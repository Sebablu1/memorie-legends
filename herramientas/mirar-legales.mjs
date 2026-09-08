/**
 * Una foto de las tres páginas legales, en PC y en teléfono.
 *
 *   node herramientas/mirar-legales.mjs [carpeta-de-salida]
 *
 * `pruebas/paginas-legales.mjs` comprueba que digan la verdad. Esto comprueba
 * que se puedan leer: que el aviso del dato pendiente se distinga del texto
 * normal, que ningún bloque desborde a lo ancho en un teléfono y que las
 * treinta secciones no queden como un muro gris.
 *
 * Falla si la página desborda horizontalmente. Ese es el defecto que aparece
 * solo en un documento largo con listas anidadas y correos electrónicos sin
 * espacios, y es el que nadie encuentra leyendo el HTML.
 */

import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SALIDA = process.argv[2] ?? RAIZ;

const PAGINAS = ["terminos", "privacidad", "seguridad"];
const ANCHOS = [
  { nombre: "pc", ancho: 1200, alto: 900 },
  { nombre: "movil", ancho: 380, alto: 800 },
];

const navegador = await chromium.launch();
const pagina = await navegador.newPage();

// Servidor de un archivo: las páginas piden CSS e imágenes con rutas absolutas
// y sin un origen quedan colgando.
await pagina.route("**/*", async (ruta) => {
  const url = new URL(ruta.request().url());
  if (url.hostname !== "legal.local") return ruta.continue();
  try {
    return await ruta.fulfill({ path: join(RAIZ, "public", url.pathname) });
  } catch {
    return ruta.abort();
  }
});

let problemas = 0;

for (const p of PAGINAS) {
  for (const { nombre, ancho, alto } of ANCHOS) {
    await pagina.setViewportSize({ width: ancho, height: alto });
    await pagina.goto(`http://legal.local/${p}.html`);
    await pagina.waitForLoadState("networkidle");

    const medida = await pagina.evaluate(() => {
      const raiz = document.documentElement;
      // Qué elemento se sale, si alguno. Saber el ancho no alcanza: hay que
      // poder nombrar al culpable.
      const culpables = [...document.querySelectorAll("body *")]
        .filter((el) => el.getBoundingClientRect().right > raiz.clientWidth + 1)
        .slice(0, 3)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className || "(sin clase)"}`);

      return {
        desborda: raiz.scrollWidth > raiz.clientWidth,
        culpables,
        secciones: document.querySelectorAll(".legal-container h2").length,
        avisos: document.querySelectorAll(".legal-container .aviso").length,
        alto: raiz.scrollHeight,
      };
    });

    const archivo = join(SALIDA, `legal-${p}-${nombre}.png`);
    await pagina.screenshot({ path: archivo, fullPage: nombre === "pc" });

    const estado = medida.desborda ? "❌ DESBORDA" : "ok";
    console.log(
      `${p.padEnd(11)} ${nombre.padEnd(6)} ${String(medida.secciones).padStart(2)} secciones, ` +
        `${medida.avisos} avisos, ${medida.alto}px de alto  ${estado}` +
        (medida.culpables.length ? `  ${medida.culpables.join(", ")}` : ""),
    );
    if (medida.desborda) problemas++;
  }
}

await navegador.close();

console.log(
  problemas
    ? `\n❌ ${problemas} vistas desbordan a lo ancho`
    : "\n✅ ninguna desborda; las fotos quedaron en " + SALIDA,
);
process.exit(problemas ? 1 : 0);
