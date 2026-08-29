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
  premioPorPuesto,
  paquetePorId,
  leyendasDePaquete,
  MOTIVOS,
  MONEDA,
} from "./reglas/economia.js";

import { crearMoverLeyendas } from "./leyendas.js";
import { crearAbandonarPartida } from "./abandono.js";
import { crearMotorEnRed } from "./partida-red.js";
import { crearCierre } from "./cierre.js";
import { crearSalirDeSalaEnEspera } from "./salida.js";

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
  clavePeriodo,
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

/** Se lanza siempre así, para que el módulo de saldo no dependa de functions. */
const errorHttp = (codigo, mensaje) => new functions.https.HttpsError(codigo, mensaje);

const marcaDeTiempo = () => admin.firestore.FieldValue.serverTimestamp();

/**
 * Única puerta por la que se mueven Leyendas. La implementación vive en
 * `leyendas.js` para poder probarla; acá sólo se le dan el Firestore y el
 * reloj de verdad.
 */
const moverLeyendas = crearMoverLeyendas({
  db,
  usuarios: USUARIOS,
  campoSaldo: CAMPO_SALDO,
  marcaDeTiempo,
  error: errorHttp,
});

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
          listos: [],
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
 * Marca al jugador como listo, o le saca la marca.
 *
 * Es una escritura sobre la sala, así que pasa por acá: las reglas dejan
 * `rooms` de sólo lectura para el navegador. Cada quien sólo puede marcarse
 * a sí mismo — el uid sale de la sesión, no de lo que manda el cliente.
 */
export const marcarListo = functions.https.onCall(async (data, context) => {
  const uid = exigirSesion(context);
  const codigo = String(data?.codigo ?? "").trim().toUpperCase();
  const listo = data?.listo !== false;

  return db.runTransaction(async (tx) => {
    const refSala = db.collection(SALAS).doc(codigo);
    const snap = await tx.get(refSala);
    if (!snap.exists) {
      throw new functions.https.HttpsError("not-found", "Sala no encontrada.");
    }

    const sala = snap.data();
    if (sala.estado !== ESTADOS_SALA.ESPERANDO) {
      throw new functions.https.HttpsError("failed-precondition", "Esta sala ya no está esperando.");
    }
    if (!(sala.jugadores ?? []).includes(uid)) {
      throw new functions.https.HttpsError("failed-precondition", "No estás en esta sala.");
    }

    const listos = new Set(sala.listos ?? []);
    if (listo) listos.add(uid);
    else listos.delete(uid);

    tx.update(refSala, { listos: [...listos] });
    return { listo, listos: listos.size, jugadores: (sala.jugadores ?? []).length };
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

    // Todos, incluido el creador, tienen que haberse marcado listos: así
    // nadie arranca mientras alguien todavía estaba acomodándose.
    const listos = new Set(sala.listos ?? []);
    const faltan = jugadores.filter((j) => !listos.has(j));
    if (faltan.length) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        faltan.length === 1
          ? "Falta un jugador por marcarse listo."
          : `Faltan ${faltan.length} jugadores por marcarse listos.`,
      );
    }

    // El reparto va en ESTA transacción, no en otra. Si fueran dos, la sala
    // podría quedar en "jugando" sin partida detrás —o con una partida que
    // nadie inició— y no habría forma de saber cuál de las dos pasó.
    //
    // El mazo se baraja acá, en el servidor, con una semilla que también
    // elige el servidor. Si la eligiera el cliente podría probar semillas
    // hasta dar con un reparto que le convenga.
    await enRed.repartirEn(tx, {
      codigo,
      jugadores,
      nombres: sala.jugadoresNombres ?? [],
    });

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
 * Salir de una sala que todavía no empezó. Devuelve la entrada entera y sin
 * penalización: la partida nunca llegó a jugarse.
 *
 * La lógica vive en `salida.js` para poder probarla. Ahí tenía un bug que
 * ninguna prueba podía ver desde acá: devolvía en bucle, y Firestore prohíbe
 * leer después de escribir dentro de una transacción.
 */
const salida = crearSalirDeSalaEnEspera({
  db,
  salas: SALAS,
  moverLeyendas,
  motivo: MOTIVOS.APUESTA,
  marcaDeTiempo,
  error: errorHttp,
  estados: ESTADOS_SALA,
});

export const salirDeSalaEnEspera = functions.https.onCall(async (data, context) => {
  const uid = exigirSesion(context);
  return salida({ uid, codigo: data?.codigo });
});

// ------------------------------------------------------ partida en red

/**
 * Motor en red. El estado completo vive en `partidas/{codigo}`, que NADIE
 * puede leer, y a cada jugador se le escribe su vista recortada en
 * `partidas/{codigo}/vistas/{uid}`.
 *
 * El navegador nunca escribe estado de partida: pide una acción, el servidor
 * la valida, la aplica y publica las vistas nuevas.
 */
/**
 * Cierre de la partida y reparto del pozo.
 *
 * Se monta ANTES que el motor en red porque éste lo necesita: cuando una
 * partida vence en `finPartida`, `avanzarPartida` reparte el pozo dentro de
 * su propia transacción usando estas mismas primitivas. Llamar a la callable
 * desde ahí abriría una segunda transacción, y Firestore no las anida.
 *
 * La versión anterior de esta función recibía del cliente quién había ganado.
 * Está reemplazada entera, no parcheada: ver `cierre.js`.
 */
const cierre = crearCierre({
  db,
  salas: SALAS,
  partidas: "partidas",
  moverLeyendas,
  motivo: MOTIVOS.PREMIO_PARTIDA,
  marcaDeTiempo,
  error: errorHttp,
  estados: ESTADOS_SALA,
});

/**
 * Cierre pedido a mano. El normal lo dispara el orquestador al vencer el
 * plazo; esto queda para reintentos y como salida de emergencia. Los dos
 * caminos usan las mismas primitivas, así que no pueden divergir.
 */
export const cerrarPartida = functions.https.onCall(async (data, context) => {
  const uid = exigirSesion(context);
  return cierre.cerrarPartida({ uid, codigo: data?.codigo });
});

const enRed = crearMotorEnRed({
  db,
  partidas: "partidas",
  ahora: () => Date.now(),
  idAleatorio: () => crypto.randomBytes(9).toString("base64url"),
  marcaDeTiempo,
  error: errorHttp,
  // La semilla del mazo sale de una fuente criptográfica: es lo que impide
  // que se pueda adivinar el reparto. No es un secreto de seguridad —para eso
  // está la redacción de vistas— pero regalarla sería absurdo.
  semillaDe: () => crypto.randomBytes(4).readUInt32BE(0),
  // Con esto, una partida que llega a `finPartida` se cierra sola al vencer
  // su plazo. Sin esto se quedaba viva para siempre.
  cierre: { leer: cierre.leer, planificar: cierre.planificar, aplicar: cierre.aplicar },
});

/**
 * Reloj del servidor, para que el cliente estime su desfase.
 *
 * Devuelve el momento en que se atendió el pedido. El cliente hace varias
 * pasadas y se queda con la de viaje más corto; ver reglas/red.js.
 */
export const horaDelServidor = functions.https.onCall(async (_data, context) => {
  exigirSesion(context);
  return { ahora: Date.now() };
});

/** Abre la ventana de reflejos. La hora y el identificador los pone el servidor. */
export const abrirVentanaDescarte = functions.https.onCall(async (data, context) => {
  exigirSesion(context);
  return enRed.abrirVentana({ codigo: String(data?.codigo ?? "").trim().toUpperCase() });
});

/**
 * Anota un intento de descarte. NO resuelve: eso pasa al cerrar la ventana.
 *
 * Si resolviera acá, "el primero" sería el primero en LLEGAR, y ganaría
 * siempre la mejor conexión. Ver PROTOCOLO-REFLEJOS.md.
 */
export const intentarDescarte = functions.https.onCall(async (data, context) => {
  const uid = exigirSesion(context);
  return enRed.intentarDescarte({
    uid,
    codigo: String(data?.codigo ?? "").trim().toUpperCase(),
    windowId: String(data?.windowId ?? ""),
    posicion: Number(data?.posicion),
    clientActionId: String(data?.clientActionId ?? ""),
    declarado: Number(data?.declarado),
    latencia: Number(data?.latencia),
    incertidumbre: Number(data?.incertidumbre),
  });
});

/** Cierra la ventana y aplica los intentos en orden de reacción. */
export const cerrarVentanaDescarte = functions.https.onCall(async (data, context) => {
  exigirSesion(context);
  return enRed.cerrarVentana({ codigo: String(data?.codigo ?? "").trim().toUpperCase() });
});

/**
 * Hace avanzar la partida si algo venció.
 *
 * La llaman los clientes porque en Firebase no hay un proceso vivo esperando,
 * pero quien mira el reloj es el servidor y mira el suyo. Llamarla temprano
 * no adelanta nada; llamarla mil veces es lo mismo que llamarla una.
 */
export const avanzarPartida = functions.https.onCall(async (data, context) => {
  exigirSesion(context);
  return enRed.avanzarPartida({ codigo: String(data?.codigo ?? "").trim().toUpperCase() });
});

/** Cierra la fase de mirar. La decide el servidor con su reloj. */
export const cerrarMirada = functions.https.onCall(async (data, context) => {
  exigirSesion(context);
  return enRed.cerrarMirada({ codigo: String(data?.codigo ?? "").trim().toUpperCase() });
});

/** Cualquier acción de turno. La lista de acciones válidas es blanca. */
export const accionDePartida = functions.https.onCall(async (data, context) => {
  const uid = exigirSesion(context);
  return enRed.accionDeTurno({
    uid,
    codigo: String(data?.codigo ?? "").trim().toUpperCase(),
    accion: String(data?.accion ?? ""),
    clientActionId: String(data?.clientActionId ?? ""),
    posicion: data?.posicion == null ? undefined : Number(data.posicion),
    objetivo: data?.objetivo ?? undefined,
  });
});

/** Señal de vida. Caerse no cuesta Leyendas; sólo hace que te salten el turno. */
export const latir = functions.https.onCall(async (data, context) => {
  const uid = exigirSesion(context);
  return enRed.latir({ uid, codigo: String(data?.codigo ?? "").trim().toUpperCase() });
});

/** Saltea el turno de quien lleva rato sin dar señales. */
export const saltarAusente = functions.https.onCall(async (data, context) => {
  exigirSesion(context);
  return enRed.saltarAusente({ codigo: String(data?.codigo ?? "").trim().toUpperCase() });
});

// ------------------------------------------------- abandono en curso

/**
 * Abandonar una partida ya empezada.
 *
 * La entrada ya está en el pozo y no vuelve; el pozo no se toca. Encima se
 * cobra una penalización que no va al pozo ni a otro jugador: se retira de
 * circulación. La lógica está en `abandono.js`, probada aparte.
 *
 * Del navegador llega sólo el código de sala. La entrada, el modo y la
 * penalización se leen y se calculan acá.
 */
const abandono = crearAbandonarPartida({
  db,
  salas: SALAS,
  moverLeyendas,
  motivo: MOTIVOS.PENALIZACION_ABANDONO,
  marcaDeTiempo,
  error: errorHttp,
  estados: ESTADOS_SALA,
  // Cobrar y salir de la mesa son la misma operación. Si fueran dos, entre
  // una y otra habría un instante en el que al jugador se le cobró el 50 % y
  // seguía sentado, con su turno bloqueando a los demás.
  partidaEnRed: {
    leer: enRed.leerPartidaParaAbandono,
    marcar: enRed.marcarAbandonoEn,
  },
});

export const abandonarPartida = functions.https.onCall(async (data, context) => {
  const uid = exigirSesion(context);
  return abandono({ uid, codigo: data?.codigo });
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
