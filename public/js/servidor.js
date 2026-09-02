/**
 * Puente con las Cloud Functions.
 *
 * Es el ÚNICO canal por el que la aplicación pide operaciones que mueven
 * Leyendas. El navegador nunca escribe saldo: pide, y el servidor decide.
 *
 * Traduce los errores de Firebase a mensajes que se le puedan mostrar a una
 * persona, y deja el detalle técnico en la consola para depurar.
 */

import { funciones, httpsCallable } from "./firebase.js";

/** Mensajes por código de error, cuando el servidor no mandó uno propio. */
const MENSAJES = {
  unauthenticated: "Iniciá sesión para continuar.",
  "failed-precondition": "No se puede hacer esto ahora mismo.",
  "invalid-argument": "Los datos enviados no son válidos.",
  "already-exists": "Esta operación ya se había hecho.",
  "not-found": "No encontramos lo que buscabas.",
  "permission-denied": "No tenés permiso para esta acción.",
  unavailable: "No pudimos conectar con el servidor. Revisá tu conexión.",
  internal: "Algo falló de nuestro lado. Probá de nuevo en un momento.",
};

/** Error con un mensaje apto para mostrar en pantalla. */
export class ErrorDeServidor extends Error {
  constructor(mensaje, codigo) {
    super(mensaje);
    this.name = "ErrorDeServidor";
    this.codigo = codigo;
  }
}

/**
 * Llama a una Cloud Function y normaliza el error.
 *
 * Los mensajes que el servidor manda con HttpsError ya vienen redactados
 * para el usuario, así que se usan tal cual; el resto cae en la tabla.
 */
async function llamar(nombre, datos = {}) {
  try {
    const { data } = await httpsCallable(funciones, nombre)(datos);
    return data;
  } catch (error) {
    console.error(`Falló la llamada a ${nombre}:`, error);
    const codigo = error?.code?.replace(/^functions\//, "") ?? "internal";
    const mensaje = error?.message && !error.message.startsWith("INTERNAL")
      ? error.message
      : (MENSAJES[codigo] ?? MENSAJES.internal);
    throw new ErrorDeServidor(mensaje, codigo);
  }
}

// --------------------------------------------------------------- salas

/**
 * Crea una sala por Leyendas y cobra la entrada.
 * @returns {Promise<{codigo: string, entrada: number}>}
 */
export const crearSala = (entrada, nombre) => llamar("crearSala", { entrada, nombre });

/**
 * Abandona una partida en curso.
 *
 * Se manda SÓLO el código. La entrada y la penalización las calcula el
 * servidor: si acá se mandara un monto, sería un monto elegido por el
 * jugador.
 *
 * @returns {Promise<{entradaPerdida: number, penalizacion: number, saldo: number}>}
 */
export const abandonarPartida = (codigo) => llamar("abandonarPartida", { codigo });

/**
 * Suma al jugador a una sala existente y le cobra la entrada.
 * @returns {Promise<{codigo: string, entrada: number, saldo: number}>}
 */
export const unirseASala = (codigo) => llamar("unirseASala", { codigo });

/**
 * Marca al jugador como listo, o le saca la marca.
 * @returns {Promise<{listo: boolean, listos: number, jugadores: number}>}
 */
export const marcarListo = (codigo, listo) => llamar("marcarListo", { codigo, listo });

/**
 * Arranca la partida. Sólo lo consigue quien creó la sala.
 * @returns {Promise<{codigo: string, jugadores: number, pozo: number}>}
 */
export const iniciarPartida = (codigo) => llamar("iniciarPartida", { codigo });

/**
 * Sale de una sala que todavía no empezó, con devolución de la entrada.
 * Si sale el creador, la sala se cancela y se devuelve a todos.
 * @returns {Promise<{cancelada: boolean, devuelto: number}>}
 */
export const salirDeSalaEnEspera = (codigo) => llamar("salirDeSalaEnEspera", { codigo });

/**
 * Reporta a otro jugador.
 *
 * No se manda quién denuncia: lo pone el servidor con el token verificado.
 * Mandarlo desde acá sería dejar que cualquiera firme denuncias con el nombre
 * de otro, y el servidor lo ignora igual.
 */
export const reportarJugador = ({ denunciado, motivo, comentario, codigo }) =>
  llamar("reportarJugador", { denunciado, motivo, comentario, codigo });
