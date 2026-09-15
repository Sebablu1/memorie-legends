/**
 * Escribe los dos bolsillos en los perfiles que todavía tienen un solo saldo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NO ES UN REQUISITO. ES PROLIJIDAD.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `moverLeyendas` deriva los bolsillos del espejo cuando el perfil no los
 * tiene: un perfil con `credits: 300` y nada más se lee como 300 ganadas y
 * funciona igual, torneos incluidos. Esta herramienta no arregla nada roto;
 * deja el dato ESCRITO en vez de calculado.
 *
 * Eso importa por dos motivos. El primero es que un campo calculado al vuelo
 * no se puede consultar: no hay forma de preguntarle a Firestore cuántas
 * Leyendas compradas hay en circulación si el campo no existe en los
 * documentos. El segundo es que el respaldo es una red, y una red que se usa
 * todos los días deja de parecer una red.
 *
 * Como no es un requisito, el orden con el despliegue no importa. Se puede
 * correr antes, después, o las dos veces.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ RECALCULA EN VEZ DE SALTEAR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La versión obvia saltea los perfiles que ya tienen `creditosGanados`. Ésta
 * los recalcula: `ganados = credits − comprados`.
 *
 * La diferencia aparece si alguien juega entre la migración y el despliegue.
 * Las funciones viejas escriben sólo `credits`, así que ese perfil queda con
 * los bolsillos atrasados y el espejo al día. Salteándolo, la deriva se queda
 * para siempre; recalculando, correrla de nuevo la corrige.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Y POR QUÉ SE NIEGA A CORRER CUANDO ALGUIEN YA COMPRÓ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque a partir de ahí el recálculo deja de ser exacto. `credits − comprados`
 * supone que todo lo que no está marcado como comprado es ganado, y eso vale
 * mientras nadie haya pagado nunca. Con una sola compra acreditada, la cuenta
 * correcta ya no se puede deducir del perfil: hay que reconstruirla del libro
 * mayor, sumando los movimientos por bolsillo.
 *
 * Así que antes de escribir mira si algún perfil tiene `creditosComprados > 0`
 * y, si lo encuentra, se detiene y lo dice. Es un cerrojo de una sola
 * dirección: esta herramienta sirve una vez, y después estorba.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * USO
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   node herramientas/migrar-saldos.mjs              (dry-run, no escribe)
 *   node herramientas/migrar-saldos.mjs --escribir   (aplica)
 *
 * Hace falta estar autenticado contra el proyecto:
 *   gcloud auth application-default login
 */

const PROYECTO = "memorie-legends";
const USUARIOS = "users";

const CAMPO_TOTAL = "credits";
const CAMPO_COMPRADO = "creditosComprados";
const CAMPO_GANADO = "creditosGanados";

/** Cuántos perfiles por lote. Firestore admite 500 escrituras por lote. */
const POR_LOTE = 400;

const escribir = process.argv.includes("--escribir");

/**
 * Qué habría que escribir. No toca nada: decide.
 *
 * Está separada del resto —y exportada— para poder probarla sin Firestore ni
 * credenciales. Una migración es código que corre UNA vez, sobre los datos de
 * todos, y que nadie mira mientras lo hace: es justo la clase de código donde
 * "lo leí y estaba bien" no alcanza.
 *
 * @param {Array<{uid: string, datos: object}>} perfiles
 */
export function planDeMigracion(perfiles) {
  const yaCompraron = [];
  const cambios = [];
  let yaEstaban = 0;

  for (const { uid, datos } of perfiles) {
    const comprado = Number(datos?.[CAMPO_COMPRADO] ?? 0);
    if (comprado > 0) yaCompraron.push({ uid, comprado });
  }

  // El cerrojo manda: con una sola compra acreditada no hay plan posible.
  if (yaCompraron.length) return { yaCompraron, cambios: [], yaEstaban: 0 };

  for (const { uid, datos } of perfiles) {
    const total = Number(datos?.[CAMPO_TOTAL] ?? 0);
    const comprado = Number(datos?.[CAMPO_COMPRADO] ?? 0);
    const ganado = Math.max(0, total - comprado);

    const tieneGanado = typeof datos?.[CAMPO_GANADO] === "number";
    const tieneComprado = typeof datos?.[CAMPO_COMPRADO] === "number";

    if (tieneGanado && tieneComprado && datos[CAMPO_GANADO] === ganado) {
      yaEstaban++;
      continue;
    }

    cambios.push({
      uid,
      total,
      antes: tieneGanado ? Number(datos[CAMPO_GANADO]) : null,
      ganado,
      comprado,
    });
  }

  return { yaCompraron, cambios, yaEstaban };
}

async function principal() {
  const { initializeApp, applicationDefault } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");

  initializeApp({ credential: applicationDefault(), projectId: PROYECTO });
  const db = getFirestore();

  console.log(
    escribir
      ? "\n⚠️  MODO ESCRITURA: esto modifica los perfiles.\n"
      : "\n🔍 Dry-run. No se escribe nada. Agregá --escribir para aplicar.\n",
  );

  const perfiles = await db.collection(USUARIOS).get();
  console.log(`${perfiles.size} perfiles.\n`);

  // ------------------------------------------------- qué habría que hacer

  const refs = new Map();
  const lista = [];
  perfiles.forEach((d) => {
    refs.set(d.id, d.ref);
    lista.push({ uid: d.id, datos: d.data() });
  });

  const { yaCompraron, cambios, yaEstaban } = planDeMigracion(lista);
  for (const c of cambios) c.ref = refs.get(c.uid);

  if (yaCompraron.length) {
    console.error(`❌ ${yaCompraron.length} perfiles ya tienen Leyendas compradas:\n`);
    for (const p of yaCompraron.slice(0, 10)) {
      console.error(`   ${p.uid}: ${p.comprado} compradas`);
    }
    if (yaCompraron.length > 10) console.error(`   … y ${yaCompraron.length - 10} más`);
    console.error(
      "\nEl recálculo `ganados = credits − comprados` supone que nadie compró\n" +
        "nunca. Con compras acreditadas hay que reconstruirlo del libro mayor,\n" +
        "sumando `deltaComprado` y `deltaGanado` de `movimientos/`.\n",
    );
    process.exit(1);
  }

  console.log(`  ${yaEstaban} ya tenían los bolsillos al día.`);
  console.log(`  ${cambios.length} para escribir.\n`);

  if (!cambios.length) {
    console.log("✅ No hay nada que hacer.\n");
    return;
  }

  // Los que cambian de valor —y no los que simplemente no tenían el campo—
  // son los interesantes: son deriva, no migración. Se muestran siempre.
  const deriva = cambios.filter((c) => c.antes !== null && c.antes !== c.ganado);
  if (deriva.length) {
    console.log(`  ⚠️  ${deriva.length} con los bolsillos DESFASADOS del espejo:`);
    for (const c of deriva.slice(0, 10)) {
      console.log(`     ${c.uid}: ganados ${c.antes} → ${c.ganado} (credits ${c.total})`);
    }
    console.log("");
  }

  for (const c of cambios.slice(0, 15)) {
    console.log(
      `     ${c.uid.padEnd(30)} credits ${String(c.total).padStart(6)}` +
        ` → ${c.comprado} compradas + ${c.ganado} ganadas`,
    );
  }
  if (cambios.length > 15) console.log(`     … y ${cambios.length - 15} más`);

  if (!escribir) {
    console.log("\n🔍 Dry-run: no se escribió nada. Con --escribir se aplica.\n");
    return;
  }

  // ------------------------------------------------- escribir

  let escritos = 0;
  for (let i = 0; i < cambios.length; i += POR_LOTE) {
    const lote = db.batch();
    for (const c of cambios.slice(i, i + POR_LOTE)) {
      // `merge` con los dos campos y nada más: `credits` NO se toca, porque ya
      // es la suma correcta. Escribirlo sería arriesgarse a pisarlo con un
      // valor viejo si alguien jugó mientras esto corría.
      lote.set(c.ref, { [CAMPO_COMPRADO]: c.comprado, [CAMPO_GANADO]: c.ganado }, { merge: true });
      escritos++;
    }
    await lote.commit();
    console.log(`  lote de ${Math.min(POR_LOTE, cambios.length - i)} escrito.`);
  }

  console.log(`\n✅ ${escritos} perfiles migrados.\n`);
  console.log("Comprobá con:");
  console.log("   node herramientas/auditar-leyendas.mjs --email tu@email.com\n");
}

// Sólo cuando se lo invoca directo: importarlo para probar `planDeMigracion`
// no tiene que intentar hablar con Firestore.
const invocadoDirecto =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());

if (invocadoDirecto) {
  principal().catch((e) => {
    console.error("\n❌ No se pudo migrar:", e.message);
    if (/could not load the default credentials/i.test(e.message)) {
      console.error("\nFalta autenticarse:\n   gcloud auth application-default login\n");
    }
    process.exit(1);
  });
}
