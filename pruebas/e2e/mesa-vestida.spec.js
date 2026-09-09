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
import { geometriaAbanico } from "../../public/js/modulos/cartas.js";

/**
 * Pone en cada mano la escala que el juego le pondría con `n` cartas, y
 * clona hasta llegar a esa cantidad.
 *
 * Se clona en el DOM en vez de jugar hasta recibir tres castigos: lo que se
 * mide es el CSS que acomoda la mano, y eso depende de cuántas cartas hay, no
 * de cómo llegaron. Jugar hasta siete llevaría minutos y dependería del azar.
 *
 * La escala sale de `geometriaAbanico`, que es la MISMA función que usa
 * `dibujarJugador`. Escribir un número acá probaría el CSS contra un valor
 * inventado.
 */
async function conCartas(page, n) {
  await page.evaluate(
    ({ n, propio, rival }) => {
      for (const mano of document.querySelectorAll(".jugador .mano")) {
        const esMia = mano.closest(".jugador").classList.contains("propio");
        mano.style.setProperty("--escala", esMia ? propio : rival);
        const base = [...mano.children];
        while (mano.children.length > 4) mano.lastElementChild.remove();
        for (let i = 4; i < n; i++) mano.append(base[i % base.length].cloneNode(true));
      }
    },
    {
      n,
      propio: geometriaAbanico(n, true).escala,
      rival: geometriaAbanico(n, false).escala,
    },
  );
}

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

test("el asiento no dibuja ninguna caja alrededor del jugador", async ({ page }) => {
  // El asiento tuvo un marco: filo dorado, relleno oscuro y esquinas
  // cortadas. Con cuatro de esos sobre un paño que ya tiene su textura, la
  // mesa era todo bordes y el ojo no sabía dónde pararse.
  //
  // Ahora el asiento es lo que importa —la cara, el nombre y las cartas—
  // apoyado directamente sobre el paño. Lo que se defiende es que no vuelva
  // a aparecer una caja: ni borde, ni relleno, ni recorte.
  await abrirMesa(page);

  const m = await page.locator('.jugador[data-jugador="1"]').evaluate((el) => {
    const propio = getComputedStyle(el);
    const relleno = getComputedStyle(el, "::after");
    return {
      borde: propio.borderTopWidth,
      recorte: propio.clipPath,
      fondo: propio.backgroundImage,
      rellenoFondo: relleno.backgroundImage,
      rellenoContenido: relleno.content,
    };
  });

  expect(m.borde, "volvió el borde del asiento").toBe("0px");
  expect(m.recorte, "volvieron las esquinas cortadas").toBe("none");
  expect(m.fondo, "volvió el fondo del asiento").toBe("none");
  expect(m.rellenoFondo, "volvió el relleno oscuro").toBe("none");
});

test("al que le toca se lo distingue por un halo, no por un contorno", async ({
  page,
}) => {
  // Sin caja hay que decir de otra manera a quién le toca. Un contorno
  // volvería a ser una caja, así que es un resplandor difuso detrás del
  // asiento: dice QUIÉN. El aro alrededor del retrato dice CUÁNTO le queda.
  await abrirMesa(page);
  await elegirCartaParaMirar(page);
  await esperarMiTurno(page);

  const halo = (jugador) =>
    page
      .locator(`.jugador[data-jugador="${jugador}"]`)
      .evaluate((el) => Number(getComputedStyle(el, "::before").opacity));

  expect(await halo(0), "el asiento en turno no se enciende").toBe(1);
  expect(await halo(1), "un asiento que no juega también está encendido").toBe(0);

  // Y sigue siendo un resplandor y no un borde.
  const borde = await page
    .locator('.jugador[data-jugador="0"]')
    .evaluate((el) => getComputedStyle(el, "::before").borderTopWidth);
  expect(borde, "el halo se volvió un contorno").toBe("0px");
});
test("la mano entra en su asiento: ni tapa las pilas ni se sale del paño", async ({
  page,
}) => {
  // Los castigos suman cartas. Los asientos laterales tienen media mesa menos
  // el centro, y una mano de siete que no entre tapa el mazo y la muestra:
  // las dos cosas que hay que mirar para saber si se puede descartar.
  //
  // Se mide contra las CARTAS de las pilas y no contra la caja del centro. La
  // caja incluye los rótulos y su aire, y una esquina de carta girada la roza
  // por cinco píxeles sin tapar absolutamente nada. Lo que no se puede tapar
  // son las cartas.
  await abrirMesa(page);

  for (const cuantas of [4, 5, 7, 10]) {
    await conCartas(page, cuantas);

    const m = await page.evaluate(() => {
      const pilas = [...document.querySelectorAll(".pila .carta, .pila .hueco")]
        .map((c) => c.getBoundingClientRect());
      const paño = document.querySelector(".mesa").getBoundingClientRect();

      let tapa = 0;
      let sale = 0;
      for (const c of document.querySelectorAll(".mano > .carta, .mano > .hueco")) {
        const b = c.getBoundingClientRect();
        for (const p of pilas) {
          const x = Math.min(b.right, p.right) - Math.max(b.left, p.left);
          const y = Math.min(b.bottom, p.bottom) - Math.max(b.top, p.top);
          if (x > 0 && y > 0) tapa = Math.max(tapa, Math.min(x, y));
        }
        sale = Math.max(sale, paño.left - b.left, b.right - paño.right);
      }
      return { tapa: Math.round(tapa), sale: Math.round(sale) };
    });

    expect(m.tapa, `con ${cuantas} cartas la mano tapa las pilas ${m.tapa}px`).toBeLessThanOrEqual(0);
    expect(m.sale, `con ${cuantas} cartas la mano se sale del paño ${m.sale}px`).toBeLessThanOrEqual(0);
  }
});
test("con más de cuatro cartas encogen, no se apilan", async ({ page }) => {
  // La otra mitad de lo mismo: que entren no puede lograrse escondiéndolas.
  //
  // Éste no es un juego de cartas cualquiera, es de MEMORIA: cada carta es una
  // posición que hay que recordar y tocar, y lleva su número escrito en la
  // esquina. Una carta metida debajo de la de al lado esconde justamente eso.
  // Antes se solapaban a partir de la quinta, y con ocho —dos castigos— media
  // mano quedaba debajo de la otra media.
  await abrirMesa(page);

  const anchoDeUna = () =>
    page
      .locator('.jugador[data-jugador="0"] .mano > .carta')
      .first()
      .evaluate((c) => c.getBoundingClientRect().width);

  const conCuatro = await anchoDeUna();
  await conCartas(page, 7);
  const conSiete = await anchoDeUna();

  expect(
    conSiete,
    `las cartas no encogieron: ${Math.round(conCuatro)} -> ${Math.round(conSiete)}`,
  ).toBeLessThan(conCuatro);

  // Y siguen sin montarse.
  //
  // Esto se mide en el MARGEN y no comparando las cajas de dos cartas vecinas.
  // El abanico las gira hasta trece grados, y la caja de una carta girada es
  // veinticuatro píxeles más ancha que la carta: dos vecinas que no se tocan
  // tienen las cajas superpuestas. Medir ahí acusaba de apilado a un abanico
  // perfectamente abierto.
  //
  // Lo que apilaba era un margen NEGATIVO —`margin-inline: calc(var(--solape)
  // / -2)`, que crecía con cada carta de más—. Mientras el margen no sea
  // negativo y haya `gap`, el flex garantiza que las cajas de disposición no
  // se solapen: no hay forma de que una carta quede debajo de otra.
  const m = await page.evaluate(() => {
    const carta = document.querySelector('.jugador[data-jugador="0"] .mano > .carta');
    const suyo = getComputedStyle(carta);
    const mano = getComputedStyle(carta.closest(".mano"));
    return {
      izquierda: parseFloat(suyo.marginLeft),
      derecha: parseFloat(suyo.marginRight),
      hueco: parseFloat(mano.columnGap) || 0,
    };
  });

  expect(m.izquierda, `margen izquierdo ${m.izquierda}px: las cartas se montan`).toBeGreaterThanOrEqual(0);
  expect(m.derecha, `margen derecho ${m.derecha}px: las cartas se montan`).toBeGreaterThanOrEqual(0);
  expect(m.hueco, "las cartas quedaron pegadas, sin aire entre ellas").toBeGreaterThan(0);
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
