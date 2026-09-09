/**
 * El barredor: quien hace avanzar una partida cuando no hay nadie mirando.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL BUG QUE ESTO CIERRA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Una partida por Leyendas avanzaba solamente porque algún navegador llamaba a
 * `avanzarPartida`, y el cliente lo hace únicamente con la pestaña VISIBLE:
 *
 *     // public/js/partida-red.js
 *     if (corriendo || document.hidden) return;
 *
 * O sea que si los cuatro jugadores minimizaban, cambiaban de pestaña o
 * bloqueaban el teléfono a la vez, nadie golpeaba la puerta y la partida se
 * congelaba. El final de ronda es donde más pasa: es la pausa en la que todo el
 * mundo mira el marcador y se va a hacer otra cosa.
 *
 * Congelada ahí, la sala quedaba en «jugando» con las entradas cobradas y el
 * pozo retenido. Para siempre, porque cerrarla también es una transición de esa
 * misma máquina que no corría.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE DEFIENDE
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   1. Que una partida vencida se encuentre. Es una consulta con desigualdad
 *      sobre un campo anidado, y si un día alguien guarda el plazo como texto
 *      o como marca de tiempo, deja de encontrar nada — sin fallar.
 *   2. Que una que NO venció no se toque. Un barredor que adelanta el reloj
 *      sería peor que uno que no corre: cerraría ventanas de reflejos que la
 *      gente todavía está jugando.
 *   3. Que una partida cerrada quede afuera. Si no, el barrido la republica en
 *      cada vuelta, para siempre, escribiendo cinco documentos por minuto.
 *   4. Que una mesa DESIERTA se termine, y no gire. Es la parte que faltaba y
 *      que se vio en producción: el barredor destraba, pero destrabar no es
 *      terminar. A una mesa sin nadie le da `saltarTurno`, que corre el turno
 *      y no hace nada más; el turno da la vuelta a la mesa un minuto tras
 *      otro, sin error, sin avanzar y sin devolver el pozo.
 *   5. Que una mesa VIVA no se termine por error. Basta con que uno siga
 *      latiendo. Es la mitad que impide que el arreglo sea peor que el fallo.
 */

import { crearMotorEnRed } from "../functions/partida-red.js";
import * as motor from "../public/js/reglas/motor.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

class E extends Error { constructor(c, m) { super(m); this.codigo = c; } }
const error = (c, m) => new E(c, m);

/**
 * El Firestore de mentira, con la consulta que el barredor necesita.
 *
 * `where("plazo.hasta", "<=", n)` se resuelve leyendo el campo anidado a mano.
 * No replica los índices de Firestore, pero sí lo que importa para esta prueba:
 * qué documentos entran y cuáles no, incluidos los que no tienen el campo.
 */
function db0() {
  const docs = new Map();
  let v = 0;

  const coleccion = (nombre) => ({
    doc: (id) => ({ ruta: `${nombre}/${id}` }),
    where(campo, op, valor) {
      const partes = campo.split(".");
      const leer = (d) => partes.reduce((o, k) => (o == null ? o : o[k]), d);
      const filtra = (d) => {
        const x = leer(d);
        if (x === undefined || x === null) return false; // campo ausente: afuera
        return op === "<=" ? x <= valor : false;
      };
      const armar = (tope) => {
        const filas = [...docs.entries()]
          .filter(([r]) => r.startsWith(`${nombre}/`) && !r.slice(nombre.length + 1).includes("/"))
          .filter(([, d]) => filtra(d.datos))
          .slice(0, tope ?? Infinity)
          .map(([r, d]) => ({ id: r.split("/").pop(), data: () => structuredClone(d.datos) }));
        return { size: filas.length, forEach: (fn) => filas.forEach(fn) };
      };
      return { limit: (tope) => ({ get: async () => armar(tope) }), get: async () => armar() };
    },
  });

  const db = {
    collection: coleccion,
    async runTransaction(f) {
      for (let i = 0; i < 8; i++) {
        const leidas = new Map();
        const esc = [];
        const tx = {
          async get(r) {
            const d = docs.get(r.ruta);
            leidas.set(r.ruta, d ? d.version : 0);
            return { exists: Boolean(d), data: () => d && structuredClone(d.datos) };
          },
          set(r, d, o) { esc.push({ ruta: r.ruta, datos: d, m: Boolean(o?.merge) }); },
          update(r, d) { esc.push({ ruta: r.ruta, datos: d, m: true }); },
        };
        const res = await f(tx);
        if ([...leidas].some(([r, x]) => (docs.get(r)?.version ?? 0) !== x)) continue;
        for (const e of esc) {
          const p = docs.get(e.ruta);
          docs.set(e.ruta, {
            datos: e.m ? { ...(p?.datos ?? {}), ...structuredClone(e.datos) } : structuredClone(e.datos),
            version: ++v,
          });
        }
        return res;
      }
      throw error("aborted", "reintentos");
    },
  };

  db.leer = (r) => docs.get(r)?.datos;
  db.escribir = (r, d) => docs.set(r, { datos: d, version: ++v });
  return db;
}

const CUATRO = ["ana", "beto", "caro", "dani"];
let reloj = 1_000_000;

const motorDe = (db) =>
  crearMotorEnRed({
    db,
    partidas: "partidas",
    error,
    ahora: () => reloj,
    idAleatorio: () => `v${reloj}`,
    marcaDeTiempo: () => "T",
    semillaDe: () => 4242,
  });

// =====================================================================

console.log("\n=== Encuentra lo vencido y sólo lo vencido ===");
{
  const db = db0();
  const red = motorDe(db);

  db.escribir("partidas/VENCIDA", { plazo: { hasta: reloj - 1, fase: "turno", que: "saltarTurno" } });
  db.escribir("partidas/AJUSTADA", { plazo: { hasta: reloj, fase: "turno", que: "saltarTurno" } });
  db.escribir("partidas/FUTURA", { plazo: { hasta: reloj + 60_000, fase: "turno", que: "saltarTurno" } });
  db.escribir("partidas/CERRADA", { cerrada: true, plazo: null });
  db.escribir("partidas/SINPLAZO", { estado: { fase: "turno" } });

  const encontradas = (await red.vencidas()).sort();

  ok(encontradas.includes("VENCIDA"), "la vencida entra");
  ok(encontradas.includes("AJUSTADA"), "la que vence justo ahora también");
  ok(!encontradas.includes("FUTURA"), "la que todavía no venció, no");
  ok(!encontradas.includes("CERRADA"), "una cerrada no tiene plazo y queda afuera");
  ok(!encontradas.includes("SINPLAZO"), "una sin plazo tampoco");
  ok(encontradas.length === 2, "y no aparece nada más", encontradas);
}

console.log("\n=== El tope limita cuántas trae de una vuelta ===");
{
  const db = db0();
  const red = motorDe(db);
  for (let i = 0; i < 7; i++) {
    db.escribir(`partidas/P${i}`, { plazo: { hasta: reloj - 1, fase: "turno", que: "saltarTurno" } });
  }
  ok((await red.vencidas({ tope: 3 })).length === 3, "trae tres cuando se le piden tres");
  ok((await red.vencidas()).length === 7, "y todas cuando no");
}

console.log("\n=== Con todos afuera, la partida termina en el acto ===");
{
  /**
   * Lo que pasó en producción: los cuatro se fueron.
   *
   * Antes esto giraba en `turno` para siempre. El fin de partida sólo se
   * evalúa al cortar, y cortar necesita que alguien esté jugando; con los
   * cuatro afuera no cortaba nadie, el turno se le pasaba al siguiente activo
   * y —como no había— volvía al mismo. La sala quedaba en «jugando» con las
   * entradas cobradas y sin forma de cerrarse.
   *
   * Ahora termina en el momento en que se va el último, sin esperar a ningún
   * barrido. El barredor sigue haciendo falta para lo otro: la partida que se
   * congela con los jugadores todavía dentro.
   */
  const db = db0();
  const red = motorDe(db);

  await red.repartir({ codigo: "ABCDEF", jugadores: CUATRO, nombres: CUATRO });
  for (const uid of CUATRO) await red.marcarAbandono({ codigo: "ABCDEF", uid });

  const estado = db.leer("partidas/ABCDEF").estado;
  ok(estado.jugadores.every((j) => j.eliminado), "los cuatro quedaron fuera de la mesa");
  ok(estado.fase === "finPartida", "y la partida terminó sin esperar nada", estado.fase);
  // El estado marca ganador a quien quedó último en pie —la partida terminó",
  // cuando se fue el tercero— y el cuarto abandono ya no cambia una partida
  // terminada. Eso no le da el pozo a nadie: `elegiblesParaPremio` saca a los
  // que abandonaron, y con los cuatro afuera no queda ningún elegible. Lo que
  // pasa con la plata lo prueba la sección 4 de `pruebas/cierre.mjs`: vuelve
  // entera a quien la puso.
  ok(
    estado.jugadores.filter((j) => j.abandono).length === 4,
    "los cuatro quedan marcados como abandono, que es lo que mira el cierre",
    estado.jugadores.filter((j) => j.abandono).length,
  );

  // Sin desempate. `comprobarFinPartida` manda a desempatar cuando nadie
  // queda por PUNTOS, y ahí tiene razón; acá no queda nadie porque se fueron
  // todos, y no hay a quién sentar a jugar la ronda de desempate.
  ok(estado.desempate === false, "y sin ronda de desempate", estado.desempate);
}

console.log("\n=== Si queda uno solo en pie, gana él ===");
{
  // La regla de siempre. Lo que no puede pasar es que tres abandonos dejen la
  // partida girando con una sola persona esperando un turno que nunca llega.
  const db = db0();
  const red = motorDe(db);

  await red.repartir({ codigo: "ABCDEF", jugadores: CUATRO, nombres: CUATRO });
  for (const uid of ["beto", "caro", "dani"]) await red.marcarAbandono({ codigo: "ABCDEF", uid });

  const estado = db.leer("partidas/ABCDEF").estado;
  ok(estado.fase === "finPartida", "la partida termina", estado.fase);
  ok(estado.ganador?.id === "ana", "y gana la que se quedó", estado.ganador?.id);
}

console.log("\n=== Una partida viva y sin nadie mirando: la destraba el barrido ===");
{
  /**
   * Acá está el barredor de verdad. Los cuatro jugadores siguen dentro —nadie
   * abandonó— y simplemente nadie tiene la pestaña visible. Antes eso
   * congelaba la partida en el paso en que estuviera.
   *
   * Las dos mitades se prueban juntas a propósito: primero que sin llamar a
   * nada NO avanza —si avanzara sola, el barredor no probaría nada— y después
   * que con el barrido sí.
   */
  const db = db0();
  const red = motorDe(db);

  await red.repartir({ codigo: "ABCDEF", jugadores: CUATRO, nombres: CUATRO });
  const alRepartir = db.leer("partidas/ABCDEF").estado.fase;

  // Pasa media hora y nadie golpea la puerta.
  reloj += 1_800_000;
  ok(
    db.leer("partidas/ABCDEF").estado.fase === alRepartir,
    "sin que nadie llame, no avanza un solo paso",
    db.leer("partidas/ABCDEF").estado.fase,
  );

  // Un barrido: buscar lo vencido y empujarlo unos pasos.
  const codigos = await red.vencidas();
  ok(codigos.includes("ABCDEF"), "el barredor la encuentra vencida", codigos);

  for (let paso = 0; paso < 8; paso++) {
    const r = await red.avanzarPartida({ codigo: "ABCDEF" });
    if (!r?.hizo) break;
  }

  ok(
    db.leer("partidas/ABCDEF").estado.fase !== alRepartir,
    "y el barrido la destraba",
    db.leer("partidas/ABCDEF").estado.fase,
  );
}
console.log("\n=== El barredor no adelanta el reloj ===");
{
  // Un barredor que actúe antes de tiempo es peor que uno que no corre:
  // cerraría ventanas de reflejos que la gente todavía está jugando.
  const db = db0();
  const red = motorDe(db);

  await red.repartir({ codigo: "ABCDEF", jugadores: CUATRO, nombres: CUATRO });
  const faseAlRepartir = db.leer("partidas/ABCDEF").estado.fase;

  // Sin mover el reloj: el plazo de la mirada todavía no venció.
  ok((await red.vencidas()).length === 0, "recién repartida, no aparece como vencida");

  const r = await red.avanzarPartida({ codigo: "ABCDEF" });
  ok(r.motivo === "todavia_no", "y avanzarla no hace nada", r.motivo);
  ok(
    db.leer("partidas/ABCDEF").estado.fase === faseAlRepartir,
    "la fase no se movió",
    db.leer("partidas/ABCDEF").estado.fase,
  );
}

console.log("\n=== Una mesa sin nadie GIRA: el barredor solo no la termina ===");
{
  /**
   * Esto se descubrió en producción, doce minutos después de desplegar el
   * barredor. Dos partidas, un paso cada una, cada minuto, `cerradas: 0`
   * siempre. Ni un error en el registro.
   *
   * La causa: `saltarTurno` corre el turno al siguiente y anota un renglón.
   * Nada más. No mueve una carta, no elimina a nadie, no termina la ronda.
   * Con los cuatro ausentes el turno da la vuelta a la mesa para siempre, y
   * cada vuelta escribe cinco documentos y alarga el registro, que vive
   * dentro del documento de la partida y tiene un tope de un mega.
   *
   * La primera mitad de esta prueba deja constancia del giro. Sin ella, la
   * segunda mitad —el vaciado— parecería una precaución de más.
   */
  const db = db0();
  const red = motorDe(db);

  await red.repartir({ codigo: "ABCDEF", jugadores: CUATRO, nombres: CUATRO });

  // Media hora sin que nadie lata: se fueron todos, sin abandonar.
  reloj += 30 * 60 * 1000;

  let pasos = 0;
  for (let minuto = 0; minuto < 12; minuto++) {
    reloj += 60_000;
    for (let i = 0; i < 8; i++) {
      const r = await red.avanzarPartida({ codigo: "ABCDEF" });
      if (!r?.hizo) break;
      pasos++;
    }
  }

  const girando = db.leer("partidas/ABCDEF");
  ok(pasos >= 12, "el barredor da un paso por vuelta, doce vueltas", pasos);
  ok(girando.estado.fase === "turno", "y sigue en turno: gira sin llegar a nada", girando.estado.fase);
  ok(!girando.cerrada, "la partida sigue abierta, con el pozo adentro");
  ok(
    girando.estado.registro.length > 10,
    "y el registro se va llenando, un renglón por vuelta",
    girando.estado.registro.length,
  );
}

console.log("\n=== Vaciarla la termina, y el pozo puede volver ===");
{
  const db = db0();
  const red = motorDe(db);

  await red.repartir({ codigo: "ABCDEF", jugadores: CUATRO, nombres: CUATRO });
  reloj += 30 * 60 * 1000;

  const r = await red.vaciarMesaDesierta({ codigo: "ABCDEF" });
  ok(r.vaciada, "la mesa desierta se vacía", r);
  ok(r.marcados.length === 4, "marcando a los cuatro de una sola escritura", r.marcados);

  const estado = db.leer("partidas/ABCDEF").estado;
  ok(estado.fase === "finPartida", "la partida termina", estado.fase);
  ok(
    estado.jugadores.every((j) => j.abandono),
    "y los cuatro quedan como abandono, que es lo que mira el cierre",
  );
  // De ahí en adelante es el camino de siempre: el plazo de `finPartida`
  // vence a los pocos segundos y el mismo barrido llama al cierre. Lo que
  // pasa con la plata lo prueba la sección 4 de `pruebas/cierre.mjs`: sin
  // ningún elegible, el pozo vuelve entero a quien lo puso.
  const plazo = db.leer("partidas/ABCDEF").plazo;
  ok(plazo?.que === "cerrarPartida", "y queda con el plazo del cierre", plazo);
}

console.log("\n=== Con uno solo mirando, no se toca ===");
{
  /**
   * La mitad que impide que esto sea peor que el problema. Vaciar una mesa
   * viva le corta la partida a quien la está jugando, así que basta con que
   * UNO siga latiendo para que la mesa siga siendo suya.
   *
   * El umbral es de diez minutos y no de quince segundos justamente por esto:
   * el navegador frena los latidos de una pestaña de fondo a uno por minuto.
   */
  const db = db0();
  const red = motorDe(db);

  await red.repartir({ codigo: "ABCDEF", jugadores: CUATRO, nombres: CUATRO });
  reloj += 30 * 60 * 1000;
  await red.latir({ codigo: "ABCDEF", uid: "caro" });

  const r = await red.vaciarMesaDesierta({ codigo: "ABCDEF" });
  ok(!r.vaciada, "no se vacía", r);
  ok(r.motivo === "alguien_sigue", "porque queda alguien del otro lado", r.motivo);
  ok(db.leer("partidas/ABCDEF").estado.fase !== "finPartida", "y la partida sigue viva");

  // Y en cuanto ESE también se calla, sí.
  reloj += 30 * 60 * 1000;
  ok((await red.vaciarMesaDesierta({ codigo: "ABCDEF" })).vaciada, "callado él, ahora sí");
}

console.log("\n=== Una recién repartida no se vacía nunca ===");
{
  // El peligro obvio del umbral: `repartir` siembra los latidos con la hora
  // del reparto justamente para esto. Si la mesa naciera sin latidos, el
  // primer barrido la encontraría en silencio absoluto y la cerraría antes de
  // que nadie jugara una carta.
  const db = db0();
  const red = motorDe(db);

  await red.repartir({ codigo: "ABCDEF", jugadores: CUATRO, nombres: CUATRO });
  const r = await red.vaciarMesaDesierta({ codigo: "ABCDEF" });

  ok(!r.vaciada, "no se vacía recién repartida", r);
  ok(
    Object.keys(db.leer("partidas/ABCDEF").latidos).length === 4,
    "porque nace con los cuatro latidos puestos",
  );
}

console.log("\n=== Lo que ya está cerrado o vacío se deja en paz ===");
{
  const db = db0();
  const red = motorDe(db);

  await red.repartir({ codigo: "ABCDEF", jugadores: CUATRO, nombres: CUATRO });
  reloj += 30 * 60 * 1000;
  for (const uid of CUATRO) await red.marcarAbandono({ codigo: "ABCDEF", uid });

  const r = await red.vaciarMesaDesierta({ codigo: "ABCDEF" });
  ok(!r.vaciada, "con todos ya afuera, no hay nada que vaciar", r);
  ok(r.motivo === "no_queda_nadie", "y lo dice", r.motivo);

  const sinPartida = await red.vaciarMesaDesierta({ codigo: "NOEXISTE" });
  ok(!sinPartida.vaciada && sinPartida.motivo === "no_existe", "una que no existe no rompe nada", sinPartida);
}

console.log("\n=== Una partida cerrada no se mueve más, la empuje quien la empuje ===");
{
  /**
   * La segunda mitad de «cancelar una sala en juego».
   *
   * Cuando la administración corta una partida y le devuelve la entrada a
   * cada uno, la partida queda `cerrada` y sin plazo. Pero sigue existiendo,
   * y sigue en la fase en que estaba —`turno`, no `finPartida`—.
   *
   * Sin este freno, el primer golpe la ve sin plazo, se lo recalcula, el
   * barredor la encuentra vencida y la empuja hasta el final. Ahí el cierre
   * repartiría premios de un pozo que ya volvió a sus dueños: la misma plata
   * pagada dos veces.
   */
  const db = db0();
  const red = motorDe(db);

  await red.repartir({ codigo: "ABCDEF", jugadores: CUATRO, nombres: CUATRO });
  reloj += 60_000;

  // Lo que escribe la cancelación: cerrada y sin plazo.
  const antes = db.leer("partidas/ABCDEF");
  db.escribir("partidas/ABCDEF", { ...antes, cerrada: true, plazo: null });

  const r = await red.avanzarPartida({ codigo: "ABCDEF" });
  ok(r.hizo === null, "no hace nada", r);
  ok(r.motivo === "cerrada", "y dice que es porque está cerrada", r.motivo);

  const despues = db.leer("partidas/ABCDEF");
  ok(despues.plazo === null, "no se le recalcula el plazo", despues.plazo);
  ok(despues.estado.fase === antes.estado.fase, "y la fase no se movió", despues.estado.fase);
  ok(!(await red.vencidas()).includes("ABCDEF"), "así que el barredor deja de verla");

  // Y por si alguien la golpea diez veces seguidas.
  for (let i = 0; i < 10; i++) await red.avanzarPartida({ codigo: "ABCDEF" });
  ok(
    db.leer("partidas/ABCDEF").estado.fase === antes.estado.fase,
    "ni con diez golpes",
    db.leer("partidas/ABCDEF").estado.fase,
  );
}

console.log(fallos === 0 ? "\n✅ TODO OK" : `\n❌ ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
