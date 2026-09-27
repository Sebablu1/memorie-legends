/**
 * El menú plegable de la barra.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE DE VERDAD HAY QUE DEFENDER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Que el menú se vea bonito importa menos que tres cosas que, si se rompen,
 * no avisan:
 *
 *   1. Que los nodos se MUDEN y no se copien. Una copia duplicaría el id
 *      `enlaceAdmin` —y el enlace de administración podría quedar visible para
 *      quien no debe— y dejaría un botón "Salir" sin escuchador, que se toca y
 *      no hace nada.
 *   2. Que el cajón se pueda cerrar. Si la X, el velo y la tecla Escape
 *      fallaran a la vez, el menú quedaría tapando la página sin salida.
 *   3. Que cambiar de tamaño no pierda ni duplique nada. Los enlaces viven
 *      siempre en el cajón; lo que se muda es el saldo, que en pantalla grande
 *      se queda en la barra y en el teléfono se guarda. Dos `#saldo` a la vez
 *      serían uno actualizándose y otro congelado.
 */

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const SESION_FALSA = `
  export const COLECCION="users"; export const CAMPO_SALDO="credits";
  export async function exigirSesion(){return{usuario:{uid:"u1",photoURL:null},
    perfil:{uid:"u1",nombre:"Probador",saldo:500,partidas:3,victorias:1}};}
  export function mostrarSaldo(){} export function conectarBotonSalir(){}
  export function formatearEspera(){return "listo";}`;

const MOVIL = { width: 390, height: 844 };
const ESCRITORIO = { width: 1280, height: 800 };

async function abrirTablero(page, tamano = MOVIL) {
  await page.setViewportSize(tamano);
  await page.route("**/js/sesion.js", (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/javascript; charset=utf-8",
      body: SESION_FALSA,
    }),
  );
  await page.goto("/dashboard.html");
  await page.waitForSelector("#btnMenu", { state: "attached", timeout: 10_000 });
}

// =====================================================================
// Dónde vive el menú según el ancho
// =====================================================================

test("en el teléfono manda el hamburguesa; el menú horizontal no está", async ({
  page,
}) => {
  await abrirTablero(page);

  await expect(page.locator("#btnMenu")).toBeVisible();
  // El `<nav>` existe, pero ya no en la barra: se mudó al cajón.
  await expect(page.locator(".barra-contenido nav")).toHaveCount(0);
  await expect(page.locator("#cajonMenu nav")).toHaveCount(1);
});

test("en pantalla grande el hamburguesa también manda", async ({ page }) => {
  // El menú plegable dejó de ser cosa del teléfono. Una barra con siete
  // enlaces, el saldo y el botón de salir compite consigo misma; con el logo,
  // el saldo y un botón se lee de un vistazo.
  await abrirTablero(page, ESCRITORIO);

  await expect(page.locator("#btnMenu")).toBeVisible();
  await expect(page.locator(".barra-contenido nav")).toHaveCount(0);
  await expect(page.locator("#cajonMenu nav")).toHaveCount(1);
});

test("las Leyendas y la foto se quedan en la barra, en cualquier tamaño", async ({
  page,
}) => {
  // Quién soy y cuánto me queda son las dos cosas que uno mira de reojo entre
  // partida y partida. Antes, en el teléfono, las dos se guardaban en el cajón
  // y había que abrirlo para verlas; ahora se quedan pegadas al botón del menú
  // en los dos tamaños.
  for (const tamano of [ESCRITORIO, MOVIL]) {
    await abrirTablero(page, tamano);
    const donde = tamano === MOVIL ? "el teléfono" : "la pantalla grande";

    await expect(page.locator(".barra-contenido #saldo"), donde).toBeVisible();
    await expect(page.locator(".barra-contenido #avatar"), donde).toBeVisible();
    await expect(page.locator("#cajonMenu #saldo"), donde).toHaveCount(0);
  }
});

test("salir, en cambio, baja al cajón", async ({ page }) => {
  // Es la única acción del menú que no lleva a una página, y la que uno menos
  // quiere tocar sin querer: no tiene que estar al alcance del pulgar al lado
  // del saldo.
  await abrirTablero(page);

  await expect(page.locator("#cajonMenu #btnSalir")).toHaveCount(1);
  await expect(page.locator(".barra-contenido #btnSalir")).toHaveCount(0);
});

test("la portada sí guarda sus dos botones en el teléfono", async ({ page }) => {
  // La portada no tiene sesión: su `.derecha` son "Iniciar sesión" y "Crear
  // cuenta", y ésos sí se mudan al cajón cuando no entran al lado del logo.
  // El cambio de arriba vale para la barra de una cuenta abierta, no para
  // cualquier barra.
  await page.setViewportSize(MOVIL);
  await page.goto("/index.html");
  await page.waitForSelector("#btnMenu");

  await expect(page.locator("#cajonMenu .derecha")).toHaveCount(1);
  await expect(page.locator(".barra-contenido .derecha")).toHaveCount(0);
});

test("el cajón abre y cierra igual en pantalla grande", async ({ page }) => {
  await abrirTablero(page, ESCRITORIO);
  const cajon = page.locator("#cajonMenu");

  await expect(cajon).toBeHidden();
  await page.locator("#btnMenu").click();
  await expect(cajon).toBeVisible();
  await expect(cajon.locator('nav a[href="ranking.html"]')).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(cajon).toBeHidden();
});

test("cambiar de tamaño no pierde el menú ni lo duplica", async ({ page }) => {
  // Se marca el nodo para reconocerlo: si en vez de mudarse se copiara, la
  // marca no viajaría y habría dos `#saldo` —uno actualizándose y otro
  // congelado— y dos `#btnSalir`, el segundo sin escuchador.
  await abrirTablero(page);
  await page.evaluate(() => {
    document.querySelector(".barra-contenido .derecha").dataset.marca = "el-mismo";
    document.querySelector("#cajonMenu #btnSalir").dataset.marca = "el-mismo";
  });

  for (const tamano of [ESCRITORIO, MOVIL, ESCRITORIO]) {
    await page.setViewportSize(tamano);
    await expect(
      page.locator('.barra-contenido .derecha[data-marca="el-mismo"]'),
    ).toHaveCount(1);
    await expect(page.locator('#cajonMenu #btnSalir[data-marca="el-mismo"]')).toHaveCount(1);
    expect(await page.locator("#saldo").count(), "hay dos saldos").toBe(1);
    expect(await page.locator("#btnSalir").count(), "hay dos botones de salir").toBe(1);
  }

  // Y el menú sigue siendo uno solo, en el cajón, todo el tiempo.
  expect(await page.locator("nav").count()).toBe(1);
});

// =====================================================================
// Abrir y cerrar
// =====================================================================

test("abre, y el resto de la página queda apagado", async ({ page }) => {
  await abrirTablero(page);

  const cajon = page.locator("#cajonMenu");
  await expect(cajon).toBeHidden();
  await expect(page.locator("#btnMenu")).toHaveAttribute("aria-expanded", "false");

  await page.locator("#btnMenu").click();

  await expect(cajon).toBeVisible();
  await expect(page.locator("#btnMenu")).toHaveAttribute("aria-expanded", "true");

  // El resto de la página queda `inert`: fuera del tabulado y del lector de
  // pantalla. Es lo que hace que esto sea un panel encima y no una capa
  // decorativa con la página viva por debajo.
  const apagado = await page.evaluate(() => ({
    cabecera: document.querySelector("header")?.inert === true,
    principal: document.querySelector("main")?.inert === true,
  }));
  expect(apagado.cabecera, "la cabecera sigue activa detrás del cajón").toBe(true);
  expect(apagado.principal, "la página sigue activa detrás del cajón").toBe(true);
});

test("se cierra con la X, con el velo y con Escape", async ({ page }) => {
  await abrirTablero(page);
  const cajon = page.locator("#cajonMenu");

  for (const cerrarDe of ["equis", "velo", "escape"]) {
    await page.locator("#btnMenu").click();
    await expect(cajon).toBeVisible();

    if (cerrarDe === "equis") await page.locator(".cerrar-menu").click();
    if (cerrarDe === "velo") await page.locator(".fondo-menu").click();
    if (cerrarDe === "escape") await page.keyboard.press("Escape");

    await expect(cajon, `no cerró con ${cerrarDe}`).toBeHidden();
    await expect(page.locator("#btnMenu")).toHaveAttribute("aria-expanded", "false");
  }
});

test("al cerrar, el foco vuelve al botón", async ({ page }) => {
  // Sin esto, quien navega con teclado cierra el menú y aparece al principio
  // de la página: hay que tabular todo otra vez para volver a donde estaba.
  await abrirTablero(page);

  await page.locator("#btnMenu").click();
  await page.keyboard.press("Escape");

  expect(await page.evaluate(() => document.activeElement?.id)).toBe("btnMenu");
});

test("tocar un enlace cierra el cajón", async ({ page }) => {
  // Importa de verdad con "Jugar", que es un salto a `#jugar` DENTRO de la
  // misma página: sin cerrar, el cajón queda tapando justo el panel al que se
  // acaba de saltar.
  await abrirTablero(page);

  await page.locator("#btnMenu").click();
  await page.locator('#cajonMenu nav a[href="#jugar"]').click();

  await expect(page.locator("#cajonMenu")).toBeHidden();
  await expect(page.locator("#jugar")).toBeInViewport();
});

// =====================================================================
// Lo que no se puede romper
// =====================================================================

test("el enlace de Administración sigue siendo uno solo, y escondido", async ({
  page,
}) => {
  // Si el menú copiara los nodos habría DOS elementos con este id. El destape
  // que hace `dashboard.js` le tocaría a uno solo, y el otro podría quedar a la
  // vista de cualquiera.
  await abrirTablero(page);

  expect(
    await page.locator("#enlaceAdmin").count(),
    "hay más de un enlace de administración: los nodos se copiaron",
  ).toBe(1);
  await expect(page.locator("#enlaceAdmin")).toBeHidden();
});

test("el botón de salir es el mismo, no una copia sin escuchador", async ({
  page,
}) => {
  await abrirTablero(page);
  expect(await page.locator("#btnSalir").count()).toBe(1);
  expect(await page.locator("#saldo").count()).toBe(1);
});

test("el cajón cerrado no deja la página scrolleando de costado", async ({
  page,
}) => {
  // El cajón vive fuera de la pantalla, a la derecha. Los elementos `fixed` no
  // agrandan el documento, pero es barato comprobarlo: si algún día se le
  // cambia el `position`, esto lo agarra.
  for (const ancho of [320, 390, 768]) {
    await abrirTablero(page, { width: ancho, height: 780 });
    const seSale = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(seSale, `a ${ancho}px la página scrollea de costado`).toBe(false);
  }
});

test("el botón dice lo que hace, y cambia al abrirse", async ({ page }) => {
  await abrirTablero(page);

  const boton = page.locator("#btnMenu");
  await expect(boton).toHaveAttribute("aria-label", "Abrir menú");
  await expect(boton).toHaveAttribute("aria-controls", "cajonMenu");

  await boton.click();
  await expect(boton).toHaveAttribute("aria-label", "Cerrar menú");
});

test("la portada también lo tiene, con sus dos botones adentro", async ({
  page,
}) => {
  await page.setViewportSize(MOVIL);
  await page.goto("/index.html");
  await page.waitForSelector("#btnMenu");

  await page.locator("#btnMenu").click();
  const cajon = page.locator("#cajonMenu");
  await expect(cajon).toBeVisible();
  await expect(cajon.locator('a[href="login.html"]')).toBeVisible();
  await expect(cajon.locator('a[href="register.html"]')).toBeVisible();

  // Sin `<nav>` no hay lista de enlaces, así que los botones no se van al pie.
  await expect(cajon).toHaveClass(/sin-enlaces/);
});

// =====================================================================
// Lo que el menú ofrece en todas las páginas
// =====================================================================

test("el cajón lleva al lobby", async ({ page }) => {
  await abrirTablero(page);
  await page.locator("#btnMenu").click();

  const lobby = page.locator('#cajonMenu nav a[href="lobby.html"]');
  await expect(lobby).toBeVisible();
  await expect(lobby).toHaveText("Lobby");
});

test("y tiene el soporte por WhatsApp, con el número del sitio", async ({ page }) => {
  await abrirTablero(page);
  await page.locator("#btnMenu").click();

  const soporte = page.locator("#cajonMenu nav a.enlace-soporte");
  await expect(soporte).toBeVisible();
  await expect(soporte).toHaveText("Soporte WhatsApp");
  await expect(soporte).toHaveAttribute("href", "https://wa.me/59891900968?text=Hola%2C%20necesito%20ayuda%20con%20Memorie%20Legends.%20Mi%20consulta%20es%3A");
  // Sale del sitio: pestaña aparte, y `noopener` para que lo que se abra no
  // pueda tocar esta página desde `window.opener`.
  await expect(soporte).toHaveAttribute("target", "_blank");
  await expect(soporte).toHaveAttribute("rel", /noopener/);

  // El verde oficial de la marca, que es lo único que lo distingue del resto
  // de la lista.
  await expect(soporte).toHaveCSS("color", "rgb(37, 211, 102)");

  // El glifo del kit: chico, con `alt` vacío —la palabra está al lado— y
  // cargado de verdad, no un hueco.
  const logo = soporte.locator("img");
  await expect(logo).toHaveAttribute("src", /Digital_Glyph_Green_RGB_2026\.svg$/);
  await expect(logo).toHaveJSProperty("alt", "");
  expect(await logo.evaluate((i) => i.naturalWidth)).toBeGreaterThan(0);
});

test("la 404, servida desde una carpeta que no existe, se ve entera", async ({ page }) => {
  // Firebase entrega esta página para CUALQUIER dirección que no existe, y la
  // dirección puede tener carpetas inventadas. Si algo de la página fuera
  // relativo, el navegador lo buscaría dentro de esa carpeta: la hoja no
  // llegaría, el logo quedaría en un hueco y las salidas no llevarían a nada.
  // Por eso se prueba servida desde el fondo, no desde `/404.html`.
  const cuerpo = readFileSync("public/404.html", "utf8");
  await page.route("**/carpeta/inventada/pagina", (r) =>
    r.fulfill({ status: 404, contentType: "text/html; charset=utf-8", body: cuerpo }),
  );

  await page.setViewportSize(MOVIL);
  await page.goto("/carpeta/inventada/pagina");

  await expect(page.locator("h1")).toHaveText("Esta carta no está en el mazo");
  // La moneda de la barra llegó: la hoja y las imágenes también salen de la raíz.
  const moneda = page.locator(".marca-moneda");
  expect(await moneda.evaluate((i) => i.naturalWidth)).toBeGreaterThan(0);

  // Las dos salidas, y el soporte en el cajón.
  await expect(page.locator('a.accion[href="/dashboard.html"]')).toBeVisible();
  await expect(page.locator('a.accion[href="/lobby.html"]')).toBeVisible();
  await page.locator("#btnMenu").click();
  await expect(page.locator('#cajonMenu nav a.enlace-soporte')).toHaveAttribute(
    "href",
    "https://wa.me/59891900968?text=Hola%2C%20necesito%20ayuda%20con%20Memorie%20Legends.%20Mi%20consulta%20es%3A",
  );
});

test("una página legal lleva el mismo cajón, y el soporte NO se ve en la barra", async ({ page }) => {
  // Las legales tenían su propia cabecera: una fila de enlaces siempre a la
  // vista. Ahí el soporte por WhatsApp quedaba expuesto en todas las páginas
  // del sitio que más se comparten. Ahora llevan la barra de siempre y el
  // soporte vive dentro del cajón, como en el resto.
  await page.setViewportSize(MOVIL);
  await page.goto("/terminos.html");
  await page.waitForSelector("#btnMenu");

  // Cerrado: no hay ni un enlace del menú a la vista.
  await expect(page.locator("header a.enlace-soporte")).toHaveCount(0);
  await expect(page.locator(".barra-contenido nav")).toHaveCount(0);
  await expect(page.locator("header")).not.toContainText("Soporte WhatsApp");

  // Abierto: el soporte está adentro, en verde y con su número.
  await page.locator("#btnMenu").click();
  const soporte = page.locator("#cajonMenu nav a.enlace-soporte");
  await expect(soporte).toBeVisible();
  await expect(soporte).toHaveAttribute("href", "https://wa.me/59891900968?text=Hola%2C%20necesito%20ayuda%20con%20Memorie%20Legends.%20Mi%20consulta%20es%3A");
  await expect(soporte).toHaveCSS("color", "rgb(37, 211, 102)");

  // Y el cuerpo sigue siendo el de la columna de lectura: 360 px en un
  // teléfono de 390, que es lo que medía antes de tocarle la cabecera.
  const columna = page.locator(".legal-container");
  expect(Math.round((await columna.boundingBox()).width)).toBe(360);
});
