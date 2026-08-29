/**
 * Abandonar una partida EN RED: cobrar y salir de la mesa, en una sola pieza.
 *
 * Antes eran dos operaciones separadas: `abandonarPartida` cobraba el 50 % y
 * `marcarAbandono` sacaba al jugador. Entre una y otra existía un instante
 * —o un fallo, o simplemente que la segunda nunca se llamara— en el que al
 * jugador se le había cobrado y seguía sentado a la mesa, con su turno
 * bloqueando a los demás. Eso es lo que se cierra acá.
 *
 * El Firestore de mentira de esta suite hace algo que los otros no: se niega
 * a leer después de haber escrito, que es la regla real de las transacciones
 * de Firestore. Sin eso, el orden equivocado pasaría todas las pruebas y
 * fallaría en producción.
 */

import { crearMoverLeyendas } from "../functions/leyendas.js";
import { crearAbandonarPartida } from "../functions/abandono.js";
import { crearMotorEnRed } from "../functions/partida-red.js";
import { ESTADOS_SALA, MODOS } from "../public/js/reglas/salas.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

class E extends Error { constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; } }
const error = (codigo, mensaje) => new E(codigo, mensaje);

// ============================== Firestore con la regla de lectura/escritura

function crearFirestore(inicial = {}) {
  const docs = new Map();
  const oyentes = new Map();
  let version = 0;
  for (const [ruta, datos] of Object.entries(inicial)) {
    docs.set(ruta, { datos: structuredClone(datos), version: ++version });
  }
  const avisar = (r) => {
    for (const fn of oyentes.get(r) ?? []) fn({ exists: docs.has(r), data: () => structuredClone(docs.get(r)?.datos) });
  };

  const db = {
    intentos: 0,
    ganchoTrasLeer: null,
    collection: (n) => ({ doc: (id = `a${Math.random()}`) => ({ ruta: `${n}/${id}` }) }),

    async runTransaction(cuerpo) {
      for (let i = 0; i < 10; i++) {
        db.intentos++;
        const leidas = new Map();
        const esc = [];
        let yaEscribio = false;

        const tx = {
          async get(ref) {
            // La regla de Firestore, tal cual: todas las lecturas primero.
            if (yaEscribio) {
              throw error(
                "invalid-argument",
                `Lectura de ${ref.ruta} después de una escritura: Firestore no lo permite.`,
              );
            }
            const d = docs.get(ref.ruta);
            leidas.set(ref.ruta, d ? d.version : 0);
            if (db.ganchoTrasLeer) await db.ganchoTrasLeer(ref.ruta);
            return { exists: Boolean(d), data: () => (d ? structuredClone(d.datos) : undefined) };
          },
          set(ref, datos, op) {
            yaEscribio = true;
            esc.push({ ruta: ref.ruta, datos, m: Boolean(op?.merge) });
          },
          update(ref, datos) {
            yaEscribio = true;
            esc.push({ ruta: ref.ruta, datos, m: true });
          },
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
  db.rutas = () => [...docs.keys()];
  return db;
}

// ================================================================ montaje

const CUATRO = ["ana", "beto", "caro", "dani"];
const CODIGO = "ABAND1";
const ENTRADA = 100;
const PENALIZACION = 50;
let reloj = 3000000;

async function montar({ saldos = { ana: 500, beto: 500, caro: 500, dani: 500 } } = {}) {
  const inicial = {
    [`rooms/${CODIGO}`]: {
      codigo: CODIGO,
      modo: MODOS.LEYENDAS,
      estado: ESTADOS_SALA.JUGANDO,
      entrada: ENTRADA,
      jugadores: [...CUATRO],
      jugadoresNombres: [...CUATRO],
      pozo: ENTRADA * 4,
    },
  };
  for (const [uid, credits] of Object.entries(saldos)) inicial[`users/${uid}`] = { credits };

  const db = crearFirestore(inicial);
  const moverLeyendas = crearMoverLeyendas({
    db, usuarios: "users", campoSaldo: "credits", marcaDeTiempo: () => "T", error,
  });
  const enRed = crearMotorEnRed({
    db, partidas: "partidas", ahora: () => reloj,
    idAleatorio: () => `v${reloj}`, marcaDeTiempo: () => "T", error, semillaDe: () => 8080,
  });
  const abandonar = crearAbandonarPartida({
    db, salas: "rooms", moverLeyendas, motivo: "penalizacion_abandono",
    marcaDeTiempo: () => "T", error, estados: ESTADOS_SALA,
    partidaEnRed: { leer: enRed.leerPartidaParaAbandono, marcar: enRed.marcarAbandonoEn },
  });

  await enRed.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: CUATRO });
  return { db, enRed, abandonar };
}

const capturar = async (fn) => {
  try { return { valor: await fn() }; } catch (e) { return { error: e }; }
};

const partidaDe = (db) => db.leer(`partidas/${CODIGO}`);
const saldoDe = (db, uid) => db.leer(`users/${uid}`).credits;
const vistaDe = (db, uid) => db.leer(`partidas/${CODIGO}/vistas/${uid}`);

// ==================================================================== 1

console.log("\n=== 1. Cobrar y salir de la mesa son la misma operación ===");
{
  reloj = 3000000;
  const { db, abandonar } = await montar();
  const antes = partidaDe(db).version;

  const r = await capturar(() => abandonar({ uid: "ana", codigo: CODIGO }));
  ok(r.valor && !r.error, "el abandono se procesa", r.error?.message);
  ok(r.valor.penalizacion === PENALIZACION, "penalización de 50", r.valor.penalizacion);
  ok(r.valor.salioDeLaMesa === true, "y salió de la mesa", r.valor.salioDeLaMesa);

  // Lo económico
  ok(saldoDe(db, "ana") === 450, "se le cobraron 50", saldoDe(db, "ana"));
  ok(["beto", "caro", "dani"].every((u) => saldoDe(db, u) === 500),
     "y a nadie más se le tocó el saldo");
  ok(db.leer(`movimientos/abandono_${CODIGO}_ana`).delta === -PENALIZACION,
     "queda el asiento del sumidero");
  ok(db.leer(`rooms/${CODIGO}`).pozo === 400, "el pozo sigue en 400: la penalización NO entra",
     db.leer(`rooms/${CODIGO}`).pozo);

  // Lo de la mesa, en la MISMA transacción
  const p = partidaDe(db);
  ok(p.abandonaron.includes("ana"), "queda marcado como abandonado en la partida");
  ok(p.estado.jugadores[0].eliminado === true, "y eliminado, para que los turnos lo salteen");
  ok(p.estado.jugadores[0].abandono === true, "distinguible de un eliminado por puntos");
  ok(p.jugadores.includes("ana"), "sigue en la lista: su entrada quedó en el pozo");
  ok(p.version > antes, "la partida publicó una versión nueva", [antes, p.version]);
  ok(db.leer(`rooms/${CODIGO}`).abandonaron.includes("ana"), "y también en la sala");
}

// ==================================================================== 2

console.log("\n=== 2. La partida puede continuar sin él ===");
{
  reloj = 3000000;
  const { db, enRed, abandonar } = await montar();
  await enRed.cerrarMirada({ codigo: CODIGO });
  const { ventana } = await enRed.abrirVentana({ codigo: CODIGO });
  reloj = ventana.abiertaEn + 20000;
  await enRed.cerrarVentana({ codigo: CODIGO });

  const enTurno = CUATRO[partidaDe(db).estado.indiceTurno];
  const iTurno = CUATRO.indexOf(enTurno);

  // Abandona justamente el que tenía el turno: el peor momento.
  const r = await capturar(() => abandonar({ uid: enTurno, codigo: CODIGO }));
  ok(r.valor?.salioDeLaMesa === true, `${enTurno} abandona en su propio turno`, r.error?.message);

  const p = partidaDe(db);
  ok(p.estado.indiceTurno !== iTurno, "el turno pasa a otro", [iTurno, p.estado.indiceTurno]);
  ok(!p.estado.jugadores[p.estado.indiceTurno].eliminado,
     "y le toca a alguien que sigue jugando", p.estado.jugadores[p.estado.indiceTurno].nombre);

  // Y el que sigue puede jugar de verdad.
  const siguiente = CUATRO[p.estado.indiceTurno];
  const juega = await capturar(() => enRed.accionDeTurno({
    uid: siguiente, codigo: CODIGO, accion: "levantar", clientActionId: "sigue",
  }));
  ok(juega.valor?.fase === "levantada", "la partida sigue en marcha", juega.error?.message);
}

// ==================================================================== 3

console.log("\n=== 3. El que abandonó no puede hacer nada más ===");
{
  reloj = 3000000;
  const { db, enRed, abandonar } = await montar();
  await abandonar({ uid: "ana", codigo: CODIGO });

  for (const accion of ["mirar", "levantar", "cambiar", "tirar", "cortar", "pasar"]) {
    const r = await capturar(() => enRed.accionDeTurno({
      uid: "ana", codigo: CODIGO, accion, clientActionId: `x-${accion}`, posicion: 0,
    }));
    ok(/Abandonaste/.test(r.error?.message ?? ""), `no puede ${accion}`, r.error?.message);
  }

  // Ni descartar en una ventana.
  await enRed.cerrarMirada({ codigo: CODIGO });
  const { ventana } = await enRed.abrirVentana({ codigo: CODIGO });
  reloj = ventana.abiertaEn + 300;
  const descarte = await capturar(() => enRed.intentarDescarte({
    uid: "ana", codigo: CODIGO, windowId: ventana.id, posicion: 0,
    clientActionId: "d", declarado: 200, latencia: 30, incertidumbre: 15,
  }));
  ok(/Abandonaste/.test(descarte.error?.message ?? ""), "ni descartar", descarte.error?.message);
}

// ==================================================================== 4

console.log("\n=== 4. No puede volver a abandonar ===");
{
  reloj = 3000000;
  const { db, abandonar } = await montar();
  await abandonar({ uid: "ana", codigo: CODIGO });
  const saldoTrasUno = saldoDe(db, "ana");

  for (let i = 0; i < 3; i++) {
    const r = await capturar(() => abandonar({ uid: "ana", codigo: CODIGO }));
    ok(r.error?.codigo === "already-exists", `intento ${i + 2} rechazado`, r.error?.codigo);
  }
  ok(saldoDe(db, "ana") === saldoTrasUno, "y no se le cobró de nuevo", saldoDe(db, "ana"));
  ok(partidaDe(db).abandonaron.filter((u) => u === "ana").length === 1,
     "queda anotado una sola vez", partidaDe(db).abandonaron);
}

// ==================================================================== 5

console.log("\n=== 5. Dos abandonos simultáneos ===");
{
  reloj = 3000000;
  const { db, abandonar } = await montar();

  let soltar;
  const barrera = new Promise((r) => (soltar = r));
  let primera = true;
  db.ganchoTrasLeer = async (ruta) => {
    if (ruta === `rooms/${CODIGO}` && primera) { primera = false; await barrera; }
  };

  const a = capturar(() => abandonar({ uid: "ana", codigo: CODIGO }));
  await new Promise((r) => setImmediate(r));
  const b = await capturar(() => abandonar({ uid: "ana", codigo: CODIGO }));
  soltar();
  const resA = await a;

  const exitos = [resA, b].filter((r) => r.valor).length;
  ok(exitos === 1, "una sola prospera", exitos);
  ok([resA, b].filter((r) => r.error?.codigo === "already-exists").length === 1,
     "la otra se rechaza por duplicada");
  ok(saldoDe(db, "ana") === 450, "una sola penalización de 50", saldoDe(db, "ana"));
  ok(partidaDe(db).abandonaron.length === 1, "y un solo abandono en la partida");
  ok(db.intentos > 2, "la perdedora reintentó, no pasó de largo", db.intentos);
}

// ==================================================================== 6

console.log("\n=== 6. Reconectarse no lo revive ===");
{
  reloj = 3000000;
  const { db, enRed, abandonar } = await montar();
  await abandonar({ uid: "ana", codigo: CODIGO });

  // Su navegador vuelve: escucha su vista de nuevo.
  const recibidas = [];
  const dejar = db.escuchar(`partidas/${CODIGO}/vistas/ana`, (s) => { if (s.exists) recibidas.push(s.data()); });
  ok(recibidas.length === 1, "al reconectar recibe su vista");
  ok(recibidas[0].abandonaron.includes("ana"), "que dice que abandonó");
  ok(recibidas[0].jugadores[0].eliminado === true, "y que está fuera");

  // Latir no lo revive.
  reloj += 1000;
  await enRed.latir({ uid: "ana", codigo: CODIGO });
  ok(partidaDe(db).abandonaron.includes("ana"), "latir no borra el abandono");
  ok(partidaDe(db).estado.jugadores[0].eliminado === true, "ni lo devuelve a la mesa");

  // Una ronda nueva tampoco.
  reloj = 3000000;
  const p = partidaDe(db);
  await db.runTransaction(async (tx) => {
    tx.set({ ruta: `partidas/${CODIGO}` }, {
      ...p, estado: { ...p.estado, fase: "finRonda" }, version: p.version + 1,
    });
  });
  reloj += 60000;
  // El estado se forzó sin pasar por `publicar`, así que el plazo quedó
  // desfasado. El primer golpe lo recalcula y el segundo reparte: esa
  // recuperación es justamente lo que evita que una partida quede colgada.
  const arregla = await enRed.avanzarPartida({ codigo: CODIGO });
  ok(arregla.hizo === "recalcularPlazo", "un plazo desfasado se recalcula solo", arregla);
  // El plazo nuevo arranca a contar desde ahora, así que hay que dejarlo vencer.
  reloj += 60000;
  const reparte = await enRed.avanzarPartida({ codigo: CODIGO });
  ok(reparte.hizo === "siguienteRonda", "y el golpe siguiente ya reparte", reparte.hizo);
  const trasRonda = partidaDe(db);
  ok(trasRonda.estado.ronda === p.estado.ronda + 1, "se reparte otra ronda", trasRonda.estado.ronda);
  ok(trasRonda.estado.jugadores[0].eliminado === true, "y el que abandonó sigue fuera");
  ok(trasRonda.estado.jugadores[0].mano.length === 0, "sin recibir cartas", trasRonda.estado.jugadores[0].mano.length);
  ok(trasRonda.abandonaron.includes("ana"), "y sigue marcado");
  dejar();
}

// ==================================================================== 7

console.log("\n=== 7. Si falla el cobro, tampoco sale de la mesa ===");
{
  reloj = 3000000;
  // Saldo insuficiente: no alcanza para la penalización.
  const { db, abandonar } = await montar({ saldos: { ana: 10, beto: 500, caro: 500, dani: 500 } });
  const antes = JSON.parse(JSON.stringify(partidaDe(db)));

  const r = await capturar(() => abandonar({ uid: "ana", codigo: CODIGO }));
  ok(/insuficiente/i.test(r.error?.message ?? ""), "se rechaza por saldo", r.error?.message);
  ok(saldoDe(db, "ana") === 10, "no se le cobró nada", saldoDe(db, "ana"));
  ok(JSON.stringify(partidaDe(db)) === JSON.stringify(antes),
     "y la partida quedó EXACTAMENTE igual: ni cobrado ni sacado");
  ok(!partidaDe(db).abandonaron?.includes("ana"), "no figura como abandonado");
  ok(partidaDe(db).estado.jugadores[0].eliminado === false, "y sigue sentado a la mesa");
}

// ==================================================================== 8

console.log("\n=== 8. La regla de Firestore: leer antes de escribir ===");
{
  // Esta prueba comprueba la PRUEBA: que el doble Firestore detecte el orden
  // equivocado. Si no lo detectara, el resto de esta suite no valdría nada.
  const db = crearFirestore({ "x/1": { a: 1 } });
  const mal = await capturar(() => db.runTransaction(async (tx) => {
    tx.set({ ruta: "x/1" }, { a: 2 });
    await tx.get({ ruta: "x/2" });
  }));
  ok(/después de una escritura/.test(mal.error?.message ?? ""),
     "el doble rechaza leer después de escribir", mal.error?.message);

  const bien = await capturar(() => db.runTransaction(async (tx) => {
    await tx.get({ ruta: "x/2" });
    tx.set({ ruta: "x/1" }, { a: 2 });
    return "ok";
  }));
  ok(bien.valor === "ok", "y acepta el orden correcto");

  // Y el abandono real pasa por ahí sin quejarse: la partida se lee ANTES
  // de que moverLeyendas escriba.
  reloj = 3000000;
  const m = await montar();
  const r = await capturar(() => m.abandonar({ uid: "beto", codigo: CODIGO }));
  ok(r.valor && !r.error, "el abandono respeta el orden lectura/escritura", r.error?.message);
}

// ==================================================================== 9

console.log("\n=== 9. Cuatro abandonos: la partida queda sin nadie ===");
{
  reloj = 3000000;
  const { db, abandonar } = await montar();
  for (const uid of CUATRO) {
    const r = await capturar(() => abandonar({ uid, codigo: CODIGO }));
    ok(r.valor?.salioDeLaMesa === true, `${uid} abandona`, r.error?.message);
  }
  const p = partidaDe(db);
  ok(p.abandonaron.length === 4, "los cuatro anotados", p.abandonaron.length);
  ok(p.estado.jugadores.every((j) => j.eliminado), "los cuatro fuera de la mesa");
  ok(CUATRO.every((u) => saldoDe(db, u) === 450), "cada uno pagó su penalización, una vez",
     CUATRO.map((u) => saldoDe(db, u)));
  ok(db.leer(`rooms/${CODIGO}`).pozo === 400, "y el pozo sigue intacto en 400",
     db.leer(`rooms/${CODIGO}`).pozo);
  ok(db.leer(`rooms/${CODIGO}`).estado === ESTADOS_SALA.JUGANDO,
     "la sala sigue en 'jugando': cerrarla es trabajo de la finalización, que todavía no existe");
}

// ==================================================================== 10

console.log("\n=== 10. Sin filtraciones ni basura ===");
{
  reloj = 3000000;
  const { db, abandonar } = await montar();
  await abandonar({ uid: "ana", codigo: CODIGO });

  const m = partidaDe(db);
  let fugas = 0;
  for (const uid of CUATRO) {
    const texto = JSON.stringify(vistaDe(db, uid));
    for (const c of m.estado.mazo) if (texto.includes(`"${c.id}"`)) fugas++;
    for (const j of m.estado.jugadores) for (const c of j.mano) if (c && texto.includes(`"${c.id}"`)) fugas++;
  }
  ok(fugas === 0, "abandonar no destapa ninguna carta", fugas);

  const malos = [];
  (function buscar(x, ruta) {
    if (typeof x === "function") return malos.push(`${ruta} función`);
    if (x instanceof Map || x instanceof Set || x instanceof Date) return malos.push(`${ruta} ${x.constructor.name}`);
    if (x && typeof x === "object") for (const [k, y] of Object.entries(x)) buscar(y, `${ruta}.${k}`);
  })(m, "partida");
  ok(malos.length === 0, "el maestro sigue siendo JSON puro", malos);

  ok(new Set(CUATRO.map((u) => vistaDe(db, u).version)).size === 1,
     "los cuatro en la misma versión", CUATRO.map((u) => vistaDe(db, u).version));
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
