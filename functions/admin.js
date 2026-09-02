/**
 * Operaciones de administración.
 *
 * QUIÉN DECIDE
 *
 * El navegador del administrador pide; acá se decide. La identidad se lee de
 * `context.auth`, que lo pone Firebase al verificar el token, y no de nada que
 * el cliente mande: un `esAdmin: true` en el cuerpo del pedido no vale nada.
 *
 * POR QUÉ NO SE BORRAN LAS SALAS
 *
 * Una sala en espera tiene entradas YA COBRADAS. Borrar el documento no las
 * devuelve: el jugador pagó y se quedó sin nada y sin rastro de por qué. Así
 * que cancelar es devolver primero y marcar después —lo mismo que hace
 * `salida.js` cuando se va el creador—, y el documento se queda como asiento
 * de lo que pasó. El listado filtra las canceladas, que es lo que el
 * administrador quería: no verlas.
 *
 * POR QUÉ NO SE LEE `partidas` DESDE EL NAVEGADOR
 *
 * Ese documento tiene las manos de los cuatro y el orden del mazo. Las reglas
 * lo niegan a todo el mundo, administrador incluido. Lo que viaja acá es un
 * resumen que se arma en el servidor y no lleva ni una carta.
 */

import { ESTADOS_SALA } from "./reglas/salas.js";

export function crearAdmin({
  db,
  salas,
  partidas,
  moverLeyendas,
  motivo,
  marcaDeTiempo,
  error,
  estados = ESTADOS_SALA,
  emailAdmin,
  // La colección de perfiles. Se inyecta como todo lo demás para no repetir
  // el nombre de la colección en dos archivos.
  usuarios = "users",
}) {
  /**
   * Comprueba que quien llama es el administrador.
   *
   * Se exige el correo VERIFICADO. Sin eso, cualquiera que registre una cuenta
   * con esa dirección sin confirmarla entraría; con la verificación, hace falta
   * además haber recibido el correo, que es el control que de verdad importa.
   */
  function exigirAdmin(context) {
    const token = context?.auth?.token;
    if (!token) throw error("unauthenticated", "Iniciá sesión para continuar.");

    const correo = String(token.email ?? "").trim().toLowerCase();
    if (correo !== emailAdmin.toLowerCase() || token.email_verified !== true) {
      // Mismo mensaje para "no sos vos" y "no verificaste el correo": desde
      // afuera no conviene poder distinguir uno del otro.
      throw error("permission-denied", "Esta sección no es para vos.");
    }
    return context.auth.uid;
  }

  /** Lo que una sala retiene: sólo lo que se cobró de verdad. */
  const retenidoDe = (sala) => {
    const entrada = Number(sala.entrada) || 0;
    const jugadores = (sala.jugadores ?? []).length;
    return entrada * jugadores;
  };

  /**
   * Resumen de las salas vivas. Sin cartas, sin manos, sin mazo.
   *
   * Se omiten las terminadas y las canceladas: el administrador viene a ver lo
   * que todavía puede hacer algo, no el historial.
   */
  async function listarSalas(context) {
    exigirAdmin(context);

    const snap = await db.collection(salas).get();
    const vivas = [];
    let retenidoTotal = 0;

    snap.forEach((doc) => {
      const sala = doc.data();
      const estado = sala.estado ?? estados.ESPERANDO;
      if (estado === estados.TERMINADA || estado === estados.CANCELADA) return;

      const retenido = retenidoDe(sala);
      retenidoTotal += retenido;

      vivas.push({
        codigo: doc.id,
        estado,
        entrada: Number(sala.entrada) || 0,
        // Nombres, no identificadores: el panel los muestra y no los necesita
        // para nada más.
        jugadores: sala.jugadoresNombres ?? [],
        cuantos: (sala.jugadores ?? []).length,
        maxJugadores: Number(sala.maxJugadores) || 4,
        leyendasRetenidas: retenido,
        creada: sala.createdAt?.toMillis?.() ?? null,
        iniciadaEn: sala.iniciadaEn?.toMillis?.() ?? null,
        abandonaron: (sala.abandonados ?? []).length,
        // Se puede cancelar sin quitarle la partida a nadie.
        cancelable: estado === estados.ESPERANDO,
      });
    });

    // De las partidas sólo se cuenta y se dice en qué fase están. Nada más.
    const enJuego = await db.collection(partidas).get();
    const partidasVivas = [];
    enJuego.forEach((doc) => {
      const p = doc.data();
      if (p.cerrada) return;
      partidasVivas.push({
        codigo: doc.id,
        fase: p.estado?.fase ?? "?",
        ronda: p.estado?.ronda ?? null,
        jugadores: (p.jugadores ?? []).length,
        abandonaron: (p.abandonaron ?? []).length,
        actualizada: p.actualizado?.toMillis?.() ?? null,
      });
    });

    return {
      salas: vivas.sort((a, b) => (b.creada ?? 0) - (a.creada ?? 0)),
      partidas: partidasVivas.sort((a, b) => (b.actualizada ?? 0) - (a.actualizada ?? 0)),
      totales: {
        salas: vivas.length,
        partidas: partidasVivas.length,
        leyendasRetenidas: retenidoTotal,
      },
    };
  }

  /**
   * Cancela UNA sala en espera y devuelve las entradas.
   *
   * Se niega si la partida ya empezó: ahí las Leyendas están en juego y
   * sacarlas por la fuerza sería decidir el resultado desde afuera. Para eso
   * está el abandono, que es una decisión de cada jugador y tiene su regla.
   */
  async function cancelarUna(codigo, quien) {
    const codigoLimpio = String(codigo ?? "").trim().toUpperCase();
    if (!codigoLimpio) throw error("invalid-argument", "Falta el código de la sala.");

    return db.runTransaction(async (tx) => {
      const refSala = db.collection(salas).doc(codigoLimpio);
      const snap = await tx.get(refSala);
      if (!snap.exists) throw error("not-found", `La sala ${codigoLimpio} no existe.`);

      const sala = snap.data();
      const estado = sala.estado ?? estados.ESPERANDO;

      if (estado === estados.CANCELADA || estado === estados.TERMINADA) {
        // No es un error: cancelar dos veces tiene que ser inofensivo.
        return { codigo: codigoLimpio, yaEstaba: true, devueltas: 0, jugadores: [] };
      }
      if (estado === estados.JUGANDO) {
        throw error(
          "failed-precondition",
          `La sala ${codigoLimpio} está jugando: sus Leyendas están en juego y no se sacan desde acá.`,
        );
      }

      const jugadores = sala.jugadores ?? [];
      const entrada = Number(sala.entrada);
      if (jugadores.length && (!Number.isInteger(entrada) || entrada <= 0)) {
        throw error("internal", `La entrada de ${codigoLimpio} no es válida: ${sala.entrada}`);
      }

      // Todas las lecturas de saldo van juntas y antes de cualquier escritura:
      // en bucle, la segunda vuelta leería después de escribir y Firestore
      // rechazaría la transacción entera. Es el bug que ya tuvimos en `salida`.
      const resultados = jugadores.length
        ? await moverLeyendas.varias(
            tx,
            jugadores.map((jugador) => ({
              uid: jugador,
              delta: entrada,
              motivo,
              referencia: codigoLimpio,
              // La MISMA clave que usa `salida.js`: si el jugador ya había
              // salido y cobrado su devolución, esto no se la paga dos veces.
              idempotencia: `devolucion_${codigoLimpio}_${jugador}`,
            })),
          )
        : [];

      const devueltos = jugadores.filter((_, i) => resultados[i]?.aplicado);

      tx.update(refSala, {
        estado: estados.CANCELADA,
        canceladaEn: marcaDeTiempo(),
        motivoCancelacion: "cancelada por administración",
        canceladaPor: quien,
        devolucionesHechas: devueltos,
      });

      return {
        codigo: codigoLimpio,
        yaEstaba: false,
        devueltas: devueltos.length * entrada,
        jugadores: devueltos,
      };
    });
  }

  async function cancelarSala(context, { codigo }) {
    const quien = exigirAdmin(context);
    return cancelarUna(codigo, quien);
  }

  /**
   * Cancela todas las que estén esperando.
   *
   * Una transacción por sala, no una para todas: si una falla —un saldo
   * ilegible, una sala que arrancó en el medio— las demás igual se resuelven,
   * y se informa cuál falló y por qué. Una transacción única las haría
   * fracasar a todas por culpa de una.
   */
  async function cancelarTodasEnEspera(context) {
    const quien = exigirAdmin(context);

    const snap = await db.collection(salas).where("estado", "==", estados.ESPERANDO).get();
    const codigos = snap.docs.map((d) => d.id);

    const hechas = [];
    const fallidas = [];
    for (const codigo of codigos) {
      try {
        hechas.push(await cancelarUna(codigo, quien));
      } catch (e) {
        fallidas.push({ codigo, motivo: e?.message ?? "error desconocido" });
      }
    }

    return {
      intentadas: codigos.length,
      canceladas: hechas.filter((h) => !h.yaEstaba).length,
      yaEstaban: hechas.filter((h) => h.yaEstaba).length,
      devueltasEnTotal: hechas.reduce((s, h) => s + h.devueltas, 0),
      fallidas,
    };
  }

  /**
   * Nombres guardados que podrían hacer daño si se dibujaran sin escapar.
   *
   * Por qué acá y no en el navegador: `users` pasó a leerse SÓLO por su dueño
   * —el saldo vive en ese documento— así que ya no hay forma de listarla desde
   * una pestaña. Las Cloud Functions no pasan por las reglas, y ésta comprueba
   * el correo del administrador antes de mirar nada.
   *
   * Sólo LEE. Cambiarle el nombre a alguien es una acción sobre la cuenta de
   * una persona, y no la toma una función de listado.
   *
   * Devuelve el nombre TAL CUAL está guardado. El panel lo escapa al pintarlo
   * —para eso está `escapar`—, y eso es correcto: quien revisa esto necesita
   * ver exactamente qué se guardó, no una versión limpia.
   */
  async function revisarNombres(context) {
    exigirAdmin(context);

    // Los caracteres que un nombre normal no tiene y que son los que hacen
    // falta para salirse del texto. No se busca "código malicioso": eso no se
    // puede definir.
    const PELIGROSOS = /[<>"'&]/;
    // Y lo que ya no es un despiste con una comilla, sino un intento.
    const ATAQUE = /<\s*(script|img|svg|iframe)|on\w+\s*=|javascript:/i;

    const snap = await db.collection(usuarios).get();

    const sospechosos = [];
    snap.forEach((doc) => {
      const nombre = doc.data()?.username;
      if (typeof nombre !== "string") return;
      // Se marca por CUALQUIERA de las dos, no sólo por los caracteres.
      // `javascript:alert(1)` no tiene ninguno de `<>"'&` y como nombre no es
      // explotable —nunca va a parar a un href— pero la intención se ve igual,
      // y quien revisa esto quiere enterarse.
      const raro = PELIGROSOS.test(nombre);
      const ataque = ATAQUE.test(nombre);
      if (!raro && !ataque) return;
      sospechosos.push({
        uid: doc.id,
        nombre,
        pareceAtaque: ataque,
      });
    });

    // Los intentos claros primero: es lo que se quiere ver de un vistazo.
    sospechosos.sort((a, b) => Number(b.pareceAtaque) - Number(a.pareceAtaque));

    return {
      revisados: snap.size,
      sospechosos,
      ataques: sospechosos.filter((s) => s.pareceAtaque).length,
    };
  }

  return { listarSalas, cancelarSala, cancelarTodasEnEspera, revisarNombres, exigirAdmin };
}
