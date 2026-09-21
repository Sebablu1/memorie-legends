/**
 * La portada baja Firebase sólo si este navegador ya inició sesión alguna vez.
 *
 * `portada.js` existe para una sola cosa: mandar al tablero a quien ya está
 * adentro. Para saberlo arrastra Firebase Auth —firebase-app, firebase-auth,
 * el iframe de Google y su consulta—, unos 196 KB en un teléfono. Para quien
 * nunca entró es peso muerto: no hay a quién mandar a ningún lado.
 *
 * `firebase-nucleo.js` deja la marca `ml-sesion` cuando hay sesión y la saca
 * cuando no la hay. La portada la lee sin bajar nada y decide.
 *
 * Firebase no existe en esta suite: se reemplazan sus dos módulos del CDN por
 * unos de mentira que contestan lo que cada prueba necesita.
 */

import { test, expect } from "@playwright/test";

const FIREBASE_APP = `export function initializeApp(config) { return { config }; }`;

// `onAuthStateChanged` contesta con lo que la prueba dejó en
// `window.__usuarioFalso`: un usuario, o nadie.
const FIREBASE_AUTH = `
  export function getAuth(app) { return { app }; }
  export function onAuthStateChanged(auth, alCambiar) {
    setTimeout(() => alCambiar(window.__usuarioFalso ?? null), 0);
    return () => {};
  }
  export async function createUserWithEmailAndPassword() { return { user: {} }; }
  export async function signInWithEmailAndPassword() { return { user: {} }; }
  export async function signOut() {}
  export async function sendPasswordResetEmail() {}
  export class GoogleAuthProvider {}
  export async function signInWithPopup() { return { user: {} }; }
`;

const modulo = (cuerpo) => (r) =>
  r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: cuerpo });

/** Firebase de mentira, y un registro de todo lo que la portada pida de él. */
async function prepararFirebase(page) {
  const pedidos = [];
  page.on("request", (r) => {
    if (/portada\.js|firebase-nucleo\.js|gstatic\.com|firebaseapp\.com|googleapis\.com/.test(r.url())) {
      pedidos.push(r.url().split("/").pop());
    }
  });
  await page.route("**/firebasejs/10.7.1/firebase-app.js", modulo(FIREBASE_APP));
  await page.route("**/firebasejs/10.7.1/firebase-auth.js", modulo(FIREBASE_AUTH));
  // El tablero, reducido a una página que dice dónde está.
  await page.route("**/dashboard.html", (r) =>
    r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: "<title>tablero</title>" }),
  );
  return pedidos;
}

/** Deja el navegador como lo dejó una visita anterior. */
async function conMarca(page, valor) {
  await page.addInitScript((v) => {
    if (!sessionStorage.getItem("__marcaPuesta")) {
      sessionStorage.setItem("__marcaPuesta", "1");
      if (v === null) localStorage.removeItem("ml-sesion");
      else localStorage.setItem("ml-sesion", v);
    }
  }, valor);
}

async function esperarLaCarga(page) {
  await page.waitForLoadState("load");
  // `portada.js` se agrega en `load`: se le da tiempo a pedirse, si lo hiciera.
  await page.waitForTimeout(800);
}

test("sin la marca, la portada no baja nada de Firebase", async ({ page }) => {
  const pedidos = await prepararFirebase(page);
  await page.goto("/index.html");
  await esperarLaCarga(page);
  expect(pedidos, "la portada pidió Firebase a alguien que nunca entró").toEqual([]);
});

test("con la marca y sesión abierta, manda al tablero", async ({ page }) => {
  const pedidos = await prepararFirebase(page);
  await conMarca(page, "1");
  await page.addInitScript(() => { window.__usuarioFalso = { uid: "uid-de-prueba" }; });

  await page.goto("/index.html");
  await page.waitForURL("**/dashboard.html", { timeout: 10_000 });
  expect(pedidos).toContain("portada.js");
});

test("con la marca pero sin sesión, se queda y la marca se borra", async ({ page }) => {
  // Es lo que pasa después de cerrar sesión en otra pestaña, o cuando la
  // sesión venció: la marca quedó, pero ya no hay nadie. La portada pregunta,
  // no manda a ningún lado, y el núcleo saca la marca para la próxima vez.
  await prepararFirebase(page);
  await conMarca(page, "1");

  await page.goto("/index.html");
  await esperarLaCarga(page);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("ml-sesion")), { timeout: 5_000 })
    .toBeNull();
  expect(page.url()).toContain("/index.html");
});

test("con sesión, el núcleo pone la marca", async ({ page }) => {
  // Cualquier página que pase por el núcleo con alguien adentro —la de
  // ingreso, el tablero— deja la marca. Se prueba el núcleo solo.
  await prepararFirebase(page);
  await conMarca(page, null);
  await page.addInitScript(() => { window.__usuarioFalso = { uid: "uid-de-prueba" }; });

  await page.goto("/index.html");
  await esperarLaCarga(page);
  await page.evaluate(() => import("/js/firebase-nucleo.js"));
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("ml-sesion")), { timeout: 5_000 })
    .toBe("1");
});

test("si el navegador no deja leer el almacenamiento, hace lo de antes", async ({ page }) => {
  // Algunos navegadores en modo privado tiran un error al tocar
  // `localStorage`. Sin poder leer la marca no se sabe si hay sesión, y lo
  // seguro es lo de siempre: bajar Firebase y preguntar.
  const pedidos = await prepararFirebase(page);
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error("almacenamiento bloqueado"); };
    Storage.prototype.setItem = () => { throw new Error("almacenamiento bloqueado"); };
  });

  await page.goto("/index.html");
  await esperarLaCarga(page);
  expect(pedidos, "sin poder leer la marca, la portada no preguntó").toContain("portada.js");
});
