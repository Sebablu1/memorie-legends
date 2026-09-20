/**
 * Las cartas, lo más grandes que entren en cada pantalla.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE PIDE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Que se vean lo más grandes posible, con el CENTRO —mazo, levantada y
 * muestra— por encima de todo: es donde se mira para decidir. Y que nada
 * quede cortado, tapado ni con scroll.
 *
 * La proporción, en los ocho escalones de pantalla:
 *
 *     centro = mano propia + 5%        centro = rivales + 40%
 *
 * Primero el centro heredaba el tamaño de los rivales y quedaba en dos
 * tercios de la mano propia: las cartas más chicas de la mesa eran las que
 * hay que leer. Después pasó a la mano más un 15%, y ese alto salió de los
 * rivales, que quedaron en 78 px de ancho en una pantalla de 1920 — tres
 * cartas de cada cuatro en la mesa son de un rival.
 *
 * Con el +5%, el foco sigue estando donde tiene que estar y los rivales
 * recuperan entre un 12% y un 23%. Donde el rival no crece es porque lo frena
 * el ANCHO de su renglón, no el alto: en el teléfono su mano comparte fila
 * con la cara y el nombre.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTA PRUEBA, Y NO MIRAR CAPTURAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque el alto de la ventana es el recurso escaso y todo compite por él:
 * subir una carta baja otra, y lo que entra en un portátil de 1920 se sale en
 * uno de 1366. Las medidas de acá salieron de una búsqueda automática del
 * máximo que entra en cada pantalla, y esta prueba las sostiene: si alguien
 * agranda algo —una carta, un retrato, un relleno— y deja de entrar, se ve
 * acá y no en el teléfono de un jugador.
 *
 * Los mínimos van un poco por debajo de lo medido, para que un cambio de
 * fuente o de borde no la ponga roja sin que nada esté mal de verdad.
 */

import { test, expect } from "@playwright/test";
import { abrirMesa } from "./mesa.js";

/**
 * [nombre, ancho, alto, densidad, mínimos]
 *
 * Los tamaños son de una carta propia, una del centro y una de rival, en
 * píxeles de CSS. Van un 4% por debajo de lo medido, para que un cambio de
 * fuente o de borde no ponga esto en rojo sin que nada esté mal de verdad.
 *
 * `rivalesPorAncho` marca las pantallas donde al rival lo frena el ancho de
 * su renglón y no el alto: ahí el centro queda mucho más de un 40% por encima
 * y no tiene sentido exigir la proporción.
 */
const PANTALLAS = [
  ["PC 1920×945", 1920, 945, 1, { propia: 119, centro: 125, rival: 89 }],
  ["PC 1536×730", 1536, 730, 1, { propia: 76, centro: 79, rival: 53 }],
  ["Notebook 1366×657", 1366, 657, 1, { propia: 65, centro: 68, rival: 48 }],
  ["Notebook 1280×620", 1280, 620, 1, { propia: 61, centro: 64, rival: 46 }],
  ["iPhone 390×664", 390, 664, 3, { propia: 53, centro: 55, rival: 36 }],
  ["iPhone 430×740", 430, 740, 3, { propia: 57, centro: 60, rival: 42 }],
  ["iPhone 390×844", 390, 844, 3, { propia: 71, centro: 74, rival: 38, rivalesPorAncho: true }],
  ["Android 412×780", 412, 780, 2.625, { propia: 69, centro: 72, rival: 41, rivalesPorAncho: true }],
  ["Pixel 412×915", 412, 915, 2.625, { propia: 74, centro: 78, rival: 41, rivalesPorAncho: true }],
  ["iPhone SE 375×553", 375, 553, 2, { propia: 37, centro: 39, rival: 27 }],
  ["Tablet 768×950", 768, 950, 2, { propia: 133, centro: 147, rival: 51, rivalesPorAncho: true }],
  ["Tablet 1024×700", 1024, 700, 2, { propia: 72, centro: 75, rival: 51 }],
  ["Teléfono acostado 740×360", 740, 360, 3, { propia: 24, centro: 25, rival: 17 }],
];

/** Lo que mide y lo que choca, leído de la página ya dibujada. */
async function medir(page) {
  return page.evaluate(() => {
    const tam = (sel) => {
      const el = document.querySelector(sel);
      return el ? { ancho: el.offsetWidth, alto: el.offsetHeight } : { ancho: 0, alto: 0 };
    };
    const caja = (el) => el.getBoundingClientRect();
    const pisa = (a, b) =>
      a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;

    const cartas = [...document.querySelectorAll(".carta")].map(caja);
    // El cartel y la botonera: los dos que quedaban tapados por la mano
    // cuando el paño se derramaba hacia abajo.
    const fijos = [document.querySelector("#anuncio"), document.querySelector(".acciones")]
      .filter(Boolean)
      .map(caja);
    const centro = [...document.querySelectorAll(".centro .carta, .centro .hueco")].map(caja);
    const asientos = [
      ...document.querySelectorAll(".asiento .carta, .asiento .retrato, .asiento .nombre"),
    ].map(caja);
    const d = document.documentElement;

    return {
      propia: tam(".jugador.propio .mano > .carta"),
      rival: tam(".jugador:not(.propio) .mano > .carta"),
      centro: tam("#muestraCarta .carta"),
      tapados: cartas.filter((c) => fijos.some((f) => pisa(c, f))).length,
      choques: centro.filter((c) => asientos.some((s) => pisa(c, s))).length,
      afuera: cartas.filter(
        (c) => c.bottom > d.clientHeight + 1 || c.right > d.clientWidth + 1 || c.left < -1,
      ).length,
      scrollH: d.scrollWidth > d.clientWidth,
      scrollV: d.scrollHeight > d.clientHeight,
    };
  });
}

for (const [nombre, ancho, alto, densidad, minimos] of PANTALLAS) {
  test(`${nombre}: todo entra y el centro manda`, async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: ancho, height: alto },
      deviceScaleFactor: densidad,
      reducedMotion: "reduce",
      baseURL: "http://localhost:5000",
    });
    const page = await ctx.newPage();
    await abrirMesa(page, { semilla: 29 });
    await page.waitForSelector('.jugador[data-jugador="0"] .mano > .carta');

    const m = await medir(page);
    const contexto = JSON.stringify(m);

    // Nada cortado, nada tapado, nada con scroll.
    expect(m.tapados, `cartas encima del cartel o de la botonera: ${contexto}`).toBe(0);
    expect(m.choques, `el centro choca con un asiento: ${contexto}`).toBe(0);
    expect(m.afuera, `cartas fuera de la pantalla: ${contexto}`).toBe(0);
    expect(m.scrollH, `la mesa no entra a lo ancho: ${contexto}`).toBe(false);
    expect(m.scrollV, `la mesa no entra a lo alto: ${contexto}`).toBe(false);

    // El centro, por encima de la mano propia: un 5%, ni más ni menos. Si se
    // fuera para arriba, el alto se lo estaría sacando a los otros dos.
    const contraMano = m.centro.ancho / m.propia.ancho;
    expect(contraMano, `centro contra mano propia: ${contexto}`).toBeGreaterThanOrEqual(1.03);
    expect(contraMano, `el centro se comió el alto de la mano: ${contexto}`)
      .toBeLessThanOrEqual(1.12);

    // Y por encima de los rivales, pero sin aplastarlos: un 40%.
    const contraRivales = m.centro.ancho / m.rival.ancho;
    expect(contraRivales, `centro contra rivales: ${contexto}`).toBeGreaterThanOrEqual(1.25);
    if (!minimos.rivalesPorAncho) {
      expect(contraRivales, `los rivales volvieron a quedar chicos: ${contexto}`)
        .toBeLessThanOrEqual(1.6);
    }

    // Y lo más grandes que entren: si algo las achica, se ve acá.
    expect(m.propia.ancho, `la mano propia encogió: ${contexto}`)
      .toBeGreaterThanOrEqual(minimos.propia);
    expect(m.centro.ancho, `el centro encogió: ${contexto}`)
      .toBeGreaterThanOrEqual(minimos.centro);
    expect(m.rival.ancho, `las cartas de los rivales encogieron: ${contexto}`)
      .toBeGreaterThanOrEqual(minimos.rival);

    await ctx.close();
  });
}

test("el cartel de medidas sólo aparece si se lo pide", async ({ page }) => {
  /**
   * `?debug-cartas=1` es la herramienta con la que se ajustaron estos
   * tamaños: dice qué mide cada carta sin tener que adivinar. Se comprueba
   * que exista —para que no se pierda en un cambio— y, sobre todo, que no
   * aparezca en una mesa normal.
   */
  await abrirMesa(page, { semilla: 29 });
  await expect(page.locator(".debug-cartas"), "el cartel de medidas se coló en la mesa")
    .toHaveCount(0);

  /**
   * Y con él, el número de posición de cada carta.
   *
   * Estaba dibujado en las dieciséis cartas de la mesa, las de los rivales
   * incluidas: sobre la mano propia era ruido, y sobre la ajena un dato que en
   * una mesa de verdad no existe. Sigue viajando en el `aria-label` del botón,
   * que es donde lo necesita quien no ve la pantalla.
   */
  const numeros = page.locator(".carta .posicion");
  await expect(numeros.first(), "la carta trae su número, oculto").toBeAttached();
  await expect(numeros.first(), "el número de posición se ve jugando").toBeHidden();
  await expect(
    page.locator('.jugador.propio .mano > .carta').first(),
    "y el número sigue anunciándose para quien no ve la pantalla",
  ).toHaveAttribute("aria-label", /Posición \d/);

  await page.goto("/mesa.html?semilla=29&debug-cartas=1");
  await page.waitForSelector('.jugador[data-jugador="0"] .mano > .carta');
  const cartel = page.locator(".debug-cartas");
  await expect(cartel).toBeVisible();
  await expect(cartel).toContainText("mano:");
  await expect(cartel).toContainText("centro:");

  // Y ahí sí: el número vuelve, que es para lo que sirve.
  await expect(page.locator(".carta .posicion").first(),
               "con la bandera puesta el número se ve").toBeVisible();
});

test("con siete cartas, la mano del teléfono se monta en vez de desaparecer", async ({
  browser,
}) => {
  /**
   * Siete cartas son cuatro más tres castigos: no es un caso raro.
   *
   * Sin montarlas, el abanico las encogía a 0,66 del tamaño y el número de la
   * esquina dejaba de leerse. Ahora se superponen un poco y conservan su
   * tamaño. Lo que se comprueba es eso: que entren de lado a lado, que sigan
   * siendo tocables y que ninguna se salga.
   */
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 664 },
    deviceScaleFactor: 3,
    reducedMotion: "reduce",
    baseURL: "http://localhost:5000",
  });
  const page = await ctx.newPage();
  await abrirMesa(page, { semilla: 29 });
  await page.waitForSelector('.jugador[data-jugador="0"] .mano > .carta');

  const r = await page.evaluate(() => {
    const mano = document.querySelector(".jugador.propio .mano");
    const cartas = [...mano.querySelectorAll(":scope > .carta")];
    // Se clonan hasta llegar a siete, que es lo que dibujaría el motor con
    // tres castigos encima.
    for (let i = cartas.length; i < 7; i++) mano.appendChild(cartas[i % cartas.length].cloneNode(true));
    const puestas = [...mano.querySelectorAll(":scope > .carta")];
    const d = document.documentElement;
    // Lo que ocupan las siete juntas, de la primera a la última. No se mide el
    // `scrollWidth` de la mano: el abanico las gira, y una carta girada asoma
    // de su caja también con cuatro.
    const cajas = puestas.map((c) => c.getBoundingClientRect());
    const izquierda = Math.min(...cajas.map((b) => b.left));
    const derecha = Math.max(...cajas.map((b) => b.right));

    return {
      cuantas: puestas.length,
      ancho: puestas[0].offsetWidth,
      usado: Math.round(derecha - izquierda),
      pantalla: d.clientWidth,
      seSalen: izquierda < -1 || derecha > d.clientWidth + 1,
    };
  });

  const contexto = JSON.stringify(r);
  expect(r.cuantas).toBe(7);
  expect(r.seSalen, `una carta quedó fuera de la pantalla: ${contexto}`).toBe(false);
  expect(r.usado, `las siete no entran de lado a lado: ${contexto}`)
    .toBeLessThanOrEqual(r.pantalla);
  // Un dedo necesita unos 44 px. Con siete cartas montadas, cada una conserva
  // su ancho completo aunque se solapen; encogiendo, quedaban en 37.
  expect(r.ancho, `con siete cartas quedaron demasiado chicas: ${contexto}`)
    .toBeGreaterThanOrEqual(50);

  await ctx.close();
});
