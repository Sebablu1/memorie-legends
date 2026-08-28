/**
 * Abandonar una partida en curso.
 *
 * Reglas, tal como quedaron definidas:
 *
 *   Entrenamiento contra IA
 *     No pasa por acá en absoluto. No hay entrada, ni pozo, ni penalización;
 *     el jugador se va y listo. Esta función se niega a tratarlo, para que
 *     una partida de entrenamiento no pueda descontar Leyendas ni por error.
 *
 *   Partida por Leyendas
 *     La entrada ya está en el pozo y se queda ahí: el pozo NO se toca.
 *     Además se le descuenta una penalización independiente, calculada
 *     server-side como Math.floor(entrada * 0.50).
 *     Esa penalización NO entra al pozo y NO se le da a nadie: es un
 *     sumidero de la casa.
 *
 * Nada de lo que manda el navegador se usa para calcular dinero. Del cliente
 * llega únicamente el código de sala, que sirve para BUSCAR la partida; la
 * entrada, el modo y la penalización salen del documento de Firestore.
 */

import { MODOS, usaLeyendas, penalizacionAbandono } from "./reglas/salas.js";

/**
 * @param {object} deps
 * @param {object} deps.db
 * @param {string} deps.salas             colección de salas
 * @param {Function} deps.moverLeyendas   el único mutador de saldo
 * @param {string} deps.motivo            motivo para el libro mayor
 * @param {Function} deps.marcaDeTiempo
 * @param {Function} deps.error           (codigo, mensaje) => Error
 * @param {object} deps.estados           ESTADOS_SALA
 */
export function crearAbandonarPartida({
  db,
  salas,
  moverLeyendas,
  motivo,
  marcaDeTiempo,
  error,
  estados,
}) {
  return async function abandonarPartida({ uid, codigo }) {
    if (!uid) throw error("unauthenticated", "Iniciá sesión para continuar.");

    const codigoLimpio = String(codigo ?? "").trim().toUpperCase();
    if (!codigoLimpio) {
      throw error("invalid-argument", "Falta el código de la partida.");
    }

    return db.runTransaction(async (tx) => {
      const refSala = db.collection(salas).doc(codigoLimpio);
      const snap = await tx.get(refSala);

      // --- la partida existe ---
      if (!snap.exists) {
        throw error("not-found", "No encontramos esa partida.");
      }
      const sala = snap.data();

      // --- el jugador pertenece a la partida ---
      const jugadores = sala.jugadores ?? [];
      if (!jugadores.includes(uid)) {
        throw error("permission-denied", "No estás jugando esta partida.");
      }

      // --- todavía no había abandonado ---
      // Se comprueba antes que nada más para que un segundo intento diga la
      // verdad ("ya abandonaste") en vez de fallar por otro motivo.
      const abandonaron = sala.abandonaron ?? [];
      if (abandonaron.includes(uid)) {
        throw error("already-exists", "Ya habías abandonado esta partida.");
      }

      // --- la partida está en curso ---
      if (sala.estado !== estados.JUGANDO) {
        throw error(
          "failed-precondition",
          sala.estado === estados.ESPERANDO
            ? "La partida todavía no empezó: salí de la sala, no se cobra nada."
            : "Esta partida ya terminó.",
        );
      }

      // --- el modo, leído del servidor ---
      // Una partida de entrenamiento nunca debería estar en `rooms`, pero si
      // llegara a estarlo, acá se corta: no se le cobra nada a nadie.
      if (sala.modo === MODOS.ENTRENAMIENTO) {
        throw error(
          "failed-precondition",
          "El entrenamiento contra la máquina no se abandona: se cierra y ya.",
        );
      }

      // --- la entrada real de la partida ---
      // `usaLeyendas` exige modo `leyendas` Y una entrada de la lista válida.
      // Un documento con la entrada manipulada no llega a cobrar nada.
      if (!usaLeyendas(sala)) {
        throw error(
          "failed-precondition",
          "Esta partida no tiene entrada en Leyendas: no hay penalización que cobrar.",
        );
      }

      const entrada = Number(sala.entrada);
      const penalizacion = penalizacionAbandono(sala);

      // El pozo NO se toca: la entrada ya pagada se queda dentro.
      const resultado = await moverLeyendas(tx, {
        uid,
        delta: -penalizacion,
        motivo,
        referencia: codigoLimpio,
        // La clave incluye partida y jugador: reintentar no cobra dos veces,
        // y dos ejecuciones simultáneas chocan en este mismo documento.
        idempotencia: `abandono_${codigoLimpio}_${uid}`,
      });

      tx.update(refSala, {
        abandonaron: [...abandonaron, uid],
        abandonosDetalle: {
          ...(sala.abandonosDetalle ?? {}),
          [uid]: { entrada, penalizacion, en: marcaDeTiempo() },
        },
        // Queda escrito explícitamente que el pozo no se movió, para que se
        // vea en el documento y no haya que deducirlo.
        pozo: sala.pozo ?? entrada * jugadores.length,
      });

      return {
        codigo: codigoLimpio,
        entradaPerdida: entrada,
        penalizacion,
        // Lo que se descuenta AHORA. La entrada ya se había cobrado al entrar.
        descontadoAhora: penalizacion,
        saldo: resultado.saldo,
        pozoSinCambios: sala.pozo ?? entrada * jugadores.length,
      };
    });
  };
}
