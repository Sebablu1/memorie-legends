/**
 * El botón de soporte que flota en el tablero.
 *
 * Lo que hay que defender es dónde está y de quién es el color:
 *
 *   1. Que esté en el tablero y en NINGUNA otra página. En el resto del sitio
 *      el soporte vive dentro del cajón del menú, que se abre cuando uno
 *      quiere; un botón fijo en cada página sería el número a la vista en
 *      todas, y tapando contenido en todas.
 *   2. Que siga fijo abajo a la derecha aunque la página se deslice: es un
 *      atajo, no una tarjeta más del tablero.
 *   3. Que el verde y el glifo blanco sean los de la marca, sin retocar.
 *   4. Que el cajón del menú lo tape, y no al revés.
 */

import { test, expect } from "@playwright/test";

const SESION_FALSA = `
  export const COLECCION="users"; export const CAMPO_SALDO="credits";
  export async function exigirSesion(){return{usuario:{uid:"u1",photoURL:null},
    perfil:{uid:"u1",nombre:"Probador",saldo:500,partidas:3,victorias:1}};}
  export function mostrarSaldo(){} export function conectarBotonSalir(){}
  export function formatearEspera(){return "listo";}`;

const MOVIL = { width: 390, height: 844 };
const ESCRITORIO = { width: 1280, height: 800 };

async function abrir(page, pagina = "/dashboard.html", tamano = MOVIL) {
  await page.setViewportSize(tamano);
  await page.route("**/js/sesion.js", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: SESION_FALSA }),
  );
  await page.goto(pagina);
  await page.waitForSelector("#btnMenu", { state: "attached", timeout: 10_000 });
}

test("está abajo a la derecha, con su número y su glifo blanco", async ({ page }) => {
  await abrir(page);

  const boton = page.locator("a.boton-soporte");
  await expect(boton).toBeVisible();
  await expect(boton).toHaveText(/Soporte WhatsApp/);
  await expect(boton).toHaveAttribute("href", "https://wa.me/59891900968?text=Hola%2C%20necesito%20ayuda%20con%20Memorie%20Legends.%20Mi%20consulta%20es%3A");
  await expect(boton).toHaveAttribute("target", "_blank");
  await expect(boton).toHaveAttribute("rel", /noopener/);

  // El verde de la marca, sin retoques.
  await expect(boton).toHaveCSS("background-color", "rgb(37, 211, 102)");
  await expect(boton).toHaveCSS("position", "fixed");

  // Abajo a la derecha: contra las dos esquinas, no en el medio.
  const caja = await boton.boundingBox();
  const pantalla = page.viewportSize();
  expect(pantalla.height - (caja.y + caja.height)).toBeLessThan(40);
  expect(pantalla.width - (caja.x + caja.width)).toBeLessThan(40);

  // El glifo blanco del kit, cargado de verdad y con `alt` vacío: la palabra
  // ya está al lado, y sus normas no dejan usar el dibujo en su lugar.
  const glifo = boton.locator("img");
  await expect(glifo).toHaveAttribute("src", /Digital_Glyph_White_RGB_2026\.svg$/);
  await expect(glifo).toHaveJSProperty("alt", "");
  expect(await glifo.evaluate((i) => i.naturalWidth)).toBeGreaterThan(0);
});

test("en el teléfono es sólo el glifo; en escritorio, la píldora entera", async ({ page }) => {
  // El texto no se saca del HTML: es el nombre del enlace para quien escucha
  // la página. Se esconde a la vista, y por eso se pregunta por lo que se ve
  // —el ancho del botón y si el texto ocupa lugar— y no por el `textContent`.
  await abrir(page);

  const boton = page.locator("a.boton-soporte");
  const enElTelefono = await boton.boundingBox();
  expect(Math.round(enElTelefono.width), "en el teléfono sale con el texto").toBe(56);
  expect(Math.round(enElTelefono.height)).toBe(56);

  // El nombre accesible sigue estando.
  await expect(boton).toHaveAccessibleName(/Soporte WhatsApp/);

  const texto = boton.locator("span", { hasText: "Soporte WhatsApp" });
  expect(await texto.evaluate((e) => e.getBoundingClientRect().width)).toBeLessThan(2);
  await expect(boton.locator(".flecha")).not.toBeInViewport();

  // El glifo, más grande que en la píldora: es lo único que queda.
  const glifo = boton.locator("img");
  expect(Math.round((await glifo.boundingBox()).width)).toBe(28);

  // En escritorio vuelven las tres partes.
  await page.setViewportSize(ESCRITORIO);
  await page.waitForTimeout(200);
  expect(await texto.evaluate((e) => e.getBoundingClientRect().width)).toBeGreaterThan(80);
  await expect(boton.locator(".flecha")).toBeVisible();
  expect(Math.round((await boton.boundingBox()).width)).toBeGreaterThan(150);
});

test("se queda quieto aunque el tablero se deslice", async ({ page }) => {
  await abrir(page);

  const boton = page.locator("a.boton-soporte");
  const antes = await boton.boundingBox();
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(200);
  const despues = await boton.boundingBox();

  expect(Math.round(despues.y), "el botón se fue con la página").toBe(Math.round(antes.y));
  await expect(boton).toBeInViewport();
});

test("el contenido respira: abajo del todo no tapa nada", async ({ page }) => {
  // Se mira la ÚLTIMA línea de la página —el copyright del pie— y no el final
  // de `main`: el pie viene después, y con el aire puesto en `main` el círculo
  // le caía justo encima.
  await abrir(page);

  await page.mouse.wheel(0, 20_000);
  await page.waitForTimeout(300);

  const ultima = page.locator("footer p").last();
  const fondo = await ultima.evaluate((e) => e.getBoundingClientRect().bottom);
  const boton = await page.locator("a.boton-soporte").evaluate((b) => b.getBoundingClientRect().top);
  expect(fondo, "el botón tapa el final de la página").toBeLessThan(boton);
});

test("el cajón del menú lo tapa, y no al revés", async ({ page }) => {
  await abrir(page);

  await page.locator("#btnMenu").click();
  await expect(page.locator("#cajonMenu")).toBeVisible();

  // El velo cubre la página entera; el botón queda por debajo. Se pregunta por
  // quién está arriba en el punto donde vive el botón.
  const encima = await page.evaluate(() => {
    const b = document.querySelector("a.boton-soporte").getBoundingClientRect();
    const arriba = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    return arriba?.classList.contains("boton-soporte") ?? false;
  });
  expect(encima, "el botón queda por encima del menú abierto").toBe(false);
});

test("en escritorio también está, y en el lobby no", async ({ page }) => {
  await abrir(page, "/dashboard.html", ESCRITORIO);
  await expect(page.locator("a.boton-soporte")).toBeVisible();

  // En el resto del sitio, el soporte es el del cajón y nada más.
  for (const pagina of ["/lobby.html", "/tienda.html", "/como-se-juega.html", "/terminos.html"]) {
    await page.goto(pagina);
    await expect(page.locator("a.boton-soporte"), `${pagina} tiene el botón flotante`).toHaveCount(0);
  }
});
