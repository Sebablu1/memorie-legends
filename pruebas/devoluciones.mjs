/**
 * Cada devolución vuelve al bolsillo de donde salió.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL AGUJERO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Una entrada de sala se cobra de las Leyendas COMPRADAS primero. Pero cuando
 * se devolvía —el jugador salía antes de empezar, la administración cancelaba
 * la sala, abandonaban todos— la devolución iba entera a las GANADAS. Entrar
 * con 500 compradas y salir dejaba 500 ganadas, y las ganadas son las que
 * abren los torneos, que por reglamento no aceptan compradas. La devolución
 * de artículos de la tienda hacía lo mismo.
 *
 * No se llegó a usar: hasta que se cerró sólo los administradores podían
 * comprar Leyendas, y se revisó en producción que ninguna devolución hubiera
 * salido de lo comprado.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE PRUEBA ESTE ARCHIVO
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   1. `repartoSegunOrigen`: cuánto vuelve a lo comprado, según el cobro.
 *   2. Los candados: un cobro no acredita, y una devolución dice qué deshace.
 *   3. `moverLeyendas` y `.varias` leen el cobro ANTES de escribir, y lo
 *      validan.
 *   4. El lavado, de punta a punta, con `salida.js` de verdad: entrar con
 *      compradas y salir ya no abre un torneo.
 *
 * La cancelación de la administración, el cierre sin ganadores, la tienda y
 * los torneos lo prueban en su propio archivo, sobre sus propios montajes.
 */

import { crearMoverLeyendas, repartoSegunOrigen } from "../functions/leyendas.js";
import { crearSalirDeSalaEnEspera } from "../functions/salida.js";
import { MOTIVOS, claveDeEntrada, claveDeDevolucion } from "../public/js/reglas/economia.js";
import { ESTADOS_SALA, MODOS } from "../public/js/reglas/salas.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else {
    fallos++;
    console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : "");
  }
};

const error = (codigo, mensaje) => Object.assign(new Error(mensaje), { codigo });

/**
 * Firestore de mentira, con la regla de verdad: ninguna lectura después de
 * una escritura. Sin eso, leer el cobro en la fase equivocada pasaría acá y
 * fallaría en producción.
 */
function crearFirestore(inicial = {}) {
  const docs = new Map(Object.entries(inicial).map(([r, d]) => [r, structuredClone(d)]));
  let auto = 0;
  const coleccion = (prefijo) => ({
    doc: (id) => ({ ruta: `${prefijo}/${id ?? `auto${++auto}`}` }),
  });

  return {
    collection: coleccion,
    async runTransaction(cuerpo) {
      let escribio = false;
      const pendientes = [];
      const r = await cuerpo({
        async get(ref) {
          if (escribio) throw error("failed-precondition", `Lectura de ${ref.ruta} después de escribir`);
          const d = docs.get(ref.ruta);
          return { exists: Boolean(d), data: () => (d ? structuredClone(d) : undefined) };
        },
        set(ref, datos, opciones) {
          escribio = true;
          pendientes.push([ref.ruta, datos, Boolean(opciones?.merge)]);
        },
        update(ref, datos) {
          escribio = true;
          pendientes.push([ref.ruta, datos, true]);
        },
      });
      for (const [ruta, datos, fusionar] of pendientes) {
        docs.set(ruta, fusionar ? { ...(docs.get(ruta) ?? {}), ...structuredClone(datos) } : structuredClone(datos));
      }
      return r;
    },
    leer: (r) => docs.get(r),
    rutas: () => [...docs.keys()],
  };
}

const perfil = (comprado, ganado) => ({
  credits: comprado + ganado,
  creditosComprados: comprado,
  creditosGanados: ganado,
});

function montar(perfiles = {}, otros = {}) {
  const inicial = { ...otros };
  for (const [uid, p] of Object.entries(perfiles)) inicial[`users/${uid}`] = p;
  const db = crearFirestore(inicial);
  const mover = crearMoverLeyendas({
    db, usuarios: "users", campoSaldo: "credits", marcaDeTiempo: () => "T", error,
  });
  return { db, mover };
}

const bolsillos = (db, uid) => {
  const p = db.leer(`users/${uid}`);
  return { comprado: p.creditosComprados, ganado: p.creditosGanados, total: p.credits };
};
const iguales = (a, b) => a.comprado === b.comprado && a.ganado === b.ganado;
const uno = (db, mover, m) => db.runTransaction((tx) => mover(tx, { uid: "ana", ...m }));
const fallo = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
};

/** Un asiento de cobro, como lo escribe `moverLeyendas`. */
const cobro = (delta, deltaComprado, uid = "ana") => ({
  uid,
  delta,
  motivo: MOTIVOS.ENTRADA_PARTIDA,
  ...(deltaComprado === undefined ? {} : { deltaComprado, deltaGanado: delta - deltaComprado }),
});

// =====================================================================
console.log("\n=== 1. Cuánto vuelve a lo comprado ===");
// =====================================================================

ok(repartoSegunOrigen(cobro(-100, -60), 100).comprado === 60,
   "una entrada de 60 compradas y 40 ganadas devuelve 60 a las compradas");
ok(repartoSegunOrigen(cobro(-100, -100), 100).comprado === 100,
   "pagada toda con compradas, vuelve toda a las compradas");
ok(repartoSegunOrigen(cobro(-100, 0), 100).comprado === 0,
   "pagada toda con ganadas, vuelve toda a las ganadas");
ok(repartoSegunOrigen(cobro(-100), 100).comprado === 0,
   "un cobro de antes de los bolsillos vuelve a las ganadas: en esa época todo era ganado");
ok(repartoSegunOrigen(null, 100).comprado === 0,
   "sin cobro, también");
ok(repartoSegunOrigen(cobro(-240, -200), 100).comprado === 84,
   "un artículo de un pack vuelve en proporción: de 240, 200 eran compradas → 84 de 100",
   repartoSegunOrigen(cobro(-240, -200), 100));
ok(repartoSegunOrigen(cobro(-3, -1), 2).comprado === 1,
   "el redondeo va hacia lo comprado, nunca hacia lo ganado (2 × 1/3 → 1)",
   repartoSegunOrigen(cobro(-3, -1), 2));
ok(repartoSegunOrigen(cobro(-100, -60), 500).comprado === 60,
   "nunca vuelve a lo comprado más de lo que el cobro sacó de ahí",
   repartoSegunOrigen(cobro(-100, -60), 500));

// =====================================================================
console.log("\n=== 2. Los candados ===");
// =====================================================================

{
  /**
   * Un cobro no acredita.
   *
   * Es el agujero en su forma más chica: `ENTRADA_PARTIDA` en positivo iba
   * entero a las ganadas. Ahora cualquier motivo que cobra, en positivo, es
   * un error — no una devolución.
   */
  for (const motivo of [
    MOTIVOS.ENTRADA_PARTIDA,
    MOTIVOS.COMPRA_PERSONALIZACION,
    MOTIVOS.TORNEO_ENTRADA,
    MOTIVOS.PENALIZACION_ABANDONO,
  ]) {
    const { db, mover } = montar({ ana: perfil(0, 100) });
    const e = await fallo(() => uno(db, mover, { delta: 50, motivo, idempotencia: "x" }));
    ok(e && /es un cobro y no puede acreditar/.test(e.message), `«${motivo}» no acredita`, e?.message);
    ok(iguales(bolsillos(db, "ana"), { comprado: 0, ganado: 100 }), "  y no se movió nada",
       bolsillos(db, "ana"));
  }
}

{
  // Una devolución que no dice qué deshace. Así se colaron la de las salas y
  // la de los artículos: sin decir nada, iban a las ganadas.
  const { db, mover } = montar({ ana: perfil(0, 0) });
  const e = await fallo(() =>
    uno(db, mover, { delta: 100, motivo: MOTIVOS.DEVOLUCION_ENTRADA, idempotencia: "d" }));
  ok(e && /no dice qué cobro deshace/.test(e.message),
     "una devolución sin origen se rechaza", e?.message);
  ok(bolsillos(db, "ana").total === 0, "y no acredita nada");
}

{
  const { db, mover } = montar({ ana: perfil(100, 100) });
  const e = await fallo(() =>
    uno(db, mover, { delta: -50, motivo: MOTIVOS.DEVOLUCION_ENTRADA, idempotencia: "d" }));
  ok(e && /no puede cobrar/.test(e.message), "una devolución no cobra", e?.message);
}

{
  const { db, mover } = montar(
    { ana: perfil(0, 0) },
    { [`movimientos/${claveDeEntrada("S", "ana")}`]: cobro(-100, -60) },
  );
  const e = await fallo(() =>
    uno(db, mover, {
      delta: 100,
      motivo: MOTIVOS.DEVOLUCION_ENTRADA,
      origen: claveDeEntrada("S", "ana"),
      reparto: { comprado: 100 },
      idempotencia: "d",
    }));
  ok(e && /origen o su reparto/.test(e.message),
     "origen y reparto a la vez es ambiguo: se rechaza", e?.message);
}

{
  // En un lote, una devolución mal dicha tira el lote ENTERO: nadie cobra.
  const { db, mover } = montar(
    { ana: perfil(0, 0), beto: perfil(0, 0) },
    { [`movimientos/${claveDeEntrada("S", "ana")}`]: cobro(-100, -100) },
  );
  const e = await fallo(() =>
    db.runTransaction((tx) =>
      mover.varias(tx, [
        { uid: "ana", delta: 100, motivo: MOTIVOS.DEVOLUCION_ENTRADA,
          origen: claveDeEntrada("S", "ana"), idempotencia: "d1" },
        { uid: "beto", delta: 100, motivo: MOTIVOS.DEVOLUCION_ENTRADA, idempotencia: "d2" },
      ])));
  ok(e && /no dice qué cobro deshace/.test(e.message), "un lote con una devolución sin origen se cae",
     e?.message);
  ok(bolsillos(db, "ana").total === 0 && bolsillos(db, "beto").total === 0,
     "y no le devuelve a nadie: ni siquiera a la que estaba bien dicha");
}

// =====================================================================
console.log("\n=== 3. La devolución lee su cobro, antes de escribir ===");
// =====================================================================

{
  // De a uno. Ana tiene 60 compradas y 100 ganadas; la entrada de 100 se
  // cobra como en `index.js`: compradas primero, así que salen 60 y 40.
  const { db, mover } = montar({ ana: perfil(60, 100) });
  await uno(db, mover, {
    delta: -100, motivo: MOTIVOS.ENTRADA_PARTIDA, referencia: "S",
    idempotencia: claveDeEntrada("S", "ana"),
  });
  ok(iguales(bolsillos(db, "ana"), { comprado: 0, ganado: 60 }),
     "la entrada sale 60 de compradas y 40 de ganadas", bolsillos(db, "ana"));

  const e = await fallo(() =>
    uno(db, mover, {
      delta: 100, motivo: MOTIVOS.DEVOLUCION_ENTRADA, referencia: "S",
      origen: claveDeEntrada("S", "ana"), idempotencia: claveDeDevolucion("S", "ana"),
    }));
  ok(!e, "la devolución se hace, sin leer después de escribir", e?.message);
  ok(iguales(bolsillos(db, "ana"), { comprado: 60, ganado: 100 }),
     "y cada bolsillo queda como estaba", bolsillos(db, "ana"));

  const asiento = db.leer(`movimientos/${claveDeDevolucion("S", "ana")}`);
  ok(asiento?.origen === claveDeEntrada("S", "ana"),
     "el asiento dice qué entrada deshizo", asiento?.origen);
  ok(asiento?.deltaComprado === 60 && asiento?.deltaGanado === 40,
     "y a qué bolsillo volvió cada parte", asiento);
}

{
  // En lote: dos jugadores, cada uno con su entrada.
  const { db, mover } = montar({ ana: perfil(100, 0), beto: perfil(0, 100) });
  for (const uid of ["ana", "beto"]) {
    await db.runTransaction((tx) => mover(tx, {
      uid, delta: -100, motivo: MOTIVOS.ENTRADA_PARTIDA, referencia: "S",
      idempotencia: claveDeEntrada("S", uid),
    }));
  }
  const e = await fallo(() =>
    db.runTransaction((tx) =>
      mover.varias(tx, ["ana", "beto"].map((uid) => ({
        uid, delta: 100, motivo: MOTIVOS.DEVOLUCION_ENTRADA, referencia: "S",
        origen: claveDeEntrada("S", uid), idempotencia: claveDeDevolucion("S", uid),
      })))));
  ok(!e, "el lote lee los dos cobros antes de escribir", e?.message);
  ok(iguales(bolsillos(db, "ana"), { comprado: 100, ganado: 0 }),
     "a Ana, que pagó con compradas, le vuelven compradas", bolsillos(db, "ana"));
  ok(iguales(bolsillos(db, "beto"), { comprado: 0, ganado: 100 }),
     "a Beto, que pagó con ganadas, le vuelven ganadas", bolsillos(db, "beto"));
}

{
  // Una clave equivocada que apunta a la entrada de OTRO jugador: devolvería
  // con los bolsillos de otro. No hace ruido; por eso se comprueba.
  const { db, mover } = montar(
    { ana: perfil(0, 0) },
    { [`movimientos/${claveDeEntrada("S", "beto")}`]: cobro(-100, -100, "beto") },
  );
  const e = await fallo(() =>
    uno(db, mover, {
      delta: 100, motivo: MOTIVOS.DEVOLUCION_ENTRADA,
      origen: claveDeEntrada("S", "beto"), idempotencia: "d",
    }));
  ok(e && /es de otra persona/.test(e.message), "el cobro de otra persona se rechaza", e?.message);
  ok(bolsillos(db, "ana").total === 0, "y no acredita nada");
}

{
  // El «origen» tiene que ser un cobro. Un premio no se deshace con una
  // devolución.
  const { db, mover } = montar(
    { ana: perfil(0, 0) },
    { "movimientos/premio_S_1": { uid: "ana", delta: 300, motivo: MOTIVOS.PREMIO_PARTIDA } },
  );
  const e = await fallo(() =>
    uno(db, mover, {
      delta: 100, motivo: MOTIVOS.DEVOLUCION_ENTRADA, origen: "premio_S_1", idempotencia: "d",
    }));
  ok(e && /no es un cobro/.test(e.message), "un origen que no es un cobro se rechaza", e?.message);
}

{
  // Una entrada de antes del libro mayor: el asiento no existe. No es un
  // error —había salas así— y vuelve a las ganadas, que es lo que era todo.
  const { db, mover } = montar({ ana: perfil(0, 0) });
  const e = await fallo(() =>
    uno(db, mover, {
      delta: 100, motivo: MOTIVOS.DEVOLUCION_ENTRADA,
      origen: claveDeEntrada("VIEJA", "ana"), idempotencia: "d",
    }));
  ok(!e, "una entrada sin asiento se devuelve igual", e?.message);
  ok(iguales(bolsillos(db, "ana"), { comprado: 0, ganado: 100 }),
     "y vuelve a las ganadas", bolsillos(db, "ana"));
}

// =====================================================================
console.log("\n=== 4. El lavado, de punta a punta ===");
// =====================================================================

{
  /**
   * Lu tiene 500 Leyendas compradas y ninguna ganada. Abre una sala de 500 y
   * se va antes de empezar. Con el código viejo, las 500 volvían como
   * ganadas, y con ganadas se entra a un torneo.
   *
   * La salida es la de verdad, `salida.js`, con el motivo que le pasa
   * `index.js`. La inscripción al torneo se cobra con `TORNEO_ENTRADA`, que es
   * exactamente lo que hace `torneos.inscribir`: la regla que la rechaza vive
   * en el motivo, no en el torneo.
   */
  const SALA = "LAVADO";
  const { db, mover } = montar(
    { lu: perfil(500, 0) },
    {
      [`rooms/${SALA}`]: {
        codigo: SALA, modo: MODOS.LEYENDAS, estado: ESTADOS_SALA.ESPERANDO, entrada: 500,
        creador: "lu", jugadores: ["lu"], jugadoresNombres: ["Lu"], listos: [], pozo: 500,
      },
    },
  );

  await db.runTransaction((tx) => mover(tx, {
    uid: "lu", delta: -500, motivo: MOTIVOS.ENTRADA_PARTIDA, referencia: SALA,
    idempotencia: claveDeEntrada(SALA, "lu"),
  }));
  ok(bolsillos(db, "lu").total === 0, "pagó la entrada con sus 500 compradas");

  const salir = crearSalirDeSalaEnEspera({
    db, salas: "rooms", moverLeyendas: mover, motivo: MOTIVOS.DEVOLUCION_ENTRADA,
    marcaDeTiempo: () => "T", error, estados: ESTADOS_SALA,
  });
  const e = await fallo(() => salir({ uid: "lu", codigo: SALA }));
  ok(!e, "sale de la sala antes de que empiece", e?.message);
  ok(iguales(bolsillos(db, "lu"), { comprado: 500, ganado: 0 }),
     "y le vuelven 500 COMPRADAS, no ganadas", bolsillos(db, "lu"));

  const torneo = await fallo(() =>
    uno(db, mover, {
      uid: "lu", delta: -500, motivo: MOTIVOS.TORNEO_ENTRADA, referencia: "COPA",
      idempotencia: "torneo_entrada_COPA_lu",
    }));
  ok(torneo && /Leyendas ganadas/.test(torneo.message),
     "así que un torneo, que sólo acepta ganadas, la sigue rechazando", torneo?.message);
}

// =====================================================================
console.log("\n=== 5. index.js conecta las devoluciones como se prueban acá ===");
// =====================================================================

{
  /**
   * Las secciones de arriba —y las de salida, cierre y administración— le
   * pasan a cada módulo el motivo de devolución a mano. En producción se lo
   * pasa `index.js`, y ahí nadie lo prueba: si volviera a decir
   * `ENTRADA_PARTIDA`, todo lo de arriba seguiría en verde y las devoluciones
   * fallarían recién con alguien saliendo de una sala.
   *
   * Es el mismo tipo de error que la pimienta sin declarar: no estaba en la
   * lógica sino en cómo se conectaba. Sólo se ve leyendo el texto.
   */
  const { readFileSync } = await import("node:fs");
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");

  /** El bloque de argumentos de `llamada({ ... })`, hasta su cierre. */
  const bloque = (llamada) => {
    const desde = index.indexOf(`${llamada}({`);
    return desde < 0 ? "" : index.slice(desde, index.indexOf("\n});", desde));
  };

  ok(/motivo: MOTIVOS\.DEVOLUCION_ENTRADA,/.test(bloque("crearSalirDeSalaEnEspera")),
     "salir de una sala devuelve con DEVOLUCION_ENTRADA");
  ok(/motivo: MOTIVOS\.DEVOLUCION_ENTRADA,/.test(bloque("crearAdmin")),
     "la cancelación de la administración, también");
  ok(/motivoDevolucion: MOTIVOS\.DEVOLUCION_ENTRADA,/.test(bloque("crearCierre")),
     "y el cierre sin ganadores, también");

  // La devolución busca la entrada por su clave: si el cobro la escribiera
  // con otra, la encontraría vacía y devolvería todo a las ganadas.
  const cobros = index.match(/motivo: MOTIVOS\.ENTRADA_PARTIDA,\s*referencia: codigo,\s*idempotencia: [^\r\n]+/g) ?? [];
  ok(cobros.length === 2, "hay dos cobros de entrada (abrir una sala y sumarse)", cobros.length);
  ok(cobros.every((c) => c.includes("claveDeEntrada(codigo, uid)")),
     "y los dos usan la clave que después busca la devolución", cobros);
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
