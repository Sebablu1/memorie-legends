/**
 * El bono diario está eliminado, y esta prueba lo mantiene eliminado.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ ERA Y POR QUÉ SE FUE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `reclamarBonoDiario` regalaba 10 Leyendas cada 24 horas. Estaba desplegada,
 * era llamable y tenía su techo de ritmo, su constante, su cálculo de espera y
 * su motivo en el libro mayor. Lo único que no tenía era quien la llamara:
 * ningún botón del juego la usaba.
 *
 * Se eliminó en vez de terminarla. Un bono por entrar premia abrir la
 * aplicación, no jugar, y todo el resto de la economía —apuestas, ranking,
 * premios por puesto— mide lo contrario.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA UNA PRUEBA PARA ALGO QUE SE BORRÓ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Por lo mismo que `sin-ruleta.mjs`: lo borrado vuelve. Vuelve porque alguien
 * lee un comentario viejo, porque una rama vieja se fusiona, o porque el
 * nombre suena a algo que faltaba. Y vuelve a medias —la constante sin la
 * función, o la función sin el techo de ritmo—, que es peor que entero.
 *
 * Cada comprobación de acá es un pedazo del bono que no puede reaparecer solo.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else {
    fallos++;
    console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : "");
  }
};

const RAIZ = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const leer = (relativo) => readFileSync(join(RAIZ, relativo), "utf8");

// =====================================================================
console.log("\n=== 1. Ni la constante, ni el cálculo, ni el motivo ===");
// =====================================================================

{
  const economia = leer("public/js/reglas/economia.js");

  // `BONO_DIARIO` con dos puntos detrás sería la clave del motivo; sin ellos,
  // la constante. Se buscan las dos formas porque volver a medias es lo
  // habitual: primero el motivo "por las dudas", después todo lo demás.
  ok(!/export const BONO_DIARIO/.test(economia), "no hay constante BONO_DIARIO");
  ok(!/HORAS_BONO_DIARIO/.test(economia), "no hay HORAS_BONO_DIARIO");
  ok(!/esperaBonoDiario/.test(economia), "no se calcula la espera");
  ok(!/BONO_DIARIO:/.test(economia), "no hay motivo de bono diario en el libro mayor");
}

// =====================================================================
console.log("\n=== 2. La función no está desplegada ni tiene techo ===");
// =====================================================================

{
  const servidor = leer("functions/index.js");
  ok(!/reclamarBonoDiario/.test(servidor), "la callable no existe");
  ok(!/ultimoBonoDiario/.test(servidor), "el servidor no escribe la fecha del último cobro");

  // El techo de ritmo aparte: una callable sin techo es una puerta abierta, y
  // un techo sin callable es una entrada muerta en una tabla que `ritmo.mjs`
  // audita nombre por nombre.
  const ritmo = leer("functions/limite-de-ritmo.js");
  ok(!/reclamarBonoDiario/.test(ritmo), "no le queda techo de ritmo reservado");
}

// =====================================================================
console.log("\n=== 3. El cliente tampoco lo recuerda ===");
// =====================================================================

{
  const sesion = leer("public/js/sesion.js");
  ok(!/ultimoBono|lastDailyBonus/.test(sesion), "la sesión no arrastra la fecha del último bono");
}

// =====================================================================
console.log("\n=== 4. Lo que SÍ se regala sigue en pie ===");
// =====================================================================

{
  // El contraste importa: si mañana alguien borra de más, esto lo dice. Las
  // Leyendas de bienvenida y las del referido no son el bono diario y no
  // tenían que irse con él.
  const economia = leer("public/js/reglas/economia.js");
  ok(/export const LEYENDAS_REGISTRO/.test(economia), "las Leyendas de bienvenida siguen");
  ok(/export const LEYENDAS_POR_REFERIDO/.test(economia), "las del referido siguen");

  const servidor = leer("functions/index.js");
  ok(/acreditarReferido/.test(servidor), "la función del referido sigue desplegada");
}

console.log(fallos ? `\n❌ ${fallos} fallos` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
