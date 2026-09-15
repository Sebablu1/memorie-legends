/**
 * La tabla del ranking muestra personas, no identificadores.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE ARREGLÓ ACÁ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La tabla pintaba `f.nombre ?? f.uid ?? "Jugador"` y NADIE escribía `nombre`
 * en las filas del ranking. Durante meses, en la pantalla que su propio
 * comentario llama «la de mayor alcance del sitio», se veía el uid crudo de
 * cada jugador.
 *
 * Nadie lo notó porque no fallaba nada: la tabla se llenaba, los puntos
 * estaban bien, y una cadena de veintiocho caracteres en la columna «Jugador»
 * pasa por un nombre raro si uno no la mira dos veces.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ TODO SALE DE LA FILA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque el navegador NO PUEDE leer el perfil de otro jugador: `users/{uid}`
 * es de lectura sólo para su dueño. La tabla se lee directo de Firestore, así
 * que lo único que puede mostrar es lo que el servidor congeló al puntuar.
 *
 * Eso además es lo correcto para un registro histórico: la fila dice cómo se
 * llamaba y cómo lucía el jugador CUANDO ganó ese puesto, y no cambia porque
 * hoy se haya puesto otro avatar.
 */

import { test, expect } from "@playwright/test";

const js = (body) => ({ status: 200, contentType: "text/javascript; charset=utf-8", body });

const SESION_FALSA = `
  export const COLECCION = "users";
  export const CAMPO_SALDO = "credits";
  export async function exigirSesion() {
    return {
      usuario: { uid: "ana", email: "a@b.c", photoURL: null },
      perfil: { uid: "ana", nombre: "Ana", saldo: 500, comprado: 0, ganado: 500,
                partidas: 0, victorias: 0,
                equipado: { avatar: null, insignia: null, dorso: null } },
    };
  }
  export function mostrarSaldo() {}
  export function conectarBotonSalir() {}
  export function formatearEspera() { return "listo"; }
  export async function leerPerfil() { return {}; }
  export async function guardarEnPerfil() {}
`;

/**
 * Firestore de mentira: `getDocs` devuelve las filas que pone la prueba.
 *
 * Se ejercita el dibujado REAL de `ranking-ui.js`, no una tabla inyectada.
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
  export const query = (...a) => a;
  export const where = () => ({});
  export const orderBy = () => ({});
  export const limit = () => ({});
  export async function deleteDoc() {}
  export async function addDoc() { return {}; }
  export const serverTimestamp = () => null;
  export const increment = (n) => n;
  export async function runTransaction(f) { return f({}); }
  export function onSnapshot() { return () => {}; }
  export async function getDocs() {
    return { docs: (window.__filas ?? []).map((d) => ({ data: () => d })) };
  }
`;

/** Archivos que existen de verdad, para que el navegador no deje un roto. */
const CARA = "/img/avatar/mago.webp";
const MARCO = "/img/insignias/heroe.webp";

const fila = (extra) => ({
  uid: extra.uid,
  puntos: extra.puntos ?? 100,
  partidasJugadas: 3,
  partidasGanadas: 1,
  ...extra,
});

async function abrirRanking(page, filas) {
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));

  await page.addInitScript((f) => {
    window.__filas = f;
  }, filas);

  await page.route("**/js/sesion.js", (r) => r.fulfill(js(SESION_FALSA)));
  await page.route("**/js/firebase.js", (r) => r.fulfill(js(firebaseFalso)));

  await page.goto("/ranking.html");
  await page
    .waitForSelector(".tabla-ranking tbody tr", { timeout: 10_000 })
    .catch(() => {
      throw new Error(
        `el ranking no dibujó ninguna fila. Errores: ${errores.join(" | ") || "(ninguno)"}`,
      );
    });
  return errores;
}

const filaN = (page, i) => page.locator(".tabla-ranking tbody tr").nth(i);

// =====================================================================

test("muestra el nombre congelado, no el uid", async ({ page }) => {
  const errores = await abrirRanking(page, [
    fila({ uid: "fFuz3IPJLWcUYYipVuTij94nsMC2", nombre: "Ana", puntos: 300 }),
  ]);

  await expect(filaN(page, 0).locator(".nombre-ranking")).toHaveText("Ana");

  // Y el uid NO aparece en ningún lado del texto de la tabla. Es la mitad que
  // importa: mostrar el nombre no sirve de nada si el uid sigue a la vista.
  const texto = await page.locator(".tabla-ranking").innerText();
  expect(texto, "el uid no puede verse").not.toContain("fFuz3IPJLWcUYYipVuTij94nsMC2");

  expect(errores, `el ranking tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

test("una fila vieja sin nombre dice «Jugador», no el uid", async ({ page }) => {
  /**
   * Ninguna fila anterior al cambio trae nombre.
   *
   * El respaldo no puede ser el uid —es lo que se vino a sacar— así que es una
   * palabra genérica. Esas filas se arreglan solas la primera vez que ese
   * jugador vuelva a puntuar.
   */
  await abrirRanking(page, [fila({ uid: "fFuz3IPJLWcUYYipVuTij94nsMC2", puntos: 300 })]);

  await expect(filaN(page, 0).locator(".nombre-ranking")).toHaveText("Jugador");

  const texto = await page.locator(".tabla-ranking").innerText();
  expect(texto).not.toContain("fFuz3IPJLWcUYYipVuTij94nsMC2");
});

test("la cara, el marco y el título salen de la fila", async ({ page }) => {
  await abrirRanking(page, [
    fila({ uid: "ana", nombre: "Ana", retrato: CARA, marco: MARCO, titulo: "Leyenda", puntos: 300 }),
    fila({ uid: "beto", nombre: "Beto", puntos: 200 }),
  ]);

  await expect(filaN(page, 0).locator(".avatar-inicial img")).toHaveAttribute("src", CARA);
  await expect(filaN(page, 0).locator(".marco-ranking")).toHaveAttribute("src", MARCO);
  await expect(filaN(page, 0).locator(".titulo-jugador")).toHaveText("Leyenda");

  // Y sólo sobre quien lo tiene.
  await expect(page.locator(".marco-ranking")).toHaveCount(1);
  await expect(page.locator(".titulo-jugador")).toHaveCount(1);
  await expect(filaN(page, 1).locator(".avatar-inicial")).toHaveText("B");
});

test("el marco no cambia la altura de la fila", async ({ page }) => {
  /**
   * En una tabla esto se nota más que en ningún otro lado: las filas están una
   * arriba de la otra, así que una que mide distinto salta a la vista.
   *
   * ───────────────────────────────────────────────────────────────────────
   * SE COMPARAN LA CUARTA Y LA QUINTA, NO LA PRIMERA Y LA SEGUNDA
   * ───────────────────────────────────────────────────────────────────────
   *
   * Las tres del podio son MÁS ALTAS a propósito: `tr.podio-N .puesto` les
   * agranda la medalla a 1.2rem. Comparar la primera contra la segunda hacía
   * fallar la prueba por 1,5 px de una diferencia que ya existía antes del
   * marco y que es correcta.
   *
   * Es el mismo error que la prueba de la mesa documenta con el asiento
   * propio, que se dibuja más grande que los de los rivales. Una prueba de
   * tamaños tiene que comparar dos cosas que deberían medir lo mismo.
   *
   * Y NINGUNA de las dos puede ser la última: `tr:last-child td` le saca el
   * borde de abajo, así que la última fila mide un píxel menos que todas las
   * demás. También es correcto, y también hacía fallar esta prueba por algo
   * que no tiene nada que ver con el marco.
   *
   * Dos trampas distintas, las dos encontradas midiendo en vez de suponiendo:
   * en aislamiento el marco no cambiaba ninguna altura, así que la diferencia
   * tenía que venir de otro lado.
   */
  await abrirRanking(page, [
    fila({ uid: "uno", nombre: "Uno", puntos: 600 }),
    fila({ uid: "dos", nombre: "Dos", puntos: 500 }),
    fila({ uid: "tres", nombre: "Tres", puntos: 400 }),
    fila({ uid: "cuatro", nombre: "Cuatro", retrato: CARA, marco: MARCO, puntos: 300 }),
    fila({ uid: "cinco", nombre: "Cinco", retrato: CARA, puntos: 200 }),
    fila({ uid: "seis", nombre: "Seis", puntos: 100 }),
  ]);

  const conMarco = await filaN(page, 3).boundingBox();
  const sinMarco = await filaN(page, 4).boundingBox();

  await expect(filaN(page, 3).locator(".marco-ranking")).toHaveCount(1);
  await expect(filaN(page, 4).locator(".marco-ranking")).toHaveCount(0);

  expect(conMarco.height).toBeCloseTo(sinMarco.height, 0);
});

test("el marco se achica a la ficha aunque el archivo sea enorme", async ({ page }) => {
  await abrirRanking(page, [
    fila({ uid: "ana", nombre: "Ana", retrato: CARA, marco: MARCO, puntos: 300 }),
  ]);

  const marco = filaN(page, 0).locator(".marco-ranking");
  const natural = await marco.evaluate((img) => img.naturalWidth);
  expect(natural, `${MARCO} tiene que ser mucho más grande que la ficha`).toBeGreaterThan(200);

  const caja = await marco.boundingBox();
  const ficha = await filaN(page, 0).locator(".ficha-ranking").boundingBox();
  expect(caja.width).toBeLessThan(ficha.width + 16);
  expect(caja.height).toBeLessThan(ficha.height + 16);
});

test("un nombre y un título con HTML se muestran como texto", async ({ page }) => {
  /**
   * El nombre lo elige cada jugador y el título lo teclea un administrador.
   * Los dos llegan a la pantalla de todos los demás, y ésta es la tabla que
   * ve más gente que ninguna otra.
   */
  const errores = await abrirRanking(page, [
    fila({
      uid: "ana",
      nombre: '<img src=x onerror="window.__colado=1">',
      titulo: '<img src=y onerror="window.__colado2=1">',
      puntos: 300,
    }),
  ]);

  expect(await page.evaluate(() => window.__colado)).toBeUndefined();
  expect(await page.evaluate(() => window.__colado2)).toBeUndefined();
  expect(await page.locator(".tabla-ranking img[onerror]").count()).toBe(0);
  expect(errores).toEqual([]);
});

test("una cara o un marco de fuera del sitio no se dibujan", async ({ page }) => {
  /**
   * Lo que hay en la fila lo escribió el servidor, pero un `src` a otro
   * dominio le avisaría a ese dominio quién está mirando el ranking. Es el
   * mismo filtro que ya tienen la mesa y la sala.
   */
  await abrirRanking(page, [
    fila({
      uid: "ana",
      nombre: "Ana",
      retrato: "https://otro-sitio.example/cara.png",
      marco: "https://otro-sitio.example/marco.png",
      puntos: 300,
    }),
  ]);

  await expect(page.locator(".marco-ranking")).toHaveCount(0);
  await expect(filaN(page, 0).locator(".avatar-inicial")).toHaveText("A");
});

test("tu propia fila sigue marcándose por uid", async ({ page }) => {
  /**
   * El uid se conserva en la fila justamente para esto, y no se muestra nunca.
   * Si alguien lo sacara pensando que ya no hace falta, la tabla dejaría de
   * poder señalar cuál sos vos.
   */
  await abrirRanking(page, [
    fila({ uid: "beto", nombre: "Beto", puntos: 300 }),
    fila({ uid: "ana", nombre: "Ana", puntos: 200 }),
  ]);

  await expect(filaN(page, 1)).toHaveClass(/yo/);
  await expect(filaN(page, 0)).not.toHaveClass(/yo/);
});
