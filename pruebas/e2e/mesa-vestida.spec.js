/**
 * La mesa vestida: retratos, aro del turno, marcos y botones con dibujo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ HAY PRUEBAS DE ALGO QUE ES DECORACIÓN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque casi nada de esto es decoración.
 *
 * El retrato dice de quién es cada mano. El aro que cuenta dice de quién es el
 * turno y cuánto le queda. El marco verde dice lo mismo desde la otra punta de
 * la pantalla. Los cuatro colores de la botonera son lo que permite elegir sin
 * leer cuando quedan dos segundos. Todo eso es información, y una información
 * que se rompe en silencio es peor que ninguna: la mesa se sigue viendo bien.
 *
 * Lo único que acá se defiende como estética es que el marco no le corte las
 * cartas a nadie, y hasta eso es funcional —una carta cortada por la mitad no
 * se puede tocar—.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE SE MIDE ES EL DOM PINTADO, NO EL CSS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `getComputedStyle` y `boundingBox`, no "existe la clase". Media hoja de este
 * rediseño depende de cosas que se rompen sin errores: un `clip-path` que
 * recorta una sombra que ya no se ve, un `z-index` negativo que se escapa del
 * contexto de apilamiento y deja el asiento dorado y macizo, un
 * `conic-gradient` que no avanza porque nadie le escribe la variable. Nada de
 * eso levanta una excepción. Se ve, o no se ve.
 */

import { test, expect } from "@playwright/test";
import { abrirMesa, misCartas, elegirCartaParaMirar, esperarMiTurno } from "./mesa.js";

const RETRATOS = ".jugador .retrato";

// =====================================================================
// Los retratos
// =====================================================================

test("cada asiento tiene su cara, y no hay dos iguales", async ({ page }) => {
  await abrirMesa(page);

  const caras = await page.locator(`${RETRATOS} img`).evaluateAll((imgs) =>
    imgs.map((i) => new URL(i.src).pathname),
  );

  expect(caras.length, "faltan retratos en la mesa").toBe(4);
  expect(
    new Set(caras).size,
    `dos asientos comparten cara: ${caras.join(", ")}`,
  ).toBe(4);

  // Y cargaron de verdad. Un `src` que apunta a un archivo que no está no
  // rompe nada: deja un hueco, y el hueco se ve como una decisión de diseño.
  const rotas = await page.locator(`${RETRATOS} img`).evaluateAll((imgs) =>
    imgs.filter((i) => !i.naturalWidth).map((i) => i.getAttribute("src")),
  );
  expect(rotas, `retratos que no cargaron: ${rotas.join(", ")}`).toEqual([]);
});

test("el asiento propio lleva la cara de fábrica cuando no hay avatar comprado", async ({
  page,
}) => {
  // Las pruebas sustituyen `guardia-sesion.js`, así que `equipadoEnMesa` no
  // existe y no llega nada de Firestore. Ése es exactamente el caso de la
  // enorme mayoría de las partidas, y el que se rompía: sin fijar el asiento
  // propio, `retratoDe` le daba al jugador local una de las caras de la casa.
  await abrirMesa(page);

  const mia = await page
    .locator('.jugador[data-jugador="0"] .retrato img')
    .evaluate((i) => new URL(i.src).pathname);

  expect(mia).toBe("/img/avatar/predeterminado.webp");
});

test("la cara se ve recortada: entra la figura, no el medallón entero", async ({
  page,
}) => {
  // Los avatares del catálogo son medallones —aro dorado propio y una cinta
  // con el nombre debajo— y no caras. Puestos enteros dentro del aro del
  // asiento se ve un aro adentro de otro y la figura ocupa un tercio.
  //
  // Lo que se comprueba es que la imagen esté AMPLIADA respecto de su ventana.
  // Si alguien le saca el recorte, el ancho de la imagen vuelve a ser el de la
  // ventana y esto se pone en rojo.
  await abrirMesa(page);

  const m = await page.locator(`${RETRATOS} .cara`).first().evaluate((cara) => {
    const img = cara.querySelector("img");
    return {
      ventana: cara.getBoundingClientRect().width,
      imagen: img.getBoundingClientRect().width,
      recorta: getComputedStyle(cara).overflow,
    };
  });

  expect(m.imagen, "la imagen dejó de estar ampliada").toBeGreaterThan(m.ventana * 1.5);
  expect(m.recorta, "la ventana dejó de recortar").toBe("hidden");
});

// =====================================================================
// El aro que cuenta
// =====================================================================

test("el aro cuenta hacia atrás en el asiento del turno, y en uno solo", async ({
  page,
}) => {
  await abrirMesa(page);
  await elegirCartaParaMirar(page);
  await esperarMiTurno(page);

  const contando = page.locator(`${RETRATOS}.contando`);
  await expect(contando, "el aro no aparece cuando toca el turno").toHaveCount(1);

  // Es el mío: `esperarMiTurno` esperó justamente a eso.
  await expect(page.locator('.jugador[data-jugador="0"] .retrato')).toHaveClass(
    /contando/,
  );

  // Y el número dice segundos, igual que el del cartel.
  await expect(contando.locator(".cuenta-asiento")).toHaveText(/^\d+s$/);

  // El aro AVANZA. Es lo único que no se puede afirmar mirando una clase: la
  // vuelta la escribe `temporizadores.js` tick a tick, y si dejara de
  // escribirla el aro se quedaría lleno para siempre sin que falle nada.
  const vuelta = () =>
    contando.evaluate((el) =>
      parseFloat(getComputedStyle(el).getPropertyValue("--vuelta")),
    );

  const antes = await vuelta();
  expect(antes, `el aro arrancó en ${antes} grados`).toBeGreaterThan(90);

  await page.waitForTimeout(1400);
  const despues = await vuelta();
  expect(despues, `el aro no bajó: ${antes} -> ${despues}`).toBeLessThan(antes);
});

test("cuando no le toca a nadie no queda ningún aro encendido", async ({ page }) => {
  // En la mirada y en el descarte puede actuar todo el mundo a la vez: no hay
  // turno. Un aro contando ahí le diría a alguien que le toca a él.
  await abrirMesa(page);

  await expect(page.locator("#anuncio")).toHaveAttribute("data-fase", "mirar");
  await expect(page.locator(`${RETRATOS}.contando`)).toHaveCount(0);
});

// =====================================================================
// El marco del asiento
// =====================================================================

test("el marco se dibuja en dos capas detrás del contenido", async ({ page }) => {
  // El filo dorado y el relleno oscuro son dos seudoelementos con `z-index`
  // negativo. Si el contexto de apilamiento se pierde —basta que alguien saque
  // `isolation: isolate`— las dos capas se van detrás del paño y el asiento
  // desaparece: quedan el nombre y las cartas flotando sobre la mesa.
  await abrirMesa(page);

  const m = await page.locator('.jugador[data-jugador="0"]').evaluate((el) => {
    const filo = getComputedStyle(el, "::before");
    const relleno = getComputedStyle(el, "::after");
    return {
      aisla: getComputedStyle(el).isolation,
      filoFondo: filo.backgroundImage,
      filoCapa: filo.zIndex,
      filoCorte: filo.clipPath,
      rellenoFondo: relleno.backgroundImage,
      rellenoCapa: relleno.zIndex,
    };
  });

  expect(m.aisla, "se perdió el contexto de apilamiento").toBe("isolate");
  expect(m.filoFondo, "el filo dorado desapareció").toContain("gradient");
  expect(m.rellenoFondo, "el relleno oscuro desapareció").toContain("gradient");
  expect(m.filoCorte, "el marco perdió las esquinas cortadas").toContain("polygon");

  // El orden importa: el filo detrás del relleno, y los dos detrás de todo.
  expect(Number(m.filoCapa), "el filo se puso delante del relleno").toBeLessThan(
    Number(m.rellenoCapa),
  );
  expect(Number(m.rellenoCapa), "el relleno tapa el contenido").toBeLessThan(0);
});

test("el asiento en turno se distingue del que no lo está", async ({ page }) => {
  await abrirMesa(page);
  await elegirCartaParaMirar(page);
  await esperarMiTurno(page);

  const filo = (jugador) =>
    page
      .locator(`.jugador[data-jugador="${jugador}"]`)
      .evaluate((el) => getComputedStyle(el, "::before").backgroundImage);

  expect(
    await filo(0),
    "el asiento en turno no cambió de color",
  ).not.toBe(await filo(1));
});

test("el marco no recorta las cartas: lo que se asoma se sigue viendo", async ({
  page,
}) => {
  // Ésta nació en rojo y encontró algo de verdad.
  //
  // El marco se recortaba con `clip-path` en el propio asiento, y `clip-path`
  // corta TAMBIÉN lo que hay adentro. Las cartas de los extremos del abanico
  // van giradas y se asoman unos píxeles del relleno —siempre lo hicieron— y
  // esos píxeles dejaron de dibujarse. A ojo no se ve: la esquina cortada de
  // una carta girada parece parte del diseño.
  //
  // Por eso el recorte vive ahora en las capas del fondo y el asiento no
  // recorta nada.
  await abrirMesa(page);

  const m = await page.evaluate(() => {
    const asiento = document.querySelector('.jugador[data-jugador="0"]');
    const marco = asiento.getBoundingClientRect();
    let sobra = 0;
    for (const c of asiento.querySelectorAll(".carta")) {
      const r = c.getBoundingClientRect();
      sobra = Math.max(
        sobra,
        marco.left - r.left,
        r.right - marco.right,
        marco.top - r.top,
        r.bottom - marco.bottom,
      );
    }
    const suyo = getComputedStyle(asiento);
    return {
      sobra: Math.round(sobra),
      recorta: suyo.clipPath,
      desborda: suyo.overflow,
    };
  });

  // Si el abanico dejara de asomarse, lo de abajo no probaría nada: se podría
  // volver a poner el recorte en el asiento sin que esto se ponga en rojo.
  expect(m.sobra, "el abanico dejó de asomarse del asiento").toBeGreaterThan(0);

  expect(
    m.recorta,
    `el asiento volvió a recortar: se pierden ${m.sobra}px de carta`,
  ).toBe("none");
  expect(m.desborda, "el asiento volvió a esconder lo que se asoma").toBe("visible");
});
// =====================================================================
// Los puntos y la botonera
// =====================================================================

test("cada asiento muestra la ronda y el total por separado", async ({ page }) => {
  await abrirMesa(page);

  const propio = page.locator('.jugador[data-jugador="0"] .puntos');
  await expect(propio.locator(".parcial")).toContainText(/ronda/i);
  await expect(propio.locator(".acumulado")).toContainText(/total/i);

  // Recién repartido, las dos cuentas están en cero. Que la de la ronda diga
  // otra cosa querría decir que alguien la está calculando con las cartas en
  // la mano, y esas cartas están tapadas: sería el marcador contando lo que el
  // jugador no puede ver.
  await expect(propio.locator(".parcial b")).toHaveText("0");
  await expect(propio.locator(".acumulado b")).toHaveText("0");
});

test("los botones llevan dibujo Y palabra, y cada uno su color", async ({ page }) => {
  await abrirMesa(page);

  const BOTONES = [
    ["#btnLevantar", "levantar"],
    ["#btnTirar", "tirar"],
    ["#btnCortar", "cortar"],
    ["#btnPasar", "pasar"],
  ];

  const fondos = [];
  for (const [sel, palabra] of BOTONES) {
    const boton = page.locator(sel);

    // El dibujo no puede reemplazar a la palabra: un botón que es sólo un
    // ícono no tiene nombre que un lector de pantalla pueda decir.
    await expect(boton).toContainText(new RegExp(palabra, "i"));
    await expect(boton.locator("svg.icono-accion")).toHaveCount(1);
    await expect(boton.locator("svg")).toHaveAttribute("aria-hidden", "true");

    fondos.push(await boton.evaluate((b) => getComputedStyle(b).backgroundImage));
  }

  // Cuatro colores distintos. Si dos coinciden, elegir vuelve a ser leer.
  expect(new Set(fondos).size, "hay botones del mismo color").toBe(4);
});

test("el dibujo se apaga con el botón, sin una regla propia", async ({ page }) => {
  // Los SVG van con `currentColor` justamente para esto: el ícono no tiene
  // color propio, hereda el del texto. Un ícono que se queda encendido en un
  // botón apagado invita a tocar algo que no se puede.
  await abrirMesa(page);

  const trazo = await page
    .locator("#btnCortar svg.icono-accion")
    .evaluate((s) => getComputedStyle(s).stroke);
  const texto = await page
    .locator("#btnCortar")
    .evaluate((b) => getComputedStyle(b).color);

  expect(trazo, "el ícono dejó de heredar el color del botón").toBe(texto);
});

// =====================================================================
// El marcador del costado
// =====================================================================

test("el marcador repite las mismas caras que la mesa", async ({ page }) => {
  // Las dibuja la misma función. Si alguna vez se dibujaran por separado, la
  // tabla y la mesa podrían mostrar caras distintas para la misma persona, que
  // es peor que no tener caras.
  await abrirMesa(page);

  // Se compara asiento por asiento y no las dos listas en el orden en que
  // están en el documento: la mesa dibuja los asientos por su lugar en el
  // paño —arriba, izquierda, derecha, uno mismo— y la tabla por el índice
  // del jugador. Las dos listas tienen las mismas caras en distinto orden, y
  // compararlas de frente sólo prueba que el orden coincide, que no importa.
  const enMesa = await page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll(".jugador[data-jugador]")].map((j) => [
        j.dataset.jugador,
        new URL(j.querySelector(".retrato img").src).pathname,
      ]),
    ),
  );
  const enTabla = await page.locator("#marcador .retrato-mini").evaluateAll((i) =>
    Object.fromEntries(i.map((x, n) => [String(n), new URL(x.src).pathname])),
  );

  expect(enTabla).toEqual(enMesa);
});

test("el pie de quién cortó no aparece hasta que alguien corta", async ({ page }) => {
  await abrirMesa(page);
  await expect(page.locator("#quienCorto")).toBeHidden();
});
