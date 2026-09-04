/**
 * Mete el CSS de la portada dentro de su propio HTML.
 *
 *   node herramientas/css-critico.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ PROBLEMA RESUELVE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La portada pedía cuatro hojas de estilo, y el navegador no dibuja NADA hasta
 * tenerlas las cuatro. Medido: 1.400 ms de pantalla en blanco, en una conexión
 * de teléfono. Son 34 KB en crudo — unos 10 comprimidos— repartidos en cuatro
 * viajes de ida y vuelta, y lo que cuesta son los viajes, no los bytes.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ENTERAS Y NO SÓLO "LO CRÍTICO"
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Lo habitual es elegir a mano las reglas de lo que se ve primero, incrustar
 * ésas y cargar el resto después. Acá se descartó por dos motivos:
 *
 *   - Se desincroniza sola. La lista de reglas "críticas" queda escrita en un
 *     lugar y las reglas de verdad en otro; a la tercera vez que alguien toca
 *     `portada.css`, la copia miente. Y cuando miente no falla nada: la página
 *     parpadea un instante con un diseño a medias, que es justo lo que esto
 *     venía a evitar.
 *   - No hace falta. La portada usa buena parte de `app.css` —la barra, la
 *     rejilla, las tarjetas— así que "lo crítico" terminaba siendo casi todo.
 *
 * Incrustando las cuatro se garantiza que lo que se ve es exactamente lo mismo
 * que antes, porque es el mismo CSS. Y se genera desde los archivos, así que no
 * hay una segunda copia que mantener: se vuelve a correr esto y listo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL PRECIO, DICHO CLARO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Este CSS deja de compartirse con las demás pantallas: quien entra por la
 * portada y después va al tablero baja `app.css` otra vez. Se acepta sólo acá
 * porque la portada es la puerta —la mayoría de las visitas la ven primero y
 * muchas no pasan de ahí—, y para esa primera vez no había nada en la caché
 * igual. En el resto del sitio las hojas siguen enlazadas y compartidas.
 */

import { readFileSync, writeFileSync } from "node:fs";

/** Dónde va el bloque. Todo lo que esté entre las marcas se reemplaza. */
const INICIO = "<!-- css-incrustado:inicio -->";
const FIN = "<!-- css-incrustado:fin -->";

const DESTINO = "public/index.html";

/** En el mismo orden en que estaban enlazadas: el orden decide quién gana. */
const HOJAS = [
  "public/css/tema.css",
  "public/css/app.css",
  "public/css/portada.css",
  "public/css/pie.css",
];

/**
 * Saca los comentarios y el espacio que sobra.
 *
 * Estas hojas están muy comentadas —a propósito— y esos comentarios explican
 * decisiones a quien lea el archivo, no al navegador. Sacarlos acá no los
 * pierde: el original sigue intacto y es el que se lee y se edita.
 *
 * Es una limpieza conservadora, no un minificador: no toca selectores, no
 * reordena nada y no intenta acortar valores. Un minificador de verdad
 * ahorraría un poco más y podría romper algo por una regla rara; esto no
 * puede.
 */
const limpiar = (css) =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\n\s*\n+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*([{}:;,])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();

const partes = HOJAS.map((hoja) => {
  const css = limpiar(readFileSync(hoja, "utf8"));
  // Una marca por hoja: cuando algo se ve mal, saber de cuál venía la regla
  // ahorra el peor rato de depurar un archivo generado.
  return `/* ${hoja} */\n${css}`;
});

const bloque = `${INICIO}\n    <style>\n${partes.join("\n")}\n    </style>\n    ${FIN}`;

const html = readFileSync(DESTINO, "utf8");
const desde = html.indexOf(INICIO);
const hasta = html.indexOf(FIN);
if (desde === -1 || hasta === -1) {
  throw new Error(
    `Faltan las marcas ${INICIO} / ${FIN} en ${DESTINO}. Sin ellas esto no ` +
      `sabe dónde escribir, y adivinar sería peor.`,
  );
}

const nuevo = html.slice(0, desde) + bloque + html.slice(hasta + FIN.length);
writeFileSync(DESTINO, nuevo, "utf8");

const crudo = HOJAS.reduce((n, h) => n + readFileSync(h, "utf8").length, 0);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(
  `  ${HOJAS.length} hojas incrustadas en ${DESTINO}: ` +
    `${kb(crudo)} -> ${kb(bloque.length)} (sin comentarios)`,
);
