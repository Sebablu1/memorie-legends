/**
 * La marca del sitio: la moneda y el nombre en la barra, y el escudo.
 *
 * Lo que se mira acá es lo que sólo se ve con un navegador de verdad: qué
 * archivo ELIGE para cada pantalla, cuánto ocupa el nombre en cada ancho, y si
 * se mueve cuando llega la tipografía. Que los archivos existan y que el HTML
 * sea el mismo en todas las páginas lo mira `pruebas/sitio.mjs`.
 */

import { test, expect } from "@playwright/test";

const SESION_FALSA = `
  export const COLECCION = "users";
  export const CAMPO_SALDO = "credits";
  export async function exigirSesion() {
    return {
      usuario: { uid: "uid-de-prueba", photoURL: null },
      perfil: { uid: "uid-de-prueba", nombre: "Probador", saldo: 500,
                partidas: 3, victorias: 1 },
    };
  }
  export function mostrarSaldo() {}
  export function conectarBotonSalir() {}
  export function formatearEspera() { return "listo"; }
`;

test.describe("en el teléfono con el que mide PageSpeed", () => {
  // Moto G Power: 412 px de ancho y 1,75 píxeles físicos por cada uno.
  test.use({ viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75 });

  test("la portada baja el escudo de 320, y lo baja una sola vez", async ({ page }) => {
    // El escudo se dibuja a 180 px: por 1,75 son 315 píxeles físicos, y el
    // más chico que alcanza es el de 320. Uno más grande es peso de más en el
    // LCP; uno más chico, un escudo borroso.
    //
    // Y UNA vez: si la precarga y la imagen no pidieran lo mismo, bajarían
    // dos archivos distintos.
    const pedidos = [];
    page.on("request", (r) => {
      if (/\/img\/escudo-/.test(r.url())) pedidos.push(r.url().split("/").pop());
    });

    await page.goto("/index.html");
    await page.waitForFunction(() => {
      const img = document.querySelector(".portada-logo");
      return img.complete && img.naturalWidth > 0;
    });

    const elegido = await page.locator(".portada-logo").evaluate((img) => img.currentSrc.split("/").pop());
    expect(elegido, "el navegador eligió otro tamaño de escudo").toBe("escudo-320.webp");
    expect(pedidos, "el escudo se pidió más de una vez, o se pidió otro").toEqual(["escudo-320.webp"]);
  });
});

test("con saldo en la barra, el nombre entra entero en todo ancho de teléfono", async ({ page }) => {
  /**
   * La barra más cargada del sitio: moneda, nombre, saldo, avatar y menú.
   *
   * En Cinzel y en mayúsculas el nombre no entra en un renglón en un
   * teléfono, así que se apila —MEMORIE arriba, LEGENDS abajo—. Lo que se
   * comprueba es que así entre SIEMPRE, con un saldo de seis cifras, sin pisar
   * el saldo, sin salirse de la pantalla y sin recortarse: antes, el último
   * recurso eran los puntos suspensivos.
   */
  await page.route("**/js/sesion.js", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: SESION_FALSA }),
  );
  await page.goto("/dashboard.html");
  await page.waitForSelector(".barra .marca-texto");
  await page.evaluate(() => document.fonts.ready);

  for (const ancho of [480, 430, 412, 393, 375, 360, 344, 320]) {
    await page.setViewportSize({ width: ancho, height: 780 });
    await page.waitForTimeout(100);

    const m = await page.evaluate(() => {
      document.getElementById("saldoValor").textContent = "999.999";
      const texto = document.querySelector(".barra .marca-texto");
      const r = texto.getBoundingClientRect();
      const saldo = document.getElementById("saldo").getBoundingClientRect();
      return {
        texto: texto.textContent.trim(),
        apilado: getComputedStyle(texto).flexDirection === "column",
        dentro: r.left >= 0 && r.right <= document.documentElement.clientWidth,
        pisaElSaldo: r.right > saldo.left,
        recortado: texto.scrollWidth > texto.clientWidth + 1,
        desborda: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });

    expect(m.texto, `a ${ancho}px el nombre cambió`).toBe("Memorie Legends");
    expect(m.apilado, `a ${ancho}px el nombre no se apiló`).toBe(true);
    expect(m.dentro, `a ${ancho}px el nombre queda fuera de la pantalla`).toBe(true);
    expect(m.pisaElSaldo, `a ${ancho}px el nombre pisa el saldo`).toBe(false);
    expect(m.recortado, `a ${ancho}px el nombre se recorta`).toBe(false);
    expect(m.desborda, `a ${ancho}px la página se mueve de costado`).toBe(false);
  }
});

test("sin saldo, en la portada, el nombre va en un solo renglón hasta 320 px", async ({ page }) => {
  // Apilar es para cuando no hay lugar. En la portada lo hay: apilado ahí
  // sería un logotipo distinto sin necesidad.
  await page.goto("/index.html");
  await page.evaluate(() => document.fonts.ready);

  for (const ancho of [430, 375, 360, 320]) {
    await page.setViewportSize({ width: ancho, height: 780 });
    await page.waitForTimeout(100);
    const m = await page.evaluate(() => {
      const texto = document.querySelector(".barra .marca-texto");
      const r = texto.getBoundingClientRect();
      const menu = document.querySelector(".barra .hamburguesa")?.getBoundingClientRect();
      return {
        apilado: getComputedStyle(texto).flexDirection === "column",
        renglones: Math.round(r.height / parseFloat(getComputedStyle(texto).lineHeight)),
        pisaElMenu: menu ? r.right > menu.left : false,
      };
    });
    expect(m.apilado, `a ${ancho}px el nombre se apiló sin necesidad`).toBe(false);
    expect(m.renglones, `a ${ancho}px el nombre ocupa más de un renglón`).toBe(1);
    expect(m.pisaElMenu, `a ${ancho}px el nombre pisa el menú`).toBe(false);
  }
});

test("el nombre no cambia de ancho cuando llega Cinzel", async ({ page }) => {
  /**
   * Mientras baja la tipografía, el nombre se dibuja con «Cinzel respaldo»:
   * Georgia con las medidas corregidas para ocupar lo mismo. Si no ocupara lo
   * mismo, al llegar Cinzel el nombre crecería o se achicaría, y en la barra
   * angosta empujaría lo de al lado.
   *
   * Se mide dos veces la misma página: una con la tipografía bloqueada —queda
   * el respaldo— y otra con la tipografía.
   */
  await page.setViewportSize({ width: 1280, height: 800 });
  const ancho = () =>
    page.evaluate(() => document.querySelector(".barra .marca-texto").getBoundingClientRect().width);
  const estadoDeCinzel = () =>
    page.evaluate(() => [...document.fonts].find((f) => f.family.replaceAll('"', "") === "Cinzel")?.status);

  await page.route("**/fonts/cinzel-*.woff2", (r) => r.abort());
  await page.goto("/index.html");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  expect(await estadoDeCinzel(), "la prueba necesita ver el respaldo").toBe("error");
  const conRespaldo = await ancho();

  await page.unroute("**/fonts/cinzel-*.woff2");
  await page.reload();
  await page.evaluate(() => document.fonts.load('700 16px "Cinzel"'));
  await page.evaluate(() => document.fonts.ready);
  expect(await estadoDeCinzel(), "Cinzel no cargó").toBe("loaded");
  const conCinzel = await ancho();

  const diferencia = Math.abs(conCinzel - conRespaldo) / conCinzel;
  expect(
    diferencia,
    `con el respaldo mide ${conRespaldo.toFixed(1)} y con Cinzel ${conCinzel.toFixed(1)}`,
  ).toBeLessThan(0.02);
});
