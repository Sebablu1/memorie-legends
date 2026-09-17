/**
 * Ausente por tiempo: dejar vencer la decisión de cortar marca al jugador, y
 * «he vuelto» lo saca.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA REGLA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Si alguien se queda ausente, se lo marca y la ronda SIGUE: los demás no
 * pierden tiempo esperando. Cuando vuelve, aprieta «he vuelto» y se
 * reincorpora a la mano en curso. No se lo expulsa, no se lo espera. El turno
 * que le saltearon mientras no estaba queda perdido.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DOS LISTAS, DOS CASOS, Y NO SE MEZCLAN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `ausentes` es la de siempre: la calcula `latir` desde los latidos y la
 * rescata `saltarAusente`. Cubre al que se fue de verdad y no puede apretar
 * nada.
 *
 * `ausentesPorTiempo` es la nueva: la llena el vencimiento de los veinte
 * segundos de `postLevantada` y sólo la vacía «he vuelto». Cubre al que dejó la
 * pestaña abierta —sigue latiendo— y no la mira.
 *
 * No podían ser la misma. `latir` recalcula `ausentes` ENTERA en cada
 * llamada, y este jugador sigue latiendo: el próximo latido de cualquiera lo
 * habría borrado. Lo comprueba el caso 2, que es el que justifica que existan
 * dos.
 */

import { crearMotorEnRed, MS_PASO_AUTOMATICO, MS_TURNO } from "../functions/partida-red.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

class E extends Error { constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; } }
const error = (codigo, mensaje) => new E(codigo, mensaje);

/** El mismo Firestore de mentira que `paso-automatico.mjs`: lecturas antes que escrituras. */
function crearFirestore() {
  const docs = new Map();
  let version = 0;
  const db = {
    collection: (n) => ({ doc: (id = `a${Math.random()}`) => ({ ruta: `${n}/${id}` }) }),
    async runTransaction(cuerpo) {
      for (let i = 0; i < 10; i++) {
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
        return res;
      }
      throw error("aborted", "Demasiados reintentos.");
    },
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

const partida = (db) => db.leer(`partidas/${CODIGO}`);
const plazo = (db) => partida(db).plazo;
const marcados = (db) => partida(db).ausentesPorTiempo ?? [];
const vistaDe = (db, uid) => db.leer(`partidas/${CODIGO}/vistas/${uid}`);

/**
 * Deja la partida en `fase` con `quien` en turno, y la lista de marcados que
 * se pida. Después da un golpe para que el servidor ponga el plazo.
 *
 * Armado a mano, igual que en `paso-automatico.mjs`: llegar jugando son varias
 * transiciones que ya prueban otras suites.
 */
async function en(db, red, { fase, quien = "ana", ausentesPorTiempo = [] }) {
  if (!partida(db)) await red.repartir({ yaSentados: true, codigo: CODIGO, jugadores: DOS, nombres: DOS });
  const p = partida(db);
  await db.runTransaction(async (tx) => {
    tx.set({ ruta: `partidas/${CODIGO}` }, {
      ...p,
      estado: { ...p.estado, fase, levantada: null, indiceTurno: DOS.indexOf(quien) },
      ausentesPorTiempo,
      plazo: null,
      version: p.version + 1,
    });
  });
  await red.avanzarPartida({ codigo: CODIGO });
}

// ==================================================================== 1

console.log("\n=== 1. Vencer los veinte segundos marca al jugador ===");
{
  reloj = 500000;
  const { db, red } = montar();
  await en(db, red, { fase: "postLevantada", quien: "ana" });
  ok(marcados(db).length === 0, "antes de vencer, nadie está marcado", marcados(db));

  reloj += MS_PASO_AUTOMATICO;
  const r = await red.avanzarPartida({ codigo: CODIGO });

  ok(r.hizo === "pasarPorTiempo", "el plazo se cumple", r.hizo);
  ok(marcados(db).includes("ana"), "y ana queda marcada", marcados(db));
  ok(!marcados(db).includes("beto"), "beto no, que no hizo nada", marcados(db));

  // La vista lo publica: la mesa lo necesita para dibujarlo.
  ok(JSON.stringify(vistaDe(db, "beto").ausentesPorTiempo) === JSON.stringify(["ana"]),
     "los otros lo ven en su vista", vistaDe(db, "beto").ausentesPorTiempo);
  ok(JSON.stringify(vistaDe(db, "ana").ausentesPorTiempo) === JSON.stringify(["ana"]),
     "y ella también, que es quien tiene que apretar el botón", vistaDe(db, "ana").ausentesPorTiempo);
}

// ==================================================================== 2

console.log("\n=== 2. Un latido NO la borra — por eso son dos listas ===");
{
  reloj = 500000;
  const { db, red } = montar();
  await en(db, red, { fase: "postLevantada", quien: "ana" });
  reloj += MS_PASO_AUTOMATICO;
  await red.avanzarPartida({ codigo: CODIGO });

  // Los dos siguen con la pestaña abierta: latiendo.
  await red.latir({ uid: "ana", codigo: CODIGO });
  await red.latir({ uid: "beto", codigo: CODIGO });

  ok(marcados(db).includes("ana"),
     "ana sigue marcada después de latir: su pestaña está abierta y nadie la mira",
     marcados(db));
  ok(!(partida(db).ausentes ?? []).includes("ana"),
     "y NO figura como ausente por silencio, porque late", partida(db).ausentes);
}

// ==================================================================== 3

console.log("\n=== 3. El turno de un marcado se saltea sin esperarlo ===");
{
  reloj = 500000;
  const { db, red } = montar();
  await en(db, red, { fase: "turno", quien: "ana", ausentesPorTiempo: ["ana"] });

  /**
   * «Los demás no pierden tiempo esperando.» Si la marca sólo se viera, los
   * otros esperarían ocho segundos de levantar, diez de decidir y veinte de
   * cortar en cada turno suyo.
   */
  ok(plazo(db)?.que === "saltarTurno", "el plazo es saltar el turno", plazo(db));
  ok(plazo(db)?.hasta === reloj, "y vence YA, no en ocho segundos", plazo(db)?.hasta - reloj);

  // Sin mover el reloj: el golpe siguiente lo encuentra vencido.
  const r = await red.avanzarPartida({ codigo: CODIGO });
  ok(r.hizo === "saltarTurno", "un golpe alcanza, sin esperar nada", r.hizo);
  ok(partida(db).estado.indiceTurno === DOS.indexOf("beto"), "y le toca a beto",
     partida(db).estado.indiceTurno);
}

// ==================================================================== 4

console.log("\n=== 4. Al que no está marcado se lo espera como siempre ===");
{
  reloj = 500000;
  const { db, red } = montar();
  // ana marcada, pero el turno es de beto.
  await en(db, red, { fase: "turno", quien: "beto", ausentesPorTiempo: ["ana"] });

  ok(plazo(db)?.hasta === reloj + MS_TURNO,
     "beto tiene sus ocho segundos: la marca es de ana, no de la mesa",
     plazo(db)?.hasta - reloj);

  const r = await red.avanzarPartida({ codigo: CODIGO });
  ok(r.hizo === null, "y un golpe inmediato no le quita el turno", r);
}

// ==================================================================== 5

console.log("\n=== 5. «He vuelto» lo saca, y vuelve a jugar ===");
{
  reloj = 500000;
  const { db, red } = montar();
  await en(db, red, { fase: "turno", quien: "beto", ausentesPorTiempo: ["ana"] });
  const antes = partida(db).version;

  const r = await red.volver({ uid: "ana", codigo: CODIGO });
  ok(r.yaEstaba === false, "estaba marcada", r);
  ok(!marcados(db).includes("ana"), "y ya no lo está", marcados(db));
  ok(partida(db).version === antes + 1, "la partida se republica una vez", partida(db).version - antes);
  ok(JSON.stringify(vistaDe(db, "beto").ausentesPorTiempo) === "[]",
     "los otros ven que volvió", vistaDe(db, "beto").ausentesPorTiempo);

  /**
   * «Se reincorpora a la mano que se está jugando ahora.» No se le devuelve
   * nada: el turno sigue siendo de beto.
   */
  ok(partida(db).estado.indiceTurno === DOS.indexOf("beto"),
     "no le devuelve el turno: sigue siendo de beto", partida(db).estado.indiceTurno);
}

// ==================================================================== 6

console.log("\n=== 6. Volver justo antes del golpe no la deja salteada ===");
{
  /**
   * El caso fino, y el que justifica la marca `-ausente` en el plazo.
   *
   * Ana está marcada y le toca: el servidor ya publicó un plazo INMEDIATO.
   * Aprieta «he vuelto» antes de que nadie golpee. `nuevo()` conserva el
   * vencimiento de un plazo si la marca no cambió — así que con la marca de
   * siempre, el plazo inmediato sobreviviría a la publicación de `volver` y
   * el golpe siguiente la saltearía igual, recién vuelta.
   */
  reloj = 500000;
  const { db, red } = montar();
  await en(db, red, { fase: "turno", quien: "ana", ausentesPorTiempo: ["ana"] });
  ok(plazo(db)?.hasta === reloj, "el plazo inmediato ya está publicado");

  await red.volver({ uid: "ana", codigo: CODIGO });

  ok(plazo(db)?.hasta === reloj + MS_TURNO,
     "al volver, el plazo es de ocho segundos otra vez", plazo(db)?.hasta - reloj);

  const r = await red.avanzarPartida({ codigo: CODIGO });
  ok(r.hizo === null, "y el golpe siguiente NO la saltea", r);
  ok(partida(db).estado.indiceTurno === DOS.indexOf("ana"), "el turno sigue siendo suyo",
     partida(db).estado.indiceTurno);
}

// ==================================================================== 7

console.log("\n=== 7. Volver dos veces no escribe dos veces ===");
{
  reloj = 500000;
  const { db, red } = montar();
  await en(db, red, { fase: "turno", quien: "beto", ausentesPorTiempo: ["ana"] });

  await red.volver({ uid: "ana", codigo: CODIGO });
  const tras = partida(db).version;
  const r = await red.volver({ uid: "ana", codigo: CODIGO });

  ok(r.yaEstaba === true, "la segunda contesta que ya no estaba", r);
  ok(partida(db).version === tras,
     "y no sube la versión: republicar las vistas por nada es trabajo para cuatro",
     partida(db).version - tras);
}

// ==================================================================== 8

console.log("\n=== 8. Nadie de afuera puede sacar a nadie ===");
{
  reloj = 500000;
  const { db, red } = montar();
  await en(db, red, { fase: "turno", quien: "beto", ausentesPorTiempo: ["ana"] });

  let rechazo = null;
  try {
    await red.volver({ uid: "zoe", codigo: CODIGO });
  } catch (e) {
    rechazo = e.codigo;
  }
  ok(rechazo === "permission-denied", "alguien que no juega es rechazado", rechazo);
  ok(marcados(db).includes("ana"), "y ana sigue marcada", marcados(db));
}

// ==================================================================== 9

console.log("\n=== 9. Los plazos de diez segundos no marcan a nadie ===");
{
  /**
   * Vencer la carta levantada o el poder es jugar apurado, no haberse ido. La
   * única señal es la decisión de cortar: la más pensada de la ronda.
   */
  reloj = 500000;
  const { db, red } = montar();
  await en(db, red, { fase: "turno", quien: "ana" });
  await red.avanzarPartida({ codigo: CODIGO }); // nada: faltan ocho segundos

  /**
   * Se lleva a `levantada` a mano, con carta, y se deja vencer.
   *
   * La carta SALE del mazo, como hace `levantar`. La primera versión de esta
   * prueba la dejaba en los dos lugares y el detector de filtraciones de
   * `publicar` la frenó: una carta del mazo apareciendo en una vista. Tenía
   * razón él.
   */
  const p = partida(db);
  const [carta, ...resto] = p.estado.mazo;
  await db.runTransaction(async (tx) => {
    tx.set({ ruta: `partidas/${CODIGO}` }, {
      ...p,
      estado: {
        ...p.estado,
        fase: "levantada",
        mazo: resto,
        levantada: { ...carta, visible: true },
      },
      plazo: null,
      version: p.version + 1,
    });
  });
  await red.avanzarPartida({ codigo: CODIGO });
  reloj += 60_000;
  const r = await red.avanzarPartida({ codigo: CODIGO });

  ok(r.hizo === "descartarPorTiempo", "la carta se tiró sola", r.hizo);
  ok(marcados(db).length === 0, "y ana NO quedó marcada", marcados(db));
}

console.log(fallos ? `\n❌ ${fallos} FALLOS` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
