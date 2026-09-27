/**
 * El lobby: torneos, mesas públicas y salas privadas, y la puerta al
 * entrenamiento.
 *
 * Firebase no existe en esta suite. Firestore es de mentira pero FILTRA como el
 * real —la consulta de mesas públicas devuelve sólo lo que pide— y anota qué
 * se le pidió; el servidor es de mentira y anota cada llamada. Los dos dobles
 * llevan todo lo que exportan los reales: lo exige `dobles-de-partida.mjs`.
 */

import { test, expect } from "@playwright/test";

const js = (body) => ({ status: 200, contentType: "text/javascript; charset=utf-8", body });

const SESION_FALSA = `
  export const COLECCION = "users";
  export const CAMPO_SALDO = "credits";
  export async function exigirSesion() {
    return {
      usuario: { uid: "yo", photoURL: null },
      perfil: { uid: "yo", nombre: "Probador", saldo: 500, partidas: 3, victorias: 1 },
    };
  }
  export function mostrarSaldo() {}
  export function conectarBotonSalir() {}
  export function formatearEspera() { return "listo"; }
`;

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
  // Las llamadas se anotan en sessionStorage: sobreviven a la navegación a la
  // sala, que es justo después de las que más importan.
  const anotar = (...a) => {
    const lista = JSON.parse(sessionStorage.getItem("__llamadas") ?? "[]");
    lista.push(a);
    sessionStorage.setItem("__llamadas", JSON.stringify(lista));
  };
  export const soyAdministrador = async () => { anotar("soyAdministrador"); return { admin: window.__admin === true }; };
  export const crearSalaPublica = async (datos) => { anotar("crearSalaPublica", datos); return { codigo: "NUE234" }; };
  export const editarSalaPublica = async (datos) => { anotar("editarSalaPublica", datos); return {}; };
  export const borrarSalaPublica = async (codigo) => { anotar("borrarSalaPublica", codigo); return {}; };
  export const crearSala = async () => { anotar("crearSala"); return { codigo: "PUB123" }; };
  export const crearSalaPrivada = async (entrada, nombre, limitePuntos) => {
    anotar("crearSalaPrivada", entrada, limitePuntos);
    return { sala: "SAL001", codigo: "K7M2PQRS", vence: Date.now() + 30 * 60_000 };
  };
  export const unirseASala = async (codigo) => { anotar("unirseASala", codigo); return { codigo }; };
  export const unirseConCodigo = async (codigo) => { anotar("unirseConCodigo", codigo); return { sala: "SAL001" }; };
  export const listarTorneos = async () => ({ torneos: window.__torneos ?? [] });
  export const inscribirseATorneo = async () => ({});
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

const mesa = (codigo, extra = {}) => ({
  codigo, nombre: `Mesa ${codigo}`, estado: "esperando", publica: true, soloGanadas: true,
  entrada: 10, limitePuntos: 150, maxJugadores: 4, jugadores: [], juego: "memorie", ...extra,
});

const MEMORIE = { id: "memorie", nombre: "Memorie Legends", activo: true, orden: 2, logo: "/img/moneda-80.webp" };

async function abrirLobby(page, { juegos = [MEMORIE], salas = [], admin = false, torneos = [] } = {}) {
  await page.addInitScript((d) => Object.assign(window, d), {
    __juegos: juegos, __salas: salas, __admin: admin, __torneos: torneos,
  });
  await page.route("**/js/sesion.js", (r) => r.fulfill(js(SESION_FALSA)));
  await page.route("**/js/firebase.js", (r) => r.fulfill(js(FIREBASE_FALSO)));
  await page.route("**/js/servidor.js", (r) => r.fulfill(js(SERVIDOR_FALSO)));
  await page.route("**/room.html*", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<p>sala</p>" }));
  await page.goto("/lobby.html");
  await page.waitForFunction(() => !/Buscando/.test(document.getElementById("listaPublicas").textContent));
}

const llamadas = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("__llamadas") ?? "[]"));

// ─────────────────────────────────────────────────────────── los juegos

test("sólo los juegos activos, en su orden, y sólo sus mesas públicas", async ({ page }) => {
  await abrirLobby(page, {
    juegos: [
      MEMORIE,
      { id: "otro", nombre: "Otro Juego", activo: true, orden: 1 },
      { id: "apagado", nombre: "Apagado", activo: false, orden: 0 },
    ],
    salas: [
      mesa("MEM234"),
      mesa("OTR234", { juego: "otro" }),
      mesa("APA234", { juego: "apagado" }),
      mesa("DES234", { juego: "desconocido" }),
      mesa("PRV234", { publica: false }),
      mesa("JUG234", { estado: "jugando" }),
    ],
  });

  const titulos = await page.locator(".juego-titulo").allTextContents();
  expect(titulos.map((t) => t.trim())).toEqual(["Otro Juego", "Memorie Legends"]);

  const lista = await page.locator("#listaPublicas").innerText();
  expect(lista).toContain("Mesa MEM234");
  expect(lista).toContain("Mesa OTR234");
  for (const fuera of ["APA234", "DES234", "PRV234", "JUG234"]) expect(lista).not.toContain(fuera);

  // La consulta pide sólo las públicas en espera, como exigen las reglas.
  const deSalas = await page.evaluate(() => (window.__consultas ?? []).filter((c) => c.coleccion === "rooms"));
  expect(deSalas.length).toBeGreaterThan(0);
  for (const { filtros } of deSalas) {
    expect(filtros).toContainEqual({ campo: "publica", op: "==", valor: true });
    expect(filtros).toContainEqual({ campo: "estado", op: "==", valor: "esperando" });
  }
});

test("sin juegos, lo dice; sin mesas, también", async ({ page }) => {
  await abrirLobby(page, { juegos: [] });
  await expect(page.locator("#listaPublicas")).toHaveText("No hay juegos disponibles por ahora.");

  const otra = await page.context().newPage();
  await abrirLobby(otra, { salas: [] });
  await expect(otra.locator("#listaPublicas")).toHaveText("Todavía no hay mesas públicas abiertas.");
});

// ─────────────────────────────────────────────────────── las mesas públicas

test("sentarse pide entrar con el código de la mesa", async ({ page }) => {
  await abrirLobby(page, { salas: [mesa("MEM234")] });
  await page.locator('[data-sentarse="MEM234"]').click();
  await expect.poll(() => page.url()).toContain("room.html?code=MEM234");
  expect(await llamadas(page)).toContainEqual(["unirseASala", "MEM234"]);
});

test("una mesa llena dice «Llena» y la propia dice «Volver»", async ({ page }) => {
  await abrirLobby(page, {
    salas: [
      mesa("LLE234", { jugadores: ["a", "b"], maxJugadores: 2 }),
      mesa("MIA234", { jugadores: ["yo"] }),
    ],
  });
  await expect(page.locator('.mesa-publica[data-codigo="LLE234"] button')).toHaveText("Llena");
  await expect(page.locator('.mesa-publica[data-codigo="LLE234"] button')).toBeDisabled();
  await expect(page.locator('[data-volver="MIA234"]')).toHaveText("Volver");
});

test("cada mesa dice que se paga con Leyendas Ganadas", async ({ page }) => {
  await abrirLobby(page, { salas: [mesa("MEM234", { entrada: 25 })] });
  await expect(page.locator('.mesa-publica[data-codigo="MEM234"]')).toContainText("Entrada 25 Leyendas Ganadas");
});

// ─────────────────────────────────────────────────── la administración

test("sin permiso de administración, no hay controles", async ({ page }) => {
  await abrirLobby(page, { salas: [mesa("MEM234")] });
  await expect.poll(async () => (await llamadas(page)).some((l) => l[0] === "soyAdministrador")).toBe(true);
  await expect(page.locator("#adminPublicas")).toBeHidden();
  await expect(page.locator("[data-editar], [data-borrar]")).toHaveCount(0);
});

test("con permiso: abrir, editar y borrar una mesa pública", async ({ page }) => {
  await abrirLobby(page, { salas: [mesa("MEM234", { nombre: "La de siempre", maxJugadores: 3 })], admin: true });
  await expect(page.locator("#adminPublicas")).toBeVisible();

  // Abrir.
  await page.locator("#publicaNombre").fill("Mesa nueva");
  await page.locator("#publicaEntrada").selectOption("25");
  await page.locator("#publicaCupo").selectOption("2");
  await page.locator("#btnGuardarPublica").click();
  await expect(page.locator("#mensaje")).toHaveText("Mesa abierta.");
  const abrir = (await llamadas(page)).find((l) => l[0] === "crearSalaPublica");
  expect(abrir[1]).toMatchObject({ nombre: "Mesa nueva", entrada: 25, maxJugadores: 2 });
  expect(Number.isFinite(abrir[1].limitePuntos)).toBe(true);

  // Editar: el formulario se llena con la mesa, y guarda con su código.
  await page.locator('[data-editar="MEM234"]').click();
  await expect(page.locator("#tituloAdminPublicas")).toHaveText("Editar la mesa MEM234");
  await expect(page.locator("#publicaNombre")).toHaveValue("La de siempre");
  await expect(page.locator("#publicaCupo")).toHaveValue("3");
  await page.locator("#publicaNombre").fill("La de siempre, renovada");
  await page.locator("#btnGuardarPublica").click();
  await expect(page.locator("#mensaje")).toHaveText("Cambios guardados.");
  const editar = (await llamadas(page)).find((l) => l[0] === "editarSalaPublica");
  expect(editar[1]).toMatchObject({ codigo: "MEM234", nombre: "La de siempre, renovada", maxJugadores: 3 });

  // Borrar pide dos toques.
  const borrar = page.locator('[data-borrar="MEM234"]');
  await borrar.click();
  await expect(borrar).toHaveText("¿Borrar? Tocá de nuevo");
  expect((await llamadas(page)).some((l) => l[0] === "borrarSalaPublica"), "borró con un solo toque").toBe(false);
  await borrar.click();
  await expect.poll(async () => (await llamadas(page)).find((l) => l[0] === "borrarSalaPublica")).toEqual([
    "borrarSalaPublica", "MEM234",
  ]);
});

// ─────────────────────────────────────────────────────── salas privadas

test("crear una sala privada muestra el mismo cartel que el tablero", async ({ page }) => {
  await abrirLobby(page);
  await page.locator("#btnCrearSala").click();
  await expect(page.locator("#codigoPrivado")).toBeVisible();
  await expect(page.locator("#codigoPrivadoTexto")).toHaveText("K7M2 PQRS");
  await expect(page.locator("#enlaceWhatsApp img")).toHaveAttribute("src", "img/whatsapp/Digital_Glyph_White_RGB_2026.svg");
  expect((await llamadas(page)).map((l) => l[0])).toContain("crearSalaPrivada");
  expect((await llamadas(page)).map((l) => l[0])).not.toContain("crearSala");
});

test("con un código de ocho entra por la puerta privada, y con uno de seis por la pública", async ({ page }) => {
  await abrirLobby(page);
  await page.locator("#codigoSala").fill("k7m2pqrs");
  await page.locator("#btnUnirse").click();
  await expect.poll(() => page.url()).toContain("room.html?code=SAL001");
  expect(page.url(), "el código privado terminó en la URL").not.toContain("K7M2PQRS");
  expect(await llamadas(page)).toContainEqual(["unirseConCodigo", "K7M2PQRS"]);

  await abrirLobby(page);
  await page.locator("#codigoSala").fill("ABC234");
  await page.locator("#btnUnirse").click();
  await expect.poll(() => page.url()).toContain("room.html?code=ABC234");
});

// ─────────────────────────────────────────────── torneos y entrenamiento

test("«Jugar vs IA» lleva al entrenamiento del tablero", async ({ page }) => {
  await abrirLobby(page);
  await expect(page.locator("#enlaceJugarIA")).toHaveAttribute("href", "dashboard.html#jugar");
});

test("los torneos están acá, y dicen cuando no hay", async ({ page }) => {
  await abrirLobby(page, { torneos: [] });
  await expect(page.locator("#carteleraTorneos")).toBeVisible();
  await expect(page.locator("#torneosVacios")).toHaveText("No hay torneos abiertos por ahora.");

  const otra = await page.context().newPage();
  await abrirLobby(otra, { torneos: [{ id: "t1", nombre: "Copa de prueba", entrada: 50, inscriptos: 1 }] });
  await expect(otra.locator("#listaTorneosJugador")).toContainText("Copa de prueba");
  await expect(otra.locator("#torneosVacios")).toBeHidden();
});

test("y ya no están en el tablero", async ({ page }) => {
  const html = await (await page.request.get("/dashboard.html")).text();
  expect(html).not.toContain('id="carteleraTorneos"');
});
