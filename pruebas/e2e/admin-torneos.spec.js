/**
 * El panel de torneos, dibujado de verdad.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE ESTA SUITE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Por un fallo que llegó a producción y que ninguna prueba podía ver.
 *
 * Al renombrar una variable en `accionesDe` cambié la declaración y no los
 * cuatro usos: quedó un `...renombrar` que ya no existía. `node --check` pasa
 * —es una referencia válida al parsear— y las 48 suites de Node no cargan el
 * panel. El resultado fue un `renombrar is not defined` en la cara del
 * administrador, y la lista de torneos vacía.
 *
 * O sea: había pruebas para lo que el panel DECIDE —`camposEditables` está
 * cubierto en `pruebas/torneos.mjs`— y ninguna para que el panel se dibuje.
 * Alcanza con pintar una fila de cada estado para que ese error no vuelva a
 * pasar sin que nadie lo note.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NO SE SUSTITUYE `torneos-admin.js`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Es el módulo que se está probando. Se sustituye `firebase.js`, que es la
 * capa de abajo, y se lo deja correr.
 */

import { test, expect } from "@playwright/test";
import { ESTADOS } from "../../public/js/reglas/torneos.js";

const ADMIN = "soporte.memorie.legends@gmail.com";

/** Un torneo por cada estado, para dibujarlos todos de una pasada. */
const TORNEOS = [
  { id: "t1", nombre: "En borrador", estado: ESTADOS.BORRADOR, entrada: 100, inscriptos: 0, pozo: 0 },
  {
    id: "t2", nombre: "Abierto", estado: ESTADOS.INSCRIPCIONES_ABIERTAS,
    entrada: 200, inscriptos: 3, pozo: 600,
    descripcion: "Cuatro mesas, por Discord.",
    comienzaEn: Date.UTC(2026, 8, 20, 23, 0),
  },
  { id: "t3", nombre: "Completo", estado: ESTADOS.COMPLETO, entrada: 50, inscriptos: 8, pozo: 400 },
  { id: "t4", nombre: "Jugándose", estado: ESTADOS.EN_CURSO, entrada: 50, inscriptos: 8, pozo: 400 },
  { id: "t5", nombre: "Terminado", estado: ESTADOS.FINALIZADO, entrada: 50, inscriptos: 8, pozo: 400 },
  { id: "t6", nombre: "Cancelado", estado: ESTADOS.CANCELADO, entrada: 50, inscriptos: 0, pozo: 0 },
];

const firebaseFalso = `
  export const app = {}; export const auth = {};
  export const db = {}; export const funciones = {};
  export const googleProvider = {};
  export const SUPPORT_EMAIL = ${JSON.stringify(ADMIN)};

  const TORNEOS = ${JSON.stringify(TORNEOS)};
  window.__llamadas = [];

  export function httpsCallable(_f, nombre) {
    return async (datos) => {
      window.__llamadas.push({ nombre, datos });
      if (nombre === "listarTorneosAdmin") return { data: { torneos: TORNEOS } };
      if (nombre === "listarTorneos") return { data: { torneos: [] } };
      if (nombre === "editarTorneoAdmin") {
        return { data: { id: datos.torneoId, nombre: datos.nombre } };
      }
      if (nombre === "leerUmbralesAdmin") return { data: { umbrales: {} } };
      // El panel de torneos comparte pantalla con el de salas, y "pintar"
      // lee "totales" sin defensa. Un doble que devuelve un objeto vacío
      // rompe la página entera y ensucia justo lo que esta suite mide.
      if (nombre === "listarSalasAdmin") {
        return { data: { salas: [], partidas: [], muertas: [], totales: { salas: 0, partidas: 0, muertas: 0, leyendasRetenidas: 0 } } };
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
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errores.push(m.text());
  });

  await page.route("**/js/firebase.js", (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/javascript; charset=utf-8",
      body: firebaseFalso,
    }));

  await page.goto("/admin/index.html");
  await page.waitForTimeout(600);
  await page.click("#btnRefrescarTorneos");
  await page.waitForSelector("#listaTorneos .fila");
  return errores;
}

// =====================================================================

test("la lista de torneos se dibuja, y sin un solo error", async ({ page }) => {
  /**
   * Ésta es la que faltaba.
   *
   * Un `ReferenceError` dentro de `accionesDe` deja la lista vacía y escribe
   * en la consola. Mirar sólo el DOM no alcanzaría: hay que mirar también que
   * no se haya roto nada en el camino.
   */
  const errores = await abrirPanel(page);

  const filas = await page.locator("#listaTorneos .fila").count();
  expect(filas, "no se dibujó una fila por torneo").toBe(TORNEOS.length);
  expect(errores, `la página tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

test("cada estado ofrece las acciones que le corresponden", async ({ page }) => {
  await abrirPanel(page);

  const acciones = await page.$$eval("#listaTorneos .fila", (filas) =>
    filas.map((f) => ({
      nombre: f.querySelector(".codigo")?.textContent?.trim(),
      botones: [...f.querySelectorAll("button[data-accion]")].map((b) => b.dataset.accion),
    })));

  // «Ver inscriptos» va en todas las filas y no sale de `accionesDe`: se
  // dibuja aparte porque mirar quién se anotó no cambia nada.
  const de = (nombre) =>
    (acciones.find((a) => a.nombre === nombre)?.botones ?? []).filter((b) => b !== "ver");

  // El borrador es el que estaba inalcanzable: sin él en la lista, «abrir
  // inscripciones» no se podía tocar y el torneo no arrancaba nunca.
  expect(de("En borrador"), "el borrador tiene que poder abrirse").toContain("abrir");
  expect(de("Abierto")).toContain("cerrar");
  expect(de("Completo")).toContain("iniciar");
  expect(de("Jugándose")).toContain("finalizar");

  // Terminado y cancelado son historia: no se tocan.
  expect(de("Terminado"), "un torneo terminado no se edita").toEqual([]);
  expect(de("Cancelado"), "uno cancelado tampoco").toEqual([]);
});

test("«Editar» aparece donde el nombre se puede cambiar, y en ningún otro lado", async ({ page }) => {
  // Sale de `camposEditables`, la misma función que usa el servidor para
  // decidir. Si mañana se congela el nombre en algún estado, el botón
  // desaparece solo.
  await abrirPanel(page);

  const conEditar = await page.$$eval('#listaTorneos [data-accion="editar"]', (bs) =>
    bs.map((b) => b.closest(".fila")?.querySelector(".codigo")?.textContent?.trim()));

  expect(conEditar.sort()).toEqual(
    ["Abierto", "Completo", "En borrador", "Jugándose"].sort(),
  );
});

test("editar manda nombre, descripción y fecha, y nunca la entrada", async ({ page }) => {
  await abrirPanel(page);

  // Los tres `prompt` seguidos: nombre, descripción y fecha.
  const respuestas = ["Copa nueva", "Se juega por Discord.", "2026-10-01T20:00"];
  let i = 0;
  page.on("dialog", (d) => d.accept(respuestas[i++] ?? ""));

  await page.click('#listaTorneos .fila:has-text("Abierto") [data-accion="editar"]');
  await page.waitForFunction(() =>
    window.__llamadas.some((l) => l.nombre === "editarTorneoAdmin"));

  const llamada = await page.evaluate(() =>
    window.__llamadas.find((l) => l.nombre === "editarTorneoAdmin"));

  expect(llamada.datos.nombre).toBe("Copa nueva");
  expect(llamada.datos.descripcion).toBe("Se juega por Discord.");
  expect(typeof llamada.datos.comienzaEn, "la fecha viaja en milisegundos").toBe("number");

  // La entrada y el cupo no viajan. El servidor los rechazaría igual, pero
  // mandarlos sería pedirle que rechace algo que el panel no debería ofrecer.
  expect(llamada.datos.entrada, "la entrada no se manda").toBeUndefined();
  expect(llamada.datos.maxJugadores, "el cupo tampoco").toBeUndefined();
});
