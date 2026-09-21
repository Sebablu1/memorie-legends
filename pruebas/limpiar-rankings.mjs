/**
 * La limpieza de rankings borra lo que tiene que borrar, y nada más.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE SE DEFIENDE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Borrar filas del ranking es irreversible, y hay tres maneras de hacerlo mal
 * sin que nada falle a la vista:
 *
 *   · borrar de más —a todos, o en todos los períodos— por un filtro que no
 *     se aplicó;
 *   · borrar la racha de alguien por limpiar un solo período, y cambiarle
 *     sin querer las otras dos tablas;
 *   · borrar algo que no es del ranking: un asiento del libro mayor, un
 *     perfil, el guardián de las partidas ya puntuadas.
 *
 * Y una cuarta que no borra de más pero engaña: callarse que un período ya
 * pagó sus premios, o que su cierre quedó a medias.
 *
 * Todo se prueba sobre `planDeLimpieza`, que decide sin tocar nada.
 */

import {
  planDeLimpieza,
  leerArgumentos,
  verificarRutas,
  AVISO_CERRADO,
  AVISO_A_MEDIAS,
} from "../herramientas/limpiar-rankings.mjs";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else {
    fallos++;
    console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : "");
  }
};

/** Un período, con sus filas: [uid, datos]. `doc` en null si está abierto. */
const periodo = (clave, filas, doc = null) => ({
  clave,
  doc,
  filas: filas.map(([uid, datos = {}]) => ({ uid, datos })),
});

/**
 * Cinco tablas de verdad: una semana cerrada y pagada, una abierta, un mes
 * abierto, un mes cuyo cierre se cortó a medias, y el año.
 */
const DATOS = {
  periodos: [
    periodo(
      "semanal_2026-W37",
      [["prueba", { puntos: 50, premiado: true, puesto: 1 }], ["ana", { puntos: 30, premiado: true, puesto: 2 }]],
      { cerrado: true, tipo: "semanal" },
    ),
    periodo("semanal_2026-W38", [["prueba", { puntos: 20 }], ["ana", { puntos: 10 }]]),
    periodo("mensual_2026-09", [["prueba", { puntos: 70 }], ["ana"], ["beto"]]),
    periodo("mensual_2026-08", [
      ["prueba", { puntos: 90, premiado: true, puesto: 1, premioFisico: "remera" }],
      ["beto", { puntos: 10 }],
    ]),
    periodo("anual_2026", [["prueba", { puntos: 160 }], ["ana"], ["beto"]]),
  ],
  rachas: ["prueba", "ana"],
};

const deUno = (plan, clave) => plan.periodos.find((p) => p.clave === clave);

// =====================================================================
console.log("\n=== 1. Por persona: sólo sus filas, en todos los períodos ===");
// =====================================================================

{
  const plan = planDeLimpieza(DATOS, { uid: "prueba" });
  ok(plan.periodos.length === 5, "toca los cinco períodos donde está", plan.periodos.map((p) => p.clave));
  ok(plan.periodos.every((p) => p.aBorrar.length === 1 && p.aBorrar[0] === "prueba"),
     "y en cada uno, sólo su fila", plan.periodos.map((p) => p.aBorrar));
  ok(!plan.rutas.some((r) => /\/(ana|beto)$/.test(r)), "nadie más", plan.rutas);
  ok(JSON.stringify(plan.rachas) === '["prueba"]', "y su racha, que es sólo suya", plan.rachas);
}

{
  const plan = planDeLimpieza(DATOS, { uid: "nadie" });
  ok(plan.periodos.length === 0 && plan.rutas.length === 0,
     "alguien que no está en ninguna tabla no toca nada", plan);
}

// =====================================================================
console.log("\n=== 2. Con --periodo: sólo ese tipo, y la racha queda ===");
// =====================================================================

{
  const plan = planDeLimpieza(DATOS, { uid: "prueba", periodo: "mensual" });
  ok(plan.periodos.map((p) => p.clave).join() === "mensual_2026-09,mensual_2026-08",
     "sólo las tablas mensuales", plan.periodos.map((p) => p.clave));
  ok(!plan.rutas.some((r) => r.includes("semanal_") || r.includes("anual_")),
     "las semanales y la anual quedan intactas", plan.rutas);

  /**
   * La racha es del jugador, no del período: de ella sale la `rachaActual`
   * de las tres tablas. Borrarla por limpiar el mes cambiaría la semana y el
   * año desde la próxima partida.
   */
  ok(plan.rachas.length === 0, "la racha NO se borra", plan.rachas);
  ok(JSON.stringify(plan.rachasQueQuedan) === '["prueba"]',
     "y el plan dice que queda, para poder explicarlo", plan.rachasQueQuedan);
  ok(!plan.rutas.some((r) => r.includes("/rachas/")), "ninguna ruta de racha en el plan", plan.rutas);
}

// =====================================================================
console.log("\n=== 3. --todo: todas las filas, y todas las rachas ===");
// =====================================================================

{
  const plan = planDeLimpieza(DATOS, { todo: true });
  ok(plan.total.filas === 12, "las doce filas de las cinco tablas", plan.total);
  ok(JSON.stringify(plan.rachas) === '["prueba","ana"]', "y las dos rachas", plan.rachas);
  ok(plan.periodos.every((p) => p.quedan === 0), "no queda ninguna fila", plan.periodos);

  const semanal = planDeLimpieza(DATOS, { todo: true, periodo: "semanal" });
  ok(semanal.total.filas === 4, "con --periodo semanal, sólo las cuatro semanales", semanal.total);
  ok(semanal.rachas.length === 0 && semanal.rachasQueQuedan.length === 2,
     "y las rachas quedan, como con una persona", semanal);
}

// =====================================================================
console.log("\n=== 4. Los conteos: había, se borran, quedan ===");
// =====================================================================

{
  const plan = planDeLimpieza(DATOS, { uid: "prueba" });
  const mes = deUno(plan, "mensual_2026-09");
  ok(mes.antes === 3 && mes.aBorrar.length === 1 && mes.quedan === 2,
     "en el mes: había 3, se borra 1, quedan 2", mes);
  ok(plan.periodos.every((p) => p.quedan === p.antes - p.aBorrar.length),
     "en todos, lo que queda es lo que había menos lo que se borra", plan.periodos);
  ok(plan.total.filas === 5 && plan.total.rachas === 1, "y el total cuadra", plan.total);
}

// =====================================================================
console.log("\n=== 5. Un período pagado se avisa, y uno a medias también ===");
// =====================================================================

{
  const plan = planDeLimpieza(DATOS, { uid: "prueba" });

  const cerrada = deUno(plan, "semanal_2026-W37");
  ok(cerrada.estado === "cerrado" && cerrada.aviso === AVISO_CERRADO,
     "la semana cerrada avisa que los premios ya se pagaron y no se revierten", cerrada);
  ok(cerrada.detalles.some((d) => d.includes("cobró el puesto 1")),
     "y dice qué puesto cobró quien se borra", cerrada.detalles);

  /**
   * A medias: hay filas premiadas pero el documento no dice `cerrado`. Es otro
   * aviso porque el riesgo es otro: si se reintenta el cierre después de
   * borrar, los puestos se recalculan sin estas filas.
   */
  const medias = deUno(plan, "mensual_2026-08");
  ok(medias.estado === "a medias" && medias.aviso === AVISO_A_MEDIAS,
     "el mes con el cierre cortado avisa distinto", medias);
  ok(AVISO_A_MEDIAS !== AVISO_CERRADO, "los dos avisos no son el mismo texto");
  ok(medias.detalles.some((d) => d.includes("remera")),
     "y menciona el premio físico anotado, que no se toca", medias.detalles);

  const abierta = deUno(plan, "semanal_2026-W38");
  ok(abierta.estado === "abierto" && abierta.aviso === null, "una tabla abierta no avisa nada", abierta);
}

// =====================================================================
console.log("\n=== 6. Correrla dos veces no hace nada la segunda ===");
// =====================================================================

{
  // Lo que queda después de aplicar el plan: sin las filas ni la racha.
  const plan = planDeLimpieza(DATOS, { uid: "prueba" });
  const borradas = new Set(plan.rutas);
  const despues = {
    periodos: DATOS.periodos.map((p) => ({
      ...p,
      filas: p.filas.filter((f) => !borradas.has(`rankings/${p.clave}/jugadores/${f.uid}`)),
    })),
    rachas: DATOS.rachas.filter((u) => !borradas.has(`jugadores/${u}/rachas/actual`)),
  };

  const otraVez = planDeLimpieza(despues, { uid: "prueba" });
  ok(otraVez.rutas.length === 0, "la segunda vez no encuentra nada que borrar", otraVez.rutas);
  ok(despues.periodos.every((p) => p.filas.every((f) => f.uid !== "prueba")) &&
     despues.periodos.reduce((s, p) => s + p.filas.length, 0) === 7,
     "y las filas de los demás siguen ahí");
}

// =====================================================================
console.log("\n=== 7. Los argumentos: un filtro, exactamente ===");
// =====================================================================

{
  const falla = (argv) => {
    try {
      leerArgumentos(argv);
      return null;
    } catch (e) {
      return e.message;
    }
  };

  // Borrar a todo el mundo no puede ser lo que pasa cuando uno se olvidó de
  // un argumento: `--todo` tiene que estar escrito.
  ok(/Falta a quién/.test(falla([]) ?? ""), "sin ningún filtro se niega", falla([]));
  ok(/Falta a quién/.test(falla(["--escribir"]) ?? ""), "ni con --escribir solo");
  ok(/Uno solo/.test(falla(["--email", "a@x.com", "--todo"]) ?? ""), "con dos filtros también se niega");
  ok(/Uno solo/.test(falla(["--uid", "u1", "--email", "a@x.com"]) ?? ""), "cualquier par de ellos");
  ok(/Período desconocido/.test(falla(["--todo", "--periodo", "diario"]) ?? ""),
     "un período que no existe se niega");
  ok(/Falta el valor/.test(falla(["--uid"]) ?? ""), "un --uid sin valor se niega");
  ok(/Falta el valor/.test(falla(["--email", "--todo"]) ?? ""),
     "y un --email seguido de otra bandera también");

  const a = leerArgumentos(["--uid", "u1", "--periodo", "anual", "--escribir"]);
  ok(a.uid === "u1" && a.periodo === "anual" && a.escribir === true && a.todo === false,
     "lo bien escrito se entiende", a);
  ok(leerArgumentos(["--todo"]).escribir === false, "y sin --escribir, no escribe");
}

// =====================================================================
console.log("\n=== 8. Nada fuera del ranking ===");
// =====================================================================

{
  /**
   * La herramienta sólo puede borrar dos formas de ruta: una fila de una
   * tabla y una racha. Si algún día el plan incluyera otra cosa —un asiento
   * del libro mayor, un perfil, el guardián de las partidas puntuadas—, el
   * plan entero se cae antes de borrar nada.
   */
  const plan = planDeLimpieza(DATOS, { todo: true });
  ok(plan.rutas.every((r) => /^rankings\/[^/]+\/jugadores\/[^/]+$|^jugadores\/[^/]+\/rachas\/actual$/.test(r)),
     "todas las rutas del plan son filas o rachas", plan.rutas.filter((r) => !r.startsWith("rankings/")));

  for (const ajena of [
    "movimientos/premio_semanal_2026-W37_prueba",
    "users/prueba",
    "partidasPuntuadas/ABC234",
    "rooms/ABC234",
    "rankings/semanal_2026-W37",
  ]) {
    let frenada = false;
    try {
      verificarRutas([...plan.rutas, ajena]);
    } catch {
      frenada = true;
    }
    ok(frenada, `frena un plan que quiere borrar ${ajena}`);
  }
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
