/**
 * Cierre de partida y reparto del pozo.
 *
 * Lo que hay que demostrar, por orden de gravedad:
 *
 *   1. que el cliente no pueda decidir quién gana, cuánto hay en el pozo ni
 *      cuánto cobra nadie;
 *   2. que nunca se pague dos veces;
 *   3. que quien abandonó no cobre;
 *   4. que el pozo cierre exacto: lo pagado más el sobrante es el pozo.
 *
 * El Firestore de mentira aplica la regla real de las transacciones: ninguna
 * lectura después de una escritura. Sin eso, pagar a dos jugadores parecería
 * funcionar acá y fallaría en producción.
 */

import { crearMoverLeyendas } from "../functions/leyendas.js";
import { crearCerrarPartida } from "../functions/cierre.js";
import { crearMotorEnRed } from "../functions/partida-red.js";
import { crearAbandonarPartida } from "../functions/abandono.js";
import { ESTADOS_SALA, MODOS, repartirPozo } from "../public/js/reglas/salas.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

class E extends Error { constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; } }
const error = (codigo, mensaje) => new E(codigo, mensaje);

// ============================== Firestore con la regla lectura/escritura

function crearFirestore(inicial = {}) {
  const docs = new Map();
  let version = 0;
  for (const [ruta, datos] of Object.entries(inicial)) {
    docs.set(ruta, { datos: structuredClone(datos), version: ++version });
  }
  const db = {
    intentos: 0,
    ganchoTrasLeer: null,
    collection: (n) => ({ doc: (id = `a${Math.random()}`) => ({ ruta: `${n}/${id}` }) }),
    async runTransaction(cuerpo) {
      for (let i = 0; i < 10; i++) {
        db.intentos++;
        const leidas = new Map(); const esc = []; let yaEscribio = false;
        const tx = {
          async get(ref) {
            if (yaEscribio) {
              throw error("invalid-argument",
                `Lectura de ${ref.ruta} después de una escritura: Firestore no lo permite.`);
            }
            const d = docs.get(ref.ruta);
            leidas.set(ref.ruta, d ? d.version : 0);
            if (db.ganchoTrasLeer) await db.ganchoTrasLeer(ref.ruta);
            return { exists: Boolean(d), data: () => (d ? structuredClone(d.datos) : undefined) };
          },
          set(ref, datos, op) { yaEscribio = true; esc.push({ ruta: ref.ruta, datos, m: Boolean(op?.merge) }); },
          update(ref, datos) { yaEscribio = true; esc.push({ ruta: ref.ruta, datos, m: true }); },
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
        return res;
      }
      throw error("aborted", "Demasiados reintentos.");
    },
  };
  db.leer = (r) => docs.get(r)?.datos;
  db.existe = (r) => docs.has(r);
  db.rutas = () => [...docs.keys()];
  return db;
}

// ================================================================ montaje

const CUATRO = ["ana", "beto", "caro", "dani"];
const NOMBRES = { ana: "Ana", beto: "Beto", caro: "Caro", dani: "Dani" };
const CODIGO = "CIERRE";
const ENTRADA = 100;
const POZO = ENTRADA * 4;
const SALDO_INICIAL = 1000;

/**
 * Arma una partida ya terminada, con el ganador y el orden que se le pidan.
 *
 * `orden` es el orden de llegada: el primero gana. Se traduce a puntajes y
 * rondas de eliminación para que `posicionesFinales` reconstruya ese mismo
 * orden por su cuenta — no se le pasa el orden hecho.
 */
function montar({ orden = CUATRO, abandonaron = [], pozo = POZO, entrada = ENTRADA } = {}) {
  const inicial = {};
  for (const uid of CUATRO) inicial[`users/${uid}`] = { credits: SALDO_INICIAL };

  inicial[`rooms/${CODIGO}`] = {
    codigo: CODIGO, modo: MODOS.LEYENDAS, estado: ESTADOS_SALA.JUGANDO,
    entrada, jugadores: [...CUATRO], jugadoresNombres: CUATRO.map((u) => NOMBRES[u]),
    pozo, abandonaron: [...abandonaron],
  };

  const ganador = orden[0];
  const jugadores = CUATRO.map((uid) => {
    const puesto = orden.indexOf(uid);
    const esGanador = uid === ganador;
    return {
      id: uid, nombre: NOMBRES[uid], esIA: false,
      mano: [], puntos: 100 + puesto * 10, puntosRonda: 0,
      // El ganador es el único no eliminado; los demás salieron en rondas
      // decrecientes, que es como `posicionesFinales` los ordena.
      eliminado: !esGanador,
      eliminadoEnRonda: esGanador ? null : orden.length - puesto,
      posicionMirada: null,
    };
  });

  inicial[`partidas/${CODIGO}`] = {
    codigo: CODIGO, jugadores: [...CUATRO], version: 5,
    abandonaron: [...abandonaron], ausentes: [], latidos: {}, ventana: null, plazo: null,
    estado: {
      fase: "finPartida", ronda: 7, indiceMano: 0, indiceTurno: 0, turnosRonda: 0,
      jugadores, mazo: [], descarte: [], levantada: null, poderPendiente: null,
      ventanaDescarte: null, indiceCortador: 0,
      ganador: { id: ganador, nombre: NOMBRES[ganador] },
      desempate: false, registro: [], eventos: [], semilla: 123,
    },
  };

  const db = crearFirestore(inicial);
  const moverLeyendas = crearMoverLeyendas({
    db, usuarios: "users", campoSaldo: "credits", marcaDeTiempo: () => "T", error,
  });
  const cerrar = crearCerrarPartida({
    db, salas: "rooms", partidas: "partidas", moverLeyendas,
    motivo: "premio_partida", marcaDeTiempo: () => "T", error, estados: ESTADOS_SALA,
  });
  return { db, cerrar, moverLeyendas };
}

const capturar = async (fn) => {
  try { return { valor: await fn() }; } catch (e) { return { error: e }; }
};
const saldo = (db, uid) => db.leer(`users/${uid}`).credits;
const ganado = (db, uid) => saldo(db, uid) - SALDO_INICIAL;
const sala = (db) => db.leer(`rooms/${CODIGO}`);

// ==================================================================== 1

console.log("\n=== 1. Cuatro elegibles: 75 / 25 ===");
{
  const { db, cerrar } = montar({ orden: ["ana", "beto", "caro", "dani"] });
  const r = await capturar(() => cerrar({ uid: "ana", codigo: CODIGO }));
  ok(r.valor && !r.error, "la partida se cierra", r.error?.message);

  ok(ganado(db, "ana") === 300, "el primero cobra 300 (75 % de 400)", ganado(db, "ana"));
  ok(ganado(db, "beto") === 100, "el segundo cobra 100 (25 %)", ganado(db, "beto"));
  ok(ganado(db, "caro") === 0 && ganado(db, "dani") === 0, "el tercero y el cuarto, nada",
     [ganado(db, "caro"), ganado(db, "dani")]);

  ok(r.valor.pozo === 400, "el pozo era 400", r.valor.pozo);
  ok(r.valor.repartido === 400 && r.valor.sobrante === 0, "se repartió entero, sin sobrante",
     [r.valor.repartido, r.valor.sobrante]);
  ok(sala(db).estado === ESTADOS_SALA.TERMINADA, "la sala queda terminada", sala(db).estado);
  ok(db.leer(`partidas/${CODIGO}`).cerrada === true, "y la partida marcada como cerrada");

  const asientos = db.rutas().filter((x) => x.startsWith("movimientos/"));
  ok(asientos.length === 2, "quedan dos asientos, uno por premio", asientos);
  ok(db.leer(`movimientos/premio_${CODIGO}_1`).delta === 300, "el del primero, por 300");
  ok(db.leer(`movimientos/premio_${CODIGO}_2`).delta === 100, "el del segundo, por 100");
}

// ==================================================================== 2

console.log("\n=== 2. El ejemplo del reglamento: C abandona ===");
{
  // 4 × 100, C abandona. Quedan A, B y D. Resultado: A 1.º, D 2.º, B 3.º.
  const { db, cerrar } = montar({
    orden: ["ana", "dani", "beto", "caro"],
    abandonaron: ["caro"],
  });
  const r = await capturar(() => cerrar({ uid: "beto", codigo: CODIGO }));
  ok(r.valor && !r.error, "cierra", r.error?.message);

  ok(ganado(db, "ana") === 300, "A → 300", ganado(db, "ana"));
  ok(ganado(db, "dani") === 100, "D → 100", ganado(db, "dani"));
  ok(ganado(db, "beto") === 0, "B → 0", ganado(db, "beto"));
  ok(ganado(db, "caro") === 0, "C → 0, aunque su puntaje lo pondría arriba", ganado(db, "caro"));
  ok(r.valor.pozo === 400, "el pozo siguió siendo 400: la entrada de C se quedó dentro");
  ok(r.valor.sobrante === 0, "sin sobrante: había dos elegibles");
  ok(r.valor.premios.every((p) => p.uid !== "caro"), "no hay ningún premio a nombre de C");
  ok(r.valor.posiciones.find((p) => p.uid === "caro").abandono === true,
     "pero queda registrado que abandonó");
}

console.log("\n=== 2b. El que abandonó habría sido el ganador ===");
{
  // El de mejor puntaje se fue. El premio va al mejor de los que se quedaron.
  const { db, cerrar } = montar({
    orden: ["caro", "ana", "beto", "dani"],
    abandonaron: ["caro"],
  });
  const r = await capturar(() => cerrar({ uid: "ana", codigo: CODIGO }));
  ok(ganado(db, "caro") === 0, "el que abandonó no cobra el primer puesto", ganado(db, "caro"));
  ok(ganado(db, "ana") === 300, "cobra el mejor de los que se quedaron", ganado(db, "ana"));
  ok(ganado(db, "beto") === 100, "y el segundo pasa a ser el que seguía", ganado(db, "beto"));
  ok(r.valor.repartido + r.valor.sobrante === 400, "el pozo cierra exacto");
}

console.log("\n=== 2c. El segundo puesto abandonó ===");
{
  const { db, cerrar } = montar({
    orden: ["ana", "caro", "beto", "dani"],
    abandonaron: ["caro"],
  });
  await cerrar({ uid: "ana", codigo: CODIGO });
  ok(ganado(db, "ana") === 300, "el primero cobra igual", ganado(db, "ana"));
  ok(ganado(db, "caro") === 0, "el segundo que abandonó no cobra", ganado(db, "caro"));
  ok(ganado(db, "beto") === 100, "el puesto no queda vacante: lo toma el siguiente",
     ganado(db, "beto"));
}

// ==================================================================== 3

console.log("\n=== 3. Un solo elegible: 75 % y el resto sobrante ===");
{
  const { db, cerrar } = montar({
    orden: ["dani", "ana", "beto", "caro"],
    abandonaron: ["ana", "beto", "caro"],
  });
  const r = await capturar(() => cerrar({ uid: "dani", codigo: CODIGO }));
  ok(r.valor && !r.error, "cierra", r.error?.message);

  ok(ganado(db, "dani") === 300, "D cobra 300", ganado(db, "dani"));
  ok(["ana", "beto", "caro"].every((u) => ganado(db, u) === 0), "los tres que abandonaron, nada");
  ok(r.valor.repartido === 300, "se repartieron 300", r.valor.repartido);
  ok(r.valor.sobrante === 100, "y 100 quedan como sobrante, sin destinatario", r.valor.sobrante);
  ok(r.valor.premios.length === 1, "un solo premio pagado", r.valor.premios.length);
  ok(r.valor.repartido + r.valor.sobrante === 400, "el pozo cierra exacto");

  const asientos = db.rutas().filter((x) => x.startsWith("movimientos/"));
  ok(asientos.length === 1, "y un solo asiento: el sobrante no se le acredita a nadie", asientos);
}

// ==================================================================== 4

console.log("\n=== 4. Ningún elegible: todo sobrante ===");
{
  const { db, cerrar } = montar({ orden: CUATRO, abandonaron: [...CUATRO] });
  const r = await capturar(() => cerrar({ uid: "ana", codigo: CODIGO }));
  ok(r.valor && !r.error, "cierra igual", r.error?.message);

  ok(CUATRO.every((u) => ganado(db, u) === 0), "nadie cobra nada",
     CUATRO.map((u) => ganado(db, u)));
  ok(r.valor.repartido === 0, "no se repartió nada", r.valor.repartido);
  ok(r.valor.sobrante === 400, "el pozo entero queda como sobrante", r.valor.sobrante);
  ok(r.valor.premios.length === 0, "sin premios");
  ok(!db.rutas().some((x) => x.startsWith("movimientos/")), "y sin ningún asiento");
  ok(sala(db).estado === ESTADOS_SALA.TERMINADA, "pero la sala igual queda cerrada");
}

// ==================================================================== 5

console.log("\n=== 5. Dos y tres elegibles ===");
{
  const dos = montar({ orden: ["ana", "beto", "caro", "dani"], abandonaron: ["caro", "dani"] });
  const r2 = await capturar(() => dos.cerrar({ uid: "ana", codigo: CODIGO }));
  ok(ganado(dos.db, "ana") === 300 && ganado(dos.db, "beto") === 100,
     "con dos elegibles se paga 75/25 completo", [ganado(dos.db, "ana"), ganado(dos.db, "beto")]);
  ok(r2.valor.sobrante === 0, "sin sobrante");

  const tres = montar({ orden: ["ana", "beto", "caro", "dani"], abandonaron: ["dani"] });
  const r3 = await capturar(() => tres.cerrar({ uid: "ana", codigo: CODIGO }));
  ok(ganado(tres.db, "ana") === 300 && ganado(tres.db, "beto") === 100,
     "con tres elegibles se paga a los dos primeros");
  ok(ganado(tres.db, "caro") === 0, "el tercero no cobra: sólo hay dos puestos pagados");
  ok(r3.valor.sobrante === 0, "sin sobrante");
}

// ==================================================================== 6

console.log("\n=== 6. Doble cierre: nunca se paga dos veces ===");
{
  const { db, cerrar } = montar();
  const primero = await capturar(() => cerrar({ uid: "ana", codigo: CODIGO }));
  const saldoTrasUno = { ana: saldo(db, "ana"), beto: saldo(db, "beto") };

  for (let i = 0; i < 3; i++) {
    const otra = await capturar(() => cerrar({ uid: "beto", codigo: CODIGO }));
    ok(otra.valor?.yaEstaba === true, `cierre repetido ${i + 1}: devuelve el cierre guardado`,
       otra.error?.message ?? otra.valor?.yaEstaba);
  }
  ok(saldo(db, "ana") === saldoTrasUno.ana, "el primero no cobró de nuevo", ganado(db, "ana"));
  ok(saldo(db, "beto") === saldoTrasUno.beto, "el segundo tampoco", ganado(db, "beto"));
  ok(db.rutas().filter((x) => x.startsWith("movimientos/")).length === 2,
     "siguen siendo dos asientos");
  ok(primero.valor.pozo === 400, "y el cierre guardado conserva las cifras");
}

console.log("\n=== 6b. Dos cierres simultáneos ===");
{
  const { db, cerrar } = montar();
  let soltar; const barrera = new Promise((r) => (soltar = r));
  let primera = true;
  db.ganchoTrasLeer = async (ruta) => {
    if (ruta === `partidas/${CODIGO}` && primera) { primera = false; await barrera; }
  };

  const a = capturar(() => cerrar({ uid: "ana", codigo: CODIGO }));
  await new Promise((r) => setImmediate(r));
  const b = await capturar(() => cerrar({ uid: "beto", codigo: CODIGO }));
  soltar();
  const resA = await a;

  const pagaron = [resA, b].filter((r) => r.valor && !r.valor.yaEstaba).length;
  ok(pagaron === 1, "una sola ejecución paga", pagaron);
  ok(ganado(db, "ana") === 300, "el primero cobró 300, una vez", ganado(db, "ana"));
  ok(ganado(db, "beto") === 100, "el segundo cobró 100, una vez", ganado(db, "beto"));
  ok(db.rutas().filter((x) => x.startsWith("movimientos/")).length === 2, "dos asientos, no cuatro");
  ok(db.intentos > 2, "la perdedora reintentó", db.intentos);
}

// ==================================================================== 7

console.log("\n=== 7. Lo que manda el cliente se ignora ===");
{
  const { db, cerrar } = montar({ orden: ["ana", "beto", "caro", "dani"] });
  // Todo lo que un atacante intentaría inyectar.
  const r = await capturar(() => cerrar({
    uid: "dani", codigo: CODIGO,
    ganadorId: "dani",
    resumen: { ganadorId: "dani", posiciones: [{ id: "dani", posicion: 1 }] },
    posiciones: [{ id: "dani", posicion: 1 }],
    pozo: 999999,
    premios: { primero: 999999 },
    reparto: { primero: 999999, segundo: 0 },
    abandonaron: [],
  }));

  ok(r.valor && !r.error, "la llamada se procesa", r.error?.message);
  ok(ganado(db, "dani") === 0, "el que se declaró ganador NO cobra", ganado(db, "dani"));
  ok(ganado(db, "ana") === 300, "cobra el ganador real", ganado(db, "ana"));
  ok(ganado(db, "beto") === 100, "y el segundo real");
  ok(r.valor.pozo === 400, "el pozo enviado se ignora: sale de la sala", r.valor.pozo);
  ok(r.valor.premios[0].monto === 300, "el premio enviado se ignora", r.valor.premios[0].monto);
  ok(saldo(db, "dani") === SALDO_INICIAL, "y no se le movió una sola Leyenda");
}

console.log("\n=== 7b. Quien no está en la partida no puede cerrarla ===");
{
  const { db, cerrar } = montar();
  const r = await capturar(() => cerrar({ uid: "colado", codigo: CODIGO }));
  ok(r.error?.codigo === "permission-denied", "se rechaza", r.error?.codigo);
  ok(sala(db).estado === ESTADOS_SALA.JUGANDO, "la sala sigue abierta");
  ok(!db.rutas().some((x) => x.startsWith("movimientos/")), "sin pagos");
}

console.log("\n=== 7c. No se cierra una partida que no terminó ===");
{
  const { db, cerrar } = montar();
  const p = db.leer(`partidas/${CODIGO}`);
  await db.runTransaction(async (tx) => {
    tx.set({ ruta: `partidas/${CODIGO}` }, { ...p, estado: { ...p.estado, fase: "turno" } });
  });
  const r = await capturar(() => cerrar({ uid: "ana", codigo: CODIGO }));
  ok(/todavía no terminó/.test(r.error?.message ?? ""), "se rechaza", r.error?.message);
  ok(!db.rutas().some((x) => x.startsWith("movimientos/")), "sin pagos");
  ok(sala(db).estado === ESTADOS_SALA.JUGANDO, "la sala sigue abierta");
}

console.log("\n=== 7d. Una partida sin entrada válida no reparte nada ===");
{
  const { db, cerrar } = montar({ entrada: 7777, pozo: 31108 });
  const r = await capturar(() => cerrar({ uid: "ana", codigo: CODIGO }));
  ok(r.error?.codigo === "failed-precondition", "entrada fuera de la lista: se rechaza",
     r.error?.message);
  ok(CUATRO.every((u) => ganado(db, u) === 0), "nadie cobra");
}

// ==================================================================== 8

console.log("\n=== 8. El pozo siempre cierra exacto ===");
{
  // Todas las entradas válidas, con 2, 3 y 4 jugadores y 0 a 3 abandonos.
  const ENTRADAS = [5, 10, 15, 20, 25, 50, 100, 200, 500];
  let casos = 0, desbalance = 0;
  for (const entrada of ENTRADAS) {
    for (const cuantosAbandonan of [0, 1, 2, 3, 4]) {
      const abandonaron = CUATRO.slice(0, cuantosAbandonan);
      const pozo = entrada * 4;
      const { db, cerrar } = montar({ orden: CUATRO, abandonaron, pozo, entrada });
      const r = await capturar(() => cerrar({ uid: "dani", codigo: CODIGO }));
      if (r.error) { desbalance++; continue; }
      casos++;
      const pagado = CUATRO.reduce((s, u) => s + ganado(db, u), 0);
      if (pagado !== r.valor.repartido) desbalance++;
      if (r.valor.repartido + r.valor.sobrante !== pozo) desbalance++;
      if (pagado > pozo) desbalance++;
    }
  }
  ok(desbalance === 0, `${casos} combinaciones: lo pagado + el sobrante es siempre el pozo`,
     desbalance);

  // Y los redondeos, uno por uno, contra la regla pura.
  for (const entrada of ENTRADAS) {
    const pozo = entrada * 4;
    const { premios, sobrante } = repartirPozo(pozo, 2);
    const { db, cerrar } = montar({ pozo, entrada });
    await cerrar({ uid: "ana", codigo: CODIGO });
    const bien = ganado(db, "ana") === premios.primero && ganado(db, "beto") === premios.segundo;
    if (!bien || sobrante !== 0) { fallos++; console.log("  ✗ entrada", entrada); }
  }
  ok(true, "los nueve niveles de entrada reparten exacto, sin perder por redondeo");
}

// ==================================================================== 9

console.log("\n=== 9. Cierre después de un abandono real ===");
{
  // No un escenario armado: se abandona de verdad y después se cierra.
  const inicial = {};
  for (const uid of CUATRO) inicial[`users/${uid}`] = { credits: SALDO_INICIAL };
  inicial[`rooms/${CODIGO}`] = {
    codigo: CODIGO, modo: MODOS.LEYENDAS, estado: ESTADOS_SALA.JUGANDO,
    entrada: ENTRADA, jugadores: [...CUATRO], jugadoresNombres: CUATRO.map((u) => NOMBRES[u]),
    pozo: POZO,
  };
  const db = crearFirestore(inicial);
  const moverLeyendas = crearMoverLeyendas({
    db, usuarios: "users", campoSaldo: "credits", marcaDeTiempo: () => "T", error,
  });
  let reloj = 5000000;
  const enRed = crearMotorEnRed({
    db, partidas: "partidas", ahora: () => reloj, idAleatorio: () => "v1",
    marcaDeTiempo: () => "T", error, semillaDe: () => 55,
  });
  const abandonar = crearAbandonarPartida({
    db, salas: "rooms", moverLeyendas, motivo: "penalizacion_abandono",
    marcaDeTiempo: () => "T", error, estados: ESTADOS_SALA,
    partidaEnRed: { leer: enRed.leerPartidaParaAbandono, marcar: enRed.marcarAbandonoEn },
  });
  const cerrar = crearCerrarPartida({
    db, salas: "rooms", partidas: "partidas", moverLeyendas,
    motivo: "premio_partida", marcaDeTiempo: () => "T", error, estados: ESTADOS_SALA,
  });

  await enRed.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: CUATRO.map((u) => NOMBRES[u]) });
  await abandonar({ uid: "caro", codigo: CODIGO });
  ok(saldo(db, "caro") === SALDO_INICIAL - 50, "C pagó 50 de penalización", ganado(db, "caro"));
  ok(sala(db).pozo === 400, "el pozo sigue en 400", sala(db).pozo);

  // Se lleva la partida a su final con A ganando.
  const p = db.leer(`partidas/${CODIGO}`);
  await db.runTransaction(async (tx) => {
    tx.set({ ruta: `partidas/${CODIGO}` }, {
      ...p,
      estado: {
        ...p.estado, fase: "finPartida", mazo: [],
        ganador: { id: "ana", nombre: "Ana" },
        jugadores: p.estado.jugadores.map((j, i) => ({
          ...j, mano: [],
          puntos: [100, 130, 160, 120][i],
          eliminado: i !== 0,
          eliminadoEnRonda: i === 0 ? null : [null, 3, 2, 4][i],
        })),
      },
    });
  });

  const r = await capturar(() => cerrar({ uid: "ana", codigo: CODIGO }));
  ok(r.valor && !r.error, "cierra", r.error?.message);
  ok(ganado(db, "ana") === 300, "A cobra 300", ganado(db, "ana"));
  ok(ganado(db, "dani") === 100, "D cobra 100: era el segundo de los que quedaron",
     ganado(db, "dani"));
  ok(ganado(db, "beto") === 0, "B nada", ganado(db, "beto"));
  ok(ganado(db, "caro") === -50, "C sigue con su penalización y sin premio", ganado(db, "caro"));

  // Y las cuentas de la casa.
  const pagado = 300 + 100;
  const cobrado = 50;
  ok(r.valor.repartido === pagado && r.valor.sobrante === 0, "el pozo se repartió entero");
  ok(db.leer(`movimientos/abandono_${CODIGO}_caro`).delta === -cobrado,
     "la penalización quedó como sumidero, fuera del pozo");
  ok(sala(db).estado === ESTADOS_SALA.TERMINADA, "la sala queda terminada");
}

// ==================================================================== 10

console.log("\n=== 10. Un cierre no lee después de escribir ===");
{
  // Si el módulo llamara a moverLeyendas dos veces sueltas en vez de en lote,
  // esto fallaría. Es la prueba de que el orden es el correcto.
  const { db, cerrar } = montar();
  const r = await capturar(() => cerrar({ uid: "ana", codigo: CODIGO }));
  ok(r.valor && !r.error, "pagar a dos jugadores respeta el orden de Firestore",
     r.error?.message);

  // Y el registro que queda es serializable.
  const malos = [];
  (function buscar(x, ruta) {
    if (typeof x === "function") return malos.push(`${ruta} función`);
    if (x instanceof Map || x instanceof Set) return malos.push(`${ruta} ${x.constructor.name}`);
    if (x && typeof x === "object") for (const [k, y] of Object.entries(x)) buscar(y, `${ruta}.${k}`);
  })(sala(db).cierre, "cierre");
  ok(malos.length === 0, "el registro del cierre es JSON puro", malos);
  ok(sala(db).cierre.posiciones.length === 4, "y guarda las cuatro posiciones");
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
