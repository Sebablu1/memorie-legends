/**
 * Le saca el fondo blanco a los avatares y las insignias, y los pasa a WebP.
 *
 *   node herramientas/recortar-fondo.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO SE BORRA "TODO LO BLANCO"
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque un umbral global —"todo píxel más claro que 225 se vuelve
 * transparente"— no distingue el fondo de la figura. Y estas figuras tienen
 * blanco adentro: el filo de una armadura, los dientes, el brillo de un ojo,
 * la túnica de la sacerdotisa. Con umbral global, al mago le quedan agujeros
 * en los ojos y nadie se entera hasta que lo ve en la tienda, chiquito y
 * recortado en un círculo.
 *
 * Lo que se hace es un RELLENO POR INUNDACIÓN desde los bordes: se entra por
 * los cuatro costados y se avanza mientras el píxel siga siendo casi blanco.
 * Así sólo desaparece el blanco que está CONECTADO con el borde, que es la
 * definición operativa de "fondo". El blanco encerrado dentro de la figura no
 * se toca, porque no se llega a él sin cruzar la silueta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL BORDE SE SUAVIZA, PORQUE SI NO QUEDA UN HALO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un recorte de sí o no deja el contorno dentado y, peor, deja el anillo de
 * píxeles medio blancos que el antialias del dibujo original puso entre la
 * figura y el fondo. Sobre el panel oscuro del juego ese anillo se ve como un
 * halo claro alrededor de cada personaje.
 *
 * Por eso, después de la inundación, los píxeles que tocan una zona ya
 * transparente y siguen siendo claros no se borran: se les baja la opacidad en
 * proporción a cuán claros son. El contorno queda progresivo, que es lo que
 * hace que se apoye sobre cualquier fondo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SE CODIFICA CON CHROMIUM, COMO `imagenes.mjs`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Sin dependencias nuevas. Ese archivo ya dejó escrita la razón: agregar una
 * librería de imágenes para correr esto una vez cada varios meses no se paga,
 * y el navegador que ya está instalado para las pruebas sabe escribir WebP con
 * transparencia.
 *
 * El PNG se pasa como `data:` y no como `file://` a propósito: una imagen
 * cargada desde el disco "mancha" el lienzo y el navegador prohíbe leerlo,
 * que es justo lo que hace falta para tocar los píxeles.
 */

import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, extname, basename } from "node:path";

const RAIZ = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** Las carpetas que se procesan, con su calidad. */
const CARPETAS = [
  { ruta: "public/img/avatar", calidad: 0.9 },
  { ruta: "public/img/insignias", calidad: 0.9 },
];

/**
 * Cuán claro tiene que ser un píxel para contar como fondo.
 *
 * 225 sobre 255 en los tres canales. Más alto deja un borde sucio; más bajo
 * empieza a comerse los grises claros de la propia figura.
 */
const UMBRAL = 225;

/**
 * Los acentos se van del nombre del archivo.
 *
 * `el_dragón.png` en una URL es `el_drag%C3%B3n.png`, y el id del catálogo se
 * deriva del nombre: un id con acento se arrastra a Firestore, a la ruta de la
 * imagen y a cada comparación. Se normaliza una vez, acá.
 */
const sinAcentos = (texto) =>
  texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

const navegador = await chromium.launch();
const pagina = await navegador.newPage();

let total = 0;
let antesTotal = 0;
let despuesTotal = 0;

for (const { ruta, calidad } of CARPETAS) {
  const carpeta = join(RAIZ, ruta);
  let archivos;
  try {
    archivos = readdirSync(carpeta).filter((f) => extname(f).toLowerCase() === ".png");
  } catch {
    console.log(`  (no existe ${ruta}, se saltea)`);
    continue;
  }

  console.log(`\n${ruta} — ${archivos.length} archivos`);

  for (const archivo of archivos) {
    const origen = join(carpeta, archivo);
    const nombre = sinAcentos(basename(archivo, ".png"));
    const destino = join(carpeta, `${nombre}.webp`);

    const png = readFileSync(origen);
    const datos = `data:image/png;base64,${png.toString("base64")}`;

    const resultado = await pagina.evaluate(
      async ({ datos, umbral, calidad }) => {
        const imagen = new Image();
        imagen.src = datos;
        await imagen.decode();

        const lienzo = document.createElement("canvas");
        lienzo.width = imagen.naturalWidth;
        lienzo.height = imagen.naturalHeight;
        const ctx = lienzo.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(imagen, 0, 0);

        const { width: an, height: al } = lienzo;
        const cuadro = ctx.getImageData(0, 0, an, al);
        const p = cuadro.data;

        const casiBlanco = (i) => p[i] >= umbral && p[i + 1] >= umbral && p[i + 2] >= umbral;

        // ---- inundación desde los bordes ----
        //
        // Una cola explícita y no recursión: 400x400 son 160.000 píxeles y una
        // recursión de esa profundidad revienta la pila del navegador.
        const visto = new Uint8Array(an * al);
        const cola = [];

        const encolar = (x, y) => {
          if (x < 0 || y < 0 || x >= an || y >= al) return;
          const n = y * an + x;
          if (visto[n]) return;
          if (!casiBlanco(n * 4)) return;
          visto[n] = 1;
          cola.push(n);
        };

        for (let x = 0; x < an; x++) {
          encolar(x, 0);
          encolar(x, al - 1);
        }
        for (let y = 0; y < al; y++) {
          encolar(0, y);
          encolar(an - 1, y);
        }

        let borrados = 0;
        while (cola.length) {
          const n = cola.pop();
          p[n * 4 + 3] = 0;
          borrados++;
          const x = n % an;
          const y = (n / an) | 0;
          encolar(x + 1, y);
          encolar(x - 1, y);
          encolar(x, y + 1);
          encolar(x, y - 1);
        }

        // ---- el anillo del borde, con opacidad proporcional ----
        //
        // Se decide sobre una COPIA de las opacidades. Si se leyera el cuadro
        // mientras se escribe, un píxel ya suavizado contaría como transparente
        // para su vecino y el desvanecido se propagaría hacia adentro de la
        // figura, comiéndosela de a poco.
        const alfaPrevia = new Uint8Array(an * al);
        for (let n = 0; n < an * al; n++) alfaPrevia[n] = p[n * 4 + 3];

        let suavizados = 0;
        for (let y = 0; y < al; y++) {
          for (let x = 0; x < an; x++) {
            const n = y * an + x;
            if (alfaPrevia[n] === 0) continue;

            const tocaFondo =
              (x > 0 && alfaPrevia[n - 1] === 0) ||
              (x < an - 1 && alfaPrevia[n + 1] === 0) ||
              (y > 0 && alfaPrevia[n - an] === 0) ||
              (y < al - 1 && alfaPrevia[n + an] === 0);
            if (!tocaFondo) continue;

            // Cuánto le falta al píxel para ser blanco: si es casi blanco,
            // casi transparente; si es oscuro, se queda entero.
            const claridad = (p[n * 4] + p[n * 4 + 1] + p[n * 4 + 2]) / 3;
            if (claridad < umbral - 60) continue;
            const opacidad = Math.max(0, Math.min(1, (255 - claridad) / 60));
            p[n * 4 + 3] = Math.round(255 * opacidad);
            suavizados++;
          }
        }

        ctx.putImageData(cuadro, 0, 0);
        return {
          webp: lienzo.toDataURL("image/webp", calidad),
          ancho: an,
          alto: al,
          borrados,
          suavizados,
        };
      },
      { datos, umbral: UMBRAL, calidad },
    );

    const bytes = Buffer.from(resultado.webp.split(",")[1], "base64");
    writeFileSync(destino, bytes);

    const antes = statSync(origen).size;
    antesTotal += antes;
    despuesTotal += bytes.length;
    total++;

    const porcentaje = ((resultado.borrados / (resultado.ancho * resultado.alto)) * 100).toFixed(0);
    console.log(
      `  ${archivo.padEnd(24)} ${resultado.ancho}x${resultado.alto}  ` +
        `${kb(antes).padStart(9)} -> ${kb(bytes.length).padStart(9)}  ` +
        `fondo ${porcentaje}%${nombre !== basename(archivo, ".png") ? `  (renombrado a ${nombre})` : ""}`,
    );
  }
}

await navegador.close();

console.log(
  `\n${total} imágenes: ${kb(antesTotal)} -> ${kb(despuesTotal)} ` +
    `(${(100 - (despuesTotal / antesTotal) * 100).toFixed(0)}% menos)`,
);
console.log("\nLos PNG NO se borran: son el original sin pérdida y el punto de partida");
console.log("si mañana hace falta otra calidad o otro tamaño.");
