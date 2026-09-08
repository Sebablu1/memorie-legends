/**
 * Torneos: crear, inscribir, jugar, pagar.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE ESTE MÓDULO TIENE QUE IMPEDIR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Cuatro cosas, y todas son formas de sacar Leyendas de la nada:
 *
 *   1. Inscribirse dos veces pagando una. El documento de inscripción se llama
 *      como el jugador —`torneos/{id}/inscripciones/{uid}`—, así que dos
 *      pedidos simultáneos chocan en Firestore y sólo uno entra. Es la misma
 *      defensa que usa la compra de la tienda, por la misma razón.
 *   2. Cobrar sin anotar, o anotar sin cobrar. Las dos cosas pasan en la misma
 *      transacción; si una falla, no pasa ninguna.
 *   3. Devolver dos veces al cancelar. Cada devolución lleva su clave de
 *      idempotencia en el libro mayor, así que cancelar un torneo ya cancelado
 *      no paga de nuevo.
 *   4. Pagar más de lo que entró. El reparto lo calcula `reglas/torneos.js`
 *      redondeando hacia abajo, y `pruebas/torneos.mjs` comprueba que el pozo
 *      cierre exacto.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ LAS DEVOLUCIONES VAN DE A UNA TRANSACCIÓN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque un bucle de `moverLeyendas` DENTRO de una transacción ya rompió este
 * proyecto una vez: la primera vuelta lee y escribe en orden, la segunda lee
 * después de haber escrito, y Firestore aborta. Hay una prueba estática
 * —`pruebas/transacciones.mjs`— que hoy falla si alguien lo vuelve a escribir
 * así.
 *
 * Una transacción por jugador es más lenta y es correcta. Y como cada una
 * lleva su clave de idempotencia, si el proceso se corta a la mitad, correrlo
 * de nuevo termina el trabajo sin repetir lo ya hecho.
 */

import {
  ESTADOS,
  puedePasarA,
  esEditable,
  admiteInscripciones,
  hayQueDevolver,
  armarMesas,
  pozoDe,
  repartirPozo,
  puestosQueCobran,
  puntosDeTorneo,
  problemasDelTorneo,
} from "./reglas/torneos.js";

import {
  problemasDeEntrada,
  JUGADORES_POR_MESA,
  MINIMO_PARA_TORNEO,
} from "./reglas/configuracion.js";

export function crearTorneos({
  db,
  moverLeyendas,
  marcaDeTiempo,
  error,
  administradores,
  motivoEntrada,
  motivoPremio,
  motivoDevolucion,
  usuarios = "users",
  torneos = "torneos",
  inscripciones = "inscripciones",
  rankingCampeonato = "rankingCampeonato",
  incremento = null,
  // El azar del reparto de mesas. En producción es criptográfico; las pruebas
  // le pasan la identidad para poder afirmar quién queda en qué mesa.
  barajar = (x) => x,
  // Con qué clave se agrupa el ranking de campeonato. Se inyecta porque
  // depende del calendario y de la zona horaria, que ya resuelve `ranking.js`.
  claveDeSemana = () => "sin-semana",
  logger,
}) {
  const refTorneo = (id) => db.collection(torneos).doc(id);
  const refInscripcion = (id, uid) => refTorneo(id).collection(inscripciones).doc(uid);
  const refPerfil = (uid) => db.collection(usuarios).doc(uid);

  /** Lee un torneo o explica que no está. */
  async function leerTorneo(id) {
    const snap = await refTorneo(id).get();
    if (!snap.exists) throw error("not-found", "Ese torneo no existe.");
    return { id: snap.id, ...snap.data() };
  }

  /** Comprueba que el paso sea legal ANTES de tocar nada. */
  function exigirTransicion(torneo, hasta) {
    if (!puedePasarA(torneo.estado, hasta)) {
      throw error(
        "failed-precondition",
        `Un torneo en «${torneo.estado}» no puede pasar a «${hasta}».`,
      );
    }
  }

  /** Los uid inscriptos, en el orden en que se anotaron. */
  async function inscriptosDe(id) {
    const snap = await refTorneo(id).collection(inscripciones).get();
    const filas = [];
    snap.forEach((d) => filas.push({ uid: d.id, ...d.data() }));
    filas.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    return filas;
  }

  // ------------------------------------------------------------- crear

  /**
   * Crea un torneo en borrador.
   *
   * Nace cerrado a propósito: entre crearlo y abrirlo hay un rato para
   * corregir la entrada, y una entrada mal puesta en un torneo con gente
   * anotada ya no se puede arreglar sin devolver todo.
   */
  async function crear(context, datos) {
    await administradores.exigir(context);

    const torneo = {
      nombre: String(datos?.nombre ?? "").trim(),
      tipo: datos?.tipo === "semanal" ? "semanal" : "especial",
      entrada: Number(datos?.entrada),
      maxJugadores: Number.isInteger(datos?.maxJugadores) ? datos.maxJugadores : 10000,
    };

    const problemas = problemasDelTorneo(torneo, problemasDeEntrada);
    if (problemas.length) throw error("invalid-argument", problemas.join(" "));

    const ref = db.collection(torneos).doc();
    await ref.set({
      ...torneo,
      minJugadores: MINIMO_PARA_TORNEO,
      estado: ESTADOS.BORRADOR,
      inscriptos: 0,
      pozo: 0,
      mesas: [],
      ganadores: [],
      creadoEn: marcaDeTiempo(),
    });

    return { id: ref.id, ...torneo, estado: ESTADOS.BORRADOR };
  }

  /** Cambia lo que se pueda cambiar. Sólo en borrador. */
  async function editar(context, id, datos) {
    await administradores.exigir(context);
    const torneo = await leerTorneo(id);

    if (!esEditable(torneo.estado)) {
      throw error(
        "failed-precondition",
        "Sólo se puede editar un torneo en borrador: ya hay gente que pagó la entrada.",
      );
    }

    const cambios = {
      nombre: String(datos?.nombre ?? torneo.nombre).trim(),
      tipo: datos?.tipo === "semanal" ? "semanal" : "especial",
      entrada: Number(datos?.entrada ?? torneo.entrada),
      maxJugadores: Number.isInteger(datos?.maxJugadores) ? datos.maxJugadores : torneo.maxJugadores,
    };

    const problemas = problemasDelTorneo(cambios, problemasDeEntrada);
    if (problemas.length) throw error("invalid-argument", problemas.join(" "));

    await refTorneo(id).set({ ...cambios, actualizadoEn: marcaDeTiempo() }, { merge: true });
    return { id, ...cambios };
  }

  /** Publica el torneo: a partir de acá se cobra. */
  async function abrirInscripciones(context, id) {
    await administradores.exigir(context);
    const torneo = await leerTorneo(id);
    exigirTransicion(torneo, ESTADOS.INSCRIPCIONES_ABIERTAS);

    await refTorneo(id).set(
      { estado: ESTADOS.INSCRIPCIONES_ABIERTAS, abiertoEn: marcaDeTiempo() },
      { merge: true },
    );
    return { id, estado: ESTADOS.INSCRIPCIONES_ABIERTAS };
  }

  // --------------------------------------------------------- inscribir

  /**
   * Se anota y paga la entrada, todo en una transacción.
   *
   * El orden es el de siempre: primero TODAS las lecturas —el torneo y la
   * inscripción propia—, después el cobro y la anotación. Firestore rechaza lo
   * contrario, y el Firestore de mentira de las pruebas también.
   */
  async function inscribir(uid, id) {
    return db.runTransaction(async (tx) => {
      const snapTorneo = await tx.get(refTorneo(id));
      if (!snapTorneo.exists) throw error("not-found", "Ese torneo no existe.");
      const torneo = snapTorneo.data();

      const yaEstaba = await tx.get(refInscripcion(id, uid));

      if (!admiteInscripciones(torneo.estado)) {
        throw error("failed-precondition", "Las inscripciones de ese torneo no están abiertas.");
      }
      if (yaEstaba.exists) {
        throw error("already-exists", "Ya estás inscripto en ese torneo.");
      }

      const inscriptos = Number(torneo.inscriptos ?? 0);
      if (inscriptos >= Number(torneo.maxJugadores ?? 10000)) {
        throw error("resource-exhausted", "El torneo está lleno.");
      }

      const entrada = Number(torneo.entrada);
      if (!Number.isInteger(entrada) || entrada <= 0) {
        throw error("failed-precondition", "Ese torneo tiene una entrada inválida.");
      }

      const r = await moverLeyendas(tx, {
        uid,
        delta: -entrada,
        motivo: motivoEntrada,
        referencia: id,
        // Un reintento de red no cobra dos veces. El documento de inscripción
        // defiende del doble clic; esto, de la red que reintenta sola.
        idempotencia: `torneo_entrada_${id}_${uid}`,
      });

      tx.set(refInscripcion(id, uid), {
        entradaPagada: entrada,
        // El orden de llegada, para que armar las mesas sea reproducible y para
        // poder mostrar quién se anotó primero.
        orden: inscriptos,
        inscriptoEn: marcaDeTiempo(),
      });

      tx.set(
        refTorneo(id),
        { inscriptos: inscriptos + 1, pozo: (inscriptos + 1) * entrada },
        { merge: true },
      );

      return { id, entrada, saldo: r.saldo, inscriptos: inscriptos + 1 };
    });
  }

  /**
   * Cierra las inscripciones.
   *
   * Si no llegaron los cuatro mínimos, el torneo se CANCELA y se devuelve todo.
   * Jugar un "torneo" entre dos no es lo que la gente pagó, y dejarlo abierto
   * para siempre esperando un cuarto es peor: la entrada queda retenida sin
   * fecha.
   */
  async function cerrarInscripciones(context, id) {
    await administradores.exigir(context);
    const torneo = await leerTorneo(id);
    exigirTransicion(torneo, ESTADOS.COMPLETO);

    const anotados = await inscriptosDe(id);
    if (anotados.length < MINIMO_PARA_TORNEO) {
      const r = await cancelar(context, id, {
        motivo: `No llegaron los ${MINIMO_PARA_TORNEO} jugadores mínimos.`,
      });
      return { id, estado: ESTADOS.CANCELADO, cancelado: true, ...r };
    }

    await refTorneo(id).set(
      { estado: ESTADOS.COMPLETO, cerradoEn: marcaDeTiempo() },
      { merge: true },
    );
    return { id, estado: ESTADOS.COMPLETO, inscriptos: anotados.length };
  }

  /**
   * Arma las mesas y arranca.
   *
   * A los que sobran —los que no completan una mesa de cuatro— se les DEVUELVE
   * la entrada acá mismo. No se los sienta de quinto ni se arma una mesa de
   * dos: pagaron por jugar un torneo de cuatro.
   */
  async function iniciar(context, id) {
    await administradores.exigir(context);
    const torneo = await leerTorneo(id);
    exigirTransicion(torneo, ESTADOS.EN_CURSO);

    const anotados = await inscriptosDe(id);
    const { mesas, sobrantes } = armarMesas(
      anotados.map((a) => a.uid),
      { porMesa: JUGADORES_POR_MESA, barajar },
    );

    if (!mesas.length) {
      throw error("failed-precondition", "No alcanza para armar ni una mesa.");
    }

    // Una transacción por devolución. Ver la nota de la cabecera: un bucle de
    // `moverLeyendas` adentro de una sola transacción ya rompió esto una vez.
    const devueltos = [];
    for (const uid of sobrantes) {
      const hecho = await devolverUno(id, uid, torneo.entrada, `sobrante_${id}_${uid}`);
      if (hecho) devueltos.push(uid);
    }

    const juegan = mesas.length * JUGADORES_POR_MESA;
    await refTorneo(id).set(
      {
        estado: ESTADOS.EN_CURSO,
        mesas,
        sobrantes: devueltos,
        // El pozo se recalcula con los que EFECTIVAMENTE juegan: la plata de
        // los sobrantes ya volvió a su dueño y no se puede repartir.
        pozo: pozoDe(torneo.entrada, juegan),
        iniciadoEn: marcaDeTiempo(),
      },
      { merge: true },
    );

    return { id, estado: ESTADOS.EN_CURSO, mesas, devueltos, pozo: pozoDe(torneo.entrada, juegan) };
  }

  /**
   * Paga, suma puntos de campeonato y cierra.
   *
   * Los ganadores los carga el administrador porque las mesas de un torneo se
   * juegan en el propio juego y el resultado ya está en cada sala. Enlazar las
   * dos cosas automáticamente es lo que viene después; mientras tanto, esto
   * paga desde el servidor con el pozo del servidor, que es lo que importa: el
   * panel manda a QUIÉN, nunca CUÁNTO.
   */
  async function finalizar(context, id, ganadores) {
    await administradores.exigir(context);
    const torneo = await leerTorneo(id);
    exigirTransicion(torneo, ESTADOS.FINALIZADO);

    const lista = [...new Set((ganadores ?? []).map((g) => String(g ?? "").trim()).filter(Boolean))];
    if (!lista.length) throw error("invalid-argument", "Falta decir quién ganó.");

    // Que estén inscriptos. Sin esto, el panel podría pagarle a cualquiera.
    const inscriptosDelTorneo = await inscriptosDe(id);
    const anotados = new Set(inscriptosDelTorneo.map((a) => a.uid));
    for (const uid of lista) {
      if (!anotados.has(uid)) {
        throw error("invalid-argument", "Alguno de los ganadores no jugó este torneo.");
      }
    }

    /**
     * Cuánta gente jugó de verdad.
     *
     * Es lo que decide el TRAMO de reparto, y no se puede deducir de cuántos
     * nombres cargó el administrador: si carga tres en un torneo de veinte, el
     * tercero cobra el 20% que le toca a un torneo de veinte, no el 20% que le
     * tocaría a uno de doce.
     *
     * Se cuentan los que se sentaron a una mesa, no los inscriptos: a los que
     * sobraron al armar las mesas se les devolvió la entrada y su plata no
     * está en el fondo.
     */
    const jugaron = (torneo.mesas ?? []).flatMap((m) => m.jugadores ?? []);
    const cuantosJugaron = jugaron.length || inscriptosDelTorneo.length;

    const puestosPagados = puestosQueCobran(cuantosJugaron);
    if (lista.length > puestosPagados) {
      throw error(
        "invalid-argument",
        `Con ${cuantosJugaron} jugadores cobran ${puestosPagados} puestos, y se cargaron ${lista.length}.`,
      );
    }

    const { pagos, repartido, comisionCasa } = repartirPozo(
      Number(torneo.pozo ?? 0),
      lista,
      cuantosJugaron,
    );

    // De a una transacción, igual que las devoluciones.
    const pagados = [];
    for (const pago of pagos) {
      const r = await db.runTransaction((tx) =>
        moverLeyendas(tx, {
          uid: pago.uid,
          delta: pago.monto,
          motivo: motivoPremio,
          referencia: id,
          idempotencia: `torneo_premio_${id}_${pago.puesto}`,
        }),
      );
      pagados.push({ ...pago, pagado: r.aplicado });
    }

    // Puntos de campeonato para TODOS los que jugaron —los que no entraron en
    // puesto pagado suman los de participación— y, para el campeón, una
    // victoria de torneo más: cinco de ésas son la insignia «Campeón».
    const semana = claveDeSemana();
    for (const p of puntosDeTorneo(lista, jugaron.length ? jugaron : [...anotados])) {
      await db
        .collection(rankingCampeonato)
        .doc(semana)
        .collection("jugadores")
        .doc(p.uid)
        .set(
          {
            puntos: incremento ? incremento(p.puntos) : p.puntos,
            torneos: incremento ? incremento(1) : 1,
            actualizadoEn: marcaDeTiempo(),
          },
          { merge: true },
        );
    }

    if (lista[0] && incremento) {
      await refPerfil(lista[0]).set({ torneosGanados: incremento(1) }, { merge: true });
    }

    await refTorneo(id).set(
      {
        estado: ESTADOS.FINALIZADO,
        ganadores: lista,
        jugaron: cuantosJugaron,
        puestosPagados,
        premios: pagados,
        repartido,
        comisionCasa,
        semanaCampeonato: semana,
        finalizadoEn: marcaDeTiempo(),
      },
      { merge: true },
    );

    logger?.info?.("Torneo finalizado", { id, repartido, comisionCasa, ganadores: lista });
    return {
      id,
      estado: ESTADOS.FINALIZADO,
      premios: pagados,
      repartido,
      comisionCasa,
      // Sale para arriba porque el panel lo muestra: «12 jugadores, 3 puestos
      // pagados» es lo que deja comprobar de un vistazo que se repartió por el
      // tramo que correspondía.
      jugaron: cuantosJugaron,
      puestosPagados,
    };
  }

  // -------------------------------------------------------- cancelar

  /** Una devolución, con su propia transacción y su clave. Devuelve si pagó. */
  async function devolverUno(id, uid, entrada, clave) {
    const monto = Number(entrada);
    if (!Number.isInteger(monto) || monto <= 0) return false;

    try {
      const r = await db.runTransaction((tx) =>
        moverLeyendas(tx, {
          uid,
          delta: monto,
          motivo: motivoDevolucion,
          referencia: id,
          idempotencia: clave,
        }),
      );
      return r.aplicado;
    } catch (e) {
      // Una devolución que falla no puede frenar las otras. Se registra para
      // poder repetirla: la clave de idempotencia hace que reintentar sea
      // seguro.
      logger?.error?.("No se pudo devolver una entrada", { torneo: id, uid, error: e.message });
      return false;
    }
  }

  /**
   * Cancela y devuelve todo.
   *
   * Se puede correr de nuevo sin miedo: cada devolución lleva su clave, así que
   * la segunda pasada no paga otra vez. Eso importa porque cancelar un torneo
   * con cien inscriptos son cien transacciones, y algo se puede cortar en el
   * medio.
   */
  async function cancelar(context, id, { motivo = "" } = {}) {
    await administradores.exigir(context);
    const torneo = await leerTorneo(id);
    exigirTransicion(torneo, ESTADOS.CANCELADO);

    let devueltos = 0;
    if (hayQueDevolver(torneo.estado)) {
      for (const a of await inscriptosDe(id)) {
        const hecho = await devolverUno(
          id,
          a.uid,
          a.entradaPagada ?? torneo.entrada,
          `torneo_devolucion_${id}_${a.uid}`,
        );
        if (hecho) devueltos++;
      }
    }

    await refTorneo(id).set(
      {
        estado: ESTADOS.CANCELADO,
        motivoCancelacion: String(motivo ?? "").slice(0, 300),
        devueltos,
        canceladoEn: marcaDeTiempo(),
      },
      { merge: true },
    );

    logger?.info?.("Torneo cancelado", { id, devueltos, motivo });
    return { id, estado: ESTADOS.CANCELADO, devueltos };
  }

  // ----------------------------------------------------------- lectura

  /** Los torneos, para el panel y para el jugador. */
  async function listar({ soloAbiertos = false } = {}) {
    const snap = await db.collection(torneos).get();
    const filas = [];
    snap.forEach((d) => filas.push({ id: d.id, ...d.data() }));

    const visibles = soloAbiertos
      ? filas.filter((t) => admiteInscripciones(t.estado))
      : filas;

    // Por fecha de creación descendente. Se ordena en memoria porque son
    // decenas de documentos y un índice de Firestore para esto no se paga.
    return visibles.sort((a, b) => String(b.creadoEn ?? "").localeCompare(String(a.creadoEn ?? "")));
  }

  /** Un torneo con sus inscriptos. Sólo para el panel. */
  async function detalle(context, id) {
    await administradores.exigir(context);
    const torneo = await leerTorneo(id);
    return { ...torneo, inscriptos: await inscriptosDe(id) };
  }

  return {
    crear,
    editar,
    abrirInscripciones,
    inscribir,
    cerrarInscripciones,
    iniciar,
    finalizar,
    cancelar,
    listar,
    detalle,
  };
}
