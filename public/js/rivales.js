/**
 * Los rivales de la mesa de entrenamiento: cómo se llaman y qué tan duros son.
 *
 * Vive aparte de `reglas/ia.js` a propósito. Ahí está el cerebro —cuánto
 * recuerda cada nivel, cuánto tarda en reaccionar, cuándo corta— y son diez mil
 * caracteres que el tablero no necesita para dibujar dos desplegables. Acá sólo
 * están los nombres y las etiquetas, que es presentación.
 *
 * Las claves (`facil`, `medio`, `dificil`, `experto`) sí tienen que coincidir
 * con las de `DIFICULTADES` en `reglas/ia.js`: son las que viajan en
 * `configMesa` y las que la mesa busca al armar la partida. Si alguna se
 * renombra allá, acá deja de encontrarse y el rival cae al nivel por defecto.
 */

/** En el orden en que se sientan a la mesa. */
export const NOMBRES_IA = ["Nara", "Bruno", "Vex"];

/** Las etiquetas que ve el jugador, en orden de dureza. */
export const NIVELES = [
  { clave: "facil", etiqueta: "Fácil" },
  { clave: "medio", etiqueta: "Medio" },
  { clave: "dificil", etiqueta: "Difícil" },
  { clave: "experto", etiqueta: "Experto" },
];

/**
 * Qué le toca a cada rival cuando se elige "Mixto".
 *
 * Está escrito a mano y no calculado, porque lo que se quiere de cada mesa es
 * distinto según cuántos sean:
 *
 *   - Con uno solo, "mixto" no significa nada —no hay con quién mezclarlo—,
 *     así que se juega el término medio.
 *   - Con dos, conviene que se noten distintos: uno blando y uno duro.
 *   - Con tres, un escalón de cada zona, incluyendo el techo, para que la mesa
 *     tenga a alguien a quien de verdad cueste ganarle.
 *
 * Una fórmula repartiendo los cuatro niveles daría combinaciones más
 * "prolijas" y peores de jugar.
 */
export const MEZCLA = {
  1: ["medio"],
  2: ["facil", "dificil"],
  3: ["facil", "medio", "experto"],
};

/**
 * Arma la lista de rivales para `configMesa`.
 *
 * `nivel` puede ser una de las claves de `NIVELES` —y entonces todos juegan
 * igual— o `"mixto"`, y entonces cada uno recibe el suyo según `MEZCLA`.
 */
export function armarRivales(cantidad, nivel) {
  const cuantos = Math.min(Math.max(Number(cantidad) || 1, 1), NOMBRES_IA.length);
  const mezcla = nivel === "mixto" ? MEZCLA[cuantos] : null;

  return NOMBRES_IA.slice(0, cuantos).map((nombre, i) => ({
    nombre,
    dificultad: mezcla ? mezcla[i] : nivel,
  }));
}
