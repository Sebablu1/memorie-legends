/**
 * La aritmética del conversor del panel, sin navegador.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE PRUEBA ACÁ Y QUÉ EN EL NAVEGADOR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Acá, las decisiones: qué medidas tiene que tener la salida, cómo se llama
 * el archivo, y qué entradas se rechazan. Son funciones puras y no necesitan
 * un lienzo.
 *
 * En `admin-conversor.spec.js`, que SÍ abre un navegador: que subir un
 * archivo de verdad produzca un WebP de esas medidas y con canal alfa.
 *
 * La división importa porque la parte cara —arrancar Chromium— no debería
 * hacer falta para comprobar que 1600 entra en 512.
 */

import { readFileSync } from "node:fs";
import { quitarFondoBlanco } from "../public/js/modulos/recorte-de-fondo.js";
import {
  ENTRADAS_VALIDAS,
  medidasDeSalida,
  nombreDeSalida,
  problemaDelArchivo,
} from "../public/admin/conversor-de-imagen.js";
import { RECETAS } from "../public/js/reglas/imagenes-de-catalogo.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

const AVATAR = RECETAS.avatar;      // cuadrada, 512
const INSIGNIA = RECETAS.insignia;  // nativa, 256
const DORSO = RECETAS.dorso;        // nativa, 894

// =====================================================================
console.log("\n=== 1. Proporción nativa: se acota el lado MAYOR ===");
// =====================================================================
{
  // Una insignia real, de las que hay hoy.
  ok(JSON.stringify(medidasDeSalida({ ancho: 544, alto: 506 }, INSIGNIA)) ===
     JSON.stringify({ ancho: 256, alto: 238, recorta: false }),
     "544×506 entra a 256×238: manda el ancho, que es el mayor",
     medidasDeSalida({ ancho: 544, alto: 506 }, INSIGNIA));

  // Y una más alta que ancha: tiene que mandar el ALTO.
  ok(JSON.stringify(medidasDeSalida({ ancho: 483, alto: 493 }, INSIGNIA)) ===
     JSON.stringify({ ancho: 251, alto: 256, recorta: false }),
     "483×493 entra a 251×256: acá el mayor es el alto",
     medidasDeSalida({ ancho: 483, alto: 493 }, INSIGNIA));

  // Un dorso, que es bien apaisado al revés.
  ok(JSON.stringify(medidasDeSalida({ ancho: 1280, alto: 1788 }, DORSO)) ===
     JSON.stringify({ ancho: 640, alto: 894, recorta: false }),
     "un dorso de 1280×1788 entra a 640×894",
     medidasDeSalida({ ancho: 1280, alto: 1788 }, DORSO));

  const cuad = medidasDeSalida({ ancho: 1000, alto: 1000 }, INSIGNIA);
  ok(cuad.ancho === 256 && cuad.alto === 256, "un cuadrado sigue cuadrado", cuad);
}

// =====================================================================
console.log("\n=== 2. Proporción cuadrada: recorta al centro ===");
// =====================================================================
{
  const deCuadrado = medidasDeSalida({ ancho: 1254, alto: 1254 }, AVATAR);
  ok(deCuadrado.ancho === 512 && deCuadrado.alto === 512 && deCuadrado.recorta === false,
     "un maestro cuadrado de 1254 va a 512 sin recortar nada", deCuadrado);

  const deApaisado = medidasDeSalida({ ancho: 1600, alto: 900 }, AVATAR);
  ok(deApaisado.ancho === 512 && deApaisado.alto === 512,
     "uno apaisado también sale cuadrado", deApaisado);
  ok(deApaisado.recorta === true,
     "y se avisa que hubo recorte: el que sube tiene que saber que perdió los costados");

  /*
   * El caso que distingue «manda el lado menor» de «manda el mayor».
   *
   * Con 1600×900 los dos criterios dan 512, porque los dos lados pasan el
   * tope. Hace falta uno cuyo lado CORTO quede por debajo: de 1600×300 sólo
   * se puede sacar un cuadrado de 300, y pedir 512 sería agrandar el recorte
   * — inventar píxeles que el original no tiene.
   */
  const cortoChico = medidasDeSalida({ ancho: 1600, alto: 300 }, AVATAR);
  ok(cortoChico.ancho === 300 && cortoChico.alto === 300,
     "de 1600×300 sale un cuadrado de 300: manda el lado MENOR", cortoChico);
}

// =====================================================================
console.log("\n=== 3. Nunca agranda ===");
// =====================================================================
{
  /*
   * Llevar un dibujo de 300 px a 512 no agrega detalle: inventa píxeles y
   * encima engorda el archivo, o sea que paga de las dos formas. Que entre
   * chico es un problema del arte, y lo correcto es decirlo —la pantalla lo
   * avisa— en vez de taparlo con una interpolación.
   */
  const chico = medidasDeSalida({ ancho: 200, alto: 180 }, INSIGNIA);
  ok(chico.ancho === 200 && chico.alto === 180,
     "una insignia de 200×180 se queda igual: no se estira hasta los 256", chico);

  // Y el caso de al lado, que es el que distingue «no agranda» de «no toca
  // nada»: 300 SÍ pasa de 256, así que tiene que achicar.
  const grande = medidasDeSalida({ ancho: 300, alto: 280 }, INSIGNIA);
  ok(grande.ancho === 256 && grande.alto === 239,
     "pero 300×280 sí se achica: no agrandar no es no hacer nada", grande);

  const chicoCuadrado = medidasDeSalida({ ancho: 200, alto: 200 }, AVATAR);
  ok(chicoCuadrado.ancho === 200 && chicoCuadrado.alto === 200,
     "y un avatar de 200 se queda en 200, no se infla a 512", chicoCuadrado);

  // El borde exacto: justo en la medida de la receta, no cambia nada.
  const justo = medidasDeSalida({ ancho: 256, alto: 256 }, INSIGNIA);
  ok(justo.ancho === 256 && justo.alto === 256, "y justo en la medida queda igual", justo);
}

// =====================================================================
console.log("\n=== 4. Medidas imposibles ===");
// =====================================================================
{
  ok(medidasDeSalida({ ancho: 0, alto: 100 }, AVATAR) === null, "ancho cero es null");
  ok(medidasDeSalida({ ancho: 100, alto: 0 }, AVATAR) === null, "alto cero también");
  ok(medidasDeSalida({}, AVATAR) === null, "y sin medidas, null");

  // Nunca cero: una escala muy chica redondeando para abajo daría 0, y un
  // lienzo de ancho cero tira al codificar.
  const finisimo = medidasDeSalida({ ancho: 4000, alto: 3 }, INSIGNIA);
  ok(finisimo.alto >= 1, "una imagen finísima no redondea el lado corto a cero", finisimo);
}

// =====================================================================
console.log("\n=== 5. El nombre del archivo ===");
// =====================================================================
{
  ok(nombreDeSalida("el_as", AVATAR) === "el_as.webp", "es el id más la extensión de la receta");
  ok(nombreDeSalida("  el_as  ", AVATAR) === "el_as.webp", "con los espacios de más sacados");
  ok(nombreDeSalida("", AVATAR) === null, "sin id no hay nombre: no se descarga un `.webp` pelado");
  ok(nombreDeSalida("   ", AVATAR) === null, "ni con espacios solamente");
  ok(nombreDeSalida(null, AVATAR) === null, "ni con null");

  /*
   * Que salga de la RECETA y no de una constante: el día que un tipo se
   * convierta a otro formato, el nombre tiene que seguirlo solo.
   */
  ok(nombreDeSalida("x", { formato: "avif" }) === "x.avif", "la extensión sale de la receta");
}

// =====================================================================
console.log("\n=== 6. Qué archivos se aceptan ===");
// =====================================================================
{
  const archivo = (type, size = 1000) => ({ type, size });

  ok(problemaDelArchivo(archivo("image/png"), AVATAR) === null, "un PNG pasa");
  ok(problemaDelArchivo(archivo("image/jpeg"), AVATAR) === null, "un JPG pasa");
  ok(problemaDelArchivo(archivo("image/webp"), AVATAR) === null, "un WebP pasa");

  ok(problemaDelArchivo(archivo("image/svg+xml"), AVATAR) !== null,
     "un SVG NO: subir un SVG es subir código, y acá no se sanitiza nada");
  ok(problemaDelArchivo(archivo("application/pdf"), AVATAR) !== null, "un PDF tampoco");
  ok(problemaDelArchivo(archivo(""), AVATAR) !== null, "ni uno sin tipo");
  ok(problemaDelArchivo(null, AVATAR) !== null, "ni la ausencia de archivo");

  ok(ENTRADAS_VALIDAS.length === 3, "son exactamente tres formatos de entrada", ENTRADAS_VALIDAS);

  // El tope de peso sale de la receta, no de un número escrito acá.
  const limite = AVATAR.maxEntradaMb * 1024 * 1024;
  ok(problemaDelArchivo(archivo("image/png", limite), AVATAR) === null,
     "justo en el tope de peso, pasa");
  ok(problemaDelArchivo(archivo("image/png", limite + 1), AVATAR) !== null,
     "un byte más, no");
  ok(/8/.test(problemaDelArchivo(archivo("image/png", limite + 1), AVATAR)),
     "y el mensaje dice cuál es el tope", problemaDelArchivo(archivo("image/png", limite + 1), AVATAR));
}

// =====================================================================
console.log("\n=== 7. La calidad y el formato salen de la receta ===");
// =====================================================================
{
  /*
   * No se puede afirmar desde acá con qué calidad codificó el lienzo: el
   * archivo que sale es válido con 85 y con 50, y las medidas son las mismas.
   * Lo que sí se puede es exigir que el número venga de la RECETA.
   *
   * Importa porque un avatar codificado al 50 se ve sucio y nada lo denuncia:
   * no falla, no rompe el tamaño, sólo queda feo en producción. Se mira el
   * texto fuente, que es el recurso que ya usan `retratos-en-red.mjs`,
   * `panos.mjs` y `version-de-imagenes.mjs`.
   */
  const fuente = readFileSync(
    new URL("../public/admin/conversor-de-imagen.js", import.meta.url), "utf8");

  ok(/receta\.calidad\s*\/\s*100/.test(fuente),
     "la calidad sale de `receta.calidad`, no de un número escrito a mano");
  ok(/`image\/\$\{receta\.formato\}`/.test(fuente),
     "y el formato de `receta.formato`, para que un tipo nuevo no haya que tocarlo acá");
}

// =====================================================================
console.log("\n=== 8. El recorte de fondo, sobre píxeles de verdad ===");
// =====================================================================
{
  /*
   * `quitarFondoBlanco` es puro: recibe un cuadro y lo modifica. No necesita
   * navegador, así que se prueba acá —rápido y determinista— en vez de
   * depender de que un lienzo real produzca el caso que interesa.
   *
   * Lo que hay que demostrar es lo que motivó el algoritmo: que NO es un
   * umbral global. El blanco encerrado dentro de la figura —el brillo de un
   * ojo, los dientes— tiene que quedarse.
   */

  /** Un cuadro RGBA, como el que devuelve `getImageData`. */
  const cuadro = (ancho, alto, pintar) => {
    const data = new Uint8ClampedArray(ancho * alto * 4);
    for (let y = 0; y < alto; y++) {
      for (let x = 0; x < ancho; x++) {
        const v = pintar(x, y);
        const i = (y * ancho + x) * 4;
        data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
      }
    }
    return { width: ancho, height: alto, data };
  };
  const alfaEn = (c, x, y) => c.data[(y * c.width + x) * 4 + 3];

  // Una figura oscura de 10×10 al medio de un cuadro blanco de 30×30, con un
  // punto BLANCO adentro: el ojo.
  const conOjo = cuadro(30, 30, (x, y) => {
    const dentro = x >= 10 && x < 20 && y >= 10 && y < 20;
    if (!dentro) return 255;
    return x === 15 && y === 15 ? 255 : 20;
  });
  const r = quitarFondoBlanco(conOjo);

  ok(alfaEn(conOjo, 0, 0) === 0, "el fondo de la esquina se borró");
  ok(alfaEn(conOjo, 29, 29) === 0, "y el de la esquina opuesta también");
  ok(alfaEn(conOjo, 15, 15) === 255,
     "pero el blanco ENCERRADO en la figura se queda: no es un umbral global",
     alfaEn(conOjo, 15, 15));
  ok(alfaEn(conOjo, 12, 12) === 255, "y el cuerpo oscuro, entero");
  ok(r.borrados > 0 && r.borrados < r.total, "se borró algo y no todo", r);

  /*
   * Y que entre por los CUATRO costados.
   *
   * Un fondo que sólo toca arriba y abajo —dos columnas oscuras pegadas a los
   * lados— no se alcanza entrando por izquierda y derecha. Sin este caso, una
   * inundación que arranque sólo por dos bordes pasa la prueba de arriba sin
   * problema, porque allá el fondo rodea la figura entera.
   */
  const soloArriba = cuadro(20, 20, (x) => (x < 3 || x >= 17 ? 20 : 255));
  quitarFondoBlanco(soloArriba);
  ok(alfaEn(soloArriba, 10, 0) === 0,
     "con el fondo tocando sólo arriba y abajo, igual se borra", alfaEn(soloArriba, 10, 0));
  ok(alfaEn(soloArriba, 1, 10) === 255, "y las columnas oscuras de los lados quedan");

  // Una imagen sin nada de blanco: no hay fondo que sacar, y hay que poder
  // decirlo — la pantalla avisa «sin fondo blanco que sacar».
  const todoOscuro = cuadro(10, 10, () => 20);
  ok(quitarFondoBlanco(todoOscuro).borrados === 0, "sin blanco, no se borra nada");
}

console.log(fallos ? `\n❌ ${fallos} fallos` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
