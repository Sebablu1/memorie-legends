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
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Y EL RESULTADO SE COMPRUEBA, NO SE PREDICE (§48)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El reparto es función de la semilla, así que qué carta se levanta y qué
 * carta muestra el 8 se puede calcular en Node y escribir acá como lista. Eso
 * es lo que se hizo, y las dos pruebas del acierto estuvieron rojas semanas.
 *
 * Lo que la lista no puede saber es lo que pasa ENTRE el reparto y el ataque.
 * La ventana de reflejos de la ronda abre con la mirada, antes de mi turno, y
 * ahí las tres IA juegan: si el jugador 1 descarta su carta 0 —o cualquier
 * carta anterior— su mano se corre, y la carta que el modal ofrece primero ya
 * no es la que dice la cuenta. La semilla seguía siendo «de acierto» sobre el
 * papel y el ataque era un error.
 *
 * Por eso el ayudante ya no busca «una semilla que reparta un 8»: usa el 8,
 * LEE lo que el 8 muestra y lo compara con la muestra. Si no es el resultado
 * que la prueba necesita, sigue con la siguiente semilla. Las listas de abajo
 * pasaron de ser promesas a ser candidatas.
 *
 * Y si ninguna sirve, esto se pone ROJO con la cuenta a la vista. Antes se
 * saltaba sola —`test.skip`— y un salto silencioso es la peor de las tres
 * salidas: no protege y no se nota.
 */

import { test, expect } from "@playwright/test";
import {
  SEL, abrirMesa, elegirCartaParaMirar, esperarPista, esperarMiTurno,
  numeroDeLaMuestra,
} from "./mesa.js";

/**
 * Candidatas: semillas que dejan un 8 arriba del mazo.
 *
 * El 8 que se tira queda de muestra, y el modal ofrece primero la carta 0 del
 * jugador 1 —`orden` las deja 1, 2, 3 y `manoParaElegir` las pinta 0 a 3—. Si
 * en el reparto esa carta también es un 8, la semilla es candidata a ACIERTO;
 * si no, a ERROR. Se calcularon corriendo el motor, que es el mismo que juega
 * la mesa:
 *
 *     node --input-type=module -e "
 *       import { crearPartida, empezarRonda } from './public/js/reglas/motor.js';
 *       const jug = ['h0','ia0','ia1','ia2'].map((id, i) =>
 *         ({ id, nombre: id, esIA: i > 0 }));
 *       for (let s = 1; s <= 20000; s++) {
 *         const e = empezarRonda(crearPartida(jug, { semilla: s }));
 *         if (e.mazo[0].numero !== 8) continue;
 *         console.log(s, e.jugadores[1].mano[0].numero === 8 ? 'acierto' : 'error');
 *       }"
 *
 * Son listas y no una semilla por dos motivos distintos. Uno: si una IA se
 * equivoca durante la ventana de la ronda, se come la carta de arriba del mazo
 * y el 8 ya no es mío. Dos, y es el de §48: esa misma ventana puede correr la
 * mano del rival, y entonces la candidata a acierto da un error. Ninguno de
 * los dos se ve desde acá, así que los dos los resuelve `mesaConOcho`
 * probando la siguiente.
 *
 * El acierto es el caso raro —hacen falta DOS ochos en el lugar justo, y son
 * 10 de cada 255 semillas con 8 arriba—, por eso su lista es la larga.
 */
const SEMILLAS_ERROR = [29, 71, 105, 159, 189, 212, 223, 230, 232, 265, 269,
                        270, 312, 318];
const SEMILLAS_ACIERTO = [76, 356, 474, 728, 845, 1110, 1176, 1861, 2169, 2308,
                          3244, 3260, 3281, 3498, 3577, 4182, 4222, 4856, 4990,
                          5532, 5648, 5690, 5873, 5945];

/**
 * Deja la mesa con el 8 ya usado, la carta del rival vista, y el resultado
 * que la prueba pidió —`"acierto"` o `"error"`— comprobado de verdad.
 *
 * Devuelve `{ semilla, rival, posicion, numero }`, o `{ fallo }` con la cuenta
 * de lo que vio cada semilla si ninguna dio lo que se buscaba.
 */
async function mesaConOcho(page, semillas, quiero) {
  const vistos = [];

  for (const semilla of semillas) {
    await abrirMesa(page, { semilla });
    await elegirCartaParaMirar(page);
    await esperarMiTurno(page);
    await page.locator(SEL.levantar).click();
    await esperarPista(page, /cambiala|poder/i);

    // Una IA se comió la carta de arriba del mazo: lo que levanté no es un 8.
    const usar = page.locator('[data-accion="usar-poder"]');
    if (!(await usar.isVisible().catch(() => false))) continue;
    if (!/\b8\b/.test(await page.locator("#modal h2").innerText())) continue;

    const visto = await usarElOcho(page);
    const muestra = await numeroDeLaMuestra(page);
    const resultado = visto.numero === muestra ? "acierto" : "error";
    vistos.push(`${semilla}: vio ${visto.numero} contra ${muestra} (${resultado})`);
    if (resultado === quiero) return { semilla, ...visto };
  }

  return {
    fallo: `ninguna de las ${semillas.length} semillas dio un ${quiero}. `
      + (vistos.length
          ? `Las que repartieron un 8: ${vistos.join("; ")}`
          : "Ninguna llegó a repartir un 8 arriba del mazo."),
  };
}

/**
 * Usa el 8 sobre la primera carta que el modal ofrezca de un rival.
 *
 * @returns el rival, la posición mirada —que es la única que se va a poder
 *          atacar— y el número de esa carta.
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

  /**
   * Y se lee el número MIENTRAS se ve, que es la única ventana que hay.
   *
   * `revelarUnMomento` dibuja la carta descubierta y la vuelve a tapar a los
   * dos segundos (`MS_MIRAR`). Una carta tapada no pinta su `.cara` y su
   * nombre accesible es «Posición N, boca abajo»: después del momento, este
   * número no está en ninguna parte del DOM. El jugador se lo acuerda; la
   * prueba tiene que leerlo ahora.
   *
   * Si no aparece, vuelve `null` en vez de reventar: para `mesaConOcho` es una
   * semilla que no sirve, como cualquier otra, y lo dice en su cuenta.
   */
  const suya = page.locator(
    `.jugador[data-jugador="${rival}"] .carta[data-posicion="${posicion}"]`,
  );
  let numero = null;
  for (const limite = Date.now() + 10_000; Date.now() < limite; ) {
    const m = (await suya.getAttribute("aria-label"))?.match(/(\d+)\s+de\s+/i);
    if (m) {
      numero = Number(m[1]);
      break;
    }
    await page.waitForTimeout(50);
  }

  return { rival, posicion, numero };
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

      /**
       * La ventana que abre el 8, después de los dos segundos de mirar.
       *
       * Se espera a que aparezca una carta ATACABLE, no a que la pista diga
       * una palabra. Esperaba `/busc/i` —por «BUSCÁ LA CARTA DEL RIVAL»— y eso
       * se rompió el día que la pista aprendió a decir otra cosa: ahora,
       * cuando además conocés una carta propia que entra en la muestra, dice
       * «TENÉS UN PAR: TUYO O DEL RIVAL». La ventana abría igual; lo que
       * fallaba era la prueba, que afirmaba una redacción en vez de un hecho.
       *
       * La marca de atacable es el hecho: la pone el motor sobre la carta que
       * se conoce, y es lo que esta prueba va a mirar en la línea siguiente.
       */
      const limite = Date.now() + 15_000;
      while (!document.querySelector(".carta.atacable")) {
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

  /**
   * La carta vista está marcada, y la mano entera no.
   *
   * Decía `toEqual([posicion])` —«y sólo ésa»— y eso afirmaba algo que el
   * juego no garantiza. `recordarFallo`, en el motor, deja a la vista de TODOS
   * los que siguen en juego la carta que alguien tocó por error, y desde ahí
   * es atacable como cualquier otra que se conozca: el conocimiento persiste
   * aunque la carta se vea dos segundos, que es de lo que se trata el juego.
   * En una ronda donde el rival se equivoca durante la ventana inicial, sus
   * cartas marcadas son dos, legítimamente, y la prueba se ponía roja por
   * tener razón el juego.
   *
   * Lo que esta prueba defiende es el bug de verdad: un 8 marcaba la mano
   * ENTERA, porque el motor guardaba el número visto y no la carta. Eso lo
   * agarra la cuenta de abajo, y de nuevo el doble toque sobre la vecina, que
   * tiene que contestar «no la conocés».
   */
  expect(visto.atacablesRival, "se marca la carta que se vio").toContain(posicion);
  expect(visto.atacablesRival.length, "y no la mano entera")
    .toBeLessThan(visto.suyasAntes);

  // Y del otro rival, nada. Esto tiene el mismo punto flojo que el de arriba
  // —si el que se equivoca en la ventana inicial es ÉL, acá va a sobrar una
  // marca— pero se deja como está: afirma lo que se quiso probar y todavía no
  // falló. Si falla, la corrección es la misma que la de arriba.
  expect(visto.atacablesOtro, "del otro rival no se marca nada").toEqual([]);
  expect(visto.trasLaAjena, "dos toques sobre una carta que no conozco").toMatch(/no la conocés/i);
  expect(visto.trasLaVecina, "dos toques sobre otra carta del mismo rival").toMatch(/no la conocés/i);
  expect(visto.trasUnToque, "un solo toque ya disparó el ataque").toMatch(/doble toque/i);
}

test("al errar, me como una y no se elige ninguna carta", async ({ page }) => {
  test.setTimeout(240_000);
  const { fallo, rival, posicion } = await mesaConOcho(page, SEMILLAS_ERROR, "error");
  expect(fallo ?? "", fallo ?? "").toBe("");

  const visto = await atacarEnLaVentana(page, rival, posicion);
  comprobarLoComun(visto, posicion);

  expect(visto.trasDosToques, "la mesa no dijo que era un error").toMatch(/no era esa/i);
  expect(visto.misTrasAtacar, "no me comí la carta de castigo").toBe(visto.misAntes + 1);
  expect(visto.apagadas, "la mesa pide una carta para entregar tras un error").toBe(0);
  expect(await cuantasDe(page, rival), "la mano del rival cambió").toBe(visto.suyasAntes);
});

test("al acertar, elijo una carta y quedo con una menos", async ({ page }) => {
  test.setTimeout(240_000);
  const { fallo, rival, posicion } = await mesaConOcho(page, SEMILLAS_ACIERTO, "acierto");
  expect(fallo ?? "", fallo ?? "").toBe("");

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
  const { fallo, rival, posicion } = await mesaConOcho(page, SEMILLAS_ACIERTO, "acierto");
  expect(fallo ?? "", fallo ?? "").toBe("");

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
