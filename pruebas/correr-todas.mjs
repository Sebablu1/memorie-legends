/**
 * Corre las 83 suites de Node. TODAS, aunque alguna falle.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ AGUJERO TAPA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El script `test` era una cadena de `node ... && node ... && ...`, y `&&`
 * corta en el primer fallo. Eso estaba escrito a propósito —está argumentado
 * en `suites-registradas.mjs`: en una laptop no querés esperar sesenta suites
 * para leer el error de la tercera— y durante mucho tiempo fue una decisión
 * razonable.
 *
 * Dejó de serlo cuando una suite se quedó en rojo de forma permanente.
 * `abandono-red.mjs` es la número 17 de 83. Con ella rota, las 66 que vienen
 * después NO CORRIERON NUNCA, y `npm test` seguía imprimiendo un error que
 * parecía un solo problema. La confianza que daba era falsa justo sobre la
 * parte que nadie estaba mirando.
 *
 * El argumento de la laptop sigue siendo cierto, y se paga de otra forma: cada
 * suite imprime mientras corre —`stdio: "inherit"`, ver abajo— así que el error
 * de la tercera se lee cuando ocurre, no al final. Lo que cambia es que la
 * corrida no se detiene ahí.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SIN PARALELISMO, Y NO ES PEREZA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Varias suites tocan estado compartido: escriben archivos, levantan dobles de
 * Firestore, comparten el directorio de trabajo. Corriéndolas de a varias se
 * pisan entre ellas y, peor, el texto que imprimen se entrelaza: un ✗ aparece
 * debajo del encabezado de otra suite y manda a buscar el problema al archivo
 * equivocado.
 *
 * Y el orden también importa —reglas puras primero, red después— así que
 * repartirlas rompería la señal de «lo de arriba ya está bien».
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ `stdio: "inherit"` Y NO JUNTAR LA SALIDA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Guardar lo que imprime cada suite para mostrarlo ordenado al final se ve
 * mejor en el resumen y es peor para trabajar: una corrida son varios minutos,
 * y si una suite se cuelga no se ve nada hasta que el tiempo se agota. Con
 * `inherit`, lo que se está colgando se lee en el momento.
 */

import { spawnSync } from "node:child_process";
import { SUITES } from "./lista-de-suites.mjs";

/**
 * Techo por suite.
 *
 * Tres minutos es mucho más de lo que tarda la más lenta, y es a propósito: no
 * está para apurar a nadie sino para que una suite colgada no se lleve puesta
 * la corrida entera. Sin esto, un `await` que nunca resuelve deja el proceso
 * esperando para siempre y no hay resumen.
 */
const TECHO_MS = 180_000;

const resultados = [];

for (const suite of SUITES) {
  const r = spawnSync("node", [`pruebas/${suite}`], {
    stdio: "inherit",
    timeout: TECHO_MS,
    shell: false,
  });

  /**
   * Las tres formas distintas de no pasar, y hay que separarlas.
   *
   * Un `status` distinto de cero es una suite que corrió y falló: el error ya
   * se imprimió arriba. Una señal o un `ETIMEDOUT` son otra cosa —el proceso
   * no llegó a decir nada— y confundirlas haría buscar un ✗ que no existe.
   *
   * `spawnSync` marca el vencimiento poniendo `error.code = "ETIMEDOUT"` y
   * matando al proceso, así que la señal llega también: se mira el tiempo
   * primero porque es la causa, no el efecto.
   */
  let motivo = null;
  if (r.error?.code === "ETIMEDOUT") motivo = `se colgó: pasó de ${TECHO_MS / 1000} s`;
  else if (r.error) motivo = `no se pudo arrancar: ${r.error.message}`;
  else if (r.signal) motivo = `la mató la señal ${r.signal}`;
  else if (r.status !== 0) motivo = `salió con código ${r.status}`;

  resultados.push({ suite, motivo });
}

const rojas = resultados.filter((r) => r.motivo);

console.log(`\n${"═".repeat(70)}`);
console.log(`${SUITES.length - rojas.length} de ${SUITES.length} suites pasaron`);

if (rojas.length) {
  console.log("\nEn rojo:");
  for (const { suite, motivo } of rojas) console.log(`  ✗ ${suite} — ${motivo}`);
  // El recordatorio que el `&&` daba gratis: con la cadena, lo que fallaba era
  // siempre lo último que se había visto. Ahora hay que decir dónde mirar.
  console.log("\nCada una imprimió su propio detalle más arriba, en orden.");
}

console.log(`${"═".repeat(70)}\n`);

process.exit(rojas.length ? 1 : 0);
