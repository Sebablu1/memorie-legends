/**
 * Lo que comparten las pruebas de navegador.
 *
 * La mesa se maneja sola: reparte, corre temporizadores y mueve tres IA. Estas
 * ayudas sirven para esperar el momento justo sin escribir un solo `sleep`, que
 * es lo que convierte una suite en algo que funciona en una máquina y falla en
 * la siguiente.
 */

import { expect } from "@playwright/test";

/** Semilla del reparto. Cualquiera sirve mientras no cambie. */
export const SEMILLA = 4242;

export const SEL = {
  pista: "#pista",
  reloj: "#temporizadorTexto",
  modal: "#modal",
  levantar: "#btnLevantar",
  tirar: "#btnTirar",
  cortar: "#btnCortar",
  pasar: "#btnPasar",
  miMano: '.jugador[data-jugador="0"]',
  muestra: "#muestraCarta",
};

/**
 * Abre la mesa con reparto fijo y empieza a anotar todo lo que se rompa.
 *
 * Los errores se juntan desde antes de cargar la página: un fallo al importar
 * un módulo ocurre antes de que corra una sola línea del juego, y engancharse
 * después no lo vería.
 */
export async function abrirMesa(page, { semilla = SEMILLA } = {}) {
  const errores = [];

  // El azar del navegador, fijado antes de que cargue una sola línea del
  // juego.
  //
  // `?semilla=N` fija el REPARTO, pero no alcanza: las IA eligen y reaccionan
  // con `Math.random`, y si una descarta durante la ventana de la ronda, el
  // mazo se corre y la carta que levanto ya no es la misma. Con eso, dos
  // corridas idénticas divergían: una prueba distinta fallaba cada vez, y las
  // que buscaban una carta de poder a veces no la encontraban y se saltaban
  // solas —"9 passed" en vez de 11, que es peor que un rojo porque no se nota—.
  //
  // Se reemplaza acá y no en `ia.js` a propósito: es un arreglo de la prueba,
  // no del juego. En producción el azar sigue siendo azar.
  await page.addInitScript((s) => {
    let x = s >>> 0 || 1;
    Math.random = () => {
      // xorshift32: barato, sin dependencias y bien repartido.
      x ^= x << 13; x >>>= 0;
      x ^= x >> 17;
      x ^= x << 5;  x >>>= 0;
      return x / 4294967296;
    };
  }, semilla);

  page.on("pageerror", (e) => errores.push(String(e.message)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|404 \(Not Found\)/.test(m.text())) {
      errores.push(m.text());
    }
  });

  await page.goto(`/mesa.html?semilla=${semilla}`);
  await expect(page.locator(SEL.pista)).toContainText(/Elegí|carta/i);
  return errores;
}

/** El texto de la pista, sin etiquetas ni espacios de más. */
export const pista = (page) => page.locator(SEL.pista).innerText();

/**
 * Espera a que la pista diga algo.
 *
 * Se usa `expect(...).toContainText`, que reintenta solo, en vez de leer una
 * vez y comparar: la mesa cambia de fase por temporizador y una lectura suelta
 * cae justo en el hueco entre dos fases más veces de las que uno esperaría.
 */
export const esperarPista = (page, patron, opciones) =>
  expect(page.locator(SEL.pista)).toContainText(patron, opciones);

/** Espera a que el reloj muestre una etiqueta concreta ("Descarte", "Mirando"). */
export const esperarReloj = (page, patron, opciones) =>
  expect(page.locator(SEL.reloj)).toContainText(patron, opciones);

/**
 * Cuántos segundos marca el reloj AHORA.
 *
 * Sirve para distinguir la ventana de la ronda de una reapertura sin mirar el
 * reloj de la máquina que corre la prueba: lo dice la propia interfaz.
 */
export async function segundosDelReloj(page) {
  // Ojo con la `i`: el CSS pone el texto en mayúsculas, así que `innerText`
  // devuelve "DESCARTE 5.0S" y no "Descarte 5.0s". Sin ella esto devolvía
  // null y la prueba fallaba culpando al juego.
  const texto = await page.locator(SEL.reloj).innerText();
  const m = texto.match(/([\d.]+)\s*s/i);
  return m ? Number(m[1]) : null;
}

/** Las cartas de mi mano que todavía están (las descartadas dejan un hueco). */
export const misCartas = (page) => page.locator(`${SEL.miMano} .carta`);

/** Atraviesa la mirada del principio de la ronda eligiendo una carta. */
export async function elegirCartaParaMirar(page) {
  await esperarPista(page, /Elegí/i);
  await misCartas(page).first().click();
}

/**
 * Espera a que llegue mi turno y deja la mesa lista para levantar.
 *
 * Puede tardar: primero pasa la ventana de la ronda y después juegan las IA
 * que estén antes. Por eso el plazo largo, y por eso se espera al botón y no a
 * un texto: `#btnLevantar` habilitado es la definición operativa de "es tu
 * turno", la misma que usa la interfaz.
 */
export async function esperarMiTurno(page, { timeout = 70_000 } = {}) {
  await expect(page.locator(SEL.levantar)).toBeEnabled({ timeout });
}

/**
 * Tira la carta levantada, venga como venga.
 *
 * Hay dos caminos y no se puede elegir cuál toca. Si la levantada trae poder,
 * la mesa abre un modal encima y el botón "Tirar" queda tapado; si no, se tira
 * con el botón. Y cuál sale no es predecible ni con la semilla fija: las IA
 * reaccionan con retrasos aleatorios, así que si alguna descarta durante la
 * ventana el mazo se corre y la carta que me toca cambia.
 *
 * Suponer una de las dos ramas era lo que hacía fallar una prueba distinta en
 * cada corrida.
 *
 * @returns "modal" o "boton", por si a la prueba le importa cuál fue.
 */
export async function tirarLaLevantada(page) {
  const desdeElModal = page.locator('[data-accion="tirar-sin-poder"]');
  if (await desdeElModal.isVisible().catch(() => false)) {
    await desdeElModal.click();
    return "modal";
  }
  await page.locator(SEL.tirar).click();
  return "boton";
}

/**
 * Espera a poder cortar, sorteando el poder si aparece uno.
 *
 * Con la regla nueva, entre tirar y decidir el corte puede meterse la elección
 * del poder. La primera versión de esto esperaba 2600 ms fijos y después
 * miraba si había modal: cuando la mesa tardaba un poco más, la comprobación
 * caía antes de que el modal existiera, no lo cerraba, y la prueba se quedaba
 * esperando un botón que nunca se iba a habilitar. Fallaba una de cada dos
 * corridas y no por culpa del juego.
 *
 * Ahora se sondea: en cada vuelta, o ya se puede cortar, o hay un modal que
 * cerrar. Sin números mágicos.
 */
export async function llegarADecidirCorte(page, { timeout = 40_000 } = {}) {
  const corte = page.locator(SEL.cortar);
  const saltar = page.locator('#modal [data-accion="saltar"]');
  const limite = Date.now() + timeout;

  while (Date.now() < limite) {
    if (await corte.isEnabled().catch(() => false)) return true;
    if (await saltar.isVisible().catch(() => false)) {
      await saltar.click();
      continue;
    }
    await page.waitForTimeout(250);
  }
  return false;
}

/**
 * El número de la muestra actual, leído del alt de la imagen.
 *
 * Va contra `.cara` y no contra `img` a secas: cada carta pinta DOS imágenes,
 * el dorso y la cara, porque el volteo es una animación CSS y las dos tienen
 * que estar en el DOM. `img` suelto encuentra las dos y Playwright, con razón,
 * se niega a adivinar cuál.
 */
export async function numeroDeLaMuestra(page) {
  // Del aria-label de la carta y no del alt de la imagen. Las imágenes van con
  // `alt=""` a propósito: cada carta pinta el dorso Y la cara, y un lector de
  // pantalla las leía las dos —"carta boca abajo, tres de espada"—, diciendo
  // el valor de una carta tapada. Ahora el nombre accesible es uno solo, y es
  // el que vale como contrato.
  const etiqueta = await page.locator(SEL.muestra + " .carta").getAttribute("aria-label");
  const m = etiqueta?.match(/(\d+)\s+de\s+/i);
  return m ? Number(m[1]) : null;
}

/** Las últimas líneas del registro, abriéndolo si hace falta. */
export async function registro(page) {
  const panel = page.locator("#registro");
  if (!(await panel.isVisible())) await page.locator("#btnRegistro").click();
  const lineas = await panel.locator("div").allInnerTexts();
  return lineas.map((l) => l.trim());
}
