/**
 * El cerrojo de la cadena de turno en RED.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE ESTE ARCHIVO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque la etapa 3 rompió «cambiar por una mía» en red, se desplegó, y hubo
 * que hacer rollback. El bug era de una línea y pasó todas las pruebas, y la
 * razón de fondo no fue la línea: fue que NINGÚN spec de red apretaba nunca un
 * botón de turno. Los cuatro dobles de `partida-red.js` estaban escritos así:
 *
 *     export const levantar = async () => {};
 *     export const tirarCarta = async () => {};
 *     export const cortar = async () => {};
 *     export const pasarTurno = async () => {};
 *
 * Sellos vacíos. Aunque un spec los hubiera apretado, no habría podido ver
 * nada. La cadena entera —botón habilitado, clic, llamada al servidor— estaba
 * sin cubrir, y se notó en producción.
 *
 * Un spec más no arregla eso: el que falta es siempre el que no se escribió.
 * Lo que arregla eso es una prueba que mire las PRUEBAS, y falle cuando una
 * parte de la cadena se queda sin nadie que la ejercite.
 *
 * Es el mismo oficio que `reglamento.mjs`, que compara la tabla de tiempos
 * del reglamento contra las constantes fila por fila, o `suites-registradas`,
 * que compara esta lista contra el disco. Pruebas sobre el andamio.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ CUENTA COMO «APRETAR EL BOTÓN»
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un `.click()` sobre el localizador del botón, en un spec de RED. Y las dos
 * mitades de esa frase importan:
 *
 *   - `toBeEnabled()` NO cuenta. `fin-de-ronda-en-red.spec.js` comprobaba que
 *     `#btnLevantar` estuviera habilitado y nunca lo tocaba: eso prueba que el
 *     botón se dibuja, no que la jugada salga. Es exactamente la clase de
 *     cobertura que dejó pasar el bug.
 *
 *   - de ENTRENAMIENTO no cuenta. `carteles.spec.js` aprieta los cuatro, y por
 *     eso el bug «funciona en entrenamiento, falla en red». Un spec de
 *     entrenamiento no toca `clicEnCartaDeRed` ni ninguna de las llamadas.
 *
 * El reconocimiento es LITERAL a propósito: se busca `locator(SEL.x).click()`
 * o `locator("#btnX").click()` en una sola expresión. Si alguien guarda el
 * localizador en una variable y lo aprieta después, este cerrojo no lo ve y
 * falla. Es la falla que se quiere: avisar de menos sería dar por cubierto lo
 * que no se revisó, y la salida es inmediata —escribir el clic en una línea, o
 * agregar la forma nueva acá—.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const aqui = dirname(fileURLToPath(import.meta.url));
const dirE2E = join(aqui, "e2e");

let fallos = 0;
const ok = (cond, que, extra) => {
  if (cond) console.log("  ✓", que);
  else {
    fallos++;
    console.log("  ✗", que, extra !== undefined ? JSON.stringify(extra) : "");
  }
};

/**
 * Los cuatro botones, con los nombres que usan los specs.
 *
 * Cada uno se puede escribir de dos formas —`SEL.levantar` o `"#btnLevantar"`—
 * y las dos están en uso hoy. Se aceptan las dos en vez de obligar a una:
 * uniformarlas sería un cambio de otro commit, y este cerrojo tiene que poder
 * correr antes de ése.
 */
const BOTONES = {
  levantar: ["SEL.levantar", "#btnLevantar"],
  tirar: ["SEL.tirar", "#btnTirar"],
  cortar: ["SEL.cortar", "#btnCortar"],
  pasar: ["SEL.pasar", "#btnPasar"],
};

/**
 * Fuera los comentarios, antes de contar nada.
 *
 * Sin esto, un comentario que MENCIONE el patrón cuenta como cobertura. No es
 * un caso inventado: el comentario que explica por qué no hay un ayudante para
 * los botones está, justamente, en el spec que los aprieta — y si dijera
 * `locator(SEL.cortar).click()` como ejemplo, este cerrojo daría cortar por
 * cubierto con una frase.
 *
 * Es un recorte de texto, no un parser: no distingue un `//` dentro de una
 * cadena. Alcanza —los specs no llevan URLs en literales en estas líneas— y la
 * dirección del error es la segura: recorta de más, nunca de menos, así que a
 * lo sumo pide un clic que ya estaba.
 */
const sinComentarios = (fuente) =>
  fuente
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ 	]*\/\/.*$/gm, " ");

/** `.click()` sobre el localizador de ese botón, en una sola expresión. */
function cuentaDeClics(fuenteCruda, formas) {
  const fuente = sinComentarios(fuenteCruda);
  let total = 0;
  for (const forma of formas) {
    const dentro = forma.startsWith("#")
      ? `["'\`]${forma}["'\`]`          // "#btnLevantar"
      : forma.replace(".", "\\.");      // SEL.levantar
    const patron = new RegExp(
      `locator\\(\\s*${dentro}\\s*\\)\\s*\\.click\\(`,
      "g",
    );
    total += [...fuente.matchAll(patron)].length;
  }
  return total;
}

/**
 * Un spec monta la mesa en RED si reemplaza el módulo `partida-red.js`.
 *
 * Es la marca más honesta que hay: ese `page.route` es lo que convierte a la
 * mesa en una mesa de Leyendas con un servidor de mentira. Buscar la palabra
 * «red» en el nombre del archivo habría dejado afuera a los que no la llevan.
 */
const montaRed = (fuente) => /route\(\s*["'`]\*\*\/js\/partida-red\.js["'`]/.test(fuente);

/** Y también monta la mesa local. Cinco archivos tienen las dos cosas. */
const montaEntrenamiento = (fuente) => /abrirEntrenamiento\(|abrirMesa\(/.test(fuente);

const specs = readdirSync(dirE2E)
  .filter((n) => n.endsWith(".spec.js"))
  .map((nombre) => ({
    nombre,
    fuente: readFileSync(join(dirE2E, nombre), "utf8"),
  }));

/*
 * SÓLO LOS PUROS, Y ES LA PRECISIÓN QUE HACE QUE ESTO SIRVA.
 *
 * Cinco archivos montan las dos mesas —`ausente`, `marco-y-titulo`,
 * `ojo-del-poder`, `reloj-para-decidir`, `tienda-en-mesa`— y en un archivo
 * mixto no se puede saber, leyendo el texto, si el clic que se encontró está
 * en un caso de red o en uno de entrenamiento.
 *
 * Esto no es teórico: la primera versión de este cerrojo daba `levantar` por
 * cubierto gracias a un clic de `ausente.spec.js`, y ese clic está en un caso
 * que entra por `abrirEntrenamiento`. O sea que daba por cubierta la cadena
 * de turno en red con una prueba que no la toca — justo el error que este
 * archivo existe para no cometer.
 *
 * Así que los mixtos no cuentan a favor. Se los nombra en la sección 1 para
 * que se vean, en vez de dejarlos contando callados.
 */
const deRed = specs.filter((s) => montaRed(s.fuente) && !montaEntrenamiento(s.fuente));
const mixtos = specs.filter((s) => montaRed(s.fuente) && montaEntrenamiento(s.fuente));

// =====================================================================
console.log("\n=== 1. Hay specs de red que mirar ===");
// =====================================================================
{
  // Si esto fallara, lo de abajo pasaría por vacío: cero specs de red dan
  // cero clics y la cuenta se leería como «no hay nada que cubrir».
  ok(deRed.length >= 8,
     `${deRed.length} specs montan SÓLO la mesa en red`,
     deRed.map((s) => s.nombre));

  // No se los exige, pero se los muestra: un clic de un archivo mixto no
  // prueba nada sobre la cadena en red, y conviene saber cuáles son.
  console.log(`  · y ${mixtos.length} montan las dos mesas, así que no cuentan:`,
              mixtos.map((s) => s.nombre).join(", "));
}

// =====================================================================
console.log("\n=== 2. Cada botón de turno lo aprieta alguien, en red ===");
// =====================================================================
{
  for (const [boton, formas] of Object.entries(BOTONES)) {
    const quienes = deRed
      .map((s) => ({ nombre: s.nombre, clics: cuentaDeClics(s.fuente, formas) }))
      .filter((s) => s.clics > 0);

    ok(quienes.length > 0,
       `${boton}: lo aprieta al menos un spec de red`,
       quienes.length ? quienes : "NADIE lo aprieta en red");
  }
}

// =====================================================================
console.log("\n=== 3. Y los dobles del servidor anotan la llamada ===");
// =====================================================================
{
  /*
   * La otra mitad del agujero, y la que de verdad dejó pasar el bug.
   *
   * Apretar el botón no sirve de nada si el doble de la función es
   * `async () => {}`: el clic sale, no pasa nada, y la prueba no tiene con qué
   * darse cuenta. Así estaba `cambiarCarta` el día que se rompió.
   *
   * Se pide que el doble ESCRIBA algo —`window.__pedidos`, o lo que ese spec
   * use para anotar— en los specs que además aprietan el botón. A los que no
   * lo aprietan no se les pide: un spec de la tienda no tiene por qué montar
   * un doble que anote jugadas que nunca va a hacer.
   */
  const FUNCIONES = {
    levantar: BOTONES.levantar,
    tirarCarta: BOTONES.tirar,
    cortar: BOTONES.cortar,
    pasarTurno: BOTONES.pasar,
  };

  for (const [funcion, formas] of Object.entries(FUNCIONES)) {
    const losQueAprietan = deRed.filter((s) => cuentaDeClics(s.fuente, formas) > 0);
    if (!losQueAprietan.length) continue;   // ya lo dijo la sección 2

    const sellosVacios = losQueAprietan.filter((s) => {
      // El cuerpo del doble, tal como lo declara el spec.
      const m = s.fuente.match(
        new RegExp(`export const ${funcion}\\s*=\\s*async\\s*\\([^)]*\\)\\s*=>\\s*\\{([^}]*)\\}`),
      );
      // Sin doble declarado no hay nada que reprochar: usa el módulo real.
      if (!m) return false;
      return m[1].trim() === "";
    });

    ok(sellosVacios.length === 0,
       `${funcion}: el doble anota la llamada en los specs que la ejercitan`,
       sellosVacios.map((s) => s.nombre));
  }
}

// =====================================================================
console.log("\n=== 4. Y este cerrojo se comprueba a sí mismo ===");
// =====================================================================
{
  /*
   * Una expresión regular que no engancha nada convierte a todo lo de arriba
   * en un «sí» automático. Se la prueba contra las dos formas escritas a mano,
   * y contra las que NO tienen que contar.
   */
  const SI = [
    'await page.locator(SEL.levantar).click();',
    'await page.locator("#btnLevantar").click();',
    "await page.locator('#btnLevantar').click();",
  ];
  const NO = [
    'await expect(page.locator(SEL.levantar)).toBeEnabled();',
    'await expect(page.locator("#btnLevantar")).toBeDisabled();',
    'const b = page.locator(SEL.levantar); await b.click();',
    'await page.locator(SEL.tirar).click();',
    // Y las dos formas de mencionarlo en un comentario, que no son cobertura.
    '// await page.locator(SEL.levantar).click();',
    '/* ejemplo: page.locator(SEL.levantar).click() */',
  ];

  ok(SI.every((t) => cuentaDeClics(t, BOTONES.levantar) === 1),
     "reconoce las dos formas de apretar el botón",
     SI.map((t) => cuentaDeClics(t, BOTONES.levantar)));
  ok(NO.every((t) => cuentaDeClics(t, BOTONES.levantar) === 0),
     "y no cuenta comprobar que está habilitado, ni el clic de otro botón",
     NO.map((t) => cuentaDeClics(t, BOTONES.levantar)));

  // Y que los dos detectores distingan, incluido el caso mixto que estuvo a
  // punto de dar por cubierta la cadena con un clic de entrenamiento.
  const deRedSuelto = 'await page.route("**/js/partida-red.js", (r) => r.fulfill(js(x)));';
  const entrenamientoSuelto = 'const errores = await abrirEntrenamiento(page);';

  ok(montaRed(deRedSuelto) && !montaEntrenamiento(deRedSuelto),
     "reconoce un spec de sólo red");
  ok(!montaRed(entrenamientoSuelto) && montaEntrenamiento(entrenamientoSuelto),
     "y uno de sólo entrenamiento");
  ok(montaRed(deRedSuelto + entrenamientoSuelto)
     && montaEntrenamiento(deRedSuelto + entrenamientoSuelto),
     "y marca el mixto como las dos cosas, para que no cuente a favor");
}

console.log(fallos ? `\n❌ ${fallos} FALLOS` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
