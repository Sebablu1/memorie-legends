/**
 * Mide la carga de la portada como la mide PageSpeed en un teléfono, pero acá
 * y las veces que haga falta.
 *
 *   node herramientas/medir-portada.mjs                  public/, 5 cargas
 *   node herramientas/medir-portada.mjs --carpeta X      otra copia de public/
 *   node herramientas/medir-portada.mjs --veces 7
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PARA QUÉ, SI YA EXISTE PAGESPEED
 * ─────────────────────────────────────────────────────────────────────────
 *
 * PageSpeed mide lo que está publicado, una vez, y de una corrida a la otra
 * el mismo sitio cambia dos o tres décimas. Con eso no se puede saber si un
 * cambio mejoró algo antes de publicarlo, ni si una décima de diferencia es
 * del cambio o del azar.
 *
 * Esto mide una carpeta cualquiera —la de hoy, o una versión vieja sacada con
 * `git archive`— en las mismas condiciones cada vez, varias veces, y da la
 * mediana. Sirve para COMPARAR. El número absoluto no es el de PageSpeed:
 * PageSpeed simula la red y esto la frena de verdad, en esta máquina.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LAS CONDICIONES
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Las del teléfono de PageSpeed: Moto G Power, 412 px de ancho, densidad
 * 1,75, y la red "4G lenta" con el freno que usa el mismo Lighthouse cuando
 * frena de verdad en vez de simular: 562,5 ms de latencia, 1,47 Mbps de bajada
 * y el procesador cuatro veces más lento. Cada carga, con la caché vacía.
 *
 * Además del FCP y el LCP dice CUÁL fue el elemento del LCP: de eso depende
 * qué conviene adelantar.
 */

import { chromium } from "@playwright/test";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { crearServidor } from "./servir.mjs";

const TELEFONO = {
  viewport: { width: 412, height: 823 },
  deviceScaleFactor: 1.75,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
};

// Los números de Lighthouse para "4G lenta" con freno de verdad (devtools):
// la latencia y el ancho de banda simulados, corregidos por su factor.
const RED = {
  offline: false,
  latency: 150 * 3.75,
  downloadThroughput: (1.6 * 1024 * 1024 * 0.9) / 8,
  uploadThroughput: (750 * 1024 * 0.9) / 8,
};
const PROCESADOR = 4;

function argumentos(argv) {
  const valor = (nombre, porOmision) => {
    const i = argv.indexOf(nombre);
    return i >= 0 ? argv[i + 1] : porOmision;
  };
  return {
    carpeta: path.resolve(valor("--carpeta", "public")),
    veces: Number(valor("--veces", 5)),
    pagina: valor("--pagina", "/index.html"),
  };
}

const mediana = (xs) => {
  const o = [...xs].sort((a, b) => a - b);
  return o.length % 2 ? o[(o.length - 1) / 2] : (o[o.length / 2 - 1] + o[o.length / 2]) / 2;
};

/** Una carga, con la caché vacía. */
async function unaCarga(navegador, url) {
  const contexto = await navegador.newContext(TELEFONO);
  const pagina = await contexto.newPage();
  const cdp = await contexto.newCDPSession(pagina);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", RED);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: PROCESADOR });

  // El observador se instala antes de que exista la página, para no perder
  // ninguna marca. El LCP que vale es el último candidato.
  await pagina.addInitScript(() => {
    window.__lcp = null;
    new PerformanceObserver((lista) => {
      for (const e of lista.getEntries()) {
        const el = e.element;
        window.__lcp = {
          ms: e.startTime,
          elemento: el
            ? `${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(/\s+/).join(".") : ""}` +
              (e.url ? ` (${e.url.split("/").pop()})` : "")
            : "(sin elemento)",
        };
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
  });

  await pagina.goto(url, { waitUntil: "load", timeout: 120_000 });
  // Un respiro después de `load`: la última fuente puede llegar después, y
  // lo que cambie en pantalla hasta entonces todavía puede ser el LCP.
  await pagina.waitForTimeout(3000);

  const resultado = await pagina.evaluate(() => ({
    fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
    lcp: window.__lcp,
    pedidos: performance.getEntriesByType("resource").map((r) => r.name.split("?")[0].split("/").slice(-1)[0]),
  }));
  await contexto.close();
  return resultado;
}

async function principal() {
  const { carpeta, veces, pagina } = argumentos(process.argv.slice(2));
  const servidor = crearServidor(carpeta);
  await new Promise((listo) => servidor.listen(0, listo));
  const url = `http://localhost:${servidor.address().port}${pagina}`;

  const navegador = await chromium.launch();
  const cargas = [];
  try {
    console.log(`midiendo ${url} (${carpeta}), ${veces} cargas`);
    for (let i = 0; i < veces; i++) {
      const c = await unaCarga(navegador, url);
      cargas.push(c);
      console.log(`  ${i + 1}. FCP ${Math.round(c.fcp)} ms · LCP ${Math.round(c.lcp?.ms)} ms · ${c.lcp?.elemento}`);
    }
  } finally {
    await navegador.close();
    servidor.close();
  }

  const elementos = {};
  for (const c of cargas) elementos[c.lcp?.elemento] = (elementos[c.lcp?.elemento] ?? 0) + 1;
  console.log(
    `\n  mediana: FCP ${Math.round(mediana(cargas.map((c) => c.fcp)))} ms · ` +
      `LCP ${Math.round(mediana(cargas.map((c) => c.lcp?.ms)))} ms`,
  );
  console.log(`  elemento del LCP: ${Object.entries(elementos).map(([e, n]) => `${e} ×${n}`).join(", ")}`);
  console.log(`  pidió: ${[...new Set(cargas[0].pedidos)].join(", ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await principal();
}
