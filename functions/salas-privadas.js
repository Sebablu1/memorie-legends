/**
 * Salas privadas: se entra con un código que el servidor no guarda.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ CAMBIA RESPECTO DE UNA SALA NORMAL
 * ─────────────────────────────────────────────────────────────────────────
 *
 * En una sala de siempre, el código ES el identificador del documento: está
 * en la URL, se ve en la pantalla de la sala y con él se entra. Sirve para
 * jugar con quien uno quiera, pero no es un secreto: quien ve la pantalla de
 * otro, o la URL en una captura, tiene la llave.
 *
 * En una privada son dos cosas distintas:
 *
 *   - el IDENTIFICADOR de la sala, que va en la URL y no sirve para entrar;
 *   - el CÓDIGO, que sirve para entrar y no está escrito en ninguna parte.
 *
 * De lo segundo Firestore guarda un hash. Quien se lleve una copia de la base
 * no se lleva ningún código: tiene que adivinarlos, y son 31⁸ —unos ochocientos
 * mil millones— con cinco intentos por minuto y por IP.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA PIMIENTA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El hash lleva una pimienta que vive en el entorno de las funciones y NO en
 * la base: `PIMIENTA_CODIGOS`. Sin ella el hash sigue funcionando, pero quien
 * se llevara la base podría probar los ochocientos mil millones por su cuenta,
 * sin límite de ritmo que lo frene. Con ella, además necesita el entorno.
 *
 * No hay sal por código, y es a propósito: para encontrar la sala hay que
 * poder calcular el hash ANTES de saber a qué documento pertenece, y una sal
 * distinta por código obligaría a recorrer la colección entera en cada
 * intento.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ NO HACE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * No toca el cobro. La entrada la cobra `abrirSalaEn` y la de quien se suma,
 * `sumarse`: las dos vienen de afuera y son las mismas que usan las salas
 * normales. Dos copias de una línea que mueve Leyendas es justamente lo que
 * `pruebas/transacciones.mjs` está para impedir.
 */

import crypto from "node:crypto";

/** Sin I, L, O, 0 ni 1: se confunden al dictar un código por teléfono. */
export const ALFABETO_CODIGO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Ocho caracteres: 31⁸ ≈ 8,5 × 10¹¹ combinaciones. */
export const LARGO_CODIGO = 8;

/** Cuánto vale un código si no se pide otra cosa: media hora. */
export const MINUTOS_VIGENCIA_POR_DEFECTO = 30;

/** Lo que se puede pedir: de cinco minutos a un día. */
export const MINUTOS_VIGENCIA_MINIMA = 5;
export const MINUTOS_VIGENCIA_MAXIMA = 24 * 60;

/** Deja el código como se guarda: mayúsculas y sólo el alfabeto. */
export const normalizarCodigo = (codigo) =>
  String(codigo ?? "")
    .toUpperCase()
    .split("")
    .filter((c) => ALFABETO_CODIGO.includes(c))
    .join("");

/**
 * El hash con el que se busca la sala.
 *
 * SHA-256 y no algo más lento a propósito: esto corre en el camino de un
 * jugador que está entrando a una mesa, y lo que frena la fuerza bruta es el
 * límite de cinco intentos por minuto, no el costo de una vuelta de hash.
 */
export const hashDeCodigo = (codigo, pimienta = "") =>
  crypto.createHash("sha256").update(`${pimienta}:${normalizarCodigo(codigo)}`).digest("hex");

/** Un código nuevo, con el azar del sistema. */
export function generarCodigoSecreto(bytes = (n) => crypto.randomBytes(n)) {
  const crudo = bytes(LARGO_CODIGO * 2);
  let salida = "";
  for (let i = 0; salida.length < LARGO_CODIGO; i++) {
    salida += ALFABETO_CODIGO[crudo[i % crudo.length] % ALFABETO_CODIGO.length];
  }
  return salida;
}

export function crearSalasPrivadas({
  db,
  salas = "rooms",
  codigos = "codigos",
  error,
  ahora = () => Date.now(),
  marcaDeTiempo = () => new Date().toISOString(),
  /**
   * La pimienta. Si no se inyecta —las pruebas lo hacen—, sale del entorno EN
   * CADA LLAMADA, nunca acá: ver `exigirPimienta`.
   */
  pimienta = null,
  bytes = (n) => crypto.randomBytes(n),
  /** Abre la sala y cobra la entrada. El mismo que usa `crearSala`. */
  abrirSalaEn,
  /** Suma a un jugador y le cobra. El mismo que usa `unirseASala`. */
  sumarse,
  /** Nombre y aspecto con los que se sienta. */
  identidadEnSala,
  /** Un identificador de sala libre, del mismo alfabeto que los de siempre. */
  generarIdDeSala,
}) {
  const refSala = (id) => db.collection(salas).doc(id);
  const refCodigo = (hash) => db.collection(codigos).doc(hash);

  /**
   * La pimienta, o nada.
   *
   * ───────────────────────────────────────────────────────────────────────
   * POR QUÉ ROMPE EN VEZ DE SEGUIR
   * ───────────────────────────────────────────────────────────────────────
   *
   * Antes esto era `process.env.PIMIENTA_CODIGOS ?? ""`. Con el secreto sin
   * declarar en la función, el entorno no lo tiene y el `??` lo tapaba: el
   * servidor hashheaba con pimienta vacía, contestaba 200 y nadie se
   * enteraba. Los códigos quedaban guardados como `sha256(":" + codigo)`, que
   * es exactamente lo que la pimienta existe para impedir — y el día que se
   * la pusiera, todos esos códigos dejarían de abrir su sala sin que nada lo
   * explicara.
   *
   * Un servicio de salas privadas caído se arregla en un despliegue. Un
   * servicio que parece andar y guarda hashes sin pimienta, no se arregla:
   * hay que rehacer las salas.
   *
   * ───────────────────────────────────────────────────────────────────────
   * POR QUÉ ACÁ Y NO AL CARGAR EL MÓDULO
   * ───────────────────────────────────────────────────────────────────────
   *
   * Porque `crearSalasPrivadas` se llama al cargar `index.js`, y ahí viven
   * las otras cuarenta funciones. Reventar al cargar dejaría sin desplegar
   * —y sin arrancar— TODO lo demás por un secreto que sólo usan dos
   * callables. Se comprueba al usarlo: cae quien lo necesita y nadie más.
   */
  function exigirPimienta() {
    const valor = pimienta ?? process.env.PIMIENTA_CODIGOS ?? "";
    if (!valor) {
      // Al registro del servidor, con nombre y apellido; al jugador, no.
      console.error(
        "PIMIENTA_CODIGOS no está en el entorno: las salas privadas quedan " +
        "fuera de servicio. Declarar el secreto con runWith({ secrets: [...] }).",
      );
      throw error(
        "failed-precondition",
        "Las salas privadas no están disponibles en este momento.",
      );
    }
    return valor;
  }

  /**
   * Los minutos pedidos, acotados a lo que se permite.
   *
   * `null` es «no pidieron nada», igual que `undefined`: es lo que manda el
   * SDK cuando el cliente omite el argumento. Sin esta línea, `Number(null)`
   * daba 0 —un número finito— y el 0 se recortaba al MÍNIMO: toda sala creada
   * sin pedir vigencia caducaba a los cinco minutos en vez de a la media hora.
   * En silencio, porque no falla nada: simplemente el código dejaba de servir
   * mucho antes.
   */
  function vigenciaEnMs(minutos) {
    if (minutos == null) return MINUTOS_VIGENCIA_POR_DEFECTO * 60_000;
    const pedidos = Number(minutos);
    if (!Number.isFinite(pedidos)) return MINUTOS_VIGENCIA_POR_DEFECTO * 60_000;
    const acotados = Math.min(
      MINUTOS_VIGENCIA_MAXIMA,
      Math.max(MINUTOS_VIGENCIA_MINIMA, Math.round(pedidos)),
    );
    return acotados * 60_000;
  }

  /**
   * Abre una sala privada y devuelve su código UNA sola vez.
   *
   * El código no se guarda en ninguna parte: lo que queda en la base es su
   * hash. Si quien la abrió lo pierde, no hay forma de recuperarlo — hay que
   * abrir otra sala—. Es la contrapartida de que no se pueda filtrar.
   */
  async function crearSalaPrivada({
    uid, entrada, nombre, limitePuntos, vigenciaMinutos,
  }) {
    if (!uid) throw error("unauthenticated", "Iniciá sesión para continuar.");
    // Antes de cobrar nada: sin pimienta no se abre una sala que después
    // nadie va a poder abrir.
    const sazon = exigirPimienta();

    const { nombre: nombreJugador, luce } = await identidadEnSala(uid);
    const vigencia = vigenciaEnMs(vigenciaMinutos);

    // Hasta cinco intentos por si un identificador de sala ya estaba tomado.
    for (let intento = 0; intento < 5; intento++) {
      const id = generarIdDeSala();
      const codigo = generarCodigoSecreto(bytes);
      const vence = ahora() + vigencia;

      try {
        await db.runTransaction(async (tx) =>
          // Primero la sala —que lee el perfil para cobrar la entrada— y
          // después el código. Al revés, Firestore rechazaría la lectura.
          abrirSalaEn(tx, {
            codigo: id,
            uid,
            entrada,
            nombre,
            nombreJugador,
            luce,
            extra: {
              privada: true,
              // Fuera de las listas públicas: a una privada se entra con su
              // código y con nada más.
              listada: false,
              limitePuntos,
              // Cuándo deja de servir el código. La sala sigue viva: lo que
              // vence es la invitación, no la mesa.
              codigoVence: vence,
            },
          }).then(() => {
            tx.set(refCodigo(hashDeCodigo(codigo, sazon)), {
              sala: id,
              vence,
              creada: marcaDeTiempo(),
            });
          }),
        );

        return { sala: id, codigo, vence };
      } catch (e) {
        if (e?.message === "codigo-ocupado") continue;
        throw e;
      }
    }

    throw error("internal", "No pudimos abrir la sala. Probá de nuevo.");
  }

  /**
   * Entra a una sala privada con su código.
   *
   * El mensaje es el MISMO para un código que no existe, uno vencido y uno
   * de una sala que ya arrancó: decir cuál de las tres cosas pasó le sirve
   * sobre todo a quien está probando códigos.
   */
  async function unirseConCodigo({ uid, codigo }) {
    if (!uid) throw error("unauthenticated", "Iniciá sesión para continuar.");

    const sazon = exigirPimienta();
    const limpio = normalizarCodigo(codigo);
    const noSirve = () => error("not-found", "Ese código no sirve o ya venció.");
    if (limpio.length !== LARGO_CODIGO) throw noSirve();

    const hash = hashDeCodigo(limpio, sazon);
    const { nombre: nombreJugador, luce } = await identidadEnSala(uid);

    return db.runTransaction(async (tx) => {
      const snapCodigo = await tx.get(refCodigo(hash));
      if (!snapCodigo.exists) throw noSirve();

      const { sala: id, vence } = snapCodigo.data();
      if (!id || !(Number(vence) > ahora())) throw noSirve();

      const ref = refSala(id);
      const snapSala = await tx.get(ref);
      if (!snapSala.exists) throw noSirve();

      const resultado = await sumarse(tx, {
        refSala: ref,
        sala: snapSala.data(),
        codigo: id,
        uid,
        nombreJugador,
        luce,
      });

      // Lo que vuelve es el identificador de la sala, nunca el código: con
      // él se abre la pantalla de la sala, y sirve para eso y para nada más.
      return { ...resultado, sala: id };
    });
  }

  /**
   * Borra los códigos vencidos. La sala no se toca: lo que caduca es la
   * invitación.
   *
   * Sin esto la colección crece para siempre con documentos que ya no dejan
   * entrar a ningún lado.
   */
  async function limpiarCodigosVencidos({ tope = 200 } = {}) {
    const vencidos = await db
      .collection(codigos)
      .where("vence", "<=", ahora())
      .limit(tope)
      .get();

    const lote = db.batch();
    vencidos.docs.forEach((d) => lote.delete(d.ref));
    await lote.commit();
    return { borrados: vencidos.docs.length };
  }

  return {
    crearSalaPrivada,
    unirseConCodigo,
    limpiarCodigosVencidos,
    vigenciaEnMs,
    exigirPimienta,
  };
}
