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

/** En borrador se puede editar todo: no hay nadie inscripto. */
export const esEditable = (estado) => estado === ESTADOS.BORRADOR;

/**
 * Qué campos se pueden tocar en cada estado.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO ES «SE PUEDE O NO SE PUEDE»
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Era eso, y por eso un torneo publicado no se podía tocar en nada: ni
 * corregirle una falta de ortografía al nombre. Pero no todos los campos
 * pesan lo mismo.
 *
 * La ENTRADA y el CUPO son las dos cosas que el jugador miró ANTES de
 * pagar: cuánto le costaba y contra cuántos iba a jugar. Cambiárselos
 * después es cambiarle el trato una vez que ya pagó, y además desincroniza
 * el pozo, que se calculó con la entrada vieja.
 *
 * El nombre y el tipo son etiquetas. No cambian lo que nadie aceptó.
 *
 * Terminado o cancelado no se toca nada: son historia.
 */
/** Lo que se puede corregir sin cambiarle el trato a nadie. */
const ETIQUETAS = ["nombre", "tipo", "descripcion", "comienzaEn"];

const EDITABLES = Object.freeze({
  [ESTADOS.BORRADOR]: [...ETIQUETAS, "entrada", "maxJugadores"],
  [ESTADOS.INSCRIPCIONES_ABIERTAS]: ETIQUETAS,
  [ESTADOS.COMPLETO]: ETIQUETAS,
  [ESTADOS.EN_CURSO]: ETIQUETAS,
});

export const camposEditables = (estado) => EDITABLES[estado] ?? [];

/**
 * Los campos que se quisieron cambiar y no se pueden en este estado.
 *
 * Compara CONTRA LO GUARDADO, no contra la lista de campos: el panel manda
 * el formulario entero en cada guardado, así que recibir `entrada` no
 * significa que se la quiera cambiar. Sólo molesta si el número es otro.
 */
export function camposBloqueados(estado, torneo, cambios) {
  const permitidos = camposEditables(estado);
  return Object.keys(cambios ?? {}).filter(
    (campo) =>
      !permitidos.includes(campo) &&
      cambios[campo] !== undefined &&
      cambios[campo] !== torneo?.[campo],
  );
}

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
 * Cuántos puestos cobran y qué porcentaje, según cuánta gente jugó.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR TRAMOS, Y NO UN REPARTO FIJO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un torneo de 4 y uno de 50 no se pueden repartir igual. Con un reparto fijo
 * de dos puestos, en el de 50 hay 48 personas que pagaron la entrada y no
 * tenían ninguna chance de recuperar nada: el fondo lo juntan todos y se lo
 * llevan dos. Cuantos más entran, más lejos se reparte.
 *
 * Está publicado en `/reglamento-torneos.html`, con estas mismas tablas y con
 * ejemplos. `pruebas/torneos.mjs` comprueba que la página y esta constante
 * digan lo mismo: un reglamento que promete un porcentaje distinto del que se
 * paga es peor que no tener reglamento.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CADA TRAMO SUMA 100%: LA CASA NO SE QUEDA CON NADA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A diferencia de la mesa de Leyendas, donde la casa retiene un 10%, acá se
 * reparte el fondo entero. Lo único que queda sin repartir es el resto del
 * redondeo hacia abajo —a lo sumo unas pocas Leyendas— y queda sin repartir
 * porque redondear hacia arriba pagaría MÁS de lo que entró, que es imprimir
 * Leyendas.
 */
export const TRAMOS_DE_REPARTO = Object.freeze([
  { desde: 4, hasta: 11, porcentajes: [60, 40] },
  { desde: 12, hasta: 19, porcentajes: [50, 30, 20] },
  { desde: 20, hasta: 29, porcentajes: [40, 25, 20, 15] },
  { desde: 30, hasta: 49, porcentajes: [35, 25, 20, 12, 8] },
  { desde: 50, hasta: Infinity, porcentajes: [25, 18, 14, 10, 8, 5, 5, 5, 5, 5] },
]);

/** El tramo que le toca a un torneo por su cantidad de jugadores. */
export function tramoDeReparto(jugadores) {
  const n = Math.trunc(jugadores);
  return TRAMOS_DE_REPARTO.find((t) => n >= t.desde && n <= t.hasta) ?? null;
}

/** Cuántos puestos cobran con esa cantidad de jugadores. */
export const puestosQueCobran = (jugadores) => tramoDeReparto(jugadores)?.porcentajes.length ?? 0;

/**
 * Puntos de campeonato por puesto.
 *
 * `PARTICIPACION` es para el quinto en adelante: todo el que jugó suma algo.
 * Sin eso, en un torneo de 50 personas hay 46 que compiten por nada, y el
 * ranking de campeonato terminaría midiendo cuántos torneos ganaste en vez de
 * cuánto jugaste y cómo te fue.
 */
export const PUNTOS_CAMPEONATO = Object.freeze({ 1: 100, 2: 50, 3: 25, 4: 10 });
export const PUNTOS_PARTICIPACION = 5;

export const puntosPorPuesto = (puesto) =>
  PUNTOS_CAMPEONATO[puesto] ?? (puesto >= 1 ? PUNTOS_PARTICIPACION : 0);

/**
 * Reparte el fondo entre los que entraron en puesto pagado.
 *
 * El porcentaje sale del TRAMO, así que hay que decirle cuánta gente jugó. No
 * se deduce de la cantidad de ganadores que se pasen: si el administrador
 * carga tres nombres en un torneo de 20, el tercero cobra el 20% que le toca
 * a un torneo de 20, no el que le tocaría a uno de 12.
 *
 * Redondea cada pago HACIA ABAJO. Redondear hacia arriba podría pagar más de
 * lo que entró —diez redondeos sobre un fondo chico— y eso es imprimir
 * Leyendas: el fondo tiene que cerrar exactamente, y lo comprueba
 * `pruebas/torneos.mjs` con seis entradas y cuatro tamaños de torneo.
 */
export function repartirPozo(pozo, ganadores, jugadores = ganadores.length) {
  const total = Math.max(0, Math.trunc(pozo));
  const tramo = tramoDeReparto(jugadores);
  const pagos = [];

  if (tramo) {
    for (let i = 0; i < tramo.porcentajes.length; i++) {
      const uid = ganadores[i];
      if (!uid) continue;
      const monto = Math.floor((total * tramo.porcentajes[i]) / 100);
      if (monto > 0) pagos.push({ uid, puesto: i + 1, monto });
    }
  }

  const repartido = pagos.reduce((s, p) => s + p.monto, 0);
  return { pagos, repartido, comisionCasa: total - repartido };
}

/**
 * Los puntos de campeonato de cada uno.
 *
 * `ordenFinal` son los que entraron en puesto pagado, en orden. `todos` son
 * TODOS los inscriptos que jugaron: los que no están en el orden final suman
 * los puntos de participación, que es lo que hace que un torneo grande le
 * sirva a algo a quien no salió entre los primeros.
 */
export function puntosDeTorneo(ordenFinal, todos = ordenFinal) {
  const colocados = new Set(ordenFinal.filter(Boolean));
  const puntos = ordenFinal
    .map((uid, i) => ({ uid, puesto: i + 1, puntos: puntosPorPuesto(i + 1) }))
    .filter((p) => p.uid);

  for (const uid of todos) {
    if (uid && !colocados.has(uid)) {
      puntos.push({ uid, puesto: null, puntos: PUNTOS_PARTICIPACION });
    }
  }

  return puntos.filter((p) => p.puntos > 0);
}

// ---------------------------------------------------------- validación

const LARGO_MAXIMO_NOMBRE = 80;

/**
 * La descripción es para contar CÓMO se juega el torneo.
 *
 * Hace falta porque el torneo se corre a mano: `iniciar` agrupa los uid en
 * mesas dentro del documento y no crea salas ni avisa a nadie. Sin un lugar
 * donde decir «se juega el sábado por Discord», el jugador paga una entrada
 * sin saber qué compró.
 *
 * Trescientos caracteres: un párrafo. Más que eso es un reglamento, y el
 * reglamento tiene su propia página.
 */
const LARGO_MAXIMO_DESCRIPCION = 300;

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

  const descripcion = torneo?.descripcion;
  if (descripcion != null && String(descripcion).length > LARGO_MAXIMO_DESCRIPCION) {
    problemas.push(
      `La descripción no puede pasar de ${LARGO_MAXIMO_DESCRIPCION} caracteres.`,
    );
  }

  /**
   * El comienzo es un instante, en milisegundos.
   *
   * `null` es válido y quiere decir «todavía no hay fecha»: se puede crear
   * el borrador antes de saber cuándo se juega.
   *
   * NO se exige que sea futuro. Editarlo es la forma de postergar un
   * torneo, y también de corregir una fecha mal tipeada de un torneo que ya
   * arrancó; exigir futuro convertiría las dos cosas en un error.
   */
  const comienza = torneo?.comienzaEn;
  if (comienza != null && (!Number.isFinite(comienza) || comienza <= 0)) {
    problemas.push("La fecha de comienzo no es válida.");
  }

  return problemas;
}
