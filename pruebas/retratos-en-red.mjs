/**
 * El retrato de cada jugador en una partida por Leyendas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE DEFIENDE ACÁ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * En entrenamiento los rivales son IA y llevan las caras de la casa. En una
 * partida por Leyendas hay cuatro personas con un avatar comprado cada una, y
 * hasta ahora ese avatar no llegaba a la mesa: la sala guardaba el uid y el
 * nombre, y nada más.
 *
 * Ahora el retrato viaja, y hay cuatro cosas que pueden salir mal en silencio:
 *
 *   1. Que la cara termine en el asiento equivocado. Es lo peor que puede
 *      pasar, porque la mesa se sigue viendo perfecta: cuatro jugadores con
 *      cuatro caras, sólo que no son las suyas. Pasa en cuanto las tres listas
 *      paralelas de la sala se desfasan en un elemento.
 *   2. Que una sala vieja —creada antes de que esto existiera— corra los
 *      retratos un lugar al entrar el siguiente jugador.
 *   3. Que el retrato cambie a mitad de la partida. Si se leyera del perfil en
 *      vez de fijarse al repartir, alguien que se cambia el avatar cambiaría
 *      de cara en las pantallas de los otros tres mientras juegan.
 *   4. Que una URL de otro dominio entre en la mesa. Ahí deja de ser un
 *      problema estético: los cuatro navegadores le pedirían la imagen a ese
 *      servidor, que se entera de cuatro IPs y de a qué hora se juega.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE NO SE PRUEBA ACÁ, Y POR QUÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `crearSala` y `unirseASala` son `functions.https.onCall` declaradas al
 * cargar `functions/index.js`: no se pueden importar sin levantar medio
 * Firebase. Lo que sí se puede comprobar de ellas es que escriban las tres
 * listas JUNTAS, y eso se hace leyendo el archivo, igual que
 * `transacciones.mjs` y `ritmo.mjs`. Una auditoría de texto no prueba que el
 * valor sea el correcto; prueba que nadie agregue un jugador olvidándose de su
 * cara, que es la forma en que esto se rompe.
 */

import { readFileSync } from "node:fs";
import * as motor from "../public/js/reglas/motor.js";
import { vistaDe, filtracionesEn } from "../public/js/reglas/vista.js";
import { esRutaDelSitio } from "../public/js/reglas/catalogo.js";
import { crearMotorEnRed } from "../functions/partida-red.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

// ===================================================== la regla de la ruta

console.log("\n=== Qué ruta puede viajar a la mesa ===");
ok(esRutaDelSitio("/img/avatar/el_dragon.webp"), "una ruta de este sitio, sí");
ok(!esRutaDelSitio("https://ejemplo.test/cara.png"), "una URL de otro dominio, NO");
ok(!esRutaDelSitio("http://ejemplo.test/cara.png"), "tampoco sin cifrar");
ok(!esRutaDelSitio("//ejemplo.test/cara.png"), "ni el protocolo relativo, que también sale afuera");
ok(!esRutaDelSitio("🐉"), "ni un emoji, que en un src no es una imagen");
ok(!esRutaDelSitio(null) && !esRutaDelSitio(undefined), "ni la ausencia de dato");

// `imagenEsArchivo` sigue siendo más permisiva, y está bien: la tienda muestra
// lo que el panel cargue. Lo que no puede es decidir qué viaja a la mesa.
const { imagenEsArchivo } = await import("../public/js/reglas/catalogo.js");
ok(
  imagenEsArchivo("https://ejemplo.test/cara.png") && !esRutaDelSitio("https://ejemplo.test/cara.png"),
  "las dos reglas son distintas a propósito: la de la mesa es la estricta",
);

// ============================================== el motor lo lleva y lo suelta

console.log("\n=== El jugador del motor lleva su retrato ===");
{
  const j = motor.crearJugador({ id: "ana", nombre: "Ana", retrato: "/img/avatar/orco.webp" });
  ok(j.retrato === "/img/avatar/orco.webp", "lo guarda", j.retrato);

  const sin = motor.crearJugador({ id: "beto", nombre: "Beto" });
  ok(sin.retrato === null, "sin retrato queda en null, no en undefined", sin.retrato);
}

console.log("\n=== Y la vista lo entrega igual a los cuatro ===");
{
  const CARAS = [
    "/img/avatar/el_dragon.webp",
    "/img/avatar/orco.webp",
    null,
    "/img/avatar/mago.webp",
  ];
  const estado = motor.empezarRonda(
    motor.crearPartida(
      ["ana", "beto", "caro", "dani"].map((id, i) => ({ id, nombre: id, retrato: CARAS[i] })),
      { semilla: 7 },
    ),
  );

  for (let quien = 0; quien < 4; quien++) {
    const vista = vistaDe(estado, quien);
    const vistos = vista.jugadores.map((j) => j.retrato);
    ok(
      JSON.stringify(vistos) === JSON.stringify(CARAS),
      `el jugador ${quien} ve las cuatro caras en su asiento`,
      vistos,
    );
  }

  // Es información pública: quién es cada uno se ve en la mesa. Lo que no
  // puede es traerse una carta de arrastre.
  const problemas = filtracionesEn(vistaDe(estado, 0), estado);
  ok(problemas.length === 0, "el campo nuevo no filtra ninguna carta", problemas);
}

// ============================================ el reparto y el asiento correcto

console.log("\n=== El reparto pone cada cara en su asiento ===");

class E extends Error { constructor(c, m) { super(m); this.codigo = c; } }
const error = (c, m) => new E(c, m);

/** El Firestore de mentira de siempre: documentos en memoria, con versión. */
function db0() {
  const docs = new Map(); let v = 0;
  const db = {
    collection: (n) => ({ doc: (id = `a${Math.random()}`) => ({ ruta: `${n}/${id}` }) }),
    async runTransaction(f) {
      for (let i = 0; i < 8; i++) {
        const leidas = new Map(), esc = [];
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
  return db;
}

const CUATRO = ["ana", "beto", "caro", "dani"];

/** El motor en red con todo lo que inyecta `index.js`, pero determinista. */
const motorDe = (db) =>
  crearMotorEnRed({
    db, partidas: "partidas", error,
    ahora: () => 100000,
    idAleatorio: () => "v1",
    marcaDeTiempo: () => "T",
    semillaDe: () => 777,
  });

async function repartirCon(retratos) {
  const db = db0();
  const red = motorDe(db);
  await red.repartir({ codigo: "ABCDEF", jugadores: CUATRO, nombres: CUATRO, retratos });
  return db.leer("partidas/ABCDEF").estado.jugadores.map((j) => j.retrato);
}

{
  const CARAS = ["/img/avatar/a.webp", "/img/avatar/b.webp", "/img/avatar/c.webp", "/img/avatar/d.webp"];
  const puestas = await repartirCon(CARAS);
  ok(JSON.stringify(puestas) === JSON.stringify(CARAS), "cada uno con la suya", puestas);
}

{
  // Una sala vieja: tiene cuatro jugadores y ningún retrato. Nadie tiene cara,
  // y sobre todo nadie tiene la de otro.
  const puestas = await repartirCon(undefined);
  ok(puestas.every((r) => r === null), "sin lista de retratos, los cuatro en null", puestas);
}

{
  // El caso feo: la lista llega más corta que los jugadores. Los que faltan
  // quedan sin cara; lo que NO puede pasar es que se corran de asiento.
  const puestas = await repartirCon(["/img/avatar/a.webp", "/img/avatar/b.webp"]);
  ok(
    puestas[0] === "/img/avatar/a.webp" && puestas[1] === "/img/avatar/b.webp",
    "los que sí tienen, en su lugar",
    puestas,
  );
  ok(puestas[2] === null && puestas[3] === null, "y los que no, sin cara ajena", puestas);
}

{
  // Fijado al repartir: el estado de la partida guarda la cara con la que cada
  // uno se sentó, y nada la vuelve a mirar después.
  const db = db0();
  const red = motorDe(db);
  const CARAS = ["/img/avatar/a.webp", null, null, null];
  await red.repartir({ codigo: "ABCDEF", jugadores: CUATRO, nombres: CUATRO, retratos: CARAS });
  const antes = db.leer("partidas/ABCDEF").estado.jugadores[0].retrato;

  // Repartir de nuevo con otra cara no cambia nada: el reparto es idempotente.
  await red.repartir({
    codigo: "ABCDEF", jugadores: CUATRO, nombres: CUATRO,
    retratos: ["/img/avatar/OTRA.webp", null, null, null],
  });
  const despues = db.leer("partidas/ABCDEF").estado.jugadores[0].retrato;
  ok(antes === despues, "la cara queda fijada al repartir y no se vuelve a tocar", { antes, despues });
}

// ================================== la auditoría de las tres listas paralelas

console.log("\n=== Las tres listas de la sala se escriben juntas ===");
{
  // Los DOS archivos que tocan la lista. `salida.js` se auditó desde el
  // principio y no por precaución: cuando alguien se iba de una sala en espera,
  // reconstruía los nombres sin los retratos, y los que quedaban detrás pasaban
  // a llevar la cara del de adelante.
  const fuente = [
    readFileSync(new URL("../functions/index.js", import.meta.url), "utf8"),
    readFileSync(new URL("../functions/salida.js", import.meta.url), "utf8"),
  ].join("\n// ---- archivo siguiente ----\n");

  // Cada bloque que agrega a `jugadores` tiene que agregar también a las otras
  // dos. Se buscan las apariciones de `jugadoresNombres` —que es la lista que
  // ya existía— y se comprueba que `jugadoresRetratos` esté a menos de cinco
  // líneas: si alguien agrega un jugador en un tercer lugar y se olvida de la
  // cara, la mesa muestra caras corridas y no falla nada.
  const lineas = fuente.split("\n");
  const conNombres = lineas
    .map((l, i) => (l.includes("jugadoresNombres") ? i : -1))
    .filter((i) => i >= 0);

  ok(conNombres.length >= 2, `hay ${conNombres.length} lugares que tocan la lista de nombres`);

  const huerfanos = conNombres.filter(
    (i) => !lineas.slice(i, i + 6).some((l) => l.includes("jugadoresRetratos")),
  );
  ok(
    huerfanos.length === 0,
    "ninguno escribe nombres sin escribir retratos",
    huerfanos.map((i) => `línea ${i + 1}: ${lineas[i].trim()}`),
  );

  // Y el reparto tiene que recibirlos: sin esto las salas guardan retratos que
  // nunca llegan a la mesa.
  ok(
    /repartirEn\(tx, \{[\s\S]{0,220}retratos:/.test(fuente),
    "iniciarPartida le pasa los retratos al reparto",
  );

  // La ruta se filtra antes de guardarse.
  ok(fuente.includes("esRutaDelSitio"), "el servidor mira la ruta antes de publicarla a la mesa");
}

console.log("\n=== La mesa prefiere el retrato de la vista ===");
{
  const mesa = readFileSync(new URL("../public/js/mesa.js", import.meta.url), "utf8");
  ok(
    /const caraDe = \(jugador, i\) =>\s*\n\s*esRutaDelSitio\(jugador\?\.retrato\) \? jugador\.retrato : retratoDe\(i\)/.test(mesa),
    "la cara sale de la vista, y si no sirve cae a la de la casa",
  );
  ok(
    !/src="\$\{retratoDe\(/.test(mesa),
    "no queda ningún retrato dibujado sin pasar por caraDe",
  );
}

console.log(fallos === 0 ? "\n✅ TODO OK" : `\n❌ ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
