/**
 * El marco y el título del Pack Élite, dibujados en la mesa.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO NO PUEDE QUEDAR SÓLO EN NODE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `pruebas/retratos-en-red.mjs` prueba que los dos viajen: que salgan del
 * perfil, entren al estado de la partida y lleguen iguales a los cuatro
 * navegadores. Eso es la mitad.
 *
 * La otra mitad es que se VEAN, y es la que importa acá: alguien pagó $2.500
 * por el Pack Élite. Un marco que llega en la vista y no se dibuja es
 * exactamente el mismo problema que la insignia `comprador-elite` que se
 * escribía en un campo que nadie leía — el jugador pagó y no ve nada.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Y POR QUÉ SE MIDE EL TAMAÑO DEL RETRATO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque la forma tentadora de hacer un marco es un `border`, y un borde
 * cambia la caja: los asientos con marco medirían distinto que los otros y la
 * mesa quedaría despareja según quién compró qué. Se comprueba comparando un
 * asiento con marco contra uno sin marco, que es la única forma de que la
 * prueba falle si alguien lo cambia a `border`.
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

/**
 * Cuatro jugadores en pleno turno, con lo que luce cada uno bajo control.
 *
 * `window.__luce` lo fija la prueba antes de cargar la página. El asiento 0
 * lleva marco y título; el 1 no lleva nada, y es contra él que se mide.
 */
const partidaFalsa = `
  const tapada = { oculta: true };
  const LUCE = window.__luce ?? [];

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
  export const MS_ENTRE_GOLPES = 900;
  export const MS_ENTRE_LATIDOS = 5000;
  export const escucharMisLogros = () => () => {};

  export function escucharMiVista(codigo, uid, alRecibir) {
    alRecibir({
      version: 3, fase: "turno", ronda: 1, yo: 0, indiceMano: 0, indiceTurno: 0,
      turnosRonda: 0, indiceCortador: null, desempate: false, registro: [],
      cartasEnMazo: 20, cartasEnDescarte: 1, muestra: null, levantada: null,
      poderPendiente: null, puedeAtacar: [], plazo: null, puntosDeMano: null,
      jugadores: ["Ana", "Beto", "Caro", "Dani"].map((nombre, i) => ({
        id: nombre, nombre,
        retrato: null, dorso: null, insignia: null,
        marco: LUCE[i]?.marco ?? null,
        titulo: LUCE[i]?.titulo ?? null,
        puntos: 0, puntosRonda: 0,
        eliminado: false, eliminadoEnRonda: null,
        cartasEnMano: 4, mano: [tapada, tapada, tapada, tapada],
      })),
    });
    return () => {};
  }
`;

const MARCO = "/img/insignias/heroe.webp"; // un archivo que existe de verdad

async function abrirMesa(page, luce) {
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));

  await page.addInitScript((l) => {
    window.__luce = l;
  }, luce);

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

// =====================================================================

test("el marco comprado se dibuja, y sólo sobre quien lo tiene", async ({ page }) => {
  const errores = await abrirMesa(page, [
    { marco: MARCO, titulo: "Élite" },
    {},
    {},
    {},
  ]);

  const marcos = page.locator(".jugador .marco-avatar");
  await expect(marcos).toHaveCount(1);
  await expect(marcos.first()).toHaveAttribute("src", MARCO);

  expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

test("el marco no cambia el tamaño del asiento", async ({ page }) => {
  /**
   * La prueba que impide que alguien lo convierta en `border`.
   *
   * Con un borde de verdad, el asiento con marco mediría distinto del que no
   * tiene, y la mesa quedaría despareja según quién compró qué.
   */
  // El marco va en un RIVAL, no en el asiento propio.
  //
  // Se comparan los asientos 1 y 2, que son los dos rivales. El asiento
  // propio se dibuja más grande a propósito —54 px contra 46— así que
  // medirlo contra un rival haría fallar la prueba por una diferencia que ya
  // existía antes del marco y que es correcta.
  await abrirMesa(page, [{}, { marco: MARCO }, {}, {}]);

  // Y por `data-jugador`, no por orden en el DOM: la mesa rota los asientos
  // para sentar abajo al jugador local, así que `.first()` puede ser
  // cualquiera. Comparar dos asientos sin marco haría pasar la prueba sin
  // probar nada.
  const conMarco = await page.locator('.jugador[data-jugador="1"] .retrato').boundingBox();
  const sinMarco = await page.locator('.jugador[data-jugador="2"] .retrato').boundingBox();

  // Que el primero tenga marco de verdad, que es de lo que se trata.
  await expect(page.locator('.jugador[data-jugador="1"] .marco-avatar')).toHaveCount(1);
  await expect(page.locator('.jugador[data-jugador="2"] .marco-avatar')).toHaveCount(0);

  expect(conMarco.width).toBeCloseTo(sinMarco.width, 0);
  expect(conMarco.height).toBeCloseTo(sinMarco.height, 0);
});

test("el marco se achica al retrato aunque el archivo sea enorme", async ({ page }) => {
  /**
   * La prueba que faltaba cuando la de arriba ya estaba en verde.
   *
   * Medir `.retrato` no alcanza: el marco va en posición absoluta, así que
   * puede pintarse del tamaño de una pantalla sin mover ni un píxel la caja
   * que la prueba anterior compara. Con `width: auto` eso es justo lo que
   * pasaba —una imagen reemplazada en absoluto no se estira hasta los `inset`,
   * se pinta al tamaño del archivo— y el asiento quedaba debajo de un escudo.
   *
   * Se vio primero en la sala de espera, que copiaba este mismo CSS. Acá la
   * mesa tenía el defecto intacto y todas las pruebas en verde.
   *
   * Se mide entonces lo que se pinta, y no lo que lo contiene.
   */
  await abrirMesa(page, [{}, { marco: MARCO }, {}, {}]);

  const marco = page.locator('.jugador[data-jugador="1"] .marco-avatar');
  await expect(marco).toHaveCount(1);

  /**
   * Se espera a que el archivo esté DESCARGADO antes de medirlo.
   *
   * `naturalWidth` vale 0 mientras la imagen no cargó, así que sin esta espera
   * la comprobación de abajo falla por una carrera y no por el CSS. Pasó en una
   * corrida completa —con dos procesos peleando el disco— mientras el archivo
   * suelto pasaba en verde: el síntoma parecía «el marco mide 0» y la causa era
   * «el marco todavía no estaba».
   *
   * `toHaveCount` no alcanza: el elemento está en el DOM desde que se dibuja el
   * asiento, mucho antes de que llegue el .webp.
   */
  await marco.evaluate(
    (img) =>
      img.complete ||
      new Promise((listo) => {
        img.addEventListener("load", listo, { once: true });
        img.addEventListener("error", listo, { once: true });
      }),
  );

  // Primero: que el archivo de prueba SEA grande. Si algún día se cambia por
  // un icono de 40px, esta prueba dejaría de probar nada y en silencio.
  const natural = await marco.evaluate((img) => img.naturalWidth);
  expect(natural, `${MARCO} tiene que ser mucho más grande que el retrato`).toBeGreaterThan(200);

  const caja = await marco.boundingBox();
  const retrato = await page.locator('.jugador[data-jugador="1"] .retrato').boundingBox();

  // Y que igual se pinte del tamaño del retrato, con el desborde de adorno.
  expect(caja.width).toBeLessThan(retrato.width + 20);
  expect(caja.height).toBeLessThan(retrato.height + 20);
});

test("el título se muestra al lado del nombre", async ({ page }) => {
  await abrirMesa(page, [{ titulo: "Élite" }, {}, {}, {}]);

  const nombre = page.locator('.jugador[data-jugador="0"] .nombre');
  await expect(nombre).toContainText("Ana");
  await expect(nombre.locator(".titulo-jugador")).toHaveText("Élite");

  // Y nadie más lo lleva.
  await expect(page.locator(".jugador .titulo-jugador")).toHaveCount(1);
});

test("un título con HTML se muestra como texto", async ({ page }) => {
  /**
   * El título lo teclea un administrador en el catálogo y viaja por Firestore
   * hasta la mesa de todos. Es texto de afuera, con el mismo tratamiento que
   * un nombre de sala.
   */
  const errores = await abrirMesa(page, [
    { titulo: '<img src=x onerror="window.__colado=1">' },
    {},
    {},
    {},
  ]);

  expect(await page.evaluate(() => window.__colado)).toBeUndefined();
  expect(await page.locator(".jugador .nombre img").count()).toBe(0);
  expect(errores).toEqual([]);
});

test("un marco que apunta fuera del sitio no se dibuja", async ({ page }) => {
  /**
   * Lo que trae la vista lo escribió el servidor, pero un `src` a otro dominio
   * le avisaría a ese dominio que este jugador está mirando la mesa. Es el
   * mismo filtro que ya tienen el retrato y el dorso.
   */
  await abrirMesa(page, [{ marco: "https://otro-sitio.example/marco.png" }, {}, {}, {}]);

  await expect(page.locator(".jugador .marco-avatar")).toHaveCount(0);
});

test("sin marco ni título, la mesa se ve como siempre", async ({ page }) => {
  const errores = await abrirMesa(page, [{}, {}, {}, {}]);

  await expect(page.locator(".jugador .marco-avatar")).toHaveCount(0);
  await expect(page.locator(".jugador .titulo-jugador")).toHaveCount(0);
  await expect(page.locator(".jugador")).toHaveCount(4);
  expect(errores).toEqual([]);
});
