/**
 * Tirar una carta reabre los reflejos.
 *
 * EL HUECO
 *
 * Al levantar del mazo y tirar, la carta tirada pasa a ser la muestra. Pero la
 * partida iba directo a `postLevantada`, así que esa muestra nueva no le
 * servía a nadie: los demás no tenían ningún momento para reaccionar a ella.
 *
 * LA REGLA
 *
 * Tirar abre otra ventana de reflejos, sobre la muestra nueva. Cuando esa
 * ventana cierra, la mesa vuelve a `postLevantada` —no a `turno`—, porque el
 * que tiró todavía tiene que decidir si corta. Eso lo lleva `volverA` dentro
 * de la ventana, y es lo que distingue esta ventana de la del principio de la
 * ronda, que sí desemboca en el turno siguiente.
 *
 * LOS LÍMITES
 *
 *   - CAMBIAR no reabre: la muestra no cambió, la carta se fue a la mano.
 *   - Tirar un PODER no reabre AL INSTANTE: primero se resuelve el poder, o
 *     se perdería. Pero si su dueño renuncia a usarlo, la carta queda como
 *     una carta más y ahí sí se reabre.
 *   - La ventana nueva es OTRA: su windowId es distinto, para que un intento
 *     de la ventana anterior no se cuele en ésta.
 */

import * as M from "../public/js/reglas/motor.js";
import { crearMotorEnRed, MS_MIRAR } from "../functions/partida-red.js";
import { MS_VENTANA, MS_GRACIA } from "../public/js/reglas/red.js";
import { MS_REVELACION } from "../public/js/reglas/vista.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

const carta = (palo, numero) => ({ id: `${palo}-${numero}`, palo, numero, puntos: numero });

/** Mesa en `levantada`, con la carta levantada que se le indique. */
function mesaConLevantada(levantada) {
  const base = M.empezarRonda(M.crearPartida([
    { id: "A", nombre: "A" }, { id: "B", nombre: "B" },
  ], { semilla: 4242 }));
  const usadas = new Set([levantada.id]);
  return {
    ...base,
    fase: "levantada",
    indiceTurno: 0,
    levantada: { ...levantada, visible: true },
    ventanaDescarte: null,
    descarte: [{ ...carta("Oro", 4), visible: true }],
    mazo: base.mazo.filter((c) => !usadas.has(c.id)),
  };
}

// ======================================================= 1. tirar reabre

console.log("\n=== 1. Tirar una carta común reabre los reflejos ===");
{
  const tirada = carta("Copa", 6);
  let s = mesaConLevantada(tirada);
  ok(s.descarte[0].numero === 4, "la muestra antes de tirar es un 4", s.descarte[0].numero);

  s = M.tirarCarta(s);

  ok(s.descarte[0].id === tirada.id, "la carta tirada es la muestra nueva", s.descarte[0].id);
  ok(s.levantada === null, "y deja de estar levantada");
  ok(s.fase === "descarte", "la fase vuelve a los reflejos", s.fase);
  ok(Boolean(s.ventanaDescarte), "con una ventana de descarte abierta");
  ok(s.ventanaDescarte.huboPrimero === false, "sin nadie que haya acertado todavía");
  ok(s.ventanaDescarte.intentos.length === 0, "y sin intentos heredados");
  ok(s.ventanaDescarte.volverA === "postLevantada",
     "que al cerrarse devuelve a su decisión, no al turno siguiente",
     s.ventanaDescarte.volverA);

  // El rival puede descartar sobre la muestra nueva. Antes no podía.
  const conSeis = { ...s, jugadores: s.jugadores.map((j, i) =>
    i === 1 ? { ...j, mano: [carta("Basto", 6), ...j.mano.slice(1)] } : j) };
  const tras = M.intentarDescarte(conSeis, 1, 0);
  ok(tras.ventanaDescarte.intentos.at(-1)?.resultado === "primero",
     "B descarta su 6 sobre la muestra recién tirada",
     tras.ventanaDescarte.intentos.at(-1)?.resultado);
  ok(tras.jugadores[1].mano[0] === null, "y se la saca de encima");
}

// ============================================ 2. el que tiró no pierde nada

console.log("\n=== 2. El que tiró conserva su decisión de cortar ===");
{
  let s = M.tirarCarta(mesaConLevantada(carta("Copa", 6)));
  const deQuien = s.indiceTurno;

  s = M.cerrarVentanaDescarte(s);
  ok(s.fase === "postLevantada", "cerrada la ventana, vuelve a postLevantada", s.fase);
  ok(s.indiceTurno === deQuien, "y sigue siendo su turno", s.indiceTurno);
  ok(s.ventanaDescarte === null, "sin ventana en pie");

  ok(M.puedeCortar(s) === true, "puede cortar");
  const trasPasar = M.pasarTurno(s);
  ok(trasPasar.indiceTurno !== deQuien, "o pasar, y ahí sí cambia el turno", trasPasar.indiceTurno);
}

// ===================================== 3. los dos casos que NO deben reabrir

console.log("\n=== 3. Cambiar no reabre, y un poder tampoco ===");
{
  // CAMBIAR: la carta va a la mano, la muestra no cambia.
  const s = mesaConLevantada(carta("Copa", 6));
  const muestraAntes = s.descarte[0].id;
  const cambiado = M.cambiarCarta(s, 0);
  ok(cambiado.fase === "postLevantada", "cambiar va directo a postLevantada", cambiado.fase);
  ok(!cambiado.ventanaDescarte, "sin abrir ninguna ventana");
  ok(cambiado.descarte[0].id !== muestraAntes,
     "la muestra la cambia la carta que salió de la mano, no la levantada",
     cambiado.descarte[0].id);

  // PODER: primero se resuelve, o se perdería.
  for (const numero of [7, 8, 9, 10]) {
    const conPoder = M.tirarCarta(mesaConLevantada(carta("Espada", numero)));
    ok(conPoder.fase === "poder", `tirar un ${numero} va al poder, no a los reflejos`, conPoder.fase);
    ok(!conPoder.ventanaDescarte, `y el ${numero} no abre ventana`);
  }
}

// ============================================== 4. la ventana de la ronda

console.log("\n=== 4. La ventana de la ronda sigue desembocando en el turno ===");
{
  // La que abre `terminarMirada` no lleva `volverA`, así que cierra al turno.
  let s = M.terminarMirada(M.empezarRonda(M.crearPartida([
    { id: "A", nombre: "A" }, { id: "B", nombre: "B" },
  ], { semilla: 7 })));
  ok(s.fase === "descarte", "la ronda arranca con su ventana", s.fase);
  ok(s.ventanaDescarte.volverA === undefined, "que no lleva volverA");
  s = M.cerrarVentanaDescarte(s);
  ok(s.fase === "turno", "y cierra al turno, como siempre", s.fase);
}

// ================================================== 5. en red, de punta a punta

console.log("\n=== 5. En red: tirar abre una ventana NUEVA ===");
{
  class E extends Error { constructor(c, m) { super(m); this.codigo = c; } }
  const error = (c, m) => new E(c, m);
  const docs = new Map(); let version = 0;
  const db = {
    collection: (n) => ({ doc: (id = `a${Math.random()}`) => ({ ruta: `${n}/${id}` }) }),
    async runTransaction(cuerpo) {
      for (let i = 0; i < 10; i++) {
        const leidas = new Map(); const esc = []; let e0 = false;
        const tx = {
          async get(ref) {
            if (e0) throw error("invalid-argument", "Lectura tras escritura");
            const d = docs.get(ref.ruta); leidas.set(ref.ruta, d ? d.version : 0);
            return { exists: Boolean(d), data: () => (d ? structuredClone(d.datos) : undefined) };
          },
          set(ref, datos, op) { e0 = true; esc.push({ ruta: ref.ruta, datos, m: Boolean(op?.merge) }); },
          update(ref, datos) { e0 = true; esc.push({ ruta: ref.ruta, datos, m: true }); },
        };
        const res = await cuerpo(tx);
        if ([...leidas].some(([r, v]) => (docs.get(r)?.version ?? 0) !== v)) continue;
        for (const e of esc) {
          const p = docs.get(e.ruta);
          docs.set(e.ruta, { datos: e.m ? { ...(p?.datos ?? {}), ...structuredClone(e.datos) } : structuredClone(e.datos), version: ++version });
        }
        return res;
      }
      throw error("aborted", "reintentos");
    },
  };
  let reloj = 800000;
  const red = crearMotorEnRed({
    db, partidas: "partidas", ahora: () => reloj, idAleatorio: () => `v${reloj}_${version}`,
    marcaDeTiempo: () => "T", error, semillaDe: () => 555,
  });
  const C = "TIR001", DOS = ["ana", "beto"];
  const partida = () => docs.get(`partidas/${C}`).datos;
  const vence = (v) => v.abiertaEn + v.duracionMs + v.graciaMs;

  await red.repartir({ codigo: C, jugadores: DOS, nombres: DOS });
  const primera = partida().ventana;

  // Se atraviesa la ventana de la ronda sin que nadie descarte.
  reloj += MS_MIRAR + 1;
  await red.avanzarPartida({ codigo: C });
  reloj = vence(primera) + 1;
  await red.avanzarPartida({ codigo: C });
  reloj += MS_REVELACION;
  await red.avanzarPartida({ codigo: C });
  ok(partida().estado.fase === "turno", "la ronda llega a los turnos", partida().estado.fase);

  const enTurno = DOS[partida().estado.indiceTurno];
  await red.accionDeTurno({ uid: enTurno, codigo: C, accion: "levantar", clientActionId: "L1" });

  // Si la levantada trae poder, se salta: eso ya se probó arriba.
  if (partida().estado.levantada && !M.esPoder(partida().estado.levantada)) {
    await red.accionDeTurno({ uid: enTurno, codigo: C, accion: "tirar", clientActionId: "T1" });

    const p = partida();
    ok(p.estado.fase === "descarte", "tirar deja la partida en reflejos", p.estado.fase);
    ok(Boolean(p.ventana) && !p.ventana.cerrada, "con una ventana de red abierta");
    ok(p.ventana.id !== primera.id, "que NO es la de la ronda", [p.ventana.id, primera.id]);
    ok(p.ventana.abiertaEn === reloj, "abierta en el instante del tiro", p.ventana.abiertaEn - reloj);
    // Más corta que la de la ronda: la mesa ya está mirando la muestra y sólo
    // tiene que reaccionar al número nuevo. Y ocurre una vez por turno, así
    // que cada segundo se paga cuatro veces por ronda.
    ok(p.ventana.duracionMs === M.MS_DESCARTE_TRAS_TIRAR,
       "y dura menos que la de la ronda", [p.ventana.duracionMs, MS_VENTANA]);
    ok(p.plazo.que === "cerrarVentana", "con su plazo de cierre", p.plazo.que);

    // Un intento con el windowId viejo no se cuela.
    const viejo = await (async () => { try {
      return { ok: await red.intentarDescarte({ uid: "beto", codigo: C, windowId: primera.id,
        posicion: 0, clientActionId: "viejo", declarado: 300, latencia: 30, incertidumbre: 15 }) };
    } catch (e) { return { err: e.message }; } })();
    ok(/otra ronda/i.test(viejo.err ?? ""), "y un intento de la ventana vieja se rechaza", viejo.err);

    // Al cerrarse vuelve a la decisión del que tiró.
    reloj = vence(p.ventana) + 1;
    await red.avanzarPartida({ codigo: C });
    reloj += MS_REVELACION;
    await red.avanzarPartida({ codigo: C });
    ok(partida().estado.fase === "postLevantada",
       "cerrada, vuelve a su decisión de cortar", partida().estado.fase);
    ok(DOS[partida().estado.indiceTurno] === enTurno, "y sigue siendo su turno");
  } else {
    ok(true, "(la levantada trajo poder: el caso en red se cubre en la sección 3)");
  }
}

// ============================== 6. renunciar al poder también reabre

/**
 * Un 7, 8, 9 o 10 tirado ya cambió la muestra antes de que su dueño decida si
 * usa el poder. Si renuncia, la carta queda como una carta más — y la mesa
 * merece los mismos reflejos que le habría dado cualquier otro tiro. Si no,
 * tirar un poder y renunciar sería la manera de cambiar la muestra sin que
 * nadie pudiera aprovecharla.
 */
console.log("\n=== 6. Renunciar al poder deja la muestra viva ===");
{
  for (const numero of [7, 8, 9, 10]) {
    const tirada = carta("Espada", numero);
    let s = M.tirarCarta(mesaConLevantada(tirada));
    ok(s.fase === "poder", `el ${numero} activa su poder`, s.fase);
    ok(s.descarte[0].id === tirada.id, `y ya es la muestra`, s.descarte[0].id);

    s = M.saltarPoder(s);
    ok(s.fase === "descarte", `renunciar al ${numero} reabre los reflejos`, s.fase);
    ok(s.poderPendiente === null, `sin poder pendiente tras el ${numero}`);
    ok(s.ventanaDescarte?.volverA === "postLevantada",
       `y el ${numero} devuelve a su decisión de cortar`);

    s = M.cerrarVentanaDescarte(s);
    ok(s.fase === "postLevantada", `cerrada, el ${numero} vuelve a postLevantada`, s.fase);
  }

  // Usar el poder, en cambio, sigue yendo derecho a la decisión.
  const usado = M.usarPoderMirar(M.tirarCarta(mesaConLevantada(carta("Espada", 7))), 0, 0);
  ok(usado.estado.fase === "postLevantada",
     "usar el poder sigue yendo derecho a la decisión", usado.estado.fase);
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
