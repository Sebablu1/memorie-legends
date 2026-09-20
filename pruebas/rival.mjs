/**
 * Descartarle una carta a un rival: de dónde sale el derecho, y qué pasa.
 *
 * La mecánica, en una frase: sólo se ataca una carta que se CONOCE.
 *
 * Conocer es saber qué carta es y dónde está. Lo da un 8, un 10, el castigo de
 * un error ajeno, o una carta propia conocida que pasó a otra mano. Si la
 * muestra es de ese número, se la puede descartar: la del rival se va al
 * descarte y en su lugar exacto queda una carta propia, elegida por posición y
 * a ciegas. Si no es, el que ataca se come una de castigo, sigue conociendo la
 * carta, y puede volver a intentar; cada error vuelve a costar.
 *
 * ANTES ERA OTRA COSA. El conocimiento guardaba el número visto y habilitaba
 * cualquier posición de esa mano: "sé que tiene un 5, no dónde". No seguía a
 * la carta cuando se movía, no caducaba cuando se iba, y la mesa y el servidor
 * no se ponían de acuerdo sobre qué se podía atacar. Esta prueba afirmaba ese
 * modelo; se reescribió con la especificación del descarte al rival.
 *
 * Lo que se comprueba acá es sobre todo lo que NO pasa: que no aparezcan ni
 * desaparezcan cartas, que ninguna carta conocida viaje al navegador, y que
 * nadie pueda atacar una carta que no conoce.
 */

import * as M from "../public/js/reglas/motor.js";
import * as V from "../public/js/reglas/vista.js";

/** Cuándo vence una ventana. Su duración ya no es fija: abre con la
 *  mirada, así que hay que preguntársela a ella y no a la constante. */
const vence = (v) => v.abiertaEn + v.duracionMs + v.graciaMs;

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

const carta = (palo, numero) => ({ id: `${palo}-${numero}`, palo, numero, puntos: numero });

/** X = 0, Y = 1, Z = 2. Muestra: un 5. */
function mesa({ manoX, manoY, muestra = carta("Copa", 5) } = {}) {
  const base = M.empezarRonda(M.crearPartida([
    { id: "X", nombre: "X" }, { id: "Y", nombre: "Y" }, { id: "Z", nombre: "Z" },
  ], { semilla: 99 }));

  const manos = [
    manoX ?? [carta("Oro", 1), carta("Oro", 2), carta("Oro", 3), carta("Oro", 4)],
    manoY ?? [carta("Basto", 7), carta("Basto", 5), carta("Basto", 3), carta("Basto", 9)],
    [carta("Espada", 11), carta("Espada", 10), carta("Espada", 6), carta("Espada", 8)],
  ];
  const vista = { ...muestra, visible: true };
  const usadas = new Set([vista.id, ...manos.flat().map((c) => c.id)]);

  return {
    ...base,
    fase: "descarte",
    ventanaDescarte: { huboPrimero: false, intentos: [] },
    descarte: [vista],
    mazo: base.mazo.filter((c) => !usadas.has(c.id)),
    jugadores: base.jugadores.map((j, i) => ({ ...j, mano: manos[i] })),
  };
}

/** Deja anotado que `actor` conoce esas cartas, sin pasar por un poder. */
const conSaber = (s, ids, actor = 0, origen = "poder8") => ({
  ...s,
  conocimientos: [
    ...(s.conocimientos ?? []),
    ...[ids].flat().map((idCarta) => ({ actor, idCarta, origen, ronda: s.ronda })),
  ],
});

const cuenta = (s, i) => s.jugadores[i].mano.filter(Boolean).length;
const todasLasCartas = (s) => [
  ...s.mazo.map((c) => c.id),
  ...s.descarte.map((c) => c.id),
  ...s.jugadores.flatMap((j) => j.mano.filter(Boolean).map((c) => c.id)),
  ...(s.levantada ? [s.levantada.id] : []),
];
const atacables = (s, actor) => JSON.stringify(M.posicionesAtacablesDe(s, actor));

// ================================================ 1. de dónde sale el saber

console.log("\n=== 1. El 8 deja conocida la carta que se miró; el 7 no autoriza nada ===");
{
  const s = { ...mesa(), fase: "poder", poderPendiente: { tipo: "mirarRival", numero: 8, indiceJugador: 0 } };
  const r = M.usarPoderMirar(s, 1, 1);   // X mira la posición 1 de Y: Basto-5

  ok(r.revelada?.carta?.numero === 5, "X ve la carta que miró", r.revelada?.carta?.numero);
  ok(M.conoceCarta(r.estado, 0, "Basto-5"), "y queda anotado que la conoce");

  const c = r.estado.conocimientos.find((k) => k.actor === 0);
  ok(c?.idCarta === "Basto-5", "lo que se guarda es la carta", c);
  ok(c?.origen === "poder8", "de dónde salió", c?.origen);
  ok(!("numero" in c) && !("posicion" in c),
     "ni el número ni la posición: la posición se busca en la mano cada vez", c);
  ok(atacables(r.estado, 0) === '[{"objetivo":1,"posicion":1}]',
     "y lo que habilita es ESA carta, no la mano entera", M.posicionesAtacablesDe(r.estado, 0));

  // El 7 mira una carta propia: la deja conocida, pero no autoriza nada
  // contra nadie. Nadie se ataca a sí mismo.
  const propio = { ...mesa(), fase: "poder", poderPendiente: { tipo: "mirarPropia", numero: 7, indiceJugador: 0 } };
  const r7 = M.usarPoderMirar(propio, 0, 0);

  ok(M.objetivosDe(r7.estado, 0).length === 0,
     "mirar una carta propia no autoriza a atacar a nadie", M.objetivosDe(r7.estado, 0));
  ok(M.conoceCarta(r7.estado, 0, "Oro-1"), "pero la carta queda conocida");
  ok(r7.estado.conocimientos.find((k) => k.actor === 0)?.origen === "poder7", "con su origen");
}

console.log("\n=== 2. El 10 deja conocidas las dos cartas; el 9 no deja nada nuevo ===");
{
  // El 10 son DOS pasos. Primero muestra las dos cartas y se detiene; lo que
  // vio ya lo conoce, cambie o no.
  const s = { ...mesa(), fase: "poder", poderPendiente: { tipo: "cambioConVista", numero: 10, indiceJugador: 0 } };
  const miCarta = s.jugadores[0].mano[2];        // Oro-3
  const suCarta = s.jugadores[1].mano[0];        // Basto-7
  const visto = M.usarPoderCambio(s, 2, 1, 0);   // mi posición 2 por la 0 de Y

  ok(visto.estado.fase === "cambioConVista", "primero espera la decisión", visto.estado.fase);
  ok(visto.revelada?.propia?.id === miCarta.id && visto.revelada?.rival?.id === suCarta.id,
     "mostrando las dos cartas a quien lo usó");
  ok(visto.estado.jugadores[1].mano[0].id === suCarta.id, "sin haber movido nada todavía");
  ok(M.conoceCarta(visto.estado, 0, miCarta.id) && M.conoceCarta(visto.estado, 0, suCarta.id),
     "y conociendo ya las dos");

  // Las POSICIONES quedan en el estado para poder resolver, nunca las cartas:
  // guardarlas ahí las pondría a un `vistaDe` mal escrito de toda la mesa.
  const p = visto.estado.cambioPendiente;
  ok(p && p.indiceJugador === 0 && p.indiceRival === 1,
     "el pendiente dice quién decide y sobre quién");
  ok(!JSON.stringify(p).includes(suCarta.id) && !JSON.stringify(p).includes(miCarta.id),
     "y NO guarda ninguna carta", p);

  // SI CAMBIA: las dos se mueven y el conocimiento va con ellas. La suya ya
  // es mía —no se ataca—; la mía quedó en la mano de Y, y ésa sí.
  const cambio = M.resolverCambioConVista(visto.estado, true);
  ok(cambio.jugadores[1].mano[0].id === miCarta.id, "mi carta quedó en la mano de Y");
  ok(cambio.jugadores[0].mano[2].id === suCarta.id, "y la suya en la mía");
  ok(atacables(cambio, 0) === '[{"objetivo":1,"posicion":0}]',
     "puedo ir sobre la carta que le di, en su lugar nuevo", M.posicionesAtacablesDe(cambio, 0));
  ok(cambio.fase === "postLevantada", "y vuelve a la decisión de cortar", cambio.fase);

  // SI NO CAMBIA: cada carta se queda donde estaba, y la que puedo atacar es
  // la de Y, que sigue siendo de Y.
  const sinCambiar = M.resolverCambioConVista(visto.estado, false);
  ok(sinCambiar.jugadores[1].mano[0].id === suCarta.id, "no cambiar deja todo donde estaba");
  ok(sinCambiar.jugadores[0].mano[2].id === miCarta.id, "en las dos manos");
  ok(atacables(sinCambiar, 0) === '[{"objetivo":1,"posicion":0}]',
     "y puedo ir sobre la carta de Y que vi", M.posicionesAtacablesDe(sinCambiar, 0));

  /**
   * Las posiciones del 10 son PÚBLICAS, y es una decisión de diseño: la mesa
   * ve el ojo sobre la carta exacta. Lo que sigue sin viajar son las CARTAS.
   */
  for (const quien of [0, 1, 2]) {
    const v = V.vistaDe(visto.estado, quien).cambioPendiente;
    ok(v?.indiceJugador === 0 && v?.indiceRival === 1,
       `el jugador ${quien} ve quién decide y sobre quién`);
    ok(v?.posicionPropia === 2 && v?.posicionRival === 0,
       `y el jugador ${quien} TAMBIÉN ve las posiciones`, v);
    const campos = Object.keys(v ?? {}).sort();
    ok(
      JSON.stringify(campos) ===
        JSON.stringify(["indiceJugador", "indiceRival", "posicionPropia", "posicionRival"]),
      `el jugador ${quien} ve las cuatro posiciones y NADA más`,
      campos,
    );
  }

  // El 9 cambia a ciegas: no se vio nada, no se anota nada, y no espera.
  const s9 = { ...mesa(), fase: "poder", poderPendiente: { tipo: "cambioCiego", numero: 9, indiceJugador: 0 } };
  const r9 = M.usarPoderCambio(s9, 2, 1, 0);
  ok(r9.estado.fase === "postLevantada", "el 9 no pregunta nada", r9.estado.fase);
  ok((r9.estado.conocimientos ?? []).length === 0, "el 9 no anota conocimiento nuevo");
  ok(r9.estado.jugadores[1].mano[0].id === miCarta.id, "pero sí cambia");
}

// ================================================== 3. la autorización

console.log("\n=== 3. Conocer una carta habilita ESA carta, y nada más ===");
{
  const s = conSaber(mesa(), "Basto-5");

  ok(M.puedeAtacarEn(s, 0, 1, 1) === true, "X puede ir sobre la carta que conoce");
  for (const p of [0, 2, 3]) {
    ok(M.puedeAtacarEn(s, 0, 1, p) === false, `pero no sobre la posición ${p} de Y`);
  }
  ok(M.puedeAtacarA(s, 0, 2) === false, "ni contra Z, de quien no conoce nada");
  ok(M.puedeAtacarA(s, 1, 0) === false, "y Y no puede ir contra X: conocer no es mutuo");
  ok(M.puedeAtacarEn(s, 0, 0, 0) === false, "nadie se ataca a sí mismo");

  ok(JSON.stringify(M.objetivosDe(s, 0)) === "[1]", "los objetivos de X son sólo Y", M.objetivosDe(s, 0));
  ok(M.objetivosDe(s, 1).length === 0, "Y no tiene ninguno");

  // A un eliminado no se lo ataca, ni un eliminado ataca.
  const conYFuera = { ...s, jugadores: s.jugadores.map((j, i) => (i === 1 ? { ...j, eliminado: true } : j)) };
  ok(M.puedeAtacarEn(conYFuera, 0, 1, 1) === false, "a un jugador eliminado no");
  const conXFuera = { ...s, jugadores: s.jugadores.map((j, i) => (i === 0 ? { ...j, eliminado: true } : j)) };
  ok(M.puedeAtacarEn(conXFuera, 0, 1, 1) === false, "y un eliminado no ataca");
}

// ============================================ 4. equivocarse y seguir

console.log("\n=== 4. Equivocarse cuesta, y se puede volver a intentar ===");
{
  // Y = [7, 5, 3, 9], muestra 5. X conoce el 7 y el 5 de Y.
  let s = conSaber(mesa(), ["Basto-7", "Basto-5"]);
  const antesX = cuenta(s, 0);
  const cartasAntes = todasLasCartas(s).length;

  s = M.intentarDescarteRival(s, 0, 1, 0, 0);   // Y[0] = 7 → error
  const primero = s.ventanaDescarte.intentos.at(-1);
  ok(primero.resultado === "rivalError", "primer intento sobre el 7: error");
  ok(cuenta(s, 0) === antesX + 1, "X recibe una carta", cuenta(s, 0));
  ok(s.jugadores[1].mano[0].id === "Basto-7", "la carta de Y no se movió");
  ok(M.conoceCarta(s, 0, "Basto-7"), "y X la sigue conociendo");

  s = M.intentarDescarteRival(s, 0, 1, 0, 0);   // otra vez el 7 → error
  ok(s.ventanaDescarte.intentos.at(-1).resultado === "rivalError", "segundo intento: se puede, y es error");
  ok(cuenta(s, 0) === antesX + 2, "otra carta más", cuenta(s, 0));

  const igual = M.intentarDescarteRival(s, 0, 1, 2, 0);   // Y[2]: no la conoce
  ok(igual === s, "sobre una carta que no conoce no hay intento, ni castigo");

  /**
   * La de castigo entra BOCA ABAJO, y nadie la conoce.
   *
   * Se mostraba, y errar un ataque costaba dos cosas: una carta más y una
   * carta marcada que los otros dos podían descartarle en cuanto saliera su
   * número. Lo que se castiga es el error, no la carta que entra.
   */
  ok(primero.castigo === undefined, "el intento no lleva la carta de castigo", primero.castigo);
  const entroX = s.jugadores[0].mano[antesX];
  ok(Boolean(entroX), "X sí recibió su castigo", entroX?.id);
  ok([0, 1, 2].every((i) => !M.conoceCarta(s, i, entroX.id)),
     "pero no la conoce nadie, ni el que la recibió");
  ok(!M.puedeAtacarEn(s, 1, 0, antesX) && !M.puedeAtacarEn(s, 2, 0, antesX),
     "así que nadie puede ir sobre ella");

  // Ahora sí: el 5.
  s = M.intentarDescarteRival(s, 0, 1, 1, 0);   // Y[1] = 5 → acierto
  ok(s.ventanaDescarte.intentos.at(-1).resultado === "rivalAcierto", "sobre el 5: acierto");
  ok(!M.conoceCarta(s, 0, "Basto-5"), "el 5 salió de la mesa y nadie lo conoce más");
  ok(M.conoceCarta(s, 0, "Basto-7"), "el 7 sigue ahí, y sigue conocido");
  ok(s.ventanaDescarte.intentos.at(-1).castigo === undefined, "un acierto no lleva castigo");

  ok(todasLasCartas(s).length === cartasAntes, "y en toda la mesa no se creó ni se perdió ninguna carta",
     { antes: cartasAntes, despues: todasLasCartas(s).length });
}

// ================================================ 5. la transferencia

console.log("\n=== 5. La transferencia: exacta, atómica y a ciegas ===");
{
  const s0 = conSaber(mesa(), "Basto-5");
  const entregada = s0.jugadores[0].mano[2];      // Oro-3, la que X va a dar
  const objetivo = s0.jugadores[1].mano[1];       // Basto-5, la que busca
  const idsAntes = todasLasCartas(s0).sort().join(",");

  const s = M.intentarDescarteRival(s0, 0, 1, 1, 2);

  ok(s.descarte[0].id === objetivo.id, "la carta de Y se fue al descarte", s.descarte[0].id);
  ok(s.descarte[0].visible === true, "y ahí se ve, como cualquier descarte");

  ok(s.jugadores[1].mano[1].id === entregada.id,
     "mi carta ocupa EXACTAMENTE la posición que ataqué", s.jugadores[1].mano[1].id);
  ok(s.jugadores[1].mano[1].visible === false, "y queda boca abajo");

  ok(s.jugadores[0].mano[2] === null, "sale de mi mano y me deja el hueco");
  ok(s.jugadores[0].mano[0].id === "Oro-1" && s.jugadores[0].mano[3].id === "Oro-4",
     "sin desplazar mis otras cartas");
  ok(s.jugadores[1].mano[0].id === "Basto-7" && s.jugadores[1].mano[3].id === "Basto-9",
     "ni las de Y");

  ok(cuenta(s, 1) === 4, "Y sigue con cuatro cartas: perdió una y recibió una", cuenta(s, 1));
  ok(cuenta(s, 0) === 3, "X queda con tres: una menos", cuenta(s, 0));

  ok(todasLasCartas(s).sort().join(",") === idsAntes, "ninguna carta duplicada ni perdida");
  ok(s.ventanaDescarte.intentos.at(-1).carta === null,
     "la carta entregada NO se expone: nadie la ve, ni quien la dio");
  ok(M.posicionesAtacablesDe(s, 0).length === 0,
     "X no sabía cuál entregaba, así que no la conoce");

  // Pero si la conocía de antes —la miró al empezar la ronda—, la sigue
  // conociendo en la mano de Y. El recuerdo es de la carta.
  const sabia = M.intentarDescarteRival(conSaber(s0, "Oro-3", 0, "mirada"), 0, 1, 1, 2);
  ok(atacables(sabia, 0) === '[{"objetivo":1,"posicion":1}]',
     "si X conocía la que entregó, la sigue en la mano de Y", M.posicionesAtacablesDe(sabia, 0));
}

// ============================================== 6. lo que no se permite

console.log("\n=== 6. Sin conocer la carta no hay intento ===");
{
  const sinSaber = mesa();
  ok(M.intentarDescarteRival(sinSaber, 0, 1, 1, 0) === sinSaber,
     "sin conocimiento, el intento no cambia nada");

  const soloEsa = conSaber(mesa(), "Basto-5");
  ok(M.intentarDescarteRival(soloEsa, 0, 1, 0, 0) === soloEsa,
     "conocer el 5 de Y no habilita otra carta de Y");
  ok(M.intentarDescarteRival(soloEsa, 0, 2, 0, 0) === soloEsa,
     "ni una de Z, aunque vaya con la muestra");

  // Una posición vacía no es un objetivo.
  const conHueco = {
    ...soloEsa,
    jugadores: soloEsa.jugadores.map((j, i) =>
      i === 1 ? { ...j, mano: [j.mano[0], null, ...j.mano.slice(2)] } : j),
  };
  ok(M.intentarDescarteRival(conHueco, 0, 1, 1, 0) === conHueco, "un hueco no se puede atacar");

  // No se puede entregar una carta que no se tiene.
  const sinEsa = {
    ...soloEsa,
    jugadores: soloEsa.jugadores.map((j, i) =>
      i === 0 ? { ...j, mano: [j.mano[0], null, null, null] } : j),
  };
  ok(M.intentarDescarteRival(sinEsa, 0, 1, 1, 2) === sinEsa,
     "no se puede entregar desde una posición vacía");

  // Fuera de la ventana no se ataca.
  const cerrada = { ...soloEsa, fase: "turno", ventanaDescarte: null };
  ok(M.intentarDescarteRival(cerrada, 0, 1, 1, 0) === cerrada, "fuera de la fase de descarte tampoco");
}

// ============================================ 7. lo que ve cada uno

console.log("\n=== 7. El permiso viaja; la carta, jamás ===");
{
  const s = conSaber(mesa(), "Basto-5");

  const vistaX = V.vistaDe(s, 0);
  const vistaY = V.vistaDe(s, 1);
  const vistaZ = V.vistaDe(s, 2);

  ok(JSON.stringify(vistaX.puedeAtacarEn) === '[{"objetivo":1,"posicion":1}]',
     "X ve dónde puede ir", vistaX.puedeAtacarEn);
  ok(JSON.stringify(vistaX.puedeAtacar) === "[1]", "y contra quién", vistaX.puedeAtacar);
  ok(vistaY.puedeAtacarEn.length === 0 && vistaZ.puedeAtacarEn.length === 0,
     "Y y Z no ven ningún objetivo");

  ok(!("conocimientos" in vistaX), "el modelo de conocimiento no viaja");
  ok(!JSON.stringify(vistaX).includes('"idCarta"'), "ni disfrazado bajo otro nombre");

  // Y sobre todo: la mano de Y sigue tapada para X.
  ok(vistaX.jugadores[1].mano.every((c) => c?.oculta),
     "X no ve ninguna carta de Y, ni siquiera la que conoce");

  for (const [quien, v] of [["X", vistaX], ["Y", vistaY], ["Z", vistaZ]]) {
    ok(V.filtracionesEn(v, s).length === 0, `la vista de ${quien} no filtra nada`,
       V.filtracionesEn(v, s));
  }

  // El detector reconoce la forma nueva si alguien la publicara.
  const conFuga = { ...vistaX, algo: [{ actor: 0, idCarta: "Basto-5" }] };
  ok(V.filtracionesEn(conFuga, s).some((p) => /conocimiento/.test(p)),
     "y si un conocimiento se colara en la vista, el detector lo ve");
}

console.log("\n=== 8. Tras la transferencia, nadie sabe qué se entregó ===");
{
  const s0 = conSaber(mesa(), "Basto-5");
  const entregada = s0.jugadores[0].mano[2];
  const s = M.intentarDescarteRival(s0, 0, 1, 1, 2);

  for (const [quien, i] of [["X (que la entregó)", 0], ["Y (que la recibió)", 1], ["Z", 2]]) {
    const v = V.vistaDe(s, i);
    ok(!JSON.stringify(v).includes(`"${entregada.id}"`),
       `${quien} no recibe el valor de la carta transferida`);
  }

  const vX = V.vistaDe(s, 0);
  ok(vX.jugadores[1].mano[1]?.oculta === true,
     "en la vista de X esa posición está tapada, aunque él puso la carta");
  ok(vX.puedeAtacarEn.length === 0, "y ya no tiene nada que atacar: la que conocía se fue");

  for (const i of [0, 1, 2]) {
    ok(V.filtracionesEn(V.vistaDe(s, i), s).length === 0, `sin filtraciones tras la transferencia (${i})`);
  }
}

// ============================================ 9. estado serializable

console.log("\n=== 9. El conocimiento sobrevive el viaje por Firestore ===");
{
  let s = conSaber(mesa(), ["Basto-7", "Basto-5"]);
  s = M.intentarDescarteRival(s, 0, 1, 0, 0);     // un error

  const ida = JSON.parse(JSON.stringify(s));
  ok(JSON.stringify(ida.conocimientos) === JSON.stringify(s.conocimientos),
     "el conocimiento cruza el JSON sin perder nada");

  const sigue = M.intentarDescarteRival(ida, 0, 1, 1, 2);
  const directo = M.intentarDescarteRival(s, 0, 1, 1, 2);
  ok(JSON.stringify(sigue) === JSON.stringify(directo),
     "y seguir desde la copia da exactamente el mismo estado");

  const raros = [];
  (function buscar(v, ruta) {
    if (typeof v === "function") return raros.push(`${ruta} función`);
    if (v instanceof Map || v instanceof Set || v instanceof Date) return raros.push(`${ruta} ${v.constructor.name}`);
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) buscar(x, `${ruta}.${k}`);
  })(sigue.conocimientos, "conocimientos");
  ok(raros.length === 0, "y no lleva nada que Firestore no sepa guardar", raros);
}

// ==================================== 10. contra el servidor de verdad

/**
 * Lo de arriba prueba el motor. Esto prueba lo que ve un atacante que manda
 * pedidos: que la autorización la decida el servidor y no el navegador.
 */
console.log("\n=== 10. El servidor no cree en la palabra del cliente ===");
{
  const { crearMotorEnRed, MS_MIRADA_TOTAL } = await import("../functions/partida-red.js");
  const { MS_REVELACION } = await import("../public/js/reglas/vista.js");

  class E extends Error { constructor(c, m) { super(m); this.codigo = c; } }
  const error = (c, m) => new E(c, m);
  const docs = new Map(); let version = 0;
  const db = {
    collection: (n) => ({ doc: (id = `a${Math.random()}`) => ({ ruta: `${n}/${id}` }) }),
    async runTransaction(cuerpo) {
      for (let i = 0; i < 10; i++) {
        const leidas = new Map(); const esc = []; let yaEsc = false;
        const tx = {
          async get(ref) {
            if (yaEsc) throw error("invalid-argument", "Lectura tras escritura");
            const d = docs.get(ref.ruta); leidas.set(ref.ruta, d ? d.version : 0);
            return { exists: Boolean(d), data: () => (d ? structuredClone(d.datos) : undefined) };
          },
          set(ref, datos, op) { yaEsc = true; esc.push({ ruta: ref.ruta, datos, m: Boolean(op?.merge) }); },
          update(ref, datos) { yaEsc = true; esc.push({ ruta: ref.ruta, datos, m: true }); },
        };
        const res = await cuerpo(tx);
        if ([...leidas].some(([r, v]) => (docs.get(r)?.version ?? 0) !== v)) continue;
        for (const e of esc) {
          const p = docs.get(e.ruta);
          docs.set(e.ruta, { datos: e.m ? { ...(p?.datos ?? {}), ...structuredClone(e.datos) } : structuredClone(e.datos), version: ++version });
        }
        return res;
      }
      throw error("aborted", "reintentos");
    },
  };

  let reloj = 700000;
  const red = crearMotorEnRed({
    db, partidas: "partidas", ahora: () => reloj, idAleatorio: () => `v${reloj}`,
    marcaDeTiempo: () => "T", error, semillaDe: () => 31337,
  });

  const C = "RIV001";
  const TRES = ["x", "y", "z"];
  const capturar = async (f) => { try { return { valor: await f() }; } catch (e) { return { error: e }; } };
  const partida = () => docs.get(`partidas/${C}`).datos;
  const vista = (u) => docs.get(`partidas/${C}/vistas/${u}`).datos;

  await red.repartir({ yaSentados: true, codigo: C, jugadores: TRES, nombres: TRES });
  reloj += MS_MIRADA_TOTAL + 1;
  await red.avanzarPartida({ codigo: C });
  await red.avanzarPartida({ codigo: C });
  const v = partida().ventana;

  const pedir = (extra) => red.intentarDescarte({
    uid: "x", codigo: C, windowId: v.id, declarado: 500, latencia: 30, incertidumbre: 15, ...extra,
  });

  // Sin conocimiento, aunque el cliente insista.
  const sinPermiso = await capturar(() => pedir({
    posicion: 0, objetivo: "y", posicionEntrega: 0, clientActionId: "n1",
  }));
  ok(sinPermiso.error?.codigo === "permission-denied",
     "sin conocimiento el servidor rechaza el ataque", sinPermiso.error?.message);

  // Ni inventando que se tiene el poder: el cliente no manda esos campos, y
  // si los mandara no existen para el servidor.
  const mintiendo = await capturar(() => red.intentarDescarte({
    uid: "x", codigo: C, windowId: v.id, posicion: 0, objetivo: "y", posicionEntrega: 0,
    clientActionId: "n2", declarado: 500, latencia: 30, incertidumbre: 15,
    conoceRival: true, cartaConocida: 5, poder8: true, idCarta: "lo-que-sea",
  }));
  ok(mintiendo.error?.codigo === "permission-denied",
     "decir «yo la conozco» no autoriza nada", mintiendo.error?.message);

  // Contra un jugador que no existe.
  const fantasma = await capturar(() => pedir({
    posicion: 0, objetivo: "nadie", posicionEntrega: 0, clientActionId: "n3",
  }));
  ok(fantasma.error?.codigo === "not-found", "ni contra alguien que no juega", fantasma.error?.message);

  // Ahora sí: x conoce las tres primeras cartas de y, en el estado maestro.
  const p = partida();
  const deY = p.estado.jugadores[1].mano;
  await db.runTransaction(async (tx) => {
    tx.set({ ruta: `partidas/${C}` }, {
      ...p,
      estado: {
        ...p.estado,
        conocimientos: [0, 1, 2].map((i) => ({
          actor: 0, idCarta: deY[i].id, origen: "poder8", ronda: p.estado.ronda,
        })),
      },
      version: p.version + 1,
    });
  });

  // Sin la carta a entregar, el ataque se anota igual: se elige después, y
  // sólo si acierta. La respuesta dice si acertó.
  const sinEntrega = await capturar(() => pedir({ posicion: 0, objetivo: "y", clientActionId: "n4" }));
  ok(sinEntrega.valor?.anotado && typeof sinEntrega.valor?.acierta === "boolean",
     "sin carta a entregar se anota, y la respuesta dice si acertó",
     sinEntrega.valor ?? sinEntrega.error?.message);

  // La cuarta carta de y no la conoce: el permiso es por carta.
  const laCuarta = await capturar(() => pedir({
    posicion: 3, objetivo: "y", posicionEntrega: 0, clientActionId: "n5",
  }));
  ok(laCuarta.error?.codigo === "permission-denied",
     "conocer tres cartas de y no habilita la cuarta", laCuarta.error?.message);

  // Varios intentos humanos sobre el rival: permitidos.
  const a = await capturar(() => pedir({ posicion: 0, objetivo: "y", posicionEntrega: 0, clientActionId: "r1" }));

  // Escribir el maestro a mano no republica las vistas —eso lo hace
  // `publicar`—, así que se comprueban después del primer intento, que sí
  // publica. Es además el camino real: la autorización llega con la vista.
  ok(JSON.stringify(vista("x").puedeAtacarEn) ===
       '[{"objetivo":1,"posicion":0},{"objetivo":1,"posicion":1},{"objetivo":1,"posicion":2}]',
     "la vista de x lo autoriza sobre esas tres cartas", vista("x").puedeAtacarEn);
  ok(vista("y").puedeAtacarEn.length === 0, "y no ve autorización ninguna");
  ok(!JSON.stringify(vista("x")).includes('"conocimientos"'), "y lo que conoce no viaja");

  const b = await capturar(() => pedir({ posicion: 1, objetivo: "y", posicionEntrega: 1, clientActionId: "r2" }));
  const c = await capturar(() => pedir({ posicion: 2, objetivo: "y", posicionEntrega: 2, clientActionId: "r3" }));
  ok([a, b, c].every((r) => r.valor?.anotado),
     "tres intentos humanos distintos sobre el rival se anotan",
     [a, b, c].map((r) => r.error?.message ?? "ok"));

  // El mismo identificador, en cambio, es un reintento técnico.
  const repetido = await capturar(() => pedir({ posicion: 0, objetivo: "y", posicionEntrega: 3, clientActionId: "r1" }));
  ok(repetido.valor?.duplicado === true, "y el mismo identificador no agrega un cuarto");
  ok(Object.keys(partida().ventana.intentos).length === 4, "quedan cuatro —con el de n4—, no cinco",
     Object.keys(partida().ventana.intentos).length);

  // Y sobre la mano propia sigue habiendo un solo tiro.
  const propio1 = await capturar(() => pedir({ posicion: 0, clientActionId: "p1" }));
  const propio2 = await capturar(() => pedir({ posicion: 1, clientActionId: "p2" }));
  ok(propio1.valor?.anotado, "el primer intento sobre la mano propia entra", propio1.error?.message);
  ok(/Ya registraste/.test(propio2.error?.message ?? ""),
     "el segundo sobre la propia se rechaza", propio2.error?.message);

  // Y al cerrar, la mesa queda coherente.
  reloj = vence(v) + 1;
  await red.avanzarPartida({ codigo: C });
  reloj += MS_REVELACION;
  await red.avanzarPartida({ codigo: C });

  const fin = partida().estado;
  const ids = [
    ...fin.mazo.map((k) => k.id), ...fin.descarte.map((k) => k.id),
    ...fin.jugadores.flatMap((j) => j.mano.filter(Boolean).map((k) => k.id)),
    ...(fin.levantada ? [fin.levantada.id] : []),
  ];
  ok(ids.length === new Set(ids).size, "tras resolver todo, ninguna carta duplicada",
     ids.length - new Set(ids).size);
  ok(ids.length === 48, "y están las 48 de la baraja", ids.length);
  ok((fin.conocimientos ?? []).every((k) => fin.jugadores.some((j) => j.mano.some((x) => x?.id === k.idCarta))),
     "y ningún recuerdo apunta a una carta que ya no está en una mano");
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
