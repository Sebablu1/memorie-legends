import { puntosCarta } from "./baraja.js";
import { esDescarteValido, esPoder } from "./motor.js";

// errorDescarte y reaccion salen directos de la tabla del reglamento.
// memoria = probabilidad de recordar una carta vista.
// cortaEn = puntos estimados de mano por debajo de los cuales corta.
export const DIFICULTADES = {
  facil: { etiqueta: "Fácil", errorDescarte: 0.3, reaccion: [2000, 4000], memoria: 0.45, cortaEn: 16, cambiaEn: 8 },
  medio: { etiqueta: "Medio", errorDescarte: 0.15, reaccion: [1000, 3000], memoria: 0.7, cortaEn: 14, cambiaEn: 7 },
  dificil: { etiqueta: "Difícil", errorDescarte: 0.05, reaccion: [500, 1500], memoria: 0.9, cortaEn: 12, cambiaEn: 6 },
  experto: { etiqueta: "Experto", errorDescarte: 0, reaccion: [300, 800], memoria: 1, cortaEn: 10, cambiaEn: 5 },
};

/** Valor medio de una carta de la baraja (268 puntos / 48 cartas). */
export const ESTIMACION_DESCONOCIDA = 5.6;

const perfil = (dificultad) => DIFICULTADES[dificultad] ?? DIFICULTADES.medio;

export function retrasoReaccion(dificultad, rng = Math.random) {
  const [min, max] = perfil(dificultad).reaccion;
  return Math.round(min + rng() * (max - min));
}

// ---------------------------------------------------------------- memoria

const clave = (indiceJugador, posicion) => `${indiceJugador}:${posicion}`;

export const crearMemoria = () => ({ vistas: new Map() });

/** Registra una carta vista. Las IAs flojas la olvidan con cierta probabilidad. */
export function recordar(memoria, dificultad, indiceJugador, posicion, carta, rng = Math.random) {
  if (!carta) return memoria;
  if (rng() > perfil(dificultad).memoria) return memoria;
  const vistas = new Map(memoria.vistas);
  vistas.set(clave(indiceJugador, posicion), carta);
  return { vistas };
}

export function olvidar(memoria, indiceJugador, posicion) {
  const vistas = new Map(memoria.vistas);
  vistas.delete(clave(indiceJugador, posicion));
  return { vistas };
}

export const consultar = (memoria, indiceJugador, posicion) =>
  memoria.vistas.get(clave(indiceJugador, posicion)) ?? null;

/**
 * Lo que se destapó en la ventana de descarte lo vio toda la mesa, así que la
 * IA lo memoriza igual que una persona. No es información permanente: si esa
 * carta después cambia de lugar, `olvidar` la borra como a cualquier otra.
 */
export function absorberRevelaciones(memoria, revelaciones) {
  const vistas = new Map(memoria.vistas);
  revelaciones.forEach(({ indiceJugador, posicion, carta }) => {
    if (carta) vistas.set(clave(indiceJugador, posicion), carta);
  });
  return { vistas };
}

// -------------------------------------------------------------- decisiones

/**
 * ¿Intenta descartar al ver la muestra? Devuelve la posición, o null si pasa.
 * Con probabilidad errorDescarte elige una posición equivocada a propósito.
 */
export function decidirDescarte(estado, indiceIA, memoria, rng = Math.random) {
  const { dificultad, mano } = estado.jugadores[indiceIA];
  const { errorDescarte } = perfil(dificultad);
  const muestra = estado.descarte[0];

  const aciertos = mano
    .map((carta, posicion) => ({ carta, posicion }))
    .filter(
      ({ carta, posicion }) =>
        carta && esDescarteValido(consultar(memoria, indiceIA, posicion), muestra),
    );

  if (rng() < errorDescarte) {
    const candidatas = mano
      .map((_, posicion) => posicion)
      .filter((p) => mano[p] && !aciertos.some((a) => a.posicion === p));
    if (!candidatas.length) return aciertos[0]?.posicion ?? null;
    return candidatas[Math.floor(rng() * candidatas.length)];
  }

  return aciertos.length ? aciertos[0].posicion : null;
}

/**
 * Con la carta ya levantada: cambiarla o tirarla.
 * Devuelve { accion: "cambiar", posicion } o { accion: "tirar" }.
 */
export function decidirLevantada(estado, indiceIA, memoria, rng = Math.random) {
  const { dificultad, mano } = estado.jugadores[indiceIA];
  const { cambiaEn } = perfil(dificultad);
  const puntosLevantada = puntosCarta(estado.levantada.numero);

  // Un poder alto vale más tirado que guardado en la mano.
  if (esPoder(estado.levantada) && puntosLevantada > cambiaEn) return { accion: "tirar" };

  const conocidas = mano
    .map((carta, posicion) => ({
      posicion,
      carta,
      puntos: puntosCarta(consultar(memoria, indiceIA, posicion)?.numero ?? -1),
    }))
    .filter(({ carta, puntos }) => carta && puntos >= 0)
    .sort((a, b) => b.puntos - a.puntos);

  const peor = conocidas[0];
  if (peor && peor.puntos > puntosLevantada) {
    return { accion: "cambiar", posicion: peor.posicion };
  }

  // Sin memoria fiable, una carta muy baja se arriesga en una posición desconocida.
  const desconocidas = mano
    .map((_, posicion) => posicion)
    .filter((p) => mano[p] && !consultar(memoria, indiceIA, p));
  if (puntosLevantada <= 3 && desconocidas.length) {
    return { accion: "cambiar", posicion: desconocidas[Math.floor(rng() * desconocidas.length)] };
  }

  return { accion: "tirar" };
}

/** Objetivo de los poderes 7 y 8: una posición que todavía no conoce. */
export function decidirObjetivoMirada(estado, indiceIA, memoria, propias, rng = Math.random) {
  const objetivos = [];
  estado.jugadores.forEach((jugador, indiceJugador) => {
    if (jugador.eliminado) return;
    if (propias ? indiceJugador !== indiceIA : indiceJugador === indiceIA) return;
    jugador.mano.forEach((carta, posicion) => {
      if (carta && !consultar(memoria, indiceJugador, posicion)) {
        objetivos.push({ indiceJugador, posicion });
      }
    });
  });
  if (!objetivos.length) return null;
  return objetivos[Math.floor(rng() * objetivos.length)];
}

/** Objetivo de los poderes 9 y 10: dar la peor propia y llevarse la mejor ajena. */
export function decidirObjetivoCambio(estado, indiceIA, memoria, aCiegas, rng = Math.random) {
  const propias = estado.jugadores[indiceIA].mano
    .map((carta, posicion) => ({
      posicion,
      carta,
      puntos: puntosCarta(consultar(memoria, indiceIA, posicion)?.numero ?? -1),
    }))
    .filter((h) => h.carta)
    .sort((a, b) => b.puntos - a.puntos);
  if (!propias.length) return null;

  const rivales = [];
  estado.jugadores.forEach((jugador, indiceJugador) => {
    if (jugador.eliminado || indiceJugador === indiceIA) return;
    jugador.mano.forEach((carta, posicion) => {
      if (!carta) return;
      const conocida = consultar(memoria, indiceJugador, posicion);
      rivales.push({
        indiceJugador,
        posicion,
        puntos: conocida ? puntosCarta(conocida.numero) : null,
      });
    });
  });
  if (!rivales.length) return null;

  // A ciegas no hay información del rival: se elige al azar.
  const objetivo = aCiegas
    ? rivales[Math.floor(rng() * rivales.length)]
    : (rivales.filter((r) => r.puntos != null).sort((a, b) => a.puntos - b.puntos)[0] ??
      rivales[Math.floor(rng() * rivales.length)]);

  return {
    posicionPropia: propias[0].posicion,
    indiceRival: objetivo.indiceJugador,
    posicionRival: objetivo.posicion,
  };
}

/**
 * ¿Corta? Estima su mano y la compara con el umbral de su nivel.
 * El umbral se afloja según se alarga la ronda, para que nadie se quede
 * esperando indefinidamente una mano perfecta.
 */
export function decidirCorte(estado, indiceIA, memoria) {
  const { dificultad, mano } = estado.jugadores[indiceIA];
  const { cortaEn } = perfil(dificultad);

  const vivas = mano.filter(Boolean).length;
  if (vivas === 0) return true;

  const estimado = mano.reduce((suma, carta, posicion) => {
    if (!carta) return suma;
    const conocida = consultar(memoria, indiceIA, posicion);
    return suma + (conocida ? puntosCarta(conocida.numero) : ESTIMACION_DESCONOCIDA);
  }, 0);

  const activos = estado.jugadores.filter((j) => !j.eliminado).length || 1;
  const vueltas = Math.floor((estado.turnosRonda ?? 0) / activos);
  const presion = Math.max(0, vueltas - 2) * 2;

  return estimado <= cortaEn + presion;
}
