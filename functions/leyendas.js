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
 * Los repartos que COBRAN: sacan del saldo y nunca acreditan.
 *
 * Si uno de sus motivos llega con un número positivo, es una devolución
 * disfrazada de cobro, y ése fue exactamente el agujero: las entradas de sala
 * se devolvían como `ENTRADA_PARTIDA` en positivo, y lo positivo iba entero a
 * lo ganado aunque se hubiera pagado con compradas.
 */
const COBRAN = new Set([
  REPARTOS.SOLO_GANADO,
  REPARTOS.COMPRADO_PRIMERO,
  REPARTOS.GANADO_PRIMERO,
]);

/**
 * Cuánto de una devolución vuelve a lo COMPRADO, según el cobro que deshace.
 *
 * `cobro` es el asiento del cobro original —el que guarda `deltaComprado`—, y
 * `monto` lo que se devuelve. Lo comprado se devuelve en la misma proporción
 * en que se cobró: una entrada de 100 pagada con 60 compradas y 40 ganadas
 * vuelve 60 y 40. Si se devuelve parte —un artículo de un pack—, la parte
 * comprada es proporcional.
 *
 * El redondeo va hacia lo comprado, y a propósito: lo que sobre de una
 * división nunca puede terminar en lo ganado, que es la dirección que se está
 * cerrando. Y nunca vuelve a lo comprado más de lo que el cobro sacó de ahí.
 *
 * Sin cobro, o con uno de antes de los bolsillos, todo vuelve a lo ganado: en
 * esa época no había otra cosa. Es la regla de siempre, pero ahora sale de un
 * dato —el asiento no tiene bolsillos— y no de que alguien se olvidó de un
 * parámetro.
 */
export function repartoSegunOrigen(cobro, monto) {
  const total = -Number(cobro?.delta);
  const comprado = -Number(cobro?.deltaComprado);
  if (!(total > 0) || !Number.isFinite(comprado)) return { comprado: 0 };

  const parte = Math.ceil((Number(monto) * comprado) / total);
  return { comprado: Math.min(comprado, Math.max(0, parte)) };
}

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

    /**
     * Los dos candados de las devoluciones.
     *
     * Un cobro no acredita: con un número positivo es una devolución que no
     * dice de dónde salió la plata. Y una devolución no cobra, y siempre
     * trae su reparto, que casi siempre sale del cobro que deshace —ver
     * `origen`—. Sin ellos, olvidarse de decir de dónde vino algo mandaba la
     * devolución entera a lo ganado sin avisar: así pasaron inadvertidas la
     * de las salas y la de los artículos de la tienda.
     */
    if (delta > 0 && COBRAN.has(regla)) {
      throw error(
        "internal",
        `«${motivo}» es un cobro y no puede acreditar. Una devolución va con su ` +
          "propio motivo y dice qué cobro deshace.",
      );
    }
    if (regla === REPARTOS.AL_ORIGEN && delta < 0) {
      throw error("internal", `«${motivo}» es una devolución y no puede cobrar.`);
    }
    if (regla === REPARTOS.AL_ORIGEN && delta > 0 && !reparto) {
      throw error(
        "internal",
        `«${motivo}» es una devolución y no dice qué cobro deshace.`,
      );
    }

    if (delta >= 0) {
      if (regla === REPARTOS.A_COMPRADO) return { dComprado: delta, dGanado: 0 };
      if (regla === REPARTOS.AL_ORIGEN) {
        // El reparto llega siempre —lo exige el candado de arriba— y casi
        // siempre sale del cobro que se deshace: ver `repartoSegunOrigen`.
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

    /**
     * `A_GANADO` y `A_COMPRADO` nombran UN bolsillo, en las dos direcciones.
     *
     * Antes caían en el reparto de abajo cuando el delta era negativo, así que
     * un movimiento «a ganado» de −10 salía de lo COMPRADO. Ningún motivo los
     * usaba en negativo, así que no rompía nada — hasta que el ajuste de
     * administrador los estrenó y habría movido el bolsillo equivocado sin
     * decir una palabra.
     *
     * Un movimiento que dice a qué bolsillo va tiene que salir de ese mismo
     * bolsillo cuando resta. Si no alcanza, se rechaza: completarlo con el
     * otro sería exactamente el silencio que se quiere evitar.
     */
    if (regla === REPARTOS.A_GANADO || regla === REPARTOS.A_COMPRADO) {
      const esGanado = regla === REPARTOS.A_GANADO;
      const hay = esGanado ? ganado : comprado;
      if (hay < falta) {
        throw error(
          "failed-precondition",
          `No alcanzan las Leyendas ${esGanado ? "ganadas" : "compradas"}: ` +
            `hay ${hay} y hacen falta ${falta}.`,
        );
      }
      return esGanado ? { dComprado: 0, dGanado: delta } : { dComprado: delta, dGanado: 0 };
    }

    // COMPRADO_PRIMERO.
    const [deComprado, deGanado] = tomarDe(comprado, ganado, falta);
    return { dComprado: -deComprado, dGanado: -deGanado };
  }

  /**
   * El reparto de una devolución que nombra el cobro que deshace.
   *
   * El cobro tiene que ser un cobro —un número negativo— y de la misma
   * persona. Las dos comprobaciones son baratas y cierran el error que no
   * haría ruido: una clave equivocada que apunta a la entrada de OTRO
   * jugador devolvería con los bolsillos de otro.
   *
   * Si el asiento no existe, no es un error: es una entrada de antes del
   * libro mayor, y `repartoSegunOrigen` la manda a lo ganado.
   */
  function repartoDelOrigen({ uid, delta, origen }, snapCobro) {
    const cobro = snapCobro?.exists ? snapCobro.data() : null;
    if (cobro && cobro.uid !== uid) {
      throw error(
        "internal",
        `La devolución a ${uid} dice deshacer ${origen}, que es de otra persona.`,
      );
    }
    if (cobro && !(Number(cobro.delta) < 0)) {
      throw error("internal", `${origen} no es un cobro: una devolución sólo deshace cobros.`);
    }
    return repartoSegunOrigen(cobro, delta);
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
    // Los cobros que deshacen las devoluciones del lote. Se leen acá, con
    // todo lo demás: en la fase 2 ya se escribió y Firestore no deja leer.
    const cobros = new Map();

    for (const m of lista) {
      if (!m.uid)
        throw error("internal", "Falta el jugador al mover Leyendas.");
      if (!Number.isInteger(m.delta)) {
        throw error("internal", "Las Leyendas se mueven en números enteros.");
      }
      if (m.origen && m.reparto) {
        throw error("internal", "Una devolución dice su origen o su reparto, no las dos cosas.");
      }
      if (m.origen && !cobros.has(m.origen)) {
        cobros.set(m.origen, await tx.get(refAsiento(m.origen)));
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

    // El reparto de cada devolución, todavía sin escribir nada: si un cobro
    // no cuadra, el lote entero se cae antes de tocar un saldo.
    const planes = lista.map((m) => ({
      ...m,
      reparto: m.origen ? repartoDelOrigen(m, cobros.get(m.origen)) : (m.reparto ?? null),
    }));

    // --- fase 2: todas las escrituras ---
    const resultados = [];
    for (const m of planes) {
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
        // Qué cobro deshace, si es una devolución.
        ...(m.origen ? { origen: m.origen } : {}),
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
    {
      uid, delta, motivo, referencia = null, idempotencia = null, reparto = null,
      // La clave del cobro que deshace, si esto es una devolución.
      origen = null,
    },
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

    if (origen && reparto) {
      throw error("internal", "Una devolución dice su origen o su reparto, no las dos cosas.");
    }
    // La última lectura: después de ésta, `aplicar` decide y se escribe.
    const repartoFinal = origen
      ? repartoDelOrigen(
          { uid, delta, origen },
          await tx.get(db.collection(movimientos).doc(origen)),
        )
      : reparto;

    const r = aplicar({ delta, motivo, reparto: repartoFinal, comprado, ganado });

    tx.set(refJugador, perfilCon(r), { merge: true });

    tx.set(refAsiento, {
      uid,
      delta,
      motivo,
      referencia,
      ...(origen ? { origen } : {}),
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
