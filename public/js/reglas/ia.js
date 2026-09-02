import { puntosCarta } from "./baraja.js";
import { esDescarteValido, esPoder } from "./motor.js";

// errorDescarte y reaccion salen directos de la tabla del reglamento.
// memoria = probabilidad de recordar una carta vista.
//
// `cortaEn` y `ESTIMACION_DESCONOCIDA` ya NO los usa `decidirCorte`: quedaron
// de la regla anterior, que estimaba las cartas no recordadas. Se dejan
// exportados porque describen bien el perfil de cada dificultad y `cambiaEn`
// vive en la misma tabla, pero nadie los lee para decidir el corte.
/**
 * `sumaMaximaConocida` es el techo para cortar con la mano casi entera.
 *
 * Sólo suma las cartas que la IA RECUERDA, así que no es comparable con
 * `cortaEn`, que estimaba las desconocidas en 5,6 puntos cada una. Cuanto
 * mejor la IA, más exigente: la experta no corta con más de 8 puntos vistos,
 * la fácil se conforma con 16.
 */
export const DIFICULTADES = {
  facil: { etiqueta: "Fácil", errorDescarte: 0.3, reaccion: [2000, 4000], memoria: 0.45, cortaEn: 16, cambiaEn: 8, sumaMaximaConocida: 16 },
  medio: { etiqueta: "Medio", errorDescarte: 0.15, reaccion: [1000, 3000], memoria: 0.7, cortaEn: 14, cambiaEn: 7, sumaMaximaConocida: 13 },
  dificil: { etiqueta: "Difícil", errorDescarte: 0.05, reaccion: [500, 1500], memoria: 0.9, cortaEn: 12, cambiaEn: 6, sumaMaximaConocida: 10 },
  experto: { etiqueta: "Experto", errorDescarte: 0, reaccion: [300, 800], memoria: 1, cortaEn: 10, cambiaEn: 5, sumaMaximaConocida: 8 },
};

/** Con esta cantidad de cartas o menos, se corta sin pensarlo. */
export const MANO_CHICA = 2;

/** Cuántas cartas hay que recordar para que la estimación valga algo. */
export const MINIMO_CONOCIDAS = 3;

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
/**
 * ¿Corta?
 *
 * Antes esto era una sola cuenta: estimar la mano —contando las desconocidas
 * como 5,6 puntos— y cortar si daba por debajo del umbral. El problema es que
 * esa estimación trata igual dos situaciones que no se parecen en nada. Cuatro
 * cartas sin recordar ninguna estima 22,4, y una mano de dos cartas que sí
 * conoce estima lo mismo si suman 22: la primera es una apuesta a ciegas y la
 * segunda un dato. Cortar mal cuesta +10, así que la diferencia importa.
 *
 * Ahora se decide en dos escalones distintos según cuántas cartas queden:
 *
 *   0 cartas   → corta. No hay nada que pueda salir mal.
 *   1 o 2      → corta. Con tan poco en la mano es muy difícil no tener el
 *                puntaje más bajo, y seguir jugando expone a recibir cartas de
 *                castigo, que es peor que el riesgo del +10.
 *   3 o 4      → sólo si sabe de qué habla: tiene que recordar al menos
 *                MINIMO_CONOCIDAS cartas, y la suma de ÉSAS tiene que caber
 *                bajo el techo de su dificultad. Si recuerda menos, no corta:
 *                una estimación mala vale menos que no arriesgar.
 *
 * Ojo con la suma: son sólo las cartas RECORDADAS, sin estimar las otras. Por
 * eso `sumaMaximaConocida` no es comparable con el viejo `cortaEn`, que sí las
 * estimaba.
 */
export function decidirCorte(estado, indiceIA, memoria) {
  const { dificultad, mano } = estado.jugadores[indiceIA];
  const { sumaMaximaConocida } = perfil(dificultad);

  const vivas = mano.filter(Boolean).length;
  if (vivas === 0) return true;
  if (vivas <= MANO_CHICA) return true;

  // Sólo lo que recuerda. Las que no recuerda no suman ni estiman: si son
  // demasiadas, directamente no corta.
  const conocidas = mano.reduce((puntos, carta, posicion) => {
    if (!carta) return puntos;
    const recordada = consultar(memoria, indiceIA, posicion);
    return recordada ? [...puntos, puntosCarta(recordada.numero)] : puntos;
  }, []);

  if (conocidas.length < MINIMO_CONOCIDAS) return false;

  return conocidas.reduce((a, b) => a + b, 0) <= sumaMaximaConocida;
}
