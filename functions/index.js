/**
 * Cloud Functions de Memorie Legends.
 *
 * Todo lo que toca Leyendas vive acá y NUNCA en el navegador: saldos, apuestas,
 * ruleta, bonos, premios de ranking y acreditación de compras. El cliente sólo
 * pide; el servidor decide y escribe.
 *
 * Reglas de Firestore que acompañan a esto (ver firestore.rules): las
 * colecciones de dinero y ranking son de sólo lectura para el cliente.
 */

import functions from "firebase-functions/v1";
import admin from "firebase-admin";
import crypto from "node:crypto";

import {
  LEYENDAS_REGISTRO,
  BONO_DIARIO,
  LEYENDAS_POR_REFERIDO,
  girarRuleta,
  esperaRuleta,
  esperaBonoDiario,
  calcularReparto,
  premioPorPuesto,
  paquetePorId,
  leyendasDePaquete,
  NIVELES_APUESTA,
  MOTIVOS,
  MONEDA,
} from "./reglas/economia.js";

import {
  ENTRADAS,
  MAX_JUGADORES,
  MIN_JUGADORES,
  ESTADOS_SALA,
  esEntradaValida,
  puedeUnirse,
  generarCodigo,
  esCodigoValido,
} from "./reglas/salas.js";

import {
  PERIODOS,
  clavesDePeriodos,
  clavePeriodo,
  esPartidaPuntuable,
  puntosDePartida,
  acumularFila,
  filaVacia,
  ZONA_POR_DEFECTO,
} from "./reglas/ranking.js";

admin.initializeApp();
const db = admin.firestore();

const ZONA = ZONA_POR_DEFECTO;

/**
 * Modelo de datos REAL de la aplicación. El perfil y el saldo viven en
 * `users/{uid}.credits`, que es lo que el login viene escribiendo desde
 * siempre. No se crea ninguna colección paralela.
 */
const USUARIOS = "users";
const CAMPO_SALDO = "credits";

// ------------------------------------------------------------ libro mayor

/**
 * Único punto por el que se mueven Leyendas. Escribe el saldo y un asiento
 * en el libro mayor dentro de la misma transacción, para que nunca haya
 * saldo sin respaldo ni asiento sin saldo.
 *
 * `idempotencia` evita que un reintento acredite dos veces: si ya existe un
 * asiento con esa clave, la operación no hace nada.
 */
async function moverLeyendas(tx, { uid, delta, motivo, referencia = null, idempotencia = null }) {
  const refJugador = db.collection(USUARIOS).doc(uid);

  if (idempotencia) {
    const refAsiento = db.collection("movimientos").doc(idempotencia);
    const yaEstaba = await tx.get(refAsiento);
    if (yaEstaba.exists) return { aplicado: false, saldo: null };
  }

  const snap = await tx.get(refJugador);
  const saldoPrevio = snap.exists ? (snap.data()[CAMPO_SALDO] ?? 0) : 0;
  const saldoNuevo = saldoPrevio + delta;

  if (saldoNuevo < 0) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      `Saldo insuficiente: tenés ${saldoPrevio} Leyendas y hacen falta ${-delta}.`,
    );
  }

  tx.set(refJugador, { [CAMPO_SALDO]: saldoNuevo }, { merge: true });

  const refAsiento = idempotencia
    ? db.collection("movimientos").doc(idempotencia)
    : db.collection("movimientos").doc();

  tx.set(refAsiento, {
    uid,
    delta,
    motivo,
    referencia,
    saldoPrevio,
    saldoNuevo,
    creado: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { aplicado: true, saldo: saldoNuevo };
}

const exigirSesion = (context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Iniciá sesión para continuar.");
  }
  return context.auth.uid;
};

// --------------------------------------------------------------- registro

// El perfil lo crea el propio cliente al registrarse, con las 100 Leyendas
// de bienvenida, y las reglas de Firestore fijan ese valor exacto. No se
// duplica acá para no tener dos caminos de creación.

// ------------------------------------------------------------ bono diario

export const reclamarBonoDiario = functions.https.onCall(async (_data, context) => {
  const uid = exigirSesion(context);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(db.collection(USUARIOS).doc(uid));
    const ultimo = snap.exists ? snap.data().ultimoBonoDiario : null;
    const restante = esperaBonoDiario(ultimo?.toDate?.() ?? ultimo, Date.now());

    if (restante > 0) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Todavía no: faltan ${Math.ceil(restante / 60000)} minutos.`,
      );
    }

    const r = await moverLeyendas(tx, { uid, delta: BONO_DIARIO, motivo: MOTIVOS.BONO_DIARIO });
    tx.set(
      db.collection(USUARIOS).doc(uid),
      { ultimoBonoDiario: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true },
    );
    return { leyendas: BONO_DIARIO, saldo: r.saldo };
  });
});

// ---------------------------------------------------------------- ruleta

/** Aleatoriedad criptográfica: el premio no puede depender de Math.random. */
const azarSeguro = () => crypto.randomInt(0, 2 ** 48) / 2 ** 48;

export const girarLaRuleta = functions.https.onCall(async (_data, context) => {
  const uid = exigirSesion(context);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(db.collection(USUARIOS).doc(uid));
    const ultimo = snap.exists ? snap.data().ultimoGiroRuleta : null;
    const restante = esperaRuleta(ultimo?.toDate?.() ?? ultimo, Date.now());

    if (restante > 0) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `La ruleta vuelve en ${Math.ceil(restante / 3600000)} horas.`,
      );
    }

    // El premio se sortea en el servidor: el cliente sólo recibe el resultado.
    const { premio, rareza } = girarRuleta(azarSeguro);

    const r = await moverLeyendas(tx, { uid, delta: premio, motivo: MOTIVOS.RULETA });
    tx.set(
      db.collection(USUARIOS).doc(uid),
      { ultimoGiroRuleta: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true },
    );

    return { premio, rareza, saldo: r.saldo };
  });
});

// -------------------------------------------------------------- apuestas

// ------------------------------------------------------------- salas

const SALAS = "rooms";

/** Azar criptográfico para los códigos de sala. */
const azarCodigo = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;

/**
 * Crea una sala por Leyendas y cobra la entrada al creador.
 *
 * El código es el ID del documento: así la unicidad la garantiza Firestore
 * (una transacción que encuentra el documento ocupado reintenta con otro
 * código) sin necesidad de consultas, que dentro de transacciones no se
 * pueden hacer.
 */
export const crearSala = functions.https.onCall(async (data, context) => {
  const uid = exigirSesion(context);
  const entrada = Number(data?.entrada);
  const nombre = String(data?.nombre ?? "Sala").slice(0, 40);

  if (!esEntradaValida(entrada)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `Entrada inválida. Las disponibles son: ${ENTRADAS.join(", ")}.`,
    );
  }

  const perfil = await db.collection(USUARIOS).doc(uid).get();
  const nombreJugador = perfil.exists ? (perfil.data().username ?? "Jugador") : "Jugador";

  // Hasta cinco intentos por si un código ya estaba tomado.
  for (let intento = 0; intento < 5; intento++) {
    const codigo = generarCodigo(azarCodigo);
    const refSala = db.collection(SALAS).doc(codigo);

    try {
      await db.runTransaction(async (tx) => {
        if ((await tx.get(refSala)).exists) throw new Error("codigo-ocupado");

        // Se cobra la entrada dentro de la MISMA transacción que crea la
        // sala: o pasan las dos cosas, o no pasa ninguna.
        const r = await moverLeyendas(tx, {
          uid,
          delta: -entrada,
          motivo: MOTIVOS.APUESTA,
          referencia: codigo,
          idempotencia: `entrada_${codigo}_${uid}`,
        });
        if (!r.aplicado) throw new Error("ya-pagada");

        tx.set(refSala, {
          codigo,
          nombre,
          modo: "leyendas",
          entrada,
          creador: uid,
          creadorNombre: nombreJugador,
          jugadores: [uid],
          jugadoresNombres: [nombreJugador],
          maxJugadores: MAX_JUGADORES,
          estado: ESTADOS_SALA.ESPERANDO,
          pozo: entrada,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      return { codigo, entrada };
    } catch (e) {
      if (e instanceof functions.https.HttpsError) throw e;
      if (e.message === "codigo-ocupado") continue; // otro código y de nuevo
      console.error("Error creando sala:", e);
      throw new functions.https.HttpsError("internal", "No pudimos crear la sala.");
    }
  }

  throw new functions.https.HttpsError("internal", "No pudimos generar un código libre.");
});

/**
 * Suma al jugador a una sala y le cobra la entrada.
 *
 * Todo ocurre en una transacción: la validación del cupo, el cobro y el alta
 * son atómicos, así que dos jugadores entrando a la vez no pueden dejar la
 * sala en cinco ni cobrarse dos veces.
 */
export const unirseASala = functions.https.onCall(async (data, context) => {
  const uid = exigirSesion(context);
  const codigo = String(data?.codigo ?? "").trim().toUpperCase();

  if (!esCodigoValido(codigo)) {
    throw new functions.https.HttpsError("invalid-argument", "Código inválido.");
  }

  const perfil = await db.collection(USUARIOS).doc(uid).get();
  const nombreJugador = perfil.exists ? (perfil.data().username ?? "Jugador") : "Jugador";

  return db.runTransaction(async (tx) => {
    const refSala = db.collection(SALAS).doc(codigo);
    const snapSala = await tx.get(refSala);
    const sala = snapSala.exists ? snapSala.data() : null;

    const snapUsuario = await tx.get(db.collection(USUARIOS).doc(uid));
    const saldo = snapUsuario.exists ? (snapUsuario.data()[CAMPO_SALDO] ?? 0) : 0;

    // La MISMA función que usa el navegador para avisar antes de intentarlo.
    const veredicto = puedeUnirse(sala, uid, saldo);
    if (!veredicto.puede) {
      throw new functions.https.HttpsError("failed-precondition", veredicto.mensaje);
    }

    const r = await moverLeyendas(tx, {
      uid,
      delta: -Number(sala.entrada),
      motivo: MOTIVOS.APUESTA,
      referencia: codigo,
      idempotencia: `entrada_${codigo}_${uid}`,
    });
    if (!r.aplicado) {
      throw new functions.https.HttpsError("already-exists", "Ya pagaste la entrada a esta sala.");
    }

    tx.update(refSala, {
      jugadores: [...(sala.jugadores ?? []), uid],
      jugadoresNombres: [...(sala.jugadoresNombres ?? []), nombreJugador],
      pozo: Number(sala.entrada) * ((sala.jugadores ?? []).length + 1),
    });

    return { codigo, entrada: sala.entrada, saldo: r.saldo };
  });
});

/**
 * Arranca la partida. Sólo el creador, y sólo con jugadores suficientes.
 *
 * Al arrancar se congela el pozo: a partir de acá la entrada no cambia y
 * nadie más puede sumarse.
 */
export const iniciarPartida = functions.https.onCall(async (data, context) => {
  const uid = exigirSesion(context);
  const codigo = String(data?.codigo ?? "").trim().toUpperCase();

  return db.runTransaction(async (tx) => {
    const refSala = db.collection(SALAS).doc(codigo);
    const snap = await tx.get(refSala);
    if (!snap.exists) {
      throw new functions.https.HttpsError("not-found", "Sala no encontrada.");
    }

    const sala = snap.data();
    if (sala.creador !== uid) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Sólo quien creó la sala puede empezar la partida.",
      );
    }
    if (sala.estado !== ESTADOS_SALA.ESPERANDO) {
      throw new functions.https.HttpsError("failed-precondition", "Esta sala ya no está esperando.");
    }

    const jugadores = sala.jugadores ?? [];
    if (jugadores.length < MIN_JUGADORES) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Hacen falta al menos ${MIN_JUGADORES} jugadores para empezar.`,
      );
    }

    tx.update(refSala, {
      estado: ESTADOS_SALA.JUGANDO,
      // El pozo queda fijado con los jugadores que efectivamente pagaron.
      pozo: Number(sala.entrada) * jugadores.length,
      iniciadaEn: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { codigo, jugadores: jugadores.length, pozo: Number(sala.entrada) * jugadores.length };
  });
});

/**
 * Salir de una sala que todavía NO empezó.
 *
 * Acá se devuelve la entrada completa y no hay penalización: la partida
 * nunca arrancó, así que no habría de qué castigar. La penalización del 50%
 * es para abandonar una partida en curso, que es otra operación.
 *
 * Si se va quien creó la sala, la sala se cancela y se le devuelve la
 * entrada a todos: no se dejan Leyendas atrapadas en una sala huérfana.
 */
export const salirDeSalaEnEspera = functions.https.onCall(async (data, context) => {
  const uid = exigirSesion(context);
  const codigo = String(data?.codigo ?? "").trim().toUpperCase();

  return db.runTransaction(async (tx) => {
    const refSala = db.collection(SALAS).doc(codigo);
    const snap = await tx.get(refSala);
    if (!snap.exists) {
      throw new functions.https.HttpsError("not-found", "Sala no encontrada.");
    }

    const sala = snap.data();
    if (sala.estado !== ESTADOS_SALA.ESPERANDO) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "La partida ya empezó: para salir hay que abandonarla.",
      );
    }

    const jugadores = sala.jugadores ?? [];
    if (!jugadores.includes(uid)) {
      throw new functions.https.HttpsError("failed-precondition", "No estás en esta sala.");
    }

    const entrada = Number(sala.entrada);
    const esCreador = sala.creador === uid;
    // Si se va el creador, se cancela y se devuelve a todos; si no, sólo a él.
    const aDevolver = esCreador ? jugadores : [uid];

    for (const jugador of aDevolver) {
      await moverLeyendas(tx, {
        uid: jugador,
        delta: entrada,
        motivo: MOTIVOS.APUESTA,
        referencia: codigo,
        idempotencia: `devolucion_${codigo}_${jugador}`,
      });
    }

    if (esCreador) {
      tx.update(refSala, {
        estado: ESTADOS_SALA.CANCELADA,
        canceladaEn: admin.firestore.FieldValue.serverTimestamp(),
        motivoCancelacion: "el creador salió de la sala",
      });
    } else {
      const indice = jugadores.indexOf(uid);
      const nombres = [...(sala.jugadoresNombres ?? [])];
      nombres.splice(indice, 1);
      tx.update(refSala, {
        jugadores: jugadores.filter((j) => j !== uid),
        jugadoresNombres: nombres,
        pozo: entrada * (jugadores.length - 1),
      });
    }

    return { cancelada: esCreador, devuelto: entrada };
  });
});

/**
 * Cierra una partida: reparte el pote y acumula el ranking.
 *
 * El resumen llega del cliente, así que hay que tratarlo como no confiable:
 * se valida contra la mesa registrada (jugadores y apuesta) antes de pagar.
 * Con dinero real de por medio, lo correcto es que la partida se simule
 * también en el servidor o que el resultado lo firme un árbitro.
 */
export const cerrarPartida = functions.https.onCall(async (data, context) => {
  exigirSesion(context);
  const { mesaId, resumen } = data ?? {};
  if (!mesaId || !resumen) {
    throw new functions.https.HttpsError("invalid-argument", "Faltan mesaId o resumen.");
  }

  const mesaSnap = await db.collection("mesas").doc(mesaId).get();
  if (!mesaSnap.exists) {
    throw new functions.https.HttpsError("not-found", "La mesa no existe.");
  }
  const mesa = mesaSnap.data();

  const humanos = resumen.posiciones.filter((p) => !p.esIA);
  const inscriptos = new Set(mesa.jugadores ?? []);
  if (!humanos.every((p) => inscriptos.has(p.id))) {
    throw new functions.https.HttpsError("permission-denied", "El resumen no coincide con la mesa.");
  }

  const partida = { id: mesaId, dePago: Boolean(mesa.dePago), apuesta: Number(mesa.apuesta) };
  const fecha = new Date();
  const claves = clavesDePeriodos(fecha, ZONA);

  const rachas = {};
  for (const p of humanos) {
    const s = await db.collection(USUARIOS).doc(p.id).get();
    rachas[p.id] = s.exists ? (s.data().rachaActual ?? 0) : 0;
  }

  return db.runTransaction(async (tx) => {
    const refPartida = db.collection("partidas").doc(mesaId);
    if ((await tx.get(refPartida)).exists) {
      throw new functions.https.HttpsError("already-exists", "La partida ya fue cerrada.");
    }

    // --- reparto del pote ---
    let reparto = null;
    if (esPartidaPuntuable(partida)) {
      reparto = calcularReparto({
        apuesta: partida.apuesta,
        jugadores: humanos.map((p) => p.id),
        ganadorId: resumen.ganadorId,
      });
      // La apuesta ya se cobró al entrar: acá sólo se paga el premio.
      const premio = reparto.movimientos.find((m) => m.jugadorId === resumen.ganadorId);
      if (premio) {
        await moverLeyendas(tx, {
          uid: resumen.ganadorId,
          delta: reparto.pago,
          motivo: MOTIVOS.PREMIO_PARTIDA,
          referencia: mesaId,
          idempotencia: `premio_${mesaId}`,
        });
      }
    }

    // --- ranking (sólo partidas de pago) ---
    const resultados = esPartidaPuntuable(partida)
      ? humanos
          .map((p) =>
            puntosDePartida(
              resumen,
              p.id,
              { rayaPrevia: rachas[p.id], ibaUltimo: mesa.contexto?.[p.id]?.ibaUltimo },
              partida.apuesta,
            ),
          )
          .filter(Boolean)
      : [];

    const objetivos = [];
    for (const r of resultados) {
      for (const periodo of PERIODOS) {
        const ref = db
          .collection("rankings")
          .doc(claves[periodo])
          .collection("jugadores")
          .doc(r.jugadorId);
        objetivos.push({ ref, r, previo: (await tx.get(ref)).data() ?? filaVacia() });
      }
    }

    tx.set(refPartida, {
      ...partida,
      resumen,
      claves,
      resultados,
      reparto,
      creada: admin.firestore.FieldValue.serverTimestamp(),
    });

    for (const { ref, r, previo } of objetivos) {
      const nombre = humanos.find((p) => p.id === r.jugadorId)?.nombre ?? null;
      tx.set(ref, { uid: r.jugadorId, nombre, ...acumularFila(previo, r) }, { merge: true });
    }

    for (const r of resultados) {
      tx.set(
        db.collection(USUARIOS).doc(r.jugadorId),
        { rachaActual: r.rayaNueva },
        { merge: true },
      );
    }

    return { resultados, reparto };
  });
});

// -------------------------------------------------------------- referidos

export const acreditarReferido = functions.https.onCall(async (data, context) => {
  const uid = exigirSesion(context);
  const { referidoUid } = data ?? {};
  if (!referidoUid || referidoUid === uid) {
    throw new functions.https.HttpsError("invalid-argument", "Referido inválido.");
  }

  return db.runTransaction(async (tx) => {
    const r = await moverLeyendas(tx, {
      uid,
      delta: LEYENDAS_POR_REFERIDO,
      motivo: MOTIVOS.REFERIDO,
      referencia: referidoUid,
      idempotencia: `referido_${referidoUid}`,
    });
    if (!r.aplicado) {
      throw new functions.https.HttpsError("already-exists", "Ese referido ya fue acreditado.");
    }
    return { leyendas: LEYENDAS_POR_REFERIDO, saldo: r.saldo };
  });
});

// -------------------------------------------------- reinicio de rankings

/**
 * Los rankings no se "borran": cada período es su propio documento y la clave
 * se deriva de la fecha. Reiniciar es, entonces, cerrar el período que termina
 * y pagar sus premios. Esta función marca el cierre y reparte.
 */
async function cerrarPeriodo(periodo, fechaDelPeriodoQueCierra) {
  const clave = clavePeriodo(periodo, fechaDelPeriodoQueCierra, ZONA);
  const refPeriodo = db.collection("rankings").doc(clave);

  const yaCerrado = await refPeriodo.get();
  if (yaCerrado.exists && yaCerrado.data().cerrado) {
    console.log(`El período ${clave} ya estaba cerrado.`);
    return { clave, premiados: 0 };
  }

  const tabla = await refPeriodo
    .collection("jugadores")
    .orderBy("puntos", "desc")
    .limit(50)
    .get();

  let premiados = 0;
  for (let i = 0; i < tabla.docs.length; i++) {
    const fila = tabla.docs[i];
    const puesto = i + 1;
    const premio = premioPorPuesto(puesto);
    if (!premio) continue;

    await db.runTransaction(async (tx) => {
      const r = await moverLeyendas(tx, {
        uid: fila.id,
        delta: premio.leyendas,
        motivo: MOTIVOS.PREMIO_RANKING,
        referencia: clave,
        idempotencia: `premio_${clave}_${fila.id}`,
      });
      if (!r.aplicado) return;

      tx.set(fila.ref, { puesto, premiado: true }, { merge: true });
      if (premio.insignia) {
        tx.set(
          db.collection(USUARIOS).doc(fila.id),
          { insignias: admin.firestore.FieldValue.arrayUnion(premio.insignia) },
          { merge: true },
        );
      }
    });
    premiados++;
  }

  await refPeriodo.set(
    {
      tipo: periodo,
      clave,
      cerrado: true,
      cerradoEn: admin.firestore.FieldValue.serverTimestamp(),
      premiados,
    },
    { merge: true },
  );

  console.log(`Período ${clave} cerrado: ${premiados} premiados.`);
  return { clave, premiados };
}

const ayer = () => new Date(Date.now() - 86400000);

export const cerrarRankingSemanal = functions.pubsub
  .schedule("0 0 * * 1") // lunes 00:00
  .timeZone(ZONA)
  .onRun(() => cerrarPeriodo("semanal", ayer()));

export const cerrarRankingMensual = functions.pubsub
  .schedule("0 0 1 * *") // día 1 a las 00:00
  .timeZone(ZONA)
  .onRun(() => cerrarPeriodo("mensual", ayer()));

export const cerrarRankingAnual = functions.pubsub
  .schedule("0 0 1 1 *") // 1 de enero 00:00
  .timeZone(ZONA)
  .onRun(() => cerrarPeriodo("anual", ayer()));

// ----------------------------------------------------------------- pagos

/**
 * Paso 1 de la compra: se registra la orden y se devuelve lo necesario para
 * abrir el checkout alojado del proveedor.
 *
 * ⚠️ INTEGRACIÓN PENDIENTE. La llamada al SDK de Xsolla / Mercado Pago va
 * marcada abajo: hace falta la credencial y el endpoint exacto de tu cuenta.
 * El importe SIEMPRE se toma del catálogo del servidor, nunca del cliente:
 * si viniera del navegador, cualquiera compraría el Pack Élite por $U 1.
 */
export const crearOrdenDeCompra = functions.https.onCall(async (data, context) => {
  const uid = exigirSesion(context);
  const paquete = paquetePorId(data?.paqueteId);
  if (!paquete) {
    throw new functions.https.HttpsError("invalid-argument", "Paquete inexistente.");
  }

  const refOrden = db.collection("ordenes").doc();
  await refOrden.set({
    id: refOrden.id,
    uid,
    paqueteId: paquete.id,
    leyendas: leyendasDePaquete(paquete),
    importe: paquete.precio, // del catálogo del servidor
    moneda: MONEDA,
    estado: "pendiente",
    creada: admin.firestore.FieldValue.serverTimestamp(),
  });

  // TODO(pagos): crear acá la sesión de checkout con el proveedor y devolver
  // su URL. Debe enviarse `refOrden.id` como referencia externa para poder
  // reconciliar el webhook, y el importe tomado de `paquete.precio`.
  const urlCheckout = null;

  return {
    ordenId: refOrden.id,
    importe: paquete.precio,
    moneda: MONEDA,
    leyendas: leyendasDePaquete(paquete),
    urlCheckout,
  };
});

/**
 * Paso 2: el proveedor confirma el pago. Sólo acá se acreditan Leyendas.
 *
 * ⚠️ La verificación de firma de abajo es genérica (HMAC-SHA256 sobre el
 * cuerpo crudo). Ajustala al algoritmo y encabezado que documente el
 * proveedor que uses; sin firma válida NO se acredita nada.
 * El secreto se configura con:  firebase functions:secrets:set PAGOS_SECRETO
 */
export const webhookPago = functions.https.onRequest(async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  // functions.config() está discontinuado: el secreto viene por variable de
  // entorno. Se define con:  firebase functions:secrets:set PAGOS_SECRETO
  const secreto = process.env.PAGOS_SECRETO;
  if (!secreto) {
    console.error("Falta la variable PAGOS_SECRETO.");
    return res.status(500).send("Sin configurar");
  }

  const firmaRecibida = req.get("x-signature") ?? "";
  const esperada = crypto
    .createHmac("sha256", secreto)
    .update(req.rawBody ?? Buffer.from(""))
    .digest("hex");

  const iguales =
    firmaRecibida.length === esperada.length &&
    crypto.timingSafeEqual(Buffer.from(firmaRecibida), Buffer.from(esperada));

  if (!iguales) {
    console.warn("Webhook con firma inválida.");
    return res.status(401).send("Firma inválida");
  }

  const { ordenId, estado, transaccionId } = req.body ?? {};
  if (!ordenId || !transaccionId) return res.status(400).send("Payload incompleto");
  if (estado !== "pagado") {
    await db.collection("ordenes").doc(ordenId).set({ estado }, { merge: true });
    return res.status(200).send("ok");
  }

  try {
    await db.runTransaction(async (tx) => {
      const refOrden = db.collection("ordenes").doc(ordenId);
      const snap = await tx.get(refOrden);
      if (!snap.exists) throw new Error(`Orden ${ordenId} inexistente`);

      const orden = snap.data();
      if (orden.estado === "pagado") return; // reintento del proveedor

      const paquete = paquetePorId(orden.paqueteId);

      await moverLeyendas(tx, {
        uid: orden.uid,
        delta: orden.leyendas,
        motivo: MOTIVOS.COMPRA,
        referencia: transaccionId,
        // Idempotencia por transacción: el proveedor puede reintentar el aviso.
        idempotencia: `compra_${transaccionId}`,
      });

      tx.set(
        refOrden,
        {
          estado: "pagado",
          transaccionId,
          pagada: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      if (paquete?.insignia) {
        tx.set(
          db.collection(USUARIOS).doc(orden.uid),
          { insignias: admin.firestore.FieldValue.arrayUnion(paquete.insignia) },
          { merge: true },
        );
      }
    });

    return res.status(200).send("ok");
  } catch (e) {
    console.error("Error acreditando la compra:", e);
    return res.status(500).send("Error");
  }
});
