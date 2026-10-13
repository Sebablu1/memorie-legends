/**
 * El diseño de la mesa, desde el panel.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE ESTO VIGILA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El ciclo completo de la brújula: la de siempre, una propia, ninguna, y de
 * vuelta a la de siempre. Las cuatro son estados distintos y la cuarta es la
 * que más fácil se rompe — sin ella, cargar una brújula sería una decisión
 * sin vuelta atrás.
 *
 * Y lo que NO se puede guardar, que importa igual: una ruta de otro dominio
 * o una palabra suelta. El servidor lo valida con su esquema, pero esta
 * pantalla lo dice antes de salir a la red, y eso también se afirma.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SE MIRA LA LLAMADA, NO LA BASE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El doble de `httpsCallable` anota qué se pidió y con qué. Eso es lo que
 * esta pantalla decide; lo que el servidor hace con eso —borrar el campo,
 * mezclar con lo que había— es de `diseno-de-mesa.js` y se prueba en Node.
 *
 * La distinción importa en el caso de borrar: lo que esta pantalla tiene que
 * mandar es `null`, y no la cadena vacía. Si mandara `""`, el servidor lo
 * guardaría como un valor y la brújula de siempre no volvería nunca.
 */

import { test, expect } from "@playwright/test";

const ADMIN = "soporte.memorie.legends@gmail.com";

const firebaseFalso = (guardado) => `
  export const app = {}; export const auth = {};
  export const db = {}; export const funciones = {};
  export const googleProvider = {};
  export const SUPPORT_EMAIL = ${JSON.stringify(ADMIN)};

  window.__llamadas = [];
  let DISENO = ${JSON.stringify(guardado)};

  export function httpsCallable(_f, nombre) {
    return async (datos) => {
      window.__llamadas.push({ nombre, datos });
      if (nombre === "leerDisenoDeMesaAdmin") return { data: { diseno: DISENO } };
      if (nombre === "guardarDisenoDeMesaAdmin") {
        // El servidor de verdad borra el campo con FieldValue.delete(); acá
        // alcanza con sacarlo, que es lo que el navegador va a volver a leer.
        for (const [k, v] of Object.entries(datos)) {
          if (v === null) delete DISENO[k];
          else DISENO[k] = v;
        }
        return { data: { guardado: Object.keys(datos).length > 0, campos: Object.keys(datos) } };
      }
      if (nombre === "listarCatalogoAdmin") return { data: { items: [] } };
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

async function abrirPanel(page, guardado = {}) {
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));
  await page.route("**/js/firebase.js", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: firebaseFalso(guardado) }));
  await page.goto("/admin/index.html");
  await page.waitForSelector("#mesaBrujula");
  return errores;
}

/** Lo último que se le pidió al servidor para guardar. */
const ultimoGuardado = (page) =>
  page.evaluate(() =>
    [...window.__llamadas].reverse().find((l) => l.nombre === "guardarDisenoDeMesaAdmin")?.datos ?? null);

// =====================================================================
// 1. El ciclo completo
// =====================================================================

test("sin nada guardado, el campo arranca vacío", async ({ page }) => {
  // Vacío quiere decir «la de siempre». No se escribe la ruta del SVG actual
  // para no hacerle creer a nadie que está configurada cuando no lo está.
  const errores = await abrirPanel(page, {});

  await expect(page.locator("#mesaBrujula")).toHaveValue("");
  expect(errores, errores.join(" | ")).toEqual([]);
});

test("lo que ya estaba guardado se muestra", async ({ page }) => {
  await abrirPanel(page, { brujula: "/img/mesa/brujulas/suya.webp" });

  await expect(page.locator("#mesaBrujula")).toHaveValue("/img/mesa/brujulas/suya.webp");
});

test("guardar una ruta la manda tal cual", async ({ page }) => {
  await abrirPanel(page, {});

  await page.fill("#mesaBrujula", "/img/mesa/brujulas/nueva.webp");
  await page.click("#btnGuardarMesa");

  await expect.poll(() => ultimoGuardado(page))
    .toEqual({ brujula: "/img/mesa/brujulas/nueva.webp" });
  await expect(page.locator("#avisoMesa")).toContainText(/Listo/i);
});

test("«ninguna» se guarda como palabra, no como ruta", async ({ page }) => {
  /*
   * Es la tercera opción: ni la de siempre ni una propia, sino que no haya
   * brújula. Tiene que llegar al servidor como la palabra, porque es lo que
   * su esquema acepta además de una ruta.
   */
  await abrirPanel(page, {});

  await page.fill("#mesaBrujula", "ninguna");
  await page.click("#btnGuardarMesa");

  await expect.poll(() => ultimoGuardado(page)).toEqual({ brujula: "ninguna" });
});

test("vaciar el campo manda null, que es volver a la de siempre", async ({ page }) => {
  /*
   * El caso que hace que cargar una brújula no sea una decisión sin vuelta.
   *
   * Y tiene que ser `null`, no `""`: la cadena vacía se guardaría como un
   * valor y la brújula de siempre no volvería nunca. Es la diferencia entre
   * borrar el campo y escribirle nada.
   */
  await abrirPanel(page, { brujula: "/img/mesa/brujulas/suya.webp" });
  await expect(page.locator("#mesaBrujula")).toHaveValue("/img/mesa/brujulas/suya.webp");

  await page.fill("#mesaBrujula", "");
  await page.click("#btnGuardarMesa");

  await expect.poll(() => ultimoGuardado(page)).toEqual({ brujula: null });
  await expect(page.locator("#mesaBrujula")).toHaveValue("");
  await expect(page.locator("#avisoMesa")).toContainText(/de siempre/i);
});

test("y el botón de volver atrás hace lo mismo sin tener que borrar a mano", async ({ page }) => {
  await abrirPanel(page, { brujula: "/img/mesa/brujulas/suya.webp" });

  await page.click("#btnBorrarBrujula");

  await expect.poll(() => ultimoGuardado(page)).toEqual({ brujula: null });
  await expect(page.locator("#mesaBrujula")).toHaveValue("");
});

// =====================================================================
// 2. Lo que no se manda
// =====================================================================

test("una ruta de otro dominio se rechaza sin salir a la red", async ({ page }) => {
  await abrirPanel(page, {});

  await page.fill("#mesaBrujula", "https://otro.com/brujula.webp");
  await page.click("#btnGuardarMesa");

  await expect(page.locator("#avisoMesa")).toContainText(/\/img\//);
  expect(await ultimoGuardado(page), "salió igual a la red").toBeNull();
});

test("y una palabra cualquiera también", async ({ page }) => {
  // `ninguna` es la única palabra que significa algo. Cualquier otra es un
  // error de tipeo, y aceptarla dejaría la mesa sin brújula sin querer.
  await abrirPanel(page, {});

  await page.fill("#mesaBrujula", "ningina");
  await page.click("#btnGuardarMesa");

  await expect(page.locator("#avisoMesa")).toContainText(/ninguna/i);
  expect(await ultimoGuardado(page)).toBeNull();
});

// =====================================================================
// 3. Y no es el catálogo
// =====================================================================

test("la brújula NO aparece entre los tipos de artículo del catálogo", async ({ page }) => {
  /*
   * La distinción que sostiene toda la fase. El desplegable de artículos se
   * arma solo desde `TIPOS_VALIDOS`: si la brújula se colara ahí, se podría
   * crear un ARTÍCULO «brujula-mesa», con precio y equipable.
   */
  await abrirPanel(page, {});

  const tipos = await page.locator("#itemTipo option").allTextContents();
  expect(tipos.join(" "), tipos.join(", ")).not.toMatch(/brujula/i);
});
