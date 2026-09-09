/**
 * Cuántas veces sale la mesa a la red mientras nadie hace nada.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE ESTO DEFIENDE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `mantenerEnMarcha` llamaba a `avanzarPartida` en CADA vuelta de su
 * temporizador —cada 900 ms— durante toda la partida. Con cuatro jugadores son
 * unas 267 llamadas por minuto y por mesa, cada una una Cloud Function y una
 * transacción de Firestore, y la enorme mayoría contestaba «todavía no» sin
 * tocar nada.
 *
 * Ahora el reloj local sigue latiendo igual —eso no cuesta nada— pero sólo se
 * sale a la red cuando el plazo que publicó el servidor ya venció.
 *
 * Se prueba en el navegador y no en Node porque lo que se mide es el
 * comportamiento del temporizador dentro de una página: cuántas llamadas
 * salen en tantos segundos.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ACÁ NO SE SUSTITUYE `partida-red.js`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Es justamente el módulo que se está probando. Se sustituyen las capas de
 * abajo —Firestore y las funciones— y se lo deja correr de verdad.
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

/**
 * Firestore de mentira que entrega UNA vista, con el plazo que se le pida.
 *
 * `faltanMs` es lo que le queda al plazo desde que carga la página. Positivo,
 * el servidor no tiene nada que hacer; negativo, ya venció.
 */
const firebaseFalso = (faltanMs) => `
  const SALA = {
    codigo: "ABCDEF", estado: "jugando", entrada: 50,
    jugadores: ["ana", "beto", "caro", "dani"],
    jugadoresNombres: ["Ana", "Beto", "Caro", "Dani"],
    maxJugadores: 4,
  };
  const tapada = { oculta: true };
  const VISTA = {
    version: 1, fase: "turno", ronda: 1, yo: 0, indiceMano: 0, indiceTurno: 1,
    turnosRonda: 0, indiceCortador: null, desempate: false, registro: [],
    cartasEnMazo: 20, cartasEnDescarte: 1,
    muestra: { id: "m", palo: "Copa", numero: 7, imagen: "/assets/Copa/7.png", visible: true },
    levantada: null, poderPendiente: null, puedeAtacar: [],
    plazo: { fase: "turno", marca: "t0-1", que: "saltarTurno", hasta: Date.now() + (${faltanMs}) },
    jugadores: ["Ana", "Beto", "Caro", "Dani"].map((nombre, i) => ({
      id: nombre, nombre, retrato: null, dorso: null, insignia: null,
      puntos: 0, puntosRonda: 0, eliminado: false, eliminadoEnRonda: null,
      cartasEnMano: 4, mano: [tapada, tapada, tapada, tapada],
    })),
  };

  export const db = {};
  export const doc = (...a) => a;
  export const collection = (...a) => a;
  export const query = (...a) => a;
  export const orderBy = () => null;
  export const where = () => null;
  export const getDocs = async () => ({ docs: [] });
  export const getDoc = async () => ({ exists: () => true, data: () => SALA });
  export const onSnapshot = (ref, cb) => {
    cb({ exists: () => true, data: () => VISTA });
    return () => {};
  };

  export const funciones = {};
  window.__llamadas = [];
  export const httpsCallable = (_f, nombre) => async (datos) => {
    window.__llamadas.push(nombre);
    if (nombre === "horaDelServidor") return { data: { ahora: Date.now() } };
    return { data: {} };
  };
  export const auth = { currentUser: { uid: "ana" } };
  export const SUPPORT_EMAIL = "soporte@memorie-legends.com";
`;

async function abrirMesaEnRed(page, faltanMs) {
  await page.route("**/js/guardia-sesion.js", (r) =>
    r.fulfill(js(`export async function exigirSesionEnMesa(){
      return { uid: "ana", email: "a@b.c" };
    }`)));
  await page.route("**/js/sesion.js", (r) => r.fulfill(js(SESION_FALSA)));
  await page.route("**/js/firebase.js", (r) => r.fulfill(js(firebaseFalso(faltanMs))));

  await page.goto("/mesa.html?sala=ABCDEF");
  await page.waitForSelector(".jugador[data-jugador] .carta");
}

const golpes = (page) =>
  page.evaluate(() => window.__llamadas.filter((n) => n === "avanzarPartida").length);

// =====================================================================

test("con el plazo lejos, la mesa deja de golpear la puerta", async ({ page }) => {
  // Treinta segundos por delante: no hay nada que el servidor pueda hacer.
  await abrirMesaEnRed(page, 30_000);

  // Cuatro segundos son más de cuatro vueltas del temporizador de 900 ms.
  await page.waitForTimeout(4000);

  const cuantos = await golpes(page);
  // Uno: el del arranque, que va forzado porque todavía no llegó ninguna vista.
  expect(cuantos, `salieron ${cuantos} llamadas con el plazo a 30 segundos`).toBeLessThanOrEqual(1);
});

test("y con el plazo vencido, sí golpea", async ({ page }) => {
  // La otra mitad, y la que importa: si dejara de golpear SIEMPRE, la partida
  // no avanzaría nunca y esta suite no lo notaría.
  await abrirMesaEnRed(page, -1000);
  await page.waitForTimeout(4000);

  const cuantos = await golpes(page);
  expect(cuantos, "con el plazo vencido tiene que seguir golpeando").toBeGreaterThan(2);
});

test("el latido sigue saliendo igual", async ({ page }) => {
  /**
   * Los golpes se espaciaron; los latidos NO.
   *
   * Son dos cosas distintas: el golpe le pregunta al servidor si venció algo,
   * y el latido dice «sigo acá». Dejar de latir haría que a uno le salten el
   * turno estando presente, que es peor que cualquier ahorro.
   */
  await abrirMesaEnRed(page, 30_000);
  await page.waitForTimeout(6000);

  const latidos = await page.evaluate(() =>
    window.__llamadas.filter((n) => n === "latir").length);
  expect(latidos, "el latido tiene que seguir saliendo").toBeGreaterThan(0);
});
