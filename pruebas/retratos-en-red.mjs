/**
 * Lo que cada jugador lleva puesto en una partida por Leyendas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE DEFIENDE ACÁ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * En entrenamiento los rivales son IA y llevan las caras de la casa. En una
 * partida por Leyendas hay cuatro personas con lo suyo comprado —cara, dorso
 * de sus cartas, insignia— y hasta hace poco nada de eso llegaba a la mesa:
 * la sala guardaba el uid y el nombre, y nada más.
 *
 * Los tres viajan juntos, en una sola lista de objetos. Podrían haber sido
 * tres listas paralelas más la de nombres, cuatro en total; se descartó
 * porque el modo en que esto se rompe es justamente que dos listas se
 * desfasen, y cada lista nueva es una manera más de que ocurra.
 *
 * Hay cuatro cosas que pueden salir mal en silencio:
 *
 *   1. Que la cara termine en el asiento equivocado. Es lo peor que puede
 *      pasar, porque la mesa se sigue viendo perfecta: cuatro jugadores con
 *      cuatro caras, sólo que no son las suyas. Pasa en cuanto la lista y la
 *      de nombres se desfasan en un elemento.
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
 * Firebase. Lo que sí se puede comprobar de ellas es que escriban las dos
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

/**
 * Reparte con lo que cada uno lleva puesto y devuelve cómo quedó en la mesa.
 *
 * `luce` es UNA lista de objetos y no tres listas paralelas. Con el dorso y
 * la insignia sumados al retrato habrían sido cuatro listas que mantener
 * alineadas —nombres incluidos— en tres lugares distintos, y ya se desalineó
 * una vez: `salida.js` reconstruía los nombres y no los retratos.
 */
async function repartirCon(luce) {
  const db = db0();
  const red = motorDe(db);
  await red.repartir({ codigo: "ABCDEF", jugadores: CUATRO, nombres: CUATRO, luce });
  return db.leer("partidas/ABCDEF").estado.jugadores;
}

/** Atajo: sólo las caras, que es lo que miran varias de estas pruebas. */
const caras = (jugadores) => jugadores.map((j) => j.retrato);

{
  const CARAS = ["/img/avatar/a.webp", "/img/avatar/b.webp", "/img/avatar/c.webp", "/img/avatar/d.webp"];
  const puestas = caras(await repartirCon(CARAS.map((retrato) => ({ retrato }))));
  ok(JSON.stringify(puestas) === JSON.stringify(CARAS), "cada uno con la suya", puestas);
}

{
  // Una sala vieja: tiene cuatro jugadores y ningún retrato. Nadie tiene cara,
  // y sobre todo nadie tiene la de otro.
  const puestas = caras(await repartirCon(undefined));
  ok(puestas.every((r) => r === null), "sin lista, los cuatro en null", puestas);
}

{
  // El caso feo: la lista llega más corta que los jugadores. Los que faltan
  // quedan sin cara; lo que NO puede pasar es que se corran de asiento.
  const puestas = caras(
    await repartirCon([{ retrato: "/img/avatar/a.webp" }, { retrato: "/img/avatar/b.webp" }]),
  );
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
  const CARAS = [{ retrato: "/img/avatar/a.webp" }, {}, {}, {}];
  await red.repartir({ codigo: "ABCDEF", jugadores: CUATRO, nombres: CUATRO, luce: CARAS });
  const antes = db.leer("partidas/ABCDEF").estado.jugadores[0].retrato;

  // Repartir de nuevo con otra cara no cambia nada: el reparto es idempotente.
  await red.repartir({
    codigo: "ABCDEF", jugadores: CUATRO, nombres: CUATRO,
    luce: [{ retrato: "/img/avatar/OTRA.webp" }, {}, {}, {}],
  });
  const despues = db.leer("partidas/ABCDEF").estado.jugadores[0].retrato;
  ok(antes === despues, "la cara queda fijada al repartir y no se vuelve a tocar", { antes, despues });
}

// =================================== la auditoría de las listas paralelas

console.log("\n=== Las listas de la sala se escriben juntas ===");
{
  // Los DOS archivos que tocan la lista. `salida.js` se auditó desde el
  // principio y no por precaución: cuando alguien se iba de una sala en espera,
  // reconstruía los nombres sin los retratos, y los que quedaban detrás pasaban
  // a llevar la cara del de adelante.
  const fuente = [
    readFileSync(new URL("../functions/index.js", import.meta.url), "utf8"),
    readFileSync(new URL("../functions/salida.js", import.meta.url), "utf8"),
  ].join("\n// ---- archivo siguiente ----\n");

  // Cada bloque que agrega a `jugadores` tiene que agregar también a la otra.
  // Se buscan las apariciones de `jugadoresNombres` —que es la lista que ya
  // existía— y se comprueba que `jugadoresLuce` esté a menos de cinco líneas:
  // si alguien agrega un jugador en un tercer lugar y se olvida de lo que
  // lleva puesto, la mesa muestra caras corridas y no falla nada.
  const lineas = fuente.split("\n");
  const conNombres = lineas
    .map((l, i) => (l.includes("jugadoresNombres") ? i : -1))
    .filter((i) => i >= 0);

  ok(conNombres.length >= 2, `hay ${conNombres.length} lugares que tocan la lista de nombres`);

  const huerfanos = conNombres.filter(
    (i) => !lineas.slice(i, i + 6).some((l) => l.includes("jugadoresLuce")),
  );
  ok(
    huerfanos.length === 0,
    "ninguno escribe nombres sin escribir lo que cada uno lleva puesto",
    huerfanos.map((i) => `línea ${i + 1}: ${lineas[i].trim()}`),
  );

  // Y el reparto tiene que recibirla: sin esto las salas guardan avatares y
  // dorsos que nunca llegan a la mesa.
  ok(
    /repartirEn\(tx, \{[\s\S]{0,420}luce:/.test(fuente),
    "iniciarPartida le pasa al reparto lo que cada uno lleva puesto",
  );

  // La ruta se filtra antes de guardarse.
  ok(fuente.includes("esRutaDelSitio"), "el servidor mira la ruta antes de publicarla a la mesa");
}

console.log("\n=== El dorso y la insignia viajan igual que la cara ===");
{
  /**
   * El DORSO es el que más importa de los tres.
   *
   * Sin él, cada navegador dibujaba las manos ajenas con el reverso que le
   * tocaba al asiento: quien se compraba uno lo veía sólo en su propia
   * pantalla, que es exactamente lo contrario de comprarse algo para que se
   * vea.
   */
  const LUCE = [
    { retrato: "/img/avatar/a.webp", dorso: "/img/dorsos/dorso-rojo.png", insignia: "/img/insignias/heroe.webp" },
    { retrato: null, dorso: "/img/dorsos/dorso-azul.png", insignia: null },
    {},
    {},
  ];
  const jugadores = await repartirCon(LUCE);

  ok(
    jugadores[0].dorso === "/img/dorsos/dorso-rojo.png",
    "el dorso comprado llega a la mesa",
    jugadores[0].dorso,
  );
  ok(
    jugadores[0].insignia === "/img/insignias/heroe.webp",
    "y la insignia también",
    jugadores[0].insignia,
  );
  ok(jugadores[2].dorso === null && jugadores[2].insignia === null, "quien no tiene, en null");

  // Los tres son independientes: tener dorso no implica tener cara.
  ok(
    jugadores[1].retrato === null && jugadores[1].dorso === "/img/dorsos/dorso-azul.png",
    "se pueden tener unos sí y otros no",
    jugadores[1],
  );
}

console.log("\n=== Y los cuatro navegadores ven lo mismo ===");
{
  // Es la mitad que importa: de nada sirve que el dorso llegue al estado si
  // después la vista se lo entrega a uno solo.
  const LUCE = [
    { retrato: "/img/avatar/a.webp", dorso: "/img/dorsos/dorso-rojo.png", insignia: "/img/insignias/heroe.webp" },
    {}, {}, {},
  ];
  const estado = motor.empezarRonda(
    motor.crearPartida(
      CUATRO.map((id, i) => ({ id, nombre: id, ...LUCE[i] })),
      { semilla: 7 },
    ),
  );

  for (let quien = 0; quien < 4; quien++) {
    const v = vistaDe(estado, quien);
    ok(
      v.jugadores[0].dorso === "/img/dorsos/dorso-rojo.png",
      `el jugador ${quien} ve el dorso comprado del 0`,
      v.jugadores[0].dorso,
    );
  }

  ok(
    filtracionesEn(vistaDe(estado, 0), estado).length === 0,
    "y los campos nuevos no filtran ninguna carta",
  );
}

console.log("\n=== La mesa prefiere lo que trae la vista ===");
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

  // El dorso, igual, con la misma caída. `dorsoDe` ya sabe la excepción del
  // asiento propio, así que en entrenamiento —donde la vista no trae dorso—
  // no cambia absolutamente nada.
  ok(
    /const reversoDe = \(jugador, i\) =>\s*\n\s*esRutaDelSitio\(jugador\?\.dorso\) \? jugador\.dorso : dorsoDe\(i\)/.test(mesa),
    "el reverso sale de la vista, y si no sirve cae al del asiento",
  );

  // Y la mano tiene que PEDIRLO. Sin esta línea `reversoDe` existe, la prueba
  // de arriba pasa, y en la mesa se siguen viendo los dorsos del asiento.
  ok(
    /dorso: reversoDe\(jugador, i\)/.test(mesa),
    "y la mano de cada jugador se dibuja con el suyo",
  );

  // La insignia va como imagen y con `alt`: es un logro, tiene nombre y se
  // cuenta. El retrato es decoración —el nombre está al lado— y va con `alt`
  // vacío. Son dos decisiones distintas a propósito.
  ok(
    /class="insignia-mesa" src="\$\{escapar\(jugador\.insignia\)\}" alt="Insignia"/.test(mesa),
    "la insignia se dibuja escapada y anunciada",
  );
  ok(
    readFileSync(new URL("../public/css/mesa.css", import.meta.url), "utf8").includes(".insignia-mesa"),
    "y tiene estilo: sin regla saldría del tamaño del archivo",
  );
}

console.log(fallos === 0 ? "\n✅ TODO OK" : `\n❌ ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
