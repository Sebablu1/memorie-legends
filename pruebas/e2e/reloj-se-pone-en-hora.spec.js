/**
 * El reloj del cliente, puesto en hora más de una vez.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ACÁ NO HAY DOBLE DE `partida-red.js`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Y es la razón de que esta suite exista aparte. Las trece pruebas de mesa
 * reemplazan el módulo entero por uno falso con `ahoraDelServidor` fijo — que
 * es lo correcto allá: miden la mesa, no la red—. Pero eso deja sin probar
 * justamente el código que calculaba mal el desfase.
 *
 * Acá se carga el módulo DE VERDAD con un `import()` dinámico sobre una
 * página en blanco, y lo único falso es `firebase.js`: un `horaDelServidor`
 * cuyo camino de vuelta lo decide la prueba.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ ES UNA MEDICIÓN «SUCIA», Y POR QUÉ SE SIMULA CON LA VUELTA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `desfase = t1 − (t0 + t2)/2` supone que la ida y la vuelta tardan lo mismo.
 * `t2` se toma en el callback de la promesa, así que cualquier atasco del hilo
 * principal entre que llega la respuesta y que corre ese callback se le suma
 * a la VUELTA y no a la ida. Eso es exactamente lo que pasa al montar la mesa.
 *
 * El efecto es de un solo signo: la vuelta inflada BAJA el desfase estimado,
 * el navegador cree que al servidor le falta más tiempo del que le falta, y
 * el jugador toca tarde. Es el turno perdido del reporte.
 *
 * Por eso el doble toma `t1` primero y DESPUÉS duerme: inflar la vuelta sin
 * mover la hora del servidor es la forma exacta de reproducirlo.
 */

import { test, expect } from "@playwright/test";

/** Una página en blanco del mismo origen, para no montar ninguna pantalla. */
const EN_BLANCO = "<!doctype html><meta charset=utf-8><title>reloj</title>";

const firebaseFalso = `
  export const app = {};
  export const db = {};
  export const funciones = {};
  export const auth = { currentUser: { uid: "ana" } };
  export const googleProvider = {};
  export const SUPPORT_EMAIL = "soporte@example.com";
  export const doc = (...a) => a;
  export const collection = (...a) => a;
  export const query = (...a) => a;
  export const where = () => ({});
  export const orderBy = () => ({});
  export const limit = () => ({});
  export const onSnapshot = () => () => {};
  export const getDoc = async () => ({ exists: () => false });
  export const getDocs = async () => ({ docs: [] });
  export const setDoc = async () => {};
  export const updateDoc = async () => {};
  export const addDoc = async () => ({});
  export const deleteDoc = async () => {};
  export const serverTimestamp = () => null;
  export const increment = (n) => n;
  export const arrayUnion = (x) => x;
  export const arrayRemove = (x) => x;
  export const runTransaction = async (f) => f({});
  export const GoogleAuthProvider = class {};
  export const onAuthStateChanged = () => () => {};
  export const signOut = async () => {};
  export const signInWithPopup = async () => ({ user: {} });
  export const signInWithEmailAndPassword = async () => ({ user: {} });
  export const createUserWithEmailAndPassword = async () => ({ user: {} });
  export const sendPasswordResetEmail = async () => {};
  export function precalentarFunciones() {}

  export function httpsCallable(_f, nombre) {
    return async () => {
      if (nombre !== "horaDelServidor") return { data: {} };
      window.__pasadas = (window.__pasadas ?? 0) + 1;
      if (window.__falla) throw new Error("horaDelServidor no contesta");

      // La hora del servidor se toma ANTES de dormir: lo que se infla es el
      // camino de VUELTA, que es lo que hace sucia a una medición.
      const t1 = Date.now() + (window.__desfaseReal ?? 0);
      const vuelta = window.__vuelta ?? 0;
      if (vuelta) await new Promise((r) => setTimeout(r, vuelta));
      return { data: { ahora: t1 } };
    };
  }
`;

/** Carga el módulo real con firebase falso, en una página vacía. */
async function cargarElReloj(page) {
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));

  await page.route("**/__reloj.html", (r) =>
    r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: EN_BLANCO }));
  await page.route("**/js/firebase.js", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: firebaseFalso }));

  await page.goto("/__reloj.html");
  await page.evaluate(async () => {
    window.Red = await import("/js/partida-red.js");
  });
  return errores;
}

const medir = (page, pasadas, vuelta) =>
  page.evaluate(
    async ([n, v]) => {
      window.__vuelta = v;
      return window.Red.sincronizarReloj(n);
    },
    [pasadas, vuelta],
  );

const relojDe = (page) => page.evaluate(() => window.Red.relojActual());

// =====================================================================
// 1. La corrección: una medición sucia la reemplaza una limpia
// =====================================================================

test("una primera medición sucia la corrige la siguiente pasada", async ({ page }) => {
  const errores = await cargarElReloj(page);

  // Vuelta de 400 ms: el desfase estimado se va unos 200 ms para abajo.
  const sucio = await medir(page, 2, 400);
  expect(
    Math.abs(sucio.desfase),
    `la medición sucia tiene que salir corrida y salió ${sucio.desfase}`,
  ).toBeGreaterThan(120);

  // Y ahora una limpia.
  const limpio = await medir(page, 2, 0);
  expect(
    Math.abs(limpio.desfase),
    `el reloj no se corrigió: quedó en ${limpio.desfase}`,
  ).toBeLessThan(60);

  expect(errores, errores.join(" | ")).toEqual([]);
});

test("pero una medición PEOR no pisa a una buena", async ({ page }) => {
  /*
   * El otro lado de la misma regla, y el que evita que re-sincronizar sea un
   * retroceso: con «gana la última» una pasada tomada en un bache de red
   * empeoraría un reloj que ya estaba bien.
   */
  await cargarElReloj(page);

  const limpio = await medir(page, 2, 0);
  const despues = await medir(page, 2, 400);

  expect(
    Math.abs(despues.desfase - limpio.desfase),
    `el desfase se movió de ${limpio.desfase} a ${despues.desfase}`,
  ).toBeLessThan(20);
});

// =====================================================================
// 2. Los disparadores
// =====================================================================

test("al volver a la pestaña se vuelve a medir", async ({ page }) => {
  /*
   * Es el disparador que más importa en un teléfono: volver a la pestaña es
   * justo después de que el aparato estuvo bloqueado o cambió de red, que es
   * cuando su reloj más probablemente se movió.
   */
  await cargarElReloj(page);

  await page.evaluate(() => {
    window.__vuelta = 0;
    window.cortar = window.Red.mantenerElRelojEnHora();
  });
  await expect.poll(() => page.evaluate(() => window.Red.relojEnHora())).toBe(true);

  const antes = await page.evaluate(() => window.__pasadas);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

  await expect
    .poll(() => page.evaluate(() => window.__pasadas), { timeout: 5000 })
    .toBeGreaterThan(antes);

  await page.evaluate(() => window.cortar());
});

test("si la primera tanda falla entera, insiste hasta tener reloj", async ({ page }) => {
  /*
   * Sin NINGUNA muestra, `ahoraDelServidor()` es el reloj crudo del aparato:
   * la única situación en la que el error no tiene techo, porque un teléfono
   * con la hora mal puesta puede estar a minutos.
   */
  await cargarElReloj(page);

  await page.evaluate(() => {
    window.__falla = true;
    window.__vuelta = 0;
    window.cortar = window.Red.mantenerElRelojEnHora();
  });

  await expect
    .poll(() => page.evaluate(() => window.__pasadas), { timeout: 5000 })
    .toBeGreaterThanOrEqual(5);
  expect(await page.evaluate(() => window.Red.relojEnHora())).toBe(false);

  // Vuelve a contestar: la insistencia tiene que levantarlo sola.
  await page.evaluate(() => { window.__falla = false; });

  await expect
    .poll(() => page.evaluate(() => window.Red.relojEnHora()), { timeout: 15_000 })
    .toBe(true);

  await page.evaluate(() => window.cortar());
});

test("cortar el ciclo lo deja de verdad quieto", async ({ page }) => {
  /*
   * La mesa lo corta en `pagehide`. Un intervalo que sigue vivo después de
   * irse de la página es una llamada al servidor por cada 30 s que el
   * navegador tarde en soltar el documento.
   */
  await cargarElReloj(page);

  await page.evaluate(async () => {
    window.__vuelta = 0;
    const cortar = window.Red.mantenerElRelojEnHora();
    await new Promise((r) => setTimeout(r, 300));
    cortar();
    window.__tras = window.__pasadas;
  });

  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(600);

  const [tras, ahora] = await page.evaluate(() => [window.__tras, window.__pasadas]);
  expect(ahora, "siguió midiendo después de cortar").toBe(tras);
});

// =====================================================================
// 3. La espera de la mesa
// =====================================================================

test("`cuandoHayaReloj` espera a la medición y después pasa de largo", async ({ page }) => {
  await cargarElReloj(page);

  // Sin reloj todavía: la espera se corta sola y avisa que no lo hubo.
  expect(await page.evaluate(() => window.Red.relojEnHora())).toBe(false);
  expect(
    await page.evaluate(() => window.Red.cuandoHayaReloj(200)),
    "sin reloj y con la espera vencida tiene que contestar false, no colgarse",
  ).toBe(false);

  // Con el reloj puesto, no espera nada.
  await medir(page, 2, 0);
  expect(await page.evaluate(() => window.Red.cuandoHayaReloj(200))).toBe(true);
});

test("una espera en curso se despierta en cuanto llega la medición", async ({ page }) => {
  /*
   * Lo que hace que la jugada salga SOLA en vez de hacer tocar de nuevo. Si
   * la espera no se despertara, quedaría colgada hasta el techo de 20 s y el
   * turno se habría perdido igual.
   */
  await cargarElReloj(page);

  const resultado = await page.evaluate(async () => {
    window.__vuelta = 0;
    const esperando = window.Red.cuandoHayaReloj(10_000);
    const t0 = Date.now();
    window.Red.sincronizarReloj(1);
    const hay = await esperando;
    return { hay, tardo: Date.now() - t0 };
  });

  expect(resultado.hay, "la espera no se despertó con la medición").toBe(true);
  expect(resultado.tardo, "esperó hasta el techo en vez de despertarse").toBeLessThan(3000);
});
