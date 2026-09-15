/**
 * Pone el saldo de una cuenta ADMINISTRADORA en un valor exacto.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PARA QUÉ EXISTE, Y POR QUÉ SÓLO ADMINISTRADORES
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Para preparar cuentas de prueba antes de abrir la compra: darse Leyendas
 * compradas sin pagar, para poder comprobar que un torneo las rechaza.
 *
 * Un ajuste es la única forma de mover saldo que no responde a nada que haya
 * pasado en el juego. Eso lo vuelve la herramienta más peligrosa del proyecto:
 * crea moneda de la nada, y si alguna vez apunta a la cuenta equivocada, lo
 * que queda es un jugador con Leyendas que nadie ganó ni pagó.
 *
 * Por eso el cerrojo NO es una advertencia ni una confirmación: es una
 * comprobación contra el mismo padrón que usa el servidor. Si el objetivo no
 * puede administrar, la herramienta se detiene antes de calcular nada.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ CUENTA COMO ADMINISTRADOR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Lo mismo que para `puedeAdministrar` en el servidor: la cuenta RAÍZ
 * —cableada en `functions/index.js`— o cualquiera en la colección
 * `administradores` con `activo !== false`.
 *
 * No alcanza con mirar la colección. La cuenta raíz no está adentro: está
 * escrita en el código, y es justamente la que uno quiere ajustar. Un cerrojo
 * que sólo mirara la colección rechazaría al único administrador que siempre
 * existe.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ PASA POR `moverLeyendas` Y NO ESCRIBE EL SALDO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque escribir `credits` a mano es exactamente lo que el proyecto entero
 * está construido para impedir. `moverLeyendas` es la única puerta: mantiene
 * los dos bolsillos y el espejo cuadrados, deja asiento de cada movimiento, y
 * respeta la tabla que dice qué bolsillo toca cada motivo.
 *
 * Una herramienta que se saltara esa puerta tendría su propia copia de la
 * aritmética del dinero, y sería la copia que nadie mantiene.
 *
 * El ajuste se expresa como DOS movimientos —uno por bolsillo— porque el
 * bolsillo se deriva del motivo. Los deltas salen de restar lo que hay de lo
 * que se pide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * USO
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   node herramientas/ajustar-leyendas.mjs --email alguien@ejemplo.com --ganadas 100 --compradas 0
 *   node herramientas/ajustar-leyendas.mjs --uid AbC123 --ganadas 100 --compradas 500 --escribir
 *
 * Los valores son ABSOLUTOS, no deltas: `--ganadas 100` deja 100 ganadas,
 * sumen o resten. Dry-run por defecto.
 */

import { pathToFileURL } from "node:url";

import { MOTIVOS } from "../public/js/reglas/economia.js";
import { crearMoverLeyendas } from "../functions/leyendas.js";

const PROYECTO = "memorie-legends";
const USUARIOS = "users";
const ADMINISTRADORES = "administradores";

/** El administrador raíz, igual que `CORREO_ADMIN` en functions/index.js. */
const CORREO_RAIZ = "soporte.memorie.legends@gmail.com";

const normalizar = (c) => String(c ?? "").trim().toLowerCase();

function argumento(nombre) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const numero = (nombre) => {
  const crudo = argumento(nombre);
  if (crudo === null) return null;
  const n = Number(crudo);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Qué habría que mover para llegar a los saldos pedidos.
 *
 * Pura: no lee ni escribe nada. Está separada para poder interrogarla sin
 * Firestore, que es lo mínimo que merece la única herramienta capaz de crear
 * Leyendas de la nada.
 *
 * @param {{comprado: number, ganado: number}} actual
 * @param {{comprado: number|null, ganado: number|null}} pedido  null = no tocar
 */
export function planDeAjuste(actual, pedido) {
  const problemas = [];

  const comprado = pedido.comprado ?? actual.comprado;
  const ganado = pedido.ganado ?? actual.ganado;

  for (const [nombre, valor] of [["compradas", comprado], ["ganadas", ganado]]) {
    if (!Number.isFinite(valor)) problemas.push(`${nombre}: no es un número`);
    else if (!Number.isInteger(valor)) problemas.push(`${nombre}: tiene decimales (${valor})`);
    else if (valor < 0) problemas.push(`${nombre}: es negativo (${valor})`);
  }

  if (problemas.length) return { problemas, cambia: false };

  const antes = { comprado: actual.comprado, ganado: actual.ganado };
  const despues = { comprado, ganado };

  /**
   * El total NO se valida acá, y no es un olvido.
   *
   * Acá había un `if (total !== comprado + ganado)` con `total` definido dos
   * líneas antes como esa misma suma: una guarda que no podía fallar nunca y
   * que, leída rápido, parecía estar cuidando el espejo.
   *
   * El espejo no se puede descuadrar por este camino porque no hay un total
   * que alguien pueda pedir: se pide cada bolsillo y la suma sale de ellos.
   * Quien lo mantiene cuadrado en el documento es `moverLeyendas`, que escribe
   * los tres campos en la misma transacción, y eso está probado en
   * `saldos-separados.mjs`. El CLI además lo vuelve a mirar después de
   * escribir, que es donde un descuadre sí podría aparecer.
   */
  const total = despues.comprado + despues.ganado;

  const movimientos = [];
  const dComprado = despues.comprado - antes.comprado;
  const dGanado = despues.ganado - antes.ganado;

  if (dComprado !== 0) {
    movimientos.push({ motivo: MOTIVOS.AJUSTE_ADMIN_COMPRADO, delta: dComprado });
  }
  if (dGanado !== 0) {
    movimientos.push({ motivo: MOTIVOS.AJUSTE_ADMIN_GANADO, delta: dGanado });
  }

  return {
    problemas: [],
    cambia: movimientos.length > 0,
    antes,
    despues,
    total,
    movimientos,
  };
}

/** ¿Este correo puede administrar? Mismo criterio que el servidor. */
export async function esAdministrador(db, correo) {
  const c = normalizar(correo);
  if (!c) return false;
  if (c === normalizar(CORREO_RAIZ)) return true;

  const doc = await db.collection(ADMINISTRADORES).doc(c).get();
  return doc.exists && doc.data()?.activo !== false;
}

// =====================================================================

async function principal() {
  const escribir = process.argv.includes("--escribir");
  const email = argumento("email");
  let uid = argumento("uid");

  const pedido = { comprado: numero("compradas"), ganado: numero("ganadas") };

  if ((!email && !uid) || (pedido.comprado === null && pedido.ganado === null)) {
    console.error("\nUso:\n");
    console.error("  node herramientas/ajustar-leyendas.mjs --email alguien@ejemplo.com \\");
    console.error("       --ganadas 100 --compradas 0 [--escribir]\n");
    console.error("Los valores son absolutos, no deltas. Dry-run por defecto.\n");
    process.exit(1);
  }

  const { initializeApp, applicationDefault } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { getAuth } = await import("firebase-admin/auth");

  initializeApp({ credential: applicationDefault(), projectId: PROYECTO });
  const db = getFirestore();

  // --------------------------------------------- quién es el objetivo

  const usuario = email
    ? await getAuth().getUserByEmail(email)
    : await getAuth().getUser(uid);
  uid = usuario.uid;

  console.log(`\nObjetivo: ${usuario.email} (${uid})`);

  // --------------------------------------------- el cerrojo, ANTES de todo

  if (!(await esAdministrador(db, usuario.email))) {
    console.error(
      `\n❌ Sólo se pueden ajustar cuentas admin.\n\n` +
        `   ${usuario.email} no es la cuenta raíz ni figura activa en\n` +
        `   la colección "${ADMINISTRADORES}".\n\n` +
        `   Esta herramienta crea Leyendas de la nada: fuera de una cuenta de\n` +
        `   prueba, eso es moneda que nadie ganó ni pagó.\n`,
    );
    process.exit(1);
  }
  console.log("Es administrador. ✅\n");

  // --------------------------------------------- el plan

  const perfilRef = db.collection(USUARIOS).doc(uid);
  const snap = await perfilRef.get();
  if (!snap.exists) {
    console.error(`❌ El perfil ${uid} no existe.\n`);
    process.exit(1);
  }

  const datos = snap.data();
  const compradoActual = Number(datos.creditosComprados ?? 0);
  const actual = {
    comprado: compradoActual,
    ganado: Number(
      datos.creditosGanados ?? Math.max(0, Number(datos.credits ?? 0) - compradoActual),
    ),
  };

  const plan = planDeAjuste(actual, pedido);

  if (plan.problemas.length) {
    console.error("❌ Valores inválidos:\n");
    for (const p of plan.problemas) console.error(`   ${p}`);
    console.error("");
    process.exit(1);
  }

  console.log(`   ganadas    ${String(plan.antes.ganado).padStart(7)} → ${plan.despues.ganado}`);
  console.log(`   compradas  ${String(plan.antes.comprado).padStart(7)} → ${plan.despues.comprado}`);
  console.log(`   total      ${String(plan.antes.ganado + plan.antes.comprado).padStart(7)} → ${plan.total}\n`);

  if (!plan.cambia) {
    console.log("✅ Ya está en esos valores. No hay nada que hacer.\n");
    return;
  }

  for (const m of plan.movimientos) {
    console.log(`   ${m.motivo}: ${m.delta > 0 ? "+" : ""}${m.delta}`);
  }

  if (!escribir) {
    console.log("\n🔍 Dry-run: no se escribió nada. Con --escribir se aplica.\n");
    return;
  }

  // --------------------------------------------- aplicar

  const { FieldValue } = await import("firebase-admin/firestore");

  const moverLeyendas = crearMoverLeyendas({
    db,
    usuarios: USUARIOS,
    campoSaldo: "credits",
    marcaDeTiempo: () => FieldValue.serverTimestamp(),
    error: (codigo, mensaje) => Object.assign(new Error(mensaje), { codigo }),
  });

  // Los dos movimientos en UNA transacción, con `varias`: son un solo ajuste.
  // Por separado, un corte en el medio dejaría un bolsillo movido y el otro no.
  const sello = new Date().toISOString();
  await db.runTransaction((tx) =>
    moverLeyendas.varias(
      tx,
      plan.movimientos.map((m) => ({
        uid,
        delta: m.delta,
        motivo: m.motivo,
        // Quién lo hizo y cuándo: un ajuste no responde a nada del juego, así
        // que su asiento tiene que poder explicarse solo.
        referencia: `ajuste por ${normalizar(CORREO_RAIZ)} el ${sello}`,
        idempotencia: `ajuste_${uid}_${sello}_${m.motivo}`,
      })),
    ),
  );

  const despues = (await perfilRef.get()).data();
  console.log("\n✅ Ajustado.\n");
  console.log(`   ganadas    ${despues.creditosGanados}`);
  console.log(`   compradas  ${despues.creditosComprados}`);
  console.log(`   credits    ${despues.credits}`);
  console.log(
    despues.credits === despues.creditosComprados + despues.creditosGanados
      ? "\n   El espejo cuadra.\n"
      : "\n   ⚠️  EL ESPEJO NO CUADRA. Mirar movimientos/.\n",
  );
}

/**
 * Sólo cuando se lo invoca directo.
 *
 * Rutas COMPLETAS, y no el nombre del archivo: la prueba de esta herramienta
 * se llama igual que ella, así que comparar nombres hacía que importarla
 * lanzara el CLI.
 */
const invocadoDirecto =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invocadoDirecto) {
  principal().catch((e) => {
    console.error("\n❌ No se pudo ajustar:", e.message);
    if (/could not load the default credentials/i.test(e.message)) {
      console.error("\nFalta autenticarse:\n   gcloud auth application-default login\n");
    }
    process.exit(1);
  });
}
