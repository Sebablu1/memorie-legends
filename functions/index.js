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

/**
 * En firebase-functions v7 el subpaquete v1 dejó de tener export por defecto:
 * sigue exportando `https`, `pubsub` y compañía, pero uno por uno. Con
 * `import functions from` la variable queda en undefined y las 27 funciones
 * revientan al arrancar, no al desplegar. De ahí el namespace.
 */
import * as functions from "firebase-functions/v1";

/**
 * Los logs, estructurados.
 *
 * Es el logger que trae firebase-functions, no uno escrito a mano. Se propuso
 * armar uno propio con `JSON.stringify({level, message, ...})`, y sería peor:
 * éste ya emite el formato que Cloud Logging entiende, le pega la traza del
 * pedido —así los mensajes de una misma invocación quedan agrupados— y respeta
 * los niveles de severidad de la consola. Un JSON.stringify a pelo pierde las
 * tres cosas.
 *
 * El segundo argumento es un objeto y no texto pegado con `+`: así los campos
 * quedan consultables en Cloud Logging. Buscar por `codigo="ABC234"` sólo
 * funciona si el código viajó como campo.
 */
const { logger } = functions;
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
import { crearLimiteDeRitmo } from "./limite-de-ritmo.js";
import {
  validar,
  EsquemaDeSala,
  EsquemaDescarte,
  EsquemaAccion,
  EsquemaCompra,
  EsquemaReferido,
} from "./esquemas.js";
import { crearSalirDeSalaEnEspera } from "./salida.js";
import { crearAdmin } from "./admin.js";
import { crearMercadoPago, pagoCoincideConOrden } from "./mercadopago.js";

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

/**
 * Techo de llamadas por jugador. Ver limite-de-ritmo.js: las acciones del
 * juego se cuentan en memoria y las de plata en Firestore, y ese reparto no
 * es una optimización sino una condición para no torcer los reflejos.
 */
const limite = crearLimiteDeRitmo({ db, error: errorHttp });

/**
 * Puerta única: sesión y ritmo.
 *
 * El techo viaja pegado al control de sesión a propósito. Si fuera una
 * llamada aparte, una función nueva podría olvidárselo sin que se note;
 * así, olvidarlo obliga a olvidarse también de exigir sesión, que es un
 * error que salta a la primera. Igual hay una prueba que audita el archivo
 * y exige que toda callable pase su nombre (pruebas/ritmo.mjs).
 */
const exigirSesion = (context, accion) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Iniciá sesión para continuar.");
  }
  if (accion) limite.exigirRitmo(context.auth.uid, accion);
  return context.auth.uid;
};

// --------------------------------------------------------------- registro

// El perfil lo crea el propio cliente al registrarse, con las 100 Leyendas
// de bienvenida, y las reglas de Firestore fijan ese valor exacto. No se
// duplica acá para no tener dos caminos de creación.

// ------------------------------------------------------------ bono diario

export const reclamarBonoDiario = functions.https.onCall(async (_data, context) => {
  const uid = exigirSesion(context, "reclamarBonoDiario");
  await limite.exigirRitmoDePlata(uid, "reclamarBonoDiario");

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
  const uid = exigirSesion(context, "girarLaRuleta");
  await limite.exigirRitmoDePlata(uid, "girarLaRuleta");

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
  const uid = exigirSesion(context, "crearSala");
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
      logger.error("No se pudo crear la sala", { uid, entrada, error: e.message });
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
  const uid = exigirSesion(context, "unirseASala");
  const codigo = validar(EsquemaDeSala, data, errorHttp).codigo;

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
  const uid = exigirSesion(context, "marcarListo");
  const codigo = validar(EsquemaDeSala, data, errorHttp).codigo;
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
  const uid = exigirSesion(context, "iniciarPartida");
  const codigo = validar(EsquemaDeSala, data, errorHttp).codigo;

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
  const uid = exigirSesion(context, "salirDeSalaEnEspera");
  return salida({ uid, codigo: data?.codigo });
});

// ------------------------------------------------------- administración

/**
 * Panel de administración.
 *
 * La cuenta autorizada se comprueba ACÁ, contra `context.auth.token`, que lo
 * pone Firebase al verificar el token. El navegador puede decir lo que quiera:
 * lo único que cuenta es ese correo, y verificado.
 *
 * Las reglas de Firestore no cambian. `partidas` sigue siendo ilegible para
 * todo el mundo —administrador incluido—: lo que el panel recibe es un resumen
 * que se arma acá y no lleva ni una carta.
 */
const CORREO_ADMIN = "soporte.memorie.legends@gmail.com";

/**
 * Mercado Pago. Las credenciales entran por variable de entorno y se leen en
 * cada llamada, no al arrancar: un secreto rotado tiene efecto sin redesplegar.
 *
 *   firebase functions:secrets:set MP_ACCESS_TOKEN
 *   firebase functions:secrets:set MP_WEBHOOK_SECRET
 */
const mercadoPago = () =>
  crearMercadoPago({
    accessToken: process.env.MP_ACCESS_TOKEN,
    webhookSecret: process.env.MP_WEBHOOK_SECRET,
  });

/** Dónde avisa Mercado Pago y adónde vuelve el comprador. */
/**
 * Los secretos hay que DECLARARLOS, no sólo configurarlos.
 *
 * En Cloud Functions v1, `functions:secrets:set` guarda el valor pero
 * `process.env` sigue vacío hasta que la función lo pide con `runWith`. El
 * código anterior leía `process.env.PAGOS_SECRETO` sin declararlo: habría
 * respondido "Sin configurar" para siempre, con el secreto correctamente
 * guardado y nadie entendiendo por qué.
 */
const SECRETOS_MP = ["MP_ACCESS_TOKEN", "MP_WEBHOOK_SECRET"];

const URL_WEBHOOK = "https://us-central1-memorie-legends.cloudfunctions.net/webhookPago";
const URL_VUELTA = "https://memorie-legends.web.app/tienda.html";

const panel = crearAdmin({
  db,
  salas: SALAS,
  partidas: "partidas",
  moverLeyendas,
  // Una cancelación devuelve la entrada: mismo motivo que cualquier otra
  // devolución, y la misma clave de idempotencia que usa `salida.js`, para que
  // a nadie se le pague dos veces por la misma sala.
  motivo: MOTIVOS.APUESTA,
  marcaDeTiempo,
  error: errorHttp,
  estados: ESTADOS_SALA,
  emailAdmin: CORREO_ADMIN,
});

export const listarSalasAdmin = functions.https.onCall((_data, context) =>
  panel.listarSalas(context));

export const cancelarSalaAdmin = functions.https.onCall((data, context) =>
  panel.cancelarSala(context, { codigo: data?.codigo }));

export const cancelarSalasEnEsperaAdmin = functions.https.onCall((_data, context) =>
  panel.cancelarTodasEnEspera(context));

/**
 * Busca nombres guardados que podrían hacer daño si se dibujaran sin escapar.
 *
 * Vive en el servidor porque `users` pasó a leerse sólo por su dueño —el saldo
 * está en ese documento— y ya no hay forma de listarla desde el navegador.
 */
export const revisarNombresAdmin = functions.https.onCall((_data, context) =>
  panel.revisarNombres(context));

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
  const uid = exigirSesion(context, "cerrarPartida");
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
  exigirSesion(context, "horaDelServidor");
  return { ahora: Date.now() };
});

/** Abre la ventana de reflejos. La hora y el identificador los pone el servidor. */
export const abrirVentanaDescarte = functions.https.onCall(async (data, context) => {
  exigirSesion(context, "abrirVentanaDescarte");
  return enRed.abrirVentana({ codigo: validar(EsquemaDeSala, data, errorHttp).codigo });
});

/**
 * Anota un intento de descarte. NO resuelve: eso pasa al cerrar la ventana.
 *
 * Si resolviera acá, "el primero" sería el primero en LLEGAR, y ganaría
 * siempre la mejor conexión. Ver PROTOCOLO-REFLEJOS.md.
 */
export const intentarDescarte = functions.https.onCall(async (data, context) => {
  const uid = exigirSesion(context, "intentarDescarte");
  // El esquema normaliza y acota; lo que sigue siendo del servidor es el
  // TIEMPO: `declarado`, `latencia` e `incertidumbre` llegan validados como
  // números razonables, pero el que decide cuánto valen es `tiempoEfectivo`,
  // que los acota al intervalo que la llegada del pedido hace posible. Un
  // esquema no puede saber si un jugador miente sobre cuándo reaccionó.
  const d = validar(EsquemaDescarte, data, errorHttp);
  return enRed.intentarDescarte({
    uid,
    codigo: d.codigo,
    windowId: d.windowId,
    posicion: d.posicion,
    clientActionId: d.clientActionId,
    declarado: d.declarado,
    latencia: d.latencia,
    incertidumbre: d.incertidumbre,
    // Contra la mano de un rival: a quién y qué carta propia se entrega si
    // acierta. Sólo posiciones y un uid; el servidor deriva todo lo demás.
    objetivo: d.objetivo ?? null,
    posicionEntrega: d.posicionEntrega ?? null,
  });
});

/** Cierra la ventana y aplica los intentos en orden de reacción. */
export const cerrarVentanaDescarte = functions.https.onCall(async (data, context) => {
  exigirSesion(context, "cerrarVentanaDescarte");
  return enRed.cerrarVentana({ codigo: validar(EsquemaDeSala, data, errorHttp).codigo });
});

/**
 * Hace avanzar la partida si algo venció.
 *
 * La llaman los clientes porque en Firebase no hay un proceso vivo esperando,
 * pero quien mira el reloj es el servidor y mira el suyo. Llamarla temprano
 * no adelanta nada; llamarla mil veces es lo mismo que llamarla una.
 */
export const avanzarPartida = functions.https.onCall(async (data, context) => {
  exigirSesion(context, "avanzarPartida");
  return enRed.avanzarPartida({ codigo: validar(EsquemaDeSala, data, errorHttp).codigo });
});

/** Cierra la fase de mirar. La decide el servidor con su reloj. */
export const cerrarMirada = functions.https.onCall(async (data, context) => {
  exigirSesion(context, "cerrarMirada");
  return enRed.cerrarMirada({ codigo: validar(EsquemaDeSala, data, errorHttp).codigo });
});

/** Cualquier acción de turno. La lista de acciones válidas es blanca. */
export const accionDePartida = functions.https.onCall(async (data, context) => {
  const uid = exigirSesion(context, "accionDePartida");
  const a = validar(EsquemaAccion, data, errorHttp);
  return enRed.accionDeTurno({
    uid,
    codigo: a.codigo,
    accion: a.accion,
    clientActionId: a.clientActionId,
    posicion: a.posicion,
    objetivo: a.objetivo,
  });
});

/** Señal de vida. Caerse no cuesta Leyendas; sólo hace que te salten el turno. */
export const latir = functions.https.onCall(async (data, context) => {
  const uid = exigirSesion(context, "latir");
  return enRed.latir({ uid, codigo: validar(EsquemaDeSala, data, errorHttp).codigo });
});

/** Saltea el turno de quien lleva rato sin dar señales. */
export const saltarAusente = functions.https.onCall(async (data, context) => {
  exigirSesion(context, "saltarAusente");
  return enRed.saltarAusente({ codigo: validar(EsquemaDeSala, data, errorHttp).codigo });
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
  const uid = exigirSesion(context, "abandonarPartida");
  return abandono({ uid, codigo: data?.codigo });
});

// -------------------------------------------------------------- referidos

export const acreditarReferido = functions.https.onCall(async (data, context) => {
  const uid = exigirSesion(context, "acreditarReferido");
  await limite.exigirRitmoDePlata(uid, "acreditarReferido");
  const { referidoUid } = validar(EsquemaReferido, data, errorHttp);
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
    logger.info("El período ya estaba cerrado", { clave, periodo });
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

  logger.info("Período de ranking cerrado", { clave, periodo, premiados });
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
export const crearOrdenDeCompra = functions
  .runWith({ secrets: SECRETOS_MP })
  .https.onCall(async (data, context) => {
  const uid = exigirSesion(context, "crearOrdenDeCompra");
  await limite.exigirRitmoDePlata(uid, "crearOrdenDeCompra");
  const paquete = paquetePorId(validar(EsquemaCompra, data, errorHttp).paqueteId);
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

  if (!process.env.MP_ACCESS_TOKEN) {
    logger.error("Falta MP_ACCESS_TOKEN: no se puede abrir el checkout");
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Los pagos todavía no están habilitados. Probá más tarde.",
    );
  }

  let checkout;
  try {
    checkout = await mercadoPago().crearPreferencia({
      orden: { id: refOrden.id },
      paquete,
      moneda: MONEDA,
      urlWebhook: URL_WEBHOOK,
      urlVuelta: URL_VUELTA,
    });
  } catch (e) {
    // La orden queda en `pendiente` y sin checkout: no se borra, porque saber
    // que alguien intentó comprar y no pudo es justamente lo que hay que poder
    // mirar después.
    logger.error("No se pudo crear la preferencia de Mercado Pago", {
      uid, ordenId: refOrden.id, error: e.message,
    });
    throw new functions.https.HttpsError("unavailable", "No pudimos abrir el pago. Probá de nuevo.");
  }

  await refOrden.set(
    { preferenciaId: checkout.preferenciaId, esSandbox: checkout.esSandbox },
    { merge: true },
  );

  const urlCheckout = checkout.url;

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
 * Los secretos se configuran con:
 *   firebase functions:secrets:set MP_ACCESS_TOKEN
 *   firebase functions:secrets:set MP_WEBHOOK_SECRET
 */
export const webhookPago = functions
  .runWith({ secrets: SECRETOS_MP })
  .https.onRequest(async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const mp = mercadoPago();

  if (!process.env.MP_WEBHOOK_SECRET || !process.env.MP_ACCESS_TOKEN) {
    logger.error("Faltan las credenciales de Mercado Pago: el webhook no puede verificar nada");
    // 500 y no 200: que MP lo reintente cuando esté configurado, en vez de
    // dar el aviso por entregado y perder el pago.
    return res.status(500).send("Sin configurar");
  }

  // Mercado Pago manda el id del pago en la QUERY, y ése es el que firma.
  const dataId = req.query?.["data.id"] ?? req.query?.id ?? req.body?.data?.id;
  const tipo = req.query?.type ?? req.body?.type;

  const firma = mp.verificarFirma({
    firma: req.get("x-signature"),
    requestId: req.get("x-request-id"),
    dataId,
    crypto,
  });

  if (!firma.valida) {
    // Sin volcar la firma recibida: es lo que un atacante querría ver para
    // saber qué tan cerca estuvo. El motivo sí, que sirve para diagnosticar.
    logger.warn("Webhook de Mercado Pago rechazado", { motivo: firma.motivo, origen: req.ip });
    return res.status(401).send("Firma inválida");
  }

  // Sólo interesan las notificaciones de pago. Al resto se le contesta 200
  // para que MP no reintente eternamente algo que no vamos a procesar.
  if (tipo && tipo !== "payment") return res.status(200).send("ignorado");
  if (!dataId) return res.status(400).send("Sin id de pago");

  // ────────────────────────────────────────────────────────────────────
  // ACÁ ESTÁ LO IMPORTANTE: el aviso no dice que te pagaron, dice que MIRES.
  //
  // El estado se lee de la API de Mercado Pago, NUNCA del cuerpo del pedido.
  // La versión anterior confiaba en `req.body.estado === "pagado"`, y eso
  // significa que cualquiera capaz de producir un cuerpo aceptado acuñaba
  // Leyendas. La firma tampoco alcanza por sí sola: el manifiesto que MP firma
  // cubre el id, el request-id y la marca de tiempo, no el cuerpo entero.
  // ────────────────────────────────────────────────────────────────────
  let pago;
  try {
    pago = await mp.consultarPago(dataId);
  } catch (e) {
    logger.error("No se pudo consultar el pago en Mercado Pago", { dataId, error: e.message });
    // 500 para que MP reintente: puede haber sido un problema pasajero suyo.
    return res.status(500).send("No se pudo confirmar");
  }

  if (!pago.aprobado) {
    // Se anota el estado real y no se acredita nada. `authorized` está retenido
    // y todavía puede caerse: tratarlo como pagado sería regalar Leyendas.
    if (pago.ordenId) {
      await db.collection("ordenes").doc(pago.ordenId)
        .set({ estado: pago.estado, detalle: pago.detalle ?? null }, { merge: true });
    }
    logger.info("Pago no aprobado", { pagoId: pago.id, estado: pago.estado });
    return res.status(200).send("ok");
  }

  try {
    await db.runTransaction(async (tx) => {
      const refOrden = db.collection("ordenes").doc(String(pago.ordenId));
      const snap = await tx.get(refOrden);           // ← leer primero
      const orden = snap.exists ? { id: snap.id, ...snap.data() } : null;

      const coincide = pagoCoincideConOrden(pago, orden, { moneda: MONEDA });
      if (!coincide.ok) {
        // "Ya pagada" es un reintento de MP y es normal: se contesta bien.
        if (coincide.motivo === "ya_pagada") return;
        // Lo demás no. Un importe o una moneda que no cuadran con la orden es
        // la señal de que algo se manipuló, y no se acredita nada.
        throw Object.assign(new Error(coincide.motivo), { noAcreditar: true, pago: pago.id });
      }

      const paquete = paquetePorId(orden.paqueteId);

      await moverLeyendas(tx, {
        uid: orden.uid,
        delta: orden.leyendas,
        motivo: MOTIVOS.COMPRA,
        referencia: pago.id,
        // Idempotencia por pago: MP reintenta el aviso hasta que le contestes
        // 200, y a veces igual manda duplicados.
        idempotencia: `compra_${pago.id}`,
      });

      tx.set(
        refOrden,
        {
          estado: "pagado",
          transaccionId: pago.id,
          importePagado: pago.importe,
          modoVivo: pago.modoVivo,
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
    if (e.noAcreditar) {
      logger.error("Pago aprobado que NO coincide con su orden: no se acreditó nada", {
        pagoId: e.pago, motivo: e.message, ordenId: pago.ordenId,
      });
      // 200: reintentar no va a arreglarlo, y hay que mirarlo a mano.
      return res.status(200).send("no coincide");
    }
    logger.error("No se pudo acreditar la compra", { pagoId: pago.id, error: e.message });
    return res.status(500).send("Error");
  }
});
