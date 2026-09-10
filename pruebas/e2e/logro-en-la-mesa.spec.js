/**
 * Al terminar la partida, la mesa avisa qué insignia se ganó.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACÍA FALTA UN AVISO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La insignia se otorgaba bien y en el momento, pero en silencio. El modal
 * del final mostraba el marcador y nada más, y el jugador se enteraba —si se
 * enteraba— al volver al panel y mirar la vitrina. Un logro del que nadie se
 * entera no premia nada.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA CARRERA QUE ESTO PRUEBA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El modal lo abre la transacción que cierra la partida. Las insignias se
 * otorgan DESPUÉS de esa transacción, porque para saber si se ganaron hay que
 * leer contadores que ella acaba de escribir. Los dos órdenes son posibles y
 * ninguno está garantizado:
 *
 *   - el aviso llega ANTES de que se abra el modal → lo tiene que encontrar
 *     esperando cuando se abre;
 *   - el aviso llega DESPUÉS → el escuchador lo tiene que pintar sobre un
 *     modal ya abierto.
 *
 * Las dos ramas se prueban acá, porque una implementación que pregunte al
 * abrir el modal pasa la segunda y falla la primera, y en producción se ve
 * como «a veces avisa».
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
 * El módulo de partida, con la vista final y el aviso bajo control.
 *
 * `window.__avisarLogros(lista)` es lo que dispara el aviso. Vive en `window`
 * porque la prueba y la página corren en mundos distintos, y es lo que
 * permite elegir el orden: llamarlo antes de que la mesa arranque, o después
 * de que el modal esté abierto.
 */
const partidaFalsa = `
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
  export const MS_ENTRE_GOLPES = 900;
  export const MS_ENTRE_LATIDOS = 5000;

  /**
   * El aviso, con el mismo contrato que el de verdad: sólo entrega lo que ya
   * está o lo que llegue, y nunca un documento vacío.
   */
  export function escucharMisLogros(codigo, uid, alGanar) {
    window.__logrosPedidos = { codigo, uid };
    // Si la prueba ya dejó algo esperando, se entrega al suscribirse: es lo
    // que hace un onSnapshot con un documento que ya existe.
    if (window.__logrosPendientes) alGanar(window.__logrosPendientes);
    window.__avisarLogros = (lista) => alGanar(lista);
    return () => { window.__logrosCortado = true; };
  }

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

/**
 * @param pendientes  lo que ya estaba publicado ANTES de que la mesa arranque
 */
async function abrirFinal(page, { pendientes = null } = {}) {
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));

  await page.route("**/js/guardia-sesion.js", (r) =>
    r.fulfill(js(`export async function exigirSesionEnMesa(){
      return { uid: "ana", email: "a@b.c" };
    }`)));
  await page.route("**/js/sesion.js", (r) => r.fulfill(js(SESION_FALSA)));
  await page.route("**/js/firebase.js", (r) => r.fulfill(js(firebaseFalso)));
  await page.route("**/js/partida-red.js", (r) => r.fulfill(js(partidaFalsa)));
  await page.route("**/room.html*", (r) =>
    r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: "<title>sala</title>" }));

  if (pendientes) {
    await page.addInitScript((lista) => {
      window.__logrosPendientes = lista;
    }, pendientes);
  }

  await page.goto("/mesa.html?sala=ABCDEF");
  await page.waitForSelector("#panelRevancha");
  return errores;
}

const NOVATO = [{ id: "novato", nombre: "Novato", leyendas: 20 }];

// =====================================================================

test("una partida sin insignia nueva no deja un hueco en blanco", async ({ page }) => {
  const errores = await abrirFinal(page);

  // El hueco existe en el HTML, pero apagado: la mayoría de las partidas no
  // gana ninguna, y un espacio vacío permanente debajo de la tabla se lee
  // como que algo no cargó.
  await expect(page.locator("#panelLogros")).toBeHidden();
  expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

test("si el aviso llega DESPUÉS de abrirse el modal, lo pinta igual", async ({ page }) => {
  await abrirFinal(page);
  await expect(page.locator("#panelLogros")).toBeHidden();

  await page.evaluate((lista) => window.__avisarLogros(lista), NOVATO);

  const panel = page.locator("#panelLogros");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("¡Ganaste la insignia Novato!");
  await expect(panel).toContainText("+20 Leyendas");
});

test("si el aviso llegó ANTES, lo encuentra esperando al abrir el modal", async ({ page }) => {
  /**
   * Ésta es la rama que se pierde con una implementación que pregunte al
   * abrir el modal: cuando el servidor otorga rápido, el dato ya está
   * publicado antes de que la mesa termine de suscribirse.
   */
  await abrirFinal(page, { pendientes: NOVATO });

  const panel = page.locator("#panelLogros");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("¡Ganaste la insignia Novato!");
});

test("varias insignias de una se anuncian todas", async ({ page }) => {
  // Pasa de verdad: quien cruza dos umbrales en la misma partida —la décima
  // victoria del que venía de la quinta— se lleva dos.
  await abrirFinal(page);

  await page.evaluate(
    (lista) => window.__avisarLogros(lista),
    [
      { id: "aventurero", nombre: "Aventurero", leyendas: 30 },
      { id: "estratega", nombre: "Estratega", leyendas: 40 },
    ],
  );

  const panel = page.locator("#panelLogros");
  await expect(panel.locator(".logro-nuevo")).toHaveCount(2);
  await expect(panel).toContainText("Aventurero");
  await expect(panel).toContainText("Estratega");
});

test("no promete Leyendas que no se acreditaron", async ({ page }) => {
  /**
   * El servidor manda `leyendas: 0` cuando la clave de idempotencia frenó el
   * pago —un reintento, o una posesión que un administrador borró y se
   * vuelve a otorgar—. Anunciar «+0 Leyendas» sería raro, y anunciar el
   * premio completo sería mentir sobre un saldo que no llegó.
   */
  await abrirFinal(page);

  await page.evaluate(
    (lista) => window.__avisarLogros(lista),
    [{ id: "novato", nombre: "Novato", leyendas: 0 }],
  );

  const panel = page.locator("#panelLogros");
  await expect(panel).toContainText("¡Ganaste la insignia Novato!");
  await expect(panel).not.toContainText("Leyendas");
});

test("el nombre de la insignia se escapa, como todo lo que viene de fuera", async ({ page }) => {
  /**
   * El nombre sale del catálogo, que lo escribe un administrador desde el
   * panel. No es una entrada de un jugador cualquiera, pero es texto que
   * alguien tecleó y termina dentro de un `innerHTML`: la misma regla que ya
   * cubre `xss-sala.spec.js` para los nombres de sala.
   */
  const errores = await abrirFinal(page);

  await page.evaluate(
    (lista) => window.__avisarLogros(lista),
    [{ id: "x", nombre: "<img src=x onerror=\"window.__colado=1\">Pirata", leyendas: 10 }],
  );

  const panel = page.locator("#panelLogros");
  await expect(panel).toContainText("Pirata");
  expect(await page.evaluate(() => window.__colado)).toBeUndefined();
  expect(await panel.locator("img").count()).toBe(0);
  expect(errores).toEqual([]);
});

test("la mesa pide los logros de la partida y del jugador que es", async ({ page }) => {
  // Si pidiera los de otro, las reglas de Firestore lo rechazarían y el
  // jugador no vería nunca su insignia. Es barato comprobarlo acá.
  await abrirFinal(page);

  const pedido = await page.evaluate(() => window.__logrosPedidos);
  expect(pedido).toEqual({ codigo: "ABCDEF", uid: "ana" });
});
