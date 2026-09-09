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

import { readFileSync } from "node:fs";
import { crearTorneos } from "../functions/torneos.js";
import { crearMoverLeyendas } from "../functions/leyendas.js";
import { MOTIVOS } from "../public/js/reglas/economia.js";
import {
  ESTADOS,
  puedePasarA,
  armarMesas,
  repartirPozo,
  pozoDe,
  puestosQueCobran,
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
  // El fondo TIENE que cerrar. Ésta es la comprobación que impide imprimir
  // Leyendas: se prueba con seis entradas y con un torneo de cada tramo,
  // incluidos los fondos que no dividen bien.
  let cierranTodos = true;
  const malos = [];
  for (const entrada of [5, 7, 13, 100, 333, 20000]) {
    for (const jugadores of [4, 12, 20, 30, 50, 137]) {
      const pozo = pozoDe(entrada, jugadores);
      const nombres = Array.from({ length: 10 }, (_, i) => `j${i}`);
      const r = repartirPozo(pozo, nombres, jugadores);
      if (r.repartido + r.comisionCasa !== pozo || r.comisionCasa < 0 || r.repartido > pozo) {
        cierranTodos = false;
        malos.push({ entrada, jugadores, pozo, ...r });
      }
    }
  }
  ok(cierranTodos, "el fondo cierra exacto en todos los casos probados", malos.slice(0, 3));

  // Lo que queda sin repartir es SÓLO el resto del redondeo. Cada tramo suma
  // 100%, así que la casa no se queda con una comisión: con diez puestos, el
  // resto no puede pasar de nueve Leyendas.
  let restoMaximo = 0;
  for (const jugadores of [4, 12, 20, 30, 50]) {
    for (const entrada of [5, 7, 13, 333]) {
      const nombres = Array.from({ length: 10 }, (_, i) => `j${i}`);
      const r = repartirPozo(pozoDe(entrada, jugadores), nombres, jugadores);
      restoMaximo = Math.max(restoMaximo, r.comisionCasa);
    }
  }
  ok(restoMaximo < 10, "y ese resto nunca pasa de nueve Leyendas", restoMaximo);
}

{
  /**
   * Los cuatro ejemplos que están publicados en el reglamento.
   *
   * Escritos a mano y con los números exactos. Si el reparto cambia, esto
   * falla nombrando el ejemplo que dejó de ser cierto, y ese ejemplo está
   * impreso en una página que los jugadores leen antes de pagar la entrada.
   */
  const CASOS = [
    { jugadores: 12, entrada: 10, esperado: [60, 36, 24] },
    { jugadores: 12, entrada: 25, esperado: [150, 90, 60] },
    { jugadores: 20, entrada: 10, esperado: [80, 50, 40, 30] },
    { jugadores: 50, entrada: 10, esperado: [125, 90, 70, 50, 40, 25, 25, 25, 25, 25] },
  ];

  for (const { jugadores, entrada, esperado } of CASOS) {
    const fondo = pozoDe(entrada, jugadores);
    const nombres = Array.from({ length: esperado.length }, (_, i) => `j${i}`);
    const r = repartirPozo(fondo, nombres, jugadores);
    const montos = r.pagos.map((p) => p.monto);

    ok(
      JSON.stringify(montos) === JSON.stringify(esperado),
      `${jugadores} jugadores x ${entrada} = ${fondo} paga [${esperado.join(", ")}]`,
      montos,
    );
    ok(r.repartido === fondo, `  y reparte el fondo entero (${fondo})`, r.repartido);
  }
}

{
  // Cuántos puestos cobran, tramo por tramo.
  const ESPERADO = { 4: 2, 11: 2, 12: 3, 19: 3, 20: 4, 29: 4, 30: 5, 49: 5, 50: 10, 500: 10 };
  for (const [jugadores, puestos] of Object.entries(ESPERADO)) {
    ok(
      puestosQueCobran(Number(jugadores)) === puestos,
      `con ${jugadores} jugadores cobran ${puestos} puestos`,
      puestosQueCobran(Number(jugadores)),
    );
  }

  // Por debajo del mínimo no hay torneo, así que no hay reparto.
  ok(puestosQueCobran(3) === 0, "con tres no cobra nadie: no es un torneo");
  ok(repartirPozo(1000, ["a", "b"], 3).pagos.length === 0, "y no se reparte nada");
}

{
  // Cargar más ganadores de los que cobran no paga de más: sobran, y punto.
  const r = repartirPozo(120, ["a", "b", "c", "d", "e"], 12);
  ok(r.pagos.length === 3, "en un torneo de 12 cobran tres, no cinco", r.pagos.length);
  ok(r.repartido === 120, "y se reparte el fondo entero igual", r.repartido);

  // Y cargar menos no le regala el resto a nadie.
  const menos = repartirPozo(120, ["a"], 12);
  ok(menos.repartido === 60, "con un solo nombre se paga sólo su puesto", menos.repartido);
  ok(menos.comisionCasa === 60, "el resto queda sin repartir, no se le da al primero", menos.comisionCasa);
}

{
  // Puntos de campeonato: los cuatro primeros por puesto, y el resto por jugar.
  const orden = ["a", "b", "c", "d"];
  const todos = ["a", "b", "c", "d", "e", "f"];
  const puntos = puntosDeTorneo(orden, todos);
  const de = (uid) => puntos.find((p) => p.uid === uid)?.puntos;

  ok(de("a") === 100, "el campeón suma 100", de("a"));
  ok(de("b") === 50, "el segundo 50", de("b"));
  ok(de("c") === 25, "el tercero 25", de("c"));
  ok(de("d") === 10, "el cuarto 10", de("d"));
  ok(de("e") === 5 && de("f") === 5, "y del quinto para abajo, 5 por haber jugado", {
    e: de("e"),
    f: de("f"),
  });
  ok(puntos.length === 6, "nadie que jugó se queda sin puntos", puntos.length);

  // Nadie cuenta dos veces, ni siquiera si aparece en las dos listas.
  const repetido = puntosDeTorneo(["a"], ["a", "b"]);
  ok(repetido.filter((p) => p.uid === "a").length === 1, "el campeón no suma también participación");

  ok(puntosDeTorneo([], []).length === 0, "y sin nadie no hay puntos");
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
  /**
   * Publicado, se retoca la etiqueta pero no el trato.
   *
   * La ENTRADA y el CUPO son las dos cosas que el jugador miró antes de
   * pagar: cuánto le costaba y contra cuántos iba a jugar. El nombre no.
   *
   * Antes esto era un portón —publicado no se tocaba nada, ni una falta de
   * ortografía en el nombre—. Ahora es una lista de campos.
   */
  const { torneos, id, db } = await conInscriptos(4);
  const antes = db._leer(`torneos/${id}`);

  const { error: e } = await capturar(() =>
    torneos.editar(ADMIN, id, { nombre: "Otra", entrada: 5 }));
  ok(e?.codigo === "failed-precondition", "la entrada no se cambia con inscriptos", e?.codigo);
  ok(/entrada/.test(e?.message ?? ""), "y el mensaje nombra el campo", e?.message);
  ok(/pag/i.test(e?.message ?? ""), "y dice por qué", e?.message);

  const cupo = await capturar(() => torneos.editar(ADMIN, id, { maxJugadores: 64 }));
  ok(cupo.error?.codigo === "failed-precondition", "el cupo tampoco", cupo.error?.codigo);

  // Nada de eso se guardó: falla entero o no falla.
  ok(db._leer(`torneos/${id}`).nombre !== "Otra", "y no se guardó a medias");

  // El nombre solo, sí.
  const r = await torneos.editar(ADMIN, id, { nombre: "Copa de otoño" });
  ok(r.nombre === "Copa de otoño", "el nombre sí se corrige", r.nombre);
  ok(db._leer(`torneos/${id}`).nombre === "Copa de otoño", "y queda escrito");
  ok(
    db._leer(`torneos/${id}`).entrada === antes.entrada,
    "sin mover la entrada",
    db._leer(`torneos/${id}`).entrada,
  );
  ok(
    db._leer(`torneos/${id}`).pozo === antes.pozo,
    "ni el pozo, que se armó con la entrada vieja",
    db._leer(`torneos/${id}`).pozo,
  );

  // Mandar la entrada IGUAL a la que ya estaba no es cambiarla: el panel
  // manda el formulario entero en cada guardado.
  const igual = await capturar(() =>
    torneos.editar(ADMIN, id, { nombre: "Copa de otoño", entrada: antes.entrada }));
  ok(!igual.error, "mandar la entrada sin cambiarla no molesta", igual.error?.message);
}

{
  // En borrador se sigue pudiendo todo: es el estado donde no hay nadie.
  const { db, torneos } = montar({ saldos: {} });
  const { id } = await torneos.crear(ADMIN, { nombre: "Copa", entrada: 100 });

  const r = await torneos.editar(ADMIN, id, { nombre: "Nueva", entrada: 50, maxJugadores: 8 });
  ok(r.entrada === 50, "en borrador la entrada se cambia", r.entrada);
  ok(db._leer(`torneos/${id}`).maxJugadores === 8, "y el cupo también");
  ok(db._leer(`torneos/${id}`).nombre === "Nueva", "y el nombre");
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

  // Ocho jugadores caen en el tramo de 4 a 11: dos puestos, 60 y 40, y el
  // fondo entero. La casa no retiene nada en los torneos.
  ok(r.repartido === 800, "reparte el fondo entero de 800", r.repartido);
  ok(r.comisionCasa === 0, "y la casa no se queda con nada", r.comisionCasa);
  ok(db._leer("users/j1").credits === antes1 + 480, "el campeón cobra el 60%");
  ok(db._leer("users/j2").credits === antes2 + 320, "el segundo el 40%");
  ok(r.jugaron === 8 && r.puestosPagados === 2, "y queda anotado cuántos jugaron", {
    jugaron: r.jugaron,
    puestos: r.puestosPagados,
  });

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

// =====================================================================
console.log("\n=== 10. Qué está comprando el que se anota ===");
// =====================================================================

{
  /**
   * La descripción y la fecha existen por una razón concreta.
   *
   * `iniciar` agrupa los uid en mesas DENTRO del documento del torneo: no crea
   * salas, no crea partidas y no notifica a nadie. El aviso al anotarse decía
   * «te avisamos cuando arranque» y no hay nada que avise.
   *
   * O sea que el jugador pagaba una entrada sin saber cuándo tenía que estar
   * ni qué se iba a jugar. Las dos son la mitad de lo que compra.
   */
  const { db, torneos } = montar({ saldos: {} });
  const CUANDO = Date.UTC(2026, 8, 20, 23, 0);

  const { id } = await torneos.crear(ADMIN, {
    nombre: "Copa",
    entrada: 100,
    descripcion: "Cuatro mesas, se juega por Discord.",
    comienzaEn: CUANDO,
  });

  const guardado = db._leer(`torneos/${id}`);
  ok(guardado.descripcion === "Cuatro mesas, se juega por Discord.", "la descripción se guarda");
  ok(guardado.comienzaEn === CUANDO, "y la fecha también", guardado.comienzaEn);
}

{
  // Se pueden dejar vacías: un torneo puede publicarse antes de saber cuándo
  // se juega, y forzar una fecha inventada sería peor que no tenerla.
  const { db, torneos } = montar({ saldos: {} });
  const { id } = await torneos.crear(ADMIN, { nombre: "Copa", entrada: 100 });

  const guardado = db._leer(`torneos/${id}`);
  ok(guardado.descripcion === "", "sin descripción, queda vacía", guardado.descripcion);
  ok(guardado.comienzaEn === null, "y sin fecha, en null", guardado.comienzaEn);
}

{
  // Lo que no puede entrar.
  const { torneos } = montar({ saldos: {} });

  const larga = await capturar(() =>
    torneos.crear(ADMIN, { nombre: "Copa", entrada: 100, descripcion: "x".repeat(301) }));
  ok(larga.error?.codigo === "invalid-argument", "una descripción de 301 no entra", larga.error?.codigo);

  const fea = await capturar(() =>
    torneos.crear(ADMIN, { nombre: "Copa", entrada: 100, comienzaEn: -5 }));
  ok(fea.error?.codigo === "invalid-argument", "ni una fecha negativa", fea.error?.codigo);
}

{
  /**
   * Postergar es una operación normal, y por eso la fecha se edita DESPUÉS de
   * publicar. La alternativa —cancelar, devolver a todos y recrear— es peor
   * para todo el mundo.
   *
   * Es la decisión más discutible de este grupo: cambia algo que el jugador
   * miró antes de pagar, a diferencia del nombre. Queda acá escrita.
   */
  const { db, torneos, id } = await conInscriptos(4);
  const NUEVA = Date.UTC(2026, 9, 1, 23, 0);
  const antes = db._leer(`torneos/${id}`);

  const r = await torneos.editar(ADMIN, id, {
    descripcion: "Se pasó para octubre.",
    comienzaEn: NUEVA,
  });

  ok(r.comienzaEn === NUEVA, "con inscripciones abiertas, la fecha se puede mover", r.comienzaEn);
  ok(db._leer(`torneos/${id}`).descripcion === "Se pasó para octubre.", "y la descripción también");
  ok(db._leer(`torneos/${id}`).entrada === antes.entrada, "sin tocar la entrada");
  ok(db._leer(`torneos/${id}`).pozo === antes.pozo, "ni el pozo");
}

{
  // Borrar la fecha es mandarla en null explícito. No mandarla no la borra:
  // el panel manda el formulario entero en cada guardado.
  const { db, torneos } = montar({ saldos: {} });
  const { id } = await torneos.crear(ADMIN, {
    nombre: "Copa", entrada: 100, comienzaEn: Date.UTC(2026, 8, 20, 23, 0),
  });

  await torneos.editar(ADMIN, id, { nombre: "Copa II" });
  ok(db._leer(`torneos/${id}`).comienzaEn !== null, "editar sólo el nombre no borra la fecha");

  await torneos.editar(ADMIN, id, { comienzaEn: null });
  ok(db._leer(`torneos/${id}`).comienzaEn === null, "y mandarla en null sí la borra");
}

// =====================================================================
console.log("\n=== 11. El panel tiene que VER los torneos que administra ===");
// =====================================================================

{
  /**
   * ESTO ERA UN FALLO, y bloqueaba el flujo entero.
   *
   * El panel listaba con `listarTorneos`, que es la del jugador y devuelve
   * sólo los que tienen inscripciones abiertas. Un torneo nace en BORRADOR, y
   * el botón «Abrir inscripciones» vive en la fila de la lista: o sea que el
   * torneo quedaba inalcanzable apenas se creaba.
   *
   * Y no era sólo el primer paso. Cerrar inscripciones lo saca de la lista
   * otra vez, así que «Armar mesas y empezar» y «Cargar ganadores y pagar»
   * tampoco se podían tocar nunca. `accionesDe` tenía ramas escritas para
   * BORRADOR, COMPLETO y EN_CURSO que no se dibujaban jamás.
   */
  const { torneos } = montar({ saldos: {} });
  await torneos.crear(ADMIN, { nombre: "Borrador", entrada: 100 });
  const { id: abierto } = await torneos.crear(ADMIN, { nombre: "Abierto", entrada: 100 });
  await torneos.abrirInscripciones(ADMIN, abierto);

  const delJugador = await torneos.listar({ soloAbiertos: true });
  ok(delJugador.length === 1, "el jugador ve sólo el abierto", delJugador.map((t) => t.nombre));

  const delPanel = await torneos.listar({ soloAbiertos: false });
  ok(delPanel.length === 2, "y el panel ve los dos", delPanel.map((t) => t.nombre));
  ok(
    delPanel.some((t) => t.estado === ESTADOS.BORRADOR),
    "incluido el borrador, que es el que hay que poder abrir",
  );
}

{
  // Y que el panel llame a la del panel. Es una auditoría de texto porque las
  // callables no se pueden importar sin levantar medio Firebase.
  const panel = readFileSync(new URL("../public/admin/torneos-admin.js", import.meta.url), "utf8");
  ok(
    /httpsCallable\(funciones, "listarTorneosAdmin"\)/.test(panel),
    "el panel lista con la suya, no con la del jugador",
  );

  const servidor = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  const desde = servidor.indexOf("export const listarTorneosAdmin");
  const cuerpo = servidor.slice(desde, servidor.indexOf("\nexport const ", desde + 1));
  ok(desde > 0, "la callable existe");
  ok(/administradores\.exigir\(context\)/.test(cuerpo), "y sólo la puede llamar un administrador");
  ok(/soloAbiertos: false/.test(cuerpo), "y trae todos");
}

console.log(fallos ? `\n❌ ${fallos} fallos` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
