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
 *   8. Las tipografías salen del sitio, no de Google, y no se precargan.
 *   9. Cada fuente servida desde el sitio lleva su licencia al lado.
 *  10. La portada dice qué es el juego: título, descripción, <h1> y datos estructurados.
 *  11. El sitemap tiene las páginas públicas y el robots no se las prohíbe.
 *  12. Cada página tiene título, descripción, canónica y Open Graph, sin repetir.
 *  13. El logo de WhatsApp es el del kit de marca, sin tocar, y se usa como pide.
 *  14. El menú dice lo mismo, y en el mismo orden, en todas las páginas.
 *  15. El botón flotante de soporte está en el tablero, y en ningún otro lado.
 *  16. El botón de compartir el juego está en la portada, y con su mensaje.
 *  17. Donde se ve no dice «pozo», «apuesta» ni «cash-out».
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

  // Y todas dicen qué son. `alt=""` vale —la moneda de la barra es decorativa:
  // el nombre está escrito al lado—, pero tiene que estar puesto: sin el
  // atributo, un lector de pantalla lee el nombre del archivo.
  const sinAlt = [];
  for (const [pagina, texto] of Object.entries(html)) {
    for (const img of etiquetas(texto, "img")) {
      if (img.alt === undefined) sinAlt.push(`${deRepo(pagina)}: ${img.crudo.slice(0, 90)}`);
    }
  }
  ok(sinAlt.length === 0, "todas tienen alt", sinAlt);
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
    // La 404 pide no ser indexada —lo dice su <meta robots>— y el panel
    // tampoco se indexa: ninguna de las dos lleva canónica.
    if (nombre === "404.html" || nombre.startsWith("admin/")) continue;

    const esperada = `${SITIO}/${nombre === "index.html" ? "" : nombre}`;
    const canonicas = etiquetas(texto, "link").filter((l) => l.rel === "canonical");
    ok(canonicas.length === 1 && canonicas[0].href === esperada,
       `${nombre}: una canónica, ${esperada}`, canonicas.map((c) => c.href));
    const ogUrl = etiquetas(texto, "meta").find((m) => m.property === "og:url")?.content;
    ok(ogUrl === esperada, `${nombre}: og:url dice lo mismo`, ogUrl);
  }
}

console.log("\n=== 8. Las tipografías, desde el sitio y sin precarga ===");
{
  // Google Fonts eran dos servidores más antes de la primera letra: la hoja en
  // fonts.googleapis.com y los archivos en fonts.gstatic.com.
  // Sin los comentarios: los que cuentan por qué ya no se usa Google lo nombran.
  const GOOGLE = /fonts\.(googleapis|gstatic)\.com/;
  const conGoogle = [];
  for (const [pagina, texto] of Object.entries(html)) {
    if (GOOGLE.test(texto.replace(/<!--[\s\S]*?-->/g, ""))) conGoogle.push(deRepo(pagina));
  }
  for (const f of readdirSync(join(PUBLIC, "css")).filter((f) => f.endsWith(".css"))) {
    const hoja = leer(join(PUBLIC, "css", f)).replace(/\/\*[\s\S]*?\*\//g, "");
    if (GOOGLE.test(hoja)) conGoogle.push(`public/css/${f}`);
  }
  ok(conGoogle.length === 0, "ninguna página ni hoja le pide tipografías a Google", conGoogle);

  // Medido: precargar Cinzel llevó el FCP de 856 a 1928 ms y el LCP de 1680
  // a 1952. El comentario en `index.html` tiene los números.
  const conPrecarga = PAGINAS
    .filter((p) => etiquetas(html[p], "link").some((l) => l.rel === "preload" && l.as === "font"))
    .map(deRepo);
  ok(conPrecarga.length === 0, "ninguna página precarga tipografías", conPrecarga);

  const tema = leer(join(PUBLIC, "css", "tema.css")).replace(/\/\*[\s\S]*?\*\//g, "");
  const caras = [...tema.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]).filter((c) => /url\(/.test(c));
  const archivos = readdirSync(join(PUBLIC, "fonts")).filter((f) => f.endsWith(".woff2"));
  ok(archivos.every((f) => caras.some((c) => c.includes(`/fonts/${f}`))),
     "cada archivo de public/fonts/ está declarado en tema.css", archivos);
  ok(caras.length > 0 && caras.every((c) => /font-display:\s*swap/.test(c)),
     "y todos con font-display: swap: el texto sale con el respaldo mientras baja");
  const inter = caras.find((c) => /font-family:\s*"Inter"/.test(c));
  ok(/font-weight:\s*100 900/.test(inter ?? ""),
     "Inter declara todos sus pesos: es un solo archivo variable");
}

console.log("\n=== 9. Cada fuente con su licencia ===");
{
  const fuentes = readdirSync(join(PUBLIC, "fonts")).filter((f) => f.endsWith(".woff2"));
  ok(fuentes.length > 0, "hay fuentes servidas desde el sitio", fuentes);
  for (const f of fuentes) {
    const familia = f.split("-")[0];
    ok(existsSync(join(PUBLIC, "fonts", `OFL-${familia}.txt`)), `${f}: con su licencia OFL al lado`);
  }
}

console.log("\n=== 10. Lo que lee un buscador en la portada ===");
{
  const indice = html[join(PUBLIC, "index.html")];
  const DESCRIPCION =
    "Memorie Legends: juego de cartas online con baraja española legendaria. Memoria, habilidad y estrategia contra la IA o con amigos. Registrate gratis y jugá.";

  ok(indice.includes("<title>Memorie Legends — Juego de cartas online con baraja española legendaria</title>"),
     "el título");
  const descripciones = [
    etiquetas(indice, "meta").find((m) => m.name === "description")?.content,
    etiquetas(indice, "meta").find((m) => m.property === "og:description")?.content,
    etiquetas(indice, "meta").find((m) => m.name === "twitter:description")?.content,
  ];
  ok(descripciones.every((d) => d === DESCRIPCION),
     "la descripción, la misma para buscadores, Open Graph y Twitter", descripciones);

  // Sin los comentarios: el que explica el cambio nombra el <h1>.
  const h1 = [...indice.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)];
  ok(h1.length === 1, "un solo <h1>", h1.length);
  ok(h1[0]?.[1].trim() === "Memoria, habilidad y estrategia con baraja española legendaria",
     "y es el lema, en texto", h1[0]?.[1]);
  const logo = etiquetas(indice, "img").find((i) => /portada-logo/.test(i.class ?? ""));
  ok(logo?.alt === "Memorie Legends", "el escudo dice el nombre del juego", logo?.alt);

  // Los datos estructurados: JSON válido, y que no digan otra cosa que la página.
  const bloque = indice.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  let datos = null;
  try { datos = JSON.parse(bloque); } catch {}
  ok(datos !== null, "los datos estructurados son JSON válido");
  const de = (tipo) => datos?.["@graph"]?.find((n) => n["@type"] === tipo);
  const sitio = de("WebSite");
  const juego = de("VideoGame");
  ok(datos?.["@context"] === "https://schema.org", "con el vocabulario de schema.org");
  ok(sitio?.name === "Memorie Legends" && sitio?.url === `${SITIO}/` && sitio?.inLanguage === "es-AR"
     && sitio?.description === DESCRIPCION, "el sitio: nombre, dirección, idioma y descripción", sitio);
  ok(juego?.name === "Memorie Legends" && juego?.url === `${SITIO}/` && juego?.inLanguage === "es-AR"
     && juego?.description === DESCRIPCION && juego?.gamePlatform === "Web Browser"
     && juego?.applicationCategory === "Game"
     && ["Memory", "Strategy", "Card Game"].every((g) => juego?.genre?.includes(g)),
     "el juego: nombre, plataforma, categoría, géneros, idioma y descripción", juego);
  ok(existsSync(join(PUBLIC, (juego?.image ?? "").replace(`${SITIO}/`, ""))),
     "y su imagen existe", juego?.image);
}

console.log("\n=== 11. El sitemap y el robots ===");
{
  // Las que piden sesión: un buscador que llega termina en la pantalla de
  // ingreso. La 404 y el panel, tampoco.
  const PRIVADAS = ["dashboard.html", "cuenta.html", "room.html", "lobby.html", "mesa.html",
                    "ranking.html", "tienda.html", "404.html", "admin/index.html"];
  const canonicaDe = (p) => etiquetas(html[p], "link").find((l) => l.rel === "canonical")?.href;
  const publicas = PAGINAS.filter((p) => !PRIVADAS.includes(relative(PUBLIC, p).replaceAll("\\", "/")));

  const mapa = leer(join(PUBLIC, "sitemap.xml"));
  const urls = [...mapa.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
  const locs = urls.map((u) => u.match(/<loc>([^<]+)<\/loc>/)?.[1]);
  ok(mapa.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'), "el sitemap declara su formato");
  ok(urls.every((u) => /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(u) && /<changefreq>\w+<\/changefreq>/.test(u)
     && /<priority>(0\.\d|1\.0)<\/priority>/.test(u)), "cada dirección con lastmod, changefreq y priority");

  const esperadas = publicas.map(canonicaDe).sort();
  ok(JSON.stringify([...locs].sort()) === JSON.stringify(esperadas),
     "están todas las páginas públicas, con su canónica, y ninguna otra", { sitemap: locs, publicas: esperadas });

  // Que ninguna página del sitemap pida sesión: la lista de arriba se podría
  // quedar vieja el día que una página nueva la pida.
  const conSesion = publicas.filter((p) =>
    etiquetas(html[p], "script").some((s) => {
      if (!s.src || !esLocal(s.src)) return false;
      const archivo = enDisco(s.src, p);
      return existsSync(archivo) && /await exigirSesion\(/.test(leer(archivo));
    }),
  ).map(deRepo);
  ok(conSesion.length === 0, "ninguna página del sitemap pide sesión", conSesion);

  const robots = leer(join(PUBLIC, "robots.txt")).split(/\r?\n/).map((l) => l.trim());
  for (const linea of ["User-agent: *", "Allow: /", "Disallow: /admin/", "Disallow: /dashboard.html",
                       "Disallow: /cuenta.html", "Sitemap: https://memorielegends.com/sitemap.xml"]) {
    ok(robots.includes(linea), `robots.txt: ${linea}`);
  }
  const prohibidas = robots.filter((l) => l.startsWith("Disallow:")).map((l) => l.slice(9).trim());
  const bloqueadas = locs.filter((u) => prohibidas.some((d) => new URL(u).pathname.startsWith(d)));
  ok(bloqueadas.length === 0, "y no le prohíbe a nadie una página del sitemap", bloqueadas);
}

console.log("\n=== 12. Cada página con sus metadatos ===");
{
  const titulos = new Map();
  const descripciones = new Map();
  for (const pagina of PAGINAS) {
    const nombre = relative(PUBLIC, pagina).replaceAll("\\", "/");
    // La 404 no se indexa, y el panel tampoco: no necesitan Open Graph.
    if (nombre === "404.html" || nombre.startsWith("admin/")) continue;
    const texto = html[pagina];
    const meta = etiquetas(texto, "meta");
    const titulo = texto.match(/<title>([^<]*)<\/title>/)?.[1];
    const descripcion = meta.find((m) => m.name === "description")?.content;
    const faltan = [
      !titulo && "title",
      !descripcion && "description",
      !etiquetas(texto, "link").some((l) => l.rel === "canonical") && "canonical",
      !meta.some((m) => m.property === "og:title" && m.content) && "og:title",
      !meta.some((m) => m.property === "og:description" && m.content) && "og:description",
      !meta.some((m) => m.property === "og:image" && m.content) && "og:image",
    ].filter(Boolean);
    ok(faltan.length === 0, `${nombre}: título, descripción, canónica y Open Graph`, faltan);
    titulos.set(titulo, [...(titulos.get(titulo) ?? []), nombre]);
    descripciones.set(descripcion, [...(descripciones.get(descripcion) ?? []), nombre]);
  }
  const repetidos = (m) => [...m.entries()].filter(([, ps]) => ps.length > 1);
  ok(repetidos(titulos).length === 0, "ningún título repetido", repetidos(titulos));
  ok(repetidos(descripciones).length === 0, "ninguna descripción repetida", repetidos(descripciones));
}

console.log("\n=== 13. El logo de WhatsApp, tal cual lo entrega su kit de marca ===");
{
  // `Digital_Glyph_Green_RGB_2026.svg`, del paquete oficial del centro de marca
  // de Meta (whatsappbrand.com), bajado el 21/9/2026. Las normas del kit no
  // dejan modificarlo —ni el dibujo ni el color— ni usar otro. La huella lo
  // ata byte por byte: si alguien lo retoca, esto falla.
  //
  // Son dos, y cada uno tiene su lugar: el verde sobre los fondos oscuros del
  // sitio, y el blanco sobre el verde de la marca —el botón flotante del
  // tablero—. Usar el verde sobre verde sería no verlo, y pintar el blanco de
  // otro color sería modificarlo.
  const KIT = {
    "Digital_Glyph_Green_RGB_2026.svg": "f7b1311db718533e671645f57cd94b92f0e006e61d7e6581a80675fc5a478fc4",
    "Digital_Glyph_White_RGB_2026.svg": "7fb054c0f4bea644b4a4a014d6d8581aad7e6dcb639049d17a578dc44f8e6fd4",
  };
  const { createHash } = await import("node:crypto");
  for (const [archivo, esperada] of Object.entries(KIT)) {
    const ruta = join(PUBLIC, "img", "whatsapp", archivo);
    const huella = existsSync(ruta) ? createHash("sha256").update(readFileSync(ruta)).digest("hex") : null;
    ok(huella === esperada, `${archivo}: es el del kit, sin tocar`, huella);
  }

  // Donde se use: chico, con `alt` vacío y con la palabra al lado. Las normas
  // piden no usar el logo en lugar de la palabra «WhatsApp».
  //
  // El tope son 28 px, que es lo que mide el glifo blanco dentro de la placa
  // verde del cartel: ahí el botón es grande y un logo de 20 se perdía. En el
  // menú y en el botón flotante sigue midiendo 20 y 22.
  // En las páginas y en los módulos que dibujan HTML: el cartel del código
  // privado lo arma `js/sala-privada.js`.
  const fuentes = [
    ...Object.entries(html),
    ...readdirSync(join(PUBLIC, "js"))
      .filter((f) => f.endsWith(".js"))
      .map((f) => [join(PUBLIC, "js", f), leer(join(PUBLIC, "js", f))]),
  ];
  const usos = [];
  for (const [pagina, texto] of fuentes) {
    for (const m of texto.matchAll(/<a\b[^>]*>(?:(?!<\/a>)[\s\S])*?img\/whatsapp\/[\s\S]*?<\/a>/g)) {
      usos.push({ pagina: deRepo(pagina), bloque: m[0] });
    }
  }
  ok(usos.length > 0, "se usa en el sitio", usos.map((u) => u.pagina));
  for (const { pagina, bloque } of usos) {
    const img = etiquetas(bloque, "img").find((i) => /img\/whatsapp\//.test(i.src ?? ""));
    const texto = bloque.replace(/<[^>]+>/g, " ");
    ok(img?.alt === "" && Number(img?.width) <= 28 && Number(img?.height) <= 28,
       `${pagina}: el logo va chico y con alt vacío`, img?.crudo);
    ok(/\bWhatsApp\b/.test(texto), `${pagina}: con la palabra «WhatsApp» al lado, bien escrita`);
  }
}


console.log("\n=== 14. El mismo menú, y en el mismo orden, en todas las páginas ===");
{
  // El orden canónico. Ninguna página los lleva todos —la sala de espera y las
  // legales llevan menos—, pero la que lleva dos los lleva en este orden. Si
  // una los ordena distinto, quien viaja entre páginas pierde el lugar donde
  // estaba el enlace que busca, y eso se siente más que un color cambiado.
  const ORDEN = ["Inicio", "Lobby", "Jugar", "Cómo se juega", "Ranking", "Tienda",
                 "Tu cuenta", "Soporte WhatsApp", "Administración"];
  // El número de soporte: UNO solo y el mismo en todas. Escrito catorce veces
  // a mano, un dígito cambiado en una sola página manda a un desconocido.
  const SOPORTE = "https://wa.me/59891900968";

  // La portada no lleva menú: su cajón tiene los dos botones de entrar y de
  // registrarse, y nada más. La mesa tampoco, porque adentro de una partida no
  // hay a dónde ir. El panel de administración es otra cosa.
  const conMenu = PAGINAS.filter((p) => /<nav\b/.test(html[p]) && !/admin/.test(p));
  ok(conMenu.length === 14, "las páginas con menú son catorce", conMenu.map(deRepo));

  for (const pagina of conMenu) {
    const nombre = relative(PUBLIC, pagina).replaceAll("\\", "/");
    const nav = html[pagina].match(/<nav\b[^>]*>[\s\S]*?<\/nav>/)[0];
    const enlaces = [...nav.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
      crudo: m[0],
      href: m[0].match(/href="([^"]*)"/)?.[1],
      texto: m[1].replace(/<[^>]*>/g, "").trim(),
      actual: /aria-current="page"/.test(m[0]),
    }));
    const textos = enlaces.map((e) => e.texto);

    // Subsecuencia del orden canónico: sin entradas desconocidas y sin vueltas
    // hacia atrás.
    const lugares = textos.map((x) => ORDEN.indexOf(x));
    ok(lugares.every((i) => i >= 0) && lugares.every((v, i) => i === 0 || v > lugares[i - 1]),
       `${nombre}: las entradas, en el orden de siempre`, textos);

    const lobby = enlaces.find((e) => e.texto === "Lobby");
    ok(/^\/?lobby\.html$/.test(lobby?.href ?? ""), `${nombre}: con «Lobby», y lleva al lobby`, lobby?.href);

    // «Jugar» significa una sola cosa: el tablero. Nunca la pantalla de
    // ingreso, que no es jugar sino entrar.
    const jugar = enlaces.find((e) => e.texto === "Jugar");
    ok(!jugar || /^(#jugar|\/?dashboard\.html#jugar)$/.test(jugar.href ?? ""),
       `${nombre}: «Jugar» va al tablero`, jugar?.href);
    ok(!/href="[^"]*login\.html"/.test(nav), `${nombre}: ninguna entrada manda a la pantalla de ingreso`);

    // Y vive DENTRO del menú, que es lo que el cajón se lleva. Suelto en la
    // barra quedaría a la vista en todas las páginas, que es justo lo que no
    // se quiere: el número no es un botón de la cabecera.
    const enLaPagina = (html[pagina].match(/class="enlace-soporte"/g) ?? []).length;
    const enElMenu = (nav.match(/class="enlace-soporte"/g) ?? []).length;
    ok(enLaPagina === 1 && enElMenu === 1,
       `${nombre}: un solo soporte, y dentro del menú`, { enLaPagina, enElMenu });

    const soporte = enlaces.find((e) => e.texto === "Soporte WhatsApp");
    ok(soporte?.href === SOPORTE, `${nombre}: con «Soporte WhatsApp», al número del sitio`, soporte?.href);
    // Sale del sitio: pestaña nueva, y `noopener` para que la página que se
    // abre no pueda tocar la nuestra desde `window.opener`.
    ok(/target="_blank"/.test(soporte?.crudo ?? "") && /rel="noopener/.test(soporte?.crudo ?? ""),
       `${nombre}: el soporte abre aparte, con noopener`, soporte?.crudo);

    // La página donde uno está se marca, y se marca una sola vez.
    const propia = (href) => {
      if (!href || /^https?:/.test(href)) return false;
      const limpia = href.split("#")[0];
      if (limpia === "") return true;
      const destino = limpia === "/" ? join(PUBLIC, "index.html") : enDisco(limpia, pagina);
      return resolve(destino) === resolve(pagina);
    };
    const propias = enlaces.filter((e) => propia(e.href));
    const marcadas = enlaces.filter((e) => e.actual);
    ok(marcadas.length === (propias.length ? 1 : 0) && marcadas.every((e) => propia(e.href)),
       `${nombre}: la página donde uno está, marcada una sola vez`, marcadas.map((e) => e.texto));
  }

  // Las legales llevan el mismo menú que una página pública cualquiera: desde
  // el Paso 1 tienen la misma barra con cajón que el resto del sitio, y el
  // soporte por WhatsApp vive DENTRO del cajón, nunca a la vista en la barra.
  const entradasDe = (pagina) => {
    const nav = html[pagina].match(/<nav[^>]*>[\s\S]*?<\/nav>/)[0];
    return [...nav.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1].replace(/<[^>]*>/g, "").trim());
  };
  const referencia = entradasDe(join(PUBLIC, "como-se-juega.html"));
  for (const nombre of ["terminos.html", "privacidad.html", "seguridad.html",
                        "quienes-somos.html", "reglamento-torneos.html"]) {
    const pagina = join(PUBLIC, nombre);
    ok(JSON.stringify(entradasDe(pagina)) === JSON.stringify(referencia),
       `${nombre}: el mismo menú que el resto del sitio`, entradasDe(pagina));
    // La barra con cajón: el mismo armado y el mismo módulo que las demás.
    ok(/<header class="barra">/.test(html[pagina]) && /<div class="barra-contenido">/.test(html[pagina]),
       `${nombre}: con la barra del sitio`);
    ok(/<script type="module" src="\/js\/menu\.js"><\/script>/.test(html[pagina]),
       `${nombre}: y con el cajón, que es donde va el soporte`);
    ok(!/header-content/.test(html[pagina]), `${nombre}: sin rastros de la cabecera vieja`);
  }
  // La hoja de las legales ya no dibuja ninguna cabecera: si volviera a
  // hacerlo, volvería la fila de enlaces a la vista.
  const legal = leer(join(PUBLIC, "css", "legal.css"));
  ok(!/header-content|^header\s*\{/m.test(legal.replace(/\/\*[\s\S]*?\*\//g, "")),
     "legal.css no define ninguna cabecera");

  // La 404 la sirve Firebase para CUALQUIER dirección que no existe, incluso
  // una con carpetas inventadas. Una sola dirección relativa —una hoja, el
  // logo, un enlace— se buscaría dentro de esa carpeta que no existe, y la
  // página saldría desnuda o el enlace no llevaría a ninguna parte.
  const cuatro = html[join(PUBLIC, "404.html")];
  const relativas = [...cuatro.matchAll(/(?:href|src)="([^"]*)"/g)]
    .map((m) => m[1])
    .filter((d) => !/^(https?:|\/|#|data:|mailto:)/.test(d));
  ok(relativas.length === 0, "404.html: todas sus direcciones salen de la raíz", relativas);
  ok(/Esta carta no está en el mazo/.test(cuatro), "404.html: lo dice en criollo");
  ok(/name="robots" content="noindex"/.test(cuatro), "404.html: y pide no ser indexada");
  const salidas = [...cuatro.matchAll(/<a class="accion[^"]*" href="([^"]*)"/g)].map((m) => m[1]);
  ok(salidas.includes("/dashboard.html") && salidas.includes("/lobby.html"),
     "404.html: con sus dos salidas, al inicio y al lobby", salidas);
}


console.log("\n=== 15. El soporte que flota: en el tablero, y en ningún otro lado ===");
{
  // La píldora verde de WhatsApp está sólo en el tablero. En el resto del
  // sitio el soporte vive dentro del cajón del menú (§14), que se abre cuando
  // uno quiere: un botón fijo en cada página sería el número a la vista en
  // todas, y tapando contenido en todas.
  const SOPORTE = "https://wa.me/59891900968";
  const conBoton = PAGINAS.filter((p) => /class="boton-soporte"/.test(html[p])).map(deRepo);
  ok(JSON.stringify(conBoton) === JSON.stringify(["public/dashboard.html"]),
     "el botón flotante existe, y sólo en el tablero", conBoton);

  const tablero = html[join(PUBLIC, "dashboard.html")];
  const boton = tablero.match(/<a\b[^>]*class="boton-soporte"[\s\S]*?<\/a>/)?.[0] ?? "";
  ok((tablero.match(/class="boton-soporte"/g) ?? []).length === 1,
     "dashboard.html: uno solo");
  ok(/href="https:\/\/wa\.me\/59891900968"/.test(boton),
     "dashboard.html: al número del sitio", boton.match(/href="[^"]*"/)?.[0]);
  ok(/target="_blank"/.test(boton) && /rel="noopener/.test(boton),
     "dashboard.html: abre aparte, con noopener");

  // El glifo BLANCO, que es el que corresponde sobre el verde de la marca.
  const glifo = etiquetas(boton, "img")[0];
  ok(/img\/whatsapp\/Digital_Glyph_White_RGB_2026\.svg$/.test(glifo?.src ?? ""),
     "dashboard.html: con el glifo blanco del kit", glifo?.src);
  // El resto de lo que piden sus normas —tamaño, `alt` vacío y la palabra al
  // lado— lo comprueba §13, que recorre todos los usos del logo.

  // Va al final del cuerpo: flota, pero con teclado es lo último de la página
  // y no se cruza en el medio del contenido.
  const despues = tablero.slice(tablero.indexOf('class="boton-soporte"'));
  ok(!/<main\b|<footer\b/.test(despues),
     "dashboard.html: va al final del cuerpo, después del pie");

  // Y sus estilos, en la hoja del tablero: fijo, en el verde de la marca, y
  // por debajo del velo del cajón (80), para que el menú abierto lo tape.
  const hoja = leer(join(PUBLIC, "css", "tablero.css"));
  const reglas = hoja.replace(/\/\*[\s\S]*?\*\//g, "").match(/\.boton-soporte\s*\{([^}]*)\}/)?.[1] ?? "";
  ok(/position:\s*fixed/.test(reglas), "tablero.css: el botón es fijo");
  ok(/background:\s*#25d366/.test(reglas), "tablero.css: en el verde oficial");
  const capa = Number(reglas.match(/z-index:\s*(\d+)/)?.[1]);
  ok(capa > 0 && capa < 80, "tablero.css: por debajo del velo del cajón", capa);
  ok(/env\(safe-area-inset-bottom/.test(reglas) && /env\(safe-area-inset-right/.test(reglas),
     "tablero.css: respeta el borde seguro del teléfono");

  // El aire de abajo va SÓLO donde está el botón. `cuenta.html` carga la misma
  // hoja y no lo tiene: sin el `:has()`, su pie quedaría con setenta y pico de
  // píxeles de vacío que no tapa nada.
  const aire = hoja.match(/@media \(max-width: 700px\) \{\s*([^{]*)\{[^}]*padding-bottom[^}]*\}/);
  ok(/body:has\(\.boton-soporte\)\s+footer/.test(aire?.[1] ?? ""),
     "tablero.css: el aire del pie, sólo en la página que tiene el botón", aire?.[1]?.trim());
}


console.log("\n=== 16. Compartir el juego, desde la portada y sólo desde ahí ===");
{
  // El tercero de los tres lugares de WhatsApp: el cartel del código, el
  // soporte del tablero y éste. Va en la portada porque es la página que ve
  // quien todavía no juega, y es la que se comparte.
  const MENSAJE =
    "Te paso Memorie Legends: memoria, habilidad y estrategia con baraja española legendaria. " +
    "Jugá contra la IA o desafiá a tus amigos. https://memorielegends.com";

  const conBoton = PAGINAS.filter((p) => /class="boton-compartir-juego"/.test(html[p])).map(deRepo);
  ok(JSON.stringify(conBoton) === JSON.stringify(["public/index.html"]),
     "el botón de compartir el juego existe, y sólo en la portada", conBoton);

  const portada = html[join(PUBLIC, "index.html")];
  const boton = portada.match(/<a\b[^>]*class="boton-compartir-juego"[\s\S]*?<\/a>/)?.[0] ?? "";

  // El mensaje, tal cual. Se compara decodificado: escrito a mano en la
  // dirección, un acento mal puesto no se ve hasta que alguien lo recibe.
  const texto = decodeURIComponent((boton.match(/href="https:\/\/wa\.me\/\?text=([^"]*)"/)?.[1] ?? "").replace(/\+/g, " "));
  ok(texto === MENSAJE, "con el mensaje acordado, palabra por palabra", texto);

  // Sin número: WhatsApp abre su selector y elige quien comparte.
  ok(/href="https:\/\/wa\.me\/\?text=/.test(boton), "sin destinatario: lo elige quien comparte");
  ok(/target="_blank"/.test(boton) && /rel="noopener/.test(boton),
     "abre aparte, con noopener");

  // El glifo VERDE, que es el que corresponde sobre el fondo oscuro de la
  // portada, y pedido tarde: está al final de la página y no tiene por qué
  // competir con el escudo, que es lo que mide el LCP.
  const glifo = etiquetas(boton, "img")[0];
  ok(/img\/whatsapp\/Digital_Glyph_Green_RGB_2026\.svg$/.test(glifo?.src ?? ""),
     "con el glifo verde del kit", glifo?.src);
  ok(glifo?.loading === "lazy" && glifo?.fetchpriority === "low",
     "el glifo se pide tarde y con prioridad baja", glifo?.crudo);

  // Lo demás que piden sus normas —`alt` vacío, tamaño y la palabra al lado—
  // lo comprueba §13, que recorre todos los usos del logo.
}


console.log("\n=== 17. El vocabulario: ni pozo ni apuesta donde se ve ===");
{
  // ─────────────────────────────────────────────────────────────────────
  // QUÉ SE BUSCA
  // ─────────────────────────────────────────────────────────────────────
  //
  // «Pozo», «apuesta», «apostar» y «cash-out» son palabras de casa de
  // apuestas. Acá no se apuesta: se paga una entrada en Leyendas, que no se
  // convierten en dinero. Que el sitio hable como lo que es no es cosmética:
  // es lo primero que mira quien tenga que opinar si esto es un juego de azar.
  //
  // NO se busca «retirar» ni «retiro». Son palabras legítimas y de otra
  // familia: se retira una carta, se retira un dato personal —la Ley 18.331
  // usa ese verbo—, se retira una promoción y alguien se retira de la partida.
  // Buscarlas daría ruido en cada barrido y enseñaría a ignorar esta prueba.
  const PROHIBIDAS = /\b(pozos?|apuestas?|apostar|cash\s*-?\s*out|cashout)\b/i;

  // ─────────────────────────────────────────────────────────────────────
  // DÓNDE SE BUSCA: SÓLO LO QUE SE VE
  // ─────────────────────────────────────────────────────────────────────
  //
  // Los nombres del código NO cuentan. El campo de Firestore se llama `pozo` y
  // se va a seguir llamando así —renombrarlo es una migración sobre datos de
  // gente jugando, sin nada que ganar—, y lo mismo `apuestaRevancha`. Nadie
  // los ve.
  //
  // En JAVASCRIPT eso obliga a mirar al revés: no alcanza con sacar los
  // comentarios, porque `const pozo = entrada * 4` es código y no texto. Se
  // miran SÓLO las cadenas —lo que va entre comillas—, y dentro de ellas se
  // sacan las interpolaciones: en `Leyendas inválidas: ${pozo}` el jugador ve
  // un número, no la palabra.
  const soloCadenas = (js) => {
    const sinComentarios = js
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " ");
    const cadenas = sinComentarios.match(/`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g) ?? [];
    return cadenas
      .join("\n")
      // Las interpolaciones, incluso anidadas un nivel: `${a ? `${b}` : c}`.
      .replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, " ")
      // Y los atributos que son nombres: muchas de esas cadenas son HTML, y
      // adentro viven `class="apuesta-revancha"` e `id="apuestaRevancha"`,
      // que no los ve nadie.
      .replace(/\b(id|class|for|name|aria-controls|aria-labelledby|data-[a-z-]+)="[^"]*"/gi, " ");
  };

  // En HTML se mira el texto y los atributos que SE LEEN —`content`, `alt`,
  // `aria-label`, `placeholder`, `title`—, y se sacan los que son nombres:
  // un `id="apuestaRevancha"` no lo ve nadie. También se sacan los
  // comentarios, el CSS incrustado y el JSON de los datos estructurados no,
  // que eso sí lo lee un buscador.
  const soloVisible = (html) =>
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/\b(id|class|for|name|aria-controls|aria-labelledby|data-[a-z-]+)="[^"]*"/gi, " ");

  // ─────────────────────────────────────────────────────────────────────
  // LAS EXCEPCIONES, UNA POR UNA Y CON SU MOTIVO
  // ─────────────────────────────────────────────────────────────────────
  //
  // En las cuatro, la palabra está para NEGAR lo que nombra: sacarla
  // debilitaría la declaración, que es lo contrario de lo que esto defiende.
  const EXCEPCIONES = {
    // «No pueden retirarse mediante mecanismos de cash-out» y «tampoco pueden
    // convertirse en dinero ni ser objeto de cash-out».
    "terminos.html": [
      "mecanismos de <em>cash-out</em>",
      "objeto de <em>cash-out</em>",
    ],
    // «No son juegos de azar ni apuestas» y «No hay cash-out: las Leyendas no
    // se convierten en dinero real».
    "reglamento-torneos.html": [
      "No son juegos de azar ni apuestas",
      "No hay <em>cash-out</em>",
    ],
  };

  // El panel de administración no lo ve ningún jugador: es de la
  // administración, que sí habla de pozos de torneo y de retirar artículos de
  // la venta.
  const paginas = PAGINAS.filter((p) => !/admin/.test(p));
  const modulos = readdirSync(join(PUBLIC, "js"))
    .filter((f) => f.endsWith(".js"))
    .map((f) => join(PUBLIC, "js", f));

  const sueltas = [];
  for (const archivo of [...paginas, ...modulos]) {
    const nombre = relative(PUBLIC, archivo).replaceAll("\\", "/");
    const permitidas = EXCEPCIONES[basename(archivo)] ?? [];
    const crudo = leer(archivo);
    const texto = archivo.endsWith(".html") ? soloVisible(crudo) : soloCadenas(crudo);
    for (const linea of texto.split(/\r?\n/)) {
      if (!PROHIBIDAS.test(linea)) continue;
      if (permitidas.some((p) => linea.includes(p))) continue;
      sueltas.push(`${nombre}: ${linea.trim().slice(0, 90)}`);
    }
  }
  ok(sueltas.length === 0, "ninguna palabra de casa de apuestas en lo que se ve", sueltas);

  // Y que las excepciones sigan estando: si alguien borra la declaración de
  // que esto NO son apuestas, se pierde lo que más conviene que esté escrito.
  for (const [archivo, frases] of Object.entries(EXCEPCIONES)) {
    const texto = leer(join(PUBLIC, archivo));
    for (const frase of frases) {
      ok(texto.includes(frase), `${archivo}: sigue diciendo «${frase.replace(/<[^>]+>/g, "")}»`);
    }
  }
}

// ────────────────────────────────────────────────────────────────────

console.log(fallos ? `\n❌ ${fallos} fallo(s)` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
