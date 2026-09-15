/**
 * Las Leyendas compradas no entran a un torneo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ESTA SUITE ES EL PILAR LEGAL, NO UNA PRUEBA DE CONTABILIDAD
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El reglamento dice, palabra por palabra, que las Leyendas compradas sólo
 * sirven para partidas privadas y tienda, y que no pueden usarse en torneos ni
 * campeonatos. Es la frase que sostiene que esto no es una casa de apuestas:
 * lo que se compra con dinero no compite por premios.
 *
 * Hasta este cambio era falsa. `credits` era un solo número sin memoria de
 * origen y `torneos.js` cobraba la inscripción con el mismo movimiento que
 * todo lo demás. Cualquiera compraba un paquete y se inscribía, y nada en el
 * sistema podía notarlo siquiera.
 *
 * De todo lo que se prueba acá, la sección 3 es la que importa. Las otras
 * existen para que la 3 no se pueda romper por accidente desde un costado.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA ESTE ARCHIVO SI LAS OTRAS QUINCE SUITES YA ESTÁN VERDES
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque están verdes por el motivo equivocado. `moverLeyendas` deriva los
 * bolsillos del espejo cuando el perfil no los tiene, así que los Firestore de
 * mentira que siembran `{ credits: 300 }` siguen andando sin cambiar una
 * línea. Eso es deseado —es lo que permite desplegar y migrar en cualquier
 * orden— pero significa que ninguna de esas suites está MIRANDO los bolsillos.
 *
 * Pasar no es cubrir.
 */

import { crearMoverLeyendas } from "../functions/leyendas.js";
import { MOTIVOS, REPARTO_POR_MOTIVO, REPARTOS, repartoDe } from "../public/js/reglas/economia.js";

let fallos = 0;
const ok = (condicion, mensaje, extra) => {
  if (condicion) {
    console.log(`  ✓ ${mensaje}`);
  } else {
    fallos++;
    console.log(`  ✗ ${mensaje}${extra === undefined ? "" : ` ${JSON.stringify(extra)}`}`);
  }
};

const error = (codigo, mensaje) => Object.assign(new Error(mensaje), { codigo });

/** Firestore de mentira, con lo justo: perfiles y libro mayor. */
function crearFirestore(inicial = {}) {
  const docs = new Map(Object.entries(inicial).map(([r, d]) => [r, { ...d }]));
  let auto = 0;

  const documento = (ruta) => ({ ruta });
  const coleccion = (prefijo) => ({ doc: (id) => documento(`${prefijo}/${id ?? `auto${++auto}`}`) });

  return {
    collection: coleccion,
    async runTransaction(cuerpo) {
      let escribio = false;
      const pendientes = [];
      const r = await cuerpo({
        async get(ref) {
          // El de verdad exige todas las lecturas antes de las escrituras, y
          // este también: un doble más permisivo daría verde sobre código que
          // Firestore rechaza.
          if (escribio) throw error("failed-precondition", "Lectura después de escritura");
          const d = docs.get(ref.ruta);
          return { exists: Boolean(d), data: () => (d ? { ...d } : undefined) };
        },
        set(ref, datos, opciones) {
          escribio = true;
          pendientes.push([ref.ruta, datos, opciones?.merge]);
        },
      });
      for (const [ruta, datos, fusionar] of pendientes) {
        docs.set(ruta, fusionar ? { ...(docs.get(ruta) ?? {}), ...datos } : datos);
      }
      return r;
    },
    _leer: (r) => docs.get(r),
    _rutas: () => [...docs.keys()],
  };
}

/** Un banco sobre un perfil dado. `perfil` se siembra tal cual. */
function montar(perfil) {
  const db = crearFirestore({ "users/ana": { username: "Ana", ...perfil } });
  const mover = crearMoverLeyendas({
    db,
    usuarios: "users",
    campoSaldo: "credits",
    marcaDeTiempo: () => "T",
    error,
  });
  return { db, mover };
}

const perfil = (db) => db._leer("users/ana");
const asientos = (db) =>
  db._rutas().filter((r) => r.startsWith("movimientos/")).map((r) => db._leer(r));

/** Mueve una vez y devuelve lo que quedó. */
async function mover1(db, banco, movimiento) {
  return db.runTransaction((tx) => banco(tx, { uid: "ana", ...movimiento }));
}

/** El espejo tiene que cerrar SIEMPRE. Se comprueba después de cada operación. */
function espejoCierra(db, donde) {
  const p = perfil(db);
  ok(
    p.credits === p.creditosComprados + p.creditosGanados,
    `${donde}: credits === comprados + ganados`,
    p,
  );
}

// =====================================================================
console.log("\n=== 1. Cada motivo toca el bolsillo que le toca ===");
// =====================================================================

{
  const todos = Object.values(MOTIVOS);
  const conFila = Object.keys(REPARTO_POR_MOTIVO);
  const sinFila = todos.filter((m) => !conFila.includes(m));

  ok(sinFila.length === 0, `los ${todos.length} motivos tienen regla de bolsillo`, sinFila);

  const sobran = conFila.filter((m) => !todos.includes(m));
  ok(sobran.length === 0, "y no hay reglas para motivos que ya no existen", sobran);

  // Los que acreditan ganado: premios, regalos, todo lo que no se pagó.
  for (const motivo of [
    MOTIVOS.REGISTRO,
    MOTIVOS.REFERIDO,
    MOTIVOS.PREMIO_PARTIDA,
    MOTIVOS.PREMIO_RANKING,
    MOTIVOS.PREMIO_LOGRO,
    MOTIVOS.TORNEO_PREMIO,
  ]) {
    ok(repartoDe(motivo) === REPARTOS.A_GANADO, `${motivo} acredita ganado`);
  }

  ok(repartoDe(MOTIVOS.COMPRA) === REPARTOS.A_COMPRADO, "compra acredita comprado");
  ok(
    repartoDe(MOTIVOS.TORNEO_ENTRADA) === REPARTOS.SOLO_GANADO,
    "y la entrada de torneo gasta SÓLO ganado — la línea del reglamento",
  );
}

{
  const { db, mover } = montar({ credits: 0, creditosComprados: 0, creditosGanados: 0 });

  await mover1(db, mover, { delta: 500, motivo: MOTIVOS.COMPRA, idempotencia: "c1" });
  ok(perfil(db).creditosComprados === 500, "un paquete pagado entra a comprados", perfil(db));
  ok(perfil(db).creditosGanados === 0, "y no toca ganados");
  espejoCierra(db, "tras comprar");

  await mover1(db, mover, { delta: 100, motivo: MOTIVOS.PREMIO_RANKING, idempotencia: "p1" });
  ok(perfil(db).creditosGanados === 100, "un premio de ranking entra a ganados", perfil(db));
  ok(perfil(db).creditosComprados === 500, "y no toca comprados");
  espejoCierra(db, "tras el premio");
}

// =====================================================================
console.log("\n=== 2. Un motivo sin regla se rompe ===");
// =====================================================================

{
  const { db, mover } = montar({ credits: 100 });
  let tiro = false;
  try {
    await mover1(db, mover, { delta: 10, motivo: "motivo_inventado" });
  } catch {
    tiro = true;
  }
  ok(tiro, "mover con un motivo que no está en la tabla tira");
  ok(asientos(db).length === 0, "y no deja ningún asiento");

  // El defecto silencioso sería mandarlo a ganado, que es justo lo que el
  // reglamento prohíbe: una forma nueva de mover plata entraría al bolsillo
  // que habilita torneos sin que nadie lo haya decidido.
}

// =====================================================================
console.log("\n=== 3. Un torneo NO acepta Leyendas compradas ===");
// =====================================================================

{
  /**
   * La prueba por la que existe todo el cambio.
   *
   * Mil Leyendas compradas y ninguna ganada. Saldo de sobra para una
   * inscripción de 100, y aun así tiene que rechazarla.
   */
  const { db, mover } = montar({ credits: 1000, creditosComprados: 1000, creditosGanados: 0 });

  let capturado = null;
  try {
    await mover1(db, mover, { delta: -100, motivo: MOTIVOS.TORNEO_ENTRADA, idempotencia: "t1" });
  } catch (e) {
    capturado = e;
  }

  ok(capturado !== null, "con 1000 compradas y 0 ganadas, el torneo RECHAZA la inscripción");
  ok(capturado?.codigo === "failed-precondition", "y es un error de precondición", capturado?.codigo);

  // El mensaje no puede decir "saldo insuficiente": saldo hay, de sobra. Decir
  // eso mandaría al jugador a comprar más, que es lo único que NO lo arregla.
  ok(/ganadas jugando/.test(capturado?.message ?? ""),
     "el mensaje explica que hacen falta Leyendas ganadas jugando", capturado?.message);
  ok(/1000 compradas/.test(capturado?.message ?? "") && /0 ganadas/.test(capturado?.message ?? ""),
     "y dice los dos números, para que se entienda por qué", capturado?.message);

  ok(perfil(db).creditosComprados === 1000, "y no se le tocó una sola Leyenda comprada");
  ok(asientos(db).length === 0, "ni quedó asiento de un cobro que no pasó");
}

{
  // Y con ganadas sí entra, que es la otra mitad de la regla.
  const { db, mover } = montar({ credits: 1000, creditosComprados: 900, creditosGanados: 100 });
  await mover1(db, mover, { delta: -100, motivo: MOTIVOS.TORNEO_ENTRADA, idempotencia: "t2" });

  ok(perfil(db).creditosGanados === 0, "con 100 ganadas, la inscripción sale de ahí");
  ok(perfil(db).creditosComprados === 900, "y las compradas quedan intactas");
  espejoCierra(db, "tras entrar al torneo");

  // Ni siquiera parcialmente: 150 con 100 ganadas no se completa con compradas.
  const { db: db2, mover: mover2 } = montar({
    credits: 1000, creditosComprados: 900, creditosGanados: 100,
  });
  let tiro = false;
  try {
    await mover1(db2, mover2, { delta: -150, motivo: MOTIVOS.TORNEO_ENTRADA, idempotencia: "t3" });
  } catch {
    tiro = true;
  }
  ok(tiro, "y una inscripción de 150 con 100 ganadas NO se completa con compradas");
  ok(perfil(db2).creditosGanados === 100, "el bolsillo ganado queda entero", perfil(db2));
}

// =====================================================================
console.log("\n=== 4. Un cobro puede cruzar los dos bolsillos ===");
// =====================================================================

{
  const { db, mover } = montar({ credits: 100, creditosComprados: 60, creditosGanados: 40 });

  const r = await mover1(db, mover, {
    delta: -100,
    motivo: MOTIVOS.COMPRA_PERSONALIZACION,
    idempotencia: "x1",
  });

  ok(perfil(db).creditosComprados === 0, "gasta las 60 compradas primero", perfil(db));
  ok(perfil(db).creditosGanados === 0, "y completa con las 40 ganadas");
  espejoCierra(db, "tras el cobro cruzado");

  const a = asientos(db)[0];
  ok(a.deltaComprado === -60 && a.deltaGanado === -40,
     "y queda UN asiento que dice de dónde salió cada parte", a);
  ok(a.delta === -100, "con el total, que es lo que lee el auditor viejo", a.delta);
  ok(asientos(db).length === 1, "un asiento, no dos: una clave es un documento");
  ok(r.deltaComprado === -60 && r.deltaGanado === -40, "y quien llamó recibe el detalle", r);
}

// =====================================================================
console.log("\n=== 5. Ningún bolsillo queda negativo ===");
// =====================================================================

{
  const { db, mover } = montar({ credits: 50, creditosComprados: 30, creditosGanados: 20 });
  let tiro = false;
  try {
    await mover1(db, mover, { delta: -51, motivo: MOTIVOS.ENTRADA_PARTIDA, idempotencia: "n1" });
  } catch (e) {
    tiro = e.codigo === "failed-precondition";
  }
  ok(tiro, "gastar más que el total se rechaza");
  ok(perfil(db).creditosComprados === 30 && perfil(db).creditosGanados === 20,
     "y los dos bolsillos quedan como estaban", perfil(db));
}

// =====================================================================
console.log("\n=== 6. La penalización sale de lo ganado primero ===");
// =====================================================================

{
  /**
   * Al revés que los otros cobros, y a propósito.
   *
   * Quien abandona tiene que pagar. Pero confiscarle primero Leyendas que
   * compró con dinero real es otra cosa, así que se le cobra de lo ganado y
   * sólo se toca lo comprado si no alcanza. No queda impune y no se le saca el
   * dinero antes que el juego.
   */
  const { db, mover } = montar({ credits: 100, creditosComprados: 70, creditosGanados: 30 });

  await mover1(db, mover, { delta: -20, motivo: MOTIVOS.PENALIZACION_ABANDONO, idempotencia: "a1" });
  ok(perfil(db).creditosGanados === 10 && perfil(db).creditosComprados === 70,
     "20 de penalización salen de las ganadas", perfil(db));

  await mover1(db, mover, { delta: -30, motivo: MOTIVOS.PENALIZACION_ABANDONO, idempotencia: "a2" });
  ok(perfil(db).creditosGanados === 0 && perfil(db).creditosComprados === 50,
     "y si las ganadas no alcanzan, el resto sale de las compradas", perfil(db));
  espejoCierra(db, "tras las penalizaciones");
}

// =====================================================================
console.log("\n=== 7. La devolución vuelve al bolsillo de origen ===");
// =====================================================================

{
  const { db, mover } = montar({ credits: 0, creditosComprados: 0, creditosGanados: 0 });

  await mover1(db, mover, {
    delta: 100,
    motivo: MOTIVOS.DEVOLUCION_ARTICULO,
    reparto: { comprado: 60, ganado: 40 },
    idempotencia: "d1",
  });
  ok(perfil(db).creditosComprados === 60 && perfil(db).creditosGanados === 40,
     "con `reparto`, cada parte vuelve a donde salió", perfil(db));
  espejoCierra(db, "tras la devolución repartida");
}

{
  /**
   * Sin `reparto`, todo a ganados.
   *
   * Es el caso de lo comprado ANTES de que existieran los bolsillos: sus
   * documentos de posesión no guardan el detalle, y no lo guardan porque en
   * ese momento todo el saldo era ganado. Devolver todo a ganados no es una
   * aproximación: es exacto.
   */
  const { db, mover } = montar({ credits: 0, creditosComprados: 0, creditosGanados: 0 });

  await mover1(db, mover, { delta: 100, motivo: MOTIVOS.DEVOLUCION_ARTICULO, idempotencia: "d2" });
  ok(perfil(db).creditosGanados === 100 && perfil(db).creditosComprados === 0,
     "sin `reparto`, la devolución vuelve entera a ganados", perfil(db));
}

// =====================================================================
console.log("\n=== 8. La idempotencia sigue valiendo, en los dos bolsillos ===");
// =====================================================================

{
  const { db, mover } = montar({ credits: 0, creditosComprados: 0, creditosGanados: 0 });

  await mover1(db, mover, { delta: 500, motivo: MOTIVOS.COMPRA, idempotencia: "pago_77" });
  const r2 = await mover1(db, mover, { delta: 500, motivo: MOTIVOS.COMPRA, idempotencia: "pago_77" });

  ok(r2.aplicado === false, "el segundo aviso del mismo pago no se aplica");
  ok(perfil(db).creditosComprados === 500, "y no acredita dos veces", perfil(db));
  ok(asientos(db).length === 1, "con un solo asiento");
  espejoCierra(db, "tras el reintento");
}

// =====================================================================
console.log("\n=== 9. Un perfil sin migrar se lee bien ===");
// =====================================================================

{
  /**
   * Lo que quita la dependencia de orden entre migrar y desplegar.
   *
   * Un perfil de antes tiene `credits` y nada más. Sin el respaldo, leerlo
   * daría cero en los dos bolsillos y el jugador se encontraría, de un
   * despliegue al otro, con que no le alcanza para una mesa que pagaba ayer.
   */
  const { db, mover } = montar({ credits: 300 });

  await mover1(db, mover, { delta: -100, motivo: MOTIVOS.ENTRADA_PARTIDA, idempotencia: "v1" });

  ok(perfil(db).creditosGanados === 200, "las 300 de un perfil viejo se leen como ganadas", perfil(db));
  ok(perfil(db).creditosComprados === 0, "y sin comprados");
  ok(perfil(db).credits === 200, "el espejo queda bien");

  // Y lo que más importa: puede entrar a un torneo, porque su saldo viejo es
  // ganado. Si el respaldo las hubiera contado como compradas, la separación
  // habría dejado afuera de los torneos a todos los jugadores actuales.
  const { db: db2, mover: mover2 } = montar({ credits: 300 });
  let entro = true;
  try {
    await mover1(db2, mover2, { delta: -100, motivo: MOTIVOS.TORNEO_ENTRADA, idempotencia: "v2" });
  } catch {
    entro = false;
  }
  ok(entro, "y un jugador de antes del cambio SIGUE pudiendo entrar a un torneo");
}

console.log(fallos ? `\n❌ ${fallos} fallos\n` : "\n✅ TODO OK\n");
process.exit(fallos ? 1 : 0);
