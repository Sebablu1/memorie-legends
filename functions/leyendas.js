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

import { repartoDe, REPARTOS, CAMPOS_SALDO } from "./reglas/economia.js";

/**
 * @param {object} deps
 * @param {object} deps.db            Firestore
 * @param {string} deps.usuarios      colección de perfiles
 * @param {string} deps.campoSaldo    campo del saldo TOTAL dentro del perfil
 * @param {string} deps.campoComprado campo de las Leyendas compradas con dinero
 * @param {string} deps.campoGanado   campo de las Leyendas ganadas jugando
 * @param {string} deps.movimientos   colección del libro mayor
 * @param {Function} deps.marcaDeTiempo  sello de servidor para el asiento
 * @param {Function} deps.error       (codigo, mensaje) => Error a lanzar
 */
export function crearMoverLeyendas({
  db,
  usuarios,
  campoSaldo,
  campoComprado = CAMPOS_SALDO.comprado,
  campoGanado = CAMPOS_SALDO.ganado,
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
  const refJugador = (uid) => db.collection(usuarios).doc(uid);
  const refAsiento = (clave) =>
    clave
      ? db.collection(movimientos).doc(clave)
      : db.collection(movimientos).doc();

  // ------------------------------------------------ los dos bolsillos

  /**
   * Los dos bolsillos de un perfil, incluso si todavía no los tiene.
   *
   * ─────────────────────────────────────────────────────────────────
   * EL `??` DE `ganado` ES LO QUE HACE QUE EL ORDEN NO IMPORTE
   * ─────────────────────────────────────────────────────────────────
   *
   * Un perfil de antes de la separación tiene `credits` y nada más. Sin este
   * respaldo, leerlo daría cero en los dos bolsillos y el jugador se
   * encontraría, de un despliegue al otro, con que no le alcanza para entrar
   * a una mesa que pagaba ayer.
   *
   * Derivarlo del espejo en vez de exigir la migración quita la dependencia
   * de orden entre correr el script y desplegar: con cualquiera de los dos
   * órdenes el saldo se lee bien. Y quita el hueco peligroso del medio —si la
   * migración corre y el despliegue tarda, las funciones viejas siguen
   * escribiendo sólo `credits` y los bolsillos quedarían atrás—.
   *
   * La migración pasa a ser prolijidad: deja el dato escrito en vez de
   * calculado. No es un requisito.
   */
  const bolsillosDe = (datos) => {
    const comprado = Number(datos?.[campoComprado] ?? 0);
    const ganado = Number(
      datos?.[campoGanado] ?? Math.max(0, Number(datos?.[campoSaldo] ?? 0) - comprado),
    );
    return { comprado, ganado };
  };

  /** Saca `falta` de un bolsillo y el resto del otro. Devuelve [dePrimero, deSegundo]. */
  const tomarDe = (primero, segundo, falta) => {
    const dePrimero = Math.min(primero, falta);
    return [dePrimero, falta - dePrimero];
  };

  /**
   * Cuánto toca cada bolsillo, según el motivo.
   *
   * Devuelve `{ dComprado, dGanado }`, los dos con el signo del movimiento.
   * No escribe nada: decide. Lo usan `moverLeyendas` y `moverVarias`, y está
   * acá una sola vez a propósito — dos copias de la lógica del dinero es una
   * que se arregla y otra que no.
   */
  function repartir({ delta, motivo, reparto, comprado, ganado }) {
    const regla = repartoDe(motivo);

    if (delta >= 0) {
      if (regla === REPARTOS.A_COMPRADO) return { dComprado: delta, dGanado: 0 };
      if (regla === REPARTOS.AL_ORIGEN) {
        // Sin `reparto`, todo vuelve a ganado: es lo comprado antes de que
        // existieran los bolsillos, y eso fue todo ganado por definición.
        const aComprado = Math.max(0, Math.min(delta, Number(reparto?.comprado ?? 0)));
        return { dComprado: aComprado, dGanado: delta - aComprado };
      }
      return { dComprado: 0, dGanado: delta };
    }

    const falta = -delta;

    if (regla === REPARTOS.SOLO_GANADO) {
      // La línea del reglamento. El mensaje dice los DOS números porque
      // "saldo insuficiente" sería mentira: saldo hay, del que no sirve acá.
      if (ganado < falta) {
        throw error(
          "failed-precondition",
          `Necesitás Leyendas ganadas jugando para esto. Tenés ${ganado} ganadas ` +
            `y ${comprado} compradas, y hacen falta ${falta} ganadas.`,
        );
      }
      return { dComprado: 0, dGanado: delta };
    }

    if (regla === REPARTOS.GANADO_PRIMERO) {
      const [deGanado, deComprado] = tomarDe(ganado, comprado, falta);
      return { dComprado: -deComprado, dGanado: -deGanado };
    }

    // COMPRADO_PRIMERO, y también A_GANADO/A_COMPRADO en negativo, que no se
    // usan hoy pero no pueden quedar sin definir.
    const [deComprado, deGanado] = tomarDe(comprado, ganado, falta);
    return { dComprado: -deComprado, dGanado: -deGanado };
  }

  /** Aplica el reparto a un perfil y devuelve los tres números nuevos. */
  function aplicar({ delta, motivo, reparto, comprado, ganado }) {
    const { dComprado, dGanado } = repartir({ delta, motivo, reparto, comprado, ganado });
    const compradoNuevo = comprado + dComprado;
    const ganadoNuevo = ganado + dGanado;

    if (compradoNuevo < 0 || ganadoNuevo < 0) {
      throw error(
        "failed-precondition",
        `Saldo insuficiente: tenés ${comprado + ganado} Leyendas y hacen falta ${-delta}.`,
      );
    }

    return {
      dComprado,
      dGanado,
      compradoNuevo,
      ganadoNuevo,
      // El espejo. Se escribe en la misma transacción que los bolsillos, así
      // que no puede quedar desfasado de ellos ni por un instante.
      saldoNuevo: compradoNuevo + ganadoNuevo,
    };
  }

  /** Los campos del perfil, listos para escribir. */
  const perfilCon = (r) => ({
    [campoComprado]: r.compradoNuevo,
    [campoGanado]: r.ganadoNuevo,
    [campoSaldo]: r.saldoNuevo,
  });

  /**
   * Varios movimientos en una sola transacción.
   *
   * Existe porque Firestore exige que TODAS las lecturas de una transacción
   * ocurran antes de cualquier escritura. Llamar a `moverLeyendas` dos veces
   * seguidas viola esa regla: la segunda lee después de que la primera
   * escribió, y la transacción entera falla.
   *
   * No es teórico. `salirDeSalaEnEspera` lo hacía en bucle: cuando el creador
   * salía de una sala con dos o más jugadores, la devolución de las entradas
   * reventaba. Nadie perdía Leyendas —la transacción no llega a confirmar—
   * pero tampoco las recuperaba.
   *
   * Acá se leen primero todos los saldos y todos los asientos, y recién
   * después se escribe. Si dos movimientos son del mismo jugador, el saldo se
   * va acumulando en memoria: no se lee dos veces ni se pisa.
   */
  async function moverVarias(tx, lista) {
    // --- fase 1: todas las lecturas ---
    const saldos = new Map();
    const yaAsentado = new Map();

    for (const m of lista) {
      if (!m.uid)
        throw error("internal", "Falta el jugador al mover Leyendas.");
      if (!Number.isInteger(m.delta)) {
        throw error("internal", "Las Leyendas se mueven en números enteros.");
      }
      if (m.idempotencia && !yaAsentado.has(m.idempotencia)) {
        yaAsentado.set(
          m.idempotencia,
          (await tx.get(refAsiento(m.idempotencia))).exists,
        );
      }
      if (!saldos.has(m.uid)) {
        const snap = await tx.get(refJugador(m.uid));
        saldos.set(m.uid, bolsillosDe(snap.exists ? snap.data() : null));
      }
    }

    // --- fase 2: todas las escrituras ---
    const resultados = [];
    for (const m of lista) {
      if (m.idempotencia && yaAsentado.get(m.idempotencia)) {
        resultados.push({ aplicado: false, saldo: null, saldoPrevio: null });
        continue;
      }
      // Los dos bolsillos se acumulan en memoria, igual que antes el saldo:
      // dos movimientos del mismo jugador en un lote no se leen dos veces.
      const { comprado, ganado } = saldos.get(m.uid);
      const saldoPrevio = comprado + ganado;

      const r = aplicar({
        delta: m.delta,
        motivo: m.motivo,
        reparto: m.reparto,
        comprado,
        ganado,
      });

      saldos.set(m.uid, { comprado: r.compradoNuevo, ganado: r.ganadoNuevo });
      // Dos movimientos con la misma clave en un mismo lote: el segundo se
      // salta, igual que si llegara en otra llamada.
      if (m.idempotencia) yaAsentado.set(m.idempotencia, true);

      tx.set(refJugador(m.uid), perfilCon(r), { merge: true });
      tx.set(refAsiento(m.idempotencia), {
        uid: m.uid,
        delta: m.delta,
        motivo: m.motivo,
        referencia: m.referencia ?? null,
        saldoPrevio,
        saldoNuevo: r.saldoNuevo,
        deltaComprado: r.dComprado,
        deltaGanado: r.dGanado,
        compradoPrevio: comprado,
        compradoNuevo: r.compradoNuevo,
        ganadoPrevio: ganado,
        ganadoNuevo: r.ganadoNuevo,
        creado: marcaDeTiempo(),
      });

      resultados.push({
        aplicado: true,
        saldo: r.saldoNuevo,
        saldoPrevio,
        comprado: r.compradoNuevo,
        ganado: r.ganadoNuevo,
        deltaComprado: r.dComprado,
        deltaGanado: r.dGanado,
      });
    }
    return resultados;
  }

  async function moverLeyendas(
    tx,
    { uid, delta, motivo, referencia = null, idempotencia = null, reparto = null },
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
    const { comprado, ganado } = bolsillosDe(snap.exists ? snap.data() : null);
    const saldoPrevio = comprado + ganado;

    const r = aplicar({ delta, motivo, reparto, comprado, ganado });

    tx.set(refJugador, perfilCon(r), { merge: true });

    tx.set(refAsiento, {
      uid,
      delta,
      motivo,
      referencia,
      saldoPrevio,
      saldoNuevo: r.saldoNuevo,
      // El detalle por bolsillo. Un cobro puede cruzar los dos —60 comprados
      // y 40 ganados para pagar 100— y sin esto el asiento diría "-100" sin
      // decir de dónde salió, que es justo lo que hay que poder auditar.
      deltaComprado: r.dComprado,
      deltaGanado: r.dGanado,
      compradoPrevio: comprado,
      compradoNuevo: r.compradoNuevo,
      ganadoPrevio: ganado,
      ganadoNuevo: r.ganadoNuevo,
      creado: marcaDeTiempo(),
    });

    return {
      aplicado: true,
      saldo: r.saldoNuevo,
      saldoPrevio,
      comprado: r.compradoNuevo,
      ganado: r.ganadoNuevo,
      deltaComprado: r.dComprado,
      deltaGanado: r.dGanado,
    };
  }

  /** Varios movimientos a la vez, respetando lecturas-antes-de-escrituras. */
  moverLeyendas.varias = moverVarias;

  return moverLeyendas;
}
