/**
 * La sala de espera muestra lo que cada uno compró.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ACÁ IMPORTA MÁS QUE EN LA MESA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * En la mesa uno mira las cartas. En la sala de espera no hay nada que hacer
 * salvo ver quién llegó, así que es el momento en que un avatar, un marco o un
 * título comprado se miran de verdad.
 *
 * El dato ya viajaba —`jugadoresLuce` está en el documento de la sala desde
 * que se armaron los dorsos— y la sala lo ignoraba: pintaba una inicial en un
 * círculo. Quien compraba un avatar lo veía recién al empezar la partida.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE SE MIDE Y NO SE MIRA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El tamaño de la ficha. La forma tentadora de poner un marco es un `border`,
 * y un borde cambia la caja: las filas de la lista dejarían de alinearse según
 * quién tenga marco. Se compara una fila con marco contra una sin marco.
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
 * Firestore de mentira con la sala bajo control de la prueba.
 *
 * `window.__sala` es el documento tal como lo escribe el servidor. Lo que se
 * ejercita es el dibujado REAL de `room.js`, no una fila inyectada a mano.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXPORTA DE MÁS Y NO SÓLO LOS TRES QUE USA room.js
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque `room.html` carga más de un módulo. `room.js` importa tres cosas de
 * acá, pero también importa `servidor.js`, que importa `funciones` y
 * `httpsCallable` del MISMO archivo. Un `import` con nombre de algo que el
 * módulo no exporta no da `undefined`: rompe el módulo entero al enlazarlo, y
 * con él a todo el que lo importa. La sala no se dibuja nunca y la prueba se
 * queda esperando una fila que no va a llegar.
 *
 * Pasó exactamente eso la primera vez que corrió este archivo, con un doble de
 * tres líneas. Así que el doble lleva todo lo que lleva el real, que es
 * además lo que hacen los otros dobles de `firebase.js` de esta carpeta.
 */
const firebaseFalso = `
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

  export const db = {};
  export const funciones = {};
  export function httpsCallable() { return async () => ({ data: {} }); }
  export const doc = (...a) => a;
  export async function getDoc() { return { exists: () => false, data: () => undefined }; }
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

  export const onSnapshot = (ref, alRecibir) => {
    alRecibir({ exists: () => true, data: () => window.__sala });
    return () => {};
  };
`;

/** Un archivo que existe de verdad, para que el navegador no deje un roto. */
const CARA = "/img/avatar/mago.webp";
const MARCO = "/img/insignias/heroe.webp";

async function abrirSala(page, sala) {
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));

  await page.addInitScript((s) => {
    window.__sala = s;
  }, sala);

  await page.route("**/js/sesion.js", (r) => r.fulfill(js(SESION_FALSA)));
  await page.route("**/js/firebase.js", (r) => r.fulfill(js(firebaseFalso)));

  await page.goto("/room.html?code=ABC234");

  // Con plazo corto y con el motivo puesto: si un doble le queda debiendo un
  // export a la página, lo que se ve sin esto es una espera de treinta
  // segundos por una fila, y no la línea que dice qué módulo no cargó.
  await page
    .waitForSelector("#listaJugadores .jugador-fila", { timeout: 10_000 })
    .catch(() => {
      throw new Error(
        `la sala no dibujó ninguna fila. Errores de la página: ${errores.join(" | ") || "(ninguno)"}`,
      );
    });
  return errores;
}

/** Una sala en espera con los cuatro jugadores y lo que luce cada uno. */
const salaCon = (luce) => ({
  codigo: "ABC234",
  nombre: "Mesa de prueba",
  estado: "esperando",
  entrada: 50,
  maxJugadores: 4,
  creador: "ana",
  listos: [],
  jugadores: ["ana", "beto", "caro", "dani"],
  jugadoresNombres: ["Ana", "Beto", "Caro", "Dani"],
  jugadoresLuce: luce,
});

const SIN_NADA = { retrato: null, dorso: null, insignia: null, marco: null, titulo: null };

/** La fila de un jugador, por su lugar en la lista. */
const fila = (page, i) => page.locator("#listaJugadores .jugador-fila").nth(i);

// =====================================================================

test("el avatar comprado se ve, y quien no tiene sigue con su inicial", async ({ page }) => {
  const errores = await abrirSala(page, salaCon([
    { ...SIN_NADA, retrato: CARA },
    SIN_NADA,
    SIN_NADA,
    SIN_NADA,
  ]));

  await expect(fila(page, 0).locator(".avatar-inicial img")).toHaveAttribute("src", CARA);

  // Beto no compró nada: le queda la inicial de siempre.
  await expect(fila(page, 1).locator(".avatar-inicial")).toHaveText("B");
  await expect(fila(page, 1).locator(".avatar-inicial img")).toHaveCount(0);

  expect(errores, `la sala tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

test("el marco se dibuja, y sólo sobre quien lo tiene", async ({ page }) => {
  await abrirSala(page, salaCon([
    { ...SIN_NADA, retrato: CARA, marco: MARCO },
    SIN_NADA,
    SIN_NADA,
    SIN_NADA,
  ]));

  await expect(page.locator(".marco-sala")).toHaveCount(1);
  await expect(fila(page, 0).locator(".marco-sala")).toHaveAttribute("src", MARCO);
});

test("el marco no cambia el tamaño de la ficha", async ({ page }) => {
  /**
   * La prueba que impide que alguien lo convierta en `border`.
   *
   * Con un borde de verdad, la fila con marco mediría distinto y la lista
   * quedaría despareja según quién compró qué.
   */
  await abrirSala(page, salaCon([
    { ...SIN_NADA, retrato: CARA, marco: MARCO },
    { ...SIN_NADA, retrato: CARA },
    SIN_NADA,
    SIN_NADA,
  ]));

  const conMarco = await fila(page, 0).locator(".ficha-jugador").boundingBox();
  const sinMarco = await fila(page, 1).locator(".ficha-jugador").boundingBox();

  // Y que el primero tenga marco de verdad, que es de lo que se trata.
  await expect(fila(page, 0).locator(".marco-sala")).toHaveCount(1);
  await expect(fila(page, 1).locator(".marco-sala")).toHaveCount(0);

  expect(conMarco.width).toBeCloseTo(sinMarco.width, 0);
  expect(conMarco.height).toBeCloseTo(sinMarco.height, 0);
});

test("el marco se achica a la ficha aunque el archivo sea enorme", async ({ page }) => {
  /**
   * La prueba que faltaba cuando la de arriba ya estaba en verde.
   *
   * Medir `.ficha-jugador` no alcanza: el marco va en posición absoluta, así
   * que puede pintarse del tamaño de una pantalla sin mover ni un píxel la
   * caja que la prueba anterior compara. Con `width: auto` eso es justo lo
   * que pasaba —una imagen reemplazada en absoluto no se estira hasta los
   * `inset`, se pinta al tamaño del archivo— y la lista entera quedaba tapada
   * por un escudo dorado. Las ocho pruebas seguían pasando.
   *
   * Se mide entonces lo que se pinta, y no lo que lo contiene.
   */
  await abrirSala(page, salaCon([
    { ...SIN_NADA, retrato: CARA, marco: MARCO },
    SIN_NADA,
    SIN_NADA,
    SIN_NADA,
  ]));

  const marco = fila(page, 0).locator(".marco-sala");
  await expect(marco).toHaveCount(1);

  // Primero: que el archivo de prueba SEA grande. Si algún día se cambia por
  // un icono de 40px, esta prueba dejaría de probar nada y en silencio.
  const natural = await marco.evaluate((img) => img.naturalWidth);
  expect(natural, `${MARCO} tiene que ser mucho más grande que la ficha`).toBeGreaterThan(200);

  const caja = await marco.boundingBox();
  const ficha = await fila(page, 0).locator(".ficha-jugador").boundingBox();

  // Y que igual se pinte del tamaño de la ficha, con el desborde de adorno.
  expect(caja.width).toBeLessThan(ficha.width + 16);
  expect(caja.height).toBeLessThan(ficha.height + 16);
});

test("el título se muestra al lado del nombre", async ({ page }) => {
  await abrirSala(page, salaCon([
    SIN_NADA,
    { ...SIN_NADA, titulo: "Élite" },
    SIN_NADA,
    SIN_NADA,
  ]));

  await expect(fila(page, 1).locator(".titulo-jugador")).toHaveText("Élite");
  await expect(page.locator(".titulo-jugador")).toHaveCount(1);
});

test("un título con HTML se muestra como texto", async ({ page }) => {
  /**
   * Lo teclea un administrador en el catálogo y viaja hasta la pantalla de
   * todos. Es la misma regla que ya cubre el nombre de jugador en esta
   * pantalla, por el mismo motivo.
   */
  const errores = await abrirSala(page, salaCon([
    { ...SIN_NADA, titulo: '<img src=x onerror="window.__colado=1">' },
    SIN_NADA,
    SIN_NADA,
    SIN_NADA,
  ]));

  expect(await page.evaluate(() => window.__colado)).toBeUndefined();
  expect(await page.locator("#listaJugadores img[onerror]").count()).toBe(0);
  expect(errores).toEqual([]);
});

test("un avatar o un marco de fuera del sitio no se dibujan", async ({ page }) => {
  /**
   * Lo que hay en la sala lo escribió el servidor, pero un `src` a otro
   * dominio le avisaría a ese dominio quién está mirando esta sala y desde
   * dónde. Es el mismo filtro que ya tiene la mesa.
   */
  await abrirSala(page, salaCon([
    {
      ...SIN_NADA,
      retrato: "https://otro-sitio.example/cara.png",
      marco: "https://otro-sitio.example/marco.png",
    },
    SIN_NADA,
    SIN_NADA,
    SIN_NADA,
  ]));

  await expect(page.locator(".marco-sala")).toHaveCount(0);
  // Y la cara cae a la inicial, en vez de quedar rota.
  await expect(fila(page, 0).locator(".avatar-inicial")).toHaveText("A");
});

test("una sala del formato viejo sigue dibujándose", async ({ page }) => {
  /**
   * `jugadoresLuce` reemplazó a `jugadoresRetratos`, que sólo llevaba la cara.
   * Puede haber salas abiertas creadas antes del cambio, y tienen que pintarse
   * sin marco y sin título en vez de romperse.
   */
  const sala = salaCon(undefined);
  delete sala.jugadoresLuce;
  sala.jugadoresRetratos = [CARA, null, null, null];

  const errores = await abrirSala(page, sala);

  await expect(fila(page, 0).locator(".avatar-inicial img")).toHaveAttribute("src", CARA);
  await expect(page.locator(".marco-sala")).toHaveCount(0);
  await expect(page.locator(".titulo-jugador")).toHaveCount(0);
  expect(errores, `la sala tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

test("sin nada comprado, la sala se ve como siempre", async ({ page }) => {
  const errores = await abrirSala(page, salaCon([SIN_NADA, SIN_NADA, SIN_NADA, SIN_NADA]));

  await expect(page.locator("#listaJugadores .jugador-fila")).toHaveCount(4);
  await expect(page.locator(".marco-sala")).toHaveCount(0);
  await expect(page.locator(".titulo-jugador")).toHaveCount(0);
  await expect(fila(page, 0).locator(".avatar-inicial")).toHaveText("A");
  expect(errores).toEqual([]);
});
