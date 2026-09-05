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
import { abrirMesa, elegirCartaParaMirar, misCartas, SEL } from "./mesa.js";


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
      () => /tu carta/i.test(texto(sel.pista)),
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
  // WebP y no PNG: el velo mostraba el original de 149 KB para dibujarlo a
  // 260px. El WebP pesa 29 y es lo primero que se descarga al entrar a la mesa.
  expect(html, "el logo del velo").toContain("memorie-legends3.webp");
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

  // Un solo toque: la pista tiene que decir que falta el otro.
  expect(pista).toMatch(/doble toque/i);

  // Y ser corta de verdad.
  //
  // Antes decía además qué buscar —"la carta igual a la muestra"— y esta prueba
  // lo exigía. Se sacó a pedido, para que la barra se lea de un vistazo. Es un
  // intercambio consciente: la pista ya no le enseña la regla a quien juega por
  // primera vez, y eso lo tiene que explicar "Cómo se juega".
  const palabras = pista.trim().split(/\s+/).length;
  expect(
    palabras,
    `la pista tiene ${palabras} palabras: "${pista}"`,
  ).toBeLessThanOrEqual(6);
});

test("la pista vive fuera de la caja de los botones", async ({ page }) => {
  // Metida dentro de la botonera, la instrucción se leía como el rótulo de la
  // caja: un texto chico arriba a la izquierda de cuatro botones. La sacamos
  // afuera, centrada y sobre el paño, para que se lea como lo que es.
  //
  // No alcanza con mirar el CSS: lo que se puede volver a romper es el HTML —
  // alguien devuelve el `<div>` adentro de `.acciones` y todo sigue
  // funcionando, sólo que la mesa vuelve a explicarse mal.
  await abrirMesa(page);

  expect(
    await page.locator(".acciones #pista").count(),
    "la pista volvió adentro de la caja de los botones",
  ).toBe(0);

  const pista = await page.locator("#pista").boundingBox();
  const barra = await page.locator(".acciones").boundingBox();
  expect(
    pista.y + pista.height,
    "la pista se solapa con la botonera",
  ).toBeLessThanOrEqual(barra.y + 1);
});

test("el cartel dice la fase y el tiempo en el mismo sitio", async ({ page }) => {
  // La instrucción y el reloj eran dos cosas separadas que decían lo mismo con
  // distintas palabras. Lo que se defiende acá es que sigan siendo una: el
  // texto DENTRO del cartel, y el reloj al lado, no en otro rincón.
  await abrirMesa(page);

  expect(
    await page.locator("#anuncio #pista").count(),
    "la pista se volvió a salir del cartel",
  ).toBe(1);
  expect(await page.locator("#anuncio #temporizador").count()).toBe(1);
  expect(await page.locator("#anuncio #relojTurno").count()).toBe(1);

  // Y el cartel lleva la fase puesta, que es de donde sale su color. Sin esto
  // el cartel se queda del color de la fase anterior y miente.
  await expect(page.locator("#anuncio")).toHaveAttribute("data-fase", "mirar");
  await expect(page.locator("#anuncio")).toContainText(/mirá tu carta/i);

  await misCartas(page).first().click();
  await expect(page.locator("#anuncio")).toHaveAttribute("data-fase", "descarte", {
    timeout: 20_000,
  });
  await expect(page.locator("#anuncio")).toContainText(/descarte/i);
});

test("el reloj de la ventana cuenta hacia abajo, no se queda en cero", async ({
  page,
}) => {
  // La barra la pintaba una transición de CSS que duraba lo que la ventana.
  // Con `prefers-reduced-motion` —que es como corre esta suite, y como lo
  // tiene puesto mucha gente— la regla general la bajaba a 0.05 ms: la barra
  // saltaba a vacía en el primer cuadro y decía que no quedaba tiempo cuando
  // quedaban cinco segundos. Ahora la pinta el reloj, tick a tick.
  await abrirMesa(page);
  await misCartas(page).first().click();
  await expect(page.locator("#anuncio")).toHaveAttribute("data-fase", "descarte", {
    timeout: 20_000,
  });

  const ancho = () =>
    page.locator("#temporizadorRelleno").evaluate((el) => parseFloat(el.style.width));

  const antes = await ancho();
  expect(antes, `la barra arrancó en ${antes}%`).toBeGreaterThan(50);

  await page.waitForTimeout(1200);
  const despues = await ancho();
  expect(despues, `la barra no bajó: ${antes}% -> ${despues}%`).toBeLessThan(antes);
});

test("la caja de los botones es del ancho de los botones, y va centrada", async ({
  page,
}) => {
  await abrirMesa(page);

  const caja = await page.locator(".acciones").boundingBox();
  const paño = await page.locator(".mesa-zona").boundingBox();

  expect(caja.width, "la caja sigue cruzando la pantalla entera").toBeLessThan(
    paño.width * 0.8,
  );

  // Centrada respecto del paño, no de la ventana: a partir de 1080px hay una
  // columna de marcador a la derecha, y centrar contra la ventana dejaría la
  // botonera corrida de la mesa que tiene encima.
  const centroCaja = caja.x + caja.width / 2;
  const centroPaño = paño.x + paño.width / 2;
  expect(
    Math.abs(centroCaja - centroPaño),
    `la caja está corrida ${Math.round(centroCaja - centroPaño)}px del eje de la mesa`,
  ).toBeLessThanOrEqual(1);
});

test("los botones no se corren de sitio cuando aparece el reloj", async ({
  page,
}) => {
  // El reloj entra y sale según la fase, y la caja es del ancho de lo que
  // contiene: con el reloj adentro, cada aparición la ensancharía y correría
  // los cuatro botones de sitio. Por eso el reloj vive arriba, con la pista.
  //
  // Un botón que se mueve justo cuando hay que decidir contra reloj es un
  // botón que se falla, así que esto queda escrito: si alguien devuelve el
  // reloj a la botonera, se entera acá.
  await abrirMesa(page);

  const boton = page.locator(SEL.pasar);
  const sinReloj = await boton.boundingBox();

  await page.evaluate(() => {
    document.querySelector("#relojTurno").hidden = false;
  });
  const conReloj = await boton.boundingBox();

  expect(
    conReloj.x,
    `el botón se corrió de ${sinReloj.x} a ${conReloj.x} al aparecer el reloj`,
  ).toBe(sinReloj.x);
});

// =====================================================================
// El teléfono chico
// =====================================================================
//
// Todo lo de acá se rompió de verdad, no en teoría: a 320 px la cabecera
// desbordaba y la página scrolleaba de costado; el paño se derramaba sobre la
// botonera y las cartas tapaban el cartel; y cuando los cuatro botones no
// entraban en una fila, "Pasar" quedaba solo, estirado de lado a lado.

const CHICO = { width: 320, height: 568 };

test("en el teléfono más chico no hay scroll lateral", async ({ page }) => {
  await page.setViewportSize(CHICO);
  await abrirMesa(page);

  const seSale = await page.evaluate(() => ({
    ancho: document.documentElement.scrollWidth,
    hueco: document.documentElement.clientWidth,
  }));
  expect(
    seSale.ancho,
    `la página mide ${seSale.ancho}px en un hueco de ${seSale.hueco}px`,
  ).toBeLessThanOrEqual(seSale.hueco);
});

test("las cartas no se meten encima del cartel ni de los botones", async ({
  page,
}) => {
  await page.setViewportSize(CHICO);
  await abrirMesa(page);

  const visto = await page.evaluate(() => {
    const c = document.querySelector("#anuncio").getBoundingClientRect();

    // Se mide por geometría y no con `elementFromPoint`: el cartel es sordo al
    // tacto a propósito, así que preguntar "qué hay en este punto" nunca lo
    // devuelve y daría todo por tapado.
    let solape = 0;
    document.querySelectorAll(".carta").forEach((el) => {
      const r = el.getBoundingClientRect();
      const alto = Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top);
      const ancho = Math.min(r.right, c.right) - Math.max(r.left, c.left);
      if (alto > 0 && ancho > 0) solape = Math.max(solape, alto);
    });

    // Los botones sí se preguntan por punto: ahí lo que importa es a quién le
    // llega el toque, y una carta encima se lo queda.
    const tapados = [...document.querySelectorAll("button.accion")]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !b.contains(e) && e !== b;
      })
      .map((b) => b.textContent.trim());

    return { solape: Math.round(solape), tapados };
  });

  expect(visto.solape, "las cartas se derraman sobre el cartel").toBeLessThanOrEqual(2);
  expect(
    visto.tapados,
    `hay cartas encima de estos botones: ${visto.tapados.join(", ")}`,
  ).toEqual([]);
});

test("con el teléfono acostado la mesa sigue entrando", async ({ page }) => {
  // Éste estaba roto del todo y no lo decía. Los escalones que achican la mesa
  // en pantallas bajas estaban atados a `max-width: 560px`, así que acostado
  // —740 de ancho, 360 de alto— no se aplicaba ninguno: la mano se dibujaba
  // 200 px por debajo del paño, encima del cartel y de los cuatro botones, que
  // quedaban tapados y no recibían un solo toque.
  //
  // Se prueba a lo ancho y bajo, que es la forma que tiene el problema. Ir por
  // `orientation` no serviría: una ventana de escritorio corta tiene el mismo
  // problema y no está "acostada".
  await page.setViewportSize({ width: 740, height: 360 });
  await abrirMesa(page);

  const visto = await page.evaluate(() => {
    const mesa = document.querySelector(".mesa").getBoundingClientRect();
    const propio = document.querySelector('.jugador[data-jugador="0"]').getBoundingClientRect();
    const tapados = [...document.querySelectorAll("button.accion")]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !b.contains(e) && e !== b;
      })
      .map((b) => b.textContent.trim());
    const doc = document.documentElement;
    return {
      desborde: Math.round(propio.bottom - mesa.bottom),
      tapados,
      alto: Math.min(...[...document.querySelectorAll("button.accion")].map((b) =>
        Math.round(b.getBoundingClientRect().height))),
      scroll: doc.scrollHeight > doc.clientHeight || doc.scrollWidth > doc.clientWidth,
    };
  });

  expect(visto.desborde, "tu mano se sale del paño").toBeLessThanOrEqual(0);
  expect(visto.tapados, `botones tapados: ${visto.tapados.join(", ")}`).toEqual([]);
  expect(visto.alto, "los botones se achicaron por debajo del dedo").toBeGreaterThanOrEqual(44);
  expect(visto.scroll, "la mesa se sale de la pantalla").toBe(false);
});

test("si los cuatro botones no entran en una fila, van dos y dos", async ({
  page,
}) => {
  // Con `flex-grow` y a lo que salga, entraban tres arriba y "Pasar" quedaba
  // solo abajo del ancho de la pantalla: tres veces más grande que los otros,
  // para la jugada más inocua de las cuatro.
  await page.setViewportSize(CHICO);
  await abrirMesa(page);

  const anchos = await page
    .locator("button.accion")
    .evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().width)));

  expect(new Set(anchos).size, `los botones miden ${anchos.join(", ")}`).toBe(1);
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
