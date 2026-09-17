/**
 * En red, la carta que se mira se VE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL BUG, COMO SE VIO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * «La primera carta no se ve en red.» La cuenta regresiva andaba, la pista
 * decía «Tocá una carta tuya», el toque llegaba al servidor, y la carta no se
 * daba vuelta. Ni un instante. En entrenamiento, perfecto.
 *
 * El servidor hacía su parte: la carta viaja en la RESPUESTA a quien miró, y
 * sólo a él. La mesa la guardaba entre las revelaciones. Y al dibujar la
 * mano elegía `carta ?? revelada`: primero lo que hay en la mano.
 *
 * En entrenamiento en la mano está la carta de verdad, y la revelación es un
 * `null` que sólo dice «dala vuelta». En red, la mano propia llega TAPADA —el
 * servidor manda un marcador `{ oculta: true }`—, que no es `null`. Así que
 * ganaba el marcador, y un marcador se dibuja de dorso aunque se lo pida
 * boca arriba.
 *
 * No era sólo la mirada inicial: todo lo que llega por la respuesta y no por
 * la vista —la carta del 7, la del 8, las dos del 10— quedaba igual de tapado.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CÓMO SE ARMA CADA CASO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El módulo de partida es un doble: publica la vista que pide el caso y
 * contesta cada acción con la carta que le toca revelar, como el servidor.
 *
 * Y SIN COMILLAS INVERTIDAS DENTRO DE `partidaFalsa`: es un template literal,
 * y una suelta adentro lo cierra antes de tiempo.
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

/** Las cartas que el servidor de mentira revela, con la forma de `crearBaraja`. */
const SIETE = { id: "Oro-7", palo: "Oro", numero: 7, puntos: 7, imagen: "/assets/Oro/7.png" };
const DOCE = { id: "Copa-12", palo: "Copa", numero: 12, puntos: 12, imagen: "/assets/Copa/12.png" };

const partidaFalsa = `
  const tapada = { oculta: true };
  const IDS = ["ana", "beto", "caro", "dani"];
  const CASO = window.__caso ?? {};
  window.__pedidos = [];

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
  // Lo que contesta el servidor a cada acción: sólo a quien la hizo.
  export const accion = async (codigo, nombre, datos) => {
    window.__pedidos.push(nombre);
    return (CASO.respuestas ?? {})[nombre] ?? {};
  };
  export const mirar = (codigo, posicion) => accion(codigo, "mirar", { posicion });
  export const levantar = async () => {};
  export const tirarCarta = async () => {};
  export const cortar = async () => {};
  export const pasarTurno = async () => {};
  export const cambiarCarta = async () => {};
  export const resolverCambio = async () => {};
  export const saltarPoder = async () => {};
  export const intentarDescarte = async () => ({ anotado: true });
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
    ronda: 1,
    yo: 0, indiceMano: 0, indiceTurno: paso.indiceTurno ?? 0, turnosRonda: 1,
    indiceCortador: null, desempate: false, registro: [],
    cartasEnMazo: 20, cartasEnDescarte: 1,
    muestra: { id: "Basto-4", palo: "Basto", numero: 4, puntos: 4, imagen: "/assets/Basto/4.png" },
    levantada: null,
    poderPendiente: paso.poderPendiente ?? null,
    cambioPendiente: null,
    ventana: paso.fase === "mirar"
      ? { id: "v1", abiertaEn: Date.now() - 300, duracionMs: 7000, cerrada: false }
      : null,
    esperando: null,
    plazo: null,
    puedeAtacarEn: [], puedeAtacar: [], revelaciones: [],
    ausentes: [], ausentesPorTiempo: [],
    jugadores: ["Ana", "Beto", "Caro", "Dani"].map((nombre, i) => ({
      id: IDS[i], nombre,
      retrato: null, dorso: null, insignia: null, marco: null, titulo: null,
      puntos: 0, puntosRonda: 0,
      eliminado: false, eliminadoEnRonda: null, posicionMirada: null,
      cartasEnMano: 4, mano: [tapada, tapada, tapada, tapada],
    })),
  });

  export function escucharMiVista(codigo, uid, alRecibir) {
    window.__empezar = () => {
      (CASO.secuencia ?? []).forEach((paso, n) => alRecibir(vista(paso, n + 1)));
    };
    return () => {};
  }
`;

async function abrirRed(page, caso) {
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));
  await page.clock.install({ time: new Date("2026-09-17T12:00:00Z") });
  await page.addInitScript((c) => {
    window.__caso = c;
  }, caso);

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

const carta = (page, jugador, pos) =>
  page.locator(`.jugador[data-jugador="${jugador}"] .carta[data-posicion="${pos}"]`);

/** Boca arriba y con la cara que mandó el servidor. */
async function seVe(page, jugador, pos, cual) {
  await expect(carta(page, jugador, pos), "la carta sigue de dorso").toHaveClass(/\bvisible\b/);
  await expect(carta(page, jugador, pos).locator(".cara img")).toHaveAttribute("src", cual.imagen);
}

test("la carta de la mirada inicial se da vuelta, y a los dos segundos se tapa", async ({ page }) => {
  const errores = await abrirRed(page, {
    secuencia: [{ fase: "mirar" }],
    respuestas: { mirar: { duplicado: false, version: 2, fase: "mirar", carta: SIETE } },
  });

  await carta(page, 0, 1).click();
  await expect.poll(() => page.evaluate(() => window.__pedidos)).toEqual(["mirar"]);
  await seVe(page, 0, 1, SIETE);

  await page.clock.runFor(2100);
  await expect(carta(page, 0, 1)).not.toHaveClass(/\bvisible\b/);
  await expect(carta(page, 0, 1).locator(".cara")).toHaveCount(0);
  expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

test("la carta que mira un 8 se da vuelta", async ({ page }) => {
  await abrirRed(page, {
    secuencia: [{
      fase: "poder",
      poderPendiente: { tipo: "mirarRival", numero: 8, indiceJugador: 0 },
    }],
    respuestas: { poderMirar: { duplicado: false, version: 2, carta: DOCE } },
  });

  await page.locator('[data-accion="red-elegir-objetivo"]').click();
  await carta(page, 2, 3).click();
  await expect.poll(() => page.evaluate(() => window.__pedidos)).toEqual(["poderMirar"]);
  await seVe(page, 2, 3, DOCE);
});

test("las dos cartas del 10 se dan vuelta", async ({ page }) => {
  await abrirRed(page, {
    secuencia: [{
      fase: "poder",
      poderPendiente: { tipo: "cambioConVista", numero: 10, indiceJugador: 0 },
    }],
    respuestas: {
      poderCambio: { duplicado: false, version: 2, revelada: { propia: SIETE, rival: DOCE } },
    },
  });

  await page.locator('[data-accion="red-elegir-objetivo"]').click();
  await carta(page, 0, 0).click();
  await carta(page, 1, 2).click();
  await expect.poll(() => page.evaluate(() => window.__pedidos)).toEqual(["poderCambio"]);
  await seVe(page, 0, 0, SIETE);
  await seVe(page, 1, 2, DOCE);
});
