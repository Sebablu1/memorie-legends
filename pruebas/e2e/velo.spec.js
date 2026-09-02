/**
 * El login no parpadea.
 *
 * EL FALLO
 *
 * Firebase tarda en decir si hay sesión: lee IndexedDB y a veces sale a la
 * red. La página ya se dibujó para entonces, así que quien YA estaba adentro
 * veía el formulario de login un instante antes de que lo mandaran al panel.
 * Parecía que se le había cerrado la sesión.
 *
 * CÓMO SE PRUEBA QUE NO PARPADEA
 *
 * Un parpadeo dura uno o dos cuadros. Mirar la pantalla una vez, después, no
 * demuestra nada: para entonces ya pasó. Así que se vigila el velo en CADA
 * cuadro con `requestAnimationFrame` desde que la página existe, y se exige
 * que no haya ni uno solo en que se lo vea destapado.
 *
 * Se reemplaza `firebase.js` por uno falso, como hacen las pruebas del
 * tablero: no se puede pedirle a Firebase de verdad que tenga o no tenga
 * sesión, y menos que tarde lo mismo dos veces.
 */

import { test, expect } from "@playwright/test";

/**
 * Un `firebase.js` de mentira.
 *
 * El retraso de 300 ms es la parte importante: sin él, `onAuthStateChanged`
 * contestaría al instante y la prueba pasaría aunque el arreglo no estuviera,
 * porque el hueco donde ocurre el parpadeo es justamente esa espera.
 */
const firebaseFalso = (hayUsuario) => `
  export const auth = {}; export const db = {};
  export const googleProvider = {};
  export const SUPPORT_EMAIL = "soporte@x.com";
  export function onAuthStateChanged(a, fn) {
    setTimeout(() => fn(${
      hayUsuario
        ? '{ uid:"u1", email:"a@b.c", displayName:"Seba", providerData:[] }'
        : "null"
    }), 300);
    return () => {};
  }
  export function doc(){ return {}; }
  export async function getDoc(){ return { data: () => ({ username: "Seba" }) }; }
  export async function setDoc(){}
  export async function signInWithEmailAndPassword(){}
  export async function signInWithPopup(){}
  export async function sendPasswordResetEmail(){}
`;

const conFirebase = (page, hayUsuario) =>
  page.route("**/js/firebase.js", (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/javascript; charset=utf-8",
      body: firebaseFalso(hayUsuario),
    }));

test("sin sesión: el velo se va y aparece el formulario", async ({ page }) => {
  await conFirebase(page, false);
  await page.goto("/login.html");

  const velo = page.locator("#veloCarga");
  await expect(velo, "la página no arranca tapada: el parpadeo vuelve").toBeVisible();

  await expect(velo, "el velo no se fue: quien no tiene sesión queda encerrado")
    .toBeHidden({ timeout: 4000 });
  await expect(page.locator("#loginForm")).toBeVisible();
  await expect(page.locator(".google-btn")).toBeVisible();
});

test("con sesión: el formulario no llega a verse en ningún cuadro", async ({ page }) => {
  await conFirebase(page, true);

  const cuadros = [];
  await page.exposeFunction("anotarVelo", (v) => cuadros.push(v));

  // `commit` y no `load`: hay que empezar a mirar apenas existe el documento,
  // no cuando terminó de cargar todo. Para entonces el parpadeo ya pasó.
  await page.goto("/login.html", { waitUntil: "commit" });
  await page
    .evaluate(() => {
      const mirar = () => {
        const v = document.getElementById("veloCarga");
        if (v) window.anotarVelo(getComputedStyle(v).visibility);
        requestAnimationFrame(mirar);
      };
      mirar();
    })
    .catch(() => {
      // La navegación al panel corta la evaluación a mitad. Es lo esperado.
    });

  await page.waitForURL(/dashboard\.html/, { timeout: 8000 });

  expect(cuadros.length, "no se llegó a mirar ni un cuadro").toBeGreaterThan(0);
  expect(
    cuadros.filter((v) => v === "hidden").length,
    "el velo se destapó en algún cuadro: el formulario se vio",
  ).toBe(0);
});

test("si Firebase no contesta, el velo igual se va", async ({ page }) => {
  // El riesgo del arreglo: un velo que tapa por defecto y que sólo quita el
  // JavaScript deja a la persona mirando una pantalla muerta si Firebase no
  // carga. Es peor que el parpadeo. Por eso hay un plazo de rendición.
  await page.route("**/js/firebase.js", (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/javascript; charset=utf-8",
      // Nunca llama a la función: la sesión no se resuelve jamás.
      body: `
        export const auth = {}; export const db = {};
        export const googleProvider = {};
        export const SUPPORT_EMAIL = "soporte@x.com";
        export function onAuthStateChanged(){ return () => {}; }
        export function doc(){ return {}; }
        export async function getDoc(){ return { data: () => ({}) }; }
        export async function setDoc(){}
        export async function signInWithEmailAndPassword(){}
        export async function signInWithPopup(){}
        export async function sendPasswordResetEmail(){}
      `,
    }));

  await page.goto("/login.html");
  await expect(page.locator("#veloCarga")).toBeVisible();

  // Se rinde a los 5 s. Con margen, porque el reloj de la máquina que corre
  // esto no es el nuestro.
  await expect(page.locator("#veloCarga"), "el velo dejó a la persona encerrada")
    .toBeHidden({ timeout: 9000 });
  await expect(page.locator("#loginForm")).toBeVisible();
  await expect(page.locator("#mensaje")).toContainText(/sesión/i);
});
