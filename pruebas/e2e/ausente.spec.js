/**
 * La marca de ausente y «he vuelto», dibujadas en la mesa.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA REGLA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Si alguien se queda ausente, se lo marca y la ronda SIGUE. Cuando vuelve,
 * aprieta «he vuelto» y se reincorpora a la mano en curso. La señal es dejar
 * vencer los veinte segundos de cortar o pasar sin tocar nada.
 *
 * `pruebas/ausente-por-tiempo.mjs` prueba el servidor: que marca, que un
 * latido no borra la marca, que saltea sin esperar, y que «he vuelto» saca. Lo
 * que no puede ver es si el jugador SE ENTERA — ni los otros tres, ni él.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DOS LISTAS, UNA SOLA MARCA, UN SOLO BOTÓN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * En red hay dos listas —`ausentes` por silencio y `ausentesPorTiempo` por la
 * señal— y para los otros tres significan lo mismo: el asiento se apaga en las
 * dos. Pero «he vuelto» sale sólo por la segunda. Los casos de red de abajo
 * prueban esa diferencia de a una.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Y SIN COMILLAS INVERTIDAS DENTRO DE `partidaFalsa`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Es un template literal. Una suelta adentro —aunque sea en un comentario— lo
 * cierra antes de tiempo y Playwright informa «No tests found», no un error
 * de sintaxis. Ya pasó cinco veces en este proyecto.
 */

import { test, expect } from "@playwright/test";
import { MS_PASO_AUTOMATICO } from "../../public/js/reglas/motor.js";
import {
  abrirMesa as abrirEntrenamiento,
  elegirCartaParaMirar,
  esperarMiTurno,
  llegarADecidirCorte,
  tirarLaLevantada,
  SEL,
} from "./mesa.js";

const js = (body) => ({ status: 200, contentType: "text/javascript; charset=utf-8", body });

const SESION_FALSA = `
  export const COLECCION = "users";
  export const CAMPO_SALDO = "credits";
  export async function exigirSesion() {
    return {
      usuario: { uid: "ana", email: "a@b.c", photoURL: null },
      perfil: { uid: "ana", nombre: "Ana", saldo: 500 },
    };
  }
  export function mostrarSaldo() {}
  export function conectarBotonSalir() {}
  export function formatearEspera() { return "listo"; }
`;

const firebaseFalso = `
  const SALA = {
    codigo: "ABCDEF",
    estado: "jugando",
    entrada: 50,
    jugadores: ["ana", "beto", "caro", "dani"],
    jugadoresNombres: ["Ana", "Beto", "Caro", "Dani"],
    maxJugadores: 4,
  };
  export const db = {};
  export const doc = (...a) => a;
  export const collection = (...a) => a;
  export const query = (...a) => a;
  export const orderBy = () => null;
  export const where = () => null;
  export const getDocs = async () => ({ docs: [] });
  export const getDoc = async () => ({ exists: () => true, data: () => SALA });
  export const onSnapshot = (ref, alRecibir) => {
    alRecibir({ exists: () => true, data: () => SALA });
    return () => {};
  };
  export const funciones = {};
  export const httpsCallable = () => async () => ({ data: {} });
  export const auth = { currentUser: { uid: "ana" } };
  export const SUPPORT_EMAIL = "soporte@memorie-legends.com";
`;

/**
 * La partida, con las dos listas bajo control de la prueba.
 *
 * Los `id` van en minúscula y coinciden con los uid: así es en producción, y
 * la mesa los compara contra las listas para saber a quién apagar. `volver`
 * cuenta cuántas veces lo llamaron, para comprobar que el botón lo pide.
 */
const partidaFalsa = `
  const tapada = { oculta: true };
  const CASO = window.__caso ?? {};
  const IDS = ["ana", "beto", "caro", "dani"];
  window.__volver = 0;

  export const ahoraDelServidor = () => Date.now();
  export const relojActual = () => ({ desfase: 0, incertidumbre: 10 });
  export const sincronizarReloj = async () => {};
  export const mantenerVivo = () => () => {};
  export const mantenerEnMarcha = () => () => {};
  export const nuevoIdDeAccion = () => "a1";
  export const saltarAusente = async () => {};
  export const volver = async () => { window.__volver += 1; return { yaEstaba: false }; };
  export const calentarDescarte = async () => true;
  export const latir = async () => {};
  export const accion = async () => {};
  export const mirar = async () => {};
  export const levantar = async () => {};
  export const tirarCarta = async () => {};
  export const cortar = async () => {};
  export const pasarTurno = async () => {};
  export const cambiarCarta = async () => {};
  export const resolverCambio = async () => {};
  export const saltarPoder = async () => {};
  export const intentarDescarte = async () => {};
  export const abrirVentanaDescarte = async () => {};
  export const cerrarVentanaDescarte = async () => {};
  export const cerrarMirada = async () => {};
  export const avanzarPartida = async () => {};
  export const MS_ENTRE_GOLPES = 900;
  export const MS_ENTRE_LATIDOS = 5000;
  export const escucharMisLogros = () => () => {};

  export function escucharMiVista(codigo, uid, alRecibir) {
    alRecibir({
      version: 3, fase: "turno", ronda: 1, yo: 0, indiceMano: 0,
      indiceTurno: CASO.enTurno ?? 2,
      turnosRonda: 0, indiceCortador: null, desempate: false, registro: [],
      cartasEnMazo: 20, cartasEnDescarte: 1, muestra: null, levantada: null,
      poderPendiente: null, puedeAtacar: [], puntosDeMano: null, plazo: null,
      ausentes: CASO.ausentes ?? [],
      ausentesPorTiempo: CASO.ausentesPorTiempo ?? [],
      jugadores: ["Ana", "Beto", "Caro", "Dani"].map((nombre, i) => ({
        id: IDS[i], nombre,
        retrato: null, dorso: null, insignia: null, marco: null, titulo: null,
        puntos: 0, puntosRonda: 0,
        eliminado: false, eliminadoEnRonda: null,
        cartasEnMano: 4, mano: [tapada, tapada, tapada, tapada],
      })),
    });
    return () => {};
  }
`;

async function abrirRed(page, caso = {}) {
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));

  await page.addInitScript((c) => {
    window.__caso = c;
  }, caso);

  await page.route("**/js/guardia-sesion.js", (r) =>
    r.fulfill(js(`export async function exigirSesionEnMesa(){
      return { uid: "ana", email: "a@b.c" };
    }`)));
  await page.route("**/js/sesion.js", (r) => r.fulfill(js(SESION_FALSA)));
  await page.route("**/js/firebase.js", (r) => r.fulfill(js(firebaseFalso)));
  await page.route("**/js/partida-red.js", (r) => r.fulfill(js(partidaFalsa)));

  await page.goto("/mesa.html?sala=ABCDEF");
  await page.waitForSelector(".jugador .retrato");
  return errores;
}

const asiento = (page, i) => page.locator(`.jugador[data-jugador="${i}"]`);
const heVuelto = (page) => page.locator("#btnHeVuelto");
const jugadas = (page) => [SEL.levantar, SEL.tirar, SEL.cortar, SEL.pasar].map((s) => page.locator(s));

// ================================================================== red

test.describe("en red", () => {
  test("un rival ausente por tiempo se ve apagado, con la palabra", async ({ page }) => {
    const errores = await abrirRed(page, { ausentesPorTiempo: ["beto"] });

    await expect(asiento(page, 1)).toHaveClass(/\bausente\b/);
    await expect(asiento(page, 1).locator(".marca-ausente")).toHaveText("ausente");

    // Y sólo él.
    await expect(asiento(page, 2)).not.toHaveClass(/\bausente\b/);
    await expect(page.locator(".jugador.ausente")).toHaveCount(1);

    expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
  });

  test("un rival ausente por SILENCIO también se apaga", async ({ page }) => {
    /**
     * `vista.ausentes` existía desde antes y no se dibujaba en ningún lado. Para
     * los otros tres las dos causas significan lo mismo: ése no está.
     */
    await abrirRed(page, { ausentes: ["caro"] });

    await expect(asiento(page, 2)).toHaveClass(/\bausente\b/);
    await expect(asiento(page, 2).locator(".marca-ausente")).toBeVisible();
  });

  test("con un rival ausente, yo NO tengo «he vuelto»", async ({ page }) => {
    // El botón es de quien está marcado, no de la mesa.
    await abrirRed(page, { ausentesPorTiempo: ["beto"] });

    await expect(heVuelto(page)).toBeHidden();
    for (const boton of jugadas(page)) await expect(boton).toBeVisible();
  });

  test("marcado yo: «he vuelto» reemplaza a los cuatro botones", async ({ page }) => {
    await abrirRed(page, { ausentesPorTiempo: ["ana"] });

    await expect(heVuelto(page)).toBeVisible();
    await expect(heVuelto(page)).toContainText("He vuelto");
    for (const boton of jugadas(page)) await expect(boton).toBeHidden();

    // Y mi asiento también, que los otros lo ven así.
    await expect(asiento(page, 0)).toHaveClass(/\bausente\b/);
  });

  test("y apretarlo lo pide al servidor", async ({ page }) => {
    /**
     * No se saca la marca acá: la decide el servidor, que toma el uid de la
     * sesión. La mesa sólo pide, y la marca se va cuando llega la vista nueva.
     */
    await abrirRed(page, { ausentesPorTiempo: ["ana"] });
    await heVuelto(page).click();

    await expect.poll(() => page.evaluate(() => window.__volver)).toBe(1);
  });

  test("en la lista por silencio, a mí no me sale el botón", async ({ page }) => {
    /**
     * No pasa en la práctica —`latir` excluye a quien llama, y quien ve la
     * pantalla está latiendo— pero documenta la regla: el botón sale SÓLO por
     * la lista de ausentes por tiempo. La otra se vacía sola al volver a latir,
     * y un botón ahí sería uno que no hace nada.
     */
    await abrirRed(page, { ausentes: ["ana"] });

    await expect(heVuelto(page)).toBeHidden();
  });

  test("sin nadie ausente, la mesa se ve como siempre", async ({ page }) => {
    await abrirRed(page, {});

    await expect(page.locator(".jugador.ausente")).toHaveCount(0);
    await expect(page.locator(".marca-ausente")).toHaveCount(0);
    await expect(heVuelto(page)).toBeHidden();
    for (const boton of jugadas(page)) await expect(boton).toBeVisible();
  });
});

// ======================================================= entrenamiento

test.describe("en entrenamiento", () => {
  /**
   * Esto espera los veinte segundos de verdad. No hay forma honesta de
   * acortarlo: lo que se prueba es justamente que vencer ESE plazo marca.
   */
  test.setTimeout(120_000);

  test("dejar vencer la decisión de cortar marca, y «he vuelto» saca", async ({ page }) => {
    const errores = await abrirEntrenamiento(page);
    await elegirCartaParaMirar(page);
    await esperarMiTurno(page);
    await page.locator(SEL.levantar).click();
    await tirarLaLevantada(page);

    const listo = await llegarADecidirCorte(page);
    expect(listo, "no se llegó a poder cortar").toBe(true);

    // Antes de vencer, nada.
    await expect(asiento(page, 0)).not.toHaveClass(/\bausente\b/);
    await expect(heVuelto(page)).toBeHidden();

    // Sin tocar nada, hasta que venza. Se espera a la marca y no a un reloj
    // propio: el que manda es el de la mesa.
    await expect(asiento(page, 0)).toHaveClass(/\bausente\b/, {
      timeout: MS_PASO_AUTOMATICO + 10_000,
    });
    await expect(page.locator(SEL.pista)).toContainText(/ausente/i);
    await expect(heVuelto(page)).toBeVisible();
    for (const boton of jugadas(page)) await expect(boton).toBeHidden();

    await heVuelto(page).click();

    await expect(asiento(page, 0)).not.toHaveClass(/\bausente\b/);
    await expect(heVuelto(page)).toBeHidden();
    for (const boton of jugadas(page)) await expect(boton).toBeVisible();

    expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
  });

  test("mientras está ausente, la mesa no le pide que levante", async ({ page }) => {
    /**
     * «Los demás no pierden tiempo esperando.» Si el ciclo de turnos se
     * detuviera en el turno propio, la pista diría LEVANTAR y la mesa quedaría
     * parada ocho segundos por alguien que no está.
     *
     * ───────────────────────────────────────────────────────────────────
     * LA PRIMERA VERSIÓN DE ESTA PRUEBA NO PROBABA NADA
     * ───────────────────────────────────────────────────────────────────
     *
     * Miraba la pista quince segundos y pedía que LEVANTAR no apareciera.
     * Con el salto QUITADO a propósito —la mesa esperando al ausente— pasaba
     * igual: en quince segundos las tres IA no alcanzaban a devolverle el
     * turno, así que no había nada que ver, y "no vi LEVANTAR" era verdad por
     * no haber mirado el momento que importaba.
     *
     * Ahora espera un ancla. `saltarTurno` deja «Vos no levantó a tiempo» en
     * el registro en los DOS casos: al instante si el salto está, a los ocho
     * segundos si no. Que la línea aparezca prueba que el turno pasó por acá;
     * que LEVANTAR no haya aparecido antes prueba que no se lo esperó. Y si el
     * ancla no llega, la prueba FALLA — no pasa por no haber visto nada.
     *
     * Se observa desde adentro de la página: la pista cambia muchas veces por
     * segundo y un `expect` que cruce el puente se perdería la mitad.
     */
    test.setTimeout(240_000);

    await abrirEntrenamiento(page);
    await elegirCartaParaMirar(page);
    await esperarMiTurno(page);
    await page.locator(SEL.levantar).click();
    await tirarLaLevantada(page);
    await llegarADecidirCorte(page);

    await expect(asiento(page, 0)).toHaveClass(/\bausente\b/, {
      timeout: MS_PASO_AUTOMATICO + 10_000,
    });

    const { pasoPorMi, pedidos } = await page.evaluate(async () => {
      const pista = document.querySelector("#pista");
      const registro = document.querySelector("#registro");
      const SALTEO = /Vos no levantó a tiempo/g;
      const salteos = () => (registro.textContent.match(SALTEO) ?? []).length;

      const inicial = salteos();
      const pedidos = [];
      const observador = new MutationObserver(() => {
        if (/^\s*LEVANTAR\s*$/i.test(pista.textContent)) pedidos.push(pista.textContent);
      });
      observador.observe(pista, { childList: true, characterData: true, subtree: true });

      // Hasta noventa segundos: si la ronda se corta antes de volver a mí, hay
      // que atravesar el fin de ronda —que con el jugador ausente avanza solo
      // a los seis—, el reparto y la mirada.
      const limite = Date.now() + 90_000;
      while (salteos() <= inicial && Date.now() < limite) {
        await new Promise((r) => setTimeout(r, 100));
      }
      observador.disconnect();
      return { pasoPorMi: salteos() > inicial, pedidos };
    });

    expect(pasoPorMi, "el turno nunca volvió a pasar por el ausente: la prueba no probó nada")
      .toBe(true);
    expect(pedidos, "la mesa se detuvo a esperar a un ausente").toEqual([]);
  });
});
