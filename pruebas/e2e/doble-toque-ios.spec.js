/**
 * El doble toque para descartar, también en iPhone.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL FALLO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Descartar pide dos toques, y el segundo se reconocía con `evento.detail === 2`
 * — el contador de clics del navegador. En PC y en Android cuenta bien. En iOS
 * NO: Safari sintetiza cada toque como un clic con `detail: 1`, así que el 2 no
 * llegaba nunca y el descarte no se disparaba jamás desde un iPhone.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CÓMO SE PRUEBA SIN UN IPHONE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * No alcanza con emular un móvil: Chromium sí cuenta los toques, así que la
 * emulación pasaría con el código roto. Lo que se hace es despachar los clics A
 * MANO con `detail: 1`, que es exactamente lo que manda Safari. Si el código
 * depende del contador del navegador, esto falla; si tiene su propia cuenta,
 * pasa.
 *
 * Se comprueban las dos direcciones, porque las dos rompen el juego:
 *
 *   - que DOS toques descarten (si no, iPhone no puede jugar);
 *   - que TRES toques descarten UNA sola vez (si no, el jugador se come dos
 *     cartas de castigo por apurarse, que es peor que no poder descartar).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO CORRE EN CHROMIUM Y NO EN WEBKIT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Parece al revés —el fallo era de Safari— pero no lo es: los eventos se
 * fabrican acá, con `detail: 1` puesto a mano. El navegador que los reciba no
 * cambia lo que se está midiendo. Si alguien vuelve a `evento.detail === 2`,
 * estos clics tampoco traen un 2 y la prueba falla igual en Chromium.
 *
 * Se intentó agregar un proyecto de Playwright con WebKit —el motor de Safari,
 * o sea de TODO navegador en iPhone— y se descartó: la mesa arranca su reloj
 * con la página y corre sola la mirada y la ventana de descarte. WebKit tarda
 * más en llegar, y en esta máquina —con poca memoria libre— perdía esa carrera
 * una de cada tres corridas. Una prueba intermitente no protege nada: se
 * empieza a ignorar, y el día que falla de verdad nadie la mira.
 *
 * Que Safari manda `detail: 1` en los dos toques está comprobado a mano
 * corriendo WebKit contra producción: devolvió `[1, 1, 1]`. Ese dato es el que
 * justifica esta prueba; no hace falta recomprobarlo en cada corrida.
 */

import { test, expect } from "@playwright/test";
import { abrirMesa, elegirCartaParaMirar, SEL } from "./mesa.js";

/**
 * Espera la ventana de descarte y toca, TODO adentro de la página.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ADENTRO Y NO DESDE LA PRUEBA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La ventana de descarte dura cinco segundos, abre una vez por ronda y después
 * el juego se queda esperando que uno levante: si se pierde, no vuelve.
 *
 * Manejarla desde afuera es una carrera que se pierde sola. Cada `evaluate`,
 * cada `count()` y cada `expect` cruzan el puente entre el proceso de la prueba
 * y el navegador, y ese viaje cuesta. La primera versión de esta prueba
 * manejaba la ventana desde afuera y fallaba cada tanto —no por un fallo del
 * juego, sino porque los toques llegaban tarde—; con la máquina cargada, en
 * Chromium puede pasar lo mismo.
 *
 * Acá se manda UN solo viaje. La página espera la ventana, toca, mira y
 * contesta; entre que la ventana abre y el segundo toque llega no hay ningún
 * cruce. Deja de medirse la velocidad del navegador y vuelve a medirse lo
 * único que importa: si el juego cuenta bien los toques.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA MIRADA TAMBIÉN VA ADENTRO, Y SE ESPERA EL FLANCO DE SUBIDA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Sacar los viajes de adentro de la ventana no alcanzó: quedaba el viaje de
 * ENTRAR. Inyectar el vigía cuando la ventana ya llevaba 4,9 segundos abiertos
 * lo dejaba ver "Descarte" —cierto— y tocar justo cuando se cerraba. El fallo
 * se reconocía porque la pista contestaba "Es tu turno. Levantá una carta del
 * mazo.": no era el juego ignorando el toque, era el toque llegando tarde.
 *
 * De ahí que la mirada del principio de la ronda se haga TAMBIÉN acá adentro,
 * en vez de usar `elegirCartaParaMirar`. Lanzar el vigía en paralelo con ese
 * clic parecía más prolijo, pero el clic de Playwright y el `evaluate`
 * pendiente se estorban: la corrida se colgaba noventa segundos en
 * `locator.click`. Un solo hilo, de punta a punta, no tiene ese problema.
 *
 * El precio es que este archivo no usa `elegirCartaParaMirar` como el resto de
 * las pruebas de mesa. Es a propósito y es el único lugar donde conviene: acá
 * lo que se mide son milisegundos, y ese helper cuesta un viaje entero.
 *
 * Y no se espera "que el reloj diga Descarte" sino que PASE a decirlo:
 * primero se confirma que NO lo dice —la ventana todavía no abrió— y recién
 * entonces se espera a que abra. Así siempre se toca sobre el borde de
 * arranque, con los cinco segundos enteros por delante.
 *
 * No sirve pedir "que queden al menos cuatro segundos": la ventana abre una
 * sola vez por ronda, y si ya se perdió, esa espera no termina nunca —el juego
 * se queda esperando que uno levante—. Eso convertía un fallo rápido en un
 * plantón de noventa segundos.
 *
 * Devuelve lo observado —cuántas cartas había antes, qué pasó tras el primer
 * toque, cómo quedó al final— para que las afirmaciones sigan estando en la
 * prueba, donde se leen.
 */
async function tocarEnLaVentana(
  page,
  { toques, pausaTrasElPrimero = 0, pausaFinal = 600 },
) {
  return page.evaluate(
    async ({ toques, pausaTrasElPrimero, pausaFinal, sel }) => {
      const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
      const texto = (s) => document.querySelector(s)?.textContent ?? "";
      const mano = () =>
        document.querySelectorAll(`${sel.miMano} .carta`).length;

      // `dispatchEvent` y no un clic de verdad: el navegador le pondría
      // `detail: 2` al segundo, que es justo lo que iOS NO hace. Para
      // reproducir el iPhone hay que fabricar el evento.
      const tocar = ([j, p]) => {
        const carta = document.querySelector(
          `.jugador[data-jugador="${j}"] .carta[data-posicion="${p}"]`,
        );
        if (!carta) throw new Error(`no hay carta en ${j}:${p}`);
        carta.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            detail: 1,
          }),
        );
      };

      const limite = Date.now() + 60_000;
      const hasta = async (listo, queFaltaba) => {
        while (!listo()) {
          if (Date.now() > limite) throw new Error(queFaltaba());
          await dormir(16);
        }
      };

      // La mirada del principio de la ronda. Es un toque simple sobre la
      // primera carta propia, igual que el que hace `elegirCartaParaMirar`
      // desde afuera.
      await hasta(
        () => /mirar/i.test(texto(sel.pista)),
        () => `no llegó la mirada: la pista dice "${texto(sel.pista)}"`,
      );
      tocar([0, 0]);

      const abierta = () => /descarte/i.test(texto(sel.reloj));

      // Primero, que la ventana NO esté abierta. Es lo que garantiza que el
      // "abre" de abajo sea el arranque de verdad y no la cola de una ventana
      // que ya venía corriendo.
      await hasta(
        () => !abierta(),
        () => "la ventana de descarte ya estaba abierta y no cerró",
      );

      // Y ahora sí, el flanco de subida. En cuanto abre, se toca.
      await hasta(
        abierta,
        () =>
          `la ventana de descarte no abrió: el reloj dice "${texto(sel.reloj)}"`,
      );

      const antes = mano();

      tocar(toques[0]);
      await dormir(pausaTrasElPrimero);
      const trasElPrimero = { cartas: mano(), pista: texto(sel.pista) };

      for (const t of toques.slice(1)) tocar(t);
      await dormir(pausaFinal);

      return { antes, trasElPrimero, despues: mano(), pista: texto(sel.pista) };
    },
    { toques, pausaTrasElPrimero, pausaFinal, sel: SEL },
  );
}

test("dos toques con detail:1 —como iOS— descartan", async ({ page }) => {
  const errores = await abrirMesa(page);

  const visto = await tocarEnLaVentana(page, {
    toques: [
      [0, 1],
      [0, 1],
    ],
    // Con pausa en el medio, para poder mirar qué dejó el PRIMER toque solo.
    pausaTrasElPrimero: 150,
  });

  expect(visto.antes, "la mano tendría que arrancar con cuatro").toBe(4);

  // Un solo toque NO descarta: un roce accidental no puede costar una carta.
  expect(visto.trasElPrimero.cartas, "un solo toque descartó").toBe(
    visto.antes,
  );
  expect(visto.trasElPrimero.pista).toMatch(/dos veces/i);

  // El segundo, sí. Descartar acierta o falla —depende de la carta— pero en
  // los dos casos la mano CAMBIA: al acertar se va la carta, al fallar entra
  // una de castigo. Lo que no puede pasar es que no ocurra nada, que era
  // exactamente el fallo en iPhone.
  expect(
    visto.despues !== visto.antes ||
      /acert|falla|castigo|descart/i.test(visto.pista),
    `el segundo toque no hizo nada: la mano sigue en ${visto.despues} y la pista dice "${visto.pista}"`,
  ).toBe(true);

  expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

test("tres toques seguidos descartan UNA vez, no dos", async ({ page }) => {
  // Ésta es la que protege el bolsillo del jugador. Con una detección ingenua
  // —"cualquier toque después del primero"— una ráfaga de tres dispara dos
  // intentos, y cada intento fallido cuesta una carta de castigo.
  const errores = await abrirMesa(page);

  const visto = await tocarEnLaVentana(page, {
    toques: [
      [0, 1],
      [0, 1],
      [0, 1],
    ],
    pausaFinal: 900,
  });

  // Un intento cambia la mano en UNO: se va la carta acertada, o entra una de
  // castigo. Dos intentos la cambiarían en dos.
  const cambio = Math.abs(visto.despues - visto.antes);
  expect(
    cambio,
    `la mano cambió en ${cambio}: la ráfaga disparó más de un intento`,
  ).toBeLessThanOrEqual(1);

  expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

test("dos toques en cartas DISTINTAS no son un doble toque", async ({
  page,
}) => {
  // Tocar una carta y enseguida otra es mirar dos, no descartar. Si la cuenta
  // no mirara CUÁL carta se tocó, el segundo toque descartaría la segunda
  // carta sin que nadie lo haya pedido.
  const errores = await abrirMesa(page);

  const visto = await tocarEnLaVentana(page, {
    toques: [
      [0, 1],
      [0, 2],
    ],
  });

  expect(visto.despues, "tocar dos cartas distintas descartó una").toBe(
    visto.antes,
  );

  expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

test("las cartas no se comen el doble toque con el zoom de iOS", async ({
  page,
}) => {
  // `touch-action: manipulation` es la otra mitad del arreglo. Sin él, en iOS
  // el doble toque sobre una carta es el gesto de ZOOM: Safari se lo queda y el
  // segundo toque no llega nunca como clic, por más que el JavaScript sepa
  // contarlos.
  //
  // Esto es CSS, así que no hace falta esperar ninguna ventana: alcanza con que
  // las cartas estén en pantalla. Esperarla era pedirle a una prueba de estilos
  // que ganara una carrera contra el reloj del juego, y perderla cada tanto por
  // algo que no tiene nada que ver con lo que mide.
  await abrirMesa(page);
  await elegirCartaParaMirar(page);

  const valor = await page
    .locator('.jugador[data-jugador="0"] .carta[data-posicion="1"]')
    .evaluate((el) => getComputedStyle(el).touchAction);

  expect(
    valor,
    "sin `manipulation`, iOS se queda el segundo toque para hacer zoom",
  ).toContain("manipulation");
});
