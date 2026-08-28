/**
 * Economía de las salas humanas: entradas, pozo, reparto y abandono.
 *
 * Módulo puro. No toca Firestore ni el DOM: lo consumen tanto el navegador
 * (para mostrar cifras antes de confirmar) como el servidor (que es quien
 * realmente mueve las Leyendas).
 *
 * El entrenamiento contra IA NO pasa por acá: no tiene entrada, ni pozo, ni
 * premio, ni penalización. Ver `esEntrenamiento`.
 */

export const MAX_JUGADORES = 4;
export const MIN_JUGADORES = 2;

/** Entradas disponibles. Agregar valores nuevos no requiere tocar nada más. */
export const ENTRADAS = [5, 10, 15, 20, 25, 50, 100, 200, 500];

export const esEntradaValida = (entrada) => ENTRADAS.includes(Number(entrada));

/** Reparto del pozo por posición. El resto de los puestos no cobra. */
export const REPARTO = { primero: 0.75, segundo: 0.25 };

/** Fracción de la entrada que se cobra como penalización al abandonar. */
export const FRACCION_PENALIZACION = 0.5;

// ------------------------------------------------------------ modos

export const MODOS = { ENTRENAMIENTO: "entrenamiento", LEYENDAS: "leyendas" };

export const esEntrenamiento = (partida) => partida?.modo === MODOS.ENTRENAMIENTO;

/**
 * Una partida sólo mueve Leyendas si es del modo `leyendas` y tiene una
 * entrada válida. Cualquier otra cosa se trata como entrenamiento.
 */
export const usaLeyendas = (partida) =>
  partida?.modo === MODOS.LEYENDAS && esEntradaValida(partida?.entrada);

// -------------------------------------------------------------- pozo

/** El pozo se congela al empezar: es la entrada por la cantidad de jugadores. */
export function calcularPozo(entrada, cantidadJugadores) {
  if (!esEntradaValida(entrada)) throw new Error(`Entrada inválida: ${entrada}`);
  if (cantidadJugadores < MIN_JUGADORES || cantidadJugadores > MAX_JUGADORES) {
    throw new Error(`Cantidad de jugadores fuera de rango: ${cantidadJugadores}`);
  }
  return entrada * cantidadJugadores;
}

/**
 * Reparte el pozo entre el primero y el segundo.
 *
 * El segundo cobra el resto exacto en lugar de su propio porcentaje: así
 * `primero + segundo === pozo` siempre, sin perder Leyendas por redondeo ni
 * repartir de más. Con pozo 400 da 300 y 100; con pozo 15 da 11 y 4.
 *
 * `posicionesPagadas` permite no pagar puestos que quedaron vacantes (por
 * ejemplo, si sólo terminó un jugador). Lo que no se paga se informa como
 * `sobrante` para que quien llame decida qué hacer: nunca se inventa destino.
 */
export function repartirPozo(pozo, posicionesPagadas = 2) {
  if (!Number.isInteger(pozo) || pozo < 0) throw new Error(`Pozo inválido: ${pozo}`);

  const primero = posicionesPagadas >= 1 ? Math.floor(pozo * REPARTO.primero) : 0;
  const segundo = posicionesPagadas >= 2 ? pozo - primero : 0;

  const premios = { primero, segundo, tercero: 0, cuarto: 0 };
  const repartido = primero + segundo;

  return { premios, repartido, sobrante: pozo - repartido };
}

/** Premio que le toca a una posición concreta (1 a 4). */
export function premioDePosicion(pozo, posicion, posicionesPagadas = 2) {
  const { premios } = repartirPozo(pozo, posicionesPagadas);
  return [premios.primero, premios.segundo, premios.tercero, premios.cuarto][posicion - 1] ?? 0;
}

// ---------------------------------------------------------- abandono

/**
 * Penalización por abandonar una partida por Leyendas.
 *
 * Se redondea hacia abajo a propósito: es un castigo, y cobrar de menos es
 * preferible a cobrar más de lo que se le anunció al jugador. Con las entradas
 * pares coincide exacto con la tabla (10→5, 20→10, 50→25, 100→50, 500→250);
 * con las impares queda por debajo (5→2, 15→7, 25→12).
 */
export function penalizacionAbandono(partida) {
  if (!usaLeyendas(partida)) return 0;
  return Math.floor(Number(partida.entrada) * FRACCION_PENALIZACION);
}

/**
 * Costo total de abandonar, tal como hay que mostrárselo al jugador antes de
 * que confirme: la entrada ya está en el pozo y no vuelve, más la penalización.
 */
export function costoDeAbandonar(partida) {
  if (!usaLeyendas(partida)) {
    return { entradaPerdida: 0, penalizacion: 0, total: 0, esEntrenamiento: true };
  }
  const entrada = Number(partida.entrada);
  const penalizacion = penalizacionAbandono(partida);
  return {
    entradaPerdida: entrada,
    penalizacion,
    total: entrada + penalizacion,
    esEntrenamiento: false,
  };
}

// ----------------------------------------------------- validaciones

/** Motivos por los que no se puede entrar a una sala, en orden de chequeo. */
export const RECHAZO = {
  NO_EXISTE: "no_existe",
  YA_EMPEZO: "ya_empezo",
  CANCELADA: "cancelada",
  TERMINADA: "terminada",
  LLENA: "llena",
  YA_ESTA: "ya_esta",
  SIN_SALDO: "sin_saldo",
};

export const MENSAJES_RECHAZO = {
  [RECHAZO.NO_EXISTE]: "Sala no encontrada.",
  [RECHAZO.YA_EMPEZO]: "La partida ya comenzó.",
  [RECHAZO.CANCELADA]: "Esta sala fue cancelada.",
  [RECHAZO.TERMINADA]: "Esta partida ya terminó.",
  [RECHAZO.LLENA]: "La sala ya está completa.",
  [RECHAZO.YA_ESTA]: "Ya estás en esta sala.",
  [RECHAZO.SIN_SALDO]: "No tenés suficientes Leyendas.",
};

export const ESTADOS_SALA = {
  ESPERANDO: "esperando",
  JUGANDO: "jugando",
  TERMINADA: "terminada",
  CANCELADA: "cancelada",
};

/**
 * ¿Puede este jugador entrar a esta sala?
 *
 * Es la MISMA función que corre en el navegador (para avisar antes) y en el
 * servidor (que es quien decide de verdad, dentro de una transacción).
 * Devuelve `{ puede: true }` o `{ puede: false, motivo, mensaje }`.
 */
export function puedeUnirse(sala, jugadorId, saldo) {
  const no = (motivo) => ({ puede: false, motivo, mensaje: MENSAJES_RECHAZO[motivo] });

  if (!sala) return no(RECHAZO.NO_EXISTE);
  if (sala.estado === ESTADOS_SALA.CANCELADA) return no(RECHAZO.CANCELADA);
  if (sala.estado === ESTADOS_SALA.TERMINADA) return no(RECHAZO.TERMINADA);
  if (sala.estado === ESTADOS_SALA.JUGANDO) return no(RECHAZO.YA_EMPEZO);

  const jugadores = sala.jugadores ?? [];
  if (jugadores.includes(jugadorId)) return no(RECHAZO.YA_ESTA);

  const capacidad = Math.min(sala.maxJugadores ?? MAX_JUGADORES, MAX_JUGADORES);
  if (jugadores.length >= capacidad) return no(RECHAZO.LLENA);

  if (usaLeyendas(sala) && Number(saldo) < Number(sala.entrada)) return no(RECHAZO.SIN_SALDO);

  return { puede: true };
}

// -------------------------------------------------------- códigos

/** Sin I, O, 0, 1 ni U: se confunden al leerlos o al dictarlos. */
const ALFABETO = "ABCDEFGHJKLMNPQRSTVWXYZ23456789";
export const LARGO_CODIGO = 5;

/**
 * Código de sala. El `rng` se inyecta para poder testearlo y para que el
 * servidor use una fuente criptográfica.
 *
 * El código sirve para encontrar la sala, NO para autorizar: quien se une
 * igual tiene que pasar por `puedeUnirse` y por las reglas de Firestore.
 */
export function generarCodigo(rng = Math.random) {
  let codigo = "";
  for (let i = 0; i < LARGO_CODIGO; i++) {
    codigo += ALFABETO[Math.floor(rng() * ALFABETO.length)];
  }
  return codigo;
}

export const esCodigoValido = (codigo) =>
  typeof codigo === "string" &&
  codigo.length === LARGO_CODIGO &&
  [...codigo.toUpperCase()].every((c) => ALFABETO.includes(c));

/** Combinaciones posibles, para dimensionar el riesgo de colisión. */
export const COMBINACIONES_CODIGO = ALFABETO.length ** LARGO_CODIGO;
