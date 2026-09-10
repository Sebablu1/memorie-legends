/**
 * La tienda y Mi colección son dos vistas del MISMO estado.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE DEFIENDE ACÁ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Que lo que uno se pone en una pantalla se vea puesto en la otra, y que
 * sacárselo en cualquiera de las dos lo saque en las dos. No hay dos estados
 * que sincronizar: hay uno solo —el perfil, en el servidor— y dos formas de
 * mirarlo.
 *
 * Cada una tenía su prueba y ninguna miraba a la otra. Y son dos módulos
 * distintos, con su propia copia de «qué llevo puesto» en memoria: es
 * exactamente la forma en que esto se rompe sin que nadie lo note, porque cada
 * pantalla por separado se ve perfecta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL SERVIDOR DE MENTIRA VIVE EN sessionStorage
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque la prueba NAVEGA de una página a la otra, y una variable de módulo se
 * muere con el documento. Guardado ahí, lo que se equipa en la tienda sigue
 * equipado al llegar al tablero, que es justamente lo que hay que comprobar.
 */

import { test, expect } from "@playwright/test";

const js = (body) => ({ status: 200, contentType: "text/javascript; charset=utf-8", body });

const CATALOGO = [
  { id: "el-zorro", tipo: "avatar", nombre: "El Zorro", descripcion: "", precio: 0, imagen: "/img/avatar/orco.webp", activo: true, orden: 10 },
  { id: "el-dragon", tipo: "avatar", nombre: "El Dragón", descripcion: "", precio: 0, imagen: "/img/avatar/el_dragon.webp", activo: true, orden: 20 },
  { id: "dorso-rojo", tipo: "dorso", nombre: "Dorso Rojo", descripcion: "", precio: 0, imagen: "/img/dorsos/dorso-rojo.png", activo: true, orden: 10 },
  { id: "mazo-verde", tipo: "mazo", nombre: "Mazo Esmeralda", descripcion: "", precio: 0, imagen: "/img/mazos/esmeralda.svg", activo: true, orden: 10 },
];

const firebaseFalso = `
  export const app = {}; export const auth = { currentUser: { uid: "u1" } };
  export const db = {}; export const funciones = {};
  export const googleProvider = {}; export const SUPPORT_EMAIL = "soporte@example.com";
  export function httpsCallable() { return async () => ({ data: {} }); }
  export function onAuthStateChanged(a, fn) { setTimeout(() => fn({ uid: "u1" }), 10); return () => {}; }
  export const doc = (...a) => ({ ruta: a.join("/") });
  export const collection = (...a) => ({ ruta: a.slice(1).join("/") });
  export const query = (c) => c;
  export const orderBy = () => ({});
  export const where = () => ({});
  export const limit = () => ({});
  export async function getDocs() {
    const filas = ${JSON.stringify(CATALOGO)};
    return { docs: filas.map((f) => ({ id: f.id, data: () => f })) };
  }
  export async function getDoc() { return { exists: () => false, data: () => ({}) }; }
  export async function setDoc() {} export async function updateDoc() {}
  export function onSnapshot() { return () => {}; }
  export async function deleteDoc() {} export async function addDoc() { return {}; }
  export const serverTimestamp = () => null; export const increment = (n) => n;
  export const arrayUnion = (x) => x; export const arrayRemove = (x) => x;
  export async function runTransaction(f) { return f({}); }
  export async function signOut() {}
`;

const sesionFalsa = `
  export const COLECCION = "users"; export const CAMPO_SALDO = "credits";
  export async function exigirSesion() {
    return { usuario: { uid: "u1", photoURL: null, email: "a@b.c" },
             perfil: { uid: "u1", nombre: "Probador", saldo: 9999, partidas: 0, victorias: 0 } };
  }
  export async function leerPerfil() { return { saldo: 9999 }; }
  export function mostrarSaldo() {}
  export function conectarBotonSalir() {}
  export function formatearEspera() { return "listo"; }
`;

/**
 * El perfil de mentira: UN solo estado, compartido por las dos pantallas.
 *
 * Vive en `sessionStorage` para sobrevivir a la navegación. Es lo que hace que
 * esta prueba pruebe algo: con un estado por página, cada una se vería bien
 * sola y la pregunta quedaría sin contestar.
 */
const servidorFalso = `
  const LEER = () => JSON.parse(sessionStorage.getItem("__equipado") ?? "{}");
  const ESCRIBIR = (e) => sessionStorage.setItem("__equipado", JSON.stringify(e));
  const TENGO = ${JSON.stringify(CATALOGO.map((i) => ({ id: i.id, tipo: i.tipo })))};

  export class ErrorDeServidor extends Error {
    constructor(m, c) { super(m); this.name = "ErrorDeServidor"; this.codigo = c; }
  }
  export async function misItems() {
    return { tengo: [...TENGO], equipado: LEER() };
  }
  export async function equiparItem(itemId) {
    const tipo = TENGO.find((i) => i.id === itemId)?.tipo;
    if (!tipo) throw new ErrorDeServidor("Todavía no tenés ese artículo.", "permission-denied");
    ESCRIBIR({ ...LEER(), [tipo]: itemId });
    return { itemId, tipo, campo: tipo };
  }
  export async function desequiparItem(tipo) {
    ESCRIBIR({ ...LEER(), [tipo]: null });
    return { tipo, campo: tipo, equipado: null };
  }
  export const comprarItem = async () => ({});
  export const comprarPack = async () => ({});
  export const misInsignias = async () => ({ estadisticas: {}, tengo: [], equipada: null });
  export const listarTorneos = async () => ({ torneos: [] });
  export const inscribirseATorneo = async () => ({});
  export const crearSala = async () => ({});
  export const unirseASala = async () => ({});
  export const ErrorDeRed = Error;
`;

async function dobles(page) {
  await page.route("**/js/firebase.js", (r) => r.fulfill(js(firebaseFalso)));
  await page.route("**/js/sesion.js", (r) => r.fulfill(js(sesionFalsa)));
  await page.route("**/js/servidor.js", (r) => r.fulfill(js(servidorFalso)));
}

const enLaTienda = (page, nombre) =>
  page.locator("#rejillaPersonalizacion .item-tienda, #rejillaPersonalizacion article")
    .filter({ hasText: nombre });

const enMiColeccion = (page, nombre) =>
  page.locator("#miInventario .item-inv").filter({ hasText: nombre });

// =====================================================================

test("lo que me pongo en la tienda aparece puesto en Mi colección", async ({ page }) => {
  await dobles(page);

  await page.goto("/tienda.html");
  await page.waitForSelector("#rejillaPersonalizacion article");
  await enLaTienda(page, "El Dragón").getByRole("button", { name: "Equipar" }).click();
  await expect(enLaTienda(page, "El Dragón").getByRole("button", { name: "Desequipar" })).toBeVisible();

  await page.goto("/dashboard.html");
  await page.waitForSelector("#miInventario .item-inv");

  await expect(enMiColeccion(page, "El Dragón")).toContainText("Equipado");
  await expect(enMiColeccion(page, "El Zorro")).toContainText("Sin equipar");
});

test("y lo que me saco en Mi colección aparece sacado en la tienda", async ({ page }) => {
  await dobles(page);

  // Se llega con algo puesto, para poder sacárselo.
  await page.goto("/tienda.html");
  await page.waitForSelector("#rejillaPersonalizacion article");
  await enLaTienda(page, "El Dragón").getByRole("button", { name: "Equipar" }).click();
  await expect(enLaTienda(page, "El Dragón").getByRole("button", { name: "Desequipar" })).toBeVisible();

  await page.goto("/dashboard.html");
  await page.waitForSelector("#miInventario .item-inv");
  await enMiColeccion(page, "El Dragón").getByRole("button", { name: "Desequipar" }).click();
  await expect(enMiColeccion(page, "El Dragón")).toContainText("Sin equipar");

  await page.goto("/tienda.html");
  await page.waitForSelector("#rejillaPersonalizacion article");
  await expect(
    enLaTienda(page, "El Dragón").getByRole("button", { name: "Equipar" }),
  ).toBeVisible();
});

test("los dos dorsos son artículos distintos: ponerse uno no toca el otro", async ({ page }) => {
  /**
   * Es la razón de que sean dos tipos y no dos colores de uno solo. Si
   * compartieran campo, comprar el del mazo central le sacaría al jugador el
   * dorso de la mano que ya había pagado.
   */
  await dobles(page);

  await page.goto("/tienda.html");
  await page.waitForSelector("#rejillaPersonalizacion article");

  await page.locator('#pestanasPersonalizacion [data-grupo="Dorsos"]').click();
  await enLaTienda(page, "Dorso Rojo").getByRole("button", { name: "Equipar" }).click();
  await expect(enLaTienda(page, "Dorso Rojo").getByRole("button", { name: "Desequipar" })).toBeVisible();

  await page.locator('#subpestanasPersonalizacion [data-categoria="mazo"]').click();
  await enLaTienda(page, "Mazo Esmeralda").getByRole("button", { name: "Equipar" }).click();
  await expect(enLaTienda(page, "Mazo Esmeralda").getByRole("button", { name: "Desequipar" })).toBeVisible();

  // Y el de las cartas sigue puesto: son dos campos del perfil.
  await page.goto("/dashboard.html");
  await page.waitForSelector("#miInventario .item-inv");
  await expect(enMiColeccion(page, "Dorso Rojo")).toContainText("Equipado");
  await expect(enMiColeccion(page, "Mazo Esmeralda")).toContainText("Equipado");
});

test("equipar deja el vestuario anotado para que la mesa abra vestida", async ({ page }) => {
  // La otra mitad del punto 4: de nada sirve que la mesa lea el caché si nadie
  // lo escribe. Lo escriben las dos vistas, y con las RUTAS ya resueltas.
  await dobles(page);

  await page.goto("/tienda.html");
  await page.waitForSelector("#rejillaPersonalizacion article");
  await enLaTienda(page, "El Dragón").getByRole("button", { name: "Equipar" }).click();
  await expect(enLaTienda(page, "El Dragón").getByRole("button", { name: "Desequipar" })).toBeVisible();

  const guardado = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("vestuario") ?? "null"));

  expect(guardado, "la tienda no dejó nada anotado").toBeTruthy();
  expect(guardado.uid, "el vestuario tiene que ir con el uid adentro").toBe("u1");
  expect(guardado.retrato, "se guarda la RUTA, no el id").toBe("/img/avatar/el_dragon.webp");
});
