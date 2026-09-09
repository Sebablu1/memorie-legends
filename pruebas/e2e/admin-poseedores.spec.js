/**
 * El panel: ver quién tiene un artículo, quitárselo, y el borrado forzado.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DE DÓNDE SALE ESTO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `borrarItemAdmin` se niega a borrar un artículo que alguien compró, y hace
 * bien: borrarlo dejaría a esa persona con un id que no apunta a nada — no se
 * ve, no se puede desequipar y no se puede volver a quitar.
 *
 * Pero la cuenta de administración compró artículos de prueba, y no había
 * forma de sacárselos. Ahora hay tres: ver quiénes lo tienen, quitárselo a
 * uno, o quitárselo a todos y borrarlo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE DEFIENDE ACÁ, Y QUÉ NO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Acá se prueba LA PANTALLA: que el botón esté, que la lista se dibuje con lo
 * que contesta el servidor, que quitar mande el id correcto, y —lo que más
 * importa— que el borrado forzado no se pueda disparar de un clic distraído.
 *
 * Lo que hace el servidor —devolver las Leyendas, desequipar, no borrar si
 * quedó alguien— lo prueban las secciones 22 a 25 de `pruebas/tienda.mjs`
 * contra un Firestore de mentira. Son dos mitades y ninguna cubre a la otra:
 * una pantalla perfecta sobre un servidor que no devuelve la plata sigue
 * siendo un robo.
 */

import { test, expect } from "@playwright/test";

const ADMIN = "soporte.memorie.legends@gmail.com";

/** Un catálogo de dos artículos y un poseedor, servido por las llamables. */
const firebaseFalso = `
  export const app = {}; export const auth = {};
  export const db = {}; export const funciones = {};
  export const googleProvider = {};
  export const SUPPORT_EMAIL = ${JSON.stringify(ADMIN)};

  window.__llamadas = [];

  const CATALOGO = [
    { id: "el_dragon", tipo: "avatar", nombre: "El Dragón", precio: 600,
      imagen: "/img/avatar/el_dragon.webp", activo: true, orden: 130 },
    { id: "de_prueba", tipo: "avatar", nombre: "De Prueba", precio: 100,
      imagen: "🧪", activo: true, orden: 999 },
  ];

  const POSEEDORES = {
    de_prueba: [
      { uid: "u1", username: "Ana", email: "ana@x", precioPagado: 100, equipado: true },
      { uid: "u2", username: "Beto", email: "beto@x", precioPagado: 100, equipado: false },
    ],
    el_dragon: [],
  };

  export function httpsCallable(_f, nombre) {
    return async (datos) => {
      window.__llamadas.push([nombre, datos ?? null]);
      if (nombre === "listarCatalogoAdmin") return { data: { items: CATALOGO } };
      if (nombre === "listarPoseedoresItemAdmin") {
        return { data: { itemId: datos.itemId, poseedores: POSEEDORES[datos.itemId] ?? [] } };
      }
      if (nombre === "desposeerItemAdmin") {
        POSEEDORES[datos.itemId] = (POSEEDORES[datos.itemId] ?? []).filter((p) => p.uid !== datos.uid);
        return { data: { uid: datos.uid, itemId: datos.itemId, yaEstaba: false, devueltas: 100 } };
      }
      if (nombre === "forzarBorrarItemAdmin") {
        return { data: { id: datos.itemId, borrado: true, quitadoA: 2, devueltasEnTotal: 200 } };
      }
      return { data: {} };
    };
  }
  export function onAuthStateChanged(a, fn) {
    setTimeout(() => fn({ email: ${JSON.stringify(ADMIN)}, uid: "admin" }), 60);
    return () => {};
  }
  export async function signInWithEmailAndPassword(){}
  export async function signInWithPopup(){}
  export function signOut(){}
`;

async function abrirPanel(page) {
  await page.route("**/js/firebase.js", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: firebaseFalso }));
  await page.goto("/admin/index.html");
  await page.waitForSelector('#listaCatalogo [data-quien="de_prueba"]', { timeout: 15_000 });
}

const llamadas = (page) => page.evaluate(() => window.__llamadas);

// =====================================================================

test("cada artículo tiene el botón de ver quién lo tiene", async ({ page }) => {
  await abrirPanel(page);
  await expect(page.locator("#listaCatalogo [data-quien]")).toHaveCount(2);
});

test("abre la lista con nombre, lo pagado y si lo lleva puesto", async ({ page }) => {
  await abrirPanel(page);
  await page.locator('[data-quien="de_prueba"]').click();

  const panel = page.locator("#poseedores-de_prueba");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Ana");
  await expect(panel).toContainText("Beto");
  await expect(panel).toContainText("100");

  // Que lo lleve puesto hace falta saberlo: quitárselo le cambia lo que ve,
  // no sólo lo que tiene guardado.
  await expect(panel).toContainText("lo lleva puesto");
});

test("la lista cuelga del artículo, no de una ventana", async ({ page }) => {
  // Se decide mirando la fila del artículo. Una ventana modal taparía justo eso.
  await abrirPanel(page);
  await page.locator('[data-quien="de_prueba"]').click();

  const debajo = await page.evaluate(() => {
    const fila = document.querySelector('[data-quien="de_prueba"]').closest(".fila");
    return fila.nextElementSibling?.id === "poseedores-de_prueba";
  });
  expect(debajo, "la lista no quedó debajo de la fila de su artículo").toBe(true);
});

test("el segundo clic la cierra", async ({ page }) => {
  await abrirPanel(page);
  const boton = page.locator('[data-quien="de_prueba"]');

  await boton.click();
  await expect(page.locator("#poseedores-de_prueba")).toHaveCount(1);
  await boton.click();
  await expect(page.locator("#poseedores-de_prueba")).toHaveCount(0);
});

test("un artículo que no tiene nadie lo dice, y no ofrece quitarlo", async ({ page }) => {
  await abrirPanel(page);
  await page.locator('[data-quien="el_dragon"]').click();

  const panel = page.locator("#poseedores-el_dragon");
  await expect(panel).toContainText(/no lo tiene nadie/i);
  await expect(panel.locator("[data-quitar]")).toHaveCount(0);
  await expect(panel.locator("[data-forzar]")).toHaveCount(0);
});

test("quitárselo a uno manda su uid y el id del artículo", async ({ page }) => {
  // Los dos datos importan y es fácil cruzarlos: el artículo se identifica por
  // id y la persona por uid, y los dos son cadenas.
  await abrirPanel(page);
  page.on("dialog", (d) => d.accept());

  await page.locator('[data-quien="de_prueba"]').click();
  await page.locator('#poseedores-de_prueba [data-quitar]').first().click();

  await expect(page.locator("#poseedores-de_prueba")).not.toContainText("Ana");

  const quitar = (await llamadas(page)).find(([n]) => n === "desposeerItemAdmin");
  expect(quitar, "no se llamó a desposeerItemAdmin").toBeTruthy();
  expect(quitar[1]).toEqual({ itemId: "de_prueba", uid: "u1" });
});

// =====================================================================
// El borrado forzado
// =====================================================================

test("el borrado forzado NO se dispara con un clic distraído", async ({ page }) => {
  // Es la única operación del panel que le quita algo a gente que no está
  // mirando. Un `confirm` se acepta sin leerlo, así que además pide escribir
  // el id: eso obliga a mirar cuál se está borrando.
  await abrirPanel(page);

  // Se acepta el confirm y se escribe MAL el id en el prompt.
  page.on("dialog", (d) => (d.type() === "prompt" ? d.accept("otra-cosa") : d.accept()));

  await page.locator('[data-quien="de_prueba"]').click();
  await page.locator('#poseedores-de_prueba [data-forzar]').click();

  const forzado = (await llamadas(page)).find(([n]) => n === "forzarBorrarItemAdmin");
  expect(forzado, "se borró con el id mal escrito").toBeFalsy();
  await expect(page.locator("#avisoCatalogoLista")).toContainText(/no coincide/i);
});

test("cancelar el aviso tampoco borra", async ({ page }) => {
  await abrirPanel(page);
  page.on("dialog", (d) => d.dismiss());

  await page.locator('[data-quien="de_prueba"]').click();
  await page.locator('#poseedores-de_prueba [data-forzar]').click();

  const forzado = (await llamadas(page)).find(([n]) => n === "forzarBorrarItemAdmin");
  expect(forzado, "se borró después de cancelar").toBeFalsy();
});

test("escribiendo el id sí borra, y cuenta a cuántos se lo quitó", async ({ page }) => {
  await abrirPanel(page);
  page.on("dialog", (d) => (d.type() === "prompt" ? d.accept("de_prueba") : d.accept()));

  await page.locator('[data-quien="de_prueba"]').click();
  await page.locator('#poseedores-de_prueba [data-forzar]').click();

  const forzado = (await llamadas(page)).find(([n]) => n === "forzarBorrarItemAdmin");
  expect(forzado, "no se llamó a forzarBorrarItemAdmin").toBeTruthy();
  expect(forzado[1]).toEqual({ itemId: "de_prueba" });

  // Y se le dice al administrador qué pasó: a cuántos y cuánto se devolvió.
  await expect(page.locator("#avisoCatalogoLista")).toContainText("2");
  await expect(page.locator("#avisoCatalogoLista")).toContainText("200");
});
