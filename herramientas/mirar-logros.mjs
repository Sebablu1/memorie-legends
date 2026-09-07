/**
 * Una foto de la vitrina de logros y la cartelera de torneos.
 *
 *   node herramientas/mirar-logros.mjs [salida.png]
 *
 * Igual que `mirar-tienda.mjs`: no comprueba nada —las suites ya lo hacen—,
 * sirve para MIRAR. Que una barra de progreso se vea como una barra, que una
 * insignia apagada se distinga de una ganada, que el botón de anotarse no se
 * salga de la fila en un teléfono. Nada de eso lo dice un `expect`.
 *
 * Se dibuja con el CSS y el HTML de verdad, y las tarjetas se arman con las
 * mismas reglas que `logros.js` y `cartelera-torneos.js`. Una maqueta parecida
 * se vería bien aunque la vitrina estuviera rota.
 */

import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CATALOGO_INICIAL, TIPOS } from "../public/js/reglas/catalogo.js";
import { CONDICIONES, cumple, progreso } from "../public/js/reglas/insignias.js";

const RAIZ = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SALIDA = process.argv[2] ?? join(RAIZ, "logros.png");

const insignias = new Map(
  CATALOGO_INICIAL.filter((i) => i.tipo === TIPOS.INSIGNIA).map((i) => [i.id, i]),
);

/** Un jugador a mitad de camino: dos ganadas, cuatro pendientes. */
const ESTADISTICAS = {
  partidasJugadas: 84,
  partidasGanadas: 61,
  torneosGanados: 1,
  mejorPuestoMensual: null,
};
const TENGO = new Set(["novato", "aventurero"]);
const PUESTA = "aventurero";

function tarjeta(condicion) {
  const item = insignias.get(condicion.id);
  const ganada = TENGO.has(condicion.id);
  const puesta = PUESTA === condicion.id;
  const alcanzada = cumple(condicion, ESTADISTICAS);
  const avance = progreso(condicion, ESTADISTICAS);

  const boton = ganada
    ? puesta
      ? '<button class="accion sobria" type="button">Sacármela</button>'
      : '<button class="accion" type="button">Ponérmela</button>'
    : "";

  const barra =
    !ganada && typeof condicion.minimo === "number"
      ? `<div class="barra-logro"><i style="width: ${Math.round(avance * 100)}%"></i></div>`
      : "";

  return `
    <article class="logro ${ganada ? "ganado" : "pendiente"} ${puesta ? "puesto" : ""}">
      ${puesta ? '<span class="cinta-item">En uso</span>' : ""}
      <img class="figura-logro" src="${item.imagen}" alt="" />
      <h3>${item.nombre}</h3>
      <p class="condicion-logro">${condicion.texto}</p>
      ${barra}
      <div class="estado-logro">${
        ganada ? "Conseguida" : alcanzada ? "Ya casi: se otorga al terminar tu próxima partida" : "Pendiente"
      }</div>
      ${boton}
    </article>`;
}

const TORNEOS = [
  { nombre: "Copa de Primavera", entrada: 100, inscriptos: 7 },
  { nombre: "Torneo Relámpago", entrada: 20, inscriptos: 2 },
];

const filaTorneo = (t) => {
  const faltan = Math.max(0, 4 - t.inscriptos);
  return `
    <div class="fila-torneo">
      <div class="datos-torneo">
        <b>${t.nombre}</b>
        <span>Entrada ${t.entrada.toLocaleString("es-UY")} Leyendas · ${t.inscriptos} anotados${
          faltan ? ` · faltan ${faltan} para que se juegue` : ""
        }</span>
      </div>
      <button class="accion" type="button">Anotarme</button>
    </div>`;
};

const hojas = ["tema.css", "app.css", "tablero.css", "logros.css"]
  .map((h) => readFileSync(join(RAIZ, "public/css", h), "utf8"))
  .join("\n");

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<style>${hojas}</style>
<style>body { padding: 24px; } section { margin-bottom: 26px; }</style>
</head><body>
  <section class="panel vitrina-logros">
    <h2>Tus logros</h2>
    <div class="rejilla-logros">${CONDICIONES.map(tarjeta).join("")}</div>
  </section>

  <section class="panel panel-torneos">
    <h2>🏆 Torneos abiertos</h2>
    <p class="nota-salas">Se paga la entrada al anotarse. Si no se llega a cuatro
      jugadores, el torneo se cancela y se devuelve todo.</p>
    <div>${TORNEOS.map(filaTorneo).join("")}</div>
  </section>
</body></html>`;

const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: 1100, height: 900 } });

// Servidor de un archivo: hace falta un origen para que `/img/...` resuelva.
await pagina.route("**/*", async (ruta) => {
  const url = new URL(ruta.request().url());
  if (url.pathname === "/") return ruta.fulfill({ contentType: "text/html", body: html });
  try {
    return await ruta.fulfill({ path: join(RAIZ, "public", url.pathname) });
  } catch {
    return ruta.abort();
  }
});

await pagina.goto("http://logros.local/");
await pagina.waitForLoadState("networkidle");

const rotas = await pagina.evaluate(() =>
  [...document.images].filter((i) => !i.naturalWidth).map((i) => i.getAttribute("src")),
);

await pagina.screenshot({ path: SALIDA, fullPage: true });

// Y en un teléfono, que es donde el botón de anotarse se sale de la fila si
// `min-width: 0` no está.
await pagina.setViewportSize({ width: 380, height: 900 });
const desborda = await pagina.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
);
await pagina.screenshot({ path: SALIDA.replace(/\.png$/, "-movil.png"), fullPage: true });

await navegador.close();

console.log(`vitrina + cartelera -> ${SALIDA}`);
if (rotas.length) {
  console.log(`❌ ${rotas.length} imágenes no cargaron: ${rotas.join(", ")}`);
  process.exit(1);
}
if (desborda) {
  console.log("❌ en 380px la página desborda a lo ancho");
  process.exit(1);
}
console.log("✅ imágenes ok y sin desborde horizontal en 380px");
