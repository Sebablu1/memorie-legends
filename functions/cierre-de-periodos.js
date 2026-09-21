/**
 * El cierre de los rankings: cada juego cierra su período y paga sus premios.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ ES CERRAR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Los rankings no se "borran": cada período es su propia tabla y la clave se
 * deriva de la fecha. Reiniciar es cerrar el período que termina y pagar sus
 * premios: esto marca el cierre y reparte.
 *
 * Vivía dentro de `index.js`, donde no se podía probar sin levantar Firebase
 * entero. Se muda acá cuando los rankings pasan a ser por juego, que es cuando
 * más falta hace probarlo: ahora son varios cierres, uno por juego.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ JUEGOS SE CIERRAN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * No hay una lista en el código. Se cierran los juegos que tienen tablas, y
 * eso lo dice la MARCA que deja quien puntúa: `rankings/{juego}` con el campo
 * `juego` igual a su propio id. Un juego entra solo el día que puntúa su
 * primera partida.
 *
 * Y la marca tiene que tener el campo, no alcanza con que el documento
 * exista: en la misma colección viven los períodos de la estructura vieja
 * —`rankings/semanal_2026-09-07`, con `tipo` y `clave` pero sin `juego`—, y
 * cerrarlos como si fueran juegos escribiría documentos sin sentido debajo de
 * ellos. `pruebas/cierre-de-periodos.mjs` lo prueba con nombre propio.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE NO SE PAGA DOS VECES
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La clave del premio lleva el juego —dos juegos pueden cerrar la misma
 * semana— y por eso cambió respecto de la de antes. Un cambio de clave es
 * justo lo que podría pagar dos veces un cierre que quedó a medias con la
 * clave vieja, así que además de la clave se mira la fila: una que ya dice
 * `premiado: true` no se vuelve a pagar. Las dos marcas se escriben en la
 * misma transacción, así que cualquiera de las dos alcanza.
 */

import { clavePeriodo, ZONA_POR_DEFECTO, RUTAS_RANKING } from "./reglas/ranking.js";
import { premioPorPuesto, multiplicadorDePeriodo } from "./reglas/economia.js";
import { premioFisicoDe, umbralesValidos } from "./reglas/configuracion.js";
import { PUESTO_MENSUAL_CON_INSIGNIA } from "./reglas/insignias.js";

/** Cuántas filas de cada tabla se miran para pagar. */
const FILAS_QUE_SE_MIRAN = 50;

export function crearCierreDePeriodos({
  db,
  moverLeyendas,
  // El motivo del premio en el libro mayor: `PREMIO_RANKING`.
  motivo,
  // `registrarPuestoMensual`, que otorga la insignia Leyenda.
  insignias,
  marcaDeTiempo,
  // `FieldValue.arrayUnion`, inyectado para poder probar esto sin Firebase.
  agregarAArray,
  logger,
  usuarios = "users",
  configuracion = "configuracion",
  zona = ZONA_POR_DEFECTO,
}) {
  /** Una referencia a partir de una ruta entera: `a/b/c/d`. */
  const ref = (ruta) => {
    const i = ruta.lastIndexOf("/");
    return db.collection(ruta.slice(0, i)).doc(ruta.slice(i + 1));
  };

  /**
   * Los juegos que tienen tablas: los documentos marcados con su `juego`.
   *
   * Un período viejo no tiene el campo —o ni siquiera tiene documento, si
   * nunca se cerró—, así que no pasa. Ver la cabecera.
   */
  async function juegosConTabla() {
    const refs = await db.collection(RUTAS_RANKING.coleccion).listDocuments();
    const juegos = [];
    for (const r of refs) {
      const snap = await r.get();
      if (snap.exists && snap.data()?.juego === r.id) juegos.push(r.id);
    }
    return juegos;
  }

  /** Cierra el período de UN juego y paga sus premios. */
  async function cerrarPeriodo(juego, periodo, fechaDelPeriodoQueCierra) {
    const clave = clavePeriodo(periodo, fechaDelPeriodoQueCierra, zona);
    const refPeriodo = ref(RUTAS_RANKING.periodo(juego, clave));

    const yaCerrado = await refPeriodo.get();
    if (yaCerrado.exists && yaCerrado.data().cerrado) {
      logger?.info?.("El período ya estaba cerrado", { juego, clave, periodo });
      return { juego, clave, premiados: 0 };
    }

    const tabla = await db
      .collection(RUTAS_RANKING.filas(juego, clave))
      .orderBy("puntos", "desc")
      .limit(FILAS_QUE_SE_MIRAN)
      .get();

    // El período se valida ANTES de pagarle a nadie.
    //
    // `premioPorPuesto` se rompe con un período que no conoce, y hace bien.
    // Pero si se rompiera adentro del bucle lo haría con veinte jugadores ya
    // cobrados y treinta sin cobrar, y un cierre a medias es peor que uno que
    // no arrancó.
    multiplicadorDePeriodo(periodo);

    let premiados = 0;
    for (let i = 0; i < tabla.docs.length; i++) {
      const fila = tabla.docs[i];
      const puesto = i + 1;
      const premio = premioPorPuesto(puesto, periodo);
      if (!premio) continue;

      // Ya cobró: ver «lo que no se paga dos veces», en la cabecera.
      if (fila.data()?.premiado === true) continue;

      await db.runTransaction(async (tx) => {
        const r = await moverLeyendas(tx, {
          uid: fila.id,
          delta: premio.leyendas,
          motivo,
          referencia: `${juego}/${clave}`,
          idempotencia: `premio_${juego}_${clave}_${fila.id}`,
        });
        if (!r.aplicado) return;

        // Sólo el puesto y las Leyendas. La única insignia del ranking es
        // `leyenda`, y la otorga `registrarPuestoMensual` más abajo, por el
        // mismo camino que todas: `users/{uid}/items/`.
        tx.set(fila.ref, { puesto, premiado: true }, { merge: true });
      });
      premiados++;
    }

    // ---- lo que sólo pasa al cerrar un mes ----
    //
    // Dos cosas que no son Leyendas: los premios FÍSICOS (remera y llavero) y
    // la insignia de Leyenda, que se gana entrando al top 5. Van fuera de las
    // transacciones del bucle porque no mueven saldo: dejan constancia y
    // otorgan, que son escrituras que se pueden repetir sin daño.
    //
    // Con un solo juego es exactamente lo de antes. Con un segundo, el cierre
    // de su mes también los otorgaría: está anotado para decidir si son por
    // juego antes de que llegue.
    let fisicos = 0;
    if (periodo === "mensual") {
      const umbrales = umbralesValidos(
        (await db.collection(configuracion).doc("ranking").get()).data(),
      );

      for (let i = 0; i < tabla.docs.length; i++) {
        const fila = tabla.docs[i];
        const puesto = i + 1;

        if (puesto <= PUESTO_MENSUAL_CON_INSIGNIA) {
          await insignias.registrarPuestoMensual(fila.id, puesto);
        }

        const premio = premioFisicoDe(puesto, Number(fila.data()?.puntos ?? 0), umbrales);
        if (!premio) continue;

        // `premios` es una lista de constancias, no un saldo. Nadie la cobra
        // desde acá: la mira un humano para saber qué mandar y a quién.
        await db.collection(usuarios).doc(fila.id).set(
          {
            premios: agregarAArray({
              premio: premio.premio,
              etiqueta: premio.etiqueta,
              juego,
              periodo: clave,
              puesto,
              puntos: premio.puntos,
            }),
          },
          { merge: true },
        );
        await fila.ref.set({ premioFisico: premio.premio }, { merge: true });
        fisicos++;
        logger?.info?.("Premio físico otorgado", { juego, clave, uid: fila.id, puesto, premio: premio.premio });
      }
    }

    await refPeriodo.set(
      {
        juego,
        tipo: periodo,
        clave,
        cerrado: true,
        cerradoEn: marcaDeTiempo(),
        premiados,
        fisicos,
      },
      { merge: true },
    );

    logger?.info?.("Período de ranking cerrado", { juego, clave, periodo, premiados });
    return { juego, clave, premiados };
  }

  /**
   * Cierra el período en TODOS los juegos que tienen tablas.
   *
   * Uno que falla no frena a los demás: se intenta cada uno, y si alguno
   * falló se avisa al final —así la ejecución programada queda marcada como
   * fallida y se ve en los registros—, después de haber cerrado lo que se
   * pudo.
   */
  async function cerrarPeriodos(periodo, fechaDelPeriodoQueCierra) {
    const resultados = [];
    const fallidos = [];

    for (const juego of await juegosConTabla()) {
      try {
        resultados.push(await cerrarPeriodo(juego, periodo, fechaDelPeriodoQueCierra));
      } catch (e) {
        logger?.error?.("No se pudo cerrar el período de un juego", { juego, periodo, error: e.message });
        fallidos.push({ juego, error: e.message });
      }
    }

    if (fallidos.length) {
      throw new Error(
        `No se pudo cerrar el período ${periodo} de: ` +
          fallidos.map((f) => `${f.juego} (${f.error})`).join(", "),
      );
    }
    return resultados;
  }

  return { cerrarPeriodo, cerrarPeriodos, juegosConTabla };
}
