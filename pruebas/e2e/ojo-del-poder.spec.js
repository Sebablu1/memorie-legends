/**
 * El ojo que marca qué carta miró un poder.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE ARREGLÓ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Cuando alguien usaba un 7, un 8 o un 10, el único que veía algo era quien lo
 * usaba: los otros tres no se enteraban de nada. Sabían —por el cartel— que
 * había mirado a alguien, pero no qué carta.
 *
 * Ahora la posición viaja en el registro y los cuatro navegadores dibujan un
 * ojo sobre la carta exacta. Es una decisión de diseño, no un descuido: qué
 * carta conoce un rival pasa a ser información pública y parte de la
 * estrategia.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL LÍMITE QUE NO SE MOVIÓ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El ojo va sobre el DORSO y dice que esa carta se miró, nunca qué decía. El
 * número sigue viajando sólo a quien usó el poder. Esta suite lo comprueba:
 * con el ojo puesto, la carta sigue boca abajo.
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
 * La partida, con el registro bajo control de la prueba.
 *
 * `window.__registro` son las líneas que la vista trae. El ojo se dispara
 * desde ahí, que es exactamente como llega en producción: el servidor escribe
 * la línea y los cuatro navegadores la leen igual.
 */
const partidaFalsa = `
  const tapada = { oculta: true };
  const CASO = window.__caso ?? {};

  export const ahoraDelServidor = () => Date.now();
  export const relojActual = () => ({ desfase: 0, incertidumbre: 10 });
  export const sincronizarReloj = async () => {};
  export const mantenerVivo = () => () => {};
  export const mantenerEnMarcha = () => () => {};
  export const nuevoIdDeAccion = () => "a1";
  export const saltarAusente = async () => {};
  export const volver = async () => {};
  export const calentarDescarte = async () => true;
  export const entregarCarta = async () => ({});
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
      turnosRonda: 0, indiceCortador: null, desempate: false,
      registro: CASO.registro ?? [],
      cartasEnMazo: 20, cartasEnDescarte: 1, muestra: null, levantada: null,
      poderPendiente: null, cambioPendiente: null,
      puedeAtacar: [], plazo: null, puntosDeMano: null,
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

/** Una carta por asiento y posición, como la nombra el motor. */
const carta = (page, jugador, posicion) =>
  page.locator(`.jugador[data-jugador="${jugador}"] .carta[data-posicion="${posicion}"]`);

/**
 * Las dos marcas se cuentan por separado, y el selector lo permite solo.
 *
 * `.carta.mirada` NO matchea `.carta.mirada-inicial`: CSS compara tokens
 * enteros, no subcadenas. Lo que sí las confunde es `toHaveClass(/mirada/)`,
 * que corre contra el atributo como texto — por eso abajo las expresiones
 * dicen `/mirada-inicial/` cuando quieren el borde.
 */
const conOjo = (page) => page.locator(".carta.mirada");
const conBorde = (page) => page.locator(".carta.mirada-inicial");

// =====================================================================

test("un 8 sobre la carta de un rival la marca, y sólo a ella", async ({ page }) => {
  /**
   * Yo soy el asiento 0 y el que usa el poder es el 1: es el caso que antes no
   * mostraba NADA a los espectadores.
   */
  const errores = await abrirMesa(page, {
    registro: [
      { ronda: 1, texto: "Beto miró una carta de Caro", tipo: "miroCarta", actor: 1, objetivo: 2, posicion: 3 },
    ],
  });

  await expect(carta(page, 2, 3)).toHaveClass(/mirada/);
  await expect(conOjo(page)).toHaveCount(1);

  expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

test("el ojo no da vuelta la carta: marca dónde miró, no qué vio", async ({ page }) => {
  /**
   * El límite que no se movió. Se hizo pública la POSICIÓN, no el número: la
   * carta sigue boca abajo para todos menos para quien usó el poder, que la ve
   * por la respuesta de su propia llamada.
   */
  await abrirMesa(page, {
    registro: [
      { ronda: 1, texto: "Beto miró una carta de Caro", tipo: "miroCarta", actor: 1, objetivo: 2, posicion: 3 },
    ],
  });

  const marcada = carta(page, 2, 3);
  await expect(marcada).toHaveClass(/mirada/);
  await expect(marcada).not.toHaveClass(/visible/);
  // Y no hay ninguna cara dibujada dentro: la carta ajena viaja sin número.
  await expect(marcada.locator(".cara img")).toHaveCount(0);
});

test("el 10 marca las DOS cartas, una en cada mano", async ({ page }) => {
  await abrirMesa(page, {
    registro: [
      {
        ronda: 1, texto: "Beto mira su carta y una de Caro",
        tipo: "miroParaCambiar", actor: 1, objetivo: 2,
        posicionPropia: 0, posicionRival: 2,
      },
    ],
  });

  await expect(carta(page, 1, 0)).toHaveClass(/mirada/);
  await expect(carta(page, 2, 2)).toHaveClass(/mirada/);
  await expect(conOjo(page)).toHaveCount(2);
});

test("el ojo se va solo", async ({ page }) => {
  // Dura dos segundos. Si se quedara, la mesa terminaría empapelada de ojos y
  // dejarían de significar nada.
  await abrirMesa(page, {
    registro: [
      { ronda: 1, texto: "Beto miró una carta de Caro", tipo: "miroCarta", actor: 1, objetivo: 2, posicion: 3 },
    ],
  });

  await expect(conOjo(page)).toHaveCount(1);
  await expect(conOjo(page)).toHaveCount(0, { timeout: 5000 });
});

test("una mirada a una carta propia también se marca", async ({ page }) => {
  // El 7 mira una carta de uno mismo, y la mesa se entera igual: es la misma
  // información pública que con el 8.
  await abrirMesa(page, {
    registro: [
      { ronda: 1, texto: "Ana miró una carta suya", tipo: "miroCarta", actor: 0, objetivo: 0, posicion: 1 },
    ],
  });

  await expect(carta(page, 0, 1)).toHaveClass(/mirada/);
});

test("sin miradas en el registro no hay ningún ojo", async ({ page }) => {
  const errores = await abrirMesa(page, { registro: [] });

  await expect(conOjo(page)).toHaveCount(0);
  expect(errores).toEqual([]);
});

test("una línea sin posición no rompe la mesa", async ({ page }) => {
  /**
   * Las partidas que ya estaban en curso cuando esto se desplegó tienen
   * líneas viejas, sin `posicion`. Tienen que pasar sin ojo y sin error, no
   * dibujar un ojo en la posición `undefined`.
   */
  const errores = await abrirMesa(page, {
    registro: [
      { ronda: 1, texto: "Beto miró una carta de Caro", tipo: "miroCarta", actor: 1, objetivo: 2 },
    ],
  });

  await expect(conOjo(page)).toHaveCount(0);
  expect(errores, `la mesa tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

test("la mirada inicial deja BORDE, y no ojo", async ({ page }) => {
  /**
   * El caso más común de todos, y el que NO es un poder: al empezar la ronda
   * cada jugador mira UNA carta suya.
   *
   * Llevó ojo por un tiempo y estaba mal. El ojo anuncia que alguien usó un
   * poder para mirar: costó una carta, va con cartel y sonido, y dice que
   * ahora sabe algo que antes no sabía. La mirada del principio no cuesta
   * nada, no la elige nadie y les pasa a los cuatro a la vez — cuatro ojos
   * idénticos al abrir cada ronda le sacaban significado al ojo justo antes de
   * que apareciera el que sí importa.
   *
   * Lo que hay que poder leer acá es más chico: «el rival miró SU posición 1».
   * Eso lo dice un borde.
   */
  await abrirMesa(page, {
    registro: [
      { ronda: 1, texto: "Caro miró una de sus cartas", tipo: "miradaInicial", actor: 2, posicion: 1 },
    ],
  });

  await expect(carta(page, 2, 1)).toHaveClass(/mirada-inicial/);
  await expect(conBorde(page)).toHaveCount(1);
  await expect(conOjo(page), "la mirada inicial no es un poder").toHaveCount(0);
});

test("los cuatro miran a la vez y se ven los cuatro bordes", async ({ page }) => {
  // Es lo que pasa de verdad en los dos segundos de apertura. Cada uno mira
  // una carta distinta de su propia mano.
  await abrirMesa(page, {
    registro: [0, 1, 2, 3].map((quien) => ({
      ronda: 1,
      texto: "miró una de sus cartas",
      tipo: "miradaInicial",
      actor: quien,
      posicion: quien,
    })),
  });

  await expect(conBorde(page)).toHaveCount(4);
  await expect(conOjo(page)).toHaveCount(0);
  for (const quien of [0, 1, 2, 3]) {
    await expect(carta(page, quien, quien)).toHaveClass(/mirada-inicial/);
  }
});

test("el mecanismo es uno solo: no hay una rama por poder", async ({ page }) => {
  /**
   * La afirmación que protege la unificación.
   *
   * Las cuatro clases de mirada llegan juntas y las cuatro tienen que dejar su
   * marca. Con una rama por evento, agregar un poder nuevo obliga a acordarse
   * de agregarle también la suya — y olvidarse no rompe nada, simplemente no
   * aparece. Acá se comprueban las cuatro de una.
   *
   * Que sean DOS marcas no rompe la unificación y es el punto: la bifurcación
   * está en un solo lugar —`claseDeMarca`, que mira el tipo de la línea— y no
   * repartida por los poderes. `cartasMiradasEn` sigue contestando quién miró
   * qué, sea cual sea el evento.
   */
  await abrirMesa(page, {
    registro: [
      { ronda: 1, texto: "inicial", tipo: "miradaInicial", actor: 0, posicion: 0 },
      { ronda: 1, texto: "un 7", tipo: "miroCarta", actor: 1, objetivo: 1, posicion: 1 },
      { ronda: 1, texto: "un 8", tipo: "miroCarta", actor: 1, objetivo: 2, posicion: 2 },
      {
        ronda: 1, texto: "un 10", tipo: "miroParaCambiar",
        actor: 3, objetivo: 2, posicionPropia: 3, posicionRival: 0,
      },
    ],
  });

  // Cinco marcas: una por cada mirada, y el 10 cuenta por dos. Cuatro ojos
  // —los tres poderes, con el 10 doble— y un borde, el de la inicial.
  await expect(conOjo(page)).toHaveCount(4);
  await expect(conBorde(page)).toHaveCount(1);

  await expect(carta(page, 0, 0), "la inicial").toHaveClass(/mirada-inicial/);
  await expect(carta(page, 1, 1), "el 7").toHaveClass(/mirada(?!-)/);
  await expect(carta(page, 2, 2), "el 8").toHaveClass(/mirada(?!-)/);
  await expect(carta(page, 3, 3), "el 10, la propia").toHaveClass(/mirada(?!-)/);
  await expect(carta(page, 2, 0), "el 10, la del rival").toHaveClass(/mirada(?!-)/);
});
