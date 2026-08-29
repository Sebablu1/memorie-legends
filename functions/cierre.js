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

/**
 * Tres primitivas, no una función.
 *
 *   leer(tx, codigo)          sólo lee
 *   planificar({partida, sala})  puro, sin I/O
 *   aplicar(tx, …)            sólo escribe
 *
 * Separadas así por una razón concreta: el cierre tiene que poder ocurrir
 * DENTRO de la transacción que `avanzarPartida` ya tiene abierta, cuando la
 * partida vence en `finPartida`. Firestore no admite transacciones anidadas,
 * y tampoco admite leer después de escribir, así que la lectura y la
 * escritura tienen que poder invocarse por separado y en ese orden.
 *
 * La callable pública usa exactamente las mismas tres. No hay dos caminos de
 * cierre: hay uno, con dos disparadores.
 */
export function crearCierre({
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

  // ---------------------------------------------------------- primitivas

  /** SÓLO LEE. Las dos lecturas que el cierre necesita, juntas y primero. */
  async function leer(tx, codigo) {
    const codigoLimpio = String(codigo ?? "").trim().toUpperCase();
    if (!codigoLimpio) throw error("invalid-argument", "Falta el código de la partida.");

    const refPartida = db.collection(partidas).doc(codigoLimpio);
    const refSala = db.collection(salas).doc(codigoLimpio);

    const snapPartida = await tx.get(refPartida);
    const snapSala = await tx.get(refSala);

    if (!snapPartida.exists) throw error("not-found", "No encontramos esa partida.");
    if (!snapSala.exists) throw error("not-found", "No encontramos esa sala.");

    return {
      codigo: codigoLimpio,
      refPartida,
      refSala,
      partida: snapPartida.data(),
      sala: snapSala.data(),
    };
  }

  /**
   * PURA. Decide a quién se le paga y cuánto. No toca Firestore ni el reloj.
   *
   * Devuelve `{ yaEstaba: true }` si la sala ya está cerrada: es la respuesta
   * correcta a un segundo intento, y la que hace que dos disparos simultáneos
   * no paguen dos veces.
   */
  function planificar({ partida, sala }) {
    if (sala.estado === estados.TERMINADA) {
      return { yaEstaba: true, cierre: sala.cierre ?? null };
    }

    if (partida.estado.fase !== "finPartida") {
      throw error(
        "failed-precondition",
        "La partida todavía no terminó: no hay premios que repartir.",
      );
    }

    if (!usaLeyendas(sala)) {
      throw error("failed-precondition", "Esta partida no tiene pozo en Leyendas.");
    }
    const pozo = Number(sala.pozo);
    if (!Number.isInteger(pozo) || pozo < 0) {
      throw error("internal", `El pozo de la sala no es un número válido: ${sala.pozo}`);
    }

    const abandonaron = sala.abandonaron ?? [];
    const elegibles = elegiblesParaPremio(partida.estado, abandonaron);
    const { premios, repartido, sobrante } = repartirPozo(pozo, Math.min(elegibles.length, 2));

    const pagos = [];
    if (elegibles[0] && premios.primero > 0) {
      pagos.push({ jugador: elegibles[0], puesto: 1, monto: premios.primero });
    }
    if (elegibles[1] && premios.segundo > 0) {
      pagos.push({ jugador: elegibles[1], puesto: 2, monto: premios.segundo });
    }

    return { yaEstaba: false, pozo, repartido, sobrante, pagos, abandonaron };
  }

  /**
   * SÓLO ESCRIBE. Paga y cierra.
   *
   * `moverLeyendas.varias` lee los saldos y los asientos antes de escribir
   * nada, así que puede ser lo primero que se llame acá sin romper la regla
   * de Firestore, siempre que quien invoque esto no haya escrito todavía.
   */
  async function aplicar(tx, { codigo, refPartida, refSala, partida, plan, cerradaPor }) {
    const resultados = plan.pagos.length
      ? await moverLeyendas.varias(
          tx,
          plan.pagos.map((p) => ({
            uid: p.jugador.id,
            delta: p.monto,
            motivo,
            referencia: codigo,
            // La clave incluye el puesto: dos cierres simultáneos chocan en el
            // mismo documento y sólo uno paga.
            idempotencia: `premio_${codigo}_${p.puesto}`,
          })),
        )
      : [];

    const cierre = {
      pozo: plan.pozo,
      repartido: plan.repartido,
      // Lo que no se pagó porque faltaban elegibles. Se registra y no se
      // reparte: no se le inventa un destinatario.
      sobrante: plan.sobrante,
      cerradaEn: marcaDeTiempo(),
      cerradaPor,
      abandonaron: plan.abandonaron,
      premios: plan.pagos.map((p, i) => ({
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
        abandono: plan.abandonaron.includes(p.id),
      })),
    };

    tx.update(refSala, {
      estado: estados.TERMINADA,
      cierre,
      terminadaEn: marcaDeTiempo(),
    });

    return { cierre, refPartida };
  }

  // ------------------------------------------------------- la callable

  /**
   * Cierre pedido explícitamente. Existe para reintentos y como salida de
   * emergencia; el cierre normal lo dispara el orquestador al vencer el plazo
   * de `finPartida`. Los dos usan las mismas tres primitivas de arriba.
   */
  async function cerrarPartida({ uid, codigo }) {
    if (!uid) throw error("unauthenticated", "Iniciá sesión para continuar.");

    return db.runTransaction(async (tx) => {
      const datos = await leer(tx, codigo);

      // El que pide el cierre tiene que haber estado en la partida. No decide
      // nada —el resultado ya está escrito— pero no es asunto de un extraño.
      if (!(datos.sala.jugadores ?? []).includes(uid)) {
        throw error("permission-denied", "No estás en esta partida.");
      }

      const plan = planificar(datos);
      if (plan.yaEstaba) return { yaEstaba: true, ...(plan.cierre ?? {}) };

      const { cierre } = await aplicar(tx, { ...datos, plan, cerradaPor: uid });

      // La partida queda marcada como cerrada, sin tocar su estado de juego:
      // sigue sirviendo para mostrar el resultado y para auditar.
      tx.set(datos.refPartida, {
        ...datos.partida,
        cerrada: true,
        cierre,
        version: datos.partida.version + 1,
      });

      return { yaEstaba: false, ...cierre };
    });
  }

  return { cerrarPartida, leer, planificar, aplicar };
}
