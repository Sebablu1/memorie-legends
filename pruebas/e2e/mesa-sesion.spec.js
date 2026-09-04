/**
 * La puerta de la mesa: sin cuenta no se juega.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTA PRUEBA EXISTE APARTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Las otras cuarenta pruebas de mesa sustituyen `guardia-sesion.js` por uno que
 * deja pasar siempre — miden el juego, no la puerta—. Ésta es la única que NO
 * lo sustituye, así que es la única que puede afirmar que la puerta está.
 *
 * Sin ella, alguien podría borrar el guardia de `mesa.js` y las cuarenta
 * seguirían en verde, porque todas lo tienen tapado.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ACÁ NO SE FALSIFICA FIREBASE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * No hace falta: el navegador de la prueba arranca sin sesión, que es
 * exactamente el caso que se quiere probar. Firebase contesta "no hay nadie"
 * solo, sin ayuda.
 */

import { test, expect } from "@playwright/test";

test("sin sesión, la mesa manda al login", async ({ page }) => {
  await page.goto("/mesa.html");

  await page.waitForURL(/login\.html/, { timeout: 15_000 });
  expect(page.url()).toContain("login.html");
});

test("y se acuerda de a dónde quería ir", async ({ page }) => {
  // El `?volver=` es lo que permite que, después de entrar, la persona termine
  // donde quería y no en una pantalla cualquiera. Sin esto, quien abre un
  // enlace a la mesa entra y aparece en otro lado sin explicación.
  await page.goto("/mesa.html?semilla=4242");

  await page.waitForURL(/login\.html/, { timeout: 15_000 });
  expect(decodeURIComponent(page.url())).toContain("mesa.html");
});

test("no alcanza a repartir ni una carta antes de irse", async ({ page }) => {
  // Lo que se evita acá es el parpadeo: si el guardia resolviera con `null` en
  // vez de dejar la promesa colgada, el navegador alcanzaría a repartir y
  // dibujar la mesa entera durante el instante que tarda la redirección.
  //
  // Se mira si ALGUNA VEZ hubo cartas, no si las hay al final: para cuando la
  // prueba llega a mirar, la página ya se fue y el rastro no quedaría.
  const hubieronCartas = [];
  await page.exposeFunction("anotarCartas", (n) => hubieronCartas.push(n));
  await page.addInitScript(() => {
    const mirar = setInterval(() => {
      const n = document.querySelectorAll(".carta[data-posicion]").length;
      if (n > 0) window.anotarCartas?.(n);
    }, 30);
    setTimeout(() => clearInterval(mirar), 12_000);
  });

  await page.goto("/mesa.html");
  await page.waitForURL(/login\.html/, { timeout: 15_000 });

  expect(
    hubieronCartas,
    `se vio una mesa repartida antes de la redirección: ${hubieronCartas.join(", ")}`,
  ).toEqual([]);
});

test("con sesión, la mesa reparte", async ({ page }) => {
  // El otro lado de la puerta. Una que no deja pasar a nadie tampoco sirve:
  // sin esto, romper la mesa del todo pasaría por "arreglado".
  //
  // Éste es el mismo reemplazo que usan las demás pruebas, escrito acá a la
  // vista para que se lea qué contrato están dando por bueno.
  await page.route("**/js/guardia-sesion.js", (ruta) =>
    ruta.fulfill({
      status: 200,
      contentType: "text/javascript; charset=utf-8",
      body: `export async function exigirSesionEnMesa() {
        return { uid: "jugador-de-prueba", email: "prueba@example.com" };
      }`,
    }),
  );

  await page.goto("/mesa.html?semilla=4242");

  await expect(page.locator("#pista")).toContainText(/Elegí|carta/i, {
    timeout: 15_000,
  });
  expect(page.url()).toContain("mesa.html");
});
