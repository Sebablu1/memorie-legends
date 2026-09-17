/**
 * Descartarle una carta a un rival, en la mesa en red.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL BUG, COMO SE VIO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * «No me deja ni intentar el descarte al rival.» En red el ataque no salía
 * nunca. Dos toques sobre la carta del rival pedían elegir una carta propia,
 * pero el toque sobre la propia lo atrapaba un bloque que se ocupa de TODOS
 * los toques propios durante el descarte —uno "mira", dos descartan—, que
 * estaba antes que la rama de la entrega. La entrega no llegaba jamás, y un
 * doble toque terminaba en un descarte propio que casi siempre fallaba.
 *
 * Y la mesa marcaba la mano entera del rival, mientras que el servidor ya
 * sólo aceptaba cartas conocidas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CÓMO SE ARMA CADA CASO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `window.__caso.secuencia` es la lista de vistas que publica el servidor,
 * cada una con cuántos milisegundos después de arrancar llega. El módulo de
 * partida es un doble que anota los pedidos en `window.__pedidos`.
 *
 * Y SIN COMILLAS INVERTIDAS DENTRO DE `partidaFalsa`: es un template literal,
 * y una suelta adentro lo cierra antes de tiempo. Playwright informa «No
 * tests found», no un error de sintaxis.
 */

import { test, expect } from "@playwright/test";

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

/** La partida: publica la secuencia del caso y anota cada pedido. */
const partidaFalsa = `
  const tapada = { oculta: true };
  const IDS = ["ana", "beto", "caro", "dani"];
  const CASO = window.__caso ?? {};
  window.__pedidos = [];
  const anotar = (nombre) => async (...args) => {
    window.__pedidos.push({ nombre, args: args.slice(1) });
    return { anotado: true };
  };

  export const ahoraDelServidor = () => Date.now();
  export const relojActual = () => ({ desfase: 0, incertidumbre: 10 });
  export const sincronizarReloj = async () => {};
  export const mantenerVivo = () => () => {};
  export const mantenerEnMarcha = () => () => {};
  export const nuevoIdDeAccion = () => "a1";
  export const saltarAusente = async () => {};
  export const volver = async () => {};
  export const calentarDescarte = async () => true;
  export const latir = async () => {};
  export const accion = anotar("accion");
  export const mirar = anotar("mirar");
  export const levantar = async () => {};
  export const tirarCarta = async () => {};
  export const cortar = async () => {};
  export const pasarTurno = async () => {};
  export const cambiarCarta = async () => {};
  export const resolverCambio = async () => {};
  export const saltarPoder = async () => {};
  export const intentarDescarte = async (codigo, ventana, posicion, tocadoEn, rival) => {
    window.__pedidos.push({ nombre: "intentarDescarte", posicion, rival: rival ?? null });
    return { anotado: true };
  };
  export const abrirVentanaDescarte = async () => {};
  export const cerrarVentanaDescarte = async () => {};
  export const cerrarMirada = async () => {};
  export const avanzarPartida = async () => {};
  export const MS_ENTRE_GOLPES = 900;
  export const MS_ENTRE_LATIDOS = 5000;
  export const escucharMisLogros = () => () => {};

  const vista = (paso, version) => ({
    version,
    fase: paso.fase ?? "descarte",
    ronda: 1,
    yo: 0, indiceMano: 0, indiceTurno: paso.indiceTurno ?? 2, turnosRonda: 1,
    indiceCortador: null, desempate: false, registro: [],
    cartasEnMazo: 20, cartasEnDescarte: 1,
    muestra: { id: "Copa-5", numero: 5, palo: "copa" },
    levantada: null, poderPendiente: null, cambioPendiente: null,
    ventana: (paso.fase ?? "descarte") === "descarte"
      ? { id: "v1", abiertaEn: Date.now() - 500, duracionMs: 5000, cerrada: false }
      : null,
    esperando: null,
    plazo: null,
    puedeAtacarEn: paso.puedeAtacarEn ?? [],
    puedeAtacar: [...new Set((paso.puedeAtacarEn ?? []).map((p) => p.objetivo))],
    revelaciones: [],
    ausentes: [], ausentesPorTiempo: [],
    jugadores: ["Ana", "Beto", "Caro", "Dani"].map((nombre, i) => ({
      id: IDS[i], nombre,
      retrato: null, dorso: null, insignia: null, marco: null, titulo: null,
      puntos: 0, puntosRonda: 0,
      eliminado: false, eliminadoEnRonda: null, posicionMirada: 0,
      cartasEnMano: 4, mano: [tapada, tapada, tapada, tapada],
    })),
  });

  export function escucharMiVista(codigo, uid, alRecibir) {
    window.__empezar = () => {
      (CASO.secuencia ?? []).forEach((paso, n) => {
        const publicar = () => alRecibir(vista(paso, n + 1));
        if (!paso.despues) publicar();
        else setTimeout(publicar, paso.despues);
      });
    };
    return () => {};
  }
`;

async function abrirRed(page, secuencia) {
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));
  await page.clock.install({ time: new Date("2026-09-17T12:00:00Z") });
  await page.addInitScript((s) => {
    window.__caso = { secuencia: s };
  }, secuencia);

  await page.route("**/js/guardia-sesion.js", (r) =>
    r.fulfill(js(`export async function exigirSesionEnMesa(){
      return { uid: "ana", email: "a@b.c" };
    }`)));
  await page.route("**/js/sesion.js", (r) => r.fulfill(js(SESION_FALSA)));
  await page.route("**/js/firebase.js", (r) => r.fulfill(js(firebaseFalso)));
  await page.route("**/js/partida-red.js", (r) => r.fulfill(js(partidaFalsa)));

  await page.goto("/mesa.html?sala=ABCDEF");
  await page.waitForFunction(() => typeof window.__empezar === "function");
  await pausar(page);
  await page.evaluate(() => window.__empezar());
  await page.waitForSelector(".jugador .retrato");
  return errores;
}

/**
 * Detiene el reloj de la página: de acá en más sólo avanza con `runFor`.
 *
 * El reloj instalado corre solo hasta que se lo pausa, y pausar en el pasado es
 * un error. Con la máquina cargada —la suite entera corriendo— entre leer la
 * hora y pausar pasaron más de los cien milisegundos de margen que había, y la
 * prueba fallaba sin que la mesa tuviera nada que ver. Ahora el margen es de un
 * segundo, y si igual se pasa, se vuelve a leer la hora y se reintenta.
 */
async function pausar(page) {
  for (let intento = 0; intento < 5; intento++) {
    const ahora = await page.evaluate(() => Date.now());
    try {
      await page.clock.pauseAt(new Date(ahora + 1000));
      return;
    } catch (error) {
      if (!/past/i.test(String(error))) throw error;
    }
  }
  throw new Error("no se pudo pausar el reloj de la página");
}

const carta = (page, jugador, pos) =>
  page.locator(`.jugador[data-jugador="${jugador}"] .carta[data-posicion="${pos}"]`);
const pista = (page) => page.locator("#pista");
const pedidos = (page) => page.evaluate(() => window.__pedidos);
const atacables = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".carta.atacable")].map(
      (c) => `${c.closest(".jugador").dataset.jugador}:${c.dataset.posicion}`,
    ),
  );

/** Ana conoce UNA carta de Beto: la de la posición 2. */
const CONOCE_UNA = [{ fase: "descarte", puedeAtacarEn: [{ objetivo: 1, posicion: 2 }] }];

test("se marca la carta conocida, y sólo ésa", async ({ page }) => {
  const errores = await abrirRed(page, CONOCE_UNA);

  await expect.poll(() => atacables(page)).toEqual(["1:2"]);
  expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

test("dos toques sobre la conocida y uno sobre una propia mandan el ataque", async ({ page }) => {
  const errores = await abrirRed(page, CONOCE_UNA);

  await carta(page, 1, 2).dblclick();
  await expect(pista(page)).toContainText(/carta tuya/i);

  await carta(page, 0, 3).click();

  await expect.poll(() => pedidos(page)).toEqual([
    { nombre: "intentarDescarte", posicion: 2, rival: { objetivo: "beto", posicionEntrega: 3 } },
  ]);
  await expect(pista(page), "el toque de la entrega se tomó como «mirar»")
    .not.toContainText(/mirando tu carta/i);
  expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

test("dos toques sobre una carta ajena que no conozco no mandan nada", async ({ page }) => {
  await abrirRed(page, CONOCE_UNA);

  await carta(page, 1, 0).dblclick();
  await expect(pista(page)).toContainText(/no la conocés/i);

  await carta(page, 2, 2).dblclick();
  await expect(pista(page)).toContainText(/no la conocés/i);

  expect(await pedidos(page), "se mandó un intento sobre una carta desconocida").toEqual([]);
  await expect(page.locator(".carta.apagada"), "y no quedó ningún ataque apuntado").toHaveCount(0);
});

test("un ataque apuntado se olvida cuando la ventana termina", async ({ page }) => {
  await abrirRed(page, [
    ...CONOCE_UNA,
    { fase: "turno", indiceTurno: 0, despues: 1000 },
  ]);

  await carta(page, 1, 2).dblclick();
  await expect(pista(page)).toContainText(/carta tuya/i);
  await expect(page.locator(".carta.apagada").first()).toBeVisible();

  await page.clock.runFor(1100);

  await expect(page.locator(".carta.apagada"), "la mesa sigue apagada fuera del descarte")
    .toHaveCount(0);
  await expect(page.locator(".carta.apuntada")).toHaveCount(0);
});
