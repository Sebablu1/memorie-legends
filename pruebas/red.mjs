/**
 * Motor en red: protocolo de la ventana de descarte.
 *
 * Lo que hay que demostrar acá, por orden de importancia:
 *
 *   1. que ganar los reflejos NO dependa de tener mejor conexión;
 *   2. que mentir sobre el propio reloj no dé ventaja;
 *   3. que las reglas A/B/C sean exactamente las de siempre;
 *   4. que nada de esto se rompa con acciones duplicadas, tardías,
 *      simultáneas o de jugadores que no corresponden.
 */

import { readFileSync } from "node:fs";
import * as R from "../public/js/reglas/red.js";
import * as motor from "../public/js/reglas/motor.js";
import { crearMotorEnRed } from "../functions/partida-red.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

// ============================================ 5. sincronización de reloj

console.log("\n=== 5. Sincronización temporal ===");
{
  // Reloj del cliente 4000 ms adelantado; viaje de 100 ms simétrico.
  const desfaseReal = -4000;
  const muestra = R.muestraDeReloj({ t0: 1000, t1: 1000 + 50 - desfaseReal * -1, t2: 1100 });
  ok(Math.abs(muestra.viaje - 100) < 1, "mide el viaje de ida y vuelta", muestra.viaje);
  ok(muestra.incertidumbre === 50, "la incertidumbre es la mitad del viaje", muestra.incertidumbre);

  // Con viajes simétricos el desfase se estima exacto.
  const limpio = R.muestraDeReloj({ t0: 0, t1: 5000, t2: 200 });
  ok(limpio.desfase === 4900, "estima el desfase", limpio.desfase);

  const elegido = R.estimarReloj([
    { desfase: 900, viaje: 800, incertidumbre: 400 },
    { desfase: 1000, viaje: 60, incertidumbre: 30 },
    { desfase: 1200, viaje: 1400, incertidumbre: 700 },
  ]);
  ok(elegido.desfase === 1000, "se queda con la muestra de viaje más corto, no con el promedio", elegido.desfase);
  ok(elegido.incertidumbre === 30, "y con su incertidumbre", elegido.incertidumbre);

  const sinNada = R.estimarReloj([]);
  ok(sinNada.desfase === 0 && sinNada.incertidumbre === R.MS_LATENCIA_MAXIMA,
     "sin muestras asume lo peor, no lo mejor");
}

// ================================== 1 y 2. latencia y clientes mentirosos

console.log("\n=== La conexión no decide quién gana ===");
{
  // Los dos reaccionan en el ms 1000. Uno tiene 40 ms de latencia; el otro, 400.
  const rapido = R.tiempoEfectivo({ declarado: 1000, llegada: 1040, latencia: 40, incertidumbre: 20 });
  const lento  = R.tiempoEfectivo({ declarado: 1000, llegada: 1400, latencia: 400, incertidumbre: 200 });
  ok(rapido === 1000 && lento === 1000, "misma reacción, mismo tiempo efectivo", { rapido, lento });

  // Si se resolviera por orden de llegada, ganaría el rápido siempre.
  ok(1040 < 1400, "por orden de llegada habría ganado el de mejor conexión");

  // El lento que reaccionó ANTES gana, que es lo que corresponde.
  const lentoAntes = R.tiempoEfectivo({ declarado: 800, llegada: 1200, latencia: 400, incertidumbre: 200 });
  ok(lentoAntes < rapido, "el que reaccionó antes gana aunque llegue después", { lentoAntes, rapido });
}

console.log("\n=== Mentir sobre el propio reloj no sirve ===");
{
  // Un tramposo con 400 ms de latencia declara que reaccionó en el ms 0.
  const tramposo = R.tiempoEfectivo({ declarado: 0, llegada: 1400, latencia: 400, incertidumbre: 200 });
  const honestoIgual = R.tiempoEfectivo({ declarado: 800, llegada: 1400, latencia: 400, incertidumbre: 200 });
  ok(tramposo === 800, "se lo acota al borde de lo físicamente posible", tramposo);
  ok(tramposo === honestoIgual,
     "queda exactamente donde un honesto con su misma conexión", { tramposo, honestoIgual });

  // Declarar una latencia enorme tampoco: está topada.
  const exagerado = R.tiempoEfectivo({ declarado: 0, llegada: 1400, latencia: 999999, incertidumbre: 999999 });
  ok(exagerado === Math.max(0, 1400 - R.MS_LATENCIA_MAXIMA * 2),
     "la latencia declarada está topada", exagerado);

  // Declarar un tiempo POSTERIOR a la llegada sólo se perjudica a sí mismo.
  const tardio = R.tiempoEfectivo({ declarado: 5000, llegada: 1400, latencia: 400, incertidumbre: 200 });
  ok(tardio === 1400, "nadie reacciona después de que su pedido llegó", tardio);

  // Nada de lo que mande el cliente puede bajar del piso físico, que acá es
  // 1400 - 400 - 200 = 800: el momento más temprano en que pudo haber tocado.
  const piso = 800;
  for (const basura of [undefined, null, NaN, "0", -999, -Infinity]) {
    const t = R.tiempoEfectivo({ declarado: basura, llegada: 1400, latencia: 400, incertidumbre: 200 });
    ok(t >= piso, `declarado ${JSON.stringify(basura)} no baja del piso físico`, t);
  }
  // Y los que no son números caen en el peor caso, no en el mejor.
  for (const basura of [undefined, null, NaN, "0"]) {
    const t = R.tiempoEfectivo({ declarado: basura, llegada: 1400, latencia: 400, incertidumbre: 200 });
    ok(t === 1400, `declarado ${JSON.stringify(basura)} se trata como llegada`, t);
  }
}

// ================================== 6. resolución de simultaneidad

console.log("\n=== 6. Empate técnico ===");
{
  const ventana = (id, tiempos) => ({
    id, abiertaEn: 0, duracionMs: 5000, graciaMs: 2000, cerrada: false,
    intentos: Object.fromEntries(tiempos.map(([uid, efectivo], i) =>
      [`a${i}`, { clientActionId: `a${i}`, uid, posicion: 0, efectivo }])),
  });

  const claro = R.ordenarIntentos(ventana("v1", [["ana", 900], ["beto", 400]]));
  ok(claro[0].uid === "beto", "500 ms de diferencia se resuelve por tiempo", claro.map((i) => i.uid));

  // 20 ms de diferencia está por debajo de lo que el reloj puede medir.
  const empate = ventana("v1", [["ana", 1000], ["beto", 1020]]);
  ok(R.esEmpateTecnico(Object.values(empate.intentos)[0], Object.values(empate.intentos)[1]),
     "20 ms se considera empate técnico");

  const a = R.ordenarIntentos(empate).map((i) => i.uid);
  const b = R.ordenarIntentos(empate).map((i) => i.uid);
  ok(JSON.stringify(a) === JSON.stringify(b), "el desempate es determinista: mismo resultado", a);

  // Y el orden de llegada NO influye: los mismos datos en otro orden dan igual.
  const alReves = ventana("v1", [["beto", 1020], ["ana", 1000]]);
  const c = R.ordenarIntentos(alReves).map((i) => i.uid);
  ok(JSON.stringify(a.slice().sort()) === JSON.stringify(c.slice().sort()), "mismos participantes");
  ok(a[0] === c[0], "y el mismo ganador, sin importar el orden de llegada", { a, c });

  // No favorece siempre al mismo: en ventanas distintas gana uno u otro.
  const ganadores = {};
  for (let i = 0; i < 2000; i++) {
    const g = R.ordenarIntentos(ventana(`v${i}`, [["ana", 1000], ["beto", 1010]]))[0].uid;
    ganadores[g] = (ganadores[g] ?? 0) + 1;
  }
  const proporcion = ganadores.ana / 2000;
  ok(proporcion > 0.45 && proporcion < 0.55,
     `reparte parejo entre los dos (ana ganó ${(proporcion * 100).toFixed(1)}%)`, ganadores);

  // Y no se puede preparar: el peso depende del windowId, que da el servidor.
  ok(R.favorecido("v1", "ana") !== R.favorecido("v2", "ana"),
     "el mismo jugador tiene distinto peso en cada ventana");
}

// ============================================= 2/3/4. registro de intentos

console.log("\n=== 3-4. Qué se acepta y qué no ===");
{
  const base = () => R.crearVentana({ id: "vX", abiertaEn: 10000 });
  const intento = (extra = {}) => ({
    windowId: "vX", clientActionId: "c1", uid: "ana", posicion: 0,
    declarado: 500, latencia: 50, incertidumbre: 25, ...extra,
  });
  const ctx = (ahora) => ({ ahora, cantidadDeCartas: 4 });

  ok(R.registrarIntento(base(), intento(), ctx(10600)).ok, "un intento normal se acepta");

  ok(R.registrarIntento(base(), intento({ windowId: "otra" }), ctx(10600)).motivo === R.RECHAZO_INTENTO.VENTANA_DISTINTA,
     "una ventana que no es la actual se rechaza");
  ok(R.registrarIntento({ ...base(), cerrada: true }, intento(), ctx(10600)).motivo === R.RECHAZO_INTENTO.VENTANA_CERRADA,
     "una ventana ya cerrada se rechaza");
  ok(R.registrarIntento(base(), intento(), ctx(9000)).motivo === R.RECHAZO_INTENTO.FUERA_DE_TIEMPO,
     "antes de que abra se rechaza");
  ok(R.registrarIntento(base(), intento(), ctx(30000)).motivo === R.RECHAZO_INTENTO.FUERA_DE_TIEMPO,
     "mucho después de la gracia se rechaza");
  ok(R.registrarIntento(base(), intento({ posicion: 9 }), ctx(10600)).motivo === R.RECHAZO_INTENTO.POSICION_INVALIDA,
     "una posición que no existe se rechaza");
  ok(R.registrarIntento(base(), intento({ posicion: -1 }), ctx(10600)).motivo === R.RECHAZO_INTENTO.POSICION_INVALIDA,
     "una posición negativa se rechaza");
  ok(R.registrarIntento(base(), intento({ clientActionId: "" }), ctx(10600)).motivo === R.RECHAZO_INTENTO.FALTA_IDENTIFICADOR,
     "sin identificador se rechaza");

  // Tocó en el ms 4900 y su paquete tardó 400: llega en el 5300, ya pasada la
  // ventana. Se acepta, porque lo tardío es la llegada y no la reacción.
  const enGracia = R.registrarIntento(base(), intento({ declarado: 4900, latencia: 400, incertidumbre: 200 }), ctx(15300));
  ok(enGracia.ok, "una llegada tardía por latencia se acepta si reaccionó a tiempo", enGracia.motivo);
  ok(enGracia.ventana.intentos.c1.efectivo === 4900, "y conserva su tiempo de reacción", enGracia.ventana?.intentos?.c1?.efectivo);

  // En cambio, si su paquete tardó mucho más de lo que declara, el reloj se
  // corrige hacia adelante: no se le puede creer un 4900 con 1400 de viaje.
  const inconsistente = R.registrarIntento(base(), intento({ declarado: 4900, latencia: 400, incertidumbre: 200 }), ctx(16300));
  ok(inconsistente.motivo === R.RECHAZO_INTENTO.FUERA_DE_TIEMPO,
     "declarar poca latencia y llegar tardísimo perjudica al que lo declara", inconsistente.motivo);

  // Reacción posterior al fin de la ventana: no descarta, por rápido que sea.
  const tarde = R.registrarIntento(base(), intento({ declarado: 6000, latencia: 10, incertidumbre: 5 }), ctx(16100));
  ok(tarde.motivo === R.RECHAZO_INTENTO.FUERA_DE_TIEMPO,
     "reaccionar después de que la ventana terminó no vale", tarde.motivo);
}

// ==================================================== 7. idempotencia

console.log("\n=== 7. Idempotencia del intento ===");
{
  const v0 = R.crearVentana({ id: "vX", abiertaEn: 0 });
  const uno = R.registrarIntento(v0, { windowId: "vX", clientActionId: "c1", uid: "ana", posicion: 1, declarado: 300 },
    { ahora: 400, cantidadDeCartas: 4 });
  const dos = R.registrarIntento(uno.ventana, { windowId: "vX", clientActionId: "c1", uid: "ana", posicion: 3, declarado: 10 },
    { ahora: 900, cantidadDeCartas: 4 });

  ok(dos.ok && dos.duplicado, "el mismo identificador se reconoce como duplicado");
  ok(Object.keys(dos.ventana.intentos).length === 1, "no se anota dos veces");
  ok(dos.ventana.intentos.c1.posicion === 1, "y no se puede cambiar la jugada reenviándola", dos.ventana.intentos.c1.posicion);

  const otro = R.registrarIntento(uno.ventana, { windowId: "vX", clientActionId: "c2", uid: "ana", posicion: 2, declarado: 500 },
    { ahora: 900, cantidadDeCartas: 4 });
  ok(Object.keys(otro.ventana.intentos).length === 2, "un identificador nuevo sí se anota");
}

// ============================================ Las reglas A/B/C intactas

console.log("\n=== Las reglas A/B/C no cambian ===");
{
  const carta = (palo, numero) => ({ id: `${palo}-${numero}`, palo, numero, puntos: numero });
  const manos = [
    [carta("Basto", 6), carta("Copa", 2), carta("Copa", 4), carta("Copa", 7)],
    [carta("Espada", 6), carta("Basto", 2), carta("Basto", 4), carta("Basto", 7)],
    [carta("Oro", 3), carta("Espada", 2), carta("Espada", 4), carta("Espada", 7)],
  ];
  const muestra = { ...carta("Copa", 6), visible: true };
  const usadas = new Set([muestra.id, ...manos.flat().map((c) => c.id)]);
  const inicial = motor.empezarRonda(motor.crearPartida(
    [{ id: "ana", nombre: "A" }, { id: "beto", nombre: "B" }, { id: "caro", nombre: "C" }]));

  const estado = {
    ...inicial, fase: "descarte",
    ventanaDescarte: { huboPrimero: false, intentos: [] },
    descarte: [muestra],
    mazo: inicial.mazo.filter((c) => !usadas.has(c.id)),
    jugadores: inicial.jugadores.map((j, i) => ({ ...j, mano: manos[i] })),
  };

  // Ana reacciona primero, Beto después, Caro se equivoca. A propósito NO
  // llegan en ese orden: Beto llega antes que Ana, con mejor conexión.
  const ventana = {
    id: "vABC", abiertaEn: 0, duracionMs: 5000, graciaMs: 2000, cerrada: false,
    intentos: {
      b1: { clientActionId: "b1", uid: "beto", posicion: 0, efectivo: 1200, llegada: 400 },
      a1: { clientActionId: "a1", uid: "ana",  posicion: 0, efectivo: 800,  llegada: 1600 },
      c1: { clientActionId: "c1", uid: "caro", posicion: 0, efectivo: 2000, llegada: 2100 },
    },
  };

  const indiceDe = (uid) => ["ana", "beto", "caro"].indexOf(uid);
  const { estado: final, orden } = R.resolverVentana(estado, ventana, indiceDe, motor.intentarDescarte);
  const cuenta = (i) => final.jugadores[i].mano.filter(Boolean).length;

  ok(orden.map((o) => o.uid).join(",") === "ana,beto,caro",
     "se aplican por reacción, no por llegada", orden.map((o) => o.uid));
  ok(orden[0].resultado === "primero", "A: primer acierto");
  ok(cuenta(0) === 3, "A queda con 3: se sacó la carta", cuenta(0));
  ok(orden[1].resultado === "tarde", "B: segundo acierto");
  ok(cuenta(1) === 4, "B queda con 4: se fue una y entró la de castigo", cuenta(1));
  ok(final.jugadores[1].mano[0] === null, "la de B se fue al descarte");
  ok(orden[2].resultado === "error", "C: error");
  ok(cuenta(2) === 5, "C queda con 5", cuenta(2));
  ok(final.jugadores[2].mano[0]?.id === "Oro-3", "C conserva su carta en su posición");
  ok(!("infoPublica" in final), "infoPublica no volvió");

  // Beto llegó primero al servidor. Si se hubiera resuelto por llegada,
  // habría sido él el que se salvaba.
  ok(ventana.intentos.b1.llegada < ventana.intentos.a1.llegada && orden[0].uid === "ana",
     "el de mejor conexión NO se lleva el premio por llegar antes");
}

// ============================== Firestore de mentira, con concurrencia

class ErrorFalso extends Error {
  constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; }
}
const error = (codigo, mensaje) => new ErrorFalso(codigo, mensaje);

function crearFirestore(inicial = {}) {
  const docs = new Map();
  let version = 0;
  for (const [ruta, datos] of Object.entries(inicial)) {
    docs.set(ruta, { datos: structuredClone(datos), version: ++version });
  }
  const db = {
    intentos: 0,
    ganchoTrasLeer: null,
    collection: (nombre) => ({
      doc: (id = `auto_${Math.random().toString(36).slice(2)}`) => ({ ruta: `${nombre}/${id}` }),
    }),
    async runTransaction(cuerpo) {
      for (let intento = 0; intento < 8; intento++) {
        db.intentos++;
        const leidas = new Map();
        const escrituras = [];
        const tx = {
          async get(ref) {
            const d = docs.get(ref.ruta);
            leidas.set(ref.ruta, d ? d.version : 0);
            if (db.ganchoTrasLeer) await db.ganchoTrasLeer(ref.ruta);
            return { exists: Boolean(d), data: () => (d ? structuredClone(d.datos) : undefined) };
          },
          set(ref, datos, op) { escrituras.push({ ruta: ref.ruta, datos, fusionar: Boolean(op?.merge) }); },
          update(ref, datos) { escrituras.push({ ruta: ref.ruta, datos, fusionar: true }); },
        };
        const resultado = await cuerpo(tx);
        if ([...leidas].some(([ruta, v]) => (docs.get(ruta)?.version ?? 0) !== v)) continue;
        for (const e of escrituras) {
          const previo = docs.get(e.ruta);
          docs.set(e.ruta, {
            datos: e.fusionar ? { ...(previo?.datos ?? {}), ...structuredClone(e.datos) } : structuredClone(e.datos),
            version: ++version,
          });
        }
        return resultado;
      }
      throw error("aborted", "Demasiados reintentos.");
    },
  };
  db.leer = (ruta) => docs.get(ruta)?.datos;
  db.rutas = () => [...docs.keys()];
  return db;
}

let reloj = 100000;
let contadorId = 0;
function montar() {
  const db = crearFirestore();
  const red = crearMotorEnRed({
    db, partidas: "partidas",
    ahora: () => reloj,
    idAleatorio: () => `id${++contadorId}`,
    marcaDeTiempo: () => "AHORA",
    error,
  });
  return { db, red };
}

const capturar = async (fn) => {
  try { return { valor: await fn() }; } catch (e) { return { error: e }; }
};

const CUATRO = ["ana", "beto", "caro", "dani"];

async function partidaEnDescarte() {
  reloj = 100000;
  const { db, red } = montar();
  await red.repartir({ codigo: "ABCDEF", jugadores: CUATRO, nombres: CUATRO });
  await red.cerrarMirada({ codigo: "ABCDEF" });
  const { ventana } = await red.abrirVentana({ codigo: "ABCDEF" });
  return { db, red, ventana };
}

// ==================================== 1. modelo de datos y secreto

console.log("\n=== 1. Modelo de datos: el estado maestro es secreto ===");
{
  const { db, red } = await partidaEnDescarte();
  const maestro = db.leer("partidas/ABCDEF");

  ok(maestro.jugadores.length === 4, "los cuatro jugadores, en orden fijo");

  // Firestore no guarda funciones. El motor lleva su fuente de azar dentro
  // del estado, así que hay que sacarla al escribir; si volviera, el primer
  // guardado en producción fallaría.
  const funciones = [];
  (function buscar(v, ruta) {
    if (typeof v === "function") return funciones.push(ruta);
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) buscar(x, `${ruta}.${k}`);
  })(maestro, "partida");
  ok(funciones.length === 0, "lo guardado no contiene funciones", funciones);
  ok(JSON.stringify(maestro).length > 0, "y es serializable entero");
  ok(maestro.estado.mazo.length === 48 - 16 - 1, "el mazo vive en el maestro", maestro.estado.mazo.length);

  for (const uid of CUATRO) {
    const vista = db.leer(`partidas/ABCDEF/vistas/${uid}`);
    ok(vista, `hay una vista propia para ${uid}`);
    ok(!("mazo" in vista), "la vista no lleva el mazo");
    ok(!("descarte" in vista), "ni la pila de descarte entera");
    const destapadas = vista.jugadores.flatMap((j) => j.mano).filter((c) => c && !c.oculta);
    ok(destapadas.length === 0, `ninguna carta destapada en la vista de ${uid}`, destapadas.length);
  }

  // La propia mano tampoco viaja: en este juego uno no ve sus cartas.
  const mia = db.leer("partidas/ABCDEF/vistas/ana");
  ok(mia.jugadores[0].mano.every((c) => c?.oculta), "ni siquiera la mano propia viaja destapada");
  ok(mia.yo === 0, "la vista dice qué jugador es");
}

// ==================================== 2. modelo de la ventana

console.log("\n=== 2. Modelo de la ventana ===");
{
  const { db, red, ventana } = await partidaEnDescarte();
  ok(typeof ventana.id === "string" && ventana.id.startsWith("v_"), "tiene identificador", ventana.id);
  ok(ventana.abiertaEn === 100000, "y hora de apertura del SERVIDOR", ventana.abiertaEn);
  ok(ventana.duracionMs === R.MS_VENTANA, "y duración", ventana.duracionMs);

  const repetida = await red.abrirVentana({ codigo: "ABCDEF" });
  ok(repetida.yaEstaba && repetida.ventana.id === ventana.id, "abrirla dos veces devuelve la misma");

  // Los intentos ajenos no se publican.
  reloj = 100500;
  await red.intentarDescarte({
    uid: "beto", codigo: "ABCDEF", windowId: ventana.id, posicion: 0,
    clientActionId: "b1", declarado: 400, latencia: 50, incertidumbre: 25,
  });
  const vistaDeAna = db.leer("partidas/ABCDEF/vistas/ana");
  ok(!("intentos" in (vistaDeAna.ventana ?? {})), "la vista no revela los intentos de los demás");
  ok(JSON.stringify(vistaDeAna).includes("beto") === false || !JSON.stringify(vistaDeAna.ventana).includes("beto"),
     "ni en qué posición tocó cada uno");
}

// ==================================== 4. validaciones server-side

console.log("\n=== 4. Validaciones del servidor ===");
{
  const { red, ventana } = await partidaEnDescarte();
  reloj = 100500;
  const base = { codigo: "ABCDEF", windowId: ventana.id, posicion: 0, declarado: 400, latencia: 50, incertidumbre: 25 };

  const ajeno = await capturar(() => red.intentarDescarte({ ...base, uid: "colado", clientActionId: "x1" }));
  ok(ajeno.error?.codigo === "permission-denied", "un jugador ajeno se rechaza", ajeno.error?.codigo);

  const otraVentana = await capturar(() => red.intentarDescarte({ ...base, uid: "ana", windowId: "v_falsa", clientActionId: "x2" }));
  ok(otraVentana.error?.codigo === "failed-precondition", "una ventana inventada se rechaza");

  const malaPos = await capturar(() => red.intentarDescarte({ ...base, uid: "ana", posicion: 77, clientActionId: "x3" }));
  ok(/posición/i.test(malaPos.error?.message ?? ""), "una posición inexistente se rechaza", malaPos.error?.message);

  const sinId = await capturar(() => red.intentarDescarte({ ...base, uid: "ana", clientActionId: "" }));
  ok(/identificador/i.test(sinId.error?.message ?? ""), "sin identificador se rechaza");

  const noExiste = await capturar(() => red.intentarDescarte({ ...base, codigo: "NADA", uid: "ana", clientActionId: "x4" }));
  ok(noExiste.error?.codigo === "not-found", "una partida inexistente se rechaza");

  // Fuera de fase: una acción de turno durante el descarte.
  const fueraDeFase = await capturar(() => red.accionDeTurno({
    uid: "ana", codigo: "ABCDEF", accion: "levantar", clientActionId: "t1",
  }));
  ok(/descarte/.test(fueraDeFase.error?.message ?? ""), "una acción de otra fase se rechaza", fueraDeFase.error?.message);
}

console.log("\n=== 4b. Sólo juega quien tiene el turno ===");
{
  const { db, red, ventana } = await partidaEnDescarte();
  reloj = 108000;
  await red.cerrarVentana({ codigo: "ABCDEF" });
  const enTurno = db.leer("partidas/ABCDEF").estado.indiceTurno;
  const otro = CUATRO[(enTurno + 1) % 4];

  const intruso = await capturar(() => red.accionDeTurno({
    uid: otro, codigo: "ABCDEF", accion: "levantar", clientActionId: "t9",
  }));
  ok(/No es tu turno/.test(intruso.error?.message ?? ""), "otro jugador no puede levantar", intruso.error?.message);

  const suyo = await capturar(() => red.accionDeTurno({
    uid: CUATRO[enTurno], codigo: "ABCDEF", accion: "levantar", clientActionId: "t10",
  }));
  ok(suyo.valor?.fase === "levantada", "el que tiene el turno sí", suyo.valor ?? suyo.error?.message);
}

// ==================================== 7. idempotencia extremo a extremo

console.log("\n=== 7b. Idempotencia contra el servidor ===");
{
  const { db, red, ventana } = await partidaEnDescarte();
  reloj = 100500;
  const accion = {
    uid: "ana", codigo: "ABCDEF", windowId: ventana.id, posicion: 1,
    clientActionId: "unica", declarado: 400, latencia: 50, incertidumbre: 25,
  };
  const a = await red.intentarDescarte(accion);
  reloj = 101200;
  const b = await red.intentarDescarte({ ...accion, posicion: 3, declarado: 10 });

  ok(a.duplicado === false && b.duplicado === true, "la segunda se reconoce como duplicada");
  const intentos = db.leer("partidas/ABCDEF").ventana.intentos;
  ok(Object.keys(intentos).length === 1, "hay un solo intento anotado", Object.keys(intentos));
  ok(intentos.unica.posicion === 1, "y conserva la posición original", intentos.unica.posicion);
}

console.log("\n=== 7c. Idempotencia de las acciones de turno ===");
{
  const { db, red } = await partidaEnDescarte();
  reloj = 108000;
  await red.cerrarVentana({ codigo: "ABCDEF" });
  const enTurno = CUATRO[db.leer("partidas/ABCDEF").estado.indiceTurno];

  const a = await red.accionDeTurno({ uid: enTurno, codigo: "ABCDEF", accion: "levantar", clientActionId: "L1" });
  const cartasTrasUna = db.leer("partidas/ABCDEF").estado.mazo.length;
  const b = await red.accionDeTurno({ uid: enTurno, codigo: "ABCDEF", accion: "levantar", clientActionId: "L1" });

  ok(a.duplicado === false && b.duplicado === true, "el doble clic no levanta dos veces");
  ok(db.leer("partidas/ABCDEF").estado.mazo.length === cartasTrasUna, "el mazo no bajó dos cartas");
}

// ==================================== 10. concurrencia

console.log("\n=== 10. Concurrencia ===");
{
  // Los cuatro intentan descartar a la vez.
  const { db, red, ventana } = await partidaEnDescarte();
  reloj = 100600;
  const resultados = await Promise.all(CUATRO.map((uid, i) =>
    capturar(() => red.intentarDescarte({
      uid, codigo: "ABCDEF", windowId: ventana.id, posicion: i % 4,
      clientActionId: `sim_${uid}`, declarado: 500 + i, latencia: 50, incertidumbre: 25,
    }))));

  const anotados = resultados.filter((r) => r.valor?.anotado).length;
  ok(anotados === 4, "los cuatro intentos quedan anotados", { anotados, errores: resultados.filter(r=>r.error).map(r=>r.error.message) });
  ok(Object.keys(db.leer("partidas/ABCDEF").ventana.intentos).length === 4,
     "sin perder ninguno por pisarse", Object.keys(db.leer("partidas/ABCDEF").ventana.intentos));
}
{
  // Los cuatro piden cerrar la ventana a la vez. Sólo una resuelve.
  const { db, red, ventana } = await partidaEnDescarte();
  reloj = 100600;
  for (const [i, uid] of CUATRO.entries()) {
    await red.intentarDescarte({
      uid, codigo: "ABCDEF", windowId: ventana.id, posicion: 0,
      clientActionId: `c_${uid}`, declarado: 300 + i * 400, latencia: 50, incertidumbre: 25,
    });
  }
  reloj = 108000;
  const cierres = await Promise.all(CUATRO.map(() => capturar(() => red.cerrarVentana({ codigo: "ABCDEF" }))));

  const resolvieron = cierres.filter((c) => c.valor && !c.valor.yaEstaba);
  const repetidos = cierres.filter((c) => c.valor?.yaEstaba);
  ok(resolvieron.length === 1, "una sola ejecución resuelve la ventana", resolvieron.length);
  ok(repetidos.length === 3, "las otras tres se encuentran con que ya estaba", repetidos.length);
  ok(db.leer("partidas/ABCDEF").ventana.cerrada === true, "la ventana queda cerrada");
  ok(db.leer("partidas/ABCDEF").estado.fase === "turno", "y la partida avanza a los turnos");

  // Se resolvió por reacción declarada, no por orden de llegada.
  const orden = resolvieron[0].valor.orden.map((o) => o.uid);
  ok(orden[0] === "ana", "el de menor tiempo efectivo va primero", orden);
  const primeros = resolvieron[0].valor.orden.filter((o) => o.resultado === "primero");
  ok(primeros.length <= 1, "a lo sumo uno se salva", primeros.length);
}
{
  // Cerrar antes de tiempo no se permite: si no, cualquiera cortaría la
  // ventana en cuanto le conviene, en el momento en que ya descartó.
  const { red } = await partidaEnDescarte();
  reloj = 101000;
  const temprano = await capturar(() => red.cerrarVentana({ codigo: "ABCDEF" }));
  ok(/todavía no terminó/.test(temprano.error?.message ?? ""), "no se puede cerrar antes de tiempo", temprano.error?.message);
}

// ==================================== 8. desconexiones

console.log("\n=== 8. Desconexiones ===");
{
  const { db, red } = await partidaEnDescarte();
  reloj = 108000;
  await red.cerrarVentana({ codigo: "ABCDEF" });
  const enTurno = CUATRO[db.leer("partidas/ABCDEF").estado.indiceTurno];
  const otro = CUATRO.find((u) => u !== enTurno);

  // Todos siguen dando señales: no se puede saltear a nadie.
  reloj = 108100;
  await Promise.all(CUATRO.map((uid) => red.latir({ uid, codigo: "ABCDEF" })));
  const vivo = await capturar(() => red.saltarAusente({ codigo: "ABCDEF" }));
  ok(/sigue conectado/.test(vivo.error?.message ?? ""),
     "no se puede saltear al que está pensando", vivo.error?.message);

  // Pasa el tiempo sin señales del que tiene el turno; los demás sí laten.
  reloj = 130000;
  await red.latir({ uid: otro, codigo: "ABCDEF" });
  ok(db.leer("partidas/ABCDEF").ausentes.includes(enTurno), "se lo marca ausente");

  const saltado = await capturar(() => red.saltarAusente({ codigo: "ABCDEF" }));
  ok(saltado.valor?.salteado === enTurno, "se le salta el turno", saltado.valor ?? saltado.error?.message);
  ok(db.leer("partidas/ABCDEF").estado.indiceTurno !== CUATRO.indexOf(enTurno), "y le toca a otro");

  // Caerse NO cuesta Leyendas ni echa a nadie.
  ok(!db.leer("partidas/ABCDEF").abandonaron.includes(enTurno),
     "desconectarse no cuenta como abandono");
  ok(!db.leer("partidas/ABCDEF").estado.jugadores[CUATRO.indexOf(enTurno)].eliminado,
     "ni lo elimina: si vuelve, sigue jugando");
}

// ==================================== 9. abandono

console.log("\n=== 9. Jugador que abandona ===");
{
  const { db, red, ventana } = await partidaEnDescarte();
  reloj = 108000;
  await red.cerrarVentana({ codigo: "ABCDEF" });
  const enTurno = CUATRO[db.leer("partidas/ABCDEF").estado.indiceTurno];

  const r = await red.marcarAbandono({ codigo: "ABCDEF", uid: enTurno });
  const partida = db.leer("partidas/ABCDEF");
  ok(r.yaEstaba === false, "se marca el abandono");
  ok(partida.abandonaron.includes(enTurno), "queda anotado");
  ok(partida.jugadores.includes(enTurno), "sigue en la lista de jugadores: su entrada quedó en el pozo");
  ok(partida.estado.jugadores[CUATRO.indexOf(enTurno)].eliminado === true, "el motor lo saltea");
  ok(partida.estado.indiceTurno !== CUATRO.indexOf(enTurno), "el turno pasa al siguiente");

  const otraVez = await red.marcarAbandono({ codigo: "ABCDEF", uid: enTurno });
  ok(otraVez.yaEstaba === true, "marcarlo dos veces es idempotente");

  const juega = await capturar(() => red.accionDeTurno({
    uid: enTurno, codigo: "ABCDEF", accion: "levantar", clientActionId: "z1",
  }));
  ok(/Abandonaste/.test(juega.error?.message ?? ""), "el que abandonó ya no puede jugar", juega.error?.message);

  // Y no puede seguir descartando en ventanas futuras.
  ok(partida.estado.jugadores[CUATRO.indexOf(enTurno)].abandono === true, "queda distinguible de un eliminado por puntos");
}

// ==================================== las reglas de Firestore que faltan

console.log("\n=== Lo que las reglas de Firestore tienen que negar ===");
{
  const reglas = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  const seccion = reglas.slice(reglas.indexOf("match /partidas"));
  ok(/match \/partidas\/\{[^}]*\}\s*\{\s*allow read: if false;/.test(seccion),
     "el estado completo de una partida no lo lee NADIE");
  ok(/match \/vistas\/\{uid\}\s*\{[\s\S]{0,140}?allow read: if esDuenio\(uid\);/.test(seccion),
     "cada jugador lee solo su propia vista");
  ok(/match \/vistas\/\{uid\}\s*\{[\s\S]{0,220}?allow write: if false;/.test(seccion),
     "y no la puede escribir");
  ok(/match \/\{resto=\*\*\}\s*\{\s*allow read, write: if false;/.test(seccion),
     "cualquier subcoleccion futura queda negada por omision");
}

// ================================ El estado persistente es JSON puro

console.log("\n=== Estado persistente: JSON y nada más ===");

/** Devuelve la lista de cosas que no sobrevivirían un viaje a Firestore. */
function noSerializable(valor, ruta = "estado", visto = new Set()) {
  const malos = [];
  if (typeof valor === "function") return [`${ruta} es una función`];
  if (typeof valor === "symbol") return [`${ruta} es un symbol`];
  if (typeof valor === "bigint") return [`${ruta} es un bigint`];
  if (valor === null || typeof valor !== "object") return malos;
  if (visto.has(valor)) return [`${ruta} es una referencia circular`];
  visto.add(valor);
  if (valor instanceof Map || valor instanceof Set) return [`${ruta} es un ${valor.constructor.name}`];
  if (valor instanceof Date) return [`${ruta} es un Date`];
  if (!Array.isArray(valor) && Object.getPrototypeOf(valor) !== Object.prototype) {
    return [`${ruta} es una instancia de ${valor.constructor?.name ?? "una clase"}`];
  }
  for (const [k, v] of Object.entries(valor)) malos.push(...noSerializable(v, `${ruta}.${k}`, visto));
  return malos;
}

{
  const estado = motor.empezarRonda(motor.crearPartida(
    [{ id: "ana", nombre: "Ana" }, { id: "beto", nombre: "Beto" },
     { id: "caro", nombre: "Caro" }, { id: "dani", nombre: "Dani" }],
    { semilla: 12345 },
  ));

  ok(noSerializable(estado).length === 0, "el estado recién creado es JSON puro", noSerializable(estado));
  ok(typeof estado.semilla === "number", "el azar es un número, no una función", typeof estado.semilla);
  ok(!("rng" in estado), "no queda ninguna función de azar dentro del estado");

  // La prueba que pediste: ida y vuelta por JSON, y el motor sigue jugando.
  const copia = JSON.parse(JSON.stringify(estado));
  ok(JSON.stringify(copia) === JSON.stringify(estado), "sobrevive el viaje sin perder nada");

  // Y sobre la COPIA, no sobre el original, se juega una ronda entera.
  let g = copia;
  let pasos = 0;
  const antesDelMazo = g.mazo.length;
  g = motor.terminarMirada(g);
  ok(g.fase === "descarte", "sobre la copia se puede cerrar la mirada", g.fase);
  g = motor.cerrarVentanaDescarte(g);
  g = motor.levantar(g);
  ok(g.fase === "levantada" && g.levantada, "y levantar del mazo", g.fase);
  ok(g.mazo.length === antesDelMazo - 1, "el mazo baja una carta");
  g = motor.tirarCarta(g);
  g = motor.pasarTurno(g);
  ok(g.fase === "turno", "y pasar el turno", g.fase);

  // Rellenar el mazo usa el azar: es donde una función perdida reventaría.
  const casiVacio = {
    ...g,
    mazo: [],
    descarte: [g.descarte[0], ...Array.from({ length: 6 }, (_, i) => ({
      id: `X-${i}`, palo: "Copa", numero: (i % 12) + 1, puntos: i,
    }))],
  };
  const rellenado = motor.levantar(JSON.parse(JSON.stringify(casiVacio)));
  ok(rellenado.mazo.length > 0 || rellenado.levantada,
     "el mazo se recicla después del viaje por JSON, que es donde reventaría una función perdida");
  ok(noSerializable(rellenado).length === 0, "y lo que sale sigue siendo JSON puro", noSerializable(rellenado));

  // La semilla avanza: dos barajadas seguidas no dan el mismo mazo.
  const r1 = motor.empezarRonda({ ...estado, fase: "finRonda" });
  const r2 = motor.empezarRonda({ ...r1, fase: "finRonda" });
  ok(r1.semilla !== estado.semilla, "la semilla avanza al barajar");
  ok(JSON.stringify(r1.mazo) !== JSON.stringify(r2.mazo), "y dos rondas no reparten igual");

  // Misma semilla, mismo reparto: la partida es reproducible.
  const uno = motor.empezarRonda(motor.crearPartida([{ id: "a", nombre: "a" }, { id: "b", nombre: "b" }], { semilla: 99 }));
  const otro = motor.empezarRonda(motor.crearPartida([{ id: "a", nombre: "a" }, { id: "b", nombre: "b" }], { semilla: 99 }));
  ok(JSON.stringify(uno.mazo) === JSON.stringify(otro.mazo),
     "con la misma semilla el reparto es idéntico: la partida se puede reproducir");
}

{
  // Y lo que efectivamente se guarda en Firestore, también.
  const { db } = await partidaEnDescarte();
  const guardado = db.leer("partidas/ABCDEF");
  ok(noSerializable(guardado, "partida").length === 0,
     "el documento guardado no tiene nada no serializable", noSerializable(guardado, "partida"));

  const ida = JSON.parse(JSON.stringify(guardado));
  ok(JSON.stringify(ida) === JSON.stringify(guardado), "y sobrevive el viaje entero");

  // Falla a propósito si alguien vuelve a meter una función en el estado.
  const contaminado = { ...guardado.estado, rng: () => 0.5 };
  ok(noSerializable(contaminado).length === 1,
     "la prueba detecta una función metida en el estado", noSerializable(contaminado));
  ok(noSerializable({ ...guardado.estado, vistas: new Map() }).length === 1,
     "y también un Map");
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
