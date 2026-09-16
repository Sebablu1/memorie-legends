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
 *     ausentesPorTiempo [uid, ...]     los que dejaron vencer la decisión de
 *                                      cortar; sólo los saca «he vuelto»
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
  MS_VENTANA_REAPERTURA,
  crearVentana,
  registrarIntento,
  resolverVentana,
  venceEn,
  yaVencio,
  MS_PARA_DECIDIR,
  decisionQueVence,
} from "./reglas/red.js";

/** Sin señales durante este tiempo, se considera que el jugador se cayó. */
export const MS_SIN_SENALES = 15000;

/**
 * Sin señales de NADIE durante este tiempo, la mesa se da por desierta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ DIEZ MINUTOS Y NO QUINCE SEGUNDOS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `MS_SIN_SENALES` mide a UNO para saltarle el turno, y equivocarse ahí
 * cuesta un turno. Esto mide a los CUATRO para terminar la partida y
 * devolver el pozo, y equivocarse cuesta una partida en curso.
 *
 * Los latidos siguen saliendo con la pestaña escondida —`mantenerVivo` es un
 * `setInterval` sin condición de visibilidad, a diferencia de
 * `mantenerEnMarcha`— pero el navegador los frena a uno por minuto en una
 * pestaña de fondo, y pasados unos minutos puede congelar la página del
 * todo. Quince segundos de silencio no significan nada; diez minutos sí.
 *
 * Y el error, si lo hubiera, cae del lado bueno: una mesa cerrada de más le
 * devuelve a cada uno lo que puso. Nadie pierde Leyendas por esto.
 */
export const MS_MESA_DESIERTA = 10 * 60 * 1000;

/** Lo que espera la mesa a que alguien levante. Vive en el motor: la pinta el
    cliente y la aplica el servidor, y dos copias se separan en silencio. */
export const MS_TURNO = motor.MS_TURNO;

/**
 * Lo que dura la mirada del principio de la ronda.
 *
 * Se re-exporta la del motor en vez de declarar otra. Tenerlo escrito dos
 * veces ya nos costó una divergencia silenciosa: alguien cambió el del motor a
 * 4000 y el entrenamiento pasó a medir el doble que las partidas por Leyendas,
 * con las pruebas en verde porque cada modo miraba su propia copia.
 */
export const MS_MIRAR = motor.MS_MIRAR;

/**
 * Lo que espera el servidor a que el del turno corte o pase.
 *
 * Sale del motor y no se escribe acá otra vez: la mesa de entrenamiento usa la
 * misma cuenta, y tenerla duplicada es como se separan dos números que tenían
 * que ser el mismo.
 */
export const MS_PASO_AUTOMATICO = motor.MS_PASO_AUTOMATICO;

/** Lo que se muestran los resultados antes de repartir la ronda siguiente.
    Vive en el motor: la mesa de entrenamiento la necesita para avanzar sola
    cuando el jugador está ausente. */
export const MS_ENTRE_RONDAS = motor.MS_ENTRE_RONDAS;

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
  // Segunda mitad del 10: ya vio las dos cartas y dice si cambia.
  RESOLVER_CAMBIO: "resolverCambio",
  CORTAR: "cortar",
  PASAR: "pasar",
};

/**
 * La ventana de descarte arranca cuando arranca la MIRADA, no después.
 *
 * La muestra puede ser justo la carta que acabás de memorizar, y hasta ahora
 * ese descarte era imposible: la fase todavía era `mirar` y no existía
 * ninguna ventana a la que pertenecer.
 *
 *   0 s ───────── 2 s ───────────────── 7 s ──── 9 s
 *        MIRAR          DESCARTE          gracia
 *        └───────── una sola ventana ────────┘
 *
 * Son 7 segundos porque cubre los 2 de la mirada más los 5 de descarte de
 * siempre. Lo que vive el jugador no cambia: sólo cambia dónde empieza a
 * contar la ventana.
 */
const MS_VENTANA_TOTAL = MS_MIRAR + MS_VENTANA;

/**
 * En qué fase del motor tiene sentido cada acción.
 *
 * Descartar vale en dos, por lo de arriba. Las demás siguen atadas a una.
 */
const FASE_DE = {
  [ACCIONES.MIRAR]: "mirar",
  [ACCIONES.DESCARTAR]: ["mirar", "descarte"],
  [ACCIONES.LEVANTAR]: "turno",
  [ACCIONES.CAMBIAR]: "levantada",
  [ACCIONES.TIRAR]: "levantada",
  [ACCIONES.PODER_MIRAR]: "poder",
  [ACCIONES.PODER_CAMBIO]: "poder",
  [ACCIONES.SALTAR_PODER]: "poder",
  [ACCIONES.RESOLVER_CAMBIO]: "cambioConVista",
  [ACCIONES.CORTAR]: "postLevantada",
  [ACCIONES.PASAR]: "postLevantada",
};

/** Acciones que sólo puede pedir quien tiene el turno. */
const EXIGEN_TURNO = new Set([
  ACCIONES.LEVANTAR, ACCIONES.CAMBIAR, ACCIONES.TIRAR,
  ACCIONES.PODER_MIRAR, ACCIONES.PODER_CAMBIO, ACCIONES.SALTAR_PODER,
  ACCIONES.RESOLVER_CAMBIO,
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
      plazo: plazoDePartida(partida, partida.plazo, ahora()),
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

        // El plazo, para que el jugador VEA lo que le queda.
        //
        // Lo decide el servidor y lo sigue decidiendo el servidor: esto no
        // le da al navegador ninguna autoridad sobre el tiempo, le da la
        // cuenta que ya estaba corriendo sin que nadie se la mostrara. En
        // entrenamiento esa cuenta se ve desde siempre; en una partida por
        // Leyendas el jugador se quedaba pensando y lo pasaban sin aviso.
        //
        // No lleva cartas —fase, marca, vencimiento y qué hacer— así que no
        // hay nada que redactar. `filtracionesEn` ya corrió sobre `vista`.
        plazo: partida.plazo ?? null,
        ausentes: partida.ausentes ?? [],
        // La otra lista de ausentes, y NO mezclada con la de arriba: ver
        // `ausentesPorTiempo` en `transicion`. La mesa dibuja a los de las dos
        // como ausentes, pero sólo ésta ofrece «he vuelto».
        ausentesPorTiempo: partida.ausentesPorTiempo ?? [],
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
  /**
   * ¿El que tiene el turno está marcado como ausente por tiempo?
   *
   * Sólo la lista nueva. Los ausentes por SILENCIO ya tienen su rescate
   * —`saltarAusente`— y mezclarlos acá haría que un mismo jugador fuera
   * salteado por dos caminos a la vez.
   */
  const turnoDeUnAusente = (partida) =>
    (partida.ausentesPorTiempo ?? []).includes(partida.jugadores?.[partida.estado?.indiceTurno]);

  /**
   * El plazo de una partida, con TODO lo que hace falta saber de ella.
   *
   * Existe para que los dos llamadores no puedan pasar datos distintos. Ya
   * pasó una vez: el segundo se olvidó de `cerrada`, calculó un plazo de cierre
   * para una partida cerrada, se creyó desfasado y republicó en cada golpe,
   * para siempre. Con un dato nuevo —el ausente en turno— la misma trampa
   * volvía a estar servida, así que en vez de acordarse en dos lugares se
   * pregunta en uno.
   */
  const plazoDePartida = (partida, previo, t) =>
    plazoDe(partida.estado, partida.ventana, previo, t, {
      cerrada: Boolean(partida.cerrada),
      ausenteEnTurno: turnoDeUnAusente(partida),
    });

  function plazoDe(estado, ventana, previo, ahoraMs, { cerrada = false, ausenteEnTurno = false } = {}) {
    const nuevo = (fase, marca, hasta, que) => {
      // Mismo plazo que ya estaba: se conserva su vencimiento original.
      if (previo && previo.fase === fase && previo.marca === marca) return previo;
      return { fase, marca, hasta, que };
    };

    switch (estado.fase) {
      case "mirar":
        // Los dos segundos se cuentan desde que abrió la ventana, no desde
        // este golpe: si no, una publicación posterior recortaría la mirada.
        return nuevo("mirar", `r${estado.ronda}`,
                     (ventana?.abiertaEn ?? ahoraMs) + MS_MIRAR, "cerrarMirada");

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
        /**
         * Un ausente por tiempo no se espera: se lo saltea ya.
         *
         * Es la regla: «los demás no pierden tiempo esperando». Si la marca
         * sólo se viera, los otros tres esperarían los ocho segundos de
         * levantar, los diez de decidir y los veinte de cortar, en CADA turno
         * suyo, por alguien que ya demostró que no está.
         *
         * `ahoraMs` y no un número: el golpe siguiente lo encuentra vencido.
         * La mesa golpea cada menos de un segundo, así que en la práctica es
         * inmediato — y sigue pasando por el mismo camino que cualquier otro
         * plazo, sin un atajo aparte que haya que mantener.
         *
         * La MARCA lleva `-ausente` y no es un detalle. `nuevo()` conserva el
         * vencimiento de un plazo si la marca no cambió; sin esto, apretar «he
         * vuelto» un instante antes del golpe dejaría vivo este plazo
         * inmediato y lo saltearían igual. Con la marca distinta, al volver se
         * calcula uno nuevo de ocho segundos.
         */
        if (ausenteEnTurno) {
          return nuevo("turno", `t${estado.turnosRonda}-${estado.indiceTurno}-ausente`,
                       ahoraMs, "saltarTurno");
        }
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

      case "postLevantada":
        // `saltarAusente` no cubre este caso y por eso hace falta el plazo.
        // Aquél mide SILENCIO: pide 15 segundos sin latidos. Alguien que dejó
        // la pestaña abierta y se fue a hacer otra cosa sigue latiendo, así
        // que nunca cuenta como ausente, y la mesa se queda esperándolo sin
        // que nada la destrabe. Los otros tres no pueden hacer nada.
        //
        // La marca lleva el turno, no la ronda: en una ronda me toca decidir
        // varias veces, y con `r${estado.ronda}` la segunda heredaría el
        // vencimiento de la primera y pasaría de inmediato.
        return nuevo("postLevantada", `t${estado.turnosRonda}-${estado.indiceTurno}`,
                     ahoraMs + MS_PASO_AUTOMATICO, "pasarPorTiempo");

      /**
       * Levantada y poderes: diez segundos para decidir.
       *
       * ───────────────────────────────────────────────────────────────────
       * ESTAS FASES NO TENÍAN RELOJ, Y ERA UN ERROR
       * ───────────────────────────────────────────────────────────────────
       *
       * El razonamiento viejo era que el que levantó una carta o usó un poder
       * TIENE la carta y va a hacer algo con ella, así que no deja a nadie
       * esperando. Eso vale en una mesa de living. En red no: quien se levanta
       * con una carta en la mano congela la partida de los otros tres, y
       * `saltarAusente` no lo rescata —aquél mide SILENCIO, quince segundos
       * sin latidos, y una pestaña abierta late igual.
       *
       * ───────────────────────────────────────────────────────────────────
       * LA MARCA LLEVA EL TURNO, NO LA RONDA
       * ───────────────────────────────────────────────────────────────────
       *
       * Es el mismo error que ya documenta `postLevantada` unas líneas arriba:
       * en una ronda me toca decidir varias veces, y con `r${estado.ronda}` la
       * segunda heredaría el vencimiento de la primera y pasaría de inmediato.
       *
       * ───────────────────────────────────────────────────────────────────
       * Y ARRANCA CUANDO LEVANTA, NO CUANDO EMPEZÓ EL TURNO
       * ───────────────────────────────────────────────────────────────────
       *
       * `ahoraMs + MS_PARA_DECIDIR`, contado desde este golpe. El turno dura
       * ocho segundos y esto dura diez, así que levantar con dos segundos de
       * turno restante NO deja dos segundos para decidir: deja diez. El plazo
       * es de la decisión, no lo que sobra del turno.
       *
       * Qué pasa al vencer sale de `decisionQueVence`, en `reglas/red.js`: con
       * una carta levantada se descarta —es la única jugada posible— y con un
       * poder se salta, porque elegir con qué carta cambia el 9 sería jugar por
       * otro.
       */
      default: {
        const decision = decisionQueVence(estado.fase);
        if (!decision) return null;
        return nuevo(estado.fase, `t${estado.turnosRonda}-${estado.indiceTurno}`,
                     ahoraMs + MS_PARA_DECIDIR, decision);
      }
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

    // La segunda mitad del 10 la decide QUIEN lo uso, no quien tenga el turno.
    // Son la misma persona hoy, pero atar el permiso al turno seria confiar en
    // una coincidencia: si manana el turno pudiera moverse durante la
    // decision, el cambio lo resolveria otro.
    if (accion === ACCIONES.RESOLVER_CAMBIO) {
      const pendiente = partida.estado.cambioPendiente;
      if (!pendiente || pendiente.indiceJugador !== indice) {
        throw error("permission-denied", "Ese cambio no es tuyo.");
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

  /**
   * Ventana de una ronda: se abre con la mirada y dura hasta el final del
   * descarte.
   *
   * Va acá y no en un plazo `abrirVentana` a propósito. Si la abriera un golpe
   * posterior, `abiertaEn` sería el momento de ese golpe —hasta 900 ms
   * después, que es cada cuánto golpean los clientes— y la mirada perdería esa
   * porción de sus dos segundos.
   */
  const ventanaDeRonda = (t) =>
    crearVentana({ id: `v_${idAleatorio()}`, abiertaEn: t, duracionMs: MS_VENTANA_TOTAL });

  /**
   * ¿El motor acaba de abrir una ventana de reflejos que la red todavía no
   * tiene? Pasa al tirar una carta: la muestra cambia y la mesa vuelve a
   * reaccionar, pero la ventana de la ronda ya se cerró.
   */
  const reabreDescarte = (partida, estado) =>
    estado.fase === "descarte" &&
    Boolean(estado.ventanaDescarte) &&
    (!partida.ventana || partida.ventana.cerrada);

  /**
   * Cuánto dura la ventana que corresponde abrir ahora.
   *
   * No son todas iguales. La del principio de la ronda dura 5 s: se viene de
   * memorizar una sola carta y hay que buscar en cuatro manos. Las que abren
   * tirar y cambiar duran 2: la mesa ya está mirando la muestra y sólo tiene
   * que reaccionar al número nuevo, y encima ocurren varias veces por ronda.
   *
   * Se distinguen por `volverA`, que es la marca que el motor ya le pone a las
   * reaperturas para saber adónde devolver el turno: la de la ronda no lo
   * lleva —desemboca en `turno`— y las otras sí. Preguntárselo al estado es
   * más seguro que confiar en desde qué línea se llamó, porque los dos sitios
   * genéricos de abajo abren tanto una como la otra.
   */
  const duracionDeVentana = (estado) =>
    estado?.ventanaDescarte?.volverA ? MS_VENTANA_REAPERTURA : MS_VENTANA;

  function exigirFase(partida, accion) {
    const esperada = FASE_DE[accion];
    if (!esperada) throw error("invalid-argument", "Acción desconocida.");
    // Casi todas las acciones valen en una sola fase; descartar vale en dos.
    const validas = Array.isArray(esperada) ? esperada : [esperada];
    if (!validas.includes(partida.estado.fase)) {
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
  async function repartirEn(tx, { codigo, jugadores, nombres, luce }) {
    const snap = await tx.get(refPartida(codigo));
    // Idempotente: repartir dos veces la misma partida no la reinicia.
    if (snap.exists) return { codigo, yaExistia: true, version: snap.data().version };

    // El retrato se fija ACÁ y no se vuelve a mirar.
    //
    // Queda dentro del estado de la partida, igual que el nombre, así que si
    // alguien se cambia el avatar a mitad de la mesa los demás siguen viendo
    // la cara con la que se sentó. Es lo que corresponde: una partida en
    // curso no puede cambiar de aspecto debajo de quien la está mirando.
    const configuracion = jugadores.map((uid, i) => ({
      id: uid,
      nombre: nombres?.[i] ?? `Jugador ${i + 1}`,
      retrato: luce?.[i]?.retrato ?? null,
      dorso: luce?.[i]?.dorso ?? null,
      insignia: luce?.[i]?.insignia ?? null,
      marco: luce?.[i]?.marco ?? null,
      titulo: luce?.[i]?.titulo ?? null,
      esIA: false,
    }));

    const partida = {
      codigo,
      jugadores,
      // La semilla la elige el SERVIDOR. Si la mandara el cliente, podría
      // probar semillas hasta dar con un reparto que le convenga.
      estado: motor.empezarRonda(motor.crearPartida(configuracion, { semilla: semillaDe() })),
      // La ventana nace con la mirada, no con el descarte: ver arriba.
      ventana: ventanaDeRonda(ahora()),
      latidos: Object.fromEntries(jugadores.map((uid) => [uid, ahora()])),
      ausentes: [],
      ausentesPorTiempo: [],
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
        duracionMs: duracionDeVentana(partida.estado),
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
  async function intentarDescarte({
    uid, codigo, windowId, posicion, clientActionId, declarado, latencia, incertidumbre,
    objetivo = null, posicionEntrega = null,
  }) {
    /**
     * La llegada se sella ACÁ, antes de cualquier espera.
     *
     * ─────────────────────────────────────────────────────────────────────
     * DÓNDE SE LEÍA ANTES, Y QUÉ LE SUMABA
     * ─────────────────────────────────────────────────────────────────────
     *
     * Se leía dentro de la transacción, después de `tx.get`. Todo lo que pasa
     * hasta ese punto quedaba cargado a la cuenta del jugador, que no tiene
     * ningún control sobre ello:
     *
     *   - La primera conexión con Firestore de una instancia nueva. En los
     *     registros de producción, la primera llamada de cada instancia pasó
     *     unos DOS SEGUNDOS dentro del handler —1963 ms en un descarte real,
     *     que además fue rechazado— y las siguientes, 200 a 290 ms.
     *
     *   - La cola. Cuando varios descartan a la vez, las transacciones chocan
     *     sobre el mismo documento y esperan su turno; cada una tarda ~250 ms.
     *     El cuarto en entrar llegaba con unos 750 ms de más, cinco veces la
     *     incertidumbre típica de sincronización. Esto pasaba TIBIO, sin
     *     ningún arranque en frío: el que pierde es el que tuvo mala suerte en
     *     la cola, no el más lento.
     *
     *   - Cada reintento de la transacción, que volvía a leer la hora, más
     *     tarde.
     *
     * Con 2 s de gracia y el piso del tiempo efectivo empujado por esa llegada
     * inflada, un toque a tiempo terminaba rechazado o contado segundos más
     * tarde de lo que fue.
     *
     * ─────────────────────────────────────────────────────────────────────
     * POR QUÉ ES SEGURO
     * ─────────────────────────────────────────────────────────────────────
     *
     * La hora de entrada al handler nunca es ANTERIOR a la llegada real del
     * pedido: el handler corre después de que el pedido llegó. Así que esto no
     * le acredita a nadie un tiempo que no tuvo — sólo deja de cobrarle uno que
     * no era suyo. La garantía del protocolo sigue intacta: mentir no da
     * ventaja. Ver PROTOCOLO-REFLEJOS.md.
     *
     * Lo que NO corrige: el arranque del contenedor, que ocurre antes de que
     * exista este handler. Eso lo reduce `calentar`, y lo resuelve de raíz que
     * el toque deje de pasar por una función.
     */
    const llegada = ahora();

    return db.runTransaction(async (tx) => {
      const snap = await tx.get(refPartida(codigo));
      const partida = exigirPartida(snap, codigo);
      const indice = exigirJugador(partida, uid);
      exigirFase(partida, ACCIONES.DESCARTAR);

      if (!partida.ventana) throw error("failed-precondition", "No hay ninguna ventana abierta.");

      // ¿Va contra la mano de otro? Todo se deriva del estado maestro: del
      // cliente sólo se aceptan POSICIONES y a quién apunta. Nada de valores,
      // ni de ids, ni de "yo conozco su carta".
      const contraRival = objetivo && objetivo !== uid;
      let indiceObjetivo = indice;

      if (contraRival) {
        indiceObjetivo = partida.jugadores.indexOf(objetivo);
        if (indiceObjetivo < 0) {
          throw error("not-found", "Ese jugador no está en la partida.");
        }
        if (partida.estado.jugadores[indiceObjetivo].eliminado) {
          throw error("failed-precondition", "Ese jugador ya no está en juego.");
        }
        // LA autorización: la da el estado, no el navegador.
        if (!motor.puedeAtacarA(partida.estado, indice, indiceObjetivo)) {
          throw error("permission-denied", "No sabés nada de esa mano.");
        }
        // La carta que se entregaría tiene que existir de verdad.
        const miMano = partida.estado.jugadores[indice].mano;
        if (!Number.isInteger(posicionEntrega) || !miMano[posicionEntrega]) {
          throw error("invalid-argument", "Elegí una carta tuya para entregar.");
        }
      }

      const resultado = registrarIntento(
        partida.ventana,
        {
          windowId, clientActionId, uid, posicion, declarado, latencia, incertidumbre,
          objetivo: contraRival ? objetivo : uid,
          posicionEntrega: contraRival ? posicionEntrega : null,
        },
        {
          // La sellada al entrar, no la de ahora: ver arriba. Es la misma en
          // cada reintento de esta transacción.
          ahora: llegada,
          // El rango se mide contra la mano que se toca, no siempre la propia.
          cantidadDeCartas: partida.estado.jugadores[indiceObjetivo].mano.length,
        },
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
        // La señal de vida fue la llegada del pedido.
        latidos: { ...partida.latidos, [uid]: llegada },
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
    ya_intento: "Ya registraste una carta en esta ventana.",
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
        motor.intentarDescarteRival,
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
        // Tirar una carta cambia la muestra y el motor vuelve a abrir una
        // ventana de reflejos. Necesita la SUYA en la red: la de la ronda ya
        // está cerrada, y su plazo de revelación —vencido hace rato— cerraría
        // esta al primer golpe. Dura MS_VENTANA a secas: acá no hay mirada que
        // cubrir, así que no lleva el agregado de MS_MIRAR.
        ventana: reabreDescarte(partida, estado)
          ? crearVentana({
              id: `v_${idAleatorio()}`,
              abiertaEn: ahora(),
              duracionMs: duracionDeVentana(estado),
            })
          : partida.ventana,
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
      // `objetivo` acá no es un jugador: es el sí o el no. Se lee como
      // booleano estricto para que un objetivo ausente NO cambie las cartas,
      // que es la salida conservadora.
      case ACCIONES.RESOLVER_CAMBIO:
        return motor.resolverCambioConVista(estado, objetivo === true);
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
  /**
   * Las partidas cuyo plazo ya venció.
   *
   * `plazo.hasta` es un número de milisegundos, así que la desigualdad
   * funciona con el índice que Firestore arma solo para cada campo. Una
   * partida cerrada no tiene plazo —`plazoDe` devuelve null— y un campo
   * ausente no entra en una comparación: quedan afuera sin filtrar nada.
   *
   * El tope existe para que un barrido no se vuelva ilimitado si algo se
   * acumula. Con el barredor corriendo cada minuto, veinte partidas por
   * vuelta es más de lo que este juego va a tener vencidas a la vez, y si
   * alguna vez lo fuera, la vuelta siguiente sigue donde quedó.
   */
  async function vencidas({ hasta = ahora(), tope = 20 } = {}) {
    const snap = await db
      .collection(partidas)
      .where("plazo.hasta", "<=", hasta)
      .limit(tope)
      .get();

    const codigos = [];
    snap.forEach((d) => codigos.push(d.id));
    return codigos;
  }

  async function avanzarPartida({ codigo }) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(refPartida(codigo));
      const partida = exigirPartida(snap, codigo);
      const t = ahora();

      /**
       * Una partida cerrada no vuelve a moverse. Nunca.
       *
       * `cerrada` la pone el cierre cuando ya repartió el pozo, y también
       * la administración cuando cancela una sala en juego y devuelve las
       * entradas. En los dos casos la plata ya se movió.
       *
       * Sin esta línea, una partida cancelada a mitad —que sigue en `turno`,
       * no en `finPartida`— vuelve a calcular su plazo en el golpe
       * siguiente, el barredor la encuentra vencida y la empuja hasta el
       * final. Ahí el cierre pagaría premios de un pozo que ya se devolvió:
       * la misma plata dos veces.
       */
      if (partida.cerrada) {
        return { hizo: null, motivo: "cerrada", fase: partida.estado.fase };
      }

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
      const faltaPlazo = !plazo && plazoDePartida(partida, null, t);

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
        const { cierre: registro, jugadores, puntuable } = await cierre.aplicar(tx, {
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
          // Quiénes terminaron la partida, y con qué puntuarla. Quien llame a
          // esto revisa después —fuera de la transacción— las insignias y
          // escribe el ranking: las dos cosas necesitan LEER algo que se acaba
          // de escribir, y adentro Firestore no lo permite.
          jugadores,
          puntuable,
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
          duracionMs: duracionDeVentana(partida.estado),
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
          motor.intentarDescarteRival,
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

      // Se acabó el tiempo de decidir: pasa, nunca corta. Cortar por alguien
      // que no contestó podría eliminarlo; pasar no le cuesta nada.
      case "pasarPorTiempo": {
        /**
         * Y queda marcado como ausente.
         *
         * ─────────────────────────────────────────────────────────────────
         * POR QUÉ ÉSTA ES LA SEÑAL
         * ─────────────────────────────────────────────────────────────────
         *
         * Veinte segundos frente a la decisión que más se piensa de la ronda,
         * sin tocar nada, dicen algo que los latidos no pueden decir: la
         * pestaña está abierta —late— pero nadie la mira. `saltarAusente` no
         * lo agarra nunca, porque mide SILENCIO.
         *
         * No es la única señal y no reemplaza a aquélla. Son dos casos: el que
         * se fue de verdad deja de latir y lo rescata `saltarAusente` sin que
         * tenga que apretar nada; el que dejó la pestaña abierta cae acá, y
         * cuando vuelve aprieta «he vuelto».
         *
         * ─────────────────────────────────────────────────────────────────
         * POR QUÉ UNA LISTA APARTE Y NO `ausentes`
         * ─────────────────────────────────────────────────────────────────
         *
         * `latir` recalcula `ausentes` ENTERA en cada llamada, a partir de los
         * latidos. Este jugador sigue latiendo, así que el próximo latido de
         * cualquiera lo borraría de ahí. Y `ausentes` es lo que dispara
         * `saltarAusente`, que rechaza a quien todavía late: meterlo ahí
         * haría que los navegadores tocaran ese timbre cada pocos segundos
         * para nada.
         *
         * Sólo ESTE caso marca. Los plazos de diez segundos —tirar la carta,
         * soltar el poder— son decisiones que vencen, no ausencias: vencer una
         * es jugar apurado, no haberse ido.
         */
        const quien = partida.jugadores[partida.estado.indiceTurno];
        const previos = partida.ausentesPorTiempo ?? [];
        return {
          ...partida,
          estado: motor.pasarTurno(partida.estado),
          ausentesPorTiempo: previos.includes(quien) ? previos : [...previos, quien],
        };
      }

      /**
       * Se acabaron los diez segundos con la carta levantada: se tira.
       *
       * Es el ÚNICO caso en que el servidor juega una carta que nadie tocó, y
       * se banca porque no hay nada que elegir: o se la queda o la tira, y
       * tirarla es lo único que no le cambia la mano sin que él lo pida.
       *
       * Queda anotado como automático en el registro —ver `tirarCarta`— para
       * que después se pueda explicar.
       */
      case "descartarPorTiempo":
        return { ...partida, estado: motor.tirarCarta(partida.estado, { porTiempo: true }) };

      /**
       * Se acabaron los diez segundos con un poder pendiente: se salta.
       *
       * ───────────────────────────────────────────────────────────────────
       * POR QUÉ SON DOS PASOS Y NO UNO
       * ───────────────────────────────────────────────────────────────────
       *
       * `saltarTurno` no sirve acá: exige fase `turno` y sin carta levantada,
       * así que desde `poder` devuelve el estado sin tocarlo — la partida se
       * quedaría colgada exactamente igual, con el plazo venciendo una y otra
       * vez.
       *
       * Lo que corresponde es lo que hace el jugador cuando declina: soltar el
       * poder, que lo deja en `postLevantada`, y de ahí pasar el turno. Son
       * las dos funciones del motor que ya existen y ya están probadas.
       *
       * El 10 a medio resolver es su propio caso: ya vio las dos cartas, así
       * que lo que se declina no es el poder sino el cambio. `false` es "no
       * cambio", que es lo único honesto — cambiar por él usaría información
       * que él tiene y el servidor no puede interpretar.
       */
      case "saltarPorTiempo": {
        const sinPendiente =
          partida.estado.fase === "cambioConVista"
            ? motor.resolverCambioConVista(partida.estado, false)
            : motor.saltarPoder(partida.estado);
        return { ...partida, estado: motor.pasarTurno(sinPendiente) };
      }

      case "siguienteRonda": {
        // Si la partida terminó, no hay ronda siguiente que repartir.
        if (partida.estado.fase === "finPartida") return null;
        return {
          ...partida,
          estado: motor.siguienteRonda(partida.estado),
          // La ronda nueva empieza mirando, así que su ventana abre acá.
          ventana: ventanaDeRonda(t),
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

      // Levantada, poder y postLevantada tienen su propio reloj —diez, diez y
      // veinte segundos— y al vencer lo resuelven solos. Este rescate llega
      // ANTES: quien dejó de latir quince segundos no va a volver en los que le
      // quedan, y esperarlos es hacer esperar a los otros tres por nadie.
      //
      // Decía que esas fases «no tienen reloj», y era cierto cuando se
      // escribió. Dejó de serlo con los cronómetros de decisión.
      //
      // Se resuelve por él de la forma más neutra posible —sin usar el poder,
      // sin cambiar cartas y sin cortar—, que es también lo que hacen esos
      // relojes al vencer.
      const estado = partida.estado;
      let avanzado;
      switch (estado.fase) {
        case "turno": avanzado = motor.saltarTurno(estado); break;
        // Se le tira la carta al ausente. Eso cambia la muestra y reabre los
        // reflejos, así que acá NO se pasa el turno: la mesa reacciona, la
        // ventana se cierra sola y la partida queda en `postLevantada`, donde
        // un segundo rescate —el ausente sigue en silencio— pasa el turno.
        // Encadenar `pasarTurno` acá no haría nada: desde `descarte` no avanza.
        case "levantada": avanzado = motor.tirarCarta(estado); break;
        case "poder": avanzado = motor.saltarPoder(estado); break;
        case "postLevantada": avanzado = motor.pasarTurno(estado); break;
        default:
          throw error("failed-precondition", "No hay nada que saltar en esta fase.");
      }

      const siguiente = {
        ...partida,
        estado: avanzado,
        // Tirarle la carta al ausente reabre los reflejos, igual que si la
        // hubiera tirado él. La ventana se crea acá y no en el golpe siguiente
        // para que `abiertaEn` sea el momento del tiro y no el del golpe.
        ventana: reabreDescarte(partida, avanzado)
          ? crearVentana({
              id: `v_${idAleatorio()}`,
              abiertaEn: ahora(),
              duracionMs: duracionDeVentana(avanzado),
            })
          : partida.ventana,
        version: partida.version + 1,
      };
      publicar(tx, codigo, siguiente);
      return { salteado: enTurno, version: siguiente.version };
    });
  }

  /**
   * Deja lista una instancia de `intentarDescarte` antes de que haga falta.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * POR QUÉ
   * ─────────────────────────────────────────────────────────────────────────
   *
   * Las funciones son de primera generación: cada instancia atiende UN pedido
   * a la vez, y una instancia nueva tarda 3 a 4 segundos en arrancar —medido
   * en producción—. Un toque que cae en una instancia así llega tarde por
   * algo que el jugador no controla, y en una ventana de reapertura de tres
   * segundos eso es un descarte perdido seguro.
   *
   * Sellar la llegada al entrar al handler no alcanza para ese caso: el
   * arranque ocurre ANTES de que el handler exista. Lo que sí sirve es que el
   * arranque lo pague otro pedido, uno que no importa cuándo llega.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * POR QUÉ UNA LECTURA Y NO UNA LLAMADA VACÍA
   * ─────────────────────────────────────────────────────────────────────────
   *
   * Una llamada vacía calienta el contenedor y las claves con que se
   * verifican los tokens, pero NO la conexión con Firestore. Y esa conexión
   * es la otra mitad del problema: en producción, la primera llamada de cada
   * instancia pasó unos dos segundos dentro del handler, casi todos en su
   * primera transacción. Una lectura la abre.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * QUÉ LECTURA, Y POR QUÉ ÉSA
   * ─────────────────────────────────────────────────────────────────────────
   *
   * La vista propia, fuera de transacción:
   *
   *   - Fuera de transacción no toma bloqueos. Leer el documento de la partida
   *     dentro de una haría esperar a los descartes de verdad justo en la
   *     ventana, que es el problema que esto viene a resolver.
   *
   *   - Y sirve de control sin costo extra: la vista sólo existe para quien
   *     juega esa partida. Nadie de afuera recibe un «listo».
   *
   * No escribe, no anota ningún intento y no sube la versión. Cuesta una
   * lectura.
   */
  async function calentar({ uid, codigo }) {
    const vista = await refVista(codigo, uid).get();
    if (!vista.exists) {
      throw error("permission-denied", "No estás jugando esta partida.");
    }
    return { caliente: true };
  }

  /**
   * «He vuelto»: sale de la lista de ausentes por tiempo.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * QUÉ HACE, Y QUÉ NO
   * ─────────────────────────────────────────────────────────────────────────
   *
   * Lo saca de `ausentesPorTiempo` y nada más. Se reincorpora a la mano que se
   * está jugando AHORA: el turno que le saltearon mientras no estaba queda
   * perdido. No se le devuelve la jugada ni se le da un turno de más — eso
   * sería premiar la ausencia con una decisión que los otros tres no tuvieron.
   *
   * Si justo le toca a él, el próximo `publicar` calcula un plazo NUEVO de
   * ocho segundos: la marca del plazo de un ausente lleva `-ausente`, así que
   * deja de coincidir y `nuevo()` no conserva el vencimiento inmediato. Ver
   * el caso `turno` de `plazoDe`.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * Y POR QUÉ NO TOCA `ausentes`
   * ─────────────────────────────────────────────────────────────────────────
   *
   * Esa lista la mantiene `latir` desde los latidos, y quien puede apretar un
   * botón está latiendo: ya no figura ahí. Tocarla acá sería pisar el trabajo
   * de otra función con un dato que ella calcula mejor.
   *
   * Idempotente. Dos clics, o un reintento de la red, no escriben dos veces:
   * si ya no estaba, se contesta sin tocar la partida — y sin subir la versión,
   * que haría republicar las cuatro vistas por nada.
   */
  async function volver({ uid, codigo }) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(refPartida(codigo));
      const partida = exigirPartida(snap, codigo);
      if (partida.jugadores.indexOf(uid) < 0) {
        throw error("permission-denied", "No estás jugando esta partida.");
      }

      const previos = partida.ausentesPorTiempo ?? [];
      if (!previos.includes(uid)) {
        return { yaEstaba: true, version: partida.version };
      }

      const siguiente = {
        ...partida,
        ausentesPorTiempo: previos.filter((u) => u !== uid),
        // Volver es también una señal de vida: si justo después hubiera que
        // decidir quién está en silencio, que no se lo cuente como ido.
        latidos: { ...partida.latidos, [uid]: ahora() },
        version: partida.version + 1,
      };
      publicar(tx, codigo, siguiente);
      return { yaEstaba: false, version: siguiente.version };
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
   * Efecto del abandono sobre la mesa. No escribe: devuelve la partida.
   *
   * Su entrada ya está en el pozo y se queda. Se lo marca eliminado para que
   * los turnos lo salteen, y `abandono: true` lo distingue de un eliminado
   * por puntos: no es lo mismo perder que irse.
   *
   * Es pura para poder aplicarla VARIAS VECES antes de escribir. Vaciar una
   * mesa desierta marca a los cuatro de una vez, y dentro de una transacción
   * no se puede releer lo que uno mismo acaba de escribir: cuatro llamadas
   * con la misma partida de partida habrían dejado sólo el último abandono.
   *
   * @returns la partida con el abandono aplicado, o null si no cambió nada
   */
  function conAbandono(partida, uid) {
    if (!partida) return null;
    const indice = partida.jugadores.indexOf(uid);
    if (indice < 0) return null;
    if ((partida.abandonaron ?? []).includes(uid)) return null;

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

    /**
     * Si no queda nadie jugando, la partida TERMINA acá.
     *
     * ─────────────────────────────────────────────────────────────────────
     * POR QUÉ NO TERMINABA SOLA
     * ─────────────────────────────────────────────────────────────────────
     *
     * El fin de partida se evalúa dentro de `cortar`, y cortar necesita que
     * alguien esté jugando. Con los cuatro afuera no cortaba nadie nunca: el
     * turno se le pasaba al siguiente activo y, como no había ninguno,
     * `siguienteActivo` devolvía el mismo índice. La partida giraba en
     * `turno` para siempre.
     *
     * Eso dejaba la sala en «jugando» con las entradas cobradas y el pozo
     * retenido, sin forma de cerrarla: es la mitad del problema de las salas
     * colgadas. La otra mitad era que nadie llamaba a `avanzarPartida` con
     * todas las pestañas escondidas, y la arregla el barredor.
     *
     * ─────────────────────────────────────────────────────────────────────
     * SIN DESEMPATE
     * ─────────────────────────────────────────────────────────────────────
     *
     * `comprobarFinPartida` sabe resolver «no queda nadie», pero cuando eso
     * pasa por PUNTOS manda a jugar una ronda de desempate. Acá no queda
     * nadie porque se fueron todos, y no hay a quién sentar a desempatar.
     * Termina sin ganador, y el cierre le devuelve el pozo a cada uno.
     *
     * Con uno solo en pie gana él, que es la regla de siempre: el último que
     * queda gana la partida.
     */
    const siguen = conTurno.jugadores.filter((j) => !j.eliminado);
    const terminada =
      siguen.length <= 1 && !enJuego
        ? {
            ...conTurno,
            fase: "finPartida",
            ganador: siguen[0] ?? null,
            desempate: false,
          }
        : conTurno;

    return {
      ...partida,
      estado: terminada,
      abandonaron: [...(partida.abandonaron ?? []), uid],
      version: partida.version + 1,
    };
  }

  /**
   * Lo mismo, escrito. Con la partida YA leída: sólo escribe.
   *
   * @returns true si cambió algo; false si ya estaba abandonado
   */
  function marcarAbandonoEn(tx, codigo, partida, uid) {
    const siguiente = conAbandono(partida, uid);
    if (!siguiente) return false;
    publicar(tx, codigo, siguiente);
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
      if (partida.jugadores.indexOf(uid) < 0) {
        throw error("permission-denied", "No estaba en esta partida.");
      }

      // Delega en `marcarAbandonoEn` en vez de repetir la marca.
      //
      // Eran dos copias del mismo cuerpo —ésta y la que usa
      // `abandonarPartida`— y ya se habían separado: al agregar el fin de
      // partida cuando no queda nadie, la otra lo aprendió y ésta no. Con eso,
      // abandonar desde el juego terminaba la partida y abandonar desde el
      // servidor la dejaba girando para siempre, según por dónde se hubiera
      // entrado. Una regla, un lugar.
      const marcado = marcarAbandonoEn(tx, codigo, partida, uid);
      return marcado
        ? { yaEstaba: false, version: partida.version + 1 }
        : { yaEstaba: true, version: partida.version };
    });
  }

  /**
   * Cierra la mesa que se quedó sin nadie.
   *
   * ───────────────────────────────────────────────────────────────────────
   * POR QUÉ EL BARREDOR SOLO NO ALCANZABA
   * ───────────────────────────────────────────────────────────────────────
   *
   * El barredor destraba la partida —le da los golpes que nadie estaba
   * dando— pero destrabar no es terminar. Una mesa en `turno` donde no queda
   * nadie recibe `saltarTurno`, y `saltarTurno` no hace más que correr el
   * turno al siguiente y anotar un renglón: no mueve una carta, no elimina a
   * nadie y no termina la ronda. Con los cuatro ausentes el turno da vueltas
   * a la mesa para siempre.
   *
   * Se vio en producción a los doce minutos de desplegar el barredor: dos
   * partidas, un paso cada una, cada minuto, `cerradas: 0` siempre. Ni un
   * error. Y cada vuelta escribía cinco documentos y le sumaba un renglón al
   * registro, que vive dentro del documento de la partida y tiene un tope de
   * un mega: la partida no se colgaba, se iba llenando.
   *
   * ───────────────────────────────────────────────────────────────────────
   * ES LA MISMA REGLA QUE YA EXISTÍA, APLICADA A LOS CUATRO
   * ───────────────────────────────────────────────────────────────────────
   *
   * No inventa una forma nueva de terminar una partida: marca el abandono
   * que ya sabía marcarse, con `conAbandono`, uno por jugador. Cuando no
   * queda ninguno en pie, esa misma función pone `finPartida`, y de ahí en
   * adelante todo es el camino de siempre: el plazo de `finPartida`, el
   * cierre, y el pozo devuelto por cabeza porque no hay a quién premiar.
   *
   * NO cobra la penalización de abandono. La cobra `abandonarPartida`, que
   * es una decisión de una persona; acá nadie decidió nada — la mesa se
   * murió sola, y encima por un fallo nuestro.
   */
  async function vaciarMesaDesierta({ codigo, silencioMs = MS_MESA_DESIERTA } = {}) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(refPartida(codigo));
      if (!snap.exists) return { vaciada: false, motivo: "no_existe" };

      const partida = snap.data();
      if (partida.cerrada) return { vaciada: false, motivo: "ya_cerrada" };

      const idos = partida.abandonaron ?? [];
      const quedan = partida.jugadores.filter(
        (uid, i) => !idos.includes(uid) && !partida.estado.jugadores[i]?.eliminado,
      );
      if (!quedan.length) return { vaciada: false, motivo: "no_queda_nadie" };

      // El latido MÁS RECIENTE de los que siguen en pie. Basta con que UNO
      // esté mirando para que la mesa no sea de nadie más que suya.
      const t = ahora();
      const latidos = partida.latidos ?? {};
      const ultimo = Math.max(...quedan.map((uid) => latidos[uid] ?? 0));
      const silencio = t - ultimo;
      if (silencio <= silencioMs) return { vaciada: false, motivo: "alguien_sigue", silencio };

      let acumulada = partida;
      const marcados = [];
      for (const uid of quedan) {
        const siguiente = conAbandono(acumulada, uid);
        if (!siguiente) continue;
        acumulada = siguiente;
        marcados.push(uid);
      }
      if (!marcados.length) return { vaciada: false, motivo: "nada_que_marcar" };

      // Una sola escritura para los cuatro: dentro de una transacción no se
      // relee lo propio, y publicar cuatro veces dejaría valer sólo la última.
      publicar(tx, codigo, acumulada);
      return {
        vaciada: true,
        marcados,
        silencio,
        fase: acumulada.estado.fase,
        version: acumulada.version,
      };
    });
  }

  return {
    repartir,
    repartirEn,
    leerPartidaParaAbandono,
    marcarAbandonoEn,
    vaciarMesaDesierta,
    avanzarPartida,
    cerrarMirada,
    abrirVentana,
    intentarDescarte,
    cerrarVentana,
    accionDeTurno,
    latir,
    saltarAusente,
    volver,
    calentar,
    vencidas,
    marcarAbandono,
    ACCIONES,
  };
}
