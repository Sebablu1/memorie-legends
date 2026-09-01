/**
 * El orquestador: quién decide cuándo termina una ventana.
 *
 * La respuesta corta es el servidor, y la larga es la que hay que probar:
 * en Firebase no existe un proceso vivo esperando a que venza un plazo, así
 * que alguien tiene que golpear la puerta. Los clientes golpean; el servidor
 * mira SU reloj y decide. Lo que hay que demostrar es que golpear no sirve
 * para nada más que preguntar:
 *
 *   - golpear temprano no adelanta la ventana;
 *   - golpear mil veces es igual que golpear una;
 *   - golpear a la vez no duplica ventanas, cierres ni rondas;
 *   - no golpear no congela la partida para siempre: el plazo sigue ahí.
 */

import { crearMotorEnRed, MS_MIRAR, MS_TURNO, MS_ENTRE_RONDAS } from "../functions/partida-red.js";
import { MS_VENTANA, MS_GRACIA } from "../public/js/reglas/red.js";
import { MS_REVELACION } from "../public/js/reglas/vista.js";

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
    intentos: 0,
    ganchoTrasLeer: null,
    collection: (n) => ({ doc: (id = `a${Math.random()}`) => ({ ruta: `${n}/${id}` }) }),
    async runTransaction(cuerpo) {
      for (let i = 0; i < 10; i++) {
        db.intentos++;
        const leidas = new Map(); const esc = [];
        const tx = {
          async get(ref) {
            const d = docs.get(ref.ruta);
            leidas.set(ref.ruta, d ? d.version : 0);
            if (db.ganchoTrasLeer) await db.ganchoTrasLeer(ref.ruta);
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
const CODIGO = "ORQ001";
let reloj = 1000000;

function montar() {
  const db = crearFirestore();
  const red = crearMotorEnRed({
    db, partidas: "partidas",
    ahora: () => reloj,
    idAleatorio: () => `v${reloj}_${Math.random().toString(36).slice(2, 6)}`,
    marcaDeTiempo: () => "T", error, semillaDe: () => 777,
  });
  return { db, red };
}

const capturar = async (fn) => {
  try { return { valor: await fn() }; } catch (e) { return { error: e }; }
};

/** Escucha la vista de un jugador, como haría su navegador. */
function espectador(db, uid) {
  const vistas = [];
  const dejar = db.escuchar(`partidas/${CODIGO}/vistas/${uid}`, (s) => { if (s.exists) vistas.push(s.data()); });
  return { uid, vistas, dejar, get ultima() { return vistas.at(-1); } };
}

async function nueva() {
  reloj = 1000000;
  const { db, red } = montar();
  await red.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: CUATRO });
  return { db, red };
}

const fase = (db) => db.leer(`partidas/${CODIGO}`).estado.fase;
const plazo = (db) => db.leer(`partidas/${CODIGO}`).plazo;

// ============================================== 1. apertura automática

console.log("\n=== 1. La mirada se cierra y la ventana se abre solas ===");
{
  const { db, red } = await nueva();
  ok(fase(db) === "mirar", "arranca en la mirada", fase(db));
  ok(plazo(db).que === "cerrarMirada", "con un plazo para cerrarla", plazo(db));
  ok(plazo(db).hasta === 1000000 + MS_MIRAR, "que vence en MS_MIRAR", plazo(db).hasta);

  // D2: la ventana de descarte YA existe durante la mirada. Sin esto, la carta
  // que acabás de memorizar no se puede descartar aunque sea la muestra.
  const vInicial = db.leer(`partidas/${CODIGO}`).ventana;
  ok(Boolean(vInicial) && !vInicial.cerrada, "la ventana ya está abierta durante la mirada");
  ok(vInicial.abiertaEn === 1000000, "abierta en el reparto", vInicial.abiertaEn);
  ok(vInicial.duracionMs === MS_MIRAR + MS_VENTANA,
     "y dura los 2 s de mirada más los 5 de descarte", vInicial.duracionMs);

  // Golpear temprano no adelanta nada.
  const temprano = await red.avanzarPartida({ codigo: CODIGO });
  ok(temprano.hizo === null && temprano.motivo === "todavia_no", "temprano: no pasa nada", temprano);
  ok(fase(db) === "mirar", "la fase no se movió");

  // Golpear cien veces temprano tampoco.
  for (let i = 0; i < 100; i++) await red.avanzarPartida({ codigo: CODIGO });
  ok(fase(db) === "mirar", "cien golpes tempranos siguen sin mover nada", fase(db));

  reloj += MS_MIRAR;
  const cierre = await red.avanzarPartida({ codigo: CODIGO });
  ok(cierre.hizo === "cerrarMirada", "cumplido el plazo, se cierra la mirada", cierre);
  ok(fase(db) === "descarte", "la partida pasa a descarte", fase(db));

  // Y NO se abre una segunda: sigue corriendo la que nació con la mirada.
  const v = db.leer(`partidas/${CODIGO}`).ventana;
  ok(v && !v.cerrada, "la ventana sigue abierta");
  ok(v.id === vInicial.id, "y es la MISMA que la de la mirada", [v.id, vInicial.id]);
  ok(v.abiertaEn === 1000000, "conserva su hora de apertura original", v.abiertaEn);
  ok(plazo(db).que === "cerrarVentana", "ahora sí hay plazo para cerrarla", plazo(db).que);
  ok(plazo(db).hasta === vence(v), "que vence pasada la gracia", plazo(db).hasta - v.abiertaEn);
}

// ================================================ 2. cierre automático

console.log("\n=== 2. La ventana se cierra sola y resuelve A/B/C ===");
{
  const { db, red } = await nueva();
  reloj += MS_MIRAR;
  await red.avanzarPartida({ codigo: CODIGO });
  await red.avanzarPartida({ codigo: CODIGO });
  const { id: ventanaId, abiertaEn } = db.leer(`partidas/${CODIGO}`).ventana;

  // Tres reaccionan en momentos distintos.
  for (const [i, uid] of CUATRO.slice(0, 3).entries()) {
    const reacciona = 300 + i * 200;
    reloj = abiertaEn + reacciona + 40;
    await capturar(() => red.intentarDescarte({
      uid, codigo: CODIGO, windowId: ventanaId, posicion: i,
      clientActionId: `d${i}`, declarado: reacciona, latencia: 40, incertidumbre: 20,
    }));
  }

  // A mitad de ventana todavía no se cierra.
  reloj = abiertaEn + MS_VENTANA - 1;
  const aMitad = await red.avanzarPartida({ codigo: CODIGO });
  ok(aMitad.hizo === null, "en plena ventana no se cierra", aMitad.motivo);

  // Ni al terminar la duración: falta la gracia para los paquetes lentos.
  reloj = abiertaEn + MS_VENTANA + 1;
  const enGracia = await red.avanzarPartida({ codigo: CODIGO });
  ok(enGracia.hizo === null, "durante la gracia tampoco, para no perder llegadas lentas", enGracia.motivo);

  reloj = vence(db.leer(`partidas/${CODIGO}`).ventana) + 1;
  const cierre = await red.avanzarPartida({ codigo: CODIGO });
  ok(cierre.hizo === "cerrarVentana", "pasada la gracia, se cierra sola", cierre.hizo);
  ok(cierre.orden.length === 3, "y resuelve los tres intentos", cierre.orden?.length);
  ok(cierre.orden[0].uid === "ana", "en orden de reacción", cierre.orden.map((o) => o.uid));
  ok(fase(db) === "descarte", "la fase se queda en descarte los 2 s de la revelación", fase(db));
  ok(db.leer(`partidas/${CODIGO}`).ventana.cerrada === true, "la ventana queda cerrada");
  ok(plazo(db).que === "cerrarRevelacion", "con un plazo para taparlas", plazo(db).que);

  reloj += MS_REVELACION;
  const tapar = await red.avanzarPartida({ codigo: CODIGO });
  ok(tapar.hizo === "cerrarRevelacion", "que vence y las tapa", tapar.hizo);
  ok(fase(db) === "turno", "y ahí sí la partida pasa a los turnos", fase(db));
  ok(db.leer(`partidas/${CODIGO}`).ventana === null, "y la ventana se retira");
}

// ======================================= 3. dos cierres simultáneos

console.log("\n=== 3. Los cuatro golpean a la vez ===");
{
  const { db, red } = await nueva();
  reloj += MS_MIRAR;
  await red.avanzarPartida({ codigo: CODIGO });
  await red.avanzarPartida({ codigo: CODIGO });
  const v = db.leer(`partidas/${CODIGO}`).ventana;
  reloj = vence(v) + 1;

  const golpes = await Promise.all(CUATRO.map(() => capturar(() => red.avanzarPartida({ codigo: CODIGO }))));
  const cerraron = golpes.filter((g) => g.valor?.hizo === "cerrarVentana");
  ok(cerraron.length === 1, "una sola llamada cierra la ventana", cerraron.length);
  ok(fase(db) === "descarte", "y la fase avanzó una sola vez", fase(db));
  reloj += MS_REVELACION;
  await red.avanzarPartida({ codigo: CODIGO });
  ok(fase(db) === "turno", "pasada la revelación, empieza el turno", fase(db));
  ok(db.leer(`partidas/${CODIGO}`).estado.turnosRonda === 0, "sin turnos de más", db.leer(`partidas/${CODIGO}`).estado.turnosRonda);

  // Y las que no cerraron no rompieron nada: dijeron que no había qué hacer.
  const otras = golpes.filter((g) => g.valor?.hizo !== "cerrarVentana");
  ok(otras.every((g) => g.valor && !g.error), "las otras tres contestan sin error",
     otras.map((g) => g.error?.message ?? g.valor?.motivo));
}

console.log("\n=== 3b. Cuatro golpes simultáneos sobre la mirada ===");
{
  const { db, red } = await nueva();
  reloj += MS_MIRAR;
  const golpes = await Promise.all(CUATRO.map(() => capturar(() => red.avanzarPartida({ codigo: CODIGO }))));
  const cerraron = golpes.filter((g) => g.valor?.hizo === "cerrarMirada");
  ok(cerraron.length === 1, "una sola cierra la mirada", cerraron.length);
  ok(fase(db) === "descarte", "y se avanzó una sola fase", fase(db));
  ok(db.leer(`partidas/${CODIGO}`).estado.ronda === 1, "sin saltarse de ronda");
}

console.log("\n=== 3c. Nunca se abren dos ventanas ===");
{
  const { db, red } = await nueva();
  const antes = db.leer(`partidas/${CODIGO}`).ventana;
  reloj += MS_MIRAR;
  await red.avanzarPartida({ codigo: CODIGO });

  const golpes = await Promise.all([...CUATRO, ...CUATRO].map(() =>
    capturar(() => red.avanzarPartida({ codigo: CODIGO }))));

  // Con D2 la ventana nace con la mirada, así que NINGÚN golpe la abre: ya
  // estaba. Que ninguno abra es más fuerte que el "exactamente uno" de antes,
  // porque un intento anotado durante la mirada moriría con la ventana vieja.
  const abrieron = golpes.filter((g) => g.valor?.hizo === "abrirVentana");
  ok(abrieron.length === 0, "ocho golpes simultáneos NO abren ninguna ventana", abrieron.length);
  ok(golpes.every((g) => g.valor && !g.error), "y ninguno falla",
     golpes.filter((g) => g.error).map((g) => g.error?.message));

  const v = db.leer(`partidas/${CODIGO}`).ventana;
  ok(v && !v.cerrada, "queda una sola, abierta");
  ok(v.id === antes.id, "la misma que nació con la mirada", [v.id, antes.id]);

  // La llamada explícita tampoco abre otra.
  const otra = await red.abrirVentana({ codigo: CODIGO });
  ok(otra.yaEstaba === true && otra.ventana.id === v.id, "abrirVentana devuelve la misma", otra.ventana.id === v.id);
}

// ============================================ 4. reconexión en ventana

console.log("\n=== 4. Reconexión en plena ventana ===");
{
  const { db, red } = await nueva();
  const E = espectador(db, "ana");
  reloj += MS_MIRAR;
  await red.avanzarPartida({ codigo: CODIGO });
  await red.avanzarPartida({ codigo: CODIGO });
  const v = db.leer(`partidas/${CODIGO}`).ventana;

  // Se cae en mitad de la ventana.
  reloj = v.abiertaEn + 1000;
  E.dejar();
  const vistasAlCaer = E.vistas.length;

  // Descarta otro mientras no está.
  await capturar(() => red.intentarDescarte({
    uid: "beto", codigo: CODIGO, windowId: v.id, posicion: 0,
    clientActionId: "b1", declarado: 900, latencia: 60, incertidumbre: 30,
  }));
  ok(E.vistas.length === vistasAlCaer, "desconectado no recibe nada");

  // Vuelve. La ventana es la misma: reconectarse no la reinicia.
  reloj = v.abiertaEn + 2000;
  const E2 = espectador(db, "ana");
  ok(E2.ultima.ventana.id === v.id, "al volver encuentra la MISMA ventana", E2.ultima.ventana.id === v.id);
  ok(E2.ultima.ventana.abiertaEn === v.abiertaEn, "con su hora de apertura original");
  ok(db.leer(`partidas/${CODIGO}`).plazo.hasta === vence(v),
     "y el plazo de cierre no se corrió");

  // Y todavía puede descartar, si le queda tiempo de reacción.
  const suyo = await capturar(() => red.intentarDescarte({
    uid: "ana", codigo: CODIGO, windowId: v.id, posicion: 1,
    clientActionId: "a1", declarado: 1950, latencia: 40, incertidumbre: 20,
  }));
  ok(suyo.valor?.anotado, "el que volvió todavía llega a descartar", suyo.error?.message);

  // Golpear al reconectar no cierra antes de tiempo.
  const golpe = await red.avanzarPartida({ codigo: CODIGO });
  ok(golpe.hizo === null, "y su golpe no cierra la ventana antes", golpe.motivo);
  E2.dejar();
}

// =========================================== 5. el turno se salta solo

console.log("\n=== 5. El reloj de turno ===");
{
  const { db, red } = await nueva();
  reloj += MS_MIRAR;
  await red.avanzarPartida({ codigo: CODIGO });
  await red.avanzarPartida({ codigo: CODIGO });
  const v = db.leer(`partidas/${CODIGO}`).ventana;
  reloj = vence(v) + 1;
  await red.avanzarPartida({ codigo: CODIGO });
  reloj += MS_REVELACION;
  await red.avanzarPartida({ codigo: CODIGO });

  ok(fase(db) === "turno", "empieza el turno", fase(db));
  const deQuien = db.leer(`partidas/${CODIGO}`).estado.indiceTurno;
  const venceEn = plazo(db).hasta;
  ok(venceEn === reloj + MS_TURNO, "con ocho segundos para levantar", venceEn - reloj);

  // Un latido NO reinicia el reloj de turno. Sin esto bastaría con respirar
  // para congelar la partida.
  reloj += 3000;
  await red.latir({ uid: CUATRO[deQuien], codigo: CODIGO });
  ok(plazo(db).hasta === venceEn, "un latido no corre el plazo del turno", plazo(db).hasta - venceEn);

  reloj = venceEn + 1;
  const salto = await red.avanzarPartida({ codigo: CODIGO });
  ok(salto.hizo === "saltarTurno", "vencido el reloj, se le salta el turno", salto.hizo);
  ok(db.leer(`partidas/${CODIGO}`).estado.indiceTurno !== deQuien, "y le toca a otro");
  ok(fase(db) === "turno", "que tiene su propio reloj", fase(db));
  ok(plazo(db).hasta > reloj, "reiniciado para él", plazo(db).hasta - reloj);
}

// ================================================ 6. poderes

console.log("\n=== 6. Poderes 7, 8, 9 y 10 ===");
{
  const { db, red } = await nueva();
  // Se lleva la partida a mano hasta la fase de poder, con una carta puesta.
  const partida = db.leer(`partidas/${CODIGO}`);
  const conPoder = (numero, tipo) => ({
    ...partida,
    estado: {
      ...partida.estado,
      fase: "poder",
      indiceTurno: 0,
      poderPendiente: { numero, tipo, indiceJugador: 0 },
    },
  });

  const guardar = async (p) => db.runTransaction(async (tx) => {
    tx.set({ ruta: `partidas/${CODIGO}` }, { ...p, version: (p.version ?? 1) + 1 });
  });

  // --- 8: mirar la carta de un rival ---
  await guardar(conPoder(8, "mirarRival"));
  const ajeno = await capturar(() => red.accionDeTurno({
    uid: "beto", codigo: CODIGO, accion: "poderMirar", clientActionId: "p1",
    posicion: 0, objetivo: { indice: 2 },
  }));
  ok(/no es tuyo|No es tu turno/i.test(ajeno.error?.message ?? ""),
     "otro jugador no puede disparar un poder ajeno", ajeno.error?.message);

  const mirar8 = await capturar(() => red.accionDeTurno({
    uid: "ana", codigo: CODIGO, accion: "poderMirar", clientActionId: "p2",
    posicion: 1, objetivo: { indice: 2 },
  }));
  ok(mirar8.valor?.carta?.id, "el dueño del poder sí, y recibe la carta", mirar8.valor?.carta?.id);
  ok(fase(db) === "postLevantada", "y la partida avanza", fase(db));

  // La carta mirada NO queda en ninguna vista.
  const idMirada = mirar8.valor.carta.id;
  const enVistas = CUATRO.some((u) => JSON.stringify(db.leer(`partidas/${CODIGO}/vistas/${u}`)).includes(`"${idMirada}"`));
  ok(!enVistas, "y no queda escrita en ninguna vista", idMirada);

  // --- posiciones fuera de rango ---
  await guardar(conPoder(8, "mirarRival"));
  for (const malo of [{ posicion: 99, objetivo: { indice: 1 } },
                      { posicion: -1, objetivo: { indice: 1 } },
                      { posicion: 0, objetivo: { indice: 99 } },
                      { posicion: 0, objetivo: {} }]) {
    const r = await capturar(() => red.accionDeTurno({
      uid: "ana", codigo: CODIGO, accion: "poderMirar", clientActionId: `x${Math.random()}`, ...malo,
    }));
    ok(Boolean(r.error), `se rechaza ${JSON.stringify(malo)}`, r.error?.message);
  }

  // --- 10: cambio con vista ---
  await guardar(conPoder(10, "cambioConVista"));
  const antes = db.leer(`partidas/${CODIGO}`).estado;
  const mia = antes.jugadores[0].mano[0];
  const suya = antes.jugadores[1].mano[2];
  const cambio = await capturar(() => red.accionDeTurno({
    uid: "ana", codigo: CODIGO, accion: "poderCambio", clientActionId: "p10",
    posicion: 0, objetivo: { indice: 1, posicion: 2 },
  }));
  ok(cambio.valor, "el cambio se aplica", cambio.error?.message);
  const luego = db.leer(`partidas/${CODIGO}`).estado;
  ok(luego.jugadores[0].mano[0].id === suya.id, "las cartas se intercambiaron", luego.jugadores[0].mano[0].id);
  ok(luego.jugadores[1].mano[2].id === mia.id, "en las dos manos");
  ok(luego.jugadores.every((j) => j.mano.every((c) => c === null || c?.id)),
     "y no quedó ninguna carta fantasma en ninguna mano");
  ok(cambio.valor.revelada?.propia?.id && cambio.valor.revelada?.rival?.id,
     "el 10 revela las dos cartas a quien lo usó", cambio.valor.revelada);

  // --- posiciones fuera de rango en el cambio ---
  await guardar(conPoder(9, "cambioCiego"));
  const roto = await capturar(() => red.accionDeTurno({
    uid: "ana", codigo: CODIGO, accion: "poderCambio", clientActionId: "p9x",
    posicion: 0, objetivo: { indice: 1, posicion: 77 },
  }));
  ok(Boolean(roto.error), "una posición inexistente no mete undefined en una mano", roto.error?.message);

  // --- saltar el poder ---
  await guardar(conPoder(7, "mirarPropia"));
  const salta = await capturar(() => red.accionDeTurno({
    uid: "ana", codigo: CODIGO, accion: "saltarPoder", clientActionId: "ps",
  }));
  // Renunciar al poder deja la carta como una carta más, y esa carta ya es la
  // muestra: la mesa recupera sus reflejos, igual que con cualquier tiro.
  ok(salta.valor?.fase === "descarte", "el poder se puede no usar", salta.error?.message);
  ok(db.leer(`partidas/${CODIGO}`).estado.poderPendiente === null, "y queda descartado");
  ok(db.leer(`partidas/${CODIGO}`).estado.ventanaDescarte?.volverA === "postLevantada",
     "con reflejos abiertos que devuelven a su decisión de cortar");
  const tras = db.leer(`partidas/${CODIGO}`).ventana;
  ok(Boolean(tras) && !tras.cerrada, "y su ventana de red", tras?.cerrada);
}

// ============================================ 7. corte y fin de ronda

console.log("\n=== 7. Corte, resolución y ronda siguiente ===");
{
  const { db, red } = await nueva();
  const E = CUATRO.map((u) => espectador(db, u));
  const partida = db.leer(`partidas/${CODIGO}`);

  // Se lleva a postLevantada para poder cortar.
  await db.runTransaction(async (tx) => {
    tx.set({ ruta: `partidas/${CODIGO}` }, {
      ...partida,
      estado: { ...partida.estado, fase: "postLevantada", indiceTurno: 0 },
      version: partida.version + 1,
    });
  });

  const ajeno = await capturar(() => red.accionDeTurno({
    uid: "beto", codigo: CODIGO, accion: "cortar", clientActionId: "c-ajeno",
  }));
  ok(/No es tu turno/.test(ajeno.error?.message ?? ""), "sólo corta el que tiene el turno", ajeno.error?.message);

  // Dos cortes simultáneos del mismo jugador: uno solo prospera.
  const dobles = await Promise.all([
    capturar(() => red.accionDeTurno({ uid: "ana", codigo: CODIGO, accion: "cortar", clientActionId: "c1" })),
    capturar(() => red.accionDeTurno({ uid: "ana", codigo: CODIGO, accion: "cortar", clientActionId: "c2" })),
  ]);
  const cortaron = dobles.filter((d) => d.valor && !d.valor.duplicado);
  ok(cortaron.length === 1, "dos cortes simultáneos cortan una vez", cortaron.length);

  const tras = db.leer(`partidas/${CODIGO}`);
  ok(["finRonda", "finPartida"].includes(tras.estado.fase), "la ronda termina", tras.estado.fase);
  ok(tras.estado.indiceCortador === 0, "queda anotado quién cortó", tras.estado.indiceCortador);
  ok(tras.estado.jugadores.some((j) => j.puntos > 0 || j.puntosRonda >= 0), "se resolvieron los puntajes");

  // Al terminar la ronda se destapa todo, para todos.
  for (const e of E) {
    const destapadas = e.ultima.jugadores.flatMap((j) => j.mano).filter((c) => c && !c.oculta);
    ok(destapadas.length > 0, `${e.uid} ve las manos reveladas al final de la ronda`, destapadas.length);
    ok(e.ultima.puntosDeMano !== null, "y los puntos de cada mano");
  }

  if (tras.estado.fase === "finRonda") {
    ok(plazo(db).que === "siguienteRonda", "hay plazo para la ronda siguiente", plazo(db).que);

    const temprano = await red.avanzarPartida({ codigo: CODIGO });
    ok(temprano.hizo === null, "no se reparte antes de tiempo", temprano.motivo);

    reloj += MS_ENTRE_RONDAS;
    const golpes = await Promise.all(CUATRO.map(() => capturar(() => red.avanzarPartida({ codigo: CODIGO }))));
    const repartieron = golpes.filter((g) => g.valor?.hizo === "siguienteRonda");
    ok(repartieron.length === 1, "cuatro golpes reparten UNA ronda", repartieron.length);

    const dos = db.leer(`partidas/${CODIGO}`);
    ok(dos.estado.ronda === 2, "se avanzó exactamente una ronda", dos.estado.ronda);
    ok(dos.estado.fase === "mirar", "y arranca en la mirada", dos.estado.fase);

    // La ronda nueva estrena ventana propia, abierta con SU mirada. Lo que no
    // puede pasar es que herede la de la ronda anterior: un intento viejo
    // seguiría vivo y se resolvería contra una mano que ya cambió.
    ok(dos.ventana && !dos.ventana.cerrada, "la ronda nueva abre su ventana");
    ok(dos.ventana.abiertaEn === reloj, "en el momento de repartirla", dos.ventana.abiertaEn);
    ok(dos.ventana.id !== partida.ventana.id, "y NO es la de la ronda anterior",
       [dos.ventana.id, partida.ventana.id]);
    ok(Object.keys(dos.ventana.intentos).length === 0, "sin intentos heredados");
    ok(Object.keys(dos.aplicadas ?? {}).length === 0, "y las jugadas recordadas se limpiaron");
    ok(dos.estado.semilla !== tras.estado.semilla, "la semilla avanzó al repartir de nuevo");

    // Las manos vuelven a estar tapadas.
    const tapadas = E[0].ultima.jugadores.flatMap((j) => j.mano).every((c) => c?.oculta);
    ok(tapadas, "y las cartas vuelven a estar tapadas para todos");
  }
  E.forEach((e) => e.dejar());
}

// ============================================ 8. final de partida

console.log("\n=== 8. Final de partida ===");
{
  const { db, red } = await nueva();
  const partida = db.leer(`partidas/${CODIGO}`);
  // Tres ya pasados de 150 y eliminados; el cuarto corta y gana.
  await db.runTransaction(async (tx) => {
    tx.set({ ruta: `partidas/${CODIGO}` }, {
      ...partida,
      estado: {
        ...partida.estado,
        fase: "postLevantada",
        indiceTurno: 0,
        jugadores: partida.estado.jugadores.map((j, i) =>
          i === 0 ? { ...j, puntos: 10 } : { ...j, puntos: 200, eliminado: true, eliminadoEnRonda: 1 }),
      },
      version: partida.version + 1,
    });
  });

  await red.accionDeTurno({ uid: "ana", codigo: CODIGO, accion: "cortar", clientActionId: "final" });
  const fin = db.leer(`partidas/${CODIGO}`);
  ok(fin.estado.fase === "finPartida", "la partida termina", fin.estado.fase);
  ok(fin.estado.ganador?.id === "ana", "con su ganador", fin.estado.ganador?.id);
  // Ya no queda "sin plazo": una partida terminada pide su cierre. Eso se
  // comprueba abajo.

  // Antes esta prueba afirmaba que golpear una partida terminada "no hace
  // nada", y eso era exactamente el bug: la partida se quedaba viva para
  // siempre con el pozo retenido. Ahora `finPartida` tiene su propio plazo.
  ok(plazo(db)?.que === "cerrarPartida", "una partida terminada pide su cierre", plazo(db));

  const temprano = await red.avanzarPartida({ codigo: CODIGO });
  ok(temprano.hizo === null, "pero no se cierra antes de tiempo", temprano.motivo);

  // Este montaje no tiene las primitivas de cierre inyectadas: se comprueba
  // que lo diga en vez de fingir que no había nada que hacer.
  reloj += 10000;
  const sinCierre = await red.avanzarPartida({ codigo: CODIGO });
  ok(sinCierre.motivo === "sin_cierre_configurado",
     "sin economía configurada, el motor lo dice claramente", sinCierre);
  ok(db.leer(`partidas/${CODIGO}`).estado.ronda === fin.estado.ronda, "no se reparte otra ronda");

  // Y no se puede seguir jugando.
  const tarde = await capturar(() => red.accionDeTurno({
    uid: "ana", codigo: CODIGO, accion: "levantar", clientActionId: "tarde",
  }));
  ok(Boolean(tarde.error), "ni jugar", tarde.error?.message);
}

// ============================================ 9. sigue todo en orden

console.log("\n=== 9. El estado sigue sano después de todo esto ===");
{
  const { db, red } = await nueva();
  reloj += MS_MIRAR;
  await red.avanzarPartida({ codigo: CODIGO });
  await red.avanzarPartida({ codigo: CODIGO });
  const v = db.leer(`partidas/${CODIGO}`).ventana;
  reloj = vence(v) + 1;
  await red.avanzarPartida({ codigo: CODIGO });
  reloj += MS_REVELACION;
  await red.avanzarPartida({ codigo: CODIGO });

  const maestro = db.leer(`partidas/${CODIGO}`);
  const malos = [];
  (function buscar(x, ruta) {
    if (typeof x === "function") return malos.push(`${ruta} función`);
    if (x instanceof Map || x instanceof Set || x instanceof Date) return malos.push(`${ruta} ${x.constructor.name}`);
    if (x && typeof x === "object") for (const [k, y] of Object.entries(x)) buscar(y, `${ruta}.${k}`);
  })(maestro, "partida");
  ok(malos.length === 0, "el maestro sigue siendo JSON puro", malos);
  ok(typeof maestro.estado.semilla === "number", "la semilla sigue siendo un número");
  ok(typeof maestro.plazo.hasta === "number", "y el plazo también");

  // Sin filtraciones en ninguna vista.
  let fugas = 0;
  for (const uid of CUATRO) {
    const texto = JSON.stringify(db.leer(`partidas/${CODIGO}/vistas/${uid}`));
    for (const c of maestro.estado.mazo) if (texto.includes(`"${c.id}"`)) fugas++;
    for (const j of maestro.estado.jugadores) for (const c of j.mano) if (c && texto.includes(`"${c.id}"`)) fugas++;
  }
  ok(fugas === 0, "y ninguna vista filtra una carta", fugas);

  const versiones = CUATRO.map((u) => db.leer(`partidas/${CODIGO}/vistas/${u}`).version);
  ok(new Set(versiones).size === 1, "los cuatro en la misma versión", versiones);
  ok(db.rutas().length === 5, "cinco documentos: el maestro y cuatro vistas", db.rutas().length);
}

// ============================== 11. la carta mal descartada se ve, y se tapa

/**
 * La regla dice que quien se equivoca expone su carta a TODA la mesa un
 * momento. Eso no puede quedarse en el motor: tiene que llegar a la vista de
 * los demás, que es lo único que un jugador recibe.
 *
 * Y tiene que irse. Si sobreviviera, la posición quedaría marcada para
 * siempre y el juego dejaría de depender de la memoria.
 */
console.log("\n=== 11. Lo que se expone se ve, y después se tapa ===");
{
  const { db, red } = await nueva();
  const mira = espectador(db, "beto");          // beto NO es el que se equivoca

  reloj += MS_MIRAR;
  await red.avanzarPartida({ codigo: CODIGO }); // cierra la mirada
  await red.avanzarPartida({ codigo: CODIGO }); // abre la ventana

  const maestro = () => db.leer(`partidas/${CODIGO}`);
  const v = maestro().ventana;
  const muestra = maestro().estado.descarte[0];

  // Ana toca una carta que no coincide: fallo garantizado.
  const manoDeAna = maestro().estado.jugadores[0].mano;
  const pos = manoDeAna.findIndex((c) => c && c.numero !== muestra.numero);
  const equivocada = manoDeAna[pos];
  ok(Boolean(equivocada), "ana tiene una carta que no sirve para descartar");

  reloj = v.abiertaEn + 700;
  await red.intentarDescarte({
    uid: "ana", codigo: CODIGO, windowId: v.id, posicion: pos,
    clientActionId: "mal-1", declarado: 700, latencia: 40, incertidumbre: 20,
  });

  // Mientras la ventana sigue abierta nadie ve nada: los intentos no se
  // resuelven hasta cerrarla.
  ok(!JSON.stringify(mira.ultima).includes(`"${equivocada.id}"`),
     "durante la ventana, beto todavía no ve la carta de ana");

  reloj = vence(v) + 1;
  await red.avanzarPartida({ codigo: CODIGO });

  const durante = mira.ultima;
  ok(durante.fase === "descarte", "cerrada la ventana, la fase se queda en descarte", durante.fase);
  ok(durante.jugadores[0].mano[pos]?.id === equivocada.id,
     "y beto SÍ ve la carta que ana descartó mal, en su posición",
     durante.jugadores[0].mano[pos]);
  ok((durante.revelaciones ?? []).some((r) => r.carta?.id === equivocada.id),
     "que además viaja en el campo de revelaciones");

  // Las demás cartas de ana siguen tapadas: se expone una, no la mano.
  const otras = durante.jugadores[0].mano.filter((c, i) => i !== pos && c);
  ok(otras.every((c) => c.oculta), "el resto de la mano de ana sigue tapada", otras.length);

  reloj += MS_REVELACION;
  await red.avanzarPartida({ codigo: CODIGO });

  const despues = mira.ultima;
  ok(despues.fase === "turno", "pasados los 2 segundos empieza el turno", despues.fase);
  ok(!JSON.stringify(despues).includes(`"${equivocada.id}"`),
     "y la carta desaparece de la vista: no queda ninguna marca");
  ok((despues.revelaciones ?? []).length === 0, "sin revelaciones en pie");

  // Ni siquiera reconstruyendo desde cero: lo guardado tampoco la expone.
  const vistaNueva = db.leer(`partidas/${CODIGO}/vistas/beto`);
  ok(!JSON.stringify(vistaNueva).includes(`"${equivocada.id}"`),
     "quien entre después tampoco la encuentra");

  mira.dejar();
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
