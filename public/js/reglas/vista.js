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
import { objetivosDe } from "./motor.js";

/** Marcador de carta tapada. No lleva palo, número ni imagen. */
export const CARTA_OCULTA = { oculta: true };

/** Hueco donde había una carta que ya se descartó. */
export const HUECO = null;

/**
 * Cartas que la mesa está viendo AHORA por un descarte fallido o tardío.
 *
 * Nada de esto queda marcado: en cuanto se cierra la ventana de descarte, la
 * información desaparece de la vista y sólo sobrevive en la memoria de cada
 * jugador. Esa es toda la gracia del juego.
 */
/**
 * Cuánto dura la revelación. El motor no mira el reloj —tiene que seguir
 * siendo determinista—, así que expone la revelación mientras dura la ventana
 * y es cada cliente el que la tapa a los dos segundos.
 */
export const MS_REVELACION = 2000;

export function revelacionesDe(estado) {
  if (estado.fase !== "descarte") return [];
  return (estado.ventanaDescarte?.intentos ?? []).filter((i) => i.carta);
}

function posicionesReveladas(estado) {
  const mapa = new Map();
  for (const r of revelacionesDe(estado)) {
    mapa.set(`${r.indiceJugador}:${r.posicion}`, r.carta);
  }
  return mapa;
}

/**
 * Mano tal como la ve `quienMira`.
 *
 * Al terminar la ronda se destapa todo, porque el reglamento manda revelar
 * las manos al cortar. En cualquier otro momento sólo se ve, y sólo mientras
 * dura la ventana de descarte, la carta que alguien acaba de exponer.
 */
function redactarMano(mano, indiceDuenio, reveladas, rondaTerminada) {
  return mano.map((carta, posicion) => {
    // Se comprueba antes que el hueco: la carta del que llegó tarde ya salió
    // de la mano, pero la mesa igual tiene que verla un momento.
    const revelada = reveladas.get(`${indiceDuenio}:${posicion}`);
    if (revelada) return revelada;

    if (!carta) return HUECO;
    if (rondaTerminada) return carta;
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
  const reveladas = posicionesReveladas(estado);
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

    // Lo que la mesa está viendo en este instante. Se vacía solo al cerrarse
    // la ventana de descarte: no hay ningún registro permanente.
    revelaciones: revelacionesDe(estado),

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

    /**
     * El 10, entre que muestra las dos cartas y que su dueño decide.
     *
     * A la mesa le llega QUIÉN está decidiendo y sobre quién, que es lo mismo
     * que se cuenta de los poderes 7 y 8. Las POSICIONES sólo van al que usó
     * el poder: decirle a todos "está mirando la segunda de Bruno" convierte
     * el poder en un anuncio público de dónde está lo que se vio, y encima
     * serviría igual si después decide no cambiar.
     *
     * Al dueño sí le viajan enteras, y no por comodidad: si recarga la página
     * en mitad de la decisión, su navegador no tiene otra forma de saber qué
     * eligió.
     */
    cambioPendiente: estado.cambioPendiente
      ? estado.cambioPendiente.indiceJugador === indiceQuienMira
        ? estado.cambioPendiente
        : {
            indiceJugador: estado.cambioPendiente.indiceJugador,
            indiceRival: estado.cambioPendiente.indiceRival,
          }
      : null,

    // A quién puede atacar QUIEN MIRA, y nada más.
    //
    // Viaja el permiso, nunca el número conocido: si viajara, el navegador
    // sabría dónde buscar y el poder dejaría de depender de la memoria. Ni
    // siquiera se dice cuántas cartas conoce, que ya sería una pista.
    puedeAtacar: objetivosDe(estado, indiceQuienMira),

    // --- los jugadores ---
    jugadores: estado.jugadores.map((jugador, indice) => ({
      id: jugador.id,
      nombre: jugador.nombre,
      puntos: jugador.puntos,
      puntosRonda: jugador.puntosRonda,
      eliminado: jugador.eliminado,
      eliminadoEnRonda: jugador.eliminadoEnRonda,
      cartasEnMano: jugador.mano.filter(Boolean).length,
      mano: redactarMano(jugador.mano, indice, reveladas, rondaTerminada),
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
  const reveladas = posicionesReveladas(estadoCompleto);

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
      if (reveladas.has(`${indice}:${posicion}`)) return;
      problemas.push(`la carta ${carta.id} de ${jugador.nombre} (posición ${posicion}) viaja destapada`);
    });
  });

  // La carta levantada es de quien juega.
  if (vista.levantada && estadoCompleto.indiceTurno !== vista.yo) {
    problemas.push("la carta levantada viaja a alguien que no está en turno");
  }

  // El conocimiento de los poderes 8 y 10 NO viaja: sólo el permiso.
  //
  // Si el número conocido llegara al navegador, el jugador no tendría que
  // recordar nada —le bastaría con leerlo— y buscar en la mano del rival
  // dejaría de ser un ejercicio de memoria para volverse un trámite.
  // Buscar el número suelto no serviría: un 9 aparece legítimamente en la
  // muestra, en la levantada y en las cartas propias reveladas. Lo que se
  // comprueba es la FORMA: que no viaje ninguna estructura de conocimiento,
  // ni entera ni disfrazada bajo otro nombre.
  (function buscarConocimiento(v, ruta) {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach((x, i) => buscarConocimiento(x, `${ruta}[${i}]`));
    const claves = Object.keys(v);
    if (claves.includes("objetivo") && claves.includes("numero") && claves.includes("actor")) {
      problemas.push(`la vista lleva un conocimiento de mano ajena en ${ruta}`);
    }
    for (const [k, x] of Object.entries(v)) {
      if (k === "conocimientos") problemas.push(`la vista incluye el modelo de conocimiento en ${ruta}`);
      buscarConocimiento(x, `${ruta}.${k}`);
    }
  })(vista, "vista");

  // Y que `puedeAtacar` sea sólo eso: una lista de índices, sin nada dentro.
  if (vista.puedeAtacar && !vista.puedeAtacar.every((x) => Number.isInteger(x))) {
    problemas.push("puedeAtacar lleva algo más que índices");
  }

  return problemas;
}
