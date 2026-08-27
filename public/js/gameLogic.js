const PALOS = ["oros", "copas", "espadas", "bastos"];
const NUMEROS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export function crearBaraja() {
  const baraja = [];
  for (const palo of PALOS) {
    for (const num of NUMEROS) {
      baraja.push({ numero: num, palo });
    }
  }
  return baraja;
}

export function barajar(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export function calcularPuntaje(mano) {
  if (!mano || mano.length === 0) return 0;
  let total = 0;
  for (const carta of mano) {
    if (carta.numero === 11) continue;
    total += carta.numero;
  }
  return total;
}

export function esIgual(carta, muestra) {
  if (!carta || !muestra) return false;
  return carta.numero === muestra.numero && carta.palo === muestra.palo;
}
