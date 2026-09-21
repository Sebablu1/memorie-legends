/**
 * Las mesas públicas: las abre la administración, aparecen en el lobby y se
 * pagan sólo con Leyendas Ganadas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EN QUÉ SE DIFERENCIAN DE CUALQUIER OTRA SALA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * En casi nada. Viven en `rooms` como todas, se entra por `unirseASala`, se
 * juegan con el mismo motor y se cierran con el mismo cierre, que reparte
 * 75/25 como en cualquier sala. Lo que cambia son cuatro campos:
 *
 *   publica: true       la abrió la administración y se lista en el lobby.
 *   soloGanadas: true   la entrada se cobra sólo de lo ganado. Es un campo
 *                       aparte de `publica` porque la revancha de una pública
 *                       también lo lleva, y la revancha no se lista.
 *   creador: null       la administración no se sienta en su mesa. La partida
 *                       la empieza quien se sentó primero (`anfitrionDe`), y
 *                       salir nunca cancela la mesa.
 *   mesa                el código de la primera: lo comparten todas sus
 *                       reaperturas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NACEN VACÍAS Y SE REABREN SOLAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Una sala de jugador nace con su creador sentado y su entrada cobrada. Una
 * mesa pública nace vacía: no le cobra nada a nadie hasta que alguien se
 * sienta.
 *
 * Y cuando empieza su partida, `iniciarPartida` abre otra igual en la misma
 * transacción, así el lobby no se vacía con cada partida que arranca. Para
 * eso son las dos mitades de abajo, `reservarSiguiente` y `abrirSiguiente`:
 * Firestore no deja leer después de escribir, y repartir la partida escribe,
 * así que el código libre se busca ANTES de repartir y la mesa se abre
 * DESPUÉS.
 *
 * Borrar es cancelar la que está esperando, con la devolución de siempre: una
 * mesa cancelada nunca empieza, así que tampoco se reabre, y la cadena termina
 * ahí. Las partidas en curso de esa mesa siguen hasta el final.
 */

import {
  ENTRADAS,
  ESTADOS_SALA,
  MAX_JUGADORES,
  MIN_JUGADORES,
  MODOS,
  esEntradaValida,
} from "./reglas/salas.js";
import { LIMITE_ELIMINACION, LIMITES_DE_PARTIDA, esLimiteDePartida } from "./reglas/puntaje.js";
import { JUEGO_POR_DEFECTO, juegoDe } from "./reglas/juegos.js";

/** Lo mismo que corta `crearSala`: un nombre de sala no pasa de 40. */
const LARGO_NOMBRE = 40;

export function crearSalasPublicas({
  db,
  salas = "rooms",
  error,
  marcaDeTiempo,
  // Quién puede administrar. Ver `administradores.js`.
  administradores,
  // `editarSala` y `cancelarSala` del panel. Editar y borrar una mesa son
  // exactamente eso, y una segunda copia sería un segundo criterio.
  panel,
  // Los códigos de sala, con azar criptográfico en producción.
  generarCodigo,
  estados = ESTADOS_SALA,
  intentos = 5,
}) {
  const refSala = (codigo) => db.collection(salas).doc(codigo);

  /** La configuración de una mesa, validada y con sus valores por omisión. */
  function configuracion({ nombre, entrada, limitePuntos, maxJugadores }) {
    const valorEntrada = Number(entrada);
    if (!esEntradaValida(valorEntrada)) {
      throw error(
        "invalid-argument",
        `Entrada inválida. Las disponibles son: ${ENTRADAS.join(", ")}.`,
      );
    }

    const limite = limitePuntos == null ? LIMITE_ELIMINACION : Number(limitePuntos);
    if (!esLimiteDePartida(limite)) {
      throw error(
        "invalid-argument",
        `Duración inválida. Las disponibles son: ${LIMITES_DE_PARTIDA.join(", ")}.`,
      );
    }

    const cupo = maxJugadores == null ? MAX_JUGADORES : Number(maxJugadores);
    if (!Number.isInteger(cupo) || cupo < MIN_JUGADORES || cupo > MAX_JUGADORES) {
      throw error("invalid-argument", `El cupo va de ${MIN_JUGADORES} a ${MAX_JUGADORES}.`);
    }

    const limpio = String(nombre ?? "").trim().slice(0, LARGO_NOMBRE);
    return {
      nombre: limpio || `Mesa de ${valorEntrada}`,
      entrada: valorEntrada,
      limitePuntos: limite,
      maxJugadores: cupo,
    };
  }

  /** Una mesa vacía, lista para escribir. */
  const mesaVacia = ({
    codigo, mesa, abiertaPor, juego, nombre, entrada, limitePuntos, maxJugadores,
  }) => ({
    codigo,
    nombre,
    modo: MODOS.LEYENDAS,
    // De qué juego es: ver `reglas/juegos.js`.
    juego,
    entrada,
    limitePuntos,
    maxJugadores,
    publica: true,
    soloGanadas: true,
    creador: null,
    abiertaPor: abiertaPor ?? null,
    mesa,
    jugadores: [],
    jugadoresNombres: [],
    jugadoresLuce: [],
    listos: [],
    estado: estados.ESPERANDO,
    pozo: 0,
    createdAt: marcaDeTiempo(),
  });

  /** SÓLO LEE. Un código de sala que no esté tomado. */
  async function codigoLibre(tx) {
    for (let i = 0; i < intentos; i++) {
      const codigo = generarCodigo();
      const ref = refSala(codigo);
      if (!(await tx.get(ref)).exists) return { codigo, ref };
    }
    throw error("internal", "No pudimos generar un código libre para la mesa.");
  }

  /**
   * Abre una mesa pública, vacía. Sólo la administración.
   *
   * Todavía no se elige el juego: con uno solo no hay qué elegir, y validarlo
   * necesita la colección `juegos/`, que llega con el lobby nuevo. Ahí se
   * valida leyendo `juegos/{id}`, no contra una lista escrita acá.
   */
  async function crear(context, datos) {
    const { uid } = await administradores.exigir(context);
    const config = configuracion(datos ?? {});

    return db.runTransaction(async (tx) => {
      const { codigo, ref } = await codigoLibre(tx);
      tx.set(ref, mesaVacia({
        ...config, codigo, mesa: codigo, abiertaPor: uid, juego: JUEGO_POR_DEFECTO,
      }));
      return { codigo, ...config, juego: JUEGO_POR_DEFECTO };
    });
  }

  /**
   * La mesa, si es pública.
   *
   * Se lee fuera de toda transacción, y alcanza: `publica` no cambia nunca.
   * Lo que sí cambia —si hay gente, si está esperando— lo vuelve a mirar
   * adentro de su transacción la función del panel que hace el trabajo.
   */
  async function mesaPublica(codigo) {
    const codigoLimpio = String(codigo ?? "").trim().toUpperCase();
    const snap = await refSala(codigoLimpio).get();
    if (!snap.exists) throw error("not-found", `La mesa ${codigoLimpio} no existe.`);

    const sala = snap.data();
    if (!sala.publica) {
      throw error("failed-precondition", `${codigoLimpio} no es una mesa pública.`);
    }
    return { codigo: codigoLimpio, sala };
  }

  /** El nombre y el cupo siempre; la entrada y la duración, con la mesa vacía. */
  async function editar(context, { codigo, ...cambios }) {
    await administradores.exigir(context);
    const { codigo: codigoLimpio } = await mesaPublica(codigo);
    return panel.editarSala(context, { codigo: codigoLimpio, ...cambios });
  }

  /**
   * Cancela la mesa que está esperando y devuelve las entradas.
   *
   * La que ya está jugando no se borra: termina su partida. Y como en cuanto
   * empezó se abrió la siguiente, borrar ésa es lo que corta la cadena.
   */
  async function borrar(context, { codigo }) {
    await administradores.exigir(context);
    const { codigo: codigoLimpio, sala } = await mesaPublica(codigo);

    if ((sala.estado ?? estados.ESPERANDO) !== estados.ESPERANDO) {
      throw error(
        "failed-precondition",
        `La mesa ${codigoLimpio} no está esperando. Se borra la que espera; ` +
          "la que está jugando termina su partida.",
      );
    }
    return panel.cancelarSala(context, { codigo: codigoLimpio, forzar: false });
  }

  /** La reapertura, paso 1: SÓLO LEE. Va antes de repartir la partida. */
  const reservarSiguiente = (tx) => codigoLibre(tx);

  /**
   * La reapertura, paso 2: SÓLO ESCRIBE. Una mesa igual a la que empezó,
   * vacía y con otro código. El juego, la entrada, la duración, el cupo y el
   * nombre se copian de la que empezó, así que lo que la administración le
   * cambió mientras esperaba sigue valiendo en la próxima.
   */
  function abrirSiguiente(tx, reserva, sala) {
    tx.set(reserva.ref, mesaVacia({
      codigo: reserva.codigo,
      mesa: sala.mesa ?? sala.codigo,
      abiertaPor: sala.abiertaPor,
      juego: juegoDe(sala),
      nombre: sala.nombre,
      entrada: Number(sala.entrada),
      limitePuntos: sala.limitePuntos,
      maxJugadores: sala.maxJugadores,
    }));
    return reserva.codigo;
  }

  return { crear, editar, borrar, reservarSiguiente, abrirSiguiente };
}
