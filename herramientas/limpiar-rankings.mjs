/**
 * Borra filas del ranking —de una persona o de todas— sin tocar la economía.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PARA QUÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Las cuentas de prueba jugaron partidas por Leyendas y quedaron en las
 * tablas. Antes de abrir el juego, el ranking tiene que empezar limpio: que
 * una cuenta de prueba no le gane el mes a nadie.
 *
 * Lo que se borra es la FILA entera —la tabla deja de mostrarla, no la deja
 * en cero— y, si se limpia a alguien en todos los períodos, su racha.
 *
 * Lo que NO se toca, a propósito:
 *
 *   · `movimientos/` y el saldo. Las Leyendas que se pagaron en pruebas
 *     quedan donde están: un libro mayor se corrige con asientos nuevos, no
 *     borrando los viejos.
 *   · `users/`: los premios físicos anotados y `mejorPuestoMensual`, que es
 *     de donde sale la insignia Leyenda.
 *   · Las salas, las partidas y `rankingCampeonato`, que es el de torneos.
 *   · `partidasPuntuadas/`. Es el guardián que impide puntuar dos veces la
 *     misma partida: si se borrara, un reintento podría volver a sumar la
 *     fila que se acaba de limpiar.
 *
 * Y para que eso no dependa de acordarse, `verificarRutas` frena cualquier
 * plan que quiera borrar algo fuera de las dos formas permitidas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA RACHA ES DEL JUGADOR, NO DEL PERÍODO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `jugadores/{uid}/rachas/actual` es una sola por jugador, y de ahí sale la
 * `rachaActual` de las tres tablas. Con `--periodo` se borra la fila de ese
 * período y la racha queda: borrarla cambiaría las filas de los otros dos
 * desde la próxima partida. Sin `--periodo`, se va con las filas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CÓMO SE SABE SI UN PERÍODO SE PAGÓ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Sin mirar el libro mayor. `cerrarPeriodo` deja dos marcas: `cerrado: true`
 * en `rankings/{clave}` cuando termina, y `premiado: true` en cada fila que
 * cobra, en la misma transacción que acredita. Con la primera, el período se
 * pagó; con filas premiadas y sin la primera, el cierre se cortó a medias.
 *
 * Un período abierto no tiene documento: sólo sus filas. Por eso se listan con
 * `listDocuments()`, que los encuentra igual; una consulta no.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * USO
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   node herramientas/limpiar-rankings.mjs --email prueba@x.com
 *   node herramientas/limpiar-rankings.mjs --uid abc123 --periodo mensual
 *   node herramientas/limpiar-rankings.mjs --todo --escribir
 *
 * Exactamente uno de --email, --uid o --todo. Sin --escribir sólo muestra lo
 * que haría. Correrla dos veces no rompe nada: la segunda no encuentra qué
 * borrar.
 *
 * Hace falta estar autenticado contra el proyecto:
 *   gcloud auth application-default login
 */

import { pathToFileURL } from "node:url";

const PROYECTO = "memorie-legends";

/** Firestore admite 500 escrituras por lote. */
const POR_LOTE = 400;

export const PERIODOS = ["semanal", "mensual", "anual"];

/**
 * Dónde vive cada cosa. En un solo lugar a propósito: cuando los rankings
 * pasen a ser por juego, cambian acá y en ningún otro lado.
 */
export const RUTAS = Object.freeze({
  rankings: "rankings",
  filas: "jugadores",
  fila: (clave, uid) => `rankings/${clave}/jugadores/${uid}`,
  racha: (uid) => `jugadores/${uid}/rachas/actual`,
});

/** Lo ÚNICO que esta herramienta puede borrar. */
const PERMITIDAS = [/^rankings\/[^/]+\/jugadores\/[^/]+$/, /^jugadores\/[^/]+\/rachas\/actual$/];

export const AVISO_CERRADO = "Los premios de este período ya se pagaron. No se revierten.";
export const AVISO_A_MEDIAS =
  "El cierre de este período quedó a medias: algunos ya cobraron y otros no. Si se " +
  "reintenta el cierre después de borrar, los puestos se recalculan sin estas filas y " +
  "puede cobrar alguien que antes no llegaba.";

// ------------------------------------------------------------ argumentos

/**
 * Los argumentos, entendidos o rechazados.
 *
 * Un filtro, exactamente: sin ninguno no hay a quién limpiar, y con dos no se
 * sabe a quién. `--todo` tiene que estar escrito: borrar a todo el mundo no
 * puede ser lo que pasa cuando uno se olvidó de un argumento.
 */
export function leerArgumentos(argv) {
  const valor = (nombre) => {
    const i = argv.indexOf(`--${nombre}`);
    if (i < 0) return null;
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) throw new Error(`Falta el valor de --${nombre}.`);
    return v;
  };

  const email = valor("email");
  const uid = valor("uid");
  const todo = argv.includes("--todo");
  const periodo = valor("periodo");
  const escribir = argv.includes("--escribir");

  const filtros = [email && "--email", uid && "--uid", todo && "--todo"].filter(Boolean);
  if (filtros.length === 0) {
    throw new Error("Falta a quién limpiar: --email, --uid o --todo.");
  }
  if (filtros.length > 1) {
    throw new Error(`Uno solo de --email, --uid o --todo; vinieron ${filtros.join(" y ")}.`);
  }
  if (periodo !== null && !PERIODOS.includes(periodo)) {
    throw new Error(`Período desconocido: ${periodo}. Son ${PERIODOS.join(", ")}.`);
  }

  return { email, uid, todo, periodo, escribir };
}

// ------------------------------------------------------------------ plan

/** El tipo de un período, por su clave: `mensual_2026-09` → `mensual`. */
const tipoDe = (clave) => String(clave).split("_")[0];

/** Frena todo si alguna ruta no es de las que se pueden borrar. */
export function verificarRutas(rutas) {
  const ajenas = rutas.filter((r) => !PERMITIDAS.some((p) => p.test(r)));
  if (ajenas.length) {
    throw new Error(
      `Este plan quiere borrar algo que no es una fila del ranking ni una racha: ` +
        `${ajenas.slice(0, 5).join(", ")}. No se borra nada.`,
    );
  }
  return rutas;
}

/**
 * Qué se borra, y qué hay que saber antes. No toca nada: decide.
 *
 * @param datos.periodos  [{ clave, doc, filas: [{ uid, datos }] }], con `doc`
 *                        en null si el período no tiene documento (abierto)
 * @param datos.rachas    uids que tienen racha
 * @param filtros         { uid, todo, periodo }: el email ya resuelto a uid
 */
export function planDeLimpieza({ periodos, rachas }, { uid = null, todo = false, periodo = null }) {
  const tocados = [];

  for (const p of periodos) {
    if (periodo && tipoDe(p.clave) !== periodo) continue;

    const filas = p.filas ?? [];
    const aBorrar = filas.filter((f) => todo || f.uid === uid);
    if (!aBorrar.length) continue;

    const cerrado = p.doc?.cerrado === true;
    const aMedias = !cerrado && filas.some((f) => f.datos?.premiado === true);

    /**
     * Lo que cada fila borrada ya se llevó, dicho con nombre.
     *
     * No se revierte nada de esto —es justo lo que la herramienta no toca—,
     * pero quien la corre tiene que saber qué queda afuera de la limpieza.
     */
    const detalles = [];
    for (const f of aBorrar) {
      const d = f.datos ?? {};
      if (d.premiado === true) {
        detalles.push(`${f.uid} cobró el puesto ${d.puesto ?? "?"}: esas Leyendas quedan en su saldo.`);
      }
      if (d.premioFisico) {
        detalles.push(`${f.uid} tiene anotado el premio «${d.premioFisico}» en su perfil: queda.`);
      }
    }

    tocados.push({
      clave: p.clave,
      tipo: tipoDe(p.clave),
      estado: cerrado ? "cerrado" : aMedias ? "a medias" : "abierto",
      aviso: cerrado ? AVISO_CERRADO : aMedias ? AVISO_A_MEDIAS : null,
      antes: filas.length,
      aBorrar: aBorrar.map((f) => f.uid),
      quedan: filas.length - aBorrar.length,
      detalles,
    });
  }

  // La racha es del jugador en los tres períodos: con un período elegido,
  // queda. Ver la cabecera.
  const candidatas = todo ? [...rachas] : rachas.filter((r) => r === uid);
  const rachasABorrar = periodo ? [] : candidatas;
  const rachasQueQuedan = periodo ? candidatas : [];

  const rutas = verificarRutas([
    ...tocados.flatMap((t) => t.aBorrar.map((u) => RUTAS.fila(t.clave, u))),
    ...rachasABorrar.map((u) => RUTAS.racha(u)),
  ]);

  return {
    periodos: tocados,
    rachas: rachasABorrar,
    rachasQueQuedan,
    rutas,
    total: { filas: tocados.reduce((s, t) => s + t.aBorrar.length, 0), rachas: rachasABorrar.length },
  };
}

// ------------------------------------------------------------- informe

function informar(plan, { quien, periodo }) {
  console.log(`A quién: ${quien}`);
  console.log(`Períodos: ${periodo ? `sólo los ${periodo}es` : "los tres"}\n`);

  if (!plan.periodos.length && !plan.rachas.length) {
    console.log("✅ No hay nada que borrar.\n");
    return;
  }

  for (const t of plan.periodos) {
    console.log(
      `  ${t.clave.padEnd(20)} ${t.estado.padEnd(9)} había ${t.antes} · ` +
        `se borran ${t.aBorrar.length} · quedan ${t.quedan}`,
    );
    if (t.aviso) console.log(`     ⚠️  ${t.aviso}`);
    for (const d of t.detalles) console.log(`     · ${d}`);
  }

  if (plan.rachas.length) {
    console.log(`\n  Rachas: se borran ${plan.rachas.length}.`);
  }
  if (plan.rachasQueQuedan.length) {
    console.log(
      `\n  Rachas: quedan ${plan.rachasQueQuedan.length}. Con --periodo la racha no se toca: ` +
        "es del jugador en los tres períodos, y borrarla cambiaría los otros dos.",
    );
  }

  console.log(`\n  En total: ${plan.total.filas} filas y ${plan.total.rachas} rachas.\n`);
}

// ------------------------------------------------------------- programa

async function principal() {
  const args = leerArgumentos(process.argv.slice(2));

  const { initializeApp, applicationDefault } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { getAuth } = await import("firebase-admin/auth");

  initializeApp({ credential: applicationDefault(), projectId: PROYECTO });
  const db = getFirestore();

  console.log(
    args.escribir
      ? "\n⚠️  MODO ESCRITURA: se borran filas del ranking.\n"
      : "\n🔍 Dry-run. No se borra nada. Agregá --escribir para aplicar.\n",
  );

  // --------------------------------------------------------- a quién
  let uid = args.uid;
  if (args.email) {
    const usuario = await getAuth().getUserByEmail(args.email);
    uid = usuario.uid;
  }
  const quien = args.todo ? "todos" : args.email ? `${args.email} (${uid})` : uid;

  // ------------------------------------------------------ lo que hay
  const refsPeriodos = await db.collection(RUTAS.rankings).listDocuments();
  const periodos = [];
  for (const ref of refsPeriodos) {
    if (args.periodo && tipoDe(ref.id) !== args.periodo) continue;
    const doc = await ref.get();
    const filas = await ref.collection(RUTAS.filas).get();
    periodos.push({
      clave: ref.id,
      doc: doc.exists ? doc.data() : null,
      filas: filas.docs.map((d) => ({ uid: d.id, datos: d.data() })),
    });
  }

  const rachas = [];
  if (args.todo) {
    for (const ref of await db.collection("jugadores").listDocuments()) {
      if ((await db.doc(RUTAS.racha(ref.id)).get()).exists) rachas.push(ref.id);
    }
  } else if ((await db.doc(RUTAS.racha(uid)).get()).exists) {
    rachas.push(uid);
  }

  // ------------------------------------------------------------ plan
  const plan = planDeLimpieza({ periodos, rachas }, { uid, todo: args.todo, periodo: args.periodo });
  informar(plan, { quien, periodo: args.periodo });

  if (!plan.rutas.length) return;
  if (!args.escribir) {
    console.log("🔍 Dry-run: no se borró nada. Con --escribir se aplica.\n");
    return;
  }

  // ---------------------------------------------------------- borrar
  for (let i = 0; i < plan.rutas.length; i += POR_LOTE) {
    const lote = db.batch();
    for (const ruta of plan.rutas.slice(i, i + POR_LOTE)) lote.delete(db.doc(ruta));
    await lote.commit();
  }

  // -------------------------------------------- y lo que quedó, de verdad
  console.log("Después de borrar:");
  for (const t of plan.periodos) {
    const quedan = (await db.collection(`${RUTAS.rankings}/${t.clave}/${RUTAS.filas}`).get()).size;
    console.log(`  ${t.clave.padEnd(20)} quedan ${quedan}`);
  }
  console.log(`\n✅ Borradas ${plan.total.filas} filas y ${plan.total.rachas} rachas.`);
  console.log("Correrla de nuevo tiene que decir que no hay nada que borrar.\n");
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
