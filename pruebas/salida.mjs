/**
 * Salir de una sala que todavía no empezó.
 *
 * Esta operación estaba ROTA en producción y nadie lo sabía: devolvía las
 * entradas llamando a `moverLeyendas` en un bucle, y Firestore prohíbe leer
 * después de haber escrito dentro de una transacción. Con dos o más jugadores
 * la devolución nunca se confirmaba.
 *
 * Lo que hay que demostrar, y lo que nadie estaba demostrando:
 *
 *   nunca puede quedar una devolución a medias.
 *
 * O se devuelve a todos los que corresponde y la sala se cancela, o no pasa
 * nada. Nunca un jugador cobrado y otro no.
 *
 * El Firestore de mentira aplica la regla real: se niega a leer después de
 * escribir. Sin eso esta suite pasaría igual con el código roto.
 */

import { crearMoverLeyendas } from "../functions/leyendas.js";
import { crearSalirDeSalaEnEspera } from "../functions/salida.js";
import { ESTADOS_SALA, MODOS } from "../public/js/reglas/salas.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

class E extends Error { constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; } }
const error = (codigo, mensaje) => new E(codigo, mensaje);

// ============================== Firestore con la regla lectura/escritura

function crearFirestore(inicial = {}) {
  const docs = new Map();
  let version = 0;
  for (const [ruta, datos] of Object.entries(inicial)) {
    docs.set(ruta, { datos: structuredClone(datos), version: ++version });
  }
  const db = {
    intentos: 0,
    ganchoTrasLeer: null,
    collection: (n) => ({ doc: (id = `a${Math.random()}`) => ({ ruta: `${n}/${id}` }) }),
    async runTransaction(cuerpo) {
      for (let i = 0; i < 10; i++) {
        db.intentos++;
        const leidas = new Map(); const esc = []; let yaEscribio = false;
        const tx = {
          async get(ref) {
            if (yaEscribio) {
              throw error("invalid-argument",
                `Lectura de ${ref.ruta} después de una escritura: Firestore no lo permite.`);
            }
            const d = docs.get(ref.ruta);
            leidas.set(ref.ruta, d ? d.version : 0);
            if (db.ganchoTrasLeer) await db.ganchoTrasLeer(ref.ruta);
            return { exists: Boolean(d), data: () => (d ? structuredClone(d.datos) : undefined) };
          },
          set(ref, datos, op) { yaEscribio = true; esc.push({ ruta: ref.ruta, datos, m: Boolean(op?.merge) }); },
          update(ref, datos) { yaEscribio = true; esc.push({ ruta: ref.ruta, datos, m: true }); },
        };
        const res = await cuerpo(tx);
        if ([...leidas].some(([r, v]) => (docs.get(r)?.version ?? 0) !== v)) continue;
        for (const e of esc) {
          const p = docs.get(e.ruta);
          docs.set(e.ruta, {
            datos: e.m ? { ...(p?.datos ?? {}), ...structuredClone(e.datos) } : structuredClone(e.datos),
            version: ++version,
          });
        }
        return res;
      }
      throw error("aborted", "Demasiados reintentos.");
    },
  };
  db.leer = (r) => docs.get(r)?.datos;
  db.rutas = () => [...docs.keys()];
  return db;
}

// ================================================================ montaje

const CODIGO = "SALIR1";
const ENTRADA = 100;
const SALDO = 1000;
const NOMBRE = { ana: "Ana", beto: "Beto", caro: "Caro", dani: "Dani" };

/** Una sala en espera con los jugadores que se le pasen; el primero la creó. */
function montar(jugadores, { estado = ESTADOS_SALA.ESPERANDO, entrada = ENTRADA } = {}) {
  const inicial = {
    [`rooms/${CODIGO}`]: {
      codigo: CODIGO, modo: MODOS.LEYENDAS, estado, entrada,
      creador: jugadores[0],
      jugadores: [...jugadores],
      jugadoresNombres: jugadores.map((u) => NOMBRE[u]),
      listos: [...jugadores],
      pozo: entrada * jugadores.length,
    },
  };
  for (const uid of jugadores) inicial[`users/${uid}`] = { credits: SALDO };

  const db = crearFirestore(inicial);
  const moverLeyendas = crearMoverLeyendas({
    db, usuarios: "users", campoSaldo: "credits", marcaDeTiempo: () => "T", error,
  });
  const salir = crearSalirDeSalaEnEspera({
    db, salas: "rooms", moverLeyendas, motivo: "apuesta",
    marcaDeTiempo: () => "T", error, estados: ESTADOS_SALA,
  });
  return { db, salir };
}

const capturar = async (fn) => {
  try { return { valor: await fn() }; } catch (e) { return { error: e }; }
};
const saldo = (db, uid) => db.leer(`users/${uid}`).credits;
const sala = (db) => db.leer(`rooms/${CODIGO}`);
const asientos = (db) => db.rutas().filter((r) => r.startsWith("movimientos/"));

// ==================================================================== 1

console.log("\n=== 1. El creador sale con DOS jugadores ===");
{
  const { db, salir } = montar(["ana", "beto"]);
  const r = await capturar(() => salir({ uid: "ana", codigo: CODIGO }));

  ok(r.valor && !r.error, "la salida se procesa (antes fallaba acá)", r.error?.message);
  ok(r.valor.cancelada === true, "la sala se cancela");
  ok(saldo(db, "ana") === SALDO + ENTRADA, "se le devuelve al creador", saldo(db, "ana") - SALDO);
  ok(saldo(db, "beto") === SALDO + ENTRADA, "y al otro también", saldo(db, "beto") - SALDO);
  ok(asientos(db).length === 2, "dos asientos de devolución", asientos(db));
  ok(sala(db).estado === ESTADOS_SALA.CANCELADA, "y la sala queda cancelada", sala(db).estado);
  ok(sala(db).motivoCancelacion === "el creador salió de la sala", "con su motivo");
}

console.log("\n=== 2. El creador sale con TRES jugadores ===");
{
  const { db, salir } = montar(["ana", "beto", "caro"]);
  const r = await capturar(() => salir({ uid: "ana", codigo: CODIGO }));

  ok(r.valor && !r.error, "se procesa", r.error?.message);
  ok(["ana", "beto", "caro"].every((u) => saldo(db, u) === SALDO + ENTRADA),
     "se devuelve a los tres", ["ana", "beto", "caro"].map((u) => saldo(db, u) - SALDO));
  ok(asientos(db).length === 3, "tres asientos", asientos(db).length);
  ok(r.valor.devueltos.length === 3, "y el resultado los enumera", r.valor.devueltos);
}

console.log("\n=== 2b. El creador sale con CUATRO ===");
{
  const { db, salir } = montar(["ana", "beto", "caro", "dani"]);
  await salir({ uid: "ana", codigo: CODIGO });
  ok(["ana", "beto", "caro", "dani"].every((u) => saldo(db, u) === SALDO + ENTRADA),
     "se devuelve a los cuatro");
  ok(asientos(db).length === 4, "cuatro asientos", asientos(db).length);
  ok(sala(db).estado === ESTADOS_SALA.CANCELADA, "sala cancelada");
}

// ==================================================================== 3

console.log("\n=== 3. Sale alguien que NO es el creador ===");
{
  const { db, salir } = montar(["ana", "beto", "caro"]);
  const r = await capturar(() => salir({ uid: "beto", codigo: CODIGO }));

  ok(r.valor?.cancelada === false, "la sala NO se cancela", r.valor?.cancelada);
  ok(saldo(db, "beto") === SALDO + ENTRADA, "se le devuelve sólo a él", saldo(db, "beto") - SALDO);
  ok(saldo(db, "ana") === SALDO && saldo(db, "caro") === SALDO,
     "a los demás no se les toca el saldo", [saldo(db, "ana"), saldo(db, "caro")]);
  ok(asientos(db).length === 1, "un solo asiento", asientos(db).length);

  const s = sala(db);
  ok(s.estado === ESTADOS_SALA.ESPERANDO, "la sala sigue esperando", s.estado);
  ok(!s.jugadores.includes("beto"), "y ya no figura entre los jugadores", s.jugadores);
  ok(!s.jugadoresNombres.includes("Beto"), "ni entre los nombres", s.jugadoresNombres);
  ok(!s.listos.includes("beto"), "ni entre los listos", s.listos);
  ok(s.pozo === ENTRADA * 2, "y el pozo baja a dos entradas", s.pozo);
  ok(s.jugadores.length === s.jugadoresNombres.length,
     "los jugadores y sus nombres siguen alineados");
}

// ==================================================================== 4

console.log("\n=== 4. Devoluciones múltiples: todo o nada ===");
{
  // Si algo falla en el medio, no puede quedar uno cobrado y otro no.
  const { db, salir } = montar(["ana", "beto", "caro"]);
  // Se rompe la sala a mitad de camino: la entrada deja de ser válida.
  const s = sala(db);
  await db.runTransaction(async (tx) => {
    tx.set({ ruta: `rooms/${CODIGO}` }, { ...s, entrada: 0 });
  });

  const r = await capturar(() => salir({ uid: "ana", codigo: CODIGO }));
  ok(Boolean(r.error), "se rechaza antes de mover nada", r.error?.message);
  ok(["ana", "beto", "caro"].every((u) => saldo(db, u) === SALDO),
     "ningún saldo se movió", ["ana", "beto", "caro"].map((u) => saldo(db, u)));
  ok(asientos(db).length === 0, "y no quedó ningún asiento a medias", asientos(db));
  ok(sala(db).estado === ESTADOS_SALA.ESPERANDO, "la sala tampoco se canceló");
}

console.log("\n=== 4b. Nunca queda una devolución incompleta ===");
{
  // Se recorre cada tamaño de sala y se comprueba la invariante: la cantidad
  // de devueltos es 0 o son TODOS los que correspondía.
  let malos = 0;
  for (const jugadores of [["ana"], ["ana", "beto"], ["ana", "beto", "caro"],
                           ["ana", "beto", "caro", "dani"]]) {
    const { db, salir } = montar(jugadores);
    const r = await capturar(() => salir({ uid: "ana", codigo: CODIGO }));
    const devueltos = jugadores.filter((u) => saldo(db, u) === SALDO + ENTRADA);
    if (r.valor && devueltos.length !== jugadores.length) malos++;
    if (r.error && devueltos.length !== 0) malos++;
    // Y la sala está cancelada si y sólo si se devolvió.
    if (r.valor && sala(db).estado !== ESTADOS_SALA.CANCELADA) malos++;
  }
  ok(malos === 0, "con 1, 2, 3 y 4 jugadores: o se devuelve a todos o a ninguno", malos);
}

// ==================================================================== 5

console.log("\n=== 5. Dos salidas simultáneas ===");
{
  const { db, salir } = montar(["ana", "beto", "caro"]);
  let soltar; const barrera = new Promise((r) => (soltar = r));
  let primera = true;
  db.ganchoTrasLeer = async (ruta) => {
    if (ruta === `rooms/${CODIGO}` && primera) { primera = false; await barrera; }
  };

  // El creador y otro jugador salen a la vez.
  const a = capturar(() => salir({ uid: "ana", codigo: CODIGO }));
  await new Promise((r) => setImmediate(r));
  const b = await capturar(() => salir({ uid: "beto", codigo: CODIGO }));
  soltar();
  const resA = await a;

  ok(db.intentos > 2, "una de las dos reintentó", db.intentos);
  // Sea cual sea el orden, nadie cobra dos veces.
  for (const uid of ["ana", "beto", "caro"]) {
    ok(saldo(db, uid) <= SALDO + ENTRADA, `${uid} no cobró más de una entrada`, saldo(db, uid) - SALDO);
  }
  const total = ["ana", "beto", "caro"].reduce((s, u) => s + saldo(db, u) - SALDO, 0);
  ok(total <= ENTRADA * 3, "y en total no se devolvió más que el pozo", total);
  ok([resA, b].filter((r) => r.valor).length >= 1, "al menos una prosperó");
}

console.log("\n=== 5b. El mismo jugador sale dos veces a la vez ===");
{
  const { db, salir } = montar(["ana", "beto"]);
  const [x, y] = await Promise.all([
    capturar(() => salir({ uid: "beto", codigo: CODIGO })),
    capturar(() => salir({ uid: "beto", codigo: CODIGO })),
  ]);
  ok(saldo(db, "beto") === SALDO + ENTRADA, "cobró una sola entrada", saldo(db, "beto") - SALDO);
  ok(asientos(db).length === 1, "y quedó un solo asiento", asientos(db).length);
  ok([x, y].some((r) => r.valor), "al menos una prosperó");
}

// ==================================================================== 6

console.log("\n=== 6. Validaciones: nada se mueve si algo falla ===");
{
  // Sala que ya empezó.
  const jugando = montar(["ana", "beto"], { estado: ESTADOS_SALA.JUGANDO });
  const r1 = await capturar(() => jugando.salir({ uid: "ana", codigo: CODIGO }));
  ok(/ya empezó/.test(r1.error?.message ?? ""), "una partida en curso se rechaza", r1.error?.message);
  ok(saldo(jugando.db, "ana") === SALDO, "sin devolver nada");

  // Jugador ajeno.
  const ajena = montar(["ana", "beto"]);
  const r2 = await capturar(() => ajena.salir({ uid: "colado", codigo: CODIGO }));
  ok(/No estás en esta sala/.test(r2.error?.message ?? ""), "un ajeno se rechaza", r2.error?.message);
  ok(asientos(ajena.db).length === 0, "sin mover nada");

  // Sala inexistente.
  const vacia = montar(["ana"]);
  const r3 = await capturar(() => vacia.salir({ uid: "ana", codigo: "NOEXIS" }));
  ok(r3.error?.codigo === "not-found", "una sala inexistente se rechaza", r3.error?.codigo);

  // Sin código.
  const r4 = await capturar(() => vacia.salir({ uid: "ana", codigo: "" }));
  ok(r4.error?.codigo === "invalid-argument", "sin código se rechaza", r4.error?.codigo);

  // Sin sesión.
  const r5 = await capturar(() => vacia.salir({ uid: null, codigo: CODIGO }));
  ok(r5.error?.codigo === "unauthenticated", "sin sesión se rechaza", r5.error?.codigo);
}

// ==================================================================== 7

console.log("\n=== 7. Repetir la operación no devuelve dos veces ===");
{
  const { db, salir } = montar(["ana", "beto", "caro"]);
  await salir({ uid: "ana", codigo: CODIGO });
  const saldos = ["ana", "beto", "caro"].map((u) => saldo(db, u));

  // La sala ya está cancelada, así que un segundo intento se rechaza por
  // estado. Es la respuesta correcta: no hay nada que devolver.
  const otra = await capturar(() => salir({ uid: "ana", codigo: CODIGO }));
  ok(Boolean(otra.error), "el segundo intento se rechaza", otra.error?.message);
  ok(["ana", "beto", "caro"].every((u, i) => saldo(db, u) === saldos[i]),
     "y ningún saldo cambió", ["ana", "beto", "caro"].map((u) => saldo(db, u)));
  ok(asientos(db).length === 3, "siguen siendo tres asientos", asientos(db).length);
}

console.log("\n=== 7b. La clave de idempotencia protege aunque se reabra la sala ===");
{
  const { db, salir } = montar(["ana", "beto"]);
  await salir({ uid: "beto", codigo: CODIGO });
  const trasUno = saldo(db, "beto");

  // Se fuerza la sala de vuelta a "esperando" con beto adentro, como si algo
  // la hubiera reabierto. La devolución NO se repite: el asiento ya existe.
  const s = sala(db);
  await db.runTransaction(async (tx) => {
    tx.set({ ruta: `rooms/${CODIGO}` }, {
      ...s, estado: ESTADOS_SALA.ESPERANDO,
      jugadores: ["ana", "beto"], jugadoresNombres: ["Ana", "Beto"], listos: [],
    });
  });

  const r = await capturar(() => salir({ uid: "beto", codigo: CODIGO }));
  ok(r.valor && !r.error, "la operación se procesa", r.error?.message);
  ok(saldo(db, "beto") === trasUno, "pero NO se le devuelve de nuevo", saldo(db, "beto") - SALDO);
  ok(r.valor.yaDevueltos === 1, "y el resultado lo dice", r.valor.yaDevueltos);
  ok(asientos(db).length === 1, "sigue habiendo un solo asiento", asientos(db).length);
}

// ==================================================================== 8

console.log("\n=== 8. La regla de Firestore se respeta ===");
{
  // Con el código viejo —moverLeyendas en bucle— esto fallaba con dos o más.
  // Es la prueba de que el arreglo es el arreglo.
  for (const n of [2, 3, 4]) {
    const jugadores = ["ana", "beto", "caro", "dani"].slice(0, n);
    const { db, salir } = montar(jugadores);
    const r = await capturar(() => salir({ uid: "ana", codigo: CODIGO }));
    ok(r.valor && !r.error, `con ${n} jugadores no hay lectura después de escritura`,
       r.error?.message);
  }
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
