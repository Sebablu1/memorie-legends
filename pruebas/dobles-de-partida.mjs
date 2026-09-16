/**
 * Un doble incompleto tiene que romper la suite, no pasar en silencio.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ AGUJERO TAPA ESTO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Varias pruebas de navegador reemplazan `public/js/partida-red.js` ENTERO por
 * un módulo de mentira, con `page.route`. Es la forma correcta de probar la
 * mesa sin servidor: la vista llega escrita a mano y no hay red de por medio.
 *
 * No se dice cuántas a propósito. Este comentario decía «tres» cuando ya eran
 * siete, y un número escrito a mano en un texto que nadie relee es justo el
 * tipo de cosa que esta prueba existe para no tener que mantener. La cuenta
 * real la da la prueba misma: «hay N pruebas que lo doblan».
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
import { join, dirname, relative } from "node:path";
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
console.log("\n=== Y todo doble exporta lo que la PÁGINA le pide ===");
// =====================================================================

/**
 * La otra mitad del problema, y necesita otra regla.
 *
 * ───────────────────────────────────────────────────────────────────────
 * POR QUÉ NO SIRVE LA REGLA DE ARRIBA PARA `firebase.js`
 * ───────────────────────────────────────────────────────────────────────
 *
 * Para `partida-red.js` y `servidor.js` alcanza con exigir que el doble
 * exporte todo lo que exporta el real: son módulos de la aplicación, con pocos
 * exports y un consumidor claro.
 *
 * `firebase.js` es un mostrador que reexporta treinta y dos nombres, y cada
 * pantalla usa un puñado distinto. Exigirle los treinta y dos a cada doble
 * pondría en rojo a diecinueve pruebas que hoy andan bien, y la forma de
 * callarlas sería pegarles exports que no usan — o sea, ruido que nadie
 * mantiene.
 *
 * ───────────────────────────────────────────────────────────────────────
 * LA REGLA QUE SÍ SIRVE
 * ───────────────────────────────────────────────────────────────────────
 *
 * Un doble tiene que exportar lo que la PÁGINA QUE LA PRUEBA ABRE le pide,
 * siguiendo la cadena de imports. Si `room.html` carga `room.js`, y `room.js`
 * importa `servidor.js`, y `servidor.js` importa `funciones` de `firebase.js`,
 * entonces el doble de `firebase.js` de esa prueba tiene que exportar
 * `funciones` — aunque `room.js` no la use nunca.
 *
 * Porque un `import` con nombre de algo que no existe no da `undefined`: rompe
 * el módulo entero al enlazarlo, y con él a todo el que lo importa. La página
 * no se dibuja y lo que se ve es una espera hasta que vence el plazo.
 *
 * Pasó exactamente así al escribir `sala-vestida.spec.js`: un doble de tres
 * líneas, `servidor.js` pidiendo `funciones` y `httpsCallable` del mismo
 * archivo, y ocho pruebas colgadas treinta segundos cada una.
 *
 * ───────────────────────────────────────────────────────────────────────
 * DÓNDE SE CORTA LA CADENA
 * ───────────────────────────────────────────────────────────────────────
 *
 * En los módulos que la prueba TAMBIÉN dobla. Si dobla `sesion.js`, lo que
 * `sesion.js` importe deja de importar: en esa prueba ese archivo no se carga.
 * Seguir la cadena a través de él pediría exports que nadie va a pedir.
 */
{
  /** Los módulos que una página carga por su marcado. */
  const modulosDePagina = (pagina) => {
    const html = readFileSync(join(raiz, "public", pagina), "utf8");
    return [...html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)]
      .map((m) => m[1].replace(/^\.?\//, ""));
  };

  /**
   * Los imports estáticos de un archivo: a qué apunta y con qué nombres.
   *
   * Sólo los estáticos. Un `await import(...)` se resuelve al ejecutar, así
   * que un nombre que falte ahí no rompe el enlazado — falla más tarde y de
   * otra forma, y no es lo que esta prueba vigila.
   */
  function importsDe(fuente) {
    const salida = [];
    const re = /(?:^|\n)\s*(?:import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']/g;
    for (const m of fuente.matchAll(re)) {
      const clausula = m[1];
      const desde = m[2];
      const llaves = clausula.match(/\{([^}]*)\}/);
      const nombres = llaves
        ? llaves[1]
            .split(",")
            .map((x) => x.trim().split(/\s+as\s+/)[0].trim())
            .filter(Boolean)
        : [];
      salida.push({ desde, nombres });
    }
    // `import "./x.js"` sin nombres: carga el módulo igual, así que la cadena
    // sigue por ahí.
    for (const m of fuente.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) {
      salida.push({ desde: m[1], nombres: [] });
    }
    return salida;
  }

  /** Resuelve un especificador relativo a una ruta dentro de `public/js`. */
  const resolver = (desdeArchivo, especificador) => {
    if (!especificador.startsWith(".")) return null;
    const dir = dirname(join(raiz, "public", "js", desdeArchivo));
    const abs = join(dir, especificador);
    return relative(join(raiz, "public", "js"), abs).replace(/\\/g, "/");
  };

  /** Qué módulos dobla una prueba, por las rutas que intercepta. */
  const doblados = (fuente) =>
    new Set(
      [...fuente.matchAll(/page\.route\(\s*["'`]\*\*\/js\/([^"'`]+)["'`]/g)].map((m) => m[1]),
    );

  /** La página que abre una prueba, si abre una sola. */
  function paginaDe(fuente) {
    const vistas = new Set(
      [...fuente.matchAll(/page\.goto\(\s*["'`]\/([^"'`?]+)/g)].map((m) => m[1]),
    );
    return vistas.size === 1 ? [...vistas][0] : null;
  }

  let revisadas = 0;

  for (const spec of specs) {
    const fuente = readFileSync(join(carpeta, spec), "utf8");
    const dobla = doblados(fuente);
    if (!dobla.size) continue;

    const pagina = paginaDe(fuente);
    if (!pagina) continue;

    let entradas;
    try {
      entradas = modulosDePagina(pagina);
    } catch {
      continue; // la prueba abre algo que no es una página del sitio
    }

    // --- el cierre de imports, cortando en lo doblado ---
    const pedidos = new Map(); // módulo doblado -> nombres que le piden
    const vistos = new Set();
    const cola = entradas.map((e) => e.replace(/^js\//, ""));

    while (cola.length) {
      const archivo = cola.pop();
      if (!archivo || vistos.has(archivo) || dobla.has(archivo)) continue;
      vistos.add(archivo);

      let texto;
      try {
        texto = readFileSync(join(raiz, "public", "js", archivo), "utf8");
      } catch {
        continue;
      }

      for (const { desde, nombres } of importsDe(texto)) {
        const destino = resolver(archivo, desde);
        if (!destino) continue;

        if (dobla.has(destino)) {
          if (!pedidos.has(destino)) pedidos.set(destino, new Set());
          for (const n of nombres) pedidos.get(destino).add(n);
          continue; // no se sigue por adentro de un doble
        }
        cola.push(destino);
      }
    }

    if (!pedidos.size) continue;

    const declaradas = exportaciones(fuente);
    revisadas++;

    for (const [modulo, nombres] of pedidos) {
      const faltan = [...nombres].filter((n) => !declaradas.has(n));
      ok(
        faltan.length === 0,
        `  ${spec}: su doble de ${modulo} tiene lo que pide ${pagina}`,
        faltan,
      );
    }
  }

  ok(revisadas > 0, `se pudo seguir la cadena en ${revisadas} pruebas`, revisadas);
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
