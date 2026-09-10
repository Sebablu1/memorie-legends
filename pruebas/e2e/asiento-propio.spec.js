/**
 * Uno siempre se sienta abajo, y los dos modos reparten la misma información.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL ASIENTO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `asientosParaMesa` devuelve los lugares en orden de juego empezando por
 * abajo, y la mesa los asignaba por índice de jugador. En entrenamiento eso
 * andaba de casualidad —ahí uno es siempre el jugador 0— pero en una partida
 * por Leyendas el asiento lo reparte el servidor, y al tercero en entrar le
 * tocaba `arriba`: jugaba mirando sus propias cartas del otro lado de la mesa.
 *
 * Y no era sólo raro: el asiento de abajo dibuja las cartas casi al doble de
 * tamaño, porque son las que uno toca contra reloj. El que caía arriba jugaba
 * la partida entera con las cartas más chicas de la pantalla.
 *
 * Se prueba con las cuatro posiciones posibles, no con una: el error no está
 * en un asiento concreto, está en usar el índice absoluto.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CÓMO SE SIMULA UNA PARTIDA POR LEYENDAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Sustituyendo `partida-red.js`, que es la costura por donde `mesa.js` habla
 * con el servidor. Se le da una vista fija con `yo` en el asiento que se
 * quiera. No hace falta Firestore ni cuatro sesiones: lo que se mide es cómo
 * la mesa DIBUJA una vista, y eso es una función de la vista.
 */

import { test, expect } from "@playwright/test";

/** Una vista como la que publica el servidor, con `yo` donde se pida. */
const vistaFalsa = (yo) => `
  const CUATRO = ["ana", "beto", "caro", "dani"];
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

  // Lo que falta del módulo real, para que el doble no le deba ningún
  // export: pruebas/dobles-de-partida.mjs compara las dos listas.
  //
  // Un undefined acá revienta a mitad de arrancarModoLeyendas y deja la mesa
  // sin latido, con todas las pruebas en verde. Y ojo con las comillas
  // invertidas: este doble ES un template literal, así que una sola en un
  // comentario lo cierra y el archivo entero deja de parsear.
  export const MS_ENTRE_GOLPES = 900;
  export const MS_ENTRE_LATIDOS = 5000;

  // Esta partida no gana ninguna insignia: el doble no llama al callback.
  // Que exista alcanza, que es de lo que se trata.
  export const escucharMisLogros = () => () => {};

  export function escucharMiVista(codigo, uid, alRecibir) {
    alRecibir({
      version: 1,
      fase: "turno",
      ronda: 1,
      yo: ${yo},
      indiceMano: 0,
      indiceTurno: ${yo},
      turnosRonda: 0,
      indiceCortador: null,
      desempate: false,
      registro: [],
      cartasEnMazo: 20,
      cartasEnDescarte: 1,
      muestra: { id: "m", palo: "Copa", numero: 7, imagen: "/assets/Copa/7.png", visible: true },
      levantada: null,
      poderPendiente: null,
      puedeAtacar: [],
      plazo: null,
      jugadores: CUATRO.map((id, i) => ({
        id,
        nombre: id,
        retrato: null,
        puntos: i * 10,
        puntosRonda: 0,
        eliminado: false,
        eliminadoEnRonda: null,
        cartasEnMano: 4,
        mano: [tapada, tapada, tapada, tapada],
      })),
    });
    return () => {};
  }
`;

/**
 * Los tres módulos que hay que sustituir además del motor en red.
 *
 * Entrar a una mesa por Leyendas no es sólo tener sesión: `entrarDesdeSala`
 * comprueba el código, pide la sesión por `sesion.js` y LEE el documento de la
 * sala para confirmar que uno esté en ella y que la partida haya empezado. Sin
 * esos tres de mentira, la mesa manda al login antes de dibujar nada.
 */
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

const FIREBASE_FALSO = `
  export const db = {};
  export const doc = (...a) => a;
  export const collection = (...a) => a;
  export const query = (...a) => a;
  export const orderBy = () => null;
  export const where = () => null;
  export const onSnapshot = () => () => {};
  export const getDocs = async () => ({ docs: [] });
  export const getDoc = async () => ({
    exists: () => true,
    data: () => ({
      codigo: "ABCDEF",
      estado: "jugando",
      entrada: 10,
      jugadores: ["ana", "beto", "caro", "dani"],
      jugadoresNombres: ["ana", "beto", "caro", "dani"],
      maxJugadores: 4,
    }),
  });
  export const funciones = {};
  export const httpsCallable = () => async () => ({ data: {} });
  export const auth = { currentUser: { uid: "ana" } };
  export const SUPPORT_EMAIL = "soporte@memorie-legends.com";
`;

async function abrirEnRed(page, yo, { fase = "turno" } = {}) {
  const js = (body) => ({ status: 200, contentType: "text/javascript; charset=utf-8", body });

  await page.route("**/js/guardia-sesion.js", (r) =>
    r.fulfill(js(`export async function exigirSesionEnMesa(){
      return { uid: "ana", email: "a@b.c" };
    }`)));
  await page.route("**/js/sesion.js", (r) => r.fulfill(js(SESION_FALSA)));
  await page.route("**/js/firebase.js", (r) => r.fulfill(js(FIREBASE_FALSO)));
  await page.route("**/js/partida-red.js", (r) =>
    r.fulfill(js(vistaFalsa(yo).replace('fase: "turno"', `fase: "${fase}"`))));

  await page.goto("/mesa.html?sala=ABCDEF");
  await page.waitForSelector(".jugador[data-jugador]", { timeout: 15_000 });
}

/** En qué asiento del paño quedó dibujado cada jugador. */
const asientos = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll(".jugador[data-jugador]")].map((j) => [
        j.dataset.jugador,
        j.closest(".asiento")?.id ?? "?",
      ]),
    ),
  );

// =====================================================================

for (const yo of [0, 1, 2, 3]) {
  test(`en red, el jugador ${yo} se dibuja abajo`, async ({ page }) => {
    await abrirEnRed(page, yo);

    const donde = await asientos(page);
    expect(donde[String(yo)], `el jugador ${yo} quedó en ${donde[String(yo)]}`).toBe("asientoAbajo");

    // Y nadie más está abajo: el asiento propio es uno solo.
    const abajo = Object.values(donde).filter((a) => a === "asientoAbajo");
    expect(abajo.length, "hay más de un jugador en el asiento de abajo").toBe(1);

    // Los cuatro repartidos en cuatro lugares distintos.
    expect(new Set(Object.values(donde)).size, "dos jugadores comparten asiento").toBe(4);
  });
}

test("el que está abajo es el que lleva la clase propio y las cartas grandes", async ({
  page,
}) => {
  // `propio` es lo que hace que las cartas se dibujen al doble. Si el asiento
  // rota pero la clase no, el jugador se ve abajo con las cartas de rival.
  await abrirEnRed(page, 2);

  const propio = page.locator(".jugador.propio");
  await expect(propio).toHaveCount(1);
  await expect(propio).toHaveAttribute("data-jugador", "2");

  const medidas = await page.evaluate(() => {
    const mia = document.querySelector('.jugador[data-jugador="2"] .carta');
    const ajena = document.querySelector('.jugador:not(.propio) .carta');
    return {
      mia: mia.getBoundingClientRect().height,
      ajena: ajena.getBoundingClientRect().height,
    };
  });

  expect(
    medidas.mia,
    `mis cartas miden ${Math.round(medidas.mia)}px y las ajenas ${Math.round(medidas.ajena)}px`,
  ).toBeGreaterThan(medidas.ajena);
});

test("en entrenamiento nada cambió: uno sigue siendo el 0 y va abajo", async ({ page }) => {
  // La rotación es `(i - YO)`, y en entrenamiento YO es 0: tiene que dar
  // exactamente el reparto de siempre.
  await page.route("**/js/guardia-sesion.js", (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/javascript; charset=utf-8",
      body: `export async function exigirSesionEnMesa(){ return { uid: "u", email: "a@b.c" }; }`,
    }));

  await page.goto("/mesa.html?semilla=4242");
  await page.waitForSelector('.jugador[data-jugador]');

  const donde = await asientos(page);
  expect(donde["0"]).toBe("asientoAbajo");
  expect(donde["1"]).toBe("asientoIzq");
  expect(donde["2"]).toBe("asientoArriba");
  expect(donde["3"]).toBe("asientoDer");
});

// =====================================================================
// La muestra, tapada mientras se mira, en los dos modos
// =====================================================================

test("durante la mirada, la muestra está tapada también en red", async ({ page }) => {
  // Estaba tapada sólo en entrenamiento. El que jugaba por Leyendas veía dos
  // segundos antes con qué carta iba a tener que comparar, mientras todavía
  // estaba memorizando la suya. Dos modos que comparten motor no pueden
  // repartir información distinta.
  await abrirEnRed(page, 0, { fase: "mirar" });
  await page.waitForSelector("#muestraCarta .carta");

  const destapada = await page
    .locator("#muestraCarta .carta")
    .evaluate((c) => c.classList.contains("visible"));

  expect(destapada, "la muestra se ve durante la mirada").toBe(false);
});
