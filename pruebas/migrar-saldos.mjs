/**
 * La migración de saldos decide bien antes de que nadie la corra.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ UNA MIGRACIÓN SE PRUEBA MÁS QUE EL CÓDIGO NORMAL
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque corre UNA vez, sobre los datos de todos, y nadie la mira mientras lo
 * hace. Una función del juego que se equivoca se nota en la siguiente partida
 * y se arregla; una migración que se equivoca deja mal el saldo de todo el
 * mundo y se entera después, cuando ya no se puede saber cuál era el valor
 * bueno.
 *
 * Por eso `planDeMigracion` está separada del script: decide qué escribir sin
 * tocar nada, y se puede interrogar sin Firestore, sin credenciales y sin
 * riesgo.
 */

import { planDeMigracion } from "../herramientas/migrar-saldos.mjs";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else {
    fallos++;
    console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : "");
  }
};

const perfil = (uid, datos) => ({ uid, datos });

// =====================================================================
console.log("\n=== 1. Un perfil viejo se parte en dos bolsillos ===");
// =====================================================================

{
  const { cambios, yaEstaban, yaCompraron } = planDeMigracion([
    perfil("ana", { credits: 605, username: "Ana" }),
    perfil("beto", { credits: 0 }),
  ]);

  ok(yaCompraron.length === 0, "nadie compró todavía, así que no hay cerrojo");
  ok(yaEstaban === 0, "ninguno estaba al día");
  ok(cambios.length === 2, "los dos se migran", cambios.length);

  const ana = cambios.find((c) => c.uid === "ana");
  ok(ana.ganado === 605, "las 605 de Ana pasan a ganadas", ana);
  ok(ana.comprado === 0, "y ninguna a compradas");
  ok(ana.antes === null, "y se anota que no tenía el campo", ana.antes);

  const beto = cambios.find((c) => c.uid === "beto");
  ok(beto.ganado === 0 && beto.comprado === 0, "un perfil en cero también se escribe", beto);
}

// =====================================================================
console.log("\n=== 2. Correrla dos veces no cambia nada ===");
// =====================================================================

{
  /**
   * Idempotencia, que es lo que permite correrla sin miedo.
   *
   * La segunda pasada ve los campos ya escritos y cerrando contra el espejo,
   * así que no propone nada.
   */
  const yaMigrado = [
    perfil("ana", { credits: 605, creditosComprados: 0, creditosGanados: 605 }),
    perfil("beto", { credits: 0, creditosComprados: 0, creditosGanados: 0 }),
  ];

  const { cambios, yaEstaban } = planDeMigracion(yaMigrado);
  ok(cambios.length === 0, "la segunda pasada no propone ningún cambio", cambios);
  ok(yaEstaban === 2, "y cuenta los dos como al día", yaEstaban);
}

// =====================================================================
console.log("\n=== 3. Y SÍ corrige la deriva ===");
// =====================================================================

{
  /**
   * El caso por el que recalcula en vez de saltear.
   *
   * Alguien jugó entre la migración y el despliegue: las funciones viejas
   * escribieron `credits` y dejaron los bolsillos atrás. Salteando los
   * perfiles que ya tienen el campo, esa deriva se queda para siempre.
   */
  const { cambios } = planDeMigracion([
    // Migrado con 605, después ganó 100 con las funciones viejas.
    perfil("ana", { credits: 705, creditosComprados: 0, creditosGanados: 605 }),
  ]);

  ok(cambios.length === 1, "el perfil desfasado se vuelve a proponer", cambios.length);
  ok(cambios[0].ganado === 705, "con el valor corregido", cambios[0]);
  ok(cambios[0].antes === 605, "y diciendo de cuánto venía, que es lo que delata la deriva");
}

// =====================================================================
console.log("\n=== 4. El cerrojo: con una compra acreditada, se detiene ===");
// =====================================================================

{
  /**
   * `ganados = credits − comprados` supone que nadie compró nunca.
   *
   * Con una sola compra acreditada la cuenta deja de ser deducible del perfil:
   * habría que reconstruirla del libro mayor, sumando `deltaComprado` y
   * `deltaGanado`. La herramienta no hace eso, así que no lo intenta.
   */
  const { yaCompraron, cambios } = planDeMigracion([
    perfil("ana", { credits: 605, creditosGanados: 605 }),
    perfil("comprador", { credits: 1500, creditosComprados: 900, creditosGanados: 600 }),
  ]);

  ok(yaCompraron.length === 1, "detecta al que ya compró", yaCompraron);
  ok(yaCompraron[0].uid === "comprador", "y dice quién es", yaCompraron[0]);
  ok(cambios.length === 0,
     "y NO propone ningún cambio, ni siquiera para los perfiles sanos", cambios);
}

// =====================================================================
console.log("\n=== 5. Nunca propone un bolsillo negativo ===");
// =====================================================================

{
  // Un perfil imposible —el espejo por debajo de lo comprado— no puede
  // convertirse en un saldo negativo: se corta en cero.
  const { cambios } = planDeMigracion([perfil("raro", { credits: -50 })]);
  ok(cambios[0].ganado === 0, "un `credits` negativo da 0 ganadas, no -50", cambios[0]);
}

console.log(fallos ? `\n❌ ${fallos} fallos\n` : "\n✅ TODO OK\n");
process.exit(fallos ? 1 : 0);
