/**
 * Borra `users/{uid}.insignias`, un campo que dejó de significar algo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ ES ESE CAMPO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un resto de cuando había DOS sistemas de insignias que no se hablaban. Uno
 * otorgaba de verdad, en `users/{uid}/items/`; el otro escribía nombres en un
 * array del perfil —`dorada`, `plateada`, `bronce`, `top10`,
 * `comprador-elite`— que no existían en ningún catálogo.
 *
 * O sea que la lista no es "insignias viejas": es una lista de cosas que nunca
 * se pudieron mostrar, porque no había artículo al que corresponder.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ES SEGURO BORRARLO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque nadie lo lee ni lo escribe. Se comprobó antes de escribir esto:
 *
 *   - Ninguna Cloud Function lo escribe. El último que lo hacía era el cierre
 *     del ranking, y la línea se sacó; queda el comentario que lo explica, en
 *     `functions/index.js`.
 *   - Ninguna pantalla lo lee. Lo que un jugador tiene sale de `misItems` y de
 *     `misInsignias`, que miran la subcolección.
 *
 * Hay un `.insignias` que SÍ se usa, y no es éste: `partidas/{codigo}/logros/
 * {uid}.insignias`, el aviso que la mesa escucha para felicitar al que acaba
 * de ganar una. Vive en otra colección y esta herramienta no lo toca — sólo
 * mira documentos de `users/`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ BORRAR EL CAMPO Y NO VACIARLO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un array vacío es una respuesta: dice "este jugador no tiene ninguna". El
 * campo ausente dice lo que corresponde, que es "acá no se guarda eso". Y
 * `FieldValue.delete()` no deja rastro que alguien tenga que interpretar
 * dentro de un año.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * USO
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   node herramientas/limpiar-perfiles.mjs              (dry-run: sólo cuenta)
 *   node herramientas/limpiar-perfiles.mjs --escribir   (borra)
 *
 * Hace falta estar autenticado contra el proyecto:
 *   gcloud auth application-default login
 */

import { pathToFileURL } from "node:url";

const PROYECTO = "memorie-legends";
const USUARIOS = "users";
const CAMPO = "insignias";

/** Firestore admite 500 escrituras por lote. */
const POR_LOTE = 400;

/**
 * Los ids que este campo llegó a tener, y que nunca existieron en el catálogo.
 *
 * No se usan para decidir qué borrar —se borra el campo entero, tenga lo que
 * tenga— sino para el informe: si aparece un id que NO está en esta lista,
 * conviene mirarlo antes de seguir. Sería señal de que algo lo escribió
 * después de que dejamos de mirarlo.
 */
const CONOCIDOS = ["dorada", "plateada", "bronce", "top10", "comprador-elite"];

/**
 * Qué hay que borrar, y qué contiene. No toca nada: decide.
 *
 * @param {Array<{uid: string, datos: object}>} perfiles
 */
export function planDeLimpieza(perfiles) {
  const conCampo = [];
  const cuentaPorId = new Map();
  const desconocidos = new Set();

  for (const { uid, datos } of perfiles) {
    if (!(CAMPO in (datos ?? {}))) continue;

    const valor = datos[CAMPO];
    const ids = Array.isArray(valor) ? valor.map(String) : [];

    for (const id of ids) {
      cuentaPorId.set(id, (cuentaPorId.get(id) ?? 0) + 1);
      if (!CONOCIDOS.includes(id)) desconocidos.add(id);
    }

    conCampo.push({
      uid,
      ids,
      // Un campo que existe pero no es un array es todavía más raro que uno
      // con ids inventados, y merece verse en el informe.
      raro: !Array.isArray(valor),
    });
  }

  return {
    conCampo,
    cuentaPorId: [...cuentaPorId.entries()].sort((a, b) => b[1] - a[1]),
    desconocidos: [...desconocidos],
  };
}

async function principal() {
  const escribir = process.argv.includes("--escribir");

  const { initializeApp, applicationDefault } = await import("firebase-admin/app");
  const { getFirestore, FieldValue } = await import("firebase-admin/firestore");

  initializeApp({ credential: applicationDefault(), projectId: PROYECTO });
  const db = getFirestore();

  console.log(
    escribir
      ? `\n⚠️  MODO ESCRITURA: se borra el campo \`${CAMPO}\` de los perfiles.\n`
      : "\n🔍 Dry-run. No se borra nada. Agregá --escribir para aplicar.\n",
  );

  const perfiles = await db.collection(USUARIOS).get();
  console.log(`${perfiles.size} perfiles.\n`);

  const refs = new Map();
  const lista = [];
  perfiles.forEach((d) => {
    refs.set(d.id, d.ref);
    lista.push({ uid: d.id, datos: d.data() });
  });

  const { conCampo, cuentaPorId, desconocidos } = planDeLimpieza(lista);

  if (!conCampo.length) {
    console.log(`✅ Ningún perfil tiene \`${CAMPO}\`. No hay nada que hacer.\n`);
    return;
  }

  console.log(`  ${conCampo.length} perfiles lo tienen.\n`);

  if (cuentaPorId.length) {
    console.log("  qué contiene, y en cuántos perfiles:");
    for (const [id, cuantos] of cuentaPorId) {
      const marca = CONOCIDOS.includes(id) ? " " : "⚠️";
      console.log(`   ${marca} ${id.padEnd(20)} ${cuantos}`);
    }
    console.log("");
  }

  const raros = conCampo.filter((p) => p.raro);
  if (raros.length) {
    console.log(`  ⚠️  ${raros.length} lo tienen y NO es un array: ${raros
      .slice(0, 5)
      .map((p) => p.uid)
      .join(", ")}\n`);
  }

  /**
   * Un id que no conocíamos frena la limpieza.
   *
   * Todo lo que había en este campo está enumerado en `CONOCIDOS`. Algo fuera
   * de esa lista significa que alguien lo escribió después de que dimos el
   * campo por muerto, y entonces la premisa entera —«no lo escribe nadie»— es
   * falsa. Borrar sería tapar la única evidencia de eso.
   */
  if (desconocidos.length) {
    console.error(`❌ Hay ids que no esperábamos: ${desconocidos.join(", ")}\n`);
    console.error("   Todo lo que este campo llegó a tener está en CONOCIDOS. Algo");
    console.error("   fuera de esa lista quiere decir que alguien lo escribió después");
    console.error("   de que lo diéramos por muerto, y eso hay que mirarlo antes de");
    console.error("   borrar: el campo sería la única prueba de que pasó.\n");
    process.exit(1);
  }

  if (!escribir) {
    console.log("🔍 Dry-run: no se borró nada. Con --escribir se aplica.\n");
    return;
  }

  let borrados = 0;
  for (let i = 0; i < conCampo.length; i += POR_LOTE) {
    const lote = db.batch();
    for (const p of conCampo.slice(i, i + POR_LOTE)) {
      // `update` con `FieldValue.delete()`: saca el campo y no toca nada más.
      // Un `set` con merge no sirve — no hay forma de decir "esto ya no está"
      // agregando datos.
      lote.update(refs.get(p.uid), { [CAMPO]: FieldValue.delete() });
      borrados++;
    }
    await lote.commit();
    console.log(`  lote de ${Math.min(POR_LOTE, conCampo.length - i)} borrado.`);
  }

  console.log(`\n✅ ${borrados} perfiles limpios.\n`);
  console.log("Correrla de nuevo tiene que decir que no queda ninguno.\n");
}

/** Sólo cuando se lo invoca directo. Rutas completas, no nombres de archivo. */
const invocadoDirecto =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invocadoDirecto) {
  principal().catch((e) => {
    console.error("\n❌ No se pudo limpiar:", e.message);
    if (/could not load the default credentials/i.test(e.message)) {
      console.error("\nFalta autenticarse:\n   gcloud auth application-default login\n");
    }
    process.exit(1);
  });
}
