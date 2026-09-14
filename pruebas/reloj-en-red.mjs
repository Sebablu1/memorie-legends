/**
 * Los diez segundos para decidir, contra el servidor.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE PRUEBA ACÁ Y QUÉ NO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `pruebas/reloj-para-decidir.mjs` prueba la TABLA: qué corresponde hacer en
 * cada fase. Acá se prueba el RELOJ: que el plazo exista, que venza cuando
 * tiene que vencer, y que al vencer pase exactamente lo que la tabla dice.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL BORDE QUE MÁS IMPORTA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El turno dura 8 segundos y esto dura 10. Quien levanta una carta cuando le
 * quedaban 2 segundos de turno NO tiene 2 segundos para decidir: tiene 10. El
 * plazo es de la decisión, no lo que sobra del turno.
 *
 * Si eso estuviera mal, el jugador perdería la carta casi al instante de
 * levantarla, en una partida que cobra entrada, y desde afuera se vería como
 * "el juego me la tiró solo".
 */

import { crearMotorEnRed, MS_TURNO } from "../functions/partida-red.js";
import { MS_PARA_DECIDIR } from "../public/js/reglas/red.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

class E extends Error { constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; } }
const error = (codigo, mensaje) => new E(codigo, mensaje);

/** El mismo Firestore de mentira que usa `paso-automatico.mjs`. */
function crearFirestore() {
  const docs = new Map();
  let version = 0;
  const db = {
    collection: (n) => ({ doc: (id = `a${Math.random()}`) => ({ ruta: `${n}/${id}` }) }),
    async runTransaction(cuerpo) {
      for (let i = 0; i < 10; i++) {
        const leidas = new Map(); const esc = []; let yaEscribio = false;
        const tx = {
          async get(ref) {
            if (yaEscribio) throw error("invalid-argument", "Lectura tras escritura");
            const d = docs.get(ref.ruta);
            leidas.set(ref.ruta, d ? d.version : 0);
            return { exists: Boolean(d), data: () => (d ? structuredClone(d.datos) : undefined) };
          },
          set(ref, datos, op) { yaEscribio = true; esc.push({ ruta: ref.ruta, datos, m: Boolean(op?.merge) }); },
          update(ref, datos) { yaEscribio = true; esc.push({ ruta: ref.ruta, datos, m: true }); },
        };
        const res = await cuerpo(tx);
        if ([...leidas].some(([r, v]) => (docs.get(r)?.version ?? 0) !== v)) continue;
        for (const e of esc) {
          const p = docs.get(e.ruta);
          docs.set(e.ruta, {
            datos: e.m ? { ...(p?.datos ?? {}), ...structuredClone(e.datos) } : structuredClone(e.datos),
            version: ++version,
          });
        }
        return res;
      }
      throw error("aborted", "Demasiados reintentos.");
    },
  };
  db.leer = (r) => docs.get(r)?.datos;
  return db;
}

const DOS = ["ana", "beto"];
const CODIGO = "REL001";
let reloj = 500000;

function montar() {
  const db = crearFirestore();
  const red = crearMotorEnRed({
    db, partidas: "partidas", ahora: () => reloj, idAleatorio: () => `v${reloj}`,
    marcaDeTiempo: () => "T", error, semillaDe: () => 4242,
  });
  return { db, red };
}

const partida = (db) => db.leer(`partidas/${CODIGO}`);
const plazo = (db) => partida(db).plazo;
const fase = (db) => partida(db).estado.fase;
const enTurno = (db) => partida(db).estado.indiceTurno;
const registro = (db) => partida(db).estado.registro;

/**
 * Deja la partida en la fase pedida, con `quien` en turno.
 *
 * El estado se arma a mano, igual que en `paso-automatico.mjs`: llegar jugando
 * hasta una fase `cambioConVista` son ocho transiciones que ya prueban otras
 * suites, y repetirlas acá enterraría lo que se quiere mirar.
 */
async function enFase(db, red, faseDestino, extra = {}, quien = "ana") {
  await red.repartir({ codigo: CODIGO, jugadores: DOS, nombres: DOS });
  const p = partida(db);
  await db.runTransaction(async (tx) => {
    tx.set({ ruta: `partidas/${CODIGO}` }, {
      ...p,
      estado: {
        ...p.estado,
        fase: faseDestino,
        indiceTurno: DOS.indexOf(quien),
        ...extra,
      },
      // El plazo se anula: el que quedaba era el de la mirada, y dejarlo haría
      // que el primer golpe lo viera desfasado y lo gastara en recalcular.
      plazo: null,
      version: p.version + 1,
    });
  });
  await red.avanzarPartida({ codigo: CODIGO });
}

/** Una carta cualquiera, para poder levantarla. */
const CARTA = { numero: 5, palo: "corazon", id: "c5" };

// =====================================================================
console.log("\n=== 1. Las tres fases tienen plazo, y dura diez segundos ===");
// =====================================================================

{
  const casos = [
    ["levantada", { levantada: CARTA }, "descartarPorTiempo"],
    ["poder", { poderPendiente: { tipo: "mirarPropia", numero: 7, indiceJugador: 0 } }, "saltarPorTiempo"],
    ["cambioConVista", {
      cambioPendiente: { indiceJugador: 0, posicionPropia: 0, indiceRival: 1, posicionRival: 0 },
    }, "saltarPorTiempo"],
  ];

  for (const [faseDestino, extra, esperado] of casos) {
    reloj = 500000;
    const { db, red } = montar();
    await enFase(db, red, faseDestino, extra);

    const p = plazo(db);
    ok(p?.fase === faseDestino, `${faseDestino}: hay plazo atado a la fase`, p?.fase);
    ok(p?.que === esperado, `  y al vencer: ${esperado}`, p?.que);
    ok(p?.hasta === reloj + MS_PARA_DECIDIR, "  que vence a los 10 s", p && p.hasta - reloj);
  }
}

// =====================================================================
console.log("\n=== 2. Levantar tarde en el turno igual da diez segundos ===");
// =====================================================================

{
  /**
   * EL BORDE.
   *
   * El turno dura 8 s. Si el plazo de decisión heredara lo que sobra del
   * turno, quien levanta sobre la hora perdería la carta casi al instante.
   * Lo que se comprueba es que el plazo arranca CUANDO LEVANTA.
   */
  ok(MS_TURNO < MS_PARA_DECIDIR,
     `el turno (${MS_TURNO}) dura menos que la decisión (${MS_PARA_DECIDIR})`);

  reloj = 500000;
  const { db, red } = montar();

  // Se entra en `levantada` con el reloj ya avanzado 7 de los 8 segundos del
  // turno: queda un segundo de turno.
  reloj += MS_TURNO - 1000;
  await enFase(db, red, "levantada", { levantada: CARTA });

  const p = plazo(db);
  ok(p?.hasta === reloj + MS_PARA_DECIDIR,
     "el plazo son 10 s desde que levantó, no lo que sobraba del turno",
     p && p.hasta - reloj);

  // Y un golpe a los 5 segundos no lo vence.
  reloj += 5000;
  const r = await red.avanzarPartida({ codigo: CODIGO });
  ok(r.hizo === null && r.motivo === "todavia_no", "a los 5 s todavía no pasa nada", r);
  ok(fase(db) === "levantada", "  y sigue con la carta en la mano", fase(db));
}

// =====================================================================
console.log("\n=== 3. Al vencer con la carta levantada, se tira ===");
// =====================================================================

{
  reloj = 500000;
  const { db, red } = montar();
  await enFase(db, red, "levantada", { levantada: CARTA });

  const antes = partida(db).estado.descarte.length;

  reloj += MS_PARA_DECIDIR;
  await red.avanzarPartida({ codigo: CODIGO });

  ok(partida(db).estado.levantada === null, "ya no tiene la carta en la mano");
  ok(partida(db).estado.descarte.length === antes + 1, "y fue al descarte",
     partida(db).estado.descarte.length);
  ok(partida(db).estado.descarte[0].numero === CARTA.numero,
     "  la que tenía levantada", partida(db).estado.descarte[0]);

  /**
   * Y queda anotado como automático.
   *
   * Es la primera vez que el servidor tira una carta que nadie tocó, en
   * partidas que cobran entrada. Si después alguien pregunta por qué perdió
   * esa mano, el registro tiene que poder contestar — y por `tipo`, no
   * buscando palabras en el texto.
   */
  const ultima = registro(db).at(-1);
  ok(ultima?.tipo === "tiroPorTiempo", "el registro lo marca como automático", ultima);
  ok(/tiempo/i.test(ultima?.texto ?? ""), "  y el texto lo dice", ultima?.texto);
}

// =====================================================================
console.log("\n=== 4. Al vencer con un poder, se salta: no se juega por nadie ===");
// =====================================================================

{
  /**
   * Con un poder NO hay una sola jugada posible.
   *
   * ¿Con qué carta cambia el 9? ¿Mira la propia o la del rival? Elegir por él
   * sería inventar una decisión suya. Se suelta el poder y pasa el turno.
   */
  reloj = 500000;
  const { db, red } = montar();
  await enFase(db, red, "poder", {
    poderPendiente: { tipo: "mirarPropia", numero: 7, indiceJugador: 0 },
  });

  const turnoAntes = enTurno(db);

  reloj += MS_PARA_DECIDIR;
  await red.avanzarPartida({ codigo: CODIGO });

  ok(partida(db).estado.poderPendiente === null, "el poder quedó sin usar");
  ok(fase(db) === "turno", "y la partida volvió a turno", fase(db));
  ok(enTurno(db) !== turnoAntes, "con el turno en el otro jugador", {
    antes: turnoAntes, ahora: enTurno(db),
  });

  // Nada fue al descarte: saltar no es descartar.
  ok(partida(db).estado.descarte.length === 1,
     "y NO se tiró ninguna carta", partida(db).estado.descarte.length);
}

// =====================================================================
console.log("\n=== 5. El 10 a medio resolver tampoco cambia por él ===");
// =====================================================================

{
  /**
   * Ya vio las dos cartas. Cualquier cosa que el servidor elija usa
   * información que él tiene y el servidor no puede interpretar, así que la
   * única respuesta honesta es "no cambio".
   */
  reloj = 500000;
  const { db, red } = montar();

  await enFase(db, red, "cambioConVista", {
    cambioPendiente: { indiceJugador: 0, posicionPropia: 0, indiceRival: 1, posicionRival: 0 },
  });

  const miCarta = partida(db).estado.jugadores[0].mano[0];
  const suCarta = partida(db).estado.jugadores[1].mano[0];

  reloj += MS_PARA_DECIDIR;
  await red.avanzarPartida({ codigo: CODIGO });

  ok(partida(db).estado.cambioPendiente === null, "el cambio quedó resuelto");
  ok(fase(db) === "turno", "y la partida siguió", fase(db));

  const miCartaDespues = partida(db).estado.jugadores[0].mano[0];
  const suCartaDespues = partida(db).estado.jugadores[1].mano[0];
  ok(JSON.stringify(miCartaDespues) === JSON.stringify(miCarta),
     "mi carta no se movió", { antes: miCarta, despues: miCartaDespues });
  ok(JSON.stringify(suCartaDespues) === JSON.stringify(suCarta),
     "y la del rival tampoco", { antes: suCarta, despues: suCartaDespues });
}

// =====================================================================
console.log("\n=== 6. Actuar a tiempo cancela el plazo ===");
// =====================================================================

{
  // Si el plazo sobreviviera a la acción, la jugada siguiente heredaría un
  // vencimiento viejo y se dispararía sola.
  reloj = 500000;
  const { db, red } = montar();
  await enFase(db, red, "levantada", { levantada: CARTA });

  ok(plazo(db)?.que === "descartarPorTiempo", "hay plazo mientras decide");

  // Tira la carta él mismo, antes de que venza.
  reloj += 3000;
  await red.accionDeTurno({ codigo: CODIGO, uid: "ana", accion: "tirar", clientActionId: "x1" });

  ok(fase(db) !== "levantada", "ya no está decidiendo", fase(db));
  ok(plazo(db)?.que !== "descartarPorTiempo",
     "y el plazo de decidir se fue con la fase", plazo(db));

  const marcadas = registro(db).filter((l) => l.tipo === "tiroPorTiempo");
  ok(marcadas.length === 0, "y nada quedó marcado como automático", marcadas);
}

console.log(fallos ? `\n❌ ${fallos} fallos` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
