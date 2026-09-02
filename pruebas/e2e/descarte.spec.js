/**
 * El descarte con doble clic.
 *
 * POR QUÉ ESTA PRUEBA EXISTE
 *
 * Acá se rompieron dos cosas que las 23 suites de `pruebas/` no podían ver,
 * porque las dos vivían en el navegador y no en el motor:
 *
 *   - `clicEnCartaDeRed` se quedó sin uno de sus parámetros y tiraba un
 *     ReferenceError en CADA clic sobre una carta. El motor estaba perfecto.
 *   - Tres clics contaban como tres intentos, así que un jugador nervioso se
 *     comía tres cartas de castigo por un solo error.
 *
 * Las dos habrían saltado acá a la primera.
 */

import { test, expect } from "@playwright/test";
import {
  SEL, abrirMesa, elegirCartaParaMirar, esperarReloj, misCartas, segundosDelReloj,
} from "./mesa.js";

test("un clic solo no descarta; hacen falta dos", async ({ page }) => {
  const errores = await abrirMesa(page);
  await elegirCartaParaMirar(page);
  await esperarReloj(page, /Descarte/);

  const antes = await misCartas(page).count();

  // Un clic: la interfaz avisa que hacen falta dos y no toca la mano.
  await misCartas(page).first().click();
  await expect(page.locator(SEL.pista)).toContainText(/dos veces/i);
  expect(await misCartas(page).count()).toBe(antes);

  expect(errores).toEqual([]);
});

test("tres clics seguidos son UN intento, no tres", async ({ page }) => {
  // La regresión que esto vigila: con `>= 2` en vez de `=== 2`, el tercer clic
  // de un triple clic entra como un intento nuevo y el jugador recibe una
  // segunda carta de castigo por el mismo error.
  const errores = await abrirMesa(page);
  await elegirCartaParaMirar(page);
  await esperarReloj(page, /Descarte/);

  const antes = await misCartas(page).count();
  const carta = misCartas(page).first();

  // Triple clic nativo: el navegador manda detail 1, 2 y 3.
  await carta.click({ clickCount: 3, delay: 40 });
  await page.waitForTimeout(600);

  const despues = await misCartas(page).count();
  // O acertó (una carta menos) o se equivocó (una carta más). Nunca dos de
  // castigo: eso sería el triple clic contando como dos intentos.
  expect(Math.abs(despues - antes)).toBeLessThanOrEqual(1);

  expect(errores).toEqual([]);
});

test("la ventana de la ronda dura 5 segundos, no 2", async ({ page }) => {
  // La distinción importa: en la ventana de la ronda se viene de memorizar UNA
  // carta y hay que buscar en cuatro manos. Se unificó con las reaperturas en
  // 2 s y el juego quedó frenético, así que se volvió atrás. Esto lo vigila.
  const errores = await abrirMesa(page);
  await elegirCartaParaMirar(page);
  await esperarReloj(page, /Descarte/);

  const segundos = await segundosDelReloj(page);
  expect(segundos).toBeGreaterThan(3.5);
  expect(segundos).toBeLessThanOrEqual(5);

  expect(errores).toEqual([]);
});
