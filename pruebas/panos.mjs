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
  ok(
    /esRutaDelSitio\(miPano\)/.test(mesa),
    "y comprueba la ruta antes de meterla en un url()",
  );

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

console.log(fallos === 0 ? "\n✅ TODO OK" : `\n❌ ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
