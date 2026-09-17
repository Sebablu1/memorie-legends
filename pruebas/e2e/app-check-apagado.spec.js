/**
 * Con el servidor sin exigir App Check, el navegador no lo baja ni lo pide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Una vez inicializado App Check, el SDK de Firebase no manda ninguna llamada
 * hasta tener respuesta sobre el token. La consola de un jugador real estaba
 * llena de `appCheck/recaptcha-error`, una vez por llamada; reproducido
 * bloqueando el iframe de reCAPTCHA —como una extensión de privacidad—, los
 * dos primeros pedidos de token quedaron colgados más de veinte segundos cada
 * uno. Y el servidor no lo exigía: era todo costo.
 *
 * `pruebas/app-check.mjs` compara el interruptor del cliente con el del
 * servidor leyendo el código. Esto mira lo que PASA: una página servida desde
 * el dominio de producción —donde App Check sí se encendería— no pide ni el
 * SDK de App Check ni nada de reCAPTCHA.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CÓMO, SIN SALIR A LA RED
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Todo lo de `memorielegends.com` se contesta desde acá: la página de prueba,
 * `app-check.js` tal como está en el disco, y un `firebase.js` de mentira que
 * sólo exporta `app`, que es lo único que `app-check.js` le pide. Los pedidos
 * a gstatic y a reCAPTCHA se anotan y se contestan o se cortan, así que la
 * prueba no depende de internet.
 */

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const js = (body) => ({ status: 200, contentType: "text/javascript; charset=utf-8", body });

const PRODUCCION = "https://memorielegends.com";

const PAGINA = `<!doctype html><meta charset="utf-8"><script type="module">
  import { encenderAppCheck } from "/js/app-check.js";
  window.__encendido = await encenderAppCheck();
</script>`;

/** Un SDK de App Check de mentira, por si algo lo pide: así se sabe que lo pidió. */
const SDK_FALSO = `
  export function initializeAppCheck() { return {}; }
  export class ReCaptchaEnterpriseProvider { constructor(clave) { this.clave = clave; } }
`;

async function abrirEnProduccion(page) {
  const pedidos = { sdk: [], recaptcha: [] };

  await page.route("**/js/firebase.js", (r) => r.fulfill(js("export const app = {};")));
  // Ruta desde la raíz del proyecto, que es desde donde corre Playwright. Con
  // `import.meta.url` no se puede: los specs se cargan como CommonJS.
  await page.route(`${PRODUCCION}/js/app-check.js`, (r) =>
    r.fulfill(js(readFileSync("public/js/app-check.js", "utf8"))),
  );
  await page.route(`${PRODUCCION}/prueba-app-check.html`, (r) =>
    r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PAGINA }),
  );
  await page.route("**/firebase-app-check.js", (r) => {
    pedidos.sdk.push(r.request().url());
    return r.fulfill(js(SDK_FALSO));
  });
  await page.route(/recaptcha/, (r) => {
    pedidos.recaptcha.push(r.request().url());
    return r.abort();
  });

  await page.goto(`${PRODUCCION}/prueba-app-check.html`);
  await page.waitForFunction(() => window.__encendido !== undefined);
  return pedidos;
}

test("en el dominio de producción, App Check no se enciende", async ({ page }) => {
  await abrirEnProduccion(page);

  expect(await page.evaluate(() => window.__encendido)).toBe(false);
});

test("y no se baja ni el SDK de App Check ni reCAPTCHA", async ({ page }) => {
  /**
   * Lo que de verdad importa: sin el SDK no hay nada que espere un token, y
   * sin reCAPTCHA no hay iframe que un navegador pueda bloquear. De paso, son
   * 345 KB y unos 770 ms de hilo principal menos en cada página.
   */
  const pedidos = await abrirEnProduccion(page);

  expect(pedidos.sdk, "se pidió el SDK de App Check").toEqual([]);
  expect(pedidos.recaptcha, "se pidió algo de reCAPTCHA").toEqual([]);
});
