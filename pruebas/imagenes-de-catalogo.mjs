/**
 * La tabla de recetas cubre el catálogo, y no le sobra nada.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ AGUJERO TAPA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Que alguien agregue un tipo a `TIPOS` y se olvide de decir qué hacer con su
 * imagen. Un tipo sin receta no rompe nada hoy —nadie consume la tabla
 * todavía— y el día que haya un conversor va a encontrarse un `undefined` en
 * la mitad de una subida, que es el peor momento para enterarse.
 *
 * Y al revés: una receta de un tipo que ya no existe. Eso no se cae nunca
 * solo; queda como un renglón que se lee, se mantiene y no gobierna nada.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE ESTO NO MIRA, Y POR QUÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Los archivos del disco. La tabla es el OBJETIVO, y hoy los archivos no lo
 * cumplen todos: las insignias miden unos 530 y la receta dice 256. Es a
 * propósito —convertirlas es otra fase— y afirmar acá que el disco cumple
 * pondría esta suite en rojo por un trabajo que todavía no se hizo.
 *
 * Cuando se conviertan, el lugar de esa comprobación es
 * `imagenes-del-catalogo.mjs`, que ya mira el disco; ésta mira la tabla.
 * Los nombres se parecen porque miran dos mitades de lo mismo: aquélla, que
 * el archivo exista; ésta, que la receta exista.
 */

import { TIPOS_VALIDOS } from "../public/js/reglas/catalogo.js";
import {
  CLASES,
  MAX_ENTRADA_MB,
  PROPORCIONES,
  RECETAS,
  TIPOS_CONVERTIBLES,
  recetaDe,
  seConvierte,
} from "../public/js/reglas/imagenes-de-catalogo.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

// =====================================================================
console.log("\n=== 1. La tabla cubre el catálogo exactamente ===");
// =====================================================================
{
  const conReceta = Object.keys(RECETAS);

  const sinReceta = TIPOS_VALIDOS.filter((t) => !conReceta.includes(t));
  ok(sinReceta.length === 0, "todo tipo del catálogo tiene su receta", sinReceta);

  const deMas = conReceta.filter((t) => !TIPOS_VALIDOS.includes(t));
  ok(deMas.length === 0, "y no sobra ninguna receta de un tipo que ya no existe", deMas);

  // No es lo mismo que las dos de arriba: podrían cumplirse las dos con
  // duplicados o con un tipo contado dos veces.
  ok(conReceta.length === TIPOS_VALIDOS.length,
     "hay tantas recetas como tipos", { recetas: conReceta.length, tipos: TIPOS_VALIDOS.length });
}

// =====================================================================
console.log("\n=== 2. Cada receta declara una clase, y una sola ===");
// =====================================================================
{
  const clases = Object.values(CLASES);
  const malas = Object.entries(RECETAS).filter(([, r]) => !clases.includes(r.clase));
  ok(malas.length === 0, "la clase de cada receta es una de las cuatro", malas.map(([t]) => t));

  // Que las cuatro clases se usen. Una clase que no clasifica nada es una
  // palabra que hay que entender para nada — y si quedó sin uso por un
  // borrado, es la señal de que sobra.
  const usadas = new Set(Object.values(RECETAS).map((r) => r.clase));
  const huerfanas = clases.filter((c) => !usadas.has(c));
  ok(huerfanas.length === 0, "y las cuatro clases clasifican algo", huerfanas);
}

// =====================================================================
console.log("\n=== 3. Las ráster traen la receta completa ===");
// =====================================================================
{
  const rasters = Object.entries(RECETAS).filter(([, r]) => r.clase === CLASES.RASTER);
  ok(rasters.length >= 1, "hay al menos un tipo que se convierte", rasters.length);

  for (const [tipo, r] of rasters) {
    const completa =
      r.formato === "webp" &&
      Number.isInteger(r.ladoMayor) && r.ladoMayor > 0 &&
      Object.values(PROPORCIONES).includes(r.proporcion) &&
      Number.isInteger(r.calidad) && r.calidad > 0 && r.calidad <= 100 &&
      r.maxEntradaMb === MAX_ENTRADA_MB;
    ok(completa, `«${tipo}» dice formato, lado, proporción, calidad y tope de entrada`, r);
  }

  /*
   * El lado tiene que ser creíble: por debajo de 64 no se ve nada y por
   * encima de 2048 se está guardando un maestro, no una imagen para servir.
   * No es un gusto: un cero o un 51200 por un dedo resbalado pasarían sin que
   * nada se queje hasta que alguien mire el resultado.
   */
  const absurdos = rasters.filter(([, r]) => r.ladoMayor < 64 || r.ladoMayor > 2048);
  ok(absurdos.length === 0, "y ninguno pide un lado absurdo", absurdos.map(([t, r]) => [t, r.ladoMayor]));
}

// =====================================================================
console.log("\n=== 4. Las vectoriales NO traen receta de ráster ===");
// =====================================================================
{
  /*
   * Un `ladoMayor` o una `calidad` en una entrada vectorial sería una
   * invitación a rasterizarla. La tabla tiene que hacer imposible leerla así.
   */
  const vectores = Object.entries(RECETAS).filter(([, r]) => r.clase === CLASES.VECTOR);
  for (const [tipo, r] of vectores) {
    ok(r.formato === "svg", `«${tipo}» es svg`, r.formato);
    ok(r.ladoMayor === undefined && r.calidad === undefined && r.proporcion === undefined,
       `«${tipo}» no trae lado ni calidad: no se rasteriza`, r);
  }
}

// =====================================================================
console.log("\n=== 5. Texto y sin-definir no traen nada más ===");
// =====================================================================
{
  const mudas = Object.entries(RECETAS).filter(
    ([, r]) => r.clase === CLASES.TEXTO || r.clase === CLASES.SIN_DEFINIR,
  );
  for (const [tipo, r] of mudas) {
    ok(Object.keys(r).length === 1,
       `«${tipo}» declara su clase y nada más: no hay medidas inventadas`, r);
  }
}

// =====================================================================
console.log("\n=== 6. Los ayudantes dicen lo mismo que la tabla ===");
// =====================================================================
{
  ok(recetaDe("avatar") === RECETAS.avatar, "`recetaDe` devuelve la entrada, no una copia");
  ok(recetaDe("no-existe") === null, "`recetaDe` de un tipo inventado es null", recetaDe("no-existe"));

  ok(seConvierte("avatar") === true, "un avatar se convierte");
  ok(seConvierte("fondo") === false, "un paño NO se convierte: es vector");
  ok(seConvierte("titulo") === false, "un título NO se convierte: es texto");
  ok(seConvierte("marco") === false, "un marco todavía NO se convierte: no hay arte");
  ok(seConvierte("no-existe") === false, "y un tipo inventado tampoco");

  const esperados = TIPOS_VALIDOS.filter((t) => RECETAS[t].clase === CLASES.RASTER);
  ok(TIPOS_CONVERTIBLES.join(",") === esperados.join(","),
     "`TIPOS_CONVERTIBLES` es exactamente la lista de ráster", TIPOS_CONVERTIBLES);
}

// =====================================================================
console.log("\n=== 7. La tabla no se puede modificar en caliente ===");
// =====================================================================
{
  /*
   * Está congelada porque es una regla, no un estado. Sin esto, cualquiera que
   * la importe puede cambiarle el lado a un tipo desde otro módulo y la
   * siguiente conversión saldría distinta sin que nada lo cuente.
   */
  const antes = RECETAS.avatar.ladoMayor;
  try { RECETAS.avatar = { clase: "raster" }; } catch { /* en estricto tira */ }
  ok(RECETAS.avatar.ladoMayor === antes, "RECETAS está congelada", RECETAS.avatar.ladoMayor);
}

console.log(fallos ? `\n❌ ${fallos} fallos` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
