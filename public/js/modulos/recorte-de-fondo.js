/**
 * Le saca el fondo blanco a un dibujo, sobre los píxeles de un lienzo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DE DÓNDE SALE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * De `herramientas/recortar-fondo.mjs`, que es con lo que se recortaron los
 * trece avatares y las seis insignias que hay hoy. Allá el algoritmo vivía
 * adentro de un `page.evaluate`, o sea que YA era código de navegador: traerlo
 * acá fue moverlo, no reescribirlo.
 *
 * Se movió para que el panel de administración use exactamente el mismo
 * recorte que produjo el arte que ya está en producción. Dos implementaciones
 * del mismo algoritmo se separan sin que nadie lo note, y lo que se nota
 * después es que un avatar nuevo tiene un halo que los viejos no tienen.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO SE BORRA «TODO LO BLANCO»
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque un umbral global —«todo píxel más claro que 225 se vuelve
 * transparente»— no distingue el fondo de la figura. Y estas figuras tienen
 * blanco adentro: el filo de una armadura, los dientes, el brillo de un ojo,
 * la túnica de la sacerdotisa. Con umbral global al mago le quedan agujeros
 * en los ojos, y nadie se entera hasta que lo ve en la tienda, chiquito y
 * recortado en un círculo.
 *
 * Lo que se hace es un RELLENO POR INUNDACIÓN desde los bordes: se entra por
 * los cuatro costados y se avanza mientras el píxel siga siendo casi blanco.
 * Así sólo desaparece el blanco CONECTADO con el borde, que es la definición
 * operativa de «fondo». El blanco encerrado dentro de la figura no se toca,
 * porque no se llega a él sin cruzar la silueta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL BORDE SE SUAVIZA, PORQUE SI NO QUEDA UN HALO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un recorte de sí o no deja el contorno dentado y, peor, deja el anillo de
 * píxeles medio blancos que el antialias del dibujo original puso entre la
 * figura y el fondo. Sobre el panel oscuro del juego ese anillo se ve como un
 * halo claro alrededor de cada personaje.
 *
 * Por eso, después de la inundación, los píxeles que tocan una zona ya
 * transparente y siguen siendo claros no se borran: se les baja la opacidad en
 * proporción a cuán claros son. El contorno queda progresivo, que es lo que
 * hace que se apoye sobre cualquier fondo.
 */

/**
 * Cuán claro tiene que ser un píxel para contar como fondo.
 *
 * 225 sobre 255 en los tres canales. Más alto deja un borde sucio; más bajo
 * empieza a comerse los grises claros de la propia figura.
 */
export const UMBRAL = 225;

/**
 * Cuánto por debajo del umbral se sigue suavizando.
 *
 * Los píxeles del anillo van de `UMBRAL` para arriba hasta blanco; los que
 * están más de 60 por debajo ya son figura y se quedan enteros.
 */
const RAMPA = 60;

/**
 * Saca el fondo blanco, EN EL LUGAR.
 *
 * Trabaja sobre `cuadro.data`, así que quien lo llame tiene que volver a
 * ponerlo con `putImageData`. Se hace así y no devolviendo un cuadro nuevo
 * porque son millones de bytes y copiarlos no agrega nada.
 *
 * @param {ImageData} cuadro
 * @param {object} [opciones]
 * @param {number} [opciones.umbral]
 * @returns {{borrados: number, suavizados: number, total: number}} para poder
 *          contarle al administrador cuánto se borró — un 0 % casi siempre
 *          significa que la imagen no tenía fondo blanco.
 */
export function quitarFondoBlanco(cuadro, { umbral = UMBRAL } = {}) {
  const an = cuadro.width;
  const al = cuadro.height;
  const p = cuadro.data;

  const casiBlanco = (i) => p[i] >= umbral && p[i + 1] >= umbral && p[i + 2] >= umbral;

  // ---- inundación desde los bordes ----
  //
  // Una cola explícita y no recursión: 512x512 son 262.144 píxeles y una
  // recursión de esa profundidad revienta la pila del navegador.
  const visto = new Uint8Array(an * al);
  const cola = [];

  const encolar = (x, y) => {
    if (x < 0 || y < 0 || x >= an || y >= al) return;
    const n = y * an + x;
    if (visto[n]) return;
    if (!casiBlanco(n * 4)) return;
    visto[n] = 1;
    cola.push(n);
  };

  for (let x = 0; x < an; x++) {
    encolar(x, 0);
    encolar(x, al - 1);
  }
  for (let y = 0; y < al; y++) {
    encolar(0, y);
    encolar(an - 1, y);
  }

  let borrados = 0;
  while (cola.length) {
    const n = cola.pop();
    p[n * 4 + 3] = 0;
    borrados++;
    const x = n % an;
    const y = (n / an) | 0;
    encolar(x + 1, y);
    encolar(x - 1, y);
    encolar(x, y + 1);
    encolar(x, y - 1);
  }

  // ---- el anillo del borde, con opacidad proporcional ----
  //
  // Se decide sobre una COPIA de las opacidades. Si se leyera el cuadro
  // mientras se escribe, un píxel ya suavizado contaría como transparente
  // para su vecino y el desvanecido se propagaría hacia adentro de la figura,
  // comiéndosela de a poco.
  const alfaPrevia = new Uint8Array(an * al);
  for (let n = 0; n < an * al; n++) alfaPrevia[n] = p[n * 4 + 3];

  let suavizados = 0;
  for (let y = 0; y < al; y++) {
    for (let x = 0; x < an; x++) {
      const n = y * an + x;
      if (alfaPrevia[n] === 0) continue;

      const tocaFondo =
        (x > 0 && alfaPrevia[n - 1] === 0) ||
        (x < an - 1 && alfaPrevia[n + 1] === 0) ||
        (y > 0 && alfaPrevia[n - an] === 0) ||
        (y < al - 1 && alfaPrevia[n + an] === 0);
      if (!tocaFondo) continue;

      // Cuánto le falta al píxel para ser blanco: si es casi blanco, casi
      // transparente; si es oscuro, se queda entero.
      const claridad = (p[n * 4] + p[n * 4 + 1] + p[n * 4 + 2]) / 3;
      if (claridad < umbral - RAMPA) continue;
      const opacidad = Math.max(0, Math.min(1, (255 - claridad) / RAMPA));
      p[n * 4 + 3] = Math.round(255 * opacidad);
      suavizados++;
    }
  }

  return { borrados, suavizados, total: an * al };
}
