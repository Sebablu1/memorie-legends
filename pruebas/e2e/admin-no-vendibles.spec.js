/**
 * El panel separa lo que se vende de lo que se gana.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ IMPORTA QUE ESTÉN SEPARADAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Mezcladas en una sola lista, las insignias se leían como productos: la fila
 * mostraba «0 Leyendas» y, si estaban apagadas, decía «🚫 apagado» y ofrecía
 * «Encender». En un artículo de venta, encender significa ponerlo a la venta.
 * Un administrador nuevo enciende la insignia creyendo que arregla algo, y lo
 * que hace en realidad es otra cosa con el mismo botón.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE ESTA SUITE NO PRUEBA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Que no se pueda GUARDAR una insignia con precio. Eso lo decide el servidor
 * y está en `pruebas/tienda.mjs`, sección 17: bloquear el campo del formulario
 * avisa, no impide — el panel manda un objeto a una Cloud Function y quien
 * abra la consola manda el que quiera.
 *
 * Acá se prueba lo que el administrador VE, que es la otra mitad: que no
 * llegue a escribir un número que le va a ser rechazado, y que entienda por
 * qué.
 */

import { test, expect } from "@playwright/test";
import { TIPOS_VENDIBLES, esVendible, TIPOS_VALIDOS } from "../../public/js/reglas/catalogo.js";

const ADMIN = "soporte.memorie.legends@gmail.com";

/** Un catálogo chico pero con las dos clases de cosa. */
const CATALOGO = [
  { id: "el-zorro", tipo: "avatar", nombre: "El Zorro", precio: 150, imagen: "🦊", activo: true, orden: 10 },
  { id: "dorso-rojo", tipo: "dorso", nombre: "Dorso Rojo", precio: 100, imagen: "🂠", activo: true, orden: 10 },
  { id: "mazo-verde", tipo: "mazo", nombre: "Mazo Esmeralda", precio: 300, imagen: "🎴", activo: true, orden: 10 },
  { id: "pano-roble", tipo: "fondo", nombre: "Roble", precio: 300, imagen: "🟫", activo: true, orden: 10 },
  // Una apagada, que es el caso que confundía: se leía como «producto fuera
  // de venta» en vez de «logro no disponible».
  { id: "novato", tipo: "insignia", nombre: "Novato", precio: 0, imagen: "🏅", activo: true, orden: 10 },
  { id: "leyenda", tipo: "insignia", nombre: "Leyenda", precio: 0, imagen: "🏆", activo: false, orden: 20 },
];

const firebaseFalso = `
  export const app = {}; export const auth = {};
  export const db = {}; export const funciones = {};
  export const googleProvider = {};
  export const SUPPORT_EMAIL = ${JSON.stringify(ADMIN)};

  const CATALOGO = ${JSON.stringify(CATALOGO)};
  window.__llamadas = [];

  export function httpsCallable(_f, nombre) {
    return async (datos) => {
      window.__llamadas.push({ nombre, datos });
      if (nombre === "listarCatalogoAdmin") return { data: { items: CATALOGO } };
      if (nombre === "listarSalasAdmin") {
        return { data: { salas: [], partidas: [], muertas: [], totales: { salas: 0, partidas: 0, muertas: 0, leyendasRetenidas: 0 } } };
      }
      if (nombre === "listarTorneosAdmin") return { data: { torneos: [] } };
      if (nombre === "leerUmbralesAdmin") return { data: { umbrales: {} } };
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

async function abrirCatalogo(page) {
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));

  await page.route("**/js/firebase.js", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: firebaseFalso }));

  await page.goto("/admin/index.html");
  await page.waitForTimeout(600);
  await page.click("#btnRefrescarCatalogo");
  await page.waitForSelector("#listaCatalogo .fila");
  return errores;
}

/**
 * La fila de un artículo, buscada por su id.
 *
 * Por el id y no por el nombre: «Leyenda» aparece dentro de «150 Leyendas», o
 * sea que filtrar por texto trae todas las filas de la lista.
 */
const filaDe = (page, id) =>
  page
    .locator("#listaCatalogo .fila")
    .filter({ has: page.locator('[data-editar="' + id + '"]') });

// =====================================================================

test("el catálogo se dibuja en dos grupos, y sin errores", async ({ page }) => {
  const errores = await abrirCatalogo(page);

  const grupos = page.locator("#listaCatalogo .grupo-catalogo h3");
  await expect(grupos).toHaveCount(2);
  await expect(grupos.first()).toContainText("Vendibles");
  await expect(grupos.last()).toContainText("No vendibles");

  expect(errores, `la página tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

test("las insignias caen del lado de los logros, y los demás del otro", async ({ page }) => {
  await abrirCatalogo(page);

  const noVendible = page.locator("#listaCatalogo .grupo-catalogo.no-vendible");

  await expect(noVendible).toContainText("Novato");
  await expect(noVendible).toContainText("Leyenda");

  // Y ninguno de los cuatro vendibles se coló ahí.
  for (const nombre of ["El Zorro", "Dorso Rojo", "Mazo Esmeralda", "Roble"]) {
    await expect(noVendible, `${nombre} quedó del lado equivocado`).not.toContainText(nombre);
  }
});

test("una insignia no dice un precio: dice cómo se consigue", async ({ page }) => {
  /**
   * Mostrar «0 Leyendas» al lado de un logro invita a leerlo como un producto
   * gratis. No lo es: no está en venta.
   */
  await abrirCatalogo(page);

  const fila = filaDe(page, "novato");
  await expect(fila).toContainText("se gana jugando");
  await expect(fila).not.toContainText("0 Leyendas");
});

test("la insignia apagada dice «no disponible», no «apagado»", async ({ page }) => {
  // Es el caso que confundía. El campo es el mismo `activo`, pero apagar un
  // producto es sacarlo de la venta y apagar un logro es dejar de ofrecerlo.
  await abrirCatalogo(page);

  // Se busca por el id y no por el nombre: «Leyenda» está adentro de
  // «150 Leyendas», así que filtrar por texto trae todas las filas.
  const fila = filaDe(page, "leyenda");
  await expect(fila).toContainText("no disponible");
  await expect(fila.getByRole("button", { name: "Ofrecer" })).toBeVisible();
  await expect(fila.getByRole("button", { name: "Encender" })).toHaveCount(0);

  // Y un artículo de venta sigue diciendo lo de siempre.
  const zorro = filaDe(page, "el-zorro");
  await expect(zorro).toContainText("a la venta");
});

test("elegir «insignia» bloquea el precio y explica por qué", async ({ page }) => {
  await abrirCatalogo(page);

  const precio = page.locator("#itemPrecio");
  const aviso = page.locator("#avisoNoVendible");

  // Con un tipo que se vende, el precio se escribe normalmente.
  await page.selectOption("#itemTipo", "avatar");
  await expect(precio).toBeEnabled();
  await expect(aviso).toBeHidden();
  await precio.fill("300");

  await page.selectOption("#itemTipo", "insignia");

  await expect(precio).toBeDisabled();
  await expect(precio).toHaveValue("0");
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText("Las insignias son logros. No se venden.");

  // La casilla NO se esconde: un logro también se ofrece y se retira. Lo que
  // cambia es la palabra.
  await expect(page.locator("#itemActivo")).toBeVisible();
  await expect(page.locator("#etiquetaActivo")).toHaveText("Logro disponible");

  // Y al volver a un tipo vendible, se puede escribir otra vez.
  await page.selectOption("#itemTipo", "dorso");
  await expect(precio).toBeEnabled();
  await expect(aviso).toBeHidden();
  await expect(page.locator("#etiquetaActivo")).toHaveText("A la venta");
});

test("la separación sale de las reglas, no de una lista escrita en el panel", async ({ page }) => {
  /**
   * `TIPOS_VENDIBLES` es lo que el servidor mira al cobrar. Si el panel
   * tuviera su propia lista, un tipo nuevo aparecería en el grupo equivocado
   * hasta que alguien se acordara de las dos.
   */
  await abrirCatalogo(page);

  const noVendiblesEsperados = TIPOS_VALIDOS.filter((t) => !esVendible(t));
  expect(noVendiblesEsperados, "hoy la única no vendible es la insignia").toEqual(["insignia"]);
  expect(TIPOS_VENDIBLES).toContain("avatar");

  // El grupo vendible tiene un subtítulo por cada tipo que se vende y tenga
  // artículos: cuatro, con este catálogo.
  const subtitulos = page.locator("#listaCatalogo .grupo-catalogo:not(.no-vendible) .titulo-tipo");
  await expect(subtitulos).toHaveCount(4);
});
