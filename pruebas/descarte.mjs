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

/**
 * B acierta, pero tarde. Y sólo el primero se salva.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ESTA PARTE AFIRMABA LO CONTRARIO, Y CAMBIÓ LA REGLA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Antes el acierto tarde también sacaba la carta de la mano y la apilaba en
 * el descarte; el beneficio se compensaba con una de castigo, así que quedaba
 * neto cero. Tenía dos problemas.
 *
 * Uno visible: la muestra crecía con una carta que nadie ganó, y la muestra
 * es lo que decide qué se puede descartar después.
 *
 * Uno de fondo: llegar tarde cambiaba una carta conocida por una desconocida
 * sin costo neto, así que intentar siempre convenía.
 *
 * Ahora B se queda con su carta Y recibe una: neto +1, igual que fallar. Lo
 * que sigue distinguiendo al que falla es que su carta le da a los rivales el
 * derecho de descartársela — ver `pruebas/fallo-da-derecho.mjs`.
 */
s = M.intentarDescarte(s, 1, 0);
ok(s.ventanaDescarte.intentos.at(-1).resultado === "tarde", "B llega tarde");
ok(s.jugadores[1].mano[0]?.id === "Espada-6", "B CONSERVA su carta: sólo el primero se salva");
ok(cuenta(s, 1) === 5, "B queda con 5: la suya más la de castigo", cuenta(s, 1));
ok(s.descarte[0].id === "Basto-6", "y la muestra sigue siendo la de A", s.descarte[0].id);
ok(s.descarte.length === 2, "la muestra no creció con el descarte tardío", s.descarte.length);

s = M.intentarDescarte(s, 2, 0);
ok(s.ventanaDescarte.intentos.at(-1).resultado === "error", "C se equivoca");
ok(s.jugadores[2].mano[0]?.id === "Oro-3", "C conserva su 3 en su posición");
ok(cuenta(s, 2) === 5, "C queda con 5", cuenta(s, 2));
ok(!("infoPublica" in s), "no existe ningún registro permanente de exposiciones");

console.log("\n=== La revelación es efímera y la ven todos ===");
const reveladas = V.revelacionesDe(s);
ok(reveladas.length === 3, "se destapan tres cartas: la de B, la de C y el castigo de C", reveladas.length);
ok(reveladas.every((r) => r.carta), "las tres vienen con su carta");
ok(reveladas.filter((r) => r.indiceJugador === 1).length === 1,
   "B, que llegó tarde, muestra sólo la suya: su castigo va boca abajo");
ok(reveladas.filter((r) => r.indiceJugador === 2).length === 2,
   "C, que se equivocó, muestra la que falló y la de castigo");
ok(!reveladas.some((r) => r.indiceJugador === 0), "la de A no se destapa: ya está en el descarte");

for (const quien of [0, 1, 2]) {
  const v = V.vistaDe(s, quien);
  ok(v.jugadores[1].mano[0]?.id === "Espada-6",
     `el jugador ${quien} ve la carta de B, que sigue en su mano`, v.jugadores[1].mano[0]);
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
  // B llegó tarde, así que conserva su carta: al taparse vuelve a ser un
  // dorso, no un hueco. Antes acá quedaba `null` porque el acierto tarde se
  // llevaba la carta; ahora sólo el primero se salva.
  ok(v.jugadores[1].mano[0]?.oculta === true,
     "la carta de B vuelve a estar tapada, y sigue en su mano", v.jugadores[1].mano[0]);
  ok(v.jugadores[2].mano[0]?.oculta === true, "la carta de C vuelve a estar tapada");
  ok(V.filtracionesEn(v, cerrado).length === 0, `sin filtraciones (jugador ${quien})`);
}

console.log("\n  jugador | resultado | cartas | conserva su carta");
console.log(`     A    | primero   |   ${cuenta(s, 0)}    | no, se descartó`);
console.log(`     B    | tarde     |   ${cuenta(s, 1)}    | sí, más una de castigo`);
console.log(`     C    | error     |   ${cuenta(s, 2)}    | sí, más una de castigo, y queda expuesta`);

console.log("\n=== Sólo hay un primero por ronda ===");
let t = mesaDePrueba();
t = M.intentarDescarte(t, 0, 0);
t = M.intentarDescarte(t, 1, 0);
t = M.intentarDescarte(t, 2, 1); // Copa-2, no coincide
const resultados = t.ventanaDescarte.intentos.map((i) => i.resultado);
ok(resultados.filter((r) => r === "primero").length === 1, "un solo 'primero'", resultados);
ok(t.ventanaDescarte.huboPrimero === true, "queda marcado que ya hubo primero");

console.log("\n=== Un intento por ventana sobre la mano propia ===");
{
  /**
   * Sobre lo propio hay UN tiro por ventana, y se vive con él.
   *
   * Sin esto, tocar tres cartas costaba tres castigos: cuatro cartas antes,
   * siete después. En red ya era así —`registrarIntento` rechaza el segundo
   * antes de anotarlo— y en entrenamiento no, así que la misma jugada costaba
   * distinto según dónde se jugara. Ahora el límite está en el motor, que es
   * lo único que corren los dos modos.
   */
  let w = mesaDePrueba();

  // Primer tiro: falla con la Copa-2, que no coincide con la muestra.
  w = M.intentarDescarte(w, 0, 1);
  const trasUno = { cartas: cuenta(w, 0), intentos: w.ventanaDescarte.intentos.length };
  ok(trasUno.cartas === 5, "el primer tiro se cobra: cuatro cartas más el castigo", trasUno);

  // Segundo tiro en la misma ventana: no pasa nada de nada.
  const segundo = M.intentarDescarte(w, 0, 0);
  ok(segundo === w, "el segundo tiro devuelve el MISMO estado, sin tocar nada");
  ok(cuenta(segundo, 0) === trasUno.cartas, "no hay una segunda carta de castigo", cuenta(segundo, 0));
  ok(segundo.ventanaDescarte.intentos.length === trasUno.intentos,
     "y no queda anotado como intento", segundo.ventanaDescarte.intentos.length);
  ok(M.yaIntentoLoSuyo(w, 0) === true, "el motor sabe que ya jugó lo suyo");

  // Pero es SÓLO del que tiró, y SÓLO en esta ventana.
  ok(M.yaIntentoLoSuyo(w, 1) === false, "a los demás no les gasta el tiro");
  const otroJugador = M.intentarDescarte(w, 1, 0);
  ok(cuenta(otroJugador, 1) === 3, "B acierta primero en la misma ventana", cuenta(otroJugador, 1));

  const ventanaNueva = { ...w, ventanaDescarte: { huboPrimero: false, intentos: [] } };
  ok(M.yaIntentoLoSuyo(ventanaNueva, 0) === false, "la ventana siguiente empieza limpia");
  ok(cuenta(M.intentarDescarte(ventanaNueva, 0, 0), 0) === 4,
     "y ahí sí puede volver a tirar: acierta y se saca una de encima");
}

console.log("\n=== Acertar tarde deja la carta a la vista, como el error ===");
{
  /**
   * Los dos castigos son públicos, y tienen que serlo por el mismo motivo: el
   * que se comió la carta ya lo sabe, la información es para los otros tres.
   *
   * La diferencia entre tarde y error se mantiene en lo que se muestra: el
   * error enseña ADEMÁS la carta de castigo, y encima regala el derecho a que
   * te la descarten. Por eso fallar sigue siendo peor que llegar tarde.
   */
  let z = mesaDePrueba();
  z = M.intentarDescarte(z, 0, 0);  // A, primero
  z = M.intentarDescarte(z, 1, 0);  // B, tarde

  const tarde = z.ventanaDescarte.intentos.at(-1);
  ok(tarde.resultado === "tarde", "B llegó tarde", tarde.resultado);
  ok(tarde.carta?.id === "Espada-6", "y su carta viaja en el intento, para mostrarla", tarde.carta);
  ok(!tarde.castigo, "pero no su castigo: eso es sólo del error");

  const expuestas = M.cartasExpuestas([tarde]);
  ok(expuestas.length === 1, "la mesa ve UNA carta del que llegó tarde", expuestas.length);
  ok(expuestas[0].indiceJugador === 1 && expuestas[0].posicion === 0,
     "en la posición en la que sigue estando", expuestas[0]);
  ok(!M.puedeAtacarEn(z, 0, 1, 0), "verla no da derecho a descartársela: eso sólo lo da el error");
}

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
