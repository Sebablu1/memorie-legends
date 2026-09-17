/**
 * La primera ronda en red espera a que lleguen todos, y después cuenta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL BUG, COMO SE VIO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * «No puedo ver la primera carta al inicio.» La ventana de la ronda 1 se
 * abría en `iniciarPartida`, y cada jugador llegaba a la mesa unos seis
 * segundos después: la mirada de dos segundos ya había vencido, el primer
 * golpe la cerraba, y tocar una carta devolvía un error.
 *
 * Ahora la partida nace esperando. Cada mesa avisa que llegó con su primer
 * latido; cuando llegan todos —o a los quince segundos— el servidor programa
 * la apertura para dentro de una cuenta regresiva, la misma de entrenamiento.
 * Lo del servidor lo prueba `pruebas/primera-ronda.mjs`. Acá, la mesa:
 *
 *   A. Mientras espera, lo dice, y no ofrece las cartas.
 *   B. La cuenta es la del servidor: sale de `abiertaEn`, y quien llega tarde
 *      entra en el paso que corresponde.
 *   C. Hasta que abre, tocar no manda nada; cuando abre, sí.
 *   D. El primer latido sale apenas se entra, no a los cinco segundos.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CÓMO SE ARMA CADA CASO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `window.__caso.secuencia` es la lista de vistas que publica el servidor,
 * cada una con cuántos milisegundos después de arrancar llega. `abreEn`
 * se convierte en un `abiertaEn` absoluto al publicarse, como lo manda el
 * servidor. El reloj es el de `page.clock`: los segundos se adelantan sin
 * esperarlos.
 *
 * Las pruebas corren con movimiento reducido, y es a propósito que la cuenta
 * se vea igual: en red la espera es real.
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

/** La partida, publicando la secuencia del caso y anotando lo que se pide. */
const partidaFalsa = `
  const tapada = { oculta: true };
  const IDS = ["ana", "beto", "caro", "dani"];
  const CASO = window.__caso ?? {};
  window.__pedidos = [];
  const anotar = (nombre) => async () => { window.__pedidos.push(nombre); return {}; };

  export const ahoraDelServidor = () => Date.now();
  export const relojActual = () => ({ desfase: 0, incertidumbre: 10 });
  export const sincronizarReloj = async () => {};
  export const mantenerVivo = () => () => {};
  export const mantenerEnMarcha = () => () => {};
  export const nuevoIdDeAccion = () => "a1";
  export const saltarAusente = async () => {};
  export const volver = async () => {};
  export const calentarDescarte = async () => true;
  export const entregarCarta = async () => ({});
  export const latir = async () => {};
  export const accion = async () => {};
  export const mirar = anotar("mirar");
  export const levantar = async () => {};
  export const tirarCarta = async () => {};
  export const cortar = async () => {};
  export const pasarTurno = async () => {};
  export const cambiarCarta = async () => {};
  export const resolverCambio = async () => {};
  export const saltarPoder = async () => {};
  export const intentarDescarte = anotar("intentarDescarte");
  export const abrirVentanaDescarte = async () => {};
  export const cerrarVentanaDescarte = async () => {};
  export const cerrarMirada = anotar("cerrarMirada");
  export const avanzarPartida = async () => {};
  export const MS_ENTRE_GOLPES = 900;
  export const MS_ENTRE_LATIDOS = 5000;
  export const escucharMisLogros = () => () => {};

  const vista = (paso, version) => ({
    version,
    fase: "mirar",
    ronda: 1,
    yo: 0, indiceMano: 0, indiceTurno: 0, turnosRonda: 0,
    indiceCortador: null, desempate: false, registro: [],
    cartasEnMazo: 20, cartasEnDescarte: 1,
    muestra: { valor: 5, palo: "oros" },
    levantada: null, poderPendiente: null, cambioPendiente: null,
    puedeAtacar: [], puntosDeMano: null,
    ventana: paso.abreEn == null
      ? null
      : { id: "v1", abiertaEn: Date.now() + paso.abreEn, duracionMs: 9000, cerrada: false },
    esperando: paso.esperando ?? null,
    plazo: null,
    ausentes: [], ausentesPorTiempo: [],
    jugadores: ["Ana", "Beto", "Caro", "Dani"].map((nombre, i) => ({
      id: IDS[i], nombre,
      retrato: null, dorso: null, insignia: null, marco: null, titulo: null,
      puntos: 0, puntosRonda: 0,
      eliminado: false, eliminadoEnRonda: null, posicionMirada: null,
      cartasEnMano: 4, mano: [tapada, tapada, tapada, tapada],
    })),
  });

  // La secuencia arranca cuando la prueba lo pide, con el reloj ya quieto:
  // si arrancara al suscribirse, los segundos que tarda en cargar la página
  // correrían sobre la cuenta.
  export function escucharMiVista(codigo, uid, alRecibir) {
    window.__empezar = () => {
      (CASO.secuencia ?? []).forEach((paso, n) => {
        const publicar = () => alRecibir(vista(paso, n + 1));
        if (!paso.despues) publicar();
        else setTimeout(publicar, paso.despues);
      });
    };
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
  await page.waitForFunction(() => typeof window.__empezar === "function");
  await pausar(page);
  await page.evaluate(() => window.__empezar());
  await page.waitForSelector(".jugador .retrato");
  return errores;
}

/**
 * Detiene el reloj de la página: de acá en más sólo avanza con `runFor`.
 *
 * El reloj instalado corre solo hasta que se lo pausa, y pausar en el pasado es
 * un error. Con la máquina cargada —la suite entera corriendo— entre leer la
 * hora y pausar pasaron más de los cien milisegundos de margen que había, y la
 * prueba fallaba sin que la mesa tuviera nada que ver. Ahora el margen es de un
 * segundo, y si igual se pasa, se vuelve a leer la hora y se reintenta.
 */
async function pausar(page) {
  for (let intento = 0; intento < 5; intento++) {
    const ahora = await page.evaluate(() => Date.now());
    try {
      await page.clock.pauseAt(new Date(ahora + 1000));
      return;
    } catch (error) {
      if (!/past/i.test(String(error))) throw error;
    }
  }
  throw new Error("no se pudo pausar el reloj de la página");
}

const pista = (page) => page.locator("#pista");
const cuenta = (page) => page.locator("#cuentaAtras");
const numero = (page) => page.locator("#cuentaAtrasNumero");
const miCarta = (page, pos = 0) =>
  page.locator(`.jugador[data-jugador="0"] .carta[data-posicion="${pos}"]`);
const misJugables = (page) =>
  page.locator('.jugador[data-jugador="0"] .carta[data-posicion].jugable');
const pedidos = (page) => page.evaluate(() => window.__pedidos);

/**
 * Espera → llegan todos → cuenta de cuatro segundos → abre.
 *
 * La última vista llega a los 2 s y trae la apertura para 4 s después: la
 * mirada abre a los 6 s de haber entrado.
 */
const LLEGADA_COMPLETA = [
  { esperando: { llegaron: 1, total: 4 } },
  { esperando: { llegaron: 3, total: 4 }, despues: 1000 },
  { abreEn: 4000, despues: 2000 },
];

// ===================================================================== A

test.describe("A — mientras faltan jugadores", () => {
  test("la mesa dice cuántos llegaron", async ({ page }) => {
    const errores = await abrirRed(page, LLEGADA_COMPLETA);

    await expect(pista(page)).toContainText("Esperando a los jugadores (1/4)");
    await page.clock.runFor(1100);
    await expect(pista(page)).toContainText("Esperando a los jugadores (3/4)");
    expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
  });

  test("no ofrece las cartas, y tocarlas no manda nada", async ({ page }) => {
    await abrirRed(page, LLEGADA_COMPLETA);

    await expect(miCarta(page)).toBeVisible();
    await expect(misJugables(page)).toHaveCount(0);

    await miCarta(page).click();
    await miCarta(page, 1).dblclick();
    expect(await pedidos(page), "se pidió algo con la mirada cerrada").toEqual([]);
  });

  test("todavía no hay cuenta regresiva", async ({ page }) => {
    await abrirRed(page, LLEGADA_COMPLETA);
    await expect(pista(page)).toContainText("Esperando");
    await expect(cuenta(page)).toBeHidden();
  });
});

// ===================================================================== B

test.describe("B — la cuenta regresiva es la del servidor", () => {
  test("3, 2, 1, Preparate… al ritmo de abiertaEn", async ({ page }) => {
    await abrirRed(page, LLEGADA_COMPLETA);
    await page.clock.runFor(2100);

    await expect(cuenta(page)).toBeVisible();
    await expect(numero(page)).toHaveText("3");
    await page.clock.runFor(1000);
    await expect(numero(page)).toHaveText("2");
    await page.clock.runFor(1000);
    await expect(numero(page)).toHaveText("1");
    await page.clock.runFor(1000);
    await expect(numero(page)).toHaveText("Preparate…");
    await expect(pista(page)).toContainText("Preparate");
  });

  test("se va justo cuando abre la mirada", async ({ page }) => {
    await abrirRed(page, LLEGADA_COMPLETA);
    await page.clock.runFor(5900);
    await expect(cuenta(page)).toBeVisible();

    await page.clock.runFor(200);
    await expect(cuenta(page), "la cuenta sigue después de abrir").toBeHidden();
    await expect(pista(page)).toContainText("Tocá una carta");
  });

  test("quien llega con la cuenta empezada entra en su paso", async ({ page }) => {
    // Le falta un segundo y medio: va el «1», no un «3» que terminaría
    // cuando los otros ya están mirando.
    await abrirRed(page, [{ abreEn: 1500 }]);

    await expect(cuenta(page)).toBeVisible();
    await expect(numero(page)).toHaveText("1");
  });

  test("sin espera y con la mirada ya abierta, no hay cuenta", async ({ page }) => {
    // Una partida repartida antes de este cambio: la mirada ya estaba
    // abierta, y tiene que poder jugarse.
    await abrirRed(page, [{ abreEn: -500 }]);

    await expect(pista(page)).toContainText("Tocá una carta");
    await expect(cuenta(page)).toBeHidden();
    await expect(misJugables(page)).toHaveCount(4);
  });
});

// ===================================================================== C

test.describe("C — las cartas se tocan cuando abre, no antes", () => {
  test("durante la cuenta, ni mirar ni descartar", async ({ page }) => {
    await abrirRed(page, LLEGADA_COMPLETA);
    await page.clock.runFor(3000);
    await expect(cuenta(page)).toBeVisible();

    await expect(misJugables(page)).toHaveCount(0);
    await miCarta(page).click();
    await miCarta(page, 1).dblclick();
    expect(await pedidos(page), "se pidió algo durante la cuenta").toEqual([]);
  });

  test("al abrir, las cartas se ofrecen y tocar mira", async ({ page }) => {
    const errores = await abrirRed(page, LLEGADA_COMPLETA);
    await page.clock.runFor(6100);

    await expect(misJugables(page)).toHaveCount(4);
    await miCarta(page, 2).click();
    await expect.poll(() => pedidos(page)).toEqual(["mirar"]);
    expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
  });
});

// ===================================================================== D

test.describe("D — el primer latido", () => {
  test("sale apenas se entra, y después cada cinco segundos", async ({ page }) => {
    /**
     * El módulo de verdad, con un Firebase de mentira que anota las llamadas.
     * Una página vacía del mismo origen alcanza para importarlo: la mesa
     * entera no hace falta para saber cuándo sale un latido.
     */
    await page.clock.install({ time: new Date("2026-09-16T12:00:00Z") });
    await page.route("**/prueba-latido.html", (r) =>
      r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: "<!doctype html><title>latido</title>" }));
    await page.route("**/js/firebase.js", (r) => r.fulfill(js(`
      window.__llamadas = [];
      export const db = {};
      export const doc = (...a) => a;
      export const onSnapshot = () => () => {};
      export const funciones = {};
      export const httpsCallable = (f, nombre) => async () => {
        window.__llamadas.push(nombre);
        return { data: {} };
      };
    `)));
    await page.goto("/prueba-latido.html");
    await pausar(page);

    await page.evaluate(async () => {
      const Red = await import("/js/partida-red.js");
      window.__dejar = Red.mantenerVivo("ABCDEF");
    });
    const latidos = () =>
      page.evaluate(() => window.__llamadas.filter((n) => n === "latir").length);

    expect(await latidos(), "el primer latido esperó al intervalo").toBe(1);

    await page.clock.runFor(4900);
    expect(await latidos()).toBe(1);
    await page.clock.runFor(200);
    expect(await latidos()).toBe(2);

    await page.evaluate(() => window.__dejar());
    await page.clock.runFor(20_000);
    expect(await latidos(), "siguió latiendo después de dejar").toBe(2);
  });
});
