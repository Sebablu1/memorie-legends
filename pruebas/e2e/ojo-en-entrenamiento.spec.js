/**
 * El ojo también en entrenamiento, y del mismo registro que en red.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ FALTABA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El ojo estaba entero —`ojoEn`, el mapa de `miradas`, el CSS— y sólo lo
 * disparaba `mostrarMiradas`, que corre con una vista del servidor. En
 * entrenamiento no hay servidor, así que no aparecía nunca. En su lugar había
 * un destello de un segundo puesto a mano en el camino de la IA que usa el 7
 * o el 8: una rama, un poder, y ninguna marca para la mirada inicial ni para
 * el 10.
 *
 * El motor es el mismo en los dos modos y anota las mismas líneas, así que
 * `cartasMiradasEn` contesta igual de este lado.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE MIDE LA MIRADA INICIAL Y NO UN PODER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque pasa siempre y pasa al principio. Que salga un 7 o un 8 depende del
 * reparto: una prueba que espere un poder concreto o depende de una semilla
 * —y entonces se rompe el día que cambie el barajado, sin que el ojo tenga
 * nada que ver— o juega rondas hasta que aparezca, y son minutos.
 *
 * La mirada inicial recorre el mismo camino: `miradaInicial` es una de las
 * cuatro clases que contesta `cartasMiradasEn`, y llega por el mismo lector.
 * Si el ojo aparece acá, el mecanismo está conectado; que las cuatro clases
 * se pinten ya lo fija `ojo-del-poder.spec.js` del lado de red.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Y POR QUÉ SE MIDE DESDE ADENTRO DE LA PÁGINA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El ojo dura dos segundos y las cuatro miradas iniciales caen casi juntas.
 * Un `expect` de Playwright que cruce el puente para cada comprobación llega
 * tarde a la mitad, y el fallo se leería como "no hay ojo" cuando lo que pasó
 * es que ya se había ido. Se observa con un `MutationObserver` dentro de la
 * página y después se pregunta qué se vio, que es la misma razón por la que
 * `entrenamiento-ux.spec.js` mide el destello así.
 */

import { test, expect } from "@playwright/test";
import { abrirMesa, elegirCartaParaMirar } from "./mesa.js";

/**
 * Mira la mesa durante `ms` y devuelve todas las cartas que llevaron ojo.
 *
 * Se anota cada aparición en vez del recuento de un instante: los ojos entran
 * y salen, y lo que hay que responder es "¿apareció alguno?", no "¿cuántos hay
 * justo ahora?".
 */
function ojosQueAparecen(page, ms) {
  return page.evaluate((duracion) => {
    const vistos = new Set();

    const anotar = () => {
      for (const carta of document.querySelectorAll(".carta.mirada")) {
        const jugador = carta.closest(".jugador")?.dataset.jugador;
        const posicion = carta.dataset.posicion;
        if (jugador != null && posicion != null) vistos.add(`${jugador}:${posicion}`);
      }
    };

    anotar();
    const observador = new MutationObserver(anotar);
    observador.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    });

    return new Promise((listo) => {
      setTimeout(() => {
        observador.disconnect();
        anotar();
        listo([...vistos]);
      }, duracion);
    });
  }, ms);
}

test("la mirada inicial deja su ojo también en entrenamiento", async ({ page }) => {
  await abrirMesa(page);
  await elegirCartaParaMirar(page);

  const vistos = await ojosQueAparecen(page, 4000);

  expect(
    vistos.length,
    "ningún ojo en toda la apertura: el registro local no se está leyendo",
  ).toBeGreaterThan(0);
});

test("y el ojo cae sobre la mano de un rival, no sólo sobre la propia", async ({ page }) => {
  /**
   * Es la queja que originó esto: «no se está marcando la posición de la carta
   * que ve el rival».
   *
   * Uno mismo es el jugador 0 en entrenamiento, así que cualquier otro índice
   * es un rival. Sin este segundo caso, un ojo que se pintara sólo sobre la
   * mano propia pasaría la prueba de arriba sin resolver nada.
   */
  await abrirMesa(page);
  await elegirCartaParaMirar(page);

  const vistos = await ojosQueAparecen(page, 4000);
  const deRivales = vistos.filter((v) => !v.startsWith("0:"));

  expect(
    deRivales.length,
    `sólo se marcaron cartas propias: ${JSON.stringify(vistos)}`,
  ).toBeGreaterThan(0);
});

test("el ojo se va solo, también acá", async ({ page }) => {
  /**
   * Dos segundos. Si se quedara puesto, a la tercera ronda la mesa estaría
   * empapelada de ojos y dejarían de significar nada.
   *
   * ⚠️ Este caso PASA IGUAL con el arreglo desactivado, y se comprobó a
   * propósito: sin ojos, cero ojos es lo que hay. Sólo significa algo al lado
   * de los dos de arriba, que sí se ponen en rojo — también comprobado. Vale
   * escribirlo acá: un verde que no puede fallar se lee como uno que probó
   * algo.
   */
  await abrirMesa(page);
  await elegirCartaParaMirar(page);

  await expect(page.locator(".carta.mirada")).toHaveCount(0, { timeout: 15_000 });
});
