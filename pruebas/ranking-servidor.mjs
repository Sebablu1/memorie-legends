/**
 * El ranking se escribe desde el servidor, una sola vez por partida.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE DEFIENDE ACÁ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Cinco cosas:
 *
 *   1. Que las tres tablas se escriban. Estaban vacías porque nadie llamaba a
 *      `registrarPartida`, y el cierre mensual repartía una remera entre cero
 *      jugadores.
 *   2. Que una partida NO se pueda puntuar dos veces. Un reintento de red
 *      duplicaría los puntos, y los puntos son el premio.
 *   3. Que el entrenamiento contra la IA no entre. Si entrara, el ranking lo
 *      ganaría quien más partidas jugara solo contra el robot.
 *   4. Que quien abandona no sume. Ya quedó fuera del reparto del pozo;
 *      dejarlo sumar puntos sería premiarlo por irse.
 *   5. Que la raya de victorias se lea ANTES y se escriba después, y que el
 *      bono de racha se cobre recién a la tercera seguida.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL FIRESTORE ES DE MENTIRA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque lo que hay que verificar es el ORDEN dentro de la transacción: acá se
 * leen tres filas por jugador y recién después se escribe. Con cuatro
 * jugadores son doce lecturas y trece escrituras, y si una lectura se cuela
 * después de la primera escritura, Firestore aborta en producción y acá no se
 * vería. El falso Firestore se queja igual que el de verdad.
 */

import { crearRankingDePartidas } from "../functions/ranking.js";
import {
  clavesDePeriodos,
  PERIODOS,
  PUNTOS_RANKING,
  RAYA_MINIMA,
  ZONA_POR_DEFECTO,
} from "../public/js/reglas/ranking.js";
import { BONOS_APUESTA } from "../public/js/reglas/economia.js";
import { ENTRADAS } from "../public/js/reglas/salas.js";
import { premioFisicoDe, umbralesValidos } from "../public/js/reglas/configuracion.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else {
    fallos++;
    console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : "");
  }
};

/** Firestore de mentira que se queja si alguien lee después de escribir. */
function crearFirestore(inicial = {}) {
  const docs = new Map(Object.entries(inicial));

  const coleccion = (prefijo) => ({
    doc: (id) => documento(`${prefijo}/${id}`),
  });

  const documento = (ruta) => ({
    ruta,
    id: ruta.split("/").pop(),
    collection: (sub) => coleccion(`${ruta}/${sub}`),
    async get() {
      const d = docs.get(ruta);
      return { exists: Boolean(d), id: ruta.split("/").pop(), data: () => (d ? { ...d } : undefined) };
    },
    async set(datos, opciones) {
      docs.set(ruta, opciones?.merge ? { ...(docs.get(ruta) ?? {}), ...datos } : datos);
    },
  });

  return {
    collection: coleccion,
    async runTransaction(cuerpo) {
      let escribio = false;
      const pendientes = [];
      const r = await cuerpo({
        async get(ref) {
          if (escribio) throw new Error("Lectura después de escritura");
          const d = docs.get(ref.ruta);
          return { exists: Boolean(d), data: () => (d ? { ...d } : undefined) };
        },
        set(ref, datos, opciones) {
          escribio = true;
          pendientes.push([ref.ruta, datos, opciones?.merge]);
        },
      });
      for (const [ruta, datos, fusionar] of pendientes) {
        docs.set(ruta, fusionar ? { ...(docs.get(ruta) ?? {}), ...datos } : datos);
      }
      return r;
    },
    _leer: (r) => docs.get(r),
    _rutas: () => [...docs.keys()],
  };
}

const FECHA = new Date("2026-09-07T15:00:00Z");
const CLAVES = clavesDePeriodos(FECHA, ZONA_POR_DEFECTO);

function montar(inicial = {}) {
  const db = crearFirestore(inicial);
  const ranking = crearRankingDePartidas({
    db,
    marcaDeTiempo: () => "T",
    ahora: () => FECHA,
  });
  return { db, ranking };
}

/**
 * Un estado final de partida, del tamaño mínimo que el motor necesita.
 *
 * `resumenPartida` sólo usa `ronda`, `ganador` y `eventos`, más lo que
 * `posicionesFinales` saca de `jugadores`. Se arma a mano en vez de jugar una
 * partida entera porque lo que se prueba acá es la ESCRITURA, no el motor —
 * eso ya lo prueban `puntaje.mjs` y `partida-completa.spec.js`.
 */
function estadoFinal({ jugadores, ganadorId, eventos = [] }) {
  return {
    ronda: 4,
    ganador: ganadorId ? { id: ganadorId } : null,
    eventos,
    jugadores: jugadores.map((j, i) => ({
      indice: i,
      id: j.id,
      nombre: j.nombre ?? j.id,
      puntos: j.puntos,
      esIA: Boolean(j.esIA),
      eliminado: false,
      cartas: [],
    })),
  };
}

const CUATRO = [
  { id: "ana", puntos: 20 },
  { id: "beto", puntos: 45 },
  { id: "caro", puntos: 70 },
  { id: "dani", puntos: 110 },
];

// =====================================================================
console.log("\n=== 1. Una partida de pago llena las tres tablas ===");
// =====================================================================

{
  const { db, ranking } = montar();
  const r = await ranking.registrarPartida({
    codigo: "ABC234",
    estado: estadoFinal({ jugadores: CUATRO, ganadorId: "ana" }),
    entrada: 50,
  });

  ok(r.length === 4, "puntúa a los cuatro", r.length);

  for (const periodo of PERIODOS) {
    const fila = db._leer(`rankings/${CLAVES[periodo]}/jugadores/ana`);
    ok(Boolean(fila), `escribe la tabla ${periodo}`, CLAVES[periodo]);
    ok(fila?.partidasJugadas === 1, `  con una partida jugada`, fila?.partidasJugadas);
    ok(fila?.partidasGanadas === 1, `  y una ganada`, fila?.partidasGanadas);
    ok(fila?.puntos > 0, `  y puntos de verdad`, fila?.puntos);
  }

  // El que salió último también entra a la tabla: el ranking cuenta a todos,
  // no sólo a los que cobraron.
  const ultimo = db._leer(`rankings/${CLAVES.mensual}/jugadores/dani`);
  ok(Boolean(ultimo), "el último también aparece en la tabla");
  ok(ultimo?.partidasGanadas === 0, "  sin victorias", ultimo?.partidasGanadas);

  // Y el guardián, que es lo que impide sumar dos veces.
  ok(Boolean(db._leer("partidasPuntuadas/ABC234")), "deja el guardián de la partida");
  ok(db._leer("partidasPuntuadas/ABC234").ganadorId === "ana", "  con quién ganó");
}

// =====================================================================
console.log("\n=== 2. La misma partida no se puntúa dos veces ===");
// =====================================================================

{
  const { db, ranking } = montar();
  const partida = {
    codigo: "ABC234",
    estado: estadoFinal({ jugadores: CUATRO, ganadorId: "ana" }),
    entrada: 50,
  };

  await ranking.registrarPartida(partida);
  const puntosTrasLaPrimera = db._leer(`rankings/${CLAVES.mensual}/jugadores/ana`).puntos;

  // Un reintento de red: la misma llamada, otra vez.
  await ranking.registrarPartida(partida);
  const despues = db._leer(`rankings/${CLAVES.mensual}/jugadores/ana`);

  ok(despues.puntos === puntosTrasLaPrimera, "los puntos no se duplican", {
    antes: puntosTrasLaPrimera,
    despues: despues.puntos,
  });
  ok(despues.partidasJugadas === 1, "ni la cuenta de partidas", despues.partidasJugadas);
}

// =====================================================================
console.log("\n=== 3. El entrenamiento contra la IA NO entra ===");
// =====================================================================

{
  const { db, ranking } = montar();

  // Sin entrada no hay apuesta, y sin apuesta no hay ranking. Si entrara, la
  // tabla la ganaría quien más partidas jugara solo contra el robot.
  const r = await ranking.registrarPartida({
    codigo: "ENTRENO",
    estado: estadoFinal({ jugadores: CUATRO, ganadorId: "ana" }),
    entrada: 0,
  });

  ok(r.length === 0, "una partida sin entrada no puntúa", r);
  ok(db._rutas().length === 0, "y no escribe absolutamente nada", db._rutas());
}

{
  // Con entrada, pero contra la IA: los robots no tienen perfil.
  const { db, ranking } = montar();
  await ranking.registrarPartida({
    codigo: "MIXTA",
    estado: estadoFinal({
      jugadores: [
        { id: "ana", puntos: 20 },
        { id: "ia-1", puntos: 50, esIA: true },
        { id: "ia-2", puntos: 80, esIA: true },
      ],
      ganadorId: "ana",
    }),
    entrada: 50,
  });

  ok(Boolean(db._leer(`rankings/${CLAVES.mensual}/jugadores/ana`)), "la humana puntúa");
  ok(!db._leer(`rankings/${CLAVES.mensual}/jugadores/ia-1`), "y las IA no");
}

// =====================================================================
console.log("\n=== 4. Quien abandonó no suma ===");
// =====================================================================

{
  const { db, ranking } = montar();
  await ranking.registrarPartida({
    codigo: "ABAND",
    estado: estadoFinal({ jugadores: CUATRO, ganadorId: "ana" }),
    entrada: 50,
    abandonaron: ["dani"],
  });

  ok(Boolean(db._leer(`rankings/${CLAVES.mensual}/jugadores/ana`)), "los que se quedaron suman");
  ok(
    !db._leer(`rankings/${CLAVES.mensual}/jugadores/dani`),
    "y el que se fue no aparece en la tabla",
  );
}

// =====================================================================
console.log("\n=== 5. La raya de victorias se lee antes y se guarda después ===");
// =====================================================================

{
  const { db, ranking } = montar();
  await ranking.registrarPartida({
    codigo: "R1",
    estado: estadoFinal({ jugadores: CUATRO, ganadorId: "ana" }),
    entrada: 50,
  });

  ok(db._leer("jugadores/ana/rachas/actual").raya === 1, "el ganador arranca su raya");
  ok(db._leer("jugadores/beto/rachas/actual").raya === 0, "y al que perdió se le corta");
}

{
  // La tercera seguida cobra el bono; la segunda todavía no.
  const conRaya = (n) => ({ "jugadores/ana/rachas/actual": { raya: n } });

  const dos = montar(conRaya(1));
  const rDos = await dos.ranking.registrarPartida({
    codigo: "R2",
    estado: estadoFinal({ jugadores: CUATRO, ganadorId: "ana" }),
    entrada: 50,
  });
  const anaDos = rDos.find((x) => x.jugadorId === "ana");
  ok(anaDos.rayaNueva === 2, "con una previa, la nueva raya es 2", anaDos.rayaNueva);
  ok(anaDos.desglose.raya === 0, "y todavía no cobra el bono de racha", anaDos.desglose.raya);

  const tres = montar(conRaya(2));
  const rTres = await tres.ranking.registrarPartida({
    codigo: "R3",
    estado: estadoFinal({ jugadores: CUATRO, ganadorId: "ana" }),
    entrada: 50,
  });
  const anaTres = rTres.find((x) => x.jugadorId === "ana");
  ok(anaTres.rayaNueva === RAYA_MINIMA, `a la ${RAYA_MINIMA}ª seguida`, anaTres.rayaNueva);
  ok(
    anaTres.desglose.raya === PUNTOS_RANKING.BONO_RAYA,
    "  ahí sí cobra el bono",
    anaTres.desglose.raya,
  );
  ok(
    tres.db._leer(`rankings/${CLAVES.mensual}/jugadores/ana`).mejorRacha === RAYA_MINIMA,
    "y la tabla guarda la mejor racha",
  );
}

// =====================================================================
console.log("\n=== 6. Dos partidas se acumulan, no se pisan ===");
// =====================================================================

{
  const { db, ranking } = montar();

  await ranking.registrarPartida({
    codigo: "P1",
    estado: estadoFinal({ jugadores: CUATRO, ganadorId: "ana" }),
    entrada: 50,
  });
  const trasLaPrimera = db._leer(`rankings/${CLAVES.mensual}/jugadores/ana`).puntos;

  await ranking.registrarPartida({
    codigo: "P2",
    estado: estadoFinal({ jugadores: CUATRO, ganadorId: "beto" }),
    entrada: 50,
  });

  const ana = db._leer(`rankings/${CLAVES.mensual}/jugadores/ana`);
  ok(ana.partidasJugadas === 2, "la segunda suma otra partida", ana.partidasJugadas);
  ok(ana.partidasGanadas === 1, "sin sumar una victoria que no fue", ana.partidasGanadas);
  ok(ana.puntos > trasLaPrimera, "y los puntos crecen", { trasLaPrimera, ahora: ana.puntos });
  ok(db._leer("jugadores/ana/rachas/actual").raya === 0, "y la raya se le cortó");
}

// =====================================================================
console.log("\n=== 7. Apostar más multiplica lo ganado ===");
// =====================================================================

{
  // Misma partida, dos entradas distintas. El multiplicador es la única
  // diferencia, así que el total tiene que crecer con la apuesta.
  //
  // 10 y 100 y no 10 y 500: 500 es una entrada VÁLIDA de sala que no está en
  // `BONOS_APUESTA` y cae al multiplicador 1. Ver la sección 9, que documenta
  // ese agujero en vez de esconderlo eligiendo números que lo esquiven.
  const baja = montar();
  const rBaja = await baja.ranking.registrarPartida({
    codigo: "B",
    estado: estadoFinal({ jugadores: CUATRO, ganadorId: "ana" }),
    entrada: 10,
  });

  const alta = montar();
  const rAlta = await alta.ranking.registrarPartida({
    codigo: "A",
    estado: estadoFinal({ jugadores: CUATRO, ganadorId: "ana" }),
    entrada: 100,
  });

  const pBaja = rBaja.find((x) => x.jugadorId === "ana");
  const pAlta = rAlta.find((x) => x.jugadorId === "ana");

  ok(pBaja.base === pAlta.base, "la base es la misma partida", { pBaja: pBaja.base, pAlta: pAlta.base });
  ok(pAlta.multiplicador > pBaja.multiplicador, "pero apostar más multiplica más", {
    baja: pBaja.multiplicador,
    alta: pAlta.multiplicador,
  });
  ok(pAlta.total > pBaja.total, "y el total es mayor", { baja: pBaja.total, alta: pAlta.total });
}

// =====================================================================
console.log("\n=== 8. Un fallo del ranking NO puede tumbar el cierre ===");
// =====================================================================

{
  // El cierre ya pagó los premios y cerró la sala cuando esto corre. Si una
  // excepción subiera, la callable devolvería error sobre una partida que en
  // realidad se cerró bien, y el jugador la vería colgada para siempre.
  const db = crearFirestore();
  db.runTransaction = async () => {
    throw new Error("Firestore se cayó");
  };
  const ranking = crearRankingDePartidas({ db, marcaDeTiempo: () => "T", ahora: () => FECHA });

  let reventó = false;
  let r = null;
  try {
    r = await ranking.registrarPartidaSinRomper({
      codigo: "X",
      estado: estadoFinal({ jugadores: CUATRO, ganadorId: "ana" }),
      entrada: 50,
    });
  } catch {
    reventó = true;
  }

  ok(!reventó, "la versión que usa el servidor no lanza");
  ok(Array.isArray(r) && r.length === 0, "y devuelve vacío", r);

  // La versión cruda SÍ lanza: es la que se usa desde una prueba o una
  // herramienta, donde tragarse el error sería esconder el problema.
  let lanzó = false;
  try {
    await ranking.registrarPartida({
      codigo: "X",
      estado: estadoFinal({ jugadores: CUATRO, ganadorId: "ana" }),
      entrada: 50,
    });
  } catch {
    lanzó = true;
  }
  ok(lanzó, "pero la cruda sí, para no esconder el problema");
}

// =====================================================================
console.log("\n=== 9. Las entradas sin multiplicador, a la vista ===");
// =====================================================================

{
  /**
   * Esto NO comprueba que algo esté bien. Deja constancia de que algo está mal.
   *
   * Una sala se puede abrir con nueve entradas —5, 10, 15, 20, 25, 50, 100,
   * 200 y 500— pero `BONOS_APUESTA` sólo define multiplicador para cuatro:
   * 10, 50, 100 y 200. Las otras cinco caen al multiplicador 1 y a 0 de
   * experiencia.
   *
   * Y entre esas cinco está la 500, que es la apuesta MÁS ALTA del juego. Hoy
   * quien arriesga 500 Leyendas suma para el ranking mensual lo mismo que
   * quien arriesga 5, y la cuarta parte de quien arriesga 100. El incentivo
   * está dado vuelta justo en el extremo donde más plata hay en juego.
   *
   * No se arregla acá porque cambiar la tabla cambia la economía del ranking,
   * que reparte una remera, y esa es una decisión de producto. Esta prueba
   * fija el comportamiento ACTUAL: el día que se decida, va a fallar, y va a
   * fallar diciendo exactamente qué cambió.
   */
  const sinMultiplicador = ENTRADAS.filter((e) => !(e in BONOS_APUESTA));

  ok(
    JSON.stringify(sinMultiplicador) === JSON.stringify([5, 15, 20, 25, 500]),
    "cinco de las nueve entradas no tienen multiplicador propio",
    sinMultiplicador,
  );

  const quinientos = montar();
  const rQuinientos = await quinientos.ranking.registrarPartida({
    codigo: "Q",
    estado: estadoFinal({ jugadores: CUATRO, ganadorId: "ana" }),
    entrada: 500,
  });
  const cien = montar();
  const rCien = await cien.ranking.registrarPartida({
    codigo: "C",
    estado: estadoFinal({ jugadores: CUATRO, ganadorId: "ana" }),
    entrada: 100,
  });

  const q = rQuinientos.find((x) => x.jugadorId === "ana").total;
  const c = rCien.find((x) => x.jugadorId === "ana").total;

  ok(q < c, "hoy apostar 500 da MENOS puntos que apostar 100", { con500: q, con100: c });
}

// =====================================================================
console.log("\n=== 10. Los premios físicos del cierre de mes ===");
// =====================================================================

{
  /**
   * Remera al 1.º con 20.000 puntos, llavero al 2.º con 19.000.
   *
   * No son Leyendas y no pasan por el libro mayor: el servidor deja constancia
   * en `users/{uid}.premios` para que después alguien los mande. Por eso lo que
   * hay que probar es la DECISIÓN —a quién le corresponde— y no un cobro.
   *
   * Los umbrales son puntos de la tabla mensual, que es la que
   * `registrarPartida` acaba de escribir unas secciones más arriba. Antes de
   * eso la tabla estaba vacía y esto no se podía alcanzar ni con la mejor
   * temporada.
   */
  ok(premioFisicoDe(1, 20000)?.premio === "remera", "el 1.º con 20.000 se lleva la remera");
  ok(premioFisicoDe(1, 25000)?.premio === "remera", "y con más, también");
  ok(premioFisicoDe(1, 19999) === null, "con 19.999 no: el umbral es exacto");

  ok(premioFisicoDe(2, 19000)?.premio === "llavero", "el 2.º con 19.000 se lleva el llavero");
  ok(premioFisicoDe(2, 18999) === null, "con 18.999 no");

  // El 2.º no cobra la remera aunque le sobren puntos: el premio es del PUESTO,
  // no del puntaje. Si fuera del puntaje, en un mes flojo no lo ganaría nadie y
  // en uno bueno lo ganarían diez.
  ok(premioFisicoDe(2, 999999)?.premio === "llavero", "el 2.º nunca se lleva la remera");
  ok(premioFisicoDe(3, 999999) === null, "y del 3.º para abajo no hay premio físico");
}

{
  // El panel puede mover los umbrales. Un cero o un negativo se ignoran y queda
  // el de fábrica: es la clase de campo que se borra sin querer en un
  // formulario, y un cero repartiría la remera a cualquiera.
  const movidos = umbralesValidos({ remera: 5000, llavero: 4000 });
  ok(premioFisicoDe(1, 5000, movidos)?.premio === "remera", "con el umbral bajado, se otorga antes");
  ok(premioFisicoDe(1, 4999, movidos) === null, "  y un punto abajo sigue sin otorgarse");

  const rotos = umbralesValidos({ remera: 0, llavero: -1 });
  ok(rotos[0].minimoPuntos === 20000, "un umbral en cero se ignora", rotos[0].minimoPuntos);
  ok(rotos[1].minimoPuntos === 19000, "y uno negativo también", rotos[1].minimoPuntos);

  const vacio = umbralesValidos(undefined);
  ok(vacio[0].minimoPuntos === 20000, "sin configuración guardada, los de fábrica");
}

console.log(fallos ? `\n❌ ${fallos} fallos` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
