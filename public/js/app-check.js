/**
 * App Check: que las Cloud Functions sólo le contesten a esta aplicación.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ RESUELVE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Hoy cualquiera con la clave web —que viaja en cada carga del sitio y NO es
 * un secreto— puede llamar a las funciones desde un script propio. El límite
 * de ritmo frena el bucle de una pestaña, pero no a alguien que se arma un
 * cliente para pedir salas en masa o llamar a la ruleta desde un servidor.
 *
 * App Check agrega una prueba de que el pedido sale de un navegador de verdad
 * cargando ESTE sitio. No reemplaza a la autenticación —quién sos lo sigue
 * diciendo el token— sino que responde otra pregunta: desde dónde.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ESTADO: MANDANDO TOKEN, PERO SIN EXIGIRLO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Con la clave puesta, cada navegador empieza a mandar el token. Lo que NO
 * pasa todavía es que el servidor lo exija: la consola está en modo
 * SUPERVISIÓN y `EXIGIR_APP_CHECK` sigue en `false` en functions/index.js.
 *
 * Los dos interruptores están apagados a propósito, y en este orden:
 *
 *   1. AHORA — los navegadores mandan token. La consola cuenta cuántos
 *      pedidos llegan con y sin él. Nada se rechaza.
 *   2. DESPUÉS — cuando los "sin token" sean cerca de cero, se exige.
 *
 * Ese paso 1 no es burocracia. Quien tenga la pestaña abierta desde antes de
 * este despliegue no manda token, y va a seguir sin mandarlo hasta que
 * recargue. Exigirlo el mismo día que se enciende deja afuera a toda esa
 * gente, con el saldo adentro. Por eso se mira primero y se exige después.
 *
 * Los pasos concretos están en `HACER-EN-LA-CONSOLA.md`.
 */

import { app } from "./firebase.js";

/**
 * La clave del sitio de reCAPTCHA Enterprise.
 *
 * Es PÚBLICA: va en el HTML de cualquier sitio que use reCAPTCHA y no protege
 * nada por sí sola. Lo que protege es que Google sólo emite tokens válidos
 * para los dominios registrados junto a esa clave. Ponerla acá está bien; lo
 * que no hay que poner nunca es la clave *secreta*, que vive en la consola y
 * nunca toca este repositorio.
 *
 * Vacía = App Check apagado.
 */
const CLAVE_RECAPTCHA = "6Lcd56UtAAAAAME1Ckf4zKXIY_CC8OaZ_t3Kffm-";

/**
 * Los dominios donde esta clave vale.
 *
 * Tienen que ser los MISMOS que estén autorizados junto a la clave en la
 * consola de reCAPTCHA. Fuera de ellos, Google no emite token: pedirlo igual
 * no protege nada y sí llena la consola de errores —`requestStorageAccess:
 * Permission denied` y compañía— que después hay que ir a descartar a mano
 * cada vez que se depura otra cosa.
 *
 * `localhost` NO está, a propósito. Para probar App Check en local hace falta
 * un token de depuración, que es un mecanismo aparte y que no conviene dejar
 * cableado en el repositorio: quien lo tenga puede hacerse pasar por la
 * aplicación desde cualquier lado.
 */
const DOMINIOS = ["memorie-legends.web.app", "memorie-legends.firebaseapp.com"];

/**
 * Enciende App Check si hay clave y estamos en un dominio autorizado.
 *
 * Se importa dinámicamente: el módulo de App Check son unos 20 KB que no
 * tienen por qué bajarse cuando esto no va a hacer nada.
 *
 * @returns true si quedó encendido.
 */
export async function encenderAppCheck() {
  if (!CLAVE_RECAPTCHA) return false;
  if (!DOMINIOS.includes(window.location.hostname)) return false;

  try {
    // ENTERPRISE, no v3. Son dos proveedores distintos del SDK y no son
    // intercambiables: una clave de Enterprise pasada a `ReCaptchaV3Provider`
    // no falla al construirse — falla después, al pedir el token, y desde
    // afuera se ve como "App Check no anda" sin decir por qué.
    const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import(
      "https://www.gstatic.com/firebasejs/10.7.1/firebase-app-check.js"
    );

    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(CLAVE_RECAPTCHA),
      // Renueva el token solo antes de que venza. Sin esto hay que pedirlo a
      // mano y una sesión larga —una partida de media hora— se queda sin.
      isTokenAutoRefreshEnabled: true,
    });

    // No hace falta tocar ninguna llamada: una vez inicializado, el SDK
    // adjunta la cabecera `X-Firebase-AppCheck` a cada `httpsCallable` y a
    // cada lectura de Firestore por su cuenta. El pedido de "aplicá el token
    // en cada llamada" ya está cumplido por el propio SDK.
    return true;
  } catch (error) {
    // Que App Check no arranque NO puede dejar a nadie afuera mientras esté en
    // modo monitoreo. Se anota y se sigue: si la aplicación estuviera en modo
    // obligatorio, las llamadas fallarían solas y con su propio mensaje.
    console.error("App Check no arrancó:", error);
    return false;
  }
}
