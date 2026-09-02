/**
 * Cómo se dibuja una carta y cómo se acomoda una mano.
 *
 * Todo lo de acá es una función de sus argumentos y nada más: no lee el estado
 * de la partida, no toca el DOM y no guarda nada entre llamadas. Devuelve
 * cadenas de HTML y números.
 *
 * Ésa fue la regla para decidir qué se sacaba de `mesa.js`. Lo que depende del
 * estado de la partida —`estado`, `YO`, `memorias`— se quedó allá, porque
 * moverlo obligaría a que estos módulos escribieran ese estado, y entonces
 * habría que importarlo desde los dos lados. Seis módulos que se importan
 * entre sí no son seis módulos: son el mismo archivo con más pasos.
 */

import { dorsoDeAsiento } from "../reglas/baraja.js";

/**
 * Con sólo dos dorsos, el 3º y el 4º jugador repiten imagen. Lo que los
 * distingue es el color del aro que rodea sus cartas y su ficha.
 */
export const claseAsiento = (indice) => `asiento-color-${indice % 4}`;

/** Clave de una posición concreta en una mano concreta. */
export const clave = (i, pos) => `${i}:${pos}`;

export function dibujarCarta(
  carta,
  { visible, asiento = 0, posicion = null, clases = "", estilo = "" },
) {
  if (!carta) {
    return `<div class="hueco vacio" style="${estilo}"></div>`;
  }
  const dorso = dorsoDeAsiento(asiento);

  // El servidor manda las cartas ajenas como un marcador sin palo, número ni
  // imagen. No es que no se dibuje la cara: es que la cara NO VIAJÓ. Dibujar
  // un `<img>` con src vacío dejaría un hueco roto, y peor, sugeriría que el
  // dato está y sólo falta mostrarlo.
  if (carta.oculta) {
    return `
      <button class="carta ${claseAsiento(asiento)} ${clases}"
              ${posicion != null ? `data-posicion="${posicion}"` : ""}
              style="${estilo}"
              type="button">
        ${posicion != null ? `<span class="posicion">${posicion}</span>` : ""}
        <span class="lados">
          <span class="dorso"><img src="${dorso}" alt="Carta boca abajo" /></span>
        </span>
      </button>`;
  }
  return `
    <button class="carta ${visible ? "visible" : ""} ${claseAsiento(asiento)} ${clases}"
            ${posicion != null ? `data-posicion="${posicion}"` : ""}
            style="${estilo}"
            type="button">
      ${posicion != null ? `<span class="posicion">${posicion}</span>` : ""}
      <span class="lados">
        <span class="dorso"><img src="${dorso}" alt="Carta boca abajo" /></span>
        <span class="cara"><img src="${carta.imagen}" alt="${carta.numero} de ${carta.palo}" /></span>
      </span>
    </button>`;
}

/**
 * Reparte las cartas en abanico. Cuanto más cartas hay (los castigos
 * las suman) más se cierra el ángulo y más se solapan, para que la mano
 * siga entrando en el asiento sin achicar las cartas.
 */
export function geometriaAbanico(cantidad, propio) {
  if (cantidad <= 1) return { anguloTotal: 0, arco: 0, solape: 0 };

  const anguloTotal = Math.min(propio ? 26 : 18, cantidad * (propio ? 5.5 : 4));
  const arco = propio ? 3.2 : 2.2;
  // A partir de 5 cartas se montan unas sobre otras, cada vez más, para que
  // el asiento no siga ensanchándose cuando los castigos suman cartas.
  // Los asientos laterales tienen menos lugar antes de tocar el centro de la
  // mesa, así que sus cartas se montan más rápido que las propias.
  const solape =
    cantidad <= 4
      ? 0
      : Math.min(propio ? 46 : 40, (cantidad - 4) * (propio ? 11 : 14));

  return { anguloTotal, arco, solape };
}

export function estiloAbanico(indice, cantidad, { anguloTotal, arco, solape }) {
  if (cantidad <= 1) return "";
  const t = indice / (cantidad - 1) - 0.5;
  const giro = anguloTotal * t;
  // Las de los extremos caen un poco, como una mano sostenida.
  const desvio = arco * Math.pow(t * 2, 2) * (cantidad - 1);
  return `--giro:${giro.toFixed(2)}deg;--desvio:${desvio.toFixed(1)}px;--solape:${solape.toFixed(0)}px;`;
}

/** Lugar libre en la mesa: se ve, pero no juega nadie. */
export function asientoVacio() {
  return `
    <div class="jugador vacante" aria-hidden="true">
      <div class="cabecera-jugador">
        <span class="ficha-vacante"></span>
        <div class="datos">
          <div class="nombre">Lugar libre</div>
          <div class="puntos">sin jugador</div>
        </div>
      </div>
      <div class="mano">${Array(4).fill('<div class="hueco vacio"></div>').join("")}</div>
    </div>`;
}

export function asientosParaMesa(total) {
  if (total <= 2) return ["abajo", "arriba"];
  if (total === 3) return ["abajo", "izq", "der"];
  return ["abajo", "izq", "arriba", "der"];
}
