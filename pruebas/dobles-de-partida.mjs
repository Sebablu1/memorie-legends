/**
 * Un doble incompleto tiene que romper la suite, no pasar en silencio.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ AGUJERO TAPA ESTO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Tres pruebas de navegador reemplazan `public/js/partida-red.js` ENTERO por
 * un módulo de mentira, con `page.route`. Es la forma correcta de probar la
 * mesa sin servidor: la vista llega escrita a mano y no hay red de por medio.
 *
 * El problema es qué pasa cuando el módulo real crece. Un `export` nuevo no
 * aparece en el doble, y `Red.loQueSea` queda en `undefined`. Llamarlo tira
 * un TypeError EN MEDIO de `arrancarModoLeyendas`, y todo lo que venía
 * después de esa línea —el latido, `mantenerEnMarcha`, los escuchas— no llega
 * a colgarse nunca.
 *
 * Y las pruebas siguen en verde. Porque la vista ya se había entregado antes
 * de la línea que revienta, la mesa se dibuja, los `expect` encuentran lo que
 * buscan, y nadie mira la consola. Ya pasó exactamente eso al agregar
 * `escucharMisLogros`: veinte pruebas en verde sobre una mesa que había
 * dejado de latir.
 *
 * En producción no se rompe —ahí el módulo sí tiene el export— así que el
 * daño no es un error del usuario: es que las pruebas dejan de probar la
 * mitad de lo que creen probar.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO SE ARREGLA CON UN `?.`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque `Red.escucharMisLogros?.(…)` haría que la mesa se calle cuando el
 * módulo no tiene lo que necesita, y eso es peor: convierte un doble
 * desactualizado en una mesa a la que le faltan funciones sin decirlo. Lo que
 * hay que arreglar es el doble, y para eso hay que enterarse.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

let fallos = 0;
const ok = (condicion, mensaje, extra) => {
  if (condicion) {
    console.log(`  ✓ ${mensaje}`);
  } else {
    fallos++;
    console.log(`  ✗ ${mensaje}${extra === undefined ? "" : ` ${JSON.stringify(extra)}`}`);
  }
};

/** Los nombres que un módulo exporta, en cualquiera de las formas usadas. */
function exportaciones(fuente) {
  const nombres = new Set();
  for (const m of fuente.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) {
    nombres.add(m[1]);
  }
  // `export { a, b as c }` — la forma que usan los dobles cuando reexportan.
  for (const m of fuente.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const trozo of m[1].split(",")) {
      const nombre = trozo.trim().split(/\s+as\s+/).pop()?.trim();
      if (nombre) nombres.add(nombre);
    }
  }
  return nombres;
}

/**
 * Los módulos que las pruebas reemplazan enteros.
 *
 * ─────────────────────────────────────────────────────────────────────
 * POR QUÉ SON DOS Y NO UNO
 * ─────────────────────────────────────────────────────────────────────
 *
 * Esta suite nació mirando sólo `partida-red.js`, y el siguiente agujero salió
 * por `servidor.js`: la tienda pasó a importar `listarPacks` de ahí, dos
 * dobles no lo declararon, y el módulo entero de la tienda falló al importar.
 * Veintiuna pruebas en rojo, ninguna por el motivo que decía su nombre.
 *
 * La lista es de MÓDULOS vigilados, no de dobles: quién dobla cuál se descubre
 * leyendo las pruebas. Agregar un módulo acá alcanza para que todos sus dobles
 * queden cubiertos.
 */
const VIGILADOS = [
  ["public", "js", "partida-red.js"],
  ["public", "js", "servidor.js"],
];

const carpeta = join(raiz, "pruebas", "e2e");
const specs = readdirSync(carpeta).filter((f) => f.endsWith(".spec.js") || f.endsWith(".js"));

for (const ruta of VIGILADOS) {
  const nombre = ruta[ruta.length - 1];

  // ===================================================================
  console.log(`\n=== Todo doble de \`${nombre}\` exporta lo que exporta el real ===`);
  // ===================================================================

  const real = exportaciones(readFileSync(join(raiz, ...ruta), "utf8"));
  ok(real.size > 5, `el módulo real exporta ${real.size} cosas`, real.size);

  /**
   * Quién lo dobla.
   *
   * Se detecta por la ruta que interceptan y no por una lista escrita a mano:
   * una prueba nueva que doble el módulo queda vigilada sin que nadie se
   * acuerde de anotarla acá, que es justo el olvido que produce el agujero.
   */
  const dobladores = specs.filter((f) => {
    const fuente = readFileSync(join(carpeta, f), "utf8");
    return fuente.includes(`page.route("**/js/${nombre}"`)
      || fuente.includes(`page.route('**/js/${nombre}'`)
      || fuente.includes("page.route(`**/js/" + nombre + "`");
  });

  ok(dobladores.length > 0, `hay ${dobladores.length} pruebas que lo doblan`, dobladores);

  for (const spec of dobladores) {
    const declaradas = exportaciones(readFileSync(join(carpeta, spec), "utf8"));
    const faltan = [...real].filter((n) => !declaradas.has(n));
    ok(faltan.length === 0, `  ${spec} no le debe ningún export`, faltan);
  }
}

// =====================================================================
console.log("\n=== Y la suite de navegador se puede cargar entera ===");
// =====================================================================

{
  /**
   * Que todos los archivos PARSEEN.
   *
   * ───────────────────────────────────────────────────────────────────────
   * POR QUÉ ESTO NO ES PARANOIA
   * ───────────────────────────────────────────────────────────────────────
   *
   * El doble de un módulo es un template literal. Una comilla invertida
   * suelta adentro —en el código o dentro de un comentario— lo cierra antes
   * de tiempo, y lo que seguía deja de ser texto y pasa a ser código.
   *
   * Eso no rompe una prueba: rompe LA CORRIDA ENTERA. Playwright no puede
   * cargar la suite, aborta antes de ejecutar nada, y el informe dice cero
   * pruebas en vez de una en rojo. Ya pasó: tres comentarios con comillas
   * invertidas dejaron 240 pruebas sin correr, y de lejos se parece bastante
   * a una corrida que terminó bien.
   *
   * ───────────────────────────────────────────────────────────────────────
   * POR QUÉ NO ALCANZA CON node --check
   * ───────────────────────────────────────────────────────────────────────
   *
   * Porque devuelve 0 sobre el archivo que Playwright rechaza. Se comprobó
   * con el archivo exacto que había roto la corrida. Lo que queda del
   * template literal cerrado a destiempo sigue siendo JavaScript que parsea
   * —a/b-c.d es una división y una resta perfectamente válidas— así que el
   * parser de Node lo deja pasar y el de Playwright no.
   *
   * La única forma honesta de saber si la suite de navegador se puede cargar
   * es pedirle a Playwright que la cargue. --list la parsea entera y no
   * ejecuta nada: cuatro segundos, sin navegador.
   */
  let carga = true;
  let motivo = "";
  try {
    execFileSync("npx", ["playwright", "test", "--list"], {
      cwd: raiz,
      stdio: "pipe",
      shell: process.platform === "win32",
    });
  } catch (e) {
    const salida = String(e.stdout ?? "") + String(e.stderr ?? e.message);
    motivo = salida.split(/\r?\n/).find((l) => /Error/.test(l)) ?? salida.slice(0, 200);
    carga = false;
  }
  ok(carga, "Playwright puede leer todas las pruebas de navegador", motivo);
}

console.log(fallos ? `\n❌ ${fallos} fallos` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
