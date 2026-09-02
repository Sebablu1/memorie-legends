/**
 * Poner una carta de muestra abre los reflejos. Siempre.
 *
 * LA REGLA
 *
 * Cada vez que una carta queda arriba del descarte, la mesa tiene una ventana
 * para reaccionar a ella. Da igual cómo llegó ahí: tirando la levantada,
 * entregando una de la mano al cambiar, o tirando un poder.
 *
 * Cuando esa ventana cierra, el turno sigue siendo del que la puso: vuelve a
 * `postLevantada` —donde corta o pasa— o a `poder`, si lo que quedó de muestra
 * era un 7, 8, 9 o 10. Eso lo lleva `volverA` dentro de la ventana, y es lo
 * que la distingue de la del principio de la ronda, que sí desemboca en el
 * turno siguiente.
 *
 * LO QUE CAMBIÓ (y por qué esta suite se reescribió)
 *
 * Había dos excepciones y las dos se cayeron:
 *
 *   - CAMBIAR no reabría, con el argumento de que la muestra no cambiaba. Era
 *     falso: la carta que sale de la mano SÍ queda arriba del descarte. Ahora
 *     abre ventana como cualquier tiro.
 *   - Tirar un PODER salteaba la ventana e iba derecho a resolverlo. Eso le
 *     daba a las cartas de poder un atajo sin justificación: tirar un 7
 *     cambiaba la muestra igual que tirar un 3, pero sólo en un caso los demás
 *     podían aprovecharlo. Ahora el orden es siempre el mismo —reflejos de la
 *     mesa primero, poder del que tiró después— y por eso RENUNCIAR ya no
 *     reabre nada: la ventana ya ocurrió.
 *
 * Lo que no cambió: la ventana nueva es OTRA, con windowId distinto, para que
 * un intento de la anterior no se cuele en ésta.
 */

import * as M from "../public/js/reglas/motor.js";
import { crearMotorEnRed, MS_MIRAR } from "../functions/partida-red.js";
import { MS_VENTANA, MS_VENTANA_REAPERTURA, MS_GRACIA } from "../public/js/reglas/red.js";
import { MS_REVELACION } from "../public/js/reglas/vista.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

const carta = (palo, numero) => ({ id: `${palo}-${numero}`, palo, numero, puntos: numero });

/**
 * Mesa en `levantada`, con la carta levantada que se le indique.
 *
 * La carta se saca del mazo Y de las manos. Sacarla sólo del mazo dejaba
 * mesas imposibles: con semilla 4242 la mano de A empieza con el Copa-6, que
 * es justo la levantada de varias pruebas de acá, así que la misma carta
 * estaba en dos lugares. Una prueba llegó a fallar por eso y el motor no
 * tenía nada que ver.
 */
function mesaConLevantada(levantada) {
  const base = M.empezarRonda(M.crearPartida([
    { id: "A", nombre: "A" }, { id: "B", nombre: "B" },
  ], { semilla: 4242 }));

  const libres = base.mazo.filter((c) => c.id !== levantada.id);
  const jugadores = base.jugadores.map((j) => ({
    ...j,
    mano: j.mano.map((c) => (c?.id === levantada.id ? libres.shift() : c)),
  }));

  return {
    ...base,
    jugadores,
    fase: "levantada",
    indiceTurno: 0,
    levantada: { ...levantada, visible: true },
    ventanaDescarte: null,
    descarte: [{ ...carta("Oro", 4), visible: true }],
    mazo: libres,
  };
}

// ======================================================= 1. tirar reabre

console.log("\n=== 1. Tirar una carta común reabre los reflejos ===");
{
  const tirada = carta("Copa", 6);
  let s = mesaConLevantada(tirada);
  ok(s.descarte[0].numero === 4, "la muestra antes de tirar es un 4", s.descarte[0].numero);

  s = M.tirarCarta(s);

  ok(s.descarte[0].id === tirada.id, "la carta tirada es la muestra nueva", s.descarte[0].id);
  ok(s.levantada === null, "y deja de estar levantada");
  ok(s.fase === "descarte", "la fase vuelve a los reflejos", s.fase);
  ok(Boolean(s.ventanaDescarte), "con una ventana de descarte abierta");
  ok(s.ventanaDescarte.huboPrimero === false, "sin nadie que haya acertado todavía");
  ok(s.ventanaDescarte.intentos.length === 0, "y sin intentos heredados");
  ok(s.ventanaDescarte.volverA === "postLevantada",
     "que al cerrarse devuelve a su decisión, no al turno siguiente",
     s.ventanaDescarte.volverA);

  // El rival puede descartar sobre la muestra nueva. Antes no podía.
  const conSeis = { ...s, jugadores: s.jugadores.map((j, i) =>
    i === 1 ? { ...j, mano: [carta("Basto", 6), ...j.mano.slice(1)] } : j) };
  const tras = M.intentarDescarte(conSeis, 1, 0);
  ok(tras.ventanaDescarte.intentos.at(-1)?.resultado === "primero",
     "B descarta su 6 sobre la muestra recién tirada",
     tras.ventanaDescarte.intentos.at(-1)?.resultado);
  ok(tras.jugadores[1].mano[0] === null, "y se la saca de encima");
}

// ============================================ 2. el que tiró no pierde nada

console.log("\n=== 2. El que tiró conserva su decisión de cortar ===");
{
  let s = M.tirarCarta(mesaConLevantada(carta("Copa", 6)));
  const deQuien = s.indiceTurno;

  s = M.cerrarVentanaDescarte(s);
  ok(s.fase === "postLevantada", "cerrada la ventana, vuelve a postLevantada", s.fase);
  ok(s.indiceTurno === deQuien, "y sigue siendo su turno", s.indiceTurno);
  ok(s.ventanaDescarte === null, "sin ventana en pie");

  ok(M.puedeCortar(s) === true, "puede cortar");
  const trasPasar = M.pasarTurno(s);
  ok(trasPasar.indiceTurno !== deQuien, "o pasar, y ahí sí cambia el turno", trasPasar.indiceTurno);
}

// ================================= 3. los dos casos que ANTES no reabrian

console.log("\n=== 3. Cambiar también reabre, y un poder también ===");
{
  // CAMBIAR: la levantada va a la mano, pero la carta que sale de la mano
  // queda de muestra. Que la muestra cambie es lo único que importa.
  const s = mesaConLevantada(carta("Copa", 6));
  const muestraAntes = s.descarte[0].id;
  const entregada = s.jugadores[0].mano[0];
  const cambiado = M.cambiarCarta(s, 0);

  ok(cambiado.descarte[0].id === entregada.id,
     "la muestra la pone la carta que salió de la mano, no la levantada",
     cambiado.descarte[0].id);
  ok(cambiado.descarte[0].id !== muestraAntes, "y de verdad cambió");
  ok(cambiado.jugadores[0].mano[0].id !== entregada.id,
     "la levantada ocupó su lugar en la mano");

  ok(cambiado.fase === "descarte", "cambiar abre reflejos", cambiado.fase);
  ok(cambiado.ventanaDescarte?.volverA === "postLevantada",
     "y desemboca en la decisión de cortar",
     cambiado.ventanaDescarte?.volverA);

  // LA REGLA: el poder sale de la carta que se LEVANTA DEL MAZO y de ninguna
  // otra. Las cartas repartidas boca abajo no son poderes; un 7 en la mano son
  // siete puntos.
  //
  // Esto estuvo al revés y la prueba anterior no lo veía: derivaba lo esperado
  // de `esPoder(entregada)`, así que daba verde con la regla vieja Y con la
  // nueva. Pasaba por la carta que traía el fixture, no por la regla. Ahora se
  // afirma el caso que importa, con un poder puesto a mano.
  for (const numero of [7, 8, 9, 10]) {
    const conPoderEnMano = {
      ...s,
      jugadores: s.jugadores.map((j, i) =>
        i === 0 ? { ...j, mano: [carta("Oro", numero), ...j.mano.slice(1)] } : j,
      ),
    };
    const entregandoPoder = M.cambiarCarta(conPoderEnMano, 0);
    ok(entregandoPoder.ventanaDescarte?.volverA === "postLevantada",
       `entregar un ${numero} de la mano NO activa su poder`,
       entregandoPoder.ventanaDescarte?.volverA);
    ok(entregandoPoder.poderPendiente == null,
       `y el ${numero} entregado no deja poder pendiente`, entregandoPoder.poderPendiente);
    ok(entregandoPoder.descarte[0].numero === numero,
       `pero sí queda de muestra, como cualquier carta`);
  }

  // La misma carta, levantada del mazo, SÍ activa. La diferencia no está en la
  // carta ni en dónde termina: está en de dónde vino.
  const mismoSieteDelMazo = M.tirarCarta(mesaConLevantada(carta("Oro", 7)));
  ok(mismoSieteDelMazo.ventanaDescarte?.volverA === "poder",
     "el mismo 7, levantado del mazo, sí activa");

  // Una posición vacía no pone muestra nueva: no hay a qué reaccionar.
  const manoConHueco = { ...s, jugadores: s.jugadores.map((j, i) =>
    i === 0 ? { ...j, mano: [null, ...j.mano.slice(1)] } : j) };
  const sinCarta = M.cambiarCarta(manoConHueco, 0);
  ok(sinCarta.fase === "postLevantada",
     "cambiar contra un hueco no abre ventana: no hay muestra nueva", sinCarta.fase);
  ok(!sinCarta.ventanaDescarte, "y no deja ninguna colgada");

  // PODER: ahora la mesa reacciona ANTES de que el poder se resuelva.
  for (const numero of [7, 8, 9, 10]) {
    const conPoder = M.tirarCarta(mesaConLevantada(carta("Espada", numero)));
    ok(conPoder.fase === "descarte", `tirar un ${numero} abre reflejos primero`, conPoder.fase);
    ok(conPoder.ventanaDescarte?.volverA === "poder",
       `y el ${numero} desemboca en su poder`, conPoder.ventanaDescarte?.volverA);
    ok(conPoder.poderPendiente?.numero === numero,
       `el ${numero} queda anotado desde el tiro`, conPoder.poderPendiente);

    // Se anota en el tiro y no al cerrar: durante la ventana alguien puede
    // acertar y su carta pasa a ser la cima. Preguntarle después al descarte
    // qué poder tocaba daría el de OTRA carta.
    const otroAcierta = { ...conPoder, descarte: [
      { ...carta("Oro", 3), visible: true }, ...conPoder.descarte] };
    const cerrada = M.cerrarVentanaDescarte(otroAcierta);
    ok(cerrada.fase === "poder", `el ${numero} llega a su poder`, cerrada.fase);
    ok(cerrada.poderPendiente?.numero === numero,
       `y sigue siendo el ${numero} aunque la muestra haya cambiado`,
       cerrada.poderPendiente?.numero);
  }
}

// ============================================== 4. la ventana de la ronda

console.log("\n=== 4. La ventana de la ronda sigue desembocando en el turno ===");
{
  // La que abre `terminarMirada` no lleva `volverA`, así que cierra al turno.
  let s = M.terminarMirada(M.empezarRonda(M.crearPartida([
    { id: "A", nombre: "A" }, { id: "B", nombre: "B" },
  ], { semilla: 7 })));
  ok(s.fase === "descarte", "la ronda arranca con su ventana", s.fase);
  ok(s.ventanaDescarte.volverA === undefined, "que no lleva volverA");
  s = M.cerrarVentanaDescarte(s);
  ok(s.fase === "turno", "y cierra al turno, como siempre", s.fase);
}

// ================================================== 5. en red, de punta a punta

console.log("\n=== 5. En red: tirar abre una ventana NUEVA ===");
{
  class E extends Error { constructor(c, m) { super(m); this.codigo = c; } }
  const error = (c, m) => new E(c, m);
  const docs = new Map(); let version = 0;
  const db = {
    collection: (n) => ({ doc: (id = `a${Math.random()}`) => ({ ruta: `${n}/${id}` }) }),
    async runTransaction(cuerpo) {
      for (let i = 0; i < 10; i++) {
        const leidas = new Map(); const esc = []; let e0 = false;
        const tx = {
          async get(ref) {
            if (e0) throw error("invalid-argument", "Lectura tras escritura");
            const d = docs.get(ref.ruta); leidas.set(ref.ruta, d ? d.version : 0);
            return { exists: Boolean(d), data: () => (d ? structuredClone(d.datos) : undefined) };
          },
          set(ref, datos, op) { e0 = true; esc.push({ ruta: ref.ruta, datos, m: Boolean(op?.merge) }); },
          update(ref, datos) { e0 = true; esc.push({ ruta: ref.ruta, datos, m: true }); },
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
  let reloj = 800000;
  const red = crearMotorEnRed({
    db, partidas: "partidas", ahora: () => reloj, idAleatorio: () => `v${reloj}_${version}`,
    marcaDeTiempo: () => "T", error, semillaDe: () => 555,
  });
  const C = "TIR001", DOS = ["ana", "beto"];
  const partida = () => docs.get(`partidas/${C}`).datos;
  const vence = (v) => v.abiertaEn + v.duracionMs + v.graciaMs;

  await red.repartir({ codigo: C, jugadores: DOS, nombres: DOS });
  const primera = partida().ventana;

  // Se atraviesa la ventana de la ronda sin que nadie descarte.
  reloj += MS_MIRAR + 1;
  await red.avanzarPartida({ codigo: C });
  reloj = vence(primera) + 1;
  await red.avanzarPartida({ codigo: C });
  reloj += MS_REVELACION;
  await red.avanzarPartida({ codigo: C });
  ok(partida().estado.fase === "turno", "la ronda llega a los turnos", partida().estado.fase);

  const enTurno = DOS[partida().estado.indiceTurno];
  await red.accionDeTurno({ uid: enTurno, codigo: C, accion: "levantar", clientActionId: "L1" });

  // Si la levantada trae poder, se salta: eso ya se probó arriba.
  if (partida().estado.levantada && !M.esPoder(partida().estado.levantada)) {
    await red.accionDeTurno({ uid: enTurno, codigo: C, accion: "tirar", clientActionId: "T1" });

    const p = partida();
    ok(p.estado.fase === "descarte", "tirar deja la partida en reflejos", p.estado.fase);
    ok(Boolean(p.ventana) && !p.ventana.cerrada, "con una ventana de red abierta");
    ok(p.ventana.id !== primera.id, "que NO es la de la ronda", [p.ventana.id, primera.id]);
    ok(p.ventana.abiertaEn === reloj, "abierta en el instante del tiro", p.ventana.abiertaEn - reloj);
    // Dura lo de una reapertura, que es MENOS que la de la ronda: la de la
    // ronda cubre además la mirada (MS_MIRAR + MS_VENTANA) y da cinco segundos
    // para buscar en cuatro manos; acá la mesa ya está mirando la muestra.
    ok(p.ventana.duracionMs === MS_VENTANA_REAPERTURA,
       "y dura lo de una reapertura, no lo de la ronda",
       [p.ventana.duracionMs, MS_VENTANA_REAPERTURA, MS_VENTANA]);
    ok(p.ventana.duracionMs < MS_VENTANA, "que es estrictamente más corta");
    ok(p.plazo.que === "cerrarVentana", "con su plazo de cierre", p.plazo.que);

    // Un intento con el windowId viejo no se cuela.
    const viejo = await (async () => { try {
      return { ok: await red.intentarDescarte({ uid: "beto", codigo: C, windowId: primera.id,
        posicion: 0, clientActionId: "viejo", declarado: 300, latencia: 30, incertidumbre: 15 }) };
    } catch (e) { return { err: e.message }; } })();
    ok(/otra ronda/i.test(viejo.err ?? ""), "y un intento de la ventana vieja se rechaza", viejo.err);

    // Al cerrarse vuelve a la decisión del que tiró.
    reloj = vence(p.ventana) + 1;
    await red.avanzarPartida({ codigo: C });
    reloj += MS_REVELACION;
    await red.avanzarPartida({ codigo: C });
    ok(partida().estado.fase === "postLevantada",
       "cerrada, vuelve a su decisión de cortar", partida().estado.fase);
    ok(DOS[partida().estado.indiceTurno] === enTurno, "y sigue siendo su turno");
  } else {
    ok(true, "(esta vez la levantada trajo poder; el caso va abajo igual)");
  }

  // --- el poder, en red, de punta a punta ---
  //
  // Este caso quedaba sin cubrir: la sección 3 prueba el motor puro y ésta
  // salteaba el poder cuando el azar lo traía. Es justo el camino nuevo —la
  // ventana ocurre ANTES de resolver el poder— así que hay que verlo en red,
  // que es donde el plazo lo lleva el servidor y no el navegador.
  {
    const antes = partida();
    const enTurnoAhora = DOS[antes.estado.indiceTurno];

    // Se fuerza una levantada con poder en vez de esperar a que salga sola.
    // La carta se SACA del mazo: inventarla dejaba la misma carta en dos
    // lugares, y el detector de filtraciones lo cazó al publicar la vista
    // —"la carta Espada-8 del mazo aparece en la vista"—. Hizo exactamente su
    // trabajo, sobre un error del fixture y no del motor.
    const conPoder = antes.estado.mazo.find((c) => M.esPoder(c));
    ok(Boolean(conPoder), "hay una carta de poder en el mazo para la prueba");

    await db.runTransaction(async (tx) => {
      tx.set({ ruta: `partidas/${C}` }, {
        ...antes,
        estado: {
          ...antes.estado,
          fase: "levantada",
          levantada: { ...conPoder, visible: true },
          mazo: antes.estado.mazo.filter((c) => c.id !== conPoder.id),
          ventanaDescarte: null,
        },
        ventana: { ...antes.ventana, cerrada: true },
        version: (antes.version ?? 1) + 1,
      });
    });

    await red.accionDeTurno({ uid: enTurnoAhora, codigo: C, accion: "tirar", clientActionId: "T8" });
    const tras = partida();
    ok(tras.estado.fase === "descarte",
       "en red, tirar un poder abre reflejos primero", tras.estado.fase);
    ok(tras.estado.ventanaDescarte?.volverA === "poder",
       "con la ventana apuntando al poder", tras.estado.ventanaDescarte?.volverA);
    ok(tras.estado.poderPendiente?.numero === conPoder.numero,
       "y el poder ya anotado desde el tiro", tras.estado.poderPendiente);
    ok(Boolean(tras.ventana) && !tras.ventana.cerrada && tras.ventana.id !== primera.id,
       "y una ventana de red nueva para ella", tras.ventana?.id);

    // El servidor la cierra por plazo, no el navegador.
    reloj = vence(tras.ventana) + 1;
    await red.avanzarPartida({ codigo: C });
    reloj += MS_REVELACION;
    await red.avanzarPartida({ codigo: C });
    ok(partida().estado.fase === "poder",
       "cerrada por el servidor, recién ahí aparece el poder", partida().estado.fase);
    ok(DOS[partida().estado.indiceTurno] === enTurnoAhora,
       "y el poder es del que lo tiró", DOS[partida().estado.indiceTurno]);

    // Renunciar en red tampoco abre una segunda ventana.
    const ventanaAntesDeSaltar = partida().ventana?.id ?? null;
    await red.accionDeTurno({ uid: enTurnoAhora, codigo: C, accion: "saltarPoder", clientActionId: "S8" });
    ok(partida().estado.fase === "postLevantada",
       "renunciar va derecho a la decisión de cortar", partida().estado.fase);
    ok((partida().ventana?.id ?? null) === ventanaAntesDeSaltar,
       "sin abrir una segunda ventana de red");
  }
}

// =========================== 6. renunciar al poder ya NO reabre

/**
 * Renunciar no abre una segunda ventana, y ése es el cambio.
 *
 * Antes sí lo hacía, y tenía sentido mientras los poderes salteaban la
 * ventana: si el poder no la abría, había que devolvérsela a la mesa cuando su
 * dueño renunciaba, o tirar un poder y renunciar habría sido la forma de
 * cambiar la muestra sin que nadie la aprovechara.
 *
 * Ese agujero ya no existe, porque la ventana ocurre ANTES de la decisión.
 * La mesa reaccionó al 7 apenas se tiró. Reabrirla al renunciar sería darle
 * dos oportunidades por la misma carta.
 */
console.log("\n=== 6. Renunciar al poder no da una segunda ventana ===");
{
  for (const numero of [7, 8, 9, 10]) {
    const tirada = carta("Espada", numero);
    let s = M.tirarCarta(mesaConLevantada(tirada));
    ok(s.fase === "descarte", `el ${numero} abre reflejos antes de nada`, s.fase);
    ok(s.descarte[0].id === tirada.id, `y ya es la muestra`, s.descarte[0].id);

    // La mesa tuvo su ventana. Ahora se cierra y recién ahí aparece el poder.
    s = M.cerrarVentanaDescarte(s);
    ok(s.fase === "poder", `cerrada la ventana, el ${numero} ofrece su poder`, s.fase);

    s = M.saltarPoder(s);
    ok(s.fase === "postLevantada",
       `renunciar al ${numero} va derecho a la decisión de cortar`, s.fase);
    ok(s.poderPendiente === null, `sin poder pendiente tras el ${numero}`);
    ok(s.ventanaDescarte == null,
       `y el ${numero} no abre una segunda ventana`, s.ventanaDescarte);
  }

  // Usar el poder también termina en la decisión de cortar.
  const conVentana = M.tirarCarta(mesaConLevantada(carta("Espada", 7)));
  const usado = M.usarPoderMirar(M.cerrarVentanaDescarte(conVentana), 0, 0);
  ok(usado.estado.fase === "postLevantada",
     "usar el poder también termina en la decisión", usado.estado.fase);
  ok(usado.estado.registro.at(-1)?.tipo === "miroCarta",
     "y deja anotado en el registro que se miró una carta",
     usado.estado.registro.at(-1));
  ok(!/\d/.test(usado.estado.registro.at(-1)?.texto?.replace(/poder \d/, "") ?? ""),
     "sin filtrar el número de la carta mirada",
     usado.estado.registro.at(-1)?.texto);
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
