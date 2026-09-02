/**
 * Una ronda entera, de punta a punta, sin que se rompa nada.
 *
 * QUÉ VIGILA
 *
 * Las otras pruebas de esta carpeta miran un momento concreto. Ésta deja la
 * mesa correr sola y comprueba lo que sólo se ve con distancia: que las fases
 * se encadenen sin colgarse, y que no haya UN SOLO error en la consola durante
 * decenas de transiciones.
 *
 * Eso último es lo que de verdad importa. `clicEnCartaDeRed` se quedó sin uno
 * de sus parámetros y tiraba un ReferenceError en cada clic; el motor estaba
 * perfecto y las 23 suites de `pruebas/` en verde. Un error en la consola
 * durante una ronda normal es exactamente esa clase de fallo.
 *
 * NO se prueba la partida completa hasta el ganador: son varias rondas con
 * eliminaciones y llevaría muchos minutos por corrida. Una ronda entera ya
 * atraviesa las seis fases.
 */

import { test, expect } from "@playwright/test";
import {
  SEL, abrirMesa, elegirCartaParaMirar, esperarMiTurno, esperarPista,
  tirarLaLevantada, llegarADecidirCorte, registro,
} from "./mesa.js";

test("una ronda entera sin un solo error de consola", async ({ page }) => {
  test.setTimeout(180_000);
  const errores = await abrirMesa(page);

  await elegirCartaParaMirar(page);
  await esperarMiTurno(page);

  // Un turno completo: levantar, tirar, aguantar la ventana, resolver el
  // poder si lo hay, y pasar.
  await page.locator(SEL.levantar).click();
  await esperarPista(page, /cambiarla|poder/i);
  await tirarLaLevantada(page);

  expect(await llegarADecidirCorte(page), "se llega a la decisión de corte").toBe(true);
  await expect(page.locator(SEL.pasar)).toBeEnabled();
  await page.locator(SEL.pasar).click();

  // Y ahora la mesa sola: las tres IA juegan sus turnos, con sus ventanas,
  // sus poderes y sus descartes.
  await expect
    .poll(async () => (await registro(page)).length, { timeout: 120_000, intervals: [2000] })
    .toBeGreaterThan(6);

  expect(errores, `errores en consola: ${errores.join(" | ")}`).toEqual([]);
});

test("la partida arranca igual con la misma semilla", async ({ page }) => {
  // La semilla es lo que hace que estas pruebas puedan afirmar algo concreto
  // en vez de "algo pasó". Si dejara de fijar el reparto, las demás seguirían
  // en verde por casualidad hasta el día que no.
  const leerMano = async () => {
    const alts = await page.locator(`${SEL.miMano} .carta .cara img`).evaluateAll(
      (imgs) => imgs.map((i) => i.getAttribute("alt")),
    );
    return alts.join(",");
  };

  await abrirMesa(page, { semilla: 4242 });
  await elegirCartaParaMirar(page);
  const primera = await leerMano();

  await abrirMesa(page, { semilla: 4242 });
  await elegirCartaParaMirar(page);
  expect(await leerMano()).toBe(primera);

  // Y con otra semilla, otra mesa. Si esto fallara, la semilla no se estaría
  // usando y la comprobación de arriba no valdría nada.
  await abrirMesa(page, { semilla: 99 });
  await elegirCartaParaMirar(page);
  expect(await leerMano()).not.toBe(primera);
});
