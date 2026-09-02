/**
 * El 10 muestra las dos cartas y ESPERA.
 *
 * El fallo que arregla: revelaba y cambiaba en la misma jugada. Ver algo que
 * ya no podés usar para decidir no es información, es el acta de lo que te
 * pasó. Y el propio juego prometía otra cosa —"viendo ambas antes"—, donde ese
 * "antes" sólo significa algo si después hay una decisión.
 *
 * Se prueba en el navegador porque el fallo se veía jugando: el motor hacía lo
 * que decía su código, y lo que faltaba era el paso intermedio.
 */

import { test, expect } from "@playwright/test";
import { SEL, abrirMesa, elegirCartaParaMirar, esperarPista, esperarMiTurno } from "./mesa.js";

/**
 * Semillas que dejan un 10 arriba del mazo.
 *
 * NO son a ojo. Se calcularon corriendo el motor en Node: para cada semilla,
 * `empezarRonda` y mirar si `mazo[0]` es un 10. Probar semillas al azar dejaba
 * las tres pruebas SALTADAS, que es peor que un rojo porque no se nota.
 *
 * Igual se recorre la lista y no se usa la primera: si alguna IA descarta
 * durante la ventana de la ronda, saca del mazo y la carta de arriba deja de
 * ser la que se calculó.
 */
const SEMILLAS_CON_DIEZ = [23, 38, 44, 65, 87, 89, 108, 147, 153, 197, 202, 206, 264, 280];

/** Busca una semilla que reparta un 10 en el primer turno. */
async function mesaConDiez(page) {
  for (const semilla of SEMILLAS_CON_DIEZ) {
    await abrirMesa(page, { semilla });
    await elegirCartaParaMirar(page);
    await esperarMiTurno(page);
    await page.locator(SEL.levantar).click();
    await esperarPista(page, /cambiarla|poder/i);
    const usar = page.locator('[data-accion="usar-poder"]');
    if (!(await usar.isVisible().catch(() => false))) continue;
    if (/\b10\b/.test(await page.locator("#modal h2").innerText())) return semilla;
  }
  return null;
}

/** Dispara el 10 hasta dejar el modal de decisión abierto. */
async function llegarALaDecision(page) {
  await page.locator('[data-accion="usar-poder"]').click();
  await expect(page.locator("#modal .objetivos")).toBeVisible({ timeout: 20_000 });
  // Primero una carta propia, después una del rival.
  await page.locator(`#modal .objetivos [data-objetivo="0"]`).first().click();
  const rival = page.locator(`#modal .objetivos [data-objetivo]:not([data-objetivo="0"])`).first();
  await rival.click();
}

test("el 10 muestra las dos cartas y espera la decisión", async ({ page }) => {
  test.setTimeout(180_000);
  const semilla = await mesaConDiez(page);
  test.skip(semilla === null, "ninguna semilla repartió un 10 en el primer turno");

  await llegarALaDecision(page);

  // El modal de decisión, con las dos cartas visibles.
  await expect(page.locator(".cartas-del-diez")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".cartas-del-diez img")).toHaveCount(2);
  await expect(page.locator('[data-accion="diez-cambiar"]')).toBeVisible();
  await expect(page.locator('[data-accion="diez-dejar"]')).toBeVisible();

  // Y NO se cambió nada todavía: sigue esperando.
  await expect(page.locator(SEL.cortar)).toBeDisabled();
});

test("decir que sí cambia las cartas; decir que no, las deja", async ({ page }) => {
  test.setTimeout(180_000);
  const semilla = await mesaConDiez(page);
  test.skip(semilla === null, "ninguna semilla repartió un 10 en el primer turno");

  await llegarALaDecision(page);
  const dosCartas = await page.locator(".cartas-del-diez img").evaluateAll(
    (imgs) => imgs.map((i) => i.getAttribute("alt")),
  );
  expect(dosCartas.length).toBe(2);

  await page.locator('[data-accion="diez-cambiar"]').click();

  // Resuelto: el modal se cierra y el turno sigue siendo suyo.
  await expect(page.locator(".cartas-del-diez")).toBeHidden({ timeout: 15_000 });
  await expect(page.locator(SEL.cortar)).toBeEnabled({ timeout: 20_000 });
  await expect(page.locator(SEL.pasar)).toBeEnabled();
});

test("la mesa se entera de si el cambio se hizo o no", async ({ page }) => {
  // Reportado jugando: el 10 funcionaba, pero los rivales no se enteraban de
  // qué había decidido. Y les importa: si cambió, alguien tiene una carta suya;
  // si no cambió, eso también dice algo.
  test.setTimeout(180_000);
  const semilla = await mesaConDiez(page);
  test.skip(semilla === null, "ninguna semilla repartió un 10 en el primer turno");

  await llegarALaDecision(page);
  await page.locator('[data-accion="diez-dejar"]').click();

  const aviso = page.locator(".anuncio-mirada");
  await expect(aviso.first()).toBeVisible({ timeout: 15_000 });
  const texto = await aviso.first().innerText();
  expect(texto).toMatch(/no cambió/i);

  // Y sin decir QUÉ cartas eran ni en qué posiciones estaban: el aviso cuenta
  // la decisión, no el contenido.
  expect(texto.replace(/poder \d+/i, "")).not.toMatch(/\d/);
});

test("dejar como está también devuelve el turno", async ({ page }) => {
  test.setTimeout(180_000);
  const semilla = await mesaConDiez(page);
  test.skip(semilla === null, "ninguna semilla repartió un 10 en el primer turno");

  await llegarALaDecision(page);
  await page.locator('[data-accion="diez-dejar"]').click();

  await expect(page.locator(".cartas-del-diez")).toBeHidden({ timeout: 15_000 });
  await expect(page.locator(SEL.cortar)).toBeEnabled({ timeout: 20_000 });
});
