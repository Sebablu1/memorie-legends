/**
 * Pruebas de la economía de salas: entradas, pozo, reparto, abandono,
 * validación de ingreso y códigos.
 */
import * as S from "../public/js/reglas/salas.js";

let fallos = 0;
const ok = (c, m, x) => { if (c) console.log("  ✓", m); else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); } };
const sala = (extra = {}) => ({ modo: "leyendas", entrada: 100, estado: "esperando", jugadores: [], maxJugadores: 4, ...extra });

console.log("\n=== Entradas ===");
ok(S.ENTRADAS.join() === "5,10,15,20,25,50,100,200,500", "las nueve entradas del pliego");
ok(S.esEntradaValida(100) && !S.esEntradaValida(7), "sólo se aceptan las entradas definidas");

console.log("\n=== Pozo ===");
ok(S.calcularPozo(100, 4) === 400, "4 × 100 = 400");
ok(S.calcularPozo(50, 4) === 200, "4 × 50 = 200");
ok(S.calcularPozo(25, 4) === 100, "4 × 25 = 100");
ok(S.calcularPozo(5, 2) === 10, "2 × 5 = 10");
try { S.calcularPozo(100, 5); ok(false, "rechaza 5 jugadores"); } catch { ok(true, "rechaza 5 jugadores"); }
try { S.calcularPozo(100, 1); ok(false, "rechaza 1 jugador"); } catch { ok(true, "rechaza 1 jugador"); }
try { S.calcularPozo(7, 4); ok(false, "rechaza entrada inválida"); } catch { ok(true, "rechaza entrada inválida"); }

console.log("\n=== Reparto 75 / 25 ===");
for (const [pozo, p1, p2] of [[400, 300, 100], [200, 150, 50], [100, 75, 25]]) {
  const { premios } = S.repartirPozo(pozo);
  ok(premios.primero === p1 && premios.segundo === p2, `pozo ${pozo} → ${p1} / ${p2}`, premios);
}
ok(S.repartirPozo(400).premios.tercero === 0 && S.repartirPozo(400).premios.cuarto === 0, "tercero y cuarto cobran 0");

console.log("\n=== El reparto nunca supera el pozo (todas las combinaciones) ===");
let peor = null, exactos = 0, total = 0;
for (const entrada of S.ENTRADAS) {
  for (let n = S.MIN_JUGADORES; n <= S.MAX_JUGADORES; n++) {
    const pozo = S.calcularPozo(entrada, n);
    const { premios, repartido, sobrante } = S.repartirPozo(pozo);
    total++;
    if (repartido > pozo) peor = { entrada, n, pozo, repartido };
    if (repartido === pozo) exactos++;
    if (!Number.isInteger(premios.primero) || !Number.isInteger(premios.segundo)) peor = { entrada, n, premios };
    if (sobrante !== 0) peor = { entrada, n, sobrante };
  }
}
ok(peor === null, `${total} combinaciones: premios enteros, suma exacta al pozo, cero sobrante`, peor);
ok(exactos === total, "no se pierde ni una Leyenda por redondeo");

console.log("\n=== Pozo indivisible ===");
const r15 = S.repartirPozo(15);
ok(r15.premios.primero === 11 && r15.premios.segundo === 4, "pozo 15 → 11 / 4 (el segundo cobra el resto)", r15.premios);
ok(r15.repartido === 15, "suma exacta");

console.log("\n=== Si sólo termina un jugador ===");
const solo = S.repartirPozo(400, 1);
ok(solo.premios.primero === 300 && solo.premios.segundo === 0, "el primero cobra su 75%", solo.premios);
ok(solo.sobrante === 100, "el 25% no repartido se informa como sobrante, no se inventa destino", solo.sobrante);

console.log("\n=== Penalización por abandono ===");
for (const [entrada, esperado] of [[10, 5], [20, 10], [50, 25], [100, 50], [500, 250], [200, 100]]) {
  ok(S.penalizacionAbandono(sala({ entrada })) === esperado, `entrada ${entrada} → ${esperado}`, S.penalizacionAbandono(sala({ entrada })));
}
ok(S.penalizacionAbandono(sala({ entrada: 5 })) === 2, "entrada 5 → 2 (la tabla dice 2,5; se redondea a favor del jugador)");
ok(S.penalizacionAbandono(sala({ entrada: 15 })) === 7, "entrada 15 → 7");
ok(S.penalizacionAbandono(sala({ entrada: 25 })) === 12, "entrada 25 → 12");

console.log("\n=== El entrenamiento no toca Leyendas ===");
const entreno = { modo: "entrenamiento", entrada: 100 };
ok(S.esEntrenamiento(entreno), "se reconoce como entrenamiento");
ok(!S.usaLeyendas(entreno), "no usa Leyendas aunque traiga entrada");
ok(S.penalizacionAbandono(entreno) === 0, "penalización 0");
ok(S.costoDeAbandonar(entreno).total === 0, "abandonar no cuesta nada");
ok(S.costoDeAbandonar(entreno).esEntrenamiento === true, "se marca como entrenamiento para la interfaz");
ok(!S.usaLeyendas({ modo: "leyendas", entrada: 7 }), "modo leyendas con entrada inválida tampoco cobra");
ok(!S.usaLeyendas({}), "una partida sin modo se trata como entrenamiento");

console.log("\n=== Costo de abandonar una partida por Leyendas ===");
const costo = S.costoDeAbandonar(sala({ entrada: 100 }));
ok(costo.entradaPerdida === 100 && costo.penalizacion === 50 && costo.total === 150,
   "entrada 100: pierde los 100 del pozo y paga 50 más = 150", costo);

console.log("\n=== Quién puede unirse ===");
ok(S.puedeUnirse(sala(), "ana", 100).puede, "sala vacía, saldo justo");
ok(!S.puedeUnirse(null, "ana", 999).puede, "sala inexistente");
ok(S.puedeUnirse(sala({ estado: "jugando" }), "ana", 999).motivo === S.RECHAZO.YA_EMPEZO, "partida ya empezada");
ok(S.puedeUnirse(sala({ estado: "cancelada" }), "ana", 999).motivo === S.RECHAZO.CANCELADA, "sala cancelada");
ok(S.puedeUnirse(sala({ estado: "terminada" }), "ana", 999).motivo === S.RECHAZO.TERMINADA, "sala terminada");
ok(S.puedeUnirse(sala({ jugadores: ["a", "b", "c", "d"] }), "ana", 999).motivo === S.RECHAZO.LLENA, "sala llena: el quinto no entra");
ok(S.puedeUnirse(sala({ jugadores: ["ana"] }), "ana", 999).motivo === S.RECHAZO.YA_ESTA, "no se entra dos veces");
ok(S.puedeUnirse(sala(), "ana", 99).motivo === S.RECHAZO.SIN_SALDO, "saldo insuficiente");
ok(S.puedeUnirse({ modo: "entrenamiento", estado: "esperando", jugadores: [] }, "ana", 0).puede, "el entrenamiento no exige saldo");
ok(S.puedeUnirse(sala({ maxJugadores: 9, jugadores: ["a","b","c","d"] }), "ana", 999).motivo === S.RECHAZO.LLENA,
   "el tope de 4 manda aunque la sala diga más");
ok(Object.values(S.RECHAZO).every((m) => S.MENSAJES_RECHAZO[m]), "todo rechazo tiene mensaje para el usuario");

console.log("\n=== Códigos de sala ===");
function mulberry32(a){return function(){a|=0;a=(a+0x6d2b79f5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296}}
const rng = mulberry32(99);
const vistos = new Set();
for (let i = 0; i < 20000; i++) vistos.add(S.generarCodigo(rng));
ok([...vistos].every((c) => c.length === S.LARGO_CODIGO), "todos de 5 caracteres");
ok([...vistos].every(S.esCodigoValido), "todos válidos");
ok(!/[IO01U]/.test([...vistos].join("")), "sin caracteres confusos (I, O, 0, 1, U)");
ok(vistos.size > 19900, `20.000 códigos, ${vistos.size} distintos: colisiones despreciables`, vistos.size);
ok(S.COMBINACIONES_CODIGO > 28_000_000, `${S.COMBINACIONES_CODIGO.toLocaleString("es-UY")} combinaciones posibles`);
ok(!S.esCodigoValido("ABC1") && !S.esCodigoValido("ABCDEF") && !S.esCodigoValido("ABCIO"), "rechaza largos y caracteres inválidos");

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
