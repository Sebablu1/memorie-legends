/**
 * La ventana corta que se abre después de un poder.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL AGUJERO QUE TAPA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Lo reportó un jugador, y el código le daba la razón: tiró un 8, usó el
 * poder, vio que el rival tenía un 8 — y no pudo descartárselo.
 *
 * El orden lo explica entero. Desde que rige «primero los reflejos de todos,
 * después el poder del que tiró», la secuencia es:
 *
 *   1. tira el 8            → queda de muestra
 *   2. ventana de reflejos  → acá TODAVÍA no sabe nada: el poder no se usó
 *   3. se resuelve el poder → recién acá ve el 8 del rival
 *   4. `postLevantada`      → sin ninguna ventana abierta
 *
 * El conocimiento llegaba un paso después de la única ventana donde servía, y
 * para cuando hubiera otra la muestra ya sería otra carta. Tirar un poder que
 * revela un par con su propia muestra era una jugada imposible de completar.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO SE VUELVE AL ORDEN VIEJO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Resolver el poder antes de los reflejos taparía esto y devolvería el
 * problema que el orden nuevo vino a arreglar: las cartas de poder salteaban
 * la ventana, y tirar un 7 no le servía a nadie más que a quien lo tiraba.
 *
 * Se agrega un paso 5 en vez de deshacer el 2.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LAS TRES RESTRICCIONES, Y POR QUÉ CADA UNA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * SÓLO PARA EL QUE USÓ EL PODER (`soloPara`). Los otros tres ya tuvieron su
 * ventana en el paso 2, con la misma muestra. Ésta existe por algo que le pasó
 * a uno solo.
 *
 * SÓLO ATACAR (`soloAtaques`). Si además pudiera descartar una carta propia,
 * tendría DOS oportunidades sobre la misma muestra y los demás una.
 *
 * SÓLO SI PUEDE ATACAR A ALGUIEN. No es «después de un poder»: es
 * `objetivosDe` no vacío. Un 7 mira una carta PROPIA y no da derecho sobre
 * nadie, así que abriría tres segundos muertos; el 9 no mira nada. Y al revés:
 * si ya sabía algo de un poder anterior de la ronda, la ventana corresponde
 * igual — el sentido es «usá contra esta muestra lo que sabés», no «usá lo que
 * acabás de aprender».
 *
 * Esto no agrega una regla: `objetivosDe` ya decidía quién puede atacar a
 * quién. El poder solamente abre el momento.
 *
 * `saltarPoder` queda afuera aunque el que declinó sepa cosas: ahí el poder no
 * se usó, y una ventana privada extra por renunciar a algo sería un premio por
 * no jugar.
 */

import * as M from "../public/js/reglas/motor.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

const carta = (palo, numero) => ({ id: `${palo}-${numero}`, palo, numero, puntos: numero });

/**
 * X = 0, Y = 1, Z = 2, en `postLevantada` y con X en turno.
 *
 * Es el estado exacto en el que termina un poder: la muestra ya está puesta,
 * la ventana de reflejos ya pasó y le toca a X decidir si corta.
 *
 * La mano de X arranca con un 5 en la posición 0, y la de Y con un 5 en la 1.
 * La muestra también es un 5: así el mismo estado sirve para comprobar el
 * ataque que SÍ corresponde y el descarte propio que NO.
 */
function trasElPoder({ muestra = carta("Copa", 5), sabe = [] } = {}) {
  const base = M.empezarRonda(M.crearPartida([
    { id: "X", nombre: "X" }, { id: "Y", nombre: "Y" }, { id: "Z", nombre: "Z" },
  ], { semilla: 99 }));

  const manos = [
    [carta("Oro", 5), carta("Oro", 2), carta("Oro", 3), carta("Oro", 4)],
    [carta("Basto", 7), carta("Basto", 5), carta("Basto", 3), carta("Basto", 9)],
    [carta("Espada", 11), carta("Espada", 10), carta("Espada", 6), carta("Espada", 8)],
  ];
  const vista = { ...muestra, visible: true };
  const usadas = new Set([vista.id, ...manos.flat().map((c) => c.id)]);

  return {
    ...base,
    fase: "postLevantada",
    indiceTurno: 0,
    ventanaDescarte: null,
    descarte: [vista],
    mazo: base.mazo.filter((c) => !usadas.has(c.id)),
    jugadores: base.jugadores.map((j, i) => ({ ...j, mano: manos[i] })),
    // La ronda sale del estado y no de un literal: si algún día el
    // conocimiento se poda por ronda, esto sigue diciendo la verdad.
    conocimientos: sabe.map((c) => ({ ...c, ronda: base.ronda })),
  };
}

/** X conoce el 5 de Y. Es el derecho que deja un 8 o un 10. */
const SABE = [{ actor: 0, idCarta: "Basto-5", origen: "poder8" }];

const cuenta = (s, i) => s.jugadores[i].mano.filter(Boolean).length;

// =====================================================================
console.log("\n=== 1. Se abre sólo si el que usó el poder puede atacar ===");
// =====================================================================
{
  const conSaber = M.ventanaTrasPoder(trasElPoder({ sabe: SABE }), 0);
  ok(conSaber.fase === "descarte", "con conocimiento, abre", conSaber.fase);
  ok(Boolean(conSaber.ventanaDescarte), "y deja una ventana puesta");

  const sinSaber = M.ventanaTrasPoder(trasElPoder(), 0);
  ok(sinSaber.fase === "postLevantada",
     "sin conocimiento no abre: serían tres segundos muertos", sinSaber.fase);
  ok(sinSaber.ventanaDescarte === null, "y no queda ninguna ventana");

  /**
   * Un 7 mira una carta PROPIA, así que no deja derecho sobre nadie: nadie se
   * ataca a sí mismo. Que acá no abra no es una regla nueva, es aquélla.
   */
  const solo7 = M.ventanaTrasPoder(
    trasElPoder({ sabe: [{ actor: 0, idCarta: "Oro-5", origen: "poder7" }] }),
    0,
  );
  ok(solo7.fase === "postLevantada", "un 7 sobre carta propia tampoco abre", solo7.fase);

  /**
   * Lo que dejó un FALLO ajeno también cuenta, y abre.
   *
   * Antes no abría: ese derecho era por posición y `objetivosDe` sólo miraba
   * los de mano entera. Ahora todo conocimiento es de una carta y vale igual,
   * y la condición de apertura es la amplia: saber algo atacable, venga de
   * donde venga.
   */
  const porFallo = M.ventanaTrasPoder(
    trasElPoder({ sabe: [{ actor: 0, idCarta: "Basto-5", origen: "fallo" }] }),
    0,
  );
  ok(porFallo.fase === "descarte", "lo que dejó un fallo ajeno también abre", porFallo.fase);
}

// =====================================================================
console.log("\n=== 2. Lleva las dos marcas, y adónde volver ===");
// =====================================================================
{
  const s = M.ventanaTrasPoder(trasElPoder({ sabe: SABE }), 0);

  ok(s.ventanaDescarte.soloPara === 0, "es de X y de nadie más", s.ventanaDescarte.soloPara);
  ok(s.ventanaDescarte.soloAtaques === true, "y sólo para atacar");

  /**
   * `volverA` no es decorativo. Lo lee el servidor para elegir la duración
   * —con `volverA` son tres segundos, sin él cinco— y lo lee
   * `cerrarVentanaDescarte` para saber adónde devolver la mesa. Sin esto, al
   * cerrarse volvería a `turno` y X perdería su decisión de cortar.
   */
  ok(s.ventanaDescarte.volverA === "postLevantada",
     "y al cerrarse devuelve la decisión de cortar", s.ventanaDescarte.volverA);

  const cerrada = M.cerrarVentanaDescarte(s);
  ok(cerrada.fase === "postLevantada", "comprobado de verdad al cerrarla", cerrada.fase);
  ok(cerrada.indiceTurno === 0, "y el turno sigue siendo de X", cerrada.indiceTurno);
}

// =====================================================================
console.log("\n=== 3. Los otros tres no juegan en esta ventana ===");
// =====================================================================
{
  const s = M.ventanaTrasPoder(trasElPoder({ sabe: SABE }), 0);

  // Z quiere descartar una carta suya: ya tuvo su ventana con esta muestra.
  const zIntenta = M.intentarDescarte(s, 2, 3);
  ok(cuenta(zIntenta, 2) === cuenta(s, 2),
     "Z no puede descartar: la ventana no es suya", cuenta(zIntenta, 2));

  /**
   * Y tampoco puede atacar, aunque tenga derecho.
   *
   * El conocimiento se le da a propósito: sin él lo frenaría `puedeAtacarEn` y
   * la prueba pasaría por el motivo equivocado, sin llegar a tocar `soloPara`.
   */
  const conY = {
    ...s,
    conocimientos: [
      ...s.conocimientos,
      { actor: 1, idCarta: "Espada-11", origen: "poder8", ronda: s.ronda },
    ],
  };
  const yAtaca = M.intentarDescarteRival(conY, 1, 2, 0, 0);
  ok(cuenta(yAtaca, 2) === cuenta(conY, 2),
     "Y no puede atacar aunque sepa: la ventana es de X", cuenta(yAtaca, 2));
}

// =====================================================================
console.log("\n=== 4. X puede atacar, y NO descartar lo suyo ===");
// =====================================================================
{
  const s = M.ventanaTrasPoder(trasElPoder({ sabe: SABE }), 0);

  /**
   * X tiene un 5 en la posición 0 y la muestra es un 5: sin `soloAtaques`
   * esto sería un descarte válido, y encima el primero. Es exactamente la
   * segunda oportunidad sobre la misma muestra que no corresponde.
   */
  const propio = M.intentarDescarte(s, 0, 0);
  ok(cuenta(propio, 0) === cuenta(s, 0),
     "X no descarta lo suyo ni con la carta correcta", cuenta(propio, 0));
  ok(propio.descarte[0].numero === 5 && propio.descarte.length === s.descarte.length,
     "y la muestra no se movió", propio.descarte.length);

  // El ataque, que es para lo que existe la ventana. Y tiene su 5 en la 1.
  const ataque = M.intentarDescarteRival(s, 0, 1, 1, 2);
  ok(cuenta(ataque, 1) === cuenta(s, 1),
     "el 5 de Y se va y en su hueco queda una carta de X", cuenta(ataque, 1));
  ok(cuenta(ataque, 0) === cuenta(s, 0) - 1, "y X entrega una", cuenta(ataque, 0));
  ok(ataque.descarte[0].numero === 5, "el 5 de Y quedó de muestra", ataque.descarte[0].numero);
}

// =====================================================================
console.log("\n=== 5. No pisa una ventana que ya está abierta ===");
// =====================================================================
{
  /**
   * Llamarla dos veces, o llamarla sobre una mesa que por cualquier motivo ya
   * está en `descarte`, no puede reemplazar la ventana que hay: sería quitarle
   * a los otros tres los reflejos que estaban corriendo, y de paso borrar los
   * intentos ya anotados.
   */
  const enReflejos = {
    ...trasElPoder({ sabe: SABE }),
    fase: "descarte",
    ventanaDescarte: { huboPrimero: false, intentos: [], volverA: "postLevantada" },
  };
  const s = M.ventanaTrasPoder(enReflejos, 0);
  ok(s === enReflejos, "con una ventana abierta, devuelve el estado intacto");

  /**
   * Y fuera de `postLevantada` tampoco. Es la misma precaución conservadora
   * que toman el resto de las transiciones del motor: una función que abre
   * ventanas desde cualquier fase termina abriendo una en medio de un corte.
   */
  const enTurno = { ...trasElPoder({ sabe: SABE }), fase: "turno" };
  ok(M.ventanaTrasPoder(enTurno, 0) === enTurno, "ni desde otra fase");
}

console.log(fallos ? `\n❌ ${fallos} FALLOS` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
