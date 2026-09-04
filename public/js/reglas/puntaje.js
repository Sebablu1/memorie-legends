import { puntosCarta } from "./baraja.js";

export const LIMITE_ELIMINACION = 150;
export const BONO_MANO_VACIA = -10;
export const CASTIGO_CORTE_FALLIDO = 10;

/** Las posiciones vaciadas quedan como null para no mover las demás. */
export const cartasVivas = (mano) => mano.filter(Boolean);

export const puntosMano = (mano) =>
  cartasVivas(mano).reduce((total, carta) => total + puntosCarta(carta.numero), 0);

/**
 * Resuelve el corte de una ronda.
 * - Cada jugador activo suma los puntos de su mano.
 * - El que cortó recibe -10 si se quedó sin cartas.
 * - El que cortó recibe +10 si NO tiene el puntaje más bajo.
 *   Si empata en el más bajo no hay castigo.
 */
export function resolverCorte(jugadores, indiceCortador) {
  const totales = new Map();
  jugadores.forEach((jugador, i) => {
    if (!jugador.eliminado) totales.set(i, puntosMano(jugador.mano));
  });

  const masBajo = Math.min(...totales.values());
  const totalCortador = totales.get(indiceCortador) ?? 0;
  const corteFallido = indiceCortador != null && totalCortador > masBajo;

  const actualizados = jugadores.map((jugador, i) => {
    if (jugador.eliminado) return jugador;

    let delta = totales.get(i);
    if (i === indiceCortador) {
      if (cartasVivas(jugador.mano).length === 0) delta += BONO_MANO_VACIA;
      if (corteFallido) delta += CASTIGO_CORTE_FALLIDO;
    }

    return {
      ...jugador,
      puntosRonda: delta,
      puntos: jugador.puntos + delta,
      mano: jugador.mano.map((c) => (c ? { ...c, visible: true } : null)),
    };
  });

  return { jugadores: actualizados, totales, masBajo, corteFallido };
}

/**
 * Queda eliminado quien SUPERA el límite. Con el límite exacto sigue en juego.
 * Se guarda la ronda de eliminación: define el orden final de la partida.
 *
 * El límite es un parámetro, no una constante, porque el entrenamiento deja
 * elegir partidas más cortas: 60, 100 o 150 puntos. Lo único que cambia es el
 * número — el castigo por cortar mal, el bono por quedarse sin cartas y el
 * "con el límite exacto seguís" son los mismos en los tres.
 *
 * El valor por defecto es 150, que es lo que hace que nada de lo que ya
 * existía tenga que cambiar: las partidas por Leyendas y el servidor llaman
 * sin este argumento y siguen jugando como siempre.
 */
export const aplicarEliminacion = (
  jugadores,
  ronda = null,
  limite = LIMITE_ELIMINACION,
) =>
  jugadores.map((j) =>
    j.eliminado || j.puntos <= limite
      ? j
      : { ...j, eliminado: true, eliminadoEnRonda: ronda },
  );

/**
 * Gana el último jugador por debajo del límite.
 * Si todos se pasan en la misma ronda y empatan, se juega ronda extra.
 */
export function comprobarFinPartida(jugadores) {
  const activos = jugadores.filter((j) => !j.eliminado);

  if (activos.length === 1) {
    return { terminada: true, ganador: activos[0], desempate: false };
  }

  if (activos.length === 0) {
    const mejor = Math.min(...jugadores.map((j) => j.puntos));
    const empatados = jugadores.filter((j) => j.puntos === mejor);
    return empatados.length === 1
      ? { terminada: true, ganador: empatados[0], desempate: false }
      : { terminada: false, ganador: null, desempate: true, empatados };
  }

  return { terminada: false, ganador: null, desempate: false };
}
