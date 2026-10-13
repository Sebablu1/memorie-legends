/**
 * El diseño que decide la casa, aplicado sobre la mesa de verdad.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA AFIRMACIÓN QUE MÁS IMPORTA ES LA PRIMERA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Que SIN configuración la mesa se vea exactamente como siempre.
 *
 * Hoy no hay ningún documento `config/mesa` en producción, así que ése es el
 * caso de TODOS los jugadores. Un error acá no se vería en una prueba de la
 * tabla ni en una del módulo: se vería en la mesa de todo el mundo, y el
 * único aviso sería que alguien mire.
 *
 * Por eso se comprueba contra el valor COMPUTADO del navegador —lo que de
 * verdad se está pintando— y no contra «la variable no está escrita».
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Y POR QUÉ LA LECTURA NO SE ESPERA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `vestirLaCasa` se dispara sin `await`: la mesa se dibuja con lo de siempre
 * y, si hay configuración, se aplica cuando llega. Son dos variables de CSS,
 * así que cambiarlas no redibuja nada ni mueve una carta.
 *
 * Eso obliga a que las pruebas esperen el efecto en vez de leerlo de una, y
 * es el precio correcto: bloquear el arranque de la mesa con un viaje a
 * Firestore sería cargar el momento más caro de la pantalla, justo cuando el
 * reloj se está sincronizando.
 */

import { test, expect } from "@playwright/test";

const js = (body) => ({ status: 200, contentType: "text/javascript; charset=utf-8", body });

const SESION_FALSA = `
  export const COLECCION = "users";
  export const CAMPO_SALDO = "credits";
  export async function exigirSesion() {
    return { usuario: { uid: "ana", email: "a@b.c", photoURL: null },
             perfil: { uid: "ana", nombre: "Ana", saldo: 500 } };
  }
  export function mostrarSaldo() {}
  export function conectarBotonSalir() {}
  export function formatearEspera() { return "listo"; }
`;

/**
 * El doble de firebase, con los documentos de configuración bajo control.
 *
 * `getDoc` tiene que distinguir QUÉ le están pidiendo, y desde que hay una
 * mesa por contexto no alcanza con «es configuración»: hay que saber CUÁL de
 * los cinco documentos —los cuatro contextos y el global—, porque la mesa
 * pide el suyo y recién si no está pide el general. Un doble que contestara
 * lo mismo a todos haría pasar a una mesa que leyera siempre el global.
 *
 * `doc(...)` devuelve sus argumentos tal cual, así que la colección y el
 * nombre están en posiciones fijas: `(db, "config", "mesa-publica")`.
 *
 * Se anota en `window.__configPedidas` qué pidió y en qué orden. Es la única
 * forma de afirmar «pidió el del contexto PRIMERO»: por lo que se ve pintado
 * no se distingue de haber pedido sólo el global cuando los dos dicen igual.
 */
const firebaseFalso = (documentos) => `
  const SALA = {
    codigo: "ABCDEF", estado: "jugando", entrada: 50,
    jugadores: ["ana", "beto", "caro", "dani"],
    jugadoresNombres: ["Ana", "Beto", "Caro", "Dani"], maxJugadores: 4,
  };
  const DOCUMENTOS = ${JSON.stringify(documentos)};
  export const db = {};
  export const doc = (...a) => a;
  export const collection = (...a) => a;
  export const query = (...a) => a;
  export const where = () => ({});
  export const orderBy = () => ({});
  export const limit = () => ({});
  export const getDocs = async () => ({ docs: [] });
  export async function getDoc(ref) {
    const esConfig = Array.isArray(ref) && ref[1] === "config";
    if (!esConfig) return { exists: () => true, data: () => SALA };
    const nombre = ref[2];
    (window.__configPedidas ??= []).push(nombre);
    const guardado = DOCUMENTOS[nombre];
    return { exists: () => guardado != null, data: () => guardado };
  }
  export const setDoc = async () => {};
  export const updateDoc = async () => {};
  export const addDoc = async () => ({});
  export const deleteDoc = async () => {};
  export const serverTimestamp = () => null;
  export const increment = (n) => n;
  export const arrayUnion = (x) => x;
  export const arrayRemove = (x) => x;
  export const runTransaction = async (f) => f({});
  export function onSnapshot() { return () => {}; }
  export const auth = { currentUser: { uid: "ana" } };
  export const app = {};
  export const googleProvider = {};
  export const SUPPORT_EMAIL = "soporte@example.com";
  export function onAuthStateChanged(a, f) { setTimeout(() => f({ uid: "ana" }), 0); return () => {}; }
  export async function signOut() {}
  export const GoogleAuthProvider = class {};
  export async function signInWithPopup() { return { user: {} }; }
  export async function signInWithEmailAndPassword() { return { user: {} }; }
  export async function createUserWithEmailAndPassword() { return { user: {} }; }
  export async function sendPasswordResetEmail() {}
  export const funciones = {};
  export function httpsCallable() { return async () => ({ data: {} }); }
  export function precalentarFunciones() {}
`;

/**
 * La mesa, con los documentos de configuración que se le indiquen.
 *
 * `documentos` va con los nombres de verdad: `mesa` es el global y
 * `mesa-entrenamiento`, `mesa-publica`, … los de cada contexto. Escribirlos
 * tal cual —en vez de pasar «el contexto» y armarlos acá— es a propósito: si
 * la prueba armara el nombre con la misma función que el código, las dos se
 * equivocarían juntas y nadie lo notaría.
 */
async function abrirMesaCon(page, documentos, { sala = "" } = {}) {
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));

  await page.route("**/js/sesion.js", (r) => r.fulfill(js(SESION_FALSA)));
  await page.route("**/js/firebase.js", (r) => r.fulfill(js(firebaseFalso(documentos))));

  await page.goto(sala ? `/mesa.html?sala=${sala}` : "/mesa.html");
  await page.waitForSelector(".mesa");
  return errores;
}

/**
 * La mesa de ENTRENAMIENTO con la configuración GLOBAL puesta, y nada más.
 *
 * Es el caso de producción: el único documento que existe es `config/mesa`,
 * el que escribía el panel antes de que hubiera contextos. Así que estas
 * pruebas pasan por el camino del fallback, que es el que hoy usan todos.
 */
const abrirMesa = (page, config = null) =>
  abrirMesaCon(page, config === null ? {} : { mesa: config });

/** Lo que el navegador está pintando de verdad, no lo que dice la variable. */
const mascaraDeLaBrujula = (page) =>
  page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector(".mesa"), "::before");
    return cs.maskImage || cs.webkitMaskImage || "";
  });

const capaDeLaSala = (page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundImage);

// =====================================================================
// 1. Sin configuración, nada cambia
// =====================================================================

test("sin configuración, la mesa se ve exactamente como siempre", async ({ page }) => {
  /*
   * Es el caso de TODOS los jugadores hoy: no hay documento `config/mesa`.
   * Si esto se rompe, se rompe para todo el mundo a la vez.
   */
  const errores = await abrirMesa(page, null);

  await expect
    .poll(() => mascaraDeLaBrujula(page))
    .toContain("rosa-viento.svg");

  // El fondo de siempre son siete capas; la primera, `--sala`, vale `none`.
  expect(await capaDeLaSala(page), "la capa de la sala tiene que seguir apagada")
    .toMatch(/^none,/);

  expect(errores, errores.join(" | ")).toEqual([]);
});

test("una configuración vacía tampoco cambia nada", async ({ page }) => {
  // El documento existe pero no dice nada: es el estado en que queda después
  // de que el administrador borre lo suyo.
  await abrirMesa(page, {});

  await expect.poll(() => mascaraDeLaBrujula(page)).toContain("rosa-viento.svg");
  expect(await capaDeLaSala(page)).toMatch(/^none,/);
});

test("y las variables NI SIQUIERA se escriben", async ({ page }) => {
  /*
   * No alcanza con que se vea igual.
   *
   * Escribir `--sala` con un valor vacío se ve idéntico —el navegador
   * descarta la declaración— pero deja la variable puesta en el elemento, y
   * a partir de ahí el `var()` ya no cae en su valor por defecto de la misma
   * forma. Es la diferencia entre «no tocar» y «tocar con nada», y la
   * primera es la que esta fase promete.
   *
   * Se mira el atributo `style` del elemento, que es lo único que distingue
   * las dos cosas.
   */
  await abrirMesa(page, {});
  await page.waitForTimeout(300); // que la lectura, que no se espera, haya llegado

  const escritas = await page.evaluate(() => ({
    sala: document.body.style.getPropertyValue("--sala"),
    brujula: document.querySelector(".mesa").style.getPropertyValue("--brujula"),
  }));

  expect(escritas.sala, "se escribió `--sala` sin tener qué escribir").toBe("");
  expect(escritas.brujula, "se escribió `--brujula` sin tener qué escribir").toBe("");
});

test("y una con basura adentro, tampoco", async ({ page }) => {
  await abrirMesa(page, { sala: "rojo", brujula: "https://otro.com/x.svg" });

  await expect.poll(() => mascaraDeLaBrujula(page)).toContain("rosa-viento.svg");
  expect(await capaDeLaSala(page)).toMatch(/^none,/);
});

// =====================================================================
// 2. Con configuración, se aplica
// =====================================================================

test("una brújula propia reemplaza a la de siempre", async ({ page }) => {
  await abrirMesa(page, { brujula: "/img/mesa/rosa-viento.svg?propia=1" });

  await expect.poll(() => mascaraDeLaBrujula(page)).toContain("propia=1");
});

test("«ninguna» deja la mesa sin brújula", async ({ page }) => {
  await abrirMesa(page, { brujula: "ninguna" });

  await expect.poll(() => mascaraDeLaBrujula(page)).toBe("none");
});

test("una sala con imagen se pinta encima del fondo de siempre", async ({ page }) => {
  await abrirMesa(page, { sala: "/img/mesa/piedra.svg" });

  await expect.poll(() => capaDeLaSala(page)).toContain("piedra.svg");
  // Y las otras capas siguen ahí: la sala va ARRIBA, no en lugar de.
  expect(await capaDeLaSala(page)).toMatch(/gradient/);
});

test("una sala de color sale como degradado de un tono", async ({ page }) => {
  /*
   * En esa posición CSS no acepta un color —sólo la última capa puede serlo—
   * así que un color plano se escribe como `linear-gradient(c, c)`. Lo que
   * se comprueba es que el navegador lo haya ACEPTADO: si fuera inválido, la
   * propiedad entera se descartaría y no quedaría ningún degradado nuevo.
   */
  await abrirMesa(page, { sala: "#1a1a2e" });

  await expect
    .poll(() => capaDeLaSala(page))
    .toMatch(/linear-gradient\(rgb\(26, 26, 46\), rgb\(26, 26, 46\)\)/);
});

// =====================================================================
// 3. Que no rompa nada si falla
// =====================================================================

test("si la lectura falla, la mesa sigue entera", async ({ page }) => {
  /*
   * Sin red, con las reglas negando, o con Firestore caído. La mesa ya está
   * dibujada cuando esto ocurre, así que no hay nada que decirle al jugador.
   */
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));

  await page.route("**/js/sesion.js", (r) => r.fulfill(js(SESION_FALSA)));
  await page.route("**/js/firebase.js", (r) =>
    r.fulfill(js(firebaseFalso({}).replace(
      "const nombre = ref[2];",
      "throw new Error('permission-denied');",
    ))));

  await page.goto("/mesa.html");
  await page.waitForSelector(".mesa");

  await expect.poll(() => mascaraDeLaBrujula(page)).toContain("rosa-viento.svg");
  await expect(page.locator(".mesa")).toBeVisible();
  expect(errores, "una lectura fallida no puede tirar la mesa").toEqual([]);
});

// =====================================================================
// 4. Cada mesa lee la suya
// =====================================================================

/** Qué documentos de configuración pidió la mesa, en orden. */
const pedidas = (page) => page.evaluate(() => window.__configPedidas ?? []);

test("la mesa de entrenamiento lee el documento de entrenamiento", async ({ page }) => {
  await abrirMesaCon(page, {
    "mesa-entrenamiento": { brujula: "/img/mesa/rosa-viento.svg?propia=1" },
  });

  await expect.poll(() => mascaraDeLaBrujula(page)).toContain("propia=1");

  // Y con el suyo puesto, NO va a buscar el global: un viaje de menos.
  expect(await pedidas(page)).toEqual(["mesa-entrenamiento"]);
});

test("si el contexto no tiene el suyo, hereda el global", async ({ page }) => {
  /*
   * El caso de producción de hoy: existe `config/mesa` y ninguno de los
   * cuatro. Sin este fallback, la mesa que los jugadores ya tienen puesta se
   * apagaría de golpe el día que esto se despliegue.
   */
  await abrirMesaCon(page, { mesa: { brujula: "/img/mesa/rosa-viento.svg?global=1" } });

  await expect.poll(() => mascaraDeLaBrujula(page)).toContain("global=1");
  expect(await pedidas(page), "primero el suyo, después el general")
    .toEqual(["mesa-entrenamiento", "mesa"]);
});

test("el documento del contexto le gana al global", async ({ page }) => {
  /*
   * LA AFIRMACIÓN QUE SOSTIENE TODA LA FASE.
   *
   * Con los dos documentos puestos y diciendo cosas distintas, una mesa que
   * leyera siempre el global se vería perfecta en todas las otras pruebas:
   * ahí los dos dicen lo mismo, o hay uno solo. Acá no.
   */
  await abrirMesaCon(page, {
    "mesa-entrenamiento": { brujula: "/img/mesa/rosa-viento.svg?propia=1" },
    mesa: { brujula: "/img/mesa/rosa-viento.svg?global=1" },
  });

  await expect.poll(() => mascaraDeLaBrujula(page)).toContain("propia=1");
  expect(await mascaraDeLaBrujula(page), "se quedó con el general").not.toContain("global=1");
});

test("sin ninguno de los dos, la mesa de siempre", async ({ page }) => {
  const errores = await abrirMesaCon(page, {});

  await expect.poll(() => pedidas(page)).toEqual(["mesa-entrenamiento", "mesa"]);
  expect(await mascaraDeLaBrujula(page)).toContain("rosa-viento.svg");
  expect(await capaDeLaSala(page)).toMatch(/^none,/);
  expect(errores, errores.join(" | ")).toEqual([]);
});

test("una mesa con sala pide la pública, no la de entrenamiento", async ({ page }) => {
  /*
   * Es lo único que distingue los contextos ANTES de leer la sala: con
   * `?sala=` hay partida en red, y por descarte es pública. Privada todavía
   * cae acá adentro a propósito —hace falta `extra.privada`, que llega con
   * el documento de la sala— y eso es otra fase.
   */
  await abrirMesaCon(page, { "mesa-publica": { sala: "#1a1a2e" } }, { sala: "ABCDEF" });

  await expect.poll(() => pedidas(page)).toEqual(["mesa-publica"]);
  await expect
    .poll(() => capaDeLaSala(page))
    .toMatch(/linear-gradient\(rgb\(26, 26, 46\), rgb\(26, 26, 46\)\)/);
});
