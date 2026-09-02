/**
 * Los carteles de la mesa, y el paso automático.
 *
 * LOS CARTELES
 *
 * Antes, el cartel que flota sobre el paño repetía la frase que había escrito
 * el motor: "Vos miró las dos cartas y NO cambió". En medio de una mano nadie
 * lee una frase. Ahora son un ícono y una palabra.
 *
 * Lo que se comprueba NO es que diga tal o cual texto —eso se cambia mañana y
 * la prueba se pondría roja sin que nada esté mal— sino la propiedad que se
 * pidió: que sea CORTO. Se mide en palabras, contra el número que sea, y así
 * la prueba sigue valiendo si el texto se reescribe.
 *
 * EL PASO AUTOMÁTICO
 *
 * `postLevantada` era la única fase sin reloj en la que la mesa entera espera
 * a una sola persona. Acá se prueba en entrenamiento, que es donde la cuenta
 * la lleva el navegador; la del servidor la cubre `pruebas/paso-automatico.mjs`,
 * porque para eso hace falta un reloj que se pueda adelantar a mano.
 */

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  SEL, abrirMesa, elegirCartaParaMirar, esperarMiTurno,
  tirarLaLevantada, llegarADecidirCorte,
} from "./mesa.js";
import { MS_PASO_AUTOMATICO } from "../../public/js/reglas/motor.js";

const CARTEL = ".cartel-corto";

/**
 * Las palabras de un cartel.
 *
 * Se cuentan sobre el `<b>`, no sobre el cartel entero: `innerText` mete el
 * ícono como una línea más y "🃏 / Tu turno" daba tres, acusando de larga a
 * una etiqueta de dos palabras. El ícono no es una palabra — justamente por
 * eso está.
 */
const palabrasDe = (texto) => texto.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);

test("el cartel de mi turno aparece, es corto y se distingue", async ({ page }) => {
  const errores = await abrirMesa(page);
  await elegirCartaParaMirar(page);
  await esperarMiTurno(page);

  // El cartel de "te toca" sale en cuanto la mesa me pasa el turno. Se busca
  // por la clase `tuyo`, que es lo que lo separa de los avisos de lo que
  // hicieron los demás: el dorado es información, no decoración.
  const mio = page.locator(`${CARTEL}.tuyo`);
  await expect(mio.first()).toBeVisible({ timeout: 70_000 });

  const texto = await mio.first().locator("b").innerText();
  expect(palabrasDe(texto).length, `"${texto}" tiene demasiadas palabras`).toBeLessThanOrEqual(2);

  // Y lleva un ícono, que es lo que se reconoce sin leer.
  await expect(mio.first().locator(".icono")).toHaveCount(1);

  // El ícono NO se anuncia: lo dice la palabra de al lado, y un lector de
  // pantalla que lea las dos cosas dice lo mismo dos veces.
  await expect(mio.first().locator(".icono")).toHaveAttribute("aria-hidden", "true");

  expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

test("ningún cartel flotante cuenta la jugada en una frase", async ({ page }) => {
  const errores = await abrirMesa(page);

  // Se juntan TODOS los carteles que aparezcan durante un turno entero, no
  // sólo el que esté en pantalla al final: duran un segundo, así que mirar una
  // sola vez es casi seguro no ver ninguno.
  const vistos = [];
  await page.exposeFunction("anotarCartel", (t) => vistos.push(t));
  await page.evaluate(() => {
    new MutationObserver((cambios) => {
      for (const c of cambios) {
        for (const n of c.addedNodes) {
          if (n.nodeType === 1 && n.classList?.contains("cartel-corto")) {
            window.anotarCartel(n.querySelector("b")?.textContent ?? n.innerText);
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });

  await elegirCartaParaMirar(page);
  await esperarMiTurno(page);
  await page.locator(SEL.levantar).click();
  await tirarLaLevantada(page);
  await llegarADecidirCorte(page);
  await page.locator(SEL.pasar).click();
  // Un rato más, para que las IA jueguen y salgan también sus carteles.
  await page.waitForTimeout(6000);

  expect(vistos.length, "no apareció ningún cartel en todo un turno").toBeGreaterThan(0);

  for (const texto of vistos) {
    const palabras = palabrasDe(texto);
    expect(palabras.length, `el cartel "${texto}" es una frase, no un aviso`).toBeLessThanOrEqual(2);
  }

  expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

test("el cartel viejo de frase larga ya no existe en el código", async ({ page }) => {
  // Contra el archivo y no contra el DOM. El cartel largo aparecía sólo en
  // ciertas jugadas, así que una prueba que mirara la pantalla podía pasar
  // simplemente por no haber llegado a dispararlo.
  // Rutas desde la raíz del proyecto: Playwright corre desde ahí. Con
  // `import.meta.url` no se puede, porque los specs se cargan como CommonJS.
  const mesa = readFileSync("public/js/mesa.js", "utf8");
  const ui = readFileSync("public/js/modulos/ui.js", "utf8");

  expect(mesa, "mesa.js sigue llamando al cartel de frase larga").not.toMatch(/anunciarMirada/);
  expect(ui, "ui.js sigue exportando el cartel de frase larga").not.toMatch(/anunciarMirada/);

  // Y nadie vuelve a meter el texto del registro en un cartel: era eso lo que
  // ataba lo que se ve flotando a cómo el motor redactó la línea.
  expect(mesa, "el texto del registro volvió a un cartel")
    .not.toMatch(/mostrarCartel\([^)]*\.texto/);

  await page.goto("/mesa.html");
  await expect(page.locator(".anuncio-mirada")).toHaveCount(0);
});

test("a los 30 segundos sin decidir, el turno pasa solo", async ({ page }) => {
  expect(MS_PASO_AUTOMATICO, "la cuenta la fija el motor").toBe(30000);

  const errores = await abrirMesa(page);
  await elegirCartaParaMirar(page);
  await esperarMiTurno(page);
  await page.locator(SEL.levantar).click();
  await tirarLaLevantada(page);

  const listo = await llegarADecidirCorte(page);
  expect(listo, "no se llegó a poder cortar").toBe(true);

  // Acá empieza la cuenta. No se toca nada: es exactamente lo que hace alguien
  // que se levantó de la silla con la pestaña abierta.
  await expect(page.locator(SEL.cortar)).toBeEnabled();

  // Antes de que venza, la decisión sigue siendo mía.
  await page.waitForTimeout(MS_PASO_AUTOMATICO / 2);
  await expect(page.locator(SEL.cortar), "pasó el turno antes de tiempo").toBeEnabled();

  // Y al cumplirse, la mesa sigue sola. Se espera a la pista y no a un
  // temporizador propio: el que manda es el reloj de la mesa, no el de acá.
  await expect(page.locator(SEL.pista)).toContainText(/tiempo/i, { timeout: 25_000 });
  await expect(page.locator(SEL.cortar), "el botón de cortar sigue vivo").toBeDisabled();

  expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

test("decidir a tiempo cancela la cuenta: no hay un pase fantasma", async ({ page }) => {
  const errores = await abrirMesa(page);
  await elegirCartaParaMirar(page);
  await esperarMiTurno(page);
  await page.locator(SEL.levantar).click();
  await tirarLaLevantada(page);
  await llegarADecidirCorte(page);

  await page.locator(SEL.pasar).click();

  // Pasado el plazo entero, la mesa no puede haber pasado un turno de nadie
  // por una cuenta que ya no correspondía. Si el temporizador no se cancelara,
  // acá aparecería el aviso de que se acabó el tiempo sobre el turno de otro.
  await page.waitForTimeout(MS_PASO_AUTOMATICO + 2000);
  await expect(page.locator(SEL.pista)).not.toContainText(/se acabó el tiempo para decidir/i);

  expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
});
