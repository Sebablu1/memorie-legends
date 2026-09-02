/**
 * Ningún nombre elegido por un jugador entra a innerHTML sin escapar.
 *
 * EL AGUJERO
 *
 * Las reglas de Firestore dejan que cada uno escriba su propio nombre
 * —`allow update: if esDuenio(uid)`— y ese nombre lo leen todos los demás. En
 * la mesa, en la sala de espera, en el listado de salas y en el ranking. Un
 * jugador llamado `<img src=x onerror="...">` ejecutaba lo que quisiera en el
 * navegador de los otros, con la sesión de ellos abierta. En una partida por
 * Leyendas ésa es la sesión con la que se mueve el saldo.
 *
 * POR QUÉ SE AUDITA EL ARCHIVO Y NO SÓLO SE PRUEBA LA FUNCIÓN
 *
 * Que `escapar` funcione no sirve de nada si alguien escribe una plantilla
 * nueva y se olvida de llamarla. Los primeros arreglos taparon la mesa; una
 * auditoría como ésta encontró después CUATRO sitios más que nadie había
 * mirado, incluida la tabla del ranking, que es la pantalla que ve más gente.
 * Sin recorrer los archivos, esos cuatro seguirían abiertos.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

import { escapar } from "../public/js/modulos/texto.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

// ══════════════════════════════════════════════════ la función

console.log("\n=== Escapar hace lo que dice ===");
{
  ok(escapar('<img src=x onerror="alert(1)">') === "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
     "una etiqueta con atributo queda inofensiva", escapar('<img src=x onerror="alert(1)">'));

  ok(escapar("Ana & Bruno") === "Ana &amp; Bruno", "el & se escapa");

  // Encadenar cinco `replace` produciría `&amp;lt;` a partir de un `<`. Con un
  // solo recorrido eso no pasa, y ésta es la prueba de que no pasa.
  ok(escapar("<") === "&lt;", "un < NO se escapa dos veces", escapar("<"));
  ok(escapar("&lt;") === "&amp;lt;", "y algo ya escapado se trata como texto");

  ok(escapar("O'Brien") === "O&#39;Brien", "la comilla simple, que rompe atributos");
  ok(escapar(null) === "" && escapar(undefined) === "", "nulo y ausente dan cadena vacía");
  ok(escapar(42) === "42", "un número pasa como texto");

  // Lo que NO tiene que hacer: destrozar un nombre normal.
  ok(escapar("Sebastián Rodríguez") === "Sebastián Rodríguez",
     "y un nombre común queda intacto, acentos incluidos");
}

// ═══════════════════════════════ el escapado está donde tiene que estar

console.log("\n=== Ninguna plantilla mete un nombre sin escapar ===");
{
  /** Campos que un jugador puede escribir, directa o indirectamente. */
  const DE_USUARIO = ["nombre", "inicial", "username", "displayName", "motivoCancelacion"];

  /**
   * Lo que NO cuenta: `tienda.js` interpola `p.nombre`, pero ese `p` sale de
   * `PAQUETES`, una constante del propio código. Escaparlo no haría daño, pero
   * anotarlo acá es más honesto que ensuciar la plantilla para callar a una
   * herramienta.
   */
  const PERMITIDOS = new Set(["public/js/tienda.js"]);

  const archivos = [];
  (function recorrer(dir) {
    for (const entrada of readdirSync(dir)) {
      const ruta = join(dir, entrada);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (entrada.endsWith(".js")) archivos.push(ruta);
    }
  })(join(raiz, "public", "js"));

  const sinEscapar = [];
  for (const ruta of archivos) {
    const corta = relative(raiz, ruta).replace(/\\/g, "/");
    if (PERMITIDOS.has(corta)) continue;
    const fuente = readFileSync(ruta, "utf8");

    // Sólo plantillas que de verdad construyen HTML: llevan una etiqueta.
    for (const plantilla of fuente.matchAll(/`[^`]*<[a-z][^`]*`/gs)) {
      for (const campo of DE_USUARIO) {
        const patron = new RegExp("\\$\\{([^}]*\\b" + campo + "\\b[^}]*)\\}", "g");
        for (const uso of plantilla[0].matchAll(patron)) {
          if (uso[1].includes("escapar(")) continue;
          const linea = fuente.slice(0, plantilla.index + uso.index).split("\n").length;
          sinEscapar.push(`${corta}:${linea} -> \${${uso[1].trim()}}`);
        }
      }
    }
  }

  ok(sinEscapar.length === 0,
     `${archivos.length} archivos revisados, ninguna interpolación sin escapar`,
     sinEscapar);

  // Y que el escapado no se haya "arreglado" borrando las plantillas: las
  // cuatro pantallas tienen que seguir mostrando nombres.
  for (const [archivo, que] of [
    ["public/js/room.js", "la lista de la sala de espera"],
    ["public/js/lobby.js", "el listado de salas"],
    ["public/js/ranking-ui.js", "la tabla del ranking"],
    ["public/js/mesa.js", "el fin de ronda"],
  ]) {
    const fuente = readFileSync(join(raiz, archivo), "utf8");
    ok(fuente.includes("escapar("), `${que} sigue escapando`, archivo);
  }
}

// ═════════════════════════════════ una sola definición, no cinco copias

console.log("\n=== Escapar se define UNA vez ===");
{
  const fuente = readFileSync(join(raiz, "public", "js", "modulos", "texto.js"), "utf8");
  ok(fuente.includes("export const escapar"), "vive en modulos/texto.js");

  // `ui.js` la re-exporta para no tener que tocar mesa.js, pero no la
  // reimplementa: dos copias es una que se arregla y otra que no.
  const ui = readFileSync(join(raiz, "public", "js", "modulos", "ui.js"), "utf8");
  ok(ui.includes('export { escapar } from "./texto.js"'),
     "y ui.js la re-exporta en vez de repetirla");
  ok(!/const escapar =/.test(ui), "sin una segunda copia en ui.js");
}

console.log(fallos ? `\n❌ ${fallos} fallos\n` : "\n✅ TODO OK\n");
process.exit(fallos ? 1 : 0);
