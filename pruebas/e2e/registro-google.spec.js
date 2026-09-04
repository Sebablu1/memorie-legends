/**
 * Crear cuenta con Google, desde la pantalla de registro.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE DE VERDAD HAY QUE DEFENDER ACÁ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * "Crear cuenta con Google" también deja entrar a quien YA tiene cuenta: es el
 * mismo botón y Google no distingue registrarse de iniciar sesión. Así que por
 * este camino va a pasar gente con partidas jugadas y con Leyendas compradas.
 *
 * Un `setDoc` a secas les pondría el saldo en 100 y las partidas en cero. A
 * alguien con 2.500 Leyendas eso le borra lo que pagó, y no se entera: entra,
 * ve un número más chico y no entiende por qué.
 *
 * Por eso la prueba central no es "el botón anda" sino "a quien ya tenía
 * cuenta no se le toca nada".
 */

import { test, expect } from "@playwright/test";

/**
 * Un `firebase.js` de mentira que además ANOTA lo que se le pidió.
 *
 * Las llamadas se mandan AFUERA del navegador con `anotar`, no a una variable
 * de `window`. El primer intento las guardaba en `window.__firestore` y las
 * pruebas fallaban sin motivo aparente: al terminar, la pantalla navega al
 * panel, y esa navegación se lleva puesto el `window` entero con todo lo
 * anotado. Afuera sobreviven.
 *
 * Poder ver lo anotado es lo que permite afirmar que algo NO pasó, que es
 * justo lo que hay que comprobar acá.
 */
const firebaseCon = ({ perfilExistente }) => `
  export const app = {}; export const db = {};
  export const auth = { currentUser: null };
  export const googleProvider = {};
  export const SUPPORT_EMAIL = "soporte@x.com";

  export function doc(_db, coleccion, id) { return { coleccion, id }; }

  export async function getDoc(ref) {
    window.anotar("lectura", ref);
    const existe = ${perfilExistente ? "true" : "false"};
    return {
      exists: () => existe,
      data: () => (${perfilExistente
        ? '{ username: "Veterano", credits: 2500, gamesPlayed: 87, wins: 40 }'
        : "undefined"}),
    };
  }

  export async function setDoc(ref, datos) {
    window.anotar("escritura", { ref, datos });
  }

  export async function signInWithPopup() {
    return { user: {
      uid: "u1", email: "jugador@example.com", displayName: "Jugador Nuevo",
      providerData: [{ providerId: "google.com" }],
    } };
  }

  export async function createUserWithEmailAndPassword() { return { user: { uid: "u1" } }; }
  export function onAuthStateChanged() { return () => {}; }
`;

/**
 * Abre el registro y devuelve el cuaderno donde quedan anotadas las llamadas.
 *
 * `exposeFunction` sobrevive a la navegación al panel, así que lo anotado se
 * puede leer después de que la pantalla ya se fue.
 */
const abrir = async (page, opciones) => {
  const llamadas = { lecturas: [], escrituras: [] };
  await page.exposeFunction("anotar", (tipo, datos) => {
    (tipo === "lectura" ? llamadas.lecturas : llamadas.escrituras).push(datos);
  });
  await page.route("**/js/firebase.js", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: firebaseCon(opciones) }));
  await page.goto("/register.html");
  await expect(page.locator("#registerForm")).toBeVisible({ timeout: 9000 });
  return llamadas;
};

test("el botón está, con el logo entero y el texto que corresponde", async ({ page }) => {
  await abrir(page, { perfilExistente: false });

  const boton = page.locator("#googleBtn");
  await expect(boton).toBeVisible();
  await expect(boton).toContainText(/crear cuenta con google/i);

  // Los cuatro trazados del logo de Google. La guía de marca los fija, y un
  // copiado a mano es la forma más fácil de perder uno y que quede un logo
  // de tres colores.
  await expect(boton.locator("svg path")).toHaveCount(4);

  // Y el separador, para que se lea como dos caminos y no como dos pasos.
  await expect(page.locator(".or-divider")).toBeVisible();
});

test("una cuenta nueva recibe su perfil con las Leyendas de regalo", async ({ page }) => {
  const llamadas = await abrir(page, { perfilExistente: false });
  await page.locator("#googleBtn").click();
  await page.waitForURL(/dashboard\.html/, { timeout: 9000 });

  expect(llamadas.escrituras.length, "no se creó el perfil").toBe(1);

  const d = llamadas.escrituras[0].datos;
  expect(llamadas.escrituras[0].ref.coleccion).toBe("users");
  expect(d.credits, "las Leyendas de bienvenida").toBe(100);
  expect(d.gamesPlayed).toBe(0);
  expect(d.wins).toBe(0);
  expect(d.email).toBe("jugador@example.com");
  expect(d.username).toBe("Jugador Nuevo");
  expect(d.provider).toBe("google.com");
  expect(typeof d.createdAt).toBe("string");
});

test("a quien YA tenía cuenta no se le toca el saldo", async ({ page }) => {
  // Ésta es la prueba que importa. Un `setDoc` sin mirar antes le pondría el
  // saldo en 100 a alguien que tiene 2.500, y le borraría 87 partidas.
  const llamadas = await abrir(page, { perfilExistente: true });
  await page.locator("#googleBtn").click();
  await page.waitForURL(/dashboard\.html/, { timeout: 9000 });

  expect(llamadas.lecturas.length, "ni siquiera leyó el perfil antes de decidir")
    .toBeGreaterThan(0);
  expect(
    llamadas.escrituras.length,
    "ESCRIBIÓ sobre un perfil que ya existía: le borra el saldo y las partidas",
  ).toBe(0);
});

test("si se cierra la ventana de Google, se puede reintentar", async ({ page }) => {
  await page.route("**/js/firebase.js", (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/javascript; charset=utf-8",
      body: `
        export const app={}; export const db={}; export const auth={};
        export const googleProvider={}; export const SUPPORT_EMAIL="soporte@x.com";
        export function doc(){ return {}; }
        export async function getDoc(){ return { exists: () => false }; }
        export async function setDoc(){}
        export async function signInWithPopup(){
          const e = new Error("cerrada"); e.code = "auth/popup-closed-by-user"; throw e;
        }
        export async function createUserWithEmailAndPassword(){ return { user: {} }; }
        export function onAuthStateChanged(){ return () => {}; }
      `,
    }));
  await page.goto("/register.html");
  await expect(page.locator("#registerForm")).toBeVisible({ timeout: 9000 });

  await page.locator("#googleBtn").click();
  await expect(page.locator("#mensaje")).toContainText(/ventana de google/i);

  // Y el botón vuelve a servir: un fallo que deja el botón muerto obliga a
  // recargar, y quien no lo sepa cree que el registro está roto.
  await expect(page.locator("#googleBtn")).toBeEnabled();
});

test("se ve bien en las tres pantallas", async ({ page }) => {
  // Sin `abrir()`: ésa registra `anotar` con `exposeFunction`, que sólo admite
  // un registro por página, y acá se recarga cuatro veces. Además no hace
  // falta anotar nada — lo que se mide es geometría.
  await page.route("**/js/firebase.js", (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/javascript; charset=utf-8",
      body: `
        export const app={}; export const db={}; export const auth={};
        export const googleProvider={}; export const SUPPORT_EMAIL="soporte@x.com";
        export function doc(){ return {}; }
        export async function getDoc(){ return { exists: () => false }; }
        export async function setDoc(){}
        export async function signInWithPopup(){ return { user: { uid:"u1" } }; }
        export async function createUserWithEmailAndPassword(){ return { user: {} }; }
        export function onAuthStateChanged(){ return () => {}; }
      `,
    }));

  for (const [donde, ancho] of [["PC", 1280], ["tablet", 768], ["móvil", 390], ["chico", 320]]) {
    await page.setViewportSize({ width: ancho, height: 860 });
    await page.goto("/register.html");
    await expect(page.locator("#registerForm")).toBeVisible({ timeout: 9000 });

    const m = await page.locator("#googleBtn").evaluate((b) => {
      const r = b.getBoundingClientRect();
      const svg = b.querySelector("svg").getBoundingClientRect();
      const t = [...b.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      const rango = document.createRange();
      rango.selectNodeContents(t);
      return {
        lineas: rango.getClientRects().length,
        logo: [Math.round(svg.width), Math.round(svg.height)],
        sobra: Math.round(r.right - rango.getBoundingClientRect().right - parseFloat(getComputedStyle(b).paddingRight)),
        pagina: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });

    // El mismo logo cuadrado y el mismo texto en una línea que en el login: si
    // los estilos compartidos se rompen, se rompen para los dos.
    expect(m.logo[0], `a ${donde} el logo es un óvalo: ${m.logo}`).toBe(m.logo[1]);
    expect(m.lineas, `a ${donde} el texto se parte en ${m.lineas} líneas`).toBe(1);
    expect(m.sobra, `a ${donde} el texto se sale del botón`).toBeGreaterThanOrEqual(0);
    expect(m.pagina, `a ${donde} el registro desborda a lo ancho`).toBeLessThanOrEqual(0);
  }
});
