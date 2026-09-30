/**
 * Todo artículo del catálogo que apunte a un archivo, apunta a uno que existe.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ AGUJERO TAPA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Los dos dorsos de la casa pasaron de `.png` a `.webp` y los `.png` viejos se
 * borraron. Tres artículos del catálogo seguían nombrándolos: `dorso_azul`,
 * `dorso_rojo` y `mazo_azul`. Los dos primeros son lo que alguien puede tener
 * EQUIPADO, y `dorso_azul` y `mazo_azul` son gratis y vienen de arranque, así
 * que los tiene casi todo el mundo.
 *
 * Nada habría fallado: ni una prueba, ni la consola, ni el despliegue. Se
 * habría visto como un hueco en la tienda y como un dorso roto en la mesa de
 * cada partida, y se habría descubierto jugando.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE ESTO NO PUEDE VER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El catálogo de verdad está en Firestore: esto es la SEMILLA, el punto de
 * partida que `sembrarCatalogo` escribe la primera vez. El panel de
 * administración puede cambiar la imagen de un artículo sin pasar por acá, y
 * esa imagen no la mira nadie desde el repositorio.
 *
 * Para eso está `herramientas/auditar-catalogo.mjs --firestore`, que hay que
 * correr a mano y con credenciales. Esto cubre lo que se puede cubrir sin
 * salir de la máquina, que es de dónde salió este defecto.
 *
 * `herramientas/png-no-usados.mjs` mira al revés: archivos que no usa nadie.
 * Los dos hacen falta, y ninguno ve lo del otro.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CATALOGO_INICIAL, esRutaDelSitio } from "../public/js/reglas/catalogo.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Un artículo puede tener un EMOJI en vez de una imagen —«🂠», «🎴»— y es a
 * propósito: sale gratis, no pesa y no se puede romper. Acá se miran sólo los
 * que nombran un archivo.
 */
const conArchivo = CATALOGO_INICIAL.filter((i) => esRutaDelSitio(i.imagen));

// =====================================================================
console.log("\n=== 1. Cada ruta del catálogo apunta a un archivo que está ===");
// =====================================================================
{
  // Sin la parte de la versión: `?v=3` no es parte del nombre del archivo.
  const archivoDe = (imagen) => join(REPO, "public", imagen.split("?")[0]);

  const rotos = conArchivo
    .filter((i) => !existsSync(archivoDe(i.imagen)))
    .map((i) => `${i.id} -> ${i.imagen}`);

  ok(rotos.length === 0, `los ${conArchivo.length} artículos con archivo lo tienen`, rotos);
}

// =====================================================================
console.log("\n=== 2. Y son rutas de este sitio, no de otro dominio ===");
// =====================================================================
{
  /**
   * `esRutaDelSitio` ya filtró la lista de arriba, así que esto mira la otra
   * mitad: que ningún artículo con imagen se haya quedado afuera por llevar
   * una URL ajena. Un `http://` en el catálogo no rompe la tienda —se ve
   * igual— pero no viaja a la mesa, y el dibujo desaparece ahí sin motivo
   * visible. El porqué está en `esRutaDelSitio`.
   */
  const ajenas = CATALOGO_INICIAL.filter(
    (i) => typeof i.imagen === "string" && /^(https?:)?\/\//.test(i.imagen),
  ).map((i) => `${i.id} -> ${i.imagen}`);

  ok(ajenas.length === 0, "ninguna imagen del catálogo vive en otro dominio", ajenas);
}

// =====================================================================
console.log("\n=== 3. Los dos dorsos de la casa también están ===");
// =====================================================================
{
  /**
   * No salen del catálogo sino de `reglas/baraja.js`: son los que usa quien no
   * tiene nada equipado, o sea la mesa por defecto. Se miran acá porque es el
   * mismo tipo de defecto y sería raro tener media comprobación.
   */
  const { DORSOS } = await import("../public/js/reglas/baraja.js");
  const faltan = DORSOS.filter((d) => !existsSync(join(REPO, "public", d.split("?")[0])));

  ok(faltan.length === 0, "los dorsos de la casa están en public/img/dorsos", faltan);
}

console.log(fallos ? `\n❌ ${fallos} fallo(s)` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
