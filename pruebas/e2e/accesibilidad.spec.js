/**
 * La mesa, para quien no la ve.
 *
 * `mesa.html` no tenía UN SOLO atributo aria. Los botones de la cabecera eran
 * emoji sueltos, así que un lector de pantalla decía "pergamino", "altavoz" y
 * "puerta" en vez de qué hacen. Y cada carta pintaba dos imágenes —dorso y
 * cara, para que el volteo sea una animación—, las dos con `alt`, de modo que
 * una carta tapada se leía como "carta boca abajo, tres de espada": el valor
 * que justamente no se puede decir.
 *
 * Se prueba contra el ÁRBOL DE ACCESIBILIDAD y no contra los atributos. Que el
 * HTML tenga `aria-label` no demuestra que el nombre llegue: puede quedar
 * pisado por el contenido, o el elemento puede no exponer rol de botón.
 */

import { test, expect } from "@playwright/test";
import { abrirMesa, elegirCartaParaMirar, misCartas, SEL } from "./mesa.js";

test("los botones de la cabecera dicen qué hacen, no qué emoji son", async ({ page }) => {
  await abrirMesa(page);

  for (const [id, nombre] of [
    ["btnRegistro", /registro/i],
    ["btnSonido", /sonido|silenciar/i],
    ["btnAbandonar", /abandonar/i],
  ]) {
    const boton = page.locator(`#${id}`);
    await expect(boton).toHaveAccessibleName(nombre);
  }
});

test("los botones de acción tienen nombre y estado", async ({ page }) => {
  await abrirMesa(page);

  for (const sel of [SEL.levantar, SEL.tirar, SEL.cortar, SEL.pasar]) {
    const boton = page.locator(sel);
    const nombre = await boton.evaluate((b) => b.textContent.trim());
    expect(nombre.length, `${sel} tiene texto`).toBeGreaterThan(0);
    // `disabled` de verdad, no una clase: un lector anuncia "no disponible" y
    // el tabulador lo saltea. Una clase CSS no hace ninguna de las dos cosas.
    expect(await boton.evaluate((b) => b.hasAttribute("disabled"))).toBe(true);
  }
});

test("una carta tapada NO dice su valor", async ({ page }) => {
  await abrirMesa(page);

  // Antes de mirar, las cuatro de mi mano están boca abajo.
  const cartas = misCartas(page);
  const cuantas = await cartas.count();
  expect(cuantas).toBeGreaterThan(0);

  for (let i = 0; i < cuantas; i++) {
    const nombre = await cartas.nth(i).getAttribute("aria-label");
    expect(nombre, "toda carta tiene nombre accesible").toBeTruthy();
    expect(nombre, `la carta ${i} no delata su palo`).not.toMatch(
      /oro|copa|espada|basto/i,
    );
    expect(nombre).toMatch(/boca abajo/i);
  }

  // Y las imágenes no meten un segundo nombre por la ventana.
  const altsConTexto = await page
    .locator(`${SEL.miMano} .carta img[alt]:not([alt=""])`)
    .count();
  expect(altsConTexto, "las imágenes van con alt vacío: el nombre es uno solo").toBe(0);
});

test("la pista se anuncia sola, y el temporizador no", async ({ page }) => {
  await abrirMesa(page);

  // La pista dice qué se puede hacer: es el canal principal.
  await expect(page.locator(SEL.pista)).toHaveAttribute("aria-live", "polite");

  // El temporizador se repinta cada 80 ms. Anunciarlo sería un lector hablando
  // sin parar, así que queda fuera del árbol.
  await expect(page.locator("#temporizador")).toHaveAttribute("aria-hidden", "true");
});

test("el foco del teclado se ve", async ({ page }) => {
  await abrirMesa(page);
  await elegirCartaParaMirar(page);

  // Con el TECLADO, no con `.focus()` a mano: `:focus-visible` sólo se activa
  // cuando el navegador considera que el foco tiene que verse, y un foco
  // programático después de un clic no cuenta. Probarlo con `.focus()` daba un
  // rojo que no era del CSS sino de la prueba.
  await page.keyboard.press("Tab");
  for (let i = 0; i < 30; i++) {
    const esCarta = await page.evaluate(() =>
      document.activeElement?.classList.contains("carta"));
    if (esCarta) break;
    await page.keyboard.press("Tab");
  }

  const contorno = await page.evaluate(() => {
    const e = getComputedStyle(document.activeElement);
    return {
      carta: document.activeElement?.classList.contains("carta"),
      ancho: e.outlineWidth,
      estilo: e.outlineStyle,
    };
  });
  expect(contorno.carta, "el tabulador llega a una carta").toBe(true);
  expect(contorno.estilo).not.toBe("none");
  expect(parseFloat(contorno.ancho)).toBeGreaterThan(0);
});

test("el modal se anuncia como diálogo", async ({ page }) => {
  await abrirMesa(page);
  const modal = page.locator("#modal");
  await expect(modal).toHaveAttribute("role", "dialog");
  await expect(modal).toHaveAttribute("aria-modal", "true");
});
