/**
 * La mesa en un teléfono, y la promesa de no haberle tocado nada a la de PC.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE ROMPIÓ, PARA ENTENDER QUÉ SE DEFIENDE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El diseño de escritorio pone a los rivales de los costados en posición
 * absoluta y les tapa el ancho al 32% del paño, para que sus manos no invadan
 * el mazo. De 950 para abajo la mesa deja de ser un óvalo y pasa a ser una
 * grilla, y ahí ese 32% se resuelve contra la CELDA: a 768 dejaba a cada rival
 * en 76 píxeles, y a 360 sus cartas encogían hasta DIEZ.
 *
 * Diez píxeles no se leen como un problema. Se leen como que el rival no tiene
 * cartas. Y los tres nombres, que no encogen, se dibujaban unos encima de
 * otros.
 *
 * O sea que una regla escrita para un diseño se estaba aplicando a otro. Eso
 * es lo que esta suite vigila, en los dos sentidos: que el teléfono se vea, y
 * que arreglarlo no le haya cambiado nada a la pantalla grande.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE MIDE Y NO SE MIRA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque una mesa rota en el teléfono sigue pareciendo una mesa. No hay
 * excepción, no hay error en consola, no hay nada en rojo: hay cartas de diez
 * píxeles. La única forma de que eso falle sola es medirlo.
 */

import { test, expect } from "@playwright/test";
import { abrirMesa } from "./mesa.js";

/** Los anchos que existen de verdad, no los redondos. */
const TELEFONOS = [
  { nombre: "iPhone SE", width: 320, height: 568 },
  { nombre: "Android común", width: 360, height: 740 },
  { nombre: "iPhone 14", width: 390, height: 844 },
  { nombre: "iPhone Plus", width: 414, height: 896 },
];

/**
 * El ancho por debajo del cual una carta deja de ser una carta.
 *
 * A 26 píxeles todavía se distingue el dorso rojo del azul, que es lo único
 * que dice de quién es cada mano. Por debajo, no.
 */
const MINIMO_LEGIBLE = 26;

const medir = (page) =>
  page.evaluate(() => {
    const caja = (s) => document.querySelector(s).getBoundingClientRect();
    const paño = caja(".mesa");
    const doc = document.documentElement;

    let cartaMasChica = Infinity;
    let seSale = 0;
    for (const c of document.querySelectorAll(".mano > .carta, .mano > .hueco")) {
      const b = c.getBoundingClientRect();
      cartaMasChica = Math.min(cartaMasChica, b.width);
      seSale = Math.max(seSale, paño.left - b.left, b.right - paño.right);
    }

    // Nombres de rivales pisándose: es lo que se veía a 360.
    const nombres = [...document.querySelectorAll(".asiento:not(.asiento-abajo) .nombre")]
      .map((n) => n.getBoundingClientRect());
    let choque = 0;
    for (let i = 0; i < nombres.length; i++) {
      for (let j = i + 1; j < nombres.length; j++) {
        const x = Math.min(nombres[i].right, nombres[j].right) - Math.max(nombres[i].left, nombres[j].left);
        const y = Math.min(nombres[i].bottom, nombres[j].bottom) - Math.max(nombres[i].top, nombres[j].top);
        if (x > 0 && y > 0) choque = Math.max(choque, Math.min(x, y));
      }
    }

    // Texto recortado por su caja: el total del rival se cortaba.
    const cortado = [...document.querySelectorAll(".jugador .nombre, .jugador .puntos")]
      .filter((t) => t.scrollWidth > t.clientWidth + 1)
      .map((t) => t.textContent.trim().slice(0, 30));

    const tapados = [...document.querySelectorAll("button.accion")]
      .filter((b) => {
        const q = b.getBoundingClientRect();
        const e = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
        return !b.contains(e) && e !== b;
      })
      .map((b) => b.textContent.trim());

    return {
      cartaMasChica: Math.round(cartaMasChica),
      seSale: Math.round(seSale),
      choque: Math.round(choque),
      cortado,
      tapados,
      scrollVertical: doc.scrollHeight > doc.clientHeight,
      scrollLateral: doc.scrollWidth > doc.clientWidth,
    };
  });

// =====================================================================
// El teléfono
// =====================================================================

for (const tel of TELEFONOS) {
  test(`${tel.nombre} (${tel.width}px): la mesa entra y las cartas se ven`, async ({ page }) => {
    await page.setViewportSize({ width: tel.width, height: tel.height });
    await abrirMesa(page);

    const m = await medir(page);

    expect(
      m.cartaMasChica,
      `la carta más chica mide ${m.cartaMasChica}px`,
    ).toBeGreaterThanOrEqual(MINIMO_LEGIBLE);

    expect(m.seSale, `una carta se sale ${m.seSale}px del paño`).toBeLessThanOrEqual(0);
    expect(m.choque, `dos nombres de rival se pisan ${m.choque}px`).toBe(0);
    expect(m.cortado, `texto recortado: ${m.cortado.join(" | ")}`).toEqual([]);
    expect(m.tapados, `botones tapados: ${m.tapados.join(", ")}`).toEqual([]);
    expect(m.scrollLateral, "la página se mueve de costado").toBe(false);
    expect(m.scrollVertical, "la mesa no entra a lo alto").toBe(false);
  });
}

test("en el teléfono el rival es una fila: cara a la izquierda, cartas a la derecha", async ({
  page,
}) => {
  // Tres rivales uno al lado del otro no entran en 360 píxeles: a cada uno le
  // tocarían 101, y sólo la cara y el nombre piden más que eso. Apilados en
  // filas, cada uno tiene el ancho entero de la pantalla para sus cartas.
  await page.setViewportSize({ width: 360, height: 740 });
  await abrirMesa(page);

  const m = await page.evaluate(() => {
    const asiento = document.querySelector(".asiento-izq");
    const cara = asiento.querySelector(".cabecera-jugador").getBoundingClientRect();
    const mano = asiento.querySelector(".mano").getBoundingClientRect();
    return {
      // Misma fila: se solapan verticalmente.
      mismaFila: Math.min(cara.bottom, mano.bottom) - Math.max(cara.top, mano.top) > 0,
      // Y la mano está a la derecha de la cara.
      manoALaDerecha: mano.left >= cara.right - 1,
      posicion: getComputedStyle(asiento).position,
    };
  });

  expect(m.mismaFila, "la cara y las cartas quedaron en renglones distintos").toBe(true);
  expect(m.manoALaDerecha, "las cartas no están a la derecha de la cara").toBe(true);
  expect(m.posicion, "el asiento sigue posicionado como en el óvalo").not.toBe("absolute");
});

test("del rival se muestra el total, que es el número que importa mirar", async ({
  page,
}) => {
  // Los dos no entran en el ancho que le queda a la cara, y el que se cortaba
  // era justo el total. De un rival lo que hay que saber es cuánto le falta
  // para pasarse del límite; lo de la ronda anterior se ve entero en el
  // marcador del final de ronda.
  await page.setViewportSize({ width: 360, height: 740 });
  await abrirMesa(page);

  await expect(page.locator(".asiento-izq .puntos .acumulado")).toBeVisible();
  await expect(page.locator(".asiento-izq .puntos .parcial")).toBeHidden();

  // En el asiento propio hay ancho de sobra y siguen los dos.
  await expect(page.locator(".asiento-abajo .puntos .acumulado")).toBeVisible();
  await expect(page.locator(".asiento-abajo .puntos .parcial")).toBeVisible();
});

// =====================================================================
// Y la promesa: la pantalla grande no se tocó
// =====================================================================

test("en pantalla grande sigue el óvalo, con los laterales absolutos", async ({ page }) => {
  // El arreglo del teléfono fue mover una regla a una consulta de medios. Lo
  // que hay que comprobar es que la regla siga aplicándose donde SÍ
  // corresponde: si alguien la mueve de más, las manos laterales vuelven a
  // meterse encima del mazo y eso no se nota hasta que tapan la muestra.
  await page.setViewportSize({ width: 1440, height: 900 });
  await abrirMesa(page);

  const m = await page.evaluate(() => {
    const izq = getComputedStyle(document.querySelector(".asiento-izq"));
    const paño = document.querySelector(".mesa").getBoundingClientRect();
    return {
      posicion: izq.position,
      // El tope existe y es una fracción del paño, no el paño entero.
      tope: parseFloat(izq.maxWidth),
      ancho: Math.round(paño.width),
      // Y los rivales vuelven a mostrar las dos cuentas.
      rondaDelRival: getComputedStyle(
        document.querySelector(".asiento-izq .puntos .parcial"),
      ).display,
    };
  });

  expect(m.posicion, "los laterales dejaron de ser absolutos en pantalla grande").toBe("absolute");
  expect(
    m.tope,
    `el tope del lateral es ${m.tope}px sobre un paño de ${m.ancho}px`,
  ).toBeLessThan(m.ancho * 0.4);
  expect(m.rondaDelRival, "se perdió la ronda del rival en pantalla grande").not.toBe("none");
});

test("en pantalla grande la mano lateral no llega al mazo", async ({ page }) => {
  // Lo que el tope protege. Se mide contra las cartas de las pilas, que es lo
  // que no se puede tapar.
  await page.setViewportSize({ width: 1440, height: 900 });
  await abrirMesa(page);

  const tapa = await page.evaluate(() => {
    const pilas = [...document.querySelectorAll(".pila .carta, .pila .hueco")]
      .map((c) => c.getBoundingClientRect());
    let peor = 0;
    for (const c of document.querySelectorAll(".asiento-izq .carta, .asiento-der .carta")) {
      const b = c.getBoundingClientRect();
      for (const p of pilas) {
        const x = Math.min(b.right, p.right) - Math.max(b.left, p.left);
        const y = Math.min(b.bottom, p.bottom) - Math.max(b.top, p.top);
        if (x > 0 && y > 0) peor = Math.max(peor, Math.min(x, y));
      }
    }
    return Math.round(peor);
  });

  expect(tapa, `una mano lateral tapa las pilas ${tapa}px`).toBeLessThanOrEqual(0);
});
