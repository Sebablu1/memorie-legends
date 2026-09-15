/**
 * La zona que impide que una carta se escape de su propio cursor.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL CICLO QUE ESTO ARREGLA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El `:hover` está en la carta, y la carta se MUEVE al recibirlo: sube 16 px y
 * crece un 6 %. Si el cursor estaba cerca del borde de abajo, la carta se le va
 * de encima, pierde el hover, vuelve a su lugar, lo recupera — y parpadea
 * varias veces por segundo mientras el ratón no se mueva.
 *
 * No pasaba en todas las cartas: `transform-origin: 50% 130%` deja el punto de
 * giro debajo de la carta, así que cuanto más abierta está en el abanico, más
 * se desplaza su borde por los mismos 16 px.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ ESTA PRUEBA NO REPRODUCE EL PARPADEO, Y HAY QUE SABERLO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Se intentó, de tres formas, y ninguna sirvió:
 *
 *   - Sobre la mesa de verdad: la mesa se redibuja sola cada pocos cientos de
 *     milisegundos y reemplaza las cartas por elementos nuevos en posiciones
 *     nuevas. Se medía 0 de 20 con el código YA arreglado.
 *
 *   - Con `matches(":hover")`: devolvía `false` mientras el rectángulo del
 *     mismo elemento mostraba la carta levantada y escalada, o sea con la
 *     regla `:hover` aplicada. El instrumento mentía.
 *
 *   - Midiendo el desparramo de la posición con el cursor quieto: pasaba
 *     IGUAL con el arreglo desactivado. Se comprobó a propósito.
 *
 * La última es la que explica todo: con un cursor sintético perfectamente
 * quieto, Chromium no vuelve a evaluar el `:hover` aunque el elemento se corra
 * de abajo del puntero. El parpadeo de verdad necesita el micro-temblor de un
 * ratón real, que Playwright no produce.
 *
 * Así que esto NO prueba que no parpadee. Prueba que la zona sensible existe,
 * que llega más abajo que lo que la carta viaja, y que no se enciende antes de
 * tiempo. Es un cerrojo contra que alguien la borre, no una reproducción — y
 * decirlo acá vale más que un verde que parece otra cosa.
 *
 * La comprobación de que el parpadeo se fue es a ojo, con un ratón.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Y NADA DE COMILLAS INVERTIDAS DENTRO DE `PAGINA`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Es un template literal. Una comilla invertida suelta ahí adentro —incluso
 * dentro de un comentario de CSS— lo cierra antes de tiempo, y Playwright no
 * puede cargar el archivo: el informe dice «No tests found», no «error de
 * sintaxis». Ya pasó cinco veces en este proyecto.
 */

import { test, expect } from "@playwright/test";

/** Cuánto sube la carta al hoverearse, según `mesa.css`. */
const VIAJE = 16;

/** Una carta sola, con la hoja de estilos de verdad y nada que la mueva. */
const PAGINA = `
  <link rel="stylesheet" href="/css/tema.css" />
  <link rel="stylesheet" href="/css/mesa.css" />
  <style>
    body { margin: 0; height: 100vh; display: grid; place-items: center; }
    .carta { --giro: 0deg; --desvio: 0px; }
  </style>
  <div id="mano">
    <button class="carta jugable" type="button">
      <span class="lados"><span class="dorso"></span><span class="cara"></span></span>
      <span class="zona-carta" aria-hidden="true"></span>
    </button>
    <button class="carta jugable atacable" type="button">
      <span class="lados"><span class="dorso"></span><span class="cara"></span></span>
      <span class="zona-carta" aria-hidden="true"></span>
    </button>
  </div>`;

async function montarCartas(page) {
  // Se sirve como una página del sitio para que `/css/...` resuelva. Usar
  // `setContent` sobre `mesa.html` no sirve: esa página arranca el juego y sin
  // sesión redirige al login, lo que destruye el contexto a mitad de camino.
  await page.route("**/prueba-carta.html", (r) =>
    r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PAGINA }),
  );
  await page.goto("/prueba-carta.html");
  await page.waitForFunction(() => {
    const c = document.querySelector(".carta.jugable");
    return c && c.getBoundingClientRect().height > 20;
  });
}

const carta = (page) => page.locator(".carta.jugable").first();

test("la zona sensible llega más abajo que lo que la carta viaja", async ({ page }) => {
  await montarCartas(page);

  const bajo = await page.evaluate(() => {
    const z = document.querySelector(".carta.jugable .zona-carta");
    return z ? { existe: true, abajo: getComputedStyle(z).bottom } : { existe: false };
  });

  expect(bajo.existe, "la zona tiene que existir en el marcado").toBe(true);

  // `bottom: -26px` — negativo quiere decir que se extiende HACIA ABAJO.
  const sobresale = -Number.parseFloat(bajo.abajo);
  expect(
    sobresale,
    `la zona sobresale ${sobresale} px y la carta viaja ${VIAJE}: tiene que cubrir ` +
      "también el rebote de la transición, que la pasa de largo",
  ).toBeGreaterThan(VIAJE);
});

test("la zona nace apagada y se enciende con el hover", async ({ page }) => {
  /**
   * Los 26 px de abajo serían una franja que levanta la carta sin tocarla si
   * estuvieran activos siempre. El hover ARRANCA por la caja de la carta; la
   * zona sólo lo SOSTIENE una vez empezado.
   */
  await montarCartas(page);

  const enReposo = await page.evaluate(
    () => getComputedStyle(document.querySelector(".carta.jugable .zona-carta")).pointerEvents,
  );
  expect(enReposo, "en reposo no puede capturar el puntero").toBe("none");

  const caja = await carta(page).boundingBox();
  await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
  await page.waitForTimeout(300);

  const hovereada = await page.evaluate(
    () => getComputedStyle(document.querySelector(".carta.jugable .zona-carta")).pointerEvents,
  );
  expect(hovereada, "hovereada sí, para sostener el hover").toBe("auto");
});

test("una carta atacable tiene zona Y borde punteado", async ({ page }) => {
  /**
   * Las dos cosas a la vez, que es lo que la primera versión no lograba.
   *
   * `::before` ya lo usa `.carta.atacable` para su borde punteado, y `mesa.js`
   * pone las dos clases sobre la misma carta cuando un rival es atacable. Con
   * la zona en ese mismo pseudo-elemento había que elegir: o el borde, o el
   * arreglo del parpadeo. Con un elemento propio no hay que elegir.
   */
  await montarCartas(page);

  const atacable = await page.evaluate(() => {
    const c = document.querySelector(".carta.atacable");
    return {
      borde: getComputedStyle(c, "::before").borderBottomStyle,
      zonaAbajo: getComputedStyle(c.querySelector(".zona-carta")).bottom,
    };
  });

  expect(atacable.borde, "el borde punteado sigue siendo punteado").toBe("dashed");
  expect(
    -Number.parseFloat(atacable.zonaAbajo),
    "y la carta atacable también tiene zona",
  ).toBeGreaterThan(VIAJE);
});
