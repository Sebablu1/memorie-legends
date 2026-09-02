/**
 * La verificación en dos pasos: el QR y el segundo paso del login.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE DECODIFICA EL QR EN VEZ DE MIRARLO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Una prueba que compruebe "hay un canvas y no está en blanco" pasa con
 * cualquier mancha. Y un QR que no escanea se ve exactamente igual que uno que
 * sí: cuadrados negros sobre blanco. La única forma de saberlo es leerlo, así
 * que la prueba lee los píxeles del canvas y los pasa por un decodificador de
 * verdad —el mismo trabajo que hace la cámara de un teléfono—.
 *
 * Lo que se afirma es lo que le importa a la persona: que si apunta la cámara,
 * su aplicación reciba EXACTAMENTE la URI que le corresponde a su cuenta. Un
 * QR bien dibujado con la URI equivocada la deja con códigos que no sirven, y
 * eso no se descubre hasta el próximo login.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE FALSEA `mfa.js` Y NO FIREBASE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Generar un secreto de verdad necesita una cuenta de verdad con el correo
 * verificado y una llamada a Identity Platform. Nada de eso puede correr en
 * una suite que se ejecuta sola. Lo que sí se puede probar —y es lo que se
 * rompe— es lo que la pantalla HACE con el secreto que recibe.
 */

import { test, expect } from "@playwright/test";
import jsQR from "jsqr";

/** Una URI otpauth de las de verdad, con los mismos campos que arma Firebase. */
const URI =
  "otpauth://totp/Memorie%20Legends:probador@example.com" +
  "?secret=JBSWY3DPEHPK3PXP&issuer=Memorie%20Legends&algorithm=SHA1&digits=6&period=30";

const CLAVE = "JBSWY3DPEHPK3PXP";

const SESION = `
  export const COLECCION="users"; export const CAMPO_SALDO="credits";
  export async function exigirSesion(){return{usuario:{uid:"u1"},
    perfil:{uid:"u1",nombre:"Probador",saldo:500,partidas:0,victorias:0,ultimoGiro:0,ultimoBono:0}};}
  export function mostrarSaldo(){} export function conectarBotonSalir(){}`;

/**
 * Un `mfa.js` de mentira: correo verificado, sin factores puestos, y un
 * secreto fijo. Todo lo demás de la pantalla es el código real.
 */
const MFA = `
  export class ErrorMfa extends Error {
    constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; }
  }
  export async function estadoMfa(){
    return { activo: false, factores: [], correoVerificado: true };
  }
  export async function verificarCorreo(){}
  export async function empezarInscripcion(){
    return { secreto: {}, clave: ${JSON.stringify(CLAVE)}, uri: ${JSON.stringify(URI)} };
  }
  export async function confirmarInscripcion(){ return true; }
  export async function quitarFactor(){ return true; }
  export const necesitaSegundoPaso = (e) => e?.code === "auth/multi-factor-auth-required";
  export async function opcionesDeSegundoPaso(){
    return { resolucion: {}, metodos: [{ indice: 0, nombre: "Google Authenticator" }] };
  }
  export async function terminarConCodigo(){ return {}; }
`;

const FIREBASE = `
  export const app = {}; export const auth = { currentUser: { reload: async () => {} } };
  export const db = {}; export const googleProvider = {};
  export const SUPPORT_EMAIL = "soporte@x.com";
  export function onAuthStateChanged(a, fn){ setTimeout(() => fn(null), 60); return () => {}; }
  export function doc(){ return {}; }
  export async function getDoc(){ return { data: () => ({ username: "Probador" }) }; }
  export async function setDoc(){}
  export async function signInWithEmailAndPassword(){
    const e = new Error("mfa"); e.code = "auth/multi-factor-auth-required"; throw e;
  }
  export async function signInWithPopup(){}
  export async function sendPasswordResetEmail(){}
`;

const servir = (page, ruta, cuerpo) =>
  page.route(ruta, (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: cuerpo }));

test("el QR de la pantalla es escaneable y lleva la URI correcta", async ({ page }) => {
  await servir(page, "**/js/sesion.js", SESION);
  await servir(page, "**/js/mfa.js", MFA);
  // También el de Firebase: el real inicializa App Check, que sale a pedirle un
  // token a Google. En una prueba eso es una dependencia de red que no aporta
  // nada y que cuelga la pantalla cuando el dominio de la prueba no está
  // autorizado —que es exactamente lo que pasa con `localhost`—.
  await servir(page, "**/js/firebase.js", FIREBASE);

  await page.goto("/cuenta.html");
  await expect(page.locator("#pasoActivar")).toBeVisible({ timeout: 15_000 });

  await page.locator("#btnActivarMfa").click();
  await expect(page.locator("#pasoConfirmar")).toBeVisible();

  // Los píxeles del canvas, tal cual los ve una cámara.
  const imagen = await page.locator("#qr").evaluate((canvas) => {
    const ctx = canvas.getContext("2d");
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { datos: Array.from(d.data), ancho: d.width, alto: d.height };
  });

  expect(imagen.ancho, "el canvas quedó sin dibujar").toBeGreaterThan(50);

  const leido = jsQR(new Uint8ClampedArray(imagen.datos), imagen.ancho, imagen.alto);

  expect(leido, "el QR dibujado NO se puede decodificar: nadie lo va a poder escanear")
    .not.toBeNull();
  expect(leido.data, "el QR lleva otra cosa que la URI de esta cuenta").toBe(URI);

  // Y la salida para quien no puede escanear dice lo mismo.
  await expect(page.locator("#claveSecreta")).toHaveText(CLAVE);
  await expect(page.locator("#enlaceOtp")).toHaveAttribute("href", URI);
});

test("el QR se dibuja con margen claro alrededor", async ({ page }) => {
  // La "zona tranquila" son cuatro módulos en blanco. Sin ella un lector no
  // encuentra dónde empieza el código, y sobre una página oscura es peor
  // todavía. Se comprueba mirando que las esquinas del canvas sean blancas.
  await servir(page, "**/js/sesion.js", SESION);
  await servir(page, "**/js/mfa.js", MFA);
  await servir(page, "**/js/firebase.js", FIREBASE);

  await page.goto("/cuenta.html");
  await expect(page.locator("#pasoActivar")).toBeVisible({ timeout: 15_000 });
  await page.locator("#btnActivarMfa").click();
  await expect(page.locator("#pasoConfirmar")).toBeVisible();

  const esquinas = await page.locator("#qr").evaluate((canvas) => {
    const ctx = canvas.getContext("2d");
    const leer = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3);
    return {
      arribaIzq: leer(2, 2),
      arribaDer: leer(canvas.width - 3, 2),
      abajoIzq: leer(2, canvas.height - 3),
      abajoDer: leer(canvas.width - 3, canvas.height - 3),
    };
  });

  for (const [donde, color] of Object.entries(esquinas)) {
    expect(color, `la esquina ${donde} no es blanca: falta el margen del QR`)
      .toEqual([255, 255, 255]);
  }
});

test("el login pide el código cuando la cuenta tiene dos pasos", async ({ page }) => {
  await servir(page, "**/js/firebase.js", FIREBASE);
  await servir(page, "**/js/mfa.js", MFA);

  await page.goto("/login.html");
  await expect(page.locator("#loginForm")).toBeVisible({ timeout: 9000 });

  // Antes de entrar, el segundo paso no está a la vista.
  await expect(page.locator("#segundoPaso")).toBeHidden();

  await page.locator("#email").fill("probador@example.com");
  await page.locator("#password").fill("cualquiera");
  await page.locator("#loginForm button[type=submit]").click();

  // `auth/multi-factor-auth-required` no es un fallo: es la mitad del camino.
  // Lo que NO puede pasar es que se muestre como "contraseña incorrecta".
  await expect(page.locator("#segundoPaso")).toBeVisible({ timeout: 9000 });
  await expect(page.locator("#primerPaso"),
    "el formulario sigue a la vista: invita a reintentar y se pierde la resolución")
    .toBeHidden();
  await expect(page.locator("#codigoMfa")).toBeVisible();
  await expect(page.locator("#mensaje")).not.toContainText(/incorrect/i);

  // Y hay salida: quien no tenga el teléfono a mano puede volver.
  await page.locator("#btnVolverAlLogin").click();
  await expect(page.locator("#primerPaso")).toBeVisible();
  await expect(page.locator("#segundoPaso")).toBeHidden();
});
