/**
 * La migración de los rankings copia lo viejo a la ruta del juego, suma sin
 * pisar, y correrla dos veces no cambia nada.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE SE DEFIENDE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Se corre una vez, en el despliegue, sobre las tablas de verdad. Los errores
 * que importan no rompen nada a la vista:
 *
 *   · pisar la fila que escribió una partida terminada entre el despliegue y
 *     la migración, y perderle esos puntos a alguien;
 *   · sumar dos veces si hay que correrla de nuevo;
 *   · quedarse con la racha vieja cuando ya hay una más nueva;
 *   · escribir donde no debe: en la estructura vieja, que es el respaldo, o
 *     en otro juego.
 *
 * Todo se prueba sobre `planDeMigracion`, que decide sin tocar nada.
 */

import {
  planDeMigracion,
  juntarFilas,
  verificarRutas,
} from "../herramientas/migrar-rankings.mjs";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else {
    fallos++;
    console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : "");
  }
};

const SEMANA_CERRADA = "semanal_2026-09-07";
const MES = "mensual_2026-09";

/** Lo viejo: una semana cerrada y pagada, y el mes abierto. */
const viejos = () => ({
  periodos: [
    {
      clave: SEMANA_CERRADA,
      doc: { tipo: "semanal", clave: SEMANA_CERRADA, cerrado: true, premiados: 1 },
      filas: [{ uid: "ana", datos: { uid: "ana", puntos: 90, premiado: true, puesto: 1, actualizada: 50 } }],
    },
    {
      clave: MES,
      doc: null,
      filas: [
        {
          uid: "ana",
          datos: {
            uid: "ana", puntos: 100, partidasJugadas: 4, partidasGanadas: 2, eliminaciones: 1,
            cortesPerfectos: 0, remontadas: 0, exp: 40, rachaActual: 0, mejorRacha: 3,
            nombre: "Ana vieja", actualizada: 100,
          },
        },
        { uid: "beto", datos: { uid: "beto", puntos: 20, partidasJugadas: 1, actualizada: 90 } },
      ],
    },
  ],
  rachas: [
    { uid: "ana", datos: { raya: 0, actualizada: 100 } },
    { uid: "beto", datos: { raya: 2, actualizada: 90 } },
  ],
});

/** Aplica un plan sobre "lo nuevo", como lo haría Firestore. */
function aplicar(nuevos, escrituras) {
  const r = structuredClone(nuevos);
  r.periodos ??= {};
  r.rachas ??= {};
  for (const e of escrituras) {
    const partes = e.ruta.split("/");
    if (partes[0] === "rankings" && partes.length === 2) r.marca = true;
    else if (partes[0] === "rankings" && partes.length === 4) {
      r.periodos[partes[3]] ??= { doc: null, filas: {} };
      r.periodos[partes[3]].doc = e.datos;
    } else if (partes[0] === "rankings" && partes.length === 6) {
      r.periodos[partes[3]] ??= { doc: null, filas: {} };
      r.periodos[partes[3]].filas[partes[5]] = e.datos;
    } else if (partes[0] === "jugadores") r.rachas[partes[1]] = e.datos;
  }
  return r;
}

const escrituraEn = (plan, ruta) => plan.escrituras.find((e) => e.ruta === ruta);

// =====================================================================
console.log("\n=== 1. Copia lo viejo a la ruta del juego ===");
// =====================================================================

{
  const plan = planDeMigracion({ viejos: viejos(), nuevos: {} }, { juego: "memorie" });

  ok(escrituraEn(plan, "rankings/memorie")?.datos?.juego === "memorie",
     "crea la marca del juego, que el cierre usa para encontrarlo");

  const fila = escrituraEn(plan, `rankings/memorie/periodos/${MES}/jugadores/ana`);
  ok(fila?.datos?.puntos === 100 && fila?.datos?.migrado === true,
     "copia la fila del mes, marcada como migrada", fila?.datos);
  ok(Boolean(escrituraEn(plan, `rankings/memorie/periodos/${MES}/jugadores/beto`)),
     "y la de cada jugador");

  ok(escrituraEn(plan, "jugadores/beto/rachas/memorie")?.datos?.raya === 2,
     "la racha pasa de `actual` a la del juego");
  ok(plan.resumen.filasCopiadas === 3 && plan.resumen.rachasCopiadas === 2, "y el resumen cuadra",
     plan.resumen);
}

// =====================================================================
console.log("\n=== 2. Si la fila nueva ya existe, suma sin pisar ===");
// =====================================================================

{
  /**
   * Una partida terminó entre el despliegue y la migración: su fila cayó en la
   * ruta nueva. La vieja trae lo de antes. Hay que juntarlas.
   */
  const nuevos = {
    marca: true,
    periodos: {
      [MES]: {
        doc: null,
        filas: {
          ana: {
            uid: "ana", puntos: 30, partidasJugadas: 1, partidasGanadas: 1, exp: 10,
            rachaActual: 1, mejorRacha: 1, nombre: "Ana nueva", actualizada: 200,
          },
        },
      },
    },
  };
  const plan = planDeMigracion({ viejos: viejos(), nuevos }, { juego: "memorie" });
  const ana = escrituraEn(plan, `rankings/memorie/periodos/${MES}/jugadores/ana`)?.datos;

  ok(ana?.puntos === 130 && ana?.partidasJugadas === 5 && ana?.partidasGanadas === 3 && ana?.exp === 50,
     "las columnas acumuladas se suman", ana);
  ok(ana?.mejorRacha === 3, "la mejor racha es la mayor de las dos", ana?.mejorRacha);
  ok(ana?.rachaActual === 1 && ana?.nombre === "Ana nueva",
     "la racha actual y el nombre salen de la más reciente", ana);
  ok(ana?.migrado === true, "y queda marcada como migrada");
  ok(plan.resumen.filasJuntadas === 1, "el resumen dice que se juntó una", plan.resumen);
  ok(!escrituraEn(plan, "rankings/memorie"), "la marca ya estaba: no se vuelve a escribir");

  // `juntarFilas` sola, con la vieja más reciente —no debería pasar, pero si
  // pasa, gana la más reciente—.
  const alReves = juntarFilas({ rachaActual: 4, actualizada: 500 }, { rachaActual: 1, actualizada: 100 });
  ok(alReves.rachaActual === 4, "si la vieja fuera la más reciente, gana la vieja", alReves);
}

// =====================================================================
console.log("\n=== 3. Correrla dos veces no suma dos veces ===");
// =====================================================================

{
  const nuevosAntes = {
    marca: true,
    periodos: { [MES]: { doc: null, filas: { ana: { uid: "ana", puntos: 30, actualizada: 200 } } } },
  };
  const primera = planDeMigracion({ viejos: viejos(), nuevos: nuevosAntes }, { juego: "memorie" });
  const despues = aplicar(nuevosAntes, primera.escrituras);

  const segunda = planDeMigracion({ viejos: viejos(), nuevos: despues }, { juego: "memorie" });
  ok(segunda.escrituras.length === 0, "la segunda corrida no encuentra nada que escribir",
     segunda.escrituras.map((e) => e.ruta));
  ok(despues.periodos[MES].filas.ana.puntos === 130,
     "y la fila juntada quedó con 130, no con 230", despues.periodos[MES].filas.ana.puntos);
  ok(segunda.resumen.filasYaMigradas === 3, "las tres filas se reconocen como migradas",
     segunda.resumen);
}

// =====================================================================
console.log("\n=== 4. Gana la racha más reciente ===");
// =====================================================================

{
  const nuevos = {
    marca: true,
    rachas: {
      ana: { raya: 5, actualizada: 300 }, // más nueva que la vieja: queda
      beto: { raya: 0, actualizada: 10 }, // más vieja que la vieja: se reemplaza
    },
  };
  const plan = planDeMigracion({ viejos: viejos(), nuevos }, { juego: "memorie" });
  ok(!escrituraEn(plan, "jugadores/ana/rachas/memorie"),
     "si la racha nueva es más reciente, no se toca", plan.escrituras.map((e) => e.ruta));
  ok(escrituraEn(plan, "jugadores/beto/rachas/memorie")?.datos?.raya === 2,
     "si es más vieja, gana la de la estructura vieja");
  ok(plan.resumen.rachasQueQuedan === 1 && plan.resumen.rachasCopiadas === 1, "el resumen cuadra",
     plan.resumen);
}

// =====================================================================
console.log("\n=== 5. Un período cerrado se copia cerrado ===");
// =====================================================================

{
  const plan = planDeMigracion({ viejos: viejos(), nuevos: {} }, { juego: "memorie" });
  const periodo = escrituraEn(plan, `rankings/memorie/periodos/${SEMANA_CERRADA}`)?.datos;
  ok(periodo?.cerrado === true && periodo?.juego === "memorie" && periodo?.clave === SEMANA_CERRADA,
     "con su `cerrado`: el cierre nuevo no lo vuelve a cerrar ni a pagar", periodo);
  ok(!escrituraEn(plan, `rankings/memorie/periodos/${MES}`),
     "un período abierto no tiene documento, y no se le inventa uno");

  const conDestino = planDeMigracion(
    {
      viejos: viejos(),
      nuevos: { periodos: { [SEMANA_CERRADA]: { doc: { cerrado: true, juego: "memorie" }, filas: {} } } },
    },
    { juego: "memorie" },
  );
  ok(!escrituraEn(conDestino, `rankings/memorie/periodos/${SEMANA_CERRADA}`),
     "y si el período ya existe en lo nuevo, no se pisa");
}

// =====================================================================
console.log("\n=== 6. La marca de un juego no es un período ===");
// =====================================================================

{
  // En `rankings/` viven también las marcas: si la lectura de lo viejo trajera
  // una, no se copia como si fuera un período.
  const conMarca = viejos();
  conMarca.periodos.push({ clave: "memorie", doc: { juego: "memorie" }, filas: [] });
  const plan = planDeMigracion({ viejos: conMarca, nuevos: {} }, { juego: "memorie" });
  ok(!plan.escrituras.some((e) => e.ruta.includes("/periodos/memorie")),
     "la marca no se copia como período", plan.escrituras.map((e) => e.ruta));
}

// =====================================================================
console.log("\n=== 7. Nada fuera de las tablas del juego ===");
// =====================================================================

{
  const plan = planDeMigracion({ viejos: viejos(), nuevos: {} }, { juego: "memorie" });
  ok(plan.escrituras.every((e) =>
    /^rankings\/memorie(\/periodos\/[^/]+(\/jugadores\/[^/]+)?)?$|^jugadores\/[^/]+\/rachas\/memorie$/.test(e.ruta)),
     "todas las escrituras son de las tablas de «memorie»", plan.escrituras.map((e) => e.ruta));

  for (const ajena of [
    `rankings/${SEMANA_CERRADA}/jugadores/ana`, // lo viejo: es el respaldo, no se toca
    "jugadores/ana/rachas/actual",
    "rankings/otro-juego/periodos/x/jugadores/ana",
    "movimientos/premio_x_ana",
    "users/ana",
  ]) {
    let frenada = false;
    try {
      verificarRutas([ajena], "memorie");
    } catch {
      frenada = true;
    }
    ok(frenada, `frena una escritura en ${ajena}`);
  }
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
