/**
 * El final de una partida por Leyendas: ¿juegan otra, o cambian la apuesta?
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE MIDE ACÁ Y NO EN NODE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `pruebas/revancha.mjs` prueba la REGLA —quién puede pedirla y cuándo— y
 * audita que el servidor la use. Lo que no puede ver es el panel: que
 * aparezca al terminar, que el selector de apuesta se abra, y sobre todo que
 * el aviso de «ya hay revancha» llegue solo cuando la abre otro. Esa última
 * pieza es un `onSnapshot` sobre la sala, y un `onSnapshot` que no se
 * suscribe no rompe nada: deja al jugador esperando un botón que no llega.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA SALA DE MENTIRA CAMBIA A MITAD DE LA PRUEBA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `onSnapshot` acá no es un `() => {}` que no hace nada: llama a su callback
 * con la sala y guarda la función para poder volver a llamarla desde la
 * prueba. Así se simula lo que pasa de verdad cuando otro jugador toca «jugar
 * otra»: el documento cambia y los otros tres navegadores se enteran.
 */

import { test, expect } from "@playwright/test";
import { ENTRADAS } from "../../public/js/reglas/salas.js";

const js = (body) => ({ status: 200, contentType: "text/javascript; charset=utf-8", body });

const ENTRADA = 50;

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

/**
 * Firestore de mentira con una sala que se puede cambiar desde la prueba.
 *
 * `window.__sala` es el documento, y `window.__avisar()` vuelve a llamar a los
 * escuchas. Las dos viven en `window` porque la prueba y la página corren en
 * mundos distintos: `page.evaluate` es la única forma de tocar lo que el
 * módulo tiene adentro.
 */
const firebaseFalso = (entrada) => `
  // Arranca EN JUEGO, que es como está de verdad cuando llega el resultado:
  // la sala pasa a terminada unos segundos después, cuando el cierre reparte
  // el pozo. La mesa además no deja entrar a una sala terminada.
  const SALA = {
    codigo: "ABCDEF",
    estado: "jugando",
    entrada: ${entrada},
    jugadores: ["ana", "beto", "caro", "dani"],
    jugadoresNombres: ["Ana", "Beto", "Caro", "Dani"],
    maxJugadores: 4,
  };
  window.__sala = { ...SALA };
  const escuchas = [];
  window.__avisar = () => escuchas.forEach((cb) => cb({
    exists: () => true,
    data: () => window.__sala,
  }));

  export const db = {};
  export const doc = (...a) => a;
  export const collection = (...a) => a;
  export const query = (...a) => a;
  export const orderBy = () => null;
  export const where = () => null;
  export const getDocs = async () => ({ docs: [] });
  export const getDoc = async () => ({ exists: () => true, data: () => window.__sala });

  export const onSnapshot = (ref, alRecibir) => {
    escuchas.push(alRecibir);
    alRecibir({ exists: () => true, data: () => window.__sala });
    return () => {};
  };

  export const funciones = {};

  // Cada llamada al servidor queda anotada, para poder afirmar CON QUÉ se
  // llamó: la apuesta que se manda es la mitad de lo que esta pantalla decide.
  //
  // Va a sessionStorage y no a una variable del módulo porque lo último que
  // hace esta pantalla es NAVEGAR, y una variable se muere con el documento:
  // al leerla después del salto estaba siempre vacía.
  const anotar = (llamada) => {
    const previas = JSON.parse(sessionStorage.getItem("__llamadas") ?? "[]");
    previas.push(llamada);
    sessionStorage.setItem("__llamadas", JSON.stringify(previas));
  };
  // __dentro es lo que contesta el servidor sobre si el jugador ya está en la
  // sala nueva: true cuando la abrió él, false cuando la abrió otro. De eso
  // depende que la mesa llame o no a unirseASala, y se prueba en los dos
  // sentidos.
  window.__dentro = true;
  // __falla hace que el servidor conteste que no. El caso real es quedarse
  // sin Leyendas para la entrada, y el jugador tiene que enterarse de por qué.
  window.__falla = null;
  export const httpsCallable = (_f, nombre) => async (datos) => {
    anotar({ nombre, datos });
    if (nombre === "revanchaDeSala" && window.__falla) {
      const e = new Error(window.__falla);
      e.code = "functions/failed-precondition";
      throw e;
    }
    if (nombre === "revanchaDeSala") {
      return { data: { codigo: "NUEVA1", entrada: datos.entrada, dentro: window.__dentro } };
    }
    return { data: {} };
  };
  export const auth = { currentUser: { uid: "ana" } };
  export const SUPPORT_EMAIL = "soporte@memorie-legends.com";
`;

/** Una vista terminada, que es la única fase donde el panel existe. */
const vistaFinal = `
  const CUATRO = ["Ana", "Beto", "Caro", "Dani"];
  const tapada = { oculta: true };

  export const ahoraDelServidor = () => Date.now();
  export const relojActual = () => ({ desfase: 0, incertidumbre: 10 });
  export const sincronizarReloj = async () => {};
  export const mantenerVivo = () => () => {};
  export const mantenerEnMarcha = () => () => {};
  export const nuevoIdDeAccion = () => "a1";
  export const saltarAusente = async () => {};
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

  export function escucharMiVista(codigo, uid, alRecibir) {
    alRecibir({
      version: 9, fase: "finPartida", ronda: 4, yo: 0, indiceMano: 0, indiceTurno: 0,
      turnosRonda: 0, indiceCortador: 1, desempate: false, registro: [],
      cartasEnMazo: 12, cartasEnDescarte: 3, muestra: null, levantada: null,
      poderPendiente: null, puedeAtacar: [], plazo: null,
      puntosDeMano: [3, 9, 14, 21],
      jugadores: CUATRO.map((nombre, i) => ({
        id: nombre, nombre, retrato: null, dorso: null, insignia: null,
        puntos: [40, 90, 120, 160][i], puntosRonda: 0,
        eliminado: i > 0, eliminadoEnRonda: i > 0 ? 4 : null,
        cartasEnMano: 0, mano: [tapada],
      })),
    });
    return () => {};
  }
`;

async function abrirFinal(page, { entrada = ENTRADA } = {}) {
  await page.route("**/js/guardia-sesion.js", (r) =>
    r.fulfill(js(`export async function exigirSesionEnMesa(){
      return { uid: "ana", email: "a@b.c" };
    }`)));
  await page.route("**/js/sesion.js", (r) => r.fulfill(js(SESION_FALSA)));
  await page.route("**/js/firebase.js", (r) => r.fulfill(js(firebaseFalso(entrada))));
  await page.route("**/js/partida-red.js", (r) => r.fulfill(js(vistaFinal)));

  // La sala de espera se reemplaza por una página vacía. Lo que se prueba acá
  // es que la mesa mande al jugador al lugar correcto con las llamadas
  // correctas; cargar `room.js` de verdad arrancaría otra pantalla contra
  // estos mismos dobles y la llevaría a redirigir a saber dónde.
  await page.route("**/room.html*", (r) =>
    r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: "<title>sala</title>" }));

  await page.goto("/mesa.html?sala=ABCDEF");
  await page.waitForSelector("#panelRevancha");
}

/** Lo que la mesa le pidió al servidor, sobreviviendo a la navegación. */
const llamadasDe = (page) =>
  page.evaluate(() => JSON.parse(sessionStorage.getItem("__llamadas") ?? "[]"));

/** El cierre terminó de repartir: la sala pasa a terminada. */
const cerrarLaSala = (page) =>
  page.evaluate(() => {
    window.__sala = { ...window.__sala, estado: "terminada" };
    window.__avisar();
  });

// =====================================================================

test("mientras se reparte el pozo, todavía no se ofrece otra", async ({ page }) => {
  /**
   * La vista dice `finPartida` unos segundos antes de que la sala quede
   * terminada: en el medio corre el cierre, que es el que paga. Y la revancha
   * exige la sala terminada.
   *
   * Sin esta espera, el botón estaba ahí desde el primer instante y tocarlo
   * devolvía «esta partida todavía no terminó» en la cara de alguien que
   * acababa de ver el resultado.
   */
  await abrirFinal(page);

  await expect(page.locator("#panelRevancha")).toContainText(/pozo/i);
  await expect(page.locator('[data-accion="revancha-igual"]')).toHaveCount(0);
});

test("al terminar, la mesa pregunta si juegan otra", async ({ page }) => {
  await abrirFinal(page);
  await cerrarLaSala(page);

  const jugarOtra = page.locator('[data-accion="revancha-igual"]');
  await expect(jugarOtra).toBeVisible();
  // La apuesta se dice ANTES de tocar: lo que sigue cobra Leyendas.
  await expect(jugarOtra).toContainText(String(ENTRADA));
  await expect(page.locator('[data-accion="revancha-cambiar"]')).toBeVisible();
  await expect(page.locator('[data-accion="revancha-salir"]')).toBeVisible();

  // Y el resultado de la partida sigue estando: el panel se suma, no reemplaza.
  await expect(page.locator("#modal .tabla-resultado")).toBeVisible();
});

test("«cambiar apuesta» abre la lista entera de entradas", async ({ page }) => {
  await abrirFinal(page);
  await cerrarLaSala(page);
  await page.click('[data-accion="revancha-cambiar"]');

  const select = page.locator("#apuestaRevancha");
  await expect(select).toBeVisible();

  // Las de las reglas, no una lista escrita a mano en la mesa.
  const valores = await select.locator("option").evaluateAll((os) =>
    os.map((o) => Number(o.value)));
  expect(valores).toEqual(ENTRADAS);

  // Y viene con la de esta mesa elegida: jugar otra por lo mismo es un clic.
  await expect(select).toHaveValue(String(ENTRADA));
});

test("la apuesta elegida es la que viaja al servidor", async ({ page }) => {
  await abrirFinal(page);
  await cerrarLaSala(page);
  await page.click('[data-accion="revancha-cambiar"]');
  await page.selectOption("#apuestaRevancha", "200");
  await page.click('[data-accion="revancha-crear"]');

  await page.waitForURL(/room\.html\?code=NUEVA1/);
  const llamadas = await llamadasDe(page);
  const revancha = llamadas.find((l) => l.nombre === "revanchaDeSala");

  expect(revancha, "no se llamó a revanchaDeSala").toBeTruthy();
  expect(revancha.datos).toEqual({ codigo: "ABCDEF", entrada: 200 });

  // Con `dentro: true` no hace falta entrar: abrirla es entrar. Llamar igual
  // a `unirseASala` daría un «ya estás en esta sala» en la cara del jugador.
  expect(llamadas.some((l) => l.nombre === "unirseASala")).toBe(false);
});

test("si la abre otro, el panel lo avisa solo", async ({ page }) => {
  // La mitad que no se ve venir: los otros tres no tocaron nada, y el botón
  // les tiene que cambiar igual.
  await abrirFinal(page);
  await cerrarLaSala(page);
  await expect(page.locator('[data-accion="revancha-igual"]')).toBeVisible();

  await page.evaluate(() => {
    window.__sala = { ...window.__sala, revancha: { codigo: "OTRA22", entrada: 25, por: "beto" } };
    window.__avisar();
  });

  const unirme = page.locator('[data-accion="revancha-unirme"]');
  await expect(unirme).toBeVisible();

  // La apuesta la fijó quien la abrió, y es 25, no los 50 de la mesa anterior.
  // Tiene que estar EN EL BOTÓN: es lo que se va a cobrar al tocarlo, y el
  // que no la quiera pagar tiene que poder no tocarlo.
  await expect(unirme).toContainText("25");
  await expect(unirme).not.toContainText(String(ENTRADA));
  // Ya no se ofrece abrir otra: sería una segunda sala con una segunda entrada.
  await expect(page.locator('[data-accion="revancha-igual"]')).toHaveCount(0);
});

test("unirse a la revancha ajena pasa por la puerta de siempre", async ({ page }) => {
  await abrirFinal(page);
  await cerrarLaSala(page);

  // El servidor va a contestar que NO está adentro: la sala la abrió otro.
  await page.evaluate(() => {
    window.__dentro = false;
    window.__sala = { ...window.__sala, revancha: { codigo: "OTRA22", entrada: 25, por: "beto" } };
    window.__avisar();
  });

  await page.click('[data-accion="revancha-unirme"]');
  await page.waitForURL(/room\.html\?code=NUEVA1/);

  const llamadas = await llamadasDe(page);
  // Se pide con la apuesta que fijó quien la abrió, no con la de esta mesa.
  expect(llamadas.find((l) => l.nombre === "revanchaDeSala")?.datos.entrada).toBe(25);

  // Y se entra por `unirseASala`, que es la que sabe de cupo, de estado y de
  // saldo. La revancha no repite ninguna de esas tres comprobaciones.
  const unirse = llamadas.find((l) => l.nombre === "unirseASala");
  expect(unirse, "no se llamó a unirseASala").toBeTruthy();
  expect(unirse.datos).toEqual({ codigo: "NUEVA1" });
});

test("si no alcanza el saldo, se dice por qué y se puede volver a elegir", async ({ page }) => {
  /**
   * El caso más probable de todos: el que acaba de perder la partida no tiene
   * para pagar la entrada de la siguiente.
   *
   * Lo que NO puede pasar es que el botón se toque y no ocurra nada. El
   * mensaje lo redacta el servidor —«tenés X y hacen falta Y»— porque es el
   * único que sabe el saldo de verdad; acá sólo se muestra.
   */
  await abrirFinal(page);
  await cerrarLaSala(page);
  await page.evaluate(() => {
    window.__falla = "Saldo insuficiente: tenés 12 Leyendas y hacen falta 50.";
  });

  await page.click('[data-accion="revancha-igual"]');

  const panel = page.locator("#panelRevancha");
  await expect(panel).toContainText("12 Leyendas");
  await expect(panel).toContainText("50");

  // Y el panel vuelve: se puede probar con una apuesta más chica, que es
  // justamente para lo que está «cambiar apuesta».
  await expect(page.locator('[data-accion="revancha-cambiar"]')).toBeVisible();
  expect(page.url()).toContain("mesa.html");
});

test("en entrenamiento no hay revancha que ofrecer", async ({ page }) => {
  // No hay sala, no hay apuesta y no hay a quién volver a enfrentar: el botón
  // de siempre recarga la mesa. Ofrecer «cambiar la apuesta» ahí sería
  // ofrecerle apostar a alguien que entró justamente a no apostar.
  await page.route("**/js/guardia-sesion.js", (r) =>
    r.fulfill(js(`export async function exigirSesionEnMesa(){
      return { uid: "u", email: "a@b.c" };
    }`)));
  await page.goto("/mesa.html?semilla=4242");
  await page.waitForSelector(".jugador.propio .carta");

  await expect(page.locator("#panelRevancha")).toHaveCount(0);
});
