/**
 * Regenera los logos en WebP, del tamaño y el peso que hacen falta.
 *
 *   node herramientas/imagenes.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTEN VARIOS TAMAÑOS DEL MISMO LOGO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque "el tamaño correcto" depende de la pantalla. El logo de la portada se
 * dibuja a 180 px de ancho en un teléfono y a 300 en una computadora — pero un
 * teléfono moderno tiene tres píxeles físicos por cada uno de esos 180, así que
 * necesita una imagen de 540 para verse nítido, mientras que la computadora se
 * conforma con 300.
 *
 * Un solo archivo no puede ganar las dos: el que sirve al teléfono le sobra a
 * la computadora, y el que le queda bien a la computadora se ve borroso en el
 * teléfono. Por eso se generan dos y elige el navegador, con `srcset`.
 *
 * Éste es el punto que conviene no perder de vista al "optimizar imágenes":
 * achicar el archivo hasta el tamaño en CSS deja el logo borroso en casi todos
 * los teléfonos que existen. Lo que se mide en una auditoría no siempre es lo
 * que se ve.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SE CODIFICA CON EL NAVEGADOR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Sin dependencias nuevas: Chromium ya sabe escribir WebP, y Playwright ya está
 * instalado para las pruebas. Agregar una librería de imágenes al proyecto para
 * correr esto una vez cada varios meses no se paga.
 *
 * El origen siempre es el PNG, que es el archivo grande y sin pérdida. Nunca se
 * re-comprime un WebP: cada pasada agrega sus propios defectos sobre los de la
 * anterior.
 */

import { chromium } from "@playwright/test";
import { writeFileSync, statSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Qué generar, de dónde y con qué calidad.
 *
 * `calidad` va entre 0 y 1. Estos logos son dibujos de bordes duros sobre fondo
 * transparente: aguantan bastante compresión sin que se note, pero por debajo
 * de 0,80 aparecen halos alrededor del dorado.
 */
export const SALIDAS = [
  // El logo de la portada, en dos tamaños. Se dibuja a 180 px en un teléfono y
  // a 300 en una computadora; con `srcset` elige el navegador según su
  // densidad de pantalla.
  //
  // Los anchos y las calidades salen de un barrido, no de la intuición: se
  // midió cada combinación y se eligió el punto donde bajar más empieza a
  // dejar halos alrededor del dorado. 420 es el ancho que ya tenía —no se
  // sube, porque el archivo crecía más de lo que el detalle mejoraba—.
  {
    origen: "public/img/memorie-legends3.png",
    destino: "public/img/memorie-legends3.webp",
    ancho: 420,
    calidad: 0.75,
    nota: "portada, pantallas de mucha densidad",
  },
  {
    origen: "public/img/memorie-legends3.png",
    destino: "public/img/memorie-legends3-chico.webp",
    ancho: 300,
    calidad: 0.78,
    nota: "portada, pantallas normales",
  },
  // El de la barra: se dibuja a 40-50 px y el archivo tenía 192, o sea 21 KB
  // para mostrarse en un cuadradito. Con 96 alcanza para el doble de densidad.
  {
    origen: "public/img/memorie-legends2.png",
    destino: "public/img/memorie-legends2.webp",
    ancho: 96,
    calidad: 0.80,
    nota: "barra y avatar",
  },
];


/** Reescala y re-codifica una imagen usando el navegador. */
async function convertir(pagina, { origen, destino, ancho, calidad }) {
  const datos = await pagina.evaluate(
    async ({ url, ancho, calidad }) => {
      const img = new Image();
      img.src = url;
      await img.decode();

      // El alto sale de la proporción del original: escribirlo a mano es como
      // se deforman los logos sin que nadie lo note hasta que está publicado.
      const alto = Math.round((ancho * img.naturalHeight) / img.naturalWidth);

      const lienzo = document.createElement("canvas");
      lienzo.width = ancho;
      lienzo.height = alto;
      const ctx = lienzo.getContext("2d");
      // Sin esto el reescalado sale con los bordes dentados.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, ancho, alto);

      return {
        alto,
        // `toDataURL` conserva la transparencia en WebP, que es lo que estos
        // logos necesitan: van sobre fondos distintos en cada pantalla.
        datos: lienzo.toDataURL("image/webp", calidad),
      };
    },
    {
      // El PNG entra como `data:` y no como `file:`.
      //
      // Un `file://` de otra carpeta cuenta como otro origen: el navegador
      // marca el canvas como "manchado" y `toDataURL` se niega a exportarlo
      // —protege contra leer imágenes ajenas píxel a píxel—. Un `data:` es del
      // mismo documento, así que no hay nada que proteger. De paso, la
      // herramienta no necesita ningún servidor levantado.
      url: `data:image/png;base64,${readFileSync(origen).toString("base64")}`,
      ancho,
      calidad,
    },
  );

  const bytes = Buffer.from(datos.datos.split(",")[1], "base64");
  writeFileSync(destino, bytes);
  return { alto: datos.alto, bytes: bytes.length };
}

const navegador = await chromium.launch();
try {
  const pagina = await (await navegador.newContext()).newPage();
  // Una página vacía alcanza: las imágenes llegan como `data:` y el canvas se
  // arma en memoria.
  await pagina.goto("about:blank");

  for (const salida of SALIDAS) {
    const antes = statSync(salida.destino, { throwIfNoEntry: false })?.size ?? 0;
    const { alto, bytes } = await convertir(pagina, salida);
    const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
    console.log(
      `  ${path.basename(salida.destino).padEnd(30)} ${salida.ancho}x${alto}` +
        `  ${antes ? kb(antes) + " -> " : ""}${kb(bytes)}   (${salida.nota})`,
    );
  }
} finally {
  await navegador.close();
}
