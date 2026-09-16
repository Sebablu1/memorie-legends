/**
 * Una suite que no corre tiene que romper, no quedarse callada.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ AGUJERO TAPA ESTO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El script `test` de `package.json` es una lista de rutas escrita a mano,
 * encadenada con `&&`. No hay ningún glob: cada suite nueva hay que agregarla
 * ahí, y si uno se olvida, no pasa nada de nada. El archivo queda en el
 * repositorio, se lee como una prueba, se actualiza cuando alguien toca el
 * código de al lado — y no se ejecuta nunca.
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
 * Además `&&` corta en el primer fallo, que es lo que se quiere en una laptop:
 * no hay que esperar sesenta suites para leer el error de la tercera.
 *
 * Se conserva la lista y se le pone un cerrojo. Es lo mismo que hace
 * `dobles-de-partida.mjs` con los módulos de mentira: el descuido es
 * inevitable, así que se vuelve ruidoso.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DÓNDE VAN LOS AYUDANTES
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Esto da por hecho que todo `pruebas/*.mjs` es una suite. Hoy es cierto: los
 * 62 archivos lo son. Si alguna vez hace falta un módulo compartido que NO sea
 * una suite, que no vaya suelto acá —que sea `.js`, o que viva en una carpeta
 * propia—. Un ayudante suelto haría fallar esta prueba, y el arreglo sería
 * agregarlo a `npm test`, que es exactamente lo que no hay que hacer.
 *
 * Las de navegador no entran: Playwright encuentra `pruebas/e2e/*.spec.js` por
 * su cuenta y no hay ninguna lista que mantener.
 */

import { readFileSync, readdirSync } from "node:fs";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

const guion = JSON.parse(readFileSync("package.json", "utf8")).scripts.test;

// Se leen las rutas del script en vez de partirlo por `&&`: así da igual cómo
// esté encadenado o si algún día lleva banderas en el medio.
const enLaLista = [...guion.matchAll(/pruebas\/([\w-]+\.mjs)/g)].map((m) => m[1]);
const enDisco = readdirSync("pruebas").filter((f) => f.endsWith(".mjs"));

// =====================================================================
console.log("\n=== 1. Toda suite en disco está en `npm test` ===");
// =====================================================================
{
  const registradas = new Set(enLaLista);
  const huerfanas = enDisco.filter((f) => !registradas.has(f));

  ok(
    huerfanas.length === 0,
    huerfanas.length
      ? `hay suites que NO corren: agregalas al script "test" de package.json`
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
   * Ése al menos hace ruido —`npm test` corta con "Cannot find module"— pero
   * el mensaje llega a mitad de la corrida y manda a buscar el problema en el
   * código de la suite anterior, que es la última que se vio pasar.
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
   * corre no cierra nada. Si alguien la sacara de `npm test`, ninguno de los
   * tres casos de arriba volvería a ejecutarse y todo seguiría en verde.
   */
  ok(enLaLista.includes("suites-registradas.mjs"),
     "el cerrojo se comprueba a sí mismo");
}

console.log(fallos ? `\n❌ ${fallos} FALLOS` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
