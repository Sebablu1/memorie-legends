/**
 * Genera la miniatura que se ve al compartir un enlace del juego.
 *
 *   node herramientas/tarjeta.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE DIBUJA CON EL NAVEGADOR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque así la tarjeta usa el logo, las fuentes y los dorados de verdad —los
 * mismos archivos y las mismas variables que el sitio— en vez de una copia a
 * ojo hecha en un editor de imágenes. El día que cambie el logo, se corre esto
 * y la tarjeta queda al día; con un PNG dibujado a mano, no se entera nadie.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ VIVE EN EL REPOSITORIO Y NO EN UN SCRIPT SUELTO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La primera versión de esta tarjeta se generó con un script de un solo uso
 * que después se borró. El resultado quedó en `public/img/`, pero la receta
 * no: nadie podía volver a generarla, ni saber qué logo se había usado, ni
 * comprobarlo. Estando acá, `pruebas/e2e/compartir.spec.js` puede afirmar de
 * dónde sale la imagen.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LAS TRES REGLAS DEL FORMATO
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   1200x630  es la proporción de las tarjetas grandes. Otra medida se ve
 *             recortada o con bandas a los costados.
 *   JPG       WhatsApp NO muestra WebP, que es el formato del resto del
 *             sitio. Ésta es la única imagen del sitio que es JPG, y es a
 *             propósito.
 *   <100 KB   por encima de unos pocos cientos de kilobytes, varios clientes
 *             se rinden y no muestran nada. La primera versión, en PNG,
 *             pesaba 551 KB y por eso se descartó.
 */

import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";

/** El logo que va en la tarjeta: el horizontal, con corona y laureles. */
export const LOGO = "img/memorie-legends3.png";

/** Dónde queda la miniatura, y con qué medidas. */
export const SALIDA = "public/img/compartir.jpg";
export const ANCHO = 1200;
export const ALTO = 630;

/**
 * La tarjeta, en HTML.
 *
 * Se sirve desde `public/` para que las rutas relativas del logo resuelvan
 * igual que en el sitio.
 */
const PLANTILLA = `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Playfair+Display:wght@700&display=swap" rel="stylesheet" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${ANCHO}px; height: ${ALTO}px; overflow: hidden; }
  .tarjeta {
    width: ${ANCHO}px; height: ${ALTO}px; position: relative;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 20px; padding: 54px 54px 104px;
    background:
      radial-gradient(circle at 50% 34%, rgba(212,168,67,0.24) 0%, rgba(212,168,67,0) 56%),
      linear-gradient(160deg, #0d0d10 0%, #05070b 55%, #0a0a0a 100%);
    font-family: "Inter", system-ui, sans-serif;
  }

  /* El marco y las esquinas doradas, como los de las cajas del juego. */
  .marco { position: absolute; inset: 22px; border: 2px solid rgba(212,168,67,0.34); border-radius: 18px; }
  .esquina { position: absolute; width: 48px; height: 48px; border: 3px solid #d4a843; }
  .e1 { top: 22px; left: 22px; border-right: 0; border-bottom: 0; border-radius: 18px 0 0 0; }
  .e2 { top: 22px; right: 22px; border-left: 0; border-bottom: 0; border-radius: 0 18px 0 0; }
  .e3 { bottom: 22px; left: 22px; border-right: 0; border-top: 0; border-radius: 0 0 0 18px; }
  .e4 { bottom: 22px; right: 22px; border-left: 0; border-top: 0; border-radius: 0 0 18px 0; }

  /* El logo manda: es lo único que se reconoce a tamaño de miniatura, cuando
     la tarjeta entra en un chat con 300px de ancho y el texto ya no se lee. */
  .logo { width: 500px; height: auto; filter: drop-shadow(0 0 50px rgba(212,168,67,0.55)); }

  .lema {
    font-family: "Playfair Display", Georgia, serif;
    font-size: 40px; color: #f0d060; text-align: center; line-height: 1.15;
  }
  .bajada { font-size: 22px; color: #b9c0cc; text-align: center; max-width: 830px; line-height: 1.45; }
  .sello {
    position: absolute; bottom: 52px; left: 50%; transform: translateX(-50%);
    display: flex; align-items: center; gap: 14px;
    font-size: 16px; letter-spacing: 3.4px; text-transform: uppercase; color: rgba(212,168,67,0.9);
  }
  .sello i { display: block; width: 46px; height: 1px; background: rgba(212,168,67,0.5); }
</style></head><body>
  <div class="tarjeta">
    <span class="marco"></span>
    <span class="esquina e1"></span><span class="esquina e2"></span>
    <span class="esquina e3"></span><span class="esquina e4"></span>
    <img class="logo" src="${LOGO}" alt="" />
    <p class="lema">Memoria, reflejos y estrategia</p>
    <p class="bajada">Cuatro cartas boca abajo. Mirás una sola. Lo demás depende de lo que puedas recordar.</p>
    <p class="sello"><i></i>memorie-legends.web.app<i></i></p>
  </div>
</body></html>`;

/** Un nombre poco probable: el archivo es temporal y vive dentro de `public/`. */
const TEMPORAL = "public/_tarjeta-generada.html";

async function generar() {
  writeFileSync(TEMPORAL, PLANTILLA, "utf8");
  const navegador = await chromium.launch();
  try {
    const pagina = await (
      await navegador.newContext({
        viewport: { width: ANCHO, height: ALTO },
        // Sin escalado: la captura tiene que medir exactamente lo que dicen
        // las etiquetas `og:image:width` y `og:image:height`.
        deviceScaleFactor: 1,
      })
    ).newPage();

    await pagina.goto(pathToFileURL(path.resolve(TEMPORAL)).href, {
      waitUntil: "networkidle",
    });
    // Un respiro para que las fuentes terminen de aplicarse: sin esto la
    // captura sale a veces con la tipografía de reserva.
    await pagina.waitForTimeout(700);

    await pagina.screenshot({ path: SALIDA, type: "jpeg", quality: 88 });
  } finally {
    await navegador.close();
    unlinkSync(TEMPORAL);
  }
}

await generar();
console.log(`miniatura escrita en ${SALIDA} (${ANCHO}x${ALTO}, desde ${LOGO})`);
