/**
 * Una foto de la mesa de verdad, jugándose.
 *
 *   node herramientas/mirar-mesa.mjs [salida.png] [--ancho=1536] [--alto=1024]
 *
 * No comprueba nada: para eso están las cuarenta pruebas de `pruebas/e2e`. Esto
 * sirve para MIRAR, que es lo único que un `expect` no puede hacer. Si un marco
 * quedó cortado, si dos paneles se pisan, si el oro de un borde se pierde
 * contra el fondo: eso se ve acá.
 *
 * Abre `mesa.html` en modo entrenamiento con la misma sesión de mentira que
 * usan las pruebas —la mesa exige sesión y esto no es una maqueta— y con la
 * misma semilla, así dos fotos seguidas muestran el mismo reparto y se puede
 * comparar un cambio contra el anterior.
 *
 * Necesita el servidor: `node herramientas/servir.mjs` en otra terminal.
 */

import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const bandera = (n, x) => Number(args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? x);
const SALIDA = args.find((a) => !a.startsWith("--")) ?? "mesa.png";
const ANCHO = bandera("ancho", 1536);
const ALTO = bandera("alto", 1024);
const SEMILLA = bandera("semilla", 4242);
const ESPERA = bandera("espera", 6000);

const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: ANCHO, height: ALTO } });

const errores = [];
pagina.on("pageerror", (e) => errores.push(String(e.message)));
pagina.on("console", (m) => {
  if (m.type() === "error" && !/favicon/.test(m.text())) errores.push(m.text());
});

// El mismo azar fijo de las pruebas: sin esto, cada foto trae otro reparto y no
// se puede comparar un cambio contra el de antes.
await pagina.addInitScript((s) => {
  let x = s >>> 0 || 1;
  Math.random = () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;  x >>>= 0;
    return x / 4294967296;
  };
}, SEMILLA);

await pagina.route("**/js/guardia-sesion.js", (r) =>
  r.fulfill({
    status: 200,
    contentType: "text/javascript; charset=utf-8",
    body: `export async function exigirSesionEnMesa() {
      return { uid: "jugador-de-prueba", email: "prueba@example.com" };
    }`,
  }));

await pagina.goto(`http://localhost:5000/mesa.html?semilla=${SEMILLA}`);

// Se espera a que la mesa hable, no un `sleep`: el velo de carga tapa todo
// hasta que terminó de repartir, y una foto tomada antes sería del velo.
await pagina.waitForSelector("#pista", { state: "visible" });
await pagina.waitForFunction(() => !document.getElementById("veloCarga"), { timeout: 20_000 })
  .catch(() => {});
await pagina.waitForTimeout(ESPERA);

const rotas = await pagina.evaluate(() =>
  [...document.images].filter((i) => !i.naturalWidth).map((i) => i.currentSrc || i.getAttribute("src") || `(sin src) ${i.className}`));

await pagina.screenshot({ path: SALIDA });
await navegador.close();

console.log(`Foto de ${ANCHO}x${ALTO} -> ${SALIDA}`);
if (rotas.length) {
  console.log(`\n❌ ${rotas.length} imágenes no cargaron:`);
  for (const r of new Set(rotas)) console.log(`   ${r}`);
}
if (errores.length) {
  console.log(`\n❌ ${errores.length} errores en consola:`);
  for (const e of errores.slice(0, 8)) console.log(`   ${e}`);
}
