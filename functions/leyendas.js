/**
 * El único punto por el que se mueven Leyendas.
 *
 * Vivía dentro de `index.js`. Se saca acá por dos razones:
 *
 *  - para poder probarlo de verdad, contra un Firestore de mentira, en vez
 *    de confiar en que está bien porque se lee bien;
 *  - para que cada operación económica nueva tenga que pasar por esta puerta.
 *    Si alguna función escribiera `credits` por su cuenta, quedaría a la
 *    vista: sería la única que no importa este módulo.
 *
 * Las dependencias se inyectan para que las pruebas puedan sustituirlas. En
 * producción las provee `index.js` con el Firestore y el reloj reales.
 */

/**
 * @param {object} deps
 * @param {object} deps.db            Firestore
 * @param {string} deps.usuarios      colección de perfiles
 * @param {string} deps.campoSaldo    campo del saldo dentro del perfil
 * @param {string} deps.movimientos   colección del libro mayor
 * @param {Function} deps.marcaDeTiempo  sello de servidor para el asiento
 * @param {Function} deps.error       (codigo, mensaje) => Error a lanzar
 */
export function crearMoverLeyendas({
  db,
  usuarios,
  campoSaldo,
  movimientos = "movimientos",
  marcaDeTiempo,
  error,
}) {
  /**
   * Mueve `delta` Leyendas y deja el asiento correspondiente, todo dentro de
   * la transacción que se le pasa: nunca hay saldo sin respaldo ni asiento
   * sin saldo.
   *
   * `idempotencia` es lo que hace que un reintento no cobre dos veces. Si ya
   * existe un asiento con esa clave, la operación no toca nada y avisa que no
   * se aplicó. Como la lectura de esa clave ocurre dentro de la transacción,
   * dos ejecuciones simultáneas no pueden pasar las dos: Firestore aborta la
   * segunda al ver que el documento que había leído cambió.
   *
   * @returns {Promise<{aplicado: boolean, saldo: number|null, saldoPrevio: number|null}>}
   */
  return async function moverLeyendas(
    tx,
    { uid, delta, motivo, referencia = null, idempotencia = null },
  ) {
    if (!uid) throw error("internal", "Falta el jugador al mover Leyendas.");
    if (!Number.isInteger(delta)) {
      throw error("internal", "Las Leyendas se mueven en números enteros.");
    }

    const refJugador = db.collection(usuarios).doc(uid);
    const refAsiento = idempotencia
      ? db.collection(movimientos).doc(idempotencia)
      : db.collection(movimientos).doc();

    if (idempotencia) {
      const yaEstaba = await tx.get(refAsiento);
      if (yaEstaba.exists) {
        return { aplicado: false, saldo: null, saldoPrevio: null };
      }
    }

    const snap = await tx.get(refJugador);
    const saldoPrevio = snap.exists ? (snap.data()[campoSaldo] ?? 0) : 0;
    const saldoNuevo = saldoPrevio + delta;

    if (saldoNuevo < 0) {
      throw error(
        "failed-precondition",
        `Saldo insuficiente: tenés ${saldoPrevio} Leyendas y hacen falta ${-delta}.`,
      );
    }

    tx.set(refJugador, { [campoSaldo]: saldoNuevo }, { merge: true });

    tx.set(refAsiento, {
      uid,
      delta,
      motivo,
      referencia,
      saldoPrevio,
      saldoNuevo,
      creado: marcaDeTiempo(),
    });

    return { aplicado: true, saldo: saldoNuevo, saldoPrevio };
  };
}
