/**
 * Entrar con Google DESDE EL LOGIN, que es el camino que no cubría nadie.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE ESTE ARCHIVO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque por acá se colaron el bug y el agujero, los dos juntos.
 *
 * `registro-google.spec.js` prueba el mismo botón pero en `register.html`:
 * sus tres `goto` van ahí. El botón de `login.html` es otro, lo atiende otro
 * archivo —`auth.js`— y no tenía ninguna prueba. Cuando se agregó `terminos`
 * a `firestore.rules`, `register.js` se actualizó y `auth.js` no: seguía
 * creando el perfil sin ese campo, Firestore lo rechazaba, y quien entraba
 * con Google por primera vez quedaba con cuenta en Auth, sin perfil, leyendo
 * «probá recargar la página» —que hacía exactamente lo mismo— para siempre.
 *
 * Las 83 suites de Node y las 444 del navegador estaban todas en verde.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE DEFIENDE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Que `auth.js` NO cree perfiles. Son dos cosas en una:
 *
 *   - que no vuelva el bug: el perfil lo crea un solo archivo, y es el que
 *     está al día con la regla;
 *   - que no se acrediten las Leyendas de bienvenida sin que nadie haya
 *     aceptado nada. En el login no hay casilla que marcar, así que un perfil
 *     nacido acá tendría `terminos.aceptado` escrito con la fecha del momento
 *     y ninguna aceptación detrás. Un registro de algo que no pasó es peor
 *     que no tener registro, porque es justo el dato con el que se sostiene
 *     que la bonificación de bienvenida no es un premio.
 *
 * `pruebas/leyendas-iniciales.mjs` lo audita leyendo el código. Esto lo
 * comprueba corriéndolo, que es lo que falta cuando el código parece bien.
 */

import { test, expect } from "@playwright/test";

/**
 * Un `firebase.js` de mentira que anota lo que se le pide.
 *
 * Mismo truco que en `registro-google.spec.js`: lo anotado sale del navegador
 * con `anotar`, porque la pantalla navega y la navegación se lleva puesto el
 * `window` con todo lo que hubiera guardado adentro.
 *
 * `onAuthStateChanged` avisa SOLO y enseguida, que es lo que hace Firebase
 * cuando la sesión ya venía abierta. No hace falta apretar el botón de
 * Google: el caso que importa es el instante siguiente a tener sesión.
 */
const firebaseCon = ({ perfilExistente }) => `
  export const app = {};
  export const db = {};
  export const auth = { currentUser: null, settings: {}, languageCode: null };
  export const googleProvider = {};
  export const SUPPORT_EMAIL = "soporte@x.com";
  export function precalentarFunciones() {}

  export function doc(_db, coleccion, id) { return { coleccion, id }; }

  export async function getDoc(ref) {
    window.anotar("lectura", ref);
    const existe = ${perfilExistente ? "true" : "false"};
    return {
      exists: () => existe,
      data: () => (${perfilExistente ? '{ username: "Veterano", credits: 2500 }' : "undefined"}),
    };
  }

  export async function setDoc(ref, datos) {
    window.anotar("escritura", { ref, datos });
  }

  export async function signInWithEmailAndPassword() { return { user: { uid: "u1" } }; }
  export async function signInWithPopup() { return { user: { uid: "u1" } }; }
  export async function sendPasswordResetEmail() {}

  /*
   * Éste no lo usa 'auth.js': lo importa 'register.js', y la ruta de mentira
   * atiende a las DOS páginas porque la prueba navega de una a la otra.
   *
   * Si falta, el import de 'register.js' falla entero y el archivo no corre:
   * la pantalla queda con el formulario a la vista, el cartel tapado, y el
   * fallo se lee como «el cartel no apareció» en vez de «faltó un export».
   * Así que acá va la UNIÓN de lo que importan los dos archivos.
   */
  export async function createUserWithEmailAndPassword() { return { user: { uid: "u1" } }; }

  export function onAuthStateChanged(_auth, cb) {
    setTimeout(() => cb({
      uid: "u1",
      email: "nuevo@example.com",
      displayName: "Nuevo",
      providerData: [{ providerId: "google.com" }],
    }), 0);
    return () => {};
  }
`;

const abrir = async (page, opciones) => {
  const llamadas = { lecturas: [], escrituras: [] };
  await page.exposeFunction("anotar", (tipo, datos) => {
    (tipo === "lectura" ? llamadas.lecturas : llamadas.escrituras).push(datos);
  });
  await page.route("**/js/firebase.js", (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/javascript; charset=utf-8",
      body: firebaseCon(opciones),
    }));
  await page.goto("/login.html");
  return llamadas;
};

test("con sesión de Google y sin perfil, va al registro y NO crea nada", async ({ page }) => {
  const llamadas = await abrir(page, { perfilExistente: false });

  // Ésta es la prueba. Antes acá se creaba el perfil y se iba al tablero.
  await page.waitForURL(/register\.html/, { timeout: 9000 });

  expect(
    llamadas.escrituras.length,
    "creó el perfil desde el login, sin que nadie aceptara los Términos",
  ).toBe(0);

  expect(llamadas.lecturas.length, "ni leyó el perfil antes de decidir").toBeGreaterThan(0);

  // Y llega a una pantalla que sirve: la casilla y el botón para terminar.
  await expect(page.locator("#aceptoTerminos")).toBeVisible({ timeout: 9000 });
  await expect(page.locator("#terminarGoogle")).toBeVisible();
  await expect(page.locator("#terminarGoogleBtn")).toBeVisible();

  // El formulario de correo no: ya se identificó con Google, y pedirle
  // usuario y contraseña sería hacerle repetir lo que acaba de hacer.
  await expect(page.locator("#registerForm")).toBeHidden();
});

test("con perfil, el login entra al tablero como siempre", async ({ page }) => {
  // El contraejemplo: el cambio no puede mandar al registro a quien ya tiene
  // cuenta. Eso sería sacar a todo el mundo de su propio login.
  const llamadas = await abrir(page, { perfilExistente: true });

  await page.waitForURL(/dashboard\.html/, { timeout: 9000 });
  expect(llamadas.escrituras.length, "escribió sobre un perfil que ya existía").toBe(0);
});

test("en el registro, no se puede terminar sin marcar la casilla", async ({ page }) => {
  const llamadas = await abrir(page, { perfilExistente: false });
  await page.waitForURL(/register\.html/, { timeout: 9000 });
  await expect(page.locator("#terminarGoogleBtn")).toBeVisible({ timeout: 9000 });

  await page.locator("#terminarGoogleBtn").click();

  await expect(page.locator("#mensaje")).toContainText(/aceptar los Términos/i);
  expect(llamadas.escrituras.length, "creó el perfil sin aceptación").toBe(0);
});
