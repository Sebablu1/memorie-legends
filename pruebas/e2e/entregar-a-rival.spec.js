/**
 * Entregarle una carta a un rival, en la mesa de entrenamiento.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ ES ESTA JUGADA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un poder 8 o 10 deja ver una carta ajena. A partir de ahí se sabe QUÉ tiene
 * ese rival, pero no DÓNDE — la mano se marca entera, nunca la posición—. En la
 * siguiente ventana de descarte se puede apostar: tocar dos veces la carta del
 * rival donde uno cree que está, y entregar una carta propia a ciegas si
 * acierta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTA PRUEBA EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El motor ya sabía hacerlo —`intentarDescarteRival`, probado en
 * `pruebas/rival.mjs`— y la mesa EN RED ya lo usaba. La de entrenamiento no:
 * los rivales nunca se marcaban y los toques no llegaban a ningún lado.
 *
 * Lo que se agregó, entonces, es cableado: las mismas reglas, conectadas al
 * camino local. Y el cableado es justo lo que ninguna prueba de motor puede
 * ver, porque del lado del motor todo estaba bien desde el principio.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL CAMINO ES TAN LARGO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque la condición no se puede fabricar: hace falta que caiga un poder 8,
 * usarlo, y recién entonces llega la ventana donde la jugada existe. Se busca
 * una semilla que reparta un 8 arriba del mazo — igual que hace
 * `poder-diez.spec.js` con el 10, y por el mismo motivo: probar semillas al
 * azar dejaba la prueba SALTADA, que es peor que un rojo porque no se nota.
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

test("mirar una carta ajena habilita entregarle una carta a ese rival", async ({
  page,
}) => {
  test.setTimeout(240_000);

  const semilla = await mesaConOcho(page);
  test.skip(semilla === null, "ninguna semilla repartió un 8 en el primer turno");

  // Usar el 8: se elige una carta de un rival y se la mira.
  await page.locator('[data-accion="usar-poder"]').click();
  await expect(page.locator("#modal .objetivos")).toBeVisible({ timeout: 20_000 });

  const objetivo = page
    .locator('#modal .objetivos [data-objetivo]:not([data-objetivo="0"])')
    .first();
  const rival = Number(await objetivo.getAttribute("data-objetivo"));
  await objetivo.click();

  // El 8 se gasta con la carta levantada, así que después no queda nada que
  // tirar: el turno sigue siendo mío pero sólo para cortar o pasar.
  await expect(page.locator(SEL.pasar)).toBeEnabled({ timeout: 25_000 });

  // Se pasa, y se espera una REAPERTURA: la ventana que abre cualquiera al
  // tirar una carta. Tiene que ser en esta misma ronda — `empezarRonda` borra
  // `conocimientos`, porque al repartir de nuevo lo que uno sabía ya no
  // corresponde a ninguna carta que siga ahí. O sea: la jugada existe sólo
  // desde que se usa el poder hasta que termina la ronda.
  await page.locator(SEL.pasar).click();

  // ── Lo que se viene a comprobar ──────────────────────────────────────
  //
  // Todo lo que sigue pasa DENTRO de la página, en un solo viaje. La ventana
  // reabierta dura tres segundos y hay que dar tres toques adentro; manejarla
  // desde afuera es una carrera que se pierde sola, como se descubrió en
  // `doble-toque-ios.spec.js`.
  const visto = await page.evaluate(
    async ({ sel, rival }) => {
      const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
      const texto = (s) => document.querySelector(s)?.textContent ?? "";
      const cartaDe = (j, p) =>
        document.querySelector(`.jugador[data-jugador="${j}"] .carta[data-posicion="${p}"]`);
      const mias = () => document.querySelectorAll(`${sel.miMano} .carta[data-posicion]`).length;
      const suyas = () =>
        document.querySelectorAll(`.jugador[data-jugador="${rival}"] .carta[data-posicion]`).length;

      // Se espera a que ALGUIEN tire y reabra la ventana. Puede tardar: antes
      // juegan las IA que estén en el medio. El plazo es generoso a propósito,
      // pero acotado por la ronda: si termina, `conocimientos` se borra y la
      // jugada deja de existir.
      const limite = Date.now() + 45_000;
      while (!/descarte/i.test(texto(sel.reloj))) {
        if (Date.now() > limite) {
          return { fallo: `nadie reabrió la ventana; el reloj dice "${texto(sel.reloj)}"` };
        }
        await dormir(16);
      }

      // 1. La mano del rival quedó marcada como atacable — la mano ENTERA,
      //    nunca una posición: se sabe qué tiene, no dónde.
      const cartasSuyas = [...document.querySelectorAll(
        `.jugador[data-jugador="${rival}"] .carta[data-posicion]`)];
      const atacables = cartasSuyas.filter((c) => c.classList.contains("atacable")).length;

      // 2. Dos toques sobre una carta suya apuntan el ataque y piden la
      //    entrega. El primero no: tiene que avisar que falta el otro.
      const suya = cartasSuyas[0];
      suya.click();
      const trasUnToque = texto(sel.pista);
      suya.click();
      await dormir(60);
      const trasDosToques = texto(sel.pista);

      // 3. Y ahora un solo toque en una carta propia ejecuta la jugada. Un
      //    solo toque a propósito: la decisión ya se confirmó al apuntar.
      const cuantasAntes = mias();
      const suyasAntes = suyas();
      const primera = document.querySelector(`${sel.miMano} .carta[data-posicion]`);
      cartaDe(0, primera.dataset.posicion).click();
      await dormir(700);

      return {
        atacables,
        cuantasSuyas: cartasSuyas.length,
        trasUnToque,
        trasDosToques,
        cuantasAntes,
        cuantasDespues: mias(),
        suyasAntes,
        suyasDespues: suyas(),
        pistaFinal: texto(sel.pista),
      };
    },
    { sel: SEL, rival },
  );

  expect(visto.fallo ?? "", visto.fallo ?? "").toBe("");

  expect(
    visto.atacables,
    "la mano del rival no quedó marcada: en entrenamiento el ataque no existía",
  ).toBe(visto.cuantasSuyas);

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
  // formas de estar roto.
  const cambio = visto.cuantasDespues - visto.cuantasAntes;
  expect(
    Math.abs(cambio),
    `mi mano pasó de ${visto.cuantasAntes} a ${visto.cuantasDespues}; la pista dice "${visto.pistaFinal}"`,
  ).toBe(1);

  // Y la del rival NO cambia de cantidad, gane o pierda. Al acertar se le va
  // una carta y le entra la mía EN SU LUGAR —por eso sigue igual—; al fallar no
  // se le toca nada. Si su mano creciera, la carta se estaría duplicando en vez
  // de transferirse.
  expect(
    visto.suyasDespues,
    `la mano del rival pasó de ${visto.suyasAntes} a ${visto.suyasDespues}: la carta no se transfirió, se duplicó`,
  ).toBe(visto.suyasAntes);

  // Acá NO se comprueba cuál de los dos desenlaces fue.
  //
  // La primera versión lo intentaba leyendo la pista, y se equivocaba: el texto
  // menciona "entregar" en los dos casos, así que daba por acierto un fallo.
  // Y no hay forma de forzar el acierto desde el navegador — la posición de la
  // carta buscada depende del reparto, que cambia en cada ronda.
  //
  // Que al acertar la carta propia se va de mi mano y aparece EN EL LUGAR
  // EXACTO de la del rival está probado en `pruebas/turnos-y-entrega.mjs`, con
  // el estado armado a mano y sin azar. Lo que esta prueba aporta es lo que
  // aquélla no puede ver: que los toques del navegador llegan al motor.
});
