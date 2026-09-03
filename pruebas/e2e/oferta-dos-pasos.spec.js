/**
 * El ofrecimiento de los dos pasos, en el panel.
 *
 * POR QUÉ EXISTE ESTE AVISO
 *
 * La pantalla para activarlos ya estaba, pero colgando de un enlace del menú
 * al que nadie entra por su cuenta. Una protección que hay que ir a buscar no
 * la usa casi nadie, así que se ofrece al caer del login.
 *
 * LO QUE SE PRUEBA ES SOBRE TODO CUÁNDO **NO** APARECE
 *
 * Mostrarlo cuando corresponde es fácil. Lo que rompe la confianza en un aviso
 * es que aparezca cuando no corresponde:
 *
 *   - a quien YA tiene los dos pasos, que lo mandaría a una pantalla donde va
 *     a leer que ya está activo y va a pensar que algo se rompió;
 *   - a quien dijo "ahora no" hace un rato, que es como se enseña a saltear un
 *     cartel sin leerlo — y entonces tampoco se lee el día que sí lo aceptaría;
 *   - cuando no se pudo averiguar si los tiene, donde la respuesta correcta es
 *     callarse.
 */

import { test, expect } from "@playwright/test";

const SESION = `
  export const COLECCION="users"; export const CAMPO_SALDO="credits";
  export async function exigirSesion(){return{usuario:{uid:"u1",photoURL:null},
    perfil:{uid:"u1",nombre:"Seba",saldo:500,partidas:0,victorias:0,ultimoGiro:0,ultimoBono:0}};}
  export function mostrarSaldo(){} export function conectarBotonSalir(){}
  export function formatearEspera(){return "listo";}`;

/** Un `mfa.js` que contesta lo que cada caso necesita. */
const mfa = (respuesta) => `
  export async function estadoMfa(){ ${respuesta} }
  export async function verificarCorreo(){}
  export async function empezarInscripcion(){ return {}; }
  export async function confirmarInscripcion(){ return true; }
  export async function quitarFactor(){ return true; }
  export const necesitaSegundoPaso = () => false;
  export async function opcionesDeSegundoPaso(){ return { resolucion:{}, metodos:[] }; }
  export async function terminarConCodigo(){ return {}; }`;

const SIN_DOS_PASOS = mfa("return { activo: false, factores: [], correoVerificado: true };");
const CON_DOS_PASOS = mfa("return { activo: true, factores: [{uid:'f1',nombre:'App'}], correoVerificado: true };");
const NO_SE_SABE = mfa("throw new Error('sin conexión');");

async function abrir(page, comoContestaMfa) {
  const servir = (ruta, cuerpo) =>
    page.route(ruta, (r) =>
      r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: cuerpo }));
  await servir("**/js/sesion.js", SESION);
  await servir("**/js/mfa.js", comoContestaMfa);
  await page.goto("/dashboard.html");
  await page.waitForFunction(() => document.querySelectorAll("#entradaSala option").length > 0);
}

test("se ofrece a quien no los tiene", async ({ page }) => {
  await abrir(page, SIN_DOS_PASOS);

  const caja = page.locator("#ofertaDosPasos");
  await expect(caja).toBeVisible({ timeout: 10_000 });

  // Las dos salidas tienen que estar, y la de activar tiene que llevar a algún
  // lado: un aviso que ofrece algo sin decir cómo hacerlo es peor que ninguno.
  await expect(caja.locator("a")).toHaveAttribute("href", "cuenta.html");
  await expect(page.locator("#btnAhoraNo")).toBeVisible();
});

test("NO se ofrece a quien ya los tiene", async ({ page }) => {
  await abrir(page, CON_DOS_PASOS);
  // Se espera un rato: el aviso se destapa después de una llamada asíncrona, y
  // comprobar al instante pasaría aunque estuviera por aparecer.
  await page.waitForTimeout(1500);
  await expect(
    page.locator("#ofertaDosPasos"),
    "le ofrece activar algo que ya tiene activo",
  ).toBeHidden();
});

test("si no se puede averiguar, se calla", async ({ page }) => {
  await abrir(page, NO_SE_SABE);
  await page.waitForTimeout(1500);
  await expect(
    page.locator("#ofertaDosPasos"),
    "ante la duda lo muestra: puede estar ofreciéndoselo a quien ya lo tiene",
  ).toBeHidden();
});

test("«ahora no» lo calla, y sigue callado al recargar", async ({ page }) => {
  await abrir(page, SIN_DOS_PASOS);
  await expect(page.locator("#ofertaDosPasos")).toBeVisible({ timeout: 10_000 });

  await page.locator("#btnAhoraNo").click();
  await expect(page.locator("#ofertaDosPasos")).toBeHidden();

  // Y la parte que importa: que no vuelva en la carga siguiente. Un aviso que
  // reaparece después de decirle que no deja de ser una sugerencia.
  await abrir(page, SIN_DOS_PASOS);
  await page.waitForTimeout(1500);
  await expect(
    page.locator("#ofertaDosPasos"),
    "vuelve a aparecer después de haberlo pospuesto",
  ).toBeHidden();
});

test("pasada la semana, vuelve a ofrecerse", async ({ page }) => {
  // El "ahora no" pospone, no cancela para siempre: quien tiene Leyendas
  // guardadas y lo pospuso en enero merece que se lo vuelvan a ofrecer.
  await abrir(page, SIN_DOS_PASOS);
  await page.evaluate(() => {
    const hace8dias = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem("ofertaDosPasosPospuesta", String(hace8dias));
  });

  await abrir(page, SIN_DOS_PASOS);
  await expect(page.locator("#ofertaDosPasos")).toBeVisible({ timeout: 10_000 });
});

test("no desborda en un teléfono", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await abrir(page, SIN_DOS_PASOS);
  await expect(page.locator("#ofertaDosPasos")).toBeVisible({ timeout: 10_000 });

  const m = await page.locator("#ofertaDosPasos").evaluate((el) => ({
    seSale: Math.round(el.getBoundingClientRect().right - document.documentElement.clientWidth),
    pagina: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(m.seSale, `el aviso se pasa ${m.seSale}px del ancho`).toBeLessThanOrEqual(0);
  expect(m.pagina, "el panel desborda a lo ancho").toBeLessThanOrEqual(0);
});
