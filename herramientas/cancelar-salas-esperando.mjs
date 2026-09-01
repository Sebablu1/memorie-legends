// herramientas/cancelar-salas-esperando.mjs
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

// Importar desde las ubicaciones CORRECTAS
import { crearMoverLeyendas } from "../functions/leyendas.js";
import { MOTIVOS } from "../functions/reglas/economia.js";

// Inicializar Firebase Admin (requiere GOOGLE_APPLICATION_CREDENTIALS)
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = getFirestore();

// Crear la función moverLeyendas con las dependencias reales
const moverLeyendas = crearMoverLeyendas({
  db,
  usuarios: "users",
  campoSaldo: "credits",
  movimientos: "movimientos",
  marcaDeTiempo: admin.firestore.FieldValue.serverTimestamp,
  error: (codigo, mensaje) => {
    const err = new Error(mensaje);
    err.code = codigo;
    return err;
  },
});

async function cancelarSalasEnEspera() {
  const snapshot = await db
    .collection("rooms")
    .where("estado", "==", "waiting")
    .get();

  if (snapshot.empty) {
    console.log("✅ No hay salas en espera.");
    return;
  }

  const devoluciones = [];

  for (const doc of snapshot.docs) {
    const sala = doc.data();
    const codigo = sala.codigo || doc.id;
    const jugadores = sala.jugadores || [];
    const entrada = sala.entrada || 0;

    if (jugadores.length === 0) {
      await doc.ref.update({ estado: "cancelled" });
      console.log(`✅ Sala ${codigo} cancelada (sin jugadores).`);
      continue;
    }

    for (const jugador of jugadores) {
      devoluciones.push({
        uid: jugador.id,
        delta: entrada,
        motivo: MOTIVOS.DEVOLUCION,
        referencia: codigo,
        idempotencia: `devolucion-${codigo}-${jugador.id}-${Date.now()}`,
      });
    }

    await doc.ref.update({ estado: "cancelled" });
    console.log(
      `⏳ Sala ${codigo} marcada como cancelada. Devolviendo ${entrada} a ${jugadores.length} jugador(es).`,
    );
  }

  if (devoluciones.length > 0) {
    await db.runTransaction(async (tx) => {
      await moverLeyendas.varias(tx, devoluciones);
    });
    console.log(`✅ ${devoluciones.length} devoluciones ejecutadas.`);
  }

  console.log("✅ Todas las salas en espera han sido canceladas.");
}

cancelarSalasEnEspera()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Error:", err);
    process.exit(1);
  });
