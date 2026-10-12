/**
 * Cliente de una partida en red.
 *
 * Dos reglas que no se negocian, y de las que depende todo lo demás:
 *
 *   1. Lo ÚNICO que este módulo lee de Firestore es
 *      `partidas/{codigo}/vistas/{miUid}`. No lee el documento maestro, no
 *      lee las vistas de los demás, y no lo intenta: las reglas se lo negarían
 *      igual, pero la intención tiene que estar también acá, donde se ve.
 *
 *   2. NUNCA escribe estado de partida. Cada acción es un pedido a una Cloud
 *      Function; el servidor valida, decide y publica las vistas nuevas.
 *
 * Lo que llega en la vista ya viene recortado por `vistaDe`: las manos son
 * marcadores de carta tapada, el mazo es sólo un número y la carta levantada
 * viene únicamente si es tu turno. Este módulo no destapa nada: sólo escucha.
 */

import { db, doc, onSnapshot } from "./firebase.js";
import { funciones, httpsCallable } from "./firebase.js";
import { ErrorDeServidor } from "./servidor.js";
import {
  crearFiltroDeVersion,
  estimarReloj,
  mejorEstimacion,
  muestraDeReloj,
} from "./reglas/red.js";

/** Identificador único de acción, para que un reintento no cuente dos veces. */
export function nuevoIdDeAccion() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `a_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function llamar(nombre, datos = {}) {
  try {
    const { data } = await httpsCallable(funciones, nombre)(datos);
    return data;
  } catch (error) {
    console.error(`Falló ${nombre}:`, error);
    const codigo = error?.code?.replace(/^functions\//, "") ?? "internal";
    const mensaje = error?.message && !error.message.startsWith("INTERNAL")
      ? error.message
      : "No pudimos completar la jugada.";
    throw new ErrorDeServidor(mensaje, codigo);
  }
}

// ------------------------------------------------------------- el reloj

/**
 * Estimación del desfase contra el reloj del servidor.
 *
 * Empieza en "no sé nada": incertidumbre máxima. Quien no sincroniza no gana
 * por no sincronizar — el servidor le asigna el peor caso.
 */
let reloj = { desfase: 0, incertidumbre: 1500, viaje: 3000, muestras: 0, medidaEn: 0 };

export const relojActual = () => ({ ...reloj });

/** ¿Hay al menos una medición, o se está usando el reloj crudo del aparato? */
export const relojEnHora = () => reloj.muestras > 0;

/** Los que están esperando a que llegue la primera medición. */
let esperandoElReloj = [];

/**
 * Sincroniza con varias pasadas y se queda con la mejor.
 *
 * La tanda elige su mejor muestra con `estimarReloj`, y `mejorEstimacion`
 * decide si esa gana contra la que ya estaba. Las dos usan el mismo criterio
 * —viaje más corto— y la segunda le pone vencimiento: ver `reglas/red.js`.
 *
 * Una tanda entera perdida NO pisa lo que había: sin muestras no hay
 * estimación, y quedarse con la anterior es mejor que volver a cero.
 */
export async function sincronizarReloj(pasadas = 5) {
  const muestras = [];
  for (let i = 0; i < pasadas; i++) {
    const t0 = Date.now();
    try {
      const { ahora } = await llamar("horaDelServidor");
      const t2 = Date.now();
      muestras.push(muestraDeReloj({ t0, t1: ahora, t2 }));
    } catch {
      // Una pasada perdida no es un problema: alcanza con que llegue alguna.
    }
  }
  if (muestras.length) reloj = mejorEstimacion(reloj, estimarReloj(muestras), Date.now());

  if (relojEnHora() && esperandoElReloj.length) {
    const avisar = esperandoElReloj;
    esperandoElReloj = [];
    for (const resolver of avisar) resolver(true);
  }
  return relojActual();
}

/** Ahora, en el reloj del SERVIDOR, según nuestra estimación. */
export const ahoraDelServidor = () => Date.now() + reloj.desfase;

/**
 * Lo máximo que una jugada espera a que el reloj esté en hora.
 *
 * Pasado esto se juega igual, con el reloj crudo del aparato. El techo no es
 * una comodidad: sin él, un `horaDelServidor` roto —desplegado mal, sin cuota—
 * dejaría a alguien sin poder jugar una partida que ya pagó, mientras el
 * resto del servidor contesta perfecto.
 */
export const MS_MAXIMO_SIN_RELOJ = 20_000;

/**
 * Se resuelve cuando hay reloj, o cuando se acaba la espera.
 *
 * @returns true si hay reloj, false si se jugará sin él.
 */
export function cuandoHayaReloj(tope = MS_MAXIMO_SIN_RELOJ) {
  if (relojEnHora()) return Promise.resolve(true);

  return new Promise((resolver) => {
    const avisar = (hay) => {
      clearTimeout(reparo);
      esperandoElReloj = esperandoElReloj.filter((f) => f !== avisar);
      resolver(hay);
    };
    const reparo = setTimeout(() => avisar(false), tope);
    esperandoElReloj.push(avisar);
  });
}

/** Cada cuánto se vuelve a poner el reloj en hora durante la partida. */
export const MS_ENTRE_SINCRONIAS = 30_000;

/**
 * Las esperas del reintento de arranque, mientras no haya NINGUNA muestra.
 *
 * Crecen porque un `horaDelServidor` que no contesta no va a contestar por
 * insistirle más rápido, y se detienen en ocho: más que eso es abandonar a
 * alguien que entró a una partida con entrada pagada.
 */
const ESPERAS_DE_ARRANQUE = [1000, 2000, 4000, 8000];

/**
 * Mantiene el reloj en hora toda la partida.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO ALCANZA CON MEDIR UNA VEZ AL ENTRAR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Que es lo que se hacía, y lo que este mismo archivo venía pidiendo arreglar
 * desde que se escribió: «conviene repetirlo de tanto en tanto».
 *
 * Tres motivos, y el primero es el que rompía partidas:
 *
 *   · LA PRIMERA MEDICIÓN ES LA PEOR. Sale junto con el montaje de la mesa,
 *     compitiendo con la primera vista, el primer pintado y la decodificación
 *     de los retratos. Como `t2` se toma en el callback de la promesa, cada
 *     milisegundo que el hilo principal esté ocupado se le suma al viaje de
 *     vuelta y le resta al desfase. El navegador termina creyendo que tiene
 *     más tiempo del que tiene, toca tarde, y el servidor le contesta que el
 *     turno ya no es suyo. En un teléfono eso es peor que en una computadora,
 *     y por eso se veía como un problema «de iPhone».
 *
 *   · EL RELOJ DEL APARATO SALTA. El sistema operativo lo corrige contra su
 *     servidor cuando quiere. Una medición de hace diez minutos puede estar
 *     describiendo un reloj que ya no existe.
 *
 *   · Y LA LATENCIA CAMBIA SOLA: de wifi a datos, de una celda a otra.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TRES DISPARADORES
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   1. AL ENTRAR, insistiendo hasta tener al menos una muestra. Sin ninguna,
 *      `ahoraDelServidor()` es el reloj crudo del aparato, que es la única
 *      situación en la que el error no tiene techo.
 *   2. CADA 30 s mientras se juega.
 *   3. AL VOLVER A LA PESTAÑA. Es el momento en que el reloj del aparato más
 *      probablemente se movió —el teléfono estuvo bloqueado, cambió de red—
 *      y además es gratis: nadie estaba mirando.
 *
 * Con la pestaña oculta no se mide. No hay a quién mostrarle la hora, y los
 * temporizadores de segundo plano están estrangulados: una medición tomada
 * así saldría mal y, por la regla del viaje más corto, al menos no ganaría.
 *
 * Las de rutina van con tres pasadas y no con cinco: para entonces la
 * instancia está caliente, y la mayoría se descarta igual sin desplazar a la
 * que ya estaba. Lo que importa no es medir seguido, es que exista la
 * oportunidad de que una medición limpia reemplace a una sucia.
 *
 * @returns función para dejar de sincronizar
 */
export function mantenerElRelojEnHora() {
  let vivo = true;
  let midiendo = false;
  let intentos = 0;
  let reintento = null;

  const medir = async (pasadas) => {
    // Dos tandas a la vez se pisarían las muestras y medirían la congestión
    // que ellas mismas causan.
    if (!vivo || midiendo) return;
    midiendo = true;
    try {
      await sincronizarReloj(pasadas);
    } catch {
      // `sincronizarReloj` ya se traga las pasadas sueltas; esto es el resto.
    } finally {
      midiendo = false;
    }
  };

  /** Al entrar: insistir hasta que haya una muestra. */
  const insistir = async () => {
    await medir(5);
    if (!vivo || relojEnHora()) return;
    const espera = ESPERAS_DE_ARRANQUE[Math.min(intentos, ESPERAS_DE_ARRANQUE.length - 1)];
    intentos += 1;
    reintento = setTimeout(insistir, espera);
  };

  const deRutina = () => {
    if (!document.hidden) medir(3);
  };

  const t = setInterval(deRutina, MS_ENTRE_SINCRONIAS);
  document.addEventListener("visibilitychange", deRutina);
  insistir();

  return () => {
    vivo = false;
    clearInterval(t);
    clearTimeout(reintento);
    document.removeEventListener("visibilitychange", deRutina);
  };
}

// ----------------------------------------------------------- la escucha

/**
 * Escucha la propia vista.
 *
 * @param codigo   código de la partida
 * @param miUid    quién soy. Sólo se puede escuchar la vista propia.
 * @param alCambiar  se llama con cada vista nueva
 * @param alFallar   se llama si Firestore rechaza o corta la escucha
 * @returns función para dejar de escuchar
 */
export function escucharMiVista(codigo, miUid, alCambiar, alFallar) {
  if (!codigo || !miUid) throw new Error("Hace falta el código de la partida y el uid propio.");

  // Firestore reenvía al suscribirse, repite versiones y tras una reconexión
  // puede entregar fuera de orden. La lógica está en reglas/red.js, probada.
  const esNueva = crearFiltroDeVersion();

  return onSnapshot(
    doc(db, "partidas", codigo, "vistas", miUid),
    (snap) => {
      if (!snap.exists()) return;
      const vista = snap.data();
      if (!esNueva(vista)) return;
      alCambiar(vista);
    },
    (error) => {
      console.error("Se cortó la escucha de la partida:", error);
      alFallar?.(error);
    },
  );
}

/**
 * Escucha las insignias que uno ganó al cerrarse esta partida.
 *
 * ─────────────────────────────────────────────────────────────────────
 * POR QUÉ ESCUCHAR Y NO PREGUNTAR
 * ─────────────────────────────────────────────────────────────────────
 *
 * Porque las insignias se otorgan DESPUÉS de la transacción que cierra —hay
 * que leer contadores que ella acaba de escribir— mientras que el modal del
 * final lo abre esa misma transacción. Preguntar al abrirlo es una carrera
 * que se pierde la mitad de las veces, y preguntar en un bucle hasta que
 * conteste es peor.
 *
 * Un `onSnapshot` no tiene ese problema: si el documento ya está, lo entrega
 * al suscribirse; si todavía no, lo entrega cuando aparece. No hay caso en el
 * que el aviso se pierda por llegar a destiempo.
 *
 * Nadie se entera de lo ajeno: las reglas sólo dejan leer `logros/{uid}` a su
 * dueño, y acá sólo se pide el propio.
 *
 * @returns función para dejar de escuchar
 */
export function escucharMisLogros(codigo, miUid, alGanar) {
  if (!codigo || !miUid) throw new Error("Hace falta el código de la partida y el uid propio.");

  return onSnapshot(
    doc(db, "partidas", codigo, "logros", miUid),
    (snap) => {
      if (!snap.exists()) return;
      const ganadas = snap.data()?.insignias;
      if (Array.isArray(ganadas) && ganadas.length) alGanar(ganadas);
    },
    // Un aviso que no llega no rompe nada: la insignia ya está otorgada y se
    // ve en la vitrina del panel. No vale la pena molestar al jugador.
    (error) => console.warn("No se pudo escuchar el aviso de insignias:", error),
  );
}

// ------------------------------------------------------------ acciones

/**
 * Golpea la puerta: si algo venció, el servidor lo hace avanzar.
 *
 * No decide nada. El plazo vive en la partida, con el reloj del servidor, y
 * esta llamada sólo pregunta si ya se cumplió. Llegar temprano no adelanta
 * la ventana de nadie.
 */
export const avanzarPartida = (codigo) => llamar("avanzarPartida", { codigo });

/** Cada cuánto se golpea la puerta mientras la pestaña está a la vista. */
export const MS_ENTRE_GOLPES = 900;

/**
 * Mantiene la partida avanzando.
 *
 * Todos los jugadores golpean, y está bien que sea así: si dependiera de uno
 * solo, su desconexión congelaría la mesa para los demás. Que lleguen a la
 * vez tampoco es problema: la transacción deja pasar una.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SE GOLPEA CUANDO HAY ALGO QUE PEDIR, NO CADA 900 MS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Antes el temporizador llamaba al servidor en CADA vuelta, toda la partida.
 * Con cuatro jugadores son unas 267 llamadas por minuto y por mesa —cada una
 * una función y una transacción de Firestore— y la enorme mayoría contestaba
 * «todavía no» sin tocar nada.
 *
 * El servidor ya publica en cada vista CUÁNDO vence el plazo: es el mismo
 * dato con el que la mesa dibuja la cuenta regresiva. Así que el reloj local
 * sigue latiendo igual —eso no cuesta nada— pero sólo se sale a la red
 * cuando ese plazo ya venció, que es el único momento en que el servidor
 * tiene algo que hacer.
 *
 * Sin plazo NO se golpea, y es correcto: `plazoDe` devuelve null en las
 * fases que no tienen reloj —levantada, poder— y ahí `avanzarPartida`
 * contesta `sin_plazo` sin mover nada. Al que no está se lo saca por otra
 * vía, `saltarAusente`, que tiene su propio ciclo.
 *
 * Queda un caso raro: una partida a la que le falte el plazo o lo tenga
 * desfasado se arregla golpeando, y con esto nadie golpearía. Lo cubre el
 * barredor del servidor, que pasa cada minuto — un minuto de demora en algo
 * que no debería ocurrir nunca.
 *
 * @param cuandoVence  función que devuelve el vencimiento del plazo en el
 *                     reloj del SERVIDOR, o null si no hay plazo.
 * @returns función para dejar de golpear
 */
export function mantenerEnMarcha(codigo, cuandoVence = () => null) {
  let corriendo = false;

  /** ¿El servidor tiene algo que hacer ahora mismo? */
  const vencido = () => {
    const hasta = cuandoVence();
    if (typeof hasta !== "number") return false;
    return ahoraDelServidor() >= hasta;
  };

  /**
   * `forzado` saltea la comprobación del plazo.
   *
   * Lo usan el arranque y la vuelta a la pestaña: en los dos casos lo que se
   * sabe del plazo puede estar viejo —o no haber llegado todavía— y una
   * llamada de más es más barata que una mesa congelada.
   */
  const golpe = async (forzado = false) => {
    if (corriendo || document.hidden) return;
    if (!forzado && !vencido()) return;
    corriendo = true;
    try { await avanzarPartida(codigo); } catch { /* el siguiente golpe reintenta */ }
    finally { corriendo = false; }
  };

  const alVolver = () => golpe(true);
  const t = setInterval(() => golpe(false), MS_ENTRE_GOLPES);
  document.addEventListener("visibilitychange", alVolver);
  golpe(true);
  return () => {
    clearInterval(t);
    document.removeEventListener("visibilitychange", alVolver);
  };
}

/** Abre la ventana de reflejos. Idempotente: si ya hay una, devuelve esa. */
export const abrirVentanaDescarte = (codigo) => llamar("abrirVentanaDescarte", { codigo });

/** Cierra la fase de mirar. */
export const cerrarMirada = (codigo) => llamar("cerrarMirada", { codigo });

/**
 * Intenta descartar.
 *
 * Se manda el momento en que se tocó, medido contra el reloj del servidor, y
 * también la propia latencia e incertidumbre. Nada de eso se cree sin más: el
 * servidor lo acota al intervalo que la llegada del pedido hace posible. Ver
 * PROTOCOLO-REFLEJOS.md.
 *
 * @param tocadoEn  Date.now() del instante del clic, no del envío. La
 *                  diferencia importa: entre uno y otro puede haber una
 *                  animación, y el jugador reaccionó en el primero.
 * @param rival     `{ objetivo }` si va contra la mano de otro. La carta a
 *                  entregar NO va acá: se manda después con `entregarCarta`,
 *                  y sólo si la respuesta dice que acertó.
 * @returns lo que contesta el servidor, más el `clientActionId` con que salió
 *          el intento: la entrega lo necesita para decir a qué ataque va.
 */
export function intentarDescarte(codigo, ventana, posicion, tocadoEn = Date.now(), rival = null) {
  const declarado = tocadoEn + reloj.desfase - ventana.abiertaEn;
  const clientActionId = nuevoIdDeAccion();
  return llamar("intentarDescarte", {
    codigo,
    windowId: ventana.id,
    posicion,
    clientActionId,
    declarado,
    latencia: Math.round((reloj.viaje ?? 0) / 2),
    incertidumbre: Math.round(reloj.incertidumbre),
    // Contra la mano de un rival: a quién se apunta. Un uid, nunca un valor:
    // la carta real la saca el servidor del estado maestro.
    ...(rival ? { objetivo: rival.objetivo } : {}),
  }).then((respuesta) => ({ ...respuesta, clientActionId }));
}

/**
 * La carta que se le da al rival después de acertarle.
 *
 * Una posición, elegida a ciegas, y a qué ataque corresponde. Va por el mismo
 * callable que el descarte —con `entregar`— para caer en la instancia que
 * acaba de atender el ataque, que está caliente.
 */
export const entregarCarta = (codigo, ventana, clientActionId, posicionEntrega) =>
  llamar("intentarDescarte", {
    entregar: true,
    codigo,
    windowId: ventana.id,
    clientActionId,
    posicionEntrega,
  });

/**
 * Deja lista una instancia de `intentarDescarte` antes de la ventana.
 *
 * Con funciones de primera generación, una instancia nueva tarda 3 a 4
 * segundos en arrancar y la primera transacción otros dos. Un descarte que cae
 * ahí llega tarde sin culpa del jugador. Esto hace que ese arranque lo pague
 * un pedido cuya hora de llegada no importa. Ver `calentar` en el servidor.
 *
 * NO pasa por `llamar`, y a propósito: aquélla anota cada falla en la consola
 * como un error. Un calentamiento que falla no es noticia —el próximo descarte
 * arranca la instancia igual que antes de que esto existiera— y llenar la
 * consola de errores que no lo son es cómo se deja de leerla.
 *
 * @returns true si la instancia quedó lista, false si no. Nadie lo necesita
 *          para seguir jugando; sirve para las pruebas.
 */
export const calentarDescarte = (codigo) =>
  httpsCallable(funciones, "intentarDescarte")({ codigo, calentar: true }).then(
    () => true,
    () => false,
  );

/*
 * Acá estaba el envoltorio de `cerrarVentanaDescarte`, y se fue con ella.
 *
 * Nunca lo llamó nadie: `mesa.js` importa una función del mismo nombre, pero
 * del MOTOR, que es otra cosa. El motivo del borrado está escrito en
 * `functions/index.js`, donde vivía la callable.
 */

/**
 * Acción de turno. `clientActionId` la hace idempotente: un doble clic o un
 * reintento por una respuesta perdida no levanta dos cartas.
 */
export const accion = (codigo, accion, datos = {}) =>
  llamar("accionDePartida", { codigo, accion, clientActionId: nuevoIdDeAccion(), ...datos });

export const mirar = (codigo, posicion) => accion(codigo, "mirar", { posicion });
export const levantar = (codigo) => accion(codigo, "levantar");
export const cambiarCarta = (codigo, posicion) => accion(codigo, "cambiar", { posicion });
export const tirarCarta = (codigo) => accion(codigo, "tirar");
export const saltarPoder = (codigo) => accion(codigo, "saltarPoder");

/**
 * Segunda mitad del 10: ya vio las dos cartas y dice si cambia.
 *
 * El sí o el no viaja en `objetivo`, que en las demás acciones es un jugador.
 * Reusar el campo no es lindo, pero cambiarle el nombre obligaría a tocar el
 * protocolo entero; lo que importa es que el servidor lo lee como booleano
 * estricto, así que un pedido incompleto NO cambia las cartas.
 */
export const resolverCambio = (codigo, cambiar) =>
  accion(codigo, "resolverCambio", { objetivo: cambiar === true });
export const cortar = (codigo) => accion(codigo, "cortar");
export const pasarTurno = (codigo) => accion(codigo, "pasar");

// -------------------------------------------------------- señales de vida

/** Sin señales durante 15 segundos, al jugador se le puede saltar el turno. */
export const MS_ENTRE_LATIDOS = 5000;

export const latir = (codigo) => llamar("latir", { codigo });
export const saltarAusente = (codigo) => llamar("saltarAusente", { codigo });

/**
 * «He vuelto». Saca a quien llama de la lista de ausentes por tiempo.
 *
 * No manda quién: el servidor lo toma de la sesión. Mandarlo sería invitar a
 * sacar a otro de la lista.
 */
export const volver = (codigo) => llamar("volver", { codigo });

/**
 * Manda señales de vida: una apenas se entra, y después cada tantos segundos.
 *
 * Perder la conexión no cuesta Leyendas: lo único que pasa es que, si te toca
 * el turno y no estás, te lo saltan. Para irse hay que abandonar, que es una
 * decisión explícita y tiene su penalización.
 *
 * @returns función para dejar de latir
 */
export function mantenerVivo(codigo) {
  const latido = () =>
    latir(codigo).catch(() => {
      // Un latido perdido no es noticia: el siguiente llega en cinco segundos.
    });

  // El primero sale YA, sin esperar el intervalo. Además de «sigo acá» es el
  // «llegué»: la primera ronda no abre la mirada hasta que llegan todos, y
  // callarlo cinco segundos era hacer esperar a los otros tres por nada.
  latido();
  const t = setInterval(latido, MS_ENTRE_LATIDOS);
  return () => clearInterval(t);
}
