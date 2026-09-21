/**
 * De qué juego es cada cosa, sin una lista de juegos en el código.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE SE DEFIENDE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Salas, partidas, economía y rankings son de todos los juegos; qué juegos
 * existen lo dice la colección `juegos/{id}`, no el código. Hoy hay uno, y el
 * riesgo es que el código empiece a suponerlo sin decirlo: un
 * `juego === "memorie"` acá, un `juego: "memorie"` allá, y el día que llegue
 * el segundo hay que encontrarlos a todos.
 *
 * Así que se prueba tres cosas:
 *
 *   1. `juegoDe` acepta cualquier id —no hay lista— y le da a lo viejo, que
 *      no tiene el campo, el juego que tenía: Memorie.
 *   2. La partida guarda el juego de su sala, sea cual sea.
 *   3. Nadie compara ni asigna un juego escrito a mano fuera de
 *      `reglas/juegos.js`, y todo lo que crea salas o partidas escribe el campo.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { crearMotorEnRed } from "../functions/partida-red.js";
import { JUEGO_POR_DEFECTO, juegoDe } from "../public/js/reglas/juegos.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else {
    fallos++;
    console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : "");
  }
};

class E extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo;
  }
}
const error = (codigo, mensaje) => new E(codigo, mensaje);

const RAIZ = join(fileURLToPath(new URL("..", import.meta.url)));

// =====================================================================
console.log("\n=== 1. juegoDe: cualquier id, y lo viejo es de Memorie ===");
// =====================================================================

ok(JUEGO_POR_DEFECTO === "memorie", "el juego de todo lo anterior al campo es Memorie");
ok(juegoDe({}) === JUEGO_POR_DEFECTO, "un documento sin el campo, es de Memorie");
ok(juegoDe(null) === JUEGO_POR_DEFECTO && juegoDe(undefined) === JUEGO_POR_DEFECTO,
   "sin documento, también");
ok(juegoDe({ juego: "truco" }) === "truco", "uno de Truco, es de Truco");
// No hay una lista: cualquier id pasa. Validar cuáles existen es trabajo de
// la colección `juegos/`, no de esta función.
ok(juegoDe({ juego: "x-mas-b" }) === "x-mas-b", "y uno que nadie conoce, también pasa");
ok(juegoDe({ juego: "" }) === JUEGO_POR_DEFECTO && juegoDe({ juego: "   " }) === JUEGO_POR_DEFECTO,
   "un texto vacío no es un juego");
ok(juegoDe({ juego: 5 }) === JUEGO_POR_DEFECTO, "ni un número");

// =====================================================================
console.log("\n=== 2. La partida guarda el juego de su sala ===");
// =====================================================================

function crearFirestore() {
  const docs = new Map();
  const referencia = (ruta) => ({ ruta });
  return {
    collection: (n) => ({ doc: (id) => referencia(`${n}/${id}`) }),
    async runTransaction(cuerpo) {
      let escribio = false;
      const pendientes = [];
      const r = await cuerpo({
        async get(ref) {
          if (escribio) throw error("failed-precondition", "Lectura después de escribir");
          const d = docs.get(ref.ruta);
          return { exists: Boolean(d), data: () => (d ? structuredClone(d) : undefined) };
        },
        set(ref, datos) {
          escribio = true;
          pendientes.push([ref.ruta, datos]);
        },
        update(ref, datos) {
          escribio = true;
          pendientes.push([ref.ruta, { ...(docs.get(ref.ruta) ?? {}), ...datos }]);
        },
      });
      for (const [ruta, datos] of pendientes) docs.set(ruta, structuredClone(datos));
      return r;
    },
    leer: (ruta) => docs.get(ruta),
  };
}

async function repartir(juego) {
  const db = crearFirestore();
  const red = crearMotorEnRed({
    db, partidas: "partidas", ahora: () => 1_000_000, idAleatorio: () => "v1",
    marcaDeTiempo: () => "T", error, semillaDe: () => 4242,
  });
  await red.repartir({
    codigo: "JUEGO1", jugadores: ["ana", "beto"], nombres: ["Ana", "Beto"],
    ...(juego === undefined ? {} : { juego }),
  });
  return db.leer("partidas/JUEGO1");
}

{
  ok((await repartir(undefined))?.juego === JUEGO_POR_DEFECTO,
     "sin que la sala diga nada, la partida es de Memorie");
  ok((await repartir("otro-juego"))?.juego === "otro-juego",
     "y si la sala es de otro juego, la partida también", (await repartir("otro-juego"))?.juego);
}

// =====================================================================
console.log("\n=== 3. Ningún juego escrito a mano ===");
// =====================================================================

/** Todos los .js del cliente y del servidor, menos las copias de las reglas. */
function archivos(dir) {
  const salida = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (nombre === "node_modules" || nombre === "vendor") continue;
    // `functions/reglas` es una copia de `public/js/reglas`: se mira el original.
    if (ruta === join(RAIZ, "functions", "reglas")) continue;
    if (statSync(ruta).isDirectory()) salida.push(...archivos(ruta));
    else if (/\.m?js$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

{
  const fuentes = [...archivos(join(RAIZ, "functions")), ...archivos(join(RAIZ, "public", "js"))];
  const definicion = join(RAIZ, "public", "js", "reglas", "juegos.js");

  // Un juego comparado o asignado con un texto literal: `juego === "x"`,
  // `juego: "x"`, `case "x":` al lado de un `juego`… Todo eso es una lista
  // escrita sin decirlo. `typeof juego === "string"` no cuenta: pregunta el
  // tipo, no el juego.
  const aMano = /(?<!typeof\s+)\bjuego\s*(?:===|!==|==|!=|:)\s*["'`]/;
  const encontrados = [];
  for (const ruta of fuentes) {
    if (ruta === definicion) continue;
    readFileSync(ruta, "utf8").split("\n").forEach((linea, i) => {
      if (aMano.test(linea) && !/^\s*(\*|\/\/)/.test(linea)) {
        encontrados.push(`${ruta.slice(RAIZ.length)}:${i + 1}`);
      }
    });
  }
  ok(encontrados.length === 0, "nadie compara ni asigna un juego escrito a mano", encontrados);

  const definiciones = fuentes.filter((r) =>
    /export const JUEGO_POR_DEFECTO\b/.test(readFileSync(r, "utf8")));
  ok(definiciones.length === 1 && definiciones[0] === definicion,
     "y el juego por omisión se define en un solo lugar", definiciones);
}

{
  // Todo lo que crea una sala o una partida escribe el campo.
  const index = readFileSync(join(RAIZ, "functions", "index.js"), "utf8");
  const publicas = readFileSync(join(RAIZ, "functions", "salas-publicas.js"), "utf8");

  ok(/modo: "leyendas",\s*(?:\/\/[^\n]*\n\s*)*juego: JUEGO_POR_DEFECTO,/.test(index),
     "toda sala de jugador nace con su juego (abrirSalaEn)");
  ok(/juego: juegoDe\(sala\),/.test(index.slice(index.indexOf("export const revanchaDeSala"))),
     "la revancha hereda el de la sala original");
  const iniciar = index.slice(index.indexOf("export const iniciarPartida"));
  ok(/enRed\.repartirEn\(tx, \{[\s\S]*?juego: juegoDe\(sala\),[\s\S]*?\}\);/.test(iniciar),
     "la partida recibe el juego de su sala al repartirse");
  ok(/juego: JUEGO_POR_DEFECTO/.test(publicas) && /juego: juegoDe\(sala\)/.test(publicas),
     "una mesa pública nace con su juego, y la reapertura hereda el de la que empezó");

  // El ranking: las filas van a las tablas del juego de la partida, y la
  // página pide las del juego por omisión con la ruta compartida, no una
  // armada a mano.
  const cierre = readFileSync(join(RAIZ, "functions", "cierre.js"), "utf8");
  const ranking = readFileSync(join(RAIZ, "functions", "ranking.js"), "utf8");
  const pagina = readFileSync(join(RAIZ, "public", "js", "ranking-ui.js"), "utf8");
  ok(/juego: juegoDe\(sala\),/.test(cierre), "lo que pasa al ranking lleva el juego de la sala");
  ok(/const deQueJuego = juegoDe\(\{ juego \}\);/.test(ranking),
     "y quien puntúa escribe en las tablas de ese juego");
  ok(/RUTAS_RANKING\.filas\(JUEGO_POR_DEFECTO, clave\)/.test(pagina),
     "la página del ranking lee la tabla del juego con la ruta compartida");
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
