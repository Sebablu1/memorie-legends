/**
 * Descartarle una carta a un rival, en la mesa de entrenamiento.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ ES ESTA JUGADA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un poder 8 deja conocer una carta ajena: cuál es y dónde está. Con la
 * ventana de descarte abierta se la puede intentar descartar —dos toques sobre
 * ESA carta— y, si va con la muestra, entregar una propia a ciegas en su
 * lugar. Si no va, el que ataca se come una de castigo.
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
 * `poder-diez.spec.js` con el 10.
 */

import { test, expect } from "@playwright/test";
import { SEL, abrirMesa, elegirCartaParaMirar, esperarPista, esperarMiTurno } from "./mesa.js";

/**
 * Semillas que dejan un 8 arriba del mazo.
 *
 * Calculadas corriendo el motor en Node: para cada semilla, `empezarRonda` y
 * mirar si `mazo[0].numero === 8`. Se recorre la lista y no se usa la primera
 * porque si una IA descarta durante la ventana de la ronda, saca del mazo y la
 * carta de arriba deja de ser la que se calculó.
 */
const SEMILLAS_CON_OCHO = [29, 71, 76, 105, 159, 189, 212, 223, 230, 232, 265, 269];

/** Deja la mesa con un 8 levantado y el modal del poder abierto. */
async function mesaConOcho(page) {
  for (const semilla of SEMILLAS_CON_OCHO) {
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

test("el 8 marca la carta que se vio, y dos toques sobre ella la atacan", async ({ page }) => {
  test.setTimeout(240_000);

  const semilla = await mesaConOcho(page);
  test.skip(semilla === null, "ninguna semilla repartió un 8 en el primer turno");

  const { rival, posicion } = await usarElOcho(page);
  const otroRival = rival === 1 ? 2 : 1;

  // ── Lo que se viene a comprobar ──────────────────────────────────────
  //
  // Todo lo que sigue pasa DENTRO de la página, en un solo viaje. La ventana
  // que abre el 8 dura tres segundos y hay que dar varios toques adentro;
  // manejarla desde afuera es una carrera que se pierde sola, como se
  // descubrió en `doble-toque-ios.spec.js`.
  const visto = await page.evaluate(
    async ({ sel, rival, posicion, otroRival }) => {
      const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
      const texto = (s) => document.querySelector(s)?.textContent ?? "";
      const cartaDe = (j, p) =>
        document.querySelector(`.jugador[data-jugador="${j}"] .carta[data-posicion="${p}"]`);
      const cuantas = (j) =>
        document.querySelectorAll(`.jugador[data-jugador="${j}"] .carta[data-posicion]`).length;
      const marcadas = (j) =>
        [...document.querySelectorAll(`.jugador[data-jugador="${j}"] .carta[data-posicion].atacable`)]
          .map((c) => Number(c.dataset.posicion));

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

      // Dos toques sobre la conocida apuntan el ataque. El primero avisa.
      const suya = cartaDe(rival, posicion);
      suya.click();
      const trasUnToque = texto(sel.pista);
      suya.click();
      await dormir(30);
      const trasDosToques = texto(sel.pista);

      // Y un toque en una carta propia ejecuta la jugada.
      const misAntes = cuantas(0);
      const suyasAntes = cuantas(rival);
      const primera = document.querySelector(`${sel.miMano} .carta[data-posicion]`);
      cartaDe(0, primera.dataset.posicion).click();
      await dormir(700);

      return {
        atacablesRival,
        atacablesOtro,
        trasLaAjena,
        trasLaVecina,
        trasUnToque,
        trasDosToques,
        misAntes,
        misDespues: cuantas(0),
        suyasAntes,
        suyasDespues: cuantas(rival),
        pistaFinal: texto(sel.pista),
      };
    },
    { sel: SEL, rival, posicion, otroRival },
  );

  expect(visto.fallo ?? "", visto.fallo ?? "").toBe("");

  expect(visto.atacablesRival, "se marca la carta que se vio, y sólo ésa").toEqual([posicion]);
  expect(visto.atacablesOtro, "del otro rival no se marca nada").toEqual([]);

  expect(visto.trasLaAjena, "dos toques sobre una carta que no conozco").toMatch(/no la conocés/i);
  expect(visto.trasLaVecina, "dos toques sobre otra carta del mismo rival").toMatch(/no la conocés/i);
  expect(visto.trasUnToque, "un solo toque ya apuntó el ataque").toMatch(/doble toque/i);
  expect(
    visto.trasDosToques,
    `tras dos toques la pista dice "${visto.trasDosToques}"`,
  ).toMatch(/carta tuya/i);

  // La jugada se ejecutó, y las cantidades lo demuestran.
  //
  // Mi mano cambia en EXACTAMENTE una carta, para cualquiera de los dos
  // desenlaces: al acertar entrego una y quedo con menos; al fallar recibo una
  // de castigo y quedo con más. Cambiar en dos, o no cambiar, serían las dos
  // formas de estar roto. Cuál de los dos fue depende del reparto; que cada
  // uno haga lo que debe está en `pruebas/descarte-al-rival.mjs`.
  const cambio = visto.misDespues - visto.misAntes;
  expect(
    Math.abs(cambio),
    `mi mano pasó de ${visto.misAntes} a ${visto.misDespues}; la pista dice "${visto.pistaFinal}"`,
  ).toBe(1);

  // Y la del rival NO cambia de cantidad, gane o pierda. Si creciera, la carta
  // se estaría duplicando en vez de transferirse.
  expect(
    visto.suyasDespues,
    `la mano del rival pasó de ${visto.suyasAntes} a ${visto.suyasDespues}`,
  ).toBe(visto.suyasAntes);
});

test("un ataque apuntado que no se completa se olvida al cerrar la ventana", async ({ page }) => {
  /**
   * Apuntar y no elegir la entrega. Antes el ataque a medio armar quedaba
   * vivo: la mesa seguía apagada con la carta apuntada resaltada, y el primer
   * toque propio de la ventana siguiente se tomaba como entrega.
   */
  test.setTimeout(240_000);

  const semilla = await mesaConOcho(page);
  test.skip(semilla === null, "ninguna semilla repartió un 8 en el primer turno");

  const { rival, posicion } = await usarElOcho(page);

  const apuntado = await page.evaluate(
    async ({ sel, rival, posicion }) => {
      const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
      const texto = (s) => document.querySelector(s)?.textContent ?? "";
      const limite = Date.now() + 15_000;
      while (!/busc/i.test(texto(sel.pista))) {
        if (Date.now() > limite) return { fallo: "no se abrió la ventana tras el 8" };
        await dormir(16);
      }
      const suya = document.querySelector(
        `.jugador[data-jugador="${rival}"] .carta[data-posicion="${posicion}"]`,
      );
      suya.click();
      suya.click();
      await dormir(30);
      return { apagadas: document.querySelectorAll(".carta.apagada").length };
    },
    { sel: SEL, rival, posicion },
  );

  expect(apuntado.fallo ?? "", apuntado.fallo ?? "").toBe("");
  expect(apuntado.apagadas, "con el ataque apuntado, el resto de la mesa se apaga")
    .toBeGreaterThan(0);

  // La ventana se cierra sola y vuelve la decisión de cortar.
  await expect(page.locator(SEL.pasar)).toBeEnabled({ timeout: 25_000 });

  await expect(page.locator(".carta.apagada"), "la mesa sigue apagada tras cerrar la ventana")
    .toHaveCount(0);
  await expect(page.locator(".carta.apuntada"), "y la carta sigue apuntada").toHaveCount(0);
});
