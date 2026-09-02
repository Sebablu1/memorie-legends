/**
 * Tirar y cambiar reabren los reflejos, y esa ventana dura 2 segundos.
 *
 * Es la regla nueva y la que más piezas movió: el motor, el orquestador de red
 * y el cliente. Las suites de `pruebas/` cubren las dos primeras; lo que sólo
 * se puede ver acá es que el navegador ENCADENE bien —tirar, esperar la
 * ventana, y recién entonces devolver el turno— sin quedarse colgado.
 *
 * NADA ACÁ SUPONE QUÉ CARTA SALE. La semilla fija el reparto, pero las IA
 * reaccionan con retrasos aleatorios: si alguna descarta durante una ventana,
 * el mazo se corre y la carta que me toca es otra. Suponer que la levantada no
 * traía poder hacía fallar una prueba distinta en cada corrida.
 */

import { test, expect } from "@playwright/test";
import {
  SEL, abrirMesa, elegirCartaParaMirar, esperarPista, esperarReloj,
  esperarMiTurno, segundosDelReloj, numeroDeLaMuestra, tirarLaLevantada,
  llegarADecidirCorte,
} from "./mesa.js";

test("tirar cambia la muestra y abre una ventana de 2 segundos", async ({ page }) => {
  const errores = await abrirMesa(page);
  await elegirCartaParaMirar(page);
  await esperarMiTurno(page);

  await page.locator(SEL.levantar).click();
  await esperarPista(page, /cambiarla|poder/i);

  const muestraAntes = await numeroDeLaMuestra(page);
  await tirarLaLevantada(page);

  await esperarReloj(page, /Descarte/i);
  const segundos = await segundosDelReloj(page);
  expect(segundos, "una reapertura dura 2 s, no los 5 de la ronda").toBeLessThanOrEqual(2);
  expect(segundos).toBeGreaterThan(0);

  // Y la carta tirada quedó de muestra: eso es lo que les da algo a lo que
  // reaccionar a los demás. Sin esto la ventana no serviría para nada.
  expect(await numeroDeLaMuestra(page)).not.toBe(muestraAntes);

  expect(errores).toEqual([]);
});

test("cerrada la ventana, el turno vuelve al que tiró", async ({ page }) => {
  // El riesgo real de reabrir era que la ventana le robara el turno al que
  // tiró y lo pasara al siguiente. `volverA` existe para impedirlo; esto
  // comprueba que llega hasta la interfaz.
  const errores = await abrirMesa(page);
  await elegirCartaParaMirar(page);
  await esperarMiTurno(page);

  await page.locator(SEL.levantar).click();
  await esperarPista(page, /cambiarla|poder/i);
  await tirarLaLevantada(page);
  await esperarReloj(page, /Descarte/i);

  // Si lo tirado era un poder, entre la ventana y la decisión de cortar se
  // mete la elección del poder. Es la regla nueva, no un estorbo.
  expect(await llegarADecidirCorte(page), "se llega a poder cortar").toBe(true);
  await expect(page.locator(SEL.pasar)).toBeEnabled();
  await expect(page.locator(SEL.levantar)).toBeDisabled();

  expect(errores).toEqual([]);
});

test("cambiar una carta propia también abre la ventana", async ({ page }) => {
  // Cambiar no reabría, con el argumento de que la muestra no cambiaba. Era
  // falso: la carta que sale de la mano queda arriba del descarte.
  const errores = await abrirMesa(page);
  await elegirCartaParaMirar(page);
  await esperarMiTurno(page);

  await page.locator(SEL.levantar).click();
  await esperarPista(page, /cambiarla|poder/i);

  const muestraAntes = await numeroDeLaMuestra(page);

  // Si la levantada trajo poder hay un modal encima; la salida al reglamento
  // es justamente cambiarla por una propia.
  const cambiarDesdeModal = page.locator('[data-accion="cambiar-poder"]');
  if (await cambiarDesdeModal.isVisible().catch(() => false)) {
    await cambiarDesdeModal.click();
  }

  await page.locator(`${SEL.miMano} .carta`).first().click();

  await esperarReloj(page, /Descarte/i);
  const segundos = await segundosDelReloj(page);
  expect(segundos, "también dura 2 s").toBeLessThanOrEqual(2);
  expect(await numeroDeLaMuestra(page)).not.toBe(muestraAntes);

  expect(errores).toEqual([]);
});
