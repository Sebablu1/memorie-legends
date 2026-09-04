/**
 * Partidas cortas, el cursor en la PC y el orden de la mirada.
 *
 * Tres cosas distintas que comparten una propiedad: cuando se rompen, la mesa
 * sigue funcionando. Nadie ve un error — se ve un juego que se porta raro.
 *
 *   - Si el límite no llegara al motor, la partida corta duraría lo mismo que
 *     la larga y el jugador tardaría media hora en darse cuenta.
 *   - Si el texto de la selección volviera, cada descarte en una PC dejaría un
 *     número resaltado en azul y el puntero convertido en la barra de
 *     escribir. Parece un error de la página, y no lo es.
 *   - Si la muestra se destapara durante la mirada, el jugador tendría dos
 *     cosas para hacer en los dos segundos en que sólo debería mirar la suya.
 */

import { test, expect } from "@playwright/test";
import {
  abrirMesa,
  elegirCartaParaMirar,
  esperarMiTurno,
  esperarPista,
  llegarADecidirCorte,
  tirarLaLevantada,
  SEL,
} from "./mesa.js";

/** Una configuración de entrenamiento con la duración elegida. */
const conLimite = (limitePuntos) => ({
  modo: "entrenamiento",
  humanos: [{ nombre: "Probador" }],
  ias: [
    { nombre: "Nara", dificultad: "medio" },
    { nombre: "Bruno", dificultad: "dificil" },
    { nombre: "Vex", dificultad: "experto" },
  ],
  limitePuntos,
});

// =====================================================================
// 1. Los tres modos de puntos
// =====================================================================

test("la mesa juega con el límite que se eligió, y lo dice", async ({ page }) => {
  // El lema de la cabecera es el único lugar donde el jugador puede confirmar
  // qué eligió antes de empezar. Con un "límite 150" escrito a mano, una
  // partida corta estaría mintiendo ahí.
  for (const limite of [60, 100, 150]) {
    await abrirMesa(page, { config: conLimite(limite) });
    await expect(page.locator("#lemaMesa")).toContainText(`límite ${limite}`);
  }
});

test("sin configuración, la mesa sigue siendo la de siempre", async ({ page }) => {
  // Quien entre por la URL, o tenga guardada una configuración vieja de antes
  // de que existieran los modos, tiene que jugar la partida de 150 — no caer
  // en una corta sin haberla pedido.
  await abrirMesa(page);
  await expect(page.locator("#lemaMesa")).toContainText("límite 150");
});

test("una configuración rota no cambia el límite", async ({ page }) => {
  // `limitePuntos` viene de localStorage, o sea de algo que cualquiera puede
  // editar. Un valor absurdo tiene que caer en el de siempre y no dejar la
  // mesa en un estado donde nadie se elimina nunca.
  await abrirMesa(page, { config: { ...conLimite(60), limitePuntos: "muchos" } });
  await expect(page.locator("#lemaMesa")).toContainText("límite 150");
});

// =====================================================================
// 2. El cursor y la selección de texto en la PC
// =====================================================================

test("descartar no selecciona el texto de la carta", async ({ page }) => {
  // El fallo: descartar son dos toques, y en una PC dos clics seguidos son un
  // doble clic — que para el navegador significa "seleccioná la palabra de
  // abajo". Las cartas llevan el número de posición adentro, así que cada
  // descarte dejaba ese número resaltado y el puntero como barra de escribir.
  const errores = await abrirMesa(page);

  const carta = page.locator(`${SEL.miMano} .carta[data-posicion="1"]`);
  await expect(carta).toHaveCSS("user-select", "none");

  // Y se comprueba de verdad: dos clics y a ver si quedó algo seleccionado.
  await carta.dblclick();
  const seleccionado = await page.evaluate(() =>
    (window.getSelection()?.toString() ?? "").trim(),
  );
  expect(
    seleccionado,
    `el doble clic dejó texto seleccionado: "${seleccionado}"`,
  ).toBe("");

  expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

test("la mano de puntero aparece sólo sobre lo que se puede tocar", async ({
  page,
}) => {
  await abrirMesa(page);

  // Durante la mirada, las cartas propias se pueden elegir.
  await expect(page.locator(`${SEL.miMano} .carta[data-posicion="0"]`)).toHaveCSS(
    "cursor",
    "pointer",
  );

  // El paño no es tocable, y el puntero no debería sugerir que sí.
  await expect(page.locator("#mesa")).toHaveCSS("cursor", "default");
});

// =====================================================================
// 3. La muestra no se adelanta a la mirada
// =====================================================================

test("la muestra queda tapada hasta que termina la mirada", async ({ page }) => {
  // En el teléfono, donde la muestra y la mano propia entran en la misma
  // pantalla, verla darse vuelta durante la mirada se lee como que el juego se
  // adelantó. Y además reparte la atención en los dos segundos en que
  // justamente hay que estar mirando la carta propia.
  await page.setViewportSize({ width: 390, height: 844 });
  const errores = await abrirMesa(page);

  const muestra = page.locator("#muestraCarta .carta");
  await expect(muestra).toBeVisible();

  // Boca abajo: la clase `visible` es la que da vuelta la carta.
  await expect(
    muestra,
    "la muestra ya estaba dada vuelta durante la mirada",
  ).not.toHaveClass(/visible/);

  // Se elige una carta para mirar y se deja pasar la mirada.
  await page.locator(`${SEL.miMano} .carta[data-posicion="0"]`).click();

  // Ahora sí: cuando llega el descarte, la muestra tiene que estar a la vista
  // —es contra ella que se compara—.
  await expect(page.locator(SEL.reloj)).toContainText(/descarte/i, {
    timeout: 20_000,
  });
  await expect(
    page.locator("#muestraCarta .carta"),
    "la muestra no se dio vuelta al abrir el descarte",
  ).toHaveClass(/visible/);

  expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

// =====================================================================
// 4. Cada ronda se reparte de nuevo, y se ve
// =====================================================================

test.describe("con animaciones", () => {
  test.use({ reducedMotion: "no-preference" });

  test("la ronda siguiente también reparte a la vista", async ({ page }) => {
    // Que el mazo se baraje en cada ronda ya está comprobado en el motor
    // (`pruebas/limite-puntos.mjs`: cinco rondas, cinco repartos distintos).
    // Lo que se comprueba acá es que ADEMÁS se vea.
    //
    // No es cosmética: sin ver volar las cartas, la ronda dos empieza con las
    // cartas ya puestas y no hay nada que distinga "se repartió de nuevo" de
    // "seguimos con el mazo de antes". La sospecha es razonable, y la única
    // forma de despejarla es mostrarlo.
    test.setTimeout(180_000);

    // Un vigía que anota cada reparto. Cuenta rondas, no cartas: sube de a uno
    // por reparto, mirando cuándo la primera carta empieza a volar.
    await page.addInitScript(() => {
      window.__repartos = 0;
      addEventListener("DOMContentLoaded", () => {
        let volando = 0;
        new MutationObserver((cambios) => {
          for (const c of cambios) {
            if (!c.target.classList?.contains("repartiendo")) continue;
            // El primer vuelo de una tanda es un reparto nuevo.
            if (volando === 0) window.__repartos++;
            volando++;
            setTimeout(() => volando--, 1200);
          }
        }).observe(document.body, {
          subtree: true,
          attributes: true,
          attributeFilter: ["class"],
        });
      });
    });

    const errores = await abrirMesa(page);
    await elegirCartaParaMirar(page);

    const trasLaPrimera = await page.evaluate(() => window.__repartos);
    expect(trasLaPrimera, "la primera ronda no repartió a la vista").toBeGreaterThan(0);

    // El camino más corto a la ronda dos: cortar en el primer turno. La ronda
    // termina ahí mismo, sin esperar a que jueguen las tres IA.
    await esperarMiTurno(page);
    await page.locator(SEL.levantar).click();
    await esperarPista(page, /cambiarla|poder/i);
    await tirarLaLevantada(page);

    expect(await llegarADecidirCorte(page), "se llega a la decisión de corte").toBe(true);
    await page.locator(SEL.cortar).click();

    // El resumen de la ronda, con el botón para seguir.
    const seguir = page.locator('[data-accion="siguiente"]');
    await expect(seguir).toBeVisible({ timeout: 60_000 });
    await seguir.click();

    // Y acá está lo que se vino a ver: la ronda dos reparte de nuevo, volando.
    await expect
      .poll(() => page.evaluate(() => window.__repartos), {
        timeout: 30_000,
        intervals: [250],
      })
      .toBeGreaterThan(trasLaPrimera);

    expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
  });
});

// =====================================================================
// 5. La marca de "te toca" dice la verdad
// =====================================================================

test("en la mirada y en el descarte no le toca a nadie", async ({ page }) => {
  // El fallo que arregla, reportado como "el turno no avanza": la mesa marcaba
  // al jugador de mano como EN TURNO desde que empezaba la ronda —durante la
  // mirada y durante toda la ventana de reflejos— y lo seguía marcando después.
  //
  // Pero en esas dos fases no le toca a nadie: puede descartar cualquiera, a la
  // vez. Quien descartaba veía su propio asiento encendido antes, durante y
  // después, y la conclusión razonable era que el turno se le había quedado
  // pegado. El turno estaba bien; lo que mentía era la marca.
  const errores = await abrirMesa(page);

  const enTurno = () => page.locator(".jugador.en-turno").count();

  // Durante la mirada.
  await expect(page.locator(SEL.pista)).toContainText(/tu carta/i);
  expect(await enTurno(), "alguien aparece en turno durante la mirada").toBe(0);

  await page.locator(`${SEL.miMano} .carta[data-posicion="0"]`).click();

  // Durante el descarte.
  await expect(page.locator(SEL.reloj)).toContainText(/descarte/i, { timeout: 20_000 });
  expect(await enTurno(), "alguien aparece en turno durante el descarte").toBe(0);

  // Y cuando SÍ le toca a alguien, se marca: una puerta que nunca se abre
  // tampoco sirve.
  await expect(page.locator(SEL.levantar)).toBeEnabled({ timeout: 40_000 });
  expect(await enTurno(), "nadie queda marcado cuando el turno sí existe").toBe(1);

  // Y el marcado es de quien tiene el turno de verdad.
  await expect(
    page.locator('.jugador[data-jugador="0"]'),
    "el turno es mío pero está marcado otro asiento",
  ).toHaveClass(/en-turno/);

  expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
});
