/**
 * Protocolo de la ventana de descarte en red.
 *
 * EL PROBLEMA
 *
 * Si el servidor resolviera "gana el primero" por el orden en que le llegan
 * los pedidos, el juego dejaría de medir reflejos y pasaría a medir conexión.
 * Con 40 ms contra 180 ms, el de la fibra gana siempre, aunque el otro haya
 * reaccionado antes de verdad.
 *
 * LA SOLUCIÓN
 *
 * El servidor NO resuelve al recibir. Abre una ventana, junta todos los
 * intentos que lleguen mientras dura (más un margen de gracia para los
 * paquetes lentos) y recién al cerrarla los ordena por el momento en que
 * cada jugador REACCIONÓ, no por el momento en que su pedido llegó.
 *
 * Ese momento lo dice el cliente, y el cliente miente. Por eso no se usa tal
 * cual: se acota al intervalo físicamente posible. El cliente puede afinar su
 * tiempo dentro de lo que su propia latencia ya justificaba, y nada más.
 * Declarar "reaccioné en el milisegundo cero" no sirve de nada: el reloj se
 * corrige hasta el borde de lo plausible, que es donde queda igualmente un
 * jugador honesto con esa misma conexión.
 *
 * Lo que queda sin resolver después de eso es el empate técnico, y ahí hace
 * falta una regla determinista. Está más abajo, en `favorecido`.
 *
 * Módulo puro: ni Firestore ni DOM. Lo usan el navegador (para estimar su
 * desfase y armar el intento) y el servidor (que es el que decide).
 */

import { MS_DESCARTE } from "./motor.js";

// ------------------------------------------------------------ constantes

/**
 * Lo que dura la ventana de reflejos.
 *
 * Se re-exporta la del motor en vez de escribir el número otra vez. Tenerlo
 * duplicado ya nos costó una divergencia silenciosa —el entrenamiento midiendo
 * el doble que las partidas por Leyendas, con las pruebas en verde porque cada
 * modo leía su propia copia— y no hay razón para volver a arriesgarlo: las dos
 * ventanas SON la misma regla.
 */
export const MS_VENTANA = MS_DESCARTE;

/**
 * Margen extra en el que todavía se aceptan intentos ya enviados.
 *
 * Un jugador que tocó en el milisegundo 4990 con 300 ms de latencia llega al
 * servidor en el 5290: sin esta gracia, su acción legítima se perdería. Lo
 * que se acepta tarde es la LLEGADA, nunca la reacción: un intento cuyo
 * tiempo efectivo cae fuera de la ventana se descarta igual.
 */
export const MS_GRACIA = 2000;

/**
 * Diferencia por debajo de la cual dos reacciones no se pueden distinguir.
 *
 * Es del orden de la incertidumbre que deja una sincronización de reloj sobre
 * una conexión doméstica. Pretender resolver por debajo de esto sería fingir
 * una precisión que no existe.
 */
export const MS_EMPATE_TECNICO = 60;

/** Tope de lo que se acepta como latencia de un solo sentido. */
export const MS_LATENCIA_MAXIMA = 1500;

// ------------------------------------------------- sincronización de reloj

/**
 * Una muestra de sincronización, al estilo NTP:
 *
 *   t0  el cliente manda el pedido
 *   t1  el servidor responde con SU reloj
 *   t2  el cliente recibe la respuesta
 *
 * El viaje de ida y el de vuelta se suponen simétricos. No lo son del todo,
 * y esa asimetría es justamente parte de la incertidumbre que se reporta.
 */
export function muestraDeReloj({ t0, t1, t2 }) {
  const viaje = t2 - t0;
  return {
    // Cuánto hay que sumarle al reloj del cliente para leer el del servidor.
    desfase: t1 - (t0 + t2) / 2,
    viaje,
    // Peor caso del error de esa estimación.
    incertidumbre: viaje / 2,
  };
}

/**
 * Mejor estimación a partir de varias muestras.
 *
 * Se queda con la de viaje más corto en vez de promediar: un promedio arrastra
 * las muestras que pasaron por un pico de congestión, y son justamente las
 * peores. La más rápida es la que menos se pudo distorsionar.
 */
export function estimarReloj(muestras) {
  if (!muestras?.length) return { desfase: 0, incertidumbre: MS_LATENCIA_MAXIMA, muestras: 0 };
  const mejor = muestras.reduce((a, b) => (b.viaje < a.viaje ? b : a));
  return {
    desfase: mejor.desfase,
    incertidumbre: Math.max(mejor.incertidumbre, 1),
    viaje: mejor.viaje,
    muestras: muestras.length,
  };
}

// -------------------------------------------------------------- ventanas

/**
 * Ventana de descarte.
 *
 * `id` lo genera el servidor y es impredecible: además de identificar la
 * ventana, es la semilla del desempate, y si se pudiera adivinar se podría
 * elegir cuándo conviene empatar.
 */
export function crearVentana({ id, abiertaEn, duracionMs = MS_VENTANA, graciaMs = MS_GRACIA }) {
  return {
    id,
    abiertaEn,
    duracionMs,
    graciaMs,
    cerrada: false,
    intentos: {},
  };
}

/** ¿Todavía se aceptan LLEGADAS en esta ventana? */
export const aceptaLlegadas = (ventana, ahora) =>
  !ventana.cerrada &&
  ahora >= ventana.abiertaEn &&
  ahora <= ventana.abiertaEn + ventana.duracionMs + ventana.graciaMs;

/** ¿Ya se puede cerrar? */
export const venceEn = (ventana) => ventana.abiertaEn + ventana.duracionMs + ventana.graciaMs;
export const yaVencio = (ventana, ahora) => ahora > venceEn(ventana);

// ------------------------------------------------- el tiempo que vale

/**
 * Momento de la reacción, medido desde que se abrió la ventana.
 *
 * `declarado` es lo que dice el cliente. Se acepta sólo dentro del intervalo
 * que su propia llegada hace posible:
 *
 *   - no puede ser POSTERIOR a la llegada: nadie reacciona después de que su
 *     pedido ya llegó;
 *   - no puede ser ANTERIOR a `llegada - latencia - incertidumbre`: por más
 *     que lo afirme, el paquete habría tenido que viajar hacia atrás.
 *
 * El borde inferior es el único que un tramposo quiere forzar, y ahí es donde
 * termina: exactamente donde queda un jugador honesto con su misma conexión.
 * Mentir no da ventaja; a lo sumo recupera la que la red le quitó.
 */
export function tiempoEfectivo({ declarado, llegada, latencia, incertidumbre }) {
  const lat = Math.min(Math.max(Number(latencia) || 0, 0), MS_LATENCIA_MAXIMA);
  const inc = Math.min(Math.max(Number(incertidumbre) || 0, 0), MS_LATENCIA_MAXIMA);

  const minimoPosible = Math.max(0, llegada - lat - inc);
  const maximoPosible = llegada;

  // Un declarado ausente o disparatado cae en la llegada: el peor caso para
  // quien no manda un tiempo utilizable, nunca el mejor.
  const base = Number.isFinite(declarado) ? declarado : maximoPosible;

  return Math.min(Math.max(base, minimoPosible), maximoPosible);
}

// ------------------------------------------------------------- desempate

/**
 * Mezcla determinista de una cadena (FNV-1a de 32 bits).
 * Sirve en el navegador y en Node sin depender de crypto.
 */
function mezclar(texto) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Peso de desempate de un jugador en una ventana concreta.
 *
 * Cuando dos reacciones caen dentro del margen de incertidumbre, no hay forma
 * honesta de decir cuál fue primero: la diferencia está por debajo de lo que
 * el reloj puede medir. Hay que elegir, y toda elección es arbitraria; lo que
 * NO puede ser es sesgada ni manipulable.
 *
 *   - Ordenar por uid favorecería siempre al mismo jugador.
 *   - Usar el clientActionId dejaría que alguien lo eligiera a propósito
 *     hasta encontrar uno que gane.
 *
 * Por eso se mezcla el uid con el `windowId`, que genera el servidor y nadie
 * conoce antes de que la ventana se abra. Es reproducible —dos veces la misma
 * ventana da el mismo resultado, y por eso se puede probar—, imposible de
 * preparar de antemano, y a lo largo de muchas ventanas favorece a cada uno
 * por igual.
 */
export const favorecido = (windowId, uid) => mezclar(`${windowId}|${uid}`);

/**
 * Ordena los intentos como se van a aplicar.
 *
 * Primero por tiempo efectivo. Si dos caen dentro de `MS_EMPATE_TECNICO`,
 * decide el sorteo determinista. El orden resultante es estable: dos
 * ejecuciones sobre los mismos datos dan exactamente la misma secuencia,
 * que es lo que permite reproducir una ronda para auditarla.
 */
export function ordenarIntentos(ventana, margenMs = MS_EMPATE_TECNICO) {
  return Object.values(ventana.intentos).slice().sort((a, b) => {
    if (Math.abs(a.efectivo - b.efectivo) >= margenMs) return a.efectivo - b.efectivo;
    const pa = favorecido(ventana.id, a.uid);
    const pb = favorecido(ventana.id, b.uid);
    if (pa !== pb) return pa - pb;
    // Dos pesos iguales es astronómicamente improbable, pero el orden tiene
    // que quedar definido igual: nunca "depende".
    return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
  });
}

/** ¿Estos dos intentos empataron técnicamente? */
export const esEmpateTecnico = (a, b, margenMs = MS_EMPATE_TECNICO) =>
  Math.abs(a.efectivo - b.efectivo) < margenMs;

// --------------------------------------------------- poderes: elegibles

/**
 * Qué cartas puede tocar quien está usando un poder.
 *
 * Es una regla de INTERFAZ, no de seguridad. El servidor valida lo mismo por
 * su cuenta en `exigirPosiciones` y rechaza cualquier cosa que no cumpla; esto
 * existe para que el jugador vea de antemano qué puede tocar, en vez de
 * probar y comerse un error.
 *
 * Las cuatro reglas salen del reglamento:
 *
 *   7   mirarPropia      una carta propia
 *   8   mirarRival       una carta de otro
 *   9   cambioCiego      primero una propia, después una de otro
 *   10  cambioConVista   igual que el 9, pero se ven las dos
 *
 * Un hueco —una posición de la que ya salió la carta— nunca es elegible: no
 * hay nada ahí que mirar ni que cambiar.
 *
 * @param numero          7, 8, 9 o 10
 * @param yo              índice del que usa el poder
 * @param jugadores       los jugadores tal como los ve la vista
 * @param propiaElegida   para el 9 y el 10: la posición propia ya elegida,
 *                        o null si todavía falta elegirla
 * @returns {(indiceJugador: number, posicion: number) => boolean}
 */
export function elegibleParaPoder({ numero, yo, jugadores, propiaElegida = null }) {
  const hayCarta = (i, pos) => Boolean(jugadores?.[i]?.mano?.[pos]);
  const enJuego = (i) => Boolean(jugadores?.[i]) && !jugadores[i].eliminado;

  return (indiceJugador, posicion) => {
    if (!hayCarta(indiceJugador, posicion)) return false;
    if (!enJuego(indiceJugador)) return false;

    // El 7 mira una carta propia; el 8, una ajena.
    if (numero === 7) return indiceJugador === yo;
    if (numero === 8) return indiceJugador !== yo;

    if (numero === 9 || numero === 10) {
      // Primero la propia, después la del rival. Nunca dos propias: cambiar
      // una carta consigo mismo no es una jugada.
      return propiaElegida === null ? indiceJugador === yo : indiceJugador !== yo;
    }

    return false;
  };
}

/** Qué hay que pedirle al jugador ahora mismo. */
export function pasoDelPoder({ numero, propiaElegida = null }) {
  if (numero === 7) return "Tocá una carta <b>tuya</b> para mirarla.";
  if (numero === 8) return "Tocá una carta de <b>otro jugador</b> para mirarla.";
  if (numero === 9 || numero === 10) {
    return propiaElegida === null
      ? "Elegí una carta <b>tuya</b> para cambiar."
      : "Ahora elegí con qué carta de <b>otro jugador</b> la cambiás.";
  }
  return "";
}

// ------------------------------------------------- orden de las vistas

/**
 * Descarta las vistas que llegan viejas o repetidas.
 *
 * Firestore reenvía el documento actual al suscribirse, puede repetir una
 * versión ya entregada y, después de una reconexión, puede entregar
 * actualizaciones fuera de orden. Pintar una vista vieja encima de una nueva
 * haría reaparecer cartas ya jugadas y devolvería el turno a quien ya jugó:
 * el jugador vería la partida retroceder.
 *
 * Una vista sin número de versión se acepta —no hay con qué compararla— pero
 * no baja el listón para las que sí lo traen.
 *
 * @returns {(vista: object) => boolean} true si hay que pintarla
 */
export function crearFiltroDeVersion() {
  let ultima = -Infinity;
  return (vista) => {
    const v = vista?.version;
    if (typeof v !== "number") return true;
    if (v <= ultima) return false;
    ultima = v;
    return true;
  };
}

// ------------------------------------------------------------- registro

export const RECHAZO_INTENTO = {
  VENTANA_DISTINTA: "ventana_distinta",
  VENTANA_CERRADA: "ventana_cerrada",
  FUERA_DE_TIEMPO: "fuera_de_tiempo",
  NO_JUGADOR: "no_jugador",
  POSICION_INVALIDA: "posicion_invalida",
  FALTA_IDENTIFICADOR: "falta_identificador",
  YA_INTENTO: "ya_intento",
};

/**
 * Anota un intento en la ventana. No resuelve nada: sólo lo guarda.
 *
 * Es idempotente por `clientActionId`. Si el mismo identificador llega dos
 * veces —reintento por timeout, doble clic, recarga— la segunda no cambia
 * nada y se informa como duplicada. Eso importa más de lo que parece: sin
 * esto, un reintento por una respuesta perdida contaría como un intento nuevo
 * y podría costarle al jugador una carta de castigo que no merecía.
 *
 * @returns {{ok: true, ventana, duplicado: boolean} | {ok: false, motivo: string}}
 */
export function registrarIntento(ventana, intento, { ahora, cantidadDeCartas }) {
  const { windowId, clientActionId, uid, posicion } = intento;

  if (!clientActionId || !uid) return { ok: false, motivo: RECHAZO_INTENTO.FALTA_IDENTIFICADOR };
  if (windowId !== ventana.id) return { ok: false, motivo: RECHAZO_INTENTO.VENTANA_DISTINTA };
  if (ventana.cerrada) return { ok: false, motivo: RECHAZO_INTENTO.VENTANA_CERRADA };
  if (!aceptaLlegadas(ventana, ahora)) return { ok: false, motivo: RECHAZO_INTENTO.FUERA_DE_TIEMPO };

  if (!Number.isInteger(posicion) || posicion < 0 || posicion >= cantidadDeCartas) {
    return { ok: false, motivo: RECHAZO_INTENTO.POSICION_INVALIDA };
  }

  // Reintento TÉCNICO: el mismo pedido mandado dos veces porque se perdió la
  // respuesta. Se contesta que sí, sin volver a anotar. Un reintento de red no
  // puede costar una carta de castigo.
  //
  // Ojo: esto NO limita al jugador a un intento por ventana, y no debe
  // hacerlo. Con los poderes 8 y 10 uno sabe QUÉ carta tiene el rival pero no
  // DÓNDE, así que puede equivocarse de posición varias veces —sumando un
  // castigo por cada error— y seguir buscando. Un identificador nuevo es un
  // intento humano nuevo, y es legítimo.
  if (ventana.intentos[clientActionId]) {
    return { ok: true, ventana, duplicado: true };
  }

  // Y ACÁ, EN CAMBIO, SÍ SE LIMITA: pero sólo contra la mano PROPIA.
  //
  // Sobre lo propio el descarte es una carrera de reflejos: hay un tiro y se
  // vive con él. Sin este límite, tocar tres cartas costaba tres castigos —lo
  // reproduje: cuatro cartas antes, siete después— porque cada clic llegaba
  // con un identificador nuevo y al cerrar la ventana se aplicaban todos.
  //
  // Sobre la mano de un RIVAL no se limita, por lo que dice el comentario de
  // arriba: buscar una carta conocida por un poder es lo contrario de una
  // carrera. Hoy no existen los intentos sobre rival; la distinción queda
  // escrita para que cuando existan no choquen contra esto.
  const contraSuPropiaMano = (intento.objetivo ?? uid) === uid;
  const yaJugoLoSuyo = Object.values(ventana.intentos)
    .some((x) => x.uid === uid && (x.objetivo ?? x.uid) === x.uid);

  if (contraSuPropiaMano && yaJugoLoSuyo) {
    return { ok: false, motivo: RECHAZO_INTENTO.YA_INTENTO };
  }

  const llegada = ahora - ventana.abiertaEn;
  const efectivo = tiempoEfectivo({
    declarado: intento.declarado,
    llegada,
    latencia: intento.latencia,
    incertidumbre: intento.incertidumbre,
  });

  // La LLEGADA puede caer en la gracia; la REACCIÓN, no. Quien tocó después
  // de que la ventana terminó no descarta, por rápida que sea su conexión.
  if (efectivo > ventana.duracionMs) {
    return { ok: false, motivo: RECHAZO_INTENTO.FUERA_DE_TIEMPO };
  }

  return {
    ok: true,
    duplicado: false,
    ventana: {
      ...ventana,
      intentos: {
        ...ventana.intentos,
        [clientActionId]: {
          clientActionId,
          uid,
          // De quién es la mano que se toca: la propia, o la de un rival
          // sobre el que se tiene un poder 8/10.
          objetivo: intento.objetivo ?? uid,
          posicion,
          // Qué carta propia se entrega si el intento sobre un rival acierta.
          // Es una POSICIÓN elegida a ciegas: el jugador no sabe cuál es.
          // Sobre la mano propia no significa nada y viaja como null.
          posicionEntrega: Number.isInteger(intento.posicionEntrega)
            ? intento.posicionEntrega
            : null,
          declarado: Number.isFinite(intento.declarado) ? intento.declarado : null,
          llegada,
          efectivo,
          latencia: Number(intento.latencia) || 0,
          incertidumbre: Number(intento.incertidumbre) || 0,
        },
      },
    },
  };
}

/**
 * Resuelve la ventana entera aplicando el motor en el orden calculado.
 *
 * Acá NO se reimplementan las reglas A/B/C. El motor local ya las tiene, y
 * duplicarlas sería garantizar que en algún momento diverjan. Esta capa sólo
 * decide EN QUÉ ORDEN se aplican; el primero de la lista es el que se salva.
 *
 * @param estado        estado completo del motor, en fase "descarte"
 * @param ventana       la ventana con sus intentos
 * @param indiceDe      uid → índice del jugador en el motor
 * @param intentarDescarte  la función del motor, inyectada para no acoplar
 */
export function resolverVentana(estado, ventana, indiceDe, intentarDescarte, intentarRival) {
  const orden = ordenarIntentos(ventana);
  let siguiente = estado;
  const aplicados = [];

  for (const intento of orden) {
    const indice = indiceDe(intento.uid);
    if (indice == null || indice < 0) continue;
    const antes = siguiente;

    // Sobre la mano de otro va por el camino del poder, que valida la
    // autorización y puede terminar en transferencia. Sobre la propia, el
    // descarte de siempre.
    const objetivo = indiceDe(intento.objetivo ?? intento.uid);
    if (intentarRival && objetivo != null && objetivo >= 0 && objetivo !== indice) {
      siguiente = intentarRival(siguiente, indice, objetivo, intento.posicion, intento.posicionEntrega);
    } else {
      siguiente = intentarDescarte(siguiente, indice, intento.posicion);
    }
    // Si el motor no cambió nada (posición ya vacía, por ejemplo) no se
    // inventa un resultado: se deja constancia de que no se aplicó.
    const ultimo = siguiente.ventanaDescarte?.intentos?.at(-1);
    aplicados.push({
      ...intento,
      indice,
      aplicado: siguiente !== antes,
      resultado: siguiente !== antes ? (ultimo?.resultado ?? null) : null,
    });
  }

  return { estado: siguiente, orden: aplicados };
}
