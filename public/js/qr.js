/**
 * Dibuja un código QR en un canvas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ LA BIBLIOTECA ESTÁ COPIADA ACÁ Y NO VIENE DE UN CDN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Es la decisión que importa de este archivo. Lo que se dibuja acá es el
 * SECRETO del segundo factor: quien lo tenga puede generar los códigos de esa
 * cuenta para siempre.
 *
 * Un `<script src="https://cdn-cualquiera/qr.js">` en esa página es código de
 * un tercero corriendo junto al secreto, con permiso para leerlo del DOM y
 * mandarlo a donde quiera. No hace falta que el proveedor sea malicioso: alcanza
 * con que le entren una vez. Poner el segundo factor —lo que se construyó
 * justamente para que robar la contraseña no alcance— a merced de una máquina
 * que no controlamos sería deshacer el trabajo con una línea de HTML.
 *
 * Así que la biblioteca vive en `vendor/qrcode.js`, se despliega con el sitio
 * y no cambia sin que nadie lo note. Son 50 KB y se cargan sólo en esta
 * pantalla.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ BLANCO Y NEGRO EN UNA PÁGINA OSCURA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un QR dorado sobre paño verde quedaría lindo y sería peor: los lectores
 * necesitan contraste alto y un margen claro alrededor —la "zona tranquila"—
 * para encontrar el código. Este es de los pocos sitios donde la marca cede.
 */

// La extensión es `.js` y no `.mjs` a propósito. Firebase Hosting y el
// servidor de las pruebas mandan `.mjs` como `application/octet-stream`, y un
// navegador rechaza un módulo que no venga con tipo de JavaScript: el import
// falla entero y la pantalla queda muerta sin decir por qué.
import qrcode from "./vendor/qrcode.js";

/**
 * Módulos de margen alrededor del código.
 *
 * Cuatro es el mínimo que pide la norma. Con menos, un lector apuntando a una
 * pantalla oscura no encuentra dónde empieza el código: no es un detalle
 * estético sino la diferencia entre que escanee y que no.
 */
const MARGEN = 4;

/**
 * @param canvas  el <canvas> donde dibujar
 * @param texto   lo que se codifica (acá, la URI otpauth://)
 * @param lado    ancho en píxeles del dibujo final
 */
export function dibujarQr(canvas, texto, { lado = 240 } = {}) {
  // Tipo 0 = que elija solo el tamaño según lo que entre. Corrección "M":
  // aguanta un 15% de daño, que es lo que compensa una pantalla sucia o una
  // foto torcida sin agrandar el código de más.
  const codigo = qrcode(0, "M");
  codigo.addData(texto);
  codigo.make();

  const modulos = codigo.getModuleCount();
  const total = modulos + MARGEN * 2;

  // El lado se redondea a un múltiplo entero de módulos. Si no, cada módulo
  // cae en una fracción de píxel, el navegador lo suaviza, y los bordes
  // borrosos son justo lo que confunde a un lector.
  const escala = Math.max(1, Math.floor(lado / total));
  const medida = total * escala;

  // El canvas se dibuja al doble en pantallas densas y se muestra al tamaño
  // pedido. Sin esto se ve pixelado en un teléfono moderno.
  const densidad = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = medida * densidad;
  canvas.height = medida * densidad;
  canvas.style.width = `${medida}px`;
  canvas.style.height = `${medida}px`;

  const pincel = canvas.getContext("2d");
  pincel.scale(densidad, densidad);

  pincel.fillStyle = "#ffffff";
  pincel.fillRect(0, 0, medida, medida);

  pincel.fillStyle = "#0b0b0b";
  for (let fila = 0; fila < modulos; fila++) {
    for (let columna = 0; columna < modulos; columna++) {
      if (!codigo.isDark(fila, columna)) continue;
      pincel.fillRect(
        (columna + MARGEN) * escala,
        (fila + MARGEN) * escala,
        escala,
        escala,
      );
    }
  }

  return { modulos, medida };
}
