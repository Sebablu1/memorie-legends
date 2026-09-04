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
 *   3. Que al volver a pantalla grande el menú vuelva a la barra. Girar el
 *      teléfono no puede dejar la barra vacía.
 */

import { test, expect } from "@playwright/test";

const SESION_FALSA = `
  export const COLECCION="users"; export const CAMPO_SALDO="credits";
  export async function exigirSesion(){return{usuario:{uid:"u1",photoURL:null},
    perfil:{uid:"u1",nombre:"Probador",saldo:500,partidas:3,victorias:1,ultimoGiro:0,ultimoBono:0}};}
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

test("en pantalla grande manda la barra; el hamburguesa se esconde", async ({
  page,
}) => {
  await abrirTablero(page, ESCRITORIO);

  await expect(page.locator(".barra-contenido nav")).toBeVisible();
  await expect(page.locator(".barra-contenido .derecha")).toBeVisible();
  await expect(page.locator("#btnMenu")).toBeHidden();
});

test("girar el teléfono devuelve el menú a la barra, sin perderlo", async ({
  page,
}) => {
  await abrirTablero(page);

  // Se marca el nodo para poder reconocerlo después. Si en vez de mudarse se
  // copiara, la marca no viajaría y esto lo delata.
  await page.evaluate(() => {
    document.querySelector("#cajonMenu nav").dataset.marca = "el-mismo";
  });

  await page.setViewportSize(ESCRITORIO);
  await expect(
    page.locator('.barra-contenido nav[data-marca="el-mismo"]'),
  ).toBeVisible();

  // Y de vuelta.
  await page.setViewportSize(MOVIL);
  await expect(page.locator('#cajonMenu nav[data-marca="el-mismo"]')).toHaveCount(1);
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
