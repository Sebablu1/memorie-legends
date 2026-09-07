/**
 * Lo que el jugador lleva puesto se ve.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO NECESITA UNA PRUEBA PROPIA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Comprar y equipar ya están probados: `pruebas/tienda.mjs` contra el servidor
 * y `tienda-personalizacion.spec.js` contra la tienda. Lo que ninguna de las
 * dos ve es el último tramo — que lo equipado APAREZCA— y es el tramo que
 * justifica todo lo anterior: un avatar que se compró y no se ve es una
 * compra sin producto.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL CASO QUE SE ROMPE SOLO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El perfil guarda un ID —"avatar-dragon"—, no una imagen, y la imagen de ese
 * artículo puede ser un archivo o un emoji. Un emoji no entra en un `<img>`:
 * hay que reemplazar el nodo por un `<span>`. Es un camino que sólo se ejerce
 * con el catálogo de demostración puesto, o sea justo el que nadie prueba a
 * mano, y si se rompe no falla nada: se ve el logo de siempre y parece que el
 * jugador no compró nada.
 */

import { test, expect } from "@playwright/test";

/** Los artículos que devuelve el Firestore de mentira, por id. */
const ARTICULOS = {
  "avatar-dragon": { tipo: "avatar", nombre: "El Dragón", imagen: "🐉", precio: 2500 },
  "avatar-foto": { tipo: "avatar", nombre: "Con archivo", imagen: "/img/dorsos/dorso-azul.png", precio: 100 },
  "insignia-corona": { tipo: "insignia", nombre: "Corona de Laurel", imagen: "🏆", precio: 1800 },
};

const firebaseFalso = `
  export const app = {}; export const auth = {}; export const db = {}; export const funciones = {};
  export const googleProvider = {}; export const SUPPORT_EMAIL = "soporte@example.com";
  export function httpsCallable() { return async () => ({ data: {} }); }
  export function onAuthStateChanged(a, fn) { setTimeout(() => fn({ uid: "u1" }), 10); return () => {}; }
  export const doc = (db, col, id) => ({ col, id });
  export const collection = () => ({});
  export const query = (c) => c; export const orderBy = () => ({}); export const limit = () => ({});
  export const where = () => ({});
  export async function getDocs() { return { docs: [], forEach() {} }; }
  export async function getDoc(ref) {
    const tabla = ${JSON.stringify(ARTICULOS)};
    const item = tabla[ref?.id];
    return { exists: () => Boolean(item), data: () => item };
  }
  export async function setDoc() {} export async function updateDoc() {}
  export function onSnapshot() { return () => {}; }
  export async function deleteDoc() {} export async function addDoc() { return {}; }
  export const serverTimestamp = () => null; export const increment = (n) => n;
  export const arrayUnion = (x) => x; export const arrayRemove = (x) => x;
  export async function runTransaction(f) { return f({}); }
  export async function signOut() {}
`;

const sesionFalsa = (equipado, foto = null) => `
  export const COLECCION = "users"; export const CAMPO_SALDO = "credits";
  export async function exigirSesion() {
    return { usuario: { uid: "u1", photoURL: ${JSON.stringify(foto)} },
             perfil: { uid: "u1", nombre: "Seba", saldo: 500, partidas: 3, victorias: 1,
                        equipado: ${JSON.stringify(equipado)} } };
  }
  export async function leerPerfil() { return { saldo: 500 }; }
  export function mostrarSaldo() {} export function conectarBotonSalir() {}
  export function formatearEspera() { return "listo"; }
`;

async function abrirTablero(page, equipado, foto = null) {
  const js = (body) => ({ status: 200, contentType: "text/javascript; charset=utf-8", body });
  await page.route("**/js/firebase.js", (r) => r.fulfill(js(firebaseFalso)));
  await page.route("**/js/sesion.js", (r) => r.fulfill(js(sesionFalsa(equipado, foto))));
  await page.goto("/dashboard.html");
  await page.waitForSelector("#saludo");
  // El dibujo espera una lectura del catálogo: se le da una vuelta de reloj.
  await page.waitForTimeout(400);
}

const SIN_NADA = { avatar: null, insignia: null, dorso: null };

// =====================================================================
// El avatar
// =====================================================================

test("sin avatar comprado, queda la foto de Google", async ({ page }) => {
  await abrirTablero(page, SIN_NADA, "https://example.com/foto.jpg");

  const avatar = page.locator("#avatar");
  await expect(avatar).toHaveAttribute("src", "https://example.com/foto.jpg");
});

test("el avatar comprado le gana a la foto de Google", async ({ page }) => {
  // Es una elección explícita: alguien gastó Leyendas para verse así.
  await abrirTablero(page, { ...SIN_NADA, avatar: "avatar-foto" }, "https://example.com/foto.jpg");

  await expect(page.locator("#avatar")).toHaveAttribute("src", "/img/dorsos/dorso-azul.png");
});

test("un avatar con emoji reemplaza la imagen por un glifo", async ({ page }) => {
  // Éste es el camino que se rompe en silencio: un emoji no entra en un
  // `<img src>`, así que el nodo tiene que dejar de ser una imagen.
  await abrirTablero(page, { ...SIN_NADA, avatar: "avatar-dragon" });

  const avatar = page.locator("#avatar");
  await expect(avatar).toHaveText("🐉");

  // Y conserva id y clase: si el reemplazo las perdiera, el CSS dejaría de
  // alcanzarlo y el avatar aparecería como un emoji suelto en la barra.
  const etiqueta = await avatar.evaluate((el) => el.tagName);
  expect(etiqueta, "el nodo sigue siendo una imagen").toBe("SPAN");
  await expect(avatar).toHaveClass(/avatar/);
});

test("si el catálogo no responde, no se rompe nada", async ({ page }) => {
  // El catálogo puede no estar sembrado todavía. Un avatar es decoración, y
  // una decoración no puede tumbar el tablero.
  const js = (body) => ({ status: 200, contentType: "text/javascript; charset=utf-8", body });
  await page.route("**/js/firebase.js", (r) =>
    r.fulfill(js(firebaseFalso.replace(
      "const item = tabla[ref?.id];",
      "throw new Error('Firestore caído');",
    ))));
  await page.route("**/js/sesion.js", (r) =>
    r.fulfill(js(sesionFalsa({ ...SIN_NADA, avatar: "avatar-dragon" }, "https://example.com/foto.jpg"))));

  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e.message)));

  await page.goto("/dashboard.html");
  await page.waitForSelector("#saludo");
  await page.waitForTimeout(400);

  await expect(page.locator("#saludo")).toContainText("Seba");
  expect(errores, `la página tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

// =====================================================================
// La insignia
// =====================================================================

test("la insignia equipada aparece al lado del nombre", async ({ page }) => {
  await abrirTablero(page, { ...SIN_NADA, insignia: "insignia-corona" });

  const marca = page.locator("#saludo .insignia-equipada");
  await expect(marca).toBeVisible();
  await expect(marca).toHaveText("🏆");

  // El nombre sigue estando: la insignia se AGREGA, no reemplaza el saludo.
  await expect(page.locator("#saludo")).toContainText("Seba");
});

test("la insignia se anuncia con su nombre, no como decoración", async ({ page }) => {
  // A diferencia del avatar de la barra —que es decoración, porque de quién es
  // la sesión ya lo dice el saludo— la insignia es algo que el jugador eligió
  // mostrar. No leerla sería esconder justo lo que se compró para que se vea.
  await abrirTablero(page, { ...SIN_NADA, insignia: "insignia-corona" });

  const marca = page.locator("#saludo .insignia-equipada");
  await expect(marca).toHaveAttribute("aria-label", /corona de laurel/i);
  await expect(marca).toHaveAttribute("role", "img");
});

test("sin insignia equipada no queda ningún hueco", async ({ page }) => {
  await abrirTablero(page, SIN_NADA);
  await expect(page.locator("#saludo .insignia-equipada")).toHaveCount(0);
});
