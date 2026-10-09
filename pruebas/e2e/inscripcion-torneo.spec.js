/**
 * Anotarse a un torneo: el cuadro, la casilla y el cobro.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE ARCHIVO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque «Anotarme» es el único botón del lobby que descuenta Leyendas de una
 * y no lo apretaba ninguna prueba. `lobby.spec.js` dibuja la cartelera y
 * comprueba que la fila esté bien escrita, pero no llega a tocar el botón; del
 * cuadro que se abre al tocarlo —el que reemplazó al `window.confirm`— no
 * había nada.
 *
 * Lo que se defiende acá son dos cosas distintas:
 *
 *   - que la plata no se mueva sin que alguien acepte. La casilla es lo único
 *     que separa un clic distraído de una entrada cobrada, y el botón de
 *     inscribirse tiene que nacer apagado;
 *   - que salir sin aceptar no cobre nada. Un cuadro que cierra y manda igual
 *     es peor que no tener cuadro.
 *
 * El asiento de la aceptación lo escribe el servidor y no el navegador, así
 * que acá NO se comprueba: eso vive en `functions/torneos.js` y lo mira
 * `pruebas/torneos.mjs`. Acá se mira la pantalla.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NO HAY EMULADOR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ningún spec de este repositorio levanta el emulador de Firebase: todos
 * interceptan `js/firebase.js`, `js/servidor.js` y `js/sesion.js` con
 * `page.route` y devuelven módulos de mentira. El arnés de acá es el de
 * `lobby.spec.js`, con dos cambios: `inscribirseATorneo` anota lo que se le
 * pidió y devuelve un saldo, y `mostrarSaldo` anota con qué número lo
 * llamaron. Sin eso no habría forma de afirmar que se cobró.
 */

import { test, expect } from "@playwright/test";

const js = (body) => ({ status: 200, contentType: "text/javascript; charset=utf-8", body });

const SESION_FALSA = `
  export const COLECCION = "users";
  export const CAMPO_SALDO = "credits";
  export async function exigirSesion() {
    return {
      usuario: { uid: "yo", photoURL: null },
      perfil: { uid: "yo", nombre: "Probador", saldo: 1000, partidas: 3, victorias: 1 },
    };
  }
  // La única diferencia con la de \`lobby.spec.js\`: acá se anota con qué
  // número la llamaron. Sin eso no hay forma de afirmar que el saldo nuevo
  // llegó a la pantalla después de pagar la entrada.
  const anotar = (...a) => {
    const lista = JSON.parse(sessionStorage.getItem("__llamadas") ?? "[]");
    lista.push(a);
    sessionStorage.setItem("__llamadas", JSON.stringify(lista));
  };
  export function mostrarSaldo(n) { anotar("mostrarSaldo", n); }
  export function conectarBotonSalir() {}
  export function formatearEspera() { return "listo"; }
`;

// El mismo `firebase.js` de mentira que `lobby.spec.js`, copiado tal cual:
// el lobby pide juegos y salas antes de montar la cartelera, y una copia
// recortada lo deja a medio arrancar sin decir por qué.
const FIREBASE_FALSO = `
  export const app = {};
  export const auth = { currentUser: { uid: "yo" } };
  export const googleProvider = {};
  export const SUPPORT_EMAIL = "soporte@example.com";
  export async function createUserWithEmailAndPassword() { return { user: {} }; }
  export async function signInWithEmailAndPassword() { return { user: {} }; }
  export function onAuthStateChanged(a, fn) { setTimeout(() => fn({ uid: "yo" }), 0); return () => {}; }
  export async function signOut() {}
  export async function sendPasswordResetEmail() {}
  export const GoogleAuthProvider = class {};
  export async function signInWithPopup() { return { user: {} }; }
  export const db = {};
  export const funciones = {};
  export function httpsCallable() { return async () => ({ data: {} }); }
  export const doc = (...a) => a;
  export async function getDoc() { return { exists: () => false, data: () => undefined }; }
  export async function setDoc() {}
  export async function updateDoc() {}
  export const arrayUnion = (x) => x;
  export const arrayRemove = (x) => x;
  export const collection = (db, nombre) => ({ nombre });
  export const query = (c, ...filtros) => ({ ...c, filtros });
  export const where = (campo, op, valor) => ({ campo, op, valor });
  export const orderBy = () => ({});
  export const limit = () => ({});
  export async function getDocs(ref) {
    const lista = ref?.nombre === "juegos" ? (window.__juegos ?? []) : [];
    return { docs: lista.map(({ id, ...datos }) => ({ id, data: () => datos })), forEach() {} };
  }
  export async function deleteDoc() {}
  export async function addDoc() { return {}; }
  export const serverTimestamp = () => null;
  export const increment = (n) => n;
  export async function runTransaction(f) { return f({}); }
  export const onSnapshot = (ref, alRecibir) => {
    const filtros = ref?.filtros ?? [];
    (window.__consultas ??= []).push({ coleccion: ref?.nombre, filtros });
    const cumple = (s) => filtros.every(({ campo, op, valor }) =>
      op === "==" ? s[campo] === valor
      : op === "array-contains" ? (s[campo] ?? []).includes(valor)
      : true);
    setTimeout(() => {
      const salas = (window.__salas ?? []).filter(cumple);
      alRecibir({ docs: salas.map((s) => ({ data: () => s })) });
    }, 0);
    return () => {};
  };
`;

const SERVIDOR_FALSO = `
  export class ErrorDeServidor extends Error {}
  const anotar = (...a) => {
    const lista = JSON.parse(sessionStorage.getItem("__llamadas") ?? "[]");
    lista.push(a);
    sessionStorage.setItem("__llamadas", JSON.stringify(lista));
  };
  export const soyAdministrador = async () => ({ admin: false });
  export const crearSalaPublica = async () => ({});
  export const editarSalaPublica = async () => ({});
  export const borrarSalaPublica = async () => ({});
  export const crearSala = async () => ({});
  export const crearSalaPrivada = async () => ({});
  export const unirseASala = async () => ({});
  export const unirseConCodigo = async () => ({});
  export const listarTorneos = async () => ({ torneos: window.__torneos ?? [] });
  export const inscribirseATorneo = async (id) => {
    anotar("inscribirseATorneo", id);
    return { id, entrada: 150, saldo: 850, inscriptos: 2 };
  };
  export const misItems = async () => ({ items: [] });
  export const misInsignias = async () => ({ insignias: [] });
  export const equiparItem = async () => ({});
  export const desequiparItem = async () => ({});
  export const revanchaDeSala = async () => ({});
  export const abandonarPartida = async () => ({});
  export const marcarListo = async () => ({});
  export const iniciarPartida = async () => ({});
  export const salirDeSalaEnEspera = async () => ({});
  export const reportarJugador = async () => ({});
  export const comprarItem = async () => ({});
  export const listarPacks = async () => ({ packs: [] });
  export const crearOrdenDeCompra = async () => ({});
  export const comprarPack = async () => ({});
`;

const MEMORIE = { id: "memorie", nombre: "Memorie Legends", activo: true, orden: 2, logo: "/img/moneda-80.webp" };

/** Un torneo abierto, con fecha, para que el cuadro tenga las tres líneas. */
const TORNEO = {
  id: "t-primavera",
  nombre: "Copa de Primavera",
  entrada: 150,
  inscriptos: 1,
  comienzaEn: Date.UTC(2026, 11, 12, 23, 30),
  juego: "memorie",
};

async function abrirLobby(page, { torneos = [TORNEO] } = {}) {
  await page.addInitScript((d) => Object.assign(window, d), {
    __juegos: [MEMORIE], __salas: [], __admin: false, __torneos: torneos,
  });
  await page.route("**/js/sesion.js", (r) => r.fulfill(js(SESION_FALSA)));
  await page.route("**/js/firebase.js", (r) => r.fulfill(js(FIREBASE_FALSO)));
  await page.route("**/js/servidor.js", (r) => r.fulfill(js(SERVIDOR_FALSO)));
  await page.goto("/lobby.html");
  await expect(page.locator('[data-torneo="t-primavera"]')).toBeVisible({ timeout: 9000 });
}

const llamadas = (page) =>
  page.evaluate(() => JSON.parse(sessionStorage.getItem("__llamadas") ?? "[]"));

const inscripciones = async (page) =>
  (await llamadas(page)).filter(([q]) => q === "inscribirseATorneo");

/**
 * Las inscripciones DESPUÉS de dejar que el manejador termine.
 *
 * Para afirmar que algo NO pasó no alcanza con mirar enseguida: `anotarse`
 * llama al servidor después de que el cuadro se cerró, así que leer en el
 * mismo instante da la lista vacía aunque la llamada esté en camino. Pasó: un
 * mutante que inscribía al cancelar sobrevivió a estas pruebas.
 *
 * El servidor de mentira resuelve en un microtask; 400 ms es holgado de
 * sobra, y es tiempo que sólo se paga en las dos pruebas que comprueban una
 * ausencia.
 */
const inscripcionesYaAsentadas = async (page) => {
  await page.waitForTimeout(400);
  return inscripciones(page);
};

// ─────────────────────────────────────────────────────────────────────────

test("el cuadro dice a qué torneo, cuánto cuesta y cuándo empieza", async ({ page }) => {
  await abrirLobby(page);
  await page.locator('[data-torneo="t-primavera"]').click();

  const cuadro = page.locator("dialog.cuadro-torneo");
  await expect(cuadro).toBeVisible();

  // Las tres cosas que el `confirm` decía, porque son las que hacen falta
  // antes de pagar: qué se compra, cuánto sale y si se va a poder estar.
  await expect(cuadro).toContainText("Copa de Primavera");
  await expect(cuadro).toContainText(/150 Leyendas/);
  await expect(cuadro).toContainText(/se cobra ahora/i);
  await expect(cuadro).toContainText(/Empieza el/);
  await expect(cuadro).toContainText(/cuatro jugadores, se cancela/i);

  // Y los dos textos que hay que poder abrir antes de aceptarlos. Sin esto la
  // casilla pediría aceptar a ciegas, que fue el motivo de dejar el `confirm`.
  await expect(cuadro.locator('a[href="/terminos.html"]')).toBeVisible();
  await expect(cuadro.locator('a[href="/reglamento-torneos.html"]')).toBeVisible();
});

test("sin marcar la casilla no se puede inscribir", async ({ page }) => {
  await abrirLobby(page);
  await page.locator('[data-torneo="t-primavera"]').click();

  const cuadro = page.locator("dialog.cuadro-torneo");
  const casilla = cuadro.locator("#ctAcepto");
  const confirmar = cuadro.locator("#ctSi");

  await expect(casilla).not.toBeChecked();
  await expect(confirmar).toBeDisabled();

  await casilla.check();
  await expect(confirmar).toBeEnabled();

  // Y se puede volver atrás: desmarcar lo apaga de nuevo. Si sólo se
  // encendiera, quien marca por error y desmarca quedaría con el botón vivo.
  await casilla.uncheck();
  await expect(confirmar).toBeDisabled();
});

test("aceptando y confirmando, se cobra y el botón queda anotado", async ({ page }) => {
  await abrirLobby(page);
  await page.locator('[data-torneo="t-primavera"]').click();

  await page.locator("#ctAcepto").check();
  await page.locator("#ctSi").click();

  await expect(page.locator("dialog.cuadro-torneo")).toBeHidden();

  // Se pidió la inscripción, una sola vez y para el torneo que se tocó.
  await expect.poll(() => inscripciones(page)).toEqual([["inscribirseATorneo", "t-primavera"]]);

  // Y el saldo nuevo llegó a la pantalla. Es la mitad que el jugador ve: si
  // `mostrarSaldo` no se llama, sigue leyendo el número viejo hasta recargar.
  const saldos = (await llamadas(page)).filter(([q]) => q === "mostrarSaldo");
  expect(saldos.at(-1), "no se actualizó el saldo en pantalla").toEqual(["mostrarSaldo", 850]);

  await expect(page.locator("#avisoTorneosJugador")).toContainText(/Anotado a «Copa de Primavera»/);
});

test("cancelar no cobra nada", async ({ page }) => {
  await abrirLobby(page);
  await page.locator('[data-torneo="t-primavera"]').click();

  // Incluso con la casilla marcada: aceptar los textos no es confirmar el
  // pago, y el cuadro tiene que poder abandonarse después de haberla tocado.
  await page.locator("#ctAcepto").check();
  await page.locator("dialog.cuadro-torneo .sobria").click();

  await expect(page.locator("dialog.cuadro-torneo")).toBeHidden();
  expect(await inscripcionesYaAsentadas(page), "cobró al cancelar").toEqual([]);
});

test("Escape cierra sin cobrar, y el botón vuelve a servir", async ({ page }) => {
  await abrirLobby(page);
  await page.locator('[data-torneo="t-primavera"]').click();
  await expect(page.locator("dialog.cuadro-torneo")).toBeVisible();

  // Se marca ANTES de salir, a propósito: es lo que deja sucio el cuadro. Sin
  // esta línea la prueba abría y cerraba sin tocar nada, y entonces el cuadro
  // aparecía limpio la segunda vez aunque nadie lo limpiara — comprobaba que
  // una casilla que nunca se marcó siguiera sin marcar.
  await page.locator("#ctAcepto").check();

  await page.keyboard.press("Escape");
  await expect(page.locator("dialog.cuadro-torneo")).toBeHidden();
  expect(await inscripcionesYaAsentadas(page), "cobró al salir con Escape").toEqual([]);

  // Un cuadro que al cerrarse deja el botón muerto obliga a recargar, y quien
  // no lo sepa cree que los torneos están rotos.
  await page.locator('[data-torneo="t-primavera"]').click();
  await expect(page.locator("dialog.cuadro-torneo")).toBeVisible();

  // Y vuelve a abrirse LIMPIO: la casilla no se queda marcada de la vez
  // anterior. Si se quedara, el segundo torneo del día se pagaría sin que
  // nadie aceptara nada.
  await expect(page.locator("#ctAcepto")).not.toBeChecked();
  await expect(page.locator("#ctSi")).toBeDisabled();
});
