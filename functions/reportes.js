/**
 * Reportes entre jugadores.
 *
 * QUÉ ES Y QUÉ NO ES
 *
 * Es una bandeja de entrada para una persona. No bloquea a nadie, no descuenta
 * Leyendas, no cierra cuentas y no decide nada solo: junta lo que los
 * jugadores denuncian y se lo muestra al administrador, que resuelve a mano.
 *
 * Que sea manual está dicho a propósito en `seguridad.html`. Un sistema que
 * suspendiera cuentas solo, con esta cantidad de señal, se equivocaría seguido
 * — y equivocarse acá significa dejar a alguien sin su saldo.
 *
 * DE DÓNDE SALE CADA DATO
 *
 * El denunciante NUNCA viene del cliente: sale de `context.auth.uid`, que lo
 * pone Firebase al verificar el token. Si viniera del pedido, cualquiera
 * podría firmar denuncias con el nombre de otro.
 *
 * POR QUÉ EL CLIENTE NO LEE `reportes`
 *
 * Las reglas le niegan la colección entera a todo el mundo. Un reporte lleva
 * quién denunció a quién: si se pudiera leer, el denunciado sabría quién lo
 * reportó, que es exactamente el motivo por el que mucha gente no reporta.
 * Se escribe por esta función y se lee sólo desde el panel, que también pasa
 * por el servidor.
 */

/** Los motivos que se aceptan. Cerrado: texto libre hay uno solo, el comentario. */
export const MOTIVOS = Object.freeze([
  "trampa",
  "insultos",
  "abandono",
  "nombre",
  "otro",
]);

export const ESTADOS_REPORTE = Object.freeze(["pendiente", "resuelto", "ignorado"]);

/** Lo que se tolera de comentario. Suficiente para explicarse, corto para leerlo. */
export const LARGO_COMENTARIO = 500;

/**
 * Cuánto hay que esperar para volver a denunciar a la MISMA persona.
 *
 * Veinticuatro horas. El límite de ritmo ya frena el bucle de una pestaña,
 * pero no frena a alguien que denuncia al mismo rival una vez por minuto
 * durante una tarde: eso pasa el límite y llena la bandeja de ruido dirigido
 * a una persona. Que se pueda denunciar a otros mientras tanto es a propósito;
 * lo que se corta es el ensañamiento con uno.
 */
export const MS_ENTRE_REPORTES_AL_MISMO = 24 * 60 * 60 * 1000;

export function crearReportes({
  db,
  error,
  ahora = () => Date.now(),
  marcaDeTiempo,
  reportes = "reportes",
  usuarios = "users",
  // Quién puede administrar. Ver `administradores.js`.
  administradores,
}) {
  const ref = (id) => db.collection(reportes).doc(id);

  /**
   * Guarda un reporte.
   *
   * Todas las LECTURAS van antes de la primera escritura. No es estilo: las
   * reglas de Firestore rechazan una transacción que lea después de escribir,
   * y `pruebas/transacciones.mjs` lo audita leyendo el archivo.
   */
  async function reportar(uid, { denunciado, motivo, comentario, codigo }) {
    if (!uid) throw error("unauthenticated", "Iniciá sesión para continuar.");
    if (typeof denunciado !== "string" || !denunciado.trim()) {
      throw error("invalid-argument", "Falta a quién estás reportando.");
    }
    if (denunciado === uid) {
      throw error("invalid-argument", "No podés reportarte a vos mismo.");
    }
    if (!MOTIVOS.includes(motivo)) {
      throw error("invalid-argument", "Ese motivo no existe.");
    }

    const texto = String(comentario ?? "").trim().slice(0, LARGO_COMENTARIO);
    const t = ahora();

    return db.runTransaction(async (tx) => {
      // ---- LEER ----

      // Que la cuenta denunciada exista. Sin esto, la bandeja se llena de
      // reportes contra uids inventados y el administrador pierde el tiempo
      // buscando cuentas que nunca hubo.
      const quien = await tx.get(db.collection(usuarios).doc(denunciado));
      if (!quien.exists) throw error("not-found", "Esa cuenta no existe.");

      // Y si ya lo denunció hace poco. Se busca por el par, no por el
      // denunciante solo: bloquear a quien reportó a alguien hace una hora le
      // impediría reportar a otro que le está arruinando la partida ahora.
      const previos = await tx.get(
        db.collection(reportes)
          .where("denunciante", "==", uid)
          .where("denunciado", "==", denunciado)
          .orderBy("creado", "desc")
          .limit(1),
      );

      const ultimo = previos.docs?.[0]?.data();
      if (ultimo && t - (ultimo.creado ?? 0) < MS_ENTRE_REPORTES_AL_MISMO) {
        throw error(
          "failed-precondition",
          "Ya reportaste a esta persona hace poco. Lo estamos mirando.",
        );
      }

      // ---- ESCRIBIR ----

      const doc = ref(`r_${t}_${uid.slice(0, 8)}_${denunciado.slice(0, 8)}`);
      tx.set(doc, {
        denunciante: uid,
        denunciado,
        motivo,
        comentario: texto,
        // La sala donde pasó, si la mandaron. Sirve para cruzarlo con la
        // partida; no se valida contra `rooms` a propósito, porque una sala
        // cancelada se borra y el reporte tiene que sobrevivirla.
        sala: typeof codigo === "string" ? codigo.trim().toUpperCase().slice(0, 8) : null,
        estado: "pendiente",
        creado: t,
        actualizado: marcaDeTiempo ? marcaDeTiempo() : t,
      });

      return { hecho: true };
    });
  }

  // ------------------------------------------------------------ el panel

  /**
   * Quién puede administrar lo decide `administradores.js`, no este archivo.
   *
   * Acá había una copia de la comprobación, escrita cuando el único
   * administrador era un correo cableado. Con la lista, dos copias serían dos
   * respuestas distintas a la misma pregunta el día que una se actualice y la
   * otra no.
   */
  async function exigirAdmin(context) {
    const { uid } = await administradores.exigir(context);
    return uid;
  }

  /**
   * Los reportes más recientes, con los nombres ya resueltos.
   *
   * Los nombres se buscan acá y no en el navegador porque `users` se lee sólo
   * por su dueño: el panel no puede pedirle a Firestore el nombre de nadie.
   */
  async function listar(context, { estado, limite = 50 } = {}) {
    await exigirAdmin(context);

    const tope = Math.min(Math.max(Number(limite) || 50, 1), 200);
    let consulta = db.collection(reportes).orderBy("creado", "desc").limit(tope);
    if (ESTADOS_REPORTE.includes(estado)) {
      consulta = db.collection(reportes)
        .where("estado", "==", estado)
        .orderBy("creado", "desc")
        .limit(tope);
    }

    const snap = await consulta.get();
    const filas = [];
    snap.forEach((d) => filas.push({ id: d.id, ...(d.data() ?? {}) }));

    // Los nombres, de una sola pasada. Se junta el conjunto de uids primero
    // para no leer dos veces al mismo cuando aparece en varios reportes.
    const uids = new Set();
    for (const f of filas) {
      if (f.denunciante) uids.add(f.denunciante);
      if (f.denunciado) uids.add(f.denunciado);
    }

    const nombres = new Map();
    await Promise.all(
      [...uids].map(async (u) => {
        const d = await db.collection(usuarios).doc(u).get();
        nombres.set(u, d.exists ? (d.data()?.username ?? "") : null);
      }),
    );

    return {
      total: filas.length,
      pendientes: filas.filter((f) => f.estado === "pendiente").length,
      reportes: filas.map((f) => ({
        id: f.id,
        motivo: f.motivo,
        comentario: f.comentario ?? "",
        sala: f.sala ?? null,
        estado: f.estado ?? "pendiente",
        creado: f.creado ?? 0,
        nota: f.nota ?? "",
        denunciante: {
          uid: f.denunciante,
          // `null` significa "la cuenta ya no está", que es distinto de "no
          // tiene nombre puesto". El panel los muestra distinto.
          nombre: nombres.get(f.denunciante) ?? null,
        },
        denunciado: {
          uid: f.denunciado,
          nombre: nombres.get(f.denunciado) ?? null,
        },
      })),
    };
  }

  /** Marca un reporte como resuelto o ignorado. No toca la cuenta denunciada. */
  async function resolver(context, { id, estado, nota }) {
    const admin = await exigirAdmin(context);

    if (typeof id !== "string" || !id.trim()) {
      throw error("invalid-argument", "Falta el reporte.");
    }
    if (!["resuelto", "ignorado", "pendiente"].includes(estado)) {
      throw error("invalid-argument", "Ese estado no existe.");
    }

    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref(id));
      if (!snap.exists) throw error("not-found", "Ese reporte ya no está.");

      tx.set(ref(id), {
        ...snap.data(),
        estado,
        nota: String(nota ?? "").trim().slice(0, LARGO_COMENTARIO),
        resueltoPor: admin,
        actualizado: marcaDeTiempo ? marcaDeTiempo() : ahora(),
      });

      return { id, estado };
    });
  }

  return { reportar, listar, resolver, exigirAdmin };
}
