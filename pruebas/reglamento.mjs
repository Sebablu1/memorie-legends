/**
 * El reglamento y el código dicen lo mismo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `public/como-se-juega.html` es el reglamento oficial: no es un resumen de
 * otro documento, es el documento. Y un reglamento escrito a mano se separa
 * del juego sin que nadie se entere — ya pasó tres veces:
 *
 *   - decía que acertar tarde descartaba la carta «pero recibís una más»
 *     (neto 0) cuando el juego la conserva y suma una (neto +1), y así estuvo
 *     meses;
 *   - decía que la mirada duraba 2 segundos sin separar elegir de ver;
 *   - decía que el límite era 150 y nada más, cuando ya se jugaba a 60 y 100.
 *
 * Nada de eso lo agarra una prueba de reglas: el motor estaba bien. Lo que
 * estaba mal era lo que el jugador leía.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ COMPRUEBA, Y QUÉ NO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Los NÚMEROS, que son lo que se puede comparar sin interpretar prosa: la
 * tabla de tiempos contra las constantes del motor, y las duraciones contra
 * la lista de límites. Más un puñado de frases que ya estuvieron mal, para
 * que no vuelvan.
 *
 * No comprueba la redacción. Que el capítulo del descarte al rival explique
 * bien la jugada es trabajo de quien lo escribe; que diga «5 segundos» cuando
 * el motor espera 5000 ms, es trabajo de acá.
 */

import { readFileSync } from "node:fs";
import * as M from "../public/js/reglas/motor.js";
import { MS_GRACIA, MS_PARA_DECIDIR } from "../public/js/reglas/red.js";
import { MS_REVELACION } from "../public/js/reglas/vista.js";
import { MS_ESPERA_LLEGADAS } from "../functions/partida-red.js";
import { LIMITES_DE_PARTIDA } from "../public/js/reglas/puntaje.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

const pagina = readFileSync(
  new URL("../public/como-se-juega.html", import.meta.url), "utf8",
);

/** El texto de la página sin etiquetas, para buscar frases. */
const texto = pagina.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

/**
 * Las reglas, sin el anexo.
 *
 * El anexo CITA las frases viejas —«antes decía…»— y tiene que poder hacerlo:
 * es su trabajo. Lo que no puede pasar es que una de esas frases siga viva
 * arriba, donde se leen las reglas.
 */
const reglas = pagina.slice(0, pagina.indexOf('id="anexo"'));

// =====================================================================
console.log("\n=== 1. La tabla de tiempos sale de las constantes ===");
// =====================================================================

/**
 * Cada fila de la tabla, con el milisegundo que la respalda.
 *
 * La clave es el texto exacto de la primera columna. Si alguien la reescribe,
 * esta prueba se pone roja y hay que actualizar las dos cosas a la vez, que es
 * exactamente lo que se busca.
 */
const TIEMPOS = {
  "Elegir la carta de la mirada inicial": M.MS_ELEGIR_MIRADA,
  "Ver la carta mirada": M.MS_MIRAR,
  "Descarte por reflejos": M.MS_DESCARTE,
  "Gracia de red para un toque": MS_GRACIA,
  "Revelación por error o acierto tarde": MS_REVELACION,
  "Levantar del mazo": M.MS_TURNO,
  "Decidir qué hacer con la levantada": MS_PARA_DECIDIR,
  "Resolver un poder": MS_PARA_DECIDIR,
  "Cortar o pasar": M.MS_PASO_AUTOMATICO,
  "Elegir la carta que entregás tras un acierto": M.MS_PARA_ENTREGAR,
  "Ventana de reapertura al cambiar la muestra": M.MS_REAPERTURA,
  "Ventana privada después de un poder": M.MS_REAPERTURA,
  "Espera de jugadores en la primera ronda": MS_ESPERA_LLEGADAS,
  "Cuenta regresiva antes de la primera mirada": M.MS_CUENTA_REGRESIVA,
};

/** Las filas tal como están escritas: [momento, segundos]. */
const filas = [...pagina.matchAll(
  /<tr><td>([^<]+)<\/td><td class="num">(\d+) s<\/td>/g,
)].map((m) => [m[1].trim(), Number(m[2])]);

ok(filas.length === Object.keys(TIEMPOS).length,
   `la tabla tiene las ${Object.keys(TIEMPOS).length} filas esperadas`, filas.length);

for (const [momento, ms] of Object.entries(TIEMPOS)) {
  const fila = filas.find(([m]) => m === momento);
  if (!fila) {
    ok(false, `falta la fila "${momento}"`, filas.map(([m]) => m));
    continue;
  }
  ok(fila[1] * 1000 === ms,
     `"${momento}": la página dice ${fila[1]} s y el código ${ms} ms`,
     { pagina: fila[1] * 1000, codigo: ms });
}

// =====================================================================
console.log("\n=== 2. Las duraciones de partida son las tres ===");
// =====================================================================

for (const limite of LIMITES_DE_PARTIDA) {
  ok(texto.includes(String(limite)),
     `la página nombra el límite de ${limite} puntos`);
}

ok(/150, 100 o 60|150, 100 y 60|60, 100 o 150|—150, 100 o 60—/.test(texto),
   "y los ofrece juntos, como las tres duraciones de una misma mesa");

// =====================================================================
console.log("\n=== 3. Las frases que ya estuvieron mal ===");
// =====================================================================

/**
 * Cada una estuvo escrita en la página y contradecía al motor. No vuelven.
 */
const PROHIBIDAS = [
  [/la descartás igual/i, "el acierto tarde NO descarta la carta: la conserva y suma una"],
  [/Mirada · 2 segundos/i, "la mirada no dura 2 segundos: son 5 para elegir y 2 para ver"],
  [/por debajo de\s*<b>150 puntos<\/b>/i, "el límite no es siempre 150: la mesa lo elige"],
];

ok(reglas.length > 0 && reglas.length < pagina.length,
   "el anexo está al final y se puede separar de las reglas");

for (const [patron, porque] of PROHIBIDAS) {
  ok(!patron.test(reglas), porque);
}

/** Y lo que tiene que estar dicho, porque es lo que el juego hace. */
const EXIGIDAS = [
  [/conservás tu carta y sumás una de castigo/i, "el acierto tarde conserva la carta y suma una"],
  [/un intento por ventana/i, "un intento por ventana sobre la mano propia"],
  [/5 segundos para elegir, 2 para ver/i, "la mirada, con sus dos tiempos"],
  [/60 milisegundos/i, "el empate técnico y su sorteo determinista"],
  [/Anexo de cambios/i, "el anexo que cuenta qué cambió"],
];

for (const [patron, que] of EXIGIDAS) {
  ok(patron.test(texto) || patron.test(pagina), `la página explica ${que}`);
}

// =====================================================================
console.log("\n=== 4. La mirada, en los dos modos y en un solo lugar ===");
// =====================================================================

ok(M.MS_MIRADA_TOTAL === M.MS_ELEGIR_MIRADA + M.MS_MIRAR,
   "la mirada entera es elegir más ver", M.MS_MIRADA_TOTAL);

ok(M.MS_ELEGIR_MIRADA === 5000 && M.MS_MIRAR === 2000,
   "y son los 5 + 2 que dice el reglamento",
   { elegir: M.MS_ELEGIR_MIRADA, ver: M.MS_MIRAR });

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
