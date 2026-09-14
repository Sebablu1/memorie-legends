/**
 * Los diez segundos para decidir: la tabla, antes que el reloj.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE PRUEBA ACÁ Y QUÉ NO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Acá se prueba QUÉ pasa al vencer, por fase. No se prueba CUÁNDO vence: eso
 * lo calcula el servidor con su reloj, en `plazoDe`, y se prueba contra un
 * Firestore de mentira en `pruebas/paso-automatico.mjs`.
 *
 * La separación no es ceremonia. La tabla es la parte que se discutió —cuándo
 * el servidor juega por alguien y cuándo no— y es la que hay que poder leer,
 * cambiar y revisar sin levantar nada. El reloj es plomería.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ IMPORTA TANTO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque es la primera vez que el servidor juega una carta que nadie tocó, y
 * pasa en partidas que cobran entrada. Un descarte automático mal puesto no es
 * una molestia: le cuesta la ronda a alguien que pagó por jugarla.
 */

import {
  MS_PARA_DECIDIR,
  AL_VENCER_LA_DECISION,
  decisionQueVence,
  esperaUnaDecision,
} from "../public/js/reglas/red.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else {
    fallos++;
    console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : "");
  }
};

// =====================================================================
console.log("\n=== 1. Diez segundos, y uno solo ===");
// =====================================================================

{
  ok(MS_PARA_DECIDIR === 10_000, "son diez segundos", MS_PARA_DECIDIR);

  /**
   * Configurable quiere decir UN lugar, no un número suelto por archivo.
   *
   * Es lo que se pidió y es lo que evita el problema clásico: el plazo dice
   * diez y el cartel dice ocho, porque alguien cambió uno de los dos.
   */
  ok(Number.isInteger(MS_PARA_DECIDIR), "y es un entero de milisegundos");
  ok(MS_PARA_DECIDIR > 0, "positivo, o el plazo vencería antes de empezar");
}

// =====================================================================
console.log("\n=== 2. La regla general: saltar salvo un caso ===");
// =====================================================================

{
  /**
   * LA REGLA, ESCRITA A MANO.
   *
   * A mano y no derivada del módulo: derivada diría "la tabla es la que dice
   * el archivo", que no afirma nada. Esto es una decisión de reglas de juego y
   * cambiarla tiene que costar una prueba en rojo.
   */
  ok(decisionQueVence("levantada") === "descartarPorTiempo",
     "con una carta levantada, se descarta", decisionQueVence("levantada"));

  ok(decisionQueVence("poder") === "saltarPorTiempo",
     "con un poder pendiente, se salta el turno", decisionQueVence("poder"));

  ok(decisionQueVence("cambioConVista") === "saltarPorTiempo",
     "y con el 10 a medio resolver, también se salta",
     decisionQueVence("cambioConVista"));

  /**
   * Y sólo UNA fase descarta.
   *
   * Descartar automáticamente es jugar por otro. Se hace donde hay una sola
   * jugada posible —tirar la carta que levantó— y en ningún otro lado. Esta
   * cuenta es lo que impide que mañana alguien agregue un segundo caso sin
   * darse cuenta de que está ampliando eso.
   */
  const descartan = Object.entries(AL_VENCER_LA_DECISION)
    .filter(([, que]) => que === "descartarPorTiempo")
    .map(([fase]) => fase);

  ok(descartan.length === 1, "una sola fase descarta por tiempo", descartan);
  ok(descartan[0] === "levantada", "y es la de la carta levantada", descartan[0]);
}

// =====================================================================
console.log("\n=== 3. Los cuatro poderes comparten una sola fase ===");
// =====================================================================

{
  /**
   * La tabla tiene tres entradas, no cinco, y no es un olvido.
   *
   * Los poderes 7, 8, 9 y 10 son la MISMA fase `poder`: el número vive en
   * `poderPendiente`, no en la fase. Como a los cuatro les toca lo mismo
   * —saltar— no hace falta distinguirlos, y distinguirlos sería inventar
   * cuatro entradas idénticas que después alguien tiene que mantener iguales.
   *
   * `cambioConVista` sí es aparte porque es otra fase de verdad: la segunda
   * mitad del 10, cuando ya vio las dos cartas.
   */
  const fases = Object.keys(AL_VENCER_LA_DECISION);
  ok(fases.length === 3, "tres fases con reloj de decisión", fases);
  ok(fases.includes("poder"), "  la de los cuatro poderes");
  ok(fases.includes("cambioConVista"), "  la segunda mitad del 10");
  ok(fases.includes("levantada"), "  y la de la carta levantada");
}

// =====================================================================
console.log("\n=== 4. Las demás fases no se tocan ===");
// =====================================================================

{
  /**
   * `turno`, `mirar`, `descarte`, `finRonda` y `finPartida` ya tienen sus
   * propios plazos, más viejos y con otras duraciones. Que esta tabla no las
   * nombre es lo que garantiza que el reloj nuevo no les pise el suyo.
   */
  for (const fase of ["turno", "mirar", "descarte", "postLevantada", "finRonda", "finPartida", "inicio"]) {
    ok(decisionQueVence(fase) === null, `${fase} no tiene reloj de decisión`, decisionQueVence(fase));
    ok(!esperaUnaDecision(fase), `  y \`esperaUnaDecision\` dice lo mismo`);
  }

  // Una fase inventada tampoco, que es lo que pasa si alguien escribe mal el
  // nombre en `plazoDe`: en vez de un reloj raro, no hay reloj.
  ok(decisionQueVence("noExiste") === null, "una fase desconocida no inventa un plazo");
  ok(decisionQueVence(undefined) === null, "ni una fase ausente");
  ok(decisionQueVence(null) === null, "ni null");
}

// =====================================================================
console.log("\n=== 5. La tabla no se puede modificar en caliente ===");
// =====================================================================

{
  /**
   * Está congelada porque viaja al navegador.
   *
   * `copiar-reglas` la manda al servidor y el mismo archivo lo carga el
   * cliente. Sin congelar, cualquier módulo del navegador podría escribirle
   * `levantada: "saltarPorTiempo"` y, aunque el servidor siguiera haciendo lo
   * correcto, la mesa dibujaría un cartel que no coincide con lo que va a
   * pasar.
   */
  ok(Object.isFrozen(AL_VENCER_LA_DECISION), "la tabla está congelada");

  const antes = AL_VENCER_LA_DECISION.levantada;
  try {
    AL_VENCER_LA_DECISION.levantada = "saltarPorTiempo";
  } catch {
    // En modo estricto lanza; en el otro, calla. Lo que importa es el después.
  }
  ok(AL_VENCER_LA_DECISION.levantada === antes, "y escribirle no la cambia");
}

console.log(fallos ? `\n❌ ${fallos} fallos` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
