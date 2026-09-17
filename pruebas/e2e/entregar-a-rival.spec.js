/**
 * Descartarle una carta a un rival, en la mesa de entrenamiento.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ ES ESTA JUGADA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un poder 8 deja conocer una carta ajena: cuál es y dónde está. Con la
 * ventana de descarte abierta se la puede intentar descartar —dos toques sobre
 * ESA carta—. Si va con la muestra, la mesa lo dice y recién ahí pide una
 * carta propia, que se entrega a ciegas en su lugar; si no se elige en cinco
 * segundos, sale al azar. Si no va, el que ataca se come una de castigo y no
 * se le pide nada.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTA PRUEBA EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Las reglas las prueban `pruebas/descarte-al-rival.mjs` y compañía, con el
 * estado armado a mano. Lo que ninguna prueba de motor puede ver es el
 * cableado: que la mesa marque la carta correcta y que los toques del
 * navegador lleguen al motor.
 *
 * Antes la mesa marcaba la mano ENTERA del rival, porque el motor guardaba el
 * número visto y no la carta. Ahora marca sólo la carta conocida, y un doble
 * toque sobre cualquier otra no intenta nada.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL ATAQUE VA EN LA VENTANA QUE ABRE EL 8
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque es la única en la que la carta conocida sigue seguro donde se vio.
 * Esta prueba esperaba antes una reapertura más adelante, y con la marca de
 * mano entera daba igual qué hicieran las IA en el medio. Ahora no: si el
 * rival cambia justo esa carta por la que levantó, deja de ser atacable —que
 * es la regla— y la prueba fallaría por azar.
 *
 * Y porque la condición no se puede fabricar: hace falta que caiga un 8. Se
 * busca una semilla que reparta un 8 arriba del mazo, igual que hace
 * `poder-diez.spec.js` con el 10 — y, para el acierto, una en la que la carta
 * que se mira sea otro 8.
 */

import { test, expect } from "@playwright/test";
import { SEL, abrirMesa, elegirCartaParaMirar, esperarPista, esperarMiTurno } from "./mesa.js";

/**
 * Semillas que dejan un 8 arriba del mazo, separadas por lo que ve el 8.
 *
 * El 8 que se tira queda de muestra, y el modal ofrece primero la carta 0 del
 * jugador 1. Si esa carta también es un 8, atacarla es un ACIERTO; si no, un
 * ERROR. Calculadas corriendo el motor en Node: `empezarRonda`, y mirar
 * `mazo[0]`, la muestra y `jugadores[1].mano[0]`.
 *
 * Son listas y no una semilla porque si una IA se equivoca durante la ventana
 * de la ronda, se come la carta de arriba del mazo y el 8 ya no es mío.
 * `mesaConOcho` prueba la siguiente.
 */
const SEMILLAS_ERROR = [29, 71, 105, 159, 189, 212, 223, 230, 232, 265, 269];
const SEMILLAS_ACIERTO = [76, 356, 474, 728, 845, 1110, 1176, 1861, 2169, 2308];

/** Deja la mesa con un 8 levantado y el modal del poder abierto. */
async function mesaConOcho(page, semillas) {
  for (const semilla of semillas) {
    await abrirMesa(page, { semilla });
    await elegirCartaParaMirar(page);
    await esperarMiTurno(page);
    await page.locator(SEL.levantar).click();
    await esperarPista(page, /cambiarla|poder/i);

    const usar = page.locator('[data-accion="usar-poder"]');
    if (!(await usar.isVisible().catch(() => false))) continue;
    if (/\b8\b/.test(await page.locator("#modal h2").innerText())) return semilla;
  }
  return null;
}

/**
 * Usa el 8 sobre la primera carta que el modal ofrezca de un rival.
 *
 * @returns el rival y la posición mirada, que es la única que se va a poder
 *          atacar.
 */
async function usarElOcho(page) {
  await page.locator('[data-accion="usar-poder"]').click();
  await expect(page.locator("#modal .objetivos")).toBeVisible({ timeout: 20_000 });

  const objetivo = page
    .locator('#modal .objetivos [data-objetivo]:not([data-objetivo="0"])')
    .first();
  const rival = Number(await objetivo.getAttribute("data-objetivo"));
  const posicion = Number(await objetivo.getAttribute("data-pos"));
  await objetivo.click();
  return { rival, posicion };
}

/**
 * Espera la ventana que abre el 8 y da dos toques sobre la carta conocida.
 *
 * Corre DENTRO de la página, en un solo viaje: la ventana dura tres segundos y
 * manejarla desde afuera es una carrera que se pierde sola, como se descubrió
 * en `doble-toque-ios.spec.js`. Antes de atacar prueba lo que NO tiene que
 * pasar: tocar cartas que no se conocen.
 */
function atacarEnLaVentana(page, rival, posicion) {
  return page.evaluate(
    async ({ sel, rival, posicion }) => {
      const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
      const texto = (s) => document.querySelector(s)?.textContent ?? "";
      const cartaDe = (j, p) =>
        document.querySelector(`.jugador[data-jugador="${j}"] .carta[data-posicion="${p}"]`);
      const cuantas = (j) =>
        document.querySelectorAll(`.jugador[data-jugador="${j}"] .carta[data-posicion]`).length;
      const marcadas = (j) =>
        [...document.querySelectorAll(`.jugador[data-jugador="${j}"] .carta[data-posicion].atacable`)]
          .map((c) => Number(c.dataset.posicion));
      const otroRival = rival === 1 ? 2 : 1;

      // La ventana que abre el 8, después de los dos segundos de mirar.
      const limite = Date.now() + 15_000;
      while (!/busc/i.test(texto(sel.pista))) {
        if (Date.now() > limite) {
          return { fallo: `no se abrió la ventana tras el 8; la pista dice "${texto(sel.pista)}"` };
        }
        await dormir(16);
      }

      const atacablesRival = marcadas(rival);
      const atacablesOtro = marcadas(otroRival);

      // Dos toques sobre una carta del otro rival, que no conozco: nada.
      const ajena = cartaDe(otroRival, 0);
      ajena.click();
      ajena.click();
      await dormir(30);
      const trasLaAjena = texto(sel.pista);

      // Ni sobre otra carta del MISMO rival: conocer una no habilita las demás.
      const vecina = cartaDe(rival, (posicion + 1) % cuantas(rival));
      vecina.click();
      vecina.click();
      await dormir(30);
      const trasLaVecina = texto(sel.pista);

      // Dos toques sobre la conocida. El primero avisa que falta el otro.
      const misAntes = cuantas(0);
      const suyasAntes = cuantas(rival);
      const suya = cartaDe(rival, posicion);
      suya.click();
      const trasUnToque = texto(sel.pista);
      suya.click();
      await dormir(60);

      return {
        atacablesRival,
        atacablesOtro,
        trasLaAjena,
        trasLaVecina,
        trasUnToque,
        trasDosToques: texto(sel.pista),
        misAntes,
        misTrasAtacar: cuantas(0),
        suyasAntes,
        apagadas: document.querySelectorAll(".carta.apagada").length,
      };
    },
    { sel: SEL, rival, posicion },
  );
}

const cuantasDe = (page, jugador) =>
  page.locator(`.jugador[data-jugador="${jugador}"] .carta[data-posicion]`).count();

/** Lo que vale para cualquier ataque, acierte o no. */
function comprobarLoComun(visto, posicion) {
  expect(visto.fallo ?? "", visto.fallo ?? "").toBe("");
  expect(visto.atacablesRival, "se marca la carta que se vio, y sólo ésa").toEqual([posicion]);
  expect(visto.atacablesOtro, "del otro rival no se marca nada").toEqual([]);
  expect(visto.trasLaAjena, "dos toques sobre una carta que no conozco").toMatch(/no la conocés/i);
  expect(visto.trasLaVecina, "dos toques sobre otra carta del mismo rival").toMatch(/no la conocés/i);
  expect(visto.trasUnToque, "un solo toque ya disparó el ataque").toMatch(/doble toque/i);
}

test("al errar, me como una y no se elige ninguna carta", async ({ page }) => {
  test.setTimeout(240_000);
  const semilla = await mesaConOcho(page, SEMILLAS_ERROR);
  test.skip(semilla === null, "ninguna semilla repartió un 8 en el primer turno");

  const { rival, posicion } = await usarElOcho(page);
  const visto = await atacarEnLaVentana(page, rival, posicion);
  comprobarLoComun(visto, posicion);

  expect(visto.trasDosToques, "la mesa no dijo que era un error").toMatch(/no era esa/i);
  expect(visto.misTrasAtacar, "no me comí la carta de castigo").toBe(visto.misAntes + 1);
  expect(visto.apagadas, "la mesa pide una carta para entregar tras un error").toBe(0);
  expect(await cuantasDe(page, rival), "la mano del rival cambió").toBe(visto.suyasAntes);
});

test("al acertar, elijo una carta y quedo con una menos", async ({ page }) => {
  test.setTimeout(240_000);
  const semilla = await mesaConOcho(page, SEMILLAS_ACIERTO);
  test.skip(semilla === null, "ninguna semilla repartió un 8 en el primer turno");

  const { rival, posicion } = await usarElOcho(page);
  const visto = await atacarEnLaVentana(page, rival, posicion);
  comprobarLoComun(visto, posicion);

  expect(visto.trasDosToques, "la mesa no dijo que era un acierto").toMatch(/le acertaste/i);
  expect(visto.misTrasAtacar, "la mano cambió antes de elegir").toBe(visto.misAntes);
  expect(visto.apagadas, "con el acierto, el resto de la mesa se apaga").toBeGreaterThan(0);

  // Un toque en una carta propia la entrega.
  await page.locator(`${SEL.miMano} .carta[data-posicion]`).first().click();

  await expect.poll(() => cuantasDe(page, 0), { message: "no quedé con una menos" })
    .toBe(visto.misAntes - 1);
  expect(await cuantasDe(page, rival), "la carta se duplicó en vez de pasar").toBe(visto.suyasAntes);
  await expect(page.locator(".carta.apagada")).toHaveCount(0);
});

test("al acertar sin elegir, la ventana espera y la carta sale al azar", async ({ page }) => {
  test.setTimeout(240_000);
  const semilla = await mesaConOcho(page, SEMILLAS_ACIERTO);
  test.skip(semilla === null, "ninguna semilla repartió un 8 en el primer turno");

  const { rival, posicion } = await usarElOcho(page);
  const visto = await atacarEnLaVentana(page, rival, posicion);
  expect(visto.fallo ?? "", visto.fallo ?? "").toBe("");
  expect(visto.trasDosToques).toMatch(/le acertaste/i);

  // La ventana del 8 dura tres segundos. Pasados, sigue esperando la carta.
  await page.waitForTimeout(3500);
  expect(await cuantasDe(page, 0), "se resolvió sin esperar la carta").toBe(visto.misAntes);
  await expect(page.locator(".carta.apagada").first()).toBeVisible();

  // A los cinco segundos, la elige el azar: quedo con una menos sin haber
  // tocado nada. El aviso «salió al azar» no se comprueba: con la ventana ya
  // vencida, el cierre que esperaba escribe enseguida la pista siguiente.
  await expect.poll(() => cuantasDe(page, 0), {
    message: "la carta no salió sola al vencer el tiempo",
    timeout: 5_000,
  }).toBe(visto.misAntes - 1);
  expect(await cuantasDe(page, rival)).toBe(visto.suyasAntes);

  // Y la ventana se cierra: vuelve la decisión de cortar, sin nada apuntado.
  await expect(page.locator(SEL.pasar)).toBeEnabled({ timeout: 10_000 });
  await expect(page.locator(".carta.apagada")).toHaveCount(0);
  await expect(page.locator(".carta.apuntada")).toHaveCount(0);
});
