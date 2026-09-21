/**
 * Qué ve quien intenta abrir una sala que las reglas no le dejan leer.
 *
 * Desde el Bloque 2, una sala se lee si es pública o si estás sentado en
 * ella. Firestore niega todo lo demás con `permission-denied` —incluida una
 * sala que no existe: no dice si existe antes de ver quién pregunta—. Antes
 * eso no pasaba nunca, así que el navegador no sabía qué hacer: la mesa se
 * quedaba en blanco y la sala decía «No pudimos leer la sala», que suena a
 * falla de la red.
 *
 * Y un caso que no es un intruso: quien sale de una sala deja de estar en
 * `jugadores`, y desde ese momento su propia escucha es rechazada. Eso es la
 * salida funcionando, no un error, y no tiene que mostrarse como uno.
 *
 * Firebase no existe en esta suite: se reemplaza `firebase.js` por un doble
 * completo —la guardia de `dobles-de-partida.mjs` exige que tenga todo lo que
 * la página importa—, que niega cuando la prueba se lo pide.
 */

import { test, expect } from "@playwright/test";

const js = (body) => ({ status: 200, contentType: "text/javascript; charset=utf-8", body });

const SESION_FALSA = `
  export const COLECCION = "users";
  export const CAMPO_SALDO = "credits";
  export async function exigirSesion() {
    return {
      usuario: { uid: "ana", email: "a@b.c", photoURL: null },
      perfil: { uid: "ana", nombre: "Ana", saldo: 500, partidas: 0, victorias: 0 },
    };
  }
  export function mostrarSaldo() {}
  export function conectarBotonSalir() {}
  export function formatearEspera() { return "listo"; }
`;

/**
 * El doble de `firebase.js`.
 *
 *   window.__denegar   la sala se niega, al escucharla y al leerla
 *   window.__sala      la sala que se entrega si no se niega
 *   window.__fallaRed  la lectura falla por otra cosa, no por permisos
 *
 * La función `salirDeSalaEnEspera` hace lo que hace el servidor de verdad: la
 * escucha se entera de que ya no estoy ANTES de que la llamada vuelva.
 */
const FIREBASE_FALSO = `
  export const app = {};
  export const auth = { currentUser: { uid: "ana" } };
  export const googleProvider = {};
  export const SUPPORT_EMAIL = "soporte@example.com";
  export async function createUserWithEmailAndPassword() { return { user: {} }; }
  export async function signInWithEmailAndPassword() { return { user: {} }; }
  export function onAuthStateChanged(a, fn) { setTimeout(() => fn({ uid: "ana" }), 0); return () => {}; }
  export async function signOut() {}
  export async function sendPasswordResetEmail() {}
  export const GoogleAuthProvider = class {};
  export async function signInWithPopup() { return { user: {} }; }

  const negado = () => Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });

  export const db = {};
  export const funciones = {};
  export function httpsCallable(f, nombre) {
    return async () => {
      if (nombre === "salirDeSalaEnEspera") {
        window.__alFallar?.(negado());
        await new Promise((r) => setTimeout(r, 400));
      }
      return { data: {} };
    };
  }
  export const doc = (...a) => a;
  export async function getDoc() {
    if (window.__fallaRed) throw Object.assign(new Error("offline"), { code: "unavailable" });
    if (window.__denegar) throw negado();
    return { exists: () => Boolean(window.__sala), data: () => window.__sala };
  }
  export async function setDoc() {}
  export async function updateDoc() {}
  export const arrayUnion = (x) => x;
  export const arrayRemove = (x) => x;
  export const collection = (...a) => a;
  export const query = (c) => c;
  export const where = () => ({});
  export const orderBy = () => ({});
  export const limit = () => ({});
  export async function getDocs() { return { docs: [], forEach() {} }; }
  export async function deleteDoc() {}
  export async function addDoc() { return {}; }
  export const serverTimestamp = () => null;
  export const increment = (n) => n;
  export async function runTransaction(f) { return f({}); }

  export const onSnapshot = (ref, alRecibir, alFallar) => {
    window.__alFallar = alFallar;
    setTimeout(() => {
      if (window.__denegar) alFallar(negado());
      else alRecibir({ exists: () => true, data: () => window.__sala });
    }, 0);
    return () => { window.__alFallar = null; };
  };
`;

/** Un tablero de mentira, que dice qué aviso le dejaron. */
async function tableroQueAnota(page) {
  await page.route("**/dashboard.html", (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<title>tablero</title><p id="aviso"></p>
             <script>document.getElementById("aviso").textContent = sessionStorage.getItem("avisoLobby") ?? "";</script>`,
    }),
  );
}

async function prepararSala(page, { denegar = false } = {}) {
  await page.addInitScript((d) => {
    window.__denegar = d;
    window.__sala = {
      codigo: "ABC234", estado: "esperando", entrada: 10, maxJugadores: 4, limitePuntos: 150,
      creador: "beto", publica: false, privada: true,
      jugadores: ["beto", "ana"], jugadoresNombres: ["Beto", "Ana"], listos: [],
    };
    // Si en algún momento aparece el cartel de error, queda anotado, aunque
    // sea un instante antes de irse de la página.
    new MutationObserver(() => {
      const titulo = document.getElementById("tituloFinal");
      const final = document.getElementById("avisoFinal");
      if (titulo && final && !final.hidden) sessionStorage.setItem("__cartelVisto", titulo.textContent);
    }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  }, denegar);
  await page.route("**/js/sesion.js", (r) => r.fulfill(js(SESION_FALSA)));
  await page.route("**/js/firebase.js", (r) => r.fulfill(js(FIREBASE_FALSO)));
  await tableroQueAnota(page);
}

// ─────────────────────────────────────────────────────────────── la sala

test("una sala que no te dejan leer lo dice, en vez de parecer una falla de red", async ({ page }) => {
  await prepararSala(page, { denegar: true });
  await page.goto("/room.html?code=ABC234");

  await expect(page.locator("#avisoFinal")).toBeVisible();
  await expect(page.locator("#tituloFinal")).toHaveText("No podés ver esta sala");
  await expect(page.locator("#textoFinal")).toHaveText("Es privada y no estás en ella, o ya no existe.");
});

test("al salir de la sala no aparece ningún error, ni por un instante", async ({ page }) => {
  await prepararSala(page);
  await page.goto("/room.html?code=ABC234");
  await expect(page.locator("#listaJugadores .jugador-fila").first()).toBeVisible();

  await page.locator("#btnSalir").click();
  await page.locator("#btnConfirmarSalida").click();

  await page.waitForURL("**/dashboard.html", { timeout: 10_000 });
  const visto = await page.evaluate(() => sessionStorage.getItem("__cartelVisto"));
  expect(visto, `al salir se vio el cartel «${visto}»`).toBeNull();
});

// ─────────────────────────────────────────────────────────────── la mesa

async function abrirMesa(page, marcas) {
  await page.addInitScript((m) => Object.assign(window, m), marcas);
  await page.route("**/js/guardia-sesion.js", (r) =>
    r.fulfill(js(`export async function exigirSesionEnMesa(){ return { uid: "ana", email: "a@b.c" }; }`)),
  );
  await page.route("**/js/sesion.js", (r) => r.fulfill(js(SESION_FALSA)));
  await page.route("**/js/firebase.js", (r) => r.fulfill(js(FIREBASE_FALSO)));
  await tableroQueAnota(page);
  await page.goto("/mesa.html?sala=ABC234");
  await page.waitForURL("**/dashboard.html", { timeout: 15_000 });
  return page.locator("#aviso").textContent();
}

test("la mesa de una sala que no te dejan leer vuelve al tablero y dice por qué", async ({ page }) => {
  // Sin el `try`, el rechazo quedaba sin atrapar y la mesa, en blanco.
  const aviso = await abrirMesa(page, { __denegar: true });
  expect(aviso).toBe("No estás en esa sala, o ya no existe.");
});

test("si la lectura falla por la red, la mesa no culpa a los permisos", async ({ page }) => {
  const aviso = await abrirMesa(page, { __fallaRed: true });
  expect(aviso).toBe("No pudimos leer la sala. Probá de nuevo en un momento.");
});
