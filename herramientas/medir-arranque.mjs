/**
 * Cuánto tarda en cargar `functions/index.js`, y en qué se va ese tiempo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ PREGUNTA CONTESTA Y CUÁL NO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El arranque en frío de una Cloud Function son cuatro cosas, en este orden:
 *
 *   1. Google consigue una máquina y arranca el contenedor.
 *   2. Node arranca.
 *   3. Node carga el grafo de módulos —`index.js` y todo lo que importa—.
 *   4. Corre el cuerpo de la función.
 *
 * Esto mide la 3, y de paso la 2 para poder restarla. La 1 no se puede medir
 * desde acá: pasa en la infraestructura de Google, antes de que exista un
 * proceso nuestro. Así que el número de abajo es un PISO de lo que se podría
 * ahorrar separando el archivo, no el arranque en frío entero.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ CADA MEDICIÓN ES UN PROCESO NUEVO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque Node guarda los módulos ya cargados. Medir dos veces en el mismo
 * proceso da el tiempo real la primera vez y casi cero la segunda, que es
 * justamente lo contrario de lo que se quiere saber: una instancia en frío
 * carga todo desde cero.
 *
 * Se paga con el arranque del proceso, que son decenas de milisegundos. Por
 * eso lo primero que se mide es un Node vacío: ése es el cero.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NO TOCA LA RED NI FIRESTORE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `index.js` llama a `admin.initializeApp()` y a `getFirestore("southamerica")`
 * al cargar, y las dos cosas son locales: arman los objetos y no hablan con
 * nadie hasta la primera consulta. Por eso esto corre sin credenciales — y por
 * eso mide lo mismo con la base vieja o con la nueva. Si algún día
 * dejara de cargar sin ellas, el error aparece como «no se pudo importar» en
 * la primera medición y no hay que adivinar.
 */

import { spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = pathToFileURL(join(RAIZ, "functions", "index.js")).href;

/** Cuántas veces se repite cada medición. La mediana sale de acá. */
const VUELTAS = Number(process.env.VUELTAS ?? 3);

// ─────────────────────────────────────────────────────── el instrumento

/**
 * Corre un fragmento en un Node limpio y devuelve lo que midió.
 *
 * El fragmento tiene que imprimir UNA línea de JSON al final. Se la busca
 * desde abajo a propósito: `firebase-admin` escribe avisos por su cuenta
 * —claves de servicio, variables de entorno— y quedarían mezclados.
 */
function enUnProcesoLimpio(fragmento) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", fragmento], {
    /**
     * `functions/` y no la raíz, y la diferencia no es cosmética.
     *
     * Un nombre pelado —`zod`, `firebase-admin`— se resuelve desde el
     * directorio de trabajo cuando el código viene por `-e`, porque no hay
     * archivo del cual colgarse. Corriendo desde la raíz, `zod` y
     * `firebase-functions` no aparecían —viven en `functions/node_modules`— y
     * `firebase-admin` SÍ aparecía, pero era la copia que arrastra
     * `firebase-tools` en la raíz: se estaba midiendo otro paquete.
     */
    cwd: join(RAIZ, "functions"),
    encoding: "utf8",
    timeout: 120_000,
  });
  const paredMs = Number(process.hrtime.bigint() - t0) / 1e6;

  if (r.error) return { error: r.error.message, paredMs };
  if (r.status !== 0) {
    // La primera línea que parece un mensaje de error, no las últimas cuatro:
    // el rastro de pila de Node termina en llaves sueltas y su propia versión.
    const salida = `${r.stderr ?? ""}`
      .split("\n")
      .map((l) => l.trim())
      .find((l) => /Error|error:/.test(l) && !l.startsWith("at "));
    return { error: salida || `salió con código ${r.status}`, paredMs };
  }

  const lineas = `${r.stdout ?? ""}`.trim().split("\n");
  for (let i = lineas.length - 1; i >= 0; i--) {
    try {
      return { ...JSON.parse(lineas[i]), paredMs };
    } catch {
      /* no era la línea del JSON; se sigue buscando hacia arriba */
    }
  }
  return { error: "el fragmento no imprimió JSON", paredMs };
}

/** El fragmento estándar: importar una lista de cosas y contar el costo. */
const fragmentoDeImport = (especificadores) => `
  import { createRequire } from "node:module";
  const antes = process.memoryUsage().rss;
  const t0 = performance.now();
  ${especificadores.map((e) => `await import(${JSON.stringify(e)});`).join("\n  ")}
  const ms = performance.now() - t0;
  const require = createRequire(${JSON.stringify(INDEX)});
  console.log(JSON.stringify({
    ms,
    rssMb: (process.memoryUsage().rss - antes) / 1048576,
    rssTotalMb: process.memoryUsage().rss / 1048576,
    cjs: Object.keys(require.cache).length,
  }));
`;

/** Repite una medición y devuelve promedio y mediana. */
function medir(etiqueta, especificadores, vueltas = VUELTAS) {
  const corridas = [];
  for (let i = 0; i < vueltas; i++) corridas.push(enUnProcesoLimpio(fragmentoDeImport(especificadores)));

  const malas = corridas.filter((c) => c.error);
  if (malas.length === corridas.length) return { etiqueta, error: malas[0].error };

  const buenas = corridas.filter((c) => !c.error);
  const ms = buenas.map((c) => c.ms).sort((a, b) => a - b);
  const pared = buenas.map((c) => c.paredMs).sort((a, b) => a - b);

  return {
    etiqueta,
    vueltas: buenas.length,
    promedio: ms.reduce((a, b) => a + b, 0) / ms.length,
    mediana: ms[Math.floor(ms.length / 2)],
    minimo: ms[0],
    maximo: ms[ms.length - 1],
    paredMediana: pared[Math.floor(pared.length / 2)],
    rssMb: buenas.at(-1).rssMb,
    rssTotalMb: buenas.at(-1).rssTotalMb,
    cjs: buenas.at(-1).cjs,
  };
}

// ──────────────────────────────────────────────────────────── formato

const ms = (n) => (n == null ? "—" : `${n.toFixed(0).padStart(5)} ms`);
const titulo = (t) => console.log(`\n${"═".repeat(72)}\n${t}\n${"═".repeat(72)}`);
const fila = (nombre, valor, extra = "") =>
  console.log(`  ${String(nombre).padEnd(38)} ${valor}${extra ? `   ${extra}` : ""}`);

/** Los imports de primer nivel de `index.js`, leídos del archivo. */
function importsDeIndex() {
  const texto = readFileSync(join(RAIZ, "functions", "index.js"), "utf8");
  return [...texto.matchAll(/^import\s+(?:[\s\S]*?)\s*from\s*"([^"]+)";/gm)].map((m) => m[1]);
}

/** Un `./loquesea.js` de `index.js`, convertido en algo importable desde acá. */
const resolverDesdeIndex = (especificador) =>
  especificador.startsWith(".")
    ? pathToFileURL(join(RAIZ, "functions", especificador.slice(2))).href
    : especificador;

// ═══════════════════════════════════════════════════════════════════════

console.log(`
Midiendo el arranque de functions/index.js
  Node de acá:        ${process.version}
  Node del runtime:   ${JSON.parse(readFileSync(join(RAIZ, "functions", "package.json"), "utf8")).engines.node}
  Vueltas por medida: ${VUELTAS}`);

if (process.version.split(".")[0] !== "v22") {
  console.log(`
  ⚠️  Esto NO corre en la misma versión que el runtime. Los números sirven
      para comparar módulos entre sí —que es lo que se vino a averiguar— pero
      no son el tiempo exacto que va a tardar allá.`);
}

// ─────────────────────────────────────────────────────────── 0. el cero

titulo("0. El cero: un Node que no carga nada");

const vacio = enUnProcesoLimpio(`console.log(JSON.stringify({ ms: 0 }));`);
fila("arrancar el proceso y no hacer nada", ms(vacio.paredMs),
     "esto NO se ahorra separando archivos");

// ───────────────────────────────────────────────────── 1. el grafo entero

titulo("1. El grafo entero de index.js");

const todo = medir("index.js", [INDEX]);
if (todo.error) {
  console.log(`\n  ✗ No se pudo importar: ${todo.error}\n`);
  console.log("  Si falta una credencial, está dicho arriba. Sin esto, el resto no tiene sentido.\n");
  process.exit(1);
}

fila("importar index.js (sólo el import)", ms(todo.mediana),
     `mediana de ${todo.vueltas}; min ${todo.minimo.toFixed(0)} / max ${todo.maximo.toFixed(0)}`);
fila("proceso entero, de punta a punta", ms(todo.paredMediana), "incluye arrancar Node");
fila("memoria después de cargar (RSS)", `${todo.rssTotalMb.toFixed(0).padStart(5)} MB`);
fila("módulos CommonJS en caché", String(todo.cjs).padStart(5) + "   ", "firebase-admin, zod y su mundo");

// ───────────────────────────────────────────── 2. las piezas, por separado

titulo("2. Las piezas pesadas, cada una sola en su proceso");

const piezas = [
  ["firebase-admin", "firebase-admin"],
  ["zod", "zod"],
  ["firebase-functions/v2/https", "firebase-functions/v2/https"],
  ["firebase-functions/v1", "firebase-functions/v1"],
  ["reglas/puntaje.js (local, chico)", resolverDesdeIndex("./reglas/puntaje.js")],
];

const medidas = new Map();
for (const [nombre, especificador] of piezas) {
  const m = medir(nombre, [especificador]);
  medidas.set(nombre, m);
  if (m.error) fila(nombre, "   ✗ " + m.error);
  else fila(nombre, ms(m.mediana), `${m.cjs} módulos CJS, ${m.rssTotalMb.toFixed(0)} MB`);
}

// ──────────────────────────────── 3. cada import de index.js, por su cuenta

titulo("3. Cada import de index.js, solo, en un proceso limpio");
console.log(`  Incluye lo que cada uno arrastra. Dos que compartan dependencias
  suman esa parte dos veces: por eso la suma da más que el total de arriba.\n`);

const aislados = [];
for (const especificador of importsDeIndex()) {
  const m = medir(especificador, [resolverDesdeIndex(especificador)], Math.min(VUELTAS, 2));
  aislados.push({ especificador, ...m });
}

const ordenados = aislados.filter((a) => !a.error).sort((a, b) => b.mediana - a.mediana);
console.log("  Los 10 más caros:\n");
for (const a of ordenados.slice(0, 10)) {
  fila(a.especificador, ms(a.mediana), `${a.cjs} módulos CJS`);
}

const rotos = aislados.filter((a) => a.error);
if (rotos.length) {
  console.log("\n  No se pudieron medir solos:");
  for (const r of rotos) fila(r.especificador, "   ✗ " + r.error);
}

// ─────────────────────────────────────── 4. cuánto AGREGA cada uno, en orden

titulo("4. Cuánto AGREGA cada import, cargándolos en el orden del archivo");
console.log(`  Acá lo compartido se paga una sola vez, el primero que lo pide.
  Es el reparto real del tiempo de arriba: estos sí suman el total.\n`);

const orden = importsDeIndex();
const acumulado = [];
let previo = 0;
for (let i = 0; i < orden.length; i++) {
  const hasta = orden.slice(0, i + 1).map(resolverDesdeIndex);
  const m = medir(`hasta ${orden[i]}`, hasta, Math.min(VUELTAS, 2));
  if (m.error) { acumulado.push({ especificador: orden[i], error: m.error }); continue; }
  acumulado.push({ especificador: orden[i], agrega: m.mediana - previo, total: m.mediana });
  previo = m.mediana;
}

const porAporte = acumulado.filter((a) => !a.error).sort((a, b) => b.agrega - a.agrega);
console.log("  Los 10 que más agregan:\n");
for (const a of porAporte.slice(0, 10)) fila(a.especificador, ms(a.agrega));

// ───────────────────────────────────────────── 5. los dos caminos posibles

titulo("5. Qué costaría cada forma de partir el archivo");

const soloReglas = importsDeIndex()
  .filter((e) => e.startsWith("./reglas/"))
  .map(resolverDesdeIndex);

const mReglas = medir("sólo reglas/*.js", soloReglas);
fila("sólo las reglas puras, sin firebase-admin", mReglas.error ? "✗" : ms(mReglas.mediana),
     mReglas.error ?? "lo que costaría un módulo que no toca la base");

/**
 * Y acá va `firebase-functions` incluido, que es lo que esta medición tenía
 * mal al principio.
 *
 * Medir «firebase-admin + un dominio» daba 70 ms y un ahorro del 96 %, y era
 * mentira: ninguna función puede existir sin importar `firebase-functions`
 * —es lo que la declara—. El 96 % no salía de partir el archivo sino de haber
 * dejado afuera, sin querer, justo lo que más pesa.
 */
const mDominio = medir("v2 + admin + un dominio", [
  "firebase-functions/v2/https",
  "firebase-admin",
  resolverDesdeIndex("./salas-privadas.js"),
]);
fila("una function partida por dominio", mDominio.error ? "✗" : ms(mDominio.mediana),
     mDominio.error ?? "v2 + firebase-admin + salas-privadas.js");

if (!todo.error && !mDominio.error) {
  const ahorro = todo.mediana - mDominio.mediana;
  fila("diferencia contra el grafo entero", ms(ahorro),
       `${((ahorro / todo.mediana) * 100).toFixed(0)}% del import`);
}

// ──────────────────────────── 5b. de dónde sale de verdad ese tiempo

titulo("5b. v1 contra v2: el import que se sacó");
console.log(`  \`index.js\` importaba las DOS generaciones: v2 para las 79 funciones y v1
  para \`webhookPago\`, que se había quedado allá por su dirección registrada
  en Mercado Pago. Al migrar el webhook, v1 salió del grafo.

  Esto queda como vigía: la fila «sólo firebase-functions/v1» es lo que
  costaría volver a meterla, y la de abajo lo que se paga hoy.\n`);

const V2 = ["firebase-functions/v2/https", "firebase-functions/v2/scheduler", "firebase-functions/logger"];
const comparacion = [
  ["sólo firebase-functions/v1", ["firebase-functions/v1"]],
  ["sólo los subpaths de v2", V2],
  ["las dos, como hoy", ["firebase-functions/v1", ...V2]],
  ["v2 + firebase-admin + zod, sin v1", [...V2, "firebase-admin", "zod"]],
];
for (const [nombre, especificadores] of comparacion) {
  const m = medir(nombre, especificadores);
  fila(nombre, m.error ? "   ✗ " + m.error : ms(m.mediana),
       m.error ? "" : `${m.cjs} módulos CJS`);
}

// ──────────────────────────────────────────────── 6. el snapshot de V8

titulo("6. Snapshot de V8 (--build-snapshot)");

// En el temporal del sistema y no en el repositorio: si esto se interrumpe a
// mitad de camino, los dos archivos no quedan tirados entre los del proyecto.
const blob = join(tmpdir(), "memorie-snapshot.blob");
const entrada = join(tmpdir(), "memorie-entrada-snapshot.cjs");
try {
  writeFileSync(entrada, 'require("firebase-admin");\n');
  const t0 = process.hrtime.bigint();
  const r = spawnSync(
    process.execPath,
    ["--build-snapshot", "--snapshot-blob", blob, entrada],
    { cwd: join(RAIZ, "functions"), encoding: "utf8", timeout: 120_000 },
  );
  const tardo = Number(process.hrtime.bigint() - t0) / 1e6;

  if (r.status === 0 && existsSync(blob)) {
    fila("construir el snapshot", ms(tardo), "funciona en este Node");
  } else {
    const motivo = `${r.stderr ?? ""}`
      .split("\n")
      .map((l) => l.trim())
      .find((l) => /^[A-Za-z]*Error: /.test(l));
    fila("construir el snapshot", "   ✗ falló", motivo ?? `código ${r.status}`);
    console.log(`
  La bandera existe y funciona con código propio —un archivo trivial produce
  un blob de 5,9 MB—, pero el \`require\` del constructor de snapshots no
  resuelve paquetes de \`node_modules\`. O sea que no puede meter adentro
  justamente lo que tardaría menos si estuviera adentro.`);
  }
} finally {
  for (const f of [blob, entrada]) if (existsSync(f)) rmSync(f, { force: true });
}

console.log(`
  Y aunque funcionara, no se puede usar: las banderas de arranque del proceso
  las pone el runtime de Cloud Functions, no nosotros. Haría falta un
  contenedor propio, que es un cambio de otra escala.
`);

// ─────────────────────────────────────────────────────────── el resumen

titulo("Resumen");

const cero = vacio.paredMs;
fila("arrancar Node, sin cargar nada", ms(cero));
fila("cargar el grafo de index.js", ms(todo.mediana));
fila("proceso completo", ms(todo.paredMediana));
console.log();
fila("del arranque en frío medido (2049 ms),", `${((todo.mediana / 2049) * 100).toFixed(0)} %`,
     "es cargar módulos");
console.log(`
  El resto —el ${(100 - (todo.mediana / 2049) * 100).toFixed(0)} % — es conseguir la máquina, arrancar el
  contenedor y arrancar Node. Nada de eso se arregla tocando los imports.
`);
