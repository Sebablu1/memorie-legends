/**
 * Cuándo corta la IA.
 *
 * LA REGLA ANTERIOR Y POR QUÉ SE CAMBIÓ
 *
 * Antes era una sola cuenta: estimar la mano contando cada carta no recordada
 * como 5,6 puntos, y cortar si daba por debajo del umbral. Eso trata igual dos
 * situaciones que no se parecen: cuatro cartas sin recordar ninguna estima
 * 22,4, y una mano de dos cartas conocidas que suman 22 estima lo mismo. La
 * primera es una apuesta a ciegas y la segunda un dato, y cortar mal cuesta
 * +10.
 *
 * Se veía en el reparto de quién cortaba: simulando 300 rondas con las cuatro
 * dificultades, la IA FÁCIL cortaba el 54 % de las veces y la EXPERTA el 8 %.
 * Exactamente al revés de lo esperable, porque a la fácil su mala memoria le
 * dejaba muchas cartas "estimadas" y la estimación era más optimista que la
 * realidad. Con la regla nueva el reparto queda 95/86/60/59.
 */

import * as IA from "../public/js/reglas/ia.js";
import { puntosCarta } from "../public/js/reglas/baraja.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

const carta = (numero, palo = "Oro") => ({ id: `${palo}-${numero}`, palo, numero, puntos: numero });

/** Una mesa mínima con la mano que se le indique. */
const mesa = (mano, dificultad = "medio") => ({
  jugadores: [{ nombre: "IA", dificultad, mano, eliminado: false }],
  indiceTurno: 0,
  turnosRonda: 0,
  fase: "postLevantada",
});

/** Memoria que recuerda exactamente las posiciones indicadas. */
function memoriaCon(mano, posiciones) {
  let m = IA.crearMemoria();
  for (const p of posiciones) {
    // rng fijo en 0 para que recuerde siempre, sea cual sea la dificultad.
    m = IA.recordar(m, "experto", 0, p, mano[p], () => 0);
  }
  return m;
}

// ═══════════════════════════════════════════ las manos chicas: cortan

console.log("\n=== Con la mano casi vacía se corta sin pensarlo ===");
{
  const sinNada = mesa([null, null, null, null]);
  ok(IA.decidirCorte(sinNada, 0, IA.crearMemoria()) === true,
     "sin cartas, corta");

  // Una carta, y la peor de la baraja. Corta igual: con tan poco en la mano es
  // muy difícil no tener el puntaje más bajo, y seguir jugando expone a
  // recibir cartas de castigo, que es peor que arriesgar el +10.
  const unaAlta = mesa([carta(12), null, null, null]);
  ok(IA.decidirCorte(unaAlta, 0, IA.crearMemoria()) === true,
     "con una sola carta corta, aunque sea alta y no la recuerde");

  const dosAltas = mesa([carta(12), carta(11), null, null]);
  ok(IA.decidirCorte(dosAltas, 0, IA.crearMemoria()) === true,
     "con dos, también");

  ok(IA.MANO_CHICA === 2, "el umbral de 'mano chica' es dos cartas", IA.MANO_CHICA);
}

// ══════════════════════════════ tres o cuatro cartas: hay que saber de qué se habla

console.log("\n=== Con tres o cuatro cartas, primero hay que conocerlas ===");
{
  const mano = [carta(1), carta(1), carta(1), null]; // tres ases: lo mejor posible
  const tabla = mesa(mano);

  for (const cuantas of [0, 1, 2]) {
    const m = memoriaCon(mano, [...Array(cuantas).keys()]);
    ok(IA.decidirCorte(tabla, 0, m) === false,
       `recordando ${cuantas} carta(s) NO corta, por buena que sea la mano`);
  }

  const conTres = memoriaCon(mano, [0, 1, 2]);
  ok(IA.decidirCorte(tabla, 0, conTres) === true,
     "recordando las tres, y sumando 3 puntos, sí corta");

  ok(IA.MINIMO_CONOCIDAS === 3, "el mínimo son tres cartas", IA.MINIMO_CONOCIDAS);
}

console.log("\n=== Una mano mala no se corta aunque se conozca entera ===");
{
  // Tres figuras: 10 + 11 + 12 = 33 puntos. Ninguna dificultad corta con eso.
  const mano = [carta(10), carta(11), carta(12), null];
  const m = memoriaCon(mano, [0, 1, 2]);
  for (const dificultad of Object.keys(IA.DIFICULTADES)) {
    ok(IA.decidirCorte(mesa(mano, dificultad), 0, m) === false,
       `${dificultad} no corta con 33 puntos conocidos`);
  }
}

// ═══════════════════════════════════════ cada dificultad, en su borde exacto

console.log("\n=== Cada dificultad corta justo en su techo, y no un punto más ===");
{
  for (const [dificultad, { sumaMaximaConocida }] of Object.entries(IA.DIFICULTADES)) {
    // Se arma una mano de tres cartas que sume EXACTAMENTE el techo, y otra
    // que sume uno más. Los puntos de una carta no siempre son su número
    // —de ahí `puntosCarta`—, así que se busca la combinación en vez de
    // suponerla.
    const justo = manoQueSuma(sumaMaximaConocida);
    const unoMas = manoQueSuma(sumaMaximaConocida + 1);

    ok(justo !== null && IA.decidirCorte(mesa(justo, dificultad), 0, memoriaCon(justo, [0, 1, 2])) === true,
       `${dificultad}: corta sumando exactamente ${sumaMaximaConocida}`);

    ok(unoMas !== null && IA.decidirCorte(mesa(unoMas, dificultad), 0, memoriaCon(unoMas, [0, 1, 2])) === false,
       `${dificultad}: NO corta sumando ${sumaMaximaConocida + 1}`);
  }
}

console.log("\n=== Los techos van de más flojo a más exigente ===");
{
  const orden = ["facil", "medio", "dificil", "experto"];
  const techos = orden.map((d) => IA.DIFICULTADES[d].sumaMaximaConocida);
  ok(techos.every((t, i) => i === 0 || t < techos[i - 1]),
     `cada dificultad es más exigente que la anterior: ${techos.join(" > ")}`);
  ok(techos.join(",") === "16,13,10,8", "y son los valores acordados", techos);
}

// ═════════════════════════════════ sólo cuentan las cartas que RECUERDA

console.log("\n=== La suma es sólo de lo recordado, sin estimar lo demás ===");
{
  // Dos ases recordados (2 puntos) y dos figuras que NO recuerda. Con tres
  // conocidas haría falta una más; con sólo dos, no corta y punto.
  const mano = [carta(1), carta(1), carta(12), carta(12)];
  ok(IA.decidirCorte(mesa(mano, "experto"), 0, memoriaCon(mano, [0, 1])) === false,
     "dos recordadas no alcanzan, por bajas que sean");

  // Con tres recordadas —incluida una figura— la suma manda: 1+1+12 = 14.
  ok(IA.decidirCorte(mesa(mano, "facil"), 0, memoriaCon(mano, [0, 1, 2])) === true,
     "tres recordadas que suman 14 sí cortan en fácil (techo 16)");
  ok(IA.decidirCorte(mesa(mano, "medio"), 0, memoriaCon(mano, [0, 1, 2])) === false,
     "las mismas 14 NO cortan en medio (techo 13)");
}

console.log("\n=== Los huecos no cuentan como cartas ===");
{
  // Dos cartas y dos huecos: es una mano de DOS, así que corta por mano chica
  // aunque no recuerde nada.
  const mano = [carta(12), null, carta(11), null];
  ok(IA.decidirCorte(mesa(mano), 0, IA.crearMemoria()) === true,
     "una mano con huecos se cuenta por cartas vivas, no por posiciones");
}

/** Tres cartas cuyos puntos sumen exactamente `total`, o null si no se puede. */
function manoQueSuma(total) {
  const numeros = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  for (const a of numeros) {
    for (const b of numeros) {
      for (const c of numeros) {
        if (puntosCarta(a) + puntosCarta(b) + puntosCarta(c) === total) {
          return [carta(a, "Oro"), carta(b, "Copa"), carta(c, "Espada"), null];
        }
      }
    }
  }
  return null;
}

console.log(fallos ? `\n❌ ${fallos} fallos\n` : "\n✅ TODO OK\n");
process.exit(fallos ? 1 : 0);
