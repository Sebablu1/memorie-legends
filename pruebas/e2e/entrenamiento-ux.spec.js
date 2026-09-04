/**
 * La puesta en escena de la mesa de entrenamiento.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE DEFIENDE ACÁ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Nada de esto cambia quién gana. Son las señales que le dicen al jugador qué
 * está pasando: la pantalla de carga, el reparto que se ve, la cuenta
 * regresiva, el brillo de "te toca" y el destello del primer toque.
 *
 * Se prueban igual porque son fáciles de romper sin enterarse —una regla de
 * CSS de más, una clase que se deja puesta— y porque cuando se rompen no falla
 * nada: la mesa sigue funcionando y simplemente deja de explicarse. Eso no
 * aparece en ningún error.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DOS GRUPOS, POR LA PREFERENCIA DE MOVIMIENTO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La suite entera corre con `prefers-reduced-motion: reduce`, así que las
 * animaciones están apagadas. Las pruebas que miran el reparto volando y la
 * cuenta regresiva tienen que pedir explícitamente lo contrario — y de paso
 * comprueban que la preferencia se respeta de verdad en las dos direcciones.
 */

import { test, expect } from "@playwright/test";
import { abrirMesa, elegirCartaParaMirar, SEL } from "./mesa.js";


/**
 * Da UN toque a una carta propia dentro de la ventana de descarte, y cuenta
 * qué pasó.
 *
 * Todo ocurre adentro de la página, en un solo viaje. Dos razones:
 *
 *   - el destello dura 150 ms, y para cuando un `expect` de Playwright cruzara
 *     el puente ya se habría ido;
 *   - la ventana de descarte dura cinco segundos y abre una sola vez por
 *     ronda, así que manejarla desde afuera es una carrera que se pierde sola.
 *     Es el mismo motivo que llevó a `doble-toque-ios.spec.js` a hacer lo
 *     mismo, y allá está explicado largo.
 */
async function unToqueEnLaVentana(page) {
  return page.evaluate(async (sel) => {
    const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
    const texto = (s) => document.querySelector(s)?.textContent ?? "";
    const carta = (p) =>
      document.querySelector(`${sel.miMano} .carta[data-posicion="${p}"]`);

    const limite = Date.now() + 40_000;
    const hasta = async (listo, queja) => {
      while (!listo()) {
        if (Date.now() > limite) throw new Error(queja());
        await dormir(16);
      }
    };

    await hasta(
      () => /mirar/i.test(texto(sel.pista)),
      () => `no llegó la mirada: "${texto(sel.pista)}"`,
    );
    carta(0).click();

    // El flanco de subida, no "que diga Descarte": ese texto dura los cinco
    // segundos y engancharlo por la mitad deja sin tiempo al toque.
    const abierta = () => /descarte/i.test(texto(sel.reloj));
    await hasta(() => !abierta(), () => "la ventana ya estaba abierta");
    await hasta(abierta, () => `no abrió el descarte: "${texto(sel.reloj)}"`);

    const objetivo = carta(1);
    objetivo.click();

    const alToque = objetivo.classList.contains("carta-primer-toque");
    const pista = texto(sel.pista);

    // Y que el destello se vaya solo: una clase pegada deja la carta
    // destellando para siempre y, peor, esconde que el próximo no ocurrió.
    await dormir(300);
    return {
      alToque,
      pista,
      despues: objetivo.classList.contains("carta-primer-toque"),
    };
  }, SEL);
}

// =====================================================================
// Con movimiento reducido (lo que corre el resto de la suite)
// =====================================================================

test("la pantalla de carga está en el HTML, no la inventa el JavaScript", async ({
  page,
}) => {
  // Importa que venga en el HTML servido: su primer trabajo es tapar el rato
  // ANTERIOR a que el JavaScript corra —la mesa comprueba la sesión antes de
  // repartir—. Si la creara el JavaScript, llegaría tarde a su propio trabajo.
  const html = await (await page.request.get("/mesa.html")).text();
  expect(html).toContain('id="veloCarga"');
  expect(html).toContain("Cargando entrenamiento");
  expect(html, "el logo del velo").toContain("memorie-legends3.png");
});

test("y se va sola cuando la mesa está lista", async ({ page }) => {
  await abrirMesa(page);
  // `toHaveCount(0)`: se saca del DOM, no se deja transparente. Un velo con
  // `opacity: 0` encima de la mesa sigue comiéndose los toques.
  await expect(page.locator("#veloCarga")).toHaveCount(0);
});

test("la pista del descarte es corta y dice qué hacer", async ({ page }) => {
  await abrirMesa(page);
  const { pista } = await unToqueEnLaVentana(page);

  // Un solo toque: la pista tiene que explicar que falta el otro Y qué buscar.
  // Las dos cosas, porque un jugador nuevo que sólo lee "tocá dos veces" toca
  // dos veces cualquier carta y se come el castigo.
  expect(pista).toMatch(/dos veces/i);
  expect(pista).toMatch(/muestra/i);

  // Corta. Diez palabras y no ocho: ésta es la única pista que tiene que decir
  // dos cosas a la vez, y es el texto exacto que se pidió. El resto de las
  // pistas de la mesa entran en seis o siete.
  const palabras = pista.trim().split(/\s+/).length;
  expect(
    palabras,
    `la pista tiene ${palabras} palabras: "${pista}"`,
  ).toBeLessThanOrEqual(10);
});

test("el brillo dorado dice cuándo se puede tocar", async ({ page }) => {
  await abrirMesa(page);

  // En la mirada se puede elegir carta, así que la mano propia está encendida.
  const mias = page.locator(`${SEL.miMano} .carta[data-posicion]`);
  await expect(mias.first()).toHaveClass(/jugable/);

  // Y las de los rivales no: no hay nada que hacer con ellas.
  const ajena = page.locator('.jugador[data-jugador="1"] .carta[data-posicion]').first();
  await expect(ajena).not.toHaveClass(/jugable/);
});

test("el primer toque contesta con un destello", async ({ page }) => {
  // Éste es el punto del pedido: hasta que llegaba el segundo toque, la mesa
  // no hacía NADA visible, y el primer toque se leía como "no me registró".
  const errores = await abrirMesa(page);
  const visto = await unToqueEnLaVentana(page);

  expect(visto.alToque, "el primer toque no destelló").toBe(true);
  expect(visto.despues, "el destello quedó pegado").toBe(false);
  expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

// =====================================================================
// Con movimiento permitido
// =====================================================================

test.describe("con animaciones", () => {
  test.use({ reducedMotion: "no-preference" });

  test("las cartas vuelan desde el mazo, y la clase no queda pegada", async ({
    page,
  }) => {
    // El reparto dura menos de dos segundos y después se limpia solo, así que
    // no se puede mirar "ahora": hay que dejar puesto un vigía antes de que
    // empiece. Un `MutationObserver` anota si ALGUNA carta llegó a volar.
    await page.addInitScript(() => {
      window.__volaron = 0;
      // `addInitScript` corre ANTES de que exista el documento, así que
      // `document.documentElement` todavía es null y `observe()` no engancha
      // nada. Ésa fue la primera versión: contaba cero vuelos y parecía que la
      // animación no existía. Se espera a que el documento esté armado — el
      // reparto ocurre mucho después, así que no se pierde nada.
      addEventListener("DOMContentLoaded", () => {
        new MutationObserver((cambios) => {
          for (const c of cambios) {
            if (c.target.classList?.contains("repartiendo")) window.__volaron++;
          }
        }).observe(document.body, {
          subtree: true,
          attributes: true,
          attributeFilter: ["class"],
        });
      });
    });

    await abrirMesa(page);

    expect(
      await page.evaluate(() => window.__volaron),
      "ninguna carta se animó al repartir",
    ).toBeGreaterThan(0);

    // Y al terminar no queda ninguna marcada: si quedara, el próximo redibujado
    // volvería a animarla sin motivo.
    await expect(page.locator(".carta.repartiendo")).toHaveCount(0);
  });

  test("la cuenta regresiva pasa por 3, 2, 1 y Preparate", async ({ page }) => {
    const vistos = [];
    await page.exposeFunction("anotarCuenta", (t) => vistos.push(t));
    await page.addInitScript(() => {
      const mirar = setInterval(() => {
        const t = document.getElementById("cuentaAtrasNumero")?.textContent;
        if (t) window.anotarCuenta?.(t);
      }, 60);
      setTimeout(() => clearInterval(mirar), 20_000);
    });

    await abrirMesa(page);

    const unicos = [...new Set(vistos)];
    expect(unicos, `lo que se vio: ${unicos.join(" ")}`).toEqual(
      expect.arrayContaining(["3", "2", "1"]),
    );
    expect(unicos.some((t) => /preparate/i.test(t)), "faltó 'Preparate…'").toBe(true);

    // Y al final se esconde: la cuenta tapada sobre la mesa, en pantalla
    // completa, no deja jugar.
    await expect(page.locator("#cuentaAtras")).toBeHidden();
  });

  test("el orden del reparto es izquierda, arriba, derecha y uno mismo", async ({
    page,
  }) => {
    // Es el orden de una mesa de verdad: se reparte a la izquierda primero y
    // uno se sirve al final. No coincide con el orden de los jugadores —el
    // jugador 0 es siempre el de abajo—, así que repartir por índice empezaría
    // por uno mismo, que es justo lo que no se quiere.
    const orden = [];
    await page.exposeFunction("anotarVuelo", (asiento) => orden.push(asiento));
    await page.addInitScript(() => {
      // Ver la nota de la prueba de arriba sobre por qué se espera al
      // documento antes de observar.
      addEventListener("DOMContentLoaded", () => {
        new MutationObserver((cambios) => {
          for (const c of cambios) {
            if (!c.target.classList?.contains("repartiendo")) continue;
            const asiento = c.target.closest(".asiento");
            if (asiento) window.anotarVuelo?.(asiento.id);
          }
        }).observe(document.body, {
          subtree: true,
          attributes: true,
          attributeFilter: ["class"],
        });
      });
    });

    await abrirMesa(page);

    expect(orden.length, "no se anotó ningún vuelo").toBeGreaterThanOrEqual(4);
    expect(orden.slice(0, 4)).toEqual([
      "asientoIzq",
      "asientoArriba",
      "asientoDer",
      "asientoAbajo",
    ]);
  });
});
