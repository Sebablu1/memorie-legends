/**
 * El doble toque para descartar, también en iPhone.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL FALLO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Descartar pide dos toques, y el segundo se reconocía con `evento.detail === 2`
 * — el contador de clics del navegador. En PC y en Android cuenta bien. En iOS
 * NO: Safari sintetiza cada toque como un clic con `detail: 1`, así que el 2 no
 * llegaba nunca y el descarte no se disparaba jamás desde un iPhone.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CÓMO SE PRUEBA SIN UN IPHONE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * No alcanza con emular un móvil: Chromium sí cuenta los toques, así que la
 * emulación pasaría con el código roto. Lo que se hace es despachar los clics A
 * MANO con `detail: 1`, que es exactamente lo que manda Safari. Si el código
 * depende del contador del navegador, esto falla; si tiene su propia cuenta,
 * pasa.
 *
 * Se comprueban las dos direcciones, porque las dos rompen el juego:
 *
 *   - que DOS toques descarten (si no, iPhone no puede jugar);
 *   - que TRES toques descarten UNA sola vez (si no, el jugador se come dos
 *     cartas de castigo por apurarse, que es peor que no poder descartar).
 */

import { test, expect } from "@playwright/test";
import { abrirMesa, elegirCartaParaMirar, esperarReloj, misCartas, SEL } from "./mesa.js";

/**
 * Toca una carta como lo haría iOS: un `click` con `detail: 1`.
 *
 * `dispatchEvent` y no `locator.click()`: Playwright manda clics de verdad, y
 * el navegador les pone el `detail` que corresponde —2 al segundo—, que es
 * justo lo que iOS NO hace. Para reproducir el iPhone hay que fabricar el
 * evento.
 */
async function toqueDeIphone(page, indiceJugador, posicion) {
  await page.evaluate(
    ({ j, p }) => {
      const carta = document.querySelector(
        `.jugador[data-jugador="${j}"] .carta[data-posicion="${p}"]`,
      );
      if (!carta) throw new Error(`no hay carta en ${j}:${p}`);
      carta.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
      );
    },
    { j: indiceJugador, p: posicion },
  );
}

/** Cuántas cartas me quedan en la mano. */
const cuantasTengo = (page) => misCartas(page).count();

test("dos toques con detail:1 —como iOS— descartan", async ({ page }) => {
  const errores = await abrirMesa(page);
  await elegirCartaParaMirar(page);

  // La ventana de reflejos de la ronda: es cuando se puede descartar.
  await esperarReloj(page, /Descarte/i, { timeout: 30_000 });

  const antes = await cuantasTengo(page);
  expect(antes, "la mano tendría que arrancar con cuatro").toBe(4);

  // Un solo toque NO descarta: un roce accidental no puede costar una carta.
  await toqueDeIphone(page, 0, 1);
  await page.waitForTimeout(150);
  expect(await cuantasTengo(page), "un solo toque descartó").toBe(antes);
  await expect(page.locator(SEL.pista)).toContainText(/dos veces/i);

  // El segundo, sí.
  await toqueDeIphone(page, 0, 1);
  await page.waitForTimeout(600);

  // Descartar acierta o falla —depende de la carta— pero en los dos casos la
  // mano CAMBIA: al acertar se va la carta, al fallar entra una de castigo.
  // Lo que no puede pasar es que no ocurra nada, que era el fallo en iPhone.
  const despues = await cuantasTengo(page);
  const pista = await page.locator(SEL.pista).innerText();
  expect(
    despues !== antes || /acert|falla|castigo|descart/i.test(pista),
    `el segundo toque no hizo nada: la mano sigue en ${despues} y la pista dice "${pista}"`,
  ).toBe(true);

  expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

test("tres toques seguidos descartan UNA vez, no dos", async ({ page }) => {
  // Ésta es la que protege el bolsillo del jugador. Con una detección ingenua
  // —"cualquier toque después del primero"— una ráfaga de tres dispara dos
  // intentos, y cada intento fallido cuesta una carta de castigo.
  const errores = await abrirMesa(page);
  await elegirCartaParaMirar(page);
  await esperarReloj(page, /Descarte/i, { timeout: 30_000 });

  const antes = await cuantasTengo(page);

  // Tres toques rápidos, todos con detail:1.
  await toqueDeIphone(page, 0, 1);
  await toqueDeIphone(page, 0, 1);
  await toqueDeIphone(page, 0, 1);
  await page.waitForTimeout(900);

  const despues = await cuantasTengo(page);

  // Un intento cambia la mano en UNO: se va la carta acertada, o entra una de
  // castigo. Dos intentos la cambiarían en dos.
  expect(
    Math.abs(despues - antes),
    `la mano cambió en ${Math.abs(despues - antes)}: la ráfaga disparó más de un intento`,
  ).toBeLessThanOrEqual(1);

  expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

test("dos toques en cartas DISTINTAS no son un doble toque", async ({ page }) => {
  // Tocar una carta y enseguida otra es mirar dos, no descartar. Si la cuenta
  // no mirara CUÁL carta se tocó, el segundo toque descartaría la segunda
  // carta sin que nadie lo haya pedido.
  const errores = await abrirMesa(page);
  await elegirCartaParaMirar(page);
  await esperarReloj(page, /Descarte/i, { timeout: 30_000 });

  const antes = await cuantasTengo(page);

  await toqueDeIphone(page, 0, 1);
  await toqueDeIphone(page, 0, 2);
  await page.waitForTimeout(600);

  expect(
    await cuantasTengo(page),
    "tocar dos cartas distintas descartó una",
  ).toBe(antes);

  expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

test("las cartas no se comen el doble toque con el zoom de iOS", async ({ page }) => {
  // `touch-action: manipulation` es la otra mitad del arreglo. Sin él, en iOS
  // el doble toque sobre una carta es el gesto de ZOOM: Safari se lo queda y el
  // segundo toque no llega nunca como clic, por más que el JavaScript sepa
  // contarlos.
  await abrirMesa(page);
  await elegirCartaParaMirar(page);
  await esperarReloj(page, /Descarte/i, { timeout: 30_000 });

  const valor = await page
    .locator('.jugador[data-jugador="0"] .carta[data-posicion="1"]')
    .evaluate((el) => getComputedStyle(el).touchAction);

  expect(
    valor,
    "sin `manipulation`, iOS se queda el segundo toque para hacer zoom",
  ).toContain("manipulation");
});
