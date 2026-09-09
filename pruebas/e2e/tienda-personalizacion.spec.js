/**
 * La sección de personalización de la tienda.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE DEFIENDE ACÁ, Y QUÉ NO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Que el saldo no se pueda tocar, que el precio lo ponga el servidor y que no
 * se compre dos veces ya está probado en `pruebas/tienda.mjs`, contra el
 * módulo del servidor y un Firestore de mentira. Repetirlo acá sería probar lo
 * mismo dos veces y más despacio.
 *
 * Lo que sólo se puede ver desde el navegador es el CABLEADO, que es
 * justamente lo que ninguna prueba de servidor alcanza:
 *
 *   - que la tienda pinte el catálogo de FIRESTORE y no la semilla del
 *     archivo —si pintara la semilla, mostraría un precio y cobraría otro—;
 *   - que el botón diga lo que corresponde en los cuatro estados;
 *   - que comprar llame a `comprarItem` con el id y NADA más: si el navegador
 *     mandara el precio o el tipo, el servidor tendría datos del cliente en
 *     una operación de dinero;
 *   - que la compra no se pueda disparar dos veces con dos clics seguidos.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE SUSTITUYEN TRES MÓDULOS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `firebase.js` para que el catálogo sea uno conocido en vez de lo que haya
 * hoy en el proyecto de verdad; `sesion.js` para tener sesión sin login; y
 * `servidor.js` para que las compras no salgan de la máquina y para poder
 * mirar con qué se llamó a cada función. Es el mismo recorte que usan
 * `admin-puerta.spec.js` y `menu.spec.js`.
 */

import { test, expect } from "@playwright/test";

/** El catálogo que devuelve el Firestore de mentira. */
const CATALOGO = [
  { id: "avatar-rey", tipo: "avatar", nombre: "El Rey", descripcion: "La figura que corona.", precio: 0, imagen: "👑", activo: true, orden: 10 },
  { id: "avatar-zorro", tipo: "avatar", nombre: "El Zorro", descripcion: "Corta justo antes.", precio: 800, imagen: "🦊", activo: true, orden: 20 },
  { id: "avatar-dragon", tipo: "avatar", nombre: "El Dragón", descripcion: "Se ve de lejos.", precio: 2500, imagen: "🐉", activo: true, orden: 30 },
  // Desactivado: no tiene que aparecer en la tienda aunque esté en la colección.
  { id: "avatar-oculto", tipo: "avatar", nombre: "Secreto", descripcion: "", precio: 10, imagen: "🕵️", activo: false, orden: 40 },
  // De otro tipo: sólo tiene que verse en su propia pestaña.
  // La insignia sigue en el catálogo de mentira A PROPÓSITO: la tienda tiene
  // que ignorarla aunque el servidor se la mande, que es lo que pasa de
  // verdad —el catálogo de Firestore las tiene, porque el perfil las muestra.
  { id: "insignia-corona", tipo: "insignia", nombre: "Corona de Laurel", descripcion: "La del que manda.", precio: 1800, imagen: "🏆", activo: true, orden: 10 },
  { id: "dorso-prueba", tipo: "dorso", nombre: "Dorso de prueba", descripcion: "El de atrás.", precio: 80, imagen: "🂠", activo: true, orden: 10 },
];

const firebaseFalso = (catalogo) => `
  export const app = {}; export const auth = {}; export const db = {}; export const funciones = {};
  export const googleProvider = {}; export const SUPPORT_EMAIL = "soporte@example.com";
  export function httpsCallable() { return async () => ({ data: {} }); }
  export function onAuthStateChanged(a, fn) { setTimeout(() => fn({ uid: "u1" }), 10); return () => {}; }
  export const doc = (...a) => ({ ruta: a.join("/") });
  export const collection = (...a) => ({ ruta: a.slice(1).join("/") });
  export const query = (c) => c;
  export const orderBy = () => ({});
  export const limit = () => ({});
  export const where = () => ({});
  export async function getDocs(c) {
    const filas = ${JSON.stringify(catalogo)};
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

const sesionFalsa = (saldo) => `
  export const COLECCION = "users"; export const CAMPO_SALDO = "credits";
  export async function exigirSesion() {
    return { usuario: { uid: "u1", photoURL: null },
             perfil: { uid: "u1", nombre: "Probador", saldo: ${saldo}, partidas: 0, victorias: 0 } };
  }
  export async function leerPerfil() { return { saldo: ${saldo} }; }
  export function mostrarSaldo(n) {
    const v = document.getElementById("saldoValor");
    if (v) v.textContent = String(n);
  }
  export function conectarBotonSalir() {}
  export function formatearEspera() { return "listo"; }
`;

/**
 * El servidor de mentira anota cada llamada en `window.__llamadas`.
 *
 * Eso es lo que permite comprobar QUÉ se mandó, que es más importante que si
 * la compra "funcionó": una compra que funciona mandando el precio desde el
 * navegador es exactamente el fallo que hay que evitar.
 */
const servidorFalso = (saldoInicial) => `
  window.__llamadas = [];
  export class ErrorDeServidor extends Error {
    constructor(m, c) { super(m); this.name = "ErrorDeServidor"; this.codigo = c; }
  }
  let saldo = ${saldoInicial};
  const tengo = [];
  export async function misItems() {
    window.__llamadas.push(["misItems", null]);
    return { tengo: tengo.map((id) => ({ id, tipo: "avatar" })), equipado: { avatar: null, insignia: null, dorso: null } };
  }
  export async function comprarItem(itemId) {
    window.__llamadas.push(["comprarItem", itemId]);
    await new Promise((r) => setTimeout(r, 120));
    if (window.__fallarCompra) throw new ErrorDeServidor("No te alcanzan las Leyendas.", "failed-precondition");
    const precio = { "avatar-zorro": 800, "avatar-dragon": 2500, "avatar-rey": 0 }[itemId] ?? 0;
    saldo -= precio;
    tengo.push(itemId);
    return { itemId, tipo: "avatar", precio, saldo };
  }
  export async function comprarPack(itemIds) {
    window.__llamadas.push(["comprarPack", itemIds]);
    await new Promise((r) => setTimeout(r, 120));
    const precios = { "avatar-zorro": 800, "avatar-dragon": 2500, "avatar-rey": 0 };
    const nuevos = itemIds.filter((id) => !tengo.includes(id));
    const suma = nuevos.reduce((s, id) => s + (precios[id] ?? 0), 0);
    const descuento = { 1: 0, 2: 0.15, 3: 0.25 }[nuevos.length] ?? 0;
    const total = Math.floor(suma * (1 - descuento));
    saldo -= total;
    for (const id of nuevos) tengo.push(id);
    return {
      comprados: nuevos.map((id) => ({ id, tipo: "avatar", precio: precios[id] ?? 0 })),
      yaTenia: itemIds.filter((id) => !nuevos.includes(id)),
      total, sinDescuento: suma, descuento, ahorro: suma - total,
      equipado: {}, saldo,
    };
  }
  export async function equiparItem(itemId) {
    window.__llamadas.push(["equiparItem", itemId]);
    return { itemId, tipo: "avatar", campo: "avatar" };
  }
  export async function desequiparItem(tipo) {
    window.__llamadas.push(["desequiparItem", tipo]);
    return { tipo, campo: tipo, equipado: null };
  }
  export const misInsignias = async () => ({ estadisticas: {}, tengo: [], equipada: null });
  export const listarTorneos = async () => ({ torneos: [] });
  export const inscribirseATorneo = async () => ({});
  export const crearSala = async () => ({}); export const unirseASala = async () => ({});
  export const marcarListo = async () => ({}); export const iniciarPartida = async () => ({});
  export const salirDeSalaEnEspera = async () => ({}); export const abandonarPartida = async () => ({});
  export const reportarJugador = async () => ({});
`;

async function abrirTienda(page, { saldo = 5000, catalogo = CATALOGO } = {}) {
  const js = (body) => ({ status: 200, contentType: "text/javascript; charset=utf-8", body });

  await page.route("**/js/firebase.js", (r) => r.fulfill(js(firebaseFalso(catalogo))));
  await page.route("**/js/sesion.js", (r) => r.fulfill(js(sesionFalsa(saldo))));
  await page.route("**/js/servidor.js", (r) => r.fulfill(js(servidorFalso(saldo))));

  await page.goto("/tienda.html");
  await page.waitForSelector("#rejillaPersonalizacion .item-tienda", { timeout: 15_000 });
}

const ficha = (page, id) =>
  page.locator(`#rejillaPersonalizacion .item-tienda`, { hasText: id });

// =====================================================================
// El catálogo sale de Firestore
// =====================================================================

test("la tienda pinta el catálogo del servidor, no la semilla del archivo", async ({
  page,
}) => {
  // La semilla de `catalogo.js` tiene cinco avatares con otros nombres. Si la
  // tienda los mostrara, estaría pintando un precio que el servidor no cobra.
  await abrirTienda(page);

  const nombres = await page.locator("#rejillaPersonalizacion .item-tienda h3").allInnerTexts();
  expect(nombres).toEqual(["El Rey", "El Zorro", "El Dragón"]);
});

test("lo desactivado no se muestra, aunque esté en la colección", async ({ page }) => {
  await abrirTienda(page);
  await expect(page.locator("#rejillaPersonalizacion")).not.toContainText("Secreto");
});

test("los precios que se ven son los del servidor", async ({ page }) => {
  await abrirTienda(page);
  await expect(ficha(page, "El Zorro")).toContainText("800");
  await expect(ficha(page, "El Rey")).toContainText(/gratis/i);
});

// =====================================================================
// Las categorías
// =====================================================================

test("cada tipo vive en su pestaña, y no se mezclan", async ({ page }) => {
  // La rejilla muestra UNA categoría por vez. Si se mezclaran, la tienda
  // ofrecería un dorso entre los avatares y equiparlo cambiaría otra cosa de
  // la que el jugador creía.
  await abrirTienda(page);

  await expect(page.locator("#rejillaPersonalizacion")).not.toContainText("Dorso de prueba");

  await page.locator('#pestanasPersonalizacion [data-categoria="dorso"]').click();

  await expect(page.locator("#rejillaPersonalizacion")).toContainText("Dorso de prueba");
  await expect(page.locator("#rejillaPersonalizacion")).not.toContainText("El Dragón");
});

test("las pestañas salen de la lista de categorías, no del HTML", async ({ page }) => {
  // El contenedor viene vacío en `tienda.html` a propósito: agregar una
  // categoría es agregar una línea en `personalizacion.js`. Un botón escrito a
  // mano en el HTML lo pisaría el primer repintado.
  await abrirTienda(page);

  // Se comparan los NOMBRES y no la cantidad. Contar decía "son dos", y al
  // agregar los dorsos la prueba se puso en rojo sin que nada estuviera mal:
  // afirmaba un número, no una regla. Lo que hay que afirmar es cuáles son.
  //
  // Y que las insignias NO estén es la mitad importante de esta prueba: son
  // logros, no mercadería. Si un día vuelven a aparecer acá, esto lo dice.
  const pestanas = page.locator("#pestanasPersonalizacion button");
  await expect(pestanas).toHaveText(["Avatares", "Dorsos", "Paños de mesa"]);
});

test("las insignias no se ofrecen en la tienda", async ({ page }) => {
  await abrirTienda(page, { saldo: 100000 });

  // Ni pestaña, ni ficha, ni con saldo de sobra. El servidor además rechaza la
  // compra —ver `pruebas/tienda.mjs`, sección 17—; esto comprueba que tampoco
  // se ofrezca, que es lo que ve el jugador.
  await expect(page.locator('#pestanasPersonalizacion [data-categoria="insignia"]')).toHaveCount(0);
  await expect(page.locator("#rejillaPersonalizacion")).not.toContainText("Corona de Laurel");
});


// =====================================================================
// Packs: llevar dos o tres de una
// =====================================================================

test("el pack descuenta, y el total que se ve es el que se cobra", async ({ page }) => {
  await abrirTienda(page, { saldo: 5000 });

  await page.locator("#btnArmarPack").click();
  await expect(page.locator("#resumenPack")).toBeVisible();

  // El primero lo agrega solo: un modo pack vacío no se distingue del normal y
  // el botón parecería no hacer nada.
  await expect(page.locator("#resumenPack")).toContainText("1 de 3");

  await ficha(page, "El Dragón").locator("button").click();

  // 800 + 2500 = 3300, menos 15% = 2805. Escrito acá a mano a propósito: si se
  // calculara con la misma función que usa la página, la prueba diría "la
  // página coincide consigo misma".
  await expect(page.locator("#resumenPack")).toContainText("2.805");
  await expect(page.locator("#resumenPack")).toContainText("ahorrás 495");

  await page.locator("#btnLlevarPack").click();
  await expect(page.locator("#avisoPersonalizacion")).toContainText("ahorraste 495");

  const llamada = await page.evaluate(() => window.__llamadas.find(([n]) => n === "comprarPack"));
  expect(llamada[1].sort(), "viajaron los ids y nada más").toEqual(["avatar-dragon", "avatar-zorro"]);

  // Y el saldo que se muestra es el que devolvió el servidor. Sin separador de
  // miles porque el `sesion.js` de mentira no formatea; lo que importa acá es
  // el número, no cómo lo escribe el módulo que esta prueba sustituye.
  await expect(page.locator("#saldo")).toContainText("2195");
});

test("no entran más de tres en un pack", async ({ page }) => {
  await abrirTienda(page, {
    saldo: 50000,
    catalogo: [
      { id: "a1", tipo: "avatar", nombre: "Uno", descripcion: "", precio: 100, imagen: "1️⃣", activo: true, orden: 1 },
      { id: "a2", tipo: "avatar", nombre: "Dos", descripcion: "", precio: 100, imagen: "2️⃣", activo: true, orden: 2 },
      { id: "a3", tipo: "avatar", nombre: "Tres", descripcion: "", precio: 100, imagen: "3️⃣", activo: true, orden: 3 },
      { id: "a4", tipo: "avatar", nombre: "Cuatro", descripcion: "", precio: 100, imagen: "4️⃣", activo: true, orden: 4 },
    ],
  });

  await page.locator("#btnArmarPack").click();
  for (const nombre of ["Dos", "Tres"]) await ficha(page, nombre).locator("button").click();
  await expect(page.locator("#resumenPack")).toContainText("3 de 3");

  await ficha(page, "Cuatro").locator("button").click();
  await expect(page.locator("#avisoPersonalizacion")).toContainText("hasta 3");
  await expect(page.locator("#resumenPack"), "y sigue habiendo tres").toContainText("3 de 3");
});

test("vaciar el pack devuelve la tienda a comprar de a uno", async ({ page }) => {
  await abrirTienda(page, { saldo: 5000 });

  await page.locator("#btnArmarPack").click();
  await expect(page.locator("#resumenPack")).toBeVisible();

  await page.locator("#btnVaciarPack").click();
  await expect(page.locator("#resumenPack")).toBeHidden();

  // Y los botones vuelven a comprar, no a seleccionar.
  await expect(ficha(page, "El Zorro").locator("button")).toContainText(/comprar/i);
});

// =====================================================================
// Los cuatro estados del botón
// =====================================================================

test("sin saldo suficiente, el botón lo dice y no se puede tocar", async ({ page }) => {
  // 1000 Leyendas: alcanza para el zorro (800), no para el dragón (2500).
  await abrirTienda(page, { saldo: 1000 });

  await expect(ficha(page, "El Zorro").locator("button")).toBeEnabled();

  const dragon = ficha(page, "El Dragón").locator("button");
  await expect(dragon).toBeDisabled();
  await expect(dragon).toContainText(/no alcanza/i);
});

test("comprar, equipar y sacárselo: el botón recorre los tres estados", async ({
  page,
}) => {
  /**
   * El tercer estado faltaba.
   *
   * Antes, lo que se llevaba puesto mostraba un botón APAGADO que decía
   * «✓ Equipado». O sea: se podía cambiar de avatar, pero no quedarse sin
   * ninguno, porque «ninguno» no es un artículo que se pueda elegir de la
   * rejilla. El jugador que se probaba uno quedaba con uno puesto para
   * siempre.
   */
  await abrirTienda(page, { saldo: 5000 });
  const boton = ficha(page, "El Zorro").locator("button");

  await boton.click();
  await expect(boton, "comprado: ahora se puede equipar").toContainText(/^equipar$/i);

  await boton.click();
  await expect(boton, "equipado: ahora se puede sacar").toContainText(/desequipar/i);
  await expect(boton, "y el botón tiene que funcionar, no estar apagado").toBeEnabled();

  await boton.click();
  await expect(boton, "sacado: vuelve a poder equiparse").toContainText(/^equipar$/i);

  // Y al servidor viajó el TIPO, no el id: el perfil guarda un id por tipo, y
  // desequipar es poner ese campo en null.
  const llamada = await page.evaluate(() =>
    window.__llamadas.find(([n]) => n === "desequiparItem"));
  expect(llamada, "no se llamó a desequiparItem").toBeTruthy();
  expect(llamada[1], "viajó el id en vez del tipo").toBe("avatar");
});

// =====================================================================
// Lo que viaja al servidor
// =====================================================================

test("comprar manda el id y NADA más", async ({ page }) => {
  // El precio y el tipo los pone el servidor. Que el navegador los mandara
  // sería darle al cliente voz en una operación de dinero, y es el fallo que
  // esta prueba existe para agarrar.
  await abrirTienda(page);
  await ficha(page, "El Dragón").locator("button").click();
  await expect(ficha(page, "El Dragón").locator("button")).toContainText(/equipar/i);

  const llamadas = await page.evaluate(() => window.__llamadas);
  const compra = llamadas.find(([n]) => n === "comprarItem");
  expect(compra, "no se llamó a comprarItem").toBeTruthy();
  expect(compra[1], "viajó algo más que el id").toBe("avatar-dragon");
});

test("dos clics seguidos compran una sola vez", async ({ page }) => {
  // El servidor rechaza la segunda igual —lo prueba `tienda.mjs`— pero el caso
  // normal no tiene por qué llegar a necesitarlo: el botón se apaga al pedir.
  await abrirTienda(page);

  const boton = ficha(page, "El Zorro").locator("button");
  await boton.click();
  await boton.click({ force: true, timeout: 1000 }).catch(() => {});
  await expect(ficha(page, "El Zorro").locator("button")).toContainText(/equipar/i);

  const compras = await page.evaluate(() =>
    window.__llamadas.filter(([n, id]) => n === "comprarItem" && id === "avatar-zorro").length);
  expect(compras, "se pidió la compra dos veces").toBe(1);
});

// =====================================================================
// Cuando algo sale mal
// =====================================================================

test("un error del servidor se muestra en pantalla, no en un alert", async ({ page }) => {
  await abrirTienda(page);

  // Si algo llamara a `alert`, la prueba se colgaría esperando el diálogo: se
  // deja anotado para que el fallo diga por qué.
  let huboAlert = false;
  page.on("dialog", async (d) => {
    huboAlert = true;
    await d.dismiss();
  });

  await page.evaluate(() => {
    window.__fallarCompra = true;
  });
  await ficha(page, "El Zorro").locator("button").click();

  await expect(page.locator("#avisoPersonalizacion")).toContainText(/no te alcanzan/i);
  expect(huboAlert, "se usó un alert").toBe(false);

  // Y el botón vuelve a estar disponible: un error no puede dejar la tienda
  // muerta hasta que alguien recargue.
  await expect(ficha(page, "El Zorro").locator("button")).toBeEnabled();
});

// =====================================================================
// La tienda de Leyendas sigue en pie
// =====================================================================

test("la compra de Leyendas no se tocó", async ({ page }) => {
  // La personalización se agregó AL LADO, no en lugar de. Los paquetes en
  // pesos siguen siendo la otra mitad de esta página.
  await abrirTienda(page);

  await expect(page.locator("#paquetes .paquete").first()).toBeVisible();
  await expect(page.locator("#paquetes")).toContainText(/leyendas/i);
});
