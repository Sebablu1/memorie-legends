/**
 * Una suite que no corre tiene que romper, no quedarse callada.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ AGUJERO TAPA ESTO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Las suites se corren desde una lista escrita a mano —`lista-de-suites.mjs`—
 * y no desde un glob: cada suite nueva hay que agregarla ahí, y si uno se
 * olvida, no pasa nada de nada. El archivo queda en el repositorio, se lee como
 * una prueba, se actualiza cuando alguien toca el código de al lado — y no se
 * ejecuta nunca.
 *
 * Pasó mientras se escribía `ventana-tras-poder.mjs`: la suite estaba en
 * verde corriéndola a mano y `npm test` seguía diciendo lo mismo que antes.
 * Se descubrió por un número que no cuadraba, no porque algo fallara.
 *
 * Y es peor que no tener la prueba. Una suite ausente se nota; una suite que
 * existe y no corre da confianza falsa sobre justo la parte que alguien se
 * tomó el trabajo de cubrir.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO SE REEMPLAZA LA LISTA POR UN GLOB
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Sería la otra salida, y es tentadora. Pero la lista tiene un orden elegido:
 * las reglas puras primero y las de red después, así que cuando algo se rompe
 * abajo ya se sabe que lo de arriba está bien. Un glob las corre por orden
 * alfabético y esa señal se pierde.
 *
 * Se conserva la lista y se le pone un cerrojo. Es lo mismo que hace
 * `dobles-de-partida.mjs` con los módulos de mentira: el descuido es
 * inevitable, así que se vuelve ruidoso.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA LISTA ESTABA EN package.json Y SE MUDÓ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Era una cadena de ochenta y tres `node pruebas/... &&`. Acá decía que el
 * corte en el primer fallo era una ventaja —en una laptop no querés esperar
 * sesenta suites para leer el error de la tercera— y se sostuvo hasta que una
 * suite se quedó en rojo de forma permanente.
 *
 * `abandono-red.mjs` es la número 17 de 83. Con ella rota, las 66 posteriores
 * NO CORRIERON NUNCA, y `npm test` imprimía un error que se leía como un solo
 * problema. Era confianza falsa sobre dos tercios del proyecto.
 *
 * Ahora la lista vive en `lista-de-suites.mjs` y la corre `correr-todas.mjs`,
 * que sigue después de una falla y da un resumen al final. El argumento de la
 * laptop se paga de otra forma: cada suite imprime mientras corre, así que el
 * error de la tercera se sigue leyendo cuando ocurre.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DÓNDE VAN LOS AYUDANTES
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Esto daba por hecho que todo `pruebas/*.mjs` es una suite, y dejó de ser
 * cierto: `correr-todas.mjs` y `lista-de-suites.mjs` son el andamio que corre a
 * las demás. Van nombrados uno por uno en `INFRA`, abajo, y no por un patrón:
 * una regla del estilo «lo que empiece con guion bajo no cuenta» sería una
 * puerta por la que puede colarse una suite de verdad sin que nadie lo note,
 * que es exactamente el agujero que este archivo tapa.
 *
 * Si alguna vez hace falta un módulo compartido que NO sea una suite ni
 * andamio, que no vaya suelto acá —que sea `.js`, o que viva en una carpeta
 * propia—. Un ayudante suelto haría fallar esta prueba, y el arreglo sería
 * agregarlo a la lista, que es exactamente lo que no hay que hacer.
 *
 * Las de navegador no entran: Playwright encuentra `pruebas/e2e/*.spec.js` por
 * su cuenta y no hay ninguna lista que mantener.
 */

import { readFileSync, readdirSync } from "node:fs";

import { SUITES } from "./lista-de-suites.mjs";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

const guion = JSON.parse(readFileSync("package.json", "utf8")).scripts.test;

// La lista se IMPORTA, ya no se saca del JSON a fuerza de expresiones
// regulares. Es la misma que corre de verdad, no una lectura de ella.
const enLaLista = SUITES;

/**
 * El andamio, nombrado uno por uno.
 *
 * Son los dos archivos de `pruebas/` que no son suites: el que tiene la lista y
 * el que la corre. No van en `SUITES` —correrlos como suite no tendría sentido:
 * uno sólo exporta un arreglo y el otro arrancaría las ochenta y tres de nuevo,
 * desde adentro— así que el caso 1 los vería como huérfanos.
 */
const INFRA = new Set(["correr-todas.mjs", "lista-de-suites.mjs"]);

const enDisco = readdirSync("pruebas")
  .filter((f) => f.endsWith(".mjs"))
  .filter((f) => !INFRA.has(f));

// =====================================================================
console.log("\n=== 1. Toda suite en disco está en la lista ===");
// =====================================================================
{
  const registradas = new Set(enLaLista);
  const huerfanas = enDisco.filter((f) => !registradas.has(f));

  ok(
    huerfanas.length === 0,
    huerfanas.length
      ? `hay suites que NO corren: agregalas a pruebas/lista-de-suites.mjs`
      : "ninguna suite quedó afuera",
    huerfanas.length ? huerfanas : undefined,
  );
}

// =====================================================================
console.log("\n=== 2. Y toda ruta de la lista existe ===");
// =====================================================================
{
  /**
   * El descuido simétrico: renombrar o borrar una suite y dejar la ruta vieja.
   *
   * Ése al menos hace ruido —la suite fantasma sale con "Cannot find module" y
   * el runner la cuenta en rojo— pero el mensaje llega a mitad de la corrida y
   * manda a buscar el problema en el código de la suite anterior, que es la
   * última que se vio pasar. Acá sale por su nombre y antes de correr nada.
   */
  const hay = new Set(enDisco);
  const fantasmas = enLaLista.filter((f) => !hay.has(f));

  ok(
    fantasmas.length === 0,
    fantasmas.length ? "la lista nombra archivos que no existen" : "y ninguna ruta apunta al vacío",
    fantasmas.length ? fantasmas : undefined,
  );
}

// =====================================================================
console.log("\n=== 3. Ninguna aparece dos veces ===");
// =====================================================================
{
  /**
   * Una suite repetida no rompe nada: corre dos veces y tarda el doble. Pero
   * casi siempre es el síntoma de un copiar y pegar en el que se cambió una
   * ruta y no la otra, y entonces hay una tercera que quedó afuera — que es el
   * caso 1, escondido detrás de un total que da bien.
   */
  const vistas = new Set();
  const repetidas = enLaLista.filter((f) => (vistas.has(f) ? true : (vistas.add(f), false)));

  ok(repetidas.length === 0, "cada suite aparece una sola vez",
     repetidas.length ? repetidas : undefined);
}

// =====================================================================
console.log("\n=== 4. Y esta prueba está en la lista ===");
// =====================================================================
{
  /**
   * El caso gracioso, y el único que no se arregla solo: un cerrojo que no
   * corre no cierra nada. Si alguien la sacara de la lista, ninguno de los
   * tres casos de arriba volvería a ejecutarse y todo seguiría en verde.
   */
  ok(enLaLista.includes("suites-registradas.mjs"),
     "el cerrojo se comprueba a sí mismo");
}

// =====================================================================
console.log("\n=== 5. Y `npm test` corre el runner, no otra cosa ===");
// =====================================================================
{
  /**
   * La otra mitad del caso 4, y hace falta desde que la lista salió de
   * `package.json`.
   *
   * Hasta ahora las dos cosas eran una sola: la lista ERA el script, así que
   * comprobar la lista era comprobar lo que se ejecuta. Ahora están separadas,
   * y eso abre un agujero nuevo: alguien podría dejar la lista impecable —los
   * cuatro casos de arriba en verde— y que `npm test` apunte a otro lado. Un
   * `"test": "node pruebas/puntaje.mjs"` dejaría todo verde corriendo una sola
   * suite.
   *
   * Se mira el texto del script y no se ejecuta nada: lo único que hay que
   * saber es que el runner es el que manda.
   */
  ok(guion.includes("pruebas/correr-todas.mjs"),
     'el script "test" de package.json corre pruebas/correr-todas.mjs',
     guion.includes("pruebas/correr-todas.mjs") ? undefined : guion);

  /**
   * Y que no haya quedado nada de la cadena vieja. Un `&&` suelto significa que
   * alguien volvió a encadenar suites a mano, y con eso vuelve el corte en el
   * primer fallo que este cambio vino a sacar.
   */
  ok(!guion.includes("&&"),
     "y no quedó ninguna suite encadenada a mano con &&",
     guion.includes("&&") ? guion : undefined);
}

console.log(fallos ? `\n❌ ${fallos} FALLOS` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
