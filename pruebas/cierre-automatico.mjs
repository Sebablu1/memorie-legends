/**
 * El cierre automático: de `finPartida` al reparto del pozo, sin que nadie lo
 * pida.
 *
 * Este era el hueco real. `cerrarPartida` estaba desplegada, era correcta y
 * NADIE la llamaba: ni el cliente, ni otra Function, ni un cron. Una partida
 * que terminaba se quedaba viva para siempre —sala en "jugando", entradas
 * cobradas, pozo retenido— porque `finPartida` era la única fase sin plazo y
 * caía en el `default: return null` de `plazoDe`.
 *
 * Lo que se prueba acá es que ese camino existe y es seguro:
 *
 *   finPartida → plazo corto → avanzarPartida → 75/25 → sala terminada
 *
 * Todo dentro de UNA transacción, sin llamar a la callable y sin anidar.
 */

import { crearMoverLeyendas } from "../functions/leyendas.js";
import { crearCierre } from "../functions/cierre.js";
import { crearMotorEnRed, MS_ANTES_DE_CERRAR } from "../functions/partida-red.js";
import { crearAbandonarPartida } from "../functions/abandono.js";
import { crearSalirDeSalaEnEspera } from "../functions/salida.js";
import { ESTADOS_SALA, MODOS } from "../public/js/reglas/salas.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

class E extends Error { constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; } }
const error = (codigo, mensaje) => new E(codigo, mensaje);

// ============ Firestore con las dos reglas reales: orden y concurrencia

function crearFirestore(inicial = {}) {
  const docs = new Map();
  const oyentes = new Map();
  let version = 0;
  for (const [ruta, datos] of Object.entries(inicial)) {
    docs.set(ruta, { datos: structuredClone(datos), version: ++version });
  }
  const avisar = (r) => {
    for (const fn of oyentes.get(r) ?? []) {
      fn({ exists: docs.has(r), data: () => structuredClone(docs.get(r)?.datos) });
    }
  };
  const db = {
    intentos: 0,
    reintentos: 0,
    ganchoTrasLeer: null,
    collection: (n) => ({ doc: (id = `a${Math.random()}`) => ({ ruta: `${n}/${id}` }) }),
    async runTransaction(cuerpo) {
      for (let i = 0; i < 12; i++) {
        db.intentos++;
        if (i > 0) db.reintentos++;
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
const NOMBRE = { ana: "Ana", beto: "Beto", caro: "Caro", dani: "Dani" };
const CODIGO = "AUTO01";
const ENTRADA = 100;
const POZO = ENTRADA * 4;
const SALDO = 1000;
let reloj = 7000000;

/** El sistema entero: motor en red con el cierre inyectado, como en index.js. */
function montar({ estado = ESTADOS_SALA.JUGANDO, abandonaron = [] } = {}) {
  const inicial = {
    [`rooms/${CODIGO}`]: {
      codigo: CODIGO, modo: MODOS.LEYENDAS, estado, entrada: ENTRADA,
      creador: "ana", jugadores: [...CUATRO], jugadoresNombres: CUATRO.map((u) => NOMBRE[u]),
      listos: [...CUATRO], pozo: POZO, abandonaron: [...abandonaron],
    },
  };
  for (const uid of CUATRO) inicial[`users/${uid}`] = { credits: SALDO };

  const db = crearFirestore(inicial);
  const moverLeyendas = crearMoverLeyendas({
    db, usuarios: "users", campoSaldo: "credits", marcaDeTiempo: () => "T", error,
  });
  const cierre = crearCierre({
    db, salas: "rooms", partidas: "partidas", moverLeyendas,
    motivo: "premio_partida", marcaDeTiempo: () => "T", error, estados: ESTADOS_SALA,
  });
  const enRed = crearMotorEnRed({
    db, partidas: "partidas", ahora: () => reloj, idAleatorio: () => `v${reloj}`,
    marcaDeTiempo: () => "T", error, semillaDe: () => 999,
    // Exactamente como en index.js.
    cierre: { leer: cierre.leer, planificar: cierre.planificar, aplicar: cierre.aplicar },
  });
  const abandonar = crearAbandonarPartida({
    db, salas: "rooms", moverLeyendas, motivo: "penalizacion_abandono",
    marcaDeTiempo: () => "T", error, estados: ESTADOS_SALA,
    partidaEnRed: { leer: enRed.leerPartidaParaAbandono, marcar: enRed.marcarAbandonoEn },
  });
  const salir = crearSalirDeSalaEnEspera({
    db, salas: "rooms", moverLeyendas, motivo: "apuesta",
    marcaDeTiempo: () => "T", error, estados: ESTADOS_SALA,
  });
  return { db, enRed, cierre, abandonar, salir };
}

const capturar = async (fn) => {
  try { return { valor: await fn() }; } catch (e) { return { error: e }; }
};
const partida = (db) => db.leer(`partidas/${CODIGO}`);
const sala = (db) => db.leer(`rooms/${CODIGO}`);
const saldo = (db, u) => db.leer(`users/${u}`).credits;
const ganado = (db, u) => saldo(db, u) - SALDO;
const asientos = (db) => db.rutas().filter((r) => r.startsWith("movimientos/"));

/** Lleva una partida repartida hasta finPartida, con `ganador` primero. */
async function llevarAlFinal(db, enRed, ganador = "ana") {
  const p = partida(db);
  const orden = [ganador, ...CUATRO.filter((u) => u !== ganador)];
  await db.runTransaction(async (tx) => {
    tx.set({ ruta: `partidas/${CODIGO}` }, {
      ...p,
      estado: {
        ...p.estado,
        fase: "finPartida",
        mazo: [],
        ganador: { id: ganador, nombre: NOMBRE[ganador] },
        jugadores: p.estado.jugadores.map((j) => {
          const puesto = orden.indexOf(j.id);
          return {
            ...j, mano: [], puntos: 100 + puesto * 10,
            eliminado: puesto !== 0,
            eliminadoEnRonda: puesto === 0 ? null : 4 - puesto,
          };
        }),
      },
      version: p.version + 1,
    });
  });
  // Se publica una vez por el camino normal para que el plazo se recalcule.
  await enRed.avanzarPartida({ codigo: CODIGO });
}

// ==================================================================== 1

console.log("\n=== 1. finPartida sin vencer: todavía no cierra ===");
{
  reloj = 7000000;
  const { db, enRed } = montar();
  await enRed.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: CUATRO.map((u) => NOMBRE[u]) });
  await llevarAlFinal(db, enRed);

  const p = partida(db);
  ok(p.estado.fase === "finPartida", "la partida está terminada", p.estado.fase);
  ok(p.plazo?.que === "cerrarPartida", "y pide su cierre", p.plazo);
  ok(p.plazo.hasta === reloj + MS_ANTES_DE_CERRAR, "con un plazo corto",
     p.plazo.hasta - reloj);

  const temprano = await enRed.avanzarPartida({ codigo: CODIGO });
  ok(temprano.hizo === null && temprano.motivo === "todavia_no",
     "golpear antes de tiempo no cierra", temprano);
  ok(sala(db).estado === ESTADOS_SALA.JUGANDO, "la sala sigue abierta", sala(db).estado);
  ok(CUATRO.every((u) => ganado(db, u) === 0), "y nadie cobró nada");

  // Cien golpes tempranos tampoco.
  for (let i = 0; i < 100; i++) await enRed.avanzarPartida({ codigo: CODIGO });
  ok(asientos(db).length === 0, "cien golpes tempranos: cero pagos", asientos(db).length);
}

// ==================================================================== 2

console.log("\n=== 2. finPartida vencido: cierra solo ===");
{
  reloj = 7000000;
  const { db, enRed } = montar();
  await enRed.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: CUATRO.map((u) => NOMBRE[u]) });
  await llevarAlFinal(db, enRed, "ana");

  reloj += MS_ANTES_DE_CERRAR + 1;
  const r = await capturar(() => enRed.avanzarPartida({ codigo: CODIGO }));

  ok(r.valor?.hizo === "cerrarPartida", "el orquestador cierra la partida", r.error?.message ?? r.valor);
  ok(r.valor.yaEstaba === false, "y es el primero en hacerlo");
  ok(r.valor.pozo === POZO, "reparte el pozo entero", r.valor.pozo);
  ok(ganado(db, "ana") === 300, "el ganador cobra 300 (75 %)", ganado(db, "ana"));
  ok(ganado(db, "beto") === 100, "el segundo cobra 100 (25 %)", ganado(db, "beto"));
  ok(ganado(db, "caro") === 0 && ganado(db, "dani") === 0, "tercero y cuarto, nada");
  ok(r.valor.sobrante === 0, "sin sobrante", r.valor.sobrante);

  ok(sala(db).estado === ESTADOS_SALA.TERMINADA, "la sala queda TERMINADA", sala(db).estado);
  ok(sala(db).cierre?.pozo === POZO, "con su registro de cierre");
  ok(sala(db).cierre.cerradaPor === "servidor",
     "y consta que lo disparó el servidor, no un jugador", sala(db).cierre.cerradaPor);
  ok(partida(db).cerrada === true, "la partida queda marcada como cerrada");
  ok(asientos(db).length === 2, "dos asientos, uno por premio", asientos(db));

  // Y ya no pide nada más: el plazo se apaga.
  ok(partida(db).plazo === null, "el plazo se apaga: no queda nada que hacer", partida(db).plazo);
  ok(CUATRO.every((u) => db.leer(`partidas/${CODIGO}/vistas/${u}`)),
     "las cuatro vistas se publicaron con el resultado");
}

// ==================================================================== 3

console.log("\n=== 3. avanzarPartida dos veces: un solo cierre ===");
{
  reloj = 7000000;
  const { db, enRed } = montar();
  await enRed.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: CUATRO.map((u) => NOMBRE[u]) });
  await llevarAlFinal(db, enRed);
  reloj += MS_ANTES_DE_CERRAR + 1;

  const uno = await enRed.avanzarPartida({ codigo: CODIGO });
  const saldos = CUATRO.map((u) => saldo(db, u));

  for (let i = 0; i < 5; i++) {
    const otra = await capturar(() => enRed.avanzarPartida({ codigo: CODIGO }));
    ok(otra.valor?.hizo === null || otra.valor?.yaEstaba === true,
       `golpe extra ${i + 1}: no vuelve a pagar`, otra.valor);
  }
  ok(CUATRO.every((u, i) => saldo(db, u) === saldos[i]), "ningún saldo cambió",
     CUATRO.map((u) => ganado(db, u)));
  ok(asientos(db).length === 2, "siguen siendo dos asientos", asientos(db).length);
  ok(uno.hizo === "cerrarPartida", "y el que cerró fue el primero");
}

// ==================================================================== 4

console.log("\n=== 4. Los cuatro golpean a la vez ===");
{
  reloj = 7000000;
  const { db, enRed } = montar();
  await enRed.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: CUATRO.map((u) => NOMBRE[u]) });
  await llevarAlFinal(db, enRed);
  reloj += MS_ANTES_DE_CERRAR + 1;
  const intentosAntes = db.intentos;

  const golpes = await Promise.all(
    CUATRO.map(() => capturar(() => enRed.avanzarPartida({ codigo: CODIGO }))),
  );

  const pagaron = golpes.filter((g) => g.valor?.hizo === "cerrarPartida" && !g.valor.yaEstaba);
  ok(pagaron.length === 1, "UNA sola ejecución paga", pagaron.length);
  ok(golpes.every((g) => g.valor && !g.error), "ninguna revienta",
     golpes.map((g) => g.error?.message).filter(Boolean));

  ok(ganado(db, "ana") === 300 && ganado(db, "beto") === 100,
     "el reparto es exacto, una sola vez", [ganado(db, "ana"), ganado(db, "beto")]);
  ok(asientos(db).length === 2, "dos asientos, no ocho", asientos(db).length);
  ok(sala(db).estado === ESTADOS_SALA.TERMINADA, "la sala queda terminada");
  ok(db.intentos > intentosAntes + 4,
     "hubo contención y reintentos, y el diseño los toleró",
     { intentos: db.intentos - intentosAntes, reintentos: db.reintentos });
}

// ==================================================================== 5

console.log("\n=== 5. Con abandono: el que se fue no cobra ===");
{
  reloj = 7000000;
  const { db, enRed, abandonar } = montar();
  await enRed.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: CUATRO.map((u) => NOMBRE[u]) });

  // Caro abandona de verdad, por el camino normal.
  const ab = await capturar(() => abandonar({ uid: "caro", codigo: CODIGO }));
  ok(ab.valor?.salioDeLaMesa === true, "caro abandona", ab.error?.message);
  ok(ganado(db, "caro") === -50, "y paga su penalización de 50", ganado(db, "caro"));
  ok(sala(db).pozo === POZO, "el pozo sigue en 400", sala(db).pozo);

  // Caro habría sido el ganador por puntaje. No debe cobrar.
  await llevarAlFinal(db, enRed, "caro");
  reloj += MS_ANTES_DE_CERRAR + 1;
  const r = await capturar(() => enRed.avanzarPartida({ codigo: CODIGO }));

  ok(r.valor?.hizo === "cerrarPartida", "la partida se cierra igual", r.error?.message);
  ok(ganado(db, "caro") === -50, "el que abandonó NO cobra premio", ganado(db, "caro"));
  const cobraron = CUATRO.filter((u) => ganado(db, u) > 0);
  ok(cobraron.length === 2, "cobran los dos mejores de los que se quedaron", cobraron);
  ok(!cobraron.includes("caro"), "y caro no está entre ellos");
  ok(r.valor.repartido + r.valor.sobrante === POZO, "el pozo cierra exacto",
     [r.valor.repartido, r.valor.sobrante]);
}

// ==================================================================== 6

console.log("\n=== 6. El abandono sigue funcionando igual ===");
{
  reloj = 7000000;
  const { db, enRed, abandonar } = montar();
  await enRed.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: CUATRO.map((u) => NOMBRE[u]) });

  const r = await capturar(() => abandonar({ uid: "ana", codigo: CODIGO }));
  ok(r.valor?.penalizacion === 50, "penalización de 50", r.error?.message);
  ok(r.valor.salioDeLaMesa === true, "sale de la mesa en la misma operación");
  ok(ganado(db, "ana") === -50, "se le cobra una vez", ganado(db, "ana"));
  ok(sala(db).pozo === POZO, "el pozo no cambia");
  ok(partida(db).estado.jugadores[0].eliminado === true, "queda fuera de la mesa");

  const otra = await capturar(() => abandonar({ uid: "ana", codigo: CODIGO }));
  ok(otra.error?.codigo === "already-exists", "no puede abandonar dos veces");
}

console.log("\n=== 7. La salida de sala en espera sigue funcionando igual ===");
{
  reloj = 7000000;
  const { db, salir } = montar({ estado: ESTADOS_SALA.ESPERANDO });
  const r = await capturar(() => salir({ uid: "ana", codigo: CODIGO }));

  ok(r.valor?.cancelada === true, "sale el creador y la sala se cancela", r.error?.message);
  ok(CUATRO.every((u) => ganado(db, u) === ENTRADA),
     "se devuelve la entrada entera a los cuatro", CUATRO.map((u) => ganado(db, u)));
  ok(asientos(db).length === 4, "cuatro asientos de devolución", asientos(db).length);
  ok(sala(db).estado === ESTADOS_SALA.CANCELADA, "sala cancelada");
}

// ==================================================================== 8

console.log("\n=== 8. El motor puro no sabe nada de Leyendas ===");
{
  const { readFileSync } = await import("node:fs");
  const motor = readFileSync(new URL("../public/js/reglas/motor.js", import.meta.url), "utf8");
  const puntaje = readFileSync(new URL("../public/js/reglas/puntaje.js", import.meta.url), "utf8");

  for (const [nombre, texto] of [["motor.js", motor], ["puntaje.js", puntaje]]) {
    const economia = ["moverLeyendas", "credits", "cerrarPartida", "pozo", "premio", "entrada"]
      .filter((t) => new RegExp(`\\b${t}\\b`).test(texto.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "")));
    ok(economia.length === 0, `${nombre} no menciona nada económico`, economia);
  }

  const red = readFileSync(new URL("../functions/partida-red.js", import.meta.url), "utf8");
  // Sin comentarios: el archivo NOMBRA a moverLeyendas al explicar por qué el
  // abandono lee antes de escribir, y eso es documentación, no una llamada.
  const redSinComentarios = red.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
  ok(!/moverLeyendas/.test(redSinComentarios),
     "partida-red.js no mueve saldo: el cierre se le inyecta");
  ok(/cierre = null/.test(red),
     "y el cierre es opcional: sin él el motor sigue funcionando");
}

// ==================================================================== 9

console.log("\n=== 9. Lo que queda escrito ===");
{
  reloj = 7000000;
  const { db, enRed } = montar();
  await enRed.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: CUATRO.map((u) => NOMBRE[u]) });
  await llevarAlFinal(db, enRed);
  reloj += MS_ANTES_DE_CERRAR + 1;
  await enRed.avanzarPartida({ codigo: CODIGO });

  const c = sala(db).cierre;
  ok(c.posiciones.length === 4, "el cierre guarda las cuatro posiciones", c.posiciones.length);
  ok(c.premios.length === 2, "y los dos premios", c.premios.length);
  ok(c.premios.every((p) => p.pagado === true), "los dos marcados como pagados");
  ok(typeof c.sobrante === "number", "y el sobrante, aunque sea cero", c.sobrante);

  const malos = [];
  (function buscar(x, ruta) {
    if (typeof x === "function") return malos.push(`${ruta} función`);
    if (x instanceof Map || x instanceof Set) return malos.push(`${ruta} ${x.constructor.name}`);
    if (x && typeof x === "object") for (const [k, y] of Object.entries(x)) buscar(y, `${ruta}.${k}`);
  })(partida(db), "partida");
  ok(malos.length === 0, "el maestro sigue siendo JSON puro", malos);

  // Y sin filtraciones, aunque la partida esté cerrada.
  ok(db.rutas().filter((r) => r.includes("/vistas/")).length === 4,
     "las cuatro vistas siguen ahí", db.rutas().filter((r) => r.includes("/vistas/")).length);
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
