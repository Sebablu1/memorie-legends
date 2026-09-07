/**
 * Comprar y equipar artículos de personalización.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ UN MÓDULO Y NO CUATRO FUNCIONES EN `index.js`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Por lo mismo que `leyendas.js` y `admin.js`: acá se mueve saldo, y el saldo
 * hay que poder probarlo contra un Firestore de mentira en vez de confiar en
 * que está bien porque se lee bien. Las dependencias entran por parámetro; en
 * producción las provee `index.js` con el Firestore y el reloj reales.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LAS TRES COSAS QUE EL CLIENTE NO DECIDE
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   El PRECIO   se lee del catálogo en Firestore, dentro de la transacción que
 *               cobra. Si viajara en la llamada, el avatar más caro costaría
 *               una Leyenda desde la consola del navegador.
 *   El SALDO    lo mueve `moverLeyendas`, que es la única puerta del sistema.
 *               No hay un segundo camino que escriba `credits`.
 *   LA POSESIÓN vive en `users/{uid}/items/{itemId}`, que las reglas de
 *               Firestore dejan leer sólo a su dueño y escribir a nadie.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ LA POSESIÓN ES EL ID DEL DOCUMENTO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `users/{uid}/items/{itemId}` y no una lista dentro del perfil. Eso hace que
 * "¿ya lo tiene?" sea una lectura por id dentro de la transacción, que es lo
 * que convierte la compra doble en imposible en vez de improbable: dos
 * pedidos simultáneos leen el mismo documento inexistente, los dos intentan
 * crearlo, y Firestore aborta el segundo por conflicto. Con un array habría
 * que leer el perfil entero y confiar en el orden de llegada.
 */

import {
  TIPOS,
  CAMPO_EQUIPADO,
  esTipoValido,
  problemasDelItem,
  normalizarItem,
  ordenarItems,
  CATALOGO_INICIAL,
} from "./reglas/catalogo.js";

export function crearTienda({
  db,
  moverLeyendas,
  marcaDeTiempo,
  error,
  motivoCompra,
  usuarios = "users",
  catalogo = "catalogo",
  items = "items",
  // Quién puede administrar el catálogo. Se inyecta desde `administradores.js`,
  // que es el único lugar donde se decide eso.
  administradores,
}) {
  const refItemCatalogo = (id) => db.collection(catalogo).doc(id);
  const refPerfil = (uid) => db.collection(usuarios).doc(uid);
  const refPosesion = (uid, id) => refPerfil(uid).collection(items).doc(id);

  // ------------------------------------------------------------- comprar

  /**
   * Cobra un artículo y anota que ese jugador lo tiene.
   *
   * Todo dentro de una transacción, y en este orden porque Firestore exige
   * que las lecturas vayan antes que las escrituras: se lee el catálogo, se
   * lee la posesión, y recién ahí se cobra y se anota.
   *
   * La idempotencia es doble a propósito:
   *
   *   - el documento de posesión hace que comprar dos veces falle con un
   *     mensaje que se entiende ("ya lo tenés");
   *   - la clave `compra_{uid}_{itemId}` en el libro mayor hace que, si el
   *     mismo pedido llega dos veces por un problema de red, el segundo no
   *     cobre. Son dos defensas contra dos cosas distintas: el jugador que
   *     toca dos veces y la red que reintenta sola.
   */
  async function comprar(uid, itemId) {
    return db.runTransaction(async (tx) => {
      const enCatalogo = await tx.get(refItemCatalogo(itemId));
      if (!enCatalogo.exists) {
        throw error("not-found", "Ese artículo no existe.");
      }

      const item = enCatalogo.data();

      // Un artículo desactivado se deja de vender pero NO se le quita a quien
      // ya lo compró: por eso se comprueba acá y no al equipar.
      if (item.activo === false) {
        throw error("failed-precondition", "Ese artículo no está a la venta.");
      }

      const precio = Number(item.precio);
      if (!Number.isInteger(precio) || precio < 0) {
        // El catálogo lo escribe el panel, que valida; esto es el cinturón por
        // si alguna vez se escribe a mano desde la consola de Firebase.
        throw error("failed-precondition", "Ese artículo tiene un precio inválido.");
      }

      const yaLoTiene = await tx.get(refPosesion(uid, itemId));
      if (yaLoTiene.exists) {
        throw error("already-exists", "Ya tenés ese artículo.");
      }

      // Los gratuitos no pasan por el libro mayor. Un asiento de cero Leyendas
      // es ruido en el historial de alguien que quiso ver qué era su avatar.
      let saldo = null;
      if (precio > 0) {
        const r = await moverLeyendas(tx, {
          uid,
          delta: -precio,
          motivo: motivoCompra,
          referencia: itemId,
          idempotencia: `compra_${uid}_${itemId}`,
        });
        saldo = r.saldo;
      }

      tx.set(refPosesion(uid, itemId), {
        tipo: item.tipo,
        nombre: item.nombre ?? itemId,
        precioPagado: precio,
        compradoEn: marcaDeTiempo(),
      });

      return { itemId, tipo: item.tipo, precio, saldo };
    });
  }

  // ------------------------------------------------------------- equipar

  /**
   * Se pone un artículo que ya tiene.
   *
   * No mueve saldo, así que no hay libro mayor de por medio. Lo que sí hay es
   * la comprobación que da sentido a todo lo demás: que lo tenga. Sin ella, la
   * tienda sería decorativa — cualquiera se equiparía el dragón sin pagarlo.
   *
   * Equipar es idempotente sin esfuerzo: el perfil guarda UN id por tipo, así
   * que ponerse otro avatar pisa el anterior. No hay nada que desequipar.
   */
  async function equipar(uid, itemId) {
    return db.runTransaction(async (tx) => {
      const posesion = await tx.get(refPosesion(uid, itemId));
      if (!posesion.exists) {
        throw error("permission-denied", "Todavía no tenés ese artículo.");
      }

      const tipo = posesion.data().tipo;
      if (!esTipoValido(tipo)) {
        throw error("failed-precondition", "Ese artículo no tiene un tipo válido.");
      }

      tx.set(refPerfil(uid), { [CAMPO_EQUIPADO[tipo]]: itemId }, { merge: true });

      return { itemId, tipo, campo: CAMPO_EQUIPADO[tipo] };
    });
  }

  // ---------------------------------------------------------- lo que tengo

  /**
   * Qué compró y qué tiene puesto.
   *
   * El navegador podría leer las dos cosas por su cuenta —las reglas se lo
   * permiten a su dueño— pero se devuelven juntas para que la tienda pinte
   * en un viaje en vez de tres.
   */
  async function misItems(uid) {
    const [perfil, snap] = await Promise.all([
      refPerfil(uid).get(),
      refPerfil(uid).collection(items).get(),
    ]);

    const tengo = [];
    snap.forEach((d) => tengo.push({ id: d.id, ...d.data() }));

    const datos = perfil.exists ? perfil.data() : {};
    const equipado = {};
    for (const tipo of Object.values(TIPOS)) {
      equipado[tipo] = datos[CAMPO_EQUIPADO[tipo]] ?? null;
    }

    return { tengo, equipado };
  }

  // ------------------------------------------------- administrar el catálogo

  /**
   * Llena la colección la primera vez.
   *
   * NO pisa lo que ya está. La semilla existe para que una instalación nueva
   * tenga algo que mostrar, no para revertir los precios que el administrador
   * haya cambiado: si sobrescribiera, tocar este botón sin querer devolvería
   * el catálogo entero a los valores de fábrica.
   */
  async function sembrarCatalogo(context) {
    await administradores.exigir(context);

    const existentes = await db.collection(catalogo).get();
    const yaEstan = new Set();
    existentes.forEach((d) => yaEstan.add(d.id));

    let creados = 0;
    for (const crudo of CATALOGO_INICIAL) {
      if (yaEstan.has(crudo.id)) continue;
      const problemas = problemasDelItem(crudo);
      if (problemas.length) {
        // La semilla está en el código: si no valida, es un error de programa,
        // no del administrador. Se corta en vez de sembrar algo malformado.
        throw error("internal", `La semilla tiene un artículo inválido: ${problemas[0]}`);
      }
      await refItemCatalogo(crudo.id).set({
        ...normalizarItem(crudo),
        creadoEn: marcaDeTiempo(),
      });
      creados++;
    }

    return { creados, yaEstaban: yaEstan.size };
  }

  /**
   * El catálogo entero, activos e inactivos, para el panel.
   *
   * El navegador del jugador lee la colección directamente —las reglas se lo
   * permiten— pero ve todo, incluido lo desactivado, y filtra al dibujar. El
   * administrador necesita justo lo contrario: verlo TODO, porque lo apagado
   * es lo que va a querer volver a encender.
   */
  async function listarCatalogo(context) {
    await administradores.exigir(context);
    const snap = await db.collection(catalogo).get();
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
    return { items: ordenarItems(items) };
  }

  /**
   * Crea o reemplaza un artículo.
   *
   * Una sola operación para las dos cosas, y a propósito: "crear" y "editar"
   * se distinguen sólo en si el id ya existía, y tener dos caminos obligaba a
   * duplicar la validación entera. Lo que sí se distingue es el AVISO — quien
   * cree estar creando y esté pisando algo tiene que enterarse.
   *
   * El precio se valida acá y nunca se toma de una compra: `comprar` lo lee de
   * este mismo documento. Un precio negativo REGALARÍA Leyendas, porque el
   * mismo `moverLeyendas` que cobra sabe sumar.
   */
  async function guardarItem(context, datos) {
    await administradores.exigir(context);

    const problemas = problemasDelItem(datos);
    if (problemas.length) {
      throw error("invalid-argument", problemas.join(" "));
    }

    const item = normalizarItem(datos);
    const ref = refItemCatalogo(item.id);
    const previo = await ref.get();

    await ref.set(
      previo.exists
        ? { ...item, actualizadoEn: marcaDeTiempo() }
        : { ...item, creadoEn: marcaDeTiempo() },
      { merge: true },
    );

    return { id: item.id, creado: !previo.exists };
  }

  /**
   * Enciende o apaga un artículo.
   *
   * Es lo que se usa en vez de borrar, y es la razón de que borrar casi nunca
   * haga falta: un artículo apagado deja de venderse pero NO se le quita a
   * quien ya lo compró. Sus cartas siguen dibujándose, su avatar sigue
   * puesto. Borrarlo dejaría a esa gente con un id que no resuelve a nada.
   */
  async function activarItem(context, id, activo) {
    await administradores.exigir(context);

    const ref = refItemCatalogo(id);
    const snap = await ref.get();
    if (!snap.exists) throw error("not-found", "Ese artículo no existe.");

    await ref.set({ activo: Boolean(activo), actualizadoEn: marcaDeTiempo() }, { merge: true });
    return { id, activo: Boolean(activo) };
  }

  /**
   * Borra un artículo, y sólo si nadie lo compró.
   *
   * Ésta es la única operación de la tienda que destruye algo, así que
   * pregunta primero. Si alguien lo tiene, se niega y sugiere apagarlo: el
   * documento del catálogo es lo que da nombre e imagen a lo que ese jugador
   * compró, y sin él su avatar pasa a ser un id huérfano.
   *
   * La consulta recorre las subcolecciones `items` de TODOS los perfiles con
   * un `collectionGroup` y filtra por id en memoria. Se podría filtrar en la
   * consulta guardando el id como campo, pero eso pide un índice compuesto y
   * una migración de los documentos que ya existen, para ahorrar en la única
   * operación de la tienda que se usa una vez cada mucho. Es cara a propósito:
   * se paga al borrar, y a cambio no se puede romper la compra de nadie sin
   * enterarse.
   */
  async function borrarItem(context, id) {
    await administradores.exigir(context);

    const ref = refItemCatalogo(id);
    const snap = await ref.get();
    if (!snap.exists) throw error("not-found", "Ese artículo no existe.");

    const comprados = await db.collectionGroup(items).get();
    const dueños = [];
    comprados.forEach((d) => {
      if (d.id === id) dueños.push(d.id);
    });

    if (dueños.length) {
      throw error(
        "failed-precondition",
        `No se puede borrar: ${dueños.length} jugador${dueños.length === 1 ? "" : "es"} ya lo ` +
          "compró. Desactivalo en vez de borrarlo, así deja de venderse pero no se le quita a nadie.",
      );
    }

    await ref.delete();
    return { id, borrado: true };
  }

  return {
    comprar,
    equipar,
    misItems,
    sembrarCatalogo,
    listarCatalogo,
    guardarItem,
    activarItem,
    borrarItem,
  };
}
