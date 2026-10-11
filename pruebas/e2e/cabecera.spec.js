/**
 * El avatar de la barra sigue a lo que el jugador se pone y se saca.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ UN ARCHIVO PROPIO Y NO UN PAR DE PRUEBAS EN LOS DE AL LADO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque lo que se prueba cruza dos pantallas. Equipar un avatar se hace
 * desde DOS lugares —«Personalización» en la tienda y «Mi colección» en el
 * perfil— y los dos tienen que terminar en lo mismo: la barra mostrando lo
 * que el servidor acaba de registrar. Partido entre `tienda-personalizacion`
 * e `inventario`, nadie estaría mirando que las dos puertas coincidan.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE ROMPIÓ, Y POR QUÉ NO SE NOTÓ DURANTE MESES
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `personalizacion.js` nunca llamó a `pintarAvatarCabecera`. Te desequipabas
 * en la tienda, el servidor lo registraba, la tarjeta pasaba a decir
 * «Equipar», y arriba seguía el avatar viejo hasta recargar.
 *
 * No se veía porque `tienda.html` no tenía `#avatar`: hasta `0015139` el
 * único lugar con avatar en la barra era el tablero, así que no había dónde
 * mostrar el desfase. El bug existía igual —sólo que sin pantalla donde
 * aparecer—, que es la peor forma de un bug.
 *
 * Esta prueba es lo que impide que vuelva: si alguien borra la llamada en
 * `personalizacion.js`, se caen las de la tienda; si la borra en
 * `inventario.js`, las de la colección; y si borra la de `perfil.js`, la que
 * mira la carga.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA FOTO ES UN ARCHIVO DEL SITIO, Y ES A PROPÓSITO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Lo que repone `pintarAvatarCabecera` al desequipar es la foto de Google,
 * que en una cuenta de verdad es una dirección de `googleusercontent.com`.
 * Acá se le pasa una imagen del propio sitio: el navegador la carga de
 * verdad, el `src` se puede comparar sin adivinar, y la prueba no sale a la
 * red. Lo que se afirma no es de dónde sale la foto —eso lo decide Auth—
 * sino que la barra VUELVA a ella.
 */

import { test, expect } from "@playwright/test";

const js = (body) => ({ status: 200, contentType: "text/javascript; charset=utf-8", body });

/** La «foto de Google», servida desde acá. Ver el encabezado. */
const FOTO = "/img/moneda-120.webp";
const ASESINO = "/img/avatar/asesino.webp";
const MAGO = "/img/avatar/mago.webp";

/**
 * Dos avatares y nada más.
 *
 * Con uno solo no se podría probar el caso que más se parece a la vida real
 * —cambiar de avatar sin pasar por «desequipar»— que es el que descubre si
 * alguien sincroniza la cabecera sólo en una de las dos ramas.
 */
const ITEMS = [
  { id: "asesino", nombre: "El Asesino", tipo: "avatar", precio: 450, imagen: ASESINO,
    descripcion: "Un avatar.", activo: true, orden: 1, metadata: { rareza: "raro" } },
  { id: "mago", nombre: "El Mago", tipo: "avatar", precio: 350, imagen: MAGO,
    descripcion: "Otro avatar.", activo: true, orden: 2, metadata: { rareza: "comun" } },
];

const sesionCon = (avatar) => `
  export const COLECCION = "users";
  export const CAMPO_SALDO = "credits";
  export async function exigirSesion() {
    return {
      usuario: { uid: "ana", email: "a@b.c", photoURL: "${FOTO}" },
      perfil: { uid: "ana", nombre: "Ana", saldo: 1234, partidas: 4, victorias: 1,
                ganado: 900, comprado: 334,
                equipado: { avatar: ${avatar === null ? "null" : `"${avatar}"`},
                            insignia: null, dorso: null } },
    };
  }
  export function mostrarSaldo(saldo) {
    const nodo = document.getElementById("saldoValor");
    if (nodo) nodo.textContent = String(saldo);
  }
  export function conectarBotonSalir() {}
  export async function leerPerfil() { return {}; }
  export async function guardarEnPerfil() {}
  export function esperarSesion() { return Promise.resolve({ uid: "ana" }); }
  export function formatearEspera() { return "listo"; }
`;

/**
 * Firestore de mentira con el catálogo.
 *
 * `getDoc` tiene que contestar el artículo por su id: es la lectura que hace
 * `pintarAvatarCabecera` para traducir «asesino» a una imagen. Un doble que
 * devuelva «no existe» —como el de `sala-vestida`— deja a la cabecera sin
 * nada que pintar y la prueba pasaría a verde por el motivo equivocado.
 */
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
  export async function getDoc(ref) {
    const items = ${JSON.stringify(ITEMS)};
    const ruta = JSON.stringify(ref ?? "");
    const item = items.find((i) => ruta.includes(i.id));
    return item
      ? { exists: () => true, data: () => item }
      : { exists: () => false, data: () => undefined };
  }
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

/**
 * Servidor de mentira que RECUERDA lo que se equipó.
 *
 * Es la mitad que hace que el ida y vuelta signifique algo: con un doble que
 * conteste siempre lo mismo, desequipar y volver a equipar darían el mismo
 * resultado aunque la página no se enterara de nada. `window.__equipado` deja
 * el estado a la vista para poder afirmar que la barra sigue al SERVIDOR y no
 * a lo que la pantalla quiso creer.
 */
const servidorFalso = (avatar) => `
  export class ErrorDeServidor extends Error {
    constructor(mensaje, codigo) { super(mensaje); this.codigo = codigo; }
  }
  window.__equipado = { avatar: ${avatar === null ? "null" : `"${avatar}"`} };
  export const misItems = async () => ({
    tengo: [{ id: "asesino", tipo: "avatar" }, { id: "mago", tipo: "avatar" }],
    equipado: { ...window.__equipado },
  });
  export const misInsignias = async () => ({ estadisticas: {}, tengo: [], equipada: null });
  export const equiparItem = async (id) => {
    window.__equipado = { ...window.__equipado, avatar: id };
    return { itemId: id, tipo: "avatar", campo: "avatar" };
  };
  export const desequiparItem = async (tipo) => {
    window.__equipado = { ...window.__equipado, [tipo]: null };
    return { tipo, campo: tipo, equipado: null };
  };
  export const comprarItem = async () => ({});
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

async function abrir(page, ruta, { avatar = "asesino" } = {}) {
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|404 \(Not Found\)/.test(m.text())) {
      errores.push(m.text());
    }
  });

  await page.route("**/js/sesion.js", (r) => r.fulfill(js(sesionCon(avatar))));
  await page.route("**/js/firebase.js", (r) => r.fulfill(js(firebaseFalso)));
  await page.route("**/js/servidor.js", (r) => r.fulfill(js(servidorFalso(avatar))));

  await page.goto(ruta);
  return errores;
}

/**
 * Lo que la barra está mostrando, como ruta.
 *
 * Se lee el `src` y no una clase: es lo único que dice QUÉ imagen hay. Y se
 * compara el `pathname` porque el navegador devuelve la dirección completa.
 */
const enLaBarra = (page) =>
  page.evaluate(() => {
    const nodo = document.getElementById("avatar");
    if (!nodo) return "(no hay #avatar)";
    if (nodo.tagName !== "IMG") return `(es un <${nodo.tagName.toLowerCase()}>)`;
    return new URL(nodo.src, location.href).pathname;
  });

/** Lo que el servidor de mentira tiene registrado. */
const enElServidor = (page) => page.evaluate(() => window.__equipado?.avatar ?? null);

/** La tarjeta de un artículo, en la tienda o en la colección. */
const tarjeta = (page, caja, nombre) =>
  page.locator(`${caja} article, ${caja} .item-inv`).filter({ hasText: nombre });

// =====================================================================
// 1. La tienda — «Personalización»
// =====================================================================

const TIENDA = "#rejillaPersonalizacion";

async function abrirTienda(page, opciones) {
  const errores = await abrir(page, "/tienda.html", opciones);
  await page.waitForSelector(`${TIENDA} article`, { timeout: 20_000 }).catch(() => {
    throw new Error(
      `la tienda no dibujó ningún artículo. Errores: ${errores.join(" | ") || "(ninguno)"}`,
    );
  });
  return errores;
}

test("la tienda abre mostrando en la barra el avatar que ya estaba puesto", async ({ page }) => {
  const errores = await abrirTienda(page);

  await expect.poll(() => enLaBarra(page)).toBe(ASESINO);
  expect(errores, `la tienda tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

test("desequipar en la tienda devuelve la foto a la barra", async ({ page }) => {
  await abrirTienda(page);
  await expect.poll(() => enLaBarra(page)).toBe(ASESINO);

  await tarjeta(page, TIENDA, "El Asesino").getByRole("button", { name: "Desequipar" }).click();

  await expect
    .poll(() => enLaBarra(page), { message: "la barra se quedó con el avatar viejo" })
    .toBe(FOTO);
  expect(await enElServidor(page), "el servidor no registró la baja").toBeNull();
});

test("equipar en la tienda cambia la barra sin recargar", async ({ page }) => {
  await abrirTienda(page, { avatar: null });
  await expect.poll(() => enLaBarra(page)).toBe(FOTO);

  await tarjeta(page, TIENDA, "El Asesino").getByRole("button", { name: "Equipar" }).click();

  await expect
    .poll(() => enLaBarra(page), { message: "la barra no siguió al avatar que se equipó" })
    .toBe(ASESINO);
  expect(await enElServidor(page)).toBe("asesino");
});

test("cambiar de avatar en la tienda, sin pasar por desequipar", async ({ page }) => {
  /*
   * El camino más común y el que más se escapa: equipar otro avatar cuando ya
   * hay uno puesto no pasa por `desequipar`, así que una sincronización
   * escrita en una sola de las dos ramas lo dejaría afuera.
   */
  await abrirTienda(page);
  await expect.poll(() => enLaBarra(page)).toBe(ASESINO);

  await tarjeta(page, TIENDA, "El Mago").getByRole("button", { name: "Equipar" }).click();

  await expect.poll(() => enLaBarra(page)).toBe(MAGO);
  expect(await enElServidor(page)).toBe("mago");
});

// =====================================================================
// 2. El perfil — «Mi colección»
// =====================================================================

const COLECCION = "#miInventario";

async function abrirColeccion(page, opciones) {
  // Con el hash: la colección vive en una pestaña y `waitForSelector` espera a
  // que el elemento sea VISIBLE.
  const errores = await abrir(page, "/perfil.html#coleccion", opciones);
  await page.waitForSelector(`${COLECCION} .item-inv`, { timeout: 20_000 }).catch(() => {
    throw new Error(
      `la colección no dibujó ningún artículo. Errores: ${errores.join(" | ") || "(ninguno)"}`,
    );
  });
  return errores;
}

test("el perfil abre mostrando en la barra el avatar que ya estaba puesto", async ({ page }) => {
  const errores = await abrirColeccion(page);

  await expect.poll(() => enLaBarra(page)).toBe(ASESINO);
  expect(errores, `el perfil tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

test("desequipar en la colección devuelve la foto a la barra", async ({ page }) => {
  await abrirColeccion(page);
  await expect.poll(() => enLaBarra(page)).toBe(ASESINO);

  await tarjeta(page, COLECCION, "El Asesino").getByRole("button", { name: "Desequipar" }).click();

  await expect
    .poll(() => enLaBarra(page), { message: "la barra se quedó con el avatar viejo" })
    .toBe(FOTO);
  expect(await enElServidor(page), "el servidor no registró la baja").toBeNull();
});

test("equipar en la colección cambia la barra sin recargar", async ({ page }) => {
  await abrirColeccion(page, { avatar: null });
  await expect.poll(() => enLaBarra(page)).toBe(FOTO);

  await tarjeta(page, COLECCION, "El Asesino").getByRole("button", { name: "Equipar" }).click();

  await expect.poll(() => enLaBarra(page)).toBe(ASESINO);
  expect(await enElServidor(page)).toBe("asesino");
});

test("cambiar de avatar en la colección, sin pasar por desequipar", async ({ page }) => {
  await abrirColeccion(page);
  await expect.poll(() => enLaBarra(page)).toBe(ASESINO);

  await tarjeta(page, COLECCION, "El Mago").getByRole("button", { name: "Equipar" }).click();

  await expect.poll(() => enLaBarra(page)).toBe(MAGO);
  expect(await enElServidor(page)).toBe("mago");
});

// =====================================================================
// 3. Las seis páginas con sesión pintan la barra al cargar
// =====================================================================

/**
 * El tablero era la única con `#avatar` hasta `0015139`, y con la colección
 * mudada al perfil eso dejaba a cuatro pantallas sin dónde mostrarlo.
 *
 * `room.html` queda afuera de esta vuelta: necesita una sala en Firestore y su
 * dibujado lo cubre `sala-vestida.spec.js`. Las otras cinco entran acá.
 */
for (const pagina of ["/dashboard.html", "/perfil.html", "/lobby.html", "/ranking.html", "/tienda.html"]) {
  test(`${pagina} pinta el avatar equipado en la barra al cargar`, async ({ page }) => {
    await abrir(page, pagina);
    await expect.poll(() => enLaBarra(page), { timeout: 20_000 }).toBe(ASESINO);
  });

  test(`${pagina} muestra la foto cuando no hay avatar equipado`, async ({ page }) => {
    await abrir(page, pagina, { avatar: null });
    await expect.poll(() => enLaBarra(page), { timeout: 20_000 }).toBe(FOTO);
  });
}
