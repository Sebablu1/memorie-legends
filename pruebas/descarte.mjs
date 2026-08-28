/**
 * El ejemplo A, B, C del reglamento, tal cual.
 *
 *   Muestra: 6
 *   A descarta un 6 y es el primero  → se la saca, sin castigo
 *   B descarta un 6 pero llega tarde → se ve 2 segundos y se va; recibe una más
 *   C descarta un 3, incorrecto      → se ve 2 segundos, vuelve a su posición,
 *                                      y recibe una más
 *
 * Las tres salidas quedan graduadas: -1 carta, 0 neto, +1 carta. Y de lo que
 * se destapó no queda ninguna marca: sólo la memoria de cada uno.
 */
import * as M from "../public/js/reglas/motor.js";
import * as V from "../public/js/reglas/vista.js";

let fallos = 0;
const ok = (c, m, x) => { if (c) console.log("  ✓", m); else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); } };

const carta = (palo, numero) => ({ id: `${palo}-${numero}`, palo, numero, puntos: numero });

function mesaDePrueba() {
  const s = M.empezarRonda(M.crearPartida([
    { id: "A", nombre: "A" }, { id: "B", nombre: "B" }, { id: "C", nombre: "C" },
  ]));

  // Manos armadas a mano: la posición 0 es la que cada uno va a jugar.
  const manos = [
    [carta("Basto", 6), carta("Copa", 2), carta("Copa", 4), carta("Copa", 7)],
    [carta("Espada", 6), carta("Basto", 2), carta("Basto", 4), carta("Basto", 7)],
    [carta("Oro", 3), carta("Espada", 2), carta("Espada", 4), carta("Espada", 7)],
  ];
  const muestra = { ...carta("Copa", 6), visible: true };

  // Sin esto el mazo conservaría copias de las cartas repartidas y el detector
  // de filtraciones las señalaría, con razón: no puede haber dos iguales.
  const usadas = new Set([muestra.id, ...manos.flat().map((c) => c.id)]);

  return {
    ...s,
    fase: "descarte",
    ventanaDescarte: { huboPrimero: false, intentos: [] },
    descarte: [muestra],
    mazo: s.mazo.filter((c) => !usadas.has(c.id)),
    jugadores: s.jugadores.map((j, i) => ({ ...j, mano: manos[i] })),
  };
}

const cuenta = (s, i) => s.jugadores[i].mano.filter(Boolean).length;

console.log("\n=== El ejemplo A, B, C ===");
let s = mesaDePrueba();
ok([0, 1, 2].every((i) => cuenta(s, i) === 4), "los tres arrancan con 4 cartas");
ok(s.descarte[0].numero === 6, "la muestra es un 6");

s = M.intentarDescarte(s, 0, 0);
ok(s.ventanaDescarte.intentos.at(-1).resultado === "primero", "A es el primero");
ok(cuenta(s, 0) === 3, "A queda con 3: se sacó la carta de encima", cuenta(s, 0));
ok(s.jugadores[0].mano[0] === null, "su posición 0 queda vacía");
ok(s.descarte[0].id === "Basto-6", "su 6 quedó arriba del descarte", s.descarte[0].id);

s = M.intentarDescarte(s, 1, 0);
ok(s.ventanaDescarte.intentos.at(-1).resultado === "tarde", "B llega tarde");
ok(s.jugadores[1].mano[0] === null, "B también se saca la carta de encima");
ok(cuenta(s, 1) === 4, "B queda con 4: se fue una y entró la de castigo", cuenta(s, 1));
ok(s.descarte[0].id === "Espada-6", "su 6 sí llegó al descarte", s.descarte[0].id);

s = M.intentarDescarte(s, 2, 0);
ok(s.ventanaDescarte.intentos.at(-1).resultado === "error", "C se equivoca");
ok(s.jugadores[2].mano[0]?.id === "Oro-3", "C conserva su 3 en su posición");
ok(cuenta(s, 2) === 5, "C queda con 5", cuenta(s, 2));
ok(!("infoPublica" in s), "no existe ningún registro permanente de exposiciones");

console.log("\n=== La revelación es efímera y la ven todos ===");
const reveladas = V.revelacionesDe(s);
ok(reveladas.length === 2, "se destapan dos cartas: la de B y la de C", reveladas.length);
ok(reveladas.every((r) => r.carta), "las dos vienen con su carta");
ok(!reveladas.some((r) => r.indiceJugador === 0), "la de A no se destapa: ya está en el descarte");

for (const quien of [0, 1, 2]) {
  const v = V.vistaDe(s, quien);
  ok(v.jugadores[1].mano[0]?.id === "Espada-6",
     `el jugador ${quien} ve la carta de B en su hueco`, v.jugadores[1].mano[0]);
  ok(v.jugadores[2].mano[0]?.id === "Oro-3",
     `el jugador ${quien} ve la carta de C`, v.jugadores[2].mano[0]);
  ok(V.filtracionesEn(v, s).length === 0, `y sin filtrar nada más (jugador ${quien})`);
}

console.log("\n=== Al cerrarse la ventana no queda rastro ===");
const cerrado = M.cerrarVentanaDescarte(s);
ok(V.revelacionesDe(cerrado).length === 0, "no queda ninguna revelación");
for (const quien of [0, 1, 2]) {
  const v = V.vistaDe(cerrado, quien);
  ok(v.revelaciones.length === 0, `la vista del jugador ${quien} no trae revelaciones`);
  ok(v.jugadores[1].mano[0] === null, "el lugar de B vuelve a ser un hueco");
  ok(v.jugadores[2].mano[0]?.oculta === true, "la carta de C vuelve a estar tapada");
  ok(V.filtracionesEn(v, cerrado).length === 0, `sin filtraciones (jugador ${quien})`);
}

console.log("\n  jugador | resultado | cartas | conserva su carta");
console.log(`     A    | primero   |   ${cuenta(s, 0)}    | no, se descartó`);
console.log(`     B    | tarde     |   ${cuenta(s, 1)}    | no, pero recibe una de castigo`);
console.log(`     C    | error     |   ${cuenta(s, 2)}    | sí, más una de castigo`);

console.log("\n=== Sólo hay un primero por ronda ===");
let t = mesaDePrueba();
t = M.intentarDescarte(t, 0, 0);
t = M.intentarDescarte(t, 1, 0);
t = M.intentarDescarte(t, 2, 1); // Copa-2, no coincide
const resultados = t.ventanaDescarte.intentos.map((i) => i.resultado);
ok(resultados.filter((r) => r === "primero").length === 1, "un solo 'primero'", resultados);
ok(t.ventanaDescarte.huboPrimero === true, "queda marcado que ya hubo primero");

console.log("\n=== La carta que no coincide nunca llega al descarte ===");
let u = mesaDePrueba();
const cimaAntes = u.descarte[0].id;
u = M.intentarDescarte(u, 2, 0); // C se equivoca sin que nadie haya acertado
ok(u.descarte[0].id === cimaAntes, "la muestra sigue siendo la misma", u.descarte[0].id);
ok(u.descarte.length === 1, "el descarte no creció");

console.log("\n=== Descartar una posición vacía no hace nada ===");
let v = mesaDePrueba();
v = M.intentarDescarte(v, 0, 0);
const antes = JSON.stringify(v.jugadores[0].mano);
v = M.intentarDescarte(v, 0, 0);
ok(JSON.stringify(v.jugadores[0].mano) === antes, "la mano queda igual");

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
