/**
 * En el teléfono, el cuadro del poder muestra UNA mano por vez.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE ESTÁ CUIDANDO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Con cuatro jugadores el cuadro del 9 y del 10 muestra cuatro manos, y
 * apiladas no entran: medido antes de este cambio, la ventana pedía 19 px de
 * scroll adentro suyo a 375×667 y 46 a 360×640. Lo que quedaba abajo del corte
 * era una mano entera, sin ninguna barra a la vista que avisara que había más.
 *
 * Achicar la carta fue la salida anterior y llegó a su piso —40 px de ancho,
 * anotado en `mesa.css`—, así que la que queda es mostrar menos a la vez. Con
 * una sola mano a la vista la carta pasa de 42 px de ancho a 84.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LAS TRES COSAS QUE NO SE PUEDEN ROMPER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. CERO SCROLL adentro de la ventana. Es el motivo del cambio.
 * 2. La POSICIÓN. Esto es un juego de memoria: la mano del cuadro tiene que
 *    estar en el mismo orden que la de la mesa, y `data-pos` tiene que seguir
 *    siendo la dirección original de la carta para el motor —la que el hueco de
 *    una carta ya descartada NO corre—. Si eso se mueve, el jugador elige una
 *    carta y juega otra.
 * 3. QUE SE PUEDA LLEGAR a las manos escondidas. Un grupo por vez sin forma de
 *    pasar al siguiente es peor que el scroll.
 *
 * En escritorio nada de esto corre: los cuatro grupos se ven juntos, como
 * siempre, y las pestañas no se dibujan. Eso también se comprueba acá, porque
 * es lo que mantiene en pie a las otras cuatro suites del cuadro del poder
 * —`poderes-orden`, `poder10`, `poder-diez`, `entregar-a-rival`—, que corren
 * todas en el viewport de escritorio y no saben que esto existe.
 *
 * Las semillas son las de `poderes-orden.spec.js`: con ellas la primera carta
 * que se levanta es el poder. Si algún día cambia el barajado, la prueba lo
 * dice con todas las letras en vez de fallar por otra cosa.
 */

import { test, expect } from "@playwright/test";
import { abrirMesa, elegirCartaParaMirar, esperarMiTurno, SEL } from "./mesa.js";

/** Un teléfono parado y uno chico: los dos que pedían scroll. */
const TELEFONOS = [
  { nombre: "390x844", width: 390, height: 844 },
  { nombre: "375x667", width: 375, height: 667 },
  { nombre: "360x640", width: 360, height: 640 },
];

/**
 * Deja el cuadro de elegir objetivo abierto, con el poder que pide la semilla.
 *
 * @returns los errores de consola, para que cada prueba los revise al final.
 */
async function abrirElCuadro(page, { numero, semilla }) {
  const errores = await abrirMesa(page, { semilla });
  await elegirCartaParaMirar(page);
  await esperarMiTurno(page);
  await page.locator(SEL.levantar).click();

  const titulo = page.locator(`${SEL.modal} h2`);
  await expect(titulo, `la semilla ${semilla} ya no da un ${numero}`).toContainText(
    `PODER ${numero}`,
    { timeout: 10_000 },
  );
  await page.locator('[data-accion="usar-poder"]').click();

  // Entre el poder y el cuadro corre la ventana de reflejos de la carta
  // tirada: el cuadro aparece cuando termina.
  await expect(page.locator("#modal .objetivos")).toBeVisible({ timeout: 20_000 });
  return errores;
}

/** Las manos que se están VIENDO, con la posición de cada carta. */
function manosALaVista(page) {
  return page.locator("#modal .objetivos > .grupo-objetivo:visible").evaluateAll((grupos) =>
    grupos.map((grupo) => ({
      titulo: grupo.querySelector(".titulo")?.textContent?.trim() ?? "",
      objetivo: grupo.querySelector("[data-objetivo]")?.dataset.objetivo ?? null,
      posiciones: [...grupo.querySelectorAll("[data-pos]")].map((c) => c.dataset.pos),
    })),
  );
}

for (const tel of TELEFONOS) {
  test.describe(`cuadro del poder en ${tel.nombre}`, () => {
    test.use({ viewport: { width: tel.width, height: tel.height } });

    test("una mano por vez, sin scroll y con cartas grandes", async ({ page }) => {
      test.setTimeout(180_000);
      const errores = await abrirElCuadro(page, { numero: 9, semilla: 4 });

      // UNA, y es la propia: el 9 pide elegir primero una carta tuya.
      const alaVista = await manosALaVista(page);
      expect(alaVista.length, "se ve más de una mano a la vez").toBe(1);
      expect(alaVista[0].titulo, "la primera que se ve no es la tuya").toBe("Tus cartas");

      // Cero scroll. Es el motivo del cambio, así que va medido y no a ojo.
      const sobra = await page
        .locator("#modal")
        .evaluate((el) => el.scrollHeight - el.clientHeight);
      expect(sobra, `la ventana pide ${sobra} px de scroll adentro`).toBeLessThanOrEqual(1);

      // La carta, más grande que las 42 de antes. No se afirma un número
      // exacto: depende del ancho del teléfono —75 px en uno de 360, 83 en uno
      // de 390— y lo que importa es que creció de verdad, no que mida tanto.
      const ancho = await page
        .locator("#modal .objetivos > .grupo-objetivo.actual .carta")
        .first()
        .evaluate((el) => el.getBoundingClientRect().width);
      expect(ancho, "la carta del cuadro no creció").toBeGreaterThan(60);

      expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
    });

    test("las pestañas llevan a las manos escondidas", async ({ page }) => {
      test.setTimeout(180_000);
      const errores = await abrirElCuadro(page, { numero: 9, semilla: 4 });

      const pestanas = page.locator("#modal .paso-grupo");
      await expect(pestanas.first()).toBeVisible();
      const cuantas = await pestanas.count();
      expect(cuantas, "con cuatro jugadores tienen que haber cuatro pestañas").toBe(4);

      // La última, que es la que quedaba fuera de la pantalla. Un toque, no
      // tres: el reloj del poder vence a los 10 segundos.
      await pestanas.nth(cuantas - 1).click();

      const alaVista = await manosALaVista(page);
      expect(alaVista.length, "tocar una pestaña dejó dos manos a la vista").toBe(1);
      expect(alaVista[0].titulo, "la pestaña no llevó a la mano que decía").not.toBe(
        "Tus cartas",
      );
      await expect(pestanas.nth(cuantas - 1)).toHaveAttribute("aria-pressed", "true");
      await expect(pestanas.first()).toHaveAttribute("aria-pressed", "false");

      expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
    });

    test("elegir la carta propia pasa solo a la del rival", async ({ page }) => {
      test.setTimeout(180_000);
      const errores = await abrirElCuadro(page, { numero: 9, semilla: 4 });

      // El camino de siempre del 9: una carta tuya y una de un rival. Si no
      // avanzara solo, acá habría un toque de más contra el reloj.
      await page.locator('#modal .objetivos [data-objetivo="0"]').first().click();

      const alaVista = await manosALaVista(page);
      expect(alaVista.length, "quedaron dos manos a la vista").toBe(1);
      expect(alaVista[0].objetivo, "no pasó a la mano de un rival").not.toBe("0");

      expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
    });

    test("la mano del cuadro está en el mismo orden que la de la mesa", async ({ page }) => {
      test.setTimeout(180_000);
      const errores = await abrirElCuadro(page, { numero: 9, semilla: 4 });

      // `data-pos` en el cuadro y `data-posicion` en la mesa son la MISMA
      // dirección, la que entiende el motor. Lo que se comprueba es que la
      // lista sea la misma y en el mismo orden: eso es la memoria de posición.
      const enElCuadro = (await manosALaVista(page))[0].posiciones;
      const enLaMesa = await page
        .locator(`${SEL.miMano} .carta[data-posicion]`)
        .evaluateAll((cartas) => cartas.map((c) => c.dataset.posicion));

      expect(enElCuadro, "el cuadro no muestra ninguna carta tuya").not.toEqual([]);
      expect(
        enElCuadro,
        `el cuadro dice ${enElCuadro.join(",")} y la mesa ${enLaMesa.join(",")}`,
      ).toEqual(enLaMesa);

      expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
    });
  });
}

test("en escritorio se siguen viendo las cuatro manos juntas", async ({ page }) => {
  // Esto es lo que sostiene a `poderes-orden`, `poder10`, `poder-diez` y
  // `entregar-a-rival`: las cuatro corren en el viewport de escritorio y buscan
  // la carta de un rival sin pasar por ninguna pestaña. Si el paso a paso se
  // colara arriba de 480 px, las cuatro se caerían a la vez y ninguna diría por
  // qué. Ésta sí lo dice.
  test.setTimeout(180_000);
  const errores = await abrirElCuadro(page, { numero: 10, semilla: 23 });

  const alaVista = await manosALaVista(page);
  expect(alaVista.length, "en escritorio se escondió alguna mano").toBeGreaterThan(1);
  expect(alaVista.at(0).titulo, "tus cartas no quedaron arriba de todo").toBe("Tus cartas");
  await expect(page.locator("#modal .paso-grupos")).toBeHidden();

  expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
});
