/**
 * El descarte al rival, contra su especificación.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA REGLA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Sólo se puede intentar sobre una carta del rival que se CONOCE. Se conoce
 * por un 8, por un 10, por el castigo de un error —que ven todos—, o porque
 * una carta que uno conocía pasó a su mano. El conocimiento viaja con la
 * carta cuando se mueve, y se pierde cuando sale de la mesa. El 7 nunca da
 * conocimiento de una carta ajena.
 *
 *   Acierto → la carta del rival se va, una propia elegida a ciegas ocupa su
 *             lugar, y quien atacó queda con una menos.
 *   Error   → la carta del rival queda, y quien atacó se come una de castigo
 *             que ven los cuatro.
 *
 * Mientras dure la ventana se puede intentar más de una vez.
 *
 * Cada sección es uno de los doce casos obligatorios, en el mismo orden. Del
 * 1 al 11 se prueban contra el motor, que es lo que corre la mesa de
 * entrenamiento; el 12 contra el servidor de las partidas en red.
 *
 * El caso 2 dice además «no elijo carta». Acá se comprueba lo que el motor ya
 * garantiza —al errar, la carta propia elegida no se mueve—; que la mesa no
 * la pida es del commit siguiente.
 */

import * as M from "../public/js/reglas/motor.js";
import * as V from "../public/js/reglas/vista.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

const carta = (palo, numero) => ({ id: `${palo}-${numero}`, palo, numero, puntos: numero });

const A = 0, B = 1, C = 2, D = 3;

/** Cuatro jugadores. La muestra es un 5; B tiene un 5 en la 1 y C en la 1. */
function mesa({ muestra = carta("Copa", 5) } = {}) {
  const base = M.empezarRonda(M.crearPartida(
    ["A", "B", "C", "D"].map((id) => ({ id, nombre: id })),
    { semilla: 7 },
  ));
  const manos = [
    [carta("Oro", 1), carta("Oro", 2), carta("Oro", 3), carta("Oro", 4)],
    [carta("Basto", 7), carta("Basto", 5), carta("Basto", 3), carta("Basto", 9)],
    [carta("Espada", 11), carta("Espada", 5), carta("Espada", 6), carta("Espada", 8)],
    [carta("Copa", 12), carta("Copa", 10), carta("Copa", 2), carta("Copa", 1)],
  ];
  const vista = { ...muestra, visible: true };
  const usadas = new Set([vista.id, ...manos.flat().map((c) => c.id)]);
  return {
    ...base,
    fase: "turno",
    descarte: [vista],
    mazo: base.mazo.filter((c) => !usadas.has(c.id)),
    jugadores: base.jugadores.map((j, i) => ({ ...j, mano: manos[i] })),
  };
}

/** La misma mesa, con la ventana de descarte abierta. */
const enVentana = (s) => ({
  ...s,
  fase: "descarte",
  ventanaDescarte: { huboPrimero: false, intentos: [] },
});

/** Un poder listo para usar. */
const conPoder = (s, tipo, numero, quien) => ({
  ...s,
  fase: "poder",
  poderPendiente: { tipo, numero, indiceJugador: quien },
});

/** `quien` usa un 8 sobre la carta de `objetivo` en `pos`. */
const ocho = (s, quien, objetivo, pos) =>
  M.usarPoderMirar(conPoder(s, "mirarRival", 8, quien), objetivo, pos).estado;

/** `quien` usa un 9: su `propia` por la `pos` de `objetivo`. */
const nueve = (s, quien, propia, objetivo, pos) =>
  M.usarPoderCambio(conPoder(s, "cambioCiego", 9, quien), propia, objetivo, pos).estado;

const cuenta = (s, i) => s.jugadores[i].mano.filter(Boolean).length;
const donde = (s, actor) => JSON.stringify(M.posicionesAtacablesDe(s, actor));
const en = (...pares) => JSON.stringify(pares.map(([objetivo, posicion]) => ({ objetivo, posicion })));

// ==================================================================== 1

console.log("\n=== 1. Acierto: la del rival se va, la mía ocupa su lugar, y quedo con una menos ===");
{
  const s = enVentana(ocho(mesa(), A, B, 1));             // A conoce el 5 de B
  const r = M.intentarDescarteRival(s, A, B, 1, 2);       // y entrega su posición 2

  ok(r.ventanaDescarte.intentos.at(-1)?.resultado === "rivalAcierto", "es un acierto");
  ok(r.descarte[0].id === "Basto-5", "la carta de B se fue al descarte", r.descarte[0].id);
  ok(r.jugadores[B].mano[1].id === "Oro-3", "la mía está en su lugar exacto", r.jugadores[B].mano[1].id);
  ok(r.jugadores[B].mano[1].visible === false, "boca abajo");
  ok(r.ventanaDescarte.intentos.at(-1).carta === null, "y no se muestra: fue a ciegas");
  ok(cuenta(r, A) === cuenta(s, A) - 1, "yo quedo con una menos", cuenta(r, A));
  ok(cuenta(r, B) === cuenta(s, B), "B queda con las mismas", cuenta(r, B));
}

// ==================================================================== 2

console.log("\n=== 2. Error: la del rival queda, me como una, y no entrego nada ===");
{
  const s = enVentana(ocho(mesa(), A, B, 0));             // A conoce el 7 de B
  const r = M.intentarDescarteRival(s, A, B, 0, 2);

  ok(r.ventanaDescarte.intentos.at(-1)?.resultado === "rivalError", "es un error");
  ok(r.jugadores[B].mano[0].id === "Basto-7", "la carta de B quedó donde estaba");
  ok(cuenta(r, A) === cuenta(s, A) + 1, "yo me como una", cuenta(r, A));
  ok(r.jugadores[A].mano[2]?.id === "Oro-3", "y mi carta no se movió: al errar no se entrega nada");
  ok(cuenta(r, B) === cuenta(s, B), "B no cambia", cuenta(r, B));
}

// ==================================================================== 3

console.log("\n=== 3. En la misma ventana se puede intentar más de una vez ===");
{
  let s = enVentana(ocho(ocho(mesa(), A, B, 0), A, B, 1));   // A conoce el 7 y el 5 de B
  const antes = cuenta(s, A);

  s = M.intentarDescarteRival(s, A, B, 0, 0);   // el 7: error
  s = M.intentarDescarteRival(s, A, B, 0, 0);   // otra vez: error
  ok(cuenta(s, A) === antes + 2, "dos errores, dos cartas", cuenta(s, A));
  s = M.intentarDescarteRival(s, A, B, 1, 0);   // el 5: acierto
  ok(cuenta(s, A) === antes + 1, "y un acierto, una menos", cuenta(s, A));

  const resultados = s.ventanaDescarte.intentos.map((i) => i.resultado);
  ok(JSON.stringify(resultados) === '["rivalError","rivalError","rivalAcierto"]',
     "los tres intentos quedaron anotados", resultados);
}

// ==================================================================== 4

console.log("\n=== 4. Sólo se puede intentar sobre una carta que conozco ===");
{
  const s = enVentana(ocho(mesa(), A, B, 1));             // sólo el 5 de B
  ok(donde(s, A) === en([B, 1]), "lo atacable es exactamente esa carta", M.posicionesAtacablesDe(s, A));

  for (const pos of [0, 2, 3]) {
    ok(M.intentarDescarteRival(s, A, B, pos, 0) === s, `la posición ${pos} de B, que no conozco: nada`);
  }
  ok(M.intentarDescarteRival(s, A, C, 1, 0) === s,
     "el 5 de C va con la muestra, pero no lo conozco: nada");

  const sinSaber = enVentana(mesa());
  ok(M.intentarDescarteRival(sinSaber, A, B, 1, 0) === sinSaber, "sin conocer nada, nada");
  ok(M.posicionesAtacablesDe(sinSaber, A).length === 0, "y no hay nada atacable");

  // Un recuerdo con la forma vieja —número y mano, sin `idCarta`— no habilita
  // nada. Tampoco sobre una carta sin `id`: ahí `undefined === undefined`
  // alcanzaba para inventar un derecho.
  const viejo = enVentana({ ...mesa(), conocimientos: [{ actor: A, objetivo: B, numero: 5, origen: "poder8" }] });
  ok(M.posicionesAtacablesDe(viejo, A).length === 0, "un recuerdo con la forma vieja no habilita nada");
  const sinId = {
    ...viejo,
    jugadores: viejo.jugadores.map((j, i) =>
      i === B ? { ...j, mano: j.mano.map(({ id, ...resto }) => resto) } : j),
  };
  ok(!M.puedeAtacarEn(sinId, A, B, 1), "ni sobre una carta sin id");
}

// ==================================================================== 5

console.log("\n=== 5. El 8 me hace conocer una carta del rival ===");
{
  const s = ocho(mesa(), A, C, 1);
  ok(M.conoceCarta(s, A, "Espada-5"), "conozco la carta que miré");
  ok(donde(s, A) === en([C, 1]), "y es la única atacable, donde está", M.posicionesAtacablesDe(s, A));
  ok(M.posicionesAtacablesDe(s, B).length === 0, "los demás no ganan nada");
}

// ==================================================================== 6

console.log("\n=== 6. El 10 me hace conocer las dos cartas ===");
{
  const visto = M.usarPoderCambio(conPoder(mesa(), "cambioConVista", 10, A), 0, B, 1).estado;
  ok(M.conoceCarta(visto, A, "Oro-1") && M.conoceCarta(visto, A, "Basto-5"),
     "al verlas, las conozco a las dos");

  const noCambia = M.resolverCambioConVista(visto, false);
  ok(donde(noCambia, A) === en([B, 1]), "si no cambio, puedo ir sobre la de B",
     M.posicionesAtacablesDe(noCambia, A));

  const cambia = M.resolverCambioConVista(visto, true);
  ok(cambia.jugadores[B].mano[1].id === "Oro-1", "si cambio, la mía queda en B");
  ok(donde(cambia, A) === en([B, 1]), "y puedo ir sobre ella: sé qué le dejé",
     M.posicionesAtacablesDe(cambia, A));
  ok(M.conoceCarta(cambia, A, "Basto-5"), "y sigo conociendo la que me llevé, ahora mía");
}

// ==================================================================== 7

console.log("\n=== 7. El 9 no muestra nada, pero se puede seguir una carta conocida ===");
{
  // a) Una carta propia conocida que le paso al rival.
  const miro = M.mirar(mesa(), A, 0);                     // A conoce su Oro-1
  const a = nueve(miro, A, 0, B, 2);
  ok(a.jugadores[B].mano[2].id === "Oro-1", "mi carta conocida quedó en B");
  ok(donde(a, A) === en([B, 2]), "y sé que la tiene ahí", M.posicionesAtacablesDe(a, A));

  // b) Una carta que vi con un 8, y que otro se lleva con un 9.
  const b = nueve(ocho(mesa(), A, B, 1), C, 0, B, 1);     // C se lleva el 5 de B
  ok(b.jugadores[C].mano[0].id === "Basto-5", "C se llevó el 5 de B");
  ok(donde(b, A) === en([C, 0]), "y lo sigo hasta la mano de C", M.posicionesAtacablesDe(b, A));

  // c) Una carta de castigo —que ven todos— que después se mueve con un 9.
  const fallo = M.intentarDescarte(enVentana(mesa()), B, 0);   // B falla con su 7
  const castigo = fallo.ventanaDescarte.intentos.at(-1).castigo;
  const cerrado = M.cerrarVentanaDescarte(fallo);
  const c = nueve(cerrado, D, 3, B, castigo.posicion);    // D se la lleva a su posición 3
  ok(c.jugadores[D].mano[3].id === castigo.carta.id, "D se llevó el castigo de B");
  ok(M.puedeAtacarEn(c, A, D, 3), "y lo sigo hasta la mano de D");
  ok(!M.puedeAtacarEn(c, A, B, castigo.posicion), "ya no está en la de B");
  ok(M.puedeAtacarEn(c, B, D, 3), "B también lo sigue: lo vio entrar en su mano");
}

// ==================================================================== 8

console.log("\n=== 8. La carta de castigo de un error la ven todos ===");
{
  // Descarte propio errado.
  const s = enVentana(mesa());
  const r = M.intentarDescarte(s, B, 0);                  // B falla con su 7
  const castigo = r.ventanaDescarte.intentos.at(-1).castigo;
  ok(castigo?.indiceJugador === B && castigo?.posicion === 4, "el castigo es de B, al final", castigo);

  for (const quien of [A, B, C, D]) {
    const v = V.vistaDe(r, quien);
    ok(v.jugadores[B].mano[castigo.posicion]?.id === castigo.carta.id,
       `el jugador ${"ABCD"[quien]} la ve`);
    ok(V.filtracionesEn(v, r).length === 0, `sin filtrar nada más (${"ABCD"[quien]})`);
    ok(M.conoceCarta(r, quien, castigo.carta.id), `y ${"ABCD"[quien]} la conoce desde ahora`);
  }
  ok([A, C, D].every((i) => M.puedeAtacarEn(r, i, B, castigo.posicion)),
     "los tres rivales pueden ir sobre ella");

  // Ataque errado: el castigo es de quien atacó, y también lo ven todos.
  const t = M.intentarDescarteRival(enVentana(ocho(mesa(), A, B, 0)), A, B, 0, 0);
  const suyo = t.ventanaDescarte.intentos.at(-1).castigo;
  ok(suyo?.indiceJugador === A, "al errar un ataque, el castigo es de quien atacó", suyo);
  ok(V.revelacionesDe(t).some((x) => x.indiceJugador === A && x.carta.id === suyo.carta.id),
     "y viaja entre las revelaciones de la mesa");
  ok([B, C, D].every((i) => M.puedeAtacarEn(t, i, A, suyo.posicion)), "y los demás pueden ir sobre él");

  // Un acierto tarde NO muestra el castigo: la regla habla de errar.
  const primero = M.intentarDescarte(enVentana(mesa()), B, 1);    // B descarta su 5: primero
  const tarde = M.intentarDescarte(primero, C, 1);                // C descarta su 5: tarde
  ok(tarde.ventanaDescarte.intentos.at(-1).resultado === "tarde", "C llegó tarde");
  ok(tarde.ventanaDescarte.intentos.at(-1).castigo === undefined, "y su castigo va boca abajo");
  const suCastigo = tarde.jugadores[C].mano.at(-1);
  ok(!M.conoceCarta(tarde, A, suCastigo.id), "nadie más lo conoce");
}

// ==================================================================== 9

console.log("\n=== 9. Si la carta se movió, la descarto donde está ahora ===");
{
  const movida = enVentana(nueve(ocho(mesa(), A, B, 1), C, 0, B, 1));   // el 5 de B, ahora en C
  const r = M.intentarDescarteRival(movida, A, C, 0, 3);

  ok(r.ventanaDescarte.intentos.at(-1)?.resultado === "rivalAcierto", "acierto en la posición nueva");
  ok(r.descarte[0].id === "Basto-5", "el 5 se fue al descarte");
  ok(r.jugadores[C].mano[0].id === "Oro-4", "y mi carta quedó en su lugar, en la mano de C");
  ok(M.intentarDescarteRival(movida, A, B, 1, 3) === movida,
     "en el lugar viejo ya no hay nada que atacar");
}

// ==================================================================== 10

console.log("\n=== 10. Si la carta salió de la mesa, pierdo la acción ===");
{
  // a) Su dueño la descartó primero.
  const sabe = enVentana(ocho(mesa(), A, B, 1));
  const laDescarto = M.intentarDescarte(sabe, B, 1);
  ok(laDescarto.jugadores[B].mano[1] === null, "B se descartó el 5");
  ok(M.posicionesAtacablesDe(laDescarto, A).length === 0, "y ya no tengo nada atacable");
  ok(!M.conoceCarta(laDescarto, A, "Basto-5"), "ni lo recuerdo");
  ok(M.intentarDescarteRival(laDescarto, A, B, 1, 0) === laDescarto, "intentar no hace nada");

  // b) Otro que también la conocía llegó antes.
  const dos = enVentana(ocho(ocho(mesa(), A, B, 1), C, B, 1));
  const ganoA = M.intentarDescarteRival(dos, A, B, 1, 0);
  ok(!M.conoceCarta(ganoA, C, "Basto-5"), "C ya no la conoce: salió de la mesa");
  ok(M.intentarDescarteRival(ganoA, C, B, 1, 0) === ganoA,
     "y sobre lo que quedó en ese lugar C no puede intentar");

  // c) Su dueño la cambió por la levantada.
  const levanto = { ...ocho(mesa(), A, B, 1), fase: "levantada", indiceTurno: B, levantada: carta("Oro", 12) };
  const cambio = M.cambiarCarta(levanto, 1);
  ok(!M.conoceCarta(cambio, A, "Basto-5"), "al cambiarla por la levantada, la dejo de conocer");
  ok(M.posicionesAtacablesDe(cambio, A).length === 0, "y la carta nueva no es atacable");
  ok(M.conoceCarta(cambio, B, "Oro-12"), "la levantada que se quedó la conoce su dueño");

  // d) Y si esa carta vuelve a entrar en una mano, el recuerdo viejo NO revive.
  //    B cambia su 7 —que A conocía— y el 7 va al descarte. Se acaba el mazo,
  //    se rebaraja, y a C le toca el 7 como castigo por llegar tarde.
  const conoceEl7 = { ...ocho(mesa(), A, B, 0), fase: "levantada", indiceTurno: B, levantada: carta("Oro", 12) };
  const tras = M.cambiarCarta(conoceEl7, 0);
  ok(tras.descarte[0].id === "Basto-7", "el 7 está en el descarte");
  const rebarajar = {
    ...tras,
    fase: "descarte",
    ventanaDescarte: { huboPrimero: true, intentos: [] },
    // Arriba un 6, abajo el 7. El mazo, vacío: el castigo sale del 7.
    descarte: [{ ...carta("Copa", 6), visible: true }, tras.descarte[0]],
    mazo: [],
  };
  const r = M.intentarDescarte(rebarajar, C, 2);          // C descarta su 6: tarde
  ok(r.jugadores[C].mano.at(-1)?.id === "Basto-7", "el 7 volvió a una mano, la de C");
  ok(!M.puedeAtacarEn(r, A, C, r.jugadores[C].mano.length - 1),
     "y A no puede ir sobre él: lo que sabía se borró cuando salió");
}

// ==================================================================== 11

console.log("\n=== 11. El 7 nunca da conocimiento de una carta ajena ===");
{
  const r = M.usarPoderMirar(conPoder(mesa(), "mirarPropia", 7, A), A, 2);
  ok(r.revelada?.carta?.id === "Oro-3", "miro mi carta");
  ok(M.posicionesAtacablesDe(r.estado, A).length === 0, "y no puedo atacar nada");
  ok(M.objetivosDe(r.estado, A).length === 0, "ni a nadie");
  ok(M.ventanaTrasPoder(r.estado, A) === r.estado, "así que no se abre la ventana tras el poder");

  // Y apuntarlo a otro no funciona: el 7 es sobre lo propio.
  const ajeno = M.usarPoderMirar(conPoder(mesa(), "mirarPropia", 7, A), B, 1);
  ok(ajeno.revelada === null, "un 7 sobre la mano de otro no muestra nada");
  ok(M.posicionesAtacablesDe(ajeno.estado, A).length === 0, "ni deja nada atacable");
}

// ==================================================================== 12

console.log("\n=== 12. En red, el servidor aplica la misma regla ===");
{
  const { crearMotorEnRed, MS_MIRAR } = await import("../functions/partida-red.js");
  const { MS_REVELACION } = await import("../public/js/reglas/vista.js");

  class E extends Error { constructor(c, m) { super(m); this.codigo = c; } }
  const error = (c, m) => new E(c, m);
  const capturar = async (f) => { try { return { valor: await f() }; } catch (e) { return { error: e }; } };
  const vence = (v) => v.abiertaEn + v.duracionMs + v.graciaMs;

  function firestore() {
    const docs = new Map(); let version = 0;
    return {
      docs,
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
  }

  const UIDS = ["a", "b", "c", "d"];
  const COD = "RIV012";

  /**
   * Una partida real, con la ventana de la ronda abierta, y una semilla en la
   * que algún rival de `a` tenga una carta que va con la muestra y otra que
   * no. Se busca en vez de fijarla: así la prueba no depende de un reparto
   * que cambie si cambia la baraja.
   */
  async function montar() {
    for (let semilla = 1; semilla < 200; semilla++) {
      const db = firestore();
      let reloj = 900000;
      const red = crearMotorEnRed({
        db, partidas: "partidas", ahora: () => reloj, idAleatorio: () => `v${reloj}`,
        marcaDeTiempo: () => "T", error, semillaDe: () => semilla,
      });
      await red.repartir({ yaSentados: true, codigo: COD, jugadores: UIDS, nombres: UIDS });
      reloj += MS_MIRAR + 1;
      await red.avanzarPartida({ codigo: COD });
      const p = db.docs.get(`partidas/${COD}`).datos;
      if (p.estado.fase !== "descarte") continue;

      const muestra = p.estado.descarte[0];
      for (const rival of [1, 2, 3]) {
        const mano = p.estado.jugadores[rival].mano;
        const va = mano.findIndex((k) => k && k.numero === muestra.numero);
        const noVa = mano.findIndex((k) => k && k.numero !== muestra.numero);
        if (va < 0 || noVa < 0) continue;
        return {
          db, red, rival, va, noVa,
          adelantar: (ms) => { reloj += ms; },
          fijar: (t) => { reloj = t; },
          partida: () => db.docs.get(`partidas/${COD}`).datos,
          vista: (u) => db.docs.get(`partidas/${COD}/vistas/${u}`).datos,
        };
      }
    }
    throw new Error("ninguna semilla dio un reparto útil");
  }

  const m = await montar();
  const { red, rival, va, noVa } = m;
  const p0 = m.partida();
  const v = p0.ventana;
  const deRival = p0.estado.jugadores[rival].mano;
  const miaAntes = p0.estado.jugadores[0].mano.filter(Boolean).length;
  const entregada = p0.estado.jugadores[0].mano[0];

  // a conoce las dos cartas del rival: como si hubiera usado un 8 dos veces.
  await m.db.runTransaction(async (tx) => {
    tx.set({ ruta: `partidas/${COD}` }, {
      ...p0,
      estado: {
        ...p0.estado,
        conocimientos: [va, noVa].map((i) => ({
          actor: 0, idCarta: deRival[i].id, origen: "poder8", ronda: p0.estado.ronda,
        })),
      },
      version: p0.version + 1,
    });
  });

  const pedir = (extra) => red.intentarDescarte({
    uid: "a", codigo: COD, windowId: v.id, declarado: 400, latencia: 30, incertidumbre: 15,
    objetivo: UIDS[rival], ...extra,
  });

  const otra = [0, 1, 2, 3].find((i) => i !== va && i !== noVa);
  const ajena = await capturar(() => pedir({ posicion: otra, posicionEntrega: 1, clientActionId: "x0" }));
  ok(ajena.error?.codigo === "permission-denied", "una carta que no conoce: rechazada",
     ajena.error?.message);

  const acierto = await capturar(() => pedir({ posicion: va, posicionEntrega: 0, clientActionId: "x1" }));
  const errado = await capturar(() => pedir({ posicion: noVa, posicionEntrega: 1, clientActionId: "x2" }));
  const otraVez = await capturar(() => pedir({ posicion: noVa, posicionEntrega: 1, clientActionId: "x3" }));
  ok([acierto, errado, otraVez].every((r) => r.valor?.anotado),
     "el acierto y dos errores se anotan: varios intentos en la ventana",
     [acierto, errado, otraVez].map((r) => r.error?.message ?? "ok"));

  const atacables = m.vista("a").puedeAtacarEn;
  ok(atacables.some((x) => x.objetivo === rival && x.posicion === va) &&
     atacables.some((x) => x.objetivo === rival && x.posicion === noVa) &&
     atacables.length === 2,
     "la vista de a marca esas dos cartas y ninguna otra", atacables);
  ok(UIDS.slice(1).every((u) => m.vista(u).puedeAtacarEn.length === 0),
     "las de los demás no marcan nada");

  // Se cierra la ventana.
  m.fijar(vence(v) + 1);
  await red.avanzarPartida({ codigo: COD });

  const resuelta = m.partida().estado;
  ok(resuelta.jugadores[rival].mano[va]?.id === entregada.id,
     "la carta de a quedó en el lugar de la acertada", resuelta.jugadores[rival].mano[va]?.id);
  ok(resuelta.jugadores[rival].mano[noVa]?.id === deRival[noVa].id,
     "la errada sigue en su lugar");
  const miaDespues = resuelta.jugadores[0].mano.filter(Boolean).length;
  ok(miaDespues === miaAntes - 1 + 2, "a: una menos por el acierto, dos más por los errores",
     { antes: miaAntes, despues: miaDespues });

  const castigos = resuelta.ventanaDescarte.intentos.map((i) => i.castigo).filter(Boolean);
  ok(castigos.length === 2, "dos castigos, uno por error", castigos.length);
  for (const u of UIDS) {
    const mano = m.vista(u).jugadores[0].mano;
    ok(castigos.every((k) => mano[k.posicion]?.id === k.carta.id),
       `${u} ve los dos castigos de a mientras dura la revelación`);
  }
  ok(castigos.every((k) => [0, 1, 2, 3].every((i) => M.conoceCarta(resuelta, i, k.carta.id))),
     "y los cuatro los conocen");

  // Pasada la revelación, las cartas se tapan pero lo conocido queda.
  m.adelantar(MS_REVELACION + 1);
  await red.avanzarPartida({ codigo: COD });
  const b = m.vista("b");
  ok(castigos.every((k) => b.jugadores[0].mano[k.posicion]?.oculta),
     "después se tapan");
  ok(castigos.every((k) => b.puedeAtacarEn.some((x) => x.objetivo === 0 && x.posicion === k.posicion)),
     "y b los sigue teniendo marcados como atacables");
  ok(V.filtracionesEn(b, m.partida().estado).length === 0, "sin filtraciones");
}

console.log(fallos ? `\n❌ ${fallos} FALLOS` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
