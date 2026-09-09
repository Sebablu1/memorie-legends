/**
 * Quedarse sin cartas corta la ronda.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ CAMBIA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Antes, vaciar la mano no hacía nada. El jugador se quedaba sentado sin nada
 * que mirar ni que descartar hasta que le tocara el turno, levantaba una carta
 * del mazo —volvía a tener— y recién ahí podía cortar. O sea que la mejor
 * jugada posible del juego, sacarse las cuatro cartas de encima, se pagaba con
 * una carta más.
 *
 * Ahora la ronda se cierra sola y ese jugador es el cortador.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE HAY QUE DEFENDER
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   1. Que corte, y que el cortador sea el que se quedó sin cartas.
 *   2. Que puntúe EXACTAMENTE igual que un corte a mano. Son dos caminos al
 *      mismo resultado, y si se separan una ronda vale distinto según cómo
 *      terminó.
 *   3. Que el bono de mano vacía se pague solo, sin tener que pedirlo.
 *   4. Que no se dispare de más: con la mano llena, o con un eliminado —que no
 *      tiene cartas porque no está jugando—, no pasa nada.
 *   5. Que si se vacían dos en la misma ventana, corte el que se vació ANTES,
 *      y que ese orden salga de los reflejos y no del número de asiento.
 *   6. Que valga en los dos modos. El corte vive en `cerrarVentanaDescarte`,
 *      que llaman la mesa local y el servidor: es lo que hace que entrenar y
 *      jugar por Leyendas terminen las rondas con la misma regla.
 */

import { readFileSync } from "node:fs";
import * as motor from "../public/js/reglas/motor.js";
import { BONO_MANO_VACIA } from "../public/js/reglas/puntaje.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

const carta = (numero, palo = "Espada") => ({ id: `${palo}-${numero}`, palo, numero, puntos: numero });

/** Una mesa parada a mano, con las manos que hagan falta. */
function mesa(manos, extra = {}) {
  const base = motor.crearPartida(
    manos.map((_, i) => ({ id: `j${i}`, nombre: `J${i}` })),
    { semilla: 1 },
  );
  return {
    ...base,
    fase: "descarte",
    ronda: 1,
    indiceTurno: 0,
    mazo: [carta(4, "Oro"), carta(5, "Oro"), carta(6, "Oro")],
    descarte: [carta(7, "Copa")],
    jugadores: base.jugadores.map((j, i) => ({ ...j, mano: manos[i], puntos: 0 })),
    ventanaDescarte: { volverA: "turno", huboPrimero: false, intentos: [] },
    ...extra,
  };
}

const LLENA = () => [carta(1), carta(2), carta(3), carta(10)];
const VACIA = () => [null, null, null, null];

// =====================================================================

console.log("\n=== Se acabaron las cartas: corta ===");
{
  const antes = mesa([VACIA(), LLENA(), LLENA(), LLENA()]);
  const despues = motor.cerrarVentanaDescarte(antes);

  ok(despues.fase === "finRonda", "la ronda se cierra", despues.fase);
  ok(despues.indiceCortador === 0, "corta el que se quedó sin cartas", despues.indiceCortador);
  ok(
    despues.registro.at(-1)?.texto?.includes("sin cartas"),
    "y el registro dice por qué",
    despues.registro.at(-1)?.texto,
  );
}

console.log("\n=== Con la mano llena no pasa nada ===");
{
  const antes = mesa([LLENA(), LLENA(), LLENA(), LLENA()]);
  const despues = motor.cerrarVentanaDescarte(antes);

  ok(despues.fase === "turno", "la ventana cierra a donde decía volverA", despues.fase);
  ok(despues.indiceCortador == null, "y nadie cortó", despues.indiceCortador);
}

console.log("\n=== La ventana que abrió un tiro vuelve a postLevantada ===");
{
  // Sin corte automático de por medio, `volverA` manda: el que tiró todavía
  // tiene que decidir si corta. Es lo que ya hacía y no se puede haber roto.
  const antes = mesa([LLENA(), LLENA(), LLENA(), LLENA()], {
    ventanaDescarte: { volverA: "postLevantada", huboPrimero: true, intentos: [] },
  });
  ok(motor.cerrarVentanaDescarte(antes).fase === "postLevantada", "vuelve a la decisión del corte");
}

console.log("\n=== Un eliminado no corta, aunque no tenga cartas ===");
{
  const antes = mesa([VACIA(), LLENA(), LLENA(), LLENA()]);
  antes.jugadores[0] = { ...antes.jugadores[0], eliminado: true };
  const despues = motor.cerrarVentanaDescarte(antes);

  ok(despues.fase === "turno", "la ronda sigue", despues.fase);
  ok(despues.indiceCortador == null, "y no hay cortador", despues.indiceCortador);
}

console.log("\n=== Puntúa igual que un corte a mano ===");
{
  // Las mismas manos y el mismo cortador por los dos caminos. Si los números
  // no coinciden, una ronda vale distinto según cómo terminó.
  const manos = [VACIA(), LLENA(), [carta(12), carta(11)], [carta(5)]];

  const auto = motor.cerrarVentanaDescarte(mesa(manos));

  const aMano = motor.cortar({
    ...mesa(manos),
    fase: "postLevantada",
    ventanaDescarte: null,
    indiceTurno: 0,
  });

  const puntos = (e) => e.jugadores.map((j) => j.puntos);
  ok(
    JSON.stringify(puntos(auto)) === JSON.stringify(puntos(aMano)),
    "los cuatro puntajes coinciden",
    { auto: puntos(auto), aMano: puntos(aMano) },
  );
  ok(auto.indiceCortador === aMano.indiceCortador, "y el cortador es el mismo");

  // El bono se cobra solo: 0 puntos de mano, menos 10 por llegar vacío.
  ok(puntos(auto)[0] === BONO_MANO_VACIA, `el que se vació cobra ${BONO_MANO_VACIA}`, puntos(auto)[0]);
}

console.log("\n=== Nunca es un corte fallido ===");
{
  // Cortar con más puntos que el más bajo cuesta +10. Con la mano vacía el
  // cortador tiene cero, que es el mínimo posible: el castigo no puede caer.
  const despues = motor.cerrarVentanaDescarte(mesa([VACIA(), [carta(1)], LLENA(), LLENA()]));
  ok(
    !despues.registro.at(-1)?.texto?.includes("cortó mal"),
    "no se castiga a quien se quedó sin cartas",
    despues.registro.at(-1)?.texto,
  );
}

console.log("\n=== Si se vacían dos, corta el que se vació antes ===");
{
  // El 2 descartó antes que el 0. El orden lo dice `intentos`, que la ventana
  // dejó ordenado por tiempo efectivo — no por número de asiento.
  const antes = mesa([VACIA(), LLENA(), VACIA(), LLENA()], {
    ventanaDescarte: {
      volverA: "turno",
      huboPrimero: true,
      intentos: [
        { indiceJugador: 2, posicion: 0, resultado: "primero", carta: null },
        { indiceJugador: 0, posicion: 0, resultado: "primero", carta: null },
      ],
    },
  });

  ok(motor.cerrarVentanaDescarte(antes).indiceCortador === 2, "corta el 2, no el 0 por ser menor");
}

{
  // Y al revés, para que no sea casualidad del orden de los asientos.
  const antes = mesa([VACIA(), LLENA(), VACIA(), LLENA()], {
    ventanaDescarte: {
      volverA: "turno",
      huboPrimero: true,
      intentos: [
        { indiceJugador: 0, posicion: 0, resultado: "primero", carta: null },
        { indiceJugador: 2, posicion: 0, resultado: "primero", carta: null },
      ],
    },
  });

  ok(motor.cerrarVentanaDescarte(antes).indiceCortador === 0, "invirtiendo los reflejos, corta el 0");
}

console.log("\n=== El que entrega su última carta a un rival también corta ===");
{
  // Acertarle a un rival cuesta una carta propia: se la entrega. Es la otra
  // forma de quedarse sin mano, y la más fácil de olvidar.
  const antes = mesa([VACIA(), LLENA(), LLENA(), LLENA()], {
    ventanaDescarte: {
      volverA: "turno",
      huboPrimero: false,
      intentos: [
        { indiceJugador: 1, posicion: 2, actor: 0, resultado: "rivalAcierto", carta: null },
      ],
    },
  });

  ok(motor.cerrarVentanaDescarte(antes).indiceCortador === 0, "corta el que entregó la última");
}

console.log("\n=== Una partida real llega al corte automático ===");
{
  // Nada de manos puestas a mano: se reparte de verdad y se le sacan las
  // cartas a un jugador con la función que las saca, para comprobar que el
  // camino entero —descartar hasta vaciarse— desemboca en el corte.
  let estado = motor.empezarRonda(
    motor.crearPartida(
      [0, 1, 2, 3].map((i) => ({ id: `j${i}`, nombre: `J${i}` })),
      { semilla: 99 },
    ),
  );
  estado = motor.terminarMirada(estado);

  // Se fuerza una ventana con la muestra igual a cada carta del jugador 1, y
  // se descartan las cuatro de a una.
  for (let pos = 0; pos < 4; pos++) {
    const suya = estado.jugadores[1].mano[pos];
    if (!suya) continue;
    estado = {
      ...estado,
      fase: "descarte",
      descarte: [{ ...suya, id: "muestra", visible: true }, ...estado.descarte],
      ventanaDescarte: { volverA: "turno", huboPrimero: false, intentos: [] },
    };
    estado = motor.intentarDescarte(estado, 1, pos);
  }

  ok(
    motor.cartasEnMano(estado.jugadores[1]) === 0,
    "el jugador se quedó sin cartas",
    motor.cartasEnMano(estado.jugadores[1]),
  );

  const cerrado = motor.cerrarVentanaDescarte(estado);
  ok(cerrado.fase === "finRonda", "y la ronda se cerró sola", cerrado.fase);
  ok(cerrado.indiceCortador === 1, "con él como cortador", cerrado.indiceCortador);
}

console.log("\n=== La regla vive donde la ven los dos modos ===");
{
  // El corte automático está DENTRO de `cerrarVentanaDescarte`, que llaman la
  // mesa local y el servidor. Sacándolo afuera habría que acordarse en los dos
  // lugares, y el día que uno se olvide, entrenar y jugar por Leyendas
  // terminarían las rondas con reglas distintas.
  const fuente = readFileSync(new URL("../public/js/reglas/motor.js", import.meta.url), "utf8");
  const cuerpo = fuente.slice(
    fuente.indexOf("export const cerrarVentanaDescarte"),
    fuente.indexOf("export function levantar"),
  );
  ok(cuerpo.includes("quienSeQuedoSinCartas"), "el corte automático está en el cierre de la ventana");

  const servidor = readFileSync(new URL("../functions/partida-red.js", import.meta.url), "utf8");
  ok(
    servidor.includes("motor.cerrarVentanaDescarte"),
    "y el servidor pasa por esa misma función",
  );
}

console.log(fallos === 0 ? "\n✅ TODO OK" : `\n❌ ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
