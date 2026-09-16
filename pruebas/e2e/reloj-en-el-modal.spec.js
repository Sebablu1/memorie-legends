/**
 * La cuenta atrás se ve TAMBIÉN con un modal abierto.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL BUG QUE ESTO FIJA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Las fases que abren modal —levantar una carta de poder, elegir a quién
 * aplicárselo— son justamente las que vencen a los diez segundos. El reloj
 * corría bien y el jugador no lo veía: decidía contra una cuenta invisible y
 * la acción se tomaba sola.
 *
 * No era el z-index del cartel. `.escena` se declara `position: relative;
 * z-index: 2`, así que crea un contexto de apilamiento y todo lo que vive
 * adentro —el cartel de la pista incluido— se pinta dentro de ESE nivel. El
 * velo del modal es hermano de `.escena`, no suyo. Se midió con
 * `elementFromPoint`: con `.escena` en `z-index: 2` gana el velo aunque el
 * cartel pida 65; con `.escena` en `auto`, gana el cartel. Subirle el número
 * no arreglaba nada.
 *
 * La salida es la tercera superficie de la MISMA cuenta, adentro del modal.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE USA EL MODAL DE ABANDONAR Y NO EL DE UN PODER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque lo que hay que probar es "modal abierto + reloj corriendo", y el
 * modal de poder sólo aparece si la carta que toca levantar trae poder — que
 * no se puede forzar ni con la semilla fija, porque las IA descartan con
 * retrasos aleatorios y corren el mazo. Una prueba así falla una corrida de
 * cada tres por algo que no tiene nada que ver con el reloj.
 *
 * `postLevantada` se alcanza siempre y tiene reloj de veinte segundos, y el
 * botón de abandonar abre un modal cuando uno quiera. Misma pareja de
 * condiciones, sin azar. Que el hueco viva en `abrirModal` y no en cada modal
 * es justamente lo que hace que dé igual cuál se abra.
 */

import { test, expect } from "@playwright/test";
import {
  abrirMesa,
  elegirCartaParaMirar,
  esperarMiTurno,
  llegarADecidirCorte,
  tirarLaLevantada,
  SEL,
} from "./mesa.js";

const relojDelModal = (page) => page.locator(".reloj-modal");
const numeroDelModal = (page) => page.locator(".reloj-modal-numero");

/**
 * Espera a que la cuenta esté ESCRITA, no sólo a que el hueco exista.
 *
 * `abrirModal` crea el hueco vacío y lo rellena `pintarReloj` en su tick
 * siguiente, hasta 120 ms después. Leerlo antes devuelve "" y el fallo se
 * leería como «el reloj no anda» cuando lo que pasó es que se preguntó
 * temprano. Pasó de verdad mientras se escribía esto.
 */
const esperarLaCuenta = (page) => expect(numeroDelModal(page)).toHaveText(/^\d+s$/);

/** Deja la mesa en `postLevantada`, que es donde hay reloj y no hay modal. */
async function llegarAlPlazoDeCortar(page) {
  await abrirMesa(page);
  await elegirCartaParaMirar(page);
  await esperarMiTurno(page);
  await page.locator(SEL.levantar).click();
  await tirarLaLevantada(page);

  const listo = await llegarADecidirCorte(page);
  expect(listo, "no se llegó a poder cortar").toBe(true);
}

test("con un modal abierto, la cuenta sigue a la vista", async ({ page }) => {
  await llegarAlPlazoDeCortar(page);

  // Sin modal no hay hueco: el nodo nace y muere con cada modal.
  await expect(relojDelModal(page)).toHaveCount(0);

  await page.locator("#btnAbandonar").click();

  await expect(relojDelModal(page), "el modal tapó la única cuenta que había")
    .toBeVisible();
  await esperarLaCuenta(page);
});

test("y es la MISMA cuenta, no una segunda", async ({ page }) => {
  /**
   * Dos relojes para lo mismo terminan discrepando en cuanto uno se cancela y
   * el otro no — y entonces el modal se cerraría solo mientras el número del
   * cartel sigue corriendo. Acá se comprueba que los dos números coinciden, que
   * es lo que pasa cuando salen de la misma cuenta.
   *
   * Se leen en el MISMO viaje a la página. Leerlos con dos `expect` distintos
   * dejaría hasta 120 ms entre uno y otro, que es justo lo que tarda un tick en
   * cambiar el número, y la prueba fallaría por el instrumento.
   */
  await llegarAlPlazoDeCortar(page);
  await page.locator("#btnAbandonar").click();
  await esperarLaCuenta(page);

  const { enElCartel, enElModal } = await page.evaluate(() => ({
    enElCartel: document.querySelector("#relojNumero")?.textContent ?? "",
    enElModal: document.querySelector(".reloj-modal-numero")?.textContent ?? "",
  }));

  expect(enElModal, `cartel "${enElCartel}" contra modal "${enElModal}"`).toBe(enElCartel);
});

test("la cuenta del modal baja, no se queda congelada", async ({ page }) => {
  await llegarAlPlazoDeCortar(page);
  await page.locator("#btnAbandonar").click();
  await esperarLaCuenta(page);

  const leer = async () =>
    Number.parseInt(await page.locator(".reloj-modal-numero").innerText(), 10);

  const antes = await leer();
  await page.waitForTimeout(2500);
  const despues = await leer();

  expect(despues, `de ${antes}s a ${despues}s`).toBeLessThan(antes);
});
