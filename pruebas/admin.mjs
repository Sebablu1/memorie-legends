/**
 * Administración: quién puede, qué ve, y qué pasa con las Leyendas.
 *
 * Lo que hay que demostrar, por orden de importancia:
 *
 *   1. que nadie más que el administrador pueda ejecutar nada;
 *   2. que lo que viaja al navegador NO contenga una sola carta;
 *   3. que cancelar devuelva las entradas antes de marcar nada;
 *   4. que cancelar dos veces no pague dos veces;
 *   5. que una sala JUGANDO no se pueda vaciar desde acá.
 */

import { crearAdmin } from "../functions/admin.js";
import { crearAdministradores } from "../functions/administradores.js";
import { ESTADOS_SALA } from "../public/js/reglas/salas.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

class E extends Error { constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; } }
const error = (codigo, mensaje) => new E(codigo, mensaje);
const capturar = async (fn) => {
  try { return { valor: await fn() }; } catch (e) { return { error: e }; }
};

const ADMIN = "soporte.memorie.legends@gmail.com";
const comoAdmin = { auth: { uid: "admin1", token: { email: ADMIN, email_verified: true } } };

// ------------------------------------------------------------- Firestore

function crearFirestore(datos = {}) {
  const cols = new Map();
  for (const [col, docs] of Object.entries(datos)) cols.set(col, new Map(Object.entries(docs)));
  const dameCol = (n) => { if (!cols.has(n)) cols.set(n, new Map()); return cols.get(n); };

  const instantanea = (col, id) => ({
    id, exists: dameCol(col).has(id),
    data: () => structuredClone(dameCol(col).get(id)),
    // La referencia va adentro porque el borrado en lote itera un `get()`
    // y borra `d.ref`, igual que en Firestore de verdad.
    ref: { __col: col, __id: id },
  });

  const consulta = (col, filtro = null) => ({
    where: (campo, _op, valor) => consulta(col, { campo, valor }),
    async get() {
      const docs = [...dameCol(col).entries()]
        .filter(([, d]) => !filtro || d[filtro.campo] === filtro.valor)
        .map(([id]) => instantanea(col, id));
      return { docs, size: docs.length, forEach: (f) => docs.forEach(f) };
    },
  });

  const db = {
    escrituras: [],
    collection: (n) => ({
      // Una referencia sabe leerse sola, como en Firestore: `eliminarSala`
      // lee la sala FUERA de una transacción, porque después borra en lote
      // y un lote no es una transacción.
      doc: (id) => ({ __col: n, __id: id, get: async () => instantanea(n, id) }),
      where: (...a) => consulta(n).where(...a),
      get: () => consulta(n).get(),
    }),
    /**
     * Lote de escrituras. Sólo `delete`, que es lo único que se usa.
     *
     * Es de verdad diferido: nada se toca hasta `commit()`. Un lote que
     * borrara al vuelo escondería el error de leer después de borrar.
     */
    batch() {
      const pendientes = [];
      return {
        delete: (ref) => pendientes.push(ref),
        async commit() {
          for (const ref of pendientes) {
            db.escrituras.push({ ruta: `${ref.__col}/${ref.__id}`, borrado: true });
            dameCol(ref.__col).delete(ref.__id);
          }
          return pendientes.length;
        },
      };
    },
    async runTransaction(cuerpo) {
      let yaEscribio = false;
      const tx = {
        async get(ref) {
          if (yaEscribio) throw error("invalid-argument", "Lectura tras escritura");
          return instantanea(ref.__col, ref.__id);
        },
        update(ref, campos) {
          yaEscribio = true;
          db.escrituras.push({ ruta: `${ref.__col}/${ref.__id}`, campos });
          dameCol(ref.__col).set(ref.__id, { ...dameCol(ref.__col).get(ref.__id), ...campos });
        },
        set(ref, datos) {
          yaEscribio = true;
          db.escrituras.push({ ruta: `${ref.__col}/${ref.__id}`, campos: datos });
          dameCol(ref.__col).set(ref.__id, structuredClone(datos));
        },
      };
      return cuerpo(tx);
    },
    leer: (col, id) => dameCol(col).get(id),
    existe: (col, id) => dameCol(col).has(id),
    cuantos: (col) => dameCol(col).size,
  };
  return db;
}

/** `moverLeyendas.varias` de mentira, que recuerda cada asiento. */
function crearBanco() {
  const asientos = new Set();
  const movimientos = [];
  const varias = async (_tx, lista) => {
    // Se comprueban TODAS las lecturas antes de escribir ninguna, igual que la
    // de verdad: si esto se hiciera en bucle, la prueba no detectaría el bug
    // de leer después de escribir.
    const yaEstaban = lista.map((m) => asientos.has(m.idempotencia));
    return lista.map((m, i) => {
      if (yaEstaban[i]) return { aplicado: false, yaEstaba: true };
      asientos.add(m.idempotencia);
      movimientos.push(m);
      return { aplicado: true };
    });
  };
  return { moverLeyendas: { varias }, movimientos, asientos };
}

const montar = (datos) => {
  const db = crearFirestore(datos);
  const banco = crearBanco();
  const admin = crearAdmin({
    db, salas: "rooms", partidas: "partidas",
    moverLeyendas: banco.moverLeyendas, motivo: "apuesta",
    marcaDeTiempo: () => "T", error, estados: ESTADOS_SALA,
    administradores: crearAdministradores({ db, error, correoRaiz: ADMIN }),
  });
  return { db, admin, banco };
};

// ============================================== 1. quién puede entrar

console.log("\n=== 1. Sólo el administrador ===");
{
  const { admin } = montar({ rooms: {} });

  const casos = [
    ["sin sesión", {}],
    ["sin token", { auth: { uid: "x" } }],
    ["otro correo", { auth: { uid: "x", token: { email: "otro@gmail.com", email_verified: true } } }],
    ["el correo pero SIN verificar", { auth: { uid: "x", token: { email: ADMIN, email_verified: false } } }],
    ["el correo sin el campo de verificación", { auth: { uid: "x", token: { email: ADMIN } } }],
    ["mayúsculas y sin verificar", { auth: { uid: "x", token: { email: ADMIN.toUpperCase() } } }],
  ];

  for (const [etiqueta, ctx] of casos) {
    const r = await capturar(() => admin.listarSalas(ctx));
    ok(Boolean(r.error), `rechaza: ${etiqueta}`, r.valor);
  }

  // Y el mismo correo en mayúsculas SÍ entra, si está verificado: los correos
  // no distinguen mayúsculas y rechazarlo sería un bloqueo por accidente.
  const enMayusculas = { auth: { uid: "admin1", token: { email: ADMIN.toUpperCase(), email_verified: true } } };
  const r = await capturar(() => admin.listarSalas(enMayusculas));
  ok(Boolean(r.valor), "acepta el correo en mayúsculas si está verificado", r.error?.message);

  // Las tres operaciones piden lo mismo.
  for (const op of ["listarSalas", "cancelarTodasEnEspera"]) {
    const s = await capturar(() => admin[op]({}));
    ok(s.error?.codigo === "unauthenticated", `${op} exige sesión`, s.error?.codigo);
  }
  const c = await capturar(() => admin.cancelarSala({}, { codigo: "ABCDEF" }));
  ok(c.error?.codigo === "unauthenticated", "cancelarSala exige sesión", c.error?.codigo);
}

// ================================== 2. lo que viaja no tiene cartas

console.log("\n=== 2. Al navegador no viaja ni una carta ===");
{
  const carta = (palo, numero) => ({ id: `${palo}-${numero}`, palo, numero });
  const mazo = [carta("Oro", 1), carta("Copa", 2), carta("Espada", 3)];
  const manos = [[carta("Basto", 7)], [carta("Oro", 11)]];

  const { admin } = montar({
    rooms: {
      SALA01: {
        estado: ESTADOS_SALA.JUGANDO, entrada: 100,
        jugadores: ["ana", "beto"], jugadoresNombres: ["Ana", "Beto"], maxJugadores: 4,
      },
    },
    partidas: {
      SALA01: {
        jugadores: ["ana", "beto"],
        // El maestro con TODO adentro, como en producción.
        estado: {
          fase: "turno", ronda: 2, mazo,
          jugadores: [{ nombre: "Ana", mano: manos[0] }, { nombre: "Beto", mano: manos[1] }],
          descarte: [carta("Copa", 6)],
        },
      },
    },
  });

  const r = await admin.listarSalas(comoAdmin);
  const texto = JSON.stringify(r);

  for (const c of [...mazo, ...manos.flat(), carta("Copa", 6)]) {
    ok(!texto.includes(`"${c.id}"`), `no viaja la carta ${c.id}`);
  }
  ok(!texto.includes('"mano"'), "ni el campo mano");
  ok(!texto.includes('"mazo"'), "ni el mazo");
  ok(!texto.includes('"descarte"'), "ni el descarte");

  // Lo que sí necesita el panel.
  ok(r.salas[0].codigo === "SALA01", "el código sí");
  ok(r.salas[0].jugadores.join() === "Ana,Beto", "los nombres sí", r.salas[0].jugadores);
  ok(r.salas[0].leyendasRetenidas === 200, "y cuántas Leyendas retiene", r.salas[0].leyendasRetenidas);
  ok(r.partidas[0].fase === "turno", "de la partida, sólo la fase", r.partidas[0]);
  ok(r.partidas[0].ronda === 2, "y la ronda");
}

// ============================================ 3. el listado filtra

console.log("\n=== 3. El listado muestra lo que todavía importa ===");
{
  const sala = (estado, jugadores) => ({
    estado, entrada: 50, jugadores, jugadoresNombres: jugadores.map((j) => j.toUpperCase()),
  });
  const { admin } = montar({
    rooms: {
      ESPERA1: sala(ESTADOS_SALA.ESPERANDO, ["ana", "beto"]),
      JUGANDO1: sala(ESTADOS_SALA.JUGANDO, ["caro", "dani"]),
      VIEJA1: sala(ESTADOS_SALA.TERMINADA, ["ana"]),
      VIEJA2: sala(ESTADOS_SALA.CANCELADA, ["beto"]),
    },
    partidas: { JUGANDO1: { jugadores: ["caro", "dani"], estado: { fase: "turno", ronda: 1 } },
                CERRADA1: { cerrada: true, jugadores: ["x"], estado: { fase: "finPartida" } } },
  });

  const r = await admin.listarSalas(comoAdmin);
  const codigos = r.salas.map((s) => s.codigo).sort();
  ok(codigos.join() === "ESPERA1,JUGANDO1", "sólo esperando y jugando", codigos);
  ok(r.totales.salas === 2, "el total cuenta las vivas", r.totales.salas);
  ok(r.totales.leyendasRetenidas === 200, "y suma lo retenido: 4 jugadores × 50", r.totales.leyendasRetenidas);

  ok(r.salas.find((s) => s.codigo === "ESPERA1").cancelable === true, "la que espera es cancelable");
  ok(r.salas.find((s) => s.codigo === "JUGANDO1").cancelable === false, "la que juega no");

  ok(r.partidas.length === 1, "las partidas cerradas no se listan", r.partidas.length);
}

// ================================ 4. cancelar devuelve, y no dos veces

console.log("\n=== 4. Cancelar devuelve las entradas ===");
{
  const { db, admin, banco } = montar({
    rooms: {
      ESPERA1: {
        estado: ESTADOS_SALA.ESPERANDO, entrada: 100,
        jugadores: ["ana", "beto", "caro"], jugadoresNombres: ["Ana", "Beto", "Caro"],
      },
    },
  });

  const r = await admin.cancelarSala(comoAdmin, { codigo: "ESPERA1" });
  ok(r.yaEstaba === false, "se cancela");
  ok(r.devueltas === 300, "devuelve 3 × 100", r.devueltas);
  ok(banco.movimientos.length === 3, "un movimiento por jugador", banco.movimientos.length);
  ok(banco.movimientos.every((m) => m.delta === 100), "cada uno por el valor de la entrada");
  ok(banco.movimientos.every((m) => m.referencia === "ESPERA1"), "con la sala como referencia");

  const sala = db.leer("rooms", "ESPERA1");
  ok(sala.estado === ESTADOS_SALA.CANCELADA, "la sala queda cancelada", sala.estado);
  ok(sala.canceladaPor === "admin1", "con quién la canceló", sala.canceladaPor);
  ok(sala.devolucionesHechas.join() === "ana,beto,caro", "y a quiénes se les devolvió");

  // Cancelar de nuevo no paga otra vez.
  const otra = await admin.cancelarSala(comoAdmin, { codigo: "ESPERA1" });
  ok(otra.yaEstaba === true, "cancelar dos veces avisa que ya estaba");
  ok(banco.movimientos.length === 3, "y NO paga de nuevo", banco.movimientos.length);
}

console.log("\n=== 4b. La misma clave que usa salir de la sala ===");
{
  const { admin, banco } = montar({
    rooms: {
      ESPERA2: { estado: ESTADOS_SALA.ESPERANDO, entrada: 50, jugadores: ["ana", "beto"], jugadoresNombres: ["A", "B"] },
    },
  });
  // Ana ya se había ido por su cuenta y cobró: su asiento existe.
  banco.asientos.add("devolucion_ESPERA2_ana");

  const r = await admin.cancelarSala(comoAdmin, { codigo: "ESPERA2" });
  ok(r.devueltas === 50, "sólo se le devuelve a beto", r.devueltas);
  ok(r.jugadores.join() === "beto", "ana no cobra dos veces", r.jugadores);
}

// ============================ 5. una partida en juego: sólo si se confirma

console.log("\n=== 5. Una sala jugando no se corta por accidente ===");
{
  const { db, admin, banco } = montar({
    rooms: {
      JUEGA1: { estado: ESTADOS_SALA.JUGANDO, entrada: 200, jugadores: ["ana", "beto"], jugadoresNombres: ["A", "B"] },
    },
  });

  const r = await capturar(() => admin.cancelarSala(comoAdmin, { codigo: "JUEGA1" }));
  ok(r.error?.codigo === "failed-precondition", "sin confirmar, se niega", r.error?.codigo);
  ok(/jugando/i.test(r.error?.message ?? ""), "diciendo por qué", r.error?.message);
  ok(/confirmaci/i.test(r.error?.message ?? ""), "y qué hacer si va en serio", r.error?.message);
  ok(banco.movimientos.length === 0, "sin mover una sola Leyenda");
  ok(db.leer("rooms", "JUEGA1").estado === ESTADOS_SALA.JUGANDO, "y la sala sigue jugando");

  const noExiste = await capturar(() => admin.cancelarSala(comoAdmin, { codigo: "NADA" }));
  ok(noExiste.error?.codigo === "not-found", "una sala inexistente se rechaza", noExiste.error?.codigo);
}

console.log("\n=== 5b. Confirmada, se corta y se devuelve la entrada ===");
{
  /**
   * Devolver LA ENTRADA, no el pozo.
   *
   * El pozo es la suma de las entradas y se reparte entre el primero y el
   * segundo cuando la partida termina. Acá no termina: se corta. Así que cada
   * uno recupera lo suyo y no hay premio que repartir.
   */
  const { db, admin, banco } = montar({
    rooms: {
      JUEGA2: {
        estado: ESTADOS_SALA.JUGANDO, entrada: 200, pozo: 400,
        jugadores: ["ana", "beto"], jugadoresNombres: ["A", "B"],
      },
    },
    partidas: {
      JUEGA2: {
        estado: { fase: "turno" },
        plazo: { fase: "turno", marca: "t0-0", hasta: 1, que: "saltarTurno" },
        version: 7,
      },
    },
  });

  const r = await admin.cancelarSala(comoAdmin, { codigo: "JUEGA2", forzar: true });

  ok(r.enJuego === true, "se sabe que estaba en juego", r.enJuego);
  ok(r.devueltas === 400, "vuelven las dos entradas: 200 cada uno", r.devueltas);
  ok(r.jugadores.join() === "ana,beto", "a los dos", r.jugadores);
  ok(
    banco.movimientos.every((m) => m.delta === 200),
    "y cada movimiento es UNA entrada, no el pozo",
    banco.movimientos.map((m) => m.delta),
  );

  const sala = db.leer("rooms", "JUEGA2");
  ok(sala.estado === ESTADOS_SALA.CANCELADA, "la sala queda cancelada", sala.estado);
  ok(/partida/i.test(sala.motivoCancelacion ?? ""), "y el motivo dice que se cortó jugando", sala.motivoCancelacion);

  /**
   * Las dos marcas que impiden pagar dos veces.
   *
   * Sin ellas, la partida sigue en `turno` con un plazo vencido: el barredor
   * la encuentra, la empuja hasta `finPartida` y el cierre reparte premios de
   * un pozo que acaba de volver a sus dueños.
   */
  const partida = db.leer("partidas", "JUEGA2");
  ok(partida.cerrada === true, "la partida queda cerrada", partida.cerrada);
  ok(partida.plazo === null, "y sin plazo, así que el barredor no la ve", partida.plazo);
}

console.log("\n=== 5c. A quien ya se le devolvió, no se le devuelve otra vez ===");
{
  const { admin, banco } = montar({
    rooms: {
      JUEGA3: {
        estado: ESTADOS_SALA.JUGANDO, entrada: 100,
        jugadores: ["ana", "beto", "caro"], jugadoresNombres: ["A", "B", "C"],
      },
    },
    partidas: { JUEGA3: { estado: { fase: "turno" }, version: 2 } },
  });
  // Beto ya había cobrado su devolución por otra vía.
  banco.asientos.add("devolucion_JUEGA3_beto");

  const r = await admin.cancelarSala(comoAdmin, { codigo: "JUEGA3", forzar: true });
  ok(r.devueltas === 200, "cobran los otros dos y nadie más", r.devueltas);
  ok(r.jugadores.join() === "ana,caro", "beto no cobra dos veces", r.jugadores);
}

console.log("\n=== 5d. Sin partida escrita, la sala se cancela igual ===");
{
  // Una sala marcada JUGANDO cuyo documento de partida no existe: no debería
  // pasar, pero si pasa lo que no puede es que las entradas queden retenidas
  // porque falta un documento.
  const { db, admin } = montar({
    rooms: {
      HUERFANA: { estado: ESTADOS_SALA.JUGANDO, entrada: 50, jugadores: ["ana"], jugadoresNombres: ["A"] },
    },
  });

  const r = await admin.cancelarSala(comoAdmin, { codigo: "HUERFANA", forzar: true });
  ok(r.devueltas === 50, "la entrada vuelve igual", r.devueltas);
  ok(db.leer("rooms", "HUERFANA").estado === ESTADOS_SALA.CANCELADA, "y la sala queda cancelada");
}

console.log("\n=== 5e. El barrido masivo NUNCA corta una partida ===");
{
  // `cancelarTodasEnEspera` consulta sólo las que esperan, y además llama sin
  // confirmación. Las dos cosas, porque es el botón que se toca a ciegas.
  const { db, admin, banco } = montar({
    rooms: {
      ESPERA9: { estado: ESTADOS_SALA.ESPERANDO, entrada: 25, jugadores: ["ana"], jugadoresNombres: ["A"] },
      JUEGA9: { estado: ESTADOS_SALA.JUGANDO, entrada: 500, jugadores: ["beto"], jugadoresNombres: ["B"] },
    },
  });

  const r = await admin.cancelarTodasEnEspera(comoAdmin);
  ok(r.canceladas === 1, "cancela la que esperaba", r.canceladas);
  ok(db.leer("rooms", "JUEGA9").estado === ESTADOS_SALA.JUGANDO, "y no toca la que juega");
  ok(
    banco.movimientos.every((m) => m.uid !== "beto"),
    "a beto no se le mueve nada",
    banco.movimientos,
  );
}

// ======================================= 6. cancelar todas las que esperan

console.log("\n=== 6. Cancelar todas las que esperan ===");
{
  const espera = (jug) => ({ estado: ESTADOS_SALA.ESPERANDO, entrada: 25, jugadores: jug, jugadoresNombres: jug });
  const { db, admin, banco } = montar({
    rooms: {
      E1: espera(["ana"]),
      E2: espera(["beto", "caro"]),
      E3: espera([]),                                   // sala vacía: nada que devolver
      J1: { estado: ESTADOS_SALA.JUGANDO, entrada: 25, jugadores: ["dani"], jugadoresNombres: ["D"] },
      T1: { estado: ESTADOS_SALA.TERMINADA, entrada: 25, jugadores: ["ana"], jugadoresNombres: ["A"] },
    },
  });

  const r = await admin.cancelarTodasEnEspera(comoAdmin);
  ok(r.intentadas === 3, "toma sólo las que esperan", r.intentadas);
  ok(r.canceladas === 3, "las cancela", r.canceladas);
  ok(r.fallidas.length === 0, "sin fallas", r.fallidas);
  ok(r.devueltasEnTotal === 75, "devuelve 3 entradas de 25", r.devueltasEnTotal);
  ok(banco.movimientos.length === 3, "tres movimientos", banco.movimientos.length);

  ok(db.leer("rooms", "J1").estado === ESTADOS_SALA.JUGANDO, "la que jugaba no se tocó");
  ok(db.leer("rooms", "T1").estado === ESTADOS_SALA.TERMINADA, "ni la terminada");
  ok(db.leer("rooms", "E3").estado === ESTADOS_SALA.CANCELADA, "la sala vacía también se cancela");

  // Repetir es inofensivo.
  const otra = await admin.cancelarTodasEnEspera(comoAdmin);
  ok(otra.intentadas === 0, "repetir no encuentra ninguna", otra.intentadas);
  ok(banco.movimientos.length === 3, "y no paga de nuevo", banco.movimientos.length);
}

// ======================================= 6b. retocar una sala en espera

console.log("\n=== 6b. Lo que se puede retocar de una sala ===");
{
  const { db, admin } = montar({
    rooms: {
      RETOQUE: {
        estado: ESTADOS_SALA.ESPERANDO, entrada: 50, maxJugadores: 4,
        nombre: "Sala", jugadores: ["ana", "beto"], jugadoresNombres: ["A", "B"],
      },
    },
  });

  const r = await admin.editarSala(comoAdmin, { codigo: "RETOQUE", nombre: "Mesa de los martes" });
  ok(r.cambios.nombre === "Mesa de los martes", "el nombre se cambia", r.cambios);
  ok(db.leer("rooms", "RETOQUE").nombre === "Mesa de los martes", "y queda escrito");
  ok(db.leer("rooms", "RETOQUE").entrada === 50, "sin tocar la entrada");

  await admin.editarSala(comoAdmin, { codigo: "RETOQUE", maxJugadores: 3 });
  ok(db.leer("rooms", "RETOQUE").maxJugadores === 3, "el cupo también");

  const chico = await capturar(() =>
    admin.editarSala(comoAdmin, { codigo: "RETOQUE", maxJugadores: 1 }));
  ok(chico.error, "el cupo no baja de lo permitido", chico.error?.message);

  // Por debajo de los que YA entraron, tampoco: dejaría una sala con más
  // gente que lugares, que el panel mostraría como 3/2.
  const { admin: a2, db: db2 } = montar({
    rooms: {
      LLENA: {
        estado: ESTADOS_SALA.ESPERANDO, entrada: 50, maxJugadores: 4,
        jugadores: ["ana", "beto", "caro"], jugadoresNombres: ["A", "B", "C"],
      },
    },
  });
  const bajo = await capturar(() => a2.editarSala(comoAdmin, { codigo: "LLENA", maxJugadores: 2 }));
  ok(bajo.error?.codigo === "failed-precondition", "ni por debajo de los que ya entraron", bajo.error?.message);
  ok(db2.leer("rooms", "LLENA").maxJugadores === 4, "y el cupo queda como estaba");
}

console.log("\n=== 6c. La entrada NO se toca desde el panel ===");
{
  /**
   * No hay campo que mandar, y no es un olvido: la entrada queda fija en
   * cuanto alguien pagó, y en una sala viva siempre pagó alguien —la paga el
   * creador al crearla, y si el creador se va la sala se cancela entera—.
   *
   * Si se pudiera cambiar, la sala guardaría un `pozo` congelado que ya no
   * coincide con lo que cada jugador pagó. Para cambiar la apuesta se cancela
   * (que devuelve) y se abre otra.
   */
  const { db, admin } = montar({
    rooms: {
      APUESTA: {
        estado: ESTADOS_SALA.ESPERANDO, entrada: 50, pozo: 100, maxJugadores: 4,
        jugadores: ["ana", "beto"], jugadoresNombres: ["A", "B"],
      },
    },
  });

  const r = await capturar(() =>
    admin.editarSala(comoAdmin, { codigo: "APUESTA", entrada: 500 }));
  ok(r.error?.codigo === "invalid-argument", "mandar sólo la entrada no cambia nada", r.error?.message);
  ok(db.leer("rooms", "APUESTA").entrada === 50, "la entrada sigue siendo la de siempre");

  await admin.editarSala(comoAdmin, { codigo: "APUESTA", nombre: "Otra", entrada: 500 });
  ok(db.leer("rooms", "APUESTA").entrada === 50, "ni de contrabando junto al nombre");
  ok(db.leer("rooms", "APUESTA").pozo === 100, "y el pozo tampoco se mueve");

  const { admin: a2 } = montar({
    rooms: { YAVA: { estado: ESTADOS_SALA.JUGANDO, entrada: 50, jugadores: ["ana"], jugadoresNombres: ["A"] } },
  });
  const jugando = await capturar(() => a2.editarSala(comoAdmin, { codigo: "YAVA", nombre: "x" }));
  ok(jugando.error?.codigo === "failed-precondition", "una sala jugando no se retoca", jugando.error?.message);
}

// ============================================ 6d. borrar las salas muertas

console.log("\n=== 6d. Sólo se borra lo que no le debe nada a nadie ===");
{
  const { db, admin } = montar({
    rooms: {
      VIVA: { estado: ESTADOS_SALA.ESPERANDO, entrada: 50, jugadores: ["ana"], jugadoresNombres: ["A"] },
      JUEGA: { estado: ESTADOS_SALA.JUGANDO, entrada: 50, jugadores: ["ana"], jugadoresNombres: ["A"] },
      MUERTA: { estado: ESTADOS_SALA.TERMINADA, entrada: 50, jugadores: ["ana"], jugadoresNombres: ["A"] },
    },
  });

  for (const codigo of ["VIVA", "JUEGA"]) {
    const r = await capturar(() => admin.eliminarSala(comoAdmin, { codigo }));
    ok(r.error?.codigo === "failed-precondition", `${codigo} no se borra`, r.error?.codigo);
    ok(/cancelala/i.test(r.error?.message ?? ""), `${codigo}: y dice qué hacer antes`, r.error?.message);
    ok(db.existe("rooms", codigo), `${codigo} sigue estando`);
  }

  await admin.eliminarSala(comoAdmin, { codigo: "MUERTA" });
  ok(!db.existe("rooms", "MUERTA"), "la terminada sí se borra");

  const noExiste = await capturar(() => admin.eliminarSala(comoAdmin, { codigo: "NADA" }));
  ok(noExiste.error?.codigo === "not-found", "y una que no existe se rechaza", noExiste.error?.codigo);
}

console.log("\n=== 6e. Se lleva la partida y las vistas ===");
{
  // Las vistas son una subcolección de la partida: sin borrarlas quedan
  // documentos huérfanos que nadie va a volver a leer y que siguen ocupando.
  const { db, admin } = montar({
    rooms: { FIN: { estado: ESTADOS_SALA.CANCELADA, entrada: 50, jugadores: ["ana", "beto"], jugadoresNombres: ["A", "B"] } },
    partidas: { FIN: { estado: { fase: "finPartida" }, cerrada: true, version: 9 } },
    "partidas/FIN/vistas": { ana: { yo: 0 }, beto: { yo: 1 } },
  });

  const r = await admin.eliminarSala(comoAdmin, { codigo: "FIN" });

  ok(r.vistas === 2, "cuenta las vistas que borró", r.vistas);
  ok(!db.existe("rooms", "FIN"), "la sala se fue");
  ok(!db.existe("partidas", "FIN"), "la partida también");
  ok(db.cuantos("partidas/FIN/vistas") === 0, "y no quedó ninguna vista", db.cuantos("partidas/FIN/vistas"));
}

console.log("\n=== 6f. Limpiar todas las cerradas de una pasada ===");
{
  /**
   * Por qué existe: `listarSalas` lee la colección ENTERA en cada refresco y
   * descarta las cerradas DESPUÉS de leerlas. Sin una limpieza, abrir el panel
   * cuesta cada vez más, y crece con todas las salas que hubo desde siempre.
   */
  const rooms = {};
  for (let i = 0; i < 6; i++) {
    rooms[`FIN${i}`] = {
      estado: i % 2 ? ESTADOS_SALA.TERMINADA : ESTADOS_SALA.CANCELADA,
      entrada: 10, jugadores: [], jugadoresNombres: [],
    };
  }
  rooms.VIVA = { estado: ESTADOS_SALA.ESPERANDO, entrada: 10, jugadores: ["ana"], jugadoresNombres: ["A"] };
  rooms.JUEGA = { estado: ESTADOS_SALA.JUGANDO, entrada: 10, jugadores: ["ana"], jugadoresNombres: ["A"] };

  const { db, admin } = montar({ rooms });
  const r = await admin.limpiarSalasCerradas(comoAdmin, {});

  ok(r.encontradas === 6, "encuentra las seis cerradas", r.encontradas);
  ok(r.borradas === 6, "y las borra", r.borradas);
  ok(r.quedan === 0, "no queda ninguna", r.quedan);
  ok(db.existe("rooms", "VIVA") && db.existe("rooms", "JUEGA"), "las vivas siguen enteras");

  // El tope existe porque un lote de Firestore admite 500 escrituras.
  const { admin: a2, db: db2 } = montar({ rooms: { ...rooms } });
  const conTope = await a2.limpiarSalasCerradas(comoAdmin, { tope: 2 });
  ok(conTope.borradas === 2, "con tope, borra sólo esas", conTope.borradas);
  ok(conTope.quedan === 4, "y dice cuántas quedan", conTope.quedan);
  ok(db2.cuantos("rooms") === 6, "quedan las cuatro cerradas y las dos vivas", db2.cuantos("rooms"));
}

// ============================ 7. las lecturas van antes que las escrituras

console.log("\n=== 7. Firestore: leer antes de escribir ===");
{
  // El doble falso lanza si se lee después de escribir, igual que Firestore.
  // Es el bug que tuvo `salida.js` y que ninguna prueba veía.
  const { admin } = montar({
    rooms: {
      E1: { estado: ESTADOS_SALA.ESPERANDO, entrada: 10, jugadores: ["a", "b", "c", "d"], jugadoresNombres: ["a","b","c","d"] },
    },
  });
  const r = await capturar(() => admin.cancelarSala(comoAdmin, { codigo: "E1" }));
  ok(Boolean(r.valor) && !r.error, "cancelar con cuatro jugadores no lee tras escribir", r.error?.message);
  ok(r.valor?.devueltas === 40, "y devuelve las cuatro entradas", r.valor?.devueltas);
}

console.log("\n=== Revisar nombres guardados ===");
{
  // El escapado tapa la SALIDA, pero lo que se guardó antes sigue guardado.
  // Esto lista lo que habría que mirar. Vive en el servidor porque `users`
  // pasó a leerse sólo por su dueño —el saldo está en ese documento— y ya no
  // se puede listar desde el navegador.
  const perfiles = [
    ["u1", "Sebastián"],
    ["u2", "O'Brien"],
    ["u3", "Tom & Jerry"],
    ["u4", '<img src=x onerror=alert(1)>'],
    ["u5", "<script>fetch(1)</script>"],
    ["u6", "Vex_99"],
    ["u7", "javascript:alert(1)"],
    ["u8", null],
    ["u9", 12345],
  ];
  const db = {
    collection: () => ({
      get: async () => ({
        size: perfiles.length,
        forEach: (fn) => perfiles.forEach(([id, username]) => fn({ id, data: () => ({ username }) })),
      }),
    }),
  };
  const panel = crearAdmin({
    db, salas: "rooms", partidas: "partidas", moverLeyendas: null,
    motivo: "x", marcaDeTiempo: () => "T", error,
    administradores: crearAdministradores({ db, error, correoRaiz: ADMIN }),
  });

  // Sólo el administrador, con el correo verificado.
  for (const [quien, ctx] of [
    ["otro correo", { auth: { token: { email: "otro@x.com", email_verified: true } } }],
    ["correo sin verificar", { auth: { token: { email: ADMIN, email_verified: false } } }],
    ["sin sesión", {}],
  ]) {
    let rechazado = false;
    try { await panel.revisarNombres(ctx); } catch { rechazado = true; }
    ok(rechazado, `${quien} no puede revisar nombres`);
  }

  const r = await panel.revisarNombres({ auth: { token: { email: ADMIN, email_verified: true } } });

  ok(r.revisados === perfiles.length, "cuenta todos los perfiles", r.revisados);
  ok(r.sospechosos.length === 5, "marca los cinco raros y deja pasar los normales",
     r.sospechosos.map((s) => s.nombre));
  ok(r.ataques === 3, "y distingue los tres que parecen un intento", r.ataques);

  const nombres = r.sospechosos.map((s) => s.nombre);
  ok(!nombres.includes("Sebastián") && !nombres.includes("Vex_99"),
     "un nombre común no se marca");
  ok(nombres.includes("O'Brien") && nombres.includes("Tom & Jerry"),
     "pero una comilla o un & sí, aunque no sean un ataque");
  ok(r.sospechosos.find((s) => s.nombre === "O'Brien")?.pareceAtaque === false,
     "y esos NO se marcan como ataque: son nombres de gente");

  // `javascript:alert(1)` no tiene ninguno de <>"'& y como nombre no es
  // explotable, pero la intención se ve. Se marca igual.
  ok(nombres.includes("javascript:alert(1)"), "se marca la intención, no sólo los caracteres");

  ok(r.sospechosos[0].pareceAtaque === true, "los ataques van primero en la lista");

  // Un perfil sin nombre o con un número no rompe la revisión.
  ok(!r.sospechosos.some((s) => s.uid === "u8" || s.uid === "u9"),
     "los perfiles sin nombre usable se saltean sin romper nada");

  // Lo que devuelve es el nombre CRUDO: quien revisa necesita ver qué se
  // guardó, no una versión limpia. El panel lo escapa al pintarlo.
  ok(r.sospechosos.some((s) => s.nombre.includes("<img")),
     "el nombre viaja tal cual está guardado");
}

console.log("\n=== Cuentas: listar y dar de baja ===");
{
  // Lo que decide el camino no es una opción de la interfaz: es si la cuenta
  // tiene algo que perder. Sin saldo ni partidas se borra; con cualquiera de
  // las dos cosas se desactiva, porque ese saldo es dinero de alguien y sus
  // partidas están en el ranking de los demás.
  const cuentas = {
    vacia: { username: "Prueba", credits: 0, gamesPlayed: 0, wins: 0 },
    conSaldo: { username: "Ana", credits: 250, gamesPlayed: 0, wins: 0 },
    conPartidas: { username: "Bruno", credits: 0, gamesPlayed: 12, wins: 3 },
    yaBaja: { username: "Vieja", credits: 0, gamesPlayed: 0, wins: 0, desactivado: true },
  };

  const borrados = [];
  const escrituras = [];
  const hacerDb = () => ({
    collection: () => ({
      doc: (id) => ({
        get: async () => ({ exists: id in cuentas, data: () => cuentas[id] }),
        set: async (datos) => escrituras.push({ id, datos }),
        delete: async () => borrados.push(id),
      }),
      get: async () => ({
        size: Object.keys(cuentas).length,
        forEach: (fn) => Object.entries(cuentas).forEach(([id, d]) => fn({ id, data: () => d })),
      }),
    }),
  });

  const nuevoPanel = () => {
    // UNA sola base para el panel y para la comprobación de administrador: si
    // fueran dos, la comprobación miraría una colección vacía distinta de la
    // que usa el panel, y la prueba pasaría por el motivo equivocado.
    const db = hacerDb();
    return crearAdmin({
      db, salas: "rooms", partidas: "partidas", moverLeyendas: null,
      motivo: "x", marcaDeTiempo: () => "T", error,
      administradores: crearAdministradores({ db, error, correoRaiz: ADMIN }),
    });
  };
  const comoAdmin = { auth: { uid: "admin-uid", token: { email: ADMIN, email_verified: true } } };

  // --- permisos ---
  for (const [quien, ctx] of [
    ["otro correo", { auth: { token: { email: "otro@x.com", email_verified: true } } }],
    ["sin verificar", { auth: { token: { email: ADMIN, email_verified: false } } }],
    ["sin sesión", {}],
  ]) {
    for (const fn of ["listarUsuarios", "eliminarUsuario"]) {
      let rechazado = false;
      try { await nuevoPanel()[fn](ctx, { uid: "vacia" }); } catch { rechazado = true; }
      ok(rechazado, `${quien} no puede ${fn}`);
    }
  }

  // --- listado ---
  const lista = await nuevoPanel().listarUsuarios(comoAdmin);
  ok(lista.total === 4, "lista todas las cuentas", lista.total);
  ok(lista.vacias === 2, "y cuenta las que no tienen nada que perder", lista.vacias);
  const porUid = Object.fromEntries(lista.cuentas.map((c) => [c.uid, c]));
  ok(porUid.vacia.vacia === true, "sin saldo ni partidas: vacía");
  ok(porUid.conSaldo.vacia === false, "con saldo: NO vacía");
  ok(porUid.conPartidas.vacia === false, "con partidas: NO vacía");
  ok(lista.cuentas[0].vacia === true, "las vacías van primero");
  ok(porUid.yaBaja.desactivado === true, "y se ve cuál ya estaba desactivada");

  // --- la baja ---
  const r1 = await nuevoPanel().eliminarUsuario(comoAdmin, { uid: "vacia" });
  ok(r1.hizo === "eliminado", "una cuenta vacía se borra", r1.hizo);
  ok(borrados.includes("vacia"), "y de verdad se borró el documento");

  escrituras.length = 0;
  const r2 = await nuevoPanel().eliminarUsuario(comoAdmin, { uid: "conSaldo" });
  ok(r2.hizo === "desactivado", "una con SALDO se desactiva, no se borra", r2.hizo);
  ok(!borrados.includes("conSaldo"), "su documento sigue ahí");
  ok(escrituras.some((e) => e.id === "conSaldo" && e.datos.desactivado === true),
     "marcada como desactivada");

  const r3 = await nuevoPanel().eliminarUsuario(comoAdmin, { uid: "conPartidas" });
  ok(r3.hizo === "desactivado", "una con PARTIDAS tampoco se borra", r3.hizo);
  ok(!borrados.includes("conPartidas"), "su historial sigue en el ranking de los demás");

  // --- los bordes ---
  const r4 = await nuevoPanel().eliminarUsuario(comoAdmin, { uid: "no-existe" });
  ok(r4.hizo === "no_existia", "una cuenta que no está no rompe nada", r4.hizo);

  for (const malo of ["", "   ", null, undefined]) {
    let salto = false;
    try { await nuevoPanel().eliminarUsuario(comoAdmin, { uid: malo }); } catch { salto = true; }
    ok(salto, `un uid ${JSON.stringify(malo)} se rechaza`);
  }

  // El administrador no puede borrarse a sí mismo por accidente: quedaría sin
  // perfil y sin poder entrar a arreglarlo.
  let propio = false;
  try { await nuevoPanel().eliminarUsuario(comoAdmin, { uid: "admin-uid" }); } catch { propio = true; }
  ok(propio, "el administrador no puede darse de baja a sí mismo");
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
