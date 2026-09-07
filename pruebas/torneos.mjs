/**
 * Torneos: que la plata que entra sea exactamente la que sale.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE DEFIENDE ACÁ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un torneo es la operación más cara del juego: junta entradas de mucha gente
 * en un pozo y después lo reparte. Cinco cosas pueden salir mal, y las cinco
 * salen mal a favor de alguien:
 *
 *   1. Que se pague MÁS de lo que entró. Dos redondeos hacia arriba sobre un
 *      pozo chico alcanzan. Eso sería imprimir Leyendas.
 *   2. Que se cobre dos veces la misma entrada. Doble clic, o la red que
 *      reintenta sola: son dos problemas distintos y hacen falta dos defensas.
 *   3. Que se devuelva dos veces al cancelar. Cien inscriptos son cien
 *      transacciones y algo se puede cortar en el medio; correrlo de nuevo
 *      tiene que terminar el trabajo, no duplicarlo.
 *   4. Que se le pague a alguien que no jugó.
 *   5. Que un torneo vuelva para atrás. Reabrir las inscripciones de uno ya
 *      jugado cobraría la entrada una segunda vez.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL FIRESTORE ES DE MENTIRA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Por lo mismo que en `pruebas/tienda.mjs`: lo que hay que verificar es el
 * ORDEN de las operaciones dentro de cada transacción, y eso no se ve leyendo
 * el código. Se ve cuando el falso Firestore se queja de que alguien leyó
 * después de escribir, que es lo que el Firestore de verdad rechaza.
 */

import { crearTorneos } from "../functions/torneos.js";
import { crearMoverLeyendas } from "../functions/leyendas.js";
import { MOTIVOS } from "../public/js/reglas/economia.js";
import {
  ESTADOS,
  puedePasarA,
  armarMesas,
  repartirPozo,
  pozoDe,
  puntosDeTorneo,
} from "../public/js/reglas/torneos.js";

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

/** Firestore de mentira con subcolecciones, igual que el de la tienda. */
function crearFirestore(inicial = {}) {
  const docs = new Map(Object.entries(inicial));
  let siguienteId = 1;

  const coleccion = (prefijo) => ({
    doc: (id) => documento(`${prefijo}/${id ?? `auto${siguienteId++}`}`),
    async get() {
      const filas = [...docs.entries()]
        .filter(([r]) => r.startsWith(`${prefijo}/`) && !r.slice(prefijo.length + 1).includes("/"))
        .map(([r, d]) => ({ id: r.slice(prefijo.length + 1), data: () => ({ ...d }) }));
      return { size: filas.length, forEach: (fn) => filas.forEach(fn) };
    },
  });

  const documento = (ruta) => ({
    ruta,
    id: ruta.split("/").pop(),
    collection: (sub) => coleccion(`${ruta}/${sub}`),
    async get() {
      const d = docs.get(ruta);
      return { exists: Boolean(d), id: ruta.split("/").pop(), data: () => (d ? { ...d } : undefined) };
    },
    async set(datos, opciones) {
      docs.set(ruta, opciones?.merge ? { ...(docs.get(ruta) ?? {}), ...datos } : datos);
    },
  });

  return {
    collection: coleccion,
    async runTransaction(cuerpo) {
      let escribio = false;
      const pendientes = [];
      const r = await cuerpo({
        async get(ref) {
          if (escribio) throw error("failed-precondition", "Lectura después de escritura");
          const d = docs.get(ref.ruta);
          return { exists: Boolean(d), data: () => (d ? { ...d } : undefined) };
        },
        set(ref, datos, opciones) {
          escribio = true;
          pendientes.push([ref.ruta, datos, opciones?.merge]);
        },
        update(ref, datos) {
          escribio = true;
          pendientes.push([ref.ruta, datos, true]);
        },
      });
      for (const [ruta, datos, fusionar] of pendientes) {
        docs.set(ruta, fusionar ? { ...(docs.get(ruta) ?? {}), ...datos } : datos);
      }
      return r;
    },
    _leer: (r) => docs.get(r),
    _rutas: () => [...docs.keys()],
  };
}

const ADMIN = { auth: { uid: "admin" } };

function montar({ saldos = {} } = {}) {
  const inicial = {};
  for (const [uid, credits] of Object.entries(saldos)) {
    inicial[`users/${uid}`] = { credits, username: uid };
  }

  const db = crearFirestore(inicial);
  const moverLeyendas = crearMoverLeyendas({
    db,
    usuarios: "users",
    campoSaldo: "credits",
    marcaDeTiempo: () => "T",
    error,
  });

  const torneos = crearTorneos({
    db,
    moverLeyendas,
    marcaDeTiempo: () => "T",
    error,
    administradores: { exigir: async () => ({ uid: "admin" }) },
    motivoEntrada: MOTIVOS.TORNEO_ENTRADA,
    motivoPremio: MOTIVOS.TORNEO_PREMIO,
    motivoDevolucion: MOTIVOS.TORNEO_DEVOLUCION,
    // Identidad: para poder afirmar quién queda en qué mesa. En producción es
    // Fisher-Yates con `crypto.randomInt`.
    barajar: (x) => x,
    claveDeSemana: () => "2026-S37",
    incremento: (n) => ({ __inc: n }),
  });

  return { db, torneos };
}

/** Un torneo abierto con `cuantos` inscriptos que pagaron `entrada`. */
async function conInscriptos(cuantos, entrada = 100) {
  const saldos = {};
  for (let i = 1; i <= cuantos; i++) saldos[`j${i}`] = 10000;

  const { db, torneos } = montar({ saldos });
  const { id } = await torneos.crear(ADMIN, { nombre: "Copa", entrada });
  await torneos.abrirInscripciones(ADMIN, id);
  for (let i = 1; i <= cuantos; i++) await torneos.inscribir(`j${i}`, id);

  return { db, torneos, id };
}

// =====================================================================
console.log("\n=== 1. Las reglas puras: mesas, pozo y reparto ===");
// =====================================================================

{
  const diez = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
  const { mesas, sobrantes } = armarMesas(diez);

  ok(mesas.length === 2, "diez inscriptos dan dos mesas", mesas.length);
  ok(mesas.every((m) => m.jugadores.length === 4), "todas de cuatro");
  ok(sobrantes.length === 2, "y dos que sobran", sobrantes);

  // Nadie en dos mesas, y nadie perdido.
  const sentados = mesas.flatMap((m) => m.jugadores);
  ok(new Set(sentados).size === sentados.length, "nadie queda en dos mesas");
  ok(
    new Set([...sentados, ...sobrantes]).size === diez.length,
    "y no se pierde ni se duplica nadie",
  );

  ok(armarMesas(["a", "b", "c"]).mesas.length === 0, "con tres no se arma ninguna mesa");
}

{
  // El pozo TIENE que cerrar. Ésta es la comprobación que impide imprimir
  // Leyendas: se prueba con muchos pozos, incluidos los que no dividen bien.
  let cierranTodos = true;
  const malos = [];
  for (const entrada of [5, 7, 13, 100, 333, 20000]) {
    for (const jugadores of [4, 8, 12, 40]) {
      const pozo = pozoDe(entrada, jugadores);
      const r = repartirPozo(pozo, ["a", "b"]);
      if (r.repartido + r.comisionCasa !== pozo || r.comisionCasa < 0) {
        cierranTodos = false;
        malos.push({ entrada, jugadores, pozo, ...r });
      }
    }
  }
  ok(cierranTodos, "el pozo cierra exacto en todos los casos probados", malos.slice(0, 3));

  const r = repartirPozo(1000, ["a", "b"]);
  ok(r.pagos[0].monto === 600, "el primero se lleva el 60%", r.pagos[0]?.monto);
  ok(r.pagos[1].monto === 300, "el segundo el 30%", r.pagos[1]?.monto);
  ok(r.comisionCasa === 100, "y la casa el 10%", r.comisionCasa);

  // Un solo ganador NO se lleva el tramo del segundo.
  const uno = repartirPozo(1000, ["a"]);
  ok(uno.repartido === 600, "con un solo ganador se paga sólo su tramo", uno.repartido);
  ok(uno.comisionCasa === 400, "el resto queda sin repartir, no se regala", uno.comisionCasa);

  ok(puntosDeTorneo(["a", "b", "c", "d"]).length === 4, "los cuatro puestos suman puntos");
  ok(puntosDeTorneo([]).length === 0, "y sin ganadores no hay puntos");
}

// =====================================================================
console.log("\n=== 2. Los estados son un camino de ida ===");
// =====================================================================

{
  ok(puedePasarA(ESTADOS.BORRADOR, ESTADOS.INSCRIPCIONES_ABIERTAS), "borrador → abierto");
  ok(puedePasarA(ESTADOS.COMPLETO, ESTADOS.EN_CURSO), "completo → en curso");
  ok(puedePasarA(ESTADOS.EN_CURSO, ESTADOS.FINALIZADO), "en curso → finalizado");

  // Lo que NO se puede, que es lo que importa.
  ok(
    !puedePasarA(ESTADOS.FINALIZADO, ESTADOS.INSCRIPCIONES_ABIERTAS),
    "un torneo jugado NO vuelve a abrir inscripciones",
  );
  ok(!puedePasarA(ESTADOS.EN_CURSO, ESTADOS.CANCELADO), "y uno en curso ya no se cancela");
  ok(!puedePasarA(ESTADOS.FINALIZADO, ESTADOS.CANCELADO), "ni uno finalizado");
  ok(!puedePasarA(ESTADOS.BORRADOR, ESTADOS.EN_CURSO), "no se salta de borrador a en curso");
}

{
  const { torneos, id } = await conInscriptos(4);

  const { error: e } = await capturar(() => torneos.abrirInscripciones(ADMIN, id));
  ok(e?.codigo === "failed-precondition", "abrir dos veces se rechaza", e?.codigo);

  const { error: e2 } = await capturar(() => torneos.iniciar(ADMIN, id));
  ok(e2?.codigo === "failed-precondition", "e iniciar sin cerrar inscripciones también", e2?.codigo);
}

// =====================================================================
console.log("\n=== 3. Crear valida la entrada contra el rango acordado ===");
// =====================================================================

{
  const { torneos } = montar();

  const malas = [
    [3, "menor al mínimo"],
    [20005, "mayor al máximo"],
    [17, "que no va de a 5"],
    [0, "en cero"],
    [-100, "negativa"],
  ];

  for (const [entrada, por] of malas) {
    const { error: e } = await capturar(() => torneos.crear(ADMIN, { nombre: "X", entrada }));
    ok(e?.codigo === "invalid-argument", `una entrada ${por} se rechaza`, { entrada, e: e?.codigo });
  }

  const { error: sinNombre } = await capturar(() => torneos.crear(ADMIN, { nombre: "", entrada: 100 }));
  ok(sinNombre?.codigo === "invalid-argument", "y sin nombre también");

  const r = await torneos.crear(ADMIN, { nombre: "Copa", entrada: 20000 });
  ok(r.estado === ESTADOS.BORRADOR, "uno válido nace en borrador", r.estado);
}

{
  // Editar sólo en borrador: después ya hay gente que pagó.
  const { torneos, id } = await conInscriptos(4);
  const { error: e } = await capturar(() =>
    torneos.editar(ADMIN, id, { nombre: "Otra", entrada: 5 }));
  ok(e?.codigo === "failed-precondition", "no se edita un torneo con inscriptos", e?.codigo);
  ok(/pagó la entrada/.test(e?.message ?? ""), "y el mensaje dice por qué");
}

// =====================================================================
console.log("\n=== 4. Inscribirse cobra una vez, y una sola ===");
// =====================================================================

{
  const { db, torneos, id } = await conInscriptos(4, 250);

  ok(db._leer("users/j1").credits === 9750, "le cobra la entrada", db._leer("users/j1").credits);
  ok(db._leer(`torneos/${id}`).inscriptos === 4, "cuenta los inscriptos");
  ok(db._leer(`torneos/${id}`).pozo === 1000, "y arma el pozo", db._leer(`torneos/${id}`).pozo);
  ok(Boolean(db._leer(`torneos/${id}/inscripciones/j1`)), "queda anotado quién es");

  const { error: e } = await capturar(() => torneos.inscribir("j1", id));
  ok(e?.codigo === "already-exists", "inscribirse dos veces se rechaza", e?.codigo);
  ok(db._leer("users/j1").credits === 9750, "y no cobra de nuevo");

  // El asiento en el libro mayor, con su motivo propio: sin él, la entrada de
  // un torneo sería indistinguible de una apuesta de mesa.
  const asientos = db._rutas().filter((r) => r.startsWith("movimientos/"));
  ok(asientos.length === 4, "un asiento por inscripción", asientos.length);
  ok(
    db._leer(asientos[0])?.motivo === MOTIVOS.TORNEO_ENTRADA,
    "con el motivo de entrada de torneo",
    db._leer(asientos[0])?.motivo,
  );
}

{
  const { db, torneos } = montar({ saldos: { pobre: 50 } });
  const { id } = await torneos.crear(ADMIN, { nombre: "Copa", entrada: 500 });
  await torneos.abrirInscripciones(ADMIN, id);

  const { error: e } = await capturar(() => torneos.inscribir("pobre", id));
  ok(e?.codigo === "failed-precondition", "sin saldo no se inscribe", e?.codigo);
  ok(db._leer("users/pobre").credits === 50, "el saldo queda intacto");
  ok(!db._leer(`torneos/${id}/inscripciones/pobre`), "y no queda anotado");
}

{
  const { torneos } = montar({ saldos: { j1: 5000 } });
  const { id } = await torneos.crear(ADMIN, { nombre: "Copa", entrada: 100 });

  const { error: e } = await capturar(() => torneos.inscribir("j1", id));
  ok(e?.codigo === "failed-precondition", "no se puede entrar a un borrador", e?.codigo);
}

{
  // El tope de jugadores se respeta.
  const saldos = {};
  for (let i = 1; i <= 5; i++) saldos[`j${i}`] = 10000;
  const { torneos } = montar({ saldos });
  const { id } = await torneos.crear(ADMIN, { nombre: "Chico", entrada: 100, maxJugadores: 4 });
  await torneos.abrirInscripciones(ADMIN, id);
  for (let i = 1; i <= 4; i++) await torneos.inscribir(`j${i}`, id);

  const { error: e } = await capturar(() => torneos.inscribir("j5", id));
  ok(e?.codigo === "resource-exhausted", "el quinto no entra en un torneo de cuatro", e?.codigo);
}

// =====================================================================
console.log("\n=== 5. Con menos de cuatro se cancela y se devuelve todo ===");
// =====================================================================

{
  const { db, torneos, id } = await conInscriptos(3, 300);

  const r = await torneos.cerrarInscripciones(ADMIN, id);

  ok(r.cancelado === true, "cerrar con tres cancela el torneo", r);
  ok(db._leer(`torneos/${id}`).estado === ESTADOS.CANCELADO, "queda cancelado");
  ok(r.devueltos === 3, "y devuelve las tres entradas", r.devueltos);

  for (let i = 1; i <= 3; i++) {
    ok(db._leer(`users/j${i}`).credits === 10000, `  j${i} recuperó todo`, db._leer(`users/j${i}`).credits);
  }
}

// =====================================================================
console.log("\n=== 6. Cancelar es seguro de repetir ===");
// =====================================================================

{
  const { db, torneos, id } = await conInscriptos(6, 200);
  await torneos.cancelar(ADMIN, id, { motivo: "Se suspende" });

  ok(db._leer("users/j1").credits === 10000, "devuelve la entrada");
  ok(db._leer(`torneos/${id}`).motivoCancelacion === "Se suspende", "y guarda el motivo");

  // Correrlo de nuevo NO paga otra vez. Cancelar un torneo con cien inscriptos
  // son cien transacciones y algo se puede cortar en el medio; reintentar
  // tiene que terminar el trabajo, no duplicarlo.
  const { error: e } = await capturar(() => torneos.cancelar(ADMIN, id));
  ok(e?.codigo === "failed-precondition", "cancelar dos veces se rechaza", e?.codigo);
  ok(db._leer("users/j1").credits === 10000, "y el saldo no subió de nuevo");
}

{
  // Cancelar un borrador no devuelve nada porque nadie pagó.
  const { db, torneos } = montar();
  const { id } = await torneos.crear(ADMIN, { nombre: "Copa", entrada: 100 });
  const r = await torneos.cancelar(ADMIN, id);

  ok(r.devueltos === 0, "cancelar un borrador no devuelve nada", r.devueltos);
  ok(!db._rutas().some((x) => x.startsWith("movimientos/")), "ni toca el libro mayor");
}

// =====================================================================
console.log("\n=== 7. Iniciar arma las mesas y devuelve a los que sobran ===");
// =====================================================================

{
  const { db, torneos, id } = await conInscriptos(10, 100);
  await torneos.cerrarInscripciones(ADMIN, id);

  const r = await torneos.iniciar(ADMIN, id);

  ok(r.mesas.length === 2, "dos mesas con diez inscriptos", r.mesas.length);
  ok(r.devueltos.length === 2, "y a los dos que sobran se les devuelve", r.devueltos);
  ok(db._leer("users/j9").credits === 10000, "j9 recuperó su entrada");
  ok(db._leer("users/j10").credits === 10000, "j10 también");
  ok(db._leer("users/j1").credits === 9900, "y a los que juegan no se les devuelve nada");

  // El pozo se recalcula con los que EFECTIVAMENTE juegan: la plata de los
  // sobrantes ya volvió a su dueño y no se puede repartir.
  ok(r.pozo === 800, "el pozo baja a lo que juntan los que juegan", r.pozo);
  ok(db._leer(`torneos/${id}`).estado === ESTADOS.EN_CURSO, "y el torneo arranca");
}

// =====================================================================
console.log("\n=== 8. Finalizar paga desde el pozo del servidor ===");
// =====================================================================

{
  const { db, torneos, id } = await conInscriptos(8, 100);
  await torneos.cerrarInscripciones(ADMIN, id);
  await torneos.iniciar(ADMIN, id);

  const antes1 = db._leer("users/j1").credits;
  const antes2 = db._leer("users/j2").credits;

  const r = await torneos.finalizar(ADMIN, id, ["j1", "j2"]);

  ok(r.repartido === 720, "reparte el 90% del pozo de 800", r.repartido);
  ok(r.comisionCasa === 80, "y la casa se queda con el 10%", r.comisionCasa);
  ok(db._leer("users/j1").credits === antes1 + 480, "el campeón cobra el 60%");
  ok(db._leer("users/j2").credits === antes2 + 240, "el segundo el 30%");

  ok(db._leer(`torneos/${id}`).estado === ESTADOS.FINALIZADO, "el torneo queda finalizado");
  ok(
    db._leer("rankingCampeonato/2026-S37/jugadores/j1")?.puntos?.__inc === 100,
    "el campeón suma 100 puntos de campeonato",
  );
  ok(
    db._leer("users/j1").torneosGanados?.__inc === 1,
    "y una victoria de torneo, que es lo que lleva a la insignia Campeón",
  );
  ok(
    db._leer("users/j2").torneosGanados === undefined,
    "el segundo NO suma victoria de torneo",
  );
}

{
  // No se le paga a alguien que no jugó. Sin esto, el panel podría pagarle a
  // cualquiera escribiendo un uid a mano.
  const { db, torneos, id } = await conInscriptos(4, 100);
  await torneos.cerrarInscripciones(ADMIN, id);
  await torneos.iniciar(ADMIN, id);

  const { error: e } = await capturar(() => torneos.finalizar(ADMIN, id, ["colado"]));
  ok(e?.codigo === "invalid-argument", "un ganador que no se inscribió se rechaza", e?.codigo);
  ok(db._leer(`torneos/${id}`).estado === ESTADOS.EN_CURSO, "y el torneo no se cierra");

  const { error: e2 } = await capturar(() => torneos.finalizar(ADMIN, id, []));
  ok(e2?.codigo === "invalid-argument", "y sin ganadores tampoco se cierra", e2?.codigo);
}

// =====================================================================
console.log("\n=== 9. Todo lo que es del panel exige ser administrador ===");
// =====================================================================

{
  const db = crearFirestore({ "torneos/t1": { estado: ESTADOS.BORRADOR, entrada: 100, nombre: "X" } });
  const torneos = crearTorneos({
    db,
    moverLeyendas: async () => ({ aplicado: true, saldo: 0 }),
    marcaDeTiempo: () => "T",
    error,
    motivoEntrada: MOTIVOS.TORNEO_ENTRADA,
    motivoPremio: MOTIVOS.TORNEO_PREMIO,
    motivoDevolucion: MOTIVOS.TORNEO_DEVOLUCION,
    administradores: {
      exigir: async () => {
        throw error("permission-denied", "No sos administrador.");
      },
    },
  });

  // Todas, una por una. Una sola dejaría abierta la posibilidad de que a
  // alguna se le haya olvidado la comprobación, que es el error que nadie nota
  // hasta que lo usan.
  const operaciones = [
    ["crear", () => torneos.crear({}, { nombre: "X", entrada: 100 })],
    ["editar", () => torneos.editar({}, "t1", { nombre: "Y", entrada: 100 })],
    ["abrirInscripciones", () => torneos.abrirInscripciones({}, "t1")],
    ["cerrarInscripciones", () => torneos.cerrarInscripciones({}, "t1")],
    ["iniciar", () => torneos.iniciar({}, "t1")],
    ["finalizar", () => torneos.finalizar({}, "t1", ["a"])],
    ["cancelar", () => torneos.cancelar({}, "t1")],
    ["detalle", () => torneos.detalle({}, "t1")],
  ];

  for (const [nombre, fn] of operaciones) {
    const { error: e } = await capturar(fn);
    ok(e?.codigo === "permission-denied", `${nombre} exige administrador`, e?.codigo);
  }

  // Inscribirse NO: es la única que hace el jugador.
  const { error: e } = await capturar(() => torneos.inscribir("j1", "t1"));
  ok(e?.codigo !== "permission-denied", "pero inscribirse no lo exige", e?.codigo);
}

console.log(fallos ? `\n❌ ${fallos} fallos` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
