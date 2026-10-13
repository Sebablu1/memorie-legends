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
import { crearDisenoDeMesa } from "../functions/diseno-de-mesa.js";
import { TIPOS_VALIDOS } from "../public/js/reglas/catalogo.js";
import {
  RECETAS,
  TIPOS_CONVERTIBLES,
  TIPOS_DE_CONFIGURACION,
  recetaDe,
  seConvierte,
} from "../public/js/reglas/imagenes-de-catalogo.js";

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

// =====================================================================
console.log("\n=== 5. La receta de la brújula NO es un tipo del catálogo ===");
// =====================================================================
{
  /*
   * La distinción que sostiene toda la fase 2.
   *
   * `TIPOS_VALIDOS` alimenta el desplegable de artículos del panel y el
   * `z.enum` del servidor. Si la brújula entrara ahí, se podría crear un
   * ARTÍCULO de catálogo de tipo «brujula-mesa» —con precio, en `misItems`
   * y equipable—, que es exactamente lo que no tiene que poder pasar.
   *
   * Lo único que comparte con un artículo es CÓMO se convierte su imagen.
   */
  ok(!TIPOS_VALIDOS.includes(TIPOS_DE_CONFIGURACION.BRUJULA),
     "la brújula no es un tipo del catálogo", TIPOS_VALIDOS);
  ok(!(TIPOS_DE_CONFIGURACION.BRUJULA in RECETAS),
     "ni tiene entrada en la tabla de artículos");

  const r = recetaDe(TIPOS_DE_CONFIGURACION.BRUJULA);
  ok(r !== null, "pero SÍ tiene receta: el conversor la necesita", r);
  ok(r.formato === "webp" && r.proporcion === "cuadrada" && r.ladoMayor === 1024,
     "cuadrada de 1024: la máscara se ajusta al lado menor de la mesa", r);
  ok(seConvierte(TIPOS_DE_CONFIGURACION.BRUJULA) === true,
     "y el conversor la trata como cualquier otra ráster");

  ok(!TIPOS_CONVERTIBLES.includes(TIPOS_DE_CONFIGURACION.BRUJULA),
     "sin colarse en `TIPOS_CONVERTIBLES`, que es sólo del catálogo",
     TIPOS_CONVERTIBLES);
}

// =====================================================================
console.log("\n=== 6. El servidor: qué escribe y qué borra ===");
// =====================================================================
{
  /*
   * `functions/diseno-de-mesa.js` es el ÚNICO camino para escribir
   * `config/mesa`: las reglas se lo prohíben al navegador a propósito, porque
   * un cliente que pudiera escribir ahí le cambiaría la mesa a todo el mundo.
   *
   * Lo que se prueba acá es la regla que hace posible volver atrás: un campo
   * AUSENTE no toca, un campo en `null` BORRA. Sin esa distinción, cargar una
   * brújula sería una decisión sin vuelta — no habría forma de recuperar la
   * de siempre sin tocar la base a mano.
   */
  const espiar = () => {
    const escrito = [];
    const db = { collection: () => ({ doc: () => ({
      set: async (c, o) => escrito.push({ c, o }),
      get: async () => ({ exists: false }),
    }) }) };
    const d = crearDisenoDeMesa({
      db,
      administradores: { exigir: async () => {} },
      campoBorrado: () => "«BORRADO»",
    });
    return { d, escrito };
  };

  {
    const { d, escrito } = espiar();
    await d.guardar({}, { brujula: "/img/x.webp" });
    ok(JSON.stringify(escrito[0].c) === JSON.stringify({ brujula: "/img/x.webp" }),
       "un valor se escribe tal cual", escrito[0]?.c);
    ok(escrito[0].o?.merge === true,
       "y con `merge`: el panel puede estar editando una sola de las dos cosas",
       escrito[0]?.o);
  }

  {
    const { d, escrito } = espiar();
    await d.guardar({}, { brujula: null });
    ok(escrito[0].c.brujula === "«BORRADO»",
       "un `null` BORRA el campo, que es volver a la de siempre", escrito[0]?.c);
  }

  {
    /*
     * Lo que NO está no se toca. Es lo que permite guardar la sala sin pisar
     * la brújula, y al revés.
     */
    const { d, escrito } = espiar();
    await d.guardar({}, { sala: "#101010" });
    ok(!("brujula" in escrito[0].c),
       "un campo ausente no se escribe: guardar la sala no pisa la brújula",
       escrito[0]?.c);
  }

  {
    /*
     * Y sin campos no se escribe NADA. Un `set({}, {merge:true})` crearía el
     * documento vacío, y «existe pero no dice nada» es un estado más para que
     * alguien tenga que interpretarlo.
     */
    const { d, escrito } = espiar();
    const r = await d.guardar({}, {});
    ok(escrito.length === 0, "sin cambios no se toca la base", escrito);
    ok(r.guardado === false && r.campos.length === 0, "y se dice que no se guardó", r);
  }

  {
    // Las dos juntas, que es el caso de cargar todo de una.
    const { d, escrito } = espiar();
    const r = await d.guardar({}, { brujula: "ninguna", sala: null });
    ok(escrito[0].c.brujula === "ninguna" && escrito[0].c.sala === "«BORRADO»",
       "las dos a la vez, cada una con lo suyo", escrito[0]?.c);
    ok(r.campos.join(",") === "brujula,sala", "y se informa qué se tocó", r);
  }
}

console.log(fallos ? `\n❌ ${fallos} fallos` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
