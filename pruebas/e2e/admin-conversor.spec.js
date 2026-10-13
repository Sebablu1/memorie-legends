/**
 * El conversor del panel: subir un archivo y que baje el que corresponde.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SE PRUEBA POR LA DESCARGA, NO POR UNA VARIABLE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Playwright puede capturar lo que el navegador descarga, así que lo que esta
 * suite mira es el ARCHIVO que el administrador se lleva — sus bytes, sus
 * medidas y su canal alfa, leídos del encabezado WebP.
 *
 * La alternativa habría sido dejar el resultado en `window` para espiarlo
 * desde la prueba, y es peor por dos motivos: habría que ensuciar el código
 * de producción con un gancho que sólo existe para la prueba, y lo que se
 * afirmaría es que una variable tiene el valor correcto, no que el archivo
 * que sale de verdad lo tenga.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL ARCHIVO DE ENTRADA SE FABRICA ACÁ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Y no se toma uno del repositorio. Un PNG de prueba generado tiene medidas y
 * colores que la prueba ELIGE —un cuadrado de 1000, un rectángulo de 800×600,
 * uno chiquito de 120— y eso es lo que permite afirmar la aritmética de la
 * tabla. Con un archivo real habría que cambiar la prueba cada vez que alguien
 * rehace el arte.
 *
 * Se fabrica con `zlib` y un encabezado PNG escrito a mano: son treinta
 * líneas y evitan sumar una dependencia para generar imágenes.
 */

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { RECETAS } from "../../public/js/reglas/imagenes-de-catalogo.js";
import { imagenUrl } from "../../public/js/reglas/imagenes.js";

const ADMIN = "soporte.memorie.legends@gmail.com";

/** Un artículo con archivo de verdad, para mirar la miniatura de la lista. */
const CARA = "/img/avatar/el_as.webp";

// =====================================================================
// Un PNG de verdad, fabricado
// =====================================================================

const crc32 = (buf) => {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
};

const trozo = (tipo, datos) => {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
  const suma = Buffer.alloc(4);
  suma.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, suma]);
};

/**
 * Un PNG RGBA opaco con una figura oscura al medio y el resto BLANCO.
 *
 * El fondo blanco no es decorativo: es lo que le da algo que hacer al recorte
 * por inundación. Sin él, «quitar el fondo» no tendría nada que quitar y la
 * prueba del checkbox no probaría nada.
 */
function pngDePrueba(ancho, alto) {
  const filas = [];
  for (let y = 0; y < alto; y++) {
    const fila = Buffer.alloc(1 + ancho * 4);
    fila[0] = 0; // sin filtro
    for (let x = 0; x < ancho; x++) {
      // La figura: el cuarto central. Oscura, así que la inundación se frena.
      const dentro =
        x > ancho / 4 && x < (ancho * 3) / 4 && y > alto / 4 && y < (alto * 3) / 4;
      const v = dentro ? 30 : 255;
      const i = 1 + x * 4;
      fila[i] = v; fila[i + 1] = v; fila[i + 2] = v; fila[i + 3] = 255;
    }
    filas.push(fila);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8;   // bits por canal
  ihdr[9] = 6;   // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo("IHDR", ihdr),
    trozo("IDAT", deflateSync(Buffer.concat(filas))),
    trozo("IEND", Buffer.alloc(0)),
  ]);
}

/** Medidas y alfa de un WebP, leídas del encabezado. */
function leerWebp(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") {
    return { formato: "no es webp" };
  }
  const formato = buf.toString("ascii", 12, 16);
  if (formato === "VP8X") {
    return {
      formato,
      ancho: buf.readUIntLE(24, 3) + 1,
      alto: buf.readUIntLE(27, 3) + 1,
      alfa: Boolean(buf[20] & 0x10),
    };
  }
  if (formato === "VP8L") {
    const n = buf.readUInt32LE(21);
    return {
      formato,
      ancho: (n & 0x3fff) + 1,
      alto: ((n >> 14) & 0x3fff) + 1,
      alfa: Boolean((n >> 28) & 1),
    };
  }
  // VP8 a secas es con pérdida y SIN alfa: para un avatar eso es un defecto.
  return { formato, ancho: buf.readUInt16LE(26) & 0x3fff, alto: buf.readUInt16LE(28) & 0x3fff, alfa: false };
}

// =====================================================================
// El panel
// =====================================================================

const CATALOGO = [
  { id: "el-zorro", tipo: "avatar", nombre: "El Zorro", precio: 150, imagen: "🦊", activo: true, orden: 10 },
  { id: "novato", tipo: "insignia", nombre: "Novato", precio: 0, imagen: "🏅", activo: true, orden: 10 },
  { id: "pano-roble", tipo: "fondo", nombre: "Roble", precio: 300, imagen: "🟫", activo: true, orden: 10 },
  // Uno con ARCHIVO, no emoji: es el único que hace visible la miniatura, y
  // sin él nadie miraba nunca cómo se dibuja.
  { id: "el-as", tipo: "avatar", nombre: "El As", precio: 100, imagen: CARA, activo: true, orden: 20 },
];

const firebaseFalso = `
  export const app = {}; export const auth = {};
  export const db = {}; export const funciones = {};
  export const googleProvider = {};
  export const SUPPORT_EMAIL = ${JSON.stringify(ADMIN)};
  const CATALOGO = ${JSON.stringify(CATALOGO)};
  export function httpsCallable(_f, nombre) {
    return async () => {
      if (nombre === "listarCatalogoAdmin") return { data: { items: CATALOGO } };
      if (nombre === "listarSalasAdmin") {
        return { data: { salas: [], partidas: [], muertas: [], totales: { salas: 0, partidas: 0, muertas: 0, leyendasRetenidas: 0 } } };
      }
      if (nombre === "listarTorneosAdmin") return { data: { torneos: [] } };
      if (nombre === "leerUmbralesAdmin") return { data: { umbrales: {} } };
      return { data: {} };
    };
  }
  export function onAuthStateChanged(a, fn) {
    setTimeout(() => fn({ email: ${JSON.stringify(ADMIN)}, uid: "admin" }), 60);
    return () => {};
  }
  export async function signInWithEmailAndPassword(){}
  export async function signInWithPopup(){}
  export function signOut(){}
`;

async function abrirPanel(page) {
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));
  await page.route("**/js/firebase.js", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: firebaseFalso }));
  await page.goto("/admin/index.html");
  await page.waitForSelector("#conversorImagen");
  return errores;
}

/** Llena lo mínimo del formulario y entrega el archivo al conversor. */
async function convertir(page, { id, tipo, png, quitarFondo = false }) {
  await page.fill("#itemId", id);
  await page.selectOption("#itemTipo", tipo);
  if (quitarFondo) await page.check("#conversorQuitarFondo");
  await page.setInputFiles("#conversorArchivo", {
    name: "original.png", mimeType: "image/png", buffer: png,
  });
  await expect(page.locator("#conversorDescargar")).toBeEnabled({ timeout: 15_000 });
}

/** Toca el botón y devuelve los bytes de lo que bajó. */
async function bajar(page) {
  const [descarga] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#conversorDescargar"),
  ]);
  return { nombre: descarga.suggestedFilename(), bytes: readFileSync(await descarga.path()) };
}

// =====================================================================
// 1. Convierte a lo que dice la tabla
// =====================================================================

test("un avatar sale en 512 cuadrados, con alfa, y se llama como el id", async ({ page }) => {
  const errores = await abrirPanel(page);

  await convertir(page, { id: "el_lobo", tipo: "avatar", png: pngDePrueba(1000, 1000) });
  const { nombre, bytes } = await bajar(page);

  expect(nombre, "el nombre es el id del artículo").toBe("el_lobo.webp");

  const webp = leerWebp(bytes);
  expect(webp.ancho).toBe(RECETAS.avatar.ladoMayor);
  expect(webp.alto).toBe(RECETAS.avatar.ladoMayor);
  expect(webp.formato, "VP8 a secas no tiene canal alfa").not.toBe("VP8 ");

  expect(errores, errores.join(" | ")).toEqual([]);
});

test("una insignia sale a 256 del lado MAYOR, con su proporción", async ({ page }) => {
  /*
   * El caso que distingue las dos recetas. Un avatar se cuadra; una insignia
   * no, porque sus seis dibujos tienen proporciones de 0,980 a 1,125 y las
   * superficies que los dibujan ya lo contemplan.
   */
  await abrirPanel(page);

  await convertir(page, { id: "veterano", tipo: "insignia", png: pngDePrueba(800, 600) });
  const { nombre, bytes } = await bajar(page);

  expect(nombre).toBe("veterano.webp");
  const webp = leerWebp(bytes);
  expect(webp.ancho, "el lado mayor va al tope de la receta").toBe(RECETAS.insignia.ladoMayor);
  expect(webp.alto, "y el otro sale de la proporción: 600 × 256/800").toBe(192);
});

test("si el original entra chico, NO se agranda", async ({ page }) => {
  /*
   * Llevar 120 px a 256 inventa píxeles y engorda el archivo: paga de las dos
   * formas. Lo correcto es dejarlo y decirlo, que es lo que hace la nota.
   */
  await abrirPanel(page);

  await convertir(page, { id: "chiquito", tipo: "insignia", png: pngDePrueba(120, 100) });
  const { bytes } = await bajar(page);

  const webp = leerWebp(bytes);
  expect(webp.ancho).toBe(120);
  expect(webp.alto).toBe(100);
  await expect(page.locator("#conversorAviso")).toContainText(/NO se agrandó/i);
});

// =====================================================================
// 2. El checkbox del fondo
// =====================================================================

test("con el fondo quitado, el resultado tiene canal alfa de verdad", async ({ page }) => {
  await abrirPanel(page);

  await convertir(page, {
    id: "recortado", tipo: "avatar", png: pngDePrueba(600, 600), quitarFondo: true,
  });
  const { bytes } = await bajar(page);

  const webp = leerWebp(bytes);
  expect(webp.alfa, "el WebP tiene que declarar canal alfa").toBe(true);

  // El PNG de prueba es blanco salvo el cuarto central, así que el recorte
  // tiene que haber borrado alrededor de tres cuartos del cuadro.
  await expect(page.locator("#conversorAviso")).toContainText(/fondo \d+%/);
});

test("y sin marcarlo, el fondo blanco se queda", async ({ page }) => {
  /*
   * El otro lado, que es el que hace que el checkbox signifique algo. Si el
   * recorte corriera siempre, marcarlo o no daría lo mismo y la casilla sería
   * un adorno.
   *
   * Se compara contra la MISMA imagen convertida con el recorte puesto: los
   * dos archivos tienen que ser distintos.
   */
  await abrirPanel(page);

  await convertir(page, { id: "entero", tipo: "avatar", png: pngDePrueba(600, 600) });
  const sinRecorte = (await bajar(page)).bytes;

  await expect(page.locator("#conversorAviso")).not.toContainText(/fondo/);

  // Ahora el mismo archivo, con la casilla marcada: se reconvierte solo.
  await page.check("#conversorQuitarFondo");
  await expect(page.locator("#conversorAviso")).toContainText(/fondo \d+%/, { timeout: 15_000 });
  const conRecorte = (await bajar(page)).bytes;

  expect(
    sinRecorte.equals(conRecorte),
    "marcar la casilla tiene que cambiar el archivo que sale",
  ).toBe(false);
});

// =====================================================================
// 3. Lo que no convierte
// =====================================================================

test("un paño no se convierte acá, y se dice por qué", async ({ page }) => {
  /*
   * Los paños son SVG. Rasterizar un vector es perder justo lo que lo hace un
   * vector. El bloque no se esconde —esconderlo haría creer que la función no
   * existe— sino que se apaga y lo explica.
   */
  await abrirPanel(page);
  await page.selectOption("#itemTipo", "fondo");

  await expect(page.locator("#conversorArchivo")).toBeDisabled();
  await expect(page.locator("#conversorImagen")).toHaveClass(/apagado/);
  await expect(page.locator("#conversorAviso")).toContainText(/SVG/i);
});

test("el recorte de fondo se ofrece sólo para avatares e insignias", async ({ page }) => {
  /*
   * Un dorso de carta es un rectángulo lleno: la inundación desde los bordes
   * le comería el dibujo si fuera claro.
   */
  await abrirPanel(page);

  await page.selectOption("#itemTipo", "avatar");
  await expect(page.locator("#conversorCampoFondo")).toBeVisible();

  await page.selectOption("#itemTipo", "insignia");
  await expect(page.locator("#conversorCampoFondo")).toBeVisible();

  await page.selectOption("#itemTipo", "dorso");
  await expect(page.locator("#conversorCampoFondo")).toBeHidden();
});

test("sin id no se convierte: el nombre del archivo sale de ahí", async ({ page }) => {
  await abrirPanel(page);

  await page.fill("#itemId", "");
  await page.selectOption("#itemTipo", "avatar");
  await page.setInputFiles("#conversorArchivo", {
    name: "x.png", mimeType: "image/png", buffer: pngDePrueba(400, 400),
  });

  await expect(page.locator("#conversorAviso")).toContainText(/id del artículo/i);
  await expect(page.locator("#conversorDescargar")).toBeDisabled();
});

test("un archivo que no es imagen se rechaza con su motivo", async ({ page }) => {
  await abrirPanel(page);

  await page.fill("#itemId", "raro");
  await page.selectOption("#itemTipo", "avatar");
  await page.setInputFiles("#conversorArchivo", {
    // Un SVG: subir un SVG es subir código, y acá no se sanitiza nada.
    name: "x.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>"),
  });

  await expect(page.locator("#conversorAviso")).toContainText(/PNG, JPG o WebP/i);
  await expect(page.locator("#conversorDescargar")).toBeDisabled();
});

// =====================================================================
// 4. Y no sube nada
// =====================================================================

test("no se manda nada a ningún lado", async ({ page }) => {
  /*
   * La promesa de esta etapa, afirmada y no sólo escrita en un comentario: al
   * convertir no sale ni un pedido a la red. El día que alguien agregue la
   * subida, esta prueba se pone roja y obliga a decidirlo a propósito.
   */
  await abrirPanel(page);

  const pedidos = [];
  page.on("request", (r) => {
    if (["xhr", "fetch"].includes(r.resourceType())) pedidos.push(r.url());
  });

  await convertir(page, { id: "mudo", tipo: "avatar", png: pngDePrueba(600, 600) });
  await bajar(page);

  expect(pedidos, `salieron pedidos: ${pedidos.join(", ")}`).toEqual([]);
});

// =====================================================================
// 5. El campo de siempre no se tocó
// =====================================================================

test("el campo de la ruta sigue estando y sigue aceptando un emoji", async ({ page }) => {
  /*
   * El conversor va AL LADO, no en lugar de. El campo de texto es la única
   * forma de poner un emoji o de apuntar a un archivo que ya existe, y el
   * catálogo de arranque usa emojis a propósito.
   */
  await abrirPanel(page);

  const campo = page.locator("#itemImagen");
  await expect(campo).toBeVisible();
  await expect(campo).toBeEditable();

  await campo.fill("🐺");
  await expect(campo).toHaveValue("🐺");
});

// =====================================================================
// 6. La miniatura de la lista
// =====================================================================

test("la miniatura del catálogo lleva la versión de la imagen", async ({ page }) => {
  /*
   * El admin era el ÚNICO lugar del sitio que dibujaba una imagen sin pasar
   * por `imagenUrl`, y el peor para no hacerlo: es la pantalla desde la que
   * se reemplaza una imagen, así que el que acababa de cambiar un avatar
   * seguía viendo el viejo —hasta treinta días— y no tenía forma de saber si
   * el cambio había entrado.
   *
   * Se compara contra `imagenUrl` y no contra «?v=3» escrito acá, para que
   * la prueba siga al número cuando suba.
   */
  await abrirPanel(page);
  await page.click("#btnRefrescarCatalogo");
  await page.waitForSelector("#listaCatalogo .fila");

  const mini = page
    .locator("#listaCatalogo .fila")
    .filter({ has: page.locator('[data-editar="el-as"]') })
    .locator("img");

  await expect(mini).toHaveAttribute("src", imagenUrl(CARA));
});
