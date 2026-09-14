/**
 * De dónde salió cada Leyenda de una cuenta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SÓLO LEE. NUNCA ESCRIBE.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * No hay un solo `set`, `update` ni `delete` en este archivo: únicamente
 * `.get()`. Es a propósito y conviene que se note, porque la pregunta que
 * contesta —«¿este saldo está bien?»— es justo la que tienta a arreglar el
 * saldo de paso. Ajustar saldos es trabajo de `moverLeyendas`, que deja
 * asiento; una herramienta de auditoría que además corrige es una que ensucia
 * la evidencia que vino a mirar.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ LA AUDITORÍA SE COMPRUEBA SOLA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Cada asiento de `movimientos/` guarda `saldoPrevio` y `saldoNuevo`, no sólo
 * el `delta`. Eso convierte al libro mayor en una CADENA: el `saldoPrevio` de
 * cada asiento tiene que ser el `saldoNuevo` del anterior, y el último
 * `saldoNuevo` tiene que ser el saldo que hoy tiene el perfil.
 *
 * Si la cadena cierra, el saldo está explicado hasta el último peso y no hay
 * nada que discutir. Si se corta, el corte dice exactamente dónde y cuánto:
 * alguien escribió `credits` sin pasar por `moverLeyendas`, que es la única
 * puerta que debería poder mover saldo. Esa diferencia —entre «es raro» y
 * «acá faltan 40 entre el 3 y el 4 de septiembre»— es todo el punto.
 *
 * Un perfil sin ningún asiento y con saldo distinto de las Leyendas de
 * registro es el mismo hallazgo, en su forma más pura.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE ORDENA EN MEMORIA Y NO EN LA CONSULTA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un `where('uid','==',…).orderBy('creado')` necesita un índice compuesto que
 * este proyecto no tiene, y la consulta falla pidiendo que lo crees. Los
 * movimientos de UNA cuenta son pocos: se traen filtrados por uid —que usa el
 * índice de un solo campo que Firestore mantiene solo— y se ordenan acá.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * USO
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   node herramientas/auditar-leyendas.mjs --email alguien@ejemplo.com
 *   node herramientas/auditar-leyendas.mjs --uid AbC123...
 *
 * Hace falta estar autenticado contra el proyecto. Cualquiera de las dos:
 *
 *   gcloud auth application-default login
 *   set GOOGLE_APPLICATION_CREDENTIALS=C:\ruta\a\la\clave.json
 */

const PROYECTO = "memorie-legends";
const USUARIOS = "users";
const MOVIMIENTOS = "movimientos";
const CAMPO_SALDO = "credits";

/** Las Leyendas con las que nace una cuenta, para explicar el primer asiento. */
const LEYENDAS_REGISTRO = 100;

function argumento(nombre) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const fecha = (valor) => {
  if (!valor) return "(sin fecha)";
  const d = typeof valor.toDate === "function" ? valor.toDate() : new Date(valor);
  return Number.isNaN(d.getTime()) ? "(sin fecha)" : d.toISOString().replace("T", " ").slice(0, 19);
};

const conSigno = (n) => (n > 0 ? `+${n}` : String(n));

async function principal() {
  const email = argumento("email");
  let uid = argumento("uid");

  if (!email && !uid) {
    console.error("\nFalta a quién auditar:\n");
    console.error("  node herramientas/auditar-leyendas.mjs --email alguien@ejemplo.com");
    console.error("  node herramientas/auditar-leyendas.mjs --uid AbC123...\n");
    process.exit(1);
  }

  const { initializeApp, applicationDefault } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { getAuth } = await import("firebase-admin/auth");

  initializeApp({ credential: applicationDefault(), projectId: PROYECTO });
  const db = getFirestore();

  if (!uid) {
    const usuario = await getAuth().getUserByEmail(email);
    uid = usuario.uid;
    console.log(`\n${email} → ${uid}`);
  }

  // ---------------------------------------------------------- el perfil

  const perfil = await db.collection(USUARIOS).doc(uid).get();
  if (!perfil.exists) {
    console.error(`\n❌ No existe el perfil ${uid}.\n`);
    process.exit(1);
  }
  const saldoHoy = Number(perfil.data()[CAMPO_SALDO] ?? 0);
  const nombre = perfil.data().username ?? "(sin nombre)";

  console.log(`\nCuenta: ${nombre}`);
  console.log(`Saldo actual: ${saldoHoy} Leyendas\n`);

  // ------------------------------------------------------ el libro mayor

  const asientos = (await db.collection(MOVIMIENTOS).where("uid", "==", uid).get()).docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const ta = a.creado?.toMillis?.() ?? 0;
      const tb = b.creado?.toMillis?.() ?? 0;
      return ta - tb;
    });

  if (!asientos.length) {
    console.log("No hay NINGÚN movimiento anotado para esta cuenta.\n");
    console.log(
      saldoHoy === LEYENDAS_REGISTRO
        ? `Y el saldo es exactamente el de registro (${LEYENDAS_REGISTRO}), así que cierra:\n` +
          "el perfil lo crea el cliente al registrarse y eso no pasa por el libro mayor.\n"
        : `⚠️  Pero el saldo es ${saldoHoy}, y el de registro es ${LEYENDAS_REGISTRO}.\n` +
          `Hay ${saldoHoy - LEYENDAS_REGISTRO} Leyendas sin asiento que las explique.\n`,
    );
    return;
  }

  console.log(`${asientos.length} movimientos:\n`);
  console.log("  fecha                delta      saldo         motivo");
  console.log("  " + "─".repeat(72));

  const cortes = [];
  let esperado = null;

  for (const a of asientos) {
    const previo = Number(a.saldoPrevio ?? 0);
    const nuevo = Number(a.saldoNuevo ?? 0);

    if (esperado !== null && previo !== esperado) {
      cortes.push({ id: a.id, fecha: fecha(a.creado), esperado, previo, hueco: previo - esperado });
    }
    esperado = nuevo;

    const ref = a.referencia ? ` · ${a.referencia}` : "";
    console.log(
      `  ${fecha(a.creado)}  ${conSigno(Number(a.delta ?? 0)).padStart(7)}` +
        `  ${String(previo).padStart(5)}→${String(nuevo).padEnd(6)}` +
        `  ${a.motivo ?? "(sin motivo)"}${ref}`,
    );
  }

  // ------------------------------------------------------- el veredicto

  const primero = Number(asientos[0].saldoPrevio ?? 0);
  const ultimo = Number(asientos[asientos.length - 1].saldoNuevo ?? 0);

  console.log("\n" + "─".repeat(74));
  console.log(`Arranca en ${primero} y termina en ${ultimo}. El perfil dice ${saldoHoy}.\n`);

  let limpio = true;

  if (cortes.length) {
    limpio = false;
    console.log(`⚠️  La cadena se corta en ${cortes.length} lugar(es):\n`);
    for (const c of cortes) {
      console.log(
        `   ${c.fecha}  se esperaba venir de ${c.esperado} y viene de ${c.previo}` +
          `  (${conSigno(c.hueco)} sin asiento)`,
      );
    }
    console.log("\n   Eso es saldo movido SIN pasar por `moverLeyendas`.\n");
  }

  if (ultimo !== saldoHoy) {
    limpio = false;
    console.log(
      `⚠️  El último asiento deja ${ultimo} pero el perfil tiene ${saldoHoy}:` +
        ` ${conSigno(saldoHoy - ultimo)} sin explicar.\n`,
    );
  }

  if (primero !== 0 && primero !== LEYENDAS_REGISTRO) {
    console.log(
      `ℹ️  El primer asiento parte de ${primero}, que no es 0 ni las ${LEYENDAS_REGISTRO}` +
        " del registro. Puede ser normal si la cuenta es anterior al libro mayor.\n",
    );
  }

  if (limpio) {
    console.log("✅ La cadena cierra: cada Leyenda del saldo tiene su asiento.\n");
  }
}

principal().catch((e) => {
  console.error("\n❌ No se pudo auditar:", e.message);
  if (/could not load the default credentials/i.test(e.message)) {
    console.error("\nFalta autenticarse. Cualquiera de las dos:\n");
    console.error("   gcloud auth application-default login");
    console.error("   set GOOGLE_APPLICATION_CREDENTIALS=C:\\ruta\\a\\la\\clave.json\n");
  }
  process.exit(1);
});
