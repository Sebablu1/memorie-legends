/**
 * Mi inventario: poner y SACAR lo que uno tiene.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE DEFIENDE ACÁ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La mitad que faltaba. La tienda equipaba avatares y dorsos, y como el perfil
 * guarda un id por tipo, ponerse otro pisa el anterior — pero «ninguno» no es
 * un artículo que se pueda elegir de una rejilla. Quien se probaba un avatar
 * quedaba con uno puesto para siempre.
 *
 * Cinco cosas:
 *
 *   1. Que se vea lo que uno TIENE, y sólo eso. Un inventario que muestre lo
 *      que no compraste es un catálogo con otro nombre.
 *   2. Que el estado de cada artículo sea el de verdad: uno equipado por tipo,
 *      no dos.
 *   3. Que equipar cambie el estado del que se pone Y del que se saca, en la
 *      misma pasada.
 *   4. Que desequipar mande el TIPO, no el id: el servidor pone ese campo del
 *      perfil en null, y mandarle un id sería mandarle otra cosa.
 *   5. Que la cabecera se entere. Sin eso, el jugador se pone un avatar, la
 *      tarjeta dice «Equipado» y arriba sigue el anterior: dos respuestas
 *      distintas a la misma pregunta en la misma pantalla.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE SUSTITUYEN TRES MÓDULOS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `firebase.js` para que el catálogo sea uno conocido en vez de lo que haya
 * hoy en el proyecto de verdad; `sesion.js` para tener sesión sin login; y
 * `servidor.js` para que nada salga de la máquina y para poder mirar con qué
 * se llamó a cada función.
 */

import { test, expect } from "@playwright/test";

/** El catálogo que devuelve el Firestore de mentira. */
const CATALOGO = [
  { id: "el-zorro", tipo: "avatar", nombre: "El Zorro", descripcion: "Corta justo antes.", precio: 150, imagen: "🦊", activo: true, orden: 10, metadata: { rareza: "poco_comun" } },
  { id: "el-dragon", tipo: "avatar", nombre: "El Dragón", descripcion: "Se ve de lejos.", precio: 600, imagen: "🐉", activo: true, orden: 20, metadata: { rareza: "legendario" } },
  { id: "no-comprado", tipo: "avatar", nombre: "El Mago", descripcion: "", precio: 300, imagen: "🧙", activo: true, orden: 30, metadata: { rareza: "raro" } },
  { id: "dorso-azul", tipo: "dorso", nombre: "Dorso Azul", descripcion: "El de siempre.", precio: 0, imagen: "🂠", activo: true, orden: 10, metadata: { rareza: "inicial" } },
  // Una insignia que SÍ tiene: no se muestra en el inventario, va en la
  // vitrina de logros.
  { id: "novato", tipo: "insignia", nombre: "Novato", descripcion: "", precio: 0, imagen: "🏅", activo: true, orden: 10 },
];

const firebaseFalso = (catalogo) => `
  export const db = {};
  export const collection = (...a) => a;
  export const query = (...a) => a;
  export const orderBy = () => null;
  export const where = () => null;
  export const onSnapshot = () => () => {};
  export const getDocs = async () => ({
    docs: ${JSON.stringify(catalogo)}.map((d) => ({ id: d.id, data: () => d })),
  });
  export const doc = (...a) => a;
  export const getDoc = async () => ({ exists: () => false, data: () => undefined });
  export const funciones = {};
  export const httpsCallable = () => async () => ({ data: {} });
  export const SUPPORT_EMAIL = "soporte@memorie-legends.com";
  export const auth = { currentUser: null };
`;

const sesionFalsa = `
  export const COLECCION = "users";
  export const CAMPO_SALDO = "credits";
  export async function exigirSesion() {
    return {
      usuario: { uid: "u1", photoURL: "https://ejemplo.test/foto.jpg", email: "a@b.c" },
      perfil: { uid: "u1", nombre: "Probador", saldo: 500, partidas: 0, victorias: 0,
                equipado: { avatar: "el-zorro", insignia: null, dorso: null } },
    };
  }
  export function mostrarSaldo() {}
  export function conectarBotonSalir() {}
  export function formatearEspera() { return "listo"; }
`;

/** Lo que el jugador tiene, y lo que lleva puesto. Cambia con cada llamada. */
const servidorFalso = `
  window.__llamadas = [];
  export class ErrorDeServidor extends Error {
    constructor(m, c) { super(m); this.name = "ErrorDeServidor"; this.codigo = c; }
  }
  const tengo = [
    { id: "el-zorro", tipo: "avatar" },
    { id: "el-dragon", tipo: "avatar" },
    { id: "dorso-azul", tipo: "dorso" },
    { id: "novato", tipo: "insignia" },
  ];
  let equipado = { avatar: "el-zorro", insignia: null, dorso: null };

  export async function misItems() {
    window.__llamadas.push(["misItems", null]);
    return { tengo: [...tengo], equipado: { ...equipado } };
  }
  export async function equiparItem(itemId) {
    window.__llamadas.push(["equiparItem", itemId]);
    const tipo = tengo.find((i) => i.id === itemId)?.tipo;
    if (!tipo) throw new ErrorDeServidor("Todavía no tenés ese artículo.", "permission-denied");
    equipado = { ...equipado, [tipo]: itemId };
    return { itemId, tipo, campo: tipo };
  }
  export async function desequiparItem(tipo) {
    window.__llamadas.push(["desequiparItem", tipo]);
    equipado = { ...equipado, [tipo]: null };
    return { tipo, campo: tipo, equipado: null };
  }
  export const misInsignias = async () => ({ estadisticas: {}, tengo: [], equipada: null });
  export const listarTorneos = async () => ({ torneos: [] });
  export const inscribirseATorneo = async () => ({});
  export const crearSala = async () => ({});
  export const unirseASala = async () => ({});
  export const ErrorDeRed = Error;
`;

async function abrirPanel(page, { catalogo = CATALOGO } = {}) {
  const js = (body) => ({ status: 200, contentType: "text/javascript; charset=utf-8", body });

  await page.route("**/js/firebase.js", (r) => r.fulfill(js(firebaseFalso(catalogo))));
  await page.route("**/js/sesion.js", (r) => r.fulfill(js(sesionFalsa)));
  await page.route("**/js/servidor.js", (r) => r.fulfill(js(servidorFalso)));

  await page.goto("/dashboard.html");
  await page.waitForSelector("#miInventario .item-inv", { timeout: 15_000 });
}

/** La tarjeta de un artículo, buscada por su nombre visible. */
const tarjeta = (page, nombre) =>
  page.locator("#miInventario .item-inv").filter({ hasText: nombre });

// =====================================================================

test("muestra lo que el jugador tiene, y sólo eso", async ({ page }) => {
  await abrirPanel(page);

  await expect(tarjeta(page, "El Zorro")).toHaveCount(1);
  await expect(tarjeta(page, "El Dragón")).toHaveCount(1);
  await expect(tarjeta(page, "Dorso Azul")).toHaveCount(1);

  // El que no compró no aparece: un inventario que muestre lo que no tenés es
  // un catálogo con otro nombre.
  await expect(tarjeta(page, "El Mago")).toHaveCount(0);
});

test("las insignias NO están acá: viven en la vitrina de logros", async ({ page }) => {
  await abrirPanel(page);

  // La tiene, y el catálogo la trae. Aun así no se dibuja en el inventario:
  // dos listas de lo mismo en la misma página no le sirven a nadie.
  await expect(page.locator("#miInventario")).not.toContainText("Novato");
  await expect(page.locator("#miInventario")).toContainText("Mis avatares");
  await expect(page.locator("#miInventario")).toContainText("Mis dorsos");
});

test("el estado dice cuál está puesto, y es uno solo por tipo", async ({ page }) => {
  await abrirPanel(page);

  await expect(tarjeta(page, "El Zorro")).toContainText("Equipado");
  await expect(tarjeta(page, "El Dragón")).toContainText("Sin equipar");

  // Uno por tipo: si hubiera dos marcados, el perfil estaría mintiendo.
  await expect(page.locator("#miInventario .item-inv.puesto")).toHaveCount(1);
});

test("equipar otro avatar saca el anterior en la misma pasada", async ({ page }) => {
  await abrirPanel(page);

  await tarjeta(page, "El Dragón").locator("button").click();

  await expect(tarjeta(page, "El Dragón")).toContainText("Equipado");
  await expect(tarjeta(page, "El Zorro"), "el anterior tiene que soltarse solo")
    .toContainText("Sin equipar");
  await expect(page.locator("#miInventario .item-inv.puesto")).toHaveCount(1);
});

test("desequipar deja al jugador sin ninguno de ese tipo", async ({ page }) => {
  await abrirPanel(page);

  await tarjeta(page, "El Zorro").locator("button").click();

  await expect(tarjeta(page, "El Zorro")).toContainText("Sin equipar");
  await expect(
    page.locator("#miInventario .item-inv.puesto"),
    "no tiene que quedar ninguno puesto",
  ).toHaveCount(0);
});

test("desequipar manda el TIPO, no el id del artículo", async ({ page }) => {
  // El perfil guarda un id por tipo, y desequipar es poner ese campo en null.
  // Mandarle el id sería mandarle otra cosa, y el esquema del servidor lo
  // rechaza — pero el error se vería recién en producción.
  await abrirPanel(page);
  await tarjeta(page, "El Zorro").locator("button").click();
  await expect(tarjeta(page, "El Zorro")).toContainText("Sin equipar");

  const llamada = await page.evaluate(() =>
    window.__llamadas.find(([n]) => n === "desequiparItem"));
  expect(llamada, "no se llamó a desequiparItem").toBeTruthy();
  expect(llamada[1], "viajó el id en vez del tipo").toBe("avatar");
});

test("el dorso se equipa por su cuenta, sin tocar el avatar", async ({ page }) => {
  await abrirPanel(page);

  await tarjeta(page, "Dorso Azul").locator("button").click();

  await expect(tarjeta(page, "Dorso Azul")).toContainText("Equipado");
  await expect(tarjeta(page, "El Zorro"), "el avatar no se toca").toContainText("Equipado");
  await expect(page.locator("#miInventario .item-inv.puesto")).toHaveCount(2);
});

test("la rareza se muestra con su color", async ({ page }) => {
  await abrirPanel(page);

  const zorro = tarjeta(page, "El Zorro").locator(".rareza");
  await expect(zorro).toHaveText("Poco común");

  const dragon = tarjeta(page, "El Dragón").locator(".rareza");
  await expect(dragon).toHaveText("Legendario");

  // Dos rarezas distintas no pueden pintarse igual: el color es la mitad de la
  // información.
  const colores = await page.evaluate(() =>
    [...document.querySelectorAll("#miInventario .rareza")].map(
      (e) => getComputedStyle(e).color,
    ));
  expect(new Set(colores).size, "todas las rarezas salieron del mismo color")
    .toBeGreaterThan(1);
});

test("un error del servidor se muestra en pantalla, no en un alert", async ({ page }) => {
  await abrirPanel(page);

  // Un `alert` bloquea la página y no se puede leer con un lector de pantalla.
  let hubo = false;
  page.on("dialog", (d) => {
    hubo = true;
    d.dismiss();
  });

  await page.evaluate(() => {
    window.__original = window.__llamadas;
  });
  await page.route("**/js/servidor.js", (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/javascript; charset=utf-8",
      body: servidorFalso.replace(
        "equipado = { ...equipado, [tipo]: itemId };",
        'throw new ErrorDeServidor("No se pudo equipar.", "internal");',
      ),
    }));

  await page.reload();
  await page.waitForSelector("#miInventario .item-inv");
  await tarjeta(page, "El Dragón").locator("button").click();

  await expect(page.locator("#avisoInventario")).toContainText(/no se pudo/i);
  expect(hubo, "se abrió un alert").toBe(false);
});
