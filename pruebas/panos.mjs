/**
 * Los paños de mesa: el cuarto tipo del catálogo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE DEFIENDE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Agregar un tipo al catálogo salió barato porque el sistema estaba escrito
 * para eso: `CAMPO_EQUIPADO` es un mapa, `TIPOS_VENDIBLES` una lista, y ni
 * `comprarItem` ni `equiparItem` ni `misItems` tienen un solo `if` por tipo.
 *
 * Lo que sí hay que vigilar son los lugares donde alguien VOLVIÓ a escribir la
 * lista de tipos a mano. Había uno —`EsquemaTipo`, en el servidor— y quedó
 * mintiendo en cuanto apareció el cuarto: el panel ofrecía «fondo» en su
 * desplegable, que se arma solo desde `TIPOS_VALIDOS`, y el servidor rechazaba
 * la consulta. Ahora sale de la misma constante, y esta suite lo comprueba.
 *
 * Y se vigila el arte: cuatro artículos que apunten a archivos que no están se
 * ven como una mesa sin paño, sin ningún error de por medio.
 */

import { readFileSync, existsSync } from "node:fs";
import {
  TIPOS,
  TIPOS_VALIDOS,
  TIPOS_VENDIBLES,
  CAMPO_EQUIPADO,
  CATALOGO_INICIAL,
  itemsDeTipo,
  gratuitos,
  esVendible,
  esRutaDelSitio,
  problemasDelItem,
} from "../public/js/reglas/catalogo.js";
import { EsquemaTipo } from "../functions/esquemas.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

const RAIZ = new URL("..", import.meta.url);
const PANOS = itemsDeTipo(CATALOGO_INICIAL, TIPOS.FONDO);

// =====================================================================

console.log("\n=== El tipo existe y se puede comprar ===");
ok(TIPOS.FONDO === "fondo", "TIPOS.FONDO", TIPOS.FONDO);
ok(TIPOS_VALIDOS.includes("fondo"), "está entre los tipos válidos");
ok(esVendible(TIPOS.FONDO), "se vende con Leyendas");
ok(CAMPO_EQUIPADO[TIPOS.FONDO] === "fondo", "y se guarda en el campo `fondo` del perfil");

// Las insignias siguen sin venderse: agregar un tipo no puede haber aflojado
// la regla que las protege.
ok(!esVendible(TIPOS.INSIGNIA), "las insignias siguen sin venderse");

console.log("\n=== El campo del perfil nace cerrado al navegador ===");
{
  // La regla de Firestore es una LISTA BLANCA. Mientras siga siéndolo, un
  // campo nuevo está prohibido sin tocar nada. Si alguien la diera vuelta y la
  // escribiera como lista de campos negados, `fondo` quedaría abierto y
  // equiparse un paño sin comprarlo serían dos líneas en la consola.
  const reglas = readFileSync(new URL("firestore.rules", RAIZ), "utf8");
  const permitidos = reglas.match(/affectedKeys\(\)\s*\.hasOnly\(\[([^\]]*)\]\)/);

  ok(Boolean(permitidos), "la regla del perfil sigue siendo una lista blanca");
  if (permitidos) {
    const lista = permitidos[1];
    for (const campo of Object.values(CAMPO_EQUIPADO)) {
      ok(!lista.includes(`'${campo}'`), `el navegador no puede escribir \`${campo}\``, lista);
    }
  }
}

console.log("\n=== El esquema del servidor no repite la lista a mano ===");
ok(EsquemaTipo.safeParse({ tipo: "fondo" }).success, "acepta el tipo nuevo");
for (const tipo of TIPOS_VALIDOS) {
  ok(EsquemaTipo.safeParse({ tipo }).success, `acepta \`${tipo}\``);
}
ok(!EsquemaTipo.safeParse({ tipo: "sombrero" }).success, "y sigue rechazando lo que no existe");

{
  // Lo que de verdad se defiende: que salga de la constante y no de una copia.
  const fuente = readFileSync(new URL("functions/esquemas.js", RAIZ), "utf8");
  ok(
    /EsquemaTipo[\s\S]{0,120}z\.enum\(TIPOS_VALIDOS\)/.test(fuente),
    "el esquema deriva de TIPOS_VALIDOS en vez de listar los tipos",
  );
}

console.log("\n=== Los cuatro paños ===");
ok(PANOS.length === 4, "hay cuatro en la semilla", PANOS.length);
ok(
  PANOS.every((p) => problemasDelItem(p).length === 0),
  "todos son artículos bien formados",
  PANOS.flatMap((p) => problemasDelItem(p)),
);

const libres = PANOS.filter((p) => p.precio === 0);
ok(libres.length === 1, "uno solo es gratis", libres.map((p) => p.id));
ok(libres[0]?.id === "pano_piedra", "y es el que la mesa ya usa sin comprar nada", libres[0]?.id);
ok(
  gratuitos().some((g) => g.id === "pano_piedra"),
  "así que le toca a toda cuenta nueva, como los dorsos",
);

const pagos = PANOS.filter((p) => p.precio > 0).map((p) => p.precio);
ok(
  pagos.every((p) => p >= 200 && p <= 400),
  "los otros tres cuestan entre 200 y 400",
  pagos,
);
ok(new Set(pagos).size === pagos.length, "y no hay dos al mismo precio", pagos);

console.log("\n=== El arte existe y no sale del sitio ===");
for (const pano of PANOS) {
  const ruta = new URL(`public${pano.imagen}`, RAIZ);
  ok(esRutaDelSitio(pano.imagen), `${pano.id}: la ruta es de este sitio`, pano.imagen);
  ok(existsSync(ruta), `${pano.id}: el archivo está`, pano.imagen);
}

{
  // Un paño se estira al óvalo de la mesa, que no tiene la proporción del
  // dibujo. Sin `preserveAspectRatio="none"` el SVG se centra y deja franjas.
  const sinEstirar = PANOS.filter((p) => {
    const svg = readFileSync(new URL(`public${p.imagen}`, RAIZ), "utf8");
    return !svg.includes('preserveAspectRatio="none"');
  });
  ok(sinEstirar.length === 0, "los cuatro se estiran al óvalo", sinEstirar.map((p) => p.id));
}

console.log("\n=== La tienda, el inventario y la mesa lo conocen ===");
{
  const lee = (ruta) => readFileSync(new URL(ruta, RAIZ), "utf8");

  ok(
    lee("public/js/personalizacion.js").includes("TIPOS.FONDO"),
    "la tienda tiene su categoría",
  );
  ok(
    lee("public/js/inventario.js").includes("TIPOS.FONDO"),
    "el inventario tiene su grupo, así que se puede desequipar",
  );

  // Lo importante de la mesa: que el paño entre por una VARIABLE de CSS y que
  // la ruta se vuelva a mirar antes, porque termina dentro de un `url()`.
  const mesa = lee("public/js/mesa.js");
  ok(mesa.includes('setProperty(\n      "--pano"') || /setProperty\(\s*"--pano"/.test(mesa),
     "la mesa aplica el paño con --pano");

  /**
   * El filtro estricto se aplica a las CUATRO cosas equipadas, no sólo al paño.
   *
   * `equipadoEnMesa` valida con `imagenEsArchivo`, que acepta `http`: es la
   * regla de la tienda, donde está bien. En la mesa cada una de las cuatro
   * termina en un `src` o en un `url()`, y una ruta de otro dominio hace que
   * el navegador le pida la imagen a ese servidor cada vez que alguien se
   * sienta a jugar.
   *
   * Se afirma la REGLA y no la línea: que exista el filtro, y que ninguna de
   * las cuatro se asigne sin pasar por él. Escrito como
   * `esRutaDelSitio(miPano)`, la prueba se ponía roja al mover el filtro un
   * renglón más arriba —que era una mejora— y se quedaba callada si mañana
   * alguien agregaba una quinta sin filtrar.
   */
  ok(
    /const propio = \(ruta\) => \(esRutaDelSitio\(ruta\) \? ruta : null\)/.test(mesa),
    "la mesa tiene un solo filtro para lo equipado, y es el estricto",
  );
  const crudas = [...mesa.matchAll(/\bmi(?:Pano|Dorso|Retrato|Mazo) = (.+)/g)]
    .map((m) => m[1].trim())
    .filter((valor) => !valor.startsWith("propio(") && valor !== "null;");
  ok(crudas.length === 0, "y ninguna de las cuatro se asigna sin pasar por él", crudas);

  // Y que la capa exista en la hoja, con `none` por defecto: sin eso la
  // variable no se aplica a nada y el paño comprado no se ve.
  ok(
    lee("public/css/mesa.css").includes("var(--pano, none) padding-box"),
    "la capa está declarada en .mesa y por defecto no pinta nada",
  );
}

console.log("\n=== El servidor lo entrega con el resto de lo equipado ===");
{
  const guardia = readFileSync(new URL("public/js/guardia-sesion.js", RAIZ), "utf8");
  ok(/ruta\(perfil\.data\(\)\.fondo\)/.test(guardia), "lee el campo `fondo` del perfil");
  ok(/dorso: null, retrato: null, pano: null/.test(guardia), "y devuelve null si no hay nada");
}

console.log("\n=== El mazo del centro es su propio artículo ===");
{
  /**
   * No es un dorso más.
   *
   * El DORSO es el reverso de las cartas de la mano, y de él hay dos alternados
   * justamente para que se distinga de quién es cada juego. El MAZO es la pila
   * del medio, que no es de nadie y se mira la partida entera. Son dos campos
   * del perfil, dos categorías de la tienda y dos compras.
   */
  const MAZOS = itemsDeTipo(CATALOGO_INICIAL, TIPOS.MAZO);

  ok(TIPOS.MAZO === "mazo", "el tipo existe", TIPOS.MAZO);
  ok(esVendible(TIPOS.MAZO), "se vende");
  ok(CAMPO_EQUIPADO[TIPOS.MAZO] === "mazo", "y tiene su propio campo del perfil");
  ok(
    CAMPO_EQUIPADO[TIPOS.MAZO] !== CAMPO_EQUIPADO[TIPOS.DORSO],
    "que NO es el del dorso: equiparse uno no puede cambiar el otro",
  );

  ok(MAZOS.length === 4, "hay cuatro en la semilla", MAZOS.length);
  ok(
    MAZOS.every((m) => problemasDelItem(m).length === 0),
    "todos bien formados",
    MAZOS.flatMap((m) => problemasDelItem(m)),
  );

  const gratis = MAZOS.filter((m) => m.precio === 0);
  ok(gratis.length === 1, "uno solo gratis", gratis.map((m) => m.id));
  ok(
    gratis[0]?.imagen === "/img/dorsos/dorso-azul.png",
    "y es el que la pila del centro ya usaba: equiparlo no cambia nada",
    gratis[0]?.imagen,
  );

  for (const mazo of MAZOS) {
    const ruta = new URL(`public${mazo.imagen}`, RAIZ);
    ok(esRutaDelSitio(mazo.imagen), `${mazo.id}: la ruta es de este sitio`, mazo.imagen);
    ok(existsSync(ruta), `${mazo.id}: el archivo está`, mazo.imagen);
  }

  // Los dibujados van en 2:3, la proporción de la carta. Con otra, el dorso se
  // estira dentro del hueco y se nota enseguida.
  const torcidos = MAZOS.filter((m) => m.imagen.endsWith(".svg")).filter((m) => {
    const svg = readFileSync(new URL(`public${m.imagen}`, RAIZ), "utf8");
    const v = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
    return !v || Math.abs(Number(v[1]) / Number(v[2]) - 2 / 3) > 0.01;
  });
  ok(torcidos.length === 0, "los dibujados van en proporción de carta", torcidos.map((m) => m.id));
}

console.log("\n=== La mesa dibuja el mazo con SU dorso, no con el del asiento ===");
{
  const lee = (r) => readFileSync(new URL(r, RAIZ), "utf8");
  const cartas = lee("public/js/modulos/cartas.js");

  ok(/export const dorsoDelMazo/.test(cartas), "el módulo de cartas sabe cuál es");
  ok(
    /mazoCentral \?\? dorsoDeAsiento\(0\)/.test(cartas),
    "y sin nada comprado cae al de siempre, así que el cambio no se nota",
  );
  ok(/dorso: dorsoDelMazo\(\)/.test(lee("public/js/mesa.js")), "y la pila del centro lo pide");

  // Lo que no puede pasar: que el dorso de la mano termine también en el
  // centro. Son dos artículos y el jugador compró uno.
  ok(
    /ruta\(perfil\.data\(\)\.mazo\)/.test(lee("public/js/guardia-sesion.js")),
    "el servidor lo lee del campo `mazo`",
  );
}

console.log("\n=== Los rótulos del centro se esconden, pero se leen ===");
{
  // Se sacaron de la vista para que ese alto fuera a las cartas. Con
  // `display: none` desaparecerían también para un lector de pantalla, y ahí
  // las tres pilas serían «Carta, boca abajo» tres veces seguidas.
  const css = readFileSync(new URL("public/css/mesa.css", RAIZ), "utf8");
  const desde = css.indexOf(".pila .etiqueta,");
  const bloque = css.slice(desde, desde + 400);

  ok(desde > 0, "el rótulo y el contador comparten regla");
  ok(!/display:\s*none/.test(bloque), "no se esconden con display:none");
  ok(/clip-path:\s*inset\(50%\)/.test(bloque), "sino sacándolos de la pantalla");
  ok(bloque.includes(".pila .contador"), "y el contador va con el mismo trato");
}

console.log("\n=== El centro mide lo mismo que una carta de la mesa ===");
{
  // Tenían tamaño propio, más chico, de cuando el centro cedía alto para que
  // entraran las manos. Con los rótulos fuera ese alto volvió, y no hay razón
  // para que una carta en el centro se vea distinta de una en una mano: es la
  // misma baraja.
  const css = readFileSync(new URL("public/css/mesa.css", RAIZ), "utf8");
  ok(
    // `--carta-alto:` como DECLARACIÓN, no como el que aparece dentro del
    // `calc()` que calcula el ancho — ése tiene que seguir estando.
    !/\.pila \.carta \{[^}]*--carta-alto:\s*clamp/.test(css),
    "el mazo y la muestra no tienen tamaño propio",
  );
  ok(
    !/\.levantada-caja \.carta \{[^}]*--carta-alto:\s*clamp/.test(css),
    "la levantada tampoco",
  );
}

console.log(fallos === 0 ? "\n✅ TODO OK" : `\n❌ ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
