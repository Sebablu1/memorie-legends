/**
 * El paso automático de `postLevantada`.
 *
 * EL AGUJERO QUE TAPA
 *
 * `postLevantada` —cortar o pasar— era la única fase sin reloj en la que la
 * mesa entera queda esperando a una sola persona. Levantar tiene sus 8
 * segundos; la mirada y los reflejos se cierran solos. Ésta no tenía nada.
 *
 * `saltarAusente` no lo cubre, y conviene entender por qué: mide SILENCIO, o
 * sea 15 segundos sin latidos. Quien deja la pestaña abierta y se va a hacer
 * otra cosa sigue latiendo, así que nunca cuenta como ausente. La partida se
 * quedaba esperándolo y los otros tres no tenían forma de seguir.
 *
 * LO QUE SE PRUEBA
 *
 *   - que el plazo existe y vence a los 30 segundos del reloj del SERVIDOR;
 *   - que latir NO lo corre — si respirar alcanzara para renovarlo, el agujero
 *     seguiría abierto exactamente igual;
 *   - que golpear la puerta antes de tiempo no lo adelanta;
 *   - que al vencerse PASA y nunca corta;
 *   - que actuar a tiempo lo cancela, sin un pase fantasma después.
 */

import { crearMotorEnRed, MS_PASO_AUTOMATICO } from "../functions/partida-red.js";
import { MS_PASO_AUTOMATICO as DEL_MOTOR } from "../public/js/reglas/motor.js";

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
const CODIGO = "PAS001";
let reloj = 500000;

function montar() {
  const db = crearFirestore();
  const red = crearMotorEnRed({
    db, partidas: "partidas", ahora: () => reloj, idAleatorio: () => `v${reloj}`,
    marcaDeTiempo: () => "T", error, semillaDe: () => 4242,
  });
  return { db, red };
}

const partida = (db) => db.leer(`partidas/${CODIGO}`);
const plazo = (db) => partida(db).plazo;
const fase = (db) => partida(db).estado.fase;
const enTurno = (db) => partida(db).estado.indiceTurno;

/**
 * Deja la partida en `postLevantada` con `quien` en turno.
 *
 * El estado se arma a mano, igual que en `ausente.mjs`: llegar jugando hasta
 * acá son seis transiciones que ya prueban otras suites, y repetirlas en cada
 * caso de éste enterraría lo que se quiere mirar.
 */
async function enPostLevantada(db, red, quien = "ana") {
  await red.repartir({ codigo: CODIGO, jugadores: DOS, nombres: DOS });
  const p = partida(db);
  await db.runTransaction(async (tx) => {
    tx.set({ ruta: `partidas/${CODIGO}` }, {
      ...p,
      estado: { ...p.estado, fase: "postLevantada", indiceTurno: DOS.indexOf(quien) },
      // El plazo se anula a propósito: el que quedaba era el de la mirada, y
      // dejarlo haría que el primer golpe lo viera desfasado y gastara ese
      // golpe en recalcularlo en vez de en lo que se está probando.
      plazo: null,
      version: p.version + 1,
    });
  });
  // Un golpe para que el servidor ponga el plazo que corresponde a la fase.
  await red.avanzarPartida({ codigo: CODIGO });
}

// ==================================================================== 1

console.log("\n=== 1. El plazo existe y dura 30 segundos ===");
{
  reloj = 500000;
  const { db, red } = montar();
  await enPostLevantada(db, red, "ana");

  ok(MS_PASO_AUTOMATICO === 30000, "son 30 segundos", MS_PASO_AUTOMATICO);
  ok(MS_PASO_AUTOMATICO === DEL_MOTOR,
     "y el servidor usa la MISMA constante que la mesa de entrenamiento");

  const p = plazo(db);
  ok(p?.que === "pasarPorTiempo", "hay un plazo para pasar por tiempo", p);
  ok(p?.fase === "postLevantada", "atado a la fase", p?.fase);
  ok(p?.hasta === reloj + MS_PASO_AUTOMATICO, "que vence a los 30 s", p?.hasta - reloj);
}

// ==================================================================== 2

console.log("\n=== 2. Golpear antes de tiempo no lo adelanta ===");
{
  reloj = 500000;
  const { db, red } = montar();
  await enPostLevantada(db, red, "ana");
  const vence = plazo(db).hasta;

  reloj += MS_PASO_AUTOMATICO - 1;
  for (let i = 0; i < 50; i++) await red.avanzarPartida({ codigo: CODIGO });

  ok(fase(db) === "postLevantada", "cincuenta golpes tempranos no mueven la fase", fase(db));
  ok(plazo(db).hasta === vence, "y no corren el vencimiento", plazo(db).hasta - vence);
}

// ==================================================================== 3

console.log("\n=== 3. Latir NO renueva el plazo ===");
{
  // Éste es el caso que motivó todo: alguien presente pero quieto. Si latir
  // corriera el vencimiento, la partida se colgaría igual que antes, sólo que
  // ahora con un plazo puesto que no vencería nunca.
  reloj = 500000;
  const { db, red } = montar();
  await enPostLevantada(db, red, "ana");
  const vence = plazo(db).hasta;

  for (let i = 0; i < 20; i++) {
    reloj += 1000;
    await red.latir({ uid: "ana", codigo: CODIGO });
    await red.latir({ uid: "beto", codigo: CODIGO });
  }

  ok(plazo(db).hasta === vence,
     "veinte latidos repartidos en 20 s no corren el vencimiento", plazo(db).hasta - vence);

  // Los 10 s que le faltaban al plazo original. Si latir lo hubiera renovado,
  // acá todavía faltarían 20 y este golpe no haría nada.
  reloj += MS_PASO_AUTOMATICO - 20000;
  const r = await red.avanzarPartida({ codigo: CODIGO });
  ok(r.hizo === "pasarPorTiempo",
     "y a los 30 s del arranque pasa, contados desde que entró en la fase", r);
}

// ==================================================================== 4

console.log("\n=== 4. Al vencerse PASA, nunca corta ===");
{
  reloj = 500000;
  const { db, red } = montar();
  await enPostLevantada(db, red, "ana");
  const antes = partida(db).estado.jugadores.map((j) => j.puntos);

  reloj += MS_PASO_AUTOMATICO;
  const r = await red.avanzarPartida({ codigo: CODIGO });

  ok(r.hizo === "pasarPorTiempo", "el plazo se cumple", r);
  ok(fase(db) === "turno", "la partida sigue", fase(db));
  ok(enTurno(db) === 1, "y el turno es de beto", enTurno(db));
  ok(partida(db).estado.indiceCortador == null, "nadie cortó", partida(db).estado.indiceCortador);
  ok(JSON.stringify(partida(db).estado.jugadores.map((j) => j.puntos)) === JSON.stringify(antes),
     "y nadie sumó puntos: pasar no puntúa");
}

// ==================================================================== 5

console.log("\n=== 5. Actuar a tiempo lo cancela ===");
{
  reloj = 500000;
  const { db, red } = montar();
  await enPostLevantada(db, red, "ana");

  reloj += 10000;
  await red.accionDeTurno({
    uid: "ana", codigo: CODIGO, accion: "pasar", clientActionId: "P1",
  });
  ok(fase(db) === "turno", "ana pasa por su cuenta", fase(db));
  ok(enTurno(db) === 1, "y le toca a beto", enTurno(db));

  // El plazo viejo ya no corresponde a la fase. Que veinte segundos después no
  // dispare un segundo pase es lo que se comprueba acá: si lo hiciera, beto
  // perdería un turno que nunca llegó a jugar.
  ok(plazo(db).fase === "turno", "el plazo pasó a ser el de levantar", plazo(db));

  reloj += MS_PASO_AUTOMATICO;
  const r = await red.avanzarPartida({ codigo: CODIGO });
  ok(r.hizo !== "pasarPorTiempo", "no hay un pase fantasma del plazo anterior", r);
}

// ==================================================================== 6

console.log("\n=== 6. Cada turno tiene su propia cuenta ===");
{
  // La marca del plazo lleva el turno. Si llevara sólo la ronda, el segundo
  // turno heredaría el vencimiento del primero —ya cumplido— y pasaría solo,
  // al instante, sin darle a nadie tiempo de decidir.
  reloj = 500000;
  const { db, red } = montar();
  await enPostLevantada(db, red, "ana");

  reloj += MS_PASO_AUTOMATICO;
  await red.avanzarPartida({ codigo: CODIGO });
  ok(fase(db) === "turno" && enTurno(db) === 1, "pasó el turno de ana");

  // Beto llega a postLevantada sin que el reloj avance.
  const p = partida(db);
  await db.runTransaction(async (tx) => {
    tx.set({ ruta: `partidas/${CODIGO}` }, {
      ...p, estado: { ...p.estado, fase: "postLevantada" }, plazo: null,
      version: p.version + 1,
    });
  });
  await red.avanzarPartida({ codigo: CODIGO });

  ok(plazo(db).que === "pasarPorTiempo", "beto tiene su propio plazo", plazo(db));
  ok(plazo(db).hasta === reloj + MS_PASO_AUTOMATICO,
     "que arranca ahora, no heredado del turno de ana", plazo(db).hasta - reloj);

  const r = await red.avanzarPartida({ codigo: CODIGO });
  ok(r.hizo === null, "y no se cumple de inmediato", r);
}

// ====================================================================

console.log(fallos ? `\n❌ ${fallos} fallo(s)` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
