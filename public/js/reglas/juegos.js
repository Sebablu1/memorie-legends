/**
 * De qué juego es una sala, una partida o una fila de ranking.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * UN ID ABIERTO, NO UNA LISTA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La infraestructura —salas, partidas, economía, rankings— es de todos los
 * juegos; el motor, de cada uno. Qué juegos existen NO lo dice el código: lo
 * dice la colección `juegos/{id}`, con su nombre, si está activo y en qué
 * orden se muestra. Agregar un juego es agregar un documento ahí, no tocar
 * esta línea ni ninguna otra.
 *
 * Por eso acá no hay una lista de juegos válidos. Hay una sola constante, y no
 * decide qué juegos existen: es el juego de todo lo que se escribió antes de
 * que existiera este campo. Las salas, partidas y tablas de hasta septiembre
 * de 2026 son de Memorie Legends, porque era el único.
 *
 * `pruebas/juegos.mjs` vigila que nadie compare ni asigne un juego escrito a
 * mano en otro lado: el día que aparezca un `juego === "algo"` suelto, el
 * código habrá empezado a tener una lista sin decirlo.
 */
export const JUEGO_POR_DEFECTO = "memorie";

/**
 * El juego de un documento. Uno viejo, sin el campo, es de Memorie.
 *
 * Leer siempre por acá y no `documento.juego` a secas: así lo viejo no
 * necesita migración, y lo nuevo nace con el campo escrito.
 */
export function juegoDe(documento) {
  const juego = documento?.juego;
  return typeof juego === "string" && juego.trim() ? juego : JUEGO_POR_DEFECTO;
}
