/**
 * Desempate por encima de 150, por el motor en red.
 *
 * El caso raro pero real: los cuatro se pasan del límite en la MISMA ronda y
 * dos empatan en el puntaje más bajo. No hay un último jugador por debajo del
 * límite, así que no hay ganador, y hay que jugar una ronda extra entre los
 * empatados.
 *
 * Este mismo caso colgaba la partida hasta el commit 64c8126: los empatados
 * seguían marcados como eliminados, la ronda de desempate no repartía a nadie
 * y la partida no terminaba nunca. Acá se comprueba de punta a punta y con el
 * orquestador de por medio, que es lo que faltaba.
 */

import { crearMotorEnRed, MS_MIRAR, MS_ENTRE_RONDAS } from "../functions/partida-red.js";
import { MS_VENTANA, MS_GRACIA } from "../public/js/reglas/red.js";
import { MS_REVELACION } from "../public/js/reglas/vista.js";
import { LIMITE_ELIMINACION } from "../public/js/reglas/puntaje.js";

/** Cuándo vence una ventana. Su duración ya no es fija: abre con la
 *  mirada, así que hay que preguntársela a ella y no a la constante. */
const vence = (v) => v.abiertaEn + v.duracionMs + v.graciaMs;

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
    for (const fn of oyentes.get(r) ?? []) fn({ exists: docs.has(r), data: () => structuredClone(docs.get(r)?.datos) });
  };
  const db = {
    collection: (n) => ({ doc: (id = `a${Math.random()}`) => ({ ruta: `${n}/${id}` }) }),
    async runTransaction(cuerpo) {
      for (let i = 0; i < 10; i++) {
        const leidas = new Map(); const esc = [];
        const tx = {
          async get(ref) {
            const d = docs.get(ref.ruta);
            leidas.set(ref.ruta, d ? d.version : 0);
            return { exists: Boolean(d), data: () => (d ? structuredClone(d.datos) : undefined) };
          },
          set(ref, datos, op) { esc.push({ ruta: ref.ruta, datos, m: Boolean(op?.merge) }); },
          update(ref, datos) { esc.push({ ruta: ref.ruta, datos, m: true }); },
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

const CUATRO = ["ana", "beto", "caro", "dani"];
const CODIGO = "DESEMP";
let reloj = 2000000;

const db = crearFirestore();
const red = crearMotorEnRed({
  db, partidas: "partidas",
  ahora: () => reloj,
  idAleatorio: () => `v${reloj}_${Math.random().toString(36).slice(2, 6)}`,
  marcaDeTiempo: () => "T", error, semillaDe: () => 31415,
});

const capturar = async (fn) => {
  try { return { valor: await fn() }; } catch (e) { return { error: e }; }
};

const maestro = () => db.leer(`partidas/${CODIGO}`);
const vistaDe = (uid) => db.leer(`partidas/${CODIGO}/vistas/${uid}`);
const puntos = () => maestro().estado.jugadores.map((j) => j.puntos);
const vivos = () => maestro().estado.jugadores.filter((j) => !j.eliminado).map((j) => j.nombre);

/**
 * Escribe el estado directamente, para armar el escenario.
 *
 * Saca del mazo cualquier carta que el escenario ponga en una mano. Sin eso,
 * la misma carta estaría en dos lugares y el detector de filtraciones —con
 * razón— se negaría a publicar la vista. Le pasó a este archivo en el primer
 * intento, y está bien que le pase: es exactamente para lo que está.
 */
const forzar = (cambios) => db.runTransaction(async (tx) => {
  const p = maestro();
  const estado = { ...p.estado, ...cambios };
  const repartidas = new Set(
    estado.jugadores.flatMap((j) => j.mano).filter(Boolean).map((c) => c.id),
  );
  tx.set({ ruta: `partidas/${CODIGO}` }, {
    ...p,
    estado: { ...estado, mazo: estado.mazo.filter((c) => !repartidas.has(c.id)) },
    version: p.version + 1,
  });
});

/** Lleva la partida hasta el final de la ronda, cortando el que tiene el turno. */
async function cortarConElDelTurno(sufijo) {
  const enTurno = CUATRO[maestro().estado.indiceTurno];
  await forzar({ fase: "postLevantada" });
  const r = await capturar(() => red.accionDeTurno({
    uid: enTurno, codigo: CODIGO, accion: "cortar", clientActionId: `corte-${sufijo}`,
  }));
  return { enTurno, r };
}

// ==================================================================== 1

console.log("\n=== 1. Los cuatro se pasan de 150 en la misma ronda ===");

await red.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: CUATRO });
const espectadores = CUATRO.map((u) => {
  const e = { uid: u, vistas: [] };
  e.dejar = db.escuchar(`partidas/${CODIGO}/vistas/${u}`, (s) => {
    if (s.exists) e.vistas.push(s.data());
  });
  return e;
});

// Se arma el escenario: los cuatro cerca del límite, con dos que van a quedar
// empatados abajo. Las manos se fijan para que el corte dé el empate exacto.
const carta = (palo, numero) => ({ id: `${palo}-${numero}`, palo, numero, puntos: numero });
await forzar({
  fase: "postLevantada",
  indiceTurno: 0,
  jugadores: maestro().estado.jugadores.map((j, i) => ({
    ...j,
    puntos: [148, 148, 145, 145][i],
    // Ana corta con 7 en la mano: se le suman, queda en 155.
    // Beto suma 7 → 155. Caro suma 12 → 157. Dani suma 12 → 157.
    mano: [
      [carta("Oro", 7)],
      [carta("Copa", 7)],
      [carta("Basto", 12)],
      [carta("Espada", 12)],
    ][i],
  })),
});

ok(puntos().every((p) => p <= LIMITE_ELIMINACION), "los cuatro arrancan por debajo del límite", puntos());

const corte = await capturar(() => red.accionDeTurno({
  uid: "ana", codigo: CODIGO, accion: "cortar", clientActionId: "corte-1",
}));
ok(corte.valor && !corte.error, "ana corta", corte.error?.message);

const trasCorte = maestro().estado;
ok(trasCorte.jugadores.every((j) => j.puntos > LIMITE_ELIMINACION),
   "los cuatro terminan por encima de 150", trasCorte.jugadores.map((j) => j.puntos));

// ==================================================================== 2

console.log("\n=== 2. Empate en el puntaje más bajo: hay desempate ===");
{
  const p = trasCorte.jugadores.map((j) => j.puntos);
  const menor = Math.min(...p);
  const empatados = p.filter((x) => x === menor).length;
  ok(empatados >= 2, `${empatados} jugadores empatan en el mínimo (${menor})`, p);

  ok(trasCorte.desempate === true, "la partida se marca en desempate", trasCorte.desempate);
  ok(trasCorte.fase === "finRonda", "y la ronda termina sin ganador", trasCorte.fase);
  ok(trasCorte.ganador == null, "no hay ganador todavía", trasCorte.ganador);

  // ACÁ estaba el cuelgue: los empatados tienen que volver a la mesa. Si
  // siguieran eliminados, la ronda extra no repartiría a nadie y la partida
  // no terminaría jamás.
  const devueltos = trasCorte.jugadores.filter((j) => !j.eliminado);
  ok(devueltos.length === empatados,
     "los empatados vuelven a la mesa para la ronda extra", devueltos.map((j) => j.nombre));
  ok(devueltos.every((j) => j.puntos === menor), "y son exactamente los del mínimo",
     devueltos.map((j) => j.puntos));
  ok(trasCorte.jugadores.filter((j) => j.eliminado).length === 4 - empatados,
     "el resto queda eliminado");

  // Los cuatro se enteran, incluidos los eliminados.
  for (const e of espectadores) {
    ok(e.vistas.at(-1).desempate === true, `${e.uid} ve que hay desempate`);
    ok(e.vistas.at(-1).fase === "finRonda", `${e.uid} ve el final de ronda`);
  }
}

// ==================================================================== 3

console.log("\n=== 3. La ronda extra se reparte sola ===");
{
  const antes = maestro().estado;
  ok(maestro().plazo?.que === "siguienteRonda", "hay plazo para la ronda extra", maestro().plazo?.que);

  const temprano = await red.avanzarPartida({ codigo: CODIGO });
  ok(temprano.hizo === null, "no se reparte antes de tiempo", temprano.motivo);

  reloj += MS_ENTRE_RONDAS;
  const golpes = await Promise.all(CUATRO.map(() => capturar(() => red.avanzarPartida({ codigo: CODIGO }))));
  const repartieron = golpes.filter((g) => g.valor?.hizo === "siguienteRonda");
  ok(repartieron.length === 1, "cuatro golpes reparten UNA ronda extra", repartieron.length);

  const extra = maestro().estado;
  ok(extra.fase === "mirar", "la ronda extra arranca en la mirada", extra.fase);
  ok(extra.ronda === antes.ronda + 1, "y es la ronda siguiente", [antes.ronda, extra.ronda]);
  ok(extra.semilla !== antes.semilla, "con la semilla avanzada");

  // Sólo los empatados reciben cartas. Los eliminados miran.
  const conCartas = extra.jugadores.filter((j) => j.mano.length > 0);
  ok(conCartas.length === vivos().length, "sólo los empatados reciben cartas",
     conCartas.map((j) => j.nombre));
  ok(extra.jugadores.filter((j) => j.eliminado).every((j) => j.mano.length === 0),
     "los eliminados no reciben ninguna");
  ok(conCartas.every((j) => j.mano.length === 4), "y los que juegan reciben cuatro");

  // El turno le toca a alguien que sigue en juego.
  ok(!extra.jugadores[extra.indiceTurno].eliminado,
     "el turno es de alguien que sigue jugando", extra.jugadores[extra.indiceTurno].nombre);

  // Un eliminado no puede jugar la ronda extra.
  const fuera = extra.jugadores.find((j) => j.eliminado);
  const intento = await capturar(() => red.accionDeTurno({
    uid: fuera.id, codigo: CODIGO, accion: "mirar", clientActionId: "elim", posicion: 0,
  }));
  ok(/eliminado/i.test(intento.error?.message ?? ""), "un eliminado no puede jugar", intento.error?.message);

  // Y las manos siguen tapadas para todos.
  for (const e of espectadores) {
    const destapadas = e.vistas.at(-1).jugadores.flatMap((j) => j.mano).filter((c) => c && !c.oculta);
    ok(destapadas.length === 0, `${e.uid} ve todo tapado de nuevo`, destapadas.length);
  }
}

// ==================================================================== 4

console.log("\n=== 4. La ronda extra se juega y resuelve ===");
{
  // Se deja correr el orquestador: mirada, ventana, cierre.
  reloj += MS_MIRAR;
  await red.avanzarPartida({ codigo: CODIGO });
  ok(maestro().estado.fase === "descarte", "se cierra la mirada", maestro().estado.fase);

  await red.avanzarPartida({ codigo: CODIGO });
  const v = maestro().ventana;
  ok(v && !v.cerrada, "se abre la ventana de reflejos");

  reloj = vence(v) + 1;
  await red.avanzarPartida({ codigo: CODIGO });
  ok(maestro().estado.fase === "descarte",
     "se cierra sola y la mesa ve lo expuesto", maestro().estado.fase);

  reloj += MS_REVELACION;
  await red.avanzarPartida({ codigo: CODIGO });
  ok(maestro().estado.fase === "turno", "y pasados los 2 s empieza el turno", maestro().estado.fase);

  // Se fuerza un resultado distinto para romper el empate.
  const empatados = maestro().estado.jugadores.filter((j) => !j.eliminado);
  ok(empatados.length >= 2, "siguen los dos en juego", empatados.map((j) => j.nombre));

  const menorAntes = Math.min(...empatados.map((j) => j.puntos));
  await forzar({
    jugadores: maestro().estado.jugadores.map((j) =>
      j.eliminado ? j : { ...j, mano: [carta("Oro", j.id === empatados[0].id ? 1 : 11)] },
    ),
  });

  const { enTurno, r } = await cortarConElDelTurno("extra");
  ok(r.valor && !r.error, `${enTurno} corta la ronda extra`, r.error?.message);
}

// ==================================================================== 5

console.log("\n=== 5. La partida termina ===");
{
  const fin = maestro().estado;
  ok(fin.fase === "finPartida", "la partida termina", fin.fase);
  ok(fin.ganador != null, "con un ganador", fin.ganador?.nombre);
  ok(fin.desempate === false, "y sin desempate pendiente", fin.desempate);
  // Ya no queda "sin plazo": una partida terminada pide su cierre, que es
  // justamente el agujero que se cerró. Este montaje no tiene el cierre
  // inyectado, así que se comprueba el plazo, no el reparto.
  ok(maestro().plazo?.que === "cerrarPartida",
     "y pide su cierre, en vez de quedarse viva para siempre", maestro().plazo);

  // El ganador es el del puntaje más bajo entre los que jugaron el desempate.
  const jugaronElExtra = fin.jugadores.filter((j) => j.eliminadoEnRonda === fin.ronda || j.id === fin.ganador.id);
  const minimo = Math.min(...jugaronElExtra.map((j) => j.puntos));
  ok(fin.jugadores.find((j) => j.id === fin.ganador.id).puntos === minimo,
     "y es el del puntaje más bajo", { ganador: fin.ganador.nombre, minimo });

  // Golpear no reparte otra ronda.
  reloj += MS_ENTRE_RONDAS * 3;
  const golpes = await Promise.all(CUATRO.map(() => capturar(() => red.avanzarPartida({ codigo: CODIGO }))));
  ok(golpes.every((g) => g.valor?.hizo === null), "golpear no reparte otra ronda",
     golpes.map((g) => g.valor?.hizo));
  ok(maestro().estado.ronda === fin.ronda, "la ronda no avanzó", maestro().estado.ronda);

  // Y nadie puede seguir jugando.
  for (const uid of CUATRO) {
    const r = await capturar(() => red.accionDeTurno({
      uid, codigo: CODIGO, accion: "levantar", clientActionId: `post-${uid}`,
    }));
    ok(Boolean(r.error), `${uid} no puede seguir jugando`, r.error?.message);
  }

  // Los cuatro ven el final, incluidos los que se fueron antes.
  for (const e of espectadores) {
    ok(e.vistas.at(-1).fase === "finPartida", `${e.uid} ve el final de la partida`);
    ok(e.vistas.at(-1).jugadores.flatMap((j) => j.mano).some((c) => c && !c.oculta) ||
       e.vistas.at(-1).jugadores.every((j) => j.mano.length === 0),
       `${e.uid} ve las manos reveladas`);
  }

  // Orden final coherente.
  const posiciones = fin.jugadores.map((j) => ({ n: j.nombre, p: j.puntos, fuera: j.eliminadoEnRonda }));
  console.log("\n  puntajes finales:", JSON.stringify(posiciones));
}

// ==================================================================== 6

console.log("\n=== 6. Nada se rompió por el camino ===");
{
  const m = maestro();
  const malos = [];
  (function buscar(x, ruta) {
    if (typeof x === "function") return malos.push(`${ruta} función`);
    if (x instanceof Map || x instanceof Set || x instanceof Date) return malos.push(`${ruta} ${x.constructor.name}`);
    if (x && typeof x === "object") for (const [k, y] of Object.entries(x)) buscar(y, `${ruta}.${k}`);
  })(m, "partida");
  ok(malos.length === 0, "el maestro sigue siendo JSON puro", malos);
  ok(typeof m.estado.semilla === "number", "la semilla sigue siendo un número");

  const versiones = CUATRO.map((u) => vistaDe(u).version);
  ok(new Set(versiones).size === 1, "los cuatro en la misma versión", versiones);
  ok(db.rutas().length === 5, "cinco documentos y nada más", db.rutas().length);

  // Nada económico se tocó.
  ok(!db.rutas().some((r) => r.startsWith("users/") || r.startsWith("movimientos/")),
     "ninguna Leyenda se movió", db.rutas());

  espectadores.forEach((e) => e.dejar());
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
