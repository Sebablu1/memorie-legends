/**
 * El diseño que decide la casa: qué se escribe y, sobre todo, qué NO.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE MÁS IMPORTA ES LO QUE DEVUELVE `null`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque `null` significa «no toques nada», y ése es el caso normal: hoy no
 * hay configuración y la mesa tiene que verse exactamente como siempre. Una
 * función que devolviera algo ante un valor vacío, mal escrito o inesperado
 * pintaría la mesa de todos con basura, y el único aviso sería que alguien la
 * mire.
 *
 * Por eso cada forma de «no hay nada que escribir» tiene su propia
 * afirmación, en vez de una sola con un valor de ejemplo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Y POR QUÉ UN COLOR SALE COMO DEGRADADO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `--sala` ocupa una posición de CAPA DE IMAGEN dentro de un `background`, y
 * ahí CSS no acepta un color: `background: #000, url(...)` es inválido, un
 * color sólo puede ser la última capa. `linear-gradient(c, c)` sí es una
 * imagen para CSS y pinta igual que el color plano.
 *
 * O sea que esto no es un adorno de implementación: es lo que hace posible
 * que el mismo campo guarde una imagen o un color.
 */

import {
  SIN_BRUJULA,
  capaDeBrujula,
  capaDeSala,
} from "../public/js/modulos/diseno-de-mesa.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

// =====================================================================
console.log("\n=== 1. La sala: imagen, color o degradado ===");
// =====================================================================
{
  ok(capaDeSala("/img/mesa/salas/cueva.webp") ===
     'url("/img/mesa/salas/cueva.webp") center / cover no-repeat',
     "una ruta del sitio sale como `url(...)`", capaDeSala("/img/mesa/salas/cueva.webp"));

  /*
   * `cover` y no `100% 100%`. El fondo cubre la VENTANA, que cambia de forma
   * entre un monitor y un teléfono: estirar deformaría el dibujo, cubrir
   * recorta — y sobre una pared de fondo, recortar no se nota.
   *
   * Es la diferencia con el paño, que sí se estira porque tiene que cubrir
   * exactamente el óvalo.
   */
  ok(/center \/ cover no-repeat/.test(capaDeSala("/img/x.webp")),
     "y se CUBRE, no se estira: la ventana cambia de forma");

  ok(capaDeSala("#1a1a2e") === "linear-gradient(#1a1a2e, #1a1a2e)",
     "un color sale como degradado de un tono: en esa posición CSS no acepta colores",
     capaDeSala("#1a1a2e"));
  ok(capaDeSala("  #000  ") === "linear-gradient(#000, #000)",
     "con los espacios de más sacados", capaDeSala("  #000  "));
  ok(capaDeSala("#AABBCCDD") === "linear-gradient(#AABBCCDD, #AABBCCDD)",
     "y con alfa de ocho dígitos también");

  const deg = "linear-gradient(178deg, #131721 0%, #05070c 100%)";
  ok(capaDeSala(deg) === deg, "un degradado entero se escribe tal cual: ya es una imagen");
  ok(capaDeSala("radial-gradient(#111, #000)") === "radial-gradient(#111, #000)",
     "radial también");
}

// =====================================================================
console.log("\n=== 2. La sala: todo lo que NO se escribe ===");
// =====================================================================
{
  for (const [valor, que] of [
    [undefined, "sin configuración"],
    [null, "un null"],
    ["", "el texto vacío"],
    ["   ", "sólo espacios"],
    [123, "un número"],
    [{}, "un objeto"],
    ["cueva.webp", "una ruta SIN la barra inicial: no es del sitio"],
    ["https://otro.com/x.webp", "otro dominio"],
    ["rojo", "un nombre de color: no se acepta, para no adivinar"],
    ["#xyz", "algo que parece color y no lo es"],
    ["url(javascript:alert(1))", "algo que no es ni ruta ni color"],
  ]) {
    ok(capaDeSala(valor) === null, `${que} → no se escribe nada`, capaDeSala(valor));
  }
}

// =====================================================================
console.log("\n=== 3. La brújula: propia, ninguna, o la de siempre ===");
// =====================================================================
{
  ok(capaDeBrujula("/img/mesa/brujulas/suya.webp") ===
     'url("/img/mesa/brujulas/suya.webp") center 46% / contain no-repeat',
     "una ruta propia sale como máscara", capaDeBrujula("/img/mesa/brujulas/suya.webp"));

  /*
   * `contain` y `center 46%`, igual que la de siempre: la brújula tiene que
   * entrar ENTERA. Con `cover`, en una ventana ancha se le cortan el norte y
   * el sur y queda una figura que no se reconoce.
   */
  ok(/center 46% \/ contain no-repeat/.test(capaDeBrujula("/img/x.svg")),
     "y entra entera, centrada al 46%: con `cover` se le cortarían las puntas");

  ok(capaDeBrujula(SIN_BRUJULA) === "none",
     "«ninguna» apaga la máscara, que es no tener brújula", capaDeBrujula(SIN_BRUJULA));

  for (const [valor, que] of [
    [undefined, "sin configuración → queda la de siempre"],
    [null, "un null"],
    ["", "el texto vacío"],
    ["ninguno", "una palabra parecida pero que no es"],
    ["rosa-viento.svg", "una ruta sin la barra inicial"],
    ["https://otro.com/x.svg", "otro dominio"],
  ]) {
    ok(capaDeBrujula(valor) === null, `${que} → no se escribe nada`, capaDeBrujula(valor));
  }
}

// =====================================================================
console.log("\n=== 4. Las dos son independientes ===");
// =====================================================================
{
  /*
   * Una configuración a medias tiene que escribir la mitad que sirve y dejar
   * la otra como estaba. Es el caso real de «cargué la sala, la brújula
   * todavía no».
   */
  ok(capaDeSala("/img/a.webp") !== null && capaDeBrujula(undefined) === null,
     "sala puesta y brújula sin tocar");
  ok(capaDeSala(undefined) === null && capaDeBrujula("/img/b.svg") !== null,
     "brújula puesta y sala sin tocar");
}

console.log(fallos ? `\n❌ ${fallos} fallos` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
