/**
 * La mesa en modo Leyendas.
 *
 * Cubre lo que la mesa hace con lo que recibe, sin navegador:
 *
 *   - el adaptador que convierte una vista en lo que `dibujar()` ya sabe pintar;
 *   - el filtro de versiones fuera de orden;
 *   - cuatro jugadores en una partida completa;
 *   - una desconexión y su reconexión;
 *   - que nada de eso filtre una carta.
 */

import { crearMotorEnRed } from "../functions/partida-red.js";
import { crearFiltroDeVersion, elegibleParaPoder, pasoDelPoder } from "../public/js/reglas/red.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

class E extends Error { constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; } }
const error = (codigo, mensaje) => new E(codigo, mensaje);

/**
 * El adaptador de la mesa, copiado de `mesa.js`.
 *
 * Está duplicado a propósito y con los ojos abiertos: `mesa.js` importa el
 * DOM y no se puede cargar en Node. La prueba de que las dos copias no se
 * separen está al final del archivo, comparando el texto de la función.
 */
function comoEstado(vista) {
  const tapada = { oculta: true };
  const restoDelDescarte = Math.max(0, (vista.cartasEnDescarte ?? 1) - 1);
  return {
    fase: vista.fase,
    ronda: vista.ronda,
    indiceMano: vista.indiceMano,
    indiceTurno: vista.indiceTurno,
    turnosRonda: vista.turnosRonda,
    indiceCortador: vista.indiceCortador,
    desempate: vista.desempate,
    registro: vista.registro ?? [],
    jugadores: vista.jugadores,
    descarte: vista.muestra
      ? [vista.muestra, ...Array.from({ length: restoDelDescarte }, () => tapada)]
      : [],
    mazo: Array.from({ length: vista.cartasEnMazo ?? 0 }, () => tapada),
    levantada: vista.levantada ?? null,
    poderPendiente: vista.poderPendiente ?? null,
    ganador: null,
    eventos: [],
  };
}

// ================================================ Firestore con escucha

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
        for (const e of esc) avisar(e.ruta);
        return res;
      }
      throw error("aborted", "Demasiados reintentos.");
    },
  };
  db.escuchar = (ruta, fn) => {
    if (!oyentes.has(ruta)) oyentes.set(ruta, new Set());
    oyentes.get(ruta).add(fn);
    if (docs.has(ruta)) fn({ exists: true, data: () => structuredClone(docs.get(ruta).datos) });
    return () => oyentes.get(ruta).delete(fn);
  };
  db.leer = (ruta) => docs.get(ruta)?.datos;
  db.rutas = () => [...docs.keys()];
  return db;
}

/** Un navegador: escucha su vista, la filtra por versión y la adapta. */
function mesa(db, codigo, uid) {
  const esNueva = crearFiltroDeVersion();
  const m = {
    uid,
    pintadas: [],
    descartadas: 0,
    estado: null,
    vista: null,
    conectada: true,
  };
  const alRecibir = (snap) => {
    if (!snap.exists) return;
    const vista = snap.data();
    if (!esNueva(vista)) { m.descartadas++; return; }
    m.vista = vista;
    m.estado = comoEstado(vista);
    m.pintadas.push(vista.version);
  };
  m.conectar = () => { m.dejar = db.escuchar(`partidas/${codigo}/vistas/${uid}`, alRecibir); m.conectada = true; };
  m.desconectar = () => { m.dejar?.(); m.conectada = false; };
  m.recibir = alRecibir;
  m.conectar();
  return m;
}

// ================================================================ montaje

let reloj = 100000;
const CUATRO = ["ana", "beto", "caro", "dani"];
const CODIGO = "MESA01";

function montar(jugadores = CUATRO) {
  const db = crearFirestore();
  const red = crearMotorEnRed({
    db, partidas: "partidas",
    ahora: () => reloj, idAleatorio: () => `w${reloj}`,
    marcaDeTiempo: () => "T", error, semillaDe: () => 4242,
  });
  return { db, red, jugadores };
}

const capturar = async (fn) => {
  try { return { valor: await fn() }; } catch (e) { return { error: e }; }
};

// ==================================================== 1. el adaptador

console.log("\n=== 1. La vista se convierte en algo dibujable ===");
{
  reloj = 100000;
  const { db, red } = montar();
  const M = CUATRO.map((u) => mesa(db, CODIGO, u));
  await red.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: CUATRO });

  const e = M[0].estado;
  ok(e.jugadores.length === 4, "la mesa ve cuatro jugadores", e.jugadores.length);
  ok(e.mazo.length === 48 - 16 - 1, "el contador del mazo cuadra", e.mazo.length);
  ok(e.mazo.every((c) => c.oculta), "pero son marcadores tapados, no cartas");
  ok(e.descarte[0]?.id, "la muestra sí tiene identidad: está boca arriba", e.descarte[0]?.id);
  ok(e.descarte.length === M[0].vista.cartasEnDescarte, "y el tamaño de la pila coincide");
  ok(e.fase === "mirar" && e.ronda === 1, "fase y ronda", [e.fase, e.ronda]);
  ok(e.levantada === null, "no hay carta levantada todavía");

  // Lo que la mesa dibuja no puede tener una carta ajena.
  const maestro = db.leer(`partidas/${CODIGO}`);
  const texto = JSON.stringify(e);
  const fugas = [];
  for (const c of maestro.estado.mazo) if (texto.includes(`"${c.id}"`)) fugas.push(c.id);
  for (const j of maestro.estado.jugadores) for (const c of j.mano) if (c && texto.includes(`"${c.id}"`)) fugas.push(c.id);
  ok(fugas.length === 0, "lo que la mesa va a dibujar no contiene ninguna carta oculta", fugas);

  M.forEach((m) => m.desconectar());
}

// ============================================ 2. versiones fuera de orden

console.log("\n=== 2. Versiones repetidas y fuera de orden ===");
{
  const filtro = crearFiltroDeVersion();
  const acepta = (v) => filtro({ version: v });

  ok(acepta(1) === true, "la primera se acepta");
  ok(acepta(2) === true, "la siguiente también");
  ok(acepta(2) === false, "la repetida se descarta");
  ok(acepta(1) === false, "una vieja se descarta");
  ok(acepta(3) === true, "y se sigue avanzando");
  ok(acepta(7) === true, "un salto hacia adelante se acepta: hubo cambios que no vimos");
  ok(acepta(5) === false, "pero no se vuelve atrás", "5 tras 7");
  ok(filtro({}) === true, "una vista sin versión se acepta: no hay con qué compararla");
  ok(acepta(8) === true, "y eso no bajó el listón");
  ok(acepta(4) === false, "la 4 sigue siendo vieja");

  // Ahora contra una mesa de verdad: se le entregan las mismas vistas al revés.
  reloj = 100000;
  const { db, red } = montar();
  const M = mesa(db, CODIGO, "ana");
  await red.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: CUATRO });
  await red.accionDeTurno({ uid: "ana", codigo: CODIGO, accion: "mirar", clientActionId: "m1", posicion: 0 });
  const pintadasAntes = [...M.pintadas];
  ok(pintadasAntes.length === 2, "se pintaron dos vistas", pintadasAntes);

  // Firestore reentrega una vista vieja tras una reconexión.
  const vieja = { version: pintadasAntes[0], fase: "mirar", ronda: 1, jugadores: [], cartasEnMazo: 0 };
  M.recibir({ exists: true, data: () => vieja });
  ok(M.pintadas.length === 2, "la vista vieja no se pinta", M.pintadas);
  ok(M.descartadas === 1, "queda contada como descartada", M.descartadas);
  ok(M.estado.jugadores.length === 4, "y la mesa sigue mostrando lo último bueno");
  M.desconectar();
}

// ================================================ 3. cuatro jugadores

console.log("\n=== 3. Cuatro jugadores, una ronda completa ===");
{
  reloj = 100000;
  const { db, red } = montar();
  const M = CUATRO.map((u) => mesa(db, CODIGO, u));
  await red.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: CUATRO });

  ok(M.every((m) => m.pintadas.length === 1), "los cuatro reciben su vista inicial",
     M.map((m) => m.pintadas.length));
  ok(new Set(M.map((m) => m.vista.yo)).size === 4, "y cada uno tiene un lugar distinto",
     M.map((m) => m.vista.yo));

  // Cada uno mira una carta. El servidor le devuelve la suya, y sólo a él.
  for (const [i, uid] of CUATRO.entries()) {
    const r = await red.accionDeTurno({ uid, codigo: CODIGO, accion: "mirar", clientActionId: `mir${i}`, posicion: i });
    ok(r.carta?.id, `${uid} recibe la carta que miró`, r.carta?.id);
    // Y esa carta no aparece en la vista de NADIE, ni en la suya.
    const enAlguna = M.some((m) => JSON.stringify(m.vista).includes(`"${r.carta.id}"`));
    ok(!enAlguna, "y no queda escrita en ninguna vista");
  }

  await red.cerrarMirada({ codigo: CODIGO });
  ok(M.every((m) => m.estado.fase === "descarte"), "los cuatro pasan a descarte");

  const { ventana } = await red.abrirVentana({ codigo: CODIGO });
  ok(M.every((m) => m.vista.ventana?.id === ventana.id), "los cuatro ven la misma ventana");

  // Cada uno reacciona en un momento distinto y su pedido llega 30 ms después,
  // que es su latencia declarada. Si llegaran todos en el mismo instante, sus
  // tiempos se acotarían al mismo piso y serían cuatro empates técnicos: el
  // orden lo decidiría el sorteo, no los reflejos.
  const intentos = [];
  for (const [i, uid] of CUATRO.entries()) {
    const reacciona = 200 + i * 120;
    reloj = 100000 + reacciona + 30;
    intentos.push(await capturar(() => red.intentarDescarte({
      uid, codigo: CODIGO, windowId: ventana.id, posicion: i,
      clientActionId: `d${i}`, declarado: reacciona, latencia: 30, incertidumbre: 20,
    })));
  }
  ok(intentos.every((r) => r.valor?.anotado), "los cuatro intentos se anotan",
     intentos.map((r) => r.error?.message).filter(Boolean));

  const anotados = db.leer(`partidas/${CODIGO}`).ventana.intentos;
  ok(Object.values(anotados).map((x) => x.efectivo).join(",") === "200,320,440,560",
     "cada uno conserva su tiempo de reacción",
     Object.values(anotados).map((x) => x.efectivo));

  reloj = 109000;
  const cierre = await red.cerrarVentana({ codigo: CODIGO });
  ok(cierre.orden.length === 4, "se resuelven los cuatro", cierre.orden.length);
  ok(cierre.orden[0].uid === "ana", "en orden de reacción", cierre.orden.map((o) => o.uid));
  ok(cierre.orden.filter((o) => o.resultado === "primero").length <= 1, "a lo sumo uno se salva");
  ok(M.every((m) => m.estado.fase === "turno"), "y la mesa avanza a los turnos");
  ok(new Set(M.map((m) => m.vista.version)).size === 1, "los cuatro en la misma versión",
     M.map((m) => m.vista.version));

  // El que tiene el turno juega; los otros no pueden.
  const enTurno = CUATRO[M[0].estado.indiceTurno];
  for (const uid of CUATRO.filter((u) => u !== enTurno)) {
    const r = await capturar(() => red.accionDeTurno({ uid, codigo: CODIGO, accion: "levantar", clientActionId: `l-${uid}` }));
    ok(/No es tu turno/.test(r.error?.message ?? ""), `${uid} no puede levantar`, r.error?.message);
  }
  const suyo = await capturar(() => red.accionDeTurno({ uid: enTurno, codigo: CODIGO, accion: "levantar", clientActionId: "l-ok" }));
  ok(suyo.valor?.fase === "levantada", `${enTurno} sí`, suyo.error?.message);

  // La carta levantada la ve sólo él.
  const idx = CUATRO.indexOf(enTurno);
  ok(M[idx].estado.levantada?.id, "la ve quien la levantó", M[idx].estado.levantada?.id);
  ok(M.filter((_, i) => i !== idx).every((m) => m.estado.levantada === null),
     "y los otros tres no");

  M.forEach((m) => m.desconectar());
}

// ========================================= 4. desconexión y reconexión

console.log("\n=== 4. Desconexión y reconexión ===");
{
  reloj = 100000;
  const { db, red } = montar();
  const M = CUATRO.map((u) => mesa(db, CODIGO, u));
  await red.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: CUATRO });
  await red.cerrarMirada({ codigo: CODIGO });
  const { ventana } = await red.abrirVentana({ codigo: CODIGO });
  reloj = 109000;
  await red.cerrarVentana({ codigo: CODIGO });

  const enTurno = CUATRO[M[0].estado.indiceTurno];
  const iCaido = CUATRO.indexOf(enTurno);
  const caido = M[iCaido];

  // Se le cae la conexión justo cuando le toca.
  const pintadasAlCaer = caido.pintadas.length;
  caido.desconectar();

  reloj = 130000;
  for (const uid of CUATRO.filter((u) => u !== enTurno)) await red.latir({ uid, codigo: CODIGO });

  const partida = db.leer(`partidas/${CODIGO}`);
  ok(partida.ausentes.includes(enTurno), "se lo marca ausente", partida.ausentes);
  ok(!partida.abandonaron.includes(enTurno), "pero NO como abandono: caerse no cuesta Leyendas");
  ok(!partida.estado.jugadores[iCaido].eliminado, "ni se lo elimina");
  ok(caido.pintadas.length === pintadasAlCaer, "desconectado deja de recibir vistas");

  const salto = await capturar(() => red.saltarAusente({ codigo: CODIGO }));
  ok(salto.valor?.salteado === enTurno, "se le salta el turno para que la partida siga", salto.error?.message);

  // Vuelve. Al reconectar recibe el estado actual, no el que dejó.
  caido.conectar();
  ok(caido.pintadas.length > pintadasAlCaer, "al reconectar recibe la vista actual");
  ok(caido.vista.version === M[0].vista.version, "y está al día con los demás",
     [caido.vista.version, M[0].vista.version]);
  ok(caido.estado.indiceTurno !== iCaido, "la partida avanzó sin él mientras no estaba");

  // Y puede volver a jugar cuando le toque.
  reloj = 131000;
  const vuelve = await capturar(() => red.latir({ uid: enTurno, codigo: CODIGO }));
  ok(vuelve.valor && !vuelve.error, "vuelve a dar señales de vida");
  ok(!db.leer(`partidas/${CODIGO}`).ausentes.includes(enTurno), "y deja de estar ausente");

  M.forEach((m) => m.desconectar());
}

// ================================= 5. un refresco no crea nada nuevo

console.log("\n=== 5. Un refresco del navegador no crea otra partida ===");
{
  reloj = 100000;
  const { db, red } = montar();
  const M = mesa(db, CODIGO, "ana");
  await red.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: CUATRO });
  await red.accionDeTurno({ uid: "ana", codigo: CODIGO, accion: "mirar", clientActionId: "m", posicion: 0 });

  const antes = JSON.parse(JSON.stringify(db.leer(`partidas/${CODIGO}`)));
  const docsAntes = db.rutas().length;

  // Refrescar es exactamente esto: cortar la escucha y volver a escuchar.
  // No se llama a repartir; la partida ya existe.
  M.desconectar();
  const M2 = mesa(db, CODIGO, "ana");

  ok(M2.pintadas.length === 1, "al reconectar recibe una vista de entrada", M2.pintadas);
  ok(M2.vista.version === antes.version, "la de la partida en curso", [M2.vista.version, antes.version]);
  ok(db.rutas().length === docsAntes, "no se creó ningún documento nuevo", db.rutas().length - docsAntes);
  ok(JSON.stringify(db.leer(`partidas/${CODIGO}`)) === JSON.stringify(antes),
     "y la partida no cambió en absoluto");

  // Y si alguien llamara a repartir otra vez, tampoco reinicia nada.
  const otra = await red.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: CUATRO });
  ok(otra.yaExistia === true, "repartir sobre una partida existente es idempotente", otra);
  ok(JSON.stringify(db.leer(`partidas/${CODIGO}`)) === JSON.stringify(antes),
     "y no toca el estado");
  M2.desconectar();
}

// ================================ 6. qué cartas se pueden tocar con un poder

console.log("\n=== 6. Cartas elegibles con un poder ===");
{
  const jugadores = [
    { nombre: "yo",   mano: [{ oculta: true }, { oculta: true }, null, { oculta: true }] },
    { nombre: "otro", mano: [{ oculta: true }, null, { oculta: true }, { oculta: true }] },
    { nombre: "tres", mano: [{ oculta: true }, { oculta: true }, { oculta: true }, { oculta: true }] },
    { nombre: "fuera", eliminado: true, mano: [] },
  ];
  const YO = 0;

  // --- 7: sólo cartas propias ---
  const p7 = elegibleParaPoder({ numero: 7, yo: YO, jugadores });
  ok(p7(0, 0) === true, "7: una carta propia es elegible");
  ok(p7(1, 0) === false, "7: la de otro NO");
  ok(p7(0, 2) === false, "7: un hueco propio tampoco: no hay nada que mirar");

  // --- 8: sólo cartas ajenas ---
  const p8 = elegibleParaPoder({ numero: 8, yo: YO, jugadores });
  ok(p8(1, 0) === true, "8: la carta de otro es elegible");
  ok(p8(0, 0) === false, "8: la propia NO");
  ok(p8(1, 1) === false, "8: un hueco ajeno tampoco");
  ok(p8(3, 0) === false, "8: un jugador eliminado no es objetivo");

  // --- 9 y 10: primero propia, después ajena ---
  for (const numero of [9, 10]) {
    const primero = elegibleParaPoder({ numero, yo: YO, jugadores, propiaElegida: null });
    ok(primero(0, 1) === true, `${numero}: primero se elige una propia`);
    ok(primero(1, 0) === false, `${numero}: todavía no se puede tocar la de otro`);
    ok(primero(0, 2) === false, `${numero}: ni un hueco propio`);

    const segundo = elegibleParaPoder({ numero, yo: YO, jugadores, propiaElegida: 1 });
    ok(segundo(1, 0) === true, `${numero}: después sí la de otro`);
    ok(segundo(0, 0) === false, `${numero}: y ya NO otra propia: no se cambia una carta consigo misma`);
    ok(segundo(0, 1) === false, `${numero}: ni la que ya eligió`);
    ok(segundo(3, 0) === false, `${numero}: ni la de un eliminado`);
  }

  // --- un poder que no existe no habilita nada ---
  const raro = elegibleParaPoder({ numero: 5, yo: YO, jugadores });
  ok([0, 1, 2].every((i) => [0, 1, 2, 3].every((p) => raro(i, p) === false)),
     "un número que no es poder no habilita ninguna carta");

  // --- los mensajes acompañan el paso ---
  ok(/tuya/.test(pasoDelPoder({ numero: 7 })), "el 7 pide una carta propia");
  ok(/otro/.test(pasoDelPoder({ numero: 8 })), "el 8 pide una ajena");
  ok(/tuya/.test(pasoDelPoder({ numero: 9, propiaElegida: null })), "el 9 empieza por la propia");
  ok(/otro/.test(pasoDelPoder({ numero: 9, propiaElegida: 2 })), "y sigue por la ajena");

  // --- y lo no elegible sigue bloqueado en el servidor, que es lo que importa ---
  reloj = 100000;
  const { db, red } = montar();
  await red.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: CUATRO });
  const base = db.leer(`partidas/${CODIGO}`);
  await db.runTransaction(async (tx) => {
    tx.set({ ruta: `partidas/${CODIGO}` }, {
      ...base,
      estado: {
        ...base.estado,
        fase: "poder",
        indiceTurno: 0,
        poderPendiente: { numero: 10, tipo: "cambioConVista", indiceJugador: 0 },
      },
      version: base.version + 1,
    });
  });

  // Cambiar una carta propia por OTRA PROPIA: el cliente ni la resalta, y el
  // servidor la rechaza igual. Las dos barreras, no una sola.
  const consigoMismo = await capturar(() => red.accionDeTurno({
    uid: "ana", codigo: CODIGO, accion: "poderCambio", clientActionId: "auto",
    posicion: 0, objetivo: { indice: 0, posicion: 1 },
  }));
  ok(Boolean(consigoMismo.error), "el servidor rechaza cambiar una carta consigo misma",
     consigoMismo.error?.message);

  const fueraDeRango = await capturar(() => red.accionDeTurno({
    uid: "ana", codigo: CODIGO, accion: "poderCambio", clientActionId: "rango",
    posicion: 0, objetivo: { indice: 1, posicion: 99 },
  }));
  ok(Boolean(fueraDeRango.error), "y una posición que no existe", fueraDeRango.error?.message);

  ok(db.leer(`partidas/${CODIGO}`).estado.fase === "poder",
     "tras los rechazos la partida sigue esperando la jugada buena");
}

// ============================= 7. el adaptador no se separó de mesa.js

console.log("\n=== 6. El adaptador duplicado sigue siendo el mismo ===");
{
  const { readFileSync } = await import("node:fs");
  const mesaJs = readFileSync(new URL("../public/js/mesa.js", import.meta.url), "utf8");
  const cuerpoDeMesa = mesaJs.slice(mesaJs.indexOf("function comoEstado(vista) {"));
  const normalizar = (t) => t.slice(0, t.indexOf("\n}") + 2).replace(/\s+/g, " ").trim();

  ok(
    normalizar(cuerpoDeMesa) === normalizar(comoEstado.toString()),
    "el `comoEstado` de la prueba es idéntico al de mesa.js",
  );
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
