/**
 * Partidas cortas, normales y extendidas — y el barajado de cada ronda.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL LÍMITE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El entrenamiento deja elegir con cuántos puntos se queda afuera: 60, 100 o
 * 150. Antes era una constante del módulo, o sea el mismo número para todos.
 *
 * Lo que cambia es SÓLO el número. El castigo de +10 por cortar mal, el bono
 * de −10 por llegar al corte sin cartas y la regla de que con el límite exacto
 * se sigue jugando son idénticos en los tres modos. Esta prueba existe sobre
 * todo para eso: para que el día que alguien toque el límite no se lleve
 * puesta ninguna de esas tres cosas sin enterarse.
 *
 * Y el valor por defecto sigue siendo 150. Es lo que hace que las partidas por
 * Leyendas y el servidor —que llaman sin decir nada— jueguen como siempre.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL BARAJADO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Cada ronda tiene que repartir un mazo distinto. Acá se comprueba mirando el
 * reparto de rondas seguidas: si el orden se repitiera, la memoria dejaría de
 * ser memoria y pasaría a ser haberse aprendido la ronda anterior.
 */

import * as M from "../public/js/reglas/motor.js";
import { LIMITE_ELIMINACION, CASTIGO_CORTE_FALLIDO, BONO_MANO_VACIA } from "../public/js/reglas/puntaje.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

const JUGADORES = [
  { id: "h0", nombre: "Vos", esIA: false },
  { id: "ia0", nombre: "Nara", esIA: true, dificultad: "medio" },
];

// =====================================================================
console.log("\n=== 1. El límite viaja en el estado ===");
// =====================================================================

ok(
  M.crearPartida(JUGADORES).limitePuntos === LIMITE_ELIMINACION,
  `sin pedir nada, el límite es el de siempre (${LIMITE_ELIMINACION})`,
  M.crearPartida(JUGADORES).limitePuntos,
);

for (const limite of [60, 100, 150]) {
  const e = M.crearPartida(JUGADORES, { limitePuntos: limite });
  ok(e.limitePuntos === limite, `se puede pedir una partida de ${limite}`, e.limitePuntos);
}

// =====================================================================
console.log("\n=== 2. Con cuántos puntos se queda afuera ===");
// =====================================================================

/** Un estado con los puntos puestos a mano, listo para eliminar. */
const conPuntos = (puntos, limite) => {
  const e = M.crearPartida(JUGADORES, { limitePuntos: limite });
  return {
    ...e,
    ronda: 3,
    jugadores: e.jugadores.map((j, i) => ({ ...j, puntos: puntos[i] })),
  };
};

/** Aplica la eliminación como lo hace el motor al cerrar una ronda. */
const eliminar = (estado) =>
  import("../public/js/reglas/puntaje.js").then(({ aplicarEliminacion }) =>
    aplicarEliminacion(estado.jugadores, estado.ronda, estado.limitePuntos),
  );

for (const limite of [60, 100, 150]) {
  // Justo en el límite se sigue jugando; uno más, afuera. Es la regla que más
  // fácil se rompe al cambiar un `<=` por un `<`.
  const justo = await eliminar(conPuntos([limite, 0], limite));
  ok(!justo[0].eliminado, `con ${limite} exactos (límite ${limite}) sigue en juego`);

  const pasado = await eliminar(conPuntos([limite + 1, 0], limite));
  ok(pasado[0].eliminado, `con ${limite + 1} (límite ${limite}) queda afuera`);
  ok(pasado[0].eliminadoEnRonda === 3, "y queda anotado en qué ronda fue");
}

// Lo importante del modo corto: 100 puntos eliminan en una partida de 60 y
// NO eliminan en una de 150. Si el límite no viajara, esto daría igual.
const en60 = await eliminar(conPuntos([100, 0], 60));
const en150 = await eliminar(conPuntos([100, 0], 150));
ok(en60[0].eliminado && !en150[0].eliminado, "100 puntos: afuera en la corta, adentro en la extendida");

// =====================================================================
console.log("\n=== 3. Las reglas del corte NO cambiaron ===");
// =====================================================================

ok(CASTIGO_CORTE_FALLIDO === 10, "cortar mal sigue costando +10");
ok(BONO_MANO_VACIA === -10, "llegar al corte sin cartas sigue dando −10");
ok(LIMITE_ELIMINACION === 150, "el límite por defecto sigue siendo 150");

// =====================================================================
console.log("\n=== 4. Cada ronda baraja de nuevo ===");
// =====================================================================

/** Cómo quedó repartida una ronda: las manos y la muestra, como texto. */
const huella = (e) => JSON.stringify([
  e.jugadores.map((j) => j.mano.map((c) => c && `${c.numero}${c.palo}`)),
  e.descarte[0] && `${e.descarte[0].numero}${e.descarte[0].palo}`,
]);

let estado = M.crearPartida(JUGADORES, { semilla: 4242 });
const huellas = [];
for (let i = 0; i < 5; i++) {
  estado = M.empezarRonda(estado);
  huellas.push(huella(estado));
}

ok(
  new Set(huellas).size === huellas.length,
  "cinco rondas seguidas reparten cinco mazos distintos",
  `${new Set(huellas).size} repartos distintos de ${huellas.length}`,
);

// La semilla avanza: es lo que hace que la ronda siguiente no repita.
let avanza = M.crearPartida(JUGADORES, { semilla: 4242 });
const semillas = [];
for (let i = 0; i < 4; i++) {
  avanza = M.empezarRonda(avanza);
  semillas.push(avanza.semilla);
}
ok(new Set(semillas).size === semillas.length, "y la semilla no se repite entre rondas");

// Con la MISMA semilla, dos partidas reparten igual. Es lo que hace que las
// pruebas del navegador puedan fijar el reparto; si esto se rompiera, media
// suite empezaría a fallar por motivos distintos en cada corrida.
const a = M.empezarRonda(M.crearPartida(JUGADORES, { semilla: 777 }));
const b = M.empezarRonda(M.crearPartida(JUGADORES, { semilla: 777 }));
ok(huella(a) === huella(b), "la misma semilla sigue dando el mismo reparto");

// =====================================================================
console.log("\n=== 5. El límite sobrevive a la ronda ===");
// =====================================================================

// `empezarRonda` rehace medio estado. Si se olvidara de copiar el límite, la
// partida corta se volvería extendida en la ronda dos y nadie lo notaría hasta
// llegar a los 150.
let corta = M.crearPartida(JUGADORES, { semilla: 1, limitePuntos: 60 });
for (let i = 0; i < 3; i++) corta = M.empezarRonda(corta);
ok(corta.limitePuntos === 60, "tres rondas después, sigue siendo una partida de 60", corta.limitePuntos);

console.log(fallos ? `\n❌ ${fallos} fallos` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
