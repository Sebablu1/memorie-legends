/**
 * La escucha de la partida, cuando se corta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE ROMPÍA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La mesa decía «⚠️ Sin conexión. Reintentando…» y NADA reintentaba. No era
 * un descuido del cartel: no había ni una re-suscripción en todo el cliente.
 *
 * Y `onSnapshot` no lo hace por uno. El SDK reintenta solo mientras la escucha
 * sigue viva —un corte común ni siquiera llama al callback de error, se queda
 * en modo desconectado y recupera al volver—. Cuando el error SÍ llega hasta
 * el callback, esa escucha terminó: no entrega una vista más, nunca.
 *
 * Lo que queda es un tablero congelado que parece vivo, con su cuenta
 * regresiva corriendo sobre un plazo viejo. El jugador toca creyendo que le
 * toca, y el servidor le contesta que el turno ya no es suyo. Es la otra
 * mitad del «se te pasó el turno»: no un reloj corrido, una mesa detenida.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ACÁ NO HAY DOBLE DE `partida-red.js`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Igual que en `reloj-se-pone-en-hora.spec.js`, y por el mismo motivo: las
 * suites de mesa reemplazan el módulo entero, así que no pueden ver el código
 * que acá se arregla. Se carga el de verdad con un `import()` dinámico y lo
 * único falso es `firebase.js`, con un `onSnapshot` que la prueba hace caer
 * cuando quiere.
 */

import { test, expect } from "@playwright/test";

const EN_BLANCO = "<!doctype html><meta charset=utf-8><title>escucha</title>";

/**
 * El `onSnapshot` falso guarda los callbacks de la ÚLTIMA suscripción y lleva
 * la cuenta de cuántas hubo. Eso es todo lo que hace falta: la prueba entrega
 * vistas y provoca caídas desde afuera.
 */
const firebaseFalso = `
  export const app = {};
  export const db = {};
  export const funciones = {};
  export const auth = { currentUser: { uid: "ana" } };
  export const googleProvider = {};
  export const SUPPORT_EMAIL = "soporte@example.com";
  export const doc = (...a) => a;
  export const collection = (...a) => a;
  export const query = (...a) => a;
  export const where = () => ({});
  export const orderBy = () => ({});
  export const limit = () => ({});
  export const getDoc = async () => ({ exists: () => false });
  export const getDocs = async () => ({ docs: [] });
  export const setDoc = async () => {};
  export const updateDoc = async () => {};
  export const addDoc = async () => ({});
  export const deleteDoc = async () => {};
  export const serverTimestamp = () => null;
  export const increment = (n) => n;
  export const arrayUnion = (x) => x;
  export const arrayRemove = (x) => x;
  export const runTransaction = async (f) => f({});
  export const GoogleAuthProvider = class {};
  export const onAuthStateChanged = () => () => {};
  export const signOut = async () => {};
  export const signInWithPopup = async () => ({ user: {} });
  export const signInWithEmailAndPassword = async () => ({ user: {} });
  export const createUserWithEmailAndPassword = async () => ({ user: {} });
  export const sendPasswordResetEmail = async () => {};
  export const httpsCallable = () => async () => ({ data: { ahora: Date.now() } });
  export function precalentarFunciones() {}

  export function onSnapshot(_ref, alRecibir, alFallar) {
    window.__suscripciones = (window.__suscripciones ?? 0) + 1;
    window.__vivas = (window.__vivas ?? 0) + 1;
    window.__cuando = [...(window.__cuando ?? []), Date.now()];
    window.__ultima = { alRecibir, alFallar };
    return () => { window.__vivas -= 1; };
  }
`;

async function cargar(page) {
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));
  page.on("console", (m) => {
    // El corte se anota en la consola a propósito; no es un error de la prueba.
    if (m.type() === "error" && !/Se cortó la escucha/.test(m.text())) errores.push(m.text());
  });

  await page.route("**/__escucha.html", (r) =>
    r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: EN_BLANCO }));
  await page.route("**/js/firebase.js", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: firebaseFalso }));

  await page.goto("/__escucha.html");
  await page.evaluate(async () => {
    const Red = await import("/js/partida-red.js");
    window.Red = Red;
    window.__vistas = [];
    window.__conexion = [];
    window.cortar = Red.escucharMiVista(
      "ABCDEF",
      "ana",
      (vista) => window.__vistas.push(vista.version),
      (estado) => window.__conexion.push(estado),
    );
  });
  return errores;
}

/** Entrega una vista por la suscripción que está viva ahora. */
const entregar = (page, version) =>
  page.evaluate((v) => {
    window.__ultima.alRecibir({ exists: () => true, data: () => ({ version: v }) });
  }, version);

const caer = (page) =>
  page.evaluate(() => {
    // La hora de la caída, que es desde donde se mide la espera. Medir desde
    // la suscripción ANTERIOR mezclaría el ida y vuelta de la prueba con el
    // retroceso, y entonces la afirmación no diría nada.
    window.__caidas = [...(window.__caidas ?? []), Date.now()];
    window.__ultima.alFallar(new Error("se cortó"));
  });

const leer = (page, que) => page.evaluate((q) => window[q], que);

// =====================================================================
// 1. Revive
// =====================================================================

test("al cortarse, se vuelve a suscribir sola", async ({ page }) => {
  const errores = await cargar(page);
  expect(await leer(page, "__suscripciones")).toBe(1);

  await caer(page);

  await expect
    .poll(() => leer(page, "__suscripciones"), { timeout: 5000 })
    .toBe(2);

  expect(errores, errores.join(" | ")).toEqual([]);
});

test("y la vista nueva llega por la suscripción nueva", async ({ page }) => {
  /*
   * Revivir sin entregar no sirve de nada: lo que el jugador necesita no es
   * una conexión abierta, es volver a ver la mesa que se movió sin él.
   */
  await cargar(page);
  await entregar(page, 1);
  expect(await leer(page, "__vistas")).toEqual([1]);

  await caer(page);
  await expect.poll(() => leer(page, "__suscripciones")).toBe(2);

  await entregar(page, 2);
  expect(await leer(page, "__vistas")).toEqual([1, 2]);
});

test("las esperas crecen: la segunda caída espera más que la primera", async ({ page }) => {
  /*
   * Sin el crecimiento, una partida de la que nos echaron —un permiso
   * denegado, que no se arregla esperando— se reintentaría cada segundo hasta
   * que el jugador cierre la pestaña.
   */
  await cargar(page);

  await caer(page);
  await expect.poll(() => leer(page, "__suscripciones"), { timeout: 5000 }).toBe(2);

  await caer(page);
  await expect.poll(() => leer(page, "__suscripciones"), { timeout: 8000 }).toBe(3);

  const [cuando, caidas] = await Promise.all([leer(page, "__cuando"), leer(page, "__caidas")]);
  // Cada espera va de SU caída a la suscripción que la siguió.
  const primera = cuando[1] - caidas[0];
  const segunda = cuando[2] - caidas[1];

  expect(primera, `la primera esperó ${primera} ms`).toBeGreaterThanOrEqual(900);
  expect(segunda, `la primera esperó ${primera} ms y la segunda ${segunda}`)
    .toBeGreaterThan(primera + 500);
});

// =====================================================================
// 2. Lo que se le cuenta a la mesa
// =====================================================================

test("avisa cuando se cae y cuando vuelve", async ({ page }) => {
  await cargar(page);
  expect(await leer(page, "__conexion"), "conectar la primera vez no es noticia").toEqual([]);

  await caer(page);
  const caido = (await leer(page, "__conexion"))[0];
  expect(caido.conectado).toBe(false);
  expect(caido.intentos).toBe(1);

  await expect.poll(() => leer(page, "__suscripciones")).toBe(2);
  await entregar(page, 1);

  const vuelta = (await leer(page, "__conexion"))[1];
  expect(vuelta.conectado, "no avisó que volvió").toBe(true);
});

test("vuelve a avisar aunque no haya vista nueva que entregar", async ({ page }) => {
  /*
   * Si mientras no estábamos nadie jugó, la versión que llega al reconectar es
   * la que ya está en pantalla y el filtro la descarta. Eso es correcto — pero
   * la conexión volvió igual, y dejar puesto el cartel de «sin conexión» sería
   * mentir sobre lo único que ese cartel tiene que decir.
   */
  await cargar(page);
  await entregar(page, 7);

  await caer(page);
  await expect.poll(() => leer(page, "__suscripciones")).toBe(2);

  // La MISMA versión: el filtro la va a descartar.
  await entregar(page, 7);

  expect(await leer(page, "__vistas"), "entregó dos veces la misma versión").toEqual([7]);
  expect((await leer(page, "__conexion")).at(-1).conectado).toBe(true);
});

test("cuenta hace cuánto se cayó, para que la mesa suba el tono", async ({ page }) => {
  await cargar(page);
  await caer(page);

  const primera = (await leer(page, "__conexion"))[0];
  expect(primera.caidaHaceMs).toBeLessThan(500);

  await expect.poll(() => leer(page, "__suscripciones"), { timeout: 5000 }).toBe(2);
  await caer(page);

  const segunda = (await leer(page, "__conexion"))[1];
  expect(segunda.intentos).toBe(2);
  expect(
    segunda.caidaHaceMs,
    "la cuenta se reinició: tiene que medir desde la PRIMERA caída",
  ).toBeGreaterThan(primera.caidaHaceMs);
});

// =====================================================================
// 3. El filtro de versión sobrevive a la reconexión
// =====================================================================

test("una versión vieja que vuelve a llegar no se repinta", async ({ page }) => {
  /*
   * El filtro se crea UNA vez, afuera del `suscribir`. Uno nuevo por cada
   * reconexión volvería a entregar lo que ya está en pantalla — y en una mesa
   * eso es repintar el tablero entero y reiniciar la cuenta regresiva.
   */
  await cargar(page);
  await entregar(page, 3);
  await entregar(page, 4);

  await caer(page);
  await expect.poll(() => leer(page, "__suscripciones")).toBe(2);

  await entregar(page, 3);
  await entregar(page, 4);
  expect(await leer(page, "__vistas")).toEqual([3, 4]);

  await entregar(page, 5);
  expect(await leer(page, "__vistas")).toEqual([3, 4, 5]);
});

// =====================================================================
// 4. Cortar de verdad
// =====================================================================

test("después de cortar, una caída no resucita nada", async ({ page }) => {
  /*
   * La mesa corta en `pagehide`. Una escucha que revive después de que el
   * jugador se fue es una suscripción a Firestore por cada caída, para
   * siempre, sobre una página que ya no existe.
   */
  await cargar(page);
  await page.evaluate(() => window.cortar());

  expect(await leer(page, "__vivas"), "no se dio de baja la suscripción").toBe(0);

  await caer(page);
  await page.waitForTimeout(1500);

  expect(await leer(page, "__suscripciones"), "revivió después de cortar").toBe(1);
  expect(await leer(page, "__conexion"), "siguió avisando después de cortar").toEqual([]);
});

test("y una vista que llega tarde tampoco se pinta", async ({ page }) => {
  await cargar(page);
  await page.evaluate(() => window.cortar());

  await entregar(page, 9);
  expect(await leer(page, "__vistas")).toEqual([]);
});
