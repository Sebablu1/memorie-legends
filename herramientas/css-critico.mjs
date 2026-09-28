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
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ADEMÁS SE PUEDE COMPROBAR SIN ESCRIBIR NADA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque nada obliga a correr esto, y "se vuelve a correr y listo" sólo vale
 * si alguien se acuerda. En `ac8ebd6` los campos del sitio pasaron a 16px
 * —para que Safari en iOS no haga zoom al tocarlos— y la copia incrustada de
 * la portada se quedó con el tamaño viejo. No falló nada: la portada siguió
 * andando, con otra letra en sus campos que el resto del sitio. Peor todavía:
 * la comprobación que se hizo en el momento contestó "al día", porque miraba
 * que las marcas estuvieran en su lugar y no que el contenido coincidiera.
 *
 * Por eso el armado vive en `armarBloque()`, que no escribe nada, y el
 * `writeFileSync` sólo corre cuando este archivo se ejecuta a mano.
 * `pruebas/css-incrustado.mjs` llama a esa misma función, la compara con lo
 * que hay en `index.html` y rompe `npm test` cuando no son iguales.
 *
 * La comprobación usa la función que escribe, no una copia de sus reglas: una
 * copia sería otra cosa más que puede desincronizarse, que es el defecto que
 * este archivo entero viene a evitar.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Todo se resuelve contra la raíz del repositorio y no contra el directorio
 *  desde donde se llamó: las pruebas importan esto, y una prueba no elige su
 *  directorio de trabajo. */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (ruta) => readFileSync(join(REPO, ruta), "utf8");

/** Dónde va el bloque. Todo lo que esté entre las marcas se reemplaza. */
export const INICIO = "<!-- css-incrustado:inicio -->";
export const FIN = "<!-- css-incrustado:fin -->";

export const DESTINO = "public/index.html";

/** En el mismo orden en que estaban enlazadas: el orden decide quién gana. */
export const HOJAS = [
  "public/css/tema.css",
  "public/css/barra.css",
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
export const limpiar = (css) =>
  css
    // Los fines de línea de Windows, primero que nada. `git` los pone al bajar
    // los archivos y los saca al subirlos (`core.autocrlf`), así que la MISMA
    // hoja llega acá con `\r\n` o con `\n` según quién la haya bajado y cuándo.
    //
    // Casi todo se normaliza solo más abajo, pero no los valores que ocupan
    // varios renglones —el `filter` de `.marca-texto` es el caso— y ahí el
    // `\r` sobrevive hasta el HTML. El bloque generado cambiaría según la
    // máquina, y la comprobación fallaría sin que nadie haya tocado una regla.
    // Apareció en la primera corrida de `pruebas/css-incrustado.mjs`.
    .replace(/\r\n?/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\n\s*\n+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*([{}:;,])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();

/**
 * El bloque entero, tal cual tiene que quedar en el HTML. No escribe nada.
 */
export function armarBloque() {
  const partes = HOJAS.map((hoja) => {
    // Una marca por hoja: cuando algo se ve mal, saber de cuál venía la regla
    // ahorra el peor rato de depurar un archivo generado.
    return `/* ${hoja} */\n${limpiar(leer(hoja))}`;
  });
  return `${INICIO}\n    <style>\n${partes.join("\n")}\n    </style>\n    ${FIN}`;
}

/**
 * El bloque que hay HOY en el HTML, marcas incluidas, para poder compararlo
 * con el de arriba sin depender de cómo esté indentado el resto del archivo.
 */
export function bloqueActual(html) {
  const desde = html.indexOf(INICIO);
  const hasta = html.indexOf(FIN);
  if (desde === -1 || hasta === -1) {
    throw new Error(
      `Faltan las marcas ${INICIO} / ${FIN} en ${DESTINO}. Sin ellas esto no ` +
        `sabe dónde escribir, y adivinar sería peor.`,
    );
  }
  return html.slice(desde, hasta + FIN.length);
}

/** Escribe el bloque en el HTML y devuelve qué tan grande quedó. */
export function incrustar() {
  const html = leer(DESTINO);
  const viejo = bloqueActual(html);
  const bloque = armarBloque();
  const desde = html.indexOf(INICIO);
  const nuevo = html.slice(0, desde) + bloque + html.slice(desde + viejo.length);
  writeFileSync(join(REPO, DESTINO), nuevo, "utf8");
  const crudo = HOJAS.reduce((n, h) => n + leer(h).length, 0);
  return { crudo, bloque, cambio: viejo !== bloque };
}

// Sólo cuando se lo llama a mano. Importarlo —lo que hace la prueba— no puede
// escribir el archivo: una prueba que arregla lo que viene a comprobar pasa
// siempre, y eso es exactamente lo que dejó pasar el tamaño viejo de `ac8ebd6`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { crudo, bloque, cambio } = incrustar();
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  console.log(
    `  ${HOJAS.length} hojas incrustadas en ${DESTINO}: ` +
      `${kb(crudo)} -> ${kb(bloque.length)} (sin comentarios)` +
      `${cambio ? "" : " — ya estaba al día"}`,
  );
}
