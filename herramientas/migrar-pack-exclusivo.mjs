/**
 * Le pone `packExclusivo` a los artículos de pack que ya están en Firestore.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA UNA MIGRACIÓN Y NO ALCANZA CON SEMBRAR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Los 12 artículos ya están escritos, y `sembrarCatalogo` no pisa lo que ya
 * está — a propósito: sembrar dos veces no puede revertir los precios que un
 * administrador haya cambiado a mano. Así que la semilla arreglada no los toca.
 *
 * Están sin el campo porque `normalizarItem` es una lista blanca y no lo
 * incluía: se descartaba en silencio en los dos caminos de escritura. Eso ya
 * está arreglado, pero el arreglo sólo vale para lo que se escriba de ahora en
 * más.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ ROMPE MIENTRAS TANTO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Nueve de los doce son de tipo vendible —avatar, dorso, paño, mazo— con
 * precio 0 y activos. Sin el campo, `seCompraConLeyendas` dice que sí y
 * cualquiera se los lleva gratis. Los otros tres se salvan sólo porque su TIPO
 * no se vende nunca: marco, título y sello.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CÓMO SE USA
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   gcloud auth application-default login     (una vez)
 *   node herramientas/migrar-pack-exclusivo.mjs            ← sólo mira
 *   node herramientas/migrar-pack-exclusivo.mjs --escribir ← escribe
 *
 * Sin `--escribir` no toca nada: dice qué haría y termina. Es la misma forma
 * que `auditar-catalogo.mjs` y que el barrido del panel, y por la misma razón
 * — un script que escribe en producción tiene que poder mirarse antes.
 *
 * Se corre UNA VEZ. Correrlo dos veces no hace daño: la segunda encuentra todo
 * en su lugar y no escribe nada.
 */

import { CATALOGO_INICIAL } from "../public/js/reglas/catalogo.js";

const ESCRIBIR = process.argv.includes("--escribir");

/**
 * De dónde sale la tabla: de la semilla, no de una copia escrita acá.
 *
 * Con una lista propia habría dos verdades, y la de este archivo se quedaría
 * vieja el día que cambie la del catálogo — que es exactamente el tipo de
 * desacuerdo que produjo este bug.
 */
const MARCAS = new Map(
  CATALOGO_INICIAL.filter((i) => i.packExclusivo).map((i) => [i.id, i.packExclusivo]),
);

async function principal() {
  if (!MARCAS.size) {
    console.error("La semilla no tiene ningún artículo con `packExclusivo`. Nada que migrar.");
    process.exit(1);
  }

  const { initializeApp, applicationDefault } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");

  initializeApp({ credential: applicationDefault(), projectId: "memorie-legends" });
  const db = getFirestore();

  const snap = await db.collection("catalogo").get();

  const aEscribir = [];
  const yaEstaban = [];
  const noEstanEnFirestore = new Set(MARCAS.keys());

  snap.forEach((doc) => {
    const esperado = MARCAS.get(doc.id);
    noEstanEnFirestore.delete(doc.id);

    const actual = doc.data().packExclusivo ?? null;

    // Los que NO son de pack se dejan como están, incluso si tienen el campo
    // en null: escribirles algo sería tocar 29 documentos para nada.
    if (!esperado) return;

    if (actual === esperado) yaEstaban.push(doc.id);
    else aEscribir.push({ id: doc.id, de: actual, a: esperado });
  });

  console.log(`\nCatálogo en Firestore: ${snap.size} artículos.`);
  console.log(`Artículos de pack según la semilla: ${MARCAS.size}.\n`);

  if (noEstanEnFirestore.size) {
    console.log("⚠️  Están en la semilla pero NO en Firestore (falta sembrar):");
    for (const id of noEstanEnFirestore) console.log(`   ${id}`);
    console.log();
  }

  if (yaEstaban.length) {
    console.log(`✓ Ya tenían la marca correcta: ${yaEstaban.length}`);
  }

  if (!aEscribir.length) {
    console.log("\nNo hay nada que cambiar.\n");
    return;
  }

  console.log(`\nHay que marcar ${aEscribir.length}:\n`);
  for (const c of aEscribir) {
    console.log(`   ${c.id.padEnd(22)} ${String(c.de).padEnd(10)} → ${c.a}`);
  }

  if (!ESCRIBIR) {
    console.log("\nEsto fue una mirada. Para escribir de verdad:");
    console.log("   node herramientas/migrar-pack-exclusivo.mjs --escribir\n");
    return;
  }

  /**
   * Se escribe con `merge` y sólo el campo.
   *
   * Un `set` entero reescribiría el documento con lo que diga la semilla, y
   * pisaría los precios, nombres o imágenes que un administrador haya cambiado
   * desde el panel. Acá se viene a agregar un campo, no a revertir el catálogo.
   */
  let escritos = 0;
  for (const c of aEscribir) {
    await db.collection("catalogo").doc(c.id).set({ packExclusivo: c.a }, { merge: true });
    escritos++;
    console.log(`   escrito ${c.id}`);
  }

  console.log(`\n✅ ${escritos} artículos marcados.\n`);
  console.log("Comprobá en la tienda que ya no aparezcan, y en Mi colección");
  console.log("que quien los tenga los siga viendo.\n");
}

principal().catch((e) => {
  console.error("\n❌ No se pudo migrar:", e.message);
  if (/could not load the default credentials/i.test(e.message)) {
    console.error("\nFalta autenticarse:\n   gcloud auth application-default login\n");
  }
  process.exit(1);
});
