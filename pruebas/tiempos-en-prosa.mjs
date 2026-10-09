/**
 * Los tiempos escritos en PALABRAS, contra el motor.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `reglamento.mjs` ya compara la tabla de `reglamento-partidas.html` contra el
 * motor, pero lo hace buscando filas con la forma `<td class="num">N s</td>`.
 * `como-se-juega.html` no tiene tabla: dice «Dos segundos de reflejos» y
 * «Cinco segundos para elegir cuál y dos para verla», en prosa y con los
 * números escritos con letras. Eso no lo mira nadie.
 *
 * Y ya mintió. Cuando `f5749a5` bajó `MS_DESCARTE` de 5 s a 2, esta página
 * siguió diciendo «cinco segundos de reflejos» en el cuerpo y en sus tres
 * metas. Se corrigió a mano, sin que ninguna prueba se enterara ni antes ni
 * después. Es el mismo agujero que tenía el 100 de la portada.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO SE PARSEA LA PROSA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque no se puede hacer bien. La misma página dice «La guía de dos
 * minutos», que no es un tiempo de juego; el «dos» de «dos para verla» no
 * lleva la palabra «segundos» al lado; y mañana alguien escribe «en un
 * segundo lo entendés» y rompe una prueba que adivina.
 *
 * Así que la página DECLARA de qué habla cada mención, con un atributo:
 *
 *     <h3 data-tiempo="MS_DESCARTE">Dos segundos de reflejos</h3>
 *     <p data-tiempo="MS_ELEGIR_MIRADA,MS_MIRAR">Cinco segundos para …</p>
 *
 * El atributo nombra la CONSTANTE, no el valor. Un `data-ms="2000"` habría
 * sido el mismo número cableado mudado de archivo: cambiar `MS_DESCARTE` a
 * 3000 lo dejaría coincidiendo con la palabra «dos» y la prueba pasaría. Con
 * el nombre, el valor lo pone el motor y la página tiene que seguirlo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ CUBRE Y QUÉ NO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * CUBRE: que cada elemento marcado diga, en palabras, el número que hoy tiene
 * cada constante que declara; y que no quede ninguna mención de «segundos»
 * fuera de un elemento marcado, para que agregar una frase nueva sin marcarla
 * se note acá y no en producción.
 *
 * NO CUBRE: que la frase tenga sentido. Si `MS_MIRAR` pasara a 5000 y
 * `MS_ELEGIR_MIRADA` también, a esta prueba le alcanzaría con que la palabra
 * «cinco» aparezca una vez en el párrafo, aunque haga falta dos veces. Es el
 * precio de no parsear prosa, y es barato: el caso pide que los dos tiempos
 * sean iguales, que hoy no lo son.
 *
 * TAMPOCO cubre los números escritos con dígitos. Esta página no los usa; los
 * de `reglamento-partidas.html` ya los mira `reglamento.mjs`.
 */

import { readFileSync } from "node:fs";
import * as MOTOR from "../public/js/reglas/motor.js";
import * as RED from "../public/js/reglas/red.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else {
    fallos++;
    console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : "");
  }
};

const RAIZ = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const leer = (relativo) => readFileSync(RAIZ + relativo, "utf8");

const PAGINA = "public/como-se-juega.html";
const html = leer(PAGINA);

/**
 * Los números como los escribe esta página.
 *
 * Sólo los que hacen falta. Si mañana una constante cae en un valor que no
 * está acá, la prueba lo dice con el número a la vista en vez de pasar de
 * largo: agregar la fila es más barato que descubrir que no vigilaba nada.
 */
const EN_PALABRAS = Object.freeze({
  1000: "un", 2000: "dos", 3000: "tres", 4000: "cuatro", 5000: "cinco",
  6000: "seis", 7000: "siete", 8000: "ocho", 9000: "nueve", 10000: "diez",
  15000: "quince", 20000: "veinte",
});

/** El valor de una constante, la busque donde la busque. */
const valorDe = (nombre) =>
  Object.hasOwn(MOTOR, nombre) ? MOTOR[nombre]
  : Object.hasOwn(RED, nombre) ? RED[nombre]
  : undefined;

/**
 * Los elementos marcados, con su texto.
 *
 * Dos formas, porque `<meta>` no tiene cierre: de las metas se lee el
 * `content`, y de los demás, lo que va entre la etiqueta y su cierre. Alcanza
 * para lo que hay —ninguno anida otro elemento con marca— y si algún día no
 * alcanzara, la comprobación de cobertura de abajo lo denuncia.
 */
function marcados(fuente) {
  const encontrados = [];

  for (const m of fuente.matchAll(/<meta\s+data-tiempo="([^"]+)"([^>]*)>/g)) {
    encontrados.push({
      donde: "meta",
      constantes: m[1].split(",").map((s) => s.trim()).filter(Boolean),
      texto: (m[2].match(/content="([^"]*)"/) ?? [, ""])[1],
      crudo: m[0],
    });
  }

  for (const m of fuente.matchAll(
    /<(?!meta\b)([a-z0-9]+)\s[^>]*data-tiempo="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g,
  )) {
    encontrados.push({
      donde: `<${m[1]}>`,
      constantes: m[2].split(",").map((s) => s.trim()).filter(Boolean),
      texto: m[3].replace(/<[^>]*>/g, " "),
      crudo: m[0].slice(0, 70),
    });
  }

  return encontrados;
}

// =====================================================================
console.log("\n=== 1. Cada mención marcada dice lo que dice el motor ===");
// =====================================================================

const marcas = marcados(html);

ok(marcas.length > 0, `${PAGINA} tiene menciones marcadas`, marcas.length);

for (const { donde, constantes, texto, crudo } of marcas) {
  for (const nombre of constantes) {
    const ms = valorDe(nombre);

    if (!Number.isFinite(ms)) {
      ok(false, `${donde}: ${nombre} no es una constante del motor`, crudo);
      continue;
    }

    const palabra = EN_PALABRAS[ms];
    if (!palabra) {
      ok(false,
         `${donde}: ${nombre} vale ${ms} ms y no hay palabra para ese número — agregala a EN_PALABRAS`,
         ms);
      continue;
    }

    ok(new RegExp(`\\b${palabra}\\b`, "i").test(texto),
       `${donde}: ${nombre} son ${ms} ms, así que el texto dice «${palabra}»`,
       texto.trim().replace(/\s+/g, " ").slice(0, 110));
  }
}

// =====================================================================
console.log("\n=== 2. Y no hay menciones sueltas sin marcar ===");
// =====================================================================

{
  /*
   * La otra mitad. Sin esto, la prueba sólo defiende lo que ya está marcado:
   * alguien agrega «tenés ocho segundos para cortar» en un párrafo nuevo y
   * nadie se entera de que quedó fuera de la vigilancia.
   *
   * Se buscan las menciones de «segundos» en el texto visible. «Dos minutos»
   * no entra —no dice segundos— y por eso la frase de la guía no molesta.
   */
  const NUMEROS = Object.values(EN_PALABRAS).join("|");
  const MENCION = new RegExp(`\\b(${NUMEROS}|\\d+)\\s+segundos?\\b`, "gi");

  // El texto de cada elemento marcado, para saber qué menciones ya están
  // cubiertas. Se cuentan apariciones: dos menciones iguales en dos lugares
  // distintos necesitan dos marcas.
  const cubierto = marcas.map(({ texto }) => texto).join("\n");
  const cuantas = (donde) => [...donde.matchAll(MENCION)].map((m) => m[0].toLowerCase());

  const visible = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Los atributos que SÍ se leen —`content` de las metas— se dejan; el resto
    // de la etiqueta se va, para no contar un `data-` ni una clase.
    .replace(/<meta[^>]*content="([^"]*)"[^>]*>/gi, " $1 ")
    .replace(/<[^>]*>/g, " ");

  const todas = cuantas(visible);
  const yaCubiertas = cuantas(cubierto);

  // Cada mención de la página tiene que tener su par entre las marcadas.
  const restantes = [...yaCubiertas];
  const sueltas = todas.filter((m) => {
    const i = restantes.indexOf(m);
    if (i === -1) return true;
    restantes.splice(i, 1);
    return false;
  });

  ok(sueltas.length === 0,
     "toda mención de segundos vive dentro de un elemento con data-tiempo",
     sueltas);
}

console.log(fallos ? `\n❌ ${fallos} fallos` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
