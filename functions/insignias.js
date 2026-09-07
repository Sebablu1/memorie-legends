/**
 * Otorga las insignias que un jugador se ganó.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO CORRE DESPUÉS DE LA TRANSACCIÓN Y NO ADENTRO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque para decidir si una insignia se ganó hay que LEER las estadísticas, y
 * las estadísticas las acaba de ESCRIBIR el cierre de la partida. Firestore no
 * deja leer después de escribir dentro de una transacción, así que meterlo
 * adentro obligaría a leer el contador viejo y sumarle uno a mano —duplicando
 * la aritmética que `FieldValue.increment` ya hace bien— o a leer un valor
 * desactualizado y otorgar una partida tarde.
 *
 * Correr después es seguro porque otorgar es idempotente: el documento de
 * posesión se llama como el artículo, así que dos pasadas escriben el mismo
 * documento y no dos. Si el proceso se cae entre el cierre y esto, la próxima
 * partida lo arregla; la insignia llega tarde, no se pierde.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO HAY UNA CALLABLE PARA ESTO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque no hay ninguna decisión que el cliente pueda tomar acá. Las
 * condiciones son públicas —viven en `reglas/insignias.js` y el perfil las
 * dibuja— pero quién las cumple lo determina el servidor leyendo contadores
 * que el servidor escribió. Una callable "revisá si me gané algo" no agrega
 * nada y agrega una puerta.
 */

import {
  insigniasNuevas,
  conPuestoMensual,
  ESTADISTICAS_VACIAS,
} from "./reglas/insignias.js";

export function crearInsignias({ db, usuarios = "users", items = "items", tienda, logger }) {
  const refPerfil = (uid) => db.collection(usuarios).doc(uid);

  /** Las estadísticas del perfil, completadas con ceros donde falten. */
  async function estadisticasDe(uid) {
    const snap = await refPerfil(uid).get();
    const d = snap.exists ? snap.data() : {};
    return {
      ...ESTADISTICAS_VACIAS,
      partidasJugadas: Number(d.partidasJugadas ?? 0),
      partidasGanadas: Number(d.partidasGanadas ?? 0),
      torneosGanados: Number(d.torneosGanados ?? 0),
      mejorPuestoMensual:
        typeof d.mejorPuestoMensual === "number" ? d.mejorPuestoMensual : null,
    };
  }

  /** Los ids de las insignias que ya tiene. */
  async function insigniasQueTiene(uid) {
    const snap = await refPerfil(uid).collection(items).get();
    const tiene = [];
    snap.forEach((doc) => {
      if (doc.data().tipo === "insignia") tiene.push(doc.id);
    });
    return tiene;
  }

  /**
   * Revisa y otorga lo que corresponda. Devuelve sólo lo que otorgó.
   *
   * No lanza: una insignia que no se puede otorgar —porque el catálogo todavía
   * no está sembrado, por ejemplo— no puede tumbar el cierre de una partida
   * que ya pagó los premios. Se registra y se sigue.
   */
  async function otorgarInsignias(uid) {
    if (!uid) return [];

    try {
      const [estadisticas, yaTiene] = await Promise.all([
        estadisticasDe(uid),
        insigniasQueTiene(uid),
      ]);

      const pendientes = insigniasNuevas(estadisticas, yaTiene);
      if (!pendientes.length) return [];

      const otorgadas = [];
      for (const id of pendientes) {
        try {
          const r = await tienda.otorgar(uid, id);
          if (r.nuevo) otorgadas.push(id);
        } catch (e) {
          logger?.warn?.("No se pudo otorgar una insignia", { uid, insignia: id, error: e.message });
        }
      }
      return otorgadas;
    } catch (e) {
      logger?.warn?.("No se pudieron revisar las insignias", { uid, error: e.message });
      return [];
    }
  }

  /** Varios jugadores de una. Se usa al cerrar una partida. */
  async function otorgarAVarios(uids) {
    const r = {};
    for (const uid of [...new Set(uids ?? [])].filter(Boolean)) {
      const otorgadas = await otorgarInsignias(uid);
      if (otorgadas.length) r[uid] = otorgadas;
    }
    return r;
  }

  /**
   * Anota el puesto que sacó en un ranking mensual y revisa la insignia.
   *
   * Guarda el MEJOR de la historia, nunca el último: quien salió tercero una
   * vez es Leyenda para siempre. Una insignia que se puede perder no es un
   * logro, es un estado, y no es lo que se acordó.
   */
  async function registrarPuestoMensual(uid, puesto) {
    if (!uid || !Number.isFinite(puesto) || puesto < 1) return null;

    const actual = await estadisticasDe(uid);
    const nuevo = conPuestoMensual(actual, puesto);
    if (nuevo.mejorPuestoMensual === actual.mejorPuestoMensual) {
      // No mejoró su marca: no hay nada que escribir, pero sí que revisar,
      // porque la insignia pudo no haberse otorgado la primera vez.
      return otorgarInsignias(uid);
    }

    await refPerfil(uid).set({ mejorPuestoMensual: nuevo.mejorPuestoMensual }, { merge: true });
    return otorgarInsignias(uid);
  }

  return { otorgarInsignias, otorgarAVarios, registrarPuestoMensual, estadisticasDe };
}
