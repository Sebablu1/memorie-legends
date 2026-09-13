/**
 * Los paquetes de Leyendas: leerlos, administrarlos y entregar lo que traen.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ SALIERON DEL CÓDIGO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Eran una constante en `reglas/economia.js`. Cambiar un precio, agregar un
 * pack o retirarlo requería un despliegue, y las promociones no esperan a un
 * despliegue. Ahora viven en `tienda/packs/items/{id}` y se administran desde
 * el panel.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE NO CAMBIÓ, Y ES LO IMPORTANTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El precio lo sigue poniendo el SERVIDOR. Que el pack venga de Firestore en
 * vez de una constante no significa que venga del navegador: `crearOrden`
 * recibe un id y lee el resto acá. Si el precio viajara en la llamada, el pack
 * más caro costaría un peso desde la consola.
 *
 * Y lo que se le acredita al comprador queda congelado en la orden en el
 * momento de comprar. Editar un pack no toca ninguna compra ya hecha.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ HAY UNA SEMILLA DE RESPALDO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque una tienda sin paquetes no puede cobrar, y "se borró sin querer la
 * colección" no puede ser el fin del negocio. Si la colección está vacía se
 * usan los de `PAQUETES`. No es lo mismo que sembrar: no escribe nada, sólo
 * evita que la tienda quede muda mientras alguien arregla el desastre.
 */

import {
  PAQUETES,
  problemasDelPaquete,
  normalizarPaquete,
  paquetesVisibles,
  leyendasDePaquete,
} from "./reglas/economia.js";

export function crearPacks({
  db,
  error,
  marcaDeTiempo,
  logger,
  // `tienda/packs/items` — tres segmentos, así que `packs` es un documento y
  // `items` la colección que cuelga de él. Firestore alterna colección y
  // documento, y no hay forma de tener una colección de dos segmentos.
  coleccion = "tienda/packs/items",
  administradores,
}) {
  const refPack = (id) => db.doc(`${coleccion}/${id}`);
  const refColeccion = () => db.collection(coleccion);

  /**
   * Todos los paquetes guardados. Vacío si no hay ninguno.
   *
   * No cae a la semilla: eso lo decide quien llama, porque el panel SÍ quiere
   * ver que la colección está vacía y la tienda no.
   */
  async function listarGuardados() {
    const snap = await refColeccion().get();
    const packs = [];
    snap.forEach((doc) => packs.push({ ...doc.data(), id: doc.id }));
    return packs;
  }

  /**
   * Lo que ve el panel: todo, activos y apagados, y de dónde salió.
   *
   * `desdeLaSemilla` importa: un administrador que ve cinco packs y no sabe
   * que ninguno está guardado va a editar uno y no va a entender por qué los
   * otros cuatro siguen igual.
   */
  async function listarParaAdmin(context) {
    await administradores.exigir(context);
    const guardados = await listarGuardados();
    if (guardados.length) {
      return { packs: ordenar(guardados), desdeLaSemilla: false };
    }
    return { packs: ordenar(PAQUETES.map(normalizarPaquete)), desdeLaSemilla: true };
  }

  /** Lo que ve la tienda: sólo los encendidos, en orden. */
  async function listarParaLaTienda() {
    const guardados = await listarGuardados();
    const fuente = guardados.length ? guardados : PAQUETES.map(normalizarPaquete);
    return paquetesVisibles(fuente);
  }

  /**
   * Un paquete por id, para cobrarlo.
   *
   * Devuelve `null` si no existe o si está apagado. Apagado importa tanto como
   * inexistente: retirar un pack de la tienda y que igual se pueda comprar
   * mandando el id a mano no sería retirarlo.
   */
  async function paraCobrar(id) {
    const clave = String(id ?? "").trim();
    if (!clave) return null;

    const doc = await refPack(clave).get();
    if (doc.exists) {
      const pack = { ...doc.data(), id: doc.id };
      return pack.activo === false ? null : pack;
    }

    // Respaldo: la colección todavía no se sembró.
    const deLaSemilla = PAQUETES.find((p) => p.id === clave);
    if (!deLaSemilla) return null;
    const pack = normalizarPaquete(deLaSemilla);
    return pack.activo === false ? null : pack;
  }

  const ordenar = (packs) =>
    packs.slice().sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || String(a.id).localeCompare(String(b.id)));

  // ------------------------------------------------------- administración

  /**
   * Crea o reemplaza un paquete.
   *
   * Una sola función para las dos cosas, igual que `guardarItem` del catálogo:
   * "crear" y "editar" se distinguen sólo en si el id ya existía, y dos
   * caminos serían dos lugares donde puede fallar la validación.
   *
   * La validación corre ACÁ y no sólo en el panel. El panel manda un objeto a
   * una Cloud Function; quien abra la consola manda el que quiera, y lo que
   * está en juego es a cuánto se vende.
   */
  async function guardar(context, datos) {
    const quien = await administradores.exigir(context);

    const problemas = problemasDelPaquete(datos);
    if (problemas.length) throw error("invalid-argument", problemas.join(" "));

    const pack = normalizarPaquete(datos);

    /**
     * Los artículos que promete tienen que existir en el catálogo.
     *
     * Es la regla que ya se rompió una vez: el Pack Élite prometía una
     * insignia `comprador-elite` que no estaba en ningún catálogo, así que
     * nadie la recibía nunca y nada fallaba. `tienda.otorgar` tira
     * `not-found` sobre un id que no existe, y eso pasaría DESPUÉS del pago,
     * cuando el comprador ya puso la plata.
     *
     * Se comprueba al guardar el pack, que es cuando hay alguien mirando la
     * pantalla y todavía no hay dinero de por medio.
     */
    if (pack.itemsExclusivos.length) {
      const docs = await Promise.all(
        pack.itemsExclusivos.map((id) => db.collection("catalogo").doc(id).get()),
      );
      const faltan = pack.itemsExclusivos.filter((_, i) => !docs[i].exists);
      if (faltan.length) {
        throw error(
          "failed-precondition",
          `Estos artículos no están en el catálogo: ${faltan.join(", ")}. ` +
            "Creálos antes de ponerlos en un pack.",
        );
      }
    }

    await refPack(pack.id).set({ ...pack, actualizado: marcaDeTiempo() }, { merge: false });
    logger?.info?.("Pack guardado", { pack: pack.id, por: quien?.uid ?? null });

    return { pack, leyendasTotal: leyendasDePaquete(pack) };
  }

  /**
   * Borra un paquete.
   *
   * Borrar y no apagar, porque el panel también puede apagar y son dos cosas
   * distintas: apagado deja de venderse y se puede volver a encender; borrado
   * no está más.
   *
   * Las órdenes ya pagadas no se tocan y no les afecta: guardan su propio
   * `paqueteId`, `importe` y `leyendas`, así que una compra vieja se sigue
   * leyendo entera aunque el pack no exista más.
   */
  async function borrar(context, id) {
    const quien = await administradores.exigir(context);
    const clave = String(id ?? "").trim();
    if (!clave) throw error("invalid-argument", "Falta el id del pack.");

    const doc = await refPack(clave).get();
    if (!doc.exists) throw error("not-found", "Ese pack no existe.");

    await refPack(clave).delete();
    logger?.info?.("Pack borrado", { pack: clave, por: quien?.uid ?? null });
    return { borrado: clave };
  }

  /** Enciende o apaga sin tener que reenviar el pack entero. */
  async function activar(context, id, activo) {
    await administradores.exigir(context);
    const clave = String(id ?? "").trim();
    if (!clave) throw error("invalid-argument", "Falta el id del pack.");

    const doc = await refPack(clave).get();
    if (!doc.exists) throw error("not-found", "Ese pack no existe.");

    await refPack(clave).set({ activo: Boolean(activo), actualizado: marcaDeTiempo() }, { merge: true });
    return { id: clave, activo: Boolean(activo) };
  }

  /**
   * Escribe la semilla, sin pisar lo que ya esté.
   *
   * Igual que `sembrarCatalogo`: sembrar dos veces no revierte los precios que
   * el administrador haya cambiado.
   */
  async function sembrar(context) {
    await administradores.exigir(context);

    const guardados = new Set((await listarGuardados()).map((p) => p.id));
    const nuevos = PAQUETES.filter((p) => !guardados.has(p.id)).map(normalizarPaquete);

    for (const pack of nuevos) {
      await refPack(pack.id).set({ ...pack, actualizado: marcaDeTiempo() });
    }

    return { creados: nuevos.map((p) => p.id), yaEstaban: [...guardados] };
  }

  return {
    listarGuardados,
    listarParaAdmin,
    listarParaLaTienda,
    paraCobrar,
    guardar,
    borrar,
    activar,
    sembrar,
  };
}
