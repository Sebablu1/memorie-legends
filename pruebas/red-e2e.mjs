/**
 * Prueba mínima extremo a extremo: dos jugadores, una partida en red.
 *
 *   iniciar → publicar vistas → A recibe SOLO la vista A · B SOLO la B
 *   → A juega → el servidor procesa → los dos reciben su vista nueva
 *
 * No se toca ninguna Leyenda: esto demuestra que la partida funciona y que
 * las vistas privadas no filtran, nada más.
 *
 * El Firestore de mentira de acá tiene algo que los otros no: `escuchar`,
 * que imita `onSnapshot`. Sin eso no se podría comprobar lo que de verdad
 * importa —qué le LLEGA a cada jugador— sino sólo qué quedó escrito.
 */

import { crearMotorEnRed } from "../functions/partida-red.js";
import { MS_REVELACION } from "../public/js/reglas/vista.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

class E extends Error { constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; } }
const error = (codigo, mensaje) => new E(codigo, mensaje);

// ======================================= Firestore de mentira, con escucha

function crearFirestore() {
  const docs = new Map();
  const oyentes = new Map();
  let version = 0;

  const avisar = (ruta) => {
    for (const fn of oyentes.get(ruta) ?? []) {
      fn({ exists: docs.has(ruta), data: () => structuredClone(docs.get(ruta)?.datos) });
    }
  };

  const db = {
    collection: (n) => ({ doc: (id = `a${Math.random()}`) => ({ ruta: `${n}/${id}` }) }),
    async runTransaction(cuerpo) {
      for (let i = 0; i < 8; i++) {
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
          const previo = docs.get(e.ruta);
          docs.set(e.ruta, {
            datos: e.m ? { ...(previo?.datos ?? {}), ...structuredClone(e.datos) } : structuredClone(e.datos),
            version: ++version,
          });
        }
        // Los avisos salen después de confirmar, como en Firestore de verdad.
        for (const e of esc) avisar(e.ruta);
        return res;
      }
      throw error("aborted", "Demasiados reintentos.");
    },
  };

  /** Imita onSnapshot: avisa al suscribirse y con cada cambio. */
  db.escuchar = (ruta, fn) => {
    if (!oyentes.has(ruta)) oyentes.set(ruta, new Set());
    oyentes.get(ruta).add(fn);
    if (docs.has(ruta)) fn({ exists: true, data: () => structuredClone(docs.get(ruta).datos) });
    return () => oyentes.get(ruta).delete(fn);
  };
  db.leer = (ruta) => docs.get(ruta)?.datos;
  db.existe = (ruta) => docs.has(ruta);
  db.rutas = () => [...docs.keys()];
  return db;
}

// =========================================== un jugador, del lado del navegador

/**
 * Lo que hace el cliente: escucha SÓLO su vista y guarda lo que recibe.
 * Deliberadamente no tiene ninguna forma de mirar el maestro.
 */
function jugador(db, codigo, uid) {
  const recibidas = [];
  const dejar = db.escuchar(`partidas/${codigo}/vistas/${uid}`, (snap) => {
    if (snap.exists) recibidas.push(snap.data());
  });
  return {
    uid,
    recibidas,
    dejar,
    get vista() { return recibidas.at(-1); },
    get versiones() { return recibidas.map((v) => v.version); },
  };
}

// ================================================================ montaje

let reloj = 100000;

/** El momento en que la ventana de esta partida ya se puede cerrar.
 *  No se escribe a mano: la ventana abre con la mirada y su duración
 *  vive en ella, así que hay que preguntársela. */
function trasLaGracia(db) {
  const v = db.leer(`partidas/${CODIGO}`).ventana;
  return v.abiertaEn + v.duracionMs + v.graciaMs + 1;
}
const db = crearFirestore();
const red = crearMotorEnRed({
  db, partidas: "partidas",
  ahora: () => reloj,
  idAleatorio: () => `w${reloj}`,
  marcaDeTiempo: () => "T",
  error,
  semillaDe: () => 20260828,
});

const capturar = async (fn) => {
  try { return { valor: await fn() }; } catch (e) { return { error: e }; }
};

const CODIGO = "PRUEBA";

// ============================================================== 1. iniciar

console.log("\n=== 1. Iniciar la partida y publicar las vistas ===");

// Los jugadores se suscriben ANTES de que exista nada, como en la vida real:
// abren la mesa y esperan.
const A = jugador(db, CODIGO, "ana");
const B = jugador(db, CODIGO, "beto");

ok(A.recibidas.length === 0 && B.recibidas.length === 0, "antes de iniciar no reciben nada");

await red.repartir({ codigo: CODIGO, jugadores: ["ana", "beto"], nombres: ["Ana", "Beto"] });

ok(A.recibidas.length === 1, "A recibe su vista al iniciarse la partida", A.recibidas.length);
ok(B.recibidas.length === 1, "B recibe la suya", B.recibidas.length);
ok(A.vista.yo === 0 && B.vista.yo === 1, "cada uno sabe qué jugador es", [A.vista.yo, B.vista.yo]);
ok(db.existe(`partidas/${CODIGO}`), "existe el documento maestro");
ok(db.rutas().length === 3, "y exactamente tres documentos: maestro y dos vistas", db.rutas());

// ============================================ 2. cada uno recibe SOLO lo suyo

console.log("\n=== 2. Cada jugador recibe únicamente su vista ===");
{
  const maestro = db.leer(`partidas/${CODIGO}`);

  // Lo que un jugador NO puede saber: el mazo entero y las manos de todos,
  // incluida la propia. Se busca el identificador en el JSON completo.
  const fuga = (vista) => {
    const texto = JSON.stringify(vista);
    const malas = [];
    for (const c of maestro.estado.mazo) if (texto.includes(`"${c.id}"`)) malas.push(`${c.id} (mazo)`);
    for (const [i, j] of maestro.estado.jugadores.entries()) {
      for (const c of j.mano) if (c && texto.includes(`"${c.id}"`)) malas.push(`${c.id} (mano de ${i})`);
    }
    return malas;
  };

  ok(fuga(A.vista).length === 0, "la vista de A no trae ninguna carta oculta", fuga(A.vista));
  ok(fuga(B.vista).length === 0, "la vista de B tampoco", fuga(B.vista));

  ok(A.vista.jugadores[1].mano.every((c) => c?.oculta), "A ve la mano de B tapada");
  ok(A.vista.jugadores[0].mano.every((c) => c?.oculta), "y la suya propia también: así se juega");
  ok(B.vista.jugadores[0].mano.every((c) => c?.oculta), "B ve la mano de A tapada");

  ok(!("mazo" in A.vista) && !("descarte" in A.vista), "la vista no lleva mazo ni pila de descarte");
  ok(typeof A.vista.cartasEnMazo === "number", "del mazo sólo se sabe cuántas quedan", A.vista.cartasEnMazo);
  ok(A.vista.muestra?.id, "la muestra sí se ve: está boca arriba en la mesa", A.vista.muestra?.id);

  // Las dos vistas son distintas entre sí. Si fueran iguales, alguien estaría
  // recibiendo la del otro.
  ok(JSON.stringify(A.vista) !== JSON.stringify(B.vista), "las dos vistas no son la misma");
  ok(A.vista.yo !== B.vista.yo, "y no se pueden confundir");
}

// ==================================================== 3. una acción de A

console.log("\n=== 3. A juega, el servidor procesa, los dos se enteran ===");
{
  const vistasDeAantes = A.recibidas.length;
  const vistasDeBantes = B.recibidas.length;
  const versionAntes = A.vista.version;

  // A mira una carta suya. Es la primera acción de la ronda.
  const r = await capturar(() => red.accionDeTurno({
    uid: "ana", codigo: CODIGO, accion: "mirar", clientActionId: "a-mira-1", posicion: 2,
  }));
  ok(r.valor && !r.error, "el servidor acepta la acción", r.error?.message);

  ok(A.recibidas.length === vistasDeAantes + 1, "A recibe una vista nueva", A.recibidas.length);
  ok(B.recibidas.length === vistasDeBantes + 1, "B también, aunque no jugó él", B.recibidas.length);
  ok(A.vista.version > versionAntes, "la versión subió", [versionAntes, A.vista.version]);
  ok(A.vista.version === B.vista.version, "y las dos vistas están en la misma versión");

  // Mirar es información privada de A: B no puede enterarse de qué carta vio.
  const maestro = db.leer(`partidas/${CODIGO}`);
  const mirada = maestro.estado.jugadores[0].mano[2];
  ok(!JSON.stringify(B.vista).includes(`"${mirada.id}"`),
     "B no ve la carta que miró A", mirada.id);
  ok(!JSON.stringify(A.vista).includes(`"${mirada.id}"`),
     "y tampoco viaja en la vista de A: la mira en su pantalla, no en el estado");

  // B no puede jugar por A.
  const suplantacion = await capturar(() => red.accionDeTurno({
    uid: "beto", codigo: CODIGO, accion: "levantar", clientActionId: "b-suplanta",
  }));
  ok(suplantacion.error, "B no puede jugar fuera de su turno ni de su fase", suplantacion.error?.message);

  // Un tercero que no está en la partida, tampoco.
  const ajeno = await capturar(() => red.accionDeTurno({
    uid: "colado", codigo: CODIGO, accion: "mirar", clientActionId: "x", posicion: 0,
  }));
  ok(ajeno.error?.codigo === "permission-denied", "un ajeno se rechaza", ajeno.error?.codigo);
}

// ======================================= 4. idempotencia extremo a extremo

console.log("\n=== 4. Un reintento no cuenta dos veces ===");
{
  const antes = A.recibidas.length;
  const repetida = await capturar(() => red.accionDeTurno({
    uid: "ana", codigo: CODIGO, accion: "mirar", clientActionId: "a-mira-1", posicion: 0,
  }));
  ok(repetida.valor?.duplicado === true, "el mismo identificador se reconoce", repetida.valor);
  ok(A.recibidas.length === antes, "y no genera ninguna vista nueva", A.recibidas.length - antes);
}

// ============================================ 5. una ronda con descarte

console.log("\n=== 5. La ventana de reflejos, de punta a punta ===");
{
  await red.accionDeTurno({ uid: "beto", codigo: CODIGO, accion: "mirar", clientActionId: "b-mira", posicion: 1 });
  await red.cerrarMirada({ codigo: CODIGO });
  ok(A.vista.fase === "descarte", "los dos pasan a la fase de descarte", A.vista.fase);

  const { ventana } = await red.abrirVentana({ codigo: CODIGO });
  ok(A.vista.ventana?.id === ventana.id, "A recibe el identificador de la ventana");
  ok(B.vista.ventana?.id === ventana.id, "B recibe el mismo");
  ok(A.vista.ventana.abiertaEn === 100000, "con la hora del SERVIDOR", A.vista.ventana.abiertaEn);
  ok(!("intentos" in A.vista.ventana), "pero no los intentos de nadie");

  // El caso que justifica todo el protocolo, con numeros coherentes:
  //
  //   B reacciona en el ms 250 y tiene 25 ms de latencia  -> llega en el 275
  //   A reacciona en el ms 120 y tiene 350 ms de latencia -> llega en el 470
  //
  // B LLEGA PRIMERO. Si el servidor resolviera por orden de llegada, ganaria
  // B. Pero A reaccionó 130 ms antes, y eso es lo que se mide.
  reloj = 100275;
  await capturar(() => red.intentarDescarte({
    uid: "beto", codigo: CODIGO, windowId: ventana.id, posicion: 0,
    clientActionId: "b-descarta", declarado: 250, latencia: 25, incertidumbre: 15,
  }));
  reloj = 100470;
  await capturar(() => red.intentarDescarte({
    uid: "ana", codigo: CODIGO, windowId: ventana.id, posicion: 0,
    clientActionId: "a-descarta", declarado: 120, latencia: 350, incertidumbre: 180,
  }));

  const anotados = db.leer(`partidas/${CODIGO}`).ventana.intentos;
  ok(anotados["b-descarta"].llegada < anotados["a-descarta"].llegada,
     "el pedido de B llegó primero al servidor",
     [anotados["b-descarta"].llegada, anotados["a-descarta"].llegada]);
  ok(anotados["a-descarta"].efectivo < anotados["b-descarta"].efectivo,
     "pero el tiempo efectivo de A es menor",
     [anotados["a-descarta"].efectivo, anotados["b-descarta"].efectivo]);

  ok(!JSON.stringify(A.vista).includes("b-descarta"), "A no se entera de que B intentó");
  ok(!JSON.stringify(B.vista).includes("a-descarta"), "ni B de que intentó A");

  reloj = trasLaGracia(db);
  const cierre = await red.cerrarVentana({ codigo: CODIGO });
  const orden = cierre.orden.map((o) => o.uid);
  ok(orden[0] === "ana",
     "y gana A, que reaccionó antes aunque su pedido llegó casi 200 ms después", orden);
  ok(A.vista.fase === "descarte" && B.vista.fase === "descarte",
     "los dos siguen en descarte durante la revelación", [A.vista.fase, B.vista.fase]);

  reloj += MS_REVELACION;
  await red.avanzarPartida({ codigo: CODIGO });
  ok(A.vista.fase === "turno" && B.vista.fase === "turno", "y pasados los 2 s avanzan a los turnos");
}

// ============================ 6. reconstruir el estado desde Firestore

console.log("\n=== 6. Reconstruir desde Firestore ===");
{
  // Se simula que el servidor se reinició: nada en memoria, todo del documento.
  const guardado = db.leer(`partidas/${CODIGO}`);
  const copia = JSON.parse(JSON.stringify(guardado));
  ok(JSON.stringify(copia) === JSON.stringify(guardado), "el maestro sobrevive el viaje por JSON");

  const antesDeLaVersion = A.vista.version;
  const enTurno = guardado.jugadores[guardado.estado.indiceTurno];
  const r = await capturar(() => red.accionDeTurno({
    uid: enTurno, codigo: CODIGO, accion: "levantar", clientActionId: "tras-reinicio",
  }));
  ok(r.valor?.fase === "levantada", "una acción sobre el estado reconstruido funciona", r.error?.message);
  ok(A.vista.version > antesDeLaVersion, "y publica vistas nuevas");

  // La carta levantada la ve SÓLO quien juega.
  const maestro = db.leer(`partidas/${CODIGO}`);
  const levantada = maestro.estado.levantada;
  const jugando = enTurno === "ana" ? A : B;
  const mirando = enTurno === "ana" ? B : A;
  ok(JSON.stringify(jugando.vista).includes(`"${levantada.id}"`),
     `${enTurno} ve la carta que levantó`, levantada.id);
  ok(!JSON.stringify(mirando.vista).includes(`"${levantada.id}"`),
     "y el otro no la ve, sólo sabe que la levantó");
  ok(mirando.vista.hayLevantada === true, "pero sí sabe que hay una levantada");
}

// ================================================ 7. nada raro guardado

console.log("\n=== 7. Lo guardado sigue siendo JSON puro ===");
{
  const malos = [];
  (function buscar(v, ruta) {
    if (typeof v === "function") return malos.push(`${ruta} función`);
    if (v instanceof Map || v instanceof Set || v instanceof Date) return malos.push(`${ruta} ${v.constructor.name}`);
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) buscar(x, `${ruta}.${k}`);
  })(db.leer(`partidas/${CODIGO}`), "maestro");
  ok(malos.length === 0, "el maestro no tiene nada no serializable", malos);

  for (const j of [A, B]) {
    const m = [];
    (function buscar(v, ruta) {
      if (typeof v === "function") return m.push(`${ruta} función`);
      if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) buscar(x, `${ruta}.${k}`);
    })(j.vista, `vista de ${j.uid}`);
    ok(m.length === 0, `la vista de ${j.uid} tampoco`, m);
  }

  ok(db.rutas().length === 3, "siguen siendo tres documentos y nada más", db.rutas());
}

// ================================================ 8. no se tocó una Leyenda

console.log("\n=== 8. Ninguna Leyenda se movió ===");
{
  ok(!db.rutas().some((r) => r.startsWith("users/")), "no se tocó ningún perfil");
  ok(!db.rutas().some((r) => r.startsWith("movimientos/")), "ni el libro mayor");
  ok(!db.rutas().some((r) => r.startsWith("rooms/")), "ni ninguna sala");

  const texto = JSON.stringify(db.leer(`partidas/${CODIGO}`));
  ok(!texto.includes("credits") && !texto.includes("pozo"),
     "el documento de partida no tiene nada económico dentro");
}

A.dejar(); B.dejar();

console.log(`\n  vistas recibidas por A: ${A.versiones.length} · versiones ${A.versiones.join(", ")}`);
console.log(`  vistas recibidas por B: ${B.versiones.length} · versiones ${B.versiones.join(", ")}`);
console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
