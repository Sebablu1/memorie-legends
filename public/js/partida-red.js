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
import { estimarReloj, muestraDeReloj } from "./reglas/red.js";

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
let reloj = { desfase: 0, incertidumbre: 1500, viaje: 3000, muestras: 0 };

export const relojActual = () => ({ ...reloj });

/**
 * Sincroniza con varias pasadas y se queda con la de viaje más corto.
 *
 * Se llama al entrar a la mesa y conviene repetirlo de tanto en tanto: el
 * desfase de un reloj de escritorio deriva, y la latencia cambia sola.
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
  if (muestras.length) reloj = estimarReloj(muestras);
  return relojActual();
}

/** Ahora, en el reloj del SERVIDOR, según nuestra estimación. */
export const ahoraDelServidor = () => Date.now() + reloj.desfase;

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

  let ultimaVersion = -1;

  return onSnapshot(
    doc(db, "partidas", codigo, "vistas", miUid),
    (snap) => {
      if (!snap.exists()) return;
      const vista = snap.data();
      // Firestore puede reenviar una versión ya vista, o entregarlas fuera de
      // orden tras una reconexión. Pintar una vista vieja encima de una nueva
      // haría reaparecer cartas que ya se jugaron.
      if (typeof vista.version === "number" && vista.version <= ultimaVersion) return;
      ultimaVersion = vista.version ?? ultimaVersion;
      alCambiar(vista);
    },
    (error) => {
      console.error("Se cortó la escucha de la partida:", error);
      alFallar?.(error);
    },
  );
}

// ------------------------------------------------------------ acciones

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
 */
export function intentarDescarte(codigo, ventana, posicion, tocadoEn = Date.now()) {
  const declarado = tocadoEn + reloj.desfase - ventana.abiertaEn;
  return llamar("intentarDescarte", {
    codigo,
    windowId: ventana.id,
    posicion,
    clientActionId: nuevoIdDeAccion(),
    declarado,
    latencia: Math.round((reloj.viaje ?? 0) / 2),
    incertidumbre: Math.round(reloj.incertidumbre),
  });
}

/** Cierra la ventana. La puede pedir cualquiera que vea que ya venció. */
export const cerrarVentanaDescarte = (codigo) => llamar("cerrarVentanaDescarte", { codigo });

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
export const cortar = (codigo) => accion(codigo, "cortar");
export const pasarTurno = (codigo) => accion(codigo, "pasar");

// -------------------------------------------------------- señales de vida

/** Sin señales durante 15 segundos, al jugador se le puede saltar el turno. */
export const MS_ENTRE_LATIDOS = 5000;

export const latir = (codigo) => llamar("latir", { codigo });
export const saltarAusente = (codigo) => llamar("saltarAusente", { codigo });

/**
 * Manda señales de vida cada tantos segundos.
 *
 * Perder la conexión no cuesta Leyendas: lo único que pasa es que, si te toca
 * el turno y no estás, te lo saltan. Para irse hay que abandonar, que es una
 * decisión explícita y tiene su penalización.
 *
 * @returns función para dejar de latir
 */
export function mantenerVivo(codigo) {
  const t = setInterval(() => {
    latir(codigo).catch(() => {
      // Un latido perdido no es noticia: el siguiente llega en cinco segundos.
    });
  }, MS_ENTRE_LATIDOS);
  return () => clearInterval(t);
}
