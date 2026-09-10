/**
 * La mesa abre YA vestida, sin el salto.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL SALTO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Traducir «qué tengo puesto» a imágenes son tres lecturas de Firestore: el
 * perfil, y el artículo de cada tipo. La mesa no las espera —hacerlo dejaría
 * la pantalla en blanco por una decoración— así que se dibujaba con las caras
 * y los dorsos de la casa, y medio segundo más tarde le cambiaban abajo de la
 * mano.
 *
 * Ahora el navegador recuerda lo último que supo, en `localStorage`, y la mesa
 * se viste con eso ANTES del primer dibujo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CÓMO SE PRUEBA QUE FUE EL CACHÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Con un `equipadoEnMesa` que NUNCA contesta.
 *
 * Si la mesa igual aparece vestida, la única explicación posible es el caché:
 * la lectura del servidor sigue colgada. Con un doble que contestara rápido no
 * se podría distinguir «se vistió de entrada» de «se vistió enseguida», que es
 * justamente la diferencia que esta suite mide.
 */

import { test, expect } from "@playwright/test";

const js = (body) => ({ status: 200, contentType: "text/javascript; charset=utf-8", body });

/** Cuatro artículos que existen de verdad, y los cuatro distintos entre sí. */
const PUESTO = {
  retrato: "/img/avatar/el_dragon.webp",
  dorso: "/img/dorsos/dorso-rojo.png",
  mazo: "/img/mazos/esmeralda.svg",
  pano: "/img/mesa/panos/madera.svg",
};

const UID = "jugador-de-prueba";

/**
 * Abre la mesa de entrenamiento con el caché ya escrito.
 *
 * `addInitScript` corre ANTES de cualquier script de la página, que es la
 * única forma de que el caché exista cuando `mesa.js` lo lee — lo lee al
 * evaluarse el módulo, no en un evento posterior.
 */
async function abrirConCache(page, vestuario) {
  await page.addInitScript(
    ([uid, v]) => {
      try {
        localStorage.setItem("vestuario", JSON.stringify({ uid, ...v }));
      } catch {
        // Si el navegador no deja escribir, la prueba va a fallar sola y con
        // un mensaje claro: la mesa aparecerá sin vestir.
      }
    },
    [UID, vestuario],
  );

  // `equipadoEnMesa` se queda colgado para siempre: lo que se vea en la mesa
  // sólo puede venir del caché.
  await page.route("**/js/guardia-sesion.js", (r) =>
    r.fulfill(js(`
      export async function exigirSesionEnMesa() {
        return { uid: ${JSON.stringify(UID)}, email: "prueba@example.com" };
      }
      export function equipadoEnMesa() {
        return new Promise(() => {});
      }
    `)));

  await page.goto("/mesa.html?semilla=4242");
  await page.waitForSelector(".jugador.propio .carta");
}

const rutaDe = (page, sel) =>
  page.$eval(sel, (el) => new URL(el.getAttribute("src"), location.href).pathname);

// =====================================================================

test("con el caché puesto, la mesa abre vestida aunque el servidor no conteste", async ({ page }) => {
  await abrirConCache(page, PUESTO);

  const mias = await rutaDe(page, ".jugador.propio .carta .dorso img");
  expect(mias, "mis cartas no salieron con mi dorso").toBe(PUESTO.dorso);

  const mazo = await rutaDe(page, "#mazoCarta .carta .dorso img");
  expect(mazo, "la pila del centro no salió con el mazo comprado").toBe(PUESTO.mazo);

  const cara = await rutaDe(page, ".jugador.propio .retrato .cara img");
  expect(cara, "mi asiento no salió con mi avatar").toBe(PUESTO.retrato);

  const pano = await page.evaluate(() =>
    getComputedStyle(document.querySelector(".mesa")).getPropertyValue("--pano"));
  expect(pano, "el paño comprado no se encendió").toContain(PUESTO.pano);
});

test("sin caché, la mesa abre con lo de la casa y no se rompe", async ({ page }) => {
  /**
   * El primer día de un jugador, o el primer día en ESE navegador. No hay nada
   * que recordar y tampoco hay salto: quien no compró nada no tiene nada que
   * ver aparecer.
   */
  await page.route("**/js/guardia-sesion.js", (r) =>
    r.fulfill(js(`
      export async function exigirSesionEnMesa() {
        return { uid: ${JSON.stringify(UID)}, email: "prueba@example.com" };
      }
      export function equipadoEnMesa() { return new Promise(() => {}); }
    `)));

  await page.goto("/mesa.html?semilla=4242");
  await page.waitForSelector(".jugador.propio .carta");

  const mazo = await rutaDe(page, "#mazoCarta .carta .dorso img");
  expect(mazo, "sin caché la pila tiene que salir con el dorso de siempre")
    .toBe("/img/dorsos/dorso-azul.png");
});

test("el caché de OTRA cuenta no se usa", async ({ page }) => {
  /**
   * Dos cuentas en el mismo navegador —el que prueba con la suya y con la del
   * hermano— comparten `localStorage`. Sin el uid adentro, el segundo abriría
   * la mesa con las cosas del primero.
   */
  await page.addInitScript((v) => {
    try {
      localStorage.setItem("vestuario", JSON.stringify({ uid: "otro-jugador", ...v }));
    } catch {
      /* ver la nota de arriba */
    }
  }, PUESTO);

  await page.route("**/js/guardia-sesion.js", (r) =>
    r.fulfill(js(`
      export async function exigirSesionEnMesa() {
        return { uid: ${JSON.stringify(UID)}, email: "prueba@example.com" };
      }
      export function equipadoEnMesa() { return new Promise(() => {}); }
    `)));

  await page.goto("/mesa.html?semilla=4242");
  await page.waitForSelector(".jugador.propio .carta");

  const mazo = await rutaDe(page, "#mazoCarta .carta .dorso img");
  expect(mazo, "se usó el vestuario de otra cuenta").toBe("/img/dorsos/dorso-azul.png");
});

test("una ruta de otro dominio en el caché no llega a la mesa", async ({ page }) => {
  /**
   * `localStorage` lo escribe cualquiera que abra la consola del navegador. Si
   * la mesa se fiara, bastaría con poner ahí una URL ajena para que los cuatro
   * navegadores le pidieran la imagen a ese servidor.
   *
   * Por eso el caché pasa por `esRutaDelSitio` igual que todo lo demás.
   */
  await abrirConCache(page, {
    ...PUESTO,
    dorso: "https://ejemplo.test/dorso.png",
    mazo: "//ejemplo.test/mazo.png",
  });

  const mias = await rutaDe(page, ".jugador.propio .carta .dorso img");
  expect(mias, "entró una URL de otro dominio").not.toContain("ejemplo.test");

  const mazo = await rutaDe(page, "#mazoCarta .carta .dorso img");
  expect(mazo, "entró una URL de protocolo relativo").toBe("/img/dorsos/dorso-azul.png");

  // Y lo que sí era del sitio se aplicó igual: una ruta mala no arrastra a las
  // demás.
  const cara = await rutaDe(page, ".jugador.propio .retrato .cara img");
  expect(cara).toBe(PUESTO.retrato);
});
