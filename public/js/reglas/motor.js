import { crearBaraja, barajar, TAM_MANO } from "./baraja.js";
import { resolverCorte, aplicarEliminacion, comprobarFinPartida, cartasVivas } from "./puntaje.js";
import { azarDesde, semillaAleatoria } from "./azar.js";

export const MS_MIRAR = 2000;

/**
 * Lo que dura cualquier ventana de reflejos.
 *
 * Una sola, para todas. Antes había dos —una para la ventana del principio de
 * la ronda y otra, más corta, para la que reabre tirar— con el argumento de
 * que en la primera se viene de memorizar y hay que buscar en cuatro manos.
 * Ahora la muestra cambia en cada tiro y en cada cambio, así que hay muchas
 * más ventanas por ronda y todas piden lo mismo: reconocer un número y tocar.
 * Dos duraciones distintas para el mismo gesto sólo confundían.
 */
export const MS_DESCARTE = 2000;

export const PODERES = {
  7: "mirarPropia",
  8: "mirarRival",
  9: "cambioCiego",
  10: "cambioConVista",
};

export const esPoder = (carta) => Boolean(carta && PODERES[carta.numero]);

/**
 * Un descarte es correcto si la carta tiene el MISMO NÚMERO que la muestra.
 * No se compara el palo: sólo existe una carta por palo+número, así que
 * exigir ambos haría imposible acertar.
 */
export const esDescarteValido = (carta, muestra) =>
  Boolean(carta && muestra && carta.numero === muestra.numero);

const cima = (pila) => pila[0] ?? null;

const siguienteActivo = (jugadores, desde) => {
  for (let paso = 1; paso <= jugadores.length; paso++) {
    const i = (desde + paso) % jugadores.length;
    if (!jugadores[i].eliminado) return i;
  }
  return desde;
};

export const crearJugador = ({ id, nombre, esIA = false, dificultad = "medio" }) => ({
  id,
  nombre,
  esIA,
  dificultad,
  mano: [],
  puntos: 0,
  puntosRonda: 0,
  eliminado: false,
  eliminadoEnRonda: null,
  posicionMirada: null,
});

/**
 * Estado inicial. Todo lo que devuelve es JSON puro: números, cadenas,
 * booleanos, arrays y objetos planos. Ninguna función, ningún Map, ninguna
 * instancia de clase. Eso es lo que permite guardarlo y recuperarlo tal cual.
 */
export const crearPartida = (configuracion, { semilla = semillaAleatoria() } = {}) => ({
  fase: "inicio",
  ronda: 0,
  indiceMano: 0,
  indiceTurno: 0,
  turnosRonda: 0,
  jugadores: configuracion.map(crearJugador),
  mazo: [],
  descarte: [],
  levantada: null,
  poderPendiente: null,
  ventanaDescarte: null,
  indiceCortador: null,
  ganador: null,
  desempate: false,
  registro: [],
  // Hechos puntuables de la partida, que consume el ranking.
  eventos: [],
  /**
   * Lo que cada jugador SABE de las manos ajenas, por haber usado un poder.
   *
   *   { actor, objetivo, numero, origen, ronda }
   *
   * Guarda el NÚMERO, no la posición: ésa es toda la mecánica. Ver un 5 en la
   * mano de otro no es saber dónde está el 5 dentro de un rato, porque las
   * cartas se mueven y la memoria falla. Por eso conocer una carta habilita a
   * intentar sobre CUALQUIER posición de esa mano, y equivocarse cuesta.
   *
   * Es un array de objetos planos: viaja con el estado y sobrevive el JSON.
   * NUNCA sale hacia una vista: al cliente sólo le llega a quién puede
   * atacar, jamás qué número conoce. Ver `vista.js`.
   */
  conocimientos: [],
  // El azar es un número, no una función: avanza con cada barajada y viaja
  // con el estado. Ver azar.js.
  semilla: semilla >>> 0,
});

/**
 * Suma una línea al registro.
 *
 * `extra` deja marcar la línea con datos que la interfaz pueda leer sin
 * adivinar. Se usa para la mirada de los poderes 7 y 8: la mesa tiene que
 * pintar una marca sobre la carta mirada, y reconocer el evento por el texto
 * —buscando "miró una carta"— se rompería con sólo cambiarle una palabra al
 * mensaje. El registro viaja entero en la vista, así que lo que se ponga acá
 * lo ve toda la mesa: nunca el número de la carta ni su posición.
 */
const anotar = (estado, texto, extra = null) => ({
  ...estado,
  registro: [...estado.registro, { ronda: estado.ronda, texto, ...(extra ?? {}) }],
});

// --------------------------------------------------------------- reparto

export function empezarRonda(estado) {
  const azar = azarDesde(estado.semilla);
  const mazo = barajar(crearBaraja(), azar);
  const jugadores = estado.jugadores.map((j) =>
    j.eliminado
      ? { ...j, mano: [], posicionMirada: null }
      : { ...j, mano: mazo.splice(0, TAM_MANO), puntosRonda: 0, posicionMirada: null },
  );
  const muestra = { ...mazo.pop(), visible: true };

  return anotar(
    {
      ...estado,
      fase: "mirar",
      ronda: estado.ronda + 1,
      jugadores,
      mazo,
      descarte: [muestra],
      levantada: null,
      poderPendiente: null,
      ventanaDescarte: null,
      indiceCortador: null,
      turnosRonda: 0,
      indiceTurno: estado.indiceMano,
      // Se reparte de nuevo: lo que alguien sabía de la mano de otro ya no
      // corresponde a ninguna carta que siga ahí.
      conocimientos: [],
      // La semilla avanza con la barajada: la ronda siguiente no repite el
      // mismo reparto.
      semilla: azar.semilla(),
    },
    estado.desempate
      ? "Ronda de desempate"
      : `Ronda ${estado.ronda + 1}: cada jugador mira una carta`,
  );
}

/** Cada jugador elige UNA carta y la ve durante MS_MIRAR. */
export const mirar = (estado, indiceJugador, posicion = 0) => ({
  ...estado,
  jugadores: estado.jugadores.map((j, i) =>
    i === indiceJugador ? { ...j, posicionMirada: posicion } : j,
  ),
});

/** Al agotarse los 2 segundos: quien no eligió se queda con la posición 0. */
export const terminarMirada = (estado) =>
  anotar(
    {
      ...estado,
      fase: "descarte",
      jugadores: estado.jugadores.map((j) =>
        j.posicionMirada == null ? { ...j, posicionMirada: 0 } : j,
      ),
      ventanaDescarte: { huboPrimero: false, intentos: [] },
    },
    "Fase de descarte: 5 segundos",
  );

// ------------------------------------------------------ descarte simultáneo

/** Recicla el descarte cuando el mazo se agota, dejando la muestra arriba. */
const rellenarMazo = (estado) => {
  if (estado.mazo.length) return estado;
  const [muestra, ...resto] = estado.descarte;
  if (!resto.length) return estado;
  const azar = azarDesde(estado.semilla);
  const mazo = barajar(resto.map((c) => ({ ...c, visible: false })), azar);
  // La semilla avanzada vuelve al estado: si no, la próxima barajada
  // repetiría exactamente la misma mezcla.
  return { ...estado, mazo, descarte: [muestra], semilla: azar.semilla() };
};

/**
 * Intento de descarte durante la ventana de reflejos.
 *
 * Las tres salidas están graduadas a propósito:
 *
 * - PRIMERO: la carta sale de la mano y no hay castigo.  → una carta menos
 * - TARDE:   la carta sale igual, pero recibe una más.   → queda igual
 * - ERROR:   conserva la carta, recibe una más, y su      → una carta más,
 *            posición queda pública para toda la partida.   y expuesto
 *
 * Si el que llega tarde conservara su carta, acertar tarde y equivocarse
 * tendrían la misma consecuencia y acertar dejaría de valer la pena.
 */
export function intentarDescarte(estado, indiceJugador, posicion) {
  if (estado.fase !== "descarte" || !estado.ventanaDescarte) return estado;

  const jugador = estado.jugadores[indiceJugador];
  const carta = jugador.mano[posicion];
  if (!carta) return estado;

  const muestra = cima(estado.descarte);
  const correcto = esDescarteValido(carta, muestra);
  const fuePrimero = correcto && !estado.ventanaDescarte.huboPrimero;

  const origen = rellenarMazo(estado);
  const mazo = [...origen.mazo];
  const descarte = [...origen.descarte];
  const mano = [...jugador.mano];
  const cartaCastigo = () => (mazo.length ? mazo.shift() : null);

  if (correcto) {
    // Acertó: la carta se va, haya llegado primero o no.
    mano[posicion] = null;
    descarte.unshift({ ...carta, visible: true });
    // Pero si no fue el primero, el beneficio se compensa con una carta más.
    if (!fuePrimero) mano.push(cartaCastigo());
  } else {
    // Se equivocó: la carta se queda donde estaba y encima recibe otra.
    mano.push(cartaCastigo());
  }

  const resultado = correcto ? (fuePrimero ? "primero" : "tarde") : "error";

  return anotar(
    {
      ...estado,
      mazo,
      descarte,
      jugadores: estado.jugadores.map((j, i) => (i === indiceJugador ? { ...j, mano } : j)),
      ventanaDescarte: {
        huboPrimero: estado.ventanaDescarte.huboPrimero || fuePrimero,
        intentos: [
          ...estado.ventanaDescarte.intentos,
          // La carta viaja en el intento para que la mesa pueda mostrarla un
          // momento. Sólo la del primero no se muestra: ya está en el descarte.
          { indiceJugador, posicion, resultado, carta: fuePrimero ? null : carta },
        ],
      },
    },
    `${jugador.nombre}: descarte ${resultado}`,
  );
}

/**
 * ¿Puede `actor` intentar sobre la mano de `objetivo`?
 *
 * Basta con conocer UNA carta suya. Conocer un número no es conocer una
 * posición, así que el derecho es sobre la mano entera: si el permiso se
 * limitara a la posición donde se vio, el poder sería un acierto garantizado
 * y no habría nada que recordar.
 */
export const puedeAtacarA = (estado, actor, objetivo) =>
  actor !== objetivo &&
  !estado.jugadores[objetivo]?.eliminado &&
  (estado.conocimientos ?? []).some((c) => c.actor === actor && c.objetivo === objetivo);

/** A quién puede atacar cada jugador. Es lo ÚNICO de esto que puede viajar. */
export const objetivosDe = (estado, actor) =>
  estado.jugadores
    .map((_, i) => i)
    .filter((i) => puedeAtacarA(estado, actor, i));

/**
 * Intento de descarte sobre la mano de OTRO, habilitado por un poder 8 o 10.
 *
 * `posicionObjetivo` es una apuesta, no una afirmación: el jugador cree que
 * ahí está la carta que vio. `posicionEntrega` es la carta propia que va a
 * dar a cambio SI acierta, elegida por posición y a ciegas —no sabe cuál es—.
 *
 * ACIERTO: la carta del rival se va al descarte y la carta propia ocupa
 *          EXACTAMENTE ese hueco, boca abajo. Nadie ve su valor, ni siquiera
 *          quien la entregó. El conocimiento de ese número se consume.
 *
 * ERROR:   la carta del rival no se mueve, se expone un momento a la mesa, y
 *          el atacante recibe una carta de castigo. El conocimiento queda:
 *          equivocarse de posición no borra lo que se vio, así que puede
 *          seguir buscando y cada error vuelve a costar.
 */
export function intentarDescarteRival(
  estado, actor, objetivo, posicionObjetivo, posicionEntrega,
) {
  if (estado.fase !== "descarte" || !estado.ventanaDescarte) return estado;
  if (!puedeAtacarA(estado, actor, objetivo)) return estado;

  const manoObjetivo = [...estado.jugadores[objetivo].mano];
  const manoActor = [...estado.jugadores[actor].mano];
  const carta = manoObjetivo[posicionObjetivo];
  if (!carta) return estado;

  const muestra = cima(estado.descarte);
  const correcto = esDescarteValido(carta, muestra);

  const origen = rellenarMazo(estado);
  const mazo = [...origen.mazo];
  const descarte = [...origen.descarte];

  let conocimientos = estado.conocimientos ?? [];

  if (correcto) {
    // La entrega tiene que ser una carta que exista de verdad.
    const entregada = manoActor[posicionEntrega];
    if (!entregada) return estado;

    // La transferencia, en una sola transición y sin desplazar nada:
    // la del rival se va al descarte y la propia ocupa ese mismo hueco.
    descarte.unshift({ ...carta, visible: true });
    manoObjetivo[posicionObjetivo] = { ...entregada, visible: false };
    manoActor[posicionEntrega] = null;

    // El número encontrado ya no está en esa mano: el conocimiento se gastó.
    // Lo que se entregó NO hereda nada: quien la dio no sabe cuál era.
    conocimientos = conocimientos.filter(
      (c) => !(c.actor === actor && c.objetivo === objetivo && c.numero === carta.numero),
    );
  } else {
    // Se equivocó de posición: la carta del rival no se toca y paga con una.
    manoActor.push(mazo.length ? mazo.shift() : null);
  }

  return anotar(
    {
      ...estado,
      mazo,
      descarte,
      conocimientos,
      jugadores: estado.jugadores.map((j, i) =>
        i === actor ? { ...j, mano: manoActor }
          : i === objetivo ? { ...j, mano: manoObjetivo }
          : j,
      ),
      ventanaDescarte: {
        ...estado.ventanaDescarte,
        intentos: [
          ...estado.ventanaDescarte.intentos,
          {
            indiceJugador: objetivo,
            posicion: posicionObjetivo,
            actor,
            resultado: correcto ? "rivalAcierto" : "rivalError",
            // Sólo la fallada se expone a la mesa. La acertada se fue al
            // descarte, donde ya se ve; la entregada no se muestra jamás.
            carta: correcto ? null : carta,
          },
        ],
      },
    },
    correcto
      ? `${estado.jugadores[actor].nombre} encontró el ${carta.numero} de ${estado.jugadores[objetivo].nombre}`
      : `${estado.jugadores[actor].nombre} se equivocó buscando en ${estado.jugadores[objetivo].nombre}`,
  );
}

/**
 * Cierra la ventana de reflejos y devuelve la mesa a donde corresponda.
 *
 * La del principio de la ronda desemboca en el turno. La que abre `tirarCarta`
 * lleva `volverA: "postLevantada"`, porque el que tiró todavía tiene que
 * decidir si corta.
 */
export const cerrarVentanaDescarte = (estado) => ({
  ...estado,
  fase: estado.ventanaDescarte?.volverA ?? "turno",
  ventanaDescarte: null,
});

// ----------------------------------------------------------------- turnos

export function levantar(estado) {
  if (estado.fase !== "turno" || estado.levantada) return estado;
  const lleno = rellenarMazo(estado);
  if (!lleno.mazo.length) return lleno;
  const mazo = [...lleno.mazo];
  const carta = mazo.shift();
  return {
    ...lleno,
    mazo,
    levantada: { ...carta, visible: true },
    fase: "levantada",
    turnosRonda: lleno.turnosRonda + 1,
  };
}

/**
 * Lo que sigue después de poner una carta nueva como muestra.
 *
 * Tirar y cambiar terminan igual: la carta que se va queda arriba del
 * descarte, la mesa tiene un número nuevo al que reaccionar, y se abre la
 * ventana de reflejos. Recién cuando esa ventana cierra sigue el turno.
 *
 * `volverA` es lo que decide adónde. Si la carta que quedó de muestra es un
 * poder, la ventana desemboca en `poder` y el que la tiró elige si lo usa; si
 * no, desemboca en `postLevantada`, donde corta o pasa. En los dos casos es
 * SU turno lo que sigue: por eso no se vuelve a `turno`, que es adonde vuelve
 * la ventana del principio de la ronda.
 *
 * El poder se deja anotado acá, al abrir la ventana, y no al cerrarla. Durante
 * esos dos segundos la muestra puede cambiar —alguien acierta y su carta pasa
 * a ser la cima—, así que preguntarle después al descarte qué poder tocaba
 * daría el de otra carta. Se fija en el momento del tiro y no se mueve.
 */
function abrirReflejos(estado, cartaDeMuestra, indiceQuienTiro) {
  const hayPoder = esPoder(cartaDeMuestra);
  return {
    ...estado,
    fase: "descarte",
    ventanaDescarte: {
      huboPrimero: false,
      intentos: [],
      volverA: hayPoder ? "poder" : "postLevantada",
    },
    poderPendiente: hayPoder
      ? {
          tipo: PODERES[cartaDeMuestra.numero],
          numero: cartaDeMuestra.numero,
          indiceJugador: indiceQuienTiro,
        }
      : null,
  };
}

/**
 * Opción A: cambiar la levantada por una carta propia.
 *
 * La que sale de la mano queda como muestra, así que ahora esto también abre
 * reflejos. Y si esa carta era un poder, el poder se activa —para el que la
 * entregó, que es quien la tiró—. Vale la pena notar lo que eso significa en
 * un juego de memoria: la carta salía boca abajo de la propia mano, así que
 * uno puede activar un poder sin haber sabido que lo tenía. Es la regla
 * pedida, y premia acordarse de lo que uno tiene.
 */
export function cambiarCarta(estado, posicion) {
  if (estado.fase !== "levantada" || !estado.levantada) return estado;
  const i = estado.indiceTurno;
  const mano = [...estado.jugadores[i].mano];
  const descartada = mano[posicion];
  mano[posicion] = { ...estado.levantada, visible: false };

  const conLaMuestraNueva = {
    ...estado,
    jugadores: estado.jugadores.map((j, idx) => (idx === i ? { ...j, mano } : j)),
    descarte: descartada
      ? [{ ...descartada, visible: true }, ...estado.descarte]
      : estado.descarte,
    levantada: null,
  };

  // Si la posición estaba vacía no hay carta nueva arriba del descarte, así
  // que no hay a qué reaccionar: no se abre ninguna ventana.
  if (!descartada) {
    return anotar(
      { ...conLaMuestraNueva, fase: "postLevantada" },
      `${estado.jugadores[i].nombre} cambió la posición ${posicion}`,
    );
  }

  return anotar(
    abrirReflejos(conLaMuestraNueva, descartada, i),
    `${estado.jugadores[i].nombre} cambió la posición ${posicion} y tiró un ${descartada.numero}`,
  );
}

/**
 * Opción B: tirar la levantada.
 *
 * Sea poder o no, primero se abren los reflejos. Antes las cartas de poder
 * salteaban la ventana e iban directo a `poder`, y eso le daba al que tiraba
 * una ventaja que no se justificaba: tirar un 7 cambiaba la muestra igual que
 * tirar un 3, pero sólo en un caso los demás podían aprovecharlo. Ahora la
 * mesa siempre tiene sus dos segundos, y recién después el poder se decide.
 */
export function tirarCarta(estado) {
  if (estado.fase !== "levantada" || !estado.levantada) return estado;
  const carta = estado.levantada;
  const conLaMuestraNueva = {
    ...estado,
    descarte: [{ ...carta, visible: true }, ...estado.descarte],
    levantada: null,
  };

  return anotar(
    abrirReflejos(conLaMuestraNueva, carta, estado.indiceTurno),
    `${estado.jugadores[estado.indiceTurno].nombre} tiró un ${carta.numero}`,
  );
}

/** Poderes 7 y 8: mirar. Devuelve la carta para que la UI la muestre un instante. */
/**
 * Anota que `actor` sabe que `objetivo` tiene una carta de ese número.
 *
 * Se guarda el número y no la carta ni su posición: es lo único que el
 * jugador se lleva de verdad. Repetido no se duplica —saber dos veces lo
 * mismo no da dos derechos— pero sí se guardan números distintos.
 */
function recordar(estado, { actor, objetivo, numero, origen }) {
  if (actor === objetivo || !Number.isInteger(numero)) return estado.conocimientos ?? [];
  const previos = estado.conocimientos ?? [];
  const repetido = previos.some(
    (c) => c.actor === actor && c.objetivo === objetivo && c.numero === numero,
  );
  if (repetido) return previos;
  return [...previos, { actor, objetivo, numero, origen, ronda: estado.ronda }];
}

export function usarPoderMirar(estado, indiceObjetivo, posicion) {
  const poder = estado.poderPendiente;
  if (estado.fase !== "poder" || !poder) return { estado, revelada: null };
  if (poder.tipo === "mirarPropia" && indiceObjetivo !== poder.indiceJugador) {
    return { estado, revelada: null };
  }
  if (poder.tipo === "mirarRival" && indiceObjetivo === poder.indiceJugador) {
    return { estado, revelada: null };
  }

  const carta = estado.jugadores[indiceObjetivo].mano[posicion];

  // El 8 mira la mano de otro: de ahí sale el conocimiento. El 7 mira la
  // propia y no genera ninguno —saber lo tuyo no te autoriza sobre nadie.
  const conocimientos = recordar(estado, {
    actor: poder.indiceJugador,
    objetivo: indiceObjetivo,
    numero: carta?.numero,
    origen: "poder8",
  });

  // Queda escrito en el registro QUÉ se hizo y SOBRE QUIÉN, nunca qué carta
  // era ni en qué posición estaba. El registro lo lee toda la mesa: decir "la
  // segunda de Bruno" convertiría un poder en un anuncio público, y decir el
  // número lo regalaría directamente. Que se sepa que Ana miró algo de Bruno
  // es justamente lo que se quiere: los demás pueden contar con que ella
  // ahora sabe algo, sin enterarse de qué.
  const nombre = (i) => estado.jugadores[i].nombre;
  const texto =
    poder.tipo === "mirarPropia"
      ? `${nombre(poder.indiceJugador)} usó el poder ${poder.numero} y miró una carta suya`
      : `${nombre(poder.indiceJugador)} usó el poder ${poder.numero} y miró una carta de ${nombre(indiceObjetivo)}`;

  return {
    estado: anotar(
      { ...estado, fase: "postLevantada", poderPendiente: null, conocimientos },
      texto,
      // Sin la posición ni el número: sólo quién miró a quién. Alcanza para
      // que la interfaz pinte la marca y para que la mesa sepa que pasó.
      { tipo: "miroCarta", actor: poder.indiceJugador, objetivo: indiceObjetivo },
    ),
    revelada: { indiceJugador: indiceObjetivo, posicion, carta },
  };
}

/** Poderes 9 y 10: intercambiar posiciones entre dos manos. La 10 revela ambas. */
export function usarPoderCambio(estado, posicionPropia, indiceRival, posicionRival) {
  const poder = estado.poderPendiente;
  if (estado.fase !== "poder" || !poder) return { estado, revelada: null };
  if (indiceRival === poder.indiceJugador) return { estado, revelada: null };

  const yo = poder.indiceJugador;
  const miMano = [...estado.jugadores[yo].mano];
  const manoRival = [...estado.jugadores[indiceRival].mano];
  const revelada =
    poder.tipo === "cambioConVista"
      ? { propia: miMano[posicionPropia], rival: manoRival[posicionRival] }
      : null;

  const mia = miMano[posicionPropia];
  miMano[posicionPropia] = manoRival[posicionRival];
  manoRival[posicionRival] = mia;

  // Qué conocimiento deja el 10, derivado de lo que REALMENTE pasó:
  //
  // El 10 muestra las dos cartas y después las intercambia. La que era del
  // rival ahora es propia, así que saber su número ya no es saber nada de
  // nadie. Pero la carta que uno entregó SÍ quedó en la mano del rival, y su
  // número se vio. Ése es el conocimiento que queda: "el rival tiene esto".
  //
  // El 9 cambia a ciegas —`revelada` es null— y por eso no deja ninguno: no
  // se puede recordar lo que no se vio.
  const conocimientos = revelada
    ? recordar(estado, {
        actor: yo,
        objetivo: indiceRival,
        numero: mia?.numero,
        origen: "poder10",
      })
    : (estado.conocimientos ?? []);

  return {
    estado: anotar(
      {
        ...estado,
        fase: "postLevantada",
        poderPendiente: null,
        conocimientos,
        jugadores: estado.jugadores.map((j, i) =>
          i === yo ? { ...j, mano: miMano } : i === indiceRival ? { ...j, mano: manoRival } : j,
        ),
      },
      `${estado.jugadores[yo].nombre} cambió su ${posicionPropia} por la ${posicionRival} de ${estado.jugadores[indiceRival].nombre}`,
    ),
    revelada,
  };
}

/**
 * Renunciar al poder: la carta queda como una carta más.
 *
 * Ya no reabre nada. Antes sí, y con razón: el poder salteaba la ventana, así
 * que al renunciar había que devolverle a la mesa los reflejos que el tiro le
 * habría dado. Ahora la ventana ocurre ANTES de decidir el poder, siempre, así
 * que la mesa ya tuvo su turno de reaccionar. Reabrirla acá sería una segunda
 * ventana por la misma carta.
 */
export function saltarPoder(estado) {
  const poder = estado.poderPendiente;
  const siguiente = {
    ...estado,
    fase: "postLevantada",
    poderPendiente: null,
  };
  if (!poder) return siguiente;
  return anotar(
    siguiente,
    `${estado.jugadores[poder.indiceJugador].nombre} no usó el poder ${poder.numero}`,
  );
}

// ------------------------------------------------------------------ corte

/** Sólo se puede cortar en el turno propio y después de haber levantado. */
export const puedeCortar = (estado) => estado.fase === "postLevantada";

export function cortar(estado) {
  if (!puedeCortar(estado)) return estado;
  const indiceCortador = estado.indiceTurno;
  const cortador = estado.jugadores[indiceCortador];

  // Se mide ANTES de resolver: al resolver las manos quedan reveladas igual,
  // pero el bono es por haber llegado al corte sin cartas.
  const cortePerfecto = cartasVivas(cortador.mano).length === 0;

  const { jugadores, corteFallido } = resolverCorte(estado.jugadores, indiceCortador);
  const eliminados = aplicarEliminacion(jugadores, estado.ronda);
  const fin = comprobarFinPartida(eliminados);

  // Si todos se pasaron de 150 en la misma ronda y quedaron empatados en el
  // puntaje más bajo, hay que jugar una ronda de desempate. Para eso los
  // empatados vuelven a la mesa: si siguieran eliminados no repartiría a
  // nadie, la ronda no cambiaría nada y la partida no terminaría nunca.
  const enDesempate = new Set(fin.desempate ? fin.empatados.map((j) => j.id) : []);
  const conEliminados = enDesempate.size
    ? eliminados.map((j) =>
        enDesempate.has(j.id) ? { ...j, eliminado: false, eliminadoEnRonda: null } : j,
      )
    : eliminados;

  const eventos = [...estado.eventos];
  if (cortePerfecto) {
    eventos.push({ tipo: "cortePerfecto", indice: indiceCortador, ronda: estado.ronda });
  }
  // Las eliminaciones de esta ronda se atribuyen a quien la cerró cortando.
  conEliminados.forEach((j, i) => {
    if (j.eliminado && !estado.jugadores[i].eliminado && i !== indiceCortador) {
      eventos.push({ tipo: "eliminacion", porIndice: indiceCortador, aIndice: i, ronda: estado.ronda });
    }
  });

  return anotar(
    {
      ...estado,
      fase: fin.terminada ? "finPartida" : "finRonda",
      jugadores: conEliminados,
      indiceCortador,
      eventos,
      ganador: fin.ganador,
      desempate: Boolean(fin.desempate),
    },
    corteFallido
      ? `${estado.jugadores[indiceCortador].nombre} cortó mal: +10 puntos`
      : `${estado.jugadores[indiceCortador].nombre} cortó correctamente`,
  );
}

/**
 * El jugador se quedó sin tiempo para levantar: pierde la levantada y el
 * turno pasa al siguiente. No es lo mismo que `pasarTurno`, que se usa
 * después de haber levantado.
 */
export function saltarTurno(estado) {
  if (estado.fase !== "turno" || estado.levantada) return estado;
  return anotar(
    {
      ...estado,
      indiceTurno: siguienteActivo(estado.jugadores, estado.indiceTurno),
    },
    `${estado.jugadores[estado.indiceTurno].nombre} no levantó a tiempo`,
  );
}

export function pasarTurno(estado) {
  if (estado.fase !== "postLevantada") return estado;
  return {
    ...estado,
    fase: "turno",
    indiceTurno: siguienteActivo(estado.jugadores, estado.indiceTurno),
  };
}

/** La mano pasa al siguiente jugador y se reparte de nuevo. */
export function siguienteRonda(estado) {
  if (estado.fase !== "finRonda") return estado;
  return empezarRonda({
    ...estado,
    indiceMano: siguienteActivo(estado.jugadores, estado.indiceMano),
  });
}

export const cartasEnMano = (jugador) => cartasVivas(jugador.mano).length;

/**
 * Orden final de la partida: 1º el ganador, después los eliminados del
 * último al primero. A igualdad de ronda de eliminación desempata el
 * puntaje más bajo.
 */
export function posicionesFinales(estado) {
  const conIndice = estado.jugadores.map((j, indice) => ({ ...j, indice }));
  const ganadorId = estado.ganador?.id;

  return conIndice
    .slice()
    .sort((a, b) => {
      if (a.id === ganadorId) return -1;
      if (b.id === ganadorId) return 1;
      if (a.eliminado !== b.eliminado) return a.eliminado ? 1 : -1;
      const rondaA = a.eliminadoEnRonda ?? Infinity;
      const rondaB = b.eliminadoEnRonda ?? Infinity;
      if (rondaA !== rondaB) return rondaB - rondaA;
      return a.puntos - b.puntos;
    })
    .map((j, orden) => ({
      posicion: orden + 1,
      indice: j.indice,
      id: j.id,
      nombre: j.nombre,
      esIA: j.esIA,
      puntos: j.puntos,
      eliminadoEnRonda: j.eliminadoEnRonda,
    }));
}

/** Todo lo que el ranking necesita saber de una partida terminada. */
export function resumenPartida(estado) {
  const posiciones = posicionesFinales(estado);
  const porIndice = new Map(posiciones.map((p) => [p.indice, p]));

  return {
    rondas: estado.ronda,
    ganadorId: estado.ganador?.id ?? null,
    posiciones,
    eventos: estado.eventos.map((ev) => ({
      ...ev,
      // Los eventos guardan índices; el ranking trabaja con ids de jugador.
      porId: ev.porIndice != null ? porIndice.get(ev.porIndice)?.id : undefined,
      aId: ev.aIndice != null ? porIndice.get(ev.aIndice)?.id : undefined,
      id: ev.indice != null ? porIndice.get(ev.indice)?.id : undefined,
    })),
  };
}
