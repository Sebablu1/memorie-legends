import { crearBaraja, barajar, TAM_MANO } from "./baraja.js";
import { resolverCorte, aplicarEliminacion, comprobarFinPartida, cartasVivas } from "./puntaje.js";

export const MS_MIRAR = 2000;
export const MS_DESCARTE = 5000;

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

export const crearPartida = (configuracion, { rng = Math.random } = {}) => ({
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
  rng,
});

const anotar = (estado, texto) => ({
  ...estado,
  registro: [...estado.registro, { ronda: estado.ronda, texto }],
});

// --------------------------------------------------------------- reparto

export function empezarRonda(estado) {
  const mazo = barajar(crearBaraja(), estado.rng);
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
  return {
    ...estado,
    mazo: barajar(
      resto.map((c) => ({ ...c, visible: false })),
      estado.rng,
    ),
    descarte: [muestra],
  };
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

export const cerrarVentanaDescarte = (estado) => ({
  ...estado,
  fase: "turno",
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

/** Opción A: cambiarla por una carta propia. No activa poder. */
export function cambiarCarta(estado, posicion) {
  if (estado.fase !== "levantada" || !estado.levantada) return estado;
  const i = estado.indiceTurno;
  const mano = [...estado.jugadores[i].mano];
  const descartada = mano[posicion];
  mano[posicion] = { ...estado.levantada, visible: false };

  return anotar(
    {
      ...estado,
      jugadores: estado.jugadores.map((j, idx) => (idx === i ? { ...j, mano } : j)),
      descarte: descartada
        ? [{ ...descartada, visible: true }, ...estado.descarte]
        : estado.descarte,
      levantada: null,
      fase: "postLevantada",
    },
    `${estado.jugadores[i].nombre} cambió la posición ${posicion}`,
  );
}

/** Opción B: tirarla directamente. Si es 7/8/9/10 el poder se activa ahora. */
export function tirarCarta(estado) {
  if (estado.fase !== "levantada" || !estado.levantada) return estado;
  const carta = estado.levantada;
  const siguiente = {
    ...estado,
    descarte: [{ ...carta, visible: true }, ...estado.descarte],
    levantada: null,
  };

  if (!esPoder(carta)) return { ...siguiente, fase: "postLevantada" };

  return anotar(
    {
      ...siguiente,
      fase: "poder",
      poderPendiente: {
        tipo: PODERES[carta.numero],
        numero: carta.numero,
        indiceJugador: estado.indiceTurno,
      },
    },
    `Poder ${carta.numero}: ${PODERES[carta.numero]}`,
  );
}

/** Poderes 7 y 8: mirar. Devuelve la carta para que la UI la muestre un instante. */
export function usarPoderMirar(estado, indiceObjetivo, posicion) {
  const poder = estado.poderPendiente;
  if (estado.fase !== "poder" || !poder) return { estado, revelada: null };
  if (poder.tipo === "mirarPropia" && indiceObjetivo !== poder.indiceJugador) {
    return { estado, revelada: null };
  }
  if (poder.tipo === "mirarRival" && indiceObjetivo === poder.indiceJugador) {
    return { estado, revelada: null };
  }

  return {
    estado: { ...estado, fase: "postLevantada", poderPendiente: null },
    revelada: {
      indiceJugador: indiceObjetivo,
      posicion,
      carta: estado.jugadores[indiceObjetivo].mano[posicion],
    },
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

  return {
    estado: anotar(
      {
        ...estado,
        fase: "postLevantada",
        poderPendiente: null,
        jugadores: estado.jugadores.map((j, i) =>
          i === yo ? { ...j, mano: miMano } : i === indiceRival ? { ...j, mano: manoRival } : j,
        ),
      },
      `${estado.jugadores[yo].nombre} cambió su ${posicionPropia} por la ${posicionRival} de ${estado.jugadores[indiceRival].nombre}`,
    ),
    revelada,
  };
}

/** El jugador decidió no usar el poder: la carta queda descartada sin efecto. */
export function saltarPoder(estado) {
  const poder = estado.poderPendiente;
  const siguiente = { ...estado, fase: "postLevantada", poderPendiente: null };
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
  const conEliminados = aplicarEliminacion(jugadores, estado.ronda);
  const fin = comprobarFinPartida(conEliminados);

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
