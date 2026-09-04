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
  /**
   * La huella de un reparto.
   *
   * Incluye la MUESTRA y no sólo la mano, y hace falta: de la mano propia sólo
   * está destapada la carta que se miró, así que las otras tres se leen "boca
   * abajo" en cualquier partida. La primera versión comparaba sólo eso y falló
   * por una coincidencia real —las semillas 4242 y 99 reparten las dos un
   * Copa-6 en la posición 0—, con lo que dos repartos distintos daban la misma
   * cadena. La muestra desempata.
   *
   * Se ESPERA a que la muestra esté dada vuelta antes de leerla. La mesa la
   * mantiene tapada mientras dura la mirada —para que el jugador mire su carta
   * sin dos cosas a la vez— y leerla antes devolvía "boca abajo" para todas
   * las semillas: volvía el desempate a la nada y esta prueba fallaba
   * culpando a la semilla de algo que no había hecho.
   */
  const huellaDelReparto = async () => {
    const muestraCarta = page.locator("#muestraCarta .carta");
    await expect(muestraCarta).toHaveClass(/visible/, { timeout: 20_000 });

    const mano = await page.locator(`${SEL.miMano} .carta`).evaluateAll(
      (cartas) => cartas.map((c) => c.getAttribute("aria-label")),
    );
    const muestra = await muestraCarta.getAttribute("aria-label");
    return `${muestra} || ${mano.join(",")}`;
  };

  await abrirMesa(page, { semilla: 4242 });
  await elegirCartaParaMirar(page);
  const primera = await huellaDelReparto();

  await abrirMesa(page, { semilla: 4242 });
  await elegirCartaParaMirar(page);
  expect(await huellaDelReparto()).toBe(primera);

  // Y con otra semilla, otra mesa. Si esto fallara, la semilla no se estaría
  // usando y la comprobación de arriba no valdría nada.
  await abrirMesa(page, { semilla: 99 });
  await elegirCartaParaMirar(page);
  expect(await huellaDelReparto()).not.toBe(primera);
});
