/**
 * La llegada de un descarte se sella al entrar, no cuando la transacción lee.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LOS DOS BUGS QUE ESTO TAPA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La llegada —con la que se decide si un pedido cayó dentro de la gracia, y
 * con la que se fija el piso del tiempo efectivo— se leía DENTRO de la
 * transacción, después de `tx.get`. Todo lo que pasaba hasta ahí se le
 * cargaba al jugador:
 *
 *   1. La primera conexión con Firestore de una instancia nueva. En
 *      producción, la primera llamada de cada instancia pasó unos dos segundos
 *      dentro del handler; un descarte real tardó 1963 ms y fue rechazado.
 *
 *   2. La cola. Cuando varios descartan a la vez, las transacciones esperan
 *      turno sobre el mismo documento, ~250 ms cada una. El cuarto llegaba con
 *      unos 750 ms de más. Pasaba TIBIO: sin ningún arranque en frío, perdía
 *      el que tuvo mala suerte en la cola.
 *
 *   Y cada reintento de la transacción volvía a leer la hora, más tarde.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CÓMO SE SIMULA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un Firestore de mentira con tres perillas: cuánto tarda cada lectura dentro
 * de una transacción, cuántos choques forzar —cada uno obliga a reintentar—,
 * y una cola que atiende las transacciones de a una, como hace la de verdad
 * sobre el mismo documento. El reloj lo mueven esas perillas, no el tiempo
 * real: la prueba no espera nada.
 *
 * Cada caso se comprobó sacando el sellado —volviendo a leer la hora adentro
 * de la transacción— y los tres de la llegada fallan.
 */

import { crearMotorEnRed } from "../functions/partida-red.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

class E extends Error { constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; } }
const error = (codigo, mensaje) => new E(codigo, mensaje);

/** El reloj del servidor. Lo adelantan las perillas del Firestore. */
const reloj = { ms: 0 };

function crearFirestore() {
  const docs = new Map();
  let version = 0;
  const cuentas = { transacciones: 0, escrituras: 0, lecturasSueltas: 0 };
  const perillas = { msPorLectura: 0, choquesPendientes: 0, msPorChoque: 0 };

  const referencia = (ruta) => ({
    ruta,
    // Lectura FUERA de transacción: la que usa `calentar`.
    async get() {
      cuentas.lecturasSueltas++;
      const d = docs.get(ruta);
      return { exists: Boolean(d), data: () => (d ? structuredClone(d.datos) : undefined) };
    },
  });

  // Las transacciones sobre el mismo documento no corren a la vez: esperan.
  let cola = Promise.resolve();

  async function correr(cuerpo) {
    cuentas.transacciones++;
    for (let intento = 0; intento < 10; intento++) {
      const leidas = new Map();
      const escrituras = [];
      let yaEscribio = false;
      const tx = {
        async get(ref) {
          if (yaEscribio) throw error("invalid-argument", "Lectura tras escritura");
          // La lectura tarda: es lo que tarda una conexión nueva o una cola.
          reloj.ms += perillas.msPorLectura;
          const d = docs.get(ref.ruta);
          leidas.set(ref.ruta, d ? d.version : 0);
          return { exists: Boolean(d), data: () => (d ? structuredClone(d.datos) : undefined) };
        },
        set(ref, datos) { yaEscribio = true; escrituras.push({ ruta: ref.ruta, datos }); },
        update(ref, datos) { yaEscribio = true; escrituras.push({ ruta: ref.ruta, datos, unir: true }); },
      };

      const resultado = await cuerpo(tx);

      // Alguien escribió en el medio: la transacción se reintenta entera.
      if (perillas.choquesPendientes > 0) {
        perillas.choquesPendientes--;
        reloj.ms += perillas.msPorChoque;
        continue;
      }
      if ([...leidas].some(([r, v]) => (docs.get(r)?.version ?? 0) !== v)) continue;

      for (const e of escrituras) {
        const previo = docs.get(e.ruta);
        docs.set(e.ruta, {
          datos: e.unir ? { ...(previo?.datos ?? {}), ...structuredClone(e.datos) } : structuredClone(e.datos),
          version: ++version,
        });
        cuentas.escrituras++;
      }
      return resultado;
    }
    throw error("aborted", "Demasiados reintentos.");
  }

  const db = {
    cuentas,
    perillas,
    collection: (n) => ({ doc: (id) => referencia(`${n}/${id}`) }),
    runTransaction(cuerpo) {
      const turno = cola.then(() => correr(cuerpo));
      cola = turno.catch(() => {});
      return turno;
    },
    leer: (ruta) => docs.get(ruta)?.datos,
  };
  return db;
}

// ================================================================ montaje

const JUGADORES = ["ana", "beto", "caro", "dani"];
const CODIGO = "LLE001";
const ABRE = 1_000_000;

/**
 * Una partida recién repartida: la ventana de la ronda está abierta desde
 * `ABRE` y se aceptan descartes. Es la ventana real, no una armada a mano.
 */
async function montar() {
  reloj.ms = ABRE;
  const db = crearFirestore();
  const red = crearMotorEnRed({
    db, partidas: "partidas", ahora: () => reloj.ms, idAleatorio: () => `v${reloj.ms}`,
    marcaDeTiempo: () => "T", error, semillaDe: () => 4242,
  });
  await red.repartir({ codigo: CODIGO, jugadores: JUGADORES, nombres: JUGADORES });
  const ventana = db.leer(`partidas/${CODIGO}`).ventana;
  return { db, red, ventana };
}

const LATENCIA = 150;
const INCERTIDUMBRE = 150;

/** Un toque honesto: declara cuándo tocó y su latencia real. */
const tocar = (red, ventana, { uid, id, tocoEn }) =>
  red.intentarDescarte({
    uid, codigo: CODIGO, windowId: ventana.id, posicion: 0, clientActionId: id,
    declarado: tocoEn, latencia: LATENCIA, incertidumbre: INCERTIDUMBRE,
  });

/** El pedido llega `LATENCIA` después del toque. */
const llegaEn = (tocoEn) => ABRE + tocoEn + LATENCIA;

const intento = (db, id) => db.leer(`partidas/${CODIGO}`).ventana.intentos[id];

// ==================================================================== 1

console.log("\n=== 1. Una primera conexión lenta no le cuesta el descarte ===");
{
  /**
   * El caso de producción: la primera transacción de una instancia tarda dos
   * segundos. Con la hora leída adentro, un toque un segundo antes del final
   * llegaba con el piso empujado más allá de la ventana, y se rechazaba.
   */
  const { db, red, ventana } = await montar();
  const tocoEn = ventana.duracionMs - 1000;
  reloj.ms = llegaEn(tocoEn);
  db.perillas.msPorLectura = 2000;

  let rechazo = null;
  try {
    await tocar(red, ventana, { uid: "ana", id: "a1", tocoEn });
  } catch (e) {
    rechazo = e.message;
  }

  ok(rechazo === null, "un toque a tiempo se acepta aunque la lectura tarde dos segundos", rechazo);
  const i = intento(db, "a1");
  ok(i?.llegada === tocoEn + LATENCIA,
     "la llegada es la de la entrada, no la de después de leer", i?.llegada);
  ok(i?.efectivo === tocoEn,
     "y cuenta lo que tardó el jugador, no lo que tardó la base", i?.efectivo);
}

// ==================================================================== 2

console.log("\n=== 2. Un reintento de la transacción no la mueve ===");
{
  const { db, red, ventana } = await montar();
  const tocoEn = ventana.duracionMs - 1000;
  reloj.ms = llegaEn(tocoEn);
  // Alguien escribe en el medio: la transacción se repite un segundo y medio
  // después. La hora que vale es la de cuando llegó el pedido, no la del
  // intento que por fin pasó.
  db.perillas.choquesPendientes = 1;
  db.perillas.msPorChoque = 1500;

  let rechazo = null;
  try {
    await tocar(red, ventana, { uid: "ana", id: "a1", tocoEn });
  } catch (e) {
    rechazo = e.message;
  }

  ok(rechazo === null, "el reintento no convierte un toque a tiempo en uno tarde", rechazo);
  ok(intento(db, "a1")?.llegada === tocoEn + LATENCIA,
     "la llegada es la misma en todos los intentos", intento(db, "a1")?.llegada);
}

// ==================================================================== 3

console.log("\n=== 3. En la cola, el cuarto no paga la espera de los otros tres ===");
{
  /**
   * El bug que pasaba tibio. Cuatro tocan con cinco milisegundos de
   * diferencia; cada transacción tarda 300 ms y esperan turno. Con la hora
   * leída adentro, el cuarto quedaba casi un segundo detrás del primero por
   * una cola que no elige.
   */
  const { db, red, ventana } = await montar();
  db.perillas.msPorLectura = 300;

  const pedidos = [];
  JUGADORES.forEach((uid, n) => {
    const tocoEn = 1000 + 5 * n;
    reloj.ms = llegaEn(tocoEn);
    // Se lanzan sin esperar: cada uno sella su llegada al entrar y después
    // hace fila detrás del anterior.
    pedidos.push(tocar(red, ventana, { uid, id: `t${n}`, tocoEn }));
  });
  await Promise.all(pedidos);

  const efectivos = JUGADORES.map((_, n) => intento(db, `t${n}`)?.efectivo);
  const distancias = efectivos.slice(1).map((e, n) => e - efectivos[n]);

  ok(efectivos.every(Number.isFinite), "los cuatro quedaron anotados", efectivos);
  ok(distancias.every((d) => d === 5),
     "entre uno y el siguiente hay los cinco milisegundos que hubo de verdad", distancias);
  ok(efectivos[3] - efectivos[0] === 15,
     "y el cuarto está a 15 ms del primero, no a casi un segundo", efectivos[3] - efectivos[0]);
}

// ==================================================================== 4

console.log("\n=== 4. Calentar lee una vez y no toca nada ===");
{
  const { db, red } = await montar();
  const partidaAntes = db.leer(`partidas/${CODIGO}`);
  const transaccionesAntes = db.cuentas.transacciones;
  const escriturasAntes = db.cuentas.escrituras;

  const r = await red.calentar({ uid: "ana", codigo: CODIGO });

  ok(r?.caliente === true, "contesta que quedó lista", r);
  ok(db.cuentas.lecturasSueltas === 1,
     "con UNA lectura, que es lo que abre la conexión con la base", db.cuentas.lecturasSueltas);
  ok(db.cuentas.transacciones === transaccionesAntes,
     "fuera de transacción: no hace esperar a ningún descarte de verdad",
     db.cuentas.transacciones - transaccionesAntes);
  ok(db.cuentas.escrituras === escriturasAntes, "no escribe nada",
     db.cuentas.escrituras - escriturasAntes);

  const partidaDespues = db.leer(`partidas/${CODIGO}`);
  ok(partidaDespues.version === partidaAntes.version, "no sube la versión");
  ok(Object.keys(partidaDespues.ventana.intentos ?? {}).length === 0, "ni anota ningún intento");
}

// ==================================================================== 5

console.log("\n=== 5. Nadie de afuera recibe un «listo» ===");
{
  const { red } = await montar();
  let rechazo = null;
  try {
    await red.calentar({ uid: "zoe", codigo: CODIGO });
  } catch (e) {
    rechazo = e.codigo;
  }
  ok(rechazo === "permission-denied", "quien no juega esa partida es rechazado", rechazo);
}

console.log(fallos ? `\n❌ ${fallos} FALLOS` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
