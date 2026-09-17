/**
 * La primera ronda espera a que lleguen todos, y arranca con cuenta regresiva.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL BUG
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La ventana de la primera ronda nacía en el reparto, y la mirada dura dos
 * segundos. Pero quien reparte es la SALA: los jugadores todavía tienen que
 * redirigirse y cargar la mesa. En producción eso llevó unos seis segundos.
 * El primero en llegar golpeaba al entrar, el servidor encontraba la mirada
 * vencida y la cerraba, y el toque para mirar rebotaba:
 *
 *   01:59:28.7  iniciarPartida  → arranca la mirada (2 s)
 *   01:59:36.4  avanzarPartida  → la cierra: ya había vencido
 *   01:59:36.9  accionDePartida → el toque para mirar
 *   01:59:38.1                  → 400
 *
 * Nadie veía su primera carta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE MÁS HABÍA QUE CUIDAR: EL BARREDOR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Una partida que espera jugadores no puede confundirse con una abandonada.
 * `vaciarMesaDesierta` mira el latido MÁS RECIENTE de los que siguen: si las
 * llegadas se hubieran anotado arrancando los latidos en cero, el barredor
 * habría vaciado cada partida nueva en su primera pasada. El caso 7 lo fija,
 * y el 8 muestra la trampa en la que no se cayó.
 */

import { readFileSync } from "node:fs";
import {
  crearMotorEnRed,
  MS_CUENTA_REGRESIVA,
  MS_ESPERA_LLEGADAS,
  MS_MESA_DESIERTA,
} from "../functions/partida-red.js";
import { MS_MIRAR } from "../public/js/reglas/motor.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

class E extends Error { constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; } }
const error = (codigo, mensaje) => new E(codigo, mensaje);

function crearFirestore() {
  const docs = new Map();
  let version = 0;
  const db = {
    collection: (n) => ({ doc: (id) => ({ ruta: `${n}/${id}` }) }),
    async runTransaction(cuerpo) {
      for (let i = 0; i < 10; i++) {
        const leidas = new Map(); const esc = []; let yaEscribio = false;
        const tx = {
          async get(ref) {
            if (yaEscribio) throw error("invalid-argument", "Lectura tras escritura");
            const d = docs.get(ref.ruta);
            leidas.set(ref.ruta, d ? d.version : 0);
            return { exists: Boolean(d), data: () => (d ? structuredClone(d.datos) : undefined) };
          },
          set(ref, datos) { yaEscribio = true; esc.push({ ruta: ref.ruta, datos }); },
          update(ref, datos) { yaEscribio = true; esc.push({ ruta: ref.ruta, datos, unir: true }); },
        };
        const res = await cuerpo(tx);
        if ([...leidas].some(([r, v]) => (docs.get(r)?.version ?? 0) !== v)) continue;
        for (const e of esc) {
          const p = docs.get(e.ruta);
          docs.set(e.ruta, {
            datos: e.unir ? { ...(p?.datos ?? {}), ...structuredClone(e.datos) } : structuredClone(e.datos),
            version: ++version,
          });
        }
        return res;
      }
      throw error("aborted", "Demasiados reintentos.");
    },
  };
  db.leer = (r) => docs.get(r)?.datos;
  db.escribir = async (r, cambiar) => {
    await db.runTransaction(async (tx) => {
      const actual = docs.get(r)?.datos;
      tx.set({ ruta: r }, cambiar(structuredClone(actual)));
    });
  };
  return db;
}

// ================================================================ montaje

const CUATRO = ["ana", "beto", "caro", "dani"];
const CODIGO = "PRI001";
const REPARTO = 1_000_000;
let reloj = REPARTO;

async function montar() {
  reloj = REPARTO;
  const db = crearFirestore();
  const red = crearMotorEnRed({
    db, partidas: "partidas", ahora: () => reloj, idAleatorio: () => `v${reloj}`,
    marcaDeTiempo: () => "T", error, semillaDe: () => 4242,
  });
  // Sin `yaSentados`: exactamente como reparte `iniciarPartida`.
  await red.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: CUATRO });
  return { db, red };
}

const partida = (db) => db.leer(`partidas/${CODIGO}`);
const vista = (db, uid = "ana") => db.leer(`partidas/${CODIGO}/vistas/${uid}`);

const llegar = (red, uid) => red.latir({ uid, codigo: CODIGO });
let idAccion = 0;
const mirar = (red, uid, posicion = 0) =>
  red.accionDeTurno({ uid, codigo: CODIGO, accion: "mirar", clientActionId: `m${++idAccion}`, posicion });

async function rechazo(promesa) {
  try { await promesa; return null; } catch (e) { return e.message; }
}

// ==================================================================== 1

console.log("\n=== 1. La partida nace esperando, sin ventana ===");
{
  const { db } = await montar();
  const p = partida(db);

  ok(p.estado.fase === "mirar", "la fase es la de mirar", p.estado.fase);
  ok(p.ventana === null, "pero la ventana todavía no existe", p.ventana);
  ok(p.esperandoLlegadas === true, "está esperando a los jugadores");
  ok(JSON.stringify(vista(db).esperando) === JSON.stringify({ llegaron: 0, total: 4 }),
     "y la mesa lo sabe: llegaron 0 de 4", vista(db).esperando);

  /**
   * El plazo de la espera, y no el de la mirada. Sin el caso nuevo de
   * `plazoDe`, éste era «cerrar la mirada en dos segundos» calculado con una
   * ventana que no existe, y la primera ronda se habría saltado entera.
   */
  ok(p.plazo?.que === "abrirPrimeraRonda", "el único plazo es el tope de la espera", p.plazo);
  ok(p.plazo?.hasta === REPARTO + MS_ESPERA_LLEGADAS,
     "que vence a los quince segundos del reparto", p.plazo?.hasta - REPARTO);
}

// ==================================================================== 2

console.log("\n=== 2. Latir es llegar, y se cuenta una sola vez ===");
{
  const { db, red } = await montar();
  reloj += 1500;
  const antes = partida(db).version;
  await llegar(red, "ana");

  ok(JSON.stringify(vista(db, "beto").esperando) === JSON.stringify({ llegaron: 1, total: 4 }),
     "llegó una, y los demás lo ven", vista(db, "beto").esperando);
  ok(partida(db).version === antes + 1, "se republica: cambió algo que se ve");
  ok(partida(db).ventana === null, "todavía no abre: faltan tres");

  // Su segundo latido no es una segunda llegada.
  const tras = partida(db).version;
  reloj += 5000;
  await llegar(red, "ana");
  ok(vista(db).esperando?.llegaron === 1, "el segundo latido no suma", vista(db).esperando);
  ok(partida(db).version === tras,
     "y no republica: cuatro jugadores latiendo cada cinco segundos serían miles de escrituras",
     partida(db).version - tras);
}

// ==================================================================== 3

console.log("\n=== 3. Cuando llega el último, abre — con la cuenta por delante ===");
{
  const { db, red } = await montar();
  reloj += 1000; await llegar(red, "ana");
  reloj += 800;  await llegar(red, "beto");
  reloj += 2500; await llegar(red, "caro");
  ok(partida(db).ventana === null, "con tres de cuatro, sigue esperando");

  reloj += 1200;
  const llegaElUltimo = reloj;
  const r = await llegar(red, "dani");

  const p = partida(db);
  ok(r.abrio === true, "el último latido abre la ronda", r);
  ok(p.esperandoLlegadas === false, "deja de esperar");
  ok(vista(db).esperando === null, "y la mesa deja de mostrar la espera", vista(db).esperando);

  /**
   * `abiertaEn` en el futuro: al terminar la cuenta. Las cuatro pantallas
   * dibujan «3, 2, 1, Preparate…» contra esa hora y empiezan a mirar juntas.
   */
  ok(p.ventana?.abiertaEn === llegaElUltimo + MS_CUENTA_REGRESIVA,
     "la ventana abre cuando termina la cuenta", p.ventana?.abiertaEn - llegaElUltimo);
  ok(vista(db).ventana?.abiertaEn === p.ventana.abiertaEn,
     "y esa hora viaja en la vista, para que la mesa la dibuje");
  ok(p.plazo?.que === "cerrarMirada" &&
     p.plazo?.hasta === p.ventana.abiertaEn + MS_MIRAR,
     "los dos segundos de mirada se cuentan desde que abre, no desde que llegó el último",
     p.plazo);
}

// ==================================================================== 4

console.log("\n=== 4. Nadie mira antes de tiempo ===");
{
  const { db, red } = await montar();
  for (const uid of CUATRO) await llegar(red, uid);
  const abre = partida(db).ventana.abiertaEn;

  // Durante la cuenta: la fase ya es `mirar`, pero la mirada no empezó.
  reloj = abre - 1;
  ok(/todavía no empezó/.test(await rechazo(mirar(red, "ana"))),
     "mirar durante la cuenta se rechaza");
  ok(/todavía no empezó/.test(await rechazo(red.cerrarMirada({ codigo: CODIGO }))),
     "y cortarle la mirada a todos, también");
  ok(partida(db).estado.fase === "mirar", "la partida sigue en mirar", partida(db).estado.fase);

  // Un descarte antes de que abra cae fuera de la ventana.
  const v = partida(db).ventana;
  ok(await rechazo(red.intentarDescarte({
    uid: "beto", codigo: CODIGO, windowId: v.id, posicion: 0, clientActionId: "d1",
    declarado: 0, latencia: 100, incertidumbre: 100,
  })) !== null, "un descarte antes de abrir no se anota");

  // Y en cuanto abre, sí.
  reloj = abre;
  ok(await rechazo(mirar(red, "ana")) === null, "con la ventana abierta, mirar se acepta");
}

// ==================================================================== 5

console.log("\n=== 5. Durante la espera, nada puede adelantarla ===");
{
  const { db, red } = await montar();
  await llegar(red, "ana");
  reloj += 3000;

  ok(/todavía no empezó/.test(await rechazo(mirar(red, "ana"))),
     "mirar mientras faltan jugadores se rechaza");
  ok(/todavía no empezó/.test(await rechazo(red.cerrarMirada({ codigo: CODIGO }))),
     "cerrarMirada no la termina: dejaría la partida en descarte sin ventana");

  const r = await red.avanzarPartida({ codigo: CODIGO });
  ok(!r.hizo, "un golpe antes del tope no hace nada", r);
  ok(partida(db).esperandoLlegadas === true, "y sigue esperando");
}

// ==================================================================== 6

console.log("\n=== 6. Si alguien no llega nunca, arranca igual al tope ===");
{
  const { db, red } = await montar();
  reloj += 2000; await llegar(red, "ana");
  reloj += 2000; await llegar(red, "beto");
  // caro y dani no cargan la mesa.

  reloj = REPARTO + MS_ESPERA_LLEGADAS - 1;
  ok(!(await red.avanzarPartida({ codigo: CODIGO })).hizo, "un milisegundo antes del tope, todavía no");

  reloj = REPARTO + MS_ESPERA_LLEGADAS;
  const r = await red.avanzarPartida({ codigo: CODIGO });
  const p = partida(db);
  ok(r.hizo === "abrirPrimeraRonda", "al tope, el golpe la abre", r);
  ok(p.ventana?.abiertaEn === reloj + MS_CUENTA_REGRESIVA,
     "también con la cuenta por delante", p.ventana?.abiertaEn - reloj);
  ok(p.esperandoLlegadas === false, "y ya no espera a nadie");
}

// ==================================================================== 7

console.log("\n=== 7. El barredor NO confunde una mesa que espera con una abandonada ===");
{
  /**
   * La preocupación principal. El barredor pasa cada minuto y hace, para cada
   * partida con plazo vencido, `vaciarMesaDesierta` y después avanza. Una mesa
   * recién creada tiene los latidos del reparto: diez minutos de gracia, como
   * siempre.
   */
  const { db, red } = await montar();

  for (const t of [1000, 14_000, MS_ESPERA_LLEGADAS + 1000]) {
    reloj = REPARTO + t;
    const v = await red.vaciarMesaDesierta({ codigo: CODIGO });
    ok(v.vaciada === false && v.motivo === "alguien_sigue",
       `a los ${t / 1000} s del reparto, sin que nadie llegue, no la vacía`, v);
  }
  ok((partida(db).abandonaron ?? []).length === 0, "nadie quedó marcado como que abandonó");

  // Y la secuencia real del barredor, pasado el tope: vaciar, después avanzar.
  reloj = REPARTO + MS_ESPERA_LLEGADAS + 1000;
  await red.vaciarMesaDesierta({ codigo: CODIGO });
  const r = await red.avanzarPartida({ codigo: CODIGO });
  ok(r.hizo === "abrirPrimeraRonda", "el barredor, pasado el tope, ABRE la ronda en vez de cerrarla", r);
  ok(!partida(db).cerrada, "y la partida sigue viva");
}

// ==================================================================== 8

console.log("\n=== 8. La trampa en la que no se cayó ===");
{
  /**
   * Anotar las llegadas en los latidos, arrancándolos en cero, habría sido lo
   * más corto. Se comprueba acá qué habría pasado: el último latido sería
   * cero, el silencio enorme, y el barredor vaciaría la mesa en su primera
   * pasada. Por eso las llegadas van aparte.
   */
  const { db, red } = await montar();
  await db.escribir(`partidas/${CODIGO}`, (p) => ({
    ...p,
    latidos: Object.fromEntries(CUATRO.map((u) => [u, 0])),
    version: p.version + 1,
  }));
  reloj = REPARTO + 1000;
  const v = await red.vaciarMesaDesierta({ codigo: CODIGO });
  ok(v.vaciada === true,
     "con los latidos en cero, una mesa de un segundo se daría por abandonada", v);
  ok(REPARTO + 1000 > MS_MESA_DESIERTA,
     "(porque el silencio se mediría desde el año 1970)");
}

// ==================================================================== 9

console.log("\n=== 9. Quien abandonó mientras se esperaba no traba a los demás ===");
{
  const { db, red } = await montar();
  await db.escribir(`partidas/${CODIGO}`, (p) => ({
    ...p, abandonaron: ["dani"], version: p.version + 1,
  }));
  for (const uid of ["ana", "beto"]) await llegar(red, uid);
  ok(partida(db).ventana === null, "con dos de los tres que quedan, sigue esperando");

  const r = await llegar(red, "caro");
  ok(r.abrio === true, "con los tres que quedan, abre sin esperar a dani", r);
}

// ==================================================================== 10

console.log("\n=== 10. iniciarPartida reparte ESPERANDO ===");
{
  /**
   * `yaSentados` existe para las pruebas que parten de una mesa con todos
   * sentados. Si `iniciarPartida` lo pasara, el bug volvería tal cual: la
   * mirada arrancaría en la sala.
   */
  const indice = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  ok(/enRed\.repartirEn\(/.test(indice), "iniciarPartida reparte con repartirEn");
  ok(!/yaSentados/.test(indice), "y no le pasa yaSentados");
}

console.log(fallos ? `\n❌ ${fallos} FALLOS` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
