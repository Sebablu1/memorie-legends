/**
 * La tabla del ranking, en un teléfono.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE ARREGLÓ ACÁ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La tabla tiene cinco columnas —puesto, jugador, puntos, ganadas, jugadas— y
 * no bajaba de 417 px de ancho a NINGÚN tamaño de pantalla. A 375 px tiene 305
 * disponibles: `main` se lleva 20 de cada lado y el `.panel`, otros 20.
 *
 * Los 112 px que sobraban no se quedaban adentro de la tabla. No había ningún
 * `overflow` en el camino, así que se salían del panel, del `main` y de la
 * ventana: el documento medía 452 px en una pantalla de 320 y **la página
 * entera se corría en horizontal**, barra y título incluidos. En PC no se veía
 * porque arriba de 560 px la tabla entra sin apretarse.
 *
 * Lo que fijaba el piso eran los ENCABEZADOS, no los números. «GANADAS» y
 * «JUGADAS» a 0,66 rem con 1,4 px de separación medían 85 y 83 px; los valores
 * que van abajo —«12», «40»— miden la mitad. Y son palabras sin espacios: una
 * columna no puede ser más angosta que su encabezado porque no hay dónde
 * cortarlo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE AFIRMA EL DOCUMENTO Y NO LA TABLA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque el bug es que se mueva la PÁGINA. Una tabla ancha que se desplaza
 * adentro de su caja es lo que hace cualquier sitio y no molesta a nadie; una
 * página que se corre en horizontal tapa el menú, descoloca el título y hace
 * que el pulgar arrastre la pantalla cuando quería tocar una fila.
 *
 * Así que la afirmación es `document.scrollWidth <= window.innerWidth`, que es
 * exactamente el síntoma. Afirmar en cambio «la tabla mide menos que X» sería
 * clavar un número de diseño: el día que se agregue una sexta columna la
 * prueba se pondría roja sin que nada esté mal, porque para eso está el
 * `overflow-x` de `.caja-tabla`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Y POR QUÉ NO ALCANZABA CON MIRAR EL CSS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque el ancho mínimo de una tabla no está escrito en ninguna parte: lo
 * calcula el navegador a partir del contenido de cada celda, la tipografía, la
 * separación entre letras y el relleno. Los 417 px no se deducen leyendo
 * `tablas.css`; se miden.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LOS MOCKS ESTÁN COPIADOS DE `ranking-vestido.spec.js`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A propósito, y no da gusto. Cada spec de este proyecto trae sus mocks —la
 * mesa es la excepción, con `e2e/mesa.js`, porque la comparten cuarenta—. Con
 * dos archivos de ranking, extraer un `e2e/ranking.js` obligaría a reescribir
 * un spec que está en verde dentro de un commit que arregla un bug de CSS.
 * Cuando aparezca el tercero, conviene extraerlo.
 */

import { test, expect } from "@playwright/test";

const js = (body) => ({ status: 200, contentType: "text/javascript; charset=utf-8", body });

const SESION_FALSA = `
  export const COLECCION = "users";
  export const CAMPO_SALDO = "credits";
  export async function exigirSesion() {
    return {
      usuario: { uid: "ana", email: "a@b.c", photoURL: null },
      perfil: { uid: "ana", nombre: "Ana", saldo: 500, comprado: 0, ganado: 500,
                partidas: 0, victorias: 0,
                equipado: { avatar: null, insignia: null, dorso: null } },
    };
  }
  export function mostrarSaldo() {}
  export function conectarBotonSalir() {}
  export function formatearEspera() { return "listo"; }
  export async function leerPerfil() { return {}; }
  export async function guardarEnPerfil() {}
`;

const firebaseFalso = `
  export const app = {};
  export const auth = { currentUser: { uid: "ana" } };
  export const googleProvider = {};
  export const SUPPORT_EMAIL = "soporte@example.com";
  export async function createUserWithEmailAndPassword() { return { user: {} }; }
  export async function signInWithEmailAndPassword() { return { user: {} }; }
  export function onAuthStateChanged(a, fn) { setTimeout(() => fn({ uid: "ana" }), 0); return () => {}; }
  export async function signOut() {}
  export async function sendPasswordResetEmail() {}
  export const GoogleAuthProvider = class {};
  export async function signInWithPopup() { return { user: {} }; }
  export const db = {};
  export const funciones = {};
  export function httpsCallable() { return async () => ({ data: {} }); }
  export const doc = (...a) => a;
  export async function getDoc() { return { exists: () => false, data: () => undefined }; }
  export async function setDoc() {}
  export async function updateDoc() {}
  export const arrayUnion = (x) => x;
  export const arrayRemove = (x) => x;
  export const collection = (...a) => a;
  export const query = (...a) => a;
  export const where = () => ({});
  export const orderBy = () => ({});
  export const limit = () => ({});
  export async function deleteDoc() {}
  export async function addDoc() { return {}; }
  export const serverTimestamp = () => null;
  export const increment = (n) => n;
  export async function runTransaction(f) { return f({}); }
  export function onSnapshot() { return () => {}; }
  export async function getDocs() {
    return { docs: (window.__filas ?? []).map((d) => ({ data: () => d })) };
  }
`;

/** Un archivo que existe de verdad, para que el navegador no deje un roto. */
const CARA = "/img/avatar/mago.webp";

/**
 * Las filas más anchas que la tabla puede llegar a tener.
 *
 * No son filas cualquiera: son el peor caso realista, y por eso lo prueban.
 *
 *   - Puntos de cinco cifras con separador de miles —«12.480»— que es la celda
 *     numérica más ancha posible con el límite de puntaje de hoy.
 *   - Un nombre largo, para que `max-width: 10ch` esté haciendo tope de verdad
 *     y no se mida una columna más angosta de lo que va a ser.
 *   - Título puesto, que arriba de 560 px agrega una pastilla al lado del
 *     nombre.
 *   - Retrato, que mete una imagen de 30 px en la celda del jugador.
 *
 * Con filas de «100 puntos» y nombres de tres letras la tabla entra en
 * cualquier lado y la prueba no afirmaría nada.
 */
const FILAS = [
  {
    uid: "sebastian",
    nombre: "Sebastianísimo",
    puntos: 12480,
    partidasJugadas: 291,
    partidasGanadas: 143,
    retrato: CARA,
    titulo: "Leyenda del Río",
  },
  {
    uid: "ana",
    nombre: "Ana",
    puntos: 1204,
    partidasJugadas: 40,
    partidasGanadas: 12,
    rachaActual: 3,
  },
];

/**
 * Y las de todos los días, que son otra pregunta.
 *
 * Un nombre de tres letras, cuatro cifras de puntaje, sin título y sin
 * retrato. La mesa real se parece mucho más a esto que a `FILAS`, y lo que se
 * quiere saber con estas es si la tabla ENTRA en el teléfono de la mayoría.
 */
const FILAS_TIPICAS = [
  { uid: "ana", nombre: "Ana", puntos: 1204, partidasJugadas: 40, partidasGanadas: 12 },
  { uid: "beto", nombre: "Beto", puntos: 980, partidasJugadas: 31, partidasGanadas: 9 },
];

async function abrirRanking(page, filas = FILAS) {
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));

  await page.addInitScript((f) => {
    window.__filas = f;
  }, filas);

  await page.route("**/js/sesion.js", (r) => r.fulfill(js(SESION_FALSA)));
  await page.route("**/js/firebase.js", (r) => r.fulfill(js(firebaseFalso)));

  await page.goto("/ranking.html");
  await page.waitForSelector(".tabla-ranking tbody tr", { timeout: 10_000 }).catch(() => {
    throw new Error(
      `el ranking no dibujó ninguna fila. Errores: ${errores.join(" | ") || "(ninguno)"}`,
    );
  });
  return errores;
}

/** Lo que mide la página contra lo que mide la ventana. */
const medir = (page) =>
  page.evaluate(() => ({
    documento: document.documentElement.scrollWidth,
    cuerpo: document.body.scrollWidth,
    ventana: window.innerWidth,
    caja: document.querySelector(".caja-tabla")?.clientWidth ?? null,
    contenido: document.querySelector(".caja-tabla")?.scrollWidth ?? null,
    tuPuestoDesborda: (() => {
      const el = document.getElementById("tuPuesto");
      return el ? el.scrollWidth - el.clientWidth : null;
    })(),
  }));

// =====================================================================
// 1. La página no se corre en horizontal. Es el bug.
// =====================================================================

/**
 * Los tres anchos, y por qué estos tres.
 *
 *   - 320: el piso de lo que existe. iPhone SE de primera generación y los
 *     Android chicos. Es donde el desborde era de 132 px.
 *   - 375: el iPhone SE actual y el 8. Es el ancho más común del parque.
 *   - 390: el iPhone 13/14/15, que es el de la mayoría hoy.
 */
for (const ancho of [320, 375, 390]) {
  test(`a ${ancho} px la página no se desplaza en horizontal`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 760 });
    const errores = await abrirRanking(page);

    const m = await medir(page);

    expect(
      m.documento,
      `el documento mide ${m.documento} px en una ventana de ${m.ventana}: ` +
        "la página se corre en horizontal y se lleva la barra y el título",
    ).toBeLessThanOrEqual(m.ventana);

    expect(m.cuerpo, "y el cuerpo tampoco").toBeLessThanOrEqual(m.ventana);

    expect(errores, `el ranking tiró errores: ${errores.join(" | ")}`).toEqual([]);
  });
}

// =====================================================================
// 2. Lo que no entra se desplaza adentro de su caja, no afuera
// =====================================================================

test("a 320 px la tabla se desplaza adentro de su caja", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await abrirRanking(page);

  const m = await medir(page);

  /*
   * A 320 px no hay forma de meter cinco columnas: la caja tiene 250 y la
   * tabla no baja de 293. Que SOBRE es correcto; lo que importa es dónde
   * sobra. Esta afirmación es la que prueba que `.caja-tabla` está haciendo su
   * trabajo: si alguien le saca el `overflow-x`, acá el contenido mediría lo
   * mismo que la caja —porque se escaparía— y la prueba de arriba se pondría
   * roja al mismo tiempo.
   */
  expect(m.contenido, "la tabla tendría que ser más ancha que su caja a 320 px")
    .toBeGreaterThan(m.caja);

  const desplazable = await page.evaluate(() => {
    const caja = document.querySelector(".caja-tabla");
    caja.scrollLeft = 9999;
    return caja.scrollLeft;
  });

  expect(desplazable, "la caja de la tabla no se puede desplazar").toBeGreaterThan(0);
});

test("a 390 px, con filas normales, la tabla entra sin desplazarse", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await abrirRanking(page, FILAS_TIPICAS);

  const m = await medir(page);

  /*
   * ESTA PRUEBA EMPEZÓ AFIRMANDO OTRA COSA, Y ESTABA MAL.
   *
   * Afirmaba que entraba con `FILAS` —las del peor caso— y fallaba por 5 px:
   * la tabla pide 325 y la caja tiene 320 a 390 px de pantalla. Los 5 px son
   * el nombre de 14 caracteres contra su tope de 10ch, que a 0,9 rem son unos
   * 90 px, más los 62 de un puntaje de cinco cifras con separador de miles.
   *
   * O sea que la aserción estaba clavando un número de diseño, que es lo que
   * el encabezado de este archivo dice que no hay que hacer. Con un nombre
   * largo la tabla se desplaza unos píxeles adentro de su caja, y eso está
   * bien: para eso está `overflow-x`.
   *
   * Lo que sí tiene que ser cierto es esto: con una fila como las que hay de
   * verdad, en el teléfono de la mayoría, la tabla entra. Si alguien devuelve
   * los encabezados largos, la tabla vuelve a 417 contra 320 y esto falla con
   * casi 100 px de diferencia, no con 5.
   */
  expect(m.contenido, "la tabla no entra en su caja a 390 px con filas normales")
    .toBe(m.caja);
});

test("con un nombre largo se desplaza poco, y adentro", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await abrirRanking(page);

  const m = await medir(page);

  // El peor caso realista sobra, y sobra POCO: es la diferencia entre
  // «se desplaza un poco» y «volvieron los encabezados largos».
  expect(m.contenido - m.caja, "la tabla sobra demasiado para el peor caso")
    .toBeLessThan(20);
});

// =====================================================================
// 3. Las cinco columnas siguen estando
// =====================================================================

test("no se escondió ninguna columna para que entrara", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await abrirRanking(page);

  /*
   * La salida fácil a este bug era esconder «Jugadas», y se descartó: 12
   * ganadas de 40 no es lo mismo que 12 de 300, y sin las jugadas la columna
   * de ganadas no se puede leer. Esta prueba es lo que impide que vuelva a
   * aparecer como atajo.
   */
  await expect(page.locator(".tabla-ranking thead th")).toHaveCount(5);

  const visibles = await page.locator(".tabla-ranking tbody tr").first().locator("td").count();
  expect(visibles, "a una fila le falta una celda").toBe(5);
});

// =====================================================================
// 4. Los encabezados cortos: visibles en el teléfono, no en la computadora
// =====================================================================

test("en el teléfono los encabezados numéricos van en tres letras", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await abrirRanking(page);

  const cabeza = page.locator(".tabla-ranking thead");
  await expect(cabeza).toContainText("Pts");
  await expect(cabeza).toContainText("Gan");
  await expect(cabeza).toContainText("Jug");

  // Y las palabras largas están en el DOM pero no se ven: `display: none` las
  // saca también del lector de pantalla, que es el motivo del `aria-label`.
  await expect(cabeza.locator(".th-largo").first()).toBeHidden();
});

test("en la computadora van completos", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await abrirRanking(page);

  const cabeza = page.locator(".tabla-ranking thead");
  await expect(cabeza).toContainText("Puntos");
  await expect(cabeza).toContainText("Ganadas");
  await expect(cabeza).toContainText("Jugadas");

  await expect(cabeza.locator(".th-corto").first()).toBeHidden();
});

test("la columna se llama por su nombre completo en los dos tamaños", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await abrirRanking(page);

  /*
   * «Gan» es una concesión al ancho del teléfono, no el nombre de la columna.
   * Quien usa un lector de pantalla no gana nada con tres letras, así que el
   * nombre accesible lleva la palabra entera en los dos tamaños.
   */
  const encabezados = page.locator(".tabla-ranking thead th.num");
  await expect(encabezados.nth(0)).toHaveAttribute("aria-label", "Puntos");
  await expect(encabezados.nth(1)).toHaveAttribute("aria-label", "Ganadas");
  await expect(encabezados.nth(2)).toHaveAttribute("aria-label", "Jugadas");
});

// =====================================================================
// 5. «Tu posición», que no tenía el bug y tiene que seguir sin tenerlo
// =====================================================================

test("«Tu posición» no desborda en ningún ancho", async ({ page }) => {
  /*
   * Se sospechó que tenía el mismo problema y no: no es una tabla, son filas
   * `.fila-dato` con `display: flex` y `justify-content: space-between`, que
   * se encogen solas. Medido en 320, 375 y 390: desborde cero.
   *
   * Se prueba igual, por dos motivos. Uno: era parte del reporte y queda
   * contestado con una prueba en vez de con una opinión. Dos: «Tu posición» es
   * el candidato natural a convertirse en tabla el día que le agreguen
   * columnas, y ese día esto avisa.
   */
  for (const ancho of [320, 375, 390]) {
    await page.setViewportSize({ width: ancho, height: 760 });
    await abrirRanking(page);

    const m = await medir(page);
    expect(m.tuPuestoDesborda, `a ${ancho} px «Tu posición» desborda`).toBe(0);
  }
});
