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
 * El dorso comprado, que sólo se aplica a las cartas de uno.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO VA EN `reglas/baraja.js`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque ahí vive `dorsoDeAsiento`, y ese archivo es un módulo PURO que
 * `copiar-reglas.js` lleva al servidor. Meterle una ruta que sale de Firestore
 * sería empujar una decisión de vista —y una lectura de base— dentro del
 * motor. La regla sigue siendo la misma de siempre: cada asiento tiene su
 * dorso. Lo que se agrega es una excepción de dibujo, y las excepciones de
 * dibujo viven en la capa que dibuja.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ SÓLO EL PROPIO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Los dos dorsos alternados no son decoración: son lo que distingue de quién
 * es cada mano en la mesa. Si los cuatro eligieran el suyo, cuatro jugadores
 * podrían terminar con el mismo y la mesa dejaría de leerse. Cambiando sólo el
 * propio, esa distinción se conserva entera — y el jugador ve lo que compró
 * justo donde mira todo el tiempo, que son sus cartas.
 *
 * Arranca vacío: sin nada comprado, o si la lectura falla, la mesa se dibuja
 * exactamente como antes.
 */
let dorsoPropio = { asiento: null, ruta: null };

/**
 * Fija qué asiento usa qué dorso.
 *
 * Se pasa el ASIENTO y no un booleano porque en una partida por Leyendas el
 * jugador local no siempre es el cero: el servidor le dice cuál le tocó, y
 * `mesa.js` vuelve a llamar acá cuando lo sabe.
 */
export function usarDorsoPropio({ asiento = null, ruta = null } = {}) {
  dorsoPropio = { asiento, ruta };
}

/** El dorso que le toca a un asiento, con la excepción del propio. */
export function dorsoDe(asiento) {
  if (dorsoPropio.ruta && asiento === dorsoPropio.asiento) return dorsoPropio.ruta;
  return dorsoDeAsiento(asiento);
}

/**
 * El dorso de la pila del centro.
 *
 * Es un artículo aparte del dorso de la mano —se compra y se equipa por su
 * cuenta— porque son dos cosas distintas: el de la mano distingue de quién
 * es cada juego, y el del centro no es de nadie.
 *
 * Sin nada comprado cae al dorso del asiento cero, que es lo que la pila
 * usaba antes de que esto existiera: el cambio no se nota hasta que alguien
 * compra uno.
 */
let mazoCentral = null;

export function usarMazoCentral(ruta = null) {
  mazoCentral = ruta;
}

export const dorsoDelMazo = () => mazoCentral ?? dorsoDeAsiento(0);

/**
 * Con sólo dos dorsos, el 3º y el 4º jugador repiten imagen. Lo que los
 * distingue es el color del aro que rodea sus cartas y su ficha.
 */
export const claseAsiento = (indice) => `asiento-color-${indice % 4}`;

/** Clave de una posición concreta en una mano concreta. */
export const clave = (i, pos) => `${i}:${pos}`;

/**
 * Nombre accesible de una carta.
 *
 * Se arma acá y no se deja al `alt` de las imágenes porque cada carta pinta
 * DOS —el dorso y la cara, para que el volteo sea una animación—, y un lector
 * de pantalla leía las dos: "carta boca abajo, tres de espada". El valor de una
 * carta tapada no puede decirse, y decirlo justo al lado de "boca abajo" es
 * peor que no tener etiqueta.
 *
 * Ahora las dos imágenes van con `alt=""` dentro de un contenedor
 * `aria-hidden`, y lo único que se anuncia es esto.
 */
function etiqueta(posicion, cartaVisible) {
  const donde = posicion != null ? `Posición ${posicion}` : "Carta";
  if (!cartaVisible) return `${donde}, boca abajo`;
  return `${donde}, ${cartaVisible.numero} de ${cartaVisible.palo}`;
}

export function dibujarCarta(
  carta,
  { visible, asiento = 0, posicion = null, clases = "", estilo = "", dorso: dorsoPedido = null },
) {
  if (!carta) {
    return `<div class="hueco vacio" style="${estilo}"></div>`;
  }
  // El dorso sale del asiento salvo que quien dibuja pida otro. Lo pide la
  // pila del centro, que no pertenece a ningún asiento y tiene el suyo.
  const dorso = dorsoPedido ?? dorsoDe(asiento);

  // El servidor manda las cartas ajenas como un marcador sin palo, número ni
  // imagen. No es que no se dibuje la cara: es que la cara NO VIAJÓ. Dibujar
  // un `<img>` con src vacío dejaría un hueco roto, y peor, sugeriría que el
  // dato está y sólo falta mostrarlo.
  if (carta.oculta) {
    return `
      <button class="carta ${claseAsiento(asiento)} ${clases}"
              ${posicion != null ? `data-posicion="${posicion}"` : ""}
              style="${estilo}"
              aria-label="${etiqueta(posicion, null)}"
              type="button">
        ${posicion != null ? `<span class="posicion">${posicion}</span>` : ""}
        <span class="lados" aria-hidden="true">
          <span class="dorso"><img src="${dorso}" alt="" /></span>
        </span>
      </button>`;
  }
  return `
    <button class="carta ${visible ? "visible" : ""} ${claseAsiento(asiento)} ${clases}"
            ${posicion != null ? `data-posicion="${posicion}"` : ""}
            style="${estilo}"
            aria-label="${etiqueta(posicion, visible ? carta : null)}"
            type="button">
      ${posicion != null ? `<span class="posicion">${posicion}</span>` : ""}
      <span class="lados" aria-hidden="true">
        <span class="dorso"><img src="${dorso}" alt="" /></span>
        <span class="cara"><img src="${carta.imagen}" alt="" /></span>
      </span>
    </button>`;
}

/**
 * Reparte las cartas en abanico.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CON MÁS DE CUATRO, LAS CARTAS ENCOGEN — NO SE MONTAN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Antes se solapaban: a partir de la quinta, cada carta se metía debajo de
 * la anterior para que el asiento no se ensanchara. El asiento no se
 * ensanchaba, y la mano dejaba de servir.
 *
 * Este no es un juego de cartas cualquiera: es de MEMORIA. Cada carta es una
 * posición que hay que recordar y tocar, lleva su número escrito en la
 * esquina, y una carta tapada por la de al lado esconde justamente eso. Con
 * ocho cartas —dos castigos— la mitad de la mano quedaba debajo de la otra
 * mitad.
 *
 * Así que ahora la mano conserva su ANCHO encogiendo las cartas. Ocho cartas
 * al 62% ocupan un 24% más que cuatro al 100%, no el doble, y las ocho se
 * ven enteras. El tope está en 0.62 porque más abajo la figura de la carta
 * deja de reconocerse, y una carta que no se distingue no se puede recordar.
 *
 * `4.6` y no `4`: con `4` la quinta carta encogería todo a 0.8 de golpe, y
 * el salto se ve. Con 4.6 la mano de cinco casi no cambia —0.92— que es lo
 * que uno espera al recibir UNA carta de castigo.
 */
export const ESCALA_MINIMA = 0.62;
const HOLGURA = 4.6;

export function geometriaAbanico(cantidad, propio) {
  if (cantidad <= 1) return { anguloTotal: 0, arco: 0, solape: 0, escala: 1 };

  const anguloTotal = Math.min(propio ? 26 : 18, cantidad * (propio ? 5.5 : 4));
  /**
   * Cuánto caen las cartas de los extremos, como una mano sostenida.
   *
   * Los rivales van PLANOS. Su curva era de dos coma dos, que en una mano de
   * cuatro deja las de las puntas casi siete píxeles más abajo — y el asiento
   * de arriba tiene justo debajo las pilas del centro. Desde que el centro
   * mide lo mismo que una carta de la mesa, esos siete píxeles se le metían
   * encima al mazo y a la muestra.
   *
   * Aplanarlo no cuesta alto, que es lo que escasea, y en una mano chica y
   * boca abajo la curva no se veía. La propia la conserva: es la que se mira.
   */
  const arco = propio ? 3.2 : 0;

  return {
    anguloTotal,
    arco,
    solape: 0,
    escala: Math.max(ESCALA_MINIMA, Math.min(1, HOLGURA / cantidad)),
  };
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
