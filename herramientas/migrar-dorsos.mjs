/**
 * Apunta al `.webp` los tres artículos del catálogo que nombraban un `.png`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA UNA MIGRACIÓN Y NO ALCANZA CON DESPLEGAR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Los dos dorsos de la casa pasaron de `.png` a `.webp` y los `.png` se
 * borraron. `reglas/catalogo.js` ya apunta a los nuevos, pero eso es la
 * SEMILLA: lo que `sembrarCatalogo` escribe la primera vez. El catálogo de
 * verdad está en Firestore y no se vuelve a sembrar —a propósito, para no
 * pisar los precios que un administrador haya cambiado a mano—.
 *
 * Y la dirección que llega a la mesa sale de ahí: cuando alguien entra a una
 * sala, `identidadEnSala` lee el documento del artículo que tiene equipado y
 * copia su campo `imagen` al estado de la sala. Con el documento viejo, lo que
 * viaja es la ruta de un archivo que ya no existe.
 *
 * Son tres, y dos de ellos son de arranque —`dorso_azul` y `mazo_azul`, gratis
 * los dos—, así que los tiene casi todo el mundo. Sin esto: un hueco en la
 * tienda y un dorso roto en la mesa.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ NO TOCA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Los perfiles. `users/{uid}.dorso` guarda el ID del artículo, no su
 * dirección, y el servidor lo resuelve contra el catálogo en cada entrada a
 * una sala. Arreglado el catálogo, quedan arreglados todos.
 *
 * Lo único que se queda con la ruta vieja es una sala YA ABIERTA: su
 * `jugadoresLuce` es una copia hecha al entrar. Se arregla sola cuando esa
 * partida termina. Por eso esto se corre antes del despliegue y con pocas
 * salas vivas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO PISA CUALQUIER COSA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Sólo cambia un documento cuyo `imagen` sea EXACTAMENTE el `.png` que
 * corresponde al `.webp` de la semilla. Si un administrador le puso otro
 * dibujo desde el panel, esto lo deja como está y lo dice: esa decisión es
 * suya y este script no sabe nada de ella.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CÓMO SE USA
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   gcloud auth application-default login     (una vez)
 *   node herramientas/migrar-dorsos.mjs            ← sólo mira
 *   node herramientas/migrar-dorsos.mjs --escribir ← escribe
 *
 * Correrlo dos veces no hace daño: la segunda encuentra todo en su lugar.
 */

import { CATALOGO_INICIAL } from "../public/js/reglas/catalogo.js";

const ESCRIBIR = process.argv.includes("--escribir");

/** La carpeta cuyos archivos cambiaron de formato. */
const CARPETA = "/img/dorsos/";

/**
 * Qué tiene que decir cada artículo, sacado de la semilla y no de una lista
 * escrita acá: con una copia propia habría dos verdades, y la de este archivo
 * se quedaría vieja el día que cambie la del catálogo.
 */
export const ESPERADO = new Map(
  CATALOGO_INICIAL.filter(
    (i) => typeof i.imagen === "string" && i.imagen.startsWith(CARPETA) && i.imagen.endsWith(".webp"),
  ).map((i) => [i.id, i.imagen]),
);

/** El `.png` del que viene cada uno. Es lo único que este script acepta pisar. */
export const anterior = (webp) => webp.replace(/\.webp$/, ".png");

/**
 * Qué hacer con cada documento. Puro: recibe lo que hay y devuelve el plan.
 *
 * `documentos` es una lista de `{ id, imagen }`. Devuelve tres grupos, porque
 * los tres hay que mirarlos antes de escribir:
 *
 *   cambian   el `.png` esperado → se reemplaza
 *   alDia     ya dice el `.webp` → no se toca
 *   ajenos    dice otra cosa → NO se toca, y se avisa
 */
export function planDeMigracion(documentos, esperado = ESPERADO) {
  const cambian = [];
  const alDia = [];
  const ajenos = [];
  const sinDocumento = new Set(esperado.keys());

  for (const { id, imagen } of documentos) {
    const destino = esperado.get(id);
    if (!destino) continue;
    sinDocumento.delete(id);

    if (imagen === destino) alDia.push({ id, imagen });
    else if (imagen === anterior(destino)) cambian.push({ id, de: imagen, a: destino });
    else ajenos.push({ id, imagen: imagen ?? null, esperado: destino });
  }

  return { cambian, alDia, ajenos, sinDocumento: [...sinDocumento] };
}

async function principal() {
  if (!ESPERADO.size) {
    console.error(`La semilla no tiene ningún artículo apuntando a ${CARPETA}*.webp.`);
    process.exit(1);
  }

  const { initializeApp, applicationDefault } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");

  initializeApp({ credential: applicationDefault(), projectId: "memorie-legends" });
  const db = getFirestore();

  const snap = await db.collection("catalogo").get();
  const documentos = [];
  snap.forEach((doc) => documentos.push({ id: doc.id, imagen: doc.data().imagen }));

  const { cambian, alDia, ajenos, sinDocumento } = planDeMigracion(documentos);

  console.log(`\nCatálogo en Firestore: ${snap.size} artículos.`);
  console.log(`Artículos que la semilla apunta a ${CARPETA}: ${ESPERADO.size}.\n`);

  if (sinDocumento.length) {
    console.log("⚠️  Están en la semilla pero NO en Firestore (falta sembrar):");
    for (const id of sinDocumento) console.log(`   ${id}`);
    console.log();
  }

  if (ajenos.length) {
    console.log("⚠️  Tienen OTRA imagen puesta a mano. NO se tocan:");
    for (const a of ajenos) console.log(`   ${a.id.padEnd(14)} dice ${a.imagen}   (la semilla diría ${a.esperado})`);
    console.log();
  }

  if (alDia.length) console.log(`✓ Ya apuntan al .webp: ${alDia.length}`);

  if (!cambian.length) {
    console.log("\nNo hay nada que cambiar.\n");
    return;
  }

  console.log(`\nHay que cambiar ${cambian.length}:\n`);
  for (const c of cambian) {
    console.log(`   ${c.id.padEnd(14)} ${c.de}`);
    console.log(`   ${" ".repeat(14)} ${c.a}\n`);
  }

  if (!ESCRIBIR) {
    console.log("Esto fue una mirada. Para escribir de verdad:");
    console.log("   node herramientas/migrar-dorsos.mjs --escribir\n");
    return;
  }

  // `merge` y sólo el campo: el documento tiene precio, nombre, orden y
  // metadata que no son asunto de este script.
  const lote = db.batch();
  for (const c of cambian) {
    lote.set(db.collection("catalogo").doc(c.id), { imagen: c.a }, { merge: true });
  }
  await lote.commit();

  console.log(`\n✅ Escritos ${cambian.length} artículos.\n`);
}

// Sólo cuando se lo llama a mano: importarlo —para probar `planDeMigracion`—
// no puede abrir una conexión a producción.
if (process.argv[1] && import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
  await principal();
}
