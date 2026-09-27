/**
 * Borra los perfiles de `users` que no tienen cuenta en Authentication, y el
 * rastro que dejan en `movimientos`.
 *
 *   node herramientas/borrar-perfiles-huerfanos.mjs --esperados 13
 *   node herramientas/borrar-perfiles-huerfanos.mjs --esperados 13 --aplicar --respaldo <archivo.json>
 *   node herramientas/borrar-perfiles-huerfanos.mjs --solo-movimientos [--aplicar]
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ ES UN HUÉRFANO, Y POR QUÉ NO ALCANZA CON RESETEARLO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un documento en `users/{uid}` cuyo uid no existe en Authentication. Nadie
 * puede entrar con él —la cuenta no está— y nadie puede leerlo: la regla de
 * Firestore deja leer un perfil sólo a su dueño, y acá no hay dueño posible.
 *
 * Resetearlos en vez de borrarlos parecía más prudente y es peor. Ponerles
 * saldo los vuelve INDESTRUIBLES desde el panel: `eliminarCuentaAdmin`, en
 * `functions/admin.js`, no borra una cuenta con saldo o partidas, la desactiva.
 * Así que un huérfano con 100 Leyendas se queda para siempre en la lista de
 * usuarios y en cualquier estadística que salga de ahí.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ TAMBIÉN BORRA MOVIMIENTOS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque no hacerlo ya nos pasó. La primera versión borraba `users` y sus
 * subcolecciones, y dejó 39 asientos en `movimientos` apuntando a perfiles que
 * acababan de desaparecer: el mismo problema de huérfanos, una capa más abajo.
 *
 * `movimientos` es una colección aparte, no una subcolección del perfil, así
 * que hay que ir a buscarla a propósito. Un borrado que no limpia el libro
 * mayor no termina el trabajo, lo mueve de lugar.
 *
 * Borrar asientos no puede causar un cobro doble: las claves de idempotencia
 * son por sala y por período —`entrada_ABC234_uid`, `devolucion_…`— y ninguna
 * se repite para un jugador que ya no existe.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ `--esperados` NO TIENE VALOR POR OMISIÓN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Tenía 13 escrito adentro, que era el número del día que se usó. Un número
 * de ayer dentro de una herramienta de borrado es peor que ninguno: el día que
 * no coincida, quien la corra va a cambiarlo para que pase en vez de mirar por
 * qué cambió.
 *
 * Ahora hay que decirlo en la línea de comandos. Obliga a contar antes, que es
 * justamente el paso que uno se saltea.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO NO SE MEZCLA CON EL RESET
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Son dos criterios distintos sobre la misma colección. Juntarlos en una
 * herramienta hace que equivocarse en uno arrastre al otro, y borrar no se
 * deshace con un `git revert`.
 *
 * Esta herramienta NUNCA toca un perfil con cuenta de Auth. Los excluidos del
 * reset tienen cuenta, así que ya están protegidos por esa sola regla; igual
 * se los nombra y se comprueba, porque una protección que depende de un
 * razonamiento es peor que una escrita.
 */

import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { EXCLUIDOS } from "./resetear-cuentas.mjs";

const PROYECTO = "memorie-legends";

/**
 * Qué borrar. No toca nada: decide.
 *
 * @param documentos [{ uid, datos, tieneCuentaDeAuth, subdocumentos }]
 * @param esperados  cuántos huérfanos se espera encontrar. Obligatorio si hay.
 */
export function planDeBorrado(documentos, { esperados } = {}) {
  const protegidos = new Set(EXCLUIDOS.map((e) => e.uid));
  const huerfanos = documentos.filter((d) => !d.tieneCuentaDeAuth);

  // Una red que no debería hacer falta nunca: un excluido tiene cuenta, así
  // que no puede ser huérfano. Si algún día lo fuera, se para en seco.
  const protegidoHuerfano = huerfanos.find((d) => protegidos.has(d.uid));
  if (protegidoHuerfano) {
    throw new Error(
      `${protegidoHuerfano.uid} está en la lista de excluidos y aparece sin cuenta de Auth. ` +
        "Eso no debería pasar. No se borra nada.",
    );
  }

  if (huerfanos.length > 0) {
    if (esperados === undefined || esperados === null || Number.isNaN(Number(esperados))) {
      throw new Error(
        `Hay ${huerfanos.length} perfil(es) huérfano(s) y falta decir cuántos se esperaban. ` +
          `Agregá --esperados ${huerfanos.length} si ése es el número. No se borra nada.`,
      );
    }
    if (huerfanos.length !== Number(esperados)) {
      throw new Error(
        `Se esperaban ${esperados} perfiles huérfanos y hay ${huerfanos.length}. ` +
          "Revisá antes de borrar: borrar no se deshace. No se borra nada.",
      );
    }
  }

  return {
    borrados: huerfanos.map((d) => ({
      uid: d.uid,
      nombre: d.datos?.username,
      correo: d.datos?.email,
      credits: d.datos?.credits,
      subdocumentos: d.subdocumentos ?? [],
      movimientos: d.movimientos ?? [],
    })),
    intactos: documentos.length - huerfanos.length,
  };
}

/**
 * Qué asientos del libro mayor quedaron sin perfil. No toca nada: decide.
 *
 * Sirve para dos cosas: limpiar de paso lo que borra `planDeBorrado`, y barrer
 * lo que quedó suelto de un borrado anterior que no los miró.
 *
 * @param movimientos   [{ id, uid }]
 * @param uidsConPerfil Set de los uid que SÍ tienen documento en `users`
 */
export function planDeMovimientosSueltos(movimientos, uidsConPerfil) {
  const protegidos = new Set(EXCLUIDOS.map((e) => e.uid));

  const sueltos = movimientos.filter((m) => {
    // Sin uid no se toca: no se puede afirmar que sea huérfano, y en la duda
    // un asiento del libro mayor se conserva.
    if (typeof m.uid !== "string" || !m.uid) return false;
    if (protegidos.has(m.uid)) return false;
    return !uidsConPerfil.has(m.uid);
  });

  const porDueño = new Map();
  for (const m of sueltos) porDueño.set(m.uid, (porDueño.get(m.uid) ?? 0) + 1);

  const sinUid = movimientos.filter((m) => typeof m.uid !== "string" || !m.uid).length;

  return { sueltos, porDueño, sinUid, conservados: movimientos.length - sueltos.length };
}

// ------------------------------------------------------------- programa

async function principal() {
  const argv = process.argv.slice(2);
  const aplicar = argv.includes("--aplicar") || argv.includes("--apply") || argv.includes("--escribir");
  const soloMovimientos = argv.includes("--solo-movimientos");
  const iR = argv.indexOf("--respaldo");
  const respaldo = iR >= 0 ? argv[iR + 1] : null;
  const iE = argv.indexOf("--esperados");
  const esperados = iE >= 0 ? Number(argv[iE + 1]) : undefined;

  if (aplicar && !soloMovimientos && !respaldo) {
    throw new Error("Para borrar perfiles hace falta --respaldo <archivo.json>. Sin respaldo no se borra.");
  }

  const { initializeApp, applicationDefault } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { getAuth } = await import("firebase-admin/auth");
  initializeApp({ credential: applicationDefault(), projectId: PROYECTO });
  const db = getFirestore();
  const auth = getAuth();

  console.log(
    aplicar
      ? "\n⚠️  MODO ESCRITURA: se BORRA. Esto no se deshace.\n"
      : "\n🔍 En seco. No se borra nada. Agregá --aplicar para aplicar.\n",
  );

  const { users } = await auth.listUsers(1000);
  const vivos = new Set(users.map((u) => u.uid));
  const snap = await db.collection("users").get();
  const uidsConPerfil = new Set(snap.docs.map((d) => d.id));

  const todosLosMovimientos = (await db.collection("movimientos").get()).docs.map((m) => ({
    id: m.id,
    uid: m.data()?.uid,
    ref: m.ref,
  }));

  // ------------------------------------------------- los perfiles huérfanos
  let plan = { borrados: [], intactos: snap.size };
  if (!soloMovimientos) {
    const documentos = [];
    for (const d of snap.docs) {
      const subdocumentos = [];
      for (const c of await d.ref.listCollections()) {
        for (const s of (await c.get()).docs) subdocumentos.push({ subcoleccion: c.id, id: s.id });
      }
      documentos.push({
        uid: d.id,
        datos: d.data(),
        tieneCuentaDeAuth: vivos.has(d.id),
        subdocumentos,
        movimientos: todosLosMovimientos.filter((m) => m.uid === d.id),
      });
    }
    plan = planDeBorrado(documentos, { esperados });

    // Un respaldo al que le falte uno es peor que no tenerlo: da confianza y
    // no cubre.
    if (aplicar && plan.borrados.length) {
      const r = JSON.parse(readFileSync(respaldo, "utf8"));
      const guardados = new Set((r?.documentos ?? []).map((d) => d.uid));
      const faltan = plan.borrados.filter((b) => !guardados.has(b.uid));
      if (faltan.length) {
        throw new Error(
          `El respaldo ${respaldo} no tiene ${faltan.length} de los perfiles a borrar: ` +
            `${faltan.map((f) => f.uid).join(", ")}. No se borra nada.`,
        );
      }
      console.log(`Respaldo: ${respaldo} — tiene los ${plan.borrados.length}, comprobado uno por uno.\n`);
    }

    console.log(`Perfiles: ${snap.size} · se borran ${plan.borrados.length} · quedan ${plan.intactos}\n`);
    let sub = 0, movs = 0;
    for (const b of plan.borrados) {
      sub += b.subdocumentos.length;
      movs += b.movimientos.length;
      console.log(`  - users/${b.uid}`);
      console.log(`      «${b.nombre}»  ${JSON.stringify(b.correo)}  credits=${b.credits}`);
      for (const s of b.subdocumentos) console.log(`      - users/${b.uid}/${s.subcoleccion}/${s.id}`);
      if (b.movimientos.length) console.log(`      - ${b.movimientos.length} movimiento(s)`);
    }
    if (plan.borrados.length) {
      console.log(`\n  ${plan.borrados.length} perfil(es) + ${sub} subdocumento(s) + ${movs} movimiento(s)\n`);
    } else {
      console.log("  No hay perfiles huérfanos.\n");
    }
  }

  // --------------------------------------- el libro mayor que quedó suelto
  // Se mira lo que quedaría SIN los perfiles que este mismo plan borra.
  const quedaran = new Set(uidsConPerfil);
  for (const b of plan.borrados) quedaran.delete(b.uid);
  const mov = planDeMovimientosSueltos(todosLosMovimientos, quedaran);

  console.log(`Libro mayor: ${todosLosMovimientos.length} asiento(s) · sin perfil detrás ${mov.sueltos.length} · quedan ${mov.conservados}\n`);
  for (const [uid, n] of [...mov.porDueño].sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${uid}  ${n} movimiento(s)`);
  }
  if (mov.sinUid) console.log(`\n  ${mov.sinUid} asiento(s) sin campo uid: NO se tocan, en la duda se conservan.`);

  if (!plan.borrados.length && !mov.sueltos.length) {
    console.log("\n✅ No hay nada que borrar.\n");
    return;
  }
  if (!aplicar) {
    console.log(`\n🔍 En seco: nada de esto se borró.\n`);
    return;
  }

  // ------------------------------------------------------------ escribir
  // Firestore NO borra en cascada: si se borra el padre y queda un documento
  // en `items`, ese documento sigue existiendo y es inalcanzable. Primero los
  // hijos, después el padre.
  let perfiles = 0;
  for (const b of plan.borrados) {
    const ref = db.collection("users").doc(b.uid);
    for (const c of await ref.listCollections()) {
      for (const s of (await c.get()).docs) await s.ref.delete();
    }
    await ref.delete();
    perfiles++;
  }
  for (const m of mov.sueltos) await m.ref.delete();

  console.log(`\n✅ ${perfiles} perfil(es) y ${mov.sueltos.length} movimiento(s) borrados.\n`);
}

const invocadoDirecto =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invocadoDirecto) {
  principal().catch((e) => {
    console.error(`\n❌ No se borró nada: ${e.message}\n`);
    process.exit(1);
  });
}
