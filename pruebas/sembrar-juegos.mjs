/**
 * La siembra de `juegos/{id}`: crea lo que falta, nunca pisa ni borra, y no
 * suma juegos que nadie pidió.
 */

import { JUEGOS, planDeSiembra } from "../herramientas/sembrar-juegos.mjs";
import { JUEGO_POR_DEFECTO } from "../public/js/reglas/juegos.js";
import { esRutaDelSitio } from "../public/js/reglas/catalogo.js";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

console.log("\n=== 1. La semilla ===");
{
  ok(JUEGOS.length === 1 && JUEGOS[0].id === JUEGO_POR_DEFECTO,
     "un solo juego, el de siempre", JUEGOS.map((j) => j.id));
  const [memorie] = JUEGOS;
  ok(memorie.activo === true && memorie.orden === 1 && memorie.nombre === "Memorie Legends",
     "activo, primero y con su nombre", memorie);
  ok(["nombre", "activo", "orden", "logo", "colores", "config"].every((k) => k in memorie),
     "con todos los campos del documento");
  ok(esRutaDelSitio(memorie.logo) && existsSync(join(REPO, "public", memorie.logo)),
     "el logo es un archivo del sitio, y existe", memorie.logo);
  ok(!JUEGOS.some((j) => /truco/i.test(`${j.id} ${j.nombre}`)),
     "Truco no está: se agrega cuando se pida");
}

console.log("\n=== 2. Crea lo que falta ===");
{
  const plan = planDeSiembra(new Set());
  ok(plan.length === 1 && plan[0].ruta === "juegos/memorie", "con la colección vacía, crea el juego", plan);
  ok(!("id" in plan[0].datos), "el id va en la ruta, no repetido en el documento", plan[0].datos);
}

console.log("\n=== 3. No pisa lo que existe ===");
{
  // Alguien lo desactivó desde la consola: volver a sembrar no lo reactiva.
  ok(planDeSiembra(new Set(["memorie"])).length === 0, "si ya existe, no escribe nada");
  const otro = { id: "otro", nombre: "Otro", activo: false, orden: 2, logo: "/img/moneda-80.webp", colores: {}, config: {} };
  const plan = planDeSiembra(new Set(["memorie"]), [...JUEGOS, otro]);
  ok(plan.length === 1 && plan[0].ruta === "juegos/otro", "de dos, crea sólo el que falta", plan);
}

console.log("\n=== 4. Escribe con create, nunca con set ni delete ===");
{
  const fuente = readFileSync(join(REPO, "herramientas", "sembrar-juegos.mjs"), "utf8");
  ok(/\.create\(datos\)/.test(fuente), "crea con create: si apareció en el medio, falla en vez de pisarlo");
  ok(!/\.set\(|\.delete\(|\.update\(/.test(fuente), "no tiene set, update ni delete");
  ok(/includes\("--escribir"\)/.test(fuente) && /if \(!escribir\)/.test(fuente),
     "sin --escribir, sólo dice qué haría");
}

console.log(fallos ? `\n❌ ${fallos} fallo(s)` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
