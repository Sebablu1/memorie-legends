/**
 * Buscar en la mano del rival: poderes 8 y 10, conocimiento y transferencia.
 *
 * La mecánica, en una frase: ver una carta ajena no es saber DÓNDE está.
 *
 * Un poder 8 o 10 deja saber que el rival tiene, por ejemplo, un 5. Cuando la
 * muestra sea un 5, se lo puede ir a buscar —pero a cualquiera de sus cuatro
 * posiciones, porque las cartas se mueven y la memoria falla—. Equivocarse
 * cuesta una carta y no borra lo que se sabe: se puede insistir, y cada error
 * vuelve a costar. Al acertar, la carta del rival se va al descarte y en su
 * lugar exacto queda una carta propia, elegida por posición y a ciegas: ni
 * quien la entrega sabe cuál era.
 *
 * Lo que se comprueba acá es sobre todo lo que NO pasa: que no aparezcan ni
 * desaparezcan cartas, que el número conocido no viaje nunca al navegador, y
 * que nadie pueda atacar una mano de la que no sabe nada.
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

/** Deja anotado que X vio una carta de Y, sin pasar por la fase de poder. */
const conSaber = (s, numero, origen = "poder8") => ({
  ...s,
  conocimientos: [{ actor: 0, objetivo: 1, numero, origen, ronda: s.ronda }],
});

const cuenta = (s, i) => s.jugadores[i].mano.filter(Boolean).length;
const todasLasCartas = (s) => [
  ...s.mazo.map((c) => c.id),
  ...s.descarte.map((c) => c.id),
  ...s.jugadores.flatMap((j) => j.mano.filter(Boolean).map((c) => c.id)),
  ...(s.levantada ? [s.levantada.id] : []),
];

// ================================================ 1. de dónde sale el saber

console.log("\n=== 1. El poder 8 deja saber, el 7 no ===");
{
  const s = { ...mesa(), fase: "poder", poderPendiente: { tipo: "mirarRival", numero: 8, indiceJugador: 0 } };
  const r = M.usarPoderMirar(s, 1, 1);   // X mira la posición 1 de Y: un 5

  ok(r.revelada?.carta?.numero === 5, "X ve la carta que miró", r.revelada?.carta?.numero);
  ok(r.estado.conocimientos.length === 1, "y queda anotado que sabe algo", r.estado.conocimientos);

  const c = r.estado.conocimientos[0];
  ok(c.actor === 0 && c.objetivo === 1, "quién sabe, y de quién");
  ok(c.numero === 5, "qué número", c.numero);
  ok(c.origen === "poder8", "de dónde salió", c.origen);
  ok(!("posicion" in c), "y NO se guarda la posición: ésa es toda la mecánica");

  // El 7 mira la carta propia: eso no autoriza nada contra nadie.
  //
  // Antes esto se comprobaba con `conocimientos.length === 0`, y dejó de valer
  // cuando el 7 empezó a dejar constancia de QUÉ vio —hace falta para que un 9
  // o un 10 le enseñen algo a quien los sufre. Lo que importaba nunca fue que
  // la lista estuviera vacía sino que no diera derechos, así que ahora se
  // afirma eso: la entrada existe, y no habilita a nadie contra nadie.
  const propio = { ...mesa(), fase: "poder", poderPendiente: { tipo: "mirarPropia", numero: 7, indiceJugador: 0 } };
  const r7 = M.usarPoderMirar(propio, 0, 0);

  ok(M.objetivosDe(r7.estado, 0).length === 0,
     "mirar una carta propia no autoriza a atacar a nadie", M.objetivosDe(r7.estado, 0));
  ok(r7.estado.conocimientos.every((c) => c.actor === c.objetivo),
     "y lo único que queda anotado es sobre uno mismo", r7.estado.conocimientos);

  const propia = r7.estado.conocimientos[0];
  ok(propia?.origen === "poder7", "con su origen", propia?.origen);
  ok(propia?.posicion === 0 && typeof propia?.idCarta === "string",
     "la posición y la carta concreta, que es lo que permite saber después si sigue ahí",
     propia);
}

console.log("\n=== 2. El 10 muestra, espera, y deja saber según lo que se decidió ===");
{
  // El 10 son DOS pasos. Primero muestra las dos cartas y se detiene: hasta
  // que su dueño no conteste no se mueve nada ni se sabe nada, porque todavía
  // no se sabe dónde va a quedar cada carta.
  const s = { ...mesa(), fase: "poder", poderPendiente: { tipo: "cambioConVista", numero: 10, indiceJugador: 0 } };
  const miCarta = s.jugadores[0].mano[2];        // Oro-3
  const suCarta = s.jugadores[1].mano[0];
  const visto = M.usarPoderCambio(s, 2, 1, 0);   // mi posición 2 por la 0 de Y

  ok(visto.estado.fase === "cambioConVista", "primero espera la decisión", visto.estado.fase);
  ok(visto.revelada?.propia?.id === miCarta.id && visto.revelada?.rival?.id === suCarta.id,
     "mostrando las dos cartas a quien lo usó");
  ok(visto.estado.jugadores[1].mano[0].id === suCarta.id, "sin haber movido nada todavía");
  ok((visto.estado.conocimientos ?? []).length === 0,
     "y sin anotar conocimiento: aún no se sabe dónde va a quedar cada carta");

  // Las POSICIONES quedan en el estado para poder resolver, nunca las cartas:
  // guardarlas ahí las pondría a un `vistaDe` mal escrito de toda la mesa.
  const p = visto.estado.cambioPendiente;
  ok(p && p.indiceJugador === 0 && p.indiceRival === 1,
     "el pendiente dice quién decide y sobre quién");
  ok(!JSON.stringify(p).includes(suCarta.id) && !JSON.stringify(p).includes(miCarta.id),
     "y NO guarda ninguna carta", p);

  // SI CAMBIA: la del rival pasa a ser propia, así que saberla ya no dice nada
  // de nadie. La que él entregó sí quedó en la mano ajena, y su número se vio.
  const cambio = M.resolverCambioConVista(visto.estado, true);
  ok(cambio.jugadores[1].mano[0].id === miCarta.id, "mi carta quedó en la mano de Y");
  ok(cambio.jugadores[0].mano[2].id === suCarta.id, "y la suya en la mía");
  const c = cambio.conocimientos[0];
  ok(c?.numero === miCarta.numero, "y sé que Y tiene ese número", c?.numero);
  ok(c?.origen === "poder10", "anotado como poder10", c?.origen);
  ok(cambio.fase === "postLevantada", "y vuelve a la decisión de cortar", cambio.fase);

  // SI NO CAMBIA: cada carta se queda donde estaba, y lo que sabe es la carta
  // del rival, que sigue siendo del rival. Derivarlo al revés le daría un
  // derecho sobre una carta que no está donde él cree.
  const sinCambiar = M.resolverCambioConVista(visto.estado, false);
  ok(sinCambiar.jugadores[1].mano[0].id === suCarta.id, "no cambiar deja todo donde estaba");
  ok(sinCambiar.jugadores[0].mano[2].id === miCarta.id, "en las dos manos");
  const c2 = sinCambiar.conocimientos[0];
  ok(c2?.numero === suCarta.numero,
     "y lo que sabe es la carta de Y, no la suya", { sabe: c2?.numero, deY: suCarta.numero });
  ok(c2?.origen === "poder10", "también anotado como poder10", c2?.origen);

  // Mientras dura la decisión, la mesa NO puede enterarse de qué posiciones
  // se están mirando. Decir "está mirando la segunda de Bruno" convierte el
  // poder en un anuncio público de dónde está lo que se vio, y serviría igual
  // si después decide no cambiar.
  {
    const V = await import("../public/js/reglas/vista.js");
    const paraElDuenio = V.vistaDe(visto.estado, 0).cambioPendiente;
    ok(paraElDuenio?.posicionPropia === 2 && paraElDuenio?.posicionRival === 0,
       "el dueño sí ve las posiciones: si recarga, no tiene otra forma de saberlas");

    for (const espectador of [1, 2]) {
      const v = V.vistaDe(visto.estado, espectador).cambioPendiente;
      ok(v?.indiceJugador === 0 && v?.indiceRival === 1,
         `el jugador ${espectador} ve quién decide y sobre quién`);
      ok(!("posicionPropia" in (v ?? {})) && !("posicionRival" in (v ?? {})),
         `pero el jugador ${espectador} NO ve las posiciones`, v);
    }
  }

  // El 9 cambia a ciegas: no se vio nada, no se sabe nada, y no espera a nadie.
  const s9 = { ...mesa(), fase: "poder", poderPendiente: { tipo: "cambioCiego", numero: 9, indiceJugador: 0 } };
  const r9 = M.usarPoderCambio(s9, 2, 1, 0);
  ok(r9.estado.fase === "postLevantada", "el 9 no pregunta nada", r9.estado.fase);
  ok((r9.estado.conocimientos ?? []).length === 0, "el 9 cambia a ciegas y no deja conocimiento");
  ok(r9.estado.jugadores[1].mano[0].id === miCarta.id, "pero sí cambia");
}

// ================================================== 3. la autorización

console.log("\n=== 3. Saber una carta habilita TODA la mano ===");
{
  const s = conSaber(mesa(), 5);

  ok(M.puedeAtacarA(s, 0, 1) === true, "X puede ir contra Y");
  ok(M.puedeAtacarA(s, 0, 2) === false, "pero no contra Z, de quien no sabe nada");
  ok(M.puedeAtacarA(s, 1, 0) === false, "y Y no puede ir contra X: el saber no es mutuo");
  ok(M.puedeAtacarA(s, 0, 0) === false, "nadie se ataca a sí mismo por esta vía");

  ok(JSON.stringify(M.objetivosDe(s, 0)) === "[1]", "los objetivos de X son sólo Y", M.objetivosDe(s, 0));
  ok(M.objetivosDe(s, 1).length === 0, "Y no tiene ninguno");

  // Sabe que hay un 5, no dónde: las cuatro posiciones quedan habilitadas.
  const habilitadas = s.jugadores[1].mano.map((_, p) => p).filter(() => M.puedeAtacarA(s, 0, 1));
  ok(habilitadas.length === 4, "las cuatro posiciones de Y quedan disponibles", habilitadas.length);

  // A un eliminado no se lo ataca.
  const conYFuera = { ...s, jugadores: s.jugadores.map((j, i) => (i === 1 ? { ...j, eliminado: true } : j)) };
  ok(M.puedeAtacarA(conYFuera, 0, 1) === false, "a un jugador eliminado no");
}

// ============================================ 4. equivocarse y seguir

console.log("\n=== 4. Equivocarse cuesta, pero no cancela la búsqueda ===");
{
  // Y = [7, 5, 3, 9]. El 5 está en la posición 1. X va a fallar tres veces.
  let s = conSaber(mesa(), 5);
  const antesX = cuenta(s, 0);
  const cartasAntes = todasLasCartas(s).length;

  s = M.intentarDescarteRival(s, 0, 1, 0, 0);   // Y[0] = 7 → error
  ok(s.ventanaDescarte.intentos.at(-1).resultado === "rivalError", "primer intento: error");
  ok(cuenta(s, 0) === antesX + 1, "X recibe una carta", cuenta(s, 0));
  ok(s.jugadores[1].mano[0].id === "Basto-7", "la carta de Y no se movió");
  ok(s.conocimientos.length === 1, "y sigue sabiendo que Y tiene un 5");

  s = M.intentarDescarteRival(s, 0, 1, 2, 0);   // Y[2] = 3 → error
  ok(cuenta(s, 0) === antesX + 2, "segundo error: otra carta más", cuenta(s, 0));

  s = M.intentarDescarteRival(s, 0, 1, 3, 0);   // Y[3] = 9 → error
  ok(cuenta(s, 0) === antesX + 3, "tercer error: y otra", cuenta(s, 0));
  ok(s.conocimientos.length === 1, "el conocimiento aguanta los tres errores");

  ok(s.ventanaDescarte.intentos.every((i) => i.carta), "las tres falladas se exponen a la mesa");
  ok(s.ventanaDescarte.intentos.length === 3, "y quedan los tres intentos anotados");

  // Cuarto intento: ahora sí.
  s = M.intentarDescarteRival(s, 0, 1, 1, 0);   // Y[1] = 5 → acierto
  ok(s.ventanaDescarte.intentos.at(-1).resultado === "rivalAcierto", "cuarto intento: acierto");
  ok(s.conocimientos.length === 0, "y el conocimiento se consume: el 5 ya no está ahí");

  ok(todasLasCartas(s).length === cartasAntes, "y en toda la mesa no se creó ni se perdió ninguna carta",
     { antes: cartasAntes, despues: todasLasCartas(s).length });
}

// ================================================ 5. la transferencia

console.log("\n=== 5. La transferencia: exacta, atómica y a ciegas ===");
{
  const s0 = conSaber(mesa(), 5);
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
  ok(cuenta(s, 0) === 3, "X queda con tres: entregó y no recibió castigo", cuenta(s, 0));

  ok(todasLasCartas(s).sort().join(",") === idsAntes, "ninguna carta duplicada ni perdida");
  ok(s.ventanaDescarte.intentos.at(-1).carta === null,
     "la carta entregada NO se expone: nadie la ve, ni quien la dio");
}

// ============================================== 6. lo que no se permite

console.log("\n=== 6. Sin conocimiento no hay derecho ===");
{
  const sinSaber = mesa();
  const igual = M.intentarDescarteRival(sinSaber, 0, 1, 1, 0);
  ok(igual === sinSaber, "sin conocimiento, el intento no cambia nada");

  // Conocer a Y no habilita a Z, aunque Z tenga la carta de la muestra.
  const soloY = conSaber(mesa(), 5);
  const contraZ = M.intentarDescarteRival(soloY, 0, 2, 0, 0);
  ok(contraZ === soloY, "conocer a Y no habilita contra Z");

  // Una posición vacía no es un objetivo.
  const conHueco = {
    ...soloY,
    jugadores: soloY.jugadores.map((j, i) =>
      i === 1 ? { ...j, mano: [null, ...j.mano.slice(1)] } : j),
  };
  ok(M.intentarDescarteRival(conHueco, 0, 1, 0, 0) === conHueco, "un hueco no se puede atacar");

  // No se puede entregar una carta que no se tiene.
  const sinEsa = {
    ...soloY,
    jugadores: soloY.jugadores.map((j, i) =>
      i === 0 ? { ...j, mano: [j.mano[0], null, null, null] } : j),
  };
  ok(M.intentarDescarteRival(sinEsa, 0, 1, 1, 2) === sinEsa,
     "no se puede entregar desde una posición vacía");

  // Fuera de la ventana no se ataca.
  const cerrada = { ...soloY, fase: "turno", ventanaDescarte: null };
  ok(M.intentarDescarteRival(cerrada, 0, 1, 1, 0) === cerrada, "fuera de la fase de descarte tampoco");
}

// ============================================ 7. lo que ve cada uno

console.log("\n=== 7. El permiso viaja; el número, jamás ===");
{
  const s = conSaber(mesa(), 5);

  const vistaX = V.vistaDe(s, 0);
  const vistaY = V.vistaDe(s, 1);
  const vistaZ = V.vistaDe(s, 2);

  ok(JSON.stringify(vistaX.puedeAtacar) === "[1]", "X ve que puede ir contra Y", vistaX.puedeAtacar);
  ok(vistaY.puedeAtacar.length === 0 && vistaZ.puedeAtacar.length === 0,
     "Y y Z no ven ningún objetivo");

  ok(!("conocimientos" in vistaX), "el modelo de conocimiento no viaja");
  ok(!JSON.stringify(vistaX).includes('"actor"'), "ni disfrazado bajo otro nombre");

  // Y sobre todo: la mano de Y sigue tapada para X.
  ok(vistaX.jugadores[1].mano.every((c) => c?.oculta),
     "X no ve ninguna carta de Y, ni siquiera la que conoce");

  for (const [quien, v] of [["X", vistaX], ["Y", vistaY], ["Z", vistaZ]]) {
    ok(V.filtracionesEn(v, s).length === 0, `la vista de ${quien} no filtra nada`,
       V.filtracionesEn(v, s));
  }
}

console.log("\n=== 8. Tras la transferencia, nadie sabe qué se entregó ===");
{
  const s0 = conSaber(mesa(), 5);
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
  ok(vX.puedeAtacar.length === 0, "y ya no puede seguir atacando: gastó lo que sabía");

  for (const i of [0, 1, 2]) {
    ok(V.filtracionesEn(V.vistaDe(s, i), s).length === 0, `sin filtraciones tras la transferencia (${i})`);
  }
}

// ============================================ 9. estado serializable

console.log("\n=== 9. El conocimiento sobrevive el viaje por Firestore ===");
{
  let s = conSaber(mesa(), 5);
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
  const { crearMotorEnRed, MS_MIRAR } = await import("../functions/partida-red.js");
  const { MS_VENTANA, MS_GRACIA } = await import("../public/js/reglas/red.js");
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

  await red.repartir({ codigo: C, jugadores: TRES, nombres: TRES });
  reloj += MS_MIRAR + 1;
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
    conoceRival: true, cartaConocida: 5, poder8: true,
  }));
  ok(mintiendo.error?.codigo === "permission-denied",
     "decir «yo tengo el poder» no autoriza nada", mintiendo.error?.message);

  // Contra un jugador que no existe.
  const fantasma = await capturar(() => pedir({
    posicion: 0, objetivo: "nadie", posicionEntrega: 0, clientActionId: "n3",
  }));
  ok(fantasma.error?.codigo === "not-found", "ni contra alguien que no juega", fantasma.error?.message);

  // Ahora sí: se le concede el conocimiento en el estado maestro.
  const p = partida();
  await db.runTransaction(async (tx) => {
    tx.set({ ruta: `partidas/${C}` }, {
      ...p,
      estado: { ...p.estado, conocimientos: [{ actor: 0, objetivo: 1, numero: 5, origen: "poder8", ronda: p.estado.ronda }] },
      version: p.version + 1,
    });
  });

  // Sin decir qué carta entrega, no vale.
  const sinEntrega = await capturar(() => pedir({ posicion: 0, objetivo: "y", clientActionId: "n4" }));
  ok(sinEntrega.error?.codigo === "invalid-argument",
     "hay que elegir una carta propia para entregar", sinEntrega.error?.message);

  // Varios intentos humanos sobre el rival: permitidos.
  const a = await capturar(() => pedir({ posicion: 0, objetivo: "y", posicionEntrega: 0, clientActionId: "r1" }));

  // Escribir el maestro a mano no republica las vistas —eso lo hace
  // `publicar`—, así que se comprueban después del primer intento, que sí
  // publica. Es además el camino real: la autorización llega con la vista.
  ok(vista("x").puedeAtacar.includes(1), "la vista de x lo autoriza contra y", vista("x").puedeAtacar);
  ok(vista("y").puedeAtacar.length === 0, "y no ve autorización ninguna");
  ok(!JSON.stringify(vista("x")).includes('"conocimientos"'), "y el número conocido no viaja");

  const b = await capturar(() => pedir({ posicion: 1, objetivo: "y", posicionEntrega: 1, clientActionId: "r2" }));
  const c = await capturar(() => pedir({ posicion: 2, objetivo: "y", posicionEntrega: 2, clientActionId: "r3" }));
  ok([a, b, c].every((r) => r.valor?.anotado),
     "tres intentos humanos distintos sobre el rival se anotan",
     [a, b, c].map((r) => r.error?.message ?? "ok"));

  // El mismo identificador, en cambio, es un reintento técnico.
  const repetido = await capturar(() => pedir({ posicion: 3, objetivo: "y", posicionEntrega: 3, clientActionId: "r1" }));
  ok(repetido.valor?.duplicado === true, "y el mismo identificador no agrega un cuarto");
  ok(Object.keys(partida().ventana.intentos).length === 3, "quedan tres, no cuatro",
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
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
