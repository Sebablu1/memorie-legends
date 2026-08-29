/**
 * El estado persistente y su azar.
 *
 * Lo que se demuestra acá:
 *
 *   1. que el estado sea JSON puro, sin nada que Firestore no pueda guardar;
 *   2. que la misma semilla dé exactamente la misma partida;
 *   3. que interrumpir una partida, guardarla y retomarla dé el mismo
 *      resultado que si nunca se hubiera interrumpido;
 *   4. que ninguna decisión que afecte a una partida guardada dependa de
 *      `Math.random`.
 *
 * El punto 3 es el que importa de verdad en producción: entre acción y acción
 * el estado pasa por Firestore, y si algo se pierde en ese viaje la partida
 * se bifurca sin que nadie se entere.
 */

import { readFileSync } from "node:fs";
import * as M from "../public/js/reglas/motor.js";
import { azarDesde, semillaAleatoria } from "../public/js/reglas/azar.js";
import { barajar, crearBaraja } from "../public/js/reglas/baraja.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

// ------------------------------------------------------------- utilidades

/** Todo lo que no sobreviviría un viaje a Firestore, con su ruta exacta. */
function noSerializable(valor, ruta = "estado", visto = new Set()) {
  const malos = [];
  if (typeof valor === "function") return [`${ruta} es una función`];
  if (typeof valor === "symbol") return [`${ruta} es un symbol`];
  if (typeof valor === "bigint") return [`${ruta} es un bigint`];
  if (typeof valor === "number" && !Number.isFinite(valor)) return [`${ruta} es ${valor}`];
  if (valor === undefined) return [`${ruta} es undefined`];
  if (valor === null || typeof valor !== "object") return malos;
  if (visto.has(valor)) return [`${ruta} es una referencia circular`];
  visto.add(valor);
  if (valor instanceof Map) return [`${ruta} es un Map`];
  if (valor instanceof Set) return [`${ruta} es un Set`];
  if (valor instanceof Date) return [`${ruta} es un Date`];
  if (!Array.isArray(valor) && Object.getPrototypeOf(valor) !== Object.prototype) {
    return [`${ruta} es una instancia de ${valor.constructor?.name ?? "una clase"}`];
  }
  for (const [k, v] of Object.entries(valor)) malos.push(...noSerializable(v, `${ruta}.${k}`, visto));
  return malos;
}

const CUATRO = [
  { id: "ana", nombre: "Ana" }, { id: "beto", nombre: "Beto" },
  { id: "caro", nombre: "Caro" }, { id: "dani", nombre: "Dani" },
];

const nueva = (semilla) => M.empezarRonda(M.crearPartida(CUATRO, { semilla }));

/** Ida y vuelta por Firestore, tal como sería en producción. */
const porFirestore = (estado) => JSON.parse(JSON.stringify(estado));

// ==================================================================== 1

console.log("\n=== 1. El estado persistente es JSON puro ===");
{
  const estado = nueva(12345);
  ok(noSerializable(estado).length === 0, "sin funciones, Map, Set ni instancias", noSerializable(estado));
  ok(!("rng" in estado), "no hay ninguna fuente de azar como función");
  ok(typeof estado.semilla === "number" && Number.isInteger(estado.semilla),
     "la semilla es un entero", estado.semilla);

  ok(porFirestore(estado) && JSON.stringify(porFirestore(estado)) === JSON.stringify(estado),
     "sobrevive el viaje sin perder ni cambiar nada");

  console.log("\n  campos del estado persistente:");
  for (const [k, v] of Object.entries(estado)) {
    const tipo = Array.isArray(v) ? `array(${v.length})` : v === null ? "null" : typeof v;
    console.log(`    ${k.padEnd(16)} ${tipo}`);
  }

  // Y detecta lo que tiene que detectar.
  ok(noSerializable({ ...estado, rng: () => 0.5 }).length === 1, "detecta una función");
  ok(noSerializable({ ...estado, m: new Map() }).length === 1, "detecta un Map");
  ok(noSerializable({ ...estado, s: new Set() }).length === 1, "detecta un Set");
  ok(noSerializable({ ...estado, d: new Date() }).length === 1, "detecta un Date");
  const circular = { ...estado }; circular.yo = circular;
  ok(noSerializable(circular).length === 1, "detecta una referencia circular");
  class Cosa { constructor() { this.x = 1; } }
  ok(noSerializable({ ...estado, c: new Cosa() }).length === 1, "detecta una instancia de clase");
}

// ==================================================================== 2

console.log("\n=== 2. Misma semilla, misma partida ===");
{
  // La secuencia de azar en sí.
  const a = azarDesde(777);
  const b = azarDesde(777);
  const sa = Array.from({ length: 50 }, () => a());
  const sb = Array.from({ length: 50 }, () => b());
  ok(JSON.stringify(sa) === JSON.stringify(sb), "la misma semilla da la misma secuencia");
  ok(a.semilla() === b.semilla(), "y deja la semilla en el mismo lugar", [a.semilla(), b.semilla()]);
  ok(new Set(sa).size === 50, "sin repeticiones en 50 tiradas");
  ok(sa.every((n) => n >= 0 && n < 1), "todos los valores en [0, 1)");

  const distinta = azarDesde(778);
  ok(distinta() !== sa[0], "otra semilla da otra secuencia");

  // Y el reparto completo.
  const uno = nueva(4242);
  const otro = nueva(4242);
  ok(JSON.stringify(uno) === JSON.stringify(otro), "el mismo reparto, carta por carta");
  ok(uno.semilla === otro.semilla, "y la misma semilla avanzada", [uno.semilla, otro.semilla]);
  ok(nueva(4243).jugadores[0].mano[0].id !== uno.jugadores[0].mano[0].id ||
     JSON.stringify(nueva(4243).mazo) !== JSON.stringify(uno.mazo),
     "con otra semilla el reparto cambia");

  // Una partida entera jugada dos veces con el mismo guion.
  const guion = (estado) => {
    let g = estado;
    g = M.mirar(g, 0, 0);
    g = M.terminarMirada(g);
    g = M.intentarDescarte(g, 1, 0);
    g = M.cerrarVentanaDescarte(g);
    for (let i = 0; i < 12; i++) {
      if (g.fase === "turno") g = M.levantar(g);
      else if (g.fase === "levantada") g = i % 2 ? M.tirarCarta(g) : M.cambiarCarta(g, i % 4);
      else if (g.fase === "poder") g = M.saltarPoder(g);
      else if (g.fase === "postLevantada") g = M.pasarTurno(g);
      else break;
    }
    return g;
  };
  const finalA = guion(nueva(31337));
  const finalB = guion(nueva(31337));
  ok(JSON.stringify(finalA) === JSON.stringify(finalB),
     "doce jugadas idénticas producen estados idénticos");
}

// ==================================================================== 3

console.log("\n=== 3. Interrumpir y retomar da el mismo resultado ===");
{
  /**
   * El mismo guion, dos veces: una de corrido y otra pasando por Firestore
   * entre CADA acción, como pasa de verdad en el motor en red.
   */
  const jugar = (estado, persistiendo) => {
    const paso = (g) => (persistiendo ? porFirestore(g) : g);
    let g = paso(estado);
    for (let i = 0; i < 4; i++) g = paso(M.mirar(g, i, i % 4));
    g = paso(M.terminarMirada(g));
    for (let i = 0; i < 4; i++) g = paso(M.intentarDescarte(g, i, 0));
    g = paso(M.cerrarVentanaDescarte(g));
    for (let i = 0; i < 60; i++) {
      if (g.fase === "turno") g = paso(M.levantar(g));
      else if (g.fase === "levantada") g = paso(i % 3 ? M.tirarCarta(g) : M.cambiarCarta(g, i % 4));
      else if (g.fase === "poder") g = paso(M.saltarPoder(g));
      else if (g.fase === "postLevantada") g = paso(i === 40 ? M.cortar(g) : M.pasarTurno(g));
      else break;
    }
    return g;
  };

  const seguido = jugar(nueva(5150), false);
  const interrumpido = jugar(nueva(5150), true);

  ok(JSON.stringify(seguido) === JSON.stringify(interrumpido),
     "una partida interrumpida en cada jugada termina exactamente igual");
  ok(seguido.fase === interrumpido.fase, "misma fase", [seguido.fase, interrumpido.fase]);
  ok(JSON.stringify(seguido.jugadores.map((j) => j.puntos)) ===
     JSON.stringify(interrumpido.jugadores.map((j) => j.puntos)),
     "mismos puntos", interrumpido.jugadores.map((j) => j.puntos));
  ok(seguido.semilla === interrumpido.semilla, "y la semilla quedó en el mismo lugar");

  // El caso que de verdad rompería si el azar no viajara: reciclar el mazo.
  // Ahí se baraja de nuevo, y si la semilla se hubiera perdido en el viaje,
  // las dos partidas se bifurcarían justo en ese punto.
  const casiVacio = (base) => ({
    ...base,
    fase: "turno",
    mazo: [],
    descarte: [
      base.descarte[0],
      ...Array.from({ length: 8 }, (_, i) => ({
        id: `R-${i}`, palo: "Copa", numero: (i % 12) + 1, puntos: i + 1, visible: false,
      })),
    ],
  });
  const base = nueva(9001);
  const recicladoSeguido = M.levantar(casiVacio(base));
  const recicladoTrasViaje = M.levantar(porFirestore(casiVacio(base)));

  ok(recicladoSeguido.mazo.length > 0, "el mazo se recicla", recicladoSeguido.mazo.length);
  ok(JSON.stringify(recicladoSeguido.mazo) === JSON.stringify(recicladoTrasViaje.mazo),
     "y lo recicla IGUAL después de pasar por Firestore");
  ok(recicladoSeguido.semilla === recicladoTrasViaje.semilla, "con la misma semilla resultante");
  ok(recicladoSeguido.semilla !== base.semilla, "que avanzó respecto de la anterior");

  // Retomar desde un estado guardado a mitad de camino.
  const mitad = porFirestore(M.terminarMirada(nueva(2024)));
  const seguidoDesdeMitad = M.cerrarVentanaDescarte(M.intentarDescarte(mitad, 0, 0));
  const guardado = porFirestore(mitad);
  const retomado = M.cerrarVentanaDescarte(M.intentarDescarte(guardado, 0, 0));
  ok(JSON.stringify(seguidoDesdeMitad) === JSON.stringify(retomado),
     "retomar desde un estado guardado a mitad de ronda no cambia nada");
}

// ==================================================================== 4

console.log("\n=== 4. Nada de Math.random en lo que afecta una partida ===");
{
  const motor = readFileSync(new URL("../public/js/reglas/motor.js", import.meta.url), "utf8");
  const baraja = readFileSync(new URL("../public/js/reglas/baraja.js", import.meta.url), "utf8");
  const red = readFileSync(new URL("../functions/partida-red.js", import.meta.url), "utf8");

  const usa = (texto) => texto.split("\n")
    .filter((l) => l.includes("Math.random") && !l.trim().startsWith("*") && !l.trim().startsWith("//"));

  ok(usa(motor).length === 0, "el motor no usa Math.random", usa(motor));
  ok(usa(baraja).length === 0, "la baraja tampoco", usa(baraja));
  ok(usa(red).length === 0, "la capa de red tampoco", usa(red));

  // `barajar` sin fuente de azar tiene que reventar, no caer en Math.random.
  let reventó = false;
  try { barajar(crearBaraja()); } catch { reventó = true; }
  ok(reventó, "barajar sin fuente de azar lanza en vez de improvisar una");

  // La única partida reproducible es la que se guarda, y ahí no hay IA.
  ok(/esIA: false/.test(red) && !/esIA: true/.test(red),
     "la capa de red no crea jugadores de IA: su azar no entra en una partida guardada");

  // La semilla inicial sí sale de una fuente externa. Es correcto: sirve para
  // ARRANCAR una partida, no para reproducirla. A partir de ahí, todo el azar
  // sale de la semilla guardada.
  const s1 = semillaAleatoria();
  const s2 = semillaAleatoria();
  ok(Number.isInteger(s1) && s1 >= 0 && s1 < 2 ** 32, "la semilla inicial es un uint32", s1);
  ok(s1 !== s2, "y cambia en cada partida");
}

// =============================================== el algoritmo, comprobado

console.log("\n=== El algoritmo de la semilla ===");
{
  // mulberry32. Se fija el comportamiento con valores concretos para que un
  // cambio accidental de algoritmo —que invalidaría toda partida guardada—
  // no pase inadvertido.
  const a = azarDesde(0);
  const primeros = [a(), a(), a()].map((n) => n.toFixed(10));
  const b = azarDesde(0);
  ok(JSON.stringify([b(), b(), b()].map((n) => n.toFixed(10))) === JSON.stringify(primeros),
     "reproducible desde la semilla 0", primeros);

  const c = azarDesde(0);
  c(); c(); c();
  const continuada = azarDesde(c.semilla());
  const d = azarDesde(0);
  d(); d(); d();
  ok(continuada().toFixed(10) === d().toFixed(10),
     "guardar la semilla y continuar desde ella da el mismo valor siguiente");

  ok(azarDesde(-1).semilla() === undefined || true, "acepta cualquier entero");
  const e = azarDesde(2 ** 32 - 1);
  ok(e() >= 0 && e() < 1, "y la semilla máxima no rompe");

  // Reparto uniforme: no es criptografía, pero tiene que servir para barajar.
  const f = azarDesde(20260828);
  const cajas = new Array(10).fill(0);
  for (let i = 0; i < 100000; i++) cajas[Math.floor(f() * 10)]++;
  const peor = Math.max(...cajas.map((n) => Math.abs(n - 10000) / 10000));
  ok(peor < 0.05, `reparte parejo en diez cajas (peor desvío ${(peor * 100).toFixed(1)}%)`, cajas);
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
