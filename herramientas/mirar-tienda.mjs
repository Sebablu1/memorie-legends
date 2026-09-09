/**
 * Una foto de la tienda con los artículos de verdad.
 *
 *   node herramientas/mirar-tienda.mjs
 *
 * No comprueba nada: las suites ya lo hacen. Esto sirve para MIRAR, que es lo
 * único que no puede hacer una prueba automática. Si un recorte quedó con halo,
 * si una figura queda descentrada dentro del cuadro de 88 píxeles, si un nombre
 * de dos palabras rompe la tarjeta: eso se ve acá y no en un `expect`.
 *
 * Lo que se dibuja es lo de verdad y no una maqueta: el catálogo sale del mismo
 * archivo que siembra Firestore, el CSS es el que se despliega, y el HTML de
 * cada tarjeta se arma con las mismas reglas que `personalizacion.js`. Una
 * maqueta parecida se vería bien aunque la tienda estuviera rota.
 *
 * Deja `tienda.png` en la carpeta de trabajo que se le pase, o en la raíz.
 */

import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CATALOGO_INICIAL,
  itemsDeTipo,
  imagenEsArchivo,
  TIPOS_VALIDOS,
} from "../public/js/reglas/catalogo.js";

const RAIZ = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SALIDA = process.argv[2] ?? join(RAIZ, "tienda.png");

const escapar = (t) =>
  String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Las mismas cuatro situaciones del botón, para que la foto no sea toda igual. */
const boton = (item, i) => {
  if (i === 0) return `<button class="accion sobria" type="button" disabled>✓ Equipado</button>`;
  if (i === 1) return `<button class="accion" type="button">Equipar</button>`;
  if (item.precio > 2000) return `<button class="accion" type="button" disabled>No alcanza</button>`;
  return `<button class="accion" type="button">Comprar</button>`;
};

const tarjeta = (item, i) => `
  <article class="item-tienda ${i === 0 ? "puesto" : ""} ${i <= 1 ? "mio" : ""}">
    ${i === 0 ? '<span class="cinta-item">En uso</span>' : ""}
    ${
      imagenEsArchivo(item.imagen)
        ? `<img class="figura-item" src="${escapar(item.imagen)}" alt="" />`
        : `<span class="figura-item glifo" aria-hidden="true">${escapar(item.imagen ?? "")}</span>`
    }
    <h3>${escapar(item.nombre)}</h3>
    <p class="descripcion-item">${escapar(item.descripcion ?? "")}</p>
    <div class="precio-item">${i <= 1 ? "Tuyo" : `${item.precio} Leyendas`}</div>
    ${boton(item, i)}
  </article>`;

/**
 * Cómo se llama cada tipo en la foto.
 *
 * Las secciones se recorren desde `TIPOS_VALIDOS` y no se escriben a mano:
 * estaban listadas y al aparecer los paños de mesa la foto siguió mostrando
 * tres categorías sobre un catálogo de cuatro. Una herramienta para MIRAR
 * que esconde una cuarta parte de lo que hay no sirve para lo único que
 * hace.
 */
const TITULOS = {
  avatar: "Avatares",
  insignia: "Insignias",
  dorso: "Dorsos",
  fondo: "Paños de mesa",
};

const seccion = (titulo, tipo) => `
  <section class="panel" style="margin-bottom: 28px">
    <h2>${titulo}</h2>
    <div class="rejilla-tienda">
      ${itemsDeTipo(CATALOGO_INICIAL, tipo).map(tarjeta).join("")}
    </div>
  </section>`;

const hojas = ["tema.css", "app.css", "tablas.css", "tienda.css"]
  .map((h) => readFileSync(join(RAIZ, "public/css", h), "utf8"))
  .join("\n");

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<style>${hojas}</style>
<style>body { padding: 24px; } h2 { margin-bottom: 14px; }</style>
</head><body>
${TIPOS_VALIDOS.map((t) => seccion(TITULOS[t] ?? t, t)).join("")}
</body></html>`;

const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: 1200, height: 900 } });

// Servidor de un archivo: hace falta un origen para que `/img/...` resuelva.
// Con `setContent` las rutas absolutas quedan colgando y salen 21 imágenes rotas
// que se verían como un problema de los recortes.
await pagina.route("**/*", async (ruta) => {
  const url = new URL(ruta.request().url());
  if (url.pathname === "/") return ruta.fulfill({ contentType: "text/html", body: html });
  try {
    return await ruta.fulfill({ path: join(RAIZ, "public", url.pathname) });
  } catch {
    return ruta.abort();
  }
});

await pagina.goto("http://tienda.local/");
await pagina.waitForLoadState("networkidle");

const rotas = await pagina.evaluate(() =>
  [...document.images].filter((i) => !i.naturalWidth).map((i) => i.getAttribute("src")),
);

await pagina.screenshot({ path: SALIDA, fullPage: true });
await navegador.close();

console.log(`${CATALOGO_INICIAL.length} artículos dibujados -> ${SALIDA}`);
if (rotas.length) {
  console.log(`\n❌ ${rotas.length} imágenes no cargaron:`);
  for (const r of rotas) console.log(`   ${r}`);
  process.exit(1);
}
console.log("✅ todas las imágenes cargaron");
