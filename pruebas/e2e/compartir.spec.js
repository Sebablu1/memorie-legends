/**
 * La tarjeta que se ve al compartir un enlace del juego.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO NECESITA UNA PRUEBA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque cuando se rompe, NADA falla. La página sigue funcionando igual; lo
 * único que pasa es que el enlace se comparte como una línea de texto pelada,
 * y eso no se descubre programando: se descubre cuando alguien lo manda por
 * WhatsApp y no aparece nada.
 *
 * Los tres errores que de verdad ocurren, y que acá se atajan:
 *
 *   - RUTA RELATIVA en `og:image`. Quien lee estas etiquetas no navega la
 *     página: pide el HTML y lee el atributo. Una ruta como `img/x.jpg` no
 *     resuelve contra nada y la miniatura no sale.
 *   - WEBP. Es el formato del resto del sitio y WhatsApp no lo muestra. Por
 *     eso la tarjeta es JPG, y es la única imagen del sitio que lo es.
 *   - UNA IMAGEN PESADA. Por encima de unos pocos cientos de kilobytes varios
 *     clientes se rinden y no muestran nada.
 */

import { test, expect } from "@playwright/test";

const SITIO = "https://memorie-legends.web.app";
const TARJETA = `${SITIO}/img/compartir.jpg`;

/** Las páginas que alguien podría llegar a compartir. */
const PAGINAS = [
  "index.html",
  "como-se-juega.html",
  "login.html",
  "register.html",
  "dashboard.html",
  "ranking.html",
  "tienda.html",
  "ruleta.html",
  "cuenta.html",
  "room.html",
  "mesa.html",
  "quienes-somos.html",
  "terminos.html",
  "privacidad.html",
  "seguridad.html",
];

/**
 * Lee las etiquetas como las lee un lector de enlaces: del HTML servido.
 *
 * Se pide el archivo y se mira el texto, sin abrir la página en el navegador.
 * Es exactamente lo que hacen WhatsApp, Telegram o X — no ejecutan JavaScript—
 * así que comprobarlo así es comprobar lo que ellos van a ver. Abrir la página
 * y leer el DOM daría por buenas etiquetas que el JavaScript agregue después,
 * que ninguno de ellos vería.
 */
async function etiquetasDe(page, archivo) {
  const html = await (await page.request.get(`/${archivo}`)).text();
  const leer = (patron) => [...html.matchAll(patron)].map((m) => m[1]);

  // `\s+` y no un espacio: algunas etiquetas del HTML están escritas en varias
  // líneas, con el nombre y el contenido cada uno en la suya. Buscar un espacio
  // exacto las daba por ausentes — y la prueba acusaba a la página de algo que
  // no pasaba.
  const meta = (clase, nombre) =>
    new RegExp(`<meta\\s+${clase}="${nombre}"\\s+content="([^"]*)"`, "g");

  return {
    ogTitulo: leer(meta("property", "og:title")),
    ogDesc: leer(meta("property", "og:description")),
    ogImagen: leer(meta("property", "og:image")),
    ogUrl: leer(meta("property", "og:url")),
    tarjeta: leer(meta("name", "twitter:card")),
    descripcion: leer(meta("name", "description")),
  };
}

test("todas las páginas tienen su tarjeta, y una sola", async ({ page }) => {
  for (const archivo of PAGINAS) {
    const e = await etiquetasDe(page, archivo);

    expect(e.ogTitulo, `${archivo}: falta og:title`).toHaveLength(1);
    expect(e.ogDesc, `${archivo}: falta og:description`).toHaveLength(1);
    expect(e.ogImagen, `${archivo}: falta og:image`).toHaveLength(1);
    expect(e.tarjeta[0], `${archivo}: la tarjeta chica no muestra el logo grande`).toBe(
      "summary_large_image",
    );

    // Repetidas es peor que faltantes: cada servicio elige una distinta y el
    // enlace se ve de una forma en WhatsApp y de otra en Telegram.
    expect(e.descripcion, `${archivo}: hay más de una descripción`).toHaveLength(1);
  }
});

test("la imagen es absoluta, y es la misma en todas", async ({ page }) => {
  for (const archivo of PAGINAS) {
    const { ogImagen } = await etiquetasDe(page, archivo);
    expect(
      ogImagen[0],
      `${archivo}: la imagen tiene que ser una URL entera, no una ruta`,
    ).toBe(TARJETA);
  }
});

test("cada página se declara a sí misma, no a la portada", async ({ page }) => {
  // Si todas dijeran ser la portada, compartir el ranking mostraría el título
  // de la portada. Y peor: los buscadores tratarían todo el sitio como una
  // sola página.
  for (const archivo of PAGINAS) {
    const { ogUrl } = await etiquetasDe(page, archivo);
    const esperada = archivo === "index.html" ? `${SITIO}/` : `${SITIO}/${archivo}`;
    expect(ogUrl[0], `${archivo}: se declara como otra página`).toBe(esperada);
  }
});

test("los títulos y las descripciones son distintos entre páginas", async ({
  page,
}) => {
  // Copiar el mismo texto en las quince es lo más fácil de hacer y lo menos
  // útil: compartir el ranking tiene que decir que es el ranking.
  const titulos = new Set();
  const descripciones = new Set();

  for (const archivo of PAGINAS) {
    const e = await etiquetasDe(page, archivo);
    titulos.add(e.ogTitulo[0]);
    descripciones.add(e.ogDesc[0]);

    // Ni tan corta que no diga nada, ni tan larga que se corte a la mitad:
    // WhatsApp y las redes muestran alrededor de 160 caracteres.
    const largo = e.ogDesc[0].length;
    expect(largo, `${archivo}: descripción de ${largo} caracteres`).toBeGreaterThan(40);
    expect(largo, `${archivo}: descripción de ${largo} caracteres`).toBeLessThanOrEqual(200);
  }

  expect(titulos.size, "hay títulos repetidos entre páginas").toBe(PAGINAS.length);
  expect(descripciones.size, "hay descripciones repetidas").toBe(PAGINAS.length);
});

test("la miniatura existe, es JPG, mide 1200x630 y pesa poco", async ({ page }) => {
  const r = await page.request.get("/img/compartir.jpg");
  expect(r.status(), "la miniatura no está servida").toBe(200);

  // JPG y no WebP: WhatsApp no muestra WebP, y el resto del sitio es WebP.
  // Ésta es la excepción a propósito.
  expect(r.headers()["content-type"]).toContain("jpeg");

  const bytes = (await r.body()).length;
  expect(
    Math.round(bytes / 1024),
    `la miniatura pesa ${Math.round(bytes / 1024)} KB: varios clientes dejan de mostrarla`,
  ).toBeLessThan(300);

  // Y mide lo que las etiquetas dicen que mide. Declarar un tamaño y servir
  // otro deja la tarjeta recortada o con bandas.
  await page.goto("/index.html");
  const medida = await page.evaluate(
    () =>
      new Promise((listo) => {
        const img = new Image();
        img.onload = () => listo({ ancho: img.naturalWidth, alto: img.naturalHeight });
        img.onerror = () => listo(null);
        img.src = "/img/compartir.jpg";
      }),
  );
  expect(medida, "la miniatura no se pudo cargar").not.toBeNull();
  expect(medida.ancho).toBe(1200);
  expect(medida.alto).toBe(630);
});
