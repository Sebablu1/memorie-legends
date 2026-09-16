/**
 * El cronómetro de diez segundos, dibujado en la mesa.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE ESTA SUITE PRUEBA Y LAS DE NODE NO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `pruebas/reloj-para-decidir.mjs` prueba la tabla —qué pasa al vencer— y
 * `pruebas/reloj-en-red.mjs` prueba el reloj del servidor. Las dos juntas
 * garantizan que la carta se tira sola a los diez segundos.
 *
 * Lo que no pueden ver es si el jugador SE ENTERA. Un plazo que corre sin que
 * nadie lo vea es peor que no tenerlo: la carta desaparece de la mano sin
 * aviso, en una partida que cobró entrada.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA AFIRMACIÓN QUE MÁS IMPORTA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Que lo vean los RIVALES, no sólo quien decide.
 *
 * El reloj de `postLevantada` lleva un `estado.indiceTurno === YO` y está
 * bien: cortar o pasar es una decisión privada. Éste no lo lleva, y ésa es la
 * diferencia que hace que la mesa deje de estar muda — los otros tres ven
 * correr la cuenta sobre el asiento del que está decidiendo, en vez de esperar
 * sin saber si se fue.
 *
 * Copiar aquel guardia sería el error fácil, y no daría ningún error: el reloj
 * simplemente no aparecería para tres de los cuatro.
 */

import { test, expect } from "@playwright/test";
import { MS_PARA_DECIDIR } from "../../public/js/reglas/red.js";

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
 * La partida, con la fase y el plazo bajo control de la prueba.
 *
 * `window.__caso` lo fija la prueba antes de cargar: qué fase, quién está
 * decidiendo, y cuánto falta. `ahoraDelServidor` devuelve un valor fijo para
 * que la cuenta no dependa del reloj de la máquina que corre esto.
 */
const partidaFalsa = `
  const tapada = { oculta: true };
  const CASO = window.__caso ?? {};
  const AHORA = 1000000;

  export const ahoraDelServidor = () => AHORA;
  export const relojActual = () => ({ desfase: 0, incertidumbre: 10 });
  export const sincronizarReloj = async () => {};
  export const mantenerVivo = () => () => {};
  export const mantenerEnMarcha = () => () => {};
  export const nuevoIdDeAccion = () => "a1";
  export const saltarAusente = async () => {};
  export const volver = async () => {};
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
      version: 3,
      fase: CASO.fase ?? "turno",
      ronda: 1, yo: 0, indiceMano: 0,
      indiceTurno: CASO.decide ?? 0,
      turnosRonda: 0, indiceCortador: null, desempate: false, registro: [],
      cartasEnMazo: 20, cartasEnDescarte: 1, muestra: null,
      levantada: CASO.fase === "levantada" ? { numero: 5, palo: "corazon" } : null,
      poderPendiente: CASO.fase === "poder"
        ? { tipo: "mirarPropia", numero: 7, indiceJugador: CASO.decide ?? 0 }
        : null,
      puedeAtacar: [], puntosDeMano: null,
      plazo: CASO.plazo === null ? null : {
        // plazoFase existe para poder mandar un plazo que NO corresponde a la
        // fase, que es lo que pasa con una vista a medio actualizar. Sin
        // comillas invertidas: esto vive dentro de un template literal.
        fase: CASO.plazoFase ?? CASO.fase ?? "turno",
        marca: "t0-0",
        hasta: AHORA + (CASO.faltanMs ?? ${MS_PARA_DECIDIR}),
        que: CASO.que ?? "descartarPorTiempo",
      },
      jugadores: ["Ana", "Beto", "Caro", "Dani"].map((nombre, i) => ({
        id: nombre, nombre,
        retrato: null, dorso: null, insignia: null, marco: null, titulo: null,
        puntos: 0, puntosRonda: 0,
        eliminado: false, eliminadoEnRonda: null,
        cartasEnMano: 4, mano: [tapada, tapada, tapada, tapada],
      })),
    });
    return () => {};
  }
`;

async function abrirMesa(page, caso) {
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

const reloj = (page) => page.locator("#relojTurno");

/**
 * Que la cuenta esté corriendo y venga del plazo de diez segundos.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO SE EXIGE «10s» EXACTO, QUE ES LO QUE DECÍA ANTES
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque «10s» está en pantalla durante UN segundo: el reloj se repinta cada
 * 120 ms y a los 1000 ms ya dice «9s». La prueba tenía que ganarle esa carrera
 * desde el arranque de la página, y con la suite entera corriendo en paralelo
 * en esta máquina, a veces no llegaba.
 *
 * Falló así una vez, con la suite completa: el registro de Playwright muestra
 * que la primera lectura ya encontró «9s» y de ahí bajó hasta cero. Las tres
 * pruebas que usaban esa línea tenían la misma carrera; ésta la perdió
 * primero. No era el reloj, era el cronómetro de la prueba.
 *
 * Un rango conserva lo que importaba —que hay una cuenta, y que sale de un
 * plazo de diez segundos y no de otro—. Que el número venga del SERVIDOR y no
 * de una constante del navegador lo fija su propia prueba, más abajo, con un
 * plazo que no es de diez.
 *
 * El piso en 5 no es generoso por las dudas: por debajo de eso ya no se podría
 * distinguir un plazo de diez de uno de seis, y entonces la prueba dejaría de
 * decir de dónde salió el número.
 */
async function cuentaDeDiezSegundos(page) {
  await expect(reloj(page)).toBeVisible();

  const texto = await page.locator("#relojNumero").innerText();
  const segundos = Number.parseInt(texto, 10);

  expect(segundos, `la cuenta dice "${texto}"`).toBeGreaterThanOrEqual(5);
  expect(segundos, `la cuenta dice "${texto}"`).toBeLessThanOrEqual(10);
}

// =====================================================================

test("con una carta levantada, la cuenta se ve", async ({ page }) => {
  const errores = await abrirMesa(page, {
    fase: "levantada",
    decide: 0,
    que: "descartarPorTiempo",
  });

  await cuentaDeDiezSegundos(page);

  expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

test("LOS RIVALES también la ven, no sólo quien decide", async ({ page }) => {
  /**
   * La afirmación que justifica esta suite.
   *
   * Yo soy el asiento 0 (`yo: 0`) y el que está decidiendo es el 1. Con el
   * `=== YO` de `postLevantada` copiado acá, el reloj no aparecería — y no
   * habría ningún error: la mesa se quedaría muda para tres de los cuatro,
   * que es exactamente el problema que este cronómetro vino a resolver.
   */
  await abrirMesa(page, { fase: "levantada", decide: 1, que: "descartarPorTiempo" });

  await cuentaDeDiezSegundos(page);
});

test("con un poder pendiente también corre", async ({ page }) => {
  await abrirMesa(page, { fase: "poder", decide: 0, que: "saltarPorTiempo" });

  await cuentaDeDiezSegundos(page);
});

test("la cuenta sale del servidor, no de una constante del navegador", async ({ page }) => {
  /**
   * Si la mesa arrancara su propio reloj de diez segundos en vez de leer
   * `plazo.hasta`, este caso mostraría «10s» — y en producción el número de la
   * pantalla se separaría del plazo real en cuanto el navegador se atrasara.
   *
   * ───────────────────────────────────────────────────────────────────────
   * POR QUÉ SESENTA SEGUNDOS Y NO CUATRO
   * ───────────────────────────────────────────────────────────────────────
   *
   * Porque el reloj CORRE. La primera versión mandaba un plazo de 4 s y
   * afirmaba «4s», y pasaba sola pero fallaba en la suite completa: con cuatro
   * trabajadores la página tarda más en montar, y para cuando se evaluaba la
   * cuenta ya iba por 3s o 2s. Afirmar un instante exacto de una cuenta
   * regresiva es una carrera contra la máquina que la corre.
   *
   * Con 60 s la afirmación deja de depender del tiempo que tarde en cargar:
   * cualquier número por encima de 30 es imposible de producir con la
   * constante de 10, que es lo único que este caso quiere descartar.
   */
  await abrirMesa(page, {
    fase: "levantada",
    decide: 0,
    que: "descartarPorTiempo",
    faltanMs: 60_000,
  });

  await expect(reloj(page)).toBeVisible();

  const texto = await page.locator("#relojNumero").textContent();
  const segundos = Number.parseInt(texto, 10);

  expect(segundos, `la cuenta dice ${texto}`).toBeGreaterThan(30);
  expect(segundos, "y no puede pasar del plazo que mandó el servidor").toBeLessThanOrEqual(60);
});

test("sin plazo del servidor no se inventa ninguno", async ({ page }) => {
  // Un plazo ausente es una vista vieja o una partida sin reloj. Dibujar una
  // cuenta ahí sería apurar al jugador por algo que no va a pasar.
  await abrirMesa(page, { fase: "levantada", decide: 0, plazo: null });

  await expect(reloj(page)).toBeHidden();
});

test("un plazo de OTRA fase no enciende este reloj", async ({ page }) => {
  /**
   * El plazo trae su `fase`, y la mesa comprueba que coincida con la fase en
   * la que está. Sin esa comprobación, una vista a medio actualizar —fase
   * nueva, plazo viejo— mostraría una cuenta que no corresponde a nada, y el
   * jugador apuraría una decisión contra un reloj que no es el suyo.
   *
   * La partida está en `poder` y el plazo dice `levantada`: no coinciden, así
   * que no hay reloj que dibujar.
   */
  await abrirMesa(page, {
    fase: "poder",
    plazoFase: "levantada",
    decide: 0,
    que: "descartarPorTiempo",
  });

  await expect(reloj(page)).toBeHidden();
});
