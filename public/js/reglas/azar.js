/**
 * Azar determinista y serializable.
 *
 * El estado de una partida se guarda en Firestore y vuelve como JSON. Por eso
 * NO puede contener funciones: una fuente de azar guardada como función no
 * sobrevive el viaje, y peor todavía, se pierde en silencio.
 *
 * La solución es que el azar sea ESTADO y no comportamiento: en la partida se
 * guarda una semilla —un número entero— y la función que la hace avanzar vive
 * en el código, como cualquier otra regla.
 *
 * Efecto secundario que vale la pena: la partida queda reproducible. Con la
 * semilla inicial y la lista de acciones se puede volver a jugar exactamente
 * la misma partida, que es lo que hace falta para auditar una queja.
 */

/** mulberry32: rápido, de calidad suficiente para barajar, y de 32 bits. */
export function azarDesde(semilla) {
  let s = semilla >>> 0;
  const siguiente = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /** La semilla en que quedó, para volver a guardarla en el estado. */
  siguiente.semilla = () => s >>> 0;
  return siguiente;
}

/**
 * Semilla inicial. En el navegador y en el servidor usa `crypto` si está;
 * si no, cae en Math.random, que para una partida de entrenamiento alcanza.
 *
 * En una partida por Leyendas la semilla la genera SIEMPRE el servidor: si la
 * eligiera el cliente, podría probar semillas hasta encontrar un reparto que
 * le convenga.
 */
export function semillaAleatoria() {
  const c = globalThis.crypto;
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0] >>> 0;
  return Math.floor(Math.random() * 2 ** 32) >>> 0;
}
