/**
 * La red de seguridad contra el jugador que desaparece.
 *
 * Levantar, usar un poder y decidir si cortar no tienen reloj: se piensan sin
 * apuro, y eso es deliberado. Pero el 29 de agosto una partida real quedó
 * trabada en una de esas tres fases —última acción a las 16:28:59, y nada
 * más— porque el jugador que tenía que decidir se fue.
 *
 * El servidor ya tenía `saltarAusente` y ya sabía quién estaba ausente. Lo
 * que faltaba era que alguien lo llamara: `mesa.js` no lo hacía nunca.
 *
 * Acá se comprueban las dos mitades:
 *
 *   - la del servidor, que es la autoridad y ya existía;
 *   - la condición que mira el cliente, que es la MISMA que publica el
 *     servidor, no un cálculo propio.
 */

import { crearMotorEnRed, MS_SIN_SENALES, MS_MIRAR } from "../functions/partida-red.js";
import { MS_VENTANA, MS_GRACIA } from "../public/js/reglas/red.js";
import { MS_REVELACION } from "../public/js/reglas/vista.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

class E extends Error { constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; } }
const error = (codigo, mensaje) => new E(codigo, mensaje);

function crearFirestore() {
  const docs = new Map();
  const oyentes = new Map();
  let version = 0;
  const avisar = (r) => {
    for (const fn of oyentes.get(r) ?? []) {
      fn({ exists: docs.has(r), data: () => structuredClone(docs.get(r)?.datos) });
    }
  };
  const db = {
    intentos: 0,
    collection: (n) => ({ doc: (id = `a${Math.random()}`) => ({ ruta: `${n}/${id}` }) }),
    async runTransaction(cuerpo) {
      for (let i = 0; i < 10; i++) {
        db.intentos++;
        const leidas = new Map(); const esc = []; let yaEscribio = false;
        const tx = {
          async get(ref) {
            if (yaEscribio) throw error("invalid-argument", "Lectura tras escritura");
            const d = docs.get(ref.ruta);
            leidas.set(ref.ruta, d ? d.version : 0);
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
        for (const e of esc) avisar(e.ruta);
        return res;
      }
      throw error("aborted", "Demasiados reintentos.");
    },
  };
  db.escuchar = (r, fn) => {
    if (!oyentes.has(r)) oyentes.set(r, new Set());
    oyentes.get(r).add(fn);
    if (docs.has(r)) fn({ exists: true, data: () => structuredClone(docs.get(r).datos) });
    return () => oyentes.get(r).delete(fn);
  };
  db.leer = (r) => docs.get(r)?.datos;
  return db;
}

// ================================================================ montaje

const DOS = ["ana", "beto"];
const CODIGO = "AUS001";
let reloj = 500000;

function montar() {
  const db = crearFirestore();
  const red = crearMotorEnRed({
    db, partidas: "partidas", ahora: () => reloj, idAleatorio: () => `v${reloj}`,
    marcaDeTiempo: () => "T", error, semillaDe: () => 4242,
  });
  return { db, red };
}

const capturar = async (fn) => {
  try { return { valor: await fn() }; } catch (e) { return { error: e }; }
};
const partida = (db) => db.leer(`partidas/${CODIGO}`);
const vista = (db, uid) => db.leer(`partidas/${CODIGO}/vistas/${uid}`);

/**
 * La MISMA condición que mira `mesa.js`, copiada tal cual.
 *
 * No recalcula nada: lee `ausentes`, que lo publica el servidor. Si esto
 * dejara de coincidir con `mesa.js`, habría dos autoridades sobre quién está
 * conectado, que es exactamente lo que no queremos.
 */
const FASES_SIN_RELOJ = new Set(["levantada", "poder", "postLevantada"]);
function elClienteLlamaria(v, miUid) {
  if (!v || !FASES_SIN_RELOJ.has(v.fase)) return false;
  const enTurno = v.jugadores[v.indiceTurno]?.id;
  if (!enTurno || enTurno === miUid) return false;
  return (v.ausentes ?? []).includes(enTurno);
}

/** Deja la partida en la fase pedida, con `quien` en turno. */
async function llevarA(db, red, fase, quien = "ana") {
  await red.repartir({ codigo: CODIGO, jugadores: DOS, nombres: DOS });
  const p = partida(db);
  const i = DOS.indexOf(quien);
  const estado = { ...p.estado, fase, indiceTurno: i };
  if (fase === "levantada") estado.levantada = { ...estado.mazo[0], visible: true };
  if (fase === "poder") {
    estado.poderPendiente = { tipo: "mirarРropiaX", numero: 7, indiceJugador: i };
    estado.poderPendiente.tipo = "mirarPropia";
  }
  const usadas = new Set(estado.levantada ? [estado.levantada.id] : []);
  await db.runTransaction(async (tx) => {
    tx.set({ ruta: `partidas/${CODIGO}` }, {
      ...p,
      estado: { ...estado, mazo: estado.mazo.filter((c) => !usadas.has(c.id)) },
      version: p.version + 1,
    });
  });
}

// ==================================================================== 1

console.log("\n=== 1. Jugador presente y activo: no interviene ===");
{
  reloj = 500000;
  const { db, red } = montar();
  await llevarA(db, red, "postLevantada", "ana");

  // Los dos laten ahora mismo.
  await red.latir({ uid: "ana", codigo: CODIGO });
  await red.latir({ uid: "beto", codigo: CODIGO });

  ok((partida(db).ausentes ?? []).length === 0, "nadie figura ausente", partida(db).ausentes);
  ok(elClienteLlamaria(vista(db, "beto"), "beto") === false,
     "el cliente de beto NO llamaría");

  const r = await capturar(() => red.saltarAusente({ codigo: CODIGO }));
  ok(/sigue conectado/.test(r.error?.message ?? ""),
     "y si igual llamara, el servidor lo rechaza", r.error?.message);
  ok(partida(db).estado.fase === "postLevantada", "la fase no se movió");
}

// ==================================================================== 2

console.log("\n=== 2. Ausente por MENOS de 15 s: no interviene ===");
{
  reloj = 500000;
  const { db, red } = montar();
  await llevarA(db, red, "levantada", "ana");
  await red.latir({ uid: "ana", codigo: CODIGO });
  await red.latir({ uid: "beto", codigo: CODIGO });

  // Ana deja de latir. Beto sigue, pero sólo pasan 10 segundos.
  reloj += 10000;
  await red.latir({ uid: "beto", codigo: CODIGO });

  ok(!(partida(db).ausentes ?? []).includes("ana"), "ana todavía no figura ausente",
     partida(db).ausentes);
  ok(elClienteLlamaria(vista(db, "beto"), "beto") === false, "el cliente no llamaría");

  const r = await capturar(() => red.saltarAusente({ codigo: CODIGO }));
  ok(Boolean(r.error), "y el servidor lo rechazaría igual", r.error?.message);
  ok(partida(db).estado.fase === "levantada", "la fase sigue igual");
}

// ==================================================================== 3

console.log("\n=== 3. Ausente por MÁS de 15 s: se puede saltar ===");
{
  reloj = 500000;
  const { db, red } = montar();
  await llevarA(db, red, "levantada", "ana");
  await red.latir({ uid: "ana", codigo: CODIGO });
  await red.latir({ uid: "beto", codigo: CODIGO });

  reloj += MS_SIN_SENALES + 1000;
  await red.latir({ uid: "beto", codigo: CODIGO });

  ok((partida(db).ausentes ?? []).includes("ana"), "el servidor marca a ana ausente",
     partida(db).ausentes);
  ok(elClienteLlamaria(vista(db, "beto"), "beto") === true,
     "AHORA sí el cliente de beto llamaría");
  ok(elClienteLlamaria(vista(db, "ana"), "ana") === false,
     "y el de ana no: no se pide que lo salteen a uno mismo");

  const r = await capturar(() => red.saltarAusente({ codigo: CODIGO }));
  ok(r.valor?.salteado === "ana", "se saltea a ana", r.error?.message ?? r.valor);
  ok(partida(db).estado.fase !== "levantada", "y la partida sale de la fase trabada",
     partida(db).estado.fase);
}

// ==================================================================== 4

console.log("\n=== 4. Llamadas repetidas: no duplican la acción ===");
{
  reloj = 500000;
  const { db, red } = montar();
  await llevarA(db, red, "postLevantada", "ana");
  await red.latir({ uid: "ana", codigo: CODIGO });
  reloj += MS_SIN_SENALES + 1000;
  await red.latir({ uid: "beto", codigo: CODIGO });

  const turnoAntes = partida(db).estado.indiceTurno;
  const uno = await capturar(() => red.saltarAusente({ codigo: CODIGO }));
  ok(uno.valor?.salteado === "ana", "el primero saltea", uno.error?.message);
  const turnoTrasUno = partida(db).estado.indiceTurno;
  ok(turnoTrasUno !== turnoAntes, "el turno cambió", [turnoAntes, turnoTrasUno]);

  for (let i = 0; i < 4; i++) {
    const otra = await capturar(() => red.saltarAusente({ codigo: CODIGO }));
    ok(Boolean(otra.error), `llamada repetida ${i + 1}: rechazada`, otra.error?.message);
  }
  ok(partida(db).estado.indiceTurno === turnoTrasUno,
     "el turno NO volvió a moverse", partida(db).estado.indiceTurno);
}

// ==================================================================== 5

console.log("\n=== 5. Dos clientes saltando al mismo jugador a la vez ===");
{
  reloj = 500000;
  const { db, red } = montar();
  await llevarA(db, red, "postLevantada", "ana");
  await red.latir({ uid: "ana", codigo: CODIGO });
  reloj += MS_SIN_SENALES + 1000;
  await red.latir({ uid: "beto", codigo: CODIGO });

  const antes = partida(db).estado.indiceTurno;
  const [a, b] = await Promise.all([
    capturar(() => red.saltarAusente({ codigo: CODIGO })),
    capturar(() => red.saltarAusente({ codigo: CODIGO })),
  ]);
  const exitos = [a, b].filter((r) => r.valor).length;
  ok(exitos === 1, "una sola prospera", exitos);
  ok([a, b].filter((r) => r.error).length === 1, "la otra se rechaza");

  // Lo importante: el turno avanzó UNA vez, no dos.
  const p = partida(db);
  ok(p.estado.indiceTurno !== antes, "el turno avanzó");
  ok(p.estado.fase === "turno", "a la fase siguiente", p.estado.fase);
}

// ==================================================================== 6

console.log("\n=== 6. Las tres fases sin reloj se desatascan ===");
{
  for (const fase of ["levantada", "poder", "postLevantada"]) {
    reloj = 500000;
    const { db, red } = montar();
    await llevarA(db, red, fase, "ana");
    await red.latir({ uid: "ana", codigo: CODIGO });

    // El primer golpe sólo recalcula el plazo: la fase se forzó escribiendo el
    // documento a mano, así que el que había quedó desfasado y el orquestador
    // se autocorrige antes de mirar nada más.
    const recalculo = await capturar(() => red.avanzarPartida({ codigo: CODIGO }));
    ok(recalculo.valor?.hizo === "recalcularPlazo",
       `${fase}: el primer golpe repone el plazo`, recalculo.valor?.hizo);

    // Ya con el plazo al día: sin nadie que la rescate, estas fases no tienen
    // reloj y el orquestador no puede hacer nada. Eso dejaba la partida colgada.
    const golpe = await capturar(() => red.avanzarPartida({ codigo: CODIGO }));
    ok(golpe.valor?.hizo === null,
       `${fase}: el orquestador solo no puede (motivo "${golpe.valor?.motivo}")`);

    reloj += MS_SIN_SENALES + 1000;
    await red.latir({ uid: "beto", codigo: CODIGO });
    ok(elClienteLlamaria(vista(db, "beto"), "beto") === true,
       `${fase}: el cliente de beto detecta que hay que rescatar`);

    const r = await capturar(() => red.saltarAusente({ codigo: CODIGO }));
    ok(r.valor && !r.error, `${fase}: el rescate funciona`, r.error?.message);
    ok(partida(db).estado.fase !== fase,
       `${fase}: la partida avanza a "${partida(db).estado.fase}"`);
  }
}

// ==================================================================== 7

console.log("\n=== 7. Las fases normales no cambian ===");
{
  for (const fase of ["mirar", "descarte", "finRonda", "finPartida"]) {
    reloj = 500000;
    const { db, red } = montar();
    const p = partida(db) ?? (await red.repartir({ codigo: CODIGO, jugadores: DOS, nombres: DOS }), partida(db));
    await db.runTransaction(async (tx) => {
      tx.set({ ruta: `partidas/${CODIGO}` }, {
        ...partida(db), estado: { ...partida(db).estado, fase }, version: partida(db).version + 1,
      });
    });
    await red.latir({ uid: "ana", codigo: CODIGO });
    reloj += MS_SIN_SENALES + 1000;
    await red.latir({ uid: "beto", codigo: CODIGO });

    ok(elClienteLlamaria(vista(db, "beto"), "beto") === false,
       `${fase}: el cliente NO pide rescate (no es fase sin reloj)`);
  }

  // Y en `turno`, que sí tiene reloj, `saltarAusente` sigue funcionando como
  // antes: es su comportamiento original, no se tocó.
  reloj = 500000;
  const { db, red } = montar();
  await llevarA(db, red, "turno", "ana");
  await red.latir({ uid: "ana", codigo: CODIGO });
  reloj += MS_SIN_SENALES + 1000;
  await red.latir({ uid: "beto", codigo: CODIGO });
  const r = await capturar(() => red.saltarAusente({ codigo: CODIGO }));
  ok(r.valor?.salteado === "ana", "en `turno` sigue saltando como siempre", r.error?.message);
}

// ================================================ 8. la desconexión real

console.log("\n=== 8. Reproducción: se va el jugador activo, sigue el otro ===");
{
  reloj = 500000;
  const { db, red } = montar();
  await red.repartir({ codigo: CODIGO, jugadores: DOS, nombres: DOS });

  // Se juega hasta una fase sin reloj, por el camino normal.
  reloj += MS_MIRAR + 1;
  await red.avanzarPartida({ codigo: CODIGO });   // cierra la mirada
  await red.avanzarPartida({ codigo: CODIGO });   // abre la ventana
  const v = partida(db).ventana;
  reloj = v.abiertaEn + MS_VENTANA + MS_GRACIA + 1;
  await red.avanzarPartida({ codigo: CODIGO });   // cierra la ventana y resuelve
  reloj += MS_REVELACION;
  await red.avanzarPartida({ codigo: CODIGO });   // tapa lo expuesto → turno

  const enTurno = DOS[partida(db).estado.indiceTurno];
  const otro = DOS.find((u) => u !== enTurno);
  await red.accionDeTurno({ uid: enTurno, codigo: CODIGO, accion: "levantar", clientActionId: "L1" });
  ok(partida(db).estado.fase === "levantada", `${enTurno} levanta → fase sin reloj`);

  // Se cierra su navegador: deja de latir y de golpear.
  const versionAlIrse = partida(db).version;
  reloj += 5000;
  await red.latir({ uid: otro, codigo: CODIGO });
  let golpe = await capturar(() => red.avanzarPartida({ codigo: CODIGO }));
  ok(golpe.valor?.hizo === null, "a los 5 s la partida sigue trabada, como debe ser");
  ok(elClienteLlamaria(vista(db, otro), otro) === false, "y el otro todavía no rescata");

  // Pasan los 15 segundos.
  reloj += MS_SIN_SENALES;
  await red.latir({ uid: otro, codigo: CODIGO });
  ok((partida(db).ausentes ?? []).includes(enTurno), `${enTurno} queda marcado ausente`);
  ok(elClienteLlamaria(vista(db, otro), otro) === true, `${otro} detecta que hay que rescatar`);

  const rescate = await capturar(() => red.saltarAusente({ codigo: CODIGO }));
  ok(rescate.valor?.salteado === enTurno, "se lo saltea", rescate.error?.message);

  const despues = partida(db);
  ok(despues.estado.fase === "turno", "la partida CONTINÚA", despues.estado.fase);
  ok(despues.estado.indiceTurno === DOS.indexOf(otro), `y le toca a ${otro}`);
  ok(despues.version > versionAlIrse, "con una versión nueva publicada");

  // Y el que quedó puede jugar.
  const juega = await capturar(() => red.accionDeTurno({
    uid: otro, codigo: CODIGO, accion: "levantar", clientActionId: "L2",
  }));
  ok(juega.valor?.fase === "levantada", `${otro} puede jugar su turno`, juega.error?.message);

  // El que se fue NO fue eliminado ni abandonó: si vuelve, sigue jugando.
  ok(!despues.abandonaron?.includes(enTurno), "el que se fue no cuenta como abandono");
  ok(!despues.estado.jugadores[DOS.indexOf(enTurno)].eliminado, "ni queda eliminado");
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
