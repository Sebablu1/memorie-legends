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

import { vistaDe, filtracionesEn } from "./reglas/vista.js";
import * as motor from "./reglas/motor.js";
import { semillaAleatoria } from "./reglas/azar.js";
import {
  MS_VENTANA,
  crearVentana,
  registrarIntento,
  resolverVentana,
  yaVencio,
} from "./reglas/red.js";

/** Sin señales durante este tiempo, se considera que el jugador se cayó. */
export const MS_SIN_SENALES = 15000;

/** Lo que espera la mesa a que alguien levante antes de saltarle el turno. */
export const MS_TURNO = 8000;

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
  async function repartir({ codigo, jugadores, nombres }) {
    return db.runTransaction(async (tx) => {
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
    });
  }

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

      const siguiente = {
        ...partida,
        estado: motor.cerrarVentanaDescarte(estado),
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

      const estado = aplicar(partida.estado, indice, accion, { posicion, objetivo });
      if (estado === partida.estado) {
        throw error("failed-precondition", "Esa jugada no cambia nada.");
      }

      const siguiente = {
        ...partida,
        estado,
        latidos: { ...partida.latidos, [uid]: ahora() },
        // Se recuerdan las últimas jugadas para poder reconocer un reintento.
        aplicadas: recortar({ ...(partida.aplicadas ?? {}), [clientActionId]: true }),
        version: partida.version + 1,
      };
      publicar(tx, codigo, siguiente);
      return { duplicado: false, version: siguiente.version, fase: estado.fase };
    });
  }

  /** Se guardan las últimas 40 jugadas: alcanza de sobra para un reintento. */
  function recortar(aplicadas) {
    const claves = Object.keys(aplicadas);
    if (claves.length <= 40) return aplicadas;
    return Object.fromEntries(claves.slice(-40).map((k) => [k, true]));
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
      if (partida.estado.fase !== "turno") {
        throw error("failed-precondition", "Sólo se puede saltar la levantada.");
      }

      const siguiente = {
        ...partida,
        estado: motor.saltarTurno(partida.estado),
        version: partida.version + 1,
      };
      publicar(tx, codigo, siguiente);
      return { salteado: enTurno, version: siguiente.version };
    });
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
