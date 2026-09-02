/**
 * Al que le cambian una carta que conocía, aprende algo.
 *
 * LA REGLA
 *
 * Si un jugador sabía qué carta tenía en una posición —la miró al principio de
 * la ronda, o con un poder 7— y alguien se la lleva con un 9 o un 10, ahora
 * sabe en qué mano está. Eso es conocimiento ganado con los ojos, igual que el
 * de cualquier poder, y da el mismo derecho: puede ir a buscársela en la
 * ventana de descarte.
 *
 * POR QUÉ HAY QUE PROBAR LO QUE **NO** PASA
 *
 * Lo delicado no es agregar el conocimiento; es no agregarlo cuando no
 * corresponde. Un derecho a atacar que no se ganó es una ventaja regalada, y
 * hay tres formas de regalarlo sin darse cuenta:
 *
 *   - dárselo a quien NUNCA supo qué tenía ahí;
 *   - dárselo a quien lo supo pero YA NO, porque en el medio le cambiaron esa
 *     carta otra vez;
 *   - dárselo cuando el 10 termina en "no cambio", donde no se movió nada.
 *
 * El recuerdo propio guarda el `id` de la carta y se valida contra la que hay
 * en la mano en ese momento. Eso es lo que hace que el segundo caso se resuelva
 * solo, sin tener que limpiar el recuerdo en cada función que mueve cartas.
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

/** La mesa con el poder de X preparado sobre Y. */
const conPoder = (tipo, numero) => ({
  ...mesa(),
  poderPendiente: { tipo, numero, indiceJugador: 0 },
});

/** Y mira su propia carta de la posición `pos`, como en la fase de mirada. */
const yMiroLaSuya = (s, pos) => M.mirar(s, 1, pos);

const saberDe = (s, actor, objetivo) =>
  (s.conocimientos ?? []).filter((c) => c.actor === actor && c.objetivo === objetivo);

// ============================================== 1. el 9, a ciegas para uno

console.log("\n=== 1. El 9: quien lo usa va a ciegas, quien lo sufre no ===");
{
  // Y había mirado su posición 1: un 5 de basto.
  const s = yMiroLaSuya(conPoder("cambioCiego", 9), 1);
  ok(M.objetivosDe(s, 1).length === 0, "antes del cambio, Y no puede atacar a nadie");

  // X le cambia justo esa.
  const r = M.usarPoderCambio(s, 0, 1, 1);

  ok(r.estado.jugadores[0].mano[0].numero === 5, "la carta que Y conocía pasó a la mano de X");

  const aprendido = saberDe(r.estado, 1, 0);
  ok(aprendido.length === 1, "y Y queda sabiendo algo de X", r.estado.conocimientos);
  ok(aprendido[0]?.numero === 5, "el número que había memorizado", aprendido[0]?.numero);
  ok(aprendido[0]?.origen === "cambio", "con origen 'cambio'", aprendido[0]?.origen);
  ok(M.objetivosDe(r.estado, 1).includes(0), "y ahora puede atacar a X");

  // El 9 es ciego para quien lo usa: X no vio nada, así que no gana nada.
  ok(saberDe(r.estado, 0, 1).length === 0,
     "X, que cambió a ciegas, sigue sin saber nada de Y", saberDe(r.estado, 0, 1));
}

// ============================================== 2. sin saber, no hay nada

console.log("\n=== 2. Si la víctima no sabía qué tenía, no aprende nada ===");
{
  // Y miró la posición 0, pero le cambian la 1.
  const s = yMiroLaSuya(conPoder("cambioCiego", 9), 0);
  const r = M.usarPoderCambio(s, 0, 1, 1);

  ok(saberDe(r.estado, 1, 0).length === 0,
     "no se le regala un conocimiento que no ganó", saberDe(r.estado, 1, 0));
  ok(M.objetivosDe(r.estado, 1).length === 0, "y sigue sin poder atacar a nadie");
  ok(!r.estado.registro.some((l) => l.tipo === "supoPorCambio"),
     "ni se anuncia nada que no pasó");
}

// ============================================== 3. el recuerdo que caducó

console.log("\n=== 3. Un recuerdo viejo no vale ===");
{
  // Y mira su posición 1 (un 5). Después Z se la cambia con un 9, así que lo
  // que Y cree tener ahí ya no es cierto. Y RECIÉN ENTONCES X se la cambia.
  //
  // Si el recuerdo no se validara contra la carta que hay, Y saldría de acá
  // creyendo —y el juego confirmándole— que X tiene un 5. X no tiene un 5: lo
  // tiene Z desde hace dos jugadas.
  let s = yMiroLaSuya(conPoder("cambioCiego", 9), 1);

  const deZ = M.usarPoderCambio(
    { ...s, poderPendiente: { tipo: "cambioCiego", numero: 9, indiceJugador: 2 } },
    0, 1, 1,
  );
  ok(deZ.estado.jugadores[1].mano[1].numero === 11,
     "Z ya le cambió esa carta a Y", deZ.estado.jugadores[1].mano[1].numero);

  const r = M.usarPoderCambio(
    { ...deZ.estado, fase: "poder", poderPendiente: { tipo: "cambioCiego", numero: 9, indiceJugador: 0 } },
    0, 1, 1,
  );

  // Y no aprende nada, y está bien que así sea. Cuando Z le cambió la carta,
  // Y no vio la que recibía —el 9 es ciego para los dos lados salvo por esta
  // misma regla, que no se aplica en cadena— así que llegó a este segundo
  // cambio sin saber qué tenía ahí. Lo único que conserva es un recuerdo de
  // una carta que hace rato no es suya, y ese recuerdo no vale.
  ok(saberDe(r.estado, 1, 0).length === 0,
     "Y no aprende un número que ya no era el suyo", saberDe(r.estado, 1, 0));
  ok(!(r.estado.conocimientos ?? []).some((c) => c.actor === 1 && c.objetivo === 0 && c.numero === 5),
     "y en particular NO cree que X tenga el 5 que él recordaba");
}

// ============================================== 4. el 10 que sí cambia

console.log("\n=== 4. El 10, cuando decide cambiar ===");
{
  const s = yMiroLaSuya(conPoder("cambioConVista", 10), 1);
  const abierto = M.usarPoderCambio(s, 0, 1, 1);
  ok(abierto.estado.fase === "cambioConVista", "el 10 se detiene a esperar la decisión");
  ok(saberDe(abierto.estado, 1, 0).length === 0,
     "y mientras espera, la víctima todavía no aprendió nada: no se movió ninguna carta");

  const r = M.resolverCambioConVista(abierto.estado, true);

  const aprendido = saberDe(r, 1, 0);
  ok(aprendido.length === 1, "hecho el cambio, Y sabe algo de X", r.conocimientos);
  ok(aprendido[0]?.numero === 5 && aprendido[0]?.origen === "cambio",
     "el número que conocía, con origen 'cambio'", aprendido[0]);
  ok(M.objetivosDe(r, 1).includes(0), "y puede atacarlo");

  // Y el conocimiento del que usó el poder sigue siendo el suyo, sin mezclarse.
  ok(saberDe(r, 0, 1).some((c) => c.origen === "poder10"),
     "X conserva el suyo, del 10", saberDe(r, 0, 1));
}

// ============================================== 5. el 10 que no cambia

console.log("\n=== 5. El 10, cuando decide NO cambiar ===");
{
  const s = yMiroLaSuya(conPoder("cambioConVista", 10), 1);
  const abierto = M.usarPoderCambio(s, 0, 1, 1);
  const r = M.resolverCambioConVista(abierto.estado, false);

  ok(r.jugadores[1].mano[1].numero === 5, "la carta de Y no se movió");
  ok(saberDe(r, 1, 0).length === 0,
     "así que Y no aprende nada: no le sacaron nada", saberDe(r, 1, 0));
  ok(!r.registro.some((l) => l.tipo === "supoPorCambio"), "ni se anuncia nada");
}

// ============================================== 6. lo que ve la mesa

console.log("\n=== 6. La mesa se entera de que aprendió, no de QUÉ ===");
{
  const s = yMiroLaSuya(conPoder("cambioCiego", 9), 1);
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
  const s = yMiroLaSuya(conPoder("cambioCiego", 9), 1);
  const r = M.usarPoderCambio(s, 0, 1, 1);

  // Se mira la vista de los tres. El detector de filtraciones caza cualquier
  // objeto con actor + objetivo + numero, así que los recuerdos propios —que
  // tienen la MISMA forma, a propósito— quedan cubiertos por él sin escribir
  // una regla nueva.
  for (let i = 0; i < 3; i++) {
    const vista = V.vistaDe(r.estado, i);
    // El estado completo va como segundo argumento: el detector compara lo
    // publicado contra lo que realmente hay, no sólo contra sí mismo.
    const problemas = V.filtracionesEn(vista, r.estado);
    ok(problemas.length === 0, `la vista de ${"XYZ"[i]} no filtra nada`, problemas);
  }

  // Lo único que viaja es el permiso.
  ok(V.vistaDe(r.estado, 1).puedeAtacar.includes(0),
     "Y ve que puede atacar a X", V.vistaDe(r.estado, 1).puedeAtacar);
  ok(!V.vistaDe(r.estado, 2).puedeAtacar.includes(0),
     "y Z, que no aprendió nada, no", V.vistaDe(r.estado, 2).puedeAtacar);
}

// ============================================== 8. el 7 alimenta la regla

console.log("\n=== 8. También sirve lo que se vio con un 7 ===");
{
  // Y usa un 7 sobre su propia posición 3 (un 9 de basto).
  const conSuPoder = {
    ...mesa(),
    poderPendiente: { tipo: "mirarPropia", numero: 7, indiceJugador: 1 },
  };
  const miro = M.usarPoderMirar(conSuPoder, 1, 3);
  ok(miro.revelada?.carta?.numero === 9, "Y ve su carta", miro.revelada?.carta?.numero);
  ok(M.objetivosDe(miro.estado, 1).length === 0, "y eso no lo autoriza contra nadie");

  // Ahora X se la lleva.
  const r = M.usarPoderCambio(
    { ...miro.estado, fase: "poder", poderPendiente: { tipo: "cambioCiego", numero: 9, indiceJugador: 0 } },
    2, 1, 3,
  );

  const aprendido = saberDe(r.estado, 1, 0);
  ok(aprendido[0]?.numero === 9, "lo que vio con el 7 también cuenta", aprendido);
  ok(M.objetivosDe(r.estado, 1).includes(0), "y ahora sí puede atacar a X");
}

// ============================================== 9. el saber se puede usar

console.log("\n=== 9. El derecho nuevo sirve de verdad en la ventana ===");
{
  // La prueba de que esto no es un adorno: Y va y le descarta la carta a X.
  const s = yMiroLaSuya(conPoder("cambioCiego", 9), 1);
  const tras = M.usarPoderCambio(s, 0, 1, 1);

  // La muestra es un 5 y X tiene el 5 de Y en su posición 0.
  const enVentana = {
    ...tras.estado,
    fase: "descarte",
    ventanaDescarte: { huboPrimero: false, intentos: [] },
  };
  ok(M.puedeAtacarA(enVentana, 1, 0), "Y está habilitado a buscar en la mano de X");

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
