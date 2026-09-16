/**
 * Las marcas de mirada en entrenamiento, del mismo registro que en red.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ FALTABA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El mecanismo estaba entero —el mapa de `miradas`, el CSS— y sólo lo
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
 * SON DOS MARCAS, Y NO DICEN LO MISMO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 👁️ para los poderes 7, 8 y 10: alguien gastó una carta para mirar y ahora
 * sabe algo. Borde para la mirada del principio de la ronda: no cuesta nada,
 * no la elige nadie y les pasa a los cuatro a la vez.
 *
 * El 9 no lleva ninguna. `cambioCiego` no mira nada, así que el motor no anota
 * línea de mirada y acá no llega — una marca sobre una carta que nadie vio
 * diría algo falso.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE MIDE LA MIRADA INICIAL Y NO UN PODER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque pasa siempre y pasa al principio. Que salga un 7 o un 8 depende del
 * reparto: una prueba que espere un poder concreto o depende de una semilla
 * —y entonces se rompe el día que cambie el barajado, sin que las marcas
 * tengan nada que ver— o juega rondas hasta que aparezca, y son minutos.
 *
 * La mirada inicial recorre el mismo camino: `miradaInicial` es una de las
 * cuatro clases que contesta `cartasMiradasEn`, y llega por el mismo lector.
 * Si su marca aparece acá, el mecanismo está conectado; que cada clase pinte
 * la que le toca ya lo fija `ojo-del-poder.spec.js` del lado de red.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Y POR QUÉ SE MIDE DESDE ADENTRO DE LA PÁGINA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Las marcas duran dos segundos y las cuatro miradas iniciales caen casi
 * juntas. Un `expect` que cruce el puente para cada comprobación llega tarde a
 * la mitad, y el fallo se leería como "no hay marca" cuando lo que pasó
 * es que ya se había ido. Se observa con un `MutationObserver` dentro de la
 * página y después se pregunta qué se vio, que es la misma razón por la que
 * `entrenamiento-ux.spec.js` mide el destello así.
 */

import { test, expect } from "@playwright/test";
import { abrirMesa, elegirCartaParaMirar } from "./mesa.js";

/**
 * Mira la mesa durante `ms` y devuelve todas las cartas que llevaron marca,
 * con cuál de las dos fue.
 *
 * Se anota cada aparición en vez del recuento de un instante: las marcas
 * entran y salen, y lo que hay que responder es "¿apareció alguna?", no
 * "¿cuántas hay justo ahora?".
 */
function marcasQueAparecen(page, ms) {
  return page.evaluate((duracion) => {
    const vistos = new Set();

    const anotar = () => {
      for (const carta of document.querySelectorAll(".carta.mirada, .carta.mirada-inicial")) {
        const jugador = carta.closest(".jugador")?.dataset.jugador;
        const posicion = carta.dataset.posicion;
        // `classList.contains` y no una expresión sobre el atributo: "mirada"
        // es prefijo de "mirada-inicial" y un `/mirada/` las confundiría.
        const cual = carta.classList.contains("mirada-inicial") ? "borde" : "ojo";
        if (jugador != null && posicion != null) vistos.add(`${cual}:${jugador}:${posicion}`);
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

test("la mirada inicial deja su marca también en entrenamiento", async ({ page }) => {
  await abrirMesa(page);
  await elegirCartaParaMirar(page);

  const vistos = await marcasQueAparecen(page, 4000);

  expect(
    vistos.length,
    "ninguna marca en toda la apertura: el registro local no se está leyendo",
  ).toBeGreaterThan(0);
});

test("y la marca cae sobre la mano de un rival, no sólo sobre la propia", async ({ page }) => {
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

  const vistos = await marcasQueAparecen(page, 4000);
  const deRivales = vistos.filter((v) => !v.startsWith("borde:0:") && !v.startsWith("ojo:0:"));

  expect(
    deRivales.length,
    `sólo se marcaron cartas propias: ${JSON.stringify(vistos)}`,
  ).toBeGreaterThan(0);
});

test("la mirada inicial es BORDE, nunca ojo", async ({ page }) => {
  /**
   * La corrección que motivó esta tanda.
   *
   * Al conectar el registro local, la mirada del principio quedó con el mismo
   * 👁️ que un poder — es uno de los cuatro casos de `cartasMiradasEn` y el
   * lector no distinguía. Y no son lo mismo: el ojo anuncia que alguien gastó
   * una carta para mirar, con su cartel y su sonido. La mirada inicial no
   * cuesta nada, no la elige nadie y les pasa a los cuatro a la vez; cuatro
   * ojos idénticos al abrir cada ronda le sacan significado al ojo justo antes
   * de que aparezca el que sí importa.
   *
   * Durante la apertura NO puede haber ningún ojo: los poderes todavía no se
   * jugaron. Es la comprobación que separa las dos marcas de verdad — contar
   * bordes sin exigir cero ojos pasaría igual con el lector sin bifurcar.
   */
  await abrirMesa(page);
  await elegirCartaParaMirar(page);

  const vistos = await marcasQueAparecen(page, 4000);

  expect(
    vistos.filter((v) => v.startsWith("borde:")).length,
    `ningún borde en la apertura: ${JSON.stringify(vistos)}`,
  ).toBeGreaterThan(0);

  expect(
    vistos.filter((v) => v.startsWith("ojo:")),
    "la mirada del principio no es un poder y no puede llevar ojo",
  ).toEqual([]);
});

test("la marca se va sola, también acá", async ({ page }) => {
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

  await expect(page.locator(".carta.mirada, .carta.mirada-inicial"))
    .toHaveCount(0, { timeout: 15_000 });
});
