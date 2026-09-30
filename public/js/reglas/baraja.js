// Baraja española de 48 cartas: 4 palos x 12 valores, sin comodines.
// Los nombres de palo coinciden con las carpetas reales de /public/assets/.
export const PALOS = ["Basto", "Copa", "Espada", "Oro"];
export const NUMEROS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export const TAM_MANO = 4;

/**
 * La versión de los dorsos. La misma idea que `VERSION_CARTAS`, más abajo, y
 * por el mismo motivo: las imágenes se guardan un mes en cada navegador, así
 * que un dibujo nuevo con el mismo nombre no llega hasta que venza.
 *
 * Hoy no hacía falta —los dorsos pasaron de `.png` a `.webp`, y un nombre
 * distinto ya es una dirección distinta—. Está para la PRÓXIMA vez, que es
 * cuando muerde: cuando se reemplace el dibujo dejando el nombre.
 *
 * Ojo con el alcance: esto cubre los dos dorsos de la casa, que son los que
 * vive acá. El dorso que alguien COMPRÓ sale de su artículo en el catálogo de
 * Firestore, y su dirección es la que diga ese documento.
 *
 * 1 — los dorsos en WebP.
 */
export const VERSION_DORSOS = 1;

/** La dirección de un dorso, con su versión. */
export const dorsoUrl = (ruta) => `${ruta}?v=${VERSION_DORSOS}`;

// Sólo existen dos dorsos. Con 3 o 4 jugadores se repiten alternando, y los
// asientos se distinguen por el color del aro (ver --color-asiento en el CSS).
export const DORSOS = ["/img/dorsos/dorso-azul.webp", "/img/dorsos/dorso-rojo.webp"];

export const dorsoDeAsiento = (indice) => dorsoUrl(DORSOS[indice % DORSOS.length]);

/** Reglamento: 1-10 valor nominal, 11 (Caballo) = 0, 12 (Rey) = 12. */
export function puntosCarta(numero) {
  return numero === 11 ? 0 : numero;
}

/**
 * La versión de las caras de las cartas. Se sube cada vez que se reemplazan.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Las imágenes se guardan en el navegador un mes (ver `firebase.json`). Si
 * una carta se reemplaza con el MISMO nombre, quien ya la tenía guardada
 * sigue viendo la vieja hasta que venza — y cambiar el encabezado no lo
 * arregla, porque la copia guardada no vuelve a preguntar.
 *
 * Pasó: las cartas se rediseñaron con los mismos nombres y algunas mesas
 * mostraban frentes viejos. Con la versión en la URL, cada reemplazo es una
 * dirección nueva y el navegador la pide de nuevo.
 *
 * 2 — las cartas rediseñadas, en WebP de 512×768.
 * 3 — las cartas nuevas, en WebP de 448×672. Siguen cubriendo un teléfono de
 *     3x: la carta más grande de la mesa es la del centro, que llega a 146×219
 *     de CSS, o sea 438×657 reales. Y pesan la mitad: 3,3 MB las 48 contra 6,6.
 */
export const VERSION_CARTAS = 3;

export function imagenCarta(palo, numero) {
  return `/assets/${palo}/${numero}.webp?v=${VERSION_CARTAS}`;
}

/**
 * La cara con la que se dibuja una carta.
 *
 * Sale del palo y el número, no del campo `imagen` que trae la carta. Ese
 * campo lo escribió quien repartió —el servidor, en una partida en red— y
 * queda guardado en el estado: una partida empezada antes de cambiar las
 * cartas seguiría pidiendo las viejas. Armada acá, la dirección es siempre la
 * de ahora.
 *
 * Sin palo o sin número —un marcador tapado— devuelve lo que venga en
 * `imagen`, que es lo que se hacía siempre.
 */
export function caraDeCarta(carta) {
  if (carta?.palo && carta?.numero) return imagenCarta(carta.palo, carta.numero);
  return carta?.imagen ?? "";
}

export function crearBaraja() {
  const baraja = [];
  for (const palo of PALOS) {
    for (const numero of NUMEROS) {
      baraja.push({
        id: `${palo}-${numero}`,
        palo,
        numero,
        puntos: puntosCarta(numero),
        imagen: imagenCarta(palo, numero),
      });
    }
  }
  return baraja;
}

/**
 * Mezcla de Fisher-Yates.
 *
 * El `rng` es OBLIGATORIO a propósito. Tenía un valor por defecto de
 * `Math.random`, y eso era una trampa: quien se olvidara de pasar la fuente
 * de azar de la partida no habría visto ningún error, sólo una partida que
 * deja de ser reproducible. Sin defecto, olvidarse revienta en el acto.
 */
export function barajar(baraja, rng) {
  if (typeof rng !== "function") {
    throw new TypeError("barajar necesita una fuente de azar explícita (ver reglas/azar.js)");
  }
  const copia = [...baraja];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}
