/**
 * Al terminar una ronda en red, la siguiente tiene que poder jugarse.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL BUG, COMO SE VIO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * En producción, desde la primera ronda: al terminar, «el cronómetro llega a
 * cero, se reinicia, y vuelve a cero», y la partida no pasa a la ronda
 * siguiente. Al recargar, la ronda 2 estaba ahí: el servidor había avanzado.
 *
 * Eran dos bugs con un solo síntoma:
 *
 *   A. El resultado de la ronda se abría al cortar y NADIE LO CERRABA al
 *      llegar la siguiente. «Ronda 1 terminada» tapaba la ronda 2 entera, y
 *      el reloj de cada turno —que también se pinta dentro de los modales—
 *      corría encima de ese cartel.
 *
 *   B. En red, el reloj del turno era LOCAL y actuaba: al llegar a cero
 *      corría el motor sobre la copia del estado y el bucle del
 *      entrenamiento. Sin ninguna vista nueva, el turno pasaba solo de un
 *      jugador al siguiente cada ocho segundos.
 *
 * Una sonda sobre el código viejo mostró los dos juntos:
 *
 *   t+0s  | velo abierto | ✂️ Cortó Beto | reloj del modal: 8s | turno de: 0
 *   t+8s  | velo abierto | ✂️ Cortó Beto | reloj del modal: 8s | turno de: 1
 *   t+16s | velo abierto | ✂️ Cortó Beto | reloj del modal: 8s | turno de: 2
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CÓMO SE ARMA CADA CASO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `window.__caso.secuencia` es la lista de vistas que publica el servidor,
 * cada una con cuántos milisegundos después de suscribirse llega. El reloj
 * es el de `page.clock`, así que ocho segundos se adelantan sin esperarlos.
 *
 * Y SIN COMILLAS INVERTIDAS DENTRO DE `partidaFalsa`: es un template literal,
 * y una suelta adentro lo cierra antes de tiempo. Playwright informa «No
 * tests found», no un error de sintaxis.
 */

import { test, expect } from "@playwright/test";

const js = (body) => ({ status: 200, contentType: "text/javascript; charset=utf-8", body });

const SESION_FALSA = `
  export const COLECCION = "users";
  export const CAMPO_SALDO = "credits";
  export async function exigirSesion() {
    return {
      usuario: { uid: "ana", email: "a@b.c", photoURL: null },
      perfil: { uid: "ana", nombre: "Ana", saldo: 500 },
    };
  }
  export function mostrarSaldo() {}
  export function conectarBotonSalir() {}
  export function formatearEspera() { return "listo"; }
`;

const firebaseFalso = `
  const SALA = {
    codigo: "ABCDEF",
    estado: "jugando",
    entrada: 50,
    jugadores: ["ana", "beto", "caro", "dani"],
    jugadoresNombres: ["Ana", "Beto", "Caro", "Dani"],
    maxJugadores: 4,
  };
  export const db = {};
  export const doc = (...a) => a;
  export const collection = (...a) => a;
  export const query = (...a) => a;
  export const orderBy = () => null;
  export const where = () => null;
  export const getDocs = async () => ({ docs: [] });
  export const getDoc = async () => ({ exists: () => true, data: () => SALA });
  export const onSnapshot = (ref, alRecibir) => {
    alRecibir({ exists: () => true, data: () => SALA });
    return () => {};
  };
  export const funciones = {};
  export const httpsCallable = () => async () => ({ data: {} });
  export const auth = { currentUser: { uid: "ana" } };
  export const SUPPORT_EMAIL = "soporte@memorie-legends.com";
`;

/**
 * La partida, publicando la secuencia que pida el caso.
 *
 * Cada paso lleva la fase y lo que haga falta de lo demás. `plazo` va como
 * `{ fase, faltan }` y se convierte en un vencimiento absoluto al publicarse,
 * que es como lo manda el servidor.
 */
const partidaFalsa = `
  const tapada = { oculta: true };
  const IDS = ["ana", "beto", "caro", "dani"];
  const CASO = window.__caso ?? {};

  export const ahoraDelServidor = () => Date.now();
  export const relojActual = () => ({ desfase: 0, incertidumbre: 10 });
  export const sincronizarReloj = async () => {};
  export const mantenerVivo = () => () => {};
  export const mantenerEnMarcha = () => () => {};
  export const nuevoIdDeAccion = () => "a1";
  export const saltarAusente = async () => {};
  export const volver = async () => {};
  export const calentarDescarte = async () => true;
  export const latir = async () => {};
  export const accion = async () => {};
  export const mirar = async () => {};
  export const levantar = async () => {};
  export const tirarCarta = async () => {};
  export const cortar = async () => {};
  export const pasarTurno = async () => {};
  export const cambiarCarta = async () => {};
  export const resolverCambio = async () => {};
  export const saltarPoder = async () => {};
  export const intentarDescarte = async () => {};
  export const abrirVentanaDescarte = async () => {};
  export const cerrarVentanaDescarte = async () => {};
  export const cerrarMirada = async () => {};
  export const avanzarPartida = async () => {};
  export const MS_ENTRE_GOLPES = 900;
  export const MS_ENTRE_LATIDOS = 5000;
  export const escucharMisLogros = () => () => {};

  const vista = (paso, version) => ({
    version,
    fase: paso.fase,
    ronda: paso.ronda ?? 1,
    yo: 0, indiceMano: 0,
    indiceTurno: paso.indiceTurno ?? 2,
    turnosRonda: 0,
    indiceCortador: paso.indiceCortador ?? null,
    desempate: false, registro: [],
    cartasEnMazo: 20, cartasEnDescarte: 1, muestra: null, levantada: null,
    poderPendiente: null,
    cambioPendiente: paso.cambioPendiente ?? null,
    puedeAtacar: [],
    puntosDeMano: paso.puntosDeMano ?? null,
    plazo: paso.plazo
      ? { fase: paso.plazo.fase, marca: "m" + version, hasta: Date.now() + paso.plazo.faltan, que: "saltarTurno" }
      : null,
    ausentes: [], ausentesPorTiempo: [],
    jugadores: ["Ana", "Beto", "Caro", "Dani"].map((nombre, i) => ({
      id: IDS[i], nombre,
      retrato: null, dorso: null, insignia: null, marco: null, titulo: null,
      puntos: 0, puntosRonda: 0,
      eliminado: false, eliminadoEnRonda: null,
      cartasEnMano: 4, mano: [tapada, tapada, tapada, tapada],
    })),
  });

  export function escucharMiVista(codigo, uid, alRecibir) {
    (CASO.secuencia ?? []).forEach((paso, n) => {
      const publicar = () => alRecibir(vista(paso, n + 1));
      if (!paso.despues) publicar();
      else setTimeout(publicar, paso.despues);
    });
    return () => {};
  }
`;

async function abrirRed(page, secuencia) {
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));
  await page.clock.install({ time: new Date("2026-09-16T12:00:00Z") });
  await page.addInitScript((s) => {
    window.__caso = { secuencia: s };
  }, secuencia);

  await page.route("**/js/guardia-sesion.js", (r) =>
    r.fulfill(js(`export async function exigirSesionEnMesa(){
      return { uid: "ana", email: "a@b.c" };
    }`)));
  await page.route("**/js/sesion.js", (r) => r.fulfill(js(SESION_FALSA)));
  await page.route("**/js/firebase.js", (r) => r.fulfill(js(firebaseFalso)));
  await page.route("**/js/partida-red.js", (r) => r.fulfill(js(partidaFalsa)));

  await page.goto("/mesa.html?sala=ABCDEF");
  await page.waitForSelector(".jugador .retrato");
  return errores;
}

const velo = (page) => page.locator("#velo");
const turnoDe = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".jugador.en-turno")].map((j) => j.dataset.jugador).join(","),
  );

/** La secuencia real de un corte: turno → resultado → mirada → turno propio. */
const CORTE = [
  { fase: "turno", ronda: 1 },
  { fase: "finRonda", ronda: 1, indiceCortador: 1, puntosDeMano: [3, 1, 7, 9], despues: 500 },
  { fase: "mirar", ronda: 2, despues: 1500 },
  { fase: "turno", ronda: 2, indiceTurno: 0, plazo: { fase: "turno", faltan: 8000 }, despues: 2500 },
];

// ===================================================================== A

test.describe("A — el resultado de la ronda no tapa la siguiente", () => {
  test("al cortar, el resultado se muestra", async ({ page }) => {
    await abrirRed(page, CORTE);
    await page.clock.runFor(600);

    await expect(velo(page)).toHaveClass(/abierto/);
    await expect(page.locator("#modal")).toContainText("Ronda 1 terminada");
  });

  test("y se cierra cuando llega la ronda siguiente", async ({ page }) => {
    const errores = await abrirRed(page, CORTE);
    await page.clock.runFor(1600);

    await expect(velo(page), "el resultado de la ronda 1 sigue tapando la ronda 2")
      .not.toHaveClass(/abierto/);
    expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
  });

  test("en el turno propio de la ronda nueva, se puede levantar", async ({ page }) => {
    // Lo que el jugador necesita de verdad: el botón a su alcance, no debajo
    // de un velo.
    await abrirRed(page, CORTE);
    await page.clock.runFor(2600);

    await expect(velo(page)).not.toHaveClass(/abierto/);
    await expect(page.locator("#btnLevantar")).toBeEnabled();
    await expect(page.locator("#modal")).not.toContainText("Ronda 1 terminada");
  });

  test("una vista nueva DENTRO del resultado no lo hace parpadear", async ({ page }) => {
    /**
     * Por eso se compara la fase y no la clave. Durante los segundos del
     * resultado pueden llegar vistas nuevas; si cada una cerrara el cartel,
     * el bloque siguiente lo volvería a abrir con su animación de entrada.
     *
     * Se vigila el velo desde adentro de la página, y mirando el valor ANTERIOR
     * de cada cambio, no el actual. El cierre y la reapertura pasan en la misma
     * llamada síncrona: cuando el observador corre, el velo ya está abierto de
     * nuevo, y preguntarle «¿está abierto?» da que sí. La primera versión de
     * esta prueba hacía eso y pasaba con el arreglo quitado.
     *
     * Un cambio cuyo valor anterior NO tenía `abierto` es una reapertura: sólo
     * puede venir después de un cierre. Volver a agregar la clase cuando ya
     * estaba también deja registro, pero con `abierto` en el valor anterior, y
     * no cuenta.
     */
    await abrirRed(page, [
      { fase: "turno", ronda: 1 },
      { fase: "finRonda", ronda: 1, indiceCortador: 1, puntosDeMano: [3, 1, 7, 9], despues: 500 },
      { fase: "finRonda", ronda: 1, indiceCortador: 1, puntosDeMano: [3, 1, 7, 9], despues: 1500 },
    ]);
    await page.clock.runFor(600);
    await expect(velo(page)).toHaveClass(/abierto/);

    await page.evaluate(() => {
      window.__reaperturas = 0;
      const v = document.querySelector("#velo");
      new MutationObserver((cambios) => {
        for (const c of cambios) {
          if (!/\babierto\b/.test(c.oldValue ?? "")) window.__reaperturas += 1;
        }
      }).observe(v, { attributes: true, attributeFilter: ["class"], attributeOldValue: true });
    });
    await page.clock.runFor(1000);

    expect(await page.evaluate(() => window.__reaperturas), "el cartel se cerró y se reabrió")
      .toBe(0);
    await expect(velo(page)).toHaveClass(/abierto/);
  });

  test("el final de la partida NO se cierra: ahí vive la revancha", async ({ page }) => {
    await abrirRed(page, [
      { fase: "turno", ronda: 1 },
      { fase: "finPartida", ronda: 1, indiceCortador: 1, puntosDeMano: [3, 1, 7, 9], despues: 500 },
    ]);
    await page.clock.runFor(3000);

    await expect(velo(page)).toHaveClass(/abierto/);
  });

  test("el 10 a medio decidir se cierra si el servidor lo resuelve por tiempo", async ({ page }) => {
    /**
     * La misma trampa, recién abierta: desde que las decisiones vencen solas,
     * el servidor puede resolver el 10 mientras el modal sigue en pantalla. Se
     * usa el aviso de «cambio a medias», que es el que abre la propia mesa.
     */
    await abrirRed(page, [
      { fase: "cambioConVista", ronda: 1, indiceTurno: 0, cambioPendiente: { indiceJugador: 0 } },
      { fase: "postLevantada", ronda: 1, indiceTurno: 0, despues: 1000 },
    ]);
    await expect(page.locator("#modal")).toContainText("Cambio a medias");

    await page.clock.runFor(1200);
    await expect(velo(page), "el 10 ya se resolvió y su modal sigue abierto")
      .not.toHaveClass(/abierto/);
  });
});

// ===================================================================== B

test.describe("B — en red, el reloj del turno es del servidor", () => {
  test("un turno sin jugar no avanza solo en esta pantalla", async ({ page }) => {
    /**
     * Sin ninguna vista nueva, el turno tiene que quedarse donde lo dejó el
     * servidor. Con el reloj local que actuaba, pasaba al siguiente cada ocho
     * segundos y la pista decía «LEVANTAR», el texto del entrenamiento.
     */
    await abrirRed(page, [
      { fase: "turno", ronda: 1, indiceTurno: 0, plazo: { fase: "turno", faltan: 8000 } },
    ]);
    expect(await turnoDe(page)).toBe("0");

    await page.clock.runFor(20_000);

    expect(await turnoDe(page), "el turno avanzó sin que el servidor lo dijera").toBe("0");
    await expect(page.locator("#pista")).not.toContainText(/se te acabó el tiempo/i);
  });

  test("la cuenta sale del plazo del servidor, no de ocho segundos fijos", async ({ page }) => {
    // Un plazo de tres segundos: con el reloj local habría dicho 8s igual.
    await abrirRed(page, [
      { fase: "turno", ronda: 1, indiceTurno: 0, plazo: { fase: "turno", faltan: 3000 } },
    ]);
    await expect(page.locator("#relojTurno")).toBeVisible();

    const segundos = Number.parseInt(await page.locator("#relojNumero").innerText(), 10);
    expect(segundos, "la cuenta no es la del servidor").toBeLessThanOrEqual(3);
    expect(segundos).toBeGreaterThan(0);
  });

  test("sin plazo del servidor no se inventa ninguno", async ({ page }) => {
    // Un turno sin plazo es una vista vieja; dibujar ocho segundos ahí sería
    // apurar al jugador contra un reloj que nadie está contando.
    await abrirRed(page, [{ fase: "turno", ronda: 1, indiceTurno: 0 }]);

    await expect(page.locator("#relojTurno")).toBeHidden();
  });

  test("un ausente al que el servidor saltea al instante no muestra ocho segundos", async ({ page }) => {
    // Su plazo vence en el momento: el espejo no tiene nada que contar.
    await abrirRed(page, [
      { fase: "turno", ronda: 1, indiceTurno: 1, plazo: { fase: "turno", faltan: 0 } },
    ]);

    await expect(page.locator("#relojTurno")).toBeHidden();
  });
});
