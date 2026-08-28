// Baraja española de 48 cartas: 4 palos x 12 valores, sin comodines.
// Los nombres de palo coinciden con las carpetas reales de /public/assets/.
export const PALOS = ["Basto", "Copa", "Espada", "Oro"];
export const NUMEROS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export const TAM_MANO = 4;

// Sólo existen dos dorsos. Con 3 o 4 jugadores se repiten alternando, y los
// asientos se distinguen por el color del aro (ver --color-asiento en el CSS).
export const DORSOS = ["/img/dorsos/dorso-azul.png", "/img/dorsos/dorso-rojo.png"];

export const dorsoDeAsiento = (indice) => DORSOS[indice % DORSOS.length];

/** Reglamento: 1-10 valor nominal, 11 (Caballo) = 0, 12 (Rey) = 12. */
export function puntosCarta(numero) {
  return numero === 11 ? 0 : numero;
}

export function imagenCarta(palo, numero) {
  return `/assets/${palo}/${numero}.png`;
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

export function barajar(baraja, rng = Math.random) {
  const copia = [...baraja];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}
