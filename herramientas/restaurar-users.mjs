/**
 * Devuelve `users` al estado de un respaldo. Es el deshacer de las otras dos.
 *
 *   node herramientas/restaurar-users.mjs --desde <archivo.json>
 *   node herramientas/restaurar-users.mjs --desde <archivo.json> --aplicar
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ RESTAURA, Y QUÉ NO PUEDE RESTAURAR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Re-crea cada documento de `users` tal como estaba, con sus subcolecciones.
 * Sirve tanto para deshacer el reset —los campos vuelven a sus valores— como
 * el borrado de huérfanos, que vuelven a existir.
 *
 * Lo que NO puede devolver es una cuenta de Authentication. Si alguien borró
 * la cuenta y no sólo el perfil, esto re-crea el perfil y la cuenta sigue sin
 * estar: el perfil vuelve a ser huérfano. Es una limitación real y conviene
 * saberla antes de necesitarla, no durante.
 *
 * Tampoco toca `movimientos`. Si se corrió el reset con `--borrar-movimientos`,
 * el libro mayor de esas cuentas no vuelve.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESCRIBE CON `set` Y SIN `merge`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Restaurar es dejar el documento EXACTAMENTE como estaba. Con `merge`, un
 * campo que se agregó después del respaldo sobreviviría, y el resultado no
 * sería el estado guardado sino una mezcla de los dos. Una restauración que
 * deja mezcla es la clase de cosa que se descubre tarde.
 */

import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const PROYECTO = "memorie-legends";

/**
 * Qué escribir para volver al respaldo. No toca nada: decide.
 *
 * @param guardados  los documentos del respaldo
 * @param actuales   lo que hay hoy, como Map uid -> datos
 */
export function planDeRestauracion(guardados, actuales) {
  const vuelven = [];
  const cambian = [];
  const iguales = [];

  for (const g of guardados) {
    const hoy = actuales.get(g.uid);
    if (hoy === undefined) vuelven.push(g);
    else if (JSON.stringify(hoy, Object.keys(hoy).sort()) !== JSON.stringify(g.datos, Object.keys(g.datos).sort())) {
      cambian.push(g);
    } else iguales.push(g);
  }

  // Lo que existe hoy y no estaba en el respaldo: se avisa y NO se borra. Un
  // restaurador que borra lo que no conoce puede llevarse por delante a quien
  // se registró después del respaldo.
  const guardadosUid = new Set(guardados.map((g) => g.uid));
  const nuevos = [...actuales.keys()].filter((uid) => !guardadosUid.has(uid));

  return { vuelven, cambian, iguales, nuevos };
}

// ------------------------------------------------------------- programa

async function principal() {
  const argv = process.argv.slice(2);
  const aplicar = argv.includes("--aplicar") || argv.includes("--apply") || argv.includes("--escribir");
  const i = argv.indexOf("--desde");
  const archivo = i >= 0 ? argv[i + 1] : null;
  if (!archivo) throw new Error("Falta --desde <archivo.json>.");

  const respaldo = JSON.parse(readFileSync(archivo, "utf8"));
  if (!Array.isArray(respaldo?.documentos) || !respaldo.documentos.length) {
    throw new Error(`${archivo} no tiene documentos.`);
  }

  const { initializeApp, applicationDefault } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  initializeApp({ credential: applicationDefault(), projectId: PROYECTO });
  // La base con nombre: la `(default)` quedó con los datos viejos y no da
  // ningún error si se le escribe. Ver `functions/index.js`.
  const db = getFirestore("southamerica");

  console.log(
    aplicar
      ? `\n⚠️  MODO ESCRITURA: se restaura users desde ${archivo}\n`
      : `\n🔍 En seco. No se escribe nada. Agregá --aplicar para restaurar.\n`,
  );
  console.log(`Respaldo tomado el ${respaldo.tomadoEn} · ${respaldo.documentos.length} documentos\n`);

  const snap = await db.collection("users").get();
  const actuales = new Map(snap.docs.map((d) => [d.id, d.data()]));
  const plan = planDeRestauracion(respaldo.documentos, actuales);

  console.log(`  vuelven a existir:  ${plan.vuelven.length}`);
  for (const g of plan.vuelven) console.log(`      + ${g.uid}  «${g.datos?.username}»`);
  console.log(`  cambian de estado:  ${plan.cambian.length}`);
  for (const g of plan.cambian) console.log(`      ~ ${g.uid}  «${g.datos?.username}»`);
  console.log(`  ya están igual:     ${plan.iguales.length}`);
  if (plan.nuevos.length) {
    console.log(`\n  ⚠️  ${plan.nuevos.length} perfil(es) existen hoy y NO están en el respaldo.`);
    console.log("      No se borran: pueden ser gente que se registró después.");
    for (const uid of plan.nuevos) console.log(`      ? ${uid}`);
  }

  if (!plan.vuelven.length && !plan.cambian.length) {
    console.log("\n✅ Ya está todo como en el respaldo.\n");
    return;
  }
  if (!aplicar) {
    console.log(`\n🔍 En seco: ${plan.vuelven.length + plan.cambian.length} documento(s) se escribirían.\n`);
    return;
  }

  let hechos = 0;
  for (const g of [...plan.vuelven, ...plan.cambian]) {
    await db.collection("users").doc(g.uid).set(g.datos);
    for (const s of g.subdocumentos ?? []) {
      await db.collection("users").doc(g.uid).collection(s.subcoleccion).doc(s.id).set(s.datos);
    }
    hechos++;
  }

  console.log(`\n✅ ${hechos} documento(s) restaurados.`);
  console.log("   Recordá: esto NO re-crea cuentas de Authentication ni movimientos.\n");
}

const invocadoDirecto =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invocadoDirecto) {
  principal().catch((e) => {
    console.error(`\n❌ No se restauró nada: ${e.message}\n`);
    process.exit(1);
  });
}
