/**
 * Auditoría estática de las transacciones de Firestore.
 *
 * Firestore exige que TODAS las lecturas de una transacción ocurran antes de
 * cualquier escritura. Romper esa regla no da un error sutil: la transacción
 * entera falla, y lo hace sólo en producción, porque un doble de pruebas
 * ingenuo no la comprueba.
 *
 * Ya pasó una vez. `salirDeSalaEnEspera` devolvía las entradas llamando a
 * `moverLeyendas` en un bucle: la segunda vuelta leía el asiento del segundo
 * jugador después de haber escrito el saldo del primero. Con dos o más
 * jugadores la devolución nunca se confirmaba. Nadie perdía Leyendas, pero
 * tampoco las recuperaba, y la sala quedaba sin cancelar.
 *
 * Esta prueba recorre el código y busca ese patrón en TODAS las transacciones
 * del proyecto, no sólo en la que ya conocemos. No ejecuta nada: lee.
 *
 * También lista todo lo que escribe el saldo, para que abrir una vía económica
 * nueva sea un acto consciente y no un descuido.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const AQUI = dirname(fileURLToPath(import.meta.url));
const FUNCIONES = join(AQUI, "..", "functions");

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x, null, 1) : ""); }
};

const archivos = readdirSync(FUNCIONES).filter(
  (f) => f.endsWith(".js") && f !== "copiar-reglas.js",
);

/**
 * Qué hace cada llamada, en orden. Las ayudantes que leen y escriben por
 * dentro cuentan como las dos cosas: es lo que importa para la regla.
 */
const OPERACIONES = [
  { patron: /\btx\.get\s*\(/g, lee: true, escribe: false, nombre: "tx.get" },
  { patron: /\btx\.set\s*\(/g, lee: false, escribe: true, nombre: "tx.set" },
  { patron: /\btx\.update\s*\(/g, lee: false, escribe: true, nombre: "tx.update" },
  { patron: /\btx\.delete\s*\(/g, lee: false, escribe: true, nombre: "tx.delete" },
  // Ayudantes propias, con su perfil declarado.
  { patron: /\bmoverLeyendas\.varias\s*\(/g, lee: true, escribe: true, nombre: "moverLeyendas.varias" },
  { patron: /(?<!\.)\bmoverLeyendas\s*\(\s*tx/g, lee: true, escribe: true, nombre: "moverLeyendas" },
  { patron: /\brepartirEn\s*\(\s*tx/g, lee: true, escribe: true, nombre: "repartirEn" },
  { patron: /\.leer\s*\(\s*tx/g, lee: true, escribe: false, nombre: "partidaEnRed.leer" },
  { patron: /\.marcar\s*\(\s*tx/g, lee: false, escribe: true, nombre: "partidaEnRed.marcar" },
  { patron: /\bpublicar\s*\(\s*tx/g, lee: false, escribe: true, nombre: "publicar" },
];

/** Extrae el cuerpo de cada `runTransaction(...)`, contando paréntesis. */
function transaccionesDe(texto, archivo) {
  const bloques = [];
  const inicio = /[a-zA-Z]+\.runTransaction\s*\(/g;
  let m;
  while ((m = inicio.exec(texto))) {
    let i = m.index + m[0].length;
    let nivel = 1;
    while (i < texto.length && nivel > 0) {
      if (texto[i] === "(") nivel++;
      else if (texto[i] === ")") nivel--;
      i++;
    }
    bloques.push({
      archivo,
      linea: texto.slice(0, m.index).split("\n").length,
      cuerpo: texto.slice(m.index, i),
    });
  }
  return bloques;
}

/** La secuencia ordenada de operaciones dentro de un bloque. */
function secuenciaDe(cuerpo) {
  const eventos = [];
  for (const op of OPERACIONES) {
    op.patron.lastIndex = 0;
    let m;
    while ((m = op.patron.exec(cuerpo))) eventos.push({ pos: m.index, ...op });
  }
  return eventos.sort((a, b) => a.pos - b.pos);
}

/** Cuerpo del bloque que empieza en la primera llave después de `desde`. */
function cuerpoDelBloque(texto, desde) {
  const abre = texto.indexOf("{", desde);
  if (abre < 0) return "";
  let i = abre + 1, nivel = 1;
  while (i < texto.length && nivel > 0) {
    if (texto[i] === "{") nivel++;
    else if (texto[i] === "}") nivel--;
    i++;
  }
  return texto.slice(abre, i);
}

// ==================================== 1. lecturas después de escrituras

console.log("\n=== 1. Ninguna lectura después de una escritura ===");
{
  const violaciones = [];
  let transacciones = 0;

  for (const archivo of archivos) {
    const texto = readFileSync(join(FUNCIONES, archivo), "utf8");
    for (const bloque of transaccionesDe(texto, archivo)) {
      transacciones++;
      let yaEscribio = null;
      for (const ev of secuenciaDe(bloque.cuerpo)) {
        if (ev.lee && yaEscribio) {
          violaciones.push({
            archivo: bloque.archivo,
            linea: bloque.linea,
            lee: ev.nombre,
            despuesDe: yaEscribio,
          });
        }
        if (ev.escribe) yaEscribio = ev.nombre;
      }
    }
  }

  console.log(`  ${transacciones} transacciones revisadas en ${archivos.length} archivos`);
  ok(violaciones.length === 0, "ninguna lee después de escribir", violaciones);

  // La prueba de la prueba: que el detector detecte de verdad.
  const roto = "db.runTransaction(async (tx) => {\n  tx.set(ref, {a: 1});\n  await tx.get(otra);\n})";
  let escribio = false, detecto = false;
  for (const e of secuenciaDe(transaccionesDe(roto, "falso")[0].cuerpo)) {
    if (e.lee && escribio) detecto = true;
    if (e.escribe) escribio = true;
  }
  ok(detecto, "el detector reconoce el patrón roto cuando se lo muestra");
}

// ============================ 2. movimientos de saldo dentro de bucles

console.log("\n=== 2. Nada que mueva saldo dentro de un bucle ===");

/** Lo que lee y escribe a la vez, y por lo tanto no puede repetirse. */
const PELIGROSA = /(?<!\.varias)\bmoverLeyendas\s*\(\s*tx|\btx\.(?:set|update)\s*\([^)]*(?:campoSaldo|CAMPO_SALDO|credits)/;
const BUCLE = /\b(?:for|while)\s*\(|\.forEach\s*\(|\.map\s*\(/g;

{
  // El caso que el orden por sí solo no detecta: UNA llamada que lee y
  // escribe, repetida por un `for`. En la primera vuelta el orden es
  // correcto; en la segunda, no.
  //
  // Lo que importa es un bucle DENTRO de una transacción. Un `for` que abre
  // una transacción por vuelta es correcto y frecuente —`crearSala` reintenta
  // códigos hasta encontrar uno libre, el cierre de ranking paga puesto por
  // puesto— y marcarlo como error haría que esta prueba se ignore, que es
  // peor que no tenerla.
  const enBucles = [];
  for (const archivo of archivos) {
    const texto = readFileSync(join(FUNCIONES, archivo), "utf8");
    for (const bloque of transaccionesDe(texto, archivo)) {
      BUCLE.lastIndex = 0;
      let m;
      while ((m = BUCLE.exec(bloque.cuerpo))) {
        if (PELIGROSA.test(cuerpoDelBloque(bloque.cuerpo, m.index))) {
          enBucles.push({
            archivo,
            transaccionEnLinea: bloque.linea,
            bucle: bloque.cuerpo.slice(m.index, m.index + 60).split("\n")[0].trim(),
          });
        }
      }
    }
  }
  ok(enBucles.length === 0,
     "ningún movimiento de saldo dentro de un bucle que esté dentro de una transacción",
     enBucles);

  // La prueba de la prueba: el patrón exacto que estaba roto en producción.
  const comoEraAntes = "db.runTransaction(async (tx) => {\n" +
    "  for (const jugador of aDevolver) {\n" +
    "    await moverLeyendas(tx, { uid: jugador, delta: entrada });\n" +
    "  }\n})";
  const t = transaccionesDe(comoEraAntes, "falso")[0];
  BUCLE.lastIndex = 0;
  const encontrado = BUCLE.exec(t.cuerpo);
  ok(encontrado && PELIGROSA.test(cuerpoDelBloque(t.cuerpo, encontrado.index)),
     "reconoce el bucle de devoluciones que estaba roto en producción");

  // Y no marca el patrón correcto: una transacción por vuelta.
  const correcto = "for (const x of lista) {\n" +
    "  await db.runTransaction(async (tx) => {\n" +
    "    await moverLeyendas(tx, { uid: x });\n" +
    "  });\n}";
  const t2 = transaccionesDe(correcto, "falso")[0];
  BUCLE.lastIndex = 0;
  ok(!BUCLE.exec(t2.cuerpo),
     "y NO marca una transacción por vuelta, que es el patrón correcto");
}

// ================================ 3. quién escribe el saldo, exactamente

console.log("\n=== 3. Todo lo que escribe `credits` ===");
{
  const escritores = [];
  for (const archivo of archivos) {
    const texto = readFileSync(join(FUNCIONES, archivo), "utf8");
    texto.split("\n").forEach((linea, i) => {
      const l = linea.trim();
      if (l.startsWith("*") || l.startsWith("//")) return;
      // Escribir el saldo es usarlo como CLAVE de un objeto.
      if (/\[campoSaldo\]\s*:|\[CAMPO_SALDO\]\s*:|(?<![\w.])credits\s*:/.test(l)) {
        escritores.push({ archivo, linea: i + 1, texto: l.slice(0, 62) });
      }
    });
  }
  console.log("  escrituras directas del campo de saldo:");
  escritores.forEach((e) => console.log(`    ${e.archivo}:${e.linea}  ${e.texto}`));

  ok(escritores.every((e) => e.archivo === "leyendas.js"),
     "el saldo se escribe SÓLO en leyendas.js",
     escritores.filter((e) => e.archivo !== "leyendas.js"));
  ok(escritores.length === 2, "y en dos lugares: el movimiento simple y el lote", escritores.length);
}

// ==================================== 4. quién llama a moverLeyendas

console.log("\n=== 4. Quién llama a moverLeyendas ===");
{
  // Sobre el texto entero, no línea por línea: las llamadas en lote parten
  // `moverLeyendas.varias(` y `tx` en dos renglones.
  const llamadas = [];
  for (const archivo of archivos) {
    // `leyendas.js` es donde la función se DEFINE: su propia firma coincide
    // con el patrón, y una definición no es una llamada.
    if (archivo === "leyendas.js") continue;
    const texto = readFileSync(join(FUNCIONES, archivo), "utf8");
    for (const m of texto.matchAll(/\bmoverLeyendas(\.varias)?\s*\(\s*\n?\s*tx/g)) {
      llamadas.push({
        archivo,
        linea: texto.slice(0, m.index).split("\n").length,
        forma: m[1] ? "varias" : "simple",
      });
    }
  }
  console.log("  llamadas que mueven Leyendas:");
  llamadas.forEach((c) =>
    console.log(`    ${c.archivo}:${String(c.linea).padStart(4)}  ${c.forma}`));

  const CONOCIDOS = new Set(["index.js", "abandono.js", "cierre.js", "salida.js"]);
  const raros = llamadas.filter((c) => !CONOCIDOS.has(c.archivo));
  ok(raros.length === 0, "todas están en operaciones económicas conocidas", raros);
  ok(llamadas.some((c) => c.forma === "varias"),
     "y las que pagan a más de uno usan el lote",
     llamadas.filter((c) => c.forma === "varias").length);
}

// ============================================ 5. los imports resuelven

console.log("\n=== 5. Los imports de index.js resuelven ===");
{
  const texto = readFileSync(join(FUNCIONES, "index.js"), "utf8");
  const rotos = [];
  let revisados = 0;
  for (const m of texto.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*"(\.[^"]+)"/g)) {
    const fuente = readFileSync(join(FUNCIONES, m[2].slice(2)), "utf8");
    for (const nombre of m[1].split(",").map((x) => x.trim()).filter(Boolean)) {
      revisados++;
      const re = new RegExp(`export\\s+(?:async\\s+)?(?:const|function|let|class)\\s+${nombre}\\b`);
      if (!re.test(fuente)) rotos.push({ nombre, de: m[2] });
    }
  }
  ok(rotos.length === 0, `los ${revisados} imports de index.js resuelven`, rotos);
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
