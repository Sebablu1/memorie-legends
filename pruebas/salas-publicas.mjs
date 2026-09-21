/**
 * Las mesas públicas: las abre la administración, nacen vacías, se pagan sólo
 * con Leyendas Ganadas y se reabren solas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE PRUEBA Y CÓMO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El módulo `salas-publicas.js` de verdad, con el panel de verdad
 * (`admin.js`, que edita y cancela), el libro mayor de verdad
 * (`leyendas.js`) y la salida de verdad (`salida.js`), sobre un Firestore de
 * mentira que aplica la regla de Firestore: ninguna lectura después de una
 * escritura.
 *
 * Sentarse a una mesa vive en `index.js`, que no se puede montar sin
 * Firebase. Acá se sienta con las MISMAS piezas —`puedeUnirse` con las
 * ganadas, `motivoDeEntrada`, `claveDeEntrada`— y la última sección lee
 * `index.js` para comprobar que allá se usan esas mismas.
 */

import { readFileSync } from "node:fs";
import { crearSalasPublicas } from "../functions/salas-publicas.js";
import { crearAdmin } from "../functions/admin.js";
import { crearMoverLeyendas } from "../functions/leyendas.js";
import { crearSalirDeSalaEnEspera } from "../functions/salida.js";
import {
  ESTADOS_SALA,
  MODOS,
  RECHAZO,
  puedeUnirse,
  anfitrionDe,
} from "../public/js/reglas/salas.js";
import {
  MOTIVOS,
  motivoDeEntrada,
  bolsillosDe,
  claveDeEntrada,
} from "../public/js/reglas/economia.js";
import { JUEGO_POR_DEFECTO } from "../public/js/reglas/juegos.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else {
    fallos++;
    console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : "");
  }
};

class E extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo;
  }
}
const error = (codigo, mensaje) => new E(codigo, mensaje);

const capturar = async (fn) => {
  try {
    return { valor: await fn() };
  } catch (e) {
    return { error: e };
  }
};

// ============================== Firestore con la regla lectura/escritura

function crearFirestore(inicial = {}) {
  const docs = new Map(Object.entries(inicial).map(([r, d]) => [r, structuredClone(d)]));
  let auto = 0;

  const referencia = (ruta) => ({
    ruta,
    id: ruta.split("/").pop(),
    // Lectura suelta, fuera de toda transacción.
    async get() {
      const d = docs.get(ruta);
      return { exists: Boolean(d), data: () => (d ? structuredClone(d) : undefined) };
    },
  });

  const db = {
    collection: (n) => ({ doc: (id) => referencia(`${n}/${id ?? `auto${++auto}`}`) }),
    async runTransaction(cuerpo) {
      let escribio = false;
      const pendientes = [];
      const tx = {
        async get(ref) {
          if (escribio) {
            throw error("failed-precondition", `Lectura de ${ref.ruta} después de escribir`);
          }
          const d = docs.get(ref.ruta);
          return { exists: Boolean(d), data: () => (d ? structuredClone(d) : undefined) };
        },
        set(ref, datos, opciones) {
          escribio = true;
          pendientes.push([ref.ruta, datos, Boolean(opciones?.merge)]);
        },
        update(ref, datos) {
          escribio = true;
          pendientes.push([ref.ruta, datos, true]);
        },
      };
      const r = await cuerpo(tx);
      for (const [ruta, datos, fusionar] of pendientes) {
        docs.set(
          ruta,
          fusionar ? { ...(docs.get(ruta) ?? {}), ...structuredClone(datos) } : structuredClone(datos),
        );
      }
      return r;
    },
    leer: (r) => docs.get(r),
    rutas: () => [...docs.keys()],
  };
  return db;
}

// ================================================================ montaje

const ADMIN = { auth: { uid: "admin", token: { email: "admin@x", email_verified: true } } };
const COMUN = { auth: { uid: "lu", token: { email: "lu@x", email_verified: true } } };

/** Quién administra. El de verdad se prueba en `administradores.mjs`. */
const administradores = {
  async exigir(context) {
    if (context?.auth?.token?.email !== "admin@x") {
      throw error("permission-denied", "Esta sección no es para vos.");
    }
    return { uid: context.auth.uid, correo: "admin@x" };
  },
  es: async (context) => context?.auth?.token?.email === "admin@x",
};

const perfil = (comprado, ganado) => ({
  credits: comprado + ganado,
  creditosComprados: comprado,
  creditosGanados: ganado,
});

function montar(inicial = {}, { codigos = null } = {}) {
  const db = crearFirestore(inicial);
  const mover = crearMoverLeyendas({
    db, usuarios: "users", campoSaldo: "credits", marcaDeTiempo: () => "T", error,
  });
  const panel = crearAdmin({
    db, salas: "rooms", partidas: "partidas", moverLeyendas: mover,
    motivo: MOTIVOS.DEVOLUCION_ENTRADA, marcaDeTiempo: () => "T", error,
    estados: ESTADOS_SALA, administradores,
  });

  let n = 0;
  const generarCodigo = () => (codigos ? codigos[n++] : `PUB${String(++n).padStart(3, "0")}`);

  const publicas = crearSalasPublicas({
    db, salas: "rooms", error, marcaDeTiempo: () => "T", administradores, panel,
    generarCodigo, estados: ESTADOS_SALA,
  });
  const salir = crearSalirDeSalaEnEspera({
    db, salas: "rooms", moverLeyendas: mover, motivo: MOTIVOS.DEVOLUCION_ENTRADA,
    marcaDeTiempo: () => "T", error, estados: ESTADOS_SALA,
  });
  return { db, mover, publicas, salir };
}

/**
 * Sentarse a una mesa, con las mismas piezas que `sumarseALaSala` de
 * `index.js`: las ganadas contadas con `bolsillosDe`, `puedeUnirse`, y el
 * cobro con `motivoDeEntrada` y `claveDeEntrada`. La sección 10 comprueba que
 * allá se usan éstas y no otras.
 */
function sentar(db, mover, codigo, uid) {
  return db.runTransaction(async (tx) => {
    const refSala = db.collection("rooms").doc(codigo);
    const sala = (await tx.get(refSala)).data();
    const datos = (await tx.get(db.collection("users").doc(uid))).data() ?? {};

    const veredicto = puedeUnirse(sala, uid, datos.credits ?? 0, {
      ganadas: bolsillosDe(datos).ganado,
    });
    if (!veredicto.puede) throw error("failed-precondition", veredicto.mensaje);

    await mover(tx, {
      uid,
      delta: -Number(sala.entrada),
      motivo: motivoDeEntrada(sala),
      referencia: codigo,
      idempotencia: claveDeEntrada(codigo, uid),
    });
    tx.update(refSala, {
      jugadores: [...sala.jugadores, uid],
      jugadoresNombres: [...sala.jugadoresNombres, uid],
      jugadoresLuce: [...(sala.jugadoresLuce ?? []), {}],
      pozo: Number(sala.entrada) * (sala.jugadores.length + 1),
    });
  });
}

const bolsillos = (db, uid) => {
  const p = db.leer(`users/${uid}`);
  return [p.creditosComprados, p.creditosGanados];
};
const mesa = (db, codigo) => db.leer(`rooms/${codigo}`);

// ==================================================================== 1

console.log("\n=== 1. Sólo la administración abre una mesa, y nace vacía ===");
{
  const { db, publicas } = montar();

  const r = await capturar(() => publicas.crear(ADMIN, { entrada: 10 }));
  ok(!r.error, "la administración la abre", r.error?.message);

  const m = mesa(db, r.valor.codigo);
  ok(m?.publica === true, "es pública");
  ok(m?.soloGanadas === true, "se paga sólo con ganadas");
  ok(m?.creador === null, "no tiene creador: la administración no se sienta");
  ok(m?.abiertaPor === "admin", "pero queda escrito quién la abrió", m?.abiertaPor);
  ok(m?.mesa === r.valor.codigo, "y es la primera de su cadena", m?.mesa);
  ok(m?.juego === JUEGO_POR_DEFECTO, "dice de qué juego es", m?.juego);
  ok(Array.isArray(m?.jugadores) && m.jugadores.length === 0, "NACE VACÍA", m?.jugadores);
  ok(m?.pozo === 0 && m?.estado === ESTADOS_SALA.ESPERANDO && m?.modo === MODOS.LEYENDAS,
     "sin nada cobrado, esperando, y por Leyendas", m);
  ok(m?.nombre === "Mesa de 10" && m?.limitePuntos === 150 && m?.maxJugadores === 4,
     "con los valores por omisión: nombre, 150 puntos y cuatro lugares", m);
  ok(!db.rutas().some((x) => x.startsWith("movimientos/")),
     "y no hay un solo movimiento en el libro mayor");

  const conTodo = await publicas.crear(ADMIN, {
    nombre: "  La de los viernes  ", entrada: 50, limitePuntos: 60, maxJugadores: 3,
  });
  const m2 = mesa(db, conTodo.codigo);
  ok(m2.nombre === "La de los viernes" && m2.entrada === 50 && m2.limitePuntos === 60 &&
     m2.maxJugadores === 3, "con lo que se le pida", m2);

  const comun = await capturar(() => publicas.crear(COMUN, { entrada: 10 }));
  ok(comun.error?.codigo === "permission-denied", "un usuario común no puede abrir una",
     comun.error?.codigo);
  ok(db.rutas().filter((x) => x.startsWith("rooms/")).length === 2,
     "y no se escribió nada", db.rutas());
}

// ==================================================================== 2

console.log("\n=== 2. La configuración se valida ===");
{
  const { db, publicas } = montar();
  for (const [datos, que] of [
    [{ entrada: 7 }, "una entrada que no está en la lista"],
    [{ entrada: 10, limitePuntos: 99 }, "una duración que no es 60, 100 ni 150"],
    [{ entrada: 10, maxJugadores: 5 }, "un cupo de cinco"],
    [{ entrada: 10, maxJugadores: 1 }, "un cupo de uno"],
  ]) {
    const r = await capturar(() => publicas.crear(ADMIN, datos));
    ok(r.error?.codigo === "invalid-argument", `rechaza ${que}`, r.error?.message);
  }
  ok(!db.rutas().some((x) => x.startsWith("rooms/")), "y ninguna llega a escribirse");

  const largo = await publicas.crear(ADMIN, { entrada: 10, nombre: "x".repeat(60) });
  ok(mesa(db, largo.codigo).nombre.length === 40, "el nombre se corta en 40");
}

// ==================================================================== 3

console.log("\n=== 3. Un código tomado se saltea ===");
{
  const { db, publicas } = montar(
    { "rooms/TOMADO": { codigo: "TOMADO", estado: ESTADOS_SALA.ESPERANDO } },
    { codigos: ["TOMADO", "LIBRE1"] },
  );
  const r = await publicas.crear(ADMIN, { entrada: 10 });
  ok(r.codigo === "LIBRE1", "usa el siguiente código libre", r.codigo);
  ok(mesa(db, "TOMADO").publica === undefined, "y no pisa la sala que ya estaba");
}

// ==================================================================== 4

console.log("\n=== 4. Se paga sólo con Leyendas Ganadas ===");
{
  const { db, mover, publicas } = montar({
    "users/lu": perfil(500, 0),
    "users/bea": perfil(100, 50),
  });
  const { codigo } = await publicas.crear(ADMIN, { entrada: 10 });

  // Lu tiene 500, todas compradas.
  const lu = await capturar(() => sentar(db, mover, codigo, "lu"));
  ok(lu.error?.codigo === "failed-precondition", "con 500 compradas y 0 ganadas, no entra",
     lu.error?.message);
  ok(/Leyendas Ganadas/.test(lu.error?.message ?? ""), "y el mensaje dice con qué se paga",
     lu.error?.message);
  ok(JSON.stringify(bolsillos(db, "lu")) === "[500,0]", "sin que se le cobre nada",
     bolsillos(db, "lu"));

  // Y aunque alguien se saltara `puedeUnirse`, el cobro mismo se niega: la
  // regla vive en el motivo, no en la pregunta de antes.
  const directo = await capturar(() =>
    db.runTransaction((tx) => mover(tx, {
      uid: "lu", delta: -10, motivo: motivoDeEntrada(mesa(db, codigo)),
      referencia: codigo, idempotencia: "x",
    })));
  ok(/Leyendas ganadas/.test(directo.error?.message ?? ""),
     "el cobro directo también se niega, con las dos cifras", directo.error?.message);

  // Bea tiene 100 compradas y 50 ganadas: paga con las ganadas, aunque la
  // regla de siempre gastaría primero las compradas.
  const bea = await capturar(() => sentar(db, mover, codigo, "bea"));
  ok(!bea.error, "con ganadas, entra", bea.error?.message);
  ok(JSON.stringify(bolsillos(db, "bea")) === "[100,40]",
     "y la entrada sale de las ganadas, no de las compradas", bolsillos(db, "bea"));
  ok(db.leer(`movimientos/${claveDeEntrada(codigo, "bea")}`)?.motivo === MOTIVOS.ENTRADA_SALA_PUBLICA,
     "asentada como entrada de mesa pública");

  ok(motivoDeEntrada({}) === MOTIVOS.ENTRADA_PARTIDA,
     "una sala normal sigue cobrando con el motivo de siempre");
}

// ==================================================================== 5

console.log("\n=== 5. Salir no cierra la mesa ===");
{
  const { db, mover, publicas, salir } = montar({
    "users/bea": perfil(100, 50),
    "users/cami": perfil(0, 30),
  });
  const { codigo } = await publicas.crear(ADMIN, { entrada: 10 });
  await sentar(db, mover, codigo, "bea");
  await sentar(db, mover, codigo, "cami");
  ok(anfitrionDe(mesa(db, codigo)) === "bea", "la empieza la primera que se sentó");

  // Se va Bea, que es la que la empieza. En una sala de jugador, la del
  // creador cancela todo; acá no.
  const r = await capturar(() => salir({ uid: "bea", codigo }));
  ok(!r.error, "Bea sale", r.error?.message);
  ok(mesa(db, codigo).estado === ESTADOS_SALA.ESPERANDO, "la mesa sigue esperando",
     mesa(db, codigo).estado);
  ok(JSON.stringify(mesa(db, codigo).jugadores) === '["cami"]', "con Cami adentro",
     mesa(db, codigo).jugadores);
  ok(JSON.stringify(bolsillos(db, "bea")) === "[100,50]",
     "a Bea le vuelve la entrada, a las ganadas", bolsillos(db, "bea"));
  ok(anfitrionDe(mesa(db, codigo)) === "cami", "y ahora la empieza Cami");

  await salir({ uid: "cami", codigo });
  ok(mesa(db, codigo).estado === ESTADOS_SALA.ESPERANDO &&
     mesa(db, codigo).jugadores.length === 0,
     "vacía de nuevo, sigue ahí: el lobby no la pierde", mesa(db, codigo));
}

// ==================================================================== 6

console.log("\n=== 6. La reapertura: otra igual, vacía, con otro código ===");
{
  const { db, publicas } = montar({
    "rooms/VIEJA1": {
      codigo: "VIEJA1", mesa: "PRIMERA", nombre: "La de los viernes", modo: MODOS.LEYENDAS,
      juego: "otro-juego", entrada: 50, limitePuntos: 60, maxJugadores: 3,
      publica: true, soloGanadas: true, creador: null, abiertaPor: "admin",
      jugadores: ["bea", "cami"], estado: ESTADOS_SALA.ESPERANDO, pozo: 100,
    },
  });

  // Como en `iniciarPartida`: se reserva, se escribe la partida, y recién
  // después se abre la mesa nueva.
  let codigoNuevo = null;
  await db.runTransaction(async (tx) => {
    const sala = (await tx.get(db.collection("rooms").doc("VIEJA1"))).data();
    const reserva = await publicas.reservarSiguiente(tx);
    tx.update(db.collection("rooms").doc("VIEJA1"), { estado: ESTADOS_SALA.JUGANDO });
    codigoNuevo = publicas.abrirSiguiente(tx, reserva, sala);
  });

  const nueva = mesa(db, codigoNuevo);
  ok(codigoNuevo && codigoNuevo !== "VIEJA1", "tiene otro código", codigoNuevo);
  ok(nueva?.publica === true && nueva?.soloGanadas === true && nueva?.creador === null,
     "es pública, se paga con ganadas y no tiene creador");
  ok(nueva?.jugadores.length === 0 && nueva?.pozo === 0 && nueva?.estado === ESTADOS_SALA.ESPERANDO,
     "y nace vacía, esperando", nueva);
  ok(nueva?.entrada === 50 && nueva?.limitePuntos === 60 && nueva?.maxJugadores === 3 &&
     nueva?.nombre === "La de los viernes",
     "con la misma entrada, duración, cupo y nombre", nueva);
  ok(nueva?.mesa === "PRIMERA", "de la misma cadena", nueva?.mesa);
  ok(nueva?.abiertaPor === "admin", "y de quien la abrió");
  // No hay una lista de juegos: el que traía la mesa, pasa.
  ok(nueva?.juego === "otro-juego", "y del mismo juego, sea cual sea", nueva?.juego);

  // El orden importa: reservar es leer, y después de escribir no se puede.
  const tarde = await capturar(() =>
    db.runTransaction(async (tx) => {
      tx.update(db.collection("rooms").doc("VIEJA1"), { nota: "x" });
      await publicas.reservarSiguiente(tx);
    }));
  ok(tarde.error, "reservar DESPUÉS de escribir falla: por eso va antes de repartir",
     tarde.error?.message);
}

// ==================================================================== 7

console.log("\n=== 7. Editar: el nombre y el cupo siempre, la entrada sólo vacía ===");
{
  const { db, mover, publicas } = montar({
    "users/bea": perfil(0, 100),
    "rooms/NORMAL": { codigo: "NORMAL", estado: ESTADOS_SALA.ESPERANDO, jugadores: ["ana"] },
  });
  const { codigo } = await publicas.crear(ADMIN, { entrada: 10 });

  await publicas.editar(ADMIN, { codigo, entrada: 20, limitePuntos: 60 });
  ok(mesa(db, codigo).entrada === 20 && mesa(db, codigo).limitePuntos === 60,
     "vacía, cambian la entrada y la duración", mesa(db, codigo));

  await sentar(db, mover, codigo, "bea");
  const entrada = await capturar(() => publicas.editar(ADMIN, { codigo, entrada: 50 }));
  ok(entrada.error?.codigo === "failed-precondition", "con alguien sentado, la entrada no",
     entrada.error?.message);
  ok(mesa(db, codigo).entrada === 20, "y sigue la que pagó Bea");

  await publicas.editar(ADMIN, { codigo, nombre: "Otra", maxJugadores: 2 });
  ok(mesa(db, codigo).nombre === "Otra" && mesa(db, codigo).maxJugadores === 2,
     "el nombre y el cupo, sí", mesa(db, codigo));

  const normal = await capturar(() => publicas.editar(ADMIN, { codigo: "NORMAL", nombre: "x" }));
  ok(normal.error?.codigo === "failed-precondition", "una sala que no es pública no se edita acá",
     normal.error?.message);
  const comun = await capturar(() => publicas.editar(COMUN, { codigo, nombre: "Mía" }));
  ok(comun.error?.codigo === "permission-denied", "ni la puede editar un usuario común",
     comun.error?.codigo);
}

// ==================================================================== 8

console.log("\n=== 8. Borrar: cancela la que espera, devuelve, y corta la cadena ===");
{
  const { db, mover, publicas } = montar({
    "users/bea": perfil(100, 50),
    "users/cami": perfil(0, 30),
    "rooms/JUGAND": {
      codigo: "JUGAND", publica: true, estado: ESTADOS_SALA.JUGANDO, jugadores: ["x", "y"],
    },
    "rooms/NORMAL": { codigo: "NORMAL", estado: ESTADOS_SALA.ESPERANDO, jugadores: ["ana"] },
  });
  const { codigo } = await publicas.crear(ADMIN, { entrada: 10 });
  await sentar(db, mover, codigo, "bea");
  await sentar(db, mover, codigo, "cami");

  const comun = await capturar(() => publicas.borrar(COMUN, { codigo }));
  ok(comun.error?.codigo === "permission-denied", "un usuario común no la borra", comun.error?.codigo);

  const r = await capturar(() => publicas.borrar(ADMIN, { codigo }));
  ok(!r.error, "la administración la borra", r.error?.message);
  ok(mesa(db, codigo).estado === ESTADOS_SALA.CANCELADA,
     "queda cancelada, y una cancelada nunca empieza: no se reabre", mesa(db, codigo).estado);
  ok(JSON.stringify(bolsillos(db, "bea")) === "[100,50]" &&
     JSON.stringify(bolsillos(db, "cami")) === "[0,30]",
     "a cada uno le vuelve su entrada, a las ganadas", [bolsillos(db, "bea"), bolsillos(db, "cami")]);

  const jugando = await capturar(() => publicas.borrar(ADMIN, { codigo: "JUGAND" }));
  ok(jugando.error?.codigo === "failed-precondition", "la que está jugando no se borra: termina",
     jugando.error?.message);
  const normal = await capturar(() => publicas.borrar(ADMIN, { codigo: "NORMAL" }));
  ok(normal.error?.codigo === "failed-precondition", "ni una sala que no es pública",
     normal.error?.message);
}

// ==================================================================== 9

console.log("\n=== 9. Los bolsillos se cuentan una sola vez ===");
{
  // `bolsillosDe` es la cuenta que usan `moverLeyendas` para cobrar y
  // `index.js` para preguntar antes si alcanza. Tienen que dar lo mismo.
  const viejo = bolsillosDe({ credits: 100 });
  ok(viejo.comprado === 0 && viejo.ganado === 100,
     "un perfil de antes de los bolsillos tiene todo ganado", viejo);
  const nuevo = bolsillosDe(perfil(100, 50));
  ok(nuevo.comprado === 100 && nuevo.ganado === 50, "uno nuevo, los suyos", nuevo);
  const otros = bolsillosDe({ t: 10, c: 4, g: 6 }, { total: "t", comprado: "c", ganado: "g" });
  ok(otros.comprado === 4 && otros.ganado === 6, "y lee los campos que se le digan", otros);
}

// ==================================================================== 10

console.log("\n=== 10. index.js usa estas mismas piezas ===");
{
  /**
   * Sentarse, empezar y abrir una revancha viven en `index.js`, que no se
   * puede montar acá. Lo que se puede es leerlo, y comprobar que usa las
   * mismas piezas que las secciones de arriba. Es el tipo de error que ya
   * pasó una vez con la pimienta: no en la lógica, sino en cómo se conecta.
   */
  const index = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");

  /** Desde `inicio` hasta la primera línea que cierra en la columna cero. */
  const bloque = (inicio) => {
    const desde = index.indexOf(inicio);
    if (desde < 0) return "";
    const fin = index.slice(desde).search(/\r?\n\}\)?;?\r?\n/);
    return fin < 0 ? index.slice(desde) : index.slice(desde, desde + fin);
  };

  const sumarse = bloque("async function sumarseALaSala(");
  ok(/ganadas: ganado/.test(sumarse) && /bolsillosDe\(perfil\)/.test(sumarse),
     "sumarse le pasa las ganadas a puedeUnirse, contadas con bolsillosDe");
  ok(/motivo: motivoDeEntrada\(sala\)/.test(sumarse), "y cobra con motivoDeEntrada");

  const abrir = bloque("async function abrirSalaEn(");
  ok(/motivo: motivoDeEntrada\(extra\)/.test(abrir),
     "abrir una sala cobra con el motivo de la sala que se abre");

  const iniciar = bloque("export const iniciarPartida");
  ok(/anfitrionDe\(sala\) !== uid/.test(iniciar), "empezar la partida lo decide anfitrionDe");
  const reserva = iniciar.indexOf("publicas.reservarSiguiente(tx)");
  const reparto = iniciar.indexOf("enRed.repartirEn(tx");
  const apertura = iniciar.indexOf("publicas.abrirSiguiente(tx");
  ok(reserva > 0 && reserva < reparto, "el código de la próxima se reserva ANTES de repartir");
  ok(apertura > reparto, "y la mesa nueva se abre después");

  const revancha = bloque("export const revanchaDeSala");
  ok(/sala\.soloGanadas === true \? \{ soloGanadas: true \}/.test(revancha),
     "la revancha de una pública hereda que se paga con ganadas");

  const crearSala = bloque("export const crearSala =");
  const control = crearSala.indexOf("administradores.es(context)");
  ok(control > 0 && control < crearSala.indexOf("db.runTransaction"),
     "crearSala exige ser administrador ANTES de abrir nada");

  for (const [funcion, llamada] of [
    ["crearSalaPublica", "publicas.crear(context"],
    ["editarSalaPublica", "publicas.editar(context"],
    ["borrarSalaPublica", "publicas.borrar(context"],
  ]) {
    ok(bloque(`export const ${funcion}`).includes(llamada),
       `${funcion} pasa por el módulo, que exige ser administrador`);
  }
  ok(/administradores\.es\(context\)/.test(bloque("export const soyAdministrador")),
     "y soyAdministrador contesta con administradores.es");
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
