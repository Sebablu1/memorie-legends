/**
 * La copia del CSS que la portada lleva adentro dice lo mismo que las hojas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE ESTA SUITE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `public/index.html` lleva incrustadas cinco hojas de `public/css/` para
 * dibujarse en un solo viaje —el motivo está en `herramientas/css-critico.mjs`—
 * y esa copia se genera corriendo la herramienta a mano. Nada obliga a
 * correrla: ni un hook, ni el despliegue, ni el despliegue de hosting.
 *
 * Así que se desincronizó. En `ac8ebd6` los campos del sitio pasaron a 16px
 * —para que Safari en iOS no haga zoom al tocarlos— y la portada se quedó con
 * el tamaño viejo hasta `ad50a1a`. No falló nada en el medio: la portada
 * siguió andando, con otra letra en sus campos que el resto del sitio.
 *
 * Y lo peor no fue el descuido sino la comprobación: en el momento se miró que
 * las marcas `css-incrustado` estuvieran en su lugar, se leyó eso como "al
 * día", y no lo estaba. Una comprobación que contesta lo que uno quiere oír es
 * peor que ninguna.
 *
 * Esto compara el contenido, no las marcas, y corre en `npm test`.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (ruta) => readFileSync(join(REPO, ruta), "utf8");

/**
 * Los dos textos se comparan con fines de línea de Unix.
 *
 * `git` reparte `\r\n` en Windows y guarda `\n`, así que index.html y las
 * hojas pueden estar de un modo o del otro en el disco de cada uno. Lo que
 * tiene que coincidir son las reglas, no cómo las bajó nadie.
 */
const nl = (t) => t.replace(/\r\n?/g, "\n");

/**
 * El HTML se lee ANTES de tocar la herramienta, y la importación es dinámica a
 * propósito.
 *
 * Un `import` de los de arriba se evalúa antes que la primera línea de este
 * archivo. Si la herramienta escribiera al importarse —como hacía hasta que se
 * le puso el cerrojo—, esta prueba estaría comparando el archivo que ella
 * misma acaba de arreglar, y pasaría siempre. Justo el tipo de comprobación
 * complaciente que la dejó pasar la primera vez.
 */
const antes = leer("public/index.html");
const { armarBloque, bloqueActual, HOJAS, INICIO, FIN } = await import(
  "../herramientas/css-critico.mjs"
);

/** Dónde se separan dos textos que tendrían que ser iguales, con su contorno. */
const primeraDiferencia = (hay, deberia) => {
  let i = 0;
  while (i < hay.length && i < deberia.length && hay[i] === deberia[i]) i++;
  const cerca = (t) => t.slice(Math.max(0, i - 50), i + 50);
  return {
    arreglo: "node herramientas/css-critico.mjs",
    caracter: i,
    hay: cerca(hay),
    deberia: cerca(deberia),
  };
};

// =====================================================================
console.log("\n=== 1. Importar la herramienta no escribe nada ===");
// =====================================================================
ok(leer("public/index.html") === antes,
   "index.html quedó intacto: la prueba no puede arreglar lo que viene a comprobar");

// =====================================================================
console.log("\n=== 2. Las marcas están, y una sola vez ===");
// =====================================================================
{
  ok(antes.split(INICIO).length === 2, "una sola marca de inicio");
  ok(antes.split(FIN).length === 2, "una sola marca de fin");
}

// =====================================================================
console.log("\n=== 3. La copia incrustada es la de las hojas de hoy ===");
// =====================================================================
{
  const deberia = armarBloque();
  const hay = nl(bloqueActual(antes));
  ok(hay === deberia,
     "el bloque de index.html sale tal cual de public/css/",
     hay === deberia ? undefined : primeraDiferencia(hay, deberia));
}

// =====================================================================
console.log("\n=== 4. El canario: los campos miden 16px también en la portada ===");
// =====================================================================
{
  /**
   * La regla exacta que estuvo vieja, escrita a mano acá.
   *
   * La sección 3 ya la cubre —si falta, el bloque no coincide—, pero cuando
   * falle va a decir "el carácter 8.412 es distinto", y quien lo lea va a
   * tener que ir a mirar qué había ahí. Esta dice qué se perdió.
   */
  const bloque = bloqueActual(antes);
  ok(/select,input,textarea\{[^}]*font-size:1rem[^}]*\}/.test(bloque),
     "el `font-size: 1rem` de los campos llegó a la copia (es lo que evita el zoom de Safari)");
}

// =====================================================================
console.log("\n=== 5. Están las cinco hojas, y en su orden ===");
// =====================================================================
{
  /** El orden decide quién gana: `tema` pone la base y `portada` la pisa. */
  const bloque = bloqueActual(antes);
  const donde = HOJAS.map((h) => bloque.indexOf(`/* ${h} */`));

  ok(donde.every((p) => p !== -1), "cada hoja dejó su marca de origen",
     donde.some((p) => p === -1) ? HOJAS.filter((_, i) => donde[i] === -1) : undefined);
  ok(donde.every((p, i) => i === 0 || p > donde[i - 1]),
     "y van en el mismo orden en que estaban enlazadas", donde);
}

console.log(fallos ? `\n❌ ${fallos} fallo(s)` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
