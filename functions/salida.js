/**
 * Salir de una sala que TODAVÍA NO empezó.
 *
 * Es la operación gemela del abandono, y la diferencia es toda la diferencia:
 * acá la partida no arrancó, así que la entrada se devuelve ENTERA y no hay
 * penalización. Castigar a alguien por irse de una sala que nunca llegó a
 * jugar no tendría sentido.
 *
 * Si sale el creador, la sala se cancela y se le devuelve la entrada a todos.
 * Si sale cualquier otro, se le devuelve sólo a él y la sala sigue esperando.
 *
 * POR QUÉ ESTÁ EN SU PROPIO ARCHIVO
 *
 * Vivía dentro de `index.js`, donde no se podía probar sin levantar Firebase
 * entero. Y ahí tenía un bug que ninguna prueba podía ver: devolvía las
 * entradas llamando a `moverLeyendas` en un bucle, y Firestore prohíbe leer
 * después de haber escrito dentro de una transacción. Con dos o más jugadores
 * la devolución nunca llegaba a confirmarse — nadie perdía Leyendas, pero
 * tampoco las recuperaba, y la sala quedaba sin cancelar.
 *
 * Ahora las devoluciones van en un solo lote: todos los saldos se leen
 * primero y todas las escrituras van después.
 */

import { ESTADOS_SALA } from "./reglas/salas.js";

export function crearSalirDeSalaEnEspera({
  db,
  salas,
  moverLeyendas,
  motivo,
  marcaDeTiempo,
  error,
  estados = ESTADOS_SALA,
}) {
  return async function salirDeSalaEnEspera({ uid, codigo }) {
    if (!uid) throw error("unauthenticated", "Iniciá sesión para continuar.");

    const codigoLimpio = String(codigo ?? "").trim().toUpperCase();
    if (!codigoLimpio) throw error("invalid-argument", "Falta el código de la sala.");

    return db.runTransaction(async (tx) => {
      const refSala = db.collection(salas).doc(codigoLimpio);
      const snap = await tx.get(refSala);
      if (!snap.exists) throw error("not-found", "Sala no encontrada.");

      const sala = snap.data();

      // --- TODAS las validaciones antes de mover una sola Leyenda ---
      if (sala.estado !== estados.ESPERANDO) {
        throw error(
          "failed-precondition",
          sala.estado === estados.JUGANDO
            ? "La partida ya empezó: para salir hay que abandonarla."
            : "Esta sala ya no está esperando.",
        );
      }

      const jugadores = sala.jugadores ?? [];
      if (!jugadores.includes(uid)) {
        throw error("failed-precondition", "No estás en esta sala.");
      }

      const entrada = Number(sala.entrada);
      if (!Number.isInteger(entrada) || entrada <= 0) {
        throw error("internal", `La entrada de la sala no es válida: ${sala.entrada}`);
      }

      const esCreador = sala.creador === uid;
      // Si se va el creador, se cancela y se devuelve a todos; si no, sólo a él.
      const aDevolver = esCreador ? [...jugadores] : [uid];

      // --- y recién ahora, todo junto ---
      // `varias` lee todos los saldos y todos los asientos primero, y escribe
      // después. En bucle, la segunda vuelta leería después de que la primera
      // escribió y Firestore rechazaría la transacción entera.
      const resultados = await moverLeyendas.varias(
        tx,
        aDevolver.map((jugador) => ({
          uid: jugador,
          delta: entrada,
          motivo,
          referencia: codigoLimpio,
          // Una devolución por sala y jugador: repetir la operación no
          // devuelve dos veces.
          idempotencia: `devolucion_${codigoLimpio}_${jugador}`,
        })),
      );

      const devueltos = aDevolver.filter((_, i) => resultados[i]?.aplicado);

      if (esCreador) {
        tx.update(refSala, {
          estado: estados.CANCELADA,
          canceladaEn: marcaDeTiempo(),
          motivoCancelacion: "el creador salió de la sala",
          // Queda escrito a quién se le devolvió: si algún jugador ya tenía su
          // devolución hecha, no aparece, y eso es información, no un error.
          devolucionesHechas: devueltos,
        });
      } else {
        const indice = jugadores.indexOf(uid);
        const nombres = [...(sala.jugadoresNombres ?? [])];
        nombres.splice(indice, 1);
        tx.update(refSala, {
          jugadores: jugadores.filter((j) => j !== uid),
          jugadoresNombres: nombres,
          // Si se va, deja de contar como listo.
          listos: (sala.listos ?? []).filter((j) => j !== uid),
          pozo: entrada * (jugadores.length - 1),
        });
      }

      return {
        cancelada: esCreador,
        devuelto: entrada,
        devueltos,
        // Cuántos de los que correspondía devolver ya tenían la devolución
        // hecha. Con la operación repetida, todos.
        yaDevueltos: aDevolver.length - devueltos.length,
      };
    });
  };
}
