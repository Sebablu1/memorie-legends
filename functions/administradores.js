/**
 * Quién puede administrar.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL ADMINISTRADOR RAÍZ ESTÁ CABLEADO, Y ES A PROPÓSITO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `correoRaiz` no vive en la base: vive en el código y no se puede quitar
 * desde ningún lado. Es el seguro contra el peor día posible — que la lista se
 * corrompa, que alguien se borre por error, que una escritura salga mal— y
 * deje a nadie con acceso al panel. Con una cuenta imposible de sacar, ese día
 * se arregla entrando; sin ella, se arregla con una credencial de servicio y
 * un rato de nervios.
 *
 * Los demás sí van en Firestore, para poder agregarlos y quitarlos sin
 * desplegar.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL DOCUMENTO SE LLAMA COMO EL CORREO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Comprobar si alguien es administrador pasa a ser UNA lectura por id, no una
 * consulta. Eso importa más de lo que parece: la comprobación corre en cada
 * llamada del panel, y una consulta con filtro cuesta más y —lo importante—
 * no se puede hacer dentro de una transacción con la misma simplicidad.
 *
 * El correo se guarda siempre en minúsculas y sin espacios. Sin eso,
 * `Ana@gmail.com` y `ana@gmail.com` serían dos documentos distintos y quitar
 * uno dejaría al otro con acceso.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA COLECCIÓN NO SE LEE NI SE ESCRIBE DESDE EL NAVEGADOR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Las reglas de Firestore la niegan a todo el mundo por el `match` final que
 * cierra lo no contemplado. Si se pudiera escribir desde el cliente, cualquiera
 * se agregaría a sí mismo y todo esto no serviría de nada.
 */

/** El correo, como se guarda y como se compara. */
export const normalizarCorreo = (c) => String(c ?? "").trim().toLowerCase();

/**
 * Forma mínima de correo.
 *
 * No valida que exista —eso no se puede desde acá— sino que no sea cualquier
 * cosa. Un administrador se agrega escribiendo a mano, y una barra o un
 * espacio de más romperían el id del documento.
 */
export const pareceCorreo = (c) => /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(normalizarCorreo(c));

export function crearAdministradores({
  db,
  error,
  marcaDeTiempo,
  ahora = () => Date.now(),
  correoRaiz,
  coleccion = "administradores",
}) {
  const raiz = normalizarCorreo(correoRaiz);
  const esRaiz = (correo) => normalizarCorreo(correo) === raiz;
  const ref = (correo) => db.collection(coleccion).doc(normalizarCorreo(correo));

  /**
   * ¿Este correo puede administrar?
   *
   * Se pregunta por el correo y no por el uid porque el correo es lo que se
   * puede escribir en el panel: nadie sabe de memoria el uid de nadie. Y es lo
   * que viene firmado en el token.
   */
  async function puedeAdministrar(correo) {
    const c = normalizarCorreo(correo);
    if (!c) return false;
    if (c === raiz) return true;

    const doc = await ref(c).get();
    // `activo !== false` y no `activo === true`: un documento viejo sin ese
    // campo cuenta como activo. Al revés, un cambio de forma dejaría a todos
    // los administradores existentes afuera de golpe.
    return doc.exists && doc.data()?.activo !== false;
  }

  /**
   * Exige que quien llama sea administrador. Devuelve quién es.
   *
   * Pide el correo VERIFICADO. Sin eso, registrar una cuenta con la dirección
   * de un administrador y no confirmarla sería suficiente para entrar.
   */
  async function exigir(context) {
    const token = context?.auth?.token;
    if (!token) throw error("unauthenticated", "Iniciá sesión para continuar.");

    const correo = normalizarCorreo(token.email);
    if (token.email_verified !== true || !(await puedeAdministrar(correo))) {
      // El mismo mensaje para "no sos administrador" y "no verificaste el
      // correo": desde afuera no conviene poder distinguir uno del otro.
      throw error("permission-denied", "Esta sección no es para vos.");
    }
    return { uid: context.auth.uid, correo };
  }

  // ───────────────────────────────────────────────────── el listado

  async function listar(context) {
    const yo = await exigir(context);
    const snap = await db.collection(coleccion).get();

    const agregados = [];
    snap.forEach((d) => {
      const datos = d.data() ?? {};
      if (datos.activo === false) return;
      agregados.push({
        correo: d.id,
        desde: datos.creado ?? null,
        agregadoPor: datos.agregadoPor ?? null,
        // Para que el panel pueda apagar el botón de quitarse a uno mismo.
        soyYo: d.id === yo.correo,
        raiz: false,
      });
    });

    agregados.sort((a, b) => a.correo.localeCompare(b.correo));

    // El raíz encabeza la lista y va marcado. No sale de la colección: no está
    // ahí. Si no se agregara acá, el panel mostraría una lista donde falta
    // justamente quien no se puede sacar, y daría la impresión de que sí.
    return {
      administradores: [
        { correo: raiz, desde: null, agregadoPor: null, soyYo: raiz === yo.correo, raiz: true },
        ...agregados,
      ],
      yo: yo.correo,
    };
  }

  // ───────────────────────────────────────────────────── alta y baja

  async function agregar(context, { correo }) {
    const yo = await exigir(context);
    const nuevo = normalizarCorreo(correo);

    if (!pareceCorreo(nuevo)) {
      throw error("invalid-argument", "Eso no tiene forma de correo.");
    }
    if (nuevo === raiz) {
      throw error("failed-precondition", "Esa cuenta ya es la administradora principal.");
    }

    return db.runTransaction(async (tx) => {
      // ---- LEER ----
      const ya = await tx.get(ref(nuevo));
      if (ya.exists && ya.data()?.activo !== false) {
        throw error("failed-precondition", "Esa cuenta ya es administradora.");
      }

      // ---- ESCRIBIR ----
      tx.set(ref(nuevo), {
        correo: nuevo,
        activo: true,
        creado: ahora(),
        // Quién lo agregó. Un permiso que aparece sin saber quién lo dio es un
        // permiso que nadie se anima a quitar.
        agregadoPor: yo.correo,
        actualizado: marcaDeTiempo ? marcaDeTiempo() : ahora(),
      });

      return { correo: nuevo, hizo: "agregado" };
    });
  }

  async function quitar(context, { correo }) {
    const yo = await exigir(context);
    const objetivo = normalizarCorreo(correo);

    // Las dos reglas que evitan quedarse sin nadie adentro.
    if (objetivo === raiz) {
      throw error(
        "failed-precondition",
        "La cuenta administradora principal no se puede quitar.",
      );
    }
    if (objetivo === yo.correo) {
      // Quitarse a uno mismo es un clic, y deshacerlo puede ser imposible si
      // era el último. Se pide que lo haga otro administrador, que además deja
      // constancia de quién fue.
      throw error(
        "failed-precondition",
        "No podés quitarte a vos mismo. Pedíselo a otro administrador.",
      );
    }

    return db.runTransaction(async (tx) => {
      // ---- LEER ----
      const actual = await tx.get(ref(objetivo));
      if (!actual.exists || actual.data()?.activo === false) {
        throw error("not-found", "Esa cuenta no es administradora.");
      }

      // ---- ESCRIBIR ----
      //
      // Se marca como inactiva en vez de borrarse. El documento es el asiento
      // de que esa cuenta tuvo acceso, quién se lo dio y quién se lo sacó; un
      // borrado deja la pregunta "¿quién le dio permiso?" sin respuesta para
      // siempre, que es justo la que uno se hace después de un problema.
      tx.set(ref(objetivo), {
        ...actual.data(),
        activo: false,
        quitado: ahora(),
        quitadoPor: yo.correo,
        actualizado: marcaDeTiempo ? marcaDeTiempo() : ahora(),
      });

      return { correo: objetivo, hizo: "quitado" };
    });
  }

  return { puedeAdministrar, exigir, listar, agregar, quitar, esRaiz, raiz };
}
