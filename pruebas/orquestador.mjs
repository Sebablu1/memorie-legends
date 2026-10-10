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

import { crearMotorEnRed, MS_MIRADA_TOTAL, MS_TURNO, MS_ENTRE_RONDAS } from "../functions/partida-red.js";
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
  await red.repartir({ yaSentados: true, codigo: CODIGO, jugadores: CUATRO, nombres: CUATRO });
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
  ok(plazo(db).hasta === 1000000 + MS_MIRADA_TOTAL, "que vence en MS_MIRADA_TOTAL", plazo(db).hasta);

  // D2: la ventana de descarte YA existe durante la mirada. Sin esto, la carta
  // que acabás de memorizar no se puede descartar aunque sea la muestra.
  const vInicial = db.leer(`partidas/${CODIGO}`).ventana;
  ok(Boolean(vInicial) && !vInicial.cerrada, "la ventana ya está abierta durante la mirada");
  ok(vInicial.abiertaEn === 1000000, "abierta en el reparto", vInicial.abiertaEn);
  ok(vInicial.duracionMs === MS_MIRADA_TOTAL + MS_VENTANA,
     "y dura los 2 s de mirada más los 5 de descarte", vInicial.duracionMs);

  // Golpear temprano no adelanta nada.
  const temprano = await red.avanzarPartida({ codigo: CODIGO });
  ok(temprano.hizo === null && temprano.motivo === "todavia_no", "temprano: no pasa nada", temprano);
  ok(fase(db) === "mirar", "la fase no se movió");

  // Golpear cien veces temprano tampoco.
  for (let i = 0; i < 100; i++) await red.avanzarPartida({ codigo: CODIGO });
  ok(fase(db) === "mirar", "cien golpes tempranos siguen sin mover nada", fase(db));

  reloj += MS_MIRADA_TOTAL;
  const cierre = await red.avanzarPartida({ codigo: CODIGO });
  ok(cierre.hizo === "cerrarMirada", "cumplido el plazo, se cierra la mirada", cierre);
  ok(fase(db) === "descarte", "la partida pasa a descarte", fase(db));

  // Y NO se abre una segunda: sigue corriendo la que nació con la mirada.
  const v = db.leer(`partidas/${CODIGO}`).ventana;
  ok(v && !v.cerrada, "la ventana sigue abierta");
  ok(v.id === vInicial.id, "y es la MISMA que la de la mirada", [v.id, vInicial.id]);
  ok(v.abiertaEn === 1000000, "conserva su hora de apertura original", v.abiertaEn);
  /*
   * Y EL PLAZO QUE SIGUE NO ES CERRARLA. (Etapa 3b/3)
   *
   * Era `cerrarVentana`, vencido al final de la ventana más la gracia. Ahora
   * no hay ningún reloj de reflejos: el único plazo que queda en `descarte`
   * es arrancar el turno CON la ventana abierta, y vence ya.
   */
  ok(plazo(db).que === "seguirTurno", "el plazo que sigue arranca el turno", plazo(db).que);
  ok(plazo(db).hasta === reloj, "y vence ya, sin esperar nada", plazo(db).hasta - reloj);
}

// ================================================ 2. cierre automático

console.log("\n=== 2. La ventana NO se cierra sola: la cierra el que tira ===");
{
  /*
   * ESTA SECCIÓN PROBABA LO CONTRARIO. (Etapa 3b/3)
   *
   * Probaba que la ventana vencía sola: ni a mitad, ni al terminar la
   * duración —faltaba la gracia—, y recién pasada la gracia se cerraba y
   * resolvía los intentos en orden de reacción, con dos segundos más de
   * revelación detrás.
   *
   * De eso no queda nada y es a propósito: en red la fase de reflejos no
   * tiene cronómetro. Lo que se prueba ahora es lo que la reemplaza, que son
   * dos cosas distintas:
   *
   *   - que el tiempo NO la cierre, por mucho que pase;
   *   - que la cierre el tiro del jugador en turno, que es lo que cambia la
   *     muestra, y que en el mismo acto abra la siguiente.
   */
  const { db, red } = await nueva();
  reloj += MS_MIRADA_TOTAL;
  await red.avanzarPartida({ codigo: CODIGO });
  const { id: ventanaId, abiertaEn } = db.leer(`partidas/${CODIGO}`).ventana;

  // Tres reaccionan en momentos distintos. Se aplican al llegar, así que no
  // queda nada que resolver después: lo que se mira es que el intento quede
  // anotado y con su tiempo.
  for (const [i, uid] of CUATRO.slice(0, 3).entries()) {
    const reacciona = 300 + i * 200;
    reloj = abiertaEn + reacciona + 40;
    await capturar(() => red.intentarDescarte({
      uid, codigo: CODIGO, windowId: ventanaId, posicion: i,
      clientActionId: `d${i}`, declarado: reacciona, latencia: 40, incertidumbre: 20,
    }));
  }
  const anotados = Object.values(db.leer(`partidas/${CODIGO}`).ventana.intentos);
  ok(anotados.length === 3, "los tres quedan anotados", anotados.length);
  ok(anotados.map((x) => x.efectivo).join(",") === "300,500,700",
     "cada uno con su tiempo de reacción", anotados.map((x) => x.efectivo));

  // Mucho después del viejo vencimiento —ventana más gracia— sigue abierta.
  reloj = abiertaEn + MS_VENTANA + MS_GRACIA + 60000;
  const tarde = await red.avanzarPartida({ codigo: CODIGO });
  ok(db.leer(`partidas/${CODIGO}`).ventana.cerrada === false,
     "un minuto después la ventana sigue abierta", db.leer(`partidas/${CODIGO}`).ventana.cerrada);
  ok(tarde.hizo !== "cerrarVentana", "y ningún plazo la cerró", tarde.hizo);

  // Un reflejo que reacciona en el segundo 60 entra igual: lo único que se le
  // pide es que la ventana sea la vigente y esté abierta.
  const dani = await capturar(() => red.intentarDescarte({
    uid: "dani", codigo: CODIGO, windowId: ventanaId, posicion: 3,
    clientActionId: "d-tarde", declarado: 60000, latencia: 40, incertidumbre: 20,
  }));
  ok(dani.valor?.anotado === true, "y uno nuevo se acepta, sin techo de tiempo",
     dani.error?.message);

  // Ahora sí: el del turno levanta y tira. Eso cambia la muestra.
  reloj += 10;
  await red.avanzarPartida({ codigo: CODIGO });       // seguirTurno
  const enTurno = CUATRO[db.leer(`partidas/${CODIGO}`).estado.indiceTurno];
  await red.accionDeTurno({ uid: enTurno, codigo: CODIGO, accion: "levantar", clientActionId: "lev" });
  await red.accionDeTurno({ uid: enTurno, codigo: CODIGO, accion: "tirar", clientActionId: "tir" });

  const despues = db.leer(`partidas/${CODIGO}`).ventana;
  ok(despues.id !== ventanaId, "el tiro abre una ventana nueva", [despues.id, ventanaId]);
  ok(despues.cerrada === false, "abierta, con la muestra recién puesta");
  ok(despues.abiertaEn === reloj, "y abierta en el instante del tiro", despues.abiertaEn - reloj);

  // La vieja no vuelve: un reflejo con su id ya no entra.
  const vieja = await capturar(() => red.intentarDescarte({
    uid: "caro", codigo: CODIGO, windowId: ventanaId, posicion: 2,
    clientActionId: "d-vieja", declarado: 100, latencia: 40, incertidumbre: 20,
  }));
  ok(vieja.error != null, "y la ventana vieja ya no acepta nada", vieja.valor);
}

// ======================================= 3. dos cierres simultáneos

console.log("\n=== 3. Los cuatro golpean a la vez ===");
{
  /*
   * El golpe simultáneo que se prueba acá ya no es el cierre de la ventana
   * —no existe—, sino el arranque del turno con la ventana abierta. Es la
   * misma garantía: cuatro clientes golpeando a la vez avanzan la mesa UNA
   * vez, no cuatro.
   */
  const { db, red } = await nueva();
  reloj += MS_MIRADA_TOTAL;
  await red.avanzarPartida({ codigo: CODIGO });
  ok(fase(db) === "descarte", "la mesa queda en descarte, con su ventana", fase(db));

  const golpes = await Promise.all(CUATRO.map(() => capturar(() => red.avanzarPartida({ codigo: CODIGO }))));
  const avanzaron = golpes.filter((g) => g.valor?.hizo === "seguirTurno");
  ok(avanzaron.length === 1, "una sola llamada arranca el turno", avanzaron.length);
  ok(fase(db) === "turno", "y la fase avanzó una sola vez", fase(db));
  ok(db.leer(`partidas/${CODIGO}`).ventana.cerrada === false,
     "con la ventana de reflejos todavía abierta");
  ok(db.leer(`partidas/${CODIGO}`).estado.turnosRonda === 0, "sin turnos de más", db.leer(`partidas/${CODIGO}`).estado.turnosRonda);

  // Y las que no avanzaron no rompieron nada: dijeron que no había qué hacer.
  const otras = golpes.filter((g) => g.valor?.hizo !== "seguirTurno");
  ok(otras.every((g) => g.valor && !g.error), "las otras tres contestan sin error",
     otras.map((g) => g.error?.message ?? g.valor?.motivo));
}

console.log("\n=== 3b. Cuatro golpes simultáneos sobre la mirada ===");
{
  const { db, red } = await nueva();
  reloj += MS_MIRADA_TOTAL;
  const golpes = await Promise.all(CUATRO.map(() => capturar(() => red.avanzarPartida({ codigo: CODIGO }))));
  const cerraron = golpes.filter((g) => g.valor?.hizo === "cerrarMirada");
  ok(cerraron.length === 1, "una sola cierra la mirada", cerraron.length);

  /*
   * Y a lo sumo otro arranca el turno. (Etapa 3b/3)
   *
   * Acá se pedía que la fase quedara en `descarte`. Dejó de ser cierto, y no
   * por un error: cerrada la mirada, el plazo que sigue —`seguirTurno`—
   * vence en el acto, así que uno de los otros tres golpes del mismo lote lo
   * cumple. Son dos plazos distintos cumplidos una vez cada uno, que es
   * exactamente lo que esta sección existe para comprobar.
   */
  const arrancaron = golpes.filter((g) => g.valor?.hizo === "seguirTurno");
  ok(arrancaron.length <= 1, "y a lo sumo uno arranca el turno", arrancaron.length);
  ok(db.leer(`partidas/${CODIGO}`).estado.turnosRonda === 0,
     "sin turnos de más", db.leer(`partidas/${CODIGO}`).estado.turnosRonda);
  ok(db.leer(`partidas/${CODIGO}`).estado.ronda === 1, "sin saltarse de ronda");
}

console.log("\n=== 3c. Nunca se abren dos ventanas ===");
{
  const { db, red } = await nueva();
  const antes = db.leer(`partidas/${CODIGO}`).ventana;
  reloj += MS_MIRADA_TOTAL;
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
  reloj += MS_MIRADA_TOTAL;
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
  const plazoAlCaer = db.leer(`partidas/${CODIGO}`).plazo;

  // Vuelve. La ventana es la misma: reconectarse no la reinicia.
  reloj = v.abiertaEn + 2000;
  const E2 = espectador(db, "ana");
  ok(E2.ultima.ventana.id === v.id, "al volver encuentra la MISMA ventana", E2.ultima.ventana.id === v.id);
  ok(E2.ultima.ventana.abiertaEn === v.abiertaEn, "con su hora de apertura original");
  /*
   * Y EL PLAZO TAMPOCO SE MUEVE. (Etapa 3b/3)
   *
   * Acá se comparaba con `vence(v)`, el vencimiento de la ventana. Ya no hay
   * tal cosa: el plazo vigente es el del turno del siguiente, que corre
   * mientras los reflejos siguen abiertos. La garantía que importa es la
   * misma de antes —reconectarse no corre ningún reloj— así que se compara
   * contra el plazo que había, sea cual sea.
   */
  ok(JSON.stringify(db.leer(`partidas/${CODIGO}`).plazo) === JSON.stringify(plazoAlCaer),
     "y el plazo no se corrió por reconectarse", db.leer(`partidas/${CODIGO}`).plazo);

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
  reloj += MS_MIRADA_TOTAL;
  await red.avanzarPartida({ codigo: CODIGO });   // cerrar la mirada
  // Y el turno arranca en el golpe siguiente, con la ventana abierta: ya no
  // hay que esperar a que venza ni a que pase la revelación. (Etapa 3b/3)
  await red.avanzarPartida({ codigo: CODIGO });   // seguirTurno

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
  ok(cambio.valor, "el 10 se dispara", cambio.error?.message);
  ok(cambio.valor.revelada?.propia?.id && cambio.valor.revelada?.rival?.id,
     "revela las dos cartas a quien lo usó", cambio.valor.revelada);

  // Y AHÍ SE DETIENE. Antes revelaba y cambiaba en la misma jugada, que es lo
  // mismo que no mostrar nada: ver algo que ya no podés usar para decidir no
  // es información. Ahora las cartas siguen donde estaban hasta que su dueño
  // conteste.
  const enEspera = db.leer(`partidas/${CODIGO}`).estado;
  ok(enEspera.fase === "cambioConVista", "y espera la decisión", enEspera.fase);
  ok(enEspera.jugadores[0].mano[0].id === mia.id, "sin haber cambiado nada todavía");
  ok(enEspera.jugadores[1].mano[2].id === suya.id, "en ninguna de las dos manos");

  // Que no lo resuelva otro. Hoy el dueño del cambio es el del turno, pero
  // atar el permiso al turno sería confiar en esa coincidencia.
  const resuelveOtro = await capturar(() => red.accionDeTurno({
    uid: "beto", codigo: CODIGO, accion: "resolverCambio", clientActionId: "r10x", objetivo: true,
  }));
  ok(Boolean(resuelveOtro.error), "y otro jugador no puede resolverlo", resuelveOtro.error?.message);

  const resuelto = await capturar(() => red.accionDeTurno({
    uid: "ana", codigo: CODIGO, accion: "resolverCambio", clientActionId: "r10", objetivo: true,
  }));
  ok(resuelto.valor, "el dueño sí", resuelto.error?.message);
  const luego = db.leer(`partidas/${CODIGO}`).estado;
  ok(luego.jugadores[0].mano[0].id === suya.id, "recién ahí se intercambian", luego.jugadores[0].mano[0].id);
  ok(luego.jugadores[1].mano[2].id === mia.id, "en las dos manos");
  ok(luego.fase === "postLevantada", "y vuelve a su decisión de cortar", luego.fase);
  ok(luego.cambioPendiente == null, "sin dejar el cambio colgado");
  ok(luego.jugadores.every((j) => j.mano.every((c) => c === null || c?.id)),
     "y no quedó ninguna carta fantasma en ninguna mano");

  // --- el 10 que decide NO cambiar ---
  await guardar(conPoder(10, "cambioConVista"));
  const antes2 = db.leer(`partidas/${CODIGO}`).estado;
  const mia2 = antes2.jugadores[0].mano[0];
  const suya2 = antes2.jugadores[1].mano[2];
  await red.accionDeTurno({
    uid: "ana", codigo: CODIGO, accion: "poderCambio", clientActionId: "p10b",
    posicion: 0, objetivo: { indice: 1, posicion: 2 },
  });
  await red.accionDeTurno({
    uid: "ana", codigo: CODIGO, accion: "resolverCambio", clientActionId: "r10b", objetivo: false,
  });
  const sinCambiar = db.leer(`partidas/${CODIGO}`).estado;
  ok(sinCambiar.jugadores[0].mano[0].id === mia2.id, "decir que no deja cada carta donde estaba");
  ok(sinCambiar.jugadores[1].mano[2].id === suya2.id, "en las dos manos");
  ok(sinCambiar.fase === "postLevantada", "y también vuelve a la decisión de cortar", sinCambiar.fase);

  // --- posiciones fuera de rango en el cambio ---
  await guardar(conPoder(9, "cambioCiego"));
  const roto = await capturar(() => red.accionDeTurno({
    uid: "ana", codigo: CODIGO, accion: "poderCambio", clientActionId: "p9x",
    posicion: 0, objetivo: { indice: 1, posicion: 77 },
  }));
  ok(Boolean(roto.error), "una posición inexistente no mete undefined en una mano", roto.error?.message);

  // --- saltar el poder ---
  await guardar(conPoder(7, "mirarPropia"));
  // El fixture ya trae una ventana de red abierta, así que no alcanza con
  // mirar si hay una: hay que comprobar que sea LA MISMA de antes.
  const ventanaAntes = db.leer(`partidas/${CODIGO}`).ventana?.id ?? null;
  const salta = await capturar(() => red.accionDeTurno({
    uid: "ana", codigo: CODIGO, accion: "saltarPoder", clientActionId: "ps",
  }));
  // Renunciar ya no reabre nada, y es un cambio deliberado. Antes sí reabría,
  // porque las cartas de poder salteaban la ventana y al renunciar había que
  // devolverle a la mesa los reflejos que el tiro le habría dado. Ahora la
  // ventana ocurre ANTES de que se decida el poder, siempre: la mesa ya
  // reaccionó, y abrir otra sería una segunda ventana por la misma carta.
  ok(salta.valor?.fase === "postLevantada", "el poder se puede no usar", salta.error?.message);
  ok(db.leer(`partidas/${CODIGO}`).estado.poderPendiente === null, "y queda descartado");
  ok(db.leer(`partidas/${CODIGO}`).estado.ventanaDescarte == null,
     "sin reabrir reflejos: la mesa ya tuvo los suyos antes de la decisión");
  const tras = db.leer(`partidas/${CODIGO}`).ventana?.id ?? null;
  ok(tras === ventanaAntes, "ni ventana de red nueva: quedó la que ya estaba",
     { antes: ventanaAntes, despues: tras });
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
  reloj += MS_MIRADA_TOTAL;
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

  reloj += MS_MIRADA_TOTAL;
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

  /*
   * Y beto lo ve EN EL MOMENTO. (Etapa 1/3)
   *
   * Acá se afirmaba lo contrario —«durante la ventana nadie ve nada: los
   * intentos no se resuelven hasta cerrarla»— y era cierto mientras todo se
   * aplicaba junto al cerrar.
   *
   * Es justamente lo que se vino a cambiar: el descarte sobre la mano propia
   * se aplica cuando llega, así que la carta se mueve y la mesa la ve. La
   * aserción no se afloja, se da vuelta: antes defendía que NO se viera,
   * ahora defiende que SÍ, que es la mitad visible del cambio.
   *
   * Lo que sigue oculto es quién intentó qué: `resumenDeVentana` no publica
   * los intentos. Lo que se ve es el efecto —una carta que se movió—, no la
   * carrera.
   */
  ok(JSON.stringify(mira.ultima).includes(`"${equivocada.id}"`),
     "beto ve la carta de ana en el momento, sin esperar al cierre");

  /*
   * LA EXPOSICIÓN DURA DOS SEGUNDOS, Y NO ESPERA NINGÚN CIERRE. (Etapa 3b/3)
   *
   * Acá se adelantaba el reloj hasta que la ventana vencía y se comprobaba
   * que la fase se quedara en `descarte` para que la carta se viera. Las dos
   * cosas se fueron: la ventana no vence y la fase ya está en el turno del
   * siguiente.
   *
   * Lo que queda es más simple y es la regla: la carta se destapa cuando el
   * descarte se APLICA, y se tapa dos segundos después, los mida quien los
   * mida. Se comprueba justo antes del borde.
   */
  reloj += MS_REVELACION - 1;
  await red.latir({ uid: "caro", codigo: CODIGO });

  const durante = mira.ultima;
  ok(durante.jugadores[0].mano[pos]?.id === equivocada.id,
     "a un milisegundo del borde, beto todavía la ve en su posición",
     durante.jugadores[0].mano[pos]);
  ok((durante.revelaciones ?? []).some((r) => r.carta?.id === equivocada.id),
     "que además viaja en el campo de revelaciones");

  // Y NADA MÁS. La de castigo entra al final de la mano boca abajo: se
  // mostraba, y el castigo pegaba dos veces —una carta más y una carta que
  // los otros tres podían descartarle en cuanto saliera su número—.
  const castigo = durante.jugadores[0].mano.length - 1;
  const otras = durante.jugadores[0].mano.filter((c, i) => i !== pos && c);
  ok(otras.every((c) => c.oculta), "el resto de la mano de ana sigue tapada", otras.length);
  ok(durante.jugadores[0].mano[castigo]?.oculta === true,
     "y la de castigo también", durante.jugadores[0].mano[castigo]);

  // Y el servidor republica por su cuenta al vencer la exposición: no hace
  // falta que pase nada más en la mesa. Ver `taparExpuestas` en `plazoDe`.
  reloj += 1;
  const tapo = await red.avanzarPartida({ codigo: CODIGO });
  ok(tapo.hizo === "taparExpuestas", "el servidor tapa solo al vencer los 2 s", tapo.hizo);

  const despues = mira.ultima;
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
