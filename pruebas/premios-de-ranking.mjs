/**
 * Cada ranking paga lo suyo, y ganar el año vale más que ganar una semana.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE ROMPIÓ Y POR QUÉ NADIE LO VIO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `premioPorPuesto` recibía sólo el puesto. `cerrarPeriodo` la llamaba igual
 * para los tres rankings, así que el 1º cobraba 500 en el semanal, 500 en el
 * mensual y 500 en el anual.
 *
 * Nada fallaba. Los premios llegaban, el libro mayor cerraba, las pruebas
 * pasaban. Lo que estaba mal no era un cálculo sino una FRECUENCIA: el
 * semanal cierra 52 veces al año y el anual una. Ganar todas las semanas
 * pagaba 26.000 y ganar el año entero, 500 —el ranking más difícil del juego
 * era el que menos pagaba—, y el semanal él solo emitía 106.600 Leyendas al
 * año contra un registro que da 100.
 *
 * Un error así no se encuentra leyendo la función, porque la función está
 * bien. Se encuentra multiplicando por las veces que corre. Por eso la última
 * sección de este archivo hace exactamente esa cuenta y la deja escrita: si
 * mañana alguien cambia un multiplicador o la frecuencia de un cierre, el
 * número anual cambia y hay que venir a mirarlo a propósito.
 */

import { PERIODOS } from "../public/js/reglas/ranking.js";
import {
  PREMIOS_RANKING,
  MULTIPLICADOR_DE_PERIODO,
  multiplicadorDePeriodo,
  premioPorPuesto,
} from "../public/js/reglas/economia.js";

let fallos = 0;
const ok = (condicion, mensaje, extra) => {
  if (condicion) {
    console.log(`  ✓ ${mensaje}`);
  } else {
    fallos++;
    console.log(`  ✗ ${mensaje}${extra === undefined ? "" : ` ${JSON.stringify(extra)}`}`);
  }
};

// =====================================================================
console.log("\n=== 1. Los tres períodos pagan, y pagan distinto ===");
// =====================================================================

{
  // La tabla base es la SEMANAL: es la unidad de la que salen las otras dos.
  const semanal = [
    [1, 100],
    [2, 60],
    [3, 30],
    [10, 10],
    [50, 5],
  ];

  for (const [puesto, leyendas] of semanal) {
    ok(premioPorPuesto(puesto, "semanal")?.leyendas === leyendas,
       `semanal, puesto ${puesto}: ${leyendas}`,
       premioPorPuesto(puesto, "semanal"));
  }

  for (const [puesto, base] of semanal) {
    ok(premioPorPuesto(puesto, "mensual")?.leyendas === base * 5,
       `mensual, puesto ${puesto}: ${base * 5}`,
       premioPorPuesto(puesto, "mensual"));
    ok(premioPorPuesto(puesto, "anual")?.leyendas === base * 15,
       `anual, puesto ${puesto}: ${base * 15}`,
       premioPorPuesto(puesto, "anual"));
  }

  // Y el tramo es el más alto alcanzado, no la suma de los que uno cruza.
  ok(premioPorPuesto(1, "anual").leyendas === 1500,
     "el campeón del año cobra su tramo y nada más, no 1500+150+75");

  ok(premioPorPuesto(51, "anual") === null, "del 51 para abajo no hay premio en ningún período");
  ok(premioPorPuesto(0, "semanal")?.leyendas === 100,
     "y un puesto 0 cae en el primer tramo, como cualquier puesto <= 1");
}

// =====================================================================
console.log("\n=== 2. El premio dice de dónde salió su número ===");
// =====================================================================

{
  const p = premioPorPuesto(2, "mensual");
  ok(p.base === 60, "trae la base semanal", p);
  ok(p.multiplicador === 5, "y el multiplicador que se le aplicó", p);
  ok(p.base * p.multiplicador === p.leyendas, "que multiplicados dan el total", p);

  // Sin esto, el asiento del libro mayor diría "300" y nada más, y entender de
  // dónde salió obligaría a reconstruir la tabla del día en que se pagó.
  ok(typeof p.etiqueta === "string" && p.etiqueta.length > 0, "y sigue trayendo su etiqueta");
}

// =====================================================================
console.log("\n=== 3. Un período desconocido se rompe, no paga de menos ===");
// =====================================================================

{
  /**
   * El defecto silencioso sería peor que el error.
   *
   * Si un período que la tabla no conoce valiera 1, el campeón del año
   * cobraría 100 en vez de 1.500 y nadie se enteraría: un premio que llega no
   * se reclama. Romperse es la única forma de que alguien mire.
   */
  for (const malo of ["diario", "SEMANAL", "", null, undefined, "anual ", 5]) {
    let tiro = false;
    try {
      premioPorPuesto(1, malo);
    } catch {
      tiro = true;
    }
    ok(tiro, `se rompe con el período ${JSON.stringify(malo)}`);
  }

  // Y el mensaje tiene que servir para arreglarlo: dice cuáles sí valen.
  let mensaje = "";
  try {
    multiplicadorDePeriodo("diario");
  } catch (e) {
    mensaje = e.message;
  }
  ok(PERIODOS.every((p) => mensaje.includes(p)),
     "y el error nombra los períodos que sí pagan", mensaje);
}

// =====================================================================
console.log("\n=== 4. La tabla de multiplicadores y PERIODOS no se separan ===");
// =====================================================================

{
  /**
   * Son dos listas en dos archivos y tienen que decir lo mismo.
   *
   * `PERIODOS` vive en `ranking.js` y los multiplicadores en `economia.js`,
   * porque `ranking.js` ya importa de `economia.js` y el import de vuelta
   * sería un ciclo. El precio de no importar es que se pueden desincronizar,
   * y esto es lo que cobra ese precio: agregar un período en un archivo y
   * olvidarlo en el otro significa un ranking que se cierra y no paga, o que
   * se rompe al pagar.
   */
  const conMultiplicador = Object.keys(MULTIPLICADOR_DE_PERIODO).sort();
  ok(JSON.stringify(conMultiplicador) === JSON.stringify([...PERIODOS].sort()),
     "todo período del ranking tiene multiplicador, y viceversa",
     { PERIODOS, conMultiplicador });

  ok(Object.isFrozen(MULTIPLICADOR_DE_PERIODO), "y la tabla está congelada");
}

// =====================================================================
console.log("\n=== 5. Lo que esto emite en un año ===");
// =====================================================================

{
  /**
   * La cuenta que faltaba hacer.
   *
   * El error viejo no se veía en la función, se veía multiplicando por las
   * veces que corre cada cierre. Así que la cuenta queda escrita, con los
   * cierres tomados de los cron de `functions/index.js`.
   */
  const CIERRES_POR_ANIO = { semanal: 52, mensual: 12, anual: 1 };

  const porCierre = (periodo) => {
    let total = 0;
    for (let puesto = 1; puesto <= 50; puesto++) {
      total += premioPorPuesto(puesto, periodo)?.leyendas ?? 0;
    }
    return total;
  };

  const anual = {};
  for (const periodo of PERIODOS) {
    anual[periodo] = porCierre(periodo) * CIERRES_POR_ANIO[periodo];
  }
  const total = Object.values(anual).reduce((a, b) => a + b, 0);

  console.log(`      semanal: ${porCierre("semanal")} × 52 = ${anual.semanal}`);
  console.log(`      mensual: ${porCierre("mensual")} × 12 = ${anual.mensual}`);
  console.log(`      anual:   ${porCierre("anual")} ×  1 = ${anual.anual}`);
  console.log(`      total:   ${total} Leyendas al año\n`);

  ok(total === 58420,
     "el ranking emite 58.420 Leyendas al año con los 50 puestos llenos", total);

  // Lo que el arreglo vino a corregir: que ganar el año valga más que ganar
  // una semana, y que el semanal deje de ser la canilla principal.
  ok(premioPorPuesto(1, "anual").leyendas > premioPorPuesto(1, "semanal").leyendas * 10,
     "ganar el año paga mucho más que ganar una semana");

  ok(anual.semanal < 133250 / 2,
     "y el semanal emite menos de la mitad de lo que emitía todo el sistema antes",
     anual.semanal);
}

console.log(fallos ? `\n❌ ${fallos} fallos\n` : "\n✅ TODO OK\n");
process.exit(fallos ? 1 : 0);
