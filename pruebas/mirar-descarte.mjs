/**
 * D2: descartar durante la mirada.
 *
 * EL PROBLEMA
 *
 * La muestra puede ser justo la carta que acabás de memorizar. Hasta ahora ese
 * descarte era imposible: la fase todavía era `mirar`, no existía ninguna
 * ventana a la que pertenecer, y el servidor rechazaba el intento. El jugador
 * veía la coincidencia y no podía hacer nada con ella.
 *
 * LA SOLUCIÓN
 *
 * Una sola ventana, que abre con la mirada:
 *
 *   0 s ───────── 2 s ───────────────── 7 s ──── 9 s
 *        MIRAR          DESCARTE          gracia
 *        └───────── una sola ventana ────────┘
 *
 * Lo que vive el jugador no cambia —2 s de mirada, 5 de descarte, 2 de gracia
 * para los paquetes lentos—: cambia dónde empieza a contar la ventana.
 *
 * Lo que hay que demostrar:
 *
 *   1. que se pueda descartar durante `mirar`, al principio y al final;
 *   2. que sea UNA ventana y no dos, con el mismo id de punta a punta;
 *   3. que un intento de la mirada sobreviva al cambio de fase y se resuelva
 *      al cerrar, con su castigo y su revelación si correspondiera;
 *   4. que el tiempo efectivo siga midiendo reacción y no conexión;
 *   5. que fuera de la ventana se siga rechazando.
 */

import { crearMotorEnRed, MS_MIRAR } from "../functions/partida-red.js";
import { MS_VENTANA, MS_GRACIA, MS_EMPATE_TECNICO } from "../public/js/reglas/red.js";
import { MS_REVELACION } from "../public/js/reglas/vista.js";

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
    collection: (n) => ({ doc: (id = `a${Math.random()}`) => ({ ruta: `${n}/${id}` }) }),
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
  return db;
}

const CUATRO = ["ana", "beto", "caro", "dani"];
const CODIGO = "D2TEST";
let reloj = 400000;

function montar() {
  const db = crearFirestore();
  const red = crearMotorEnRed({
    db, partidas: "partidas", ahora: () => reloj, idAleatorio: () => `v${reloj}_${version()}`,
    marcaDeTiempo: () => "T", error, semillaDe: () => 31337,
  });
  return { db, red };
}
let n = 0;
const version = () => ++n;

const capturar = async (fn) => {
  try { return { valor: await fn() }; } catch (e) { return { error: e }; }
};

async function nueva() {
  reloj = 400000;
  const { db, red } = montar();
  await red.repartir({ codigo: CODIGO, jugadores: CUATRO, nombres: CUATRO });
  return { db, red };
}

const partida = (db) => db.leer(`partidas/${CODIGO}`);
const vista = (db, uid) => db.leer(`partidas/${CODIGO}/vistas/${uid}`);
const vence = (v) => v.abiertaEn + v.duracionMs + v.graciaMs;

/** Descarta la posición `pos`, declarando que reaccionó en `enMs`. */
const tocar = (red, uid, v, pos, enMs, id) =>
  capturar(() => red.intentarDescarte({
    uid, codigo: CODIGO, windowId: v.id, posicion: pos,
    clientActionId: id, declarado: enMs, latencia: 40, incertidumbre: 20,
  }));

// =================================================== 1. la ventana existe

console.log("\n=== 1. La ventana nace con la mirada ===");
{
  const { db } = await nueva();
  const p = partida(db);

  ok(p.estado.fase === "mirar", "la partida arranca mirando", p.estado.fase);
  ok(Boolean(p.ventana), "y YA tiene ventana de descarte");
  ok(p.ventana.abiertaEn === 400000, "abierta en el instante del reparto", p.ventana.abiertaEn);
  ok(p.ventana.duracionMs === MS_MIRAR + MS_VENTANA,
     "que dura 2 s de mirada + 5 s de descarte = 7 s", p.ventana.duracionMs);
  ok(p.ventana.graciaMs === MS_GRACIA, "la gracia no cambia", p.ventana.graciaMs);
  ok(Object.keys(p.ventana.intentos).length === 0, "y sin intentos todavía");

  ok(p.plazo.que === "cerrarMirada", "el plazo es cerrar la mirada", p.plazo.que);
  ok(p.plazo.hasta === p.ventana.abiertaEn + MS_MIRAR,
     "a los 2 s de ABRIRSE LA VENTANA, no de este golpe",
     p.plazo.hasta - p.ventana.abiertaEn);
}

// ============================================ 2. descartar durante mirar

console.log("\n=== 2. Se puede descartar durante la mirada ===");
{
  const { db, red } = await nueva();
  const v = partida(db).ventana;

  // Apenas empieza: 100 ms después de abrirse.
  reloj = v.abiertaEn + 140;
  const alPrincipio = await tocar(red, "ana", v, 0, 100, "temprano");
  ok(alPrincipio.valor?.anotado === true,
     "al principio de la mirada se anota", alPrincipio.error?.message);
  ok(partida(db).estado.fase === "mirar", "y la fase sigue siendo mirar", partida(db).estado.fase);

  // Al filo de que termine la mirada.
  reloj = v.abiertaEn + MS_MIRAR - 60;
  const alFinal = await tocar(red, "beto", v, 1, MS_MIRAR - 100, "al-filo");
  ok(alFinal.valor?.anotado === true, "al final de la mirada también", alFinal.error?.message);

  ok(Object.keys(partida(db).ventana.intentos).length === 2,
     "los dos quedan anotados en la MISMA ventana",
     Object.keys(partida(db).ventana.intentos).length);
}

// ================================ 3. una sola ventana de punta a punta

console.log("\n=== 3. Una sola ventana, de la mirada al cierre ===");
{
  const { db, red } = await nueva();
  const inicial = partida(db).ventana;

  reloj = inicial.abiertaEn + 300;
  await tocar(red, "ana", inicial, 0, 260, "durante-mirar");

  // Se cierra la mirada.
  reloj = inicial.abiertaEn + MS_MIRAR;
  const cierreMirada = await red.avanzarPartida({ codigo: CODIGO });
  ok(cierreMirada.hizo === "cerrarMirada", "la mirada se cierra a los 2 s", cierreMirada.hizo);
  ok(partida(db).estado.fase === "descarte", "y empieza el descarte", partida(db).estado.fase);

  const trasMirada = partida(db).ventana;
  ok(trasMirada.id === inicial.id, "la ventana es la MISMA", [trasMirada.id, inicial.id]);
  ok(trasMirada.abiertaEn === inicial.abiertaEn, "con su hora original");
  ok(Object.keys(trasMirada.intentos).length === 1,
     "y el intento de la mirada sigue vivo", Object.keys(trasMirada.intentos).length);

  // Golpear mil veces no abre otra.
  for (let i = 0; i < 20; i++) await red.avanzarPartida({ codigo: CODIGO });
  ok(partida(db).ventana.id === inicial.id, "veinte golpes no abren una segunda");

  // Y todavía se puede descartar, ahora en fase `descarte`.
  reloj = inicial.abiertaEn + MS_MIRAR + 500;
  const enDescarte = await tocar(red, "beto", inicial, 1, MS_MIRAR + 460, "durante-descarte");
  ok(enDescarte.valor?.anotado === true, "se sigue descartando en la fase descarte",
     enDescarte.error?.message);
}

// ============================== 4. el intento de la mirada se resuelve

console.log("\n=== 4. Lo tocado durante la mirada se resuelve al cerrar ===");
{
  const { db, red } = await nueva();
  const v = partida(db).ventana;
  const muestra = partida(db).estado.descarte[0];
  const manoAna = partida(db).estado.jugadores[0].mano;

  // Ana toca, DURANTE LA MIRADA, una carta que no coincide: error seguro.
  const posMala = manoAna.findIndex((c) => c && c.numero !== muestra.numero);
  const equivocada = manoAna[posMala];
  reloj = v.abiertaEn + 200;
  await tocar(red, "ana", v, posMala, 160, "error-en-mirar");

  const cartasAntes = manoAna.filter(Boolean).length;

  // Se cierra todo.
  reloj = v.abiertaEn + MS_MIRAR;
  await red.avanzarPartida({ codigo: CODIGO });
  reloj = vence(v) + 1;
  const cierre = await red.avanzarPartida({ codigo: CODIGO });
  ok(cierre.hizo === "cerrarVentana", "la ventana se cierra sola", cierre.hizo);

  const aplicado = cierre.orden.find((o) => o.uid === "ana");
  ok(aplicado?.resultado === "error",
     "el intento hecho en la MIRADA se aplicó como error", aplicado);

  const despues = partida(db).estado.jugadores[0].mano;
  ok(despues.filter(Boolean).length === cartasAntes + 1,
     "y costó una carta de castigo", [cartasAntes, despues.filter(Boolean).length]);
  ok(despues[posMala]?.id === equivocada.id, "la carta equivocada no se movió");

  // Y la mesa la ve, dos segundos.
  ok(vista(db, "beto").jugadores[0].mano[posMala]?.id === equivocada.id,
     "beto la ve destapada durante la revelación");

  reloj += MS_REVELACION;
  await red.avanzarPartida({ codigo: CODIGO });
  ok(!JSON.stringify(vista(db, "beto")).includes(`"${equivocada.id}"`),
     "y pasados los 2 s desaparece: no queda marca");
}

// ================================== 5. el reloj sigue midiendo reacción

console.log("\n=== 5. Sigue ganando el que reaccionó antes, no el que llegó antes ===");
{
  const { db, red } = await nueva();
  const p0 = partida(db);
  const muestra = p0.estado.descarte[0];

  // Se plantan dos coincidencias reales para que el careo ocurra siempre y no
  // dependa de la semilla: ana y beto tienen, cada uno, una carta del mismo
  // número que la muestra, en la posición 0.
  const gemela = (palo) => ({ id: `${palo}-${muestra.numero}`, palo, numero: muestra.numero, puntos: muestra.numero });
  const usadas = new Set([`Oro-${muestra.numero}`, `Copa-${muestra.numero}`]);
  await db.runTransaction(async (tx) => {
    tx.set({ ruta: `partidas/${CODIGO}` }, {
      ...p0,
      estado: {
        ...p0.estado,
        mazo: p0.estado.mazo.filter((c) => !usadas.has(c.id)),
        jugadores: p0.estado.jugadores.map((j, i) =>
          i === 0 ? { ...j, mano: [gemela("Oro"), ...j.mano.slice(1)] }
          : i === 1 ? { ...j, mano: [gemela("Copa"), ...j.mano.slice(1)] }
          : j),
      },
      version: p0.version + 1,
    });
  });
  const v = partida(db).ventana;

  // Ana reacciona DURANTE LA MIRADA (ms 300) con una conexión mala: su pedido
  // llega en el 1400. Beto reacciona mucho después, ya en el descarte (ms
  // 3000), pero con fibra. Por orden de llegada ganaría ana igual; lo que se
  // prueba es que el tiempo efectivo la deja primera por REACCIÓN.
  reloj = v.abiertaEn + 1400;
  const lenta = await capturar(() => red.intentarDescarte({
    uid: "ana", codigo: CODIGO, windowId: v.id, posicion: 0,
    clientActionId: "ana-lenta", declarado: 300, latencia: 550, incertidumbre: 275,
  }));
  ok(lenta.valor?.anotado === true, "ana descarta durante la mirada", lenta.error?.message);

  reloj = v.abiertaEn + 3030;
  const rapida = await capturar(() => red.intentarDescarte({
    uid: "beto", codigo: CODIGO, windowId: v.id, posicion: 0,
    clientActionId: "beto-rapido", declarado: 3000, latencia: 30, incertidumbre: 15,
  }));
  ok(rapida.valor?.anotado === true, "beto descarta durante el descarte", rapida.error?.message);

  reloj = v.abiertaEn + MS_MIRAR;
  await red.avanzarPartida({ codigo: CODIGO });
  reloj = vence(v) + 1;
  const cierre = await red.avanzarPartida({ codigo: CODIGO });

  const orden = cierre.orden.map((o) => o.uid);
  ok(orden[0] === "ana",
     "gana ana, que reaccionó en la mirada, aunque su conexión es peor", orden);
  ok(cierre.orden[0].resultado === "primero", "y se lleva el 'primero'", cierre.orden[0]);
  ok(cierre.orden[1].resultado === "tarde",
     "beto acierta pero llega tarde: se lleva su castigo", cierre.orden[1]);

  // La prueba de que el criterio es la reacción y no el reloj de pared: los
  // dos tiempos efectivos conservan el orden en que REACCIONARON.
  const efectivos = Object.values(partida(db).ventana.intentos)
    .sort((a, b) => a.efectivo - b.efectivo).map((x) => [x.uid, x.efectivo]);
  ok(efectivos[0][0] === "ana" && efectivos[0][1] < efectivos[1][1],
     "el tiempo efectivo de ana es menor", efectivos);
}

// ========================================= 6. fuera de la ventana, no

console.log("\n=== 6. Fuera de la ventana se sigue rechazando ===");
{
  const { db, red } = await nueva();
  const v = partida(db).ventana;

  // Una reacción posterior al final del descarte no vale, por rápida que sea
  // la conexión: lo que se acepta tarde es la LLEGADA, nunca la reacción.
  reloj = v.abiertaEn + v.duracionMs + 500;
  const tardio = await tocar(red, "ana", v, 0, v.duracionMs + 400, "tarde");
  ok(/fuera de tiempo/i.test(tardio.error?.message ?? ""),
     "reaccionar después del final de la ventana se rechaza", tardio.error?.message);

  // Y con la ventana ya cerrada, tampoco.
  reloj = v.abiertaEn + MS_MIRAR;
  await red.avanzarPartida({ codigo: CODIGO });
  reloj = vence(v) + 1;
  await red.avanzarPartida({ codigo: CODIGO });
  const cerrada = await tocar(red, "beto", v, 0, 500, "post-cierre");
  ok(Boolean(cerrada.error), "con la ventana cerrada, tampoco", cerrada.error?.message);
}

// =========================== 7. un windowId viejo no cuela en otra ronda

console.log("\n=== 7. Cada ronda estrena su ventana ===");
{
  const { db, red } = await nueva();
  const primera = partida(db).ventana;

  // Se fuerza el fin de ronda para llegar a la siguiente.
  const p = partida(db);
  await db.runTransaction(async (tx) => {
    tx.set({ ruta: `partidas/${CODIGO}` }, {
      ...p, estado: { ...p.estado, fase: "finRonda" }, plazo: null, version: p.version + 1,
    });
  });
  await red.avanzarPartida({ codigo: CODIGO });   // repone el plazo
  reloj += 60000;
  await red.avanzarPartida({ codigo: CODIGO });   // siguienteRonda

  const segunda = partida(db).ventana;
  ok(partida(db).estado.fase === "mirar", "la ronda nueva arranca mirando", partida(db).estado.fase);
  ok(Boolean(segunda) && segunda.id !== primera.id, "con una ventana nueva",
     [segunda?.id, primera.id]);
  ok(Object.keys(segunda.intentos).length === 0, "sin intentos heredados");

  // El identificador de la ventana anterior ya no sirve.
  const conVieja = await tocar(red, "ana", primera, 0, 200, "ventana-vieja");
  ok(/otra ronda/i.test(conVieja.error?.message ?? ""),
     "un intento con el windowId viejo se rechaza", conVieja.error?.message);
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
