/**
 * Pasa los rankings de la estructura vieja a la estructura por juego.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DE DÓNDE A DÓNDE
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   rankings/{clave}/jugadores/{uid}   →  rankings/{juego}/periodos/{clave}/jugadores/{uid}
 *   rankings/{clave}                   →  rankings/{juego}/periodos/{clave}
 *   jugadores/{uid}/rachas/actual      →  jugadores/{uid}/rachas/{juego}
 *
 * y además la marca del juego, `rankings/{juego}` con `{ juego }`, que es lo
 * que el cierre de los períodos mira para saber qué juegos tienen tablas.
 *
 * NO BORRA NADA. Lo viejo queda como respaldo; las reglas lo siguen dejando
 * leer, y nadie lo escribe más.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CUÁNDO SE CORRE, Y POR QUÉ PUEDE HABER QUE SUMAR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * En el despliegue: primero la limpieza de lo viejo (`limpiar-rankings.mjs
 * --legado`), después las funciones nuevas, y recién después esto.
 *
 * Entre las funciones y la migración puede terminar una partida. Su fila cae
 * en la ruta NUEVA, y la vieja del mismo jugador y período trae lo de antes:
 * hay que juntarlas, no pisar una con la otra. Las columnas acumuladas se
 * suman, la mejor racha es la mayor, y la racha actual y la identidad salen
 * de la más reciente.
 *
 * Y cada fila escrita queda con `migrado: true`: correrla dos veces no suma
 * dos veces, porque una fila migrada no se vuelve a tocar.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * USO
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   node herramientas/migrar-rankings.mjs              (dry-run: sólo muestra)
 *   node herramientas/migrar-rankings.mjs --escribir
 *
 * `--juego` elige el juego de destino; por omisión, el de siempre, que es el
 * único que había cuando las tablas no tenían juego. Después de escribir, una
 * segunda corrida en seco tiene que decir que no queda nada que migrar.
 *
 * Hace falta estar autenticado contra el proyecto:
 *   gcloud auth application-default login
 */

import { pathToFileURL } from "node:url";
import {
  RUTAS_RANKING,
  RUTAS_RANKING_VIEJAS,
  esClaveDePeriodo,
} from "../public/js/reglas/ranking.js";
import { JUEGO_POR_DEFECTO } from "../public/js/reglas/juegos.js";

const PROYECTO = "memorie-legends";

/** Firestore admite 500 escrituras por lote. */
const POR_LOTE = 400;

/** Las columnas que se SUMAN al juntar una fila vieja con una nueva. */
export const ACUMULADAS = [
  "puntos",
  "partidasJugadas",
  "partidasGanadas",
  "eliminaciones",
  "cortesPerfectos",
  "remontadas",
  "exp",
];

/** Lo que sale de la fila escrita más recientemente. */
const DE_LA_MAS_RECIENTE = ["rachaActual", "nombre", "retrato", "marco", "titulo", "actualizada"];

/** Milisegundos de un sello: un Timestamp de Firestore, una fecha o un número. */
const ms = (sello) => {
  if (typeof sello?.toMillis === "function") return sello.toMillis();
  if (sello instanceof Date) return sello.getTime();
  const n = Number(sello);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Junta la fila vieja de un jugador con la que ya escribió el código nuevo,
 * del mismo período. Ver la cabecera.
 */
export function juntarFilas(vieja, nueva) {
  const junta = { ...vieja, ...nueva };
  for (const columna of ACUMULADAS) {
    junta[columna] = Number(vieja?.[columna] ?? 0) + Number(nueva?.[columna] ?? 0);
  }
  junta.mejorRacha = Math.max(Number(vieja?.mejorRacha ?? 0), Number(nueva?.mejorRacha ?? 0));

  const masReciente = ms(vieja?.actualizada) > ms(nueva?.actualizada) ? vieja : nueva;
  for (const campo of DE_LA_MAS_RECIENTE) {
    if (masReciente?.[campo] !== undefined) junta[campo] = masReciente[campo];
  }
  return junta;
}

/** Escapa un id para meterlo en una expresión regular. */
const escaparRegex = (texto) => String(texto).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Frena todo si alguna escritura cae fuera de las rutas del juego de destino.
 *
 * La migración sólo puede escribir la marca, los períodos, las filas y las
 * rachas de ESE juego. Nunca la estructura vieja —la copia no se toca—, nunca
 * otro juego, nunca nada que no sea del ranking.
 */
export function verificarRutas(rutas, juego = JUEGO_POR_DEFECTO) {
  const j = escaparRegex(juego);
  const permitidas = [
    new RegExp(`^rankings/${j}$`),
    new RegExp(`^rankings/${j}/periodos/[^/]+$`),
    new RegExp(`^rankings/${j}/periodos/[^/]+/jugadores/[^/]+$`),
    new RegExp(`^jugadores/[^/]+/rachas/${j}$`),
  ];
  const ajenas = rutas.filter((r) => !permitidas.some((p) => p.test(r)));
  if (ajenas.length) {
    throw new Error(
      `La migración quiere escribir fuera de las tablas de «${juego}»: ` +
        `${ajenas.slice(0, 5).join(", ")}. No se escribe nada.`,
    );
  }
  return rutas;
}

/**
 * Qué escribir para migrar. No toca nada: decide.
 *
 * @param viejos.periodos [{ clave, doc, filas: [{ uid, datos }] }]
 * @param viejos.rachas   [{ uid, datos }]
 * @param nuevos.marca    si la marca del juego ya existe
 * @param nuevos.periodos { [clave]: { doc, filas: { [uid]: datos } } }
 * @param nuevos.rachas   { [uid]: datos }
 */
export function planDeMigracion({ viejos, nuevos = {} }, { juego = JUEGO_POR_DEFECTO } = {}) {
  const escrituras = [];
  const resumen = {
    marca: false,
    periodosCopiados: 0,
    filasCopiadas: 0,
    filasJuntadas: 0,
    filasYaMigradas: 0,
    rachasCopiadas: 0,
    rachasQueQuedan: 0,
  };

  if (!nuevos.marca) {
    escrituras.push({ ruta: RUTAS_RANKING.juego(juego), datos: { juego }, fusionar: true });
    resumen.marca = true;
  }

  for (const p of viejos.periodos ?? []) {
    // En `rankings/` viven también las marcas de los juegos: no son períodos.
    if (!esClaveDePeriodo(p.clave)) continue;

    const destino = nuevos.periodos?.[p.clave] ?? { doc: null, filas: {} };

    // El documento del período existe sólo si se cerró. Se copia con su
    // `cerrado`, así el cierre nuevo no lo vuelve a cerrar ni a pagar.
    if (p.doc && !destino.doc) {
      escrituras.push({
        ruta: RUTAS_RANKING.periodo(juego, p.clave),
        datos: { ...p.doc, juego, clave: p.clave },
      });
      resumen.periodosCopiados++;
    }

    for (const f of p.filas ?? []) {
      const yaEsta = destino.filas?.[f.uid];
      if (yaEsta?.migrado === true) {
        resumen.filasYaMigradas++;
        continue;
      }
      const datos = yaEsta ? juntarFilas(f.datos, yaEsta) : { ...f.datos };
      escrituras.push({
        ruta: RUTAS_RANKING.fila(juego, p.clave, f.uid),
        datos: { ...datos, migrado: true },
      });
      if (yaEsta) resumen.filasJuntadas++;
      else resumen.filasCopiadas++;
    }
  }

  // La racha: gana la más reciente. Si la nueva ya existe y es igual o más
  // nueva —lo normal: la escribió una partida después del despliegue—, queda.
  for (const r of viejos.rachas ?? []) {
    const yaEsta = nuevos.rachas?.[r.uid];
    if (yaEsta && ms(yaEsta.actualizada) >= ms(r.datos?.actualizada)) {
      resumen.rachasQueQuedan++;
      continue;
    }
    escrituras.push({ ruta: RUTAS_RANKING.racha(juego, r.uid), datos: { ...r.datos } });
    resumen.rachasCopiadas++;
  }

  verificarRutas(escrituras.map((e) => e.ruta), juego);
  return { escrituras, resumen };
}

// ------------------------------------------------------------- programa

async function principal() {
  const argv = process.argv.slice(2);
  const escribir = argv.includes("--escribir");
  const i = argv.indexOf("--juego");
  const juego = i >= 0 ? argv[i + 1] : JUEGO_POR_DEFECTO;
  if (!juego || juego.startsWith("--")) throw new Error("Falta el valor de --juego.");

  const { initializeApp, applicationDefault } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");

  initializeApp({ credential: applicationDefault(), projectId: PROYECTO });
  // La base con nombre: la `(default)` quedó con los datos viejos y no da

  // ningún error si se le escribe. Ver `functions/index.js`.

  const db = getFirestore("southamerica");

  console.log(
    escribir
      ? `\n⚠️  MODO ESCRITURA: se migran los rankings a «${juego}».\n`
      : `\n🔍 Dry-run. No se escribe nada. Agregá --escribir para aplicar.\n`,
  );

  // ------------------------------------------------------ lo viejo
  const periodosViejos = [];
  for (const ref of await db.collection(RUTAS_RANKING.coleccion).listDocuments()) {
    if (!esClaveDePeriodo(ref.id)) continue;
    const doc = await ref.get();
    const filas = await db.collection(RUTAS_RANKING_VIEJAS.filas(ref.id)).get();
    periodosViejos.push({
      clave: ref.id,
      doc: doc.exists ? doc.data() : null,
      filas: filas.docs.map((d) => ({ uid: d.id, datos: d.data() })),
    });
  }

  const rachasViejas = [];
  for (const ref of await db.collection("jugadores").listDocuments()) {
    const snap = await db.doc(RUTAS_RANKING_VIEJAS.racha(ref.id)).get();
    if (snap.exists) rachasViejas.push({ uid: ref.id, datos: snap.data() });
  }

  // ---------------------------------------------- lo que ya hay en lo nuevo
  const marca = await db.doc(RUTAS_RANKING.juego(juego)).get();
  const periodosNuevos = {};
  for (const p of periodosViejos) {
    const doc = await db.doc(RUTAS_RANKING.periodo(juego, p.clave)).get();
    const filas = await db.collection(RUTAS_RANKING.filas(juego, p.clave)).get();
    periodosNuevos[p.clave] = {
      doc: doc.exists ? doc.data() : null,
      filas: Object.fromEntries(filas.docs.map((d) => [d.id, d.data()])),
    };
  }
  const rachasNuevas = {};
  for (const r of rachasViejas) {
    const snap = await db.doc(RUTAS_RANKING.racha(juego, r.uid)).get();
    if (snap.exists) rachasNuevas[r.uid] = snap.data();
  }

  // ------------------------------------------------------------ plan
  const { escrituras, resumen } = planDeMigracion(
    {
      viejos: { periodos: periodosViejos, rachas: rachasViejas },
      nuevos: {
        marca: marca.exists && marca.data()?.juego === juego,
        periodos: periodosNuevos,
        rachas: rachasNuevas,
      },
    },
    { juego },
  );

  const filasViejas = periodosViejos.reduce((s, p) => s + p.filas.length, 0);
  console.log(`Juego de destino: «${juego}»`);
  console.log(`Lo viejo: ${periodosViejos.length} períodos, ${filasViejas} filas, ${rachasViejas.length} rachas.\n`);
  console.log(`  Marca del juego:          ${resumen.marca ? "se crea" : "ya estaba"}`);
  console.log(`  Períodos cerrados:        ${resumen.periodosCopiados} se copian`);
  console.log(`  Filas:                    ${resumen.filasCopiadas} se copian, ${resumen.filasJuntadas} se juntan con una nueva`);
  console.log(`                            ${resumen.filasYaMigradas} ya estaban migradas`);
  console.log(`  Rachas:                   ${resumen.rachasCopiadas} se copian, ${resumen.rachasQueQuedan} quedan (la nueva es más reciente)\n`);

  if (!escrituras.length) {
    console.log("✅ No queda nada que migrar.\n");
    return;
  }
  if (!escribir) {
    console.log(`🔍 Dry-run: ${escrituras.length} escrituras pendientes. Con --escribir se aplican.\n`);
    return;
  }

  for (let k = 0; k < escrituras.length; k += POR_LOTE) {
    const lote = db.batch();
    for (const e of escrituras.slice(k, k + POR_LOTE)) {
      lote.set(db.doc(e.ruta), e.datos, e.fusionar ? { merge: true } : {});
    }
    await lote.commit();
  }

  console.log(`✅ ${escrituras.length} escrituras hechas. Lo viejo quedó intacto, como respaldo.`);
  console.log("Una segunda corrida en seco tiene que decir que no queda nada que migrar.\n");
}

/** Sólo cuando se lo invoca directo. Rutas completas, no nombres de archivo. */
const invocadoDirecto =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invocadoDirecto) {
  principal().catch((e) => {
    console.error("\n❌ No se pudo migrar:", e.message);
    if (/could not load the default credentials/i.test(e.message)) {
      console.error("\nFalta autenticarse:\n   gcloud auth application-default login\n");
    }
    process.exit(1);
  });
}
