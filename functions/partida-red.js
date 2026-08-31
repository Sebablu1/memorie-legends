/**
 * Motor en red: la partida vive en el servidor.
 *
 * MODELO DE DATOS
 *
 *   partidas/{codigo}                  ← estado COMPLETO. Secreto.
 *     jugadores      [uid, ...]        el índice en este array es el índice
 *                                      del jugador en el motor, y no cambia
 *     estado         {...}             el estado del motor, con TODAS las
 *                                      cartas: manos, mazo y orden del mazo
 *     ventana        {...}             ventana de descarte abierta, si hay
 *     latidos        { uid: ms }       última señal de vida de cada uno
 *     ausentes       [uid, ...]        los que dejaron de dar señales
 *     abandonaron    [uid, ...]        los que se fueron pagando la penalización
 *     version        n                 sube en cada cambio; ordena los avisos
 *
 *   partidas/{codigo}/vistas/{uid}     ← lo que ese jugador puede saber
 *
 * Este documento maestro NO puede ser legible por nadie: contiene las manos
 * de los cuatro y el orden del mazo. Las reglas de Firestore tienen que
 * negarlo explícitamente, y cada jugador lee sólo su propia vista, que se
 * escribe en la misma transacción con `vistaDe`.
 *
 * Si algún día alguien "arregla" las reglas dejando leer `partidas`, el juego
 * se termina en silencio: cualquiera abriría la consola y vería las manos.
 * Por eso la comprobación está también en las pruebas.
 */

import { vistaDe, filtracionesEn, MS_REVELACION } from "./reglas/vista.js";
import * as motor from "./reglas/motor.js";
import { semillaAleatoria } from "./reglas/azar.js";
import {
  MS_VENTANA,
  crearVentana,
  registrarIntento,
  resolverVentana,
  venceEn,
  yaVencio,
} from "./reglas/red.js";

/** Sin señales durante este tiempo, se considera que el jugador se cayó. */
export const MS_SIN_SENALES = 15000;

/** Lo que espera la mesa a que alguien levante antes de saltarle el turno. */
export const MS_TURNO = 8000;

/** Lo que dura la mirada del principio de la ronda. */
export const MS_MIRAR = 2000;

/** Lo que se muestran los resultados antes de repartir la ronda siguiente. */
export const MS_ENTRE_RONDAS = 6000;

/**
 * Lo que se muestra el resultado final antes de repartir el pozo.
 *
 * Corto a propósito: el dinero de la gente no puede quedar esperando. Pero no
 * cero, para que los cuatro alcancen a recibir la vista con el resultado antes
 * de que la sala pase a terminada.
 */
export const MS_ANTES_DE_CERRAR = 4000;

/**
 * Acciones que un jugador puede pedir. Cualquier otra cosa se rechaza sin
 * mirarla: la lista es blanca a propósito.
 */
export const ACCIONES = {
  MIRAR: "mirar",
  DESCARTAR: "descartar",
  LEVANTAR: "levantar",
  CAMBIAR: "cambiar",
  TIRAR: "tirar",
  PODER_MIRAR: "poderMirar",
  PODER_CAMBIO: "poderCambio",
  SALTAR_PODER: "saltarPoder",
  CORTAR: "cortar",
  PASAR: "pasar",
};

/** En qué fase del motor tiene sentido cada acción. */
const FASE_DE = {
  [ACCIONES.MIRAR]: "mirar",
  [ACCIONES.DESCARTAR]: "descarte",
  [ACCIONES.LEVANTAR]: "turno",
  [ACCIONES.CAMBIAR]: "levantada",
  [ACCIONES.TIRAR]: "levantada",
  [ACCIONES.PODER_MIRAR]: "poder",
  [ACCIONES.PODER_CAMBIO]: "poder",
  [ACCIONES.SALTAR_PODER]: "poder",
  [ACCIONES.CORTAR]: "postLevantada",
  [ACCIONES.PASAR]: "postLevantada",
};

/** Acciones que sólo puede pedir quien tiene el turno. */
const EXIGEN_TURNO = new Set([
  ACCIONES.LEVANTAR, ACCIONES.CAMBIAR, ACCIONES.TIRAR,
  ACCIONES.PODER_MIRAR, ACCIONES.PODER_CAMBIO, ACCIONES.SALTAR_PODER,
  ACCIONES.CORTAR, ACCIONES.PASAR,
]);

export function crearMotorEnRed({
  db, partidas, ahora, idAleatorio, marcaDeTiempo, error, semillaDe = semillaAleatoria,
  /**
   * Las tres primitivas de `cierre.js`. Se inyectan para que el cierre pueda
   * ocurrir DENTRO de la transacción que abre `avanzarPartida`: llamar a la
   * callable desde acá abriría una segunda transacción, que Firestore no
   * admite anidar.
   *
   * Sin ellas el motor funciona igual, pero una partida que llegue a
   * `finPartida` se queda ahí. Es lo que pasaba hasta ahora.
   */
  cierre = null,
}) {
  const refPartida = (codigo) => db.collection(partidas).doc(codigo);
  const refVista = (codigo, uid) =>
    db.collection(`${partidas}/${codigo}/vistas`).doc(uid);

  /**
   * El estado del motor es JSON puro y viaja tal cual: no hay nada que quitar
   * al escribir ni que reponer al leer. El azar vive dentro como una semilla
   * entera (ver reglas/azar.js), no como una función.
   *
   * Esto no es un detalle de implementación: si el estado necesitara
   * "hidratarse", habría dos formas del estado dando vueltas y tarde o
   * temprano una acción correría sobre la equivocada.
   */
  const comprobarSerializable = (estado) => {
    const sospechosos = [];
    (function buscar(v, ruta) {
      if (typeof v === "function") return sospechosos.push(`${ruta} es una función`);
      if (v instanceof Map || v instanceof Set) return sospechosos.push(`${ruta} es un ${v.constructor.name}`);
      if (v && typeof v === "object") {
        if (Object.getPrototypeOf(v) !== Object.prototype && !Array.isArray(v)) {
          return sospechosos.push(`${ruta} es una instancia de ${v.constructor?.name}`);
        }
        for (const [k, x] of Object.entries(v)) buscar(x, `${ruta}.${k}`);
      }
    })(estado, "estado");
    if (sospechosos.length) {
      throw error("internal", `El estado no es serializable: ${sospechosos.join("; ")}`);
    }
    return estado;
  };

  // ------------------------------------------------------------ escritura

  /**
   * Escribe el estado maestro y, en la MISMA transacción, la vista recortada
   * de cada jugador. Que vayan juntas es lo que impide que alguien lea una
   * vista de una jugada y el estado de otra.
   *
   * Antes de publicar, cada vista pasa por el detector de filtraciones. Es
   * una red de seguridad cara en líneas y barata en tiempo: si un cambio
   * futuro agrega un campo con cartas, revienta acá y no en producción.
   */
  function publicar(tx, codigo, partida) {
    const { estado, jugadores } = partida;
    partida = {
      ...partida,
      plazo: plazoDe(estado, partida.ventana, partida.plazo, ahora(), Boolean(partida.cerrada)),
    };

    jugadores.forEach((uid, indice) => {
      const vista = vistaDe(estado, indice);
      const fugas = filtracionesEn(vista, estado);
      if (fugas.length) {
        throw error("internal", `La vista de un jugador filtraba cartas: ${fugas.join("; ")}`);
      }
      tx.set(refVista(codigo, uid), {
        ...vista,
        version: partida.version,
        ventana: resumenDeVentana(partida.ventana),
        ausentes: partida.ausentes ?? [],
        abandonaron: partida.abandonaron ?? [],
        actualizado: marcaDeTiempo(),
      });
    });

    // Se comprueba en cada escritura, no sólo en las pruebas: un estado no
    // serializable llegaría a Firestore mutilado y en silencio.
    tx.set(refPartida(codigo), {
      ...partida,
      estado: comprobarSerializable(estado),
      actualizado: marcaDeTiempo(),
    });
  }

  /**
   * Lo que el cliente necesita saber de la ventana, sin los intentos ajenos.
   *
   * Los intentos de los demás NO viajan: saber que otro ya descartó, y en qué
   * posición, es información que en la mesa de verdad no se tiene hasta que
   * se resuelve.
   */
  function resumenDeVentana(ventana) {
    if (!ventana) return null;
    return {
      id: ventana.id,
      abiertaEn: ventana.abiertaEn,
      duracionMs: ventana.duracionMs,
      cerrada: ventana.cerrada,
    };
  }

  // -------------------------------------------------------------- plazos

  /**
   * Cuándo vence lo que la partida está esperando.
   *
   * ACÁ ESTÁ LA AUTORIDAD DEL TIEMPO. El plazo se guarda en la partida, con el
   * reloj del servidor, y desde ese momento existe independientemente de que
   * haya alguien mirando. Los clientes sólo golpean la puerta con
   * `avanzarPartida`; no pueden hacer que el tiempo pase ni que no pase.
   *
   * `marca` es lo que distingue un plazo de otro dentro de la misma fase. Sin
   * ella, cada publicación —un latido, por ejemplo— recalcularía `hasta` y el
   * reloj de turno no se agotaría nunca: bastaría con respirar para congelar
   * la partida.
   */
  function plazoDe(estado, ventana, previo, ahoraMs, cerrada = false) {
    const nuevo = (fase, marca, hasta, que) => {
      // Mismo plazo que ya estaba: se conserva su vencimiento original.
      if (previo && previo.fase === fase && previo.marca === marca) return previo;
      return { fase, marca, hasta, que };
    };

    switch (estado.fase) {
      case "mirar":
        return nuevo("mirar", `r${estado.ronda}`, ahoraMs + MS_MIRAR, "cerrarMirada");

      case "descarte":
        // Ventana ya resuelta: la mesa está viendo las cartas que se
        // expusieron. La fase sigue siendo `descarte` a propósito, porque es
        // la condición con la que `vistaDe` deja viajar esas cartas. Pasados
        // los dos segundos se cierra de verdad y todo vuelve a taparse.
        if (ventana?.cerrada) {
          return nuevo("descarte", `revelacion-${ventana.id}`,
                       ventana.resueltaEn + MS_REVELACION, "cerrarRevelacion");
        }
        // Sin ventana, lo que corresponde es abrirla, y ya.
        if (!ventana) {
          return nuevo("descarte", `abrir-r${estado.ronda}`, ahoraMs, "abrirVentana");
        }
        return nuevo("descarte", ventana.id, venceEn(ventana), "cerrarVentana");

      case "turno":
        // El reloj corre por turno, no por publicación.
        return nuevo("turno", `t${estado.turnosRonda}-${estado.indiceTurno}`,
                     ahoraMs + MS_TURNO, "saltarTurno");

      case "finRonda":
        return nuevo("finRonda", `r${estado.ronda}`, ahoraMs + MS_ENTRE_RONDAS, "siguienteRonda");

      case "finPartida":
        // Una partida terminada NO es un estado final: falta repartir el pozo.
        // Que este caso devolviera `null` —cayendo en el `default`— es lo que
        // dejaba la partida viva para siempre, con las entradas cobradas y el
        // pozo retenido, esperando a alguien que nunca iba a llamar.
        //
        // El plazo es corto pero no cero: son los segundos en que los cuatro
        // jugadores ven el resultado antes de que la sala se cierre. Y una vez
        // cerrada vuelve a ser `null`, porque ahí sí no queda nada que hacer.
        if (cerrada) return null;
        return nuevo("finPartida", `r${estado.ronda}`, ahoraMs + MS_ANTES_DE_CERRAR, "cerrarPartida");

      // Levantada, poder y postLevantada no tienen reloj, igual que en la mesa
      // local: esas decisiones se toman sin apuro. Si el jugador desaparece,
      // lo resuelve `saltarAusente`, que exige 15 segundos de silencio.
      default:
        return null;
    }
  }

  // ---------------------------------------------------------- validación

  function exigirPartida(snap, codigo) {
    if (!snap.exists) throw error("not-found", `No encontramos la partida ${codigo}.`);
    return snap.data();
  }

  function exigirJugador(partida, uid) {
    const indice = partida.jugadores.indexOf(uid);
    if (indice < 0) throw error("permission-denied", "No estás jugando esta partida.");
    if ((partida.abandonaron ?? []).includes(uid)) {
      throw error("failed-precondition", "Abandonaste esta partida.");
    }
    if (partida.estado.jugadores[indice]?.eliminado) {
      throw error("failed-precondition", "Quedaste eliminado de esta partida.");
    }
    return indice;
  }

  /**
   * Posiciones y objetivos dentro de rango.
   *
   * `usarPoderCambio` no comprueba los índices: si le llega una posición que
   * no existe, mete `undefined` dentro de una mano y la partida queda con una
   * carta fantasma. En la mesa local eso no podía pasar porque las posiciones
   * salían de un clic sobre una carta dibujada; acá llegan por la red y hay
   * que comprobarlas.
   */
  function exigirPosiciones(partida, indice, accion, { posicion, objetivo }) {
    const manoDe = (i) => partida.estado.jugadores[i]?.mano;
    const enRango = (i, pos) =>
      Number.isInteger(pos) && pos >= 0 && pos < (manoDe(i)?.length ?? 0);

    if (accion === ACCIONES.MIRAR || accion === ACCIONES.CAMBIAR) {
      if (!enRango(indice, posicion)) {
        throw error("invalid-argument", "Esa posición no existe en tu mano.");
      }
    }

    if (accion === ACCIONES.PODER_MIRAR || accion === ACCIONES.PODER_CAMBIO) {
      const poder = partida.estado.poderPendiente;
      // El poder es de quien lo levantó, y de nadie más. `usarPoderCambio`
      // toma al dueño del poder como sujeto sin mirar quién llamó, así que si
      // esto no estuviera, un jugador podría disparar el poder de otro.
      if (!poder || poder.indiceJugador !== indice) {
        throw error("permission-denied", "Ese poder no es tuyo.");
      }
      const otro = objetivo?.indice;
      if (!Number.isInteger(otro) || otro < 0 || otro >= partida.jugadores.length) {
        throw error("invalid-argument", "Ese jugador no está en la partida.");
      }
      if (partida.estado.jugadores[otro]?.eliminado) {
        throw error("failed-precondition", "Ese jugador ya no está en juego.");
      }
      if (accion === ACCIONES.PODER_MIRAR && !enRango(otro, posicion)) {
        throw error("invalid-argument", "Esa posición no existe.");
      }
      if (accion === ACCIONES.PODER_CAMBIO) {
        if (!enRango(indice, posicion)) {
          throw error("invalid-argument", "Esa posición no existe en tu mano.");
        }
        if (!enRango(otro, objetivo?.posicion)) {
          throw error("invalid-argument", "Esa posición no existe en la mano del otro.");
        }
      }
    }
  }

  function exigirFase(partida, accion) {
    const esperada = FASE_DE[accion];
    if (!esperada) throw error("invalid-argument", "Acción desconocida.");
    if (partida.estado.fase !== esperada) {
      throw error(
        "failed-precondition",
        `Eso no se puede hacer ahora: la partida está en "${partida.estado.fase}".`,
      );
    }
  }

  // ------------------------------------------------------------ reparto

  /**
   * Reparte en el servidor. El mazo se baraja acá y su orden no sale nunca:
   * es la diferencia entre un juego de memoria y una lista pública de cartas.
   */
  /**
   * Reparto DENTRO de una transacción que ya está abierta.
   *
   * Existe separado de `repartir` porque `iniciarPartida` tiene que cobrar la
   * entrada y crear la partida en la MISMA transacción. Si fueran dos, una
   * partida podría quedar iniciada sin documento maestro —o al revés— y no
   * habría forma de saber cuál de las dos cosas pasó.
   */
  async function repartirEn(tx, { codigo, jugadores, nombres }) {
    const snap = await tx.get(refPartida(codigo));
    // Idempotente: repartir dos veces la misma partida no la reinicia.
    if (snap.exists) return { codigo, yaExistia: true, version: snap.data().version };

    const configuracion = jugadores.map((uid, i) => ({
      id: uid,
      nombre: nombres?.[i] ?? `Jugador ${i + 1}`,
      esIA: false,
    }));

    const partida = {
      codigo,
      jugadores,
      // La semilla la elige el SERVIDOR. Si la mandara el cliente, podría
      // probar semillas hasta dar con un reparto que le convenga.
      estado: motor.empezarRonda(motor.crearPartida(configuracion, { semilla: semillaDe() })),
      ventana: null,
      latidos: Object.fromEntries(jugadores.map((uid) => [uid, ahora()])),
      ausentes: [],
      abandonaron: [],
      version: 1,
      creada: marcaDeTiempo(),
    };

    publicar(tx, codigo, partida);
    return { codigo, yaExistia: false, version: 1 };
  }

  const repartir = (datos) => db.runTransaction((tx) => repartirEn(tx, datos));

  // ------------------------------------------------------- ventana

  /**
   * Abre la ventana de reflejos. La abre el SERVIDOR, con su reloj, y el
   * identificador es impredecible: es la semilla del desempate.
   */
  async function abrirVentana({ codigo }) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(refPartida(codigo));
      const partida = exigirPartida(snap, codigo);

      if (partida.estado.fase !== "descarte") {
        throw error("failed-precondition", "La partida no está en fase de descarte.");
      }
      // Idempotente: si ya hay una ventana abierta, se devuelve esa.
      if (partida.ventana && !partida.ventana.cerrada) {
        return { ventana: resumenDeVentana(partida.ventana), yaEstaba: true };
      }

      const ventana = crearVentana({
        id: `v_${idAleatorio()}`,
        abiertaEn: ahora(),
        duracionMs: MS_VENTANA,
      });

      const siguiente = { ...partida, ventana, version: partida.version + 1 };
      publicar(tx, codigo, siguiente);
      return { ventana: resumenDeVentana(ventana), yaEstaba: false };
    });
  }

  /**
   * Anota un intento de descarte. NO resuelve: sólo lo guarda.
   *
   * Que no resuelva es la decisión central del diseño. Si resolviera acá,
   * "el primero" sería el primero en llegar, y ganaría siempre la mejor
   * conexión. Se junta todo y se ordena al cerrar.
   */
  async function intentarDescarte({ uid, codigo, windowId, posicion, clientActionId, declarado, latencia, incertidumbre }) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(refPartida(codigo));
      const partida = exigirPartida(snap, codigo);
      const indice = exigirJugador(partida, uid);
      exigirFase(partida, ACCIONES.DESCARTAR);

      if (!partida.ventana) throw error("failed-precondition", "No hay ninguna ventana abierta.");

      const resultado = registrarIntento(
        partida.ventana,
        { windowId, clientActionId, uid, posicion, declarado, latencia, incertidumbre },
        { ahora: ahora(), cantidadDeCartas: partida.estado.jugadores[indice].mano.length },
      );

      if (!resultado.ok) {
        throw error("failed-precondition", mensajeDeRechazo(resultado.motivo));
      }
      // Duplicado: se contesta que sí sin escribir nada. Un reintento por una
      // respuesta que se perdió no puede costar una carta de castigo.
      if (resultado.duplicado) {
        return { anotado: true, duplicado: true, version: partida.version };
      }

      const siguiente = {
        ...partida,
        ventana: resultado.ventana,
        latidos: { ...partida.latidos, [uid]: ahora() },
        version: partida.version + 1,
      };
      // Ojo: no se republican las vistas con los intentos ajenos dentro; el
      // resumen de ventana que viaja no los incluye.
      publicar(tx, codigo, siguiente);
      return { anotado: true, duplicado: false, version: siguiente.version };
    });
  }

  const mensajeDeRechazo = (motivo) => ({
    ventana_distinta: "Esa jugada era de otra ronda.",
    ventana_cerrada: "La ventana de descarte ya se cerró.",
    fuera_de_tiempo: "Llegaste fuera de tiempo.",
    posicion_invalida: "Esa posición no existe en tu mano.",
    falta_identificador: "A la jugada le falta su identificador.",
    no_jugador: "No estás jugando esta partida.",
  })[motivo] ?? "No pudimos registrar la jugada.";

  /**
   * Cierra la ventana y aplica todos los intentos en el orden calculado.
   *
   * Es idempotente: cerrar dos veces no vuelve a aplicar nada, porque lo
   * primero que se mira es si ya estaba cerrada. Puede pedirla cualquiera
   * (el primer cliente que ve que venció), y por eso tiene que aguantar que
   * la pidan los cuatro a la vez: la transacción deja pasar una sola.
   */
  async function cerrarVentana({ codigo, forzar = false }) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(refPartida(codigo));
      const partida = exigirPartida(snap, codigo);

      if (!partida.ventana) throw error("failed-precondition", "No hay ventana que cerrar.");
      if (partida.ventana.cerrada) {
        return { yaEstaba: true, orden: [], version: partida.version };
      }
      if (!forzar && !yaVencio(partida.ventana, ahora())) {
        throw error("failed-precondition", "La ventana todavía no terminó.");
      }

      const indiceDe = (u) => {
        const i = partida.jugadores.indexOf(u);
        return i < 0 ? null : i;
      };

      const { estado, orden } = resolverVentana(
        partida.estado,
        partida.ventana,
        indiceDe,
        motor.intentarDescarte,
      );

      // La fase sigue en `descarte` los dos segundos de la revelación; el
      // plazo `cerrarRevelacion` la termina. Ver `plazoDe`.
      const siguiente = {
        ...partida,
        estado,
        ventana: { ...partida.ventana, cerrada: true, resueltaEn: ahora() },
        version: partida.version + 1,
      };

      publicar(tx, codigo, siguiente);
      return {
        yaEstaba: false,
        version: siguiente.version,
        // Se devuelve el orden para que la mesa pueda animar quién ganó.
        orden: orden.map((o) => ({ uid: o.uid, posicion: o.posicion, resultado: o.resultado })),
      };
    });
  }

  /**
   * Cierra la fase de mirar. La decide el servidor con su reloj, igual que la
   * ventana: si dependiera de que cada cliente avise, el que tarda en avisar
   * le regalaría segundos de memorización a los demás.
   */
  async function cerrarMirada({ codigo }) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(refPartida(codigo));
      const partida = exigirPartida(snap, codigo);
      if (partida.estado.fase !== "mirar") {
        return { yaEstaba: true, version: partida.version };
      }
      const siguiente = {
        ...partida,
        estado: motor.terminarMirada(partida.estado),
        version: partida.version + 1,
      };
      publicar(tx, codigo, siguiente);
      return { yaEstaba: false, version: siguiente.version };
    });
  }

  // ------------------------------------------------------- turnos

  /**
   * Acciones de turno. Una sola puerta para todas: cada una declara en qué
   * fase vive y si exige el turno, y acá se comprueba siempre, sin excepción.
   *
   * `clientActionId` las hace idempotentes: un doble clic o un reintento no
   * levanta dos cartas.
   */
  async function accionDeTurno({ uid, codigo, accion, clientActionId, posicion, objetivo }) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(refPartida(codigo));
      const partida = exigirPartida(snap, codigo);
      const indice = exigirJugador(partida, uid);

      if (!clientActionId) throw error("invalid-argument", "Falta el identificador de la jugada.");
      // Ya aplicada: se contesta con el estado de entonces, sin repetirla.
      if (partida.aplicadas?.[clientActionId]) {
        return { duplicado: true, version: partida.version };
      }

      exigirFase(partida, accion);

      if (EXIGEN_TURNO.has(accion) && partida.estado.indiceTurno !== indice) {
        throw error("failed-precondition", "No es tu turno.");
      }

      exigirPosiciones(partida, indice, accion, { posicion, objetivo });

      const estado = aplicar(partida.estado, indice, accion, { posicion, objetivo });
      if (estado === partida.estado) {
        throw error("failed-precondition", "Esa jugada no cambia nada.");
      }

      // Lo que este jugador tiene derecho a VER por haber hecho esta jugada.
      // Viaja en la RESPUESTA, no en la partida: se muestra unos segundos en
      // su pantalla y se olvida. Guardarlo en el estado sería reinventar
      // `infoPublica`, que se sacó justamente para que no quedara rastro.
      const revelado = queRevela(partida.estado, indice, accion, { posicion, objetivo });

      const siguiente = {
        ...partida,
        estado,
        latidos: { ...partida.latidos, [uid]: ahora() },
        // Se recuerdan las últimas jugadas para poder reconocer un reintento.
        aplicadas: recortar({ ...(partida.aplicadas ?? {}), [clientActionId]: true }),
        version: partida.version + 1,
      };
      publicar(tx, codigo, siguiente);
      return { duplicado: false, version: siguiente.version, fase: estado.fase, ...revelado };
    });
  }

  /** Se guardan las últimas 40 jugadas: alcanza de sobra para un reintento. */
  function recortar(aplicadas) {
    const claves = Object.keys(aplicadas);
    if (claves.length <= 40) return aplicadas;
    return Object.fromEntries(claves.slice(-40).map((k) => [k, true]));
  }

  /**
   * Qué ve el jugador que hizo la jugada, y sólo él.
   *
   * Mirar una carta propia al empezar la ronda, o usar un poder de mirada,
   * son jugadas cuyo resultado es información privada. El estado publicado no
   * la lleva —ninguna vista, ni la suya— porque ahí quedaría escrita; viaja
   * una sola vez, en la respuesta a quien la pidió.
   */
  function queRevela(estado, indice, accion, { posicion, objetivo }) {
    if (accion === ACCIONES.MIRAR) {
      return { carta: estado.jugadores[indice].mano[posicion] ?? null };
    }
    if (accion === ACCIONES.PODER_MIRAR) {
      const objetivoIndice = objetivo?.indice ?? indice;
      return { carta: estado.jugadores[objetivoIndice]?.mano[posicion] ?? null };
    }
    if (accion === ACCIONES.PODER_CAMBIO) {
      const { revelada } = motor.usarPoderCambio(
        estado, posicion, objetivo?.indice, objetivo?.posicion,
      );
      return { revelada: revelada ?? null };
    }
    return {};
  }

  function aplicar(estado, indice, accion, { posicion, objetivo }) {
    switch (accion) {
      case ACCIONES.MIRAR: return motor.mirar(estado, indice, posicion);
      case ACCIONES.LEVANTAR: return motor.levantar(estado);
      case ACCIONES.CAMBIAR: return motor.cambiarCarta(estado, posicion);
      case ACCIONES.TIRAR: return motor.tirarCarta(estado);
      case ACCIONES.SALTAR_PODER: return motor.saltarPoder(estado);
      case ACCIONES.CORTAR: return motor.cortar(estado);
      case ACCIONES.PASAR: return motor.pasarTurno(estado);
      // Los dos poderes devuelven { estado, revelada }. Lo revelado NO se
      // guarda en la partida: viaja sólo en la respuesta a quien lo usó, y se
      // pierde. Guardarlo sería reinventar `infoPublica` por la puerta de
      // atrás, que es justamente lo que se sacó del motor.
      case ACCIONES.PODER_MIRAR:
        return motor.usarPoderMirar(estado, objetivo?.indice ?? indice, posicion).estado;
      case ACCIONES.PODER_CAMBIO:
        return motor.usarPoderCambio(
          estado, posicion, objetivo?.indice, objetivo?.posicion,
        ).estado;
      default: throw error("invalid-argument", "Acción desconocida.");
    }
  }

  // ------------------------------------------------------ orquestador

  /**
   * Hace avanzar la partida si algo venció. La llaman los clientes.
   *
   * Que la llamen los clientes NO significa que decidan ellos. En Firebase no
   * hay un proceso vivo esperando, así que alguien tiene que golpear la
   * puerta; pero quien mira el reloj es el servidor, y mira el suyo. Golpear
   * temprano no adelanta nada —se contesta "todavía no"— y golpear mil veces
   * es lo mismo que golpear una: el plazo está guardado y sólo se cumple
   * cuando se cumple.
   *
   * De ahí salen las cuatro garantías que hacen falta:
   *
   *   - no se duplica una ventana: abrirla dos veces devuelve la misma;
   *   - no se cierra dos veces: lo primero que se mira es si ya está cerrada;
   *   - no se avanza dos rondas: la transición cambia la fase, y el plazo
   *     siguiente ya es otro;
   *   - no se crean dos estados: todo pasa dentro de una transacción, y dos
   *     llamadas simultáneas chocan y una reintenta.
   *
   * Hace UNA transición por llamada. Es a propósito: cada paso publica vistas,
   * y encadenar varios en una transacción dejaría a los jugadores sin ver los
   * pasos intermedios.
   */
  async function avanzarPartida({ codigo }) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(refPartida(codigo));
      const partida = exigirPartida(snap, codigo);
      const t = ahora();
      const plazo = partida.plazo;

      // Un plazo que no corresponde a la fase actual sería una partida
      // colgada para siempre: el orquestador no actuaría nunca y nadie
      // recalcularía el plazo. No debería ocurrir —toda mutación pasa por
      // `publicar`, que lo recalcula— pero si ocurriera, la partida quedaría
      // muerta sin que nada lo señale. Se arregla republicando: `publicar`
      // pone el plazo que corresponde y el golpe siguiente ya puede actuar.
      const desfasado = plazo && plazo.fase !== partida.estado.fase;
      // Con `cerrada`, igual que en `publicar`. Sin ese dato, una partida ya
      // cerrada calcularía un plazo de cierre, se creería desfasada y se
      // republicaría en CADA golpe: cinco documentos escritos por segundo,
      // para siempre. Lo destapó la prueba del cierre repetido.
      const faltaPlazo =
        !plazo && plazoDe(partida.estado, partida.ventana, null, t, Boolean(partida.cerrada));

      if (desfasado || faltaPlazo) {
        publicar(tx, codigo, { ...partida, plazo: null, version: partida.version + 1 });
        return {
          hizo: "recalcularPlazo",
          motivo: desfasado ? "plazo_desfasado" : "plazo_faltante",
          fase: partida.estado.fase,
          version: partida.version + 1,
        };
      }

      if (!plazo) return { hizo: null, motivo: "sin_plazo", fase: partida.estado.fase };
      if (t < plazo.hasta) {
        return { hizo: null, motivo: "todavia_no", faltanMs: plazo.hasta - t, fase: partida.estado.fase };
      }

      // El cierre es la única transición que necesita LEER otro documento —la
      // sala, por el pozo— y mover Leyendas. Por eso no pasa por `transicion`,
      // que es sincrónica y sólo transforma el estado: va acá, donde todavía
      // no se escribió nada y las lecturas siguen siendo legales.
      if (plazo.que === "cerrarPartida") {
        if (!cierre) {
          // Sin las primitivas de cierre inyectadas no se puede repartir. Se
          // dice, en vez de fingir que no había nada que hacer.
          return { hizo: null, motivo: "sin_cierre_configurado", fase: partida.estado.fase };
        }

        // 1. LEER: la sala, con el pozo y los abandonos.
        const datos = await cierre.leer(tx, codigo);

        // 2. PENSAR: quién cobra y cuánto. Puro, sin tocar nada.
        const plan = cierre.planificar(datos);
        if (plan.yaEstaba) {
          // Otro golpe llegó primero. Se republica para que el plazo se
          // recalcule a null y esta partida deje de pedir cierre.
          publicar(tx, codigo, { ...partida, cerrada: true, version: partida.version + 1 });
          return { hizo: "cerrarPartida", yaEstaba: true, fase: partida.estado.fase };
        }

        // 3. ESCRIBIR: pagar y cerrar la sala.
        const { cierre: registro } = await cierre.aplicar(tx, {
          ...datos,
          plan,
          // No lo pidió ningún jugador: lo disparó el vencimiento del plazo.
          cerradaPor: "servidor",
        });

        publicar(tx, codigo, {
          ...partida,
          cerrada: true,
          cierre: registro,
          version: partida.version + 1,
        });

        return {
          hizo: "cerrarPartida",
          yaEstaba: false,
          fase: partida.estado.fase,
          version: partida.version + 1,
          pozo: registro.pozo,
          repartido: registro.repartido,
          sobrante: registro.sobrante,
          premios: registro.premios,
        };
      }

      const siguiente = transicion(partida, plazo, t);
      if (!siguiente) return { hizo: null, motivo: "nada_que_hacer", fase: partida.estado.fase };

      publicar(tx, codigo, { ...siguiente, version: partida.version + 1 });
      return {
        hizo: plazo.que,
        fase: siguiente.estado.fase,
        version: partida.version + 1,
        ...(siguiente.extra ?? {}),
      };
    });
  }

  /** La transición concreta que toca. Devuelve la partida nueva, o null. */
  function transicion(partida, plazo, t) {
    switch (plazo.que) {
      case "cerrarMirada":
        return { ...partida, estado: motor.terminarMirada(partida.estado) };

      case "abrirVentana": {
        const ventana = crearVentana({
          id: `v_${idAleatorio()}`,
          abiertaEn: t,
          duracionMs: MS_VENTANA,
        });
        return { ...partida, ventana };
      }

      case "cerrarVentana": {
        const indiceDe = (u) => {
          const i = partida.jugadores.indexOf(u);
          return i < 0 ? null : i;
        };
        const { estado, orden } = resolverVentana(
          partida.estado, partida.ventana, indiceDe, motor.intentarDescarte,
        );
        // NO se cierra la fase todavía. Los intentos ya están aplicados, y las
        // cartas que se expusieron sólo viajan mientras la fase sea
        // `descarte`: cerrar acá las escondería antes de que nadie las viera.
        return {
          ...partida,
          estado,
          ventana: { ...partida.ventana, cerrada: true, resueltaEn: t },
          extra: { orden: orden.map((o) => ({ uid: o.uid, posicion: o.posicion, resultado: o.resultado })) },
        };
      }

      // Se acabaron los dos segundos: se tapa todo y arranca el turno.
      case "cerrarRevelacion":
        return {
          ...partida,
          estado: motor.cerrarVentanaDescarte(partida.estado),
          ventana: null,
        };

      case "saltarTurno":
        return { ...partida, estado: motor.saltarTurno(partida.estado) };

      case "siguienteRonda": {
        // Si la partida terminó, no hay ronda siguiente que repartir.
        if (partida.estado.fase === "finPartida") return null;
        return {
          ...partida,
          estado: motor.siguienteRonda(partida.estado),
          ventana: null,
          // Las jugadas recordadas eran de la ronda anterior.
          aplicadas: {},
        };
      }

      default:
        return null;
    }
  }

  // -------------------------------------------------- desconexiones

  /**
   * Señal de vida. La manda la mesa cada pocos segundos.
   *
   * Perder la conexión NO cuesta Leyendas: sería cobrarle a alguien por un
   * corte de luz. Lo único que pasa es que, si le toca el turno y no está,
   * se le salta —igual que si se le acabara el reloj— y la partida sigue.
   * Para irse de verdad hay que abandonar, que es una decisión explícita y
   * tiene su penalización.
   */
  async function latir({ uid, codigo }) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(refPartida(codigo));
      const partida = exigirPartida(snap, codigo);
      const indice = partida.jugadores.indexOf(uid);
      if (indice < 0) throw error("permission-denied", "No estás jugando esta partida.");

      const t = ahora();
      const latidos = { ...partida.latidos, [uid]: t };
      const ausentes = partida.jugadores.filter(
        (u) => u !== uid && t - (latidos[u] ?? 0) > MS_SIN_SENALES,
      );

      // Sólo se republican las vistas si CAMBIÓ quién está ausente. Un latido
      // cada cinco segundos por cuatro jugadores serían miles de escrituras
      // por partida, y encima cada publicación recalcularía plazos.
      const cambio = JSON.stringify(ausentes) !== JSON.stringify(partida.ausentes ?? []);
      if (!cambio) {
        tx.set(refPartida(codigo), { ...partida, latidos, actualizado: marcaDeTiempo() });
        return { ausentes, version: partida.version };
      }

      const siguiente = { ...partida, latidos, ausentes, version: partida.version + 1 };
      publicar(tx, codigo, siguiente);
      return { ausentes, version: siguiente.version };
    });
  }

  /**
   * Le salta el turno a quien no está. Cualquier jugador puede pedirlo, pero
   * sólo prospera si se cumplen las dos condiciones a la vez: que le toque a
   * ese jugador y que efectivamente lleve sin dar señales más de la cuenta.
   * Así nadie puede usarlo para saltear al rival que está pensando.
   */
  async function saltarAusente({ codigo }) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(refPartida(codigo));
      const partida = exigirPartida(snap, codigo);

      const enTurno = partida.jugadores[partida.estado.indiceTurno];
      const t = ahora();
      const silencio = t - (partida.latidos?.[enTurno] ?? 0);

      if (silencio <= MS_SIN_SENALES) {
        throw error("failed-precondition", "El jugador en turno sigue conectado.");
      }

      // Levantada, poder y postLevantada no tienen reloj: se decide sin apuro.
      // Pero si el que decide no está, la mesa no puede quedarse esperando
      // para siempre. Se resuelve por él de la forma más neutra posible: sin
      // usar el poder, sin cambiar cartas y sin cortar.
      const estado = partida.estado;
      let avanzado;
      switch (estado.fase) {
        case "turno": avanzado = motor.saltarTurno(estado); break;
        case "levantada": avanzado = motor.pasarTurno(motor.tirarCarta(estado)); break;
        case "poder": avanzado = motor.saltarPoder(estado); break;
        case "postLevantada": avanzado = motor.pasarTurno(estado); break;
        default:
          throw error("failed-precondition", "No hay nada que saltar en esta fase.");
      }

      const siguiente = {
        ...partida,
        estado: avanzado,
        version: partida.version + 1,
      };
      publicar(tx, codigo, siguiente);
      return { salteado: enTurno, version: siguiente.version };
    });
  }

  /**
   * Lee la partida para que `abandonarPartida` pueda cobrar y marcar el
   * abandono en UNA sola transacción.
   *
   * Existe separada de la escritura por una razón concreta: Firestore exige
   * que todas las lecturas de una transacción ocurran ANTES de cualquier
   * escritura. `moverLeyendas` lee y escribe, así que la partida hay que
   * leerla antes de que él toque nada, o la transacción falla en producción
   * —no en las pruebas, si las pruebas no lo comprueban.
   */
  async function leerPartidaParaAbandono(tx, codigo) {
    const snap = await tx.get(refPartida(codigo));
    return snap.exists ? snap.data() : null;
  }

  /**
   * Efecto del abandono sobre la mesa, con la partida YA leída. Sólo escribe.
   *
   * Su entrada ya está en el pozo y se queda. Se lo marca eliminado para que
   * los turnos lo salteen, y `abandono: true` lo distingue de un eliminado
   * por puntos: no es lo mismo perder que irse.
   *
   * @returns true si cambió algo; false si ya estaba abandonado
   */
  function marcarAbandonoEn(tx, codigo, partida, uid) {
    if (!partida) return false;
    const indice = partida.jugadores.indexOf(uid);
    if (indice < 0) return false;
    if ((partida.abandonaron ?? []).includes(uid)) return false;

    const estado = {
      ...partida.estado,
      jugadores: partida.estado.jugadores.map((j, i) =>
        i === indice ? { ...j, eliminado: true, abandono: true } : j,
      ),
    };
    // Si le tocaba a él, el turno pasa al siguiente que siga jugando: la
    // partida tiene que poder continuar sin el que se fue.
    const enJuego = ["finRonda", "finPartida"].includes(estado.fase);
    const conTurno = estado.indiceTurno === indice && !enJuego
      ? motor.saltarTurno(estado)
      : estado;

    publicar(tx, codigo, {
      ...partida,
      estado: conTurno,
      abandonaron: [...(partida.abandonaron ?? []), uid],
      version: partida.version + 1,
    });
    return true;
  }

  /**
   * Marca que un jugador abandonó. El cobro de la penalización NO ocurre acá:
   * lo hace `abandonarPartida`, que es la única función que mueve Leyendas.
   * Esto es sólo el efecto sobre la mesa.
   *
   * Su entrada ya está en el pozo y se queda. En el motor se lo marca como
   * eliminado para que los turnos lo salteen; sigue figurando entre los
   * jugadores, porque el pozo se calculó con él.
   */
  async function marcarAbandono({ codigo, uid }) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(refPartida(codigo));
      const partida = exigirPartida(snap, codigo);
      const indice = partida.jugadores.indexOf(uid);
      if (indice < 0) throw error("permission-denied", "No estaba en esta partida.");

      if ((partida.abandonaron ?? []).includes(uid)) {
        return { yaEstaba: true, version: partida.version };
      }

      const estado = {
        ...partida.estado,
        jugadores: partida.estado.jugadores.map((j, i) =>
          i === indice ? { ...j, eliminado: true, abandono: true } : j,
        ),
      };
      // Si le tocaba a él, el turno pasa al siguiente que siga jugando.
      const conTurno =
        estado.indiceTurno === indice && estado.fase !== "finRonda" && estado.fase !== "finPartida"
          ? motor.saltarTurno(estado)
          : estado;

      const siguiente = {
        ...partida,
        estado: conTurno,
        abandonaron: [...(partida.abandonaron ?? []), uid],
        version: partida.version + 1,
      };
      publicar(tx, codigo, siguiente);
      return { yaEstaba: false, version: siguiente.version };
    });
  }

  return {
    repartir,
    repartirEn,
    leerPartidaParaAbandono,
    marcarAbandonoEn,
    avanzarPartida,
    cerrarMirada,
    abrirVentana,
    intentarDescarte,
    cerrarVentana,
    accionDeTurno,
    latir,
    saltarAusente,
    marcarAbandono,
    ACCIONES,
  };
}
