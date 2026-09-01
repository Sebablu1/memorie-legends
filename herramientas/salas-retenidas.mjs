/**
 * §70 — Qué salas están reteniendo Leyendas.
 *
 * SÓLO LEE. No borra, no cancela, no mueve un saldo. Esa es la mitad del
 * punto: antes de tocar una sala hay que saber cuánto hay adentro y de quién,
 * porque una entrada cobrada que se borra sin devolver es una Leyenda que el
 * jugador perdió sin jugar.
 *
 * USO
 *
 *   1. Autenticarse una vez (abre el navegador, lo hacés vos):
 *
 *        gcloud auth application-default login
 *
 *      O, si preferís una clave de cuenta de servicio:
 *
 *        set GOOGLE_APPLICATION_CREDENTIALS=C:\ruta\a\la\clave.json
 *
 *   2. node herramientas/salas-retenidas.mjs
 *
 * SALIDA
 *
 *   Un listado por estado, con el pozo retenido y qué correspondería hacer
 *   según §70: las `waiting` se pueden cancelar con devolución; las `playing`
 *   sólo se informan.
 */

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const admin = require("../functions/node_modules/firebase-admin");

const PROYECTO = "memorie-legends";

try {
  admin.initializeApp({ projectId: PROYECTO });
} catch (e) {
  console.error("No se pudo inicializar el Admin SDK:", e.message);
  process.exit(1);
}

const db = admin.firestore();

const dinero = (n) => String(n ?? 0).padStart(6);
const fecha = (t) => {
  if (!t) return "sin fecha";
  const d = t.toDate ? t.toDate() : new Date(t);
  return d.toISOString().replace("T", " ").slice(0, 16);
};

let salas;
try {
  salas = await db.collection("rooms").get();
} catch (e) {
  console.error("\nNo se pudo leer `rooms`:", e.message);
  console.error("\nProbablemente falten credenciales. Ejecutá:");
  console.error("  gcloud auth application-default login\n");
  process.exit(1);
}

if (salas.empty) {
  console.log("\nNo hay ninguna sala. Nada que limpiar.\n");
  process.exit(0);
}

const porEstado = new Map();
for (const doc of salas.docs) {
  const s = doc.data();
  const estado = s.estado ?? s.state ?? "(sin estado)";
  if (!porEstado.has(estado)) porEstado.set(estado, []);
  porEstado.get(estado).push({ id: doc.id, ...s });
}

let retenidoTotal = 0;
const ACCION = {
  waiting: "cancelable con devolución (§70)",
  esperando: "cancelable con devolución (§70)",
  ready: "cancelable con devolución (§70)",
  playing: "NO tocar: informar primero (§70)",
  finished: "cerrada: no retiene nada",
  cancelled: "cancelada: no retiene nada",
};

console.log(`\n${salas.size} salas en ${PROYECTO}\n`);

for (const [estado, lista] of [...porEstado].sort()) {
  const retiene = !["finished", "cancelled"].includes(estado);
  console.log(`\n── ${estado.toUpperCase()} (${lista.length}) — ${ACCION[estado] ?? "estado desconocido: revisar a mano"}`);
  for (const s of lista) {
    const jugadores = (s.jugadores ?? []).length;
    const pozo = Number(s.pozo ?? 0);
    const entrada = Number(s.entrada ?? 0);
    if (retiene) retenidoTotal += pozo;
    console.log(
      `   ${s.id.padEnd(8)} entrada ${dinero(entrada)}  pozo ${dinero(pozo)}  ` +
        `${jugadores} jugador(es)  creada ${fecha(s.createdAt)}` +
        (s.abandonados?.length ? `  · abandonaron ${s.abandonados.length}` : ""),
    );
    if (retiene && jugadores > 0) {
      console.log(`            jugadores: ${(s.jugadores ?? []).join(", ")}`);
    }
  }
}

// Partidas en curso que ya no deberían estarlo.
const partidas = await db.collection("partidas").get();
const colgadas = partidas.docs
  .map((d) => ({ id: d.id, ...d.data() }))
  .filter((p) => !p.cerrada && p.estado?.fase);

console.log(`\n\n── PARTIDAS SIN CERRAR (${colgadas.length})`);
for (const p of colgadas) {
  console.log(
    `   ${p.id.padEnd(8)} fase ${String(p.estado.fase).padEnd(14)} ronda ${p.estado.ronda ?? "?"}  ` +
      `última escritura ${fecha(p.actualizado)}`,
  );
}

console.log(`\n\nLEYENDAS RETENIDAS EN SALAS NO CERRADAS: ${retenidoTotal}`);
console.log("\nEste script no modificó nada. Para devolver o cancelar hace falta");
console.log("una decisión explícita y `moverLeyendas.varias`, que es la única vía\n" +
            "autorizada para tocar saldos (§51).\n");

process.exit(0);
