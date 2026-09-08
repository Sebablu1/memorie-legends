/**
 * Busca los PNG que no usa nadie. NO borra salvo que se lo pidan.
 *
 *   node herramientas/png-no-usados.mjs            ← sólo mira y explica
 *   node herramientas/png-no-usados.mjs --borrar   ← borra los sueltos
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO ALCANZA CON BUSCAR EL NOMBRE DEL ARCHIVO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque la mitad de las imágenes de este proyecto no se nombran nunca. Una
 * carta se pide así:
 *
 *     `/assets/${palo}/${numero}.png`          ← reglas/baraja.js
 *
 * Ahí no dice "Oro/7.png" en ningún lado. Un buscador que compare nombres de
 * archivo contra el código no encuentra ninguna de las 48 cartas y concluye
 * que ninguna se usa. Borrarlas deja el juego sin cartas — sin error de
 * compilación, sin prueba en rojo, sólo una mesa vacía.
 *
 * Peor todavía: comparar por subcadena mezcla archivos que no tienen nada que
 * ver. "12.png" contiene "2.png", así que la carta 12 salva a la 2 por
 * accidente. Un criterio que a veces acierta de casualidad es más peligroso
 * que uno que falla siempre.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CÓMO SE DECIDE ACÁ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un PNG está EN USO si pasa cualquiera de estas dos:
 *
 *   1. Alguien lo nombra. Su ruta completa o su nombre de archivo aparece
 *      literal en algún .html, .css, .js, .mjs, .json o .rules.
 *
 *   2. Alguien puede armarlo. En el código hay una plantilla que arma rutas
 *      dentro de su carpeta y termina en `.png` — como la de las cartas. En
 *      ese caso se salva la CARPETA ENTERA, porque no hay forma de saber qué
 *      valores va a tomar la variable sin ejecutar el programa.
 *
 * La regla 2 es deliberadamente generosa: ante la duda, no se borra. Un PNG de
 * más pesa unos kilobytes; un PNG de menos rompe algo que nadie va a notar
 * hasta que un jugador lo vea.
 *
 * Se miran TODOS los archivos, las pruebas incluidas. Una imagen que sólo usa
 * una prueba sigue estando en uso: borrarla pone la suite en rojo.
 */

import { readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, relative, basename, dirname, extname } from "node:path";

const RAIZ = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const BORRAR = process.argv.includes("--borrar");

/** Carpetas que no se miran ni para buscar imágenes ni para buscar referencias. */
const IGNORADAS = new Set(["node_modules", ".git", ".firebase", "test-results", "playwright-report"]);

/** Dónde puede haber una referencia a una imagen. */
const EXTENSIONES_FUENTE = new Set([".html", ".css", ".js", ".mjs", ".json", ".rules", ".md"]);

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

/** Recorre el árbol una sola vez y devuelve todo lo que hay. */
function listar(carpeta, salida = []) {
  for (const entrada of readdirSync(carpeta, { withFileTypes: true })) {
    if (IGNORADAS.has(entrada.name)) continue;
    const ruta = join(carpeta, entrada.name);
    if (entrada.isDirectory()) listar(ruta, salida);
    else salida.push(ruta);
  }
  return salida;
}

const todos = listar(RAIZ);

const pngs = todos
  .filter((f) => extname(f).toLowerCase() === ".png" && relative(RAIZ, f).startsWith("public"))
  .map((f) => ({
    absoluta: f,
    relativa: relative(RAIZ, f).replace(/\\/g, "/"),
    nombre: basename(f),
    carpeta: relative(RAIZ, dirname(f)).replace(/\\/g, "/"),
    bytes: statSync(f).size,
  }));

const fuentes = todos.filter((f) => EXTENSIONES_FUENTE.has(extname(f).toLowerCase()));

console.log(`${pngs.length} PNG en public/, buscando en ${fuentes.length} archivos.\n`);

const textoDe = new Map();
for (const f of fuentes) {
  try {
    textoDe.set(f, readFileSync(f, "utf8"));
  } catch {
    // Un archivo que no se puede leer como texto no puede contener una
    // referencia legible. Se saltea en vez de tumbar la herramienta.
  }
}

/**
 * Las carpetas que alguna plantilla puede alcanzar.
 *
 * Se busca cualquier cadena que mezcle una ruta con una interpolación y
 * termine en `.png`. De ahí sale el prefijo fijo —`/assets/`— y con eso se
 * salvan todas las carpetas que empiecen así.
 */
const carpetasDinamicas = new Set();
for (const texto of textoDe.values()) {
  for (const m of texto.matchAll(/["'`]([^"'`\n]*?)\$\{[^}]*\}[^"'`\n]*?\.png["'`]/g)) {
    // Se exige que el prefijo sea una carpeta de verdad —`assets/`— y no una
    // barra suelta. Un prefijo vacío salvaría TODO y el informe diría que no
    // sobra nada, que es la respuesta más cómoda y la menos útil.
    const prefijo = m[1].replace(/^\/+/, "").replace(/\/+$/, "").trim();
    if (prefijo) carpetasDinamicas.add(prefijo);
  }
}

if (carpetasDinamicas.size) {
  console.log("Plantillas que arman rutas .png (salvan la carpeta entera):");
  for (const p of carpetasDinamicas) console.log(`  /${p}…\${…}.png`);
  console.log();
}

const alcanzablePorPlantilla = (png) => {
  const dentroDePublic = png.carpeta.replace(/^public\/?/, "");
  return [...carpetasDinamicas].some((prefijo) =>
    `${dentroDePublic}/`.startsWith(`${prefijo}/`),
  );
};

/**
 * ¿Alguien lo nombra?
 *
 * El nombre tiene que venir precedido de una barra, una comilla, un espacio o
 * un paréntesis. Sin ese borde, `12.png` contiene `2.png` y la carta 12 salva
 * a la 2 por accidente: un criterio que a veces acierta de casualidad da un
 * informe que parece bien y no lo está.
 */
function quienLoNombra(png) {
  const sinPublic = png.relativa.replace(/^public/, "");
  const escapado = png.nombre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const conBorde = new RegExp("(^|[/\"'`\\s(=,])" + escapado);

  for (const [archivo, texto] of textoDe) {
    if (texto.includes(sinPublic) || texto.includes(png.relativa) || conBorde.test(texto)) {
      return relative(RAIZ, archivo).replace(/\\/g, "/");
    }
  }
  return null;
}

const usados = [];
const sueltos = [];

for (const png of pngs) {
  // La plantilla primero: es un hecho estructural del código, mientras que
  // encontrar el nombre suelto en un texto siempre puede ser casualidad.
  if (alcanzablePorPlantilla(png)) {
    usados.push({ ...png, motivo: "una plantilla puede armar su ruta" });
    continue;
  }
  const porNombre = quienLoNombra(png);
  if (porNombre) {
    usados.push({ ...png, motivo: `lo nombra ${porNombre}` });
    continue;
  }
  sueltos.push(png);
}

// ---- informe ----

const porCarpeta = new Map();
for (const png of sueltos) {
  if (!porCarpeta.has(png.carpeta)) porCarpeta.set(png.carpeta, []);
  porCarpeta.get(png.carpeta).push(png);
}

console.log(`EN USO: ${usados.length}`);
const motivos = new Map();
for (const u of usados) {
  const clave = u.motivo.startsWith("lo nombra") ? "lo nombra alguien" : u.motivo;
  motivos.set(clave, (motivos.get(clave) ?? 0) + 1);
}
for (const [motivo, cuantos] of motivos) console.log(`  ${String(cuantos).padStart(3)}  ${motivo}`);

console.log(`\nSIN REFERENCIA: ${sueltos.length}`);
let totalSuelto = 0;
for (const [carpeta, lista] of porCarpeta) {
  const peso = lista.reduce((s, p) => s + p.bytes, 0);
  totalSuelto += peso;
  console.log(`\n  ${carpeta}/  — ${lista.length} archivos, ${kb(peso)}`);
  for (const p of lista) console.log(`     ${p.nombre.padEnd(28)} ${kb(p.bytes).padStart(9)}`);
}

if (!sueltos.length) {
  console.log("\n✅ Todos los PNG están en uso.");
  process.exit(0);
}

console.log(`\nTotal sin referencia: ${kb(totalSuelto)}`);

if (!BORRAR) {
  console.log("\nNo se borró nada. Para borrarlos: node herramientas/png-no-usados.mjs --borrar");
  process.exit(0);
}

for (const png of sueltos) unlinkSync(png.absoluta);
console.log(`\n🗑️  Borrados ${sueltos.length} archivos (${kb(totalSuelto)}).`);
console.log("Se recuperan con: git checkout -- public/");
