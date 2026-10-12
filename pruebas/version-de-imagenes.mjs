/**
 * Un solo número para todas las imágenes del sitio, y qué queda afuera.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ AGUJERO TAPA (§66)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El versionado estaba partido en tres y cubría la mitad: los avatares tenían
 * su número, los dorsos de la casa otro, las cartas un tercero — y las
 * insignias, los marcos, los paños y los mazos NO TENÍAN NINGUNO. Reemplazar
 * una insignia era desplegarla y esperar un mes a que venciera la caché.
 *
 * Y había algo peor que el agujero: la inconsistencia dentro del MISMO
 * archivo. `/img/dorsos/dorso-azul.webp` llevaba `?v=1` cuando lo repartía la
 * casa y llegaba SIN versión cuando era el dorso que alguien compró, porque
 * esa ruta sale del catálogo de Firestore y nadie la envolvía.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE MÁS IMPORTA ACÁ NO ES LO QUE VERSIONA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Es lo que NO. Un `imagenUrl` que versione de más rompe cosas que hoy
 * andan: la foto de Google de otro dominio, los emojis del catálogo, las
 * cartas —que tienen su propia versión a propósito— y, sobre todo, las rutas
 * que YA vienen versionadas desde el `localStorage` de una visita anterior.
 * Ésa última daría `?v=3?v=3` y un 404.
 *
 * Por eso cada caso de «deja pasar» tiene su propia afirmación.
 */

import { readFileSync } from "node:fs";
import { VERSION_IMAGENES, imagenUrl } from "../public/js/reglas/imagenes.js";
import { VERSION_CARTAS, dorsoDeAsiento, dorsoUrl, imagenCarta } from "../public/js/reglas/baraja.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

// =====================================================================
console.log("\n=== 1. Versiona todo /img/, que es el punto del §66 ===");
// =====================================================================
{
  const v = `?v=${VERSION_IMAGENES}`;

  // Las seis carpetas que hay. Las cuatro del medio son las que no tenían
  // ninguna versión y por las que existe este cambio.
  const carpetas = [
    ["/img/avatar/el_as.webp", "avatares"],
    ["/img/dorsos/dorso-azul.webp", "dorsos"],
    ["/img/insignias/novato.webp", "insignias"],
    ["/img/mesa/panos/fieltro.svg", "paños"],
    ["/img/mazos/azul.svg", "mazos"],
    ["/img/marcos/dorado.webp", "marcos (cuando los haya)"],
  ];
  for (const [ruta, que] of carpetas) {
    ok(imagenUrl(ruta) === ruta + v, `${que}: lleva versión`, imagenUrl(ruta));
  }

  ok(imagenUrl("/img/cualquier/cosa/nueva.webp") === `/img/cualquier/cosa/nueva.webp${v}`,
     "y una carpeta que no existe todavía también: la regla es `/img/`, no una lista");
}

// =====================================================================
console.log("\n=== 2. Lo que NO toca ===");
// =====================================================================
{
  // Un perfil sin retrato trae null, y la mesa lo pasa igual.
  ok(imagenUrl(null) === null, "un null pasa tal cual");
  ok(imagenUrl(undefined) === undefined, "un undefined también");
  ok(Number.isNaN(imagenUrl(NaN)) , "y cualquier cosa que no sea texto");

  // Los emojis del catálogo son `imagen` sin ser rutas.
  ok(imagenUrl("🐺") === "🐺", "un emoji del catálogo no es una ruta");
  ok(imagenUrl("") === "", "el texto vacío tampoco");

  // La foto de Google, que es de otro dominio.
  const google = "https://lh3.googleusercontent.com/a/ACg8ocK";
  ok(imagenUrl(google) === google, "la foto de Google no se toca: es de otro dominio");

  // Las cartas tienen su propia versión, a propósito.
  ok(imagenUrl("/assets/Oro/7.webp") === "/assets/Oro/7.webp",
     "`/assets/` no se toca: las cartas tienen su propio número");

  // Una ruta relativa, que no es del sitio.
  ok(imagenUrl("img/avatar/el_as.webp") === "img/avatar/el_as.webp",
     "sin la barra inicial no es una ruta del sitio");
}

// =====================================================================
console.log("\n=== 3. Lo que ya viene versionado no se vuelve a versionar ===");
// =====================================================================
{
  /*
   * Esto NO es defensa por las dudas. Las rutas de los artículos están
   * copiadas en el `localStorage` de cada navegador y en filas viejas del
   * ranking, y algunas de esas copias se escribieron YA con la query. Sin
   * esta regla, la segunda pasada daría `?v=3?v=3`.
   */
  const yaTiene = "/img/avatar/el_as.webp?v=3";
  ok(imagenUrl(yaTiene) === yaTiene, "una ruta con `?v=` guardada de antes queda igual");

  const vieja = "/img/avatar/el_as.webp?v=2";
  ok(imagenUrl(vieja) === vieja, "incluso con un número VIEJO: dos queries serían un 404");

  ok(imagenUrl(imagenUrl("/img/insignias/novato.webp")) === imagenUrl("/img/insignias/novato.webp"),
     "aplicarlo dos veces da lo mismo que una");

  ok(imagenUrl("/img/x.webp?otra=cosa") === "/img/x.webp?otra=cosa",
     "y cualquier otra query también lo deja pasar");
}

// =====================================================================
console.log("\n=== 4. Los dos caminos del dorso dan lo mismo ===");
// =====================================================================
{
  /*
   * El agujero concreto que esto cierra: el dorso de la CASA pasaba por
   * `dorsoUrl` y llevaba `?v=1`; el dorso COMPRADO salía del catálogo y
   * llegaba crudo. Mismo archivo, dos direcciones.
   */
  const ruta = "/img/dorsos/dorso-azul.webp";
  ok(dorsoUrl(ruta) === imagenUrl(ruta),
     "un dorso de la casa y uno comprado dan la MISMA dirección", [dorsoUrl(ruta), imagenUrl(ruta)]);
  ok(dorsoDeAsiento(0) === imagenUrl(ruta),
     "y el que reparte la mesa también", dorsoDeAsiento(0));
}

// =====================================================================
console.log("\n=== 5. Las cartas quedaron afuera, y sigue siendo a propósito ===");
// =====================================================================
{
  /*
   * Si algún día alguien las unifica sin querer, esto se pone rojo. El costo
   * de unificarlas es concreto: subir el número de las imágenes obligaría a
   * redescargar las cuarenta y ocho cartas, 3,3 MB, por haber recortado un
   * avatar.
   */
  const carta = imagenCarta("Oro", 7);
  ok(carta === `/assets/Oro/7.webp?v=${VERSION_CARTAS}`,
     "`imagenCarta` sigue con `VERSION_CARTAS`", carta);
  ok(!carta.startsWith("/img/"),
     "y viven bajo `/assets/`, así que `imagenUrl` no las alcanza ni queriendo");
}

// =====================================================================
console.log("\n=== 6. El número ===");
// =====================================================================
{
  ok(Number.isInteger(VERSION_IMAGENES) && VERSION_IMAGENES > 0,
     "es un entero positivo", VERSION_IMAGENES);

  /*
   * Y nunca menor que 3. No es una formalidad: 3 es el valor que tenía
   * `VERSION_AVATARES` cuando se unificó, así que `/img/avatar/...?v=3` y
   * todo lo anterior YA están guardados en los navegadores de la gente.
   * Bajarlo devolvería una dirección que ya tienen en caché, y entonces la
   * versión deja de servir para lo único que sirve.
   */
  ok(VERSION_IMAGENES >= 3,
     "y nunca baja de 3: por debajo devuelve direcciones ya guardadas", VERSION_IMAGENES);

  ok(imagenUrl("/img/a.webp").endsWith(`?v=${VERSION_IMAGENES}`),
     "la dirección termina en el número que exporta el módulo");

  /*
   * Y que lo INTERPOLE, no que coincida.
   *
   * La afirmación de arriba pasa igual con un `?v=3` escrito a mano, porque
   * hoy los dos valores son 3. Lo que eso dejaría pasar es el día en que
   * alguien suba la constante a 4 para forzar una recarga: la constante diría
   * 4, la dirección seguiría diciendo 3, y la recarga no llegaría nunca — que
   * es exactamente el problema que este archivo existe para resolver.
   *
   * Se mira el texto fuente porque no hay forma de variar una constante
   * exportada desde acá. Es el mismo recurso de `retratos-en-red.mjs`.
   */
  const fuente = readFileSync(new URL("../public/js/reglas/imagenes.js", import.meta.url), "utf8");
  ok(/\?v=\$\{VERSION_IMAGENES\}/.test(fuente),
     "y la arma interpolando la constante, no con un número escrito a mano");
}

console.log(fallos ? `\n❌ ${fallos} fallos` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
