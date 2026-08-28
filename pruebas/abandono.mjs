/**
 * Fase 7 — abandono de partida.
 *
 * Estas pruebas corren la Cloud Function DE VERDAD (`functions/abandono.js`
 * y `functions/leyendas.js`), contra un Firestore de mentira que imita lo
 * único que importa acá: que una transacción aborte si alguien tocó, mientras
 * tanto, un documento que ella había leído. Sin eso, probar la idempotencia
 * sería teatro.
 */

import io from "node:fs";
import { crearMoverLeyendas } from "../functions/leyendas.js";
import { crearAbandonarPartida } from "../functions/abandono.js";
import { ESTADOS_SALA, MODOS } from "../public/js/reglas/salas.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

// ===================================================== Firestore de mentira

class ErrorFalso extends Error {
  constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; }
}
const error = (codigo, mensaje) => new ErrorFalso(codigo, mensaje);

/**
 * Guarda documentos con un número de versión. Una transacción anota qué
 * versiones leyó; al confirmar, si alguna cambió, se descarta y se reintenta.
 * Es el comportamiento que hace que dos ejecuciones simultáneas no puedan
 * cobrar las dos.
 */
function crearFirestore(inicial = {}) {
  const docs = new Map();
  let version = 0;
  for (const [ruta, datos] of Object.entries(inicial)) {
    docs.set(ruta, { datos: structuredClone(datos), version: ++version });
  }

  const db = {
    intentos: 0,
    /** Se llama después de cada lectura; sirve para forzar entrelazados. */
    ganchoTrasLeer: null,

    collection: (nombre) => ({
      doc: (id = `auto_${Math.random().toString(36).slice(2)}`) => ({
        ruta: `${nombre}/${id}`,
      }),
    }),

    async runTransaction(cuerpo) {
      for (let intento = 0; intento < 6; intento++) {
        db.intentos++;
        const leidas = new Map();
        const escrituras = [];

        const tx = {
          async get(ref) {
            const d = docs.get(ref.ruta);
            leidas.set(ref.ruta, d ? d.version : 0);
            if (db.ganchoTrasLeer) await db.ganchoTrasLeer(ref.ruta);
            return {
              exists: Boolean(d),
              data: () => (d ? structuredClone(d.datos) : undefined),
            };
          },
          set(ref, datos, opciones) {
            escrituras.push({ ruta: ref.ruta, datos, fusionar: Boolean(opciones?.merge) });
          },
          update(ref, datos) {
            escrituras.push({ ruta: ref.ruta, datos, fusionar: true, exigeExistir: true });
          },
        };

        const resultado = await cuerpo(tx);

        // ¿Cambió algo de lo que leí mientras tanto?
        const chocó = [...leidas].some(([ruta, v]) => (docs.get(ruta)?.version ?? 0) !== v);
        if (chocó) continue;

        for (const e of escrituras) {
          const previo = docs.get(e.ruta);
          if (e.exigeExistir && !previo) throw error("not-found", `No existe ${e.ruta}`);
          docs.set(e.ruta, {
            datos: e.fusionar
              ? { ...(previo?.datos ?? {}), ...structuredClone(e.datos) }
              : structuredClone(e.datos),
            version: ++version,
          });
        }
        return resultado;
      }
      throw error("aborted", "Demasiados reintentos.");
    },
  };

  db.leer = (ruta) => docs.get(ruta)?.datos;
  db.existe = (ruta) => docs.has(ruta);
  db.rutas = () => [...docs.keys()];
  return db;
}

// ===================================================== montaje del sistema

const MOTIVO = "penalizacion_abandono";

function montar(inicial) {
  const db = crearFirestore(inicial);
  const moverLeyendas = crearMoverLeyendas({
    db, usuarios: "users", campoSaldo: "credits",
    marcaDeTiempo: () => "AHORA", error,
  });
  const abandonarPartida = crearAbandonarPartida({
    db, salas: "rooms", moverLeyendas, motivo: MOTIVO,
    marcaDeTiempo: () => "AHORA", error, estados: ESTADOS_SALA,
  });
  return { db, abandonarPartida, moverLeyendas };
}

const salaJugando = (extra = {}) => ({
  codigo: "ABCDEF",
  modo: MODOS.LEYENDAS,
  estado: ESTADOS_SALA.JUGANDO,
  entrada: 100,
  jugadores: ["ana", "beto", "caro", "dani"],
  pozo: 400,
  ...extra,
});

const escenario = (sala = {}, saldos = { ana: 500, beto: 500, caro: 500, dani: 500 }) => {
  const inicial = { "rooms/ABCDEF": salaJugando(sala) };
  for (const [uid, credits] of Object.entries(saldos)) inicial[`users/${uid}`] = { credits };
  return montar(inicial);
};

const capturar = async (fn) => {
  try { return { valor: await fn() }; } catch (e) { return { error: e }; }
};

// ===================================================================== 1
console.log("\n=== 1. Entrenamiento contra IA: 0 Leyendas ===");
{
  // Una partida de entrenamiento no vive en `rooms`. Aun así se comprueba
  // que, si llegara a estar, esta función no le cobra nada a nadie.
  const { db, abandonarPartida } = escenario({ modo: MODOS.ENTRENAMIENTO, entrada: 0, pozo: 0 });
  const r = await capturar(() => abandonarPartida({ uid: "ana", codigo: "ABCDEF" }));
  ok(r.error?.codigo === "failed-precondition", "se rechaza en vez de cobrar", r.error?.codigo);
  ok(db.leer("users/ana").credits === 500, "el saldo queda intacto", db.leer("users/ana").credits);
  ok(!db.rutas().some((p) => p.startsWith("movimientos/")), "no se escribe ningún asiento");
}

// ================================================================= 2 a 5
console.log("\n=== 2-5. Penalización por entrada, calculada server-side ===");
for (const [entrada, esperada] of [[5, 2], [10, 5], [15, 7], [20, 10], [25, 12], [50, 25], [100, 50], [200, 100], [500, 250]]) {
  const { db, abandonarPartida } = escenario({ entrada, pozo: entrada * 4 }, { ana: 1000 });
  const r = await capturar(() => abandonarPartida({ uid: "ana", codigo: "ABCDEF" }));
  const cobrado = 1000 - (db.leer("users/ana")?.credits ?? 0);
  ok(r.valor?.penalizacion === esperada && cobrado === esperada,
     `entrada ${entrada} → penalización ${esperada}`, {devuelto: r.valor?.penalizacion, cobrado});
}

// ===================================================================== 6-7
console.log("\n=== 6-7. El pozo no se toca ===");
{
  const { db, abandonarPartida } = escenario();
  const r = await capturar(() => abandonarPartida({ uid: "ana", codigo: "ABCDEF" }));
  const sala = db.leer("rooms/ABCDEF");
  ok(sala.pozo === 400, "4 × 100: el pozo sigue siendo 400", sala.pozo);
  ok(r.valor.penalizacion === 50, "la penalización es 50", r.valor.penalizacion);
  ok(sala.pozo === 400, "los 50 NO se sumaron al pozo", sala.pozo);
  ok(db.leer("users/ana").credits === 450, "salieron del saldo del que abandona", db.leer("users/ana").credits);

  const otros = ["beto", "caro", "dani"].map((u) => db.leer(`users/${u}`).credits);
  ok(otros.every((c) => c === 500), "y no se le dieron a ningún otro jugador", otros);

  const asiento = db.leer("movimientos/abandono_ABCDEF_ana");
  ok(asiento.delta === -50 && asiento.motivo === MOTIVO,
     "queda un asiento de sumidero, sin contraparte", {delta: asiento.delta, motivo: asiento.motivo});
  ok(sala.abandonaron.includes("ana") && sala.jugadores.includes("ana"),
     "sigue figurando entre los jugadores: su entrada quedó en el pozo");
}

// ===================================================================== 8
console.log("\n=== 8. Segundo intento de abandono ===");
{
  const { db, abandonarPartida } = escenario();
  await abandonarPartida({ uid: "ana", codigo: "ABCDEF" });
  const saldoTrasUno = db.leer("users/ana").credits;
  const r = await capturar(() => abandonarPartida({ uid: "ana", codigo: "ABCDEF" }));
  ok(r.error?.codigo === "already-exists", "se rechaza el segundo intento", r.error?.codigo);
  ok(db.leer("users/ana").credits === saldoTrasUno, "no se cobra de nuevo", db.leer("users/ana").credits);
  ok(saldoTrasUno === 450, "una sola penalización en total", saldoTrasUno);
}

// ===================================================================== 9
console.log("\n=== 9. Dos ejecuciones simultáneas ===");
{
  const { db, abandonarPartida } = escenario();

  // Se fuerza el entrelazado peor posible: la primera llamada lee la sala y
  // se queda esperando; la segunda entra entera y confirma; recién entonces
  // la primera intenta confirmar, con datos ya viejos.
  let soltar;
  const barrera = new Promise((r) => (soltar = r));
  let primeraLectura = true;

  db.ganchoTrasLeer = async (ruta) => {
    if (ruta === "rooms/ABCDEF" && primeraLectura) {
      primeraLectura = false;
      await barrera;
    }
  };

  const a = capturar(() => abandonarPartida({ uid: "ana", codigo: "ABCDEF" }));
  await new Promise((r) => setImmediate(r));
  const b = await capturar(() => abandonarPartida({ uid: "ana", codigo: "ABCDEF" }));
  soltar();
  const resA = await a;

  const resultados = [resA, b];
  const exitos = resultados.filter((r) => r.valor).length;
  const rechazos = resultados.filter((r) => r.error?.codigo === "already-exists").length;

  ok(exitos === 1, "exactamente una de las dos cobra", {exitos, rechazos});
  ok(rechazos === 1, "la otra se rechaza por duplicada", rechazos);
  ok(db.leer("users/ana").credits === 450, "una sola penalización de 50", db.leer("users/ana").credits);
  ok(db.leer("rooms/ABCDEF").abandonaron.length === 1, "y un solo abandono anotado");
  ok(db.intentos > 2, "la transacción perdedora reintentó, no pasó de largo", db.intentos);
}

// ==================================================================== 10
console.log("\n=== 10. Jugador ajeno a la partida ===");
{
  const { db, abandonarPartida } = escenario({}, { ana: 500, beto: 500, caro: 500, dani: 500, colado: 500 });
  const r = await capturar(() => abandonarPartida({ uid: "colado", codigo: "ABCDEF" }));
  ok(r.error?.codigo === "permission-denied", "se rechaza", r.error?.codigo);
  ok(db.leer("users/colado").credits === 500, "no se le cobra nada", db.leer("users/colado").credits);
  ok(!db.leer("rooms/ABCDEF").abandonaron, "no se anota nada en la partida");
}

// ==================================================================== 11
console.log("\n=== 11. Partida ya finalizada ===");
for (const estado of [ESTADOS_SALA.TERMINADA, ESTADOS_SALA.CANCELADA]) {
  const { db, abandonarPartida } = escenario({ estado });
  const r = await capturar(() => abandonarPartida({ uid: "ana", codigo: "ABCDEF" }));
  ok(r.error?.codigo === "failed-precondition", `estado "${estado}" se rechaza`, r.error?.codigo);
  ok(db.leer("users/ana").credits === 500, "sin cobro");
}
{
  const { abandonarPartida } = escenario({ estado: ESTADOS_SALA.ESPERANDO });
  const r = await capturar(() => abandonarPartida({ uid: "ana", codigo: "ABCDEF" }));
  ok(/todavía no empezó/.test(r.error?.message ?? ""), "y si no empezó, se lo manda a salir sin costo");
}
{
  const { abandonarPartida } = escenario();
  const r = await capturar(() => abandonarPartida({ uid: "ana", codigo: "NOEXIS" }));
  ok(r.error?.codigo === "not-found", "una partida inexistente también se rechaza", r.error?.codigo);
}

// ==================================================================== 12
console.log("\n=== 12. Saldo insuficiente ===");
{
  const { db, abandonarPartida } = escenario({}, { ana: 30, beto: 500, caro: 500, dani: 500 });
  const r = await capturar(() => abandonarPartida({ uid: "ana", codigo: "ABCDEF" }));
  ok(r.error?.codigo === "failed-precondition", "se rechaza", r.error?.codigo);
  ok(/insuficiente/i.test(r.error?.message ?? ""), "el mensaje lo explica", r.error?.message);
  ok(db.leer("users/ana").credits === 30, "el saldo no queda en negativo ni se toca", db.leer("users/ana").credits);
  ok(!db.existe("movimientos/abandono_ABCDEF_ana"), "y no queda asiento a medias");
  ok(!db.leer("rooms/ABCDEF").abandonaron, "ni abandono anotado: la transacción entera se descarta");
}

// ==================================================================== 13
console.log("\n=== 13. El cliente manda cifras manipuladas ===");
{
  const { db, abandonarPartida } = escenario({ entrada: 100, pozo: 400 }, { ana: 1000 });
  const r = await capturar(() => abandonarPartida({
    uid: "ana",
    codigo: "ABCDEF",
    // Todo esto es lo que mandaría alguien retocando la llamada:
    penalizacion: 0,
    entrada: 1,
    delta: 999,
    pozo: 999999,
    modo: MODOS.ENTRENAMIENTO,
    credits: 1000000,
  }));
  ok(r.valor?.penalizacion === 50, "la penalización sale de la entrada real, no de la enviada", r.valor?.penalizacion);
  ok(db.leer("users/ana").credits === 950, "se cobran 50, no 0 ni 999", db.leer("users/ana").credits);
  ok(db.leer("rooms/ABCDEF").pozo === 400, "el pozo enviado se ignora", db.leer("rooms/ABCDEF").pozo);
  ok(db.leer("rooms/ABCDEF").modo === MODOS.LEYENDAS, "el modo enviado se ignora");
}
{
  // Una entrada fuera de la lista en el propio documento tampoco cobra.
  const { db, abandonarPartida } = escenario({ entrada: 7777, pozo: 31108 }, { ana: 100000 });
  const r = await capturar(() => abandonarPartida({ uid: "ana", codigo: "ABCDEF" }));
  ok(r.error?.codigo === "failed-precondition", "entrada fuera de la lista: se rechaza", r.error?.codigo);
  ok(db.leer("users/ana").credits === 100000, "sin cobro");
}

// ==================================================================== 14
console.log("\n=== 14. El cliente no puede tocar `credits` ===");
{
  // Esto lo decide Firestore, no la función. Se comprueba sobre el archivo
  // de reglas: es una comprobación estática, no un emulador.
  const reglas = io.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  const permitidos = reglas.match(/hasOnly\(\[([^\]]*)\]\)/)?.[1] ?? "";
  ok(permitidos.length > 0, "las reglas restringen los campos que el jugador puede escribir", permitidos.trim());
  ok(!/credits/.test(permitidos), "`credits` NO está entre los campos permitidos", permitidos.trim());
  ok(/allow delete: if false/.test(reglas), "el perfil no se puede borrar");
  ok(/match \/movimientos\/\{id\}[\s\S]*?allow write: if false/.test(reglas),
     "el libro mayor es de sólo lectura para el cliente");
  ok(/match \/rooms\/\{salaId\}[\s\S]*?allow write: if false/.test(reglas),
     "las salas son de sólo lectura para el cliente");
}

// ================================================= la única vía económica
console.log("\n=== El saldo se mueve por un solo lugar ===");
{
  const index = io.readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  const abandono = io.readFileSync(new URL("../functions/abandono.js", import.meta.url), "utf8");
  // Escribir el saldo es usarlo como CLAVE de un objeto: `[CAMPO_SALDO]:` o
  // `credits:`. Leerlo —`data()[CAMPO_SALDO]`— es legítimo y no cuenta.
  const escrituras = [...index.matchAll(/\[CAMPO_SALDO\]\s*:|credits\s*:/g)].map((m) => m[0]);
  ok(escrituras.length === 0, "index.js ya no escribe el campo del saldo por su cuenta", escrituras);
  const lecturas = [...index.matchAll(/data\(\)\[CAMPO_SALDO\]/g)].length;
  ok(lecturas > 0, "sí lo lee, que es otra cosa", lecturas);
  ok(!/credits/.test(abandono), "abandono.js no menciona el campo del saldo: pasa por moverLeyendas");
  ok(/moverLeyendas/.test(abandono), "y lo usa");
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
