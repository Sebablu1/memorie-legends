/**
 * En la ventana del 9 y del 10, los rivales arriba y tus cartas abajo.
 *
 * Son las dos únicas ventanas que muestran las dos cosas: el 7 muestra sólo
 * tus cartas y el 8 sólo las de los rivales. Antes seguían el orden de los
 * asientos y tus cartas —asiento 0 en el entrenamiento— quedaban arriba.
 *
 * Esta ventana es sólo del entrenamiento: en red, el objetivo del poder se
 * elige tocando las cartas sobre la mesa, sin ventana.
 *
 * Para llegar a un 9 o a un 10 sin jugar rondas hasta que salga, cada prueba
 * usa una semilla con la que la primera carta que levantás es ese poder. Si
 * algún día cambia el barajado, la prueba lo dice con todas las letras —«la
 * semilla ya no da un 9»— en vez de fallar por otra cosa; para encontrar otra
 * alcanza con probar semillas con el motor, levantando la primera carta.
 */

import { test, expect } from "@playwright/test";
import { abrirMesa, elegirCartaParaMirar, esperarMiTurno, SEL } from "./mesa.js";

for (const [numero, semilla] of [[9, 4], [10, 23]]) {
  test(`el ${numero}: los rivales arriba y tus cartas abajo`, async ({ page }) => {
    const errores = await abrirMesa(page, { semilla });
    await elegirCartaParaMirar(page);
    await esperarMiTurno(page);
    await page.locator(SEL.levantar).click();

    const titulo = page.locator(`${SEL.modal} h2`);
    await expect(titulo, `la semilla ${semilla} ya no da un ${numero}`).toContainText(`PODER ${numero}`, {
      timeout: 10_000,
    });
    await page.locator('[data-accion="usar-poder"]').click();

    // Antes de elegir el objetivo corre la ventana de reflejos de la carta
    // tirada: la lista aparece cuando termina.
    const grupos = page.locator(".objetivos .grupo-objetivo .titulo");
    await expect(grupos.first()).toBeVisible({ timeout: 20_000 });
    const titulos = await grupos.allTextContents();

    expect(titulos.at(-1), "tus cartas no quedaron abajo").toBe("Tus cartas");
    expect(titulos.slice(0, -1), "arriba tiene que haber sólo rivales").not.toContain("Tus cartas");
    expect(titulos.length, "faltan rivales en la ventana").toBeGreaterThan(1);
    expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
  });
}
