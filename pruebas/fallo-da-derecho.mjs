/**
 * Un descarte fallido le da a la mesa el derecho de descartarle esa carta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL AGUJERO QUE TAPA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Cuando alguien falla un descarte, su carta se expone dos segundos y los tres
 * rivales la ven — la carta Y su posición. Pero no podían hacer nada con ella:
 * `puedeAtacarA` exige un conocimiento, y los conocimientos sólo los daban los
 * poderes 8 y 10. Se veía y no se tocaba.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL ALCANCE ES ESA CARTA Y NO LA MANO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque todo conocimiento es de una carta: la mesa vio ésa, en ese lugar.
 * Dar derecho sobre la mano entera regalaría un permiso que nadie se ganó.
 *
 * Un error muestra además la carta de castigo, y ésa también la conocen
 * todos. Así que tras un fallo hay DOS cartas atacables: la fallada y el
 * castigo. Las otras, no.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Y POR QUÉ NADIE TIENE QUE ACORDARSE DE INVALIDARLO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El derecho se busca contra la carta que HAY en esa posición. Si se la
 * cambiaron o se la descartaron, deja de valer ahí solo. La mitad de esta
 * suite es eso.
 */

import * as M from "../public/js/reglas/motor.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

/** Una mesa de tres en fase de descarte, con las manos puestas a mano. */
function mesa({ muestra = 7, manos } = {}) {
  const jugadores = manos.map((mano, i) => ({
    id: `j${i}`,
    nombre: `J${i}`,
    mano,
    puntos: 0,
    puntosRonda: 0,
    eliminado: false,
    eliminadoEnRonda: null,
    posicionMirada: null,
    esIA: false,
  }));

  return {
    fase: "descarte",
    jugadores,
    ronda: 1,
    indiceMano: 0,
    indiceTurno: 0,
    turnosRonda: 0,
    indiceCortador: null,
    desempate: false,
    registro: [],
    conocimientos: [],
    mazo: [
      { id: "m1", numero: 1, palo: "oro" },
      { id: "m2", numero: 2, palo: "oro" },
      { id: "m3", numero: 3, palo: "oro" },
    ],
    descarte: [{ id: "d0", numero: muestra, palo: "copa", visible: true }],
    levantada: null,
    poderPendiente: null,
    cambioPendiente: null,
    ventanaDescarte: { huboPrimero: false, intentos: [], volverA: "turno" },
    limitePuntos: 100,
    semilla: 1,
  };
}

const carta = (id, numero) => ({ id, numero, palo: "espada" });

// =====================================================================
console.log("\n=== 1. Fallar le da derecho a los demás, y sólo ahí ===");
// =====================================================================

{
  // La muestra es un 7 y J0 descarta un 3 desde la posición 1: falla.
  const inicial = mesa({
    muestra: 7,
    manos: [
      [carta("a0", 9), carta("a1", 3), carta("a2", 5)],
      [carta("b0", 4)],
      [carta("c0", 6)],
    ],
  });

  const tras = M.intentarDescarte(inicial, 0, 1);

  ok(tras !== inicial, "el intento se aplicó");
  ok(tras.jugadores[0].mano[1]?.id === "a1", "la carta fallada se queda donde estaba");
  ok(tras.jugadores[0].mano.length === 4, "y le llega una de castigo", tras.jugadores[0].mano.length);

  // Los dos rivales pueden atacarle ESA posición.
  for (const rival of [1, 2]) {
    ok(M.puedeAtacarEn(tras, rival, 0, 1), `J${rival} puede atacar la posición 1`);
  }

  // Y ninguna otra.
  for (const otra of [0, 2]) {
    ok(!M.puedeAtacarEn(tras, 1, 0, otra), `  pero NO la posición ${otra}`);
  }

  /**
   * Lo atacable es exactamente la fallada y la de castigo.
   *
   * Si apareciera cualquier otra posición, el fallo estaría regalando la mano
   * entera.
   */
  ok(JSON.stringify(M.posicionesAtacablesDe(tras, 1)) ===
       '[{"objetivo":0,"posicion":1},{"objetivo":0,"posicion":3}]',
     "el fallo da derecho sobre la fallada y el castigo, y nada más",
     M.posicionesAtacablesDe(tras, 1));

  // El que falló no gana derecho sobre sí mismo.
  ok(!M.puedeAtacarEn(tras, 0, 0, 1), "y el que falló no se ataca a sí mismo");
}

// =====================================================================
console.log("\n=== 2. El acierto tarde NO da derecho ===");
// =====================================================================

{
  /**
   * Es lo que mantiene el escalón: fallar es peor que llegar tarde.
   *
   * Los dos exponen la carta dos segundos —eso no cambió— pero sólo el error
   * regala el derecho a atacarla.
   */
  const inicial = mesa({
    muestra: 7,
    manos: [
      [carta("a0", 7), carta("a1", 2)],
      [carta("b0", 7)],
      [carta("c0", 6)],
    ],
  });

  // J1 llega primero con su 7.
  const primero = M.intentarDescarte(inicial, 1, 0);
  ok(primero.ventanaDescarte.huboPrimero === true, "J1 llegó primero");

  // J0 llega tarde con el suyo, que también es un 7: acierta pero tarde.
  const tarde = M.intentarDescarte(primero, 0, 0);
  const ultimo = tarde.ventanaDescarte.intentos.at(-1);
  ok(ultimo?.resultado === "tarde", "J0 acertó tarde", ultimo?.resultado);

  ok(!M.puedeAtacarEn(tarde, 2, 0, 0), "el acierto tarde no le da derecho a nadie");
  ok(M.posicionesAtacablesDe(tarde, 2).length === 0, "ni aparece en la lista de posiciones");
}

// =====================================================================
console.log("\n=== 3. El derecho se invalida solo cuando la carta cambia ===");
// =====================================================================

{
  const inicial = mesa({
    muestra: 7,
    manos: [
      [carta("a0", 9), carta("a1", 3)],
      [carta("b0", 4)],
      [carta("c0", 6)],
    ],
  });

  const tras = M.intentarDescarte(inicial, 0, 1);
  ok(M.puedeAtacarEn(tras, 1, 0, 1), "J1 tiene el derecho");

  /**
   * Otra carta en esa posición mata el recuerdo, sin que nadie lo borre.
   *
   * Se simula poniendo una carta distinta donde estaba. Da igual cómo llegó
   * —un 9, un 10, un descarte, otro fallo—: lo que decide es que el `id` no
   * coincide con el que se vio.
   */
  const cambiada = {
    ...tras,
    jugadores: tras.jugadores.map((j, i) =>
      i === 0 ? { ...j, mano: j.mano.map((c, p) => (p === 1 ? carta("zz", 3) : c)) } : j,
    ),
  };
  ok(!M.puedeAtacarEn(cambiada, 1, 0, 1), "con otra carta ahí, el derecho se fue");

  // Y un hueco tampoco vale: no hay nada que descartar.
  const vaciada = {
    ...tras,
    jugadores: tras.jugadores.map((j, i) =>
      i === 0 ? { ...j, mano: j.mano.map((c, p) => (p === 1 ? null : c)) } : j,
    ),
  };
  ok(!M.puedeAtacarEn(vaciada, 1, 0, 1), "y sobre un hueco tampoco");

  // La MISMA carta sigue valiendo: no se invalida por cualquier cosa.
  ok(M.puedeAtacarEn(tras, 1, 0, 1), "mientras la carta siga ahí, el derecho vale");
}

// =====================================================================
console.log("\n=== 4. Un fallo nuevo en la misma posición da un derecho nuevo ===");
// =====================================================================

{
  const inicial = mesa({
    muestra: 7,
    manos: [
      [carta("a0", 9), carta("a1", 3)],
      [carta("b0", 4)],
      [carta("c0", 6)],
    ],
  });

  const uno = M.intentarDescarte(inicial, 0, 1);
  ok(M.puedeAtacarEn(uno, 1, 0, 1), "derecho sobre la primera");

  // Se le cambia la carta de esa posición y vuelve a fallar ahí.
  const conOtra = {
    ...uno,
    jugadores: uno.jugadores.map((j, i) =>
      i === 0 ? { ...j, mano: j.mano.map((c, p) => (p === 1 ? carta("a9", 2) : c)) } : j,
    ),
  };
  ok(!M.puedeAtacarEn(conOtra, 1, 0, 1), "que se invalida al cambiar la carta");

  const dos = M.intentarDescarte(conOtra, 0, 1);
  ok(M.puedeAtacarEn(dos, 1, 0, 1), "y el fallo nuevo da un derecho nuevo");

  // Lo que se sabe es de cartas: la vieja ya no está en ninguna mano y su
  // recuerdo se borró; la nueva queda una sola vez.
  const deJ1 = (dos.conocimientos ?? []).filter((c) => c.actor === 1);
  ok(!deJ1.some((c) => c.idCarta === "a1"),
     "el recuerdo de la carta que ya no está se borró", deJ1);
  ok(deJ1.filter((c) => c.idCarta === "a9").length === 1,
     "y la que se vio último queda una sola vez", deJ1);
}

// =====================================================================
console.log("\n=== 5. Con el derecho, el ataque se puede hacer ===");
// =====================================================================

{
  /**
   * La mitad que importa: el permiso sirve para algo.
   *
   * `intentarDescarteRival` rechazaba sin conocimiento; ahora acepta los dos
   * derechos, el de mano entera y el de posición.
   */
  const inicial = mesa({
    muestra: 3,
    manos: [
      [carta("a0", 9), carta("a1", 3)],
      [carta("b0", 4), carta("b1", 8)],
      [carta("c0", 6)],
    ],
  });

  // J0 falla su 3 contra una muestra de... 3. Para que falle, la muestra tiene
  // que ser otra: se arma con un 9 arriba.
  const conNueve = { ...inicial, descarte: [{ id: "d9", numero: 9, palo: "copa", visible: true }] };
  const tras = M.intentarDescarte(conNueve, 0, 1);
  const ultimo = tras.ventanaDescarte.intentos.at(-1);
  ok(ultimo?.resultado === "error", "J0 falló", ultimo?.resultado);

  // Ahora la muestra vuelve a ser un 3 y J1 le descarta esa carta.
  const paraAtacar = { ...tras, descarte: [{ id: "d3", numero: 3, palo: "copa", visible: true }] };
  const atacado = M.intentarDescarteRival(paraAtacar, 1, 0, 1, 0);

  ok(atacado !== paraAtacar, "el ataque se aplicó");
  ok(atacado.jugadores[0].mano[1]?.id === "b0",
     "la carta entregada ocupó el lugar", atacado.jugadores[0].mano[1]);
  ok(atacado.descarte[0]?.id === "a1", "y la fallada se fue al descarte", atacado.descarte[0]?.id);
}

{
  // Y sin derecho sigue sin poder: el agujero se tapó, no se abrió de par en par.
  const inicial = mesa({
    muestra: 3,
    manos: [
      [carta("a0", 9), carta("a1", 3)],
      [carta("b0", 4)],
      [carta("c0", 6)],
    ],
  });

  const sinDerecho = M.intentarDescarteRival(inicial, 1, 0, 1, 0);
  ok(sinDerecho === inicial, "sin conocimiento, el ataque no hace nada");
}

// =====================================================================
console.log("\n=== 6. El acierto tarde no engorda la muestra ===");
// =====================================================================

{
  /**
   * EL ESCENARIO QUE SE REPORTÓ, TAL CUAL PASÓ EN UNA PARTIDA.
   *
   * Había un 4 en la muestra. Un rival descartó su 4 correctamente. Yo
   * descarté el mío tarde. El sistema me dio una carta nueva —bien— pero
   * ADEMÁS dejó mi descarte apilado en la muestra.
   *
   * Eso importa porque la muestra es lo que decide qué se puede descartar
   * después: una carta que nadie ganó cambiaba el estado del juego para los
   * cuatro.
   *
   * La regla nueva: sólo el primero se salva. El que llega tarde conserva su
   * carta y recibe una de castigo, y la muestra no se toca.
   */
  const inicial = mesa({
    muestra: 4,
    manos: [[carta("a0", 4)], [carta("b0", 4)], [carta("c0", 9)]],
  });

  const muestraAntes = inicial.descarte.length;

  // J1 llega primero.
  const primero = M.intentarDescarte(inicial, 1, 0);
  ok(primero.jugadores[1].mano[0] === null, "al primero se le va la carta");
  ok(primero.descarte.length === muestraAntes + 1, "y la muestra crece con la suya");
  ok(primero.descarte[0].id === "b0", "que pasa a ser la muestra", primero.descarte[0]?.id);

  // J0 llega tarde con el mismo número.
  const tarde = M.intentarDescarte(primero, 0, 0);
  ok(tarde.ventanaDescarte.intentos.at(-1)?.resultado === "tarde", "J0 acierta tarde");

  ok(tarde.jugadores[0].mano[0]?.id === "a0", "el tardío CONSERVA su carta");
  ok(tarde.jugadores[0].mano.filter(Boolean).length === 2,
     "y recibe una de castigo: queda con dos",
     tarde.jugadores[0].mano.filter(Boolean).length);

  ok(tarde.descarte.length === primero.descarte.length,
     "LA MUESTRA NO CRECIÓ con el descarte tardío",
     { antes: primero.descarte.length, despues: tarde.descarte.length });
  ok(tarde.descarte[0].id === "b0",
     "y la muestra sigue siendo la del primero", tarde.descarte[0]?.id);
}

{
  /**
   * El escalón completo, medido en cartas.
   *
   *   primero: se va su carta, y pasa a ser la muestra.
   *   tarde:   conserva la suya y suma una; la muestra no cambia.
   *   error:   conserva la suya y suma una, Y la mesa gana el derecho.
   *
   * Tarde y error cuestan lo mismo en cartas: lo que los separa es el derecho,
   * y por eso `recordarFallo` corre sólo con el error.
   */
  const inicial = mesa({
    muestra: 5,
    manos: [[carta("a0", 5)], [carta("b0", 5)], [carta("c0", 9)]],
  });

  const conPrimero = M.intentarDescarte(inicial, 0, 0);
  const conTarde = M.intentarDescarte(conPrimero, 1, 0);
  const conError = M.intentarDescarte(conTarde, 2, 0);

  const cuantas = (s, i) => s.jugadores[i].mano.filter(Boolean).length;

  ok(cuantas(conError, 0) === 0, "primero: se queda sin cartas", cuantas(conError, 0));
  ok(cuantas(conError, 1) === 2, "tarde: suma una", cuantas(conError, 1));
  ok(cuantas(conError, 2) === 2, "error: suma una también", cuantas(conError, 2));

  // Y el derecho separa a los dos últimos.
  ok(!M.puedeAtacarEn(conError, 0, 1, 0), "al tardío no se le puede atacar");
  ok(M.puedeAtacarEn(conError, 0, 2, 0), "al que falló, sí");
}

console.log(fallos ? `\n❌ ${fallos} fallos` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
