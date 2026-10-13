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
import {
  CONTEXTOS_DE_MESA,
  CONTEXTOS_VALIDOS,
  DOCUMENTO_GLOBAL_DE_MESA,
  documentoDeMesa,
} from "../public/js/reglas/salas.js";
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
  ok(capaDeSala("#abcd") === "linear-gradient(#abcd, #abcd)", "y de cuatro");

  /*
   * Y SÓLO 3, 4, 6 u 8. Cinco y siete dígitos se parecen a un color y CSS no
   * los acepta: dejarlos pasar daría un `linear-gradient` inválido, el
   * navegador descartaría la declaración entera, y el color quedaría
   * guardado sin pintar nada. Aceptado y sin efecto es peor que rechazado.
   */
  ok(capaDeSala("#1a1a2") === null, "cinco dígitos no es un color de CSS");
  ok(capaDeSala("#1a1a2ea") === null, "siete tampoco");

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

  // Y la sala, lo mismo: receta sí, catálogo no.
  ok(!TIPOS_VALIDOS.includes(TIPOS_DE_CONFIGURACION.SALA),
     "la sala tampoco es un tipo del catálogo");

  const s = recetaDe(TIPOS_DE_CONFIGURACION.SALA);
  ok(s !== null, "pero tiene su receta", s);

  /*
   * 1920 de lado mayor y proporción NATIVA, no un par exacto.
   *
   * Con lado mayor 1920 una imagen 16:9 sale exactamente 1920x1080, que es
   * lo que se va a subir. Y una que no sea 16:9 se conserva entera en vez de
   * recortarse dos veces: una al convertir y otra con el `cover` del CSS. El
   * segundo recorte se adapta a cada ventana; el primero sería una decisión
   * tomada antes de saber en qué pantalla se va a ver.
   */
  ok(s.formato === "webp" && s.ladoMayor === 1920 && s.proporcion === "nativa",
     "1920 de lado mayor, proporción nativa", s);
  ok(seConvierte(TIPOS_DE_CONFIGURACION.SALA) === true,
     "y el conversor la trata como cualquier otra ráster");
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

// =====================================================================
console.log("\n=== 7. Cuál documento, por contexto ===");
// =====================================================================
{
  /*
   * El nombre del documento se arma en UN solo lugar porque lo necesitan
   * tres: la mesa que lee, el panel que escribe y el servidor que guarda.
   * Tres plantillas iguales se separan en cuanto una cambie.
   */
  ok(documentoDeMesa(CONTEXTOS_DE_MESA.ENTRENAMIENTO) === "mesa-entrenamiento",
     "entrenamiento tiene el suyo", documentoDeMesa(CONTEXTOS_DE_MESA.ENTRENAMIENTO));
  ok(documentoDeMesa(CONTEXTOS_DE_MESA.PUBLICA) === "mesa-publica", "pública también");
  ok(documentoDeMesa(CONTEXTOS_DE_MESA.PRIVADA) === "mesa-privada", "privada también");
  ok(documentoDeMesa(CONTEXTOS_DE_MESA.TORNEO) === "mesa-torneo",
     "y torneo, aunque todavía no lo lea nadie");

  ok(CONTEXTOS_VALIDOS.length === 4, "son cuatro, ni uno más", CONTEXTOS_VALIDOS);

  /*
   * Un contexto desconocido cae al GLOBAL, no inventa un documento.
   *
   * De un nombre con una letra de más saldría `mesa-privadq`: un documento
   * que nadie escribió, una mesa sin decorar, y nada que lo denuncie. Caer
   * al global es visible —se ve la mesa general— y recuperable.
   */
  for (const [v, que] of [
    ["privadq", "un nombre con un dedo resbalado"],
    [undefined, "sin contexto"],
    [null, "un null"],
    ["", "el texto vacío"],
    ["MESA-PRIVADA", "el mismo en mayúsculas"],
    [7, "un número"],
  ]) {
    ok(documentoDeMesa(v) === "mesa", `${que} cae al documento global`, documentoDeMesa(v));
  }

  ok(DOCUMENTO_GLOBAL_DE_MESA === "mesa",
     "y el global sigue llamándose como antes: lo ya guardado vale", DOCUMENTO_GLOBAL_DE_MESA);

  // Ningún contexto puede llamarse igual que el global, o se pisarían.
  ok(!CONTEXTOS_VALIDOS.includes(DOCUMENTO_GLOBAL_DE_MESA),
     "ningún contexto se llama como el documento global");
}

// =====================================================================
console.log("\n=== 8. El servidor escribe al documento del contexto ===");
// =====================================================================
{
  const espiar = () => {
    const tocados = [];
    const db = { collection: () => ({ doc: (d) => ({
      set: async (c) => tocados.push({ doc: d, cambios: c }),
      get: async () => ({ exists: false }),
    }) }) };
    const d = crearDisenoDeMesa({
      db,
      administradores: { exigir: async () => {} },
      campoBorrado: () => "«BORRADO»",
    });
    return { d, tocados };
  };

  {
    const { d, tocados } = espiar();
    await d.guardar({}, { contexto: "privada", brujula: "/img/x.webp" });
    ok(tocados[0].doc === "mesa-privada",
       "con contexto, escribe el documento de ESE contexto", tocados[0]?.doc);
    ok(!("contexto" in tocados[0].cambios),
       "y el contexto NO se guarda adentro: es a dónde se escribe, no un dato",
       tocados[0]?.cambios);
  }

  {
    /*
     * Sin contexto, el global. Es compatibilidad: el panel escribía ahí
     * antes de que existieran los contextos, y lo ya guardado tiene que
     * seguir valiendo sin migrar nada.
     */
    const { d, tocados } = espiar();
    await d.guardar({}, { brujula: "/img/x.webp" });
    ok(tocados[0].doc === "mesa", "sin contexto, el global", tocados[0]?.doc);
  }

  {
    // Y guardar en uno no toca a los otros: cada contexto es su documento.
    const { d, tocados } = espiar();
    await d.guardar({}, { contexto: "publica", sala: "#101010" });
    await d.guardar({}, { contexto: "torneo", sala: "#202020" });
    ok(tocados.map((x) => x.doc).join(",") === "mesa-publica,mesa-torneo",
       "cada uno al suyo", tocados.map((x) => x.doc));
  }
}

console.log(fallos ? `\n❌ ${fallos} fallos` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
