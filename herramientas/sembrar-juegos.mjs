/**
 * Crea los documentos de `juegos/{id}` que falten.
 *
 *   node herramientas/sembrar-juegos.mjs              en seco: dice qué haría
 *   node herramientas/sembrar-juegos.mjs --escribir   lo hace
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El lobby no tiene ningún juego escrito en el código: muestra los de esta
 * colección que dicen `activo: true`, en su `orden`. Con la colección vacía, el
 * lobby dice «No hay juegos disponibles» y no muestra ninguna mesa pública.
 * Por eso esto corre ANTES de desplegar el hosting del lobby nuevo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE NUNCA HACE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Pisar un juego que ya existe. Si alguien lo editó desde la consola —otro
 * logo, lo desactivó para una mantención—, correr esto de nuevo no lo
 * deshace. Sólo crea los que faltan, y nunca borra.
 *
 * Y no suma juegos por su cuenta: la semilla es la lista de abajo, que hoy
 * tiene uno solo. Truco no está, y no va a estar hasta que se pida.
 */

import { pathToFileURL } from "node:url";

const PROYECTO = "memorie-legends";

/**
 * Los juegos que tiene que haber.
 *
 *   nombre   el que se muestra
 *   activo   si aparece en el lobby
 *   orden    en qué lugar, de menor a mayor
 *   logo     un archivo del sitio; una dirección de afuera no se dibuja
 *   colores  para que cada juego tenga su tono; hoy no los usa nadie
 *   config   lo propio de cada juego; hoy vacío
 */
export const JUEGOS = Object.freeze([
  Object.freeze({
    id: "memorie",
    nombre: "Memorie Legends",
    activo: true,
    orden: 1,
    logo: "/img/moneda-80.webp",
    colores: Object.freeze({ principal: "#d4a843" }),
    config: Object.freeze({}),
  }),
]);

/**
 * Qué escribir: los juegos de la semilla que no existen. Los que existen, se
 * dejan como están, aunque difieran de la semilla.
 *
 * @param {Set<string>} existentes  los ids que ya hay en `juegos`
 */
export function planDeSiembra(existentes, semilla = JUEGOS) {
  return semilla
    .filter((j) => !existentes.has(j.id))
    .map(({ id, ...datos }) => ({ ruta: `juegos/${id}`, datos }));
}

async function principal() {
  const escribir = process.argv.slice(2).includes("--escribir");

  const { initializeApp, applicationDefault } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  initializeApp({ credential: applicationDefault(), projectId: PROYECTO });
  const db = getFirestore();

  console.log(
    escribir
      ? "\n⚠️  MODO ESCRITURA: se crean los juegos que falten.\n"
      : "\n🔍 En seco. No se escribe nada. Agregá --escribir para aplicar.\n",
  );

  const existentes = new Set((await db.collection("juegos").listDocuments()).map((r) => r.id));
  console.log(`Ya hay: ${existentes.size ? [...existentes].join(", ") : "ninguno"}`);

  const plan = planDeSiembra(existentes);
  if (!plan.length) {
    console.log("✅ No falta ninguno. No hay nada que crear.");
    return;
  }
  for (const { ruta, datos } of plan) console.log(`  + ${ruta}  ${JSON.stringify(datos)}`);

  if (!escribir) {
    console.log(`\n🔍 En seco: ${plan.length} por crear. Con --escribir se crean.`);
    return;
  }

  for (const { ruta, datos } of plan) {
    // `create` y no `set`: si alguien lo creó entre la lectura y esta línea,
    // falla en vez de pisarlo.
    await db.doc(ruta).create(datos);
  }
  console.log(`\n✅ Creados: ${plan.length}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await principal();
}
