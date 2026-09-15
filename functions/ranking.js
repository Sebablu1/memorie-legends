/**
 * Escribe el ranking cuando una partida termina.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO EXISTÍA Y NO FUNCIONABA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Había un `registrarPartida` en `public/js/ranking-store.js` que hacía casi
 * esto mismo, con dos problemas. El primero: no lo llamaba nadie, así que las
 * tres tablas estaban vacías y el cierre mensual repartía premios entre cero
 * jugadores. El segundo, escrito por su propio autor en la cabecera del
 * archivo:
 *
 *   "los puntos se escribe desde el navegador. Eso alcanza para probar, pero
 *    NO para una tabla atada a dinero real: cualquiera con la consola abierta
 *    puede escribirse los puntos que quiera."
 *
 * Y el ranking mensual reparte una remera. Así que la escritura se mudó acá,
 * donde el cliente no llega, y las reglas de Firestore dejan `rankings/` en
 * sólo lectura para todo el mundo.
 *
 * El cálculo NO se mudó: sigue en `reglas/ranking.js`, puro y compartido. Lo
 * que cambió es quién lo ejecuta y quién escribe el resultado.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ CORRE DESPUÉS DEL CIERRE Y NO ADENTRO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Por lo mismo que las insignias: para acumular hay que LEER la fila previa de
 * cada jugador en cada uno de los tres períodos, y la transacción del cierre ya
 * escribió cuando termina. Firestore no deja leer después de escribir.
 *
 * Correr después es seguro porque hay un guardián: `partidasPuntuadas/{codigo}`.
 * Se crea DENTRO de la misma transacción que suma los puntos, así que dos
 * intentos simultáneos chocan en ese documento y sólo uno entra. Y si el
 * proceso se cae entre el cierre y esto, reintentar suma una vez, no dos.
 *
 * Es una colección aparte y no el documento de la partida a propósito:
 * `partidas/{codigo}` guarda el estado del motor —las manos de los cuatro
 * jugadores y el mazo— y lo escribe el cierre. Meter acá una bandera en ese
 * documento mezclaría dos cosas con vidas distintas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE HOY NO SE PAGA: LA REMONTADA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `puntosDePartida` tiene un bono para quien gana viniendo último al entrar en
 * la ronda final. Ese dato —`ibaUltimo`— no está en ningún lado: el motor no
 * guarda el puntaje ronda por ronda, sólo el final, y en todo el proyecto no
 * hay un solo lugar que lo calcule. Nunca lo hubo.
 *
 * Se pasa `false` y el bono queda en cero. Es la única respuesta honesta:
 * inventarlo a partir del puntaje final —"salió primero y por poco"— pagaría
 * un bono por otra cosa, y nadie se enteraría de que la tabla miente. Para
 * pagarlo de verdad hay que guardar el puntaje al empezar la última ronda, que
 * es un cambio en el motor.
 */

import {
  PERIODOS,
  clavesDePeriodos,
  esPartidaPuntuable,
  puntosDePartida,
  acumularFila,
  filaVacia,
  ZONA_POR_DEFECTO,
} from "./reglas/ranking.js";

import { resumenPartida } from "./reglas/motor.js";

export function crearRankingDePartidas({
  db,
  marcaDeTiempo,
  logger,
  rankings = "rankings",
  // Dos colecciones distintas que se llaman parecido y NO son la misma:
  // `rankings/{clave}/jugadores/{uid}` es una fila de la tabla, y
  // `jugadores/{uid}/rachas/actual` es la raya de victorias en curso.
  filasDeTabla = "jugadores",
  perfilesDeRacha = "jugadores",
  puntuadas = "partidasPuntuadas",
  zona = ZONA_POR_DEFECTO,
  ahora = () => new Date(),

  /**
   * Quién es cada jugador, para CONGELARLO en la fila.
   *
   * ────────────────────────────────────────────────────────────────
   * POR QUÉ LA FILA GUARDA EL NOMBRE Y EL ASPECTO
   * ────────────────────────────────────────────────────────────────
   *
   * Porque el navegador NO PUEDE averiguarlo. La tabla se lee directo de
   * Firestore —`rankings/{clave}/jugadores` es de lectura pública— y
   * `users/{uid}` sólo lo lee su dueño, que fue una decisión deliberada para
   * que nadie viera el saldo ajeno.
   *
   * Sin esto, la tabla no tiene de dónde sacar el nombre de nadie. Y no lo
   * tenía: `ranking-ui.js` pintaba `f.nombre ?? f.uid`, nadie escribía
   * `nombre`, y la pantalla de mayor alcance del sitio mostraba el uid crudo
   * de cada jugador.
   *
   * ────────────────────────────────────────────────────────────────
   * Y POR QUÉ CONGELADO Y NO EN VIVO
   * ────────────────────────────────────────────────────────────────
   *
   * Una fila del ranking es un registro histórico: dice que en la semana del 8
   * de septiembre alguien salió tercero. Leer el perfil en vivo haría que las
   * tablas de meses pasados cambiaran cada vez que alguien se cambia el avatar.
   *
   * Devuelve `{ nombre, retrato, marco, titulo }` o `null`. Nada de esto puede
   * impedir que se puntúe: si falla, la fila se escribe sin identidad y se
   * completa sola la próxima vez que ese jugador sume.
   */
  identidadDe = async () => null,
}) {
  const refFila = (clave, uid) =>
    db.collection(rankings).doc(clave).collection(filasDeTabla).doc(uid);
  const refRaya = (uid) =>
    db.collection(perfilesDeRacha).doc(uid).collection("rachas").doc("actual");
  const refGuardian = (codigo) => db.collection(puntuadas).doc(codigo);

  /**
   * La identidad de cada uno, o nada. Nunca tira.
   *
   * Un perfil que no se pudo leer no puede cortar el puntaje de una partida ya
   * jugada: los puntos son el dato, el nombre es la decoración. Se escribe la
   * fila sin identidad y se completa sola la próxima vez.
   */
  async function identidadesDe(uids) {
    const pares = await Promise.all(
      uids.map(async (uid) => {
        try {
          return [uid, (await identidadDe(uid)) ?? null];
        } catch (e) {
          logger?.warn?.("No se pudo leer la identidad para el ranking", { uid, error: e.message });
          return [uid, null];
        }
      }),
    );
    return Object.fromEntries(pares);
  }

  /** La raya de victorias que traía cada uno. Lectura suelta, antes de todo. */
  async function rayasDe(uids) {
    const pares = await Promise.all(
      uids.map(async (uid) => {
        const snap = await refRaya(uid).get();
        return [uid, snap.exists ? Number(snap.data().raya ?? 0) : 0];
      }),
    );
    return Object.fromEntries(pares);
  }

  /**
   * Suma una partida terminada a las tres tablas.
   *
   * @param codigo      el de la sala; es la clave del guardián
   * @param estado      el estado final del motor
   * @param entrada     la apuesta, que multiplica lo ganado en la mesa
   * @param abandonaron uids que se fueron antes de terminar
   * @returns los resultados escritos, o [] si no había nada que puntuar
   */
  async function registrarPartida({ codigo, estado, entrada, abandonaron = [] }) {
    // El mismo portero que la versión del navegador: sólo puntúan las partidas
    // jugadas con Leyendas. El entrenamiento contra la IA no entra al ranking.
    if (!esPartidaPuntuable({ dePago: true, apuesta: Number(entrada) })) return [];
    if (!codigo || !estado) return [];

    const resumen = resumenPartida(estado);
    const seFueron = new Set(abandonaron ?? []);

    // Quiénes puntúan: humanos que llegaron al final. La IA no tiene perfil, y
    // quien abandonó ya quedó fuera del reparto del pozo unas líneas antes —
    // dejarlo sumar puntos de ranking sería premiarlo por irse.
    const elegibles = resumen.posiciones
      .filter((p) => !p.esIA && !seFueron.has(p.id))
      .map((p) => p.id);

    if (!elegibles.length) return [];

    const claves = clavesDePeriodos(ahora(), zona);
    const rayas = await rayasDe(elegibles);

    // Antes de abrir la transacción, igual que las rayas. Adentro serían
    // lecturas de más en una transacción que ya lee tres filas por jugador, y
    // encima lecturas de una colección que no se escribe acá.
    const identidades = await identidadesDe(elegibles);

    const resultados = elegibles
      .map((uid) =>
        puntosDePartida(
          resumen,
          uid,
          // `ibaUltimo: false` a propósito. Ver la nota de la cabecera: el dato
          // no existe en ningún lado y fabricarlo pagaría un bono por otra cosa.
          { rayaPrevia: rayas[uid], ibaUltimo: false },
          Number(entrada),
        ),
      )
      .filter(Boolean);

    if (!resultados.length) return [];

    await db.runTransaction(async (tx) => {
      // ---- lecturas ----
      const yaPuntuada = await tx.get(refGuardian(codigo));
      if (yaPuntuada.exists) {
        // No es un error: es un reintento. Se sale sin escribir, que es
        // exactamente lo que hace falta para que sumar dos veces sea imposible.
        return;
      }

      const objetivos = [];
      for (const r of resultados) {
        for (const periodo of PERIODOS) {
          const ref = refFila(claves[periodo], r.jugadorId);
          const snap = await tx.get(ref);
          objetivos.push({ ref, r, previo: snap.exists ? snap.data() : filaVacia() });
        }
      }

      // ---- escrituras ----
      tx.set(refGuardian(codigo), {
        codigo,
        claves,
        entrada: Number(entrada),
        ganadorId: resumen.ganadorId ?? null,
        // Sólo lo que hace falta para auditar el puntaje. El estado del motor
        // NO se copia acá: ya está en `partidas/{codigo}`, y duplicar las manos
        // de los jugadores en una colección con otras reglas es cómo se filtra
        // una partida entera.
        resultados: resultados.map((r) => ({
          jugadorId: r.jugadorId,
          posicionFinal: r.posicionFinal,
          gano: r.gano,
          total: r.total,
          base: r.base,
          multiplicador: r.multiplicador,
        })),
        puntuadaEn: marcaDeTiempo(),
      });

      for (const { ref, r, previo } of objetivos) {
        const quien = identidades[r.jugadorId];

        tx.set(
          ref,
          {
            uid: r.jugadorId,
            jugadorId: r.jugadorId,
            ...acumularFila(previo, r),

            /**
             * La identidad, congelada, y sólo si se pudo leer.
             *
             * El `...(quien ? {...} : {})` no es adorno: con `merge: true`,
             * escribir `nombre: undefined` no borra nada, pero escribir
             * `nombre: null` SÍ pisa el nombre que la fila ya tenía. Un
             * perfil que no se pudo leer una vez dejaría la fila peor que
             * antes, y encima en silencio.
             *
             * Así, la fila conserva lo último que se supo del jugador.
             */
            ...(quien
              ? {
                  nombre: quien.nombre ?? null,
                  retrato: quien.retrato ?? null,
                  marco: quien.marco ?? null,
                  titulo: quien.titulo ?? null,
                }
              : {}),

            actualizada: marcaDeTiempo(),
          },
          { merge: true },
        );
      }

      for (const r of resultados) {
        tx.set(refRaya(r.jugadorId), { raya: r.rayaNueva, actualizada: marcaDeTiempo() });
      }
    });

    logger?.info?.("Partida puntuada", {
      codigo,
      jugadores: resultados.length,
      puntos: resultados.map((r) => ({ uid: r.jugadorId, total: r.total })),
    });

    return resultados;
  }

  /**
   * Igual que la anterior, pero no lanza nunca.
   *
   * Es la que usan las callables. Un ranking que no se pudo escribir es un
   * problema; una partida que no se pudo cerrar porque el ranking falló es
   * peor: los premios ya se pagaron y la sala quedaría abierta para siempre.
   * Se registra y se sigue, y el guardián hace que reintentar sea seguro.
   */
  async function registrarPartidaSinRomper(datos) {
    try {
      return await registrarPartida(datos);
    } catch (e) {
      logger?.error?.("No se pudo puntuar la partida", {
        codigo: datos?.codigo,
        error: e.message,
      });
      return [];
    }
  }

  return { registrarPartida, registrarPartidaSinRomper };
}
