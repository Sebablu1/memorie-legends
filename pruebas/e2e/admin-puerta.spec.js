/**
 * La puerta del panel de administración.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE DEFIENDE, Y EN QUÉ ORDEN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Hay dos puertas y no son igual de importantes:
 *
 *   LA QUE MANDA es el servidor. Las ocho funciones del panel comprueban el
 *   correo del token verificado antes de mirar nada. Eso ya está probado en
 *   `pruebas/admin.mjs`, y es lo que hace que forzar la URL no sirva de nada:
 *   sin esa comprobación, esconder la pantalla sería pintar sobre la cerradura.
 *
 *   LA DE ACÁ es la pantalla. No protege datos —el servidor ya no se los da a
 *   nadie— sino que evita mostrarle a una cuenta cualquiera un panel lleno de
 *   botones que no va a poder usar, con nombres de secciones que le dicen qué
 *   existe del otro lado.
 *
 * Se prueba la segunda porque es barata de romper sin querer: alcanza una
 * regla de CSS con `display` para anular un `hidden`, y ya pasó en este mismo
 * proyecto con otro aviso.
 */

import { test, expect } from "@playwright/test";

const ADMIN = "soporte.memorie.legends@gmail.com";

/** Un `firebase.js` que contesta con la sesión que cada caso necesita. */
const firebaseCon = (usuario) => `
  export const app = {}; export const auth = {};
  export const db = {}; export const funciones = {};
  export const googleProvider = {};
  export const SUPPORT_EMAIL = ${JSON.stringify(ADMIN)};
  export function httpsCallable(){ return async () => ({ data: {} }); }
  export function onAuthStateChanged(a, fn){
    setTimeout(() => fn(${usuario ? JSON.stringify(usuario) : "null"}), 80);
    return () => {};
  }
  export async function signInWithEmailAndPassword(){}
  export async function signInWithPopup(){}
  export function signOut(){}
`;

const abrirComo = async (page, usuario) => {
  await page.route("**/js/firebase.js", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: firebaseCon(usuario) }));
  await page.goto("/admin/index.html");
  await page.waitForTimeout(600);
};

/**
 * Lo que se ve de verdad.
 *
 * No se mira el atributo `hidden` sino si el elemento OCUPA ESPACIO. Es la
 * diferencia entre comprobar lo que el código dijo y comprobar lo que la
 * persona ve: `hidden` es sólo un `display: none` de la hoja del navegador, y
 * cualquier regla de autor con `display` lo anula sin que nada avise.
 */
const seVe = (page, sel) =>
  page.locator(sel).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }).catch(() => false);

test("una cuenta cualquiera no ve el panel", async ({ page }) => {
  await abrirComo(page, { uid: "u1", email: "jugador@example.com" });

  expect(await seVe(page, "#panel"), "el panel se ve para una cuenta que no es la de soporte").toBe(false);
  await expect(page.locator("#avisoEntrar")).toContainText(/no es para esta cuenta/i);

  // Y no queda nada del panel en la página: ni los totales, ni los nombres de
  // las secciones, que solos ya cuentan qué hay del otro lado.
  const texto = await page.locator("body").innerText();
  for (const palabra of ["Leyendas retenidas", "Cuentas", "Reportes", "Partidas en curso"]) {
    expect(texto, `la palabra "${palabra}" quedó a la vista`).not.toContain(palabra);
  }
});

test("sin sesión tampoco", async ({ page }) => {
  await abrirComo(page, null);
  expect(await seVe(page, "#panel"), "el panel se ve sin ninguna sesión").toBe(false);
});

test("la cuenta de soporte sí lo ve", async ({ page }) => {
  // El otro lado de la prueba: una puerta que no deja pasar a nadie tampoco
  // sirve. Sin esto, romper el panel del todo pasaría por "arreglado".
  await abrirComo(page, { uid: "root", email: ADMIN });
  expect(await seVe(page, "#panel"), "la cuenta de soporte no puede ver su propio panel").toBe(true);
  expect(await seVe(page, "#entrar"), "le sigue mostrando el formulario de entrada").toBe(false);
});

test("el correo se compara entero, no por parecido", async ({ page }) => {
  // Un correo que CONTIENE el del administrador no es el del administrador.
  // Registrar `soporte.memorie.legends@gmail.com.attacker.com` es gratis.
  for (const correo of [
    "soporte.memorie.legends@gmail.com.atacante.com",
    "otro+soporte.memorie.legends@gmail.com",
    "soporte.memorie.legends@gmail.co",
  ]) {
    await abrirComo(page, { uid: "x", email: correo });
    expect(await seVe(page, "#panel"), `entró con ${correo}`).toBe(false);
  }
});

test("el mayúsculas/minúsculas no bloquea al administrador de verdad", async ({ page }) => {
  // Los correos no distinguen mayúsculas en la práctica, y Firebase los guarda
  // en minúsculas. Si la comparación fuera estricta, el administrador quedaría
  // afuera por escribir su propio correo con una mayúscula.
  await abrirComo(page, { uid: "root", email: "Soporte.Memorie.Legends@Gmail.com" });
  expect(await seVe(page, "#panel"), "rechaza al administrador por una mayúscula").toBe(true);
});


test("el panel pide el código cuando la cuenta tiene dos pasos", async ({ page }) => {
  // El fallo que arregla: la cuenta de soporte activó los dos pasos y el panel
  // no sabía pedirlos. `signInWithPopup` lanzaba
  // `auth/multi-factor-auth-required` —que no es un fallo sino la mitad del
  // camino— y la pantalla lo mostraba como "no pudimos entrar con Google".
  // El administrador quedaba afuera de su propio panel sin ninguna pista.
  await page.route("**/js/mfa.js", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: `
      export const necesitaSegundoPaso = (e) => e?.code === "auth/multi-factor-auth-required";
      export async function opcionesDeSegundoPaso(){
        return { resolucion: {}, metodos: [{ indice: 0, nombre: "Google Authenticator" }] };
      }
      export async function terminarConCodigo(){ return {}; }
    ` }));

  await page.route("**/js/firebase.js", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: `
      export const app={}; export const auth={}; export const db={}; export const funciones={};
      export const googleProvider={};
      export const SUPPORT_EMAIL=${JSON.stringify(ADMIN)};
      export function httpsCallable(){ return async () => ({ data: {} }); }
      export function onAuthStateChanged(a, fn){ setTimeout(() => fn(null), 80); return () => {}; }
      export async function signInWithEmailAndPassword(){}
      export async function signInWithPopup(){
        const e = new Error("mfa"); e.code = "auth/multi-factor-auth-required"; throw e;
      }
      export function signOut(){}
    ` }));

  await page.goto("/admin/index.html");
  await expect(page.locator("#btnGoogle")).toBeVisible({ timeout: 9000 });
  await expect(page.locator("#segundoPaso")).toBeHidden();

  await page.locator("#btnGoogle").click();

  await expect(page.locator("#segundoPaso"),
    "no pide el código: el administrador con dos pasos no puede entrar").toBeVisible({ timeout: 9000 });
  await expect(page.locator("#entrar"),
    "deja los dos formularios a la vista a la vez").toBeHidden();
  await expect(page.locator("#codigoMfa")).toBeVisible();

  // Y NO se muestra como un error, que era el fallo.
  await expect(page.locator("#avisoEntrar")).not.toContainText(/no pudimos/i);

  // Hay salida: quien no tenga el teléfono a mano puede volver.
  await page.locator("#btnVolverAdmin").click();
  await expect(page.locator("#entrar")).toBeVisible();
  await expect(page.locator("#segundoPaso")).toBeHidden();
});
