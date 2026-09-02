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
 * POR QUÉ ARRANCA APAGADO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Sin `CLAVE_RECAPTCHA` puesta, este archivo no hace absolutamente nada. Es a
 * propósito y es lo más importante que hay que entender de acá:
 *
 * Si se inicializara con una clave inventada, el SDK pediría un token, no lo
 * conseguiría, y —una vez que la aplicación esté en modo obligatorio— TODAS
 * las llamadas empezarían a fallar. Todo el mundo afuera del juego, con el
 * saldo adentro. Es la clase de cambio que se ve bien en el editor y rompe la
 * producción entera en el primer minuto.
 *
 * Así que el orden es: primero se registra el sitio en la consola y se pega la
 * clave acá; después se mira una semana de métricas para ver cuántos pedidos
 * llegan sin token; y sólo entonces se pone en obligatorio, que es un
 * interruptor de la consola y del servidor, no de este archivo.
 *
 * Los pasos concretos están en `HACER-EN-LA-CONSOLA.md`.
 */

import { app } from "./firebase.js";

/**
 * La clave del sitio de reCAPTCHA v3 (o Enterprise).
 *
 * Es PÚBLICA: va en el HTML de cualquier sitio que use reCAPTCHA y no protege
 * nada por sí sola. Lo que protege es que Google sólo emite tokens válidos
 * para los dominios que estén registrados junto a esa clave. Ponerla acá está
 * bien; lo que no hay que poner nunca es la clave *secreta*, que vive en la
 * consola y nunca toca este repositorio.
 *
 * Vacía = App Check apagado. Ver la nota de arriba.
 */
const CLAVE_RECAPTCHA = "";

/**
 * Enciende App Check si hay clave. Si no, se va sin hacer nada.
 *
 * Se importa dinámicamente: el módulo de App Check son unos 20 KB que no
 * tienen por qué bajarse mientras esto esté apagado.
 *
 * @returns true si quedó encendido.
 */
export async function encenderAppCheck() {
  if (!CLAVE_RECAPTCHA) return false;

  try {
    const { initializeAppCheck, ReCaptchaV3Provider } = await import(
      "https://www.gstatic.com/firebasejs/10.7.1/firebase-app-check.js"
    );

    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(CLAVE_RECAPTCHA),
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
