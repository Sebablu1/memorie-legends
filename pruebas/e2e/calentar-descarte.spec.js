/**
 * La mesa en red precalienta el descarte justo antes de que haga falta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Las funciones son de primera generación: cada instancia atiende un pedido a
 * la vez, y una nueva tarda 3 a 4 segundos en arrancar —medido en
 * producción— más unos dos en su primera transacción. Un descarte que cae ahí
 * llega tarde sin culpa del jugador; en una ventana de reapertura de tres
 * segundos, se pierde seguro.
 *
 * La mesa le pide a `intentarDescarte` que se prepare con un pedido que no es
 * un descarte, así el arranque lo paga ése. Esta suite prueba CUÁNDO lo pide:
 * `pruebas/llegada-sellada.mjs` prueba qué hace el servidor con el pedido.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL RELOJ ES DE MENTIRA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El freno es de veinte segundos, y esperarlos de verdad haría esta suite
 * lenta sin probar nada más. `page.clock` los adelanta: las vistas nuevas
 * llegan con `setTimeout` dentro de la página, y el freno mira `Date.now()`,
 * así que los dos avanzan juntos.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Y SIN COMILLAS INVERTIDAS DENTRO DE `partidaFalsa`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Es un template literal. Una suelta adentro lo cierra antes de tiempo, y
 * Playwright informa «No tests found», no un error de sintaxis.
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
 * La partida, con una SECUENCIA de vistas.
 *
 * `window.__caso.vistas` es una lista de fases, cada una con cuántos
 * milisegundos después de suscribirse llega. `calentarDescarte` cuenta las
 * veces que la llamaron.
 */
const partidaFalsa = `
  const tapada = { oculta: true };
  const CASO = window.__caso ?? {};
  const IDS = ["ana", "beto", "caro", "dani"];
  window.__calentadas = 0;

  export const ahoraDelServidor = () => Date.now();
  export const relojActual = () => ({ desfase: 0, incertidumbre: 10 });
  export const sincronizarReloj = async () => {};
  export const mantenerVivo = () => () => {};
  export const mantenerEnMarcha = () => () => {};
  export const nuevoIdDeAccion = () => "a1";
  export const saltarAusente = async () => {};
  export const volver = async () => {};
  export const calentarDescarte = async () => { window.__calentadas += 1; return true; };
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

  const vistaEn = (fase, version) => ({
    version, fase, ronda: 1, yo: 0, indiceMano: 0, indiceTurno: 2,
    turnosRonda: 0, indiceCortador: null, desempate: false, registro: [],
    cartasEnMazo: 20, cartasEnDescarte: 1, muestra: null,
    levantada: fase === "levantada" ? { numero: 5, palo: "copa" } : null,
    poderPendiente: null, puedeAtacar: [], puntosDeMano: null, plazo: null,
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
    const vistas = CASO.vistas ?? [{ fase: "turno", despues: 0 }];
    vistas.forEach(({ fase, despues }, n) => {
      if (despues === 0) alRecibir(vistaEn(fase, n + 1));
      else setTimeout(() => alRecibir(vistaEn(fase, n + 1)), despues);
    });
    return () => {};
  }
`;

async function abrirRed(page, caso, { oculta = false } = {}) {
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));

  await page.clock.install({ time: new Date("2026-09-16T12:00:00Z") });
  await page.addInitScript(
    ({ c, oculta }) => {
      window.__caso = c;
      if (oculta) Object.defineProperty(document, "hidden", { get: () => true });
    },
    { c: caso, oculta },
  );

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

const calentadas = (page) => page.evaluate(() => window.__calentadas);

// =====================================================================

test("la primera vista de la partida calienta", async ({ page }) => {
  // Es el tramo con más margen antes de la primera ventana.
  const errores = await abrirRed(page, { vistas: [{ fase: "turno", despues: 0 }] });

  expect(await calentadas(page)).toBe(1);
  expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

test("pasados veinte segundos, entrar en levantada vuelve a calentar", async ({ page }) => {
  /**
   * Alguien levantó: está por tirar, y tirar abre una ventana. Los cuatro
   * reciben esta vista casi a la vez, así que calientan juntos — y eso deja
   * una instancia lista por cada descarte que puede llegar al mismo tiempo.
   */
  await abrirRed(page, {
    vistas: [{ fase: "turno", despues: 0 }, { fase: "levantada", despues: 21_000 }],
  });
  await page.clock.runFor(21_500);

  expect(await calentadas(page)).toBe(2);
});

test("y entrar en mirar, también", async ({ page }) => {
  // La ronda está por abrir sus reflejos.
  await abrirRed(page, {
    vistas: [{ fase: "turno", despues: 0 }, { fase: "mirar", despues: 21_000 }],
  });
  await page.clock.runFor(21_500);

  expect(await calentadas(page)).toBe(2);
});

test("antes de los veinte segundos, el freno lo impide", async ({ page }) => {
  // Una instancia que se acaba de calentar no se enfría en un segundo.
  await abrirRed(page, {
    vistas: [{ fase: "turno", despues: 0 }, { fase: "levantada", despues: 1_000 }],
  });
  await page.clock.runFor(1_500);

  expect(await calentadas(page)).toBe(1);
});

test("otra vista de la MISMA fase no calienta: cuenta entrar, no estar", async ({ page }) => {
  /**
   * Mientras dura `levantada` llegan varias vistas —cambia la versión por
   * cualquier motivo—. Si cada una calentara, el freno sería lo único que
   * separa esto de un pedido por vista.
   */
  await abrirRed(page, {
    vistas: [
      { fase: "turno", despues: 0 },
      { fase: "levantada", despues: 21_000 },
      { fase: "levantada", despues: 43_000 },
    ],
  });
  await page.clock.runFor(43_500);

  expect(await calentadas(page)).toBe(2);
});

test("una fase que no lleva a una ventana no calienta", async ({ page }) => {
  // Cortar o pasar no abre reflejos.
  await abrirRed(page, {
    vistas: [{ fase: "turno", despues: 0 }, { fase: "postLevantada", despues: 21_000 }],
  });
  await page.clock.runFor(21_500);

  expect(await calentadas(page)).toBe(1);
});

test("con la pestaña oculta no calienta: no hay quien toque", async ({ page }) => {
  await abrirRed(page, { vistas: [{ fase: "turno", despues: 0 }] }, { oculta: true });

  expect(await calentadas(page)).toBe(0);
});
