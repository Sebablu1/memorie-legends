/**
 * Redacción del estado de la partida.
 *
 * El estado completo del motor tiene TODAS las cartas: las manos de los
 * cuatro jugadores y el mazo entero. Si ese objeto llega al navegador, el
 * juego se termina: cualquiera abre las herramientas de desarrollo y ve lo
 * que tiene cada uno. En un juego de memoria eso no es una ventaja, es el
 * fin del juego.
 *
 * Por eso el estado vive en el servidor y a cada jugador se le manda sólo lo
 * que puede saber. Este módulo produce esa versión recortada.
 *
 * Regla de oro: si el valor de una carta no está justificado por algo que
 * ese jugador vio, no viaja. Nunca se manda "por si acaso".
 */

import { puntosCarta } from "./baraja.js";

/** Marcador de carta tapada. No lleva palo, número ni imagen. */
export const CARTA_OCULTA = { oculta: true };

/** Hueco donde había una carta que ya se descartó. */
export const HUECO = null;

/**
 * Posiciones que quedaron expuestas para toda la mesa por un descarte
 * fallido. Es lo único que el reglamento hace público de forma permanente.
 */
function posicionesPublicas(estado) {
  const mapa = new Map();
  for (const p of estado.infoPublica ?? []) {
    mapa.set(`${p.indiceJugador}:${p.posicion}`, p.carta);
  }
  return mapa;
}

/**
 * Mano tal como la ve `quienMira`.
 *
 * Al terminar la ronda se destapa todo, porque el reglamento manda revelar
 * las manos al cortar. En cualquier otro momento sólo se ven las cartas
 * expuestas por un error.
 */
function redactarMano(mano, indiceDuenio, publicas, rondaTerminada) {
  return mano.map((carta, posicion) => {
    if (!carta) return HUECO;
    if (rondaTerminada) return carta;

    const expuesta = publicas.get(`${indiceDuenio}:${posicion}`);
    if (expuesta) return expuesta;

    return CARTA_OCULTA;
  });
}

/**
 * Estado recortado para un jugador.
 *
 * @param estado      estado completo del motor
 * @param indiceQuienMira  a quién se le va a mandar
 */
export function vistaDe(estado, indiceQuienMira) {
  const publicas = posicionesPublicas(estado);
  const rondaTerminada = estado.fase === "finRonda" || estado.fase === "finPartida";

  return {
    // --- lo público de la mesa ---
    fase: estado.fase,
    ronda: estado.ronda,
    indiceMano: estado.indiceMano,
    indiceTurno: estado.indiceTurno,
    turnosRonda: estado.turnosRonda,
    indiceCortador: estado.indiceCortador,
    desempate: estado.desempate,
    registro: estado.registro,
    infoPublica: estado.infoPublica,

    // Del mazo sólo se sabe cuántas cartas quedan. Su contenido y su ORDEN
    // son secretos: conocer el orden sería saber qué va a levantar cada uno.
    cartasEnMazo: estado.mazo.length,

    // Del descarte se ve la cima, que es la muestra, y el tamaño de la pila.
    muestra: estado.descarte[0] ?? null,
    cartasEnDescarte: estado.descarte.length,

    // La carta levantada sólo la ve quien está en turno: es su decisión.
    levantada: estado.indiceTurno === indiceQuienMira ? (estado.levantada ?? null) : null,
    hayLevantada: Boolean(estado.levantada),

    // El poder pendiente es público (todos ven que alguien lo activó).
    poderPendiente: estado.poderPendiente,

    // --- los jugadores ---
    jugadores: estado.jugadores.map((jugador, indice) => ({
      id: jugador.id,
      nombre: jugador.nombre,
      puntos: jugador.puntos,
      puntosRonda: jugador.puntosRonda,
      eliminado: jugador.eliminado,
      eliminadoEnRonda: jugador.eliminadoEnRonda,
      cartasEnMano: jugador.mano.filter(Boolean).length,
      mano: redactarMano(jugador.mano, indice, publicas, rondaTerminada),
    })),

    // Puntaje de la mano sólo cuando ya se reveló todo.
    puntosDeMano: rondaTerminada
      ? estado.jugadores.map((j) => j.mano.filter(Boolean).reduce((s, c) => s + puntosCarta(c.numero), 0))
      : null,

    yo: indiceQuienMira,
  };
}

/**
 * Comprueba que una vista no filtre ninguna carta que deba estar tapada.
 *
 * Se usa en las pruebas y también en el servidor antes de publicar, como
 * red de seguridad: si algún cambio futuro agrega un campo con cartas, esto
 * lo detecta en vez de dejarlo pasar en silencio.
 *
 * @returns {string[]} las filtraciones encontradas; vacío si está limpia.
 */
export function filtracionesEn(vista, estadoCompleto) {
  const problemas = [];
  const rondaTerminada = vista.fase === "finRonda" || vista.fase === "finPartida";
  const publicas = posicionesPublicas(estadoCompleto);

  // Ninguna carta del mazo puede aparecer, en ningún lado.
  const serializada = JSON.stringify(vista);
  for (const carta of estadoCompleto.mazo) {
    if (serializada.includes(`"${carta.id}"`)) {
      problemas.push(`la carta ${carta.id} del mazo aparece en la vista`);
    }
  }

  if ("mazo" in vista) problemas.push("la vista incluye el mazo completo");
  if ("descarte" in vista) problemas.push("la vista incluye la pila de descarte entera");

  // Las manos: sólo lo permitido.
  vista.jugadores.forEach((jugador, indice) => {
    jugador.mano.forEach((carta, posicion) => {
      if (carta === null || carta?.oculta) return;
      if (rondaTerminada) return;
      if (publicas.has(`${indice}:${posicion}`)) return;
      problemas.push(`la carta ${carta.id} de ${jugador.nombre} (posición ${posicion}) viaja destapada`);
    });
  });

  // La carta levantada es de quien juega.
  if (vista.levantada && estadoCompleto.indiceTurno !== vista.yo) {
    problemas.push("la carta levantada viaja a alguien que no está en turno");
  }

  return problemas;
}
