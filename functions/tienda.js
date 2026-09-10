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
  esVendible,
  problemasDelItem,
  normalizarItem,
  ordenarItems,
  precioDePack,
  descuentoPorCantidad,
  imagenEsArchivo,
  MAXIMO_POR_PACK,
  CATALOGO_INICIAL,
} from "./reglas/catalogo.js";

export function crearTienda({
  db,
  moverLeyendas,
  marcaDeTiempo,
  error,
  motivoCompra,
  motivoDevolucion,
  // Lo que se asienta al pagar una insignia. Es su propio motivo: la casa
  // emite esas Leyendas, no salen del pozo de nadie.
  motivoLogro,
  usuarios = "users",
  catalogo = "catalogo",
  items = "items",
  auditoria = "auditoria",
  // Quién puede administrar el catálogo. Se inyecta desde `administradores.js`,
  // que es el único lugar donde se decide eso.
  administradores,
}) {
  const refItemCatalogo = (id) => db.collection(catalogo).doc(id);
  const refPerfil = (uid) => db.collection(usuarios).doc(uid);
  const refPosesion = (uid, id) => refPerfil(uid).collection(items).doc(id);
  const refAuditoria = () => db.collection(auditoria).doc();

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
  /**
   * Compra de 1 a 3 artículos en una sola transacción.
   *
   * Es la ÚNICA ruta de compra: `comprar` llama acá con una lista de uno.
   * Tener dos funciones que cobran sería tener dos lugares donde puede
   * fallar la comprobación de precio, y sólo uno de ellos se acordaría de
   * arreglarse.
   *
   * El orden importa y no es negociable: PRIMERO todas las lecturas
   * —catálogo, posesiones, perfil— y recién después las escrituras. Firestore
   * rechaza lo contrario, y el Firestore de mentira de las pruebas también.
   */
  async function comprarVarios(uid, itemIds) {
    const ids = [...new Set(itemIds.map((s) => String(s ?? "").trim()).filter(Boolean))];

    if (!ids.length) throw error("invalid-argument", "No pediste ningún artículo.");
    if (ids.length > MAXIMO_POR_PACK) {
      throw error("invalid-argument", `No se pueden llevar más de ${MAXIMO_POR_PACK} de una vez.`);
    }

    return db.runTransaction(async (tx) => {
      // ---- lecturas ----
      const enCatalogo = await Promise.all(ids.map((id) => tx.get(refItemCatalogo(id))));
      const posesiones = await Promise.all(ids.map((id) => tx.get(refPosesion(uid, id))));
      const perfil = await tx.get(refPerfil(uid));

      const articulos = [];
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        if (!enCatalogo[i].exists) throw error("not-found", "Ese artículo no existe.");

        const item = enCatalogo[i].data();

        // Las insignias son logros. No se venden ni con saldo de sobra: la
        // comprobación está acá, en el servidor, porque esconder el botón en
        // la tienda no impide la llamada.
        if (!esVendible(item.tipo)) {
          throw error("failed-precondition", "Ese artículo no está a la venta: se gana jugando.");
        }

        // Un artículo desactivado se deja de vender pero NO se le quita a
        // quien ya lo compró: por eso se comprueba acá y no al equipar.
        if (item.activo === false) {
          throw error("failed-precondition", "Ese artículo no está a la venta.");
        }

        const precio = Number(item.precio);
        if (!Number.isInteger(precio) || precio < 0) {
          // El catálogo lo escribe el panel, que valida; esto es el cinturón
          // por si alguna vez se escribe a mano desde la consola de Firebase.
          throw error("failed-precondition", "Ese artículo tiene un precio inválido.");
        }

        articulos.push({ id, item, precio, yaLoTiene: posesiones[i].exists });
      }

      // El descuento se calcula sobre los NUEVOS. Si contara los repetidos,
      // meter en el pack algo ya comprado abarataría el resto.
      //
      // Todo esto se arma en UN bucle con llaves y antes de cobrar. No es
      // estilo: `pruebas/transacciones.mjs` audita que no haya bucles con
      // movimientos de saldo adentro de una transacción, y una flecha sin
      // llaves le impide delimitar dónde termina el bucle.
      const nuevos = [];
      const idsNuevos = [];
      const yaTenia = [];
      let sinDescuento = 0;
      for (const a of articulos) {
        if (a.yaLoTiene) {
          yaTenia.push(a.id);
          continue;
        }
        nuevos.push(a);
        idsNuevos.push(a.id);
        sinDescuento += a.precio;
      }

      if (!nuevos.length) throw error("already-exists", "Ya tenés ese artículo.");

      const total = precioDePack(sinDescuento, nuevos.length);
      const referencia = idsNuevos.join(",");
      // Los ids ordenados: el mismo pack pedido dos veces por un reintento de
      // red da la misma clave y cobra una sola vez, sin importar en qué orden
      // los mandó el cliente.
      const claveIdempotencia = `compra_${uid}_${[...idsNuevos].sort().join("_")}`;

      // ---- escrituras ----
      //
      // Los gratuitos no pasan por el libro mayor. Un asiento de cero Leyendas
      // es ruido en el historial de alguien que quiso ver qué era su avatar.
      let saldo = null;
      if (total > 0) {
        const r = await moverLeyendas(tx, {
          uid,
          delta: -total,
          motivo: motivoCompra,
          referencia,
          idempotencia: claveIdempotencia,
        });
        saldo = r.saldo;
      }

      const datosPerfil = perfil.exists ? perfil.data() : {};
      const aEquipar = {};

      for (const a of nuevos) {
        tx.set(refPosesion(uid, a.id), {
          tipo: a.item.tipo,
          nombre: a.item.nombre ?? a.id,
          precioPagado: a.precio,
          compradoEn: marcaDeTiempo(),
        });

        // El primero de cada tipo se pone solo. Comprar un avatar y que no
        // pase nada visible es la queja obvia; a partir del segundo ya hay una
        // elección que hacer, y elegir por el jugador sería pisarle la puesta.
        const campo = CAMPO_EQUIPADO[a.item.tipo];
        if (campo && !datosPerfil[campo] && !aEquipar[campo]) aEquipar[campo] = a.id;
      }

      if (Object.keys(aEquipar).length) tx.set(refPerfil(uid), aEquipar, { merge: true });

      return {
        comprados: nuevos.map((a) => ({ id: a.id, tipo: a.item.tipo, precio: a.precio })),
        // Los que venían en el pedido y ya tenía. No es un error —el pack se
        // compra igual— pero el cliente necesita poder decirlo.
        yaTenia,
        total,
        sinDescuento,
        descuento: descuentoPorCantidad(nuevos.length),
        ahorro: sinDescuento - total,
        equipado: aEquipar,
        saldo,
      };
    });
  }

  /** Comprar uno. Devuelve la forma de siempre, que es la que usa la tienda. */
  async function comprar(uid, itemId) {
    const r = await comprarVarios(uid, [itemId]);
    const c = r.comprados[0];
    return { itemId: c.id, tipo: c.tipo, precio: c.precio, saldo: r.saldo, equipado: r.equipado };
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

  /**
   * Se saca lo que tiene puesto, dejando el campo en `null`.
   *
   * Hace falta porque equipar no puede deshacerse solo: el perfil guarda un id
   * por tipo, así que ponerse otro pisa el anterior, pero no ponerse NINGUNO
   * no tiene forma de expresarse cambiando de artículo. Quien quiere jugar sin
   * insignia no tiene un "artículo sin insignia" que elegir.
   *
   * No comprueba posesión a propósito: sacarse algo que no se tiene no es un
   * privilegio, y si el perfil quedó apuntando a un artículo borrado, esto es
   * exactamente lo que lo destraba.
   */
  async function desequipar(uid, tipo) {
    if (!esTipoValido(tipo)) {
      throw error("invalid-argument", "Ese tipo de artículo no existe.");
    }
    await refPerfil(uid).set({ [CAMPO_EQUIPADO[tipo]]: null }, { merge: true });
    return { tipo, campo: CAMPO_EQUIPADO[tipo], equipado: null };
  }

  // ------------------------------------------------------------- otorgar

  /**
   * Le da un artículo sin cobrarlo, y le paga lo que ese logro valga.
   *
   * NO es una callable y no puede serlo: no hay ningún camino desde el
   * navegador hasta acá. La llama el servidor cuando una insignia se gana.
   *
   * ───────────────────────────────────────────────────────────────────────
   * POR QUÉ AHORA ES UNA TRANSACCIÓN
   * ───────────────────────────────────────────────────────────────────────
   *
   * Porque otorgar dejó de ser una escritura inocente. Antes sólo anotaba la
   * posesión; ahora las insignias pagan Leyendas, y saldo y posesión tienen
   * que moverse juntos o no moverse. Con dos escrituras sueltas, un corte en
   * el medio dejaba al jugador con la insignia y sin las Leyendas —o al
   * revés, cobrando dos veces la próxima vez que el servidor revisara.
   *
   * El orden es el de siempre y no es negociable: primero TODAS las lecturas
   * —catálogo, posesión—, después `moverLeyendas`, que lee y escribe por
   * dentro, y recién al final la posesión. Firestore rechaza leer después de
   * escribir, y el Firestore de mentira de las pruebas también.
   *
   * ───────────────────────────────────────────────────────────────────────
   * DOS CANDADOS CONTRA EL PAGO DOBLE
   * ───────────────────────────────────────────────────────────────────────
   *
   * El documento de posesión se llama como el artículo, así que revisar dos
   * veces encuentra que ya lo tiene y no vuelve a entrar. Y si igual entrara
   * —dos servidores a la vez, una posesión borrada a mano desde el panel— la
   * clave `logro_{uid}_{itemId}` del libro mayor hace que el segundo asiento
   * no exista. Son dos defensas contra dos cosas distintas, igual que en la
   * compra.
   *
   * @returns leyendas: lo que se acreditó de verdad. Cero si ya lo tenía o si
   *          el asiento ya estaba: quien avisa en pantalla no tiene que
   *          adivinar si el pago ocurrió.
   */
  async function otorgar(uid, itemId, { origen = "logro", premio = 0 } = {}) {
    const leyendas = Number.isInteger(premio) && premio > 0 ? premio : 0;

    // Sin motivo no se paga.
    //
    // `moverLeyendas` no comprueba el motivo, así que una fábrica montada sin
    // `motivoLogro` escribiría el asiento con `motivo: undefined`. El saldo
    // quedaría bien y el libro mayor inservible: la gracia de tener motivos es
    // poder preguntarle de dónde salió cada Leyenda, y un asiento sin motivo
    // no se puede clasificar después.
    if (leyendas > 0 && !motivoLogro) {
      throw error("internal", "Falta el motivo contable para pagar un logro.");
    }

    return db.runTransaction(async (tx) => {
      // ---- lecturas ----
      const enCatalogo = await tx.get(refItemCatalogo(itemId));
      if (!enCatalogo.exists) throw error("not-found", "Ese artículo no existe.");

      const item = enCatalogo.data();
      const ref = refPosesion(uid, itemId);
      const yaLoTiene = await tx.get(ref);
      const nombre = item.nombre ?? itemId;
      if (yaLoTiene.exists) return { itemId, nombre, tipo: item.tipo, nuevo: false, leyendas: 0 };

      // ---- el saldo, que lee y escribe por dentro ----
      let acreditado = 0;
      if (leyendas > 0) {
        const movimiento = await moverLeyendas(tx, {
          uid,
          delta: leyendas,
          motivo: motivoLogro,
          referencia: itemId,
          idempotencia: `logro_${uid}_${itemId}`,
        });
        if (movimiento.aplicado) acreditado = leyendas;
      }

      // ---- escrituras ----
      tx.set(ref, {
        tipo: item.tipo,
        nombre,
        precioPagado: 0,
        origen,
        // Lo que pagó el logro queda anotado en la posesión además de en el
        // libro mayor. El asiento es la verdad contable; esto es para poder
        // mirar un inventario y entender de dónde salió cada cosa sin cruzar
        // dos colecciones.
        leyendasPagadas: acreditado,
        compradoEn: marcaDeTiempo(),
      });

      return { itemId, nombre, tipo: item.tipo, nuevo: true, leyendas: acreditado };
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
   * Apaga los artículos del catálogo de demostración.
   *
   * ───────────────────────────────────────────────────────────────────────
   * QUÉ SON "LOS VIEJOS"
   * ───────────────────────────────────────────────────────────────────────
   *
   * Los que se sembraron cuando el catálogo era de mentira: `avatar-dragon`,
   * `insignia-corona`, `dorso-azul` y compañía, con un EMOJI en el campo de
   * imagen porque todavía no había dibujos. Siguen en Firestore porque sembrar
   * no pisa lo que ya está —eso es a propósito, para no revertir un precio que
   * el administrador cambió—, así que la tienda los muestra al lado de los de
   * verdad, con un emoji donde va la figura.
   *
   * ───────────────────────────────────────────────────────────────────────
   * POR QUÉ SE RECONOCEN POR LA IMAGEN Y NO POR LA EXTENSIÓN
   * ───────────────────────────────────────────────────────────────────────
   *
   * Lo que los distingue es que su imagen NO ES UN ARCHIVO: es un emoji. Un
   * criterio parecido y tentador —"todo lo que no termine en .webp"— apagaría
   * también los dos dorsos, que son PNG legítimos y están en uso. La
   * diferencia entre las dos reglas es invisible al leerlas y evidente al
   * ejecutarlas.
   *
   * ───────────────────────────────────────────────────────────────────────
   * APAGA, NO BORRA
   * ───────────────────────────────────────────────────────────────────────
   *
   * Por lo mismo que `activarItem` existe: si alguien alcanzó a comprar uno,
   * el documento del catálogo es lo que le da nombre e imagen a lo que tiene.
   * Borrarlo lo dejaría con un id huérfano. Apagado, deja de venderse y sigue
   * dibujándose.
   */
  async function apagarCatalogoViejo(context, { simular = false } = {}) {
    await administradores.exigir(context);

    const snap = await db.collection(catalogo).get();
    const candidatos = [];
    snap.forEach((doc) => {
      const d = doc.data();
      if (d.activo === false) return; // ya apagado: no hay nada que hacer
      if (imagenEsArchivo(d.imagen)) return; // tiene dibujo de verdad
      candidatos.push({ id: doc.id, nombre: d.nombre ?? doc.id, imagen: d.imagen ?? "" });
    });

    // `simular` existe para poder mirar antes de tocar. El panel lo usa para
    // mostrar la lista y pedir confirmación: apagar diez artículos sin ver
    // cuáles es la clase de botón que nadie se anima a tocar.
    if (simular) return { apagados: 0, candidatos, simulado: true };

    for (const c of candidatos) {
      await refItemCatalogo(c.id).set(
        { activo: false, actualizadoEn: marcaDeTiempo() },
        { merge: true },
      );
    }

    return { apagados: candidatos.length, candidatos, simulado: false };
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

    const dueños = await poseedoresDe(id);

    if (dueños.length) {
      throw error(
        "failed-precondition",
        `No se puede borrar: ${dueños.length} jugador${dueños.length === 1 ? "" : "es"} ya lo ` +
          "compró. Desactivalo, o usá el borrado forzado si de verdad hay que " +
          "sacárselo a todo el mundo.",
      );
    }

    await ref.delete();
    return { id, borrado: true };
  }

  // ------------------------------------------------- quitar un artículo

  /**
   * Quiénes tienen un artículo, y cuánto pagaron.
   *
   * ─────────────────────────────────────────────────────────────────────
   * POR QUÉ RECORRE TODO EN VEZ DE CONSULTAR
   * ─────────────────────────────────────────────────────────────────────
   *
   * Porque la posesión se guarda como el ID DEL DOCUMENTO —`users/{uid}/
   * items/{itemId}`, que es lo que hace imposible comprar dos veces lo
   * mismo— y en una consulta de grupo de colecciones no se puede filtrar
   * por el último tramo del identificador: `documentId()` compara la ruta
   * entera, que incluye el uid.
   *
   * Filtrar de verdad pediría guardar el id también como campo y migrar lo
   * ya comprado. No vale la pena: esto lo llama el panel de administración,
   * a mano y de a una vez, y lo que recorre son las compras que hubo, no
   * los usuarios que hay. El día que sean decenas de miles, el arreglo es
   * ese campo — y este comentario dice cuál era el motivo.
   */
  async function poseedoresDe(id) {
    const comprados = await db.collectionGroup(items).get();
    const dueños = [];
    comprados.forEach((d) => {
      if (d.id !== id) return;
      dueños.push({ uid: dueñoDe(d.ref), precioPagado: Number(d.data()?.precioPagado ?? 0) });
    });
    return dueños;
  }

  /**
   * De quién es una posesión: `users/{uid}/items/{itemId}`.
   *
   * Se intenta primero por la ruta y después por el abuelo del documento.
   * Los dos caminos existen en Firestore; el de la ruta existe además en el
   * Firestore de mentira de las pruebas, que no arma la cadena de padres.
   *
   * Devuelve `null` si no se pudo averiguar, y ese `null` NO se descarta en
   * silencio: una posesión cuyo dueño no se sabe sigue contando como
   * poseída —para que `borrarItem` se siga negando— y hace que el borrado
   * forzado se plante. Descartarla sería borrar el artículo dejándole a esa
   * persona un id que no apunta a nada.
   */
  function dueñoDe(ref) {
    const porRuta = String(ref?.path ?? "").split("/");
    if (porRuta.length >= 2 && porRuta[1]) return porRuta[1];
    return ref?.parent?.parent?.id ?? null;
  }

  /**
   * La lista de poseedores, con nombre y correo para poder reconocerlos.
   *
   * Antes de sacarle algo a alguien hay que poder ver a quién. Un `uid` no
   * le dice nada a nadie.
   */
  async function listarPoseedores(context, id) {
    await administradores.exigir(context);

    const dueños = await poseedoresDe(id);
    if (!dueños.length) return { itemId: id, poseedores: [] };

    const perfiles = await Promise.all(dueños.map((d) => refPerfil(d.uid).get()));

    return {
      itemId: id,
      poseedores: dueños.map((d, i) => {
        const datos = perfiles[i].exists ? perfiles[i].data() : {};
        // Si lo tiene puesto, hace falta saberlo: quitárselo le va a
        // cambiar lo que se ve, no sólo lo que tiene guardado.
        const equipadoEn = Object.entries(CAMPO_EQUIPADO)
          .filter(([, campo]) => datos[campo] === id)
          .map(([tipo]) => tipo);
        return {
          uid: d.uid,
          username: datos.username ?? null,
          email: datos.email ?? null,
          precioPagado: d.precioPagado,
          equipado: equipadoEn.length > 0,
        };
      }),
    };
  }

  /**
   * Le saca un artículo a una persona, y le devuelve lo que pagó.
   *
   * ─────────────────────────────────────────────────────────────────────
   * POR QUÉ DEVUELVE
   * ─────────────────────────────────────────────────────────────────────
   *
   * Porque si no, es quedarse con lo que pagó. El caso que motivó esto son
   * artículos de prueba que compró la propia cuenta de administración, y
   * ahí devolver o no da lo mismo; pero la función es general y algún día
   * se va a usar sobre alguien de verdad.
   *
   * La devolución pasa por `moverLeyendas` como todo lo que toca el saldo,
   * con una clave de idempotencia por artículo y persona: repetir la
   * operación no paga dos veces.
   *
   * ─────────────────────────────────────────────────────────────────────
   * Y POR QUÉ SE LO DESEQUIPA
   * ─────────────────────────────────────────────────────────────────────
   *
   * Porque el perfil guarda el id de lo que lleva puesto, no una copia del
   * artículo. Sacándoselo del inventario y dejando el campo apuntando ahí,
   * la mesa y la tienda quedan buscando un artículo que ya no le pertenece
   * —y si además se borra del catálogo, uno que no existe—.
   *
   * Se miran TODOS los campos equipados y no sólo el del tipo que dice la
   * posesión: las compras viejas podrían no tener guardado el tipo, y un
   * campo que quedó apuntando a la nada no avisa, sólo deja de dibujar.
   */
  async function desposeer(context, { itemId, uid }) {
    const quien = await administradores.exigir(context);

    return db.runTransaction(async (tx) => {
      // Todas las lecturas antes de cualquier escritura. `moverLeyendas`
      // lee el saldo y escribe, así que va después de éstas y antes del
      // resto.
      const posesion = await tx.get(refPosesion(uid, itemId));
      const perfil = await tx.get(refPerfil(uid));

      if (!posesion.exists) {
        // No es un error: quitar dos veces tiene que ser inofensivo.
        return { uid, itemId, yaEstaba: true, devueltas: 0, desequipado: [] };
      }

      const datos = perfil.exists ? perfil.data() : {};
      const precio = Number(posesion.data()?.precioPagado ?? 0);

      const devolucion =
        precio > 0
          ? await moverLeyendas(tx, {
              uid,
              delta: precio,
              motivo: motivoDevolucion,
              referencia: itemId,
              idempotencia: `desposesion_${itemId}_${uid}`,
            })
          : { aplicado: false };

      tx.delete(refPosesion(uid, itemId));

      const desequipado = [];
      for (const campo of Object.values(CAMPO_EQUIPADO)) {
        if (datos[campo] === itemId) desequipado.push(campo);
      }
      if (desequipado.length) {
        tx.set(
          refPerfil(uid),
          Object.fromEntries(desequipado.map((campo) => [campo, null])),
          { merge: true },
        );
      }

      // El libro mayor explica el saldo; esto explica el artículo. Son dos
      // preguntas distintas y mezclarlas dejaría el libro con asientos de
      // cero Leyendas que no dicen nada de dónde fue el dinero.
      tx.set(refAuditoria(), {
        accion: "desposeer",
        itemId,
        uid,
        admin: quien?.email ?? quien?.uid ?? null,
        precioDevuelto: devolucion.aplicado ? precio : 0,
        desequipado,
        cuando: marcaDeTiempo(),
      });

      return {
        uid,
        itemId,
        yaEstaba: false,
        devueltas: devolucion.aplicado ? precio : 0,
        desequipado,
      };
    });
  }

  /**
   * Saca el artículo de todos los inventarios y después lo borra.
   *
   * Una transacción POR PERSONA, no una para todas. Es la misma decisión
   * que toma `cancelarTodasEnEspera` con las salas y por el mismo motivo:
   * si el saldo de alguien no se puede leer, los demás igual se resuelven
   * y se informa cuál falló. Una transacción única las haría fracasar a
   * todas por culpa de una — y además `pruebas/transacciones.mjs` prohíbe,
   * con razón, mover plata dentro de un bucle en una transacción.
   *
   * El artículo se borra sólo si NO quedó ningún poseedor. Borrarlo igual
   * dejaría a esa persona con un id que no apunta a nada: ni se ve, ni se
   * puede desequipar, ni se puede volver a quitar.
   */
  async function forzarBorrar(context, id) {
    await administradores.exigir(context);

    const ref = refItemCatalogo(id);
    if (!(await ref.get()).exists) throw error("not-found", "Ese artículo no existe.");

    const dueños = await poseedoresDe(id);

    // Si de alguna posesión no se sabe de quién es, no se toca nada. Borrar
    // el artículo dejaría a esa persona con un id colgado: no se ve, no se
    // puede desequipar y no se puede volver a quitar.
    const anonimas = dueños.filter((d) => !d.uid).length;
    if (anonimas) {
      throw error(
        "internal",
        `Hay ${anonimas} posesion${anonimas === 1 ? "" : "es"} de las que no se pudo ` +
          "averiguar el dueño. No se borró nada.",
      );
    }

    const quitados = [];
    const fallidos = [];

    for (const dueño of dueños) {
      try {
        quitados.push(await desposeer(context, { itemId: id, uid: dueño.uid }));
      } catch (e) {
        fallidos.push({ uid: dueño.uid, motivo: e?.message ?? "error desconocido" });
      }
    }

    if (fallidos.length) {
      throw error(
        "aborted",
        `No se le pudo quitar a ${fallidos.length} de ${dueños.length}. El artículo NO se ` +
          `borró: ${fallidos.map((f) => f.motivo).join("; ")}`,
      );
    }

    await ref.delete();

    return {
      id,
      borrado: true,
      quitadoA: quitados.filter((q) => !q.yaEstaba).length,
      devueltasEnTotal: quitados.reduce((s, q) => s + q.devueltas, 0),
    };
  }

  return {
    comprar,
    comprarVarios,
    equipar,
    desequipar,
    otorgar,
    misItems,
    sembrarCatalogo,
    listarCatalogo,
    guardarItem,
    activarItem,
    apagarCatalogoViejo,
    borrarItem,
    listarPoseedores,
    desposeer,
    forzarBorrar,
  };
}
