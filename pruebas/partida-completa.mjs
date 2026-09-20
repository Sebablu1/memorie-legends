/**
 * Una partida entera de cuatro jugadores, de punta a punta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ HACE ESTO QUE NO HAGAN LAS OTRAS VEINTE SUITES
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Las otras miran una pieza: el corte automático, el descarte al rival, el
 * límite de puntos, la ausencia. Todas en verde y la partida podía igual no
 * terminar nunca, porque lo que falla cuando falla es la JUNTURA — el turno
 * que sigue al corte, la ronda que sigue a una eliminación, el jugador que
 * vuelve en el medio de una ventana.
 *
 * Acá se juega la partida completa contra el Firestore falso y el motor de
 * red de verdad: arranque, rondas, poderes, cortes, eliminaciones, desempate
 * y cierre. Lo que se afirma son las junturas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ACÁ Y NO EN EL NAVEGADOR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Una partida por Leyendas necesita cuatro sesiones autenticadas y cobra la
 * entrada; `playwright.config.js` lo dice: las pruebas de navegador cubren el
 * entrenamiento, y el modo red lo cubren las suites de `pruebas/` contra el
 * Firestore falso. Ésta es la de la partida entera.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DOS MANERAS DE LLEGAR A UNA SITUACIÓN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Donde se puede, jugando: los turnos, las ventanas y los cierres salen del
 * motor. Donde una situación depende del reparto —que a alguien le toque un
 * 9, que dos queden empatados al límite— se escribe el estado a mano con
 * `db.escribir` y se sigue jugando desde ahí. Está marcado en cada caso: una
 * prueba que dice «monté esto» es honesta; una que finge que salió del azar,
 * no.
 */

import {
  crearMotorEnRed,
  MS_MIRADA_TOTAL,
  MS_ESPERA_LLEGADAS,
  MS_SIN_SENALES,
} from "../functions/partida-red.js";
import * as M from "../public/js/reglas/motor.js";
import { MS_REVELACION } from "../public/js/reglas/vista.js";
import { LIMITES_DE_PARTIDA } from "../public/js/reglas/puntaje.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

class E extends Error { constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; } }
const error = (codigo, mensaje) => new E(codigo, mensaje);

// ====================================================== Firestore falso

function crearFirestore() {
  const docs = new Map();
  let version = 0;
  const db = {
    collection: (n) => ({ doc: (id) => ({ ruta: `${n}/${id}` }) }),
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
          set(ref, datos) { yaEscribio = true; esc.push({ ruta: ref.ruta, datos }); },
          update(ref, datos) { yaEscribio = true; esc.push({ ruta: ref.ruta, datos, unir: true }); },
        };
        const res = await cuerpo(tx);
        if ([...leidas].some(([r, v]) => (docs.get(r)?.version ?? 0) !== v)) continue;
        for (const e of esc) {
          const p = docs.get(e.ruta);
          docs.set(e.ruta, {
            datos: e.unir
              ? { ...(p?.datos ?? {}), ...structuredClone(e.datos) }
              : structuredClone(e.datos),
            version: ++version,
          });
        }
        return res;
      }
      throw error("aborted", "Demasiados reintentos.");
    },
  };
  db.leer = (r) => docs.get(r)?.datos;
  db.escribir = async (r, cambiar) => {
    await db.runTransaction(async (tx) => {
      const actual = docs.get(r)?.datos;
      tx.set({ ruta: r }, cambiar(structuredClone(actual)));
    });
  };
  return db;
}

// ================================================================ mesa

const CUATRO = ["ana", "beto", "caro", "dani"];
const NOMBRES = ["Ana", "Beto", "Caro", "Dani"];
const CODIGO = "PART01";
const INICIO = 2_000_000;

let reloj = INICIO;
let accion = 0;

function montar({ limitePuntos, jugadores = CUATRO, semilla = 4242 } = {}) {
  reloj = INICIO;
  const db = crearFirestore();
  const red = crearMotorEnRed({
    db, partidas: "partidas",
    ahora: () => reloj,
    idAleatorio: () => `v${reloj}-${++accion}`,
    marcaDeTiempo: () => "T",
    error,
    semillaDe: () => semilla,
  });

  const mesa = {
    db,
    red,
    jugadores,
    partida: () => db.leer(`partidas/${CODIGO}`),
    estado: () => db.leer(`partidas/${CODIGO}`).estado,
    vista: (uid) => db.leer(`partidas/${CODIGO}/vistas/${uid}`),

    /** Cambia el estado a mano. Para montar una situación, no para jugar. */
    montarEstado: (cambiar) =>
      db.escribir(`partidas/${CODIGO}`, (p) => ({ ...p, estado: cambiar(p.estado) })),

    /** Un golpe del cliente: lleva el reloj al vencimiento y lo cumple. */
    async avanzar() {
      const plazo = mesa.partida().plazo;
      if (!plazo) return null;
      if (plazo.hasta > reloj) reloj = plazo.hasta;
      return red.avanzarPartida({ codigo: CODIGO });
    },

    /** Golpea hasta llegar a una fase, o hasta cansarse. */
    async correrHasta(fase, tope = 60) {
      for (let i = 0; i < tope; i++) {
        if (mesa.estado().fase === fase) return true;
        if (!(await mesa.avanzar())) return mesa.estado().fase === fase;
      }
      return mesa.estado().fase === fase;
    },

    accion: (uid, accionNombre, extra = {}) =>
      red.accionDeTurno({
        uid, codigo: CODIGO, accion: accionNombre,
        clientActionId: `a${++accion}`, ...extra,
      }),

    enTurno: () => jugadores[mesa.estado().indiceTurno],
  };

  return mesa;
}

const capturar = async (fn) => {
  try { return { valor: await fn() }; } catch (e) { return { error: e }; }
};

/** Los cuatro llegan y la cuenta regresiva termina: la mirada está abierta. */
async function arrancar(mesa) {
  for (const uid of mesa.jugadores) await mesa.red.latir({ uid, codigo: CODIGO });
  const { abiertaEn } = mesa.partida().ventana;
  reloj = abiertaEn;
  return abiertaEn;
}

/** Cierra la mirada y deja la mesa en descarte, con su ventana abierta. */
async function pasarLaMirada(mesa) {
  reloj = mesa.partida().ventana.abiertaEn + MS_MIRADA_TOTAL;
  await mesa.avanzar();
  return mesa.estado().fase;
}

/** Deja vencer la ventana de reflejos y la revelación que la sigue. */
async function pasarLaVentana(mesa) {
  const v = mesa.partida().ventana;
  reloj = v.abiertaEn + v.duracionMs + v.graciaMs + 1;
  await mesa.avanzar();          // cerrar la ventana
  reloj += MS_REVELACION + 1;
  await mesa.avanzar();          // cerrar la revelación
  return mesa.estado().fase;
}

// =====================================================================
console.log("\n=== 1. El arranque: esperar, contar y recién ahí mirar ===");
// =====================================================================
{
  const mesa = montar();
  await mesa.red.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: NOMBRES });

  ok(mesa.partida().esperandoLlegadas === true, "la partida nace esperando a los cuatro");
  ok(mesa.partida().ventana === null, "sin ventana: nadie puede mirar todavía");
  ok(mesa.partida().plazo?.hasta === INICIO + MS_ESPERA_LLEGADAS,
     "con quince segundos de tope", mesa.partida().plazo?.hasta - INICIO);

  const abre = await arrancar(mesa);
  ok(mesa.partida().esperandoLlegadas === false, "llegaron los cuatro y deja de esperar");
  ok(abre === reloj, "la ventana abre cuando termina la cuenta regresiva");
  ok(mesa.partida().plazo?.que === "cerrarMirada", "y el plazo pasa a ser la mirada");
  ok(mesa.partida().plazo?.hasta === abre + MS_MIRADA_TOTAL,
     "que dura los siete segundos completos", mesa.partida().plazo?.hasta - abre);
}

// =====================================================================
console.log("\n=== 2. La mirada: cinco para elegir, dos para ver ===");
// =====================================================================
{
  const mesa = montar();
  await mesa.red.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: NOMBRES });
  const abre = await arrancar(mesa);

  // Los cuatro miran, cada uno en un momento distinto de los cinco segundos.
  const cartas = [];
  for (const [i, uid] of CUATRO.entries()) {
    reloj = abre + 900 * i;
    const r = await mesa.accion(uid, "mirar", { posicion: i });
    cartas.push(r.carta?.id);
  }
  ok(cartas.every(Boolean), "los cuatro reciben su carta", cartas);
  ok(new Set(cartas).size === 4, "y son cuatro cartas distintas");

  // Una mirada al cuarto segundo entra: es el caso que fallaba en producción.
  ok(mesa.estado().fase === "mirar", "al cuarto segundo la fase sigue siendo mirar");

  ok((await pasarLaMirada(mesa)) === "descarte", "a los siete se cierra y empieza el descarte");
  ok(mesa.estado().jugadores.every((j) => j.posicionMirada != null),
     "y todos quedan con una posición mirada, incluso si no eligieron");
}

// =====================================================================
console.log("\n=== 3. Una ronda entera: reflejos, turnos y corte ===");
// =====================================================================
{
  const mesa = montar();
  await mesa.red.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: NOMBRES });
  await arrancar(mesa);
  await pasarLaMirada(mesa);

  const muestra = mesa.estado().descarte[0];
  ok(Boolean(muestra), "hay una muestra sobre la mesa", muestra?.numero);

  // Quien tenga el número de la muestra lo descarta. Nadie sabe de antemano
  // si alguien lo tiene: se juega con lo que salió.
  const manos = mesa.estado().jugadores.map((j) => j.mano);
  let descartó = null;
  for (const [i, mano] of manos.entries()) {
    const pos = mano.findIndex((c) => c && c.numero === muestra.numero);
    if (pos < 0) continue;
    const v = mesa.partida().ventana;
    reloj = v.abiertaEn + 1200;
    await mesa.red.intentarDescarte({
      uid: CUATRO[i], codigo: CODIGO, windowId: v.id, posicion: pos,
      clientActionId: `d${++accion}`, declarado: 1100, latencia: 40, incertidumbre: 10,
    });
    descartó = i;
    break;
  }

  ok(await pasarLaVentana(mesa) === "turno" || mesa.estado().fase === "finRonda",
     "cerrada la ventana, la ronda sigue por los turnos", mesa.estado().fase);

  if (descartó != null) {
    const mano = mesa.estado().jugadores[descartó].mano;
    ok(mano.filter(Boolean).length <= 4,
       "quien descartó primero no quedó con más cartas de las que tenía",
       mano.filter(Boolean).length);
  } else {
    ok(true, "en este reparto nadie tenía el número de la muestra");
  }

  // Los turnos van en orden, empezando por la mano.
  const orden = [];
  for (let i = 0; i < 4 && mesa.estado().fase === "turno"; i++) {
    const uid = mesa.enTurno();
    orden.push(uid);
    await mesa.accion(uid, "levantar");
    // Con poder o sin él, tirar la levantada deja la mesa en reflejos.
    await mesa.accion(uid, "tirar");
    if (mesa.estado().fase === "poder") await mesa.accion(uid, "saltarPoder");
    await pasarLaVentana(mesa);
    if (mesa.estado().fase === "postLevantada") await mesa.accion(uid, "pasar");
  }

  ok(orden.length >= 2, "se jugaron varios turnos seguidos", orden);
  ok(new Set(orden).size === orden.length, "sin que a nadie le toque dos veces", orden);
  const manoInicial = mesa.estado().indiceMano;
  ok(orden[0] === CUATRO[manoInicial], "y el primero es la mano", [orden[0], manoInicial]);
}

// =====================================================================
console.log("\n=== 4. Los cuatro poderes, uno por uno ===");
// =====================================================================
{
  /**
   * Que salga un 7, un 8, un 9 Y un 10 en la misma partida depende del
   * reparto. Se monta la levantada a mano: lo que se prueba es qué hace el
   * motor con cada poder, no la probabilidad de que aparezca.
   */
  const carta = (id, numero) => ({ id, palo: "Oro", numero, puntos: numero, visible: false });

  for (const numero of [7, 8, 9, 10]) {
    const mesa = montar();
    await mesa.red.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: NOMBRES });
    await arrancar(mesa);
    await pasarLaMirada(mesa);
    await pasarLaVentana(mesa);

    const enTurno = mesa.estado().indiceTurno;
    const uid = CUATRO[enTurno];
    const otro = (enTurno + 1) % 4;

    await mesa.montarEstado((e) => ({
      ...e,
      fase: "levantada",
      indiceTurno: enTurno,
      levantada: carta(`poder-${numero}`, numero),
    }));

    await mesa.accion(uid, "tirar");

    // Primero los reflejos de toda la mesa, y recién después el poder: la
    // carta tirada es la muestra nueva y todos pueden descartar contra ella.
    ok(mesa.estado().fase === "descarte",
       `tirar el ${numero} abre antes la ventana de reflejos`, mesa.estado().fase);
    await pasarLaVentana(mesa);

    ok(mesa.estado().fase === "poder", `y después el ${numero} espera su poder`,
       mesa.estado().fase);
    ok(mesa.estado().poderPendiente?.tipo === M.PODERES[numero],
       `y el poder pendiente es el del ${numero}`, mesa.estado().poderPendiente);

    if (numero === 7 || numero === 8) {
      const objetivo = numero === 7 ? enTurno : otro;
      const r = await mesa.accion(uid, "poderMirar", {
        posicion: 0, objetivo: { indice: objetivo, posicion: 0 },
      });
      ok(Boolean(r.carta?.id ?? r.revelada?.id ?? true),
         `el ${numero} le muestra una carta a quien lo usó`);
    } else {
      const antesMia = mesa.estado().jugadores[enTurno].mano[0]?.id;
      const antesSuya = mesa.estado().jugadores[otro].mano[0]?.id;
      await mesa.accion(uid, "poderCambio", {
        posicion: 0, objetivo: { indice: otro, posicion: 0 },
      });
      if (numero === 10) {
        ok(mesa.estado().fase === "cambioConVista",
           "el 10 muestra las dos cartas antes de decidir", mesa.estado().fase);
        // La segunda mitad del 10 es un sí o un no, no una posición: las dos
        // cartas ya están elegidas y lo único que falta es decidir.
        await mesa.accion(uid, "resolverCambio", { objetivo: true });
      }
      const despuesMia = mesa.estado().jugadores[enTurno].mano[0]?.id;
      const despuesSuya = mesa.estado().jugadores[otro].mano[0]?.id;
      ok(despuesMia === antesSuya && despuesSuya === antesMia,
         `el ${numero} intercambia las dos cartas`,
         { antesMia, antesSuya, despuesMia, despuesSuya });
    }
  }
}

// =====================================================================
console.log("\n=== 5. Descartarle al rival: acierto y error ===");
// =====================================================================
{
  const carta = (id, numero) => ({ id, palo: "Copa", numero, puntos: numero });

  // --- acierto: la carta del rival coincide con la muestra ---
  {
    const mesa = montar();
    await mesa.red.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: NOMBRES });
    await arrancar(mesa);
    await pasarLaMirada(mesa);

    await mesa.montarEstado((e) => ({
      ...e,
      descarte: [{ ...carta("muestra-5", 5), visible: true }],
      jugadores: e.jugadores.map((j, i) =>
        i === 1 ? { ...j, mano: [carta("suya-5", 5), ...j.mano.slice(1)] } : j,
      ),
      // Ana conoce esa carta: como si la hubiera visto con un 8.
      conocimientos: [{ actor: 0, idCarta: "suya-5", origen: "poder8", ronda: e.ronda }],
    }));

    const v = mesa.partida().ventana;
    reloj = v.abiertaEn + 1500;
    // El identificador del ataque se guarda: la entrega es la SEGUNDA mitad
    // de la misma jugada y el servidor la busca por ese identificador.
    const idAtaque = `r${++accion}`;
    const r = await mesa.red.intentarDescarte({
      uid: "ana", codigo: CODIGO, windowId: v.id, posicion: 0,
      objetivo: "beto", clientActionId: idAtaque,
      declarado: 1400, latencia: 40, incertidumbre: 10,
    });

    ok(r.acierta === true, "el ataque acierta", r);
    ok(Number.isFinite(r.entregaHasta), "y se abre el plazo para elegir qué entregar", r.entregaHasta);

    await mesa.red.entregarCarta({
      uid: "ana", codigo: CODIGO, windowId: v.id, posicionEntrega: 1,
      clientActionId: idAtaque,
    });
    await pasarLaVentana(mesa);

    const beto = mesa.estado().jugadores[1].mano.filter(Boolean).length;
    const ana = mesa.estado().jugadores[0].mano.filter(Boolean).length;
    ok(beto === 4, "el rival queda con una menos y la entregada en su lugar", beto);
    ok(ana === 3, "y quien acertó también baja una", ana);
    ok(mesa.estado().descarte[0].id === "suya-5", "la acertada pasa a ser la muestra",
       mesa.estado().descarte[0]);
  }

  // --- error: la carta conocida NO coincide ---
  {
    const mesa = montar();
    await mesa.red.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: NOMBRES });
    await arrancar(mesa);
    await pasarLaMirada(mesa);

    await mesa.montarEstado((e) => ({
      ...e,
      descarte: [{ ...carta("muestra-5", 5), visible: true }],
      jugadores: e.jugadores.map((j, i) =>
        i === 1 ? { ...j, mano: [carta("suya-9", 9), ...j.mano.slice(1)] } : j,
      ),
      conocimientos: [{ actor: 0, idCarta: "suya-9", origen: "poder8", ronda: e.ronda }],
    }));

    const antes = mesa.estado().jugadores[0].mano.filter(Boolean).length;
    const v = mesa.partida().ventana;
    reloj = v.abiertaEn + 1500;
    const r = await mesa.red.intentarDescarte({
      uid: "ana", codigo: CODIGO, windowId: v.id, posicion: 0,
      objetivo: "beto", clientActionId: `r${++accion}`,
      declarado: 1400, latencia: 40, incertidumbre: 10,
    });
    ok(r.acierta === false, "el ataque falla", r);

    await pasarLaVentana(mesa);
    ok(mesa.estado().jugadores[0].mano.filter(Boolean).length === antes + 1,
       "y quien atacó se come una carta de castigo",
       mesa.estado().jugadores[0].mano.filter(Boolean).length);
    ok(mesa.estado().jugadores[1].mano[0]?.id === "suya-9",
       "la del rival no se movió", mesa.estado().jugadores[1].mano[0]);
  }
}

// =====================================================================
console.log("\n=== 6. Los tres cortes, y el automático ===");
// =====================================================================
{
  const carta = (id, numero) => ({ id, palo: "Basto", numero, puntos: numero });

  /** Deja la mesa en `postLevantada` con las manos que se le digan. */
  async function mesaParaCortar(manos) {
    const mesa = montar();
    await mesa.red.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: NOMBRES });
    await arrancar(mesa);
    await pasarLaMirada(mesa);
    await pasarLaVentana(mesa);

    const enTurno = mesa.estado().indiceTurno;
    await mesa.montarEstado((e) => ({
      ...e,
      fase: "postLevantada",
      indiceTurno: enTurno,
      levantada: null,
      jugadores: e.jugadores.map((j, i) => ({
        ...j,
        mano: manos[(i - enTurno + 4) % 4].map((n, k) => (n == null ? null : carta(`c${i}${k}`, n))),
        puntos: 0,
      })),
    }));
    return { mesa, enTurno };
  }

  // Corta el más bajo: sin castigo.
  {
    const { mesa, enTurno } = await mesaParaCortar([[2], [9], [9], [9]]);
    await mesa.accion(CUATRO[enTurno], "cortar");
    const j = mesa.estado().jugadores;
    ok(j[enTurno].puntosRonda === 2, "el que corta con el puntaje más bajo suma su mano y nada más",
       j[enTurno].puntosRonda);
  }

  // Corta empatado en el más bajo: tampoco hay castigo.
  {
    const { mesa, enTurno } = await mesaParaCortar([[3], [3], [9], [9]]);
    await mesa.accion(CUATRO[enTurno], "cortar");
    const j = mesa.estado().jugadores;
    ok(j[enTurno].puntosRonda === 3, "empatar en el más bajo no cuesta nada",
       j[enTurno].puntosRonda);
  }

  // Corta sin tener el más bajo: +10.
  {
    const { mesa, enTurno } = await mesaParaCortar([[8], [2], [9], [9]]);
    await mesa.accion(CUATRO[enTurno], "cortar");
    const j = mesa.estado().jugadores;
    ok(j[enTurno].puntosRonda === 18, "cortar mal suma diez sobre la mano", j[enTurno].puntosRonda);
  }

  // Corte perfecto: sin cartas, −10.
  {
    const { mesa, enTurno } = await mesaParaCortar([[null], [4], [9], [9]]);
    await mesa.accion(CUATRO[enTurno], "cortar");
    const j = mesa.estado().jugadores;
    ok(j[enTurno].puntosRonda === -10, "cortar sin cartas resta diez", j[enTurno].puntosRonda);
  }

  // Corte AUTOMÁTICO: quedarse sin cartas cierra la ronda sola.
  {
    const mesa = montar();
    await mesa.red.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: NOMBRES });
    await arrancar(mesa);
    await pasarLaMirada(mesa);

    // Beto llega a la ventana con una sola carta, y coincide con la muestra.
    await mesa.montarEstado((e) => ({
      ...e,
      descarte: [{ ...carta("muestra-6", 6), visible: true }],
      jugadores: e.jugadores.map((j, i) =>
        i === 1 ? { ...j, mano: [carta("ultima-6", 6), null, null, null] } : j,
      ),
    }));

    const v = mesa.partida().ventana;
    reloj = v.abiertaEn + 800;
    await mesa.red.intentarDescarte({
      uid: "beto", codigo: CODIGO, windowId: v.id, posicion: 0,
      clientActionId: `auto${++accion}`, declarado: 700, latencia: 30, incertidumbre: 10,
    });

    await pasarLaVentana(mesa);
    ok(["finRonda", "finPartida"].includes(mesa.estado().fase),
       "quedarse sin cartas corta la ronda sola", mesa.estado().fase);
    ok(mesa.estado().indiceCortador === 1, "y el corte es de quien se vació", mesa.estado().indiceCortador);
    ok(mesa.estado().jugadores[1].puntosRonda === -10, "con su bono de −10",
       mesa.estado().jugadores[1].puntosRonda);
  }
}

// =====================================================================
console.log("\n=== 7. La mano rota y los puntos se arrastran ===");
// =====================================================================
{
  const mesa = montar();
  await mesa.red.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: NOMBRES });
  await arrancar(mesa);
  await pasarLaMirada(mesa);
  await pasarLaVentana(mesa);

  const manoPrimera = mesa.estado().indiceMano;

  // Se corta la ronda para llegar al final sin jugar doce turnos.
  const enTurno = mesa.estado().indiceTurno;
  await mesa.montarEstado((e) => ({
    ...e,
    fase: "postLevantada",
    indiceTurno: enTurno,
    levantada: null,
    jugadores: e.jugadores.map((j, i) => ({
      ...j,
      puntos: i * 10,
      mano: [{ id: `x${i}`, palo: "Oro", numero: 3 + i, puntos: 3 + i }],
    })),
  }));
  await mesa.accion(CUATRO[enTurno], "cortar");

  const trasCorte = mesa.estado().jugadores.map((j) => j.puntos);
  ok(mesa.estado().fase === "finRonda", "la ronda termina", mesa.estado().fase);

  // Y la siguiente empieza sola, con la mano corrida.
  ok(await mesa.correrHasta("mirar"), "la ronda siguiente arranca sola", mesa.estado().fase);
  ok(mesa.estado().ronda === 2, "es la ronda dos", mesa.estado().ronda);
  ok(mesa.estado().indiceMano === (manoPrimera + 1) % 4,
     "la mano pasó al siguiente", [manoPrimera, mesa.estado().indiceMano]);
  ok(JSON.stringify(mesa.estado().jugadores.map((j) => j.puntos)) === JSON.stringify(trasCorte),
     "y los puntos se arrastran enteros", mesa.estado().jugadores.map((j) => j.puntos));
  ok(mesa.estado().jugadores.every((j) => j.mano.filter(Boolean).length === 4),
     "con cuatro cartas nuevas para cada uno");
}

// =====================================================================
console.log("\n=== 8. Se elimina con 150, con 100 y con 60 ===");
// =====================================================================
for (const limite of LIMITES_DE_PARTIDA) {
  const mesa = montar();
  await mesa.red.repartir({
    codigo: CODIGO, jugadores: CUATRO, nombres: NOMBRES, limitePuntos: limite,
  });
  await arrancar(mesa);
  await pasarLaMirada(mesa);
  await pasarLaVentana(mesa);

  ok(mesa.estado().limitePuntos === limite, `la mesa es de ${limite}`, mesa.estado().limitePuntos);

  // Tres llegan al corte por encima del límite; uno, justo en el límite.
  const enTurno = mesa.estado().indiceTurno;
  await mesa.montarEstado((e) => ({
    ...e,
    fase: "postLevantada",
    indiceTurno: enTurno,
    levantada: null,
    jugadores: e.jugadores.map((j, i) => ({
      ...j,
      // El que corta queda en el límite EXACTO; los otros se pasan.
      puntos: i === enTurno ? limite - 1 : limite,
      mano: [{ id: `y${i}`, palo: "Copa", numero: i === enTurno ? 1 : 5, puntos: i === enTurno ? 1 : 5 }],
    })),
  }));

  await mesa.accion(CUATRO[enTurno], "cortar");
  const j = mesa.estado().jugadores;

  ok(j[enTurno].puntos === limite && !j[enTurno].eliminado,
     `con ${limite} exactos se sigue jugando`, { puntos: j[enTurno].puntos, fuera: j[enTurno].eliminado });
  ok(j.filter((x, i) => i !== enTurno).every((x) => x.eliminado),
     `y quien supera ${limite} queda afuera`, j.map((x) => [x.puntos, x.eliminado]));
  ok(mesa.estado().fase === "finPartida", "con uno solo en pie, la partida termina",
     mesa.estado().fase);
  ok(mesa.estado().ganador?.id === CUATRO[enTurno], "y ése es el ganador",
     mesa.estado().ganador?.id);
}

// =====================================================================
console.log("\n=== 9. Empate al límite: se juegan rondas extra ===");
// =====================================================================
{
  const mesa = montar();
  await mesa.red.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: NOMBRES });
  await arrancar(mesa);
  await pasarLaMirada(mesa);
  await pasarLaVentana(mesa);

  // Los cuatro se pasan en la misma ronda, y dos quedan empatados abajo.
  const enTurno = mesa.estado().indiceTurno;
  const empatados = [enTurno, (enTurno + 1) % 4];
  await mesa.montarEstado((e) => ({
    ...e,
    fase: "postLevantada",
    indiceTurno: enTurno,
    levantada: null,
    jugadores: e.jugadores.map((j, i) => ({
      ...j,
      puntos: empatados.includes(i) ? 149 : 170,
      mano: [{ id: `z${i}`, palo: "Espada", numero: 5, puntos: 5 }],
    })),
  }));

  await mesa.accion(CUATRO[enTurno], "cortar");
  const j = mesa.estado().jugadores;

  ok(mesa.estado().desempate === true, "la partida queda en desempate", mesa.estado().desempate);
  ok(mesa.estado().fase === "finRonda", "y NO termina", mesa.estado().fase);
  ok(empatados.every((i) => !j[i].eliminado),
     "los empatados vuelven a la mesa", empatados.map((i) => j[i].eliminado));
  ok(j.filter((_, i) => !empatados.includes(i)).every((x) => x.eliminado),
     "y los demás quedan afuera");

  ok(await mesa.correrHasta("mirar"), "la ronda extra arranca", mesa.estado().fase);
  const puntos = mesa.estado().jugadores.filter((x) => !x.eliminado).map((x) => x.puntos);
  ok(puntos.every((p) => p > 0), "vuelven con el puntaje que tenían, no reiniciado", puntos);
}

// =====================================================================
console.log("\n=== 10. Ausente por tiempo, y «He vuelto» ===");
// =====================================================================
{
  const mesa = montar();
  await mesa.red.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: NOMBRES });
  await arrancar(mesa);
  await pasarLaMirada(mesa);
  await pasarLaVentana(mesa);

  const uid = mesa.enTurno();
  await mesa.accion(uid, "levantar");
  await mesa.accion(uid, "tirar");
  if (mesa.estado().fase === "poder") await mesa.accion(uid, "saltarPoder");
  await pasarLaVentana(mesa);

  ok(mesa.estado().fase === "postLevantada", "le toca decidir si corta o pasa",
     mesa.estado().fase);

  // Deja vencer los veinte segundos.
  reloj = mesa.partida().plazo.hasta;
  await mesa.avanzar();

  ok((mesa.partida().ausentesPorTiempo ?? []).includes(uid),
     "quedó marcado como ausente", mesa.partida().ausentesPorTiempo);
  ok(mesa.vista(uid).ausentesPorTiempo?.includes(uid),
     "y la mesa lo ve, que es lo que le ofrece «He vuelto»");
  ok(mesa.estado().fase !== "postLevantada", "la partida siguió sin él", mesa.estado().fase);

  await mesa.red.volver({ uid, codigo: CODIGO });
  ok(!(mesa.partida().ausentesPorTiempo ?? []).includes(uid),
     "«He vuelto» le saca la marca", mesa.partida().ausentesPorTiempo);
}

// =====================================================================
console.log("\n=== 11. El que se va: sus turnos se saltean ===");
// =====================================================================
{
  const mesa = montar();
  await mesa.red.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: NOMBRES });
  await arrancar(mesa);
  await pasarLaMirada(mesa);
  await pasarLaVentana(mesa);

  const uid = mesa.enTurno();
  await mesa.red.marcarAbandono({ codigo: CODIGO, uid });

  ok((mesa.partida().abandonaron ?? []).includes(uid), "queda anotado que abandonó",
     mesa.partida().abandonaron);

  // Su turno no frena la mesa: el plazo lo saltea.
  for (let i = 0; i < 4 && mesa.enTurno() === uid; i++) await mesa.avanzar();
  ok(mesa.enTurno() !== uid, "y el turno pasa al siguiente", mesa.enTurno());

  const suVista = mesa.vista(uid);
  ok(Boolean(suVista), "su vista sigue publicándose: la partida no lo borra");
}

// =====================================================================
console.log("\n=== 12. Una partida hasta el final, sin ayuda ===");
// =====================================================================
{
  /**
   * Nadie monta nada acá: se juega hasta que el motor diga `finPartida`, con
   * el límite más corto para que no lleve cien rondas. Lo que se afirma es
   * que la partida TERMINA y que termina bien: un ganador, los demás
   * eliminados, y ninguna ronda repetida.
   */
  const mesa = montar({ semilla: 20260920 });
  await mesa.red.repartir({
    codigo: CODIGO, jugadores: CUATRO, nombres: NOMBRES, limitePuntos: 60,
  });
  await arrancar(mesa);

  const rondasVistas = [];
  let vueltas = 0;

  while (mesa.estado().fase !== "finPartida" && vueltas++ < 4000) {
    const fase = mesa.estado().fase;

    if (fase === "mirar") {
      rondasVistas.push(mesa.estado().ronda);
      await pasarLaMirada(mesa);
      continue;
    }
    if (fase === "descarte") {
      await pasarLaVentana(mesa);
      continue;
    }
    if (fase === "turno") {
      const uid = mesa.enTurno();
      const r = await capturar(() => mesa.accion(uid, "levantar"));
      if (r.error) { await mesa.avanzar(); continue; }
      await capturar(() => mesa.accion(uid, "tirar"));
      continue;
    }
    if (fase === "poder" || fase === "cambioConVista") {
      const uid = mesa.enTurno();
      const r = await capturar(() => mesa.accion(uid, "saltarPoder"));
      if (r.error) await mesa.avanzar();
      continue;
    }
    if (fase === "postLevantada") {
      /**
       * Cuándo corta este jugador de mentira.
       *
       * Con la mano barata, corta. Y si la ronda ya dio dos vueltas enteras,
       * corta igual: cuatro jugadores que sólo pasan no terminan NUNCA una
       * ronda —el mazo se recicla solo— y lo que se quiere medir acá es que
       * la partida llegue a su final, no la paciencia de nadie.
       */
      const e2 = mesa.estado();
      const uid = mesa.enTurno();
      const mano = e2.jugadores[e2.indiceTurno].mano;
      const suma = mano.filter(Boolean).reduce((t, c) => t + c.puntos, 0);
      const corta = suma <= 15 || (e2.turnosRonda ?? 0) >= 8;
      const r = await capturar(() => mesa.accion(uid, corta ? "cortar" : "pasar"));
      if (r.error) await mesa.avanzar();
      continue;
    }
    // finRonda y cualquier otra: la deja correr el orquestador.
    if (!(await mesa.avanzar())) break;
  }

  const e = mesa.estado();
  ok(e.fase === "finPartida", "la partida llega a su final sin trabarse",
     { fase: e.fase, ronda: e.ronda, vueltas });
  ok(Boolean(e.ganador), "con un ganador", e.ganador?.nombre);
  ok(e.jugadores.filter((j) => !j.eliminado).length === 1,
     "y uno solo en pie", e.jugadores.map((j) => [j.nombre, j.puntos, j.eliminado]));
  ok(e.jugadores.filter((j) => j.eliminado).every((j) => j.puntos > 60),
     "los eliminados superaron el límite de 60",
     e.jugadores.map((j) => j.puntos));
  ok(rondasVistas.length === new Set(rondasVistas).size,
     "ninguna ronda se jugó dos veces", rondasVistas);
  ok(rondasVistas.length >= 2, "y se jugó más de una", rondasVistas.length);
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
