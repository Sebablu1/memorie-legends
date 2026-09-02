/**
 * Servidor estático mínimo para mirar la mesa en el navegador.
 *
 * No reemplaza a `firebase serve`: no tiene emuladores ni reescrituras. Sirve
 * para lo único que hace falta acá, que es abrir la mesa en modo entrenamiento
 * y comprobar que el cliente hace lo que dice.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

// normalize() para que la raíz use los mismos separadores que join(): en
// Windows la URL trae barras normales y join() devuelve invertidas, y comparar
// una contra otra rechazaba todo.
const RAIZ = normalize(
  new URL("../public/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
);
const TIPOS = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  // `.mjs` también. Sin esto sale como `application/octet-stream`, el navegador
  // rechaza el módulo por el tipo, y el import falla entero: la pantalla queda
  // muerta y el único rastro es un error de MIME en la consola.
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
  ".webp": "image/webp", ".mp3": "audio/mpeg", ".ico": "image/x-icon",
};

createServer(async (pedido, respuesta) => {
  const ruta = decodeURIComponent(new URL(pedido.url, "http://x").pathname);
  const archivo = join(RAIZ, normalize(ruta));
  // Después de normalizar, cualquier ../.. ya se resolvió: si el resultado se
  // fue de public/, se corta acá. Sirve sólo en esta máquina, pero un servidor
  // que entrega archivos arbitrarios no se escribe "sólo para probar".
  if (!archivo.startsWith(RAIZ)) {
    respuesta.writeHead(403).end("no");
    return;
  }
  try {
    const cuerpo = await readFile(archivo.endsWith("/") ? join(archivo, "index.html") : archivo);
    respuesta.writeHead(200, { "Content-Type": TIPOS[extname(archivo)] ?? "application/octet-stream" });
    respuesta.end(cuerpo);
  } catch {
    respuesta.writeHead(404).end("no está");
  }
}).listen(5000, () => console.log("sirviendo public/ en http://localhost:5000"));
