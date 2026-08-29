/**
 * Cierre de una partida por Leyendas: reparto del pozo.
 *
 * POR QUÉ ESTO ES UN ARCHIVO NUEVO Y NO UN PARCHE
 *
 * La `cerrarPartida` anterior recibía del cliente `resumen.ganadorId` y
 * `resumen.posiciones`, y pagaba a quien el navegador dijera que había ganado.
 * Sólo comprobaba que esos jugadores pertenecieran a la mesa, no que el
 * ganador fuera el ganador. Cualquiera podía declararse primero y cobrar el
 * 75 % del pozo. Nunca llegó a desplegarse, así que nunca fue explotable, pero
 * no se arregla con validaciones: hay que invertir de dónde sale el dato.
 *
 * Acá NADA viene del cliente salvo el código de la partida, y ese código sólo
 * sirve para buscarla. El ganador, las posiciones, el pozo y los premios se
 * leen y se calculan del estado autoritativo.
 *
 * LAS REGLAS DEL REPARTO
 *
 *   El pozo es `entrada × jugadores al empezar`, y NO cambia nunca: la entrada
 *   del que abandona se queda dentro.
 *
 *   La penalización por abandono es independiente y no entra al pozo: es un
 *   sumidero de la casa. La cobra `abandonarPartida`, no esto.
 *
 *   Sólo cobran premio los jugadores que NO abandonaron. Quien se fue queda
 *   fuera de los puestos pagados, por más que su puntaje lo pondría arriba.
 *
 *   75 % al primero elegible, 25 % al segundo elegible.
 *   Con un solo elegible: cobra el 75 % y el 25 % queda como SOBRANTE.
 *   Sin ninguno: no se paga nada y todo el pozo queda como sobrante.
 *
 * El sobrante se registra y no se reparte. Inventarle un destino sería
 * inventar una regla de negocio en el medio de una transacción.
 */

import { posicionesFinales } from "./reglas/motor.js";
import { repartirPozo, usaLeyendas } from "./reglas/salas.js";

export function crearCerrarPartida({
  db,
  salas,
  partidas,
  moverLeyendas,
  motivo,
  marcaDeTiempo,
  error,
  estados,
}) {
  /**
   * Quiénes pueden cobrar, en orden.
   *
   * `posicionesFinales` ordena a TODOS los jugadores. De ahí se sacan los que
   * abandonaron —no por su puntaje, sino por haberse ido— y los que quedan
   * conservan su orden relativo. El que estaba segundo detrás de un abandonado
   * pasa a ser el segundo elegible: no se saltea un puesto ni se deja vacante.
   */
  function elegiblesParaPremio(estado, abandonaron) {
    const seFueron = new Set(abandonaron ?? []);
    return posicionesFinales(estado)
      .filter((p) => !seFueron.has(p.id) && !p.esIA)
      .map((p, i) => ({ ...p, puestoPagado: i + 1 }));
  }

  return async function cerrarPartida({ uid, codigo }) {
    if (!uid) throw error("unauthenticated", "Iniciá sesión para continuar.");

    const codigoLimpio = String(codigo ?? "").trim().toUpperCase();
    if (!codigoLimpio) throw error("invalid-argument", "Falta el código de la partida.");

    return db.runTransaction(async (tx) => {
      // ---------------------------------------------------- 1 y 2: leer
      // Las dos lecturas van primero y juntas: después de esto no se lee más,
      // porque `moverLeyendas.varias` escribe.
      const refPartida = db.collection(partidas).doc(codigoLimpio);
      const refSala = db.collection(salas).doc(codigoLimpio);

      const snapPartida = await tx.get(refPartida);
      const snapSala = await tx.get(refSala);

      if (!snapPartida.exists) throw error("not-found", "No encontramos esa partida.");
      if (!snapSala.exists) throw error("not-found", "No encontramos esa sala.");

      const partida = snapPartida.data();
      const sala = snapSala.data();

      // El que pide el cierre tiene que haber estado en la partida. No decide
      // nada —el resultado ya está escrito— pero no es asunto de un extraño.
      if (!(sala.jugadores ?? []).includes(uid)) {
        throw error("permission-denied", "No estás en esta partida.");
      }

      // ------------------------------------------- idempotencia de entrada
      // Si ya se cerró, se devuelve el cierre que quedó registrado. No se
      // vuelve a calcular ni a pagar: contestar dos veces lo mismo es lo
      // correcto, pagar dos veces no.
      if (sala.estado === estados.TERMINADA) {
        return { yaEstaba: true, ...(sala.cierre ?? {}) };
      }

      // ----------------------------------------------- 3: fase de la partida
      if (partida.estado.fase !== "finPartida") {
        throw error(
          "failed-precondition",
          "La partida todavía no terminó: no hay premios que repartir.",
        );
      }

      // --------------------------------------------- el pozo, del servidor
      if (!usaLeyendas(sala)) {
        throw error("failed-precondition", "Esta partida no tiene pozo en Leyendas.");
      }
      const pozo = Number(sala.pozo);
      if (!Number.isInteger(pozo) || pozo < 0) {
        throw error("internal", `El pozo de la sala no es un número válido: ${sala.pozo}`);
      }

      // ------------------------- 4 y 5: posiciones, sin los que abandonaron
      const abandonaron = sala.abandonaron ?? [];
      const elegibles = elegiblesParaPremio(partida.estado, abandonaron);

      // ------------------------------------------------- 6: el 75 / 25
      const { premios, repartido, sobrante } = repartirPozo(
        pozo,
        Math.min(elegibles.length, 2),
      );

      const pagos = [];
      if (elegibles[0] && premios.primero > 0) {
        pagos.push({ jugador: elegibles[0], puesto: 1, monto: premios.primero });
      }
      if (elegibles[1] && premios.segundo > 0) {
        pagos.push({ jugador: elegibles[1], puesto: 2, monto: premios.segundo });
      }

      // ------------------------------------- 7 y 8: pagar, con idempotencia
      // Un solo lote: leer los dos saldos y después escribir los dos. En dos
      // llamadas sueltas, la segunda leería después de que la primera escribió
      // y Firestore rechazaría la transacción entera.
      const resultados = pagos.length
        ? await moverLeyendas.varias(
            tx,
            pagos.map((p) => ({
              uid: p.jugador.id,
              delta: p.monto,
              motivo,
              referencia: codigoLimpio,
              // La clave incluye el puesto: dos cierres simultáneos chocan en
              // el mismo documento y sólo uno paga.
              idempotencia: `premio_${codigoLimpio}_${p.puesto}`,
            })),
          )
        : [];

      // ------------------------------------------------- 10: el registro
      const cierre = {
        pozo,
        repartido,
        // Lo que no se pagó porque faltaban elegibles. Se registra y no se
        // reparte: no se le inventa un destinatario.
        sobrante,
        cerradaEn: marcaDeTiempo(),
        cerradaPor: uid,
        abandonaron,
        premios: pagos.map((p, i) => ({
          uid: p.jugador.id,
          nombre: p.jugador.nombre,
          puesto: p.puesto,
          monto: p.monto,
          pagado: resultados[i]?.aplicado ?? false,
        })),
        // El orden completo, incluidos los que abandonaron, para poder
        // reconstruir después qué pasó.
        posiciones: posicionesFinales(partida.estado).map((p) => ({
          posicion: p.posicion,
          uid: p.id,
          nombre: p.nombre,
          puntos: p.puntos,
          abandono: abandonaron.includes(p.id),
        })),
      };

      // ------------------------------------------- 9: la sala queda cerrada
      tx.update(refSala, {
        estado: estados.TERMINADA,
        cierre,
        terminadaEn: marcaDeTiempo(),
      });

      // La partida queda marcada como cerrada, sin tocar su estado de juego:
      // sigue sirviendo para mostrar el resultado y para auditar.
      tx.set(refPartida, { ...partida, cerrada: true, cierre, version: partida.version + 1 });

      return { yaEstaba: false, ...cierre };
    });
  };
}
