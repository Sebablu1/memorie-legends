/**
 * La Ruleta de Leyendas se eliminó, y esta prueba la mantiene eliminada.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ UNA AUDITORÍA DEL CÓDIGO Y NO UNA PRUEBA DE COMPORTAMIENTO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque no hay comportamiento que probar: lo que hay que defender es una
 * AUSENCIA. Una prueba que abriera `ruleta.html` y esperara un 404 comprobaría
 * una sola de las veinte puntas que tenía la ruleta —la página— y se quedaría
 * en verde con la función del servidor todavía viva, el cupo del limitador
 * reservado y el enlace en cuatro menús.
 *
 * Se recorre el árbol y se busca cualquier rastro. Es la misma forma que usa
 * `transacciones.mjs` para auditar las transacciones de Firestore, y sirve
 * para lo mismo: que el día que alguien copie y pegue un archivo viejo, o
 * revierta un merge sin mirar, se entere acá y no en producción.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ NO SE BORRÓ, Y ES DELIBERADO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Las Leyendas siguen siendo la moneda del juego. El bono diario, el referido,
 * el libro mayor, las compras de paquetes y los premios del ranking son otras
 * entradas de saldo y no dependían de la ruleta: se comprueba abajo que sigan
 * en pie, porque una limpieza demasiado entusiasta se los habría llevado por
 * delante y nadie lo habría notado hasta el primer reclamo.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

let fallos = 0;
const ok = (condicion, mensaje, extra) => {
  if (condicion) console.log("  ✓", mensaje);
  else {
    fallos++;
    console.log("  ✗", mensaje, extra !== undefined ? JSON.stringify(extra) : "");
  }
};

const RAIZ = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** Carpetas que se auditan. `node_modules` y lo generado quedan fuera. */
const CARPETAS = ["public", "functions", "pruebas", "herramientas"];
const EXTENSIONES = new Set([".js", ".mjs", ".html", ".css", ".json"]);
const SALTEAR = new Set(["node_modules", "reglas-copia", ".git", "test-results"]);

/**
 * `functions/reglas` es una copia generada por `copiar-reglas.js`. Se audita
 * igual: si alguien restaura la ruleta en `public/js/reglas`, la copia la
 * arrastra y tiene que saltar acá.
 */
function archivos(dir) {
  const salida = [];
  for (const nombre of readdirSync(dir)) {
    if (SALTEAR.has(nombre)) continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...archivos(ruta));
    else if (EXTENSIONES.has(extname(nombre))) salida.push(ruta);
  }
  return salida;
}

// =====================================================================
console.log("\n=== 1. No queda un solo rastro de la ruleta ===");
// =====================================================================

/**
 * Se busca CÓDIGO, no prosa.
 *
 * La primera versión buscaba la palabra "ruleta" a secas y encontró tres
 * cosas: las que había que borrar, el `package.json` que la nombraba en su
 * descripción —una que se me había pasado, así que la prueba ya sirvió— y el
 * comentario de esta misma limpieza, que explica POR QUÉ se eliminó.
 *
 * Prohibir la palabra prohíbe contar la historia, y en este proyecto los
 * comentarios cuentan la historia a propósito. Así que se buscan las formas
 * que sólo aparecen si la ruleta VUELVE: nombres de identificadores, campos
 * del perfil y rutas de archivo. Un comentario que la mencione pasa; una
 * llamada a `girarLaRuleta`, no.
 */
const RASTROS = [
  "girarlaruleta", // la Cloud Function y su cupo en el limitador
  "girarruleta", // el sorteo del módulo de economía
  "premios_ruleta",
  "horas_ruleta",
  "esperaruleta",
  "lastspin", // el campo del perfil, escrito al crear la cuenta
  "ultimogiro", // el mismo campo, ya traducido por `sesion.js`
  "ruleta.html",
  "ruleta.js",
  "ruleta.css",
];

/**
 * En el HTML, además, la palabra suelta es un hallazgo.
 *
 * Ahí no hay comentarios que expliquen nada: lo que aparece es texto visible o
 * un enlace, y las dos cosas son la ruleta de vuelta en la interfaz.
 */
const encontrados = [];
for (const carpeta of CARPETAS) {
  let lista;
  try {
    lista = archivos(join(RAIZ, carpeta));
  } catch {
    continue; // la carpeta puede no existir en un clon parcial
  }
  for (const ruta of lista) {
    // Esta misma prueba nombra los rastros: sería la única que siempre falla.
    if (ruta.endsWith("sin-ruleta.mjs")) continue;
    const texto = readFileSync(ruta, "utf8").toLowerCase();

    const buscar =
      extname(ruta) === ".html" && ruta.includes("public") ? [...RASTROS, "ruleta"] : RASTROS;

    for (const rastro of buscar) {
      if (texto.includes(rastro)) {
        encontrados.push(`${ruta.slice(RAIZ.length)} → ${rastro}`);
        break;
      }
    }
  }
}

ok(encontrados.length === 0, "ningún archivo la resucita", encontrados.slice(0, 8));

// =====================================================================
console.log("\n=== 2. Los archivos propios de la ruleta ya no están ===");
// =====================================================================

const BORRADOS = ["public/ruleta.html", "public/js/ruleta.js", "public/css/ruleta.css"];
for (const relativo of BORRADOS) {
  let existe = true;
  try {
    statSync(join(RAIZ, relativo));
  } catch {
    existe = false;
  }
  ok(!existe, `${relativo} no existe`);
}

// =====================================================================
console.log("\n=== 3. Lo que NO había que borrar sigue en pie ===");
// =====================================================================

const economia = readFileSync(join(RAIZ, "public/js/reglas/economia.js"), "utf8");

ok(economia.includes("BONO_DIARIO"), "el bono diario sigue existiendo");
ok(economia.includes("LEYENDAS_POR_REFERIDO"), "el referido sigue existiendo");
ok(economia.includes("LEYENDAS_REGISTRO"), "las Leyendas de registro siguen existiendo");
ok(economia.includes("PAQUETES"), "los paquetes de compra siguen existiendo");
ok(economia.includes("PREMIOS_RANKING"), "los premios del ranking siguen existiendo");
ok(economia.includes("esperaBonoDiario"), "la espera del bono diario sigue calculándose");

const servidor = readFileSync(join(RAIZ, "functions/index.js"), "utf8");

ok(servidor.includes("reclamarBonoDiario"), "la función del bono diario sigue desplegada");
ok(servidor.includes("acreditarReferido"), "la función del referido sigue desplegada");
ok(servidor.includes("crearOrdenDeCompra"), "la compra de Leyendas sigue en el servidor");
ok(servidor.includes("webhookPago"), "el webhook de pagos sigue en el servidor");
ok(servidor.includes("moverLeyendas"), "el módulo central de Leyendas se sigue usando");

// El libro mayor y su idempotencia son lo que hace auditable el saldo: si
// desaparecieran, las Leyendas seguirían moviéndose pero sin respaldo.
const leyendas = readFileSync(join(RAIZ, "functions/leyendas.js"), "utf8");
ok(leyendas.includes("idempotencia"), "el libro mayor conserva la idempotencia");

console.log(fallos ? `\n❌ ${fallos} fallos` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
