/**
 * Los tiempos que vive el jugador son los que dice el reglamento.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE MIDE ACÁ, Y POR QUÉ NO ALCANZA CON LAS CONSTANTES
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Que `MS_DESCARTE` valga 5000 no dice nada sobre lo que dura la ventana en
 * pantalla. En el medio hay un navegador, tres IA con temporizadores propios y
 * una cadena de promesas que puede cortar una fase antes de tiempo — ya pasó:
 * la mirada en red duraba dos segundos en vez de siete porque el plazo del
 * servidor la cerraba, y ninguna prueba de reglas lo veía.
 *
 * Esto corre una mesa de verdad, con relojes de verdad, y compara lo que se
 * pidió contra lo que se midió.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO SE TOCA NADA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La prueba deja vencer la elección de la mirada en vez de elegir una carta.
 * Así las tres fases duran lo que tienen que durar sin depender de cuándo
 * hace clic una máquina: si eligiera, la fase se cerraría antes A PROPÓSITO y
 * medirla no diría nada.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA TOLERANCIA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 700 ms. Un `setTimeout` de 5000 en un Chromium que además dibuja cartas no
 * dispara en 5000 clavados, y esta máquina corre dos navegadores a la vez.
 * Lo que la prueba defiende es que no falte ni sobre un SEGUNDO: eso sería un
 * cambio de regla, no jitter.
 */

import { test, expect } from "@playwright/test";
import { abrirMesa } from "./mesa.js";
import {
  MS_ELEGIR_MIRADA, MS_MIRAR, MS_DESCARTE,
} from "../../public/js/reglas/motor.js";

/** Lo que se acepta entre lo pedido y lo medido. */
const TOLERANCIA = 700;

test("el panel de tiempos sólo aparece si se lo pide", async ({ page }) => {
  await abrirMesa(page);
  await expect(page.locator(".debug-tiempos"), "el panel se coló en una mesa normal")
    .toHaveCount(0);
  expect(
    await page.evaluate(() => Boolean(window.__tiempos)),
    "la medición quedó expuesta en una mesa normal",
  ).toBe(false);
});

test("con la bandera puesta, dice qué fase corre y cuánto le queda", async ({ page }) => {
  await abrirMesa(page, { parametros: { "debug-tiempos": "1" } });

  const panel = page.locator(".debug-tiempos");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(/elegir mirada/i);
  await expect(panel).toContainText(/queda/);

  // Y lo que dice el panel es lo que dice la medición.
  const enCurso = await page.evaluate(() => window.__tiempos.enCurso());
  expect(enCurso.fase).toBe("elegir mirada");
  expect(enCurso.configurado).toBe(5000);
  expect(enCurso.restante).toBeLessThanOrEqual(5000);
});

test("la mirada y el descarte duran lo que dice el reglamento", async ({ page }) => {
  await abrirMesa(page, { parametros: { "debug-tiempos": "1" } });

  /**
   * No se toca nada: la elección vence sola a los cinco segundos, se abre la
   * primera carta, se la ve dos segundos y arranca el descarte.
   *
   * Se espera a que el historial tenga las tres fases cerradas en vez de
   * dormir doce segundos: si algo las acortara, la espera termina antes y la
   * comparación de abajo lo dice.
   */
  await expect
    .poll(
      async () =>
        page.evaluate(() =>
          window.__tiempos.historial().map((f) => f.fase).join("|"),
        ),
      { timeout: 30_000, message: "las tres fases no llegaron a cerrarse" },
    )
    .toContain("descarte");

  const historial = await page.evaluate(() => window.__tiempos.historial());
  const contexto = JSON.stringify(historial);

  const ultima = (fase) => historial.filter((f) => f.fase === fase).at(-1);
  const ESPERADAS = [
    ["elegir mirada", MS_ELEGIR_MIRADA],
    ["mirar", MS_MIRAR],
    ["descarte", MS_DESCARTE],
  ];

  for (const [fase, configurado] of ESPERADAS) {
    const fila = ultima(fase);
    expect(fila, `no se midió la fase "${fase}": ${contexto}`).toBeTruthy();
    expect(fila.configurado, `"${fase}" se pidió con otro tiempo: ${contexto}`)
      .toBe(configurado);
    expect(
      Math.abs(fila.desvio),
      `"${fase}" duró ${fila.real} ms en vez de ${configurado}: ${contexto}`,
    ).toBeLessThanOrEqual(TOLERANCIA);
  }

  // Y todas en la ronda 1, que es la única que se jugó.
  expect(historial.every((f) => f.ronda === 1), `alguna cayó en otra ronda: ${contexto}`)
    .toBe(true);
});
