/**
 * Qué cara tiene cada jugador en la mesa.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ HAY QUE INVENTAR ALGO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque el avatar equipado sólo se conoce del jugador LOCAL. En
 * entrenamiento los tres rivales son IA y no tienen perfil; en una partida
 * por Leyendas el documento de la sala guarda el nombre y el uid de cada uno,
 * y nada más. O sea que si el retrato tuviera que salir del catálogo para
 * todos, tres de los cuatro asientos quedarían vacíos.
 *
 * La salida no es dejarlos vacíos —una mesa con un retrato y tres huecos se
 * lee peor que una sin ninguno— sino repartir caras FIJAS por asiento. Cada
 * silla tiene la suya y no cambia entre rondas ni entre partidas, que es lo
 * único que la mesa necesita para que uno reconozca de quién es cada mano.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NO SE INVENTA NINGUNA IMAGEN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Las caras son los avatares del catálogo, los mismos trece que ya están en
 * `/img/avatar/`. No hay un solo archivo nuevo acá: lo que este módulo agrega
 * es a QUIÉN se le pone cuál.
 *
 * Y por eso la lista arranca en el segundo: `predeterminado` es el avatar con
 * el que empieza todo el mundo y es el respaldo del asiento propio, así que
 * dárselo además a un rival haría que dos asientos se vieran igual justo en
 * el caso más común.
 */

/**
 * Las caras de la casa, en el orden en que se reparten.
 *
 * Cuatro y no trece a propósito: la mesa tiene cuatro sillas. Con una lista
 * larga habría que elegir, y elegir con `Math.random` daría una cara distinta
 * en cada redibujado —la mesa se repinta entera en cada jugada— con lo cual
 * los rivales cambiarían de cara varias veces por turno.
 */
const CARAS = Object.freeze([
  "/img/avatar/el_zorro.webp",
  "/img/avatar/orco.webp",
  "/img/avatar/sacerdotisa.webp",
  "/img/avatar/el_caballo.webp",
]);

/** Con el que empieza todo el mundo: el respaldo del asiento propio. */
export const RETRATO_INICIAL = "/img/avatar/predeterminado.webp";

/**
 * El avatar comprado del jugador local, cuando llegó.
 *
 * Mismo trato que el dorso en `cartas.js`: se guarda acá, se pide sin
 * esperarlo, y si no llega nunca la mesa se dibuja igual con la cara de
 * fábrica. Un retrato es decoración y no puede demorar un reparto.
 */
let retratoPropio = { asiento: null, ruta: null };

export function usarRetratoPropio({ asiento = null, ruta = null } = {}) {
  retratoPropio = { asiento, ruta };
}

/**
 * El retrato que le toca a un asiento.
 *
 * El propio gana siempre que se sepa cuál es. Los demás toman la cara de su
 * silla, salteando la que ya lleva puesta el jugador local: dos asientos con
 * la misma cara es exactamente lo que este módulo viene a evitar.
 */
export function retratoDe(asiento) {
  if (asiento === retratoPropio.asiento) return retratoPropio.ruta ?? RETRATO_INICIAL;

  const cara = CARAS[asiento % CARAS.length];
  if (cara !== retratoPropio.ruta) return cara;
  return CARAS[(asiento + 1) % CARAS.length];
}
