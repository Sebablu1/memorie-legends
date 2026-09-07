/**
 * Las Leyendas de bienvenida: un número, en un solo lugar.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO NECESITA UNA PRUEBA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque el perfil lo crea EL NAVEGADOR. No hay un servidor que decida cuánto
 * regalar: hay un `setDoc` desde el cliente y una regla de Firestore que
 * comprueba que el saldo sea exactamente el de bienvenida. Esa comparación es
 * lo único que impide que alguien se cree la cuenta con un millón.
 *
 * Y eso convierte al número en algo raro: vive en dos idiomas —JavaScript y el
 * lenguaje de reglas— que ningún compilador puede comparar entre sí. Si se
 * cambia uno solo, no falla nada al desplegar. Falla el día siguiente, cuando
 * NADIE PUEDE REGISTRARSE, porque Firestore rechaza la creación del documento
 * y el navegador sólo dice "permission-denied".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE HABÍA CUANDO SE ESCRIBIÓ ESTO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Cinco definiciones del mismo número: `LEYENDAS_REGISTRO = 50` en el módulo
 * de economía —importado por el servidor y nunca usado—, un `100` escrito a
 * mano en `auth.js`, otro `100` a mano en `register.js`, una constante propia
 * `LEYENDAS_DE_REGALO = 100` en ese mismo archivo, y el `== 100` de la regla.
 *
 * O sea: la única que se declaraba oficial era la que mentía. Nunca llegó a
 * producción por casualidad —el import del servidor estaba muerto— y ésa es
 * exactamente la clase de suerte de la que no conviene depender.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LEYENDAS_REGISTRO } from "../public/js/reglas/economia.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else {
    fallos++;
    console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : "");
  }
};

const RAIZ = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const leer = (relativo) => readFileSync(join(RAIZ, relativo), "utf8");

// =====================================================================
console.log("\n=== 1. El código y la regla de Firestore dicen lo mismo ===");
// =====================================================================

{
  const reglas = leer("firestore.rules");
  const m = reglas.match(/request\.resource\.data\.credits\s*==\s*(\d+)/);

  ok(Boolean(m), "la regla sigue fijando un saldo exacto de bienvenida");

  if (m) {
    const enLaRegla = Number(m[1]);
    ok(
      enLaRegla === LEYENDAS_REGISTRO,
      `la regla pide ${enLaRegla} y el código regala ${LEYENDAS_REGISTRO}`,
      { enLaRegla, LEYENDAS_REGISTRO },
    );
  }
}

// =====================================================================
console.log("\n=== 2. Nadie escribe el número a mano ===");
// =====================================================================

/**
 * Los dos archivos que crean el perfil.
 *
 * `register.js` lo hace por partida doble —correo y Google— y `auth.js` cuando
 * alguien entra con Google sin haberse registrado antes. Los tres caminos
 * tienen que escribir la MISMA constante: si uno pone un literal, ese camino
 * queda fuera de este control y vuelve a poder divergir.
 */
for (const archivo of ["public/js/register.js", "public/js/auth.js"]) {
  const texto = leer(archivo);

  const literales = [...texto.matchAll(/credits:\s*(\d+)/g)].map((m) => m[1]);
  ok(
    literales.length === 0,
    `${archivo} no escribe el saldo a mano`,
    literales,
  );

  const usos = [...texto.matchAll(/credits:\s*LEYENDAS_REGISTRO/g)].length;
  ok(usos > 0, `${archivo} usa la constante`, usos);

  ok(
    /import \{ LEYENDAS_REGISTRO \}/.test(texto),
    `${archivo} la importa en vez de redeclararla`,
  );
}

// =====================================================================
console.log("\n=== 3. Una sola definición en todo el proyecto ===");
// =====================================================================

{
  // Se cuenta sobre `public/js/reglas/economia.js`, que es la fuente. La copia
  // de `functions/reglas` la genera `copiar-reglas.js` y no cuenta como
  // definición aparte: si difiriera, el problema sería la copia.
  const economia = leer("public/js/reglas/economia.js");
  const definiciones = [...economia.matchAll(/export const LEYENDAS_REGISTRO/g)].length;
  ok(definiciones === 1, "hay exactamente una definición", definiciones);

  // Y ninguna constante paralela que diga lo mismo con otro nombre, que es
  // como empezó este problema.
  for (const archivo of ["public/js/register.js", "public/js/auth.js"]) {
    ok(
      !/const LEYENDAS_DE_REGALO/.test(leer(archivo)),
      `${archivo} no tiene su propia copia con otro nombre`,
    );
  }
}

// =====================================================================
console.log("\n=== 4. El valor es el que se acordó ===");
// =====================================================================

{
  // Este número se fija acá a propósito. No es redundante con lo de arriba:
  // aquéllas comprueban que todo COINCIDA, y dos cosas pueden coincidir en el
  // valor equivocado. Ésta dice cuál es el valor correcto.
  ok(LEYENDAS_REGISTRO === 100, "la bienvenida son 100 Leyendas", LEYENDAS_REGISTRO);
}

console.log(fallos ? `\n❌ ${fallos} fallos` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
