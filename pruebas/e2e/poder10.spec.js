/**
 * Los poderes, con el orden nuevo.
 *
 * LO QUE SE VIGILA
 *
 * Antes, tirar un 7, 8, 9 o 10 salteaba la ventana de reflejos e iba derecho a
 * resolver el poder. Ahora no: la mesa reacciona primero y el poder se decide
 * después. Ese encadenado —tirar, ventana, modal— vive entero en el navegador,
 * así que es lo único que no puede comprobar ninguna suite de `pruebas/`.
 *
 * CÓMO SE CONSIGUE UN PODER SIN ESPERAR AL AZAR
 *
 * `?semilla=N` fija el reparto, así que se prueban varias semillas hasta dar
 * con una que reparta un poder en el primer turno. Buscar en vez de suponer:
 * las IA reaccionan con retrasos aleatorios y pueden correr el mazo, así que
 * ni con la semilla fija se puede garantizar QUÉ carta sale.
 */

import { test, expect } from "@playwright/test";
import {
  SEL, abrirMesa, elegirCartaParaMirar, esperarPista, esperarReloj,
  esperarMiTurno, segundosDelReloj, registro, SEG_RONDA, SEG_REAPERTURA,
} from "./mesa.js";

/** Semillas a probar hasta que una reparta un poder en el primer turno. */
const SEMILLAS = [4242, 7, 99, 1234, 55, 808, 31415, 2718, 161803, 12];

/**
 * Levanta en el primer turno hasta encontrar una mesa con carta de poder.
 *
 * @param soloMirar  si es true, sólo sirve un 7 o un 8. Los de cambio (9 y 10)
 *                   no anuncian ninguna mirada, así que para esa prueba dan
 *                   igual que no haber encontrado nada.
 * @returns la semilla que funcionó, o null si ninguna sirvió.
 */
async function mesaConPoderEnMano(page, { soloMirar = false } = {}) {
  for (const semilla of SEMILLAS) {
    await abrirMesa(page, { semilla });
    await elegirCartaParaMirar(page);
    await esperarMiTurno(page);
    await page.locator(SEL.levantar).click();
    await esperarPista(page, /cambiarla|poder/i);

    const modal = page.locator('[data-accion="usar-poder"]');
    if (!(await modal.isVisible().catch(() => false))) continue;
    if (!soloMirar) return semilla;

    // El título del modal dice qué poder es: "¡Levantaste un PODER 7!".
    const titulo = await page.locator("#modal h2").innerText();
    if (/\b(7|8)\b/.test(titulo)) return semilla;
  }
  return null;
}

test("un poder tirado abre PRIMERO la ventana y DESPUÉS el poder", async ({ page }) => {
  const semilla = await mesaConPoderEnMano(page);
  test.skip(semilla === null, "ninguna semilla repartió un poder en el primer turno");

  // 🔮 Usar poder: antes tiraba y saltaba derecho al modal del poder. Ahora
  // tira, y la mesa tiene su ventana antes de que el poder aparezca.
  await page.locator('[data-accion="usar-poder"]').click();

  await esperarReloj(page, /Descarte/i);
  const segundos = await segundosDelReloj(page);
  expect(segundos, "la mesa reacciona antes que el poder").toBeLessThanOrEqual(SEG_REAPERTURA);
  expect(segundos, "y es la ventana corta, no la de la ronda").toBeLessThan(SEG_RONDA);

  // Y recién después llega la elección del objetivo.
  await expect(page.locator("#modal .objetivos")).toBeVisible({ timeout: 15_000 });
});

test("renunciar al poder no abre una segunda ventana", async ({ page }) => {
  // Antes, renunciar reabría los reflejos, y con razón: el poder había
  // salteado la ventana. Ahora la ventana ya ocurrió, así que reabrirla sería
  // darle dos oportunidades a la mesa por la misma carta.
  const semilla = await mesaConPoderEnMano(page);
  test.skip(semilla === null, "ninguna semilla repartió un poder en el primer turno");

  await page.locator('[data-accion="tirar-sin-poder"]').click();

  // La única ventana: la que abre el tiro.
  await esperarReloj(page, /Descarte/i);
  await expect(page.locator(SEL.cortar)).toBeEnabled({ timeout: 20_000 });

  // Si hubiera reabierto, el reloj volvería a decir "Descarte" y cortar
  // seguiría deshabilitado. Que se pueda cortar ES la comprobación.
  await expect(page.locator(SEL.pasar)).toBeEnabled();
});

test("mirar una carta deja constancia sin decir cuál", async ({ page }) => {
  test.setTimeout(180_000);

  // Los poderes 7 y 8 anuncian que alguien miró. Es información pública a
  // propósito: los demás tienen derecho a saber que ese jugador ahora sabe
  // algo. Lo que no puede escaparse es QUÉ vio.
  //
  // La primera versión de esto dejaba correr la mesa esperando a que alguna IA
  // sacara un 7 o un 8. Pasaba casi siempre y fallaba de vez en cuando, que es
  // la peor clase de prueba: la que enseña a desconfiar de los rojos. Ahora el
  // poder lo usa el jugador, buscando una semilla que se lo reparta.
  const semilla = await mesaConPoderEnMano(page, { soloMirar: true });
  test.skip(semilla === null, "ninguna semilla repartió un 7 ni un 8 en el primer turno");

  await page.locator('[data-accion="usar-poder"]').click();

  // Reflejos primero; el poder, después.
  await esperarReloj(page, /Descarte/i);
  await expect(page.locator("#modal .objetivos")).toBeVisible({ timeout: 15_000 });

  // Se elige una carta cualquiera de las ofrecidas.
  await page.locator("#modal .objetivos .carta").first().click();

  const anuncio = page.locator(".anuncio-mirada");
  await expect(anuncio.first()).toBeVisible({ timeout: 15_000 });

  const texto = await anuncio.first().innerText();
  expect(texto).toMatch(/miró una carta/i);
  // Ni el número de la carta ni su posición. El único dígito permitido es el
  // del poder, en "usó el poder 7".
  expect(texto.replace(/poder \d+/i, "")).not.toMatch(/\d/);
});
