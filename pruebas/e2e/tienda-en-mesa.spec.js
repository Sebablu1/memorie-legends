/**
 * Lo que se compra en la tienda, puesto en la mesa.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO SE PRUEBA EN EL NAVEGADOR Y NO EN NODE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque la forma en que esto se rompe es que la ruta llegue bien a todos
 * lados y no termine en ningún `src`. Las pruebas de Node siguen el dato hasta
 * la vista y hasta la línea de `mesa.js` que lo pide; lo que no pueden ver es
 * el `<img>` pintado, que es lo único que el jugador compró.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SON CUATRO ARTÍCULOS DISTINTOS Y NO UNO
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   · el AVATAR   — la cara del medallón
 *   · el DORSO    — el reverso de las cartas de la mano
 *   · el MAZO     — el reverso de la pila del centro, que no es de nadie
 *   · el PAÑO     — el fondo de la mesa
 *
 * El dorso y el mazo son los que se confunden, porque los dos son el reverso
 * de una carta. Pero de dorsos hay DOS alternados a propósito —para distinguir
 * de quién es cada juego— y el mazo se mira la partida entera sin ser de
 * nadie. Son dos campos del perfil, dos categorías de la tienda y dos compras;
 * si equipar uno cambiara el otro, el jugador pagaría dos veces por lo mismo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Y EN RED, LO QUE COMPRÓ CADA UNO LO VEN LOS CUATRO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Que es la mitad que importa. Un dorso que se ve sólo en la pantalla del que
 * lo compró es exactamente lo contrario de comprarse algo para que se vea.
 */

import { test, expect } from "@playwright/test";
import { dorsoDeAsiento } from "../../public/js/reglas/baraja.js";

const js = (body) => ({ status: 200, contentType: "text/javascript; charset=utf-8", body });

/** Cuatro artículos que existen de verdad, y los cuatro distintos entre sí. */
const COMPRADO = {
  retrato: "/img/avatar/el_dragon.webp",
  dorso: "/img/dorsos/dorso-rojo.png",
  mazo: "/img/mazos/esmeralda.svg",
  pano: "/img/mesa/panos/madera.svg",
};

/**
 * Abre la mesa de entrenamiento con un perfil que compró las cuatro cosas.
 *
 * Se sustituye `guardia-sesion.js` entero, que es de donde `mesa.js` saca lo
 * equipado. Es el mismo módulo que sustituyen las otras pruebas de mesa; la
 * diferencia es que las otras devuelven sólo la sesión —y ahí `equipadoEnMesa`
 * no existe, `?.()` da `undefined` y la mesa se dibuja con lo de la casa—.
 */
async function abrirVestida(page, equipo = COMPRADO) {
  await page.route("**/js/guardia-sesion.js", (r) =>
    r.fulfill(js(`
      export async function exigirSesionEnMesa() {
        return { uid: "jugador-de-prueba", email: "prueba@example.com" };
      }
      export async function equipadoEnMesa() {
        return ${JSON.stringify(equipo)};
      }
    `)));

  await page.goto("/mesa.html?semilla=4242");
  await page.waitForSelector(".jugador.propio .carta");
}

/** Los `src` de los reversos de una mano, sin repetidos y ya resueltos. */
const dorsosDe = (page, sel) =>
  page.$$eval(`${sel} .carta .dorso img`, (imgs) => [
    ...new Set(imgs.map((i) => new URL(i.getAttribute("src"), location.href).pathname)),
  ]);

// =====================================================================
// Entrenamiento: las cuatro compras, en su lugar
// =====================================================================

test("mis cartas llevan mi dorso y el mazo del centro lleva el suyo", async ({ page }) => {
  await abrirVestida(page);

  const mios = await dorsosDe(page, ".jugador.propio");
  expect(mios, `mi mano usa ${mios.join(", ")}`).toEqual([COMPRADO.dorso]);

  const mazo = await page.getAttribute("#mazoCarta .carta .dorso img", "src");
  expect(mazo, "la pila del centro no usa el mazo comprado").toBe(COMPRADO.mazo);

  // Lo que no puede pasar: que sean el mismo. Son dos compras.
  expect(mazo).not.toBe(mios[0]);
});

test("el dorso comprado cambia mi asiento y ningún otro", async ({ page }) => {
  // Los rivales siguen con los dos dorsos alternados de la casa.
  //
  // No se afirma que ninguno coincida con el mío: los dos únicos dorsos que se
  // venden SON los dos de la casa, así que comprar el rojo garantiza que dos
  // rivales lo lleven también. Lo que se afirma es lo que de verdad sostiene
  // la regla —la excepción alcanza a un solo asiento— y para eso se compara
  // contra `dorsoDeAsiento`, que es la misma función que usa el juego. Escribir
  // acá los nombres de archivo probaría la mesa contra una lista inventada.
  await abrirVestida(page);

  const ajenos = await dorsosDe(page, ".jugador:not(.propio)");
  expect(ajenos.length, "los rivales no tienen dorso dibujado").toBeGreaterThan(0);

  for (const i of [1, 2, 3]) {
    const suyo = await dorsosDe(page, `.jugador[data-jugador="${i}"]`);
    expect(suyo, `el rival ${i} no lleva el dorso de su asiento`).toEqual([dorsoDeAsiento(i)]);
  }

  // Y el mío NO es el que me tocaría por asiento: si lo fuera, esta prueba
  // pasaría con la compra desconectada.
  const mios = await dorsosDe(page, ".jugador.propio");
  expect(mios).toEqual([COMPRADO.dorso]);
  expect(mios[0], "el dorso comprado coincide con el del asiento").not.toBe(dorsoDeAsiento(0));
});

test("el paño comprado se enciende sin repintar la mesa", async ({ page }) => {
  await abrirVestida(page);

  const pano = await page.evaluate(() =>
    getComputedStyle(document.querySelector(".mesa")).getPropertyValue("--pano"));
  expect(pano, "el paño comprado no llegó a la variable").toContain(COMPRADO.pano);
});

test("sin nada comprado, la mesa se ve exactamente como siempre", async ({ page }) => {
  // La red de seguridad de todo esto: el que no compró nada no tiene que notar
  // que la tienda existe.
  await abrirVestida(page, {});

  const mazo = await page.getAttribute("#mazoCarta .carta .dorso img", "src");
  expect(mazo, "sin mazo comprado la pila del centro cambió de dorso").toBe(
    "/img/dorsos/dorso-azul.png",
  );

  const pano = await page.evaluate(() =>
    getComputedStyle(document.querySelector(".mesa")).getPropertyValue("--pano").trim());
  expect(pano === "" || pano === "none", `--pano quedó en "${pano}"`).toBe(true);
});

// =====================================================================
// Red: lo de cada uno lo ven los cuatro
// =====================================================================

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

/**
 * Lo que lleva puesto cada uno de los cuatro, tal como viaja en la vista.
 *
 * Dos con dorso y dos sin él, dos con insignia y dos sin ella, y las parejas
 * cruzadas: el jugador 1 tiene dorso y no insignia, el 2 al revés. Con los
 * tres campos juntos en los mismos jugadores, una vista que los mezclara
 * pasaría igual.
 */
const LUCE = [
  {
    retrato: "/img/avatar/el_dragon.webp",
    dorso: "/img/dorsos/dorso-rojo.png",
    insignia: "/img/insignias/heroe.webp",
  },
  { retrato: null, dorso: "/img/mazos/carmesi.svg", insignia: null },
  { retrato: null, dorso: null, insignia: "/img/insignias/leyenda.webp" },
  { retrato: null, dorso: null, insignia: null },
];

const vistaConLuce = `
  const CUATRO = ["ana", "beto", "caro", "dani"];
  const LUCE = ${JSON.stringify(LUCE)};
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
      version: 1,
      fase: "turno",
      ronda: 1,
      yo: 3,
      indiceMano: 0,
      indiceTurno: 3,
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
        retrato: LUCE[i].retrato,
        dorso: LUCE[i].dorso,
        insignia: LUCE[i].insignia,
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

async function abrirEnRed(page) {
  await page.route("**/js/guardia-sesion.js", (r) =>
    r.fulfill(js(`export async function exigirSesionEnMesa(){
      return { uid: "ana", email: "a@b.c" };
    }`)));
  await page.route("**/js/sesion.js", (r) => r.fulfill(js(SESION_FALSA)));
  await page.route("**/js/firebase.js", (r) => r.fulfill(js(FIREBASE_FALSO)));
  await page.route("**/js/partida-red.js", (r) => r.fulfill(js(vistaConLuce)));

  await page.goto("/mesa.html?sala=ABCDEF");
  await page.waitForSelector(".jugador[data-jugador] .carta", { timeout: 15_000 });
}

test("en red, cada mano se dibuja con el dorso que compró su dueño", async ({ page }) => {
  await abrirEnRed(page);

  for (const [i, suyo] of LUCE.entries()) {
    if (!suyo.dorso) continue;
    const usados = await dorsosDe(page, `.jugador[data-jugador="${i}"]`);
    expect(usados, `el jugador ${i} se dibuja con ${usados.join(", ")}`).toEqual([suyo.dorso]);
  }

  // Y los que no compraron ninguno caen al de su asiento, no al del vecino.
  //
  // Se compara contra `dorsoDeAsiento` en vez de contra los dorsos ajenos: el
  // rojo que compró el jugador 0 es TAMBIÉN el que la casa le da a los asientos
  // impares, así que «no lleva el de otro» sería falso por diseño y no por un
  // error. Lo que hay que ver es que la caída sea la de siempre.
  for (const [i, suyo] of LUCE.entries()) {
    if (suyo.dorso) continue;
    const usados = await dorsosDe(page, `.jugador[data-jugador="${i}"]`);
    expect(usados, `el jugador ${i} sin compra se dibuja con ${usados.join(", ")}`).toEqual([
      dorsoDeAsiento(i),
    ]);
  }
});

test("en red, la insignia de cada uno se dibuja al lado de su nombre", async ({ page }) => {
  await abrirEnRed(page);

  const puestas = await page.$$eval(".jugador .nombre .insignia-mesa", (imgs) =>
    imgs.map((i) => ({
      jugador: i.closest(".jugador").dataset.jugador,
      src: new URL(i.getAttribute("src"), location.href).pathname,
      alt: i.getAttribute("alt"),
      alto: Math.round(i.getBoundingClientRect().height),
    })));

  expect(puestas.map((p) => p.src).sort()).toEqual([LUCE[0].insignia, LUCE[2].insignia].sort());
  expect(puestas.map((p) => p.jugador).sort()).toEqual(["0", "2"]);

  // Que tenga tamaño es la mitad que se rompe en silencio: sin la regla de CSS
  // la imagen sale del tamaño del archivo —quinientos píxeles— y tapa la mesa.
  for (const p of puestas) {
    expect(p.alto, `la insignia del jugador ${p.jugador} mide ${p.alto}px`).toBeGreaterThan(8);
    expect(p.alto, `la insignia del jugador ${p.jugador} mide ${p.alto}px`).toBeLessThan(60);
    expect(p.alt, "la insignia es un logro y tiene que anunciarse").toBeTruthy();
  }
});

test("en red, el mazo del centro no toma el dorso de nadie", async ({ page }) => {
  // La pila del centro no es de ningún jugador. Con la rotación de asientos es
  // fácil que termine tomando el dorso del que quedó abajo.
  await abrirEnRed(page);

  const mazo = await page.getAttribute("#mazoCarta .carta .dorso img", "src");
  expect(mazo).toBe("/img/dorsos/dorso-azul.png");
  for (const suyo of LUCE) {
    if (suyo.dorso) expect(mazo).not.toBe(suyo.dorso);
  }
});
