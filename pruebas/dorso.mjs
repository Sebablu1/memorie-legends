/**
 * El dorso comprado, y por qué sólo cambia el propio.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE DEFIENDE ACÁ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Los dos dorsos alternados por asiento NO son decoración: son lo que
 * distingue de quién es cada mano. Un cambio mal hecho acá no rompe nada
 * visible en una prueba de navegador —las cartas se dibujan igual— pero deja
 * una mesa donde no se sabe qué cartas son de quién, que es peor que un error.
 *
 * Se prueba contra el módulo de dibujo directamente porque lo que hay que
 * fijar es una REGLA de tres líneas, y una prueba de navegador para eso sería
 * arrancar un Chromium para comprobar una condición.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL MÓDULO GUARDA ESTADO, Y ESO IMPORTA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `usarDorsoPropio` es lo único de `cartas.js` que se acuerda de algo entre
 * llamadas. Por eso cada bloque lo vuelve a fijar: una prueba que dependiera
 * de lo que dejó la anterior pasaría o fallaría según el orden.
 */

import { dorsoDe, usarDorsoPropio } from "../public/js/modulos/cartas.js";
import { DORSOS, dorsoDeAsiento } from "../public/js/reglas/baraja.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else {
    fallos++;
    console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : "");
  }
};

const MIO = "/img/dorsos/dorso-dorado.png";

// =====================================================================
console.log("\n=== 1. Sin nada comprado, la mesa se dibuja como siempre ===");
// =====================================================================

{
  usarDorsoPropio({});

  for (let i = 0; i < 4; i++) {
    ok(dorsoDe(i) === dorsoDeAsiento(i), `el asiento ${i} usa el dorso de siempre`);
  }
}

// =====================================================================
console.log("\n=== 2. El dorso comprado va SÓLO en las cartas propias ===");
// =====================================================================

{
  usarDorsoPropio({ asiento: 0, ruta: MIO });

  ok(dorsoDe(0) === MIO, "el asiento propio lleva el comprado", dorsoDe(0));

  // Y ésta es la que importa de verdad: los rivales no se tocan.
  for (let i = 1; i < 4; i++) {
    ok(dorsoDe(i) === dorsoDeAsiento(i), `el rival del asiento ${i} sigue como estaba`);
  }
}

// =====================================================================
console.log("\n=== 3. La distinción entre jugadores se conserva ===");
// =====================================================================

{
  usarDorsoPropio({ asiento: 0, ruta: MIO });

  // Con dos dorsos y cuatro asientos, el 1 y el 3 comparten imagen desde
  // siempre —lo que los separa es el color del aro— pero el propio tiene que
  // ser distinguible de TODOS los rivales, que es lo que la personalización
  // podría haber roto.
  const rivales = [1, 2, 3].map(dorsoDe);
  ok(!rivales.includes(MIO), "ningún rival terminó con el dorso propio", rivales);
  ok(new Set(rivales).size === DORSOS.length, "los rivales siguen alternando los dos de siempre");
}

// =====================================================================
console.log("\n=== 4. En red, el asiento propio no es el cero ===");
// =====================================================================

{
  // El servidor le dice al jugador cuál asiento le tocó, y puede ser
  // cualquiera. Si el dorso quedara pegado al cero, aparecería en las cartas
  // de otro jugador — que es exactamente el fallo que hay que evitar.
  usarDorsoPropio({ asiento: 2, ruta: MIO });

  ok(dorsoDe(2) === MIO, "el dorso sigue al asiento que diga el servidor");
  ok(dorsoDe(0) === dorsoDeAsiento(0), "y el asiento cero vuelve al de siempre");
}

// =====================================================================
console.log("\n=== 5. Volver a no tener nada lo deja como al principio ===");
// =====================================================================

{
  usarDorsoPropio({ asiento: 1, ruta: MIO });
  usarDorsoPropio({});

  ok(dorsoDe(1) === dorsoDeAsiento(1), "sin ruta, no hay excepción que aplicar");
}

{
  // Una ruta vacía o nula no puede convertirse en un `src` roto.
  usarDorsoPropio({ asiento: 0, ruta: null });
  ok(dorsoDe(0) === dorsoDeAsiento(0), "una ruta nula se ignora");

  usarDorsoPropio({ asiento: 0, ruta: "" });
  ok(dorsoDe(0) === dorsoDeAsiento(0), "una ruta vacía también");
}

console.log(fallos ? `\n❌ ${fallos} fallos` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
