/**
 * Auditoría de filtraciones: ¿alguna carta tapada llega al cliente?
 *
 * `vista.mjs` comprueba la función que recorta el estado. Esto comprueba otra
 * cosa, y es la que importa en producción: lo que EFECTIVAMENTE queda escrito
 * en los documentos que el cliente puede leer.
 *
 * Se juega una partida entera por el motor en red y, en cada publicación, se
 * busca en el texto completo de cada vista el identificador de cada carta que
 * ese jugador no tiene derecho a conocer: el mazo entero, las manos de todos
 * —incluida la suya— y la carta levantada del que está en turno.
 *
 * Es una búsqueda por texto a propósito. Comprobar campo por campo sólo
 * encontraría las filtraciones que uno ya imaginó; buscar el identificador en
 * el JSON entero encuentra también la que se cuele en un campo nuevo.
 */
import { crearMotorEnRed } from "../functions/partida-red.js";

class E extends Error { constructor(c, m) { super(m); this.codigo = c; } }
const error = (c, m) => new E(c, m);

function db0() {
  const docs = new Map(); let v = 0;
  const db = {
    collection: (n) => ({ doc: (id = `a${Math.random()}`) => ({ ruta: `${n}/${id}` }) }),
    async runTransaction(f) {
      for (let i = 0; i < 8; i++) {
        const leidas = new Map(), esc = [];
        const tx = {
          async get(r) { const d = docs.get(r.ruta); leidas.set(r.ruta, d ? d.version : 0);
            return { exists: Boolean(d), data: () => d && structuredClone(d.datos) }; },
          set(r, d, o) { esc.push({ ruta: r.ruta, datos: d, m: Boolean(o?.merge) }); },
          update(r, d) { esc.push({ ruta: r.ruta, datos: d, m: true }); },
        };
        const res = await f(tx);
        if ([...leidas].some(([r, x]) => (docs.get(r)?.version ?? 0) !== x)) continue;
        for (const e of esc) {
          const p = docs.get(e.ruta);
          docs.set(e.ruta, { datos: e.m ? { ...(p?.datos ?? {}), ...structuredClone(e.datos) } : structuredClone(e.datos), version: ++v });
        }
        return res;
      }
      throw error("aborted", "reintentos");
    },
  };
  db.leer = (r) => docs.get(r)?.datos;
  db.rutas = () => [...docs.keys()];
  return db;
}

const CUATRO = ["ana", "beto", "caro", "dani"];
let reloj = 100000;
const db = db0();
const red = crearMotorEnRed({
  db, partidas: "partidas", ahora: () => reloj,
  idAleatorio: () => `w${reloj}`, marcaDeTiempo: () => "T", error, semillaDe: () => 777,
});

let fugas = 0, revisiones = 0, publicaciones = 0;

/** Revisa todas las vistas contra el estado maestro. */
function auditar(etiqueta) {
  const maestro = db.leer("partidas/ABCDEF");
  if (!maestro) return;
  publicaciones++;
  const rondaTerminada = ["finRonda", "finPartida"].includes(maestro.estado.fase);

  for (const [i, uid] of CUATRO.entries()) {
    const vista = db.leer(`partidas/ABCDEF/vistas/${uid}`);
    if (!vista) continue;
    const texto = JSON.stringify(vista);
    revisiones++;

    // Ninguna carta del mazo puede aparecer NUNCA.
    for (const c of maestro.estado.mazo) {
      if (texto.includes(`"${c.id}"`)) { fugas++; console.log(`  ✗ ${etiqueta}: ${uid} ve ${c.id} del MAZO`); }
    }
    // Ninguna carta en mano ajena ni propia, salvo al terminar la ronda o
    // por una revelación en curso de la ventana de descarte.
    if (!rondaTerminada) {
      const reveladas = new Set(
        (maestro.ventana && !maestro.ventana.cerrada
          ? Object.values(maestro.ventana.intentos ?? {}) : []
        ).map((x) => maestro.estado.jugadores[CUATRO.indexOf(x.uid)]?.mano[x.posicion]?.id).filter(Boolean),
      );
      for (const [j, jug] of maestro.estado.jugadores.entries()) {
        for (const c of jug.mano) {
          if (!c || reveladas.has(c.id)) continue;
          if (texto.includes(`"${c.id}"`)) {
            fugas++;
            console.log(`  ✗ ${etiqueta}: ${uid} ve ${c.id} de la mano de ${CUATRO[j]}${j === i ? " (la suya)" : ""}`);
          }
        }
      }
    }
    // La carta levantada sólo la ve quien juega.
    const lev = maestro.estado.levantada;
    if (lev && maestro.estado.indiceTurno !== i && texto.includes(`"${lev.id}"`)) {
      fugas++; console.log(`  ✗ ${etiqueta}: ${uid} ve la levantada ${lev.id} sin ser su turno`);
    }
  }
}

await red.repartir({ codigo: "ABCDEF", jugadores: CUATRO, nombres: CUATRO });
auditar("reparto");

for (let ronda = 0; ronda < 3; ronda++) {
  for (const [i, uid] of CUATRO.entries()) {
    try { await red.accionDeTurno({ uid, codigo: "ABCDEF", accion: "mirar", clientActionId: `m${ronda}${i}`, posicion: i % 4 }); } catch {}
    auditar(`mirar r${ronda} ${uid}`);
  }
  await red.cerrarMirada({ codigo: "ABCDEF" });
  auditar(`cerrarMirada r${ronda}`);

  const { ventana } = await red.abrirVentana({ codigo: "ABCDEF" });
  auditar(`ventana abierta r${ronda}`);
  reloj += 600;
  for (const [i, uid] of CUATRO.entries()) {
    try {
      await red.intentarDescarte({ uid, codigo: "ABCDEF", windowId: ventana.id, posicion: i % 4,
        clientActionId: `d${ronda}${i}`, declarado: 300 + i * 30, latencia: 40, incertidumbre: 20 });
    } catch {}
    auditar(`descarte r${ronda} ${uid}`);
  }
  reloj += 8000;
  await red.cerrarVentana({ codigo: "ABCDEF" });
  auditar(`ventana cerrada r${ronda}`);

  for (let t = 0; t < 30; t++) {
    const m = db.leer("partidas/ABCDEF");
    const fase = m.estado.fase;
    const uid = CUATRO[m.estado.indiceTurno];
    const id = `t${ronda}_${t}`;
    try {
      if (fase === "turno") await red.accionDeTurno({ uid, codigo: "ABCDEF", accion: "levantar", clientActionId: id });
      else if (fase === "levantada") await red.accionDeTurno({ uid, codigo: "ABCDEF", accion: t % 3 ? "tirar" : "cambiar", clientActionId: id, posicion: t % 4 });
      else if (fase === "poder") await red.accionDeTurno({ uid, codigo: "ABCDEF", accion: "saltarPoder", clientActionId: id });
      else if (fase === "postLevantada") await red.accionDeTurno({ uid, codigo: "ABCDEF", accion: t === 20 ? "cortar" : "pasar", clientActionId: id });
      else break;
    } catch (e) { break; }
    auditar(`${fase} r${ronda} #${t}`);
  }
  const m = db.leer("partidas/ABCDEF");
  if (m.estado.fase !== "finRonda") break;
  auditar(`finRonda r${ronda}`);
  break; // una ronda completa alcanza: cubre todas las fases
}

console.log(`\n  publicaciones auditadas : ${publicaciones}`);
console.log(`  vistas revisadas        : ${revisiones}`);
console.log(`  documentos escritos     : ${db.rutas().length}`);
console.log(`  rutas                   : ${db.rutas().join(", ")}`);
console.log(fugas === 0 ? "\n  ✅ CERO FILTRACIONES\n" : `\n  ❌ ${fugas} FILTRACIONES\n`);
process.exit(fugas ? 1 : 0);
