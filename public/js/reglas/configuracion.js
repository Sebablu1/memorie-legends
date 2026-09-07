/**
 * Los números sueltos del juego, en un solo lugar.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE ARCHIVO NO REDECLARA NADA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque "centralizar la configuración" creando un segundo lugar donde vive el
 * mismo número es exactamente el problema que se quería resolver, con un
 * archivo más.
 *
 * Ya pasó una vez en este proyecto: las Leyendas de bienvenida llegaron a
 * tener CINCO definiciones —`LEYENDAS_REGISTRO = 50` en economía, un 100 a
 * mano en `auth.js`, otro en `register.js`, una constante propia con otro
 * nombre, y el `== 100` de las reglas de Firestore—, y la única que se
 * declaraba oficial era la que mentía. Nunca llegó a producción por
 * casualidad. Hay una prueba —`pruebas/leyendas-iniciales.mjs`— que hoy falla
 * si aparece una segunda definición.
 *
 * Así que acá se REEXPORTA lo que ya tiene dueño y se DEFINE sólo lo que no
 * existía en ningún lado. Un lugar donde mirar, sin un segundo lugar donde
 * cambiar.
 */

import { LEYENDAS_REGISTRO, LEYENDAS_POR_REFERIDO } from "./economia.js";

export { LEYENDAS_REGISTRO, LEYENDAS_POR_REFERIDO };

// ------------------------------------------------------------- torneos

/**
 * Qué entrada puede tener un torneo.
 *
 * Un rango con paso, y no una lista cerrada, porque el administrador arma los
 * torneos a mano y va a querer una entrada que la lista no tenga. El paso de 5
 * es lo que evita las entradas de 137 Leyendas, que no son un error pero
 * quedan mal escritas en un cartel.
 */
export const ENTRADA_MINIMA = 5;
export const ENTRADA_MAXIMA = 20000;
export const PASO_DE_ENTRADA = 5;

/** Las que ofrece el panel de un toque. No son las únicas válidas. */
export const ENTRADAS_SUGERIDAS = Object.freeze([5, 10, 15, 20, 25, 50, 100, 200, 500]);

export function problemasDeEntrada(entrada) {
  const problemas = [];
  if (!Number.isInteger(entrada)) {
    problemas.push("La entrada tiene que ser un número entero.");
    return problemas;
  }
  if (entrada < ENTRADA_MINIMA) problemas.push(`La entrada mínima es ${ENTRADA_MINIMA} Leyendas.`);
  if (entrada > ENTRADA_MAXIMA) problemas.push(`La entrada máxima es ${ENTRADA_MAXIMA} Leyendas.`);
  if (entrada % PASO_DE_ENTRADA !== 0) {
    problemas.push(`La entrada tiene que ir de a ${PASO_DE_ENTRADA} Leyendas.`);
  }
  return problemas;
}

/**
 * Cuántos hacen falta y cuántos entran en una mesa.
 *
 * Menos de 4 no es un torneo: es una partida. Por eso, si al cerrar las
 * inscripciones no llegaron 4, el torneo se cancela y se devuelve la entrada
 * en vez de jugarse entre dos.
 */
export const JUGADORES_POR_MESA = 4;
export const MINIMO_PARA_TORNEO = 4;

// ------------------------------------------------- premios del ranking

/**
 * Los premios físicos del ranking mensual.
 *
 * Son de la casa: no son Leyendas y no pasan por el libro mayor. Lo único que
 * hace el servidor es DEJAR CONSTANCIA de que corresponden —en
 * `users/{uid}.premios`— para que después alguien los mande.
 *
 * Los umbrales son puntos del ranking mensual, que es lo que acumula
 * `rankings/{clave}/jugadores/{uid}`. No son Leyendas ganadas ni partidas
 * jugadas: son la misma unidad que muestra la tabla, para que quien la mira
 * pueda saber si le falta mucho.
 *
 * El panel puede cambiarlos —se guardan en `configuracion/ranking`— y esto es
 * lo que vale si nunca se tocaron.
 */
export const PREMIOS_MENSUALES = Object.freeze([
  { puesto: 1, minimoPuntos: 20000, premio: "remera", etiqueta: "Remera de Memorie Legends" },
  { puesto: 2, minimoPuntos: 19000, premio: "llavero", etiqueta: "Llavero de Memorie Legends" },
]);

/**
 * Qué premio físico le toca a un puesto, si llegó al umbral.
 *
 * Devuelve `null` cuando el puesto no tiene premio o cuando no llegó. Los dos
 * casos son distintos para quien mira la tabla, pero iguales para quien
 * reparte: no hay nada que mandar.
 */
export function premioFisicoDe(puesto, puntos, umbrales = PREMIOS_MENSUALES) {
  const fila = umbrales.find((p) => p.puesto === puesto);
  if (!fila) return null;
  if (!Number.isFinite(puntos) || puntos < fila.minimoPuntos) return null;
  return { premio: fila.premio, etiqueta: fila.etiqueta, puesto, puntos };
}

/**
 * Normaliza umbrales editados desde el panel.
 *
 * Un umbral en cero o negativo repartiría el premio a cualquiera, así que se
 * ignora y queda el de fábrica. Es la clase de campo que se borra sin querer
 * en un formulario.
 */
export function umbralesValidos(guardados) {
  if (!guardados || typeof guardados !== "object") return PREMIOS_MENSUALES;
  return PREMIOS_MENSUALES.map((base) => {
    const v = Number(guardados[base.premio]);
    return Number.isInteger(v) && v > 0 ? { ...base, minimoPuntos: v } : base;
  });
}
