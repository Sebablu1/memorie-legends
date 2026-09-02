/**
 * El tablero, que absorbió al lobby.
 *
 * No hay sesión de Firebase acá, así que `exigirSesion()` redirige a
 * `login.html`. Esa redirección se bloquea para poder mirar la página: lo que
 * se comprueba es lo que NO depende de estar logueado —que los módulos carguen,
 * que los controles existan con los ids acordados, que el desplegable se llene
 * de las reglas y que el campo de código se comporte—.
 *
 * Lo que sí depende de la sesión (crear sala, unirse, la tabla en vivo) lo
 * cubren las suites de Node contra las Cloud Functions.
 */

import { test, expect } from "@playwright/test";

/**
 * Un `sesion.js` de mentira, servido en lugar del real.
 *
 * Sin esto `exigirSesion()` manda a login.html y no queda nada que mirar. El
 * primer intento fue abortar esa navegación con `route.abort()`, y el
 * resultado era peor: la página quedaba muerta y las pruebas fallaban
 * diciendo "falta #entradaSala" cuando el problema era que no se estaba
 * mirando el tablero.
 *
 * Se sustituye el MÓDULO y no la autenticación de Firebase: es la frontera
 * más chica que hace falta cruzar, y deja correr el resto del tablero tal cual
 * se despliega.
 */
const SESION_FALSA = `
  export const COLECCION = "users";
  export const CAMPO_SALDO = "credits";
  export async function exigirSesion() {
    return {
      usuario: { uid: "uid-de-prueba", photoURL: null },
      perfil: { uid: "uid-de-prueba", nombre: "Probador", saldo: 500,
                partidas: 3, victorias: 1, ultimoGiro: 0, ultimoBono: 0 },
    };
  }
  export function mostrarSaldo() {}
  export function conectarBotonSalir() {}
  export function formatearEspera() { return "listo"; }
`;

async function abrirTablero(page) {
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e.message)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|404|net::ERR|Firebase|permission/i.test(m.text())) {
      errores.push(m.text());
    }
  });

  await page.route("**/js/sesion.js", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: SESION_FALSA }),
  );

  await page.goto("/dashboard.html");
  // Se espera a que el desplegable TENGA opciones, no a que "se vea": un
  // <option> nunca cuenta como visible para Playwright, así que
  // `waitForSelector` se quedaba esperando algo que ya estaba ahí.
  await page.waitForFunction(
    () => document.querySelectorAll("#entradaSala option").length > 0,
    null,
    { timeout: 15_000 },
  );
  return errores;
}

test("los módulos cargan: ningún import roto", async ({ page }) => {
  const errores = await abrirTablero(page);
  await page.waitForTimeout(1500);
  // Un import mal escrito revienta antes de que corra una línea, así que esto
  // es lo que separa "la página anda" de "la página está en blanco".
  const deModulo = errores.filter((e) => /import|module|not defined|is not a function/i.test(e));
  expect(deModulo, `errores de módulo: ${deModulo.join(" | ")}`).toEqual([]);
});

test("están los controles con los ids acordados", async ({ page }) => {
  await abrirTablero(page);
  for (const id of ["entradaSala", "btnCrearSala", "codigoSala", "btnUnirse", "filasSalas"]) {
    await expect(page.locator(`#${id}`), `falta #${id}`).toHaveCount(1);
  }
  await expect(page.locator("#btnEntrenar")).toHaveAttribute("href", "mesa.html");
});

test("el título central y la sección de salas", async ({ page }) => {
  await abrirTablero(page);
  await expect(page.locator(".titulo-elegir")).toHaveText(/cómo querés jugar/i);
  await expect(page.locator(".panel-salas h2")).toContainText(/salas/i);

  // Las cinco columnas pedidas.
  const encabezados = await page.locator(".tabla-salas thead th").allInnerTexts();
  expect(encabezados.length).toBe(5);
  expect(encabezados.slice(0, 4).join("|").toLowerCase()).toContain("código");
});

test("el desplegable de entradas sale de las reglas, no escrito a mano", async ({ page }) => {
  await abrirTablero(page);
  const { ENTRADAS } = await import("../../public/js/reglas/salas.js");
  const valores = await page.locator("#entradaSala option").evaluateAll(
    (os) => os.map((o) => Number(o.value)),
  );
  expect(valores).toEqual(ENTRADAS);
});

test("el campo de código fuerza mayúsculas y descarta lo que no va", async ({ page }) => {
  await abrirTablero(page);
  const campo = page.locator("#codigoSala");
  await campo.fill("");
  await campo.type("ab-c 2*3");
  expect(await campo.inputValue()).toBe("ABC23");
  await expect(campo).toHaveAttribute("maxlength", "6");
});

test("el tablero no ofrece el lobby viejo por ningún lado", async ({ page }) => {
  await abrirTablero(page);
  const alLobby = await page.locator('a[href*="lobby"]').count();
  expect(alLobby, "el tablero no debe enlazar a lobby.html").toBe(0);
});
