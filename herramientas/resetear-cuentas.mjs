/**
 * Devuelve las cuentas reales al estado de registro.
 *
 *   node herramientas/resetear-cuentas.mjs                 en seco: sólo muestra
 *   node herramientas/resetear-cuentas.mjs --aplicar --respaldo <archivo.json>
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ HACE, Y QUÉ NO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Toca SÓLO los perfiles que tienen cuenta en Authentication, menos los dos
 * de la lista de excluidos. Un perfil sin cuenta detrás no se resetea: ése es
 * asunto de `borrar-perfiles-huerfanos.mjs`, y mezclar las dos cosas en una
 * herramienta hace que un error de criterio en una arrastre a la otra.
 *
 * El saldo vuelve a `saldoDeRegistro()` —el MISMO que usa el registro— y no a
 * tres números escritos a mano acá. Si algún día cambian las Leyendas de
 * bienvenida, esto las sigue sin que nadie se acuerde de venir a tocarlo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LAS DOS BARRERAS, Y POR QUÉ SON DOS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Los excluidos van por UID, no por correo: un correo se puede cambiar desde
 * la consola de Firebase y el script seguiría creyendo que protege algo.
 *
 * Pero además se comprueba que el UID siga teniendo el correo esperado. Si no
 * coincide, se para. Suena redundante y no lo es: `PENDIENTE §16b` tiene
 * anotado que la cuenta de administración se va a mudar de correo algún día, y
 * el día que eso pase conviene que esto se detenga y obligue a mirar, en vez de
 * resetear en silencio la cuenta equivocada.
 */

import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { CAMPOS_SALDO, saldoDeRegistro } from "../public/js/reglas/economia.js";

const PROYECTO = "memorie-legends";

/** Firestore admite 500 escrituras por lote; se deja aire. */
const POR_LOTE = 400;

/**
 * Los que NO se tocan, por UID, con el correo que tienen que seguir teniendo.
 *
 * La cuenta de administración —con la que se prueban las compras— y la cuenta
 * personal del dueño del sitio.
 */
export const EXCLUIDOS = Object.freeze([
  Object.freeze({
    uid: "mWiQt7AxsIgkAIZmUHqa1e4Tg8E2",
    correo: "soporte.memorie.legends@gmail.com",
    porque: "cuenta de administración",
  }),
  Object.freeze({
    uid: "uaEf4jyO8dZtPBfzMqY96IMnze73",
    correo: "seba48603468@gmail.com",
    porque: "cuenta personal del dueño del sitio",
  }),
]);

/** Cuántas cuentas se espera tocar. Si no coincide, algo cambió: se para. */
export const ESPERADAS = 9;

/** Lo que vuelve a cero. */
export const A_CERO = Object.freeze(["gamesPlayed", "wins", "torneosGanados", "mejorPuestoMensual"]);

/**
 * Lo que vuelve a `null`: los artículos que se llevan puestos.
 *
 * `sello` NO está, y su ausencia es la misma regla que en `CAMPO_EQUIPADO`:
 * un sello no se equipa ni se quita, así que tampoco se desequipa acá.
 */
export const A_NULO = Object.freeze(["avatar", "insignia", "dorso", "mazo", "fondo", "marco", "titulo"]);

/**
 * Lo que se borra del documento.
 *
 * `lastSpin` es de la ruleta, que ya no existe —lo comprueba
 * `pruebas/sin-ruleta.mjs`—, y encima está guardado con dos tipos distintos:
 * número en dieciocho perfiles y texto en uno. Un campo muerto y mal tipado no
 * se pone en cero: se saca.
 *
 * `insignias` y `premios` son listas que escribía el sistema viejo de
 * insignias y el cierre de períodos. Vaciarlas a `[]` dejaría un array vacío
 * donde antes no había campo; borrarlas deja el documento como lo deja el
 * registro.
 */
export const A_BORRAR = Object.freeze(["lastSpin", "insignias", "premios", "desactivado", "desactivadaEn", "desactivadaPor"]);

/** Lo que sobrevive: identidad e historia, no progreso. */
export const SE_QUEDAN = Object.freeze(["username", "email", "createdAt", "provider", "photoURL"]);

/**
 * Qué escribir en un perfil. No toca nada: decide.
 *
 * Devuelve sólo los campos que CAMBIAN. Un perfil que ya está en el estado de
 * registro no genera escritura, y eso hace que el dry-run diga la verdad sobre
 * cuánto se mueve de verdad.
 */
export function cambiosDe(datos, { borrarCampo = "__BORRAR__" } = {}) {
  const cambios = {};
  const saldo = saldoDeRegistro();

  for (const [campo, valor] of Object.entries(saldo)) {
    if (Number(datos?.[campo]) !== Number(valor)) cambios[campo] = valor;
  }
  for (const campo of A_CERO) {
    if (datos?.[campo] !== undefined && Number(datos[campo]) !== 0) cambios[campo] = 0;
  }
  for (const campo of A_NULO) {
    if (datos?.[campo] !== undefined && datos[campo] !== null) cambios[campo] = null;
  }
  for (const campo of A_BORRAR) {
    if (datos?.[campo] !== undefined) cambios[campo] = borrarCampo;
  }
  return cambios;
}

/**
 * El plan entero. `documentos` es [{ uid, datos, tieneCuentaDeAuth, correoEnAuth }].
 *
 * Frena —lanza— si algo no cierra: un excluido cuyo correo cambió, o una
 * cantidad de cuentas distinta de la esperada. Frenar es lo correcto: quien
 * corra esto dentro de seis meses no va a recordar cuántas tenían que ser.
 */
export function planDeReset(documentos, { esperadas = ESPERADAS, borrarCampo = "__BORRAR__" } = {}) {
  const porUid = new Map(EXCLUIDOS.map((e) => [e.uid, e]));

  for (const e of EXCLUIDOS) {
    const doc = documentos.find((d) => d.uid === e.uid);
    if (!doc) throw new Error(`El excluido ${e.uid} (${e.porque}) no aparece. No se escribe nada.`);
    if (doc.correoEnAuth && doc.correoEnAuth !== e.correo) {
      throw new Error(
        `El excluido ${e.uid} tiene el correo «${doc.correoEnAuth}» y se esperaba «${e.correo}». ` +
          "Si la cuenta se mudó de correo, actualizá EXCLUIDOS. No se escribe nada.",
      );
    }
  }

  const candidatos = documentos.filter((d) => d.tieneCuentaDeAuth && !porUid.has(d.uid));
  if (candidatos.length !== esperadas) {
    throw new Error(
      `Se esperaban ${esperadas} cuentas a resetear y hay ${candidatos.length}. ` +
        "Si se registró o se borró alguien, revisá y ajustá ESPERADAS. No se escribe nada.",
    );
  }

  const escrituras = candidatos
    .map((d) => ({ uid: d.uid, nombre: d.datos?.username, cambios: cambiosDe(d.datos, { borrarCampo }) }))
    .filter((x) => Object.keys(x.cambios).length > 0);

  return {
    escrituras,
    saltadas: documentos.filter((d) => !d.tieneCuentaDeAuth).length,
    excluidas: EXCLUIDOS.map((e) => e.uid),
    sinCambios: candidatos.length - escrituras.length,
  };
}

// ------------------------------------------------------------- programa

async function principal() {
  const argv = process.argv.slice(2);
  const aplicar = argv.includes("--aplicar") || argv.includes("--apply") || argv.includes("--escribir");
  const i = argv.indexOf("--respaldo");
  const respaldo = i >= 0 ? argv[i + 1] : null;
  const vaciarItems = argv.includes("--vaciar-items");
  const borrarMovimientos = argv.includes("--borrar-movimientos");

  if (aplicar && !respaldo) {
    throw new Error("Para aplicar hace falta --respaldo <archivo.json>. Sin respaldo no se escribe.");
  }
  if (aplicar) {
    const r = JSON.parse(readFileSync(respaldo, "utf8"));
    if (!Array.isArray(r?.documentos) || !r.documentos.length) {
      throw new Error(`El respaldo ${respaldo} no tiene documentos. No se escribe nada.`);
    }
    console.log(`\nRespaldo: ${respaldo} (${r.documentos.length} documentos, tomado ${r.tomadoEn})`);
  }

  const { initializeApp, applicationDefault } = await import("firebase-admin/app");
  const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
  const { getAuth } = await import("firebase-admin/auth");
  initializeApp({ credential: applicationDefault(), projectId: PROYECTO });
  const db = getFirestore();
  const auth = getAuth();

  console.log(
    aplicar
      ? "\n⚠️  MODO ESCRITURA: se resetean las cuentas reales.\n"
      : "\n🔍 En seco. No se escribe nada. Agregá --aplicar --respaldo <archivo> para aplicar.\n",
  );

  const { users } = await auth.listUsers(1000);
  const correoDe = new Map(users.map((u) => [u.uid, u.email ?? null]));
  const snap = await db.collection("users").get();

  const documentos = [];
  for (const d of snap.docs) {
    documentos.push({
      uid: d.id,
      datos: d.data(),
      tieneCuentaDeAuth: correoDe.has(d.id),
      correoEnAuth: correoDe.get(d.id) ?? null,
      items: (await d.ref.collection("items").count().get()).data().count,
    });
  }

  const plan = planDeReset(documentos);

  console.log(`Perfiles: ${documentos.length} · con cuenta ${correoDe.size ? documentos.filter((d) => d.tieneCuentaDeAuth).length : 0} · sin cuenta ${plan.saltadas} (no se tocan acá)\n`);
  console.log(`Excluidas, intactas: ${plan.excluidas.join(", ")}\n`);

  for (const e of plan.escrituras) {
    const d = documentos.find((x) => x.uid === e.uid);
    console.log(`  ${e.uid}  «${e.nombre}»`);
    for (const [campo, valor] of Object.entries(e.cambios)) {
      const antes = JSON.stringify(d.datos[campo]);
      const despues = valor === "__BORRAR__" ? "(se borra el campo)" : JSON.stringify(valor);
      console.log(`      ${campo.padEnd(20)} ${String(antes).padEnd(14)} -> ${despues}`);
    }
    if (d.items) {
      console.log(`      ${"items/".padEnd(20)} ${d.items} artículo(s)  -> ${vaciarItems ? "se vacían" : "SE QUEDAN (usá --vaciar-items)"}`);
    }
    console.log("");
  }
  if (plan.sinCambios) console.log(`  (${plan.sinCambios} cuenta(s) ya estaban en el estado de registro)\n`);

  // ------------------------------------------------- lo que hay que decidir
  const conItems = plan.escrituras.filter((e) => documentos.find((x) => x.uid === e.uid)?.items > 0);
  if (conItems.length && !vaciarItems) {
    console.log("⚠️  Los equipados pasan a null pero los artículos se quedan en users/{uid}/items.");
    console.log("    Queda gente que TIENE artículos y no los lleva puestos. Con --vaciar-items se van las dos cosas.\n");
  }

  let movimientos = 0;
  for (const e of plan.escrituras) {
    movimientos += (await db.collection("movimientos").where("uid", "==", e.uid).get()).size;
  }
  if (movimientos) {
    console.log(`⚠️  Estas cuentas tienen ${movimientos} movimiento(s) en el libro mayor.`);
    console.log(`    ${borrarMovimientos ? "Se borran." : "NO se tocan: el saldo va a dejar de ser la suma de su historia. Con --borrar-movimientos se van."}\n`);
  }

  if (!plan.escrituras.length) {
    console.log("✅ No hay nada que cambiar.\n");
    return;
  }
  if (!aplicar) {
    console.log(`🔍 En seco: ${plan.escrituras.length} perfil(es) cambiarían.\n`);
    return;
  }

  // ------------------------------------------------------------ escribir
  const conBorrados = (cambios) =>
    Object.fromEntries(
      Object.entries(cambios).map(([k, v]) => [k, v === "__BORRAR__" ? FieldValue.delete() : v]),
    );

  for (let k = 0; k < plan.escrituras.length; k += POR_LOTE) {
    const lote = db.batch();
    for (const e of plan.escrituras.slice(k, k + POR_LOTE)) {
      // `update` y no `set`: si el documento desapareció entre la lectura y
      // esto, falla en vez de crearlo de nuevo con la mitad de los campos.
      lote.update(db.collection("users").doc(e.uid), conBorrados(e.cambios));
    }
    await lote.commit();
  }

  if (vaciarItems) {
    for (const e of plan.escrituras) {
      const items = await db.collection("users").doc(e.uid).collection("items").get();
      for (const i of items.docs) await i.ref.delete();
    }
  }
  if (borrarMovimientos) {
    for (const e of plan.escrituras) {
      const movs = await db.collection("movimientos").where("uid", "==", e.uid).get();
      for (const m of movs.docs) await m.ref.delete();
    }
  }

  console.log(`✅ ${plan.escrituras.length} perfil(es) reseteados. Las ${plan.excluidas.length} excluidas, intactas.\n`);
}

const invocadoDirecto =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invocadoDirecto) {
  principal().catch((e) => {
    console.error(`\n❌ No se reseteó nada: ${e.message}\n`);
    process.exit(1);
  });
}
