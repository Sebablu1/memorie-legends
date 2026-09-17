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
 * cliente para pedir salas en masa o llamar a las funciones desde un servidor.
 *
 * App Check agrega una prueba de que el pedido sale de un navegador de verdad
 * cargando ESTE sitio. No reemplaza a la autenticación —quién sos lo sigue
 * diciendo el token— sino que responde otra pregunta: desde dónde.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ESTADO: APAGADO EN EL CLIENTE, PORQUE NADIE LO EXIGE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El plan era encenderlo en dos pasos: primero que los navegadores mandaran
 * token sin que el servidor lo exigiera, para mirar en la consola cuántos
 * llegaban sin él, y después exigirlo.
 *
 * El primer paso resultó tener un costo que no estaba en la cuenta, y lo
 * pagaba el juego: ver `MANDAR_TOKEN`, abajo. Mientras el servidor no lo
 * exija, el cliente no lo pide. Cuando se decida exigirlo, los dos se
 * encienden juntos — una prueba vigila que no se separen.
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
 * ¿El navegador pide token? Hoy, NO — y va atado a `EXIGIR_APP_CHECK`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE COSTABA PEDIRLO SIN QUE NADIE LO EXIJA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Una vez inicializado, el SDK de Firebase no manda NINGUNA llamada —ni a las
 * funciones ni, para el caso, a Firestore— hasta tener una respuesta sobre el
 * token. En un navegador donde reCAPTCHA funciona eso es casi nada. En uno
 * donde no, es la partida entera:
 *
 *   - La consola de un jugador real estaba llena de
 *     `appCheck/recaptcha-error`, una vez por llamada, y en los registros del
 *     servidor sus pedidos llegaban con `"app": "MISSING"`. Los de su rival,
 *     en la misma partida y el mismo segundo, con `"VALID"`: la clave anda,
 *     lo que falla es ese navegador.
 *
 *   - Reproducido bloqueando el iframe de reCAPTCHA, como hace una extensión
 *     de privacidad o el bloqueo de almacenamiento de terceros
 *     (`requestStorageAccess: Permission denied` aparece solo): los dos
 *     primeros pedidos de token quedaron COLGADOS más de veinte segundos
 *     cada uno, y los siguientes fallan igual. Esa falla, a diferencia de
 *     un 403, el SDK no la frena: la reintenta en cada llamada.
 *
 * Mientras el servidor no lo exige, ese token no protege nada — el servidor
 * lo recibe y lo ignora. Era todo costo: las primeras jugadas de la partida
 * esperando decenas de segundos antes de salir, en los navegadores
 * justamente de quienes cuidan su privacidad. Y de paso, en TODAS las
 * páginas, los 345 KB de reCAPTCHA y sus 770 ms de hilo principal.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ATADO AL SERVIDOR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Las dos combinaciones con sentido son «ninguno» y «los dos». Servidor
 * exigiendo con este apagado dejaría afuera a todo el mundo, con el saldo
 * adentro; éste encendido con el servidor sin exigir es lo que acaba de
 * describirse. `pruebas/app-check.mjs` compara los dos valores.
 *
 * Antes de encender los dos, hay que resolver qué pasa con los navegadores
 * donde reCAPTCHA no anda: exigirlo así los deja afuera. Ver
 * `HACER-EN-LA-CONSOLA.md` y `PENDIENTE.md`.
 */
const MANDAR_TOKEN = false;

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
/**
 * Los dominios donde App Check se enciende.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ES UNA LISTA DE INCLUIDOS, Y POR ESO HAY QUE ACORDARSE DE ELLA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `encenderAppCheck` devuelve `false` en cualquier hostname que no esté acá,
 * y lo hace EN SILENCIO — que es lo correcto para `localhost`, donde no hay
 * clave de reCAPTCHA que valga.
 *
 * El costo es que un dominio nuevo nace sin App Check y nada avisa. Pasó con
 * `memorielegends.com`: el sitio ya servía desde ahí y App Check estaba
 * apagado, invisible, hasta que alguien mirara esta lista. El día que App
 * Check pase a modo obligatorio, un dominio olvidado acá deja de funcionar
 * entero.
 *
 * Si se agrega un dominio al sitio, va también en la consola de Firebase —
 * ver `HACER-EN-LA-CONSOLA.md`.
 */
const DOMINIOS = [
  "memorielegends.com",
  "www.memorielegends.com",
  // El de Firebase sigue sirviendo el sitio y sigue siendo válido.
  "memorie-legends.web.app",
  "memorie-legends.firebaseapp.com",
];

/**
 * Las páginas que NO necesitan App Check.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTA LISTA EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * App Check protege las llamadas al servidor. Una página que no hace ninguna
 * no gana nada con él, y sí paga: reCAPTCHA son 345 KB que además hay que
 * ejecutar. Medido en la portada, esa carga sola era 770 ms de hilo principal
 * bloqueado y la diferencia entre 69 y 87 puntos de Lighthouse en móvil.
 *
 * La portada es la única página del sitio que carga Firebase y usa sólo
 * `onAuthStateChanged` — mirar si hay sesión para mandar al panel. No lee
 * Firestore y no llama a ninguna función. Se comprobó una por una: todas las
 * demás que cargan JavaScript tocan una cosa o la otra, y las legales no
 * cargan ninguno.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ES UNA LISTA DE EXCLUIDOS, NO DE INCLUIDOS, Y ESO IMPORTA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Al revés —una lista de páginas que SÍ lo llevan— una pantalla nueva nacería
 * sin App Check, y el día que se ponga en modo obligatorio sus llamadas
 * fallarían sin que nadie entendiera por qué. Así, una pantalla nueva lo lleva
 * por omisión: lo peor que puede pasar es que cargue 345 KB de más, que se
 * nota y se arregla. Olvidarse al revés no se nota hasta que rompe.
 */
const SIN_APP_CHECK = new Set(["/", "/index.html"]);

/**
 * Enciende App Check si hay clave y estamos en un dominio autorizado.
 *
 * Se importa dinámicamente: el módulo de App Check son unos 20 KB que no
 * tienen por qué bajarse cuando esto no va a hacer nada.
 *
 * @returns true si quedó encendido.
 */
export async function encenderAppCheck() {
  // Primero, antes que la clave y el dominio: sin esto, ni el SDK de App Check
  // ni reCAPTCHA se bajan. Ver `MANDAR_TOKEN`.
  if (!MANDAR_TOKEN) return false;
  if (!CLAVE_RECAPTCHA) return false;
  if (!DOMINIOS.includes(window.location.hostname)) return false;
  if (SIN_APP_CHECK.has(window.location.pathname)) return false;

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
