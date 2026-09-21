/**
 * Regenera el escudo, la moneda y los íconos, del tamaño y el peso que hacen
 * falta.
 *
 *   node herramientas/imagenes.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LOS ORIGINALES VIVEN FUERA DE `public/`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `diseno/escudo.png` y `diseno/moneda.png` pesan 2 MB cada uno. Dentro de
 * `public/` se publicarían, y cualquiera podría bajarse 4 MB que ninguna
 * página usa. Acá son la materia prima: se leen, no se sirven.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTEN VARIOS TAMAÑOS DE LA MISMA IMAGEN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque "el tamaño correcto" depende de la pantalla. El escudo de la portada
 * se dibuja a 180 px de ancho en un teléfono y a 300 en una computadora — pero
 * un teléfono moderno tiene tres píxeles físicos por cada uno de esos 180, así
 * que necesita una imagen de 540 para verse nítido, mientras que la
 * computadora se conforma con 320.
 *
 * Un solo archivo no puede ganar las dos: el que sirve al teléfono le sobra a
 * la computadora, y el que le queda bien a la computadora se ve borroso en el
 * teléfono. Por eso se generan varios y elige el navegador, con `srcset`.
 *
 * Éste es el punto que conviene no perder de vista al "optimizar imágenes":
 * achicar el archivo hasta el tamaño en CSS deja la imagen borrosa en casi
 * todos los teléfonos que existen. Lo que se mide en una auditoría no siempre
 * es lo que se ve.
 *
 * Y el otro extremo tampoco sirve: no hay escudo de 1200. El más grande del
 * sitio se dibuja a 300 px, y ni una pantalla doble necesita más de 640. Uno
 * de 1200 pesaría unos 250 KB y sólo lo bajaría quien no lo necesita.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SE CODIFICA CON EL NAVEGADOR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Sin dependencias nuevas: Chromium ya sabe escribir WebP y PNG, y Playwright
 * ya está instalado para las pruebas. Agregar una librería de imágenes al
 * proyecto para correr esto una vez cada varios meses no se paga.
 *
 * El origen siempre es el PNG, que es el archivo grande y sin pérdida. Nunca
 * se re-comprime un WebP: cada pasada agrega sus propios defectos sobre los de
 * la anterior.
 */

import { chromium } from "@playwright/test";
import { writeFileSync, statSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** La materia prima. Fuera de `public/`: ver arriba. */
export const ORIGINALES = Object.freeze({
  escudo: "diseno/escudo.png",
  moneda: "diseno/moneda.png",
});

/**
 * La calidad, entre 0 y 1, salió de un barrido: se generó cada tamaño a
 * 0,70 - 0,75 - 0,80 - 0,85 y se miró ampliado al triple. A 0,70 aparecen
 * bloques alrededor de la gema de la cinta; de 0,75 para arriba no se
 * distinguen entre sí, y cada escalón suma un 10 % al archivo.
 *
 * A 0,75 el escudo de 320 pesa 26 KB: menos que los 29,8 del logo anterior
 * que bajaba el mismo teléfono.
 */
const CALIDAD_ESCUDO = 0.75;
const CALIDAD_MONEDA = 0.8;

/** Qué generar, de dónde y cómo. */
export const SALIDAS = [
  // El escudo: portada, caja del tablero, velo de la mesa, ingreso y registro.
  // Cada página elige con `srcset` y un `sizes` calcado de su CSS.
  { origen: ORIGINALES.escudo, destino: "public/img/escudo-160.webp", ancho: 160, calidad: CALIDAD_ESCUDO, nota: "tablero en un teléfono chico" },
  { origen: ORIGINALES.escudo, destino: "public/img/escudo-320.webp", ancho: 320, calidad: CALIDAD_ESCUDO, nota: "portada en el teléfono de PageSpeed y en computadora" },
  { origen: ORIGINALES.escudo, destino: "public/img/escudo-480.webp", ancho: 480, calidad: CALIDAD_ESCUDO, nota: "pantallas de densidad 2" },
  { origen: ORIGINALES.escudo, destino: "public/img/escudo-640.webp", ancho: 640, calidad: CALIDAD_ESCUDO, nota: "pantallas de densidad 3" },

  // La moneda de la barra: 40 px en un teléfono y 50 en una computadora.
  { origen: ORIGINALES.moneda, destino: "public/img/moneda-40.webp", ancho: 40, calidad: CALIDAD_MONEDA, nota: "barra, densidad 1" },
  { origen: ORIGINALES.moneda, destino: "public/img/moneda-80.webp", ancho: 80, calidad: CALIDAD_MONEDA, nota: "barra densidad 2, avatar" },
  { origen: ORIGINALES.moneda, destino: "public/img/moneda-120.webp", ancho: 120, calidad: CALIDAD_MONEDA, nota: "barra densidad 3" },

  // Los íconos van en PNG: un favicon en WebP no lo muestran todos los
  // navegadores, y el de la pantalla de inicio del iPhone tampoco.
  { origen: ORIGINALES.moneda, destino: "public/img/favicon-32.png", ancho: 32, formato: "image/png", nota: "pestaña del navegador" },
  // El iPhone pinta de negro lo transparente y le redondea las esquinas por su
  // cuenta: se le da el fondo del sitio y un margen para que el borde de la
  // moneda no quede pegado a la curva.
  { origen: ORIGINALES.moneda, destino: "public/img/apple-touch-icon.png", ancho: 180, formato: "image/png", fondo: "#0a0a0a", margen: 0.1, nota: "pantalla de inicio del iPhone" },
];

/** Reescala y re-codifica una imagen usando el navegador. */
export async function convertir(pagina, { origen, destino, ancho, calidad, formato = "image/webp", fondo = null, margen = 0 }) {
  const datos = await pagina.evaluate(
    async ({ url, ancho, calidad, formato, fondo, margen }) => {
      const img = new Image();
      img.src = url;
      await img.decode();

      // El alto sale de la proporción del original: escribirlo a mano es como
      // se deforman los logos sin que nadie lo note hasta que está publicado.
      const alto = Math.round((ancho * img.naturalHeight) / img.naturalWidth);
      const anchoDibujo = Math.round(ancho * (1 - 2 * margen));
      const altoDibujo = Math.round(alto * (1 - 2 * margen));

      // Se achica de a mitades. De 1254 a 40 px en un solo paso, el navegador
      // mira pocos píxeles de cada zona del original y el borde de la moneda
      // sale dentado; bajando de a la mitad, cada paso promedia bien.
      let fuente = img;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      while (w / 2 >= anchoDibujo) {
        w = Math.round(w / 2);
        h = Math.round(h / 2);
        const paso = document.createElement("canvas");
        paso.width = w;
        paso.height = h;
        const c = paso.getContext("2d");
        c.imageSmoothingEnabled = true;
        c.imageSmoothingQuality = "high";
        c.drawImage(fuente, 0, 0, w, h);
        fuente = paso;
      }

      const lienzo = document.createElement("canvas");
      lienzo.width = ancho;
      lienzo.height = alto;
      const ctx = lienzo.getContext("2d");
      if (fondo) {
        ctx.fillStyle = fondo;
        ctx.fillRect(0, 0, ancho, alto);
      }
      // Sin esto el reescalado sale con los bordes dentados.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(fuente, (ancho - anchoDibujo) / 2, (alto - altoDibujo) / 2, anchoDibujo, altoDibujo);

      return {
        alto,
        // `toDataURL` conserva la transparencia en WebP y en PNG, que es lo
        // que estas imágenes necesitan: van sobre fondos distintos en cada
        // pantalla.
        datos: lienzo.toDataURL(formato, calidad),
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
      formato,
      fondo,
      margen,
    },
  );

  const bytes = Buffer.from(datos.datos.split(",")[1], "base64");
  writeFileSync(destino, bytes);
  return { alto: datos.alto, bytes: bytes.length };
}

async function principal() {
  const navegador = await chromium.launch();
  try {
    const pagina = await (await navegador.newContext()).newPage();
    // Una página vacía alcanza: las imágenes llegan como `data:` y el canvas
    // se arma en memoria.
    await pagina.goto("about:blank");

    for (const salida of SALIDAS) {
      const antes = statSync(salida.destino, { throwIfNoEntry: false })?.size ?? 0;
      const { alto, bytes } = await convertir(pagina, salida);
      const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
      console.log(
        `  ${path.basename(salida.destino).padEnd(22)} ${salida.ancho}x${alto}` +
          `  ${antes ? kb(antes) + " -> " : ""}${kb(bytes)}   (${salida.nota})`,
      );
    }
  } finally {
    await navegador.close();
  }
}

// Se corre sólo cuando se la llama. Importada —las pruebas leen `SALIDAS` y
// `ORIGINALES`— no abre ningún navegador.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await principal();
}
