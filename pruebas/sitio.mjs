/**
 * Lo que el sitio publica, leído de los archivos.
 *
 *   1. Toda imagen, ícono, hoja, script o fuente que se pide existe.
 *   2. Toda <img> del HTML reserva su lugar con `width` y `height`.
 *   3. Las precargas piden exactamente lo que después usa la imagen.
 *   4. Los originales de 2 MB no se publican.
 *   5. La cabecera es la misma en todas las páginas.
 *   6. El correo de contacto es uno solo, y no es la cuenta de administración.
 *   7. Cada página se declara con su dirección canónica, sin www.
 *   8. Cada fuente servida desde el sitio lleva su licencia al lado.
 *
 * Nada de esto rompe una prueba del navegador cuando falla. Un `src` mal
 * escrito no tira ningún error de JavaScript: deja un hueco donde iba la marca,
 * y nadie se entera hasta que lo ve un jugador. Por eso se mira acá, en todos
 * los archivos a la vez.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { ORIGINALES, SALIDAS } from "../herramientas/imagenes.mjs";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(REPO, "public");
const leer = (ruta) => readFileSync(ruta, "utf8");
const deRepo = (ruta) => relative(REPO, ruta).replaceAll("\\", "/");

const CONTACTO = "soporte@memorielegends.com";

// Leído del archivo y no importado: `public/` no se declara como módulo para
// Node, y el aviso que da al importarlo ensucia la salida de la suite.
const CORREO_ADMINISTRACION = leer(join(PUBLIC, "js", "administracion.js"))
  .match(/export const CORREO_ADMINISTRACION = "([^"]+)";/)?.[1];
const SITIO = "https://memorielegends.com";

const PAGINAS = [
  ...readdirSync(PUBLIC).filter((f) => f.endsWith(".html")).map((f) => join(PUBLIC, f)),
  join(PUBLIC, "admin", "index.html"),
];
const html = Object.fromEntries(PAGINAS.map((p) => [p, leer(p)]));

/** Las etiquetas `<nombre ...>` de un HTML, con sus atributos. */
function etiquetas(texto, nombre) {
  return [...texto.matchAll(new RegExp(`<${nombre}\\b[^>]*>`, "gi"))].map((m) => ({
    crudo: m[0],
    ...Object.fromEntries([...m[0].matchAll(/([a-z-]+)="([^"]*)"/gi)].map((a) => [a[1].toLowerCase(), a[2]])),
  }));
}

/** Las direcciones de un `srcset`, sin el descriptor de ancho. */
const direccionesDe = (srcset = "") =>
  srcset.split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);

const esLocal = (d) => d && !/^(https?:|data:|mailto:|#|\/\/)/.test(d) && !d.includes("${");

/** Dónde queda en disco una dirección pedida desde `desde`. */
function enDisco(direccion, desde) {
  const limpia = direccion.split(/[?#]/)[0];
  return limpia.startsWith("/") ? join(PUBLIC, limpia) : resolve(dirname(desde), limpia);
}

// ─────────────────────────────────────────────────────────────────────

console.log("\n=== 1. Todo lo que se pide existe ===");
{
  const rotas = [];
  const mirar = (direccion, desde) => {
    if (esLocal(direccion) && !existsSync(enDisco(direccion, desde))) {
      rotas.push(`${deRepo(desde)} → ${direccion}`);
    }
  };

  for (const [pagina, texto] of Object.entries(html)) {
    for (const img of [...etiquetas(texto, "img"), ...etiquetas(texto, "source")]) {
      mirar(img.src, pagina);
      direccionesDe(img.srcset).forEach((d) => mirar(d, pagina));
    }
    for (const link of etiquetas(texto, "link")) {
      if (/icon|preload|stylesheet/.test(link.rel ?? "")) {
        mirar(link.href, pagina);
        direccionesDe(link.imagesrcset).forEach((d) => mirar(d, pagina));
      }
    }
    for (const script of etiquetas(texto, "script")) mirar(script.src, pagina);
  }

  // Las imágenes que arma el JavaScript: las rutas son relativas a la página,
  // y todas las páginas que las usan están en la raíz.
  for (const carpeta of ["js", "admin"]) {
    for (const f of readdirSync(join(PUBLIC, carpeta)).filter((f) => f.endsWith(".js"))) {
      const texto = leer(join(PUBLIC, carpeta, f));
      for (const m of texto.matchAll(/["'`](?:\.\.\/)?(img\/[^"'`$\s]+?\.(?:webp|png|jpg|svg))["'`]/g)) {
        if (!existsSync(join(PUBLIC, m[1]))) rotas.push(`public/${carpeta}/${f} → ${m[1]}`);
      }
    }
  }

  // Y lo que piden las hojas: las fuentes y los fondos.
  for (const f of readdirSync(join(PUBLIC, "css")).filter((f) => f.endsWith(".css"))) {
    const ruta = join(PUBLIC, "css", f);
    for (const m of leer(ruta).matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) mirar(m[1], ruta);
  }

  ok(rotas.length === 0, "ninguna página, script ni hoja apunta a un archivo que no está", rotas);
}

console.log("\n=== 2. Toda <img> reserva su lugar ===");
{
  // Sin `width` y `height` el navegador no sabe cuánto espacio dejar hasta que
  // la imagen baja, y todo lo de abajo salta. Es lo que mide el CLS.
  const sinMedidas = [];
  for (const [pagina, texto] of Object.entries(html)) {
    for (const img of etiquetas(texto, "img")) {
      if (!/^\d+$/.test(img.width ?? "") || !/^\d+$/.test(img.height ?? "")) {
        sinMedidas.push(`${deRepo(pagina)}: ${img.crudo.slice(0, 90)}`);
      }
    }
  }
  ok(sinMedidas.length === 0, "todas tienen width y height en números", sinMedidas);
}

console.log("\n=== 3. Las precargas piden lo mismo que la imagen ===");
{
  // Si la precarga y la imagen no coinciden al carácter, el navegador baja un
  // archivo por la precarga y OTRO para la imagen: la precarga que tenía que
  // adelantar el LCP termina costando una descarga de más.
  const indice = html[join(PUBLIC, "index.html")];
  const precarga = etiquetas(indice, "link").find((l) => l.rel === "preload" && l.as === "image");
  const logo = etiquetas(indice, "img").find((i) => /portada-logo/.test(i.class ?? ""));
  ok(Boolean(precarga && logo), "la portada precarga su escudo");
  ok(precarga?.imagesrcset === logo?.srcset, "con el mismo srcset que la imagen",
     { precarga: precarga?.imagesrcset, imagen: logo?.srcset });
  ok(precarga?.imagesizes === logo?.sizes, "y el mismo sizes",
     { precarga: precarga?.imagesizes, imagen: logo?.sizes });
  ok(precarga?.fetchpriority === "high" && logo?.fetchpriority === "high",
     "la portada pide su escudo con prioridad alta");

  // Sólo la portada. En las demás pantallas el escudo no es lo que se mide,
  // y ponerle prioridad alta a todo es lo mismo que no ponérsela a nada.
  const conPrioridad = PAGINAS
    .filter((p) => p !== join(PUBLIC, "index.html") && /fetchpriority="high"/.test(html[p]))
    .map(deRepo);
  ok(conPrioridad.length === 0, "ninguna otra página usa fetchpriority=\"high\"", conPrioridad);

  // El ingreso muestra el escudo dos veces —el velo y el formulario— y tiene
  // que bajarlo UNA: mismo srcset y mismo sizes en las dos y en la precarga.
  for (const nombre of ["login.html", "register.html"]) {
    const texto = html[join(PUBLIC, nombre)];
    const escudos = etiquetas(texto, "img").filter((i) => /escudo-/.test(i.src ?? ""));
    const pre = etiquetas(texto, "link").find((l) => l.rel === "preload" && l.as === "image");
    const juegos = new Set([...escudos.map((i) => `${i.srcset}|${i.sizes}`), `${pre?.imagesrcset}|${pre?.imagesizes}`]);
    ok(escudos.length >= 1 && juegos.size === 1,
       `${nombre}: la precarga y cada escudo piden el mismo archivo`, [...juegos]);
  }
}

console.log("\n=== 4. Los originales no se publican ===");
{
  ok(Object.values(ORIGINALES).every((o) => existsSync(join(REPO, o))),
     "los originales están en el repositorio", ORIGINALES);
  const adentro = SALIDAS.map((s) => s.origen).filter((o) => o.replaceAll("\\", "/").startsWith("public/"));
  ok(adentro.length === 0, "y ninguno vive dentro de public/", adentro);

  const nombres = new Set(Object.values(ORIGINALES).map((o) => basename(o)));
  const publicados = [];
  const recorrer = (carpeta) => {
    for (const e of readdirSync(carpeta, { withFileTypes: true })) {
      const ruta = join(carpeta, e.name);
      if (e.isDirectory()) recorrer(ruta);
      else if (nombres.has(e.name)) publicados.push(deRepo(ruta));
    }
  };
  recorrer(PUBLIC);
  ok(publicados.length === 0, "no hay una copia de un original en public/", publicados);

  const faltan = SALIDAS.map((s) => s.destino).filter((d) => !existsSync(join(REPO, d)));
  ok(faltan.length === 0, "todo lo que genera imagenes.mjs está generado", faltan);
}

console.log("\n=== 5. La misma cabecera en todas las páginas ===");
{
  const NOMBRE = '<span class="marca-texto"><span>Memorie</span> <span>Legends</span></span>';
  const conBarra = PAGINAS.filter((p) => /class="(marca|logo)"/.test(html[p]) && /<header/.test(html[p]))
    .filter((p) => !/mesa\.html$|admin/.test(p));
  ok(conBarra.length >= 13, "las páginas con barra son las esperadas", conBarra.map(deRepo));

  for (const pagina of conBarra) {
    const texto = html[pagina];
    const monedas = etiquetas(texto, "img").filter((i) => /marca-moneda/.test(i.class ?? ""));
    const moneda = monedas[0];
    ok(monedas.length === 1
       && moneda.width === "40" && moneda.height === "40" && moneda.alt === ""
       && ["moneda-40", "moneda-80", "moneda-120"].every((n) => moneda.srcset.includes(n)),
       `${deRepo(pagina)}: la moneda, con sus tres tamaños y alt vacío`, moneda?.crudo);
    ok(texto.includes(NOMBRE), `${deRepo(pagina)}: el nombre escrito en texto, una palabra por <span>`);
    // En las etiquetas, no en el CSS: la portada lleva sus hojas incrustadas, y
    // `.logo-text` sigue definida para otras pantallas.
    ok(!/class="logo-(text|img)"|memorie-legends2/.test(texto), `${deRepo(pagina)}: sin rastros de la marca anterior`);
  }

  for (const nombre of ["mesa.html", "admin/index.html"]) {
    const marca = etiquetas(html[join(PUBLIC, nombre)], "img").find((i) => /\bmarca\b/.test(i.class ?? ""));
    ok(/moneda-/.test(marca?.src ?? ""), `${nombre}: la moneda en la cabecera`, marca?.crudo);
  }

  // El relieve va con `drop-shadow`: `text-shadow` sobre un degradado
  // recortado a las letras se pinta encima y ensucia el dorado.
  // Sin los comentarios, que explican justamente por qué no hay text-shadow.
  const tema = leer(join(PUBLIC, "css", "tema.css")).replace(/\/\*[\s\S]*?\*\//g, "");
  const reglas = [...tema.matchAll(/\.marca-texto[^{]*\{([^}]*)\}/g)].map((m) => m[1]).join("\n");
  ok(/font-family:\s*"Cinzel"/.test(reglas), "el nombre va en Cinzel");
  ok(/text-transform:\s*uppercase/.test(reglas), "las mayúsculas las pone el CSS");
  ok(/filter:[^;]*drop-shadow/.test(reglas), "el relieve es con drop-shadow");
  ok(!/text-shadow/.test(reglas), "y no con text-shadow");
  ok(/background-clip:\s*text/.test(reglas), "el dorado es un degradado recortado a las letras");
}

console.log("\n=== 6. Un solo correo de contacto ===");
{
  const nucleo = leer(join(PUBLIC, "js", "firebase-nucleo.js"));
  ok(nucleo.includes(`const SUPPORT_EMAIL = "${CONTACTO}";`), `SUPPORT_EMAIL es ${CONTACTO}`);

  const VIEJO = "soporte.memorie.legends@gmail.com";
  const conElViejo = [];
  const mailtos = [];
  const recorrer = (carpeta) => {
    for (const e of readdirSync(carpeta, { withFileTypes: true })) {
      const ruta = join(carpeta, e.name);
      if (e.isDirectory()) { recorrer(ruta); continue; }
      if (!/\.(html|js|css)$/.test(e.name)) continue;
      const texto = leer(ruta);
      if (texto.includes(VIEJO)) conElViejo.push(deRepo(ruta));
      for (const m of texto.matchAll(/mailto:([^"'?\s<]+)/g)) mailtos.push(`${deRepo(ruta)}: ${m[1]}`);
    }
  };
  recorrer(PUBLIC);

  // El viejo sigue existiendo, pero como CUENTA: es con la que entra la
  // administración, y cambiarlo sin cambiar antes la cuenta la deja afuera.
  ok(conElViejo.length === 1 && conElViejo[0] === "public/js/administracion.js",
     "el correo viejo sólo queda como la cuenta de administración", conElViejo);
  const ajenos = mailtos.filter((m) => !m.endsWith(`: ${CONTACTO}`));
  ok(mailtos.length > 0 && ajenos.length === 0, `todo mailto: va a ${CONTACTO}`, ajenos);

  for (const ruta of ["admin/admin.js", "js/dashboard.js"]) {
    const texto = leer(join(PUBLIC, ruta));
    ok(/import \{ CORREO_ADMINISTRACION \} from "\.\.?\/(js\/)?administracion\.js";/.test(texto)
       && /=== CORREO_ADMINISTRACION\.toLowerCase\(\)/.test(texto)
       && !/SUPPORT_EMAIL/.test(texto),
       `${ruta}: reconoce a la administración por su cuenta, no por el correo de contacto`);
  }

  // El navegador y las funciones tienen que hablar de la misma cuenta: si una
  // cambia y la otra no, el panel se abre y el servidor lo rechaza, o al revés.
  const indice = leer(join(REPO, "functions", "index.js"));
  const raiz = indice.match(/const CORREO_ADMIN = "([^"]+)";/)?.[1];
  ok(raiz === CORREO_ADMINISTRACION, "la cuenta del navegador es la raíz de las funciones",
     { navegador: CORREO_ADMINISTRACION, funciones: raiz });
}

console.log("\n=== 7. La dirección canónica, sin www ===");
{
  for (const pagina of PAGINAS) {
    const nombre = relative(PUBLIC, pagina).replaceAll("\\", "/");
    const texto = html[pagina];
    ok(!/www\.memorielegends\.com|http:\/\/(www\.)?memorielegends\.com/.test(texto),
       `${nombre}: ningún enlace con www ni con http://`);
    // La 404 es la de Firebase y el panel no se indexa: no llevan canónica.
    if (nombre === "404.html" || nombre.startsWith("admin/")) continue;

    const esperada = `${SITIO}/${nombre === "index.html" ? "" : nombre}`;
    const canonicas = etiquetas(texto, "link").filter((l) => l.rel === "canonical");
    ok(canonicas.length === 1 && canonicas[0].href === esperada,
       `${nombre}: una canónica, ${esperada}`, canonicas.map((c) => c.href));
    const ogUrl = etiquetas(texto, "meta").find((m) => m.property === "og:url")?.content;
    ok(ogUrl === esperada, `${nombre}: og:url dice lo mismo`, ogUrl);
  }
}

console.log("\n=== 8. Cada fuente con su licencia ===");
{
  const fuentes = readdirSync(join(PUBLIC, "fonts")).filter((f) => f.endsWith(".woff2"));
  ok(fuentes.length > 0, "hay fuentes servidas desde el sitio", fuentes);
  for (const f of fuentes) {
    const familia = f.split("-")[0];
    ok(existsSync(join(PUBLIC, "fonts", `OFL-${familia}.txt`)), `${f}: con su licencia OFL al lado`);
  }
}

// ────────────────────────────────────────────────────────────────────

console.log(fallos ? `\n❌ ${fallos} fallo(s)` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
