/**
 * Firebase Analytics: en un solo lugar, y sin poder romper nada.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE CARGA APARTE Y CON `import()`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Es el mismo patrón que `app-check.js`, y por el mismo motivo: medir no es
 * una dependencia del juego. `firebase-analytics.js` son ~40 KB más que bajar,
 * y un bloqueador de publicidad lo corta sin avisar — la petición a gstatic
 * falla o el `getAnalytics` revienta por dentro.
 *
 * Si eso pasa con un `import` estático, el módulo que lo importaba no evalúa,
 * y se lleva puesta la pantalla entera. Con `import()` y `catch`, lo único que
 * pasa es que no se mide. Que es exactamente lo que tiene que pasar.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DÓNDE SE ENCIENDE, Y DÓNDE NO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Lo enciende `firebase-nucleo.js`, que es el punto más hondo por el que pasa
 * toda página que use Firebase: login, registro, tablero, lobby, mesa, sala,
 * tienda, cuenta, ranking y el panel.
 *
 * NO se enciende en la portada sin sesión, ni en las páginas legales, y es a
 * propósito. `index.html` evita bajar Firebase —186 KB entre `firebase-app`,
 * `firebase-auth`, el iframe y `gapi`— cuando no hay sesión, y esa decisión
 * está medida. Colgar la analítica de ahí la desharía. O sea que hoy el
 * `page_view` de la portada de un visitante nuevo NO se registra: está
 * anotado al final de este archivo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LOS NOMBRES DE LOS EVENTOS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `login`, `sign_up` y `begin_checkout` son nombres RECOMENDADOS por GA4: los
 * entiende sin configurar nada y aparecen en los informes que vienen hechos.
 * `partida_jugada` es nuestro, porque no hay uno estándar para eso.
 *
 * `page_view` no está en esta lista porque no lo manda nadie a mano: lo
 * recolecta solo `getAnalytics()` al iniciarse, una vez por carga de página.
 */

/** La función real de Firebase, si llegó a cargar. */
let registrar = null;

/**
 * Lo que se pidió antes de que cargara.
 *
 * `encenderAnalitica` tarda lo que tarde la red, y mientras tanto una pantalla
 * puede querer anotar algo —un login es justamente de lo primero que pasa—.
 * Sin la cola, esos eventos se perderían callados.
 *
 * Tiene techo. Si la analítica nunca carga, esto no puede crecer para siempre
 * en una pestaña que queda abierta toda la tarde.
 */
const cola = [];
const TECHO_DE_COLA = 20;

/** Ya se intentó encender: no tiene sentido intentarlo dos veces. */
let intentado = false;

/**
 * Anota un evento. No falla nunca.
 *
 * Si la analítica no cargó todavía, se encola. Si no cargó nunca —bloqueador,
 * red caída, consentimiento del navegador— se descarta en silencio.
 */
export function anotar(evento, datos = {}) {
  try {
    if (registrar) registrar(evento, datos);
    else if (cola.length < TECHO_DE_COLA) cola.push([evento, datos]);
  } catch {
    // Medir no puede romper lo que se estaba midiendo.
  }
}

/**
 * Enciende la analítica. La llama `firebase-nucleo.js`, sin `await`.
 *
 * Devuelve `true` si quedó midiendo. El valor es para las pruebas y para
 * poder depurar a mano desde la consola; nadie lo usa para decidir nada.
 */
export async function encenderAnalitica(app) {
  if (intentado) return registrar !== null;
  intentado = true;

  try {
    const modulo = await import(
      "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js"
    );

    // `isSupported` existe porque Analytics NO anda en todos lados: hace falta
    // `indexedDB` y cookies, y en una ventana privada o con el almacenamiento
    // bloqueado no están. Sin esta pregunta, `getAnalytics` tira.
    if (!(await modulo.isSupported())) return false;

    const analitica = modulo.getAnalytics(app);
    registrar = (evento, datos) => modulo.logEvent(analitica, evento, datos);

    // Lo que se juntó mientras cargaba. Se vacía la cola aunque alguno falle.
    while (cola.length) {
      const [evento, datos] = cola.shift();
      try {
        registrar(evento, datos);
      } catch {
        // Un evento mal armado no puede impedir los que vienen detrás.
      }
    }

    return true;
  } catch {
    // El caso común y esperado: un bloqueador cortó gstatic. No se avisa por
    // consola a propósito — es ruido en la pantalla de alguien que eligió
    // bloquearlo, y no hay nada que hacer al respecto.
    return false;
  }
}
