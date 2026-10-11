/**
 * El avatar, en grande: se abre tocándolo y se sale por tres puertas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ DEFIENDE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Una ventana que se abre y no se cierra es peor que no tener ventana: deja
 * la pantalla trabada. Por eso las tres salidas —Escape, el fondo y la cruz—
 * tienen cada una su prueba, y no una sola que las dé por equivalentes.
 *
 * Y dos cosas que no se ven y se rompen en silencio:
 *
 *   · Que tocar la IMAGEN no cierre. Es el error clásico de escribir el
 *     escuchador con `closest`: un clic sobre el dibujo tiene al velo entre
 *     sus ancestros, así que la ventana se cerraría justo al intentar mirarla
 *     de cerca.
 *   · Que el foco VUELVA al botón que la abrió. Sin eso, quien navega con
 *     teclado cierra y aparece al principio de la página.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Y QUE SEA UNA VENTANA, NO UN CARTEL
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `position: fixed` y cubriendo la pantalla entera. Es la misma comprobación
 * que `tablero.spec.js` le hace al cartel del código privado, y por el mismo
 * motivo: el día que un ancestro con `transform` o `filter` la encierre en la
 * tarjeta, el CSS sigue diciendo `fixed` y la ventana mide doscientos píxeles.
 */

import { test, expect } from "@playwright/test";

const js = (body) => ({ status: 200, contentType: "text/javascript; charset=utf-8", body });

const ASESINO = "/img/avatar/asesino.webp";
const MAGO = "/img/avatar/mago.webp";

/**
 * Dos avatares y un dorso.
 *
 * El dorso no está de relleno: es lo que prueba que la lupa va sólo en los
 * avatares. Con un catálogo de puros avatares, una lupa puesta en todo
 * pasaría igual.
 */
const ITEMS = [
  { id: "asesino", nombre: "El Asesino", tipo: "avatar", precio: 450, imagen: ASESINO,
    descripcion: "Un avatar.", activo: true, orden: 1, metadata: { rareza: "raro" } },
  { id: "mago", nombre: "El Mago", tipo: "avatar", precio: 350, imagen: MAGO,
    descripcion: "Otro avatar.", activo: true, orden: 2, metadata: { rareza: "comun" } },
  { id: "dorso-rojo", nombre: "Dorso Rojo", tipo: "dorso", precio: 200,
    imagen: "/img/dorsos/dorso-rojo.webp", descripcion: "Un dorso.",
    activo: true, orden: 3, metadata: { rareza: "comun" } },
];

const SESION = `
  export const COLECCION = "users";
  export const CAMPO_SALDO = "credits";
  export async function exigirSesion() {
    return {
      usuario: { uid: "ana", email: "a@b.c", photoURL: null },
      perfil: { uid: "ana", nombre: "Ana", saldo: 5000, partidas: 0, victorias: 0,
                ganado: 5000, comprado: 0,
                equipado: { avatar: null, insignia: null, dorso: null } },
    };
  }
  export function mostrarSaldo() {}
  export function conectarBotonSalir() {}
  export async function leerPerfil() { return {}; }
  export async function guardarEnPerfil() {}
  export function esperarSesion() { return Promise.resolve({ uid: "ana" }); }
  export function formatearEspera() { return "listo"; }
`;

const firebaseFalso = `
  export const app = {};
  export const auth = { currentUser: { uid: "ana", reload: async () => {} } };
  export const db = {};
  export const googleProvider = {};
  export const SUPPORT_EMAIL = "soporte@example.com";
  export function onAuthStateChanged(a, fn) { setTimeout(() => fn({ uid: "ana" }), 0); return () => {}; }
  export async function signOut() {}
  export async function sendPasswordResetEmail() {}
  export const GoogleAuthProvider = class {};
  export async function signInWithPopup() { return { user: {} }; }
  export async function createUserWithEmailAndPassword() { return { user: {} }; }
  export async function signInWithEmailAndPassword() { return { user: {} }; }
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
  export const funciones = {};
  export function httpsCallable() { return async () => ({ data: {} }); }
  export function precalentarFunciones() {}
  export async function getDocs() {
    const items = ${JSON.stringify(ITEMS)};
    return { docs: items.map((i) => ({ id: i.id, data: () => i })) };
  }
`;

const servidorFalso = `
  export class ErrorDeServidor extends Error {
    constructor(mensaje, codigo) { super(mensaje); this.codigo = codigo; }
  }
  window.__llamadas = [];
  export const misItems = async () => ({ tengo: [], equipado: {} });
  export const misInsignias = async () => ({ estadisticas: {}, tengo: [], equipada: null });
  export const comprarItem = async (id) => { window.__llamadas.push(["comprarItem", id]); return {}; };
  export const equiparItem = async (id) => { window.__llamadas.push(["equiparItem", id]); return {}; };
  export const desequiparItem = async (t) => { window.__llamadas.push(["desequiparItem", t]); return {}; };
  export const comprarPack = async () => ({});
  export const listarPacks = async () => ({ packs: [] });
  export const crearOrdenDeCompra = async () => ({});
  export const listarTorneos = async () => ({ torneos: [] });
  export const soyAdministrador = async () => ({ admin: false });
  export const crearSala = async () => ({});
  export const crearSalaPrivada = async () => ({});
  export const unirseASala = async () => ({});
  export const unirseConCodigo = async () => ({});
  export const marcarListo = async () => ({});
  export const iniciarPartida = async () => ({});
  export const salirDeSalaEnEspera = async () => ({});
  export const revanchaDeSala = async () => ({});
  export const abandonarPartida = async () => ({});
  export const reportarJugador = async () => ({});
  export const inscribirseATorneo = async () => ({});
  export const crearSalaPublica = async () => ({});
  export const editarSalaPublica = async () => ({});
  export const borrarSalaPublica = async () => ({});
  export const ErrorDeRed = Error;
`;

async function abrirTienda(page) {
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|404 \(Not Found\)/.test(m.text())) errores.push(m.text());
  });

  await page.route("**/js/sesion.js", (r) => r.fulfill(js(SESION)));
  await page.route("**/js/firebase.js", (r) => r.fulfill(js(firebaseFalso)));
  await page.route("**/js/servidor.js", (r) => r.fulfill(js(servidorFalso)));

  await page.goto("/tienda.html");
  await page.waitForSelector("#rejillaPersonalizacion article", { timeout: 20_000 }).catch(() => {
    throw new Error(`la tienda no dibujó nada. Errores: ${errores.join(" | ") || "(ninguno)"}`);
  });
  return errores;
}

/** La lupa de un artículo, buscada por su nombre visible. */
const lupa = (page, nombre) =>
  page.locator("#rejillaPersonalizacion article").filter({ hasText: nombre }).locator(".lupa-avatar");

const ventana = (page) => page.locator(".zoom-avatar");

// =====================================================================
// 1. Abrir
// =====================================================================

test("tocar un avatar lo abre en grande", async ({ page }) => {
  const errores = await abrirTienda(page);
  await expect(ventana(page), "la ventana no puede estar abierta de entrada").toHaveCount(0);

  await lupa(page, "El Asesino").click();

  await expect(ventana(page)).toBeVisible();
  await expect(ventana(page).locator("img")).toHaveAttribute("src", new RegExp("asesino"));
  expect(errores, `la tienda tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

test("es una ventana de verdad: fija y cubriendo la pantalla", async ({ page }) => {
  await abrirTienda(page);
  await lupa(page, "El Asesino").click();

  await expect(ventana(page)).toHaveCSS("position", "fixed");

  const cubre = await ventana(page).evaluate((e) => {
    const r = e.getBoundingClientRect();
    return r.width >= innerWidth && r.height >= innerHeight;
  });
  expect(cubre, "la ventana no cubre la pantalla: la encerró algún ancestro").toBe(true);
});

test("se anuncia como ventana, con nombre", async ({ page }) => {
  await abrirTienda(page);
  await lupa(page, "El Mago").click();

  const caja = page.locator(".zoom-caja");
  await expect(caja).toHaveAttribute("role", "dialog");
  await expect(caja).toHaveAttribute("aria-modal", "true");
  // El nombre accesible lo necesita `role="dialog"`; que diga de qué avatar
  // es, y no «Avatar en grande» a secas, es lo que distingue una ventana de
  // la otra para quien no ve la pantalla.
  await expect(caja).toHaveAttribute("aria-label", /Mago/);
});

test("el resto de la página queda apagado mientras está abierta", async ({ page }) => {
  await abrirTienda(page);
  await lupa(page, "El Asesino").click();

  const apagado = await page.evaluate(() => {
    const velo = document.querySelector(".zoom-avatar");
    return [...document.body.children].filter((e) => e !== velo).every((e) => e.inert);
  });
  expect(apagado, "algo de la página quedó alcanzable detrás de la ventana").toBe(true);
});

// =====================================================================
// 2. Las tres salidas
// =====================================================================

test("Escape la cierra", async ({ page }) => {
  await abrirTienda(page);
  await lupa(page, "El Asesino").click();
  await expect(ventana(page)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(ventana(page)).toHaveCount(0);
});

test("tocar el fondo la cierra", async ({ page }) => {
  await abrirTienda(page);
  await lupa(page, "El Asesino").click();
  await expect(ventana(page)).toBeVisible();

  // Una esquina, lejos de la imagen.
  await page.mouse.click(8, 8);
  await expect(ventana(page)).toHaveCount(0);
});

test("la cruz la cierra", async ({ page }) => {
  await abrirTienda(page);
  await lupa(page, "El Asesino").click();
  await expect(ventana(page)).toBeVisible();

  await page.locator(".cerrar-zoom").click();
  await expect(ventana(page)).toHaveCount(0);
});

test("tocar la IMAGEN no la cierra", async ({ page }) => {
  /*
   * El error clásico de escribir el escuchador con `closest`: un clic sobre el
   * dibujo tiene al velo entre sus ancestros, así que preguntar por el
   * ancestro cerraría la ventana justo al intentar mirarla de cerca.
   */
  await abrirTienda(page);
  await lupa(page, "El Asesino").click();

  await ventana(page).locator("img").click();
  await expect(ventana(page), "se cerró al tocar el dibujo").toBeVisible();
});

test("y después de cerrarla, la página vuelve a estar viva", async ({ page }) => {
  await abrirTienda(page);
  await lupa(page, "El Asesino").click();
  await page.keyboard.press("Escape");

  const vivo = await page.evaluate(() =>
    [...document.body.children].every((e) => !e.inert));
  expect(vivo, "quedó algo apagado después de cerrar").toBe(true);
});

// =====================================================================
// 3. El foco
// =====================================================================

test("el foco entra a la ventana y vuelve al botón que la abrió", async ({ page }) => {
  await abrirTienda(page);

  await lupa(page, "El Mago").click();
  expect(await page.evaluate(() => document.activeElement?.className))
    .toContain("zoom-caja");

  await page.keyboard.press("Escape");

  const volvio = await page.evaluate(() => {
    const a = document.activeElement;
    return a?.classList.contains("lupa-avatar") && (a.getAttribute("aria-label") ?? "");
  });
  expect(volvio, "el foco no volvió a la lupa del Mago").toContain("Mago");
});

// =====================================================================
// 4. Dónde NO va
// =====================================================================

test("los dorsos no se abren en grande: sólo los avatares", async ({ page }) => {
  await abrirTienda(page);

  await page.locator('#pestanasPersonalizacion [data-grupo="Dorsos"]').click();
  await expect(
    page.locator("#rejillaPersonalizacion article").filter({ hasText: "Dorso Rojo" }),
  ).toBeVisible();

  await expect(lupa(page, "Dorso Rojo")).toHaveCount(0);
});

test("comprar sigue comprando: la lupa no se come el botón", async ({ page }) => {
  /*
   * La lupa envuelve la figura, y la delegación de la rejilla busca el
   * `<button>` más cercano. Si un día la figura quedara DENTRO de la tarjeta
   * de otra forma, lo que se rompe es el botón de al lado — y eso no se nota
   * mirando la ventana.
   */
  await abrirTienda(page);

  await page
    .locator("#rejillaPersonalizacion article").filter({ hasText: "El Asesino" })
    .getByRole("button", { name: "Comprar" })
    .click();

  await expect
    .poll(() => page.evaluate(() => window.__llamadas))
    .toContainEqual(["comprarItem", "asesino"]);
  await expect(ventana(page), "comprar abrió la ventana").toHaveCount(0);
});
