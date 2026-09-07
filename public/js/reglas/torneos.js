/**
 * Torneos: estados, mesas y reparto del pozo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO ES PURO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque un torneo mueve dinero de verdad —cada inscripción cobra la entrada—
 * y lo que decide cuánto se cobra y cuánto se devuelve no puede vivir mezclado
 * con Firestore. Acá entra un objeto y sale otro; el servidor se encarga de
 * guardar. Así se pueden probar cien inscripciones y una cancelación sin
 * levantar nada, y sobre todo se puede probar que el pozo CIERRA: que lo que
 * se reparte más lo que se queda la casa es exactamente lo que entró.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LOS ESTADOS SON UN CAMINO, NO UN CAMPO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un torneo va para adelante y no vuelve. Eso importa porque cada paso hace
 * algo irreversible con la plata: abrir inscripciones deja que se cobre,
 * iniciar impide devolver, finalizar paga. Si el estado fuera un campo que el
 * panel escribe libre, un clic mal dado podría reabrir las inscripciones de un
 * torneo ya jugado y cobrar la entrada dos veces.
 *
 * Por eso `TRANSICIONES` dice desde dónde se puede llegar a cada estado, y el
 * servidor lo comprueba antes de tocar nada.
 */

// ------------------------------------------------------------- estados

export const ESTADOS = {
  BORRADOR: "borrador",
  INSCRIPCIONES_ABIERTAS: "inscripciones_abiertas",
  COMPLETO: "completo",
  EN_CURSO: "en_curso",
  FINALIZADO: "finalizado",
  CANCELADO: "cancelado",
};

/**
 * Desde qué estado se puede pasar a cada uno.
 *
 * `cancelado` se puede alcanzar desde casi cualquier lado porque cancelar es
 * la salida de emergencia. Desde `en_curso` NO: una vez que la gente está
 * jugando, cancelar sería devolver la entrada a quien ya perdió y a quien ya
 * ganó por igual. Y desde `finalizado` tampoco, porque ya se pagó.
 */
export const TRANSICIONES = Object.freeze({
  [ESTADOS.INSCRIPCIONES_ABIERTAS]: [ESTADOS.BORRADOR],
  [ESTADOS.COMPLETO]: [ESTADOS.INSCRIPCIONES_ABIERTAS],
  [ESTADOS.EN_CURSO]: [ESTADOS.COMPLETO],
  [ESTADOS.FINALIZADO]: [ESTADOS.EN_CURSO],
  [ESTADOS.CANCELADO]: [
    ESTADOS.BORRADOR,
    ESTADOS.INSCRIPCIONES_ABIERTAS,
    ESTADOS.COMPLETO,
  ],
});

export const puedePasarA = (desde, hasta) =>
  (TRANSICIONES[hasta] ?? []).includes(desde);

/** Sólo se puede editar lo que todavía no se publicó. */
export const esEditable = (estado) => estado === ESTADOS.BORRADOR;

/** Sólo se cobra entrada mientras las inscripciones están abiertas. */
export const admiteInscripciones = (estado) => estado === ESTADOS.INSCRIPCIONES_ABIERTAS;

/**
 * ¿Hay que devolver la plata al cancelar?
 *
 * Sólo si se llegó a cobrar. Cancelar un borrador no devuelve nada porque
 * nadie pagó, y hacer el recorrido igual sería recorrer una lista vacía y
 * escribir un registro que dice "0 devoluciones" — ruido que después alguien
 * lee como si hubiera pasado algo.
 */
export const hayQueDevolver = (estado) =>
  estado === ESTADOS.INSCRIPCIONES_ABIERTAS || estado === ESTADOS.COMPLETO;

// --------------------------------------------------------------- mesas

/**
 * Reparte a los inscriptos en mesas de cuatro.
 *
 * El orden lo decide `barajar`, que se inyecta: el servidor le pasa un azar
 * criptográfico y las pruebas le pasan la identidad, para poder afirmar quién
 * queda dónde. Un `Math.random` acá haría esta función imposible de probar.
 *
 * Los que sobran quedan FUERA y se los nombra. Con 10 inscriptos hay dos mesas
 * y dos que no juegan, y esos dos tienen que recuperar su entrada: no se les
 * arma una mesa de dos ni se los mete de quinto en una de cuatro.
 */
export function armarMesas(inscriptos, { porMesa = 4, barajar = (x) => x } = {}) {
  const orden = barajar([...inscriptos]);
  const mesas = [];

  for (let i = 0; i + porMesa <= orden.length; i += porMesa) {
    mesas.push({ numero: mesas.length + 1, jugadores: orden.slice(i, i + porMesa) });
  }

  return { mesas, sobrantes: orden.slice(mesas.length * porMesa) };
}

// ---------------------------------------------------------- el pozo

/**
 * Cuánto junta el torneo.
 *
 * `entrada × inscriptos`, y nada más. No incluye a los sobrantes que no
 * llegaron a jugar, porque a ésos se les devuelve: contarlos inflaría el pozo
 * con plata que ya volvió a su dueño.
 */
export const pozoDe = (entrada, cuantosJuegan) =>
  Math.max(0, Math.trunc(entrada) * Math.max(0, Math.trunc(cuantosJuegan)));

/**
 * Qué porción del pozo se lleva cada puesto.
 *
 * Suman 0.90: el 10% se lo queda la casa, igual que en las partidas de mesa.
 * Está escrito como fracciones y no como cantidades porque el pozo depende de
 * la entrada, que la elige el administrador torneo por torneo.
 */
export const REPARTO = Object.freeze([
  { puesto: 1, parte: 0.6 },
  { puesto: 2, parte: 0.3 },
]);

/** Puntos de campeonato por puesto, que alimentan el ranking semanal. */
export const PUNTOS_CAMPEONATO = Object.freeze({ 1: 100, 2: 60, 3: 30, 4: 10 });

/**
 * Reparte el pozo entre los ganadores.
 *
 * Redondea cada pago HACIA ABAJO y le deja el resto a la casa. Redondear hacia
 * arriba podría pagar más de lo que entró —dos redondeos de 0,6 sobre un pozo
 * chico— y eso es imprimir Leyendas: el pozo tiene que cerrar exactamente, y
 * lo comprueba `pruebas/torneos.mjs`.
 */
export function repartirPozo(pozo, ganadores, reparto = REPARTO) {
  const total = Math.max(0, Math.trunc(pozo));
  const pagos = [];

  for (const tramo of reparto) {
    const uid = ganadores[tramo.puesto - 1];
    if (!uid) continue;
    const monto = Math.floor(total * tramo.parte);
    if (monto > 0) pagos.push({ uid, puesto: tramo.puesto, monto });
  }

  const repartido = pagos.reduce((s, p) => s + p.monto, 0);
  return { pagos, repartido, comisionCasa: total - repartido };
}

/** Los puntos de campeonato de cada uno, por su puesto final. */
export function puntosDeTorneo(ganadores) {
  return ganadores
    .map((uid, i) => ({ uid, puesto: i + 1, puntos: PUNTOS_CAMPEONATO[i + 1] ?? 0 }))
    .filter((p) => p.uid && p.puntos > 0);
}

// ---------------------------------------------------------- validación

const LARGO_MAXIMO_NOMBRE = 80;

/**
 * Qué le falta o le sobra a un torneo para poder guardarse.
 *
 * Devuelve una lista de problemas y no lanza, por lo mismo que
 * `problemasDelItem`: el panel los muestra todos juntos y no de a uno.
 *
 * La entrada NO se valida acá: la valida `problemasDeEntrada` en
 * `configuracion.js`, que es donde vive el rango. Duplicar el rango en dos
 * archivos es cómo se llega a que uno diga 20000 y el otro 10000.
 */
export function problemasDelTorneo(torneo, problemasDeEntrada) {
  const problemas = [];

  const nombre = String(torneo?.nombre ?? "").trim();
  if (!nombre) problemas.push("Falta el nombre.");
  else if (nombre.length > LARGO_MAXIMO_NOMBRE) {
    problemas.push(`El nombre no puede pasar de ${LARGO_MAXIMO_NOMBRE} caracteres.`);
  }

  problemas.push(...problemasDeEntrada(torneo?.entrada));

  const max = torneo?.maxJugadores;
  if (max != null) {
    if (!Number.isInteger(max) || max < 4) {
      problemas.push("El máximo de jugadores tiene que ser un entero de 4 para arriba.");
    }
  }

  return problemas;
}
