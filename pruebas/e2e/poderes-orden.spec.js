/**
 * En la ventana del 9 y del 10, TUS CARTAS ARRIBA y los rivales abajo.
 *
 * Son las dos únicas ventanas que muestran las dos cosas: el 7 muestra sólo
 * tus cartas y el 8 sólo las de los rivales.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ESTO ESTABA AL REVÉS, Y ESTA PRUEBA LO SOSTENÍA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Primero fue el orden de los asientos, que dejaba tus cartas arriba por
 * casualidad —sos el asiento 0 en el entrenamiento—. Se cambió a propósito
 * para que no dependiera del asiento, y se eligió rivales arriba.
 *
 * En un teléfono con cuatro jugadores, «abajo» resultó ser «fuera de la
 * pantalla»: la ventana pedía hasta 298 px de scroll interno y lo que quedaba
 * abajo del corte era justamente tu mano. Y el 9 y el 10 piden elegir PRIMERO
 * una carta tuya —«Elegí una carta tuya y una de un rival»—, así que lo
 * primero que nombra la instrucción era lo único que no se veía.
 *
 * El orden sigue sin depender del asiento, que era lo que importaba de la
 * decisión anterior. Lo que cambió es cuál va primero.
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
  test(`el ${numero}: tus cartas arriba y los rivales abajo`, async ({ page }) => {
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

    expect(titulos.at(0), "tus cartas no quedaron arriba de todo").toBe("Tus cartas");
    expect(titulos.slice(1), "abajo tiene que haber sólo rivales").not.toContain("Tus cartas");
    expect(titulos.length, "faltan rivales en la ventana").toBeGreaterThan(1);
    expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
  });
}
