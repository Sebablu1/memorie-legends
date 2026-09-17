/**
 * Una carta conocida que cambia de mano sigue conocida: el recuerdo viaja.
 *
 * LA REGLA
 *
 * Lo que se conoce es la CARTA, no el lugar. Si un jugador sabía qué carta
 * tenía en una posición —la miró al principio de la ronda, o con un poder 7— y
 * alguien se la lleva con un 9 o un 10, ahora sabe en qué mano está, y puede
 * ir a descartársela en la ventana de descarte.
 *
 * Y vale al revés: el que usa el 9 y conocía la carta que entrega sabe que
 * ahora la tiene el rival, en esa posición.
 *
 * POR QUÉ HAY QUE PROBAR LO QUE **NO** PASA
 *
 * Un derecho a atacar que no se ganó es una ventaja regalada, y hay dos formas
 * de regalarlo sin darse cuenta:
 *
 *   - dárselo a quien NUNCA supo qué tenía ahí;
 *   - dárselo sobre una carta que no es la que conocía: si en el medio otro se
 *     la llevó, el derecho está donde está la carta, no donde estaba.
 *
 * ANTES ESTA PRUEBA AFIRMABA OTRA COSA: que el recuerdo caducaba cuando la
 * carta se movía por segunda vez, y que lo que se aprendía era un NÚMERO sobre
 * la mano entera. Se reescribió con la especificación del descarte al rival.
 */

import * as M from "../public/js/reglas/motor.js";
import * as V from "../public/js/reglas/vista.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

const carta = (palo, numero) => ({ id: `${palo}-${numero}`, palo, numero, puntos: numero });

/** X = 0, Y = 1, Z = 2. */
function mesa() {
  const base = M.empezarRonda(M.crearPartida([
    { id: "X", nombre: "X" }, { id: "Y", nombre: "Y" }, { id: "Z", nombre: "Z" },
  ], { semilla: 99 }));

  const manos = [
    [carta("Oro", 1), carta("Oro", 2), carta("Oro", 3), carta("Oro", 4)],
    [carta("Basto", 7), carta("Basto", 5), carta("Basto", 3), carta("Basto", 9)],
    [carta("Espada", 11), carta("Espada", 10), carta("Espada", 6), carta("Espada", 8)],
  ];
  const muestra = { ...carta("Copa", 5), visible: true };
  const usadas = new Set([muestra.id, ...manos.flat().map((c) => c.id)]);

  return {
    ...base,
    fase: "poder",
    descarte: [muestra],
    mazo: base.mazo.filter((c) => !usadas.has(c.id)),
    jugadores: base.jugadores.map((j, i) => ({ ...j, mano: manos[i] })),
  };
}

/** La mesa con el poder de `quien` preparado. */
const conPoder = (tipo, numero, quien = 0) => ({
  ...mesa(),
  poderPendiente: { tipo, numero, indiceJugador: quien },
});

/** Un jugador mira su propia carta, como en la fase de mirada. */
const miro = (s, quien, pos) => M.mirar(s, quien, pos);

/** Sobre qué cartas ajenas puede ir `actor`, como texto para comparar. */
const donde = (s, actor) => JSON.stringify(M.posicionesAtacablesDe(s, actor));

// ============================================== 1. el 9, para los dos lados

console.log("\n=== 1. El 9: cada uno sigue la carta que conocía ===");
{
  // Y había mirado su posición 1: el 5 de basto.
  const s = miro(conPoder("cambioCiego", 9), 1, 1);
  ok(M.objetivosDe(s, 1).length === 0, "antes del cambio, Y no puede atacar a nadie");

  // X le cambia justo esa, por su posición 0.
  const r = M.usarPoderCambio(s, 0, 1, 1);
  ok(r.estado.jugadores[0].mano[0].id === "Basto-5", "la carta que Y conocía pasó a la mano de X");

  ok(donde(r.estado, 1) === '[{"objetivo":0,"posicion":0}]',
     "y Y puede ir sobre ella, en la posición exacta de X", M.posicionesAtacablesDe(r.estado, 1));

  // X no conocía la suya: cambió a ciegas y no gana nada.
  ok(M.objetivosDe(r.estado, 0).length === 0,
     "X, que no conocía la que dio, no puede atacar a nadie", M.objetivosDe(r.estado, 0));

  // Si X SÍ conocía la suya, sabe que ahora la tiene Y.
  const xSabia = M.usarPoderCambio(miro(miro(conPoder("cambioCiego", 9), 1, 1), 0, 0), 0, 1, 1);
  ok(donde(xSabia.estado, 0) === '[{"objetivo":1,"posicion":1}]',
     "si X conocía la que dio, la sigue en la mano de Y", M.posicionesAtacablesDe(xSabia.estado, 0));
}

// ============================================== 2. sin saber, no hay nada

console.log("\n=== 2. Si la víctima no sabía qué tenía, no gana nada ===");
{
  // Y miró la posición 0, pero le cambian la 1.
  const s = miro(conPoder("cambioCiego", 9), 1, 0);
  const r = M.usarPoderCambio(s, 0, 1, 1);

  ok(M.objetivosDe(r.estado, 1).length === 0,
     "no se le regala un derecho que no ganó", M.objetivosDe(r.estado, 1));
  ok(!r.estado.registro.some((l) => l.tipo === "supoPorCambio"),
     "ni se anuncia nada que no pasó");
}

// ============================================== 3. la carta, no el lugar

console.log("\n=== 3. El derecho está donde está la carta ===");
{
  // Y mira su posición 1 (el 5). Z se la lleva con un 9 a su posición 0. Y
  // RECIÉN ENTONCES X le cambia a Y esa misma posición, que ya tiene otra.
  let s = miro(conPoder("cambioCiego", 9), 1, 1);

  const deZ = M.usarPoderCambio(
    { ...s, poderPendiente: { tipo: "cambioCiego", numero: 9, indiceJugador: 2 } },
    0, 1, 1,
  );
  ok(deZ.estado.jugadores[2].mano[0].id === "Basto-5", "Z se llevó el 5 de Y");
  ok(donde(deZ.estado, 1) === '[{"objetivo":2,"posicion":0}]',
     "y Y lo sigue hasta la mano de Z", M.posicionesAtacablesDe(deZ.estado, 1));

  const r = M.usarPoderCambio(
    { ...deZ.estado, fase: "poder", poderPendiente: { tipo: "cambioCiego", numero: 9, indiceJugador: 0 } },
    0, 1, 1,
  );

  // Lo que X se llevó es el 11 de Z, que Y nunca vio. Y no gana nada sobre X,
  // y lo que ya sabía sigue en su lugar: el 5 está en la mano de Z.
  ok(!M.puedeAtacarA(r.estado, 1, 0),
     "Y no puede atacar a X: lo que X se llevó no lo conocía");
  ok(donde(r.estado, 1) === '[{"objetivo":2,"posicion":0}]',
     "y sigue sabiendo dónde está el 5", M.posicionesAtacablesDe(r.estado, 1));
  ok(!r.estado.registro.slice(deZ.estado.registro.length).some((l) => l.tipo === "supoPorCambio"),
     "el segundo cambio no anuncia nada");
}

// ============================================== 4. el 10 que sí cambia

console.log("\n=== 4. El 10, cuando decide cambiar ===");
{
  const s = miro(conPoder("cambioConVista", 10), 1, 1);
  const abierto = M.usarPoderCambio(s, 0, 1, 1);
  ok(abierto.estado.fase === "cambioConVista", "el 10 se detiene a esperar la decisión");
  ok(M.objetivosDe(abierto.estado, 1).length === 0,
     "y mientras espera, la víctima no gana nada: no se movió ninguna carta");

  const r = M.resolverCambioConVista(abierto.estado, true);

  ok(donde(r, 1) === '[{"objetivo":0,"posicion":0}]',
     "hecho el cambio, Y puede ir sobre su 5 en la mano de X", M.posicionesAtacablesDe(r, 1));
  ok(donde(r, 0) === '[{"objetivo":1,"posicion":1}]',
     "y X, que vio las dos, sobre la suya en la mano de Y", M.posicionesAtacablesDe(r, 0));
  ok(r.registro.some((l) => l.tipo === "supoPorCambio" && l.actor === 1 && l.objetivo === 0),
     "y la mesa se entera de que Y sabe algo de X");
}

// ============================================== 5. el 10 que no cambia

console.log("\n=== 5. El 10, cuando decide NO cambiar ===");
{
  const s = miro(conPoder("cambioConVista", 10), 1, 1);
  const abierto = M.usarPoderCambio(s, 0, 1, 1);
  const r = M.resolverCambioConVista(abierto.estado, false);

  ok(r.jugadores[1].mano[1].id === "Basto-5", "la carta de Y no se movió");
  ok(M.objetivosDe(r, 1).length === 0,
     "así que Y no gana nada: no le sacaron nada", M.objetivosDe(r, 1));
  ok(!r.registro.some((l) => l.tipo === "supoPorCambio"), "ni se anuncia nada");
  ok(donde(r, 0) === '[{"objetivo":1,"posicion":1}]',
     "y X puede ir sobre la de Y que vio, donde está", M.posicionesAtacablesDe(r, 0));
}

// ============================================== 6. lo que ve la mesa

console.log("\n=== 6. La mesa se entera de que aprendió, no de QUÉ ===");
{
  const s = miro(conPoder("cambioCiego", 9), 1, 1);
  const r = M.usarPoderCambio(s, 0, 1, 1);

  const linea = r.estado.registro.find((l) => l.tipo === "supoPorCambio");
  ok(Boolean(linea), "queda anotado en el registro", r.estado.registro.at(-1));
  ok(linea?.actor === 1 && linea?.objetivo === 0, "quién aprendió, y sobre quién", linea);
  ok(!/\d/.test(linea?.texto ?? "x1"),
     "y el texto no lleva ningún número: ni la carta ni la posición", linea?.texto);
}

// ============================================== 7. nada de esto viaja

console.log("\n=== 7. Nada de esto llega al navegador ===");
{
  const s = miro(conPoder("cambioCiego", 9), 1, 1);
  const r = M.usarPoderCambio(s, 0, 1, 1);

  for (let i = 0; i < 3; i++) {
    const vista = V.vistaDe(r.estado, i);
    // El estado completo va como segundo argumento: el detector compara lo
    // publicado contra lo que realmente hay, no sólo contra sí mismo.
    const problemas = V.filtracionesEn(vista, r.estado);
    ok(problemas.length === 0, `la vista de ${"XYZ"[i]} no filtra nada`, problemas);
  }

  // Lo único que viaja es el permiso: quién y dónde.
  ok(JSON.stringify(V.vistaDe(r.estado, 1).puedeAtacarEn) === '[{"objetivo":0,"posicion":0}]',
     "Y ve dónde puede ir", V.vistaDe(r.estado, 1).puedeAtacarEn);
  ok(V.vistaDe(r.estado, 2).puedeAtacarEn.length === 0,
     "y Z, que no conocía nada, no", V.vistaDe(r.estado, 2).puedeAtacarEn);
}

// ============================================== 8. el 7 alimenta la regla

console.log("\n=== 8. También sirve lo que se vio con un 7 ===");
{
  // Y usa un 7 sobre su propia posición 3 (un 9 de basto).
  const conSuPoder = conPoder("mirarPropia", 7, 1);
  const vio = M.usarPoderMirar(conSuPoder, 1, 3);
  ok(vio.revelada?.carta?.numero === 9, "Y ve su carta", vio.revelada?.carta?.numero);
  ok(M.objetivosDe(vio.estado, 1).length === 0, "y eso no lo autoriza contra nadie");

  // Ahora X se la lleva a su posición 2.
  const r = M.usarPoderCambio(
    { ...vio.estado, fase: "poder", poderPendiente: { tipo: "cambioCiego", numero: 9, indiceJugador: 0 } },
    2, 1, 3,
  );

  ok(donde(r.estado, 1) === '[{"objetivo":0,"posicion":2}]',
     "lo que vio con el 7 también cuenta, y en su lugar nuevo", M.posicionesAtacablesDe(r.estado, 1));
}

// ============================================== 9. el saber se puede usar

console.log("\n=== 9. El derecho nuevo sirve de verdad en la ventana ===");
{
  // La prueba de que esto no es un adorno: Y va y le descarta la carta a X.
  const s = miro(conPoder("cambioCiego", 9), 1, 1);
  const tras = M.usarPoderCambio(s, 0, 1, 1);

  // La muestra es un 5 y X tiene el 5 de Y en su posición 0.
  const enVentana = {
    ...tras.estado,
    fase: "descarte",
    ventanaDescarte: { huboPrimero: false, intentos: [] },
  };
  ok(M.puedeAtacarEn(enVentana, 1, 0, 0), "Y está habilitado sobre esa carta de X");

  const antes = enVentana.jugadores[0].mano.filter(Boolean).length;
  const r = M.intentarDescarteRival(enVentana, 1, 0, 0, 0);

  ok(r.jugadores[0].mano.filter(Boolean).length === antes,
     "acertar no cambia cuántas cartas tiene X: entra una de Y en el hueco",
     r.jugadores[0].mano.filter(Boolean).length);
  ok(r.descarte[0].numero === 5, "el 5 se fue al descarte", r.descarte[0]?.numero);
  ok(r.jugadores[1].mano.filter(Boolean).length === 3,
     "y Y se quedó con una menos, que es el premio", r.jugadores[1].mano.filter(Boolean).length);
}

// ====================================================================

console.log(fallos ? `\n❌ ${fallos} fallo(s)` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
