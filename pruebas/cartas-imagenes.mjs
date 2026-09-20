/**
 * Las caras de las cartas: que estén todas, que pesen poco, y que la
 * dirección lleve versión.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LOS TRES PROBLEMAS QUE ESTO VIGILA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. UNA CARTA QUE FALTA. El 10 de copa quedó guardado como `10..png`, con
 *    dos puntos, y la mesa siguió mostrando el diseño viejo durante días. No
 *    lo notó ninguna prueba: las cuarenta y ocho existían, sólo que una era
 *    la de antes.
 *
 * 2. EL PESO. Las cartas rediseñadas entraron en 1023×1537 y 2,7 MB CADA UNA
 *    —137 MB entre las 48— y así se desplegaron. Una mesa muestra veinte
 *    cartas: eran decenas de megas por partida, y en un teléfono con datos,
 *    impagable. Ahora son WebP de 512×768, que cubren un celular 3x.
 *
 * 3. LA CACHÉ. Las imágenes se guardan un mes en el navegador. Reemplazar un
 *    archivo con el mismo nombre deja a quien ya lo tenía con la copia vieja,
 *    y eso NO se arregla cambiando el encabezado. Por eso la dirección lleva
 *    `?v=VERSION_CARTAS`: cada reemplazo es una dirección nueva.
 *
 * Lo que esta prueba NO puede ver es si el dibujo es el que corresponde. Eso
 * lo mira una persona. Lo que sí garantiza es que el archivo exista, sea
 * liviano y se pida con la versión de ahora.
 */

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PALOS,
  NUMEROS,
  VERSION_CARTAS,
  imagenCarta,
  caraDeCarta,
  crearBaraja,
} from "../public/js/reglas/baraja.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const assets = join(raiz, "public", "assets");

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

/** Ancho y alto de un WebP, leídos del archivo. */
function medidaWebp(ruta) {
  const b = readFileSync(ruta);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") return null;
  const formato = b.toString("ascii", 12, 16);
  // Sin transparencia y con pérdida, Pillow escribe un "VP8 " simple: las
  // medidas van en catorce bits cada una, dentro del encabezado del cuadro.
  if (formato === "VP8 ") {
    return { ancho: b.readUInt16LE(26) & 0x3fff, alto: b.readUInt16LE(28) & 0x3fff };
  }
  if (formato === "VP8X") {
    const leer3 = (i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
    return { ancho: leer3(24) + 1, alto: leer3(27) + 1 };
  }
  return null;
}

// ===================================================== 1. están todas

console.log("\n=== 1. Las 48 cartas están, y nada más ===");
{
  const esperadas = new Set(PALOS.flatMap((p) => NUMEROS.map((n) => `${p}/${n}.webp`)));
  const halladas = new Set(
    PALOS.flatMap((p) => readdirSync(join(assets, p)).map((f) => `${p}/${f}`)),
  );

  const faltan = [...esperadas].filter((f) => !halladas.has(f));
  const sobran = [...halladas].filter((f) => !esperadas.has(f));

  ok(faltan.length === 0, "están las 48 caras", faltan);
  // `10..png` entraría acá: un nombre con un punto de más es una carta que
  // nadie ve, y la vieja quedándose en su lugar.
  ok(sobran.length === 0, "y no hay ningún archivo de más en assets", sobran);
}

// ===================================================== 2. livianas

console.log("\n=== 2. Livianas y del tamaño que se sirve ===");
{
  const TOPE_KB = 300;
  const pesadas = [];
  const raras = [];
  let total = 0;

  for (const palo of PALOS) {
    for (const numero of NUMEROS) {
      const ruta = join(assets, palo, `${numero}.webp`);
      const kb = Math.round(statSync(ruta).size / 1024);
      total += kb;
      if (kb > TOPE_KB) pesadas.push(`${palo}/${numero}: ${kb} KB`);

      const m = medidaWebp(ruta);
      if (!m || m.ancho !== 512 || m.alto !== 768) raras.push(`${palo}/${numero}: ${JSON.stringify(m)}`);
    }
  }

  ok(pesadas.length === 0, `ninguna pasa de ${TOPE_KB} KB`, pesadas.slice(0, 5));
  ok(raras.length === 0, "todas miden 512×768, que es 2:3 como el dibujo", raras.slice(0, 5));
  ok(total < 9 * 1024, "y las 48 juntas no llegan a 9 MB", `${Math.round(total / 1024)} MB`);
}

// ===================================================== 3. la dirección

console.log("\n=== 3. La dirección lleva la versión ===");
{
  ok(imagenCarta("Oro", 7) === `/assets/Oro/7.webp?v=${VERSION_CARTAS}`,
     "la arma el motor con palo, número y versión", imagenCarta("Oro", 7));
  ok(Number.isInteger(VERSION_CARTAS) && VERSION_CARTAS >= 2,
     "y la versión es un número, que sube con cada reemplazo", VERSION_CARTAS);

  const conVieja = { id: "Oro-7", palo: "Oro", numero: 7, imagen: "/assets/Oro/7.png" };
  ok(caraDeCarta(conVieja) === imagenCarta("Oro", 7),
     "una carta guardada con la dirección vieja se dibuja con la de ahora",
     caraDeCarta(conVieja));

  // Es lo que pasa con una partida en red empezada antes del cambio: el
  // servidor escribió la dirección en el estado y ahí se quedó.
  ok(caraDeCarta({ oculta: true }) === "", "un marcador tapado no tiene cara");
  ok(caraDeCarta(null) === "", "y una carta que no está, tampoco");

  const sinVersion = crearBaraja().filter((c) => !c.imagen.includes(`?v=${VERSION_CARTAS}`));
  ok(sinVersion.length === 0, "las 48 de la baraja se piden con versión", sinVersion.slice(0, 3));
}

console.log(fallos ? `\n❌ ${fallos} FALLOS` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
