/**
 * Quién puede leer una sala, y cómo pregunta el navegador.
 *
 *   1. La regla de `rooms`: pública o sentado, y nada más.
 *   2. Toda consulta del navegador a `rooms` pide sólo lo que la regla deja
 *      ver: las públicas, o las mías.
 *   3. La lista de casos de `herramientas/probar-reglas.mjs` está completa.
 *   4. Los juegos se leen sin sesión y no se escriben desde el navegador.
 *
 * Lo que la regla HACE lo prueba esa herramienta contra el motor de Google
 * (necesita red y credenciales, así que no corre acá). Esto prueba lo que se
 * puede probar sin red: que la regla diga lo que tiene que decir, que el
 * navegador no pida algo que la regla va a rechazar, y que nadie le saque un
 * caso a la herramienta.
 *
 * El punto 2 importa más de lo que parece: Firestore no filtra una consulta
 * según las reglas, la RECHAZA entera si podría traer algo prohibido. Una
 * consulta de "todas las salas en espera" no devolvería las permitidas: no
 * devolvería nada, y la tabla quedaría vacía sin ningún error a la vista.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { CASOS, SALAS, QUIENES } from "../herramientas/probar-reglas.mjs";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (...p) => readFileSync(join(REPO, ...p), "utf8");
const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

console.log("\n=== 1. La regla de las salas ===");
{
  const reglas = sinComentarios(leer("firestore.rules"));
  const bloque = reglas.match(/match \/rooms\/\{salaId\}\s*\{([^}]*)\}/)?.[1] ?? "";
  const lectura = (bloque.match(/allow read:([^;]*);/)?.[1] ?? "").replace(/\s+/g, " ").trim();

  ok(bloque !== "", "existe el bloque de rooms");
  ok(/^if autenticado\(\) && \(/.test(lectura), "leer exige sesión", lectura);
  ok(lectura.includes("resource.data.publica == true"), "se lee si es pública", lectura);
  ok(lectura.includes("request.auth.uid in resource.data.jugadores"), "o si estás sentado", lectura);
  ok(!/^if autenticado\(\)$/.test(lectura), "ya no alcanza con tener sesión", lectura);
  // Nada más: un tercer camino —«o si la creaste», «o si está listada»— es
  // una puerta más, y tiene que pasar por acá para abrirse.
  ok(lectura === "if autenticado() && (resource.data.publica == true || request.auth.uid in resource.data.jugadores)",
     "y no hay ningún otro camino", lectura);
  ok(/allow write: if false;/.test(bloque), "el navegador sigue sin poder escribir");
}

console.log("\n=== 2. Las consultas del navegador ===");
{
  // Todos los archivos del navegador.
  const archivos = [];
  const recorrer = (carpeta) => {
    for (const e of readdirSync(join(REPO, carpeta), { withFileTypes: true })) {
      const ruta = join(carpeta, e.name);
      if (e.isDirectory()) recorrer(ruta);
      else if (e.name.endsWith(".js")) archivos.push(ruta);
    }
  };
  recorrer("public");

  const PERMITIDAS = [
    { nombre: "las mías", patron: /where\(\s*"jugadores",\s*"array-contains",\s*miUid\s*\)/ },
    { nombre: "las públicas", patron: /where\(\s*"publica",\s*"==",\s*true\s*\)/ },
  ];

  const consultas = [];
  for (const ruta of archivos) {
    const texto = sinComentarios(readFileSync(join(REPO, ruta), "utf8"));
    for (const m of texto.matchAll(/collection\(\s*db\s*,\s*"rooms"\s*\)/g)) {
      // La sentencia entera: desde el `query(` que la envuelve hasta el `;`.
      const antes = texto.slice(Math.max(0, m.index - 80), m.index);
      const despues = texto.slice(m.index, texto.indexOf(";", m.index) + 1);
      consultas.push({
        donde: relative(REPO, join(REPO, ruta)).replaceAll("\\", "/"),
        dentroDeQuery: /query\(\s*$/.test(antes),
        tipo: PERMITIDAS.find((p) => p.patron.test(despues))?.nombre ?? null,
      });
    }
  }

  ok(consultas.length > 0, "el navegador consulta salas", consultas);
  const sueltas = consultas.filter((c) => !c.dentroDeQuery);
  ok(sueltas.length === 0, "nadie pide la colección entera, sin consulta", sueltas);
  const sinFiltro = consultas.filter((c) => !c.tipo);
  ok(sinFiltro.length === 0, "toda consulta pide las públicas o las mías", sinFiltro);

  const de = (archivo) => consultas.filter((c) => c.donde === archivo).map((c) => c.tipo);
  ok(de("public/js/dashboard.js").every((t) => t === "las mías") && de("public/js/dashboard.js").length === 1,
     "el tablero pide las suyas", de("public/js/dashboard.js"));
  ok(de("public/js/lobby.js").every((t) => t === "las públicas") && de("public/js/lobby.js").length === 1,
     "el lobby pide las públicas", de("public/js/lobby.js"));
}

console.log("\n=== 3. La lista de casos contra el motor de reglas ===");
{
  const nombres = new Set(CASOS.map((c) => c.nombre));
  for (const tipo of Object.keys(SALAS)) {
    for (const quien of Object.keys(QUIENES)) {
      ok(nombres.has(`sala ${tipo}, leída por alguien ${quien}`), `está el caso: sala ${tipo}, ${quien}`);
    }
  }
  ok(["pública", "privada", "revancha", "vieja"].every((t) => t in SALAS),
     "la matriz tiene los cuatro tipos de sala", Object.keys(SALAS));
  ok(["sentado", "ajeno", "sin sesión"].every((q) => q in QUIENES),
     "y los tres que preguntan", Object.keys(QUIENES));

  const esperado = (nombre) => CASOS.find((c) => c.nombre === nombre)?.esperado;
  ok(esperado("sala privada, leída por alguien ajeno") === "DENY", "una privada ajena se niega");
  ok(esperado("sala pública, leída por alguien ajeno") === "ALLOW", "una pública se lee");
  ok(esperado("sala vieja, leída por alguien sentado") === "ALLOW",
     "una sala sin el campo `publica` la sigue leyendo quien está sentado");
  ok(esperado("sala que no existe, leída por alguien con sesión") === "DENY", "una que no existe se niega");

  // Lo que ya estaba cerrado: cambiar una regla es la ocasión de abrir otra
  // sin querer.
  for (const n of ["perfil propio", "perfil ajeno", "código de sala privada", "movimiento propio",
                   "movimiento ajeno", "partida, aunque la juegue",
                   "juego, leído sin sesión", "juego, escrito por alguien con sesión"]) {
    ok(nombres.has(n), `sigue el resguardo: ${n}`);
  }
  ok(CASOS.every((c) => c.esperado === "ALLOW" || c.esperado === "DENY"),
     "cada caso dice qué espera");
}

console.log("\n=== 4. Los juegos: se leen sin sesión, no se escriben ===");
{
  // El lobby lee `juegos/{id}` para saber qué mostrar. Son nombres y logos:
  // nada que esconder. Escribirlos es de la administración.
  const reglas = sinComentarios(leer("firestore.rules"));
  const bloque = reglas.match(/match \/juegos\/\{juegoId\}\s*\{([^}]*)\}/)?.[1] ?? "";
  ok(/allow read: if true;/.test(bloque), "se leen sin sesión");
  ok(/allow write: if false;/.test(bloque), "y el navegador no los escribe");
}

console.log(fallos ? `\n❌ ${fallos} fallo(s)` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
