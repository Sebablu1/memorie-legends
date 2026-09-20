/**
 * El reglamento y el código dicen lo mismo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `public/reglamento-partidas.html` es el reglamento oficial: no es un resumen
 * de otro documento, es el documento. `como-se-juega.html` es la guía corta
 * que lleva hasta él. Y un reglamento escrito a mano se separa
 * del juego sin que nadie se entere — ya pasó tres veces:
 *
 *   - decía que acertar tarde descartaba la carta «pero recibís una más»
 *     (neto 0) cuando el juego la conserva y suma una (neto +1), y así estuvo
 *     meses;
 *   - decía que la mirada duraba 2 segundos sin separar elegir de ver;
 *   - decía que el límite era 150 y nada más, cuando ya se jugaba a 60 y 100.
 *
 * Nada de eso lo agarra una prueba de reglas: el motor estaba bien. Lo que
 * estaba mal era lo que el jugador leía.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ COMPRUEBA, Y QUÉ NO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Los NÚMEROS, que son lo que se puede comparar sin interpretar prosa: la
 * tabla de tiempos contra las constantes del motor, y las duraciones contra
 * la lista de límites. Más un puñado de frases que ya estuvieron mal, para
 * que no vuelvan.
 *
 * No comprueba la redacción. Que el capítulo del descarte al rival explique
 * bien la jugada es trabajo de quien lo escribe; que diga «5 segundos» cuando
 * el motor espera 5000 ms, es trabajo de acá.
 */

import { readFileSync, readdirSync } from "node:fs";
import * as M from "../public/js/reglas/motor.js";
import { MS_GRACIA, MS_PARA_DECIDIR } from "../public/js/reglas/red.js";
import { MS_REVELACION } from "../public/js/reglas/vista.js";
import { MS_ESPERA_LLEGADAS } from "../functions/partida-red.js";
import { LIMITES_DE_PARTIDA } from "../public/js/reglas/puntaje.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

/**
 * El reglamento completo vive en `reglamento-partidas.html` desde que
 * `como-se-juega.html` pasó a ser la guía de dos minutos. Lo que se compara
 * contra las constantes es el reglamento; la guía se mira aparte, al final.
 */
const pagina = readFileSync(
  new URL("../public/reglamento-partidas.html", import.meta.url), "utf8",
);

/** La guía corta: la puerta de entrada, y lo primero que lee cualquiera. */
const guia = readFileSync(
  new URL("../public/como-se-juega.html", import.meta.url), "utf8",
);

/** El texto de la página sin etiquetas, para buscar frases. */
const texto = pagina.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

/**
 * Las reglas, sin el anexo.
 *
 * El anexo CITA las frases viejas —«antes decía…»— y tiene que poder hacerlo:
 * es su trabajo. Lo que no puede pasar es que una de esas frases siga viva
 * arriba, donde se leen las reglas.
 */
const reglas = pagina.slice(0, pagina.indexOf('id="anexo"'));

// =====================================================================
console.log("\n=== 1. La tabla de tiempos sale de las constantes ===");
// =====================================================================

/**
 * Cada fila de la tabla, con el milisegundo que la respalda.
 *
 * La clave es el texto exacto de la primera columna. Si alguien la reescribe,
 * esta prueba se pone roja y hay que actualizar las dos cosas a la vez, que es
 * exactamente lo que se busca.
 */
const TIEMPOS = {
  "Elegir la carta de la mirada inicial": M.MS_ELEGIR_MIRADA,
  "Ver la carta mirada": M.MS_MIRAR,
  "Descarte por reflejos": M.MS_DESCARTE,
  "Gracia de red para un toque": MS_GRACIA,
  "Revelación por error o acierto tarde": MS_REVELACION,
  "Levantar del mazo": M.MS_TURNO,
  "Decidir qué hacer con la levantada": MS_PARA_DECIDIR,
  "Resolver un poder": MS_PARA_DECIDIR,
  "Cortar o pasar": M.MS_PASO_AUTOMATICO,
  "Elegir la carta que entregás tras un acierto": M.MS_PARA_ENTREGAR,
  "Ventana de reapertura al cambiar la muestra": M.MS_REAPERTURA,
  "Ventana privada después de un poder": M.MS_REAPERTURA,
  "Espera de jugadores en la primera ronda": MS_ESPERA_LLEGADAS,
  "Cuenta regresiva antes de la primera mirada": M.MS_CUENTA_REGRESIVA,
};

/** Las filas tal como están escritas: [momento, segundos]. */
const filas = [...pagina.matchAll(
  /<tr><td>([^<]+)<\/td><td class="num">(\d+) s<\/td>/g,
)].map((m) => [m[1].trim(), Number(m[2])]);

ok(filas.length === Object.keys(TIEMPOS).length,
   `la tabla tiene las ${Object.keys(TIEMPOS).length} filas esperadas`, filas.length);

for (const [momento, ms] of Object.entries(TIEMPOS)) {
  const fila = filas.find(([m]) => m === momento);
  if (!fila) {
    ok(false, `falta la fila "${momento}"`, filas.map(([m]) => m));
    continue;
  }
  ok(fila[1] * 1000 === ms,
     `"${momento}": la página dice ${fila[1]} s y el código ${ms} ms`,
     { pagina: fila[1] * 1000, codigo: ms });
}

// =====================================================================
console.log("\n=== 2. Las duraciones de partida son las tres ===");
// =====================================================================

for (const limite of LIMITES_DE_PARTIDA) {
  ok(texto.includes(String(limite)),
     `la página nombra el límite de ${limite} puntos`);
}

ok(/150, 100 o 60|150, 100 y 60|60, 100 o 150|—150, 100 o 60—/.test(texto),
   "y los ofrece juntos, como las tres duraciones de una misma mesa");

// =====================================================================
console.log("\n=== 3. Las frases que ya estuvieron mal ===");
// =====================================================================

/**
 * Cada una estuvo escrita en la página y contradecía al motor. No vuelven.
 */
const PROHIBIDAS = [
  [/la descartás igual/i, "el acierto tarde NO descarta la carta: la conserva y suma una"],
  [/Mirada · 2 segundos/i, "la mirada no dura 2 segundos: son 5 para elegir y 2 para ver"],
  [/por debajo de\s*<b>150 puntos<\/b>/i, "el límite no es siempre 150: la mesa lo elige"],
];

ok(reglas.length > 0 && reglas.length < pagina.length,
   "el anexo está al final y se puede separar de las reglas");

for (const [patron, porque] of PROHIBIDAS) {
  ok(!patron.test(reglas), porque);
}

/** Y lo que tiene que estar dicho, porque es lo que el juego hace. */
const EXIGIDAS = [
  [/conservás tu carta y sumás una de castigo/i, "el acierto tarde conserva la carta y suma una"],
  [/un intento por ventana/i, "un intento por ventana sobre la mano propia"],
  [/5 segundos para elegir, 2 para ver/i, "la mirada, con sus dos tiempos"],
  [/60 milisegundos/i, "el empate técnico y su sorteo determinista"],
  [/Anexo de cambios/i, "el anexo que cuenta qué cambió"],
];

for (const [patron, que] of EXIGIDAS) {
  ok(patron.test(texto) || patron.test(pagina), `la página explica ${que}`);
}

// =====================================================================
console.log("\n=== 4. La mirada, en los dos modos y en un solo lugar ===");
// =====================================================================

ok(M.MS_MIRADA_TOTAL === M.MS_ELEGIR_MIRADA + M.MS_MIRAR,
   "la mirada entera es elegir más ver", M.MS_MIRADA_TOTAL);

ok(M.MS_ELEGIR_MIRADA === 5000 && M.MS_MIRAR === 2000,
   "y son los 5 + 2 que dice el reglamento",
   { elegir: M.MS_ELEGIR_MIRADA, ver: M.MS_MIRAR });

// =====================================================================
console.log("\n=== 5. Las otras páginas cuentan lo mismo ===");
// =====================================================================

/**
 * El tablero y la portada resumen las reglas en un párrafo, y un resumen que
 * dice otra cosa es tan malo como un reglamento equivocado: la mayoría de los
 * jugadores lee ESO y no la página entera.
 *
 * Los dos decían «durante 2 segundos» y «supera 150 puntos» cuando ya había
 * cinco segundos para elegir y partidas de 60 y de 100.
 */
const RESUMENES = ["dashboard.html", "index.html"];

for (const nombre of RESUMENES) {
  const otra = readFileSync(new URL(`../public/${nombre}`, import.meta.url), "utf8")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const suTexto = otra.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  ok(!/cuatro cartas durante 2 segundos/i.test(suTexto),
     `${nombre} no dice que la mirada dure 2 segundos`);
  ok(!/supera\s*(<b>)?\s*150 puntos/i.test(otra) && !/supera 150 queda/i.test(suTexto),
     `${nombre} no da los 150 puntos por único límite`);
}

// =====================================================================
console.log("\n=== 6. Las insignias se EQUIPAN y se DESEQUIPAN ===");
// =====================================================================

/**
 * Una acción, una palabra.
 *
 * La tienda y el inventario decían «Equipar» y «Desequipar»; la vitrina de
 * logros, «Ponérmela» y «Sacármela» para exactamente lo mismo. Cuatro
 * palabras para dos acciones, y el jugador tiene que darse cuenta solo de que
 * son la misma cosa.
 *
 * Esto barre todo lo que el jugador puede leer —las páginas, el JavaScript
 * del navegador y la herramienta que copia ese HTML— y no deja volver las
 * palabras viejas ni entrar sinónimos nuevos.
 */
function archivosDeTexto(carpeta) {
  const salida = [];
  for (const entrada of readdirSync(new URL(`../${carpeta}/`, import.meta.url), { withFileTypes: true })) {
    if (entrada.name === "vendor" || entrada.name === "node_modules") continue;
    const ruta = `${carpeta}/${entrada.name}`;
    if (entrada.isDirectory()) salida.push(...archivosDeTexto(ruta));
    else if (/\.(html|js|mjs)$/.test(entrada.name)) salida.push(ruta);
  }
  return salida;
}

const MIRADOS = [...archivosDeTexto("public"), ...archivosDeTexto("herramientas")];
ok(MIRADOS.length > 20, "hay archivos que mirar", MIRADOS.length);

/** Las que estuvieron y no vuelven, en cualquier archivo. */
const VIEJAS = /Pon[eé]rmela|Sac[aá]rmela|Poner insignia|Sacar insignia|Quitar insignia/i;

const conViejas = MIRADOS.filter((ruta) =>
  VIEJAS.test(readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8")));

ok(conViejas.length === 0,
   "«Ponérmela» y «Sacármela» no vuelven a aparecer en ninguna parte", conViejas);

/**
 * Y en las tres pantallas donde se equipa algo, la etiqueta de un botón de
 * esta familia sólo puede ser una de las dos palabras.
 *
 * `cuenta.js` también tiene un botón que dice «Quitar», y está bien: saca un
 * segundo factor de autenticación, no una insignia. Por eso la regla mira
 * estos archivos y no todos.
 */
const DONDE_SE_EQUIPA = ["public/js/logros.js", "public/js/inventario.js",
                         "public/js/personalizacion.js"];
const PROHIBIDAS_EN_BOTON = /^(Poner|Ponerla|Ponérmela|Sacar|Sacarla|Sacármela|Quitar|Activar|Desactivar|Mostrar|Ocultar)$/i;

for (const ruta of DONDE_SE_EQUIPA) {
  const fuente = readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
  const etiquetas = [...fuente.matchAll(/>([^<>{}$\n]{3,20})<\/button>/g)]
    .map((m) => m[1].trim());
  const malas = etiquetas.filter((t) => PROHIBIDAS_EN_BOTON.test(t));
  ok(malas.length === 0, `${ruta}: ningún botón dice otra cosa que Equipar o Desequipar`, malas);
}

const vitrina = readFileSync(new URL("../public/js/logros.js", import.meta.url), "utf8");
ok(/>Equipar<\/button>/.test(vitrina), "la vitrina de logros ofrece Equipar");
ok(/>Desequipar<\/button>/.test(vitrina), "y Desequipar");

// =====================================================================
console.log("\n=== 7. La guía corta lleva a los dos reglamentos ===");
// =====================================================================

/**
 * `como-se-juega.html` es la puerta: dos minutos de lectura y se puede
 * jugar. Lo que se comprueba es que siga siendo eso —corta— y que no deje al
 * jugador sin camino al detalle.
 *
 * Era el reglamento entero, con catorce filas de relojes y el capítulo del
 * descarte al rival: lo primero que veía alguien que nunca jugó.
 */
const textoGuia = guia.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

ok(guia.length < pagina.length / 2,
   "la guía es menos de la mitad del reglamento",
   { guia: guia.length, reglamento: pagina.length });

ok(!/<table/.test(guia), "y no tiene ninguna tabla: eso es del reglamento");

for (const [destino, que] of [
  ["reglamento-partidas.html", "al reglamento de partidas"],
  ["reglamento-torneos.html", "al de torneos"],
]) {
  ok(new RegExp(`href="${destino}"`).test(guia), `la guía lleva ${que}`);
}

// Lo mínimo que tiene que decir para poder jugar una mano.
for (const [patron, que] of [
  [/cinco segundos para elegir|5 segundos para elegir/i, "cuánto dura la mirada"],
  [/una sola/i, "que se mira una sola carta"],
  [/supera el límite de la mesa/i, "cómo se pierde"],
  [/7|8|9|10/, "los poderes"],
  [/puntaje más bajo/i, "cuándo cortar"],
]) {
  ok(patron.test(textoGuia), `la guía explica ${que}`);
}

// Y no puede contradecir al reglamento: son las mismas frases prohibidas.
for (const [patron, porque] of PROHIBIDAS) {
  ok(!patron.test(guia), `la guía tampoco: ${porque}`);
}

// El reglamento de torneos avisa que no habla del juego.
const torneos = readFileSync(
  new URL("../public/reglamento-torneos.html", import.meta.url), "utf8",
);
ok(/sólo para torneos/i.test(torneos), "el reglamento de torneos dice que es sólo de torneos");
ok(/href="\/reglamento-partidas\.html"/.test(torneos), "y manda al de partidas");

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
