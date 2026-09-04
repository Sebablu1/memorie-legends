/**
 * Dos cosas que se reportaron como rotas: a quién le toca después de un
 * descarte, y qué pasa con las cartas al acertarle a un rival.
 *
 * Se escribe antes de tocar nada. Si el motor ya hace lo correcto, esta prueba
 * lo demuestra y el problema está en otro lado —la pantalla, o lo que se
 * esperaba— y no en las reglas. Arreglar lo que no está roto es la forma más
 * cara de no arreglar nada.
 */

import * as M from "../public/js/reglas/motor.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

const CUATRO = [
  { id: "h0", nombre: "Vos", esIA: false },
  { id: "ia0", nombre: "Nara", esIA: true, dificultad: "medio" },
  { id: "ia1", nombre: "Bruno", esIA: true, dificultad: "medio" },
  { id: "ia2", nombre: "Vex", esIA: true, dificultad: "medio" },
];

/** Cuántas cartas tiene cada uno, contando sólo las que están. */
const manos = (e) => e.jugadores.map((j) => j.mano.filter(Boolean).length);

// =====================================================================
console.log("\n=== 1. El turno avanza, y avanza UNA vez ===");
// =====================================================================

{
  let e = M.empezarRonda(M.crearPartida(CUATRO, { semilla: 4242 }));
  e = { ...e, fase: "postLevantada", indiceTurno: 0 };

  const despues = M.pasarTurno(e);
  ok(despues.indiceTurno === 1, "de 0 pasa a 1", despues.indiceTurno);
  ok(despues.fase === "turno", "y queda en fase de turno", despues.fase);

  // Dar la vuelta entera y volver al principio: cuatro pases, cuatro jugadores.
  let vuelta = { ...e, indiceTurno: 3 };
  ok(M.pasarTurno(vuelta).indiceTurno === 0, "del último vuelve al primero");

  // Y que no se salte a nadie ni repita.
  const recorrido = [];
  let x = { ...e, indiceTurno: 0 };
  for (let i = 0; i < 4; i++) {
    x = M.pasarTurno({ ...x, fase: "postLevantada" });
    recorrido.push(x.indiceTurno);
  }
  ok(
    JSON.stringify(recorrido) === "[1,2,3,0]",
    "una vuelta completa sin saltear ni repetir",
    recorrido,
  );
}

{
  // Con eliminados en el medio, se los saltea.
  let e = M.empezarRonda(M.crearPartida(CUATRO, { semilla: 7 }));
  e = {
    ...e,
    fase: "postLevantada",
    indiceTurno: 0,
    jugadores: e.jugadores.map((j, i) => (i === 1 || i === 2 ? { ...j, eliminado: true } : j)),
  };
  ok(M.pasarTurno(e).indiceTurno === 3, "saltea a los eliminados", M.pasarTurno(e).indiceTurno);
}

{
  // El caso que colgaría el juego: si sólo queda uno, no puede buscar
  // eternamente a quién pasarle.
  let e = M.empezarRonda(M.crearPartida(CUATRO, { semilla: 11 }));
  e = {
    ...e,
    fase: "postLevantada",
    indiceTurno: 2,
    jugadores: e.jugadores.map((j, i) => (i === 2 ? j : { ...j, eliminado: true })),
  };
  ok(M.pasarTurno(e).indiceTurno === 2, "con un solo jugador activo se queda en él, sin colgarse");
}

// =====================================================================
console.log("\n=== 2. Cerrar la ventana de descarte no cambia de quién es el turno ===");
// =====================================================================

{
  // La ventana de la ronda: al cerrarse, la mesa entra en el ciclo de turnos
  // por donde le toca a la mano, sin importar quién descartó.
  let e = M.empezarRonda(M.crearPartida(CUATRO, { semilla: 4242 }));
  const deQuienEra = e.indiceTurno;

  e = M.intentarDescarte(e, 2, 0); // descarta el jugador 2, no el de mano
  const cerrada = M.cerrarVentanaDescarte(e);

  ok(cerrada.fase === "turno", "la ventana de la ronda vuelve a 'turno'", cerrada.fase);
  ok(
    cerrada.indiceTurno === deQuienEra,
    "y el turno sigue siendo del que le tocaba, no del que descartó",
    { era: deQuienEra, quedo: cerrada.indiceTurno },
  );
}

// =====================================================================
console.log("\n=== 3. Acertarle a un rival: quién pierde y quién gana cartas ===");
// =====================================================================

{
  // Se arma el caso a mano: el jugador 0 sabe que el 1 tiene un 5, y la
  // muestra es un 5. Con eso el ataque puede acertar.
  let e = M.empezarRonda(M.crearPartida(CUATRO, { semilla: 4242 }));

  const cinco = { numero: 5, palo: "copa", imagen: "", visible: false };
  const mia = { numero: 12, palo: "espada", imagen: "", visible: false };

  e = {
    ...e,
    fase: "descarte",
    ventanaDescarte: { abiertaEn: Date.now(), duracionMs: 5000, graciaMs: 0, intentos: [], huboPrimero: false },
    descarte: [{ ...cinco, visible: true }],
    conocimientos: [{ actor: 0, objetivo: 1, numero: 5, origen: "poder", ronda: 1 }],
    jugadores: e.jugadores.map((j, i) =>
      i === 0 ? { ...j, mano: [mia, { ...mia }, { ...mia }, { ...mia }] }
        : i === 1 ? { ...j, mano: [{ ...mia }, cinco, { ...mia }, { ...mia }] }
        : j,
    ),
  };

  const antes = manos(e);
  ok(JSON.stringify(antes.slice(0, 2)) === "[4,4]", "los dos arrancan con cuatro", antes);

  // Acierta: apunta a la posición 1 del rival, que es donde está el 5.
  const acierto = M.intentarDescarteRival(e, 0, 1, 1, 2);
  const d = manos(acierto);

  ok(d[0] === 3, "AL ACERTAR: mi mano baja de 4 a 3", d[0]);
  ok(d[1] === 4, "la del rival sigue en 4: se le va una y le entra la mía", d[1]);
  ok(
    acierto.jugadores[0].mano[2] === null,
    "la carta que entregué ya no está en mi mano",
    acierto.jugadores[0].mano[2],
  );
  ok(
    acierto.jugadores[1].mano[1]?.numero === 12,
    "y está en la mano del rival, en el lugar exacto de la suya",
    acierto.jugadores[1].mano[1]?.numero,
  );
  ok(
    acierto.descarte[0]?.numero === 5,
    "la carta del rival quedó de muestra en el descarte",
    acierto.descarte[0]?.numero,
  );
  ok(
    !acierto.jugadores[1].mano[1].visible,
    "boca abajo: ni quien la entregó sabe cuál era",
  );

  // Falla: apunta a una posición donde no está el 5.
  const error = M.intentarDescarteRival(e, 0, 1, 0, 2);
  const f = manos(error);
  ok(f[0] === 5, "AL FALLAR: recibo una carta de castigo (4 -> 5)", f[0]);
  ok(f[1] === 4, "y la mano del rival no se toca", f[1]);
  ok(
    error.jugadores[0].mano[2]?.numero === 12,
    "no entregué nada: mi carta sigue donde estaba",
  );
}

console.log(fallos ? `\n❌ ${fallos} fallos` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
