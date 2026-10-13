/**
 * El diseño de la mesa, desde el panel.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE ESTO VIGILA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El ciclo completo de la brújula: la de siempre, una propia, ninguna, y de
 * vuelta a la de siempre. Las cuatro son estados distintos y la cuarta es la
 * que más fácil se rompe — sin ella, cargar una brújula sería una decisión
 * sin vuelta atrás.
 *
 * Y lo que NO se puede guardar, que importa igual: una ruta de otro dominio
 * o una palabra suelta. El servidor lo valida con su esquema, pero esta
 * pantalla lo dice antes de salir a la red, y eso también se afirma.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SE MIRA LA LLAMADA, NO LA BASE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El doble de `httpsCallable` anota qué se pidió y con qué. Eso es lo que
 * esta pantalla decide; lo que el servidor hace con eso —borrar el campo,
 * mezclar con lo que había— es de `diseno-de-mesa.js` y se prueba en Node.
 *
 * La distinción importa en el caso de borrar: lo que esta pantalla tiene que
 * mandar es `null`, y no la cadena vacía. Si mandara `""`, el servidor lo
 * guardaría como un valor y la brújula de siempre no volvería nunca.
 */

import { test, expect } from "@playwright/test";

const ADMIN = "soporte.memorie.legends@gmail.com";

/**
 * El doble del servidor, con un diseño GUARDADO POR CONTEXTO.
 *
 * La clave `""` es la configuración general: el documento `config/mesa` que
 * esta pantalla escribía antes de que hubiera contextos. Las otras son los
 * cuatro contextos, con el mismo nombre que viaja en la llamada.
 *
 * Se indexa por CONTEXTO y no por nombre de documento a propósito: lo que
 * esta pantalla decide es a qué contexto escribir, y cómo se llama el
 * documento de cada uno es del servidor — se prueba en Node, con el nombre
 * escrito a mano.
 *
 * El fallback imita al de verdad: entero, no por campo. Si el contexto tiene
 * documento propio se usa ése aunque esté vacío, y `heredado` dice cuál de
 * las dos cosas pasó.
 */
const firebaseFalso = (porContexto) => `
  export const app = {}; export const auth = {};
  export const db = {}; export const funciones = {};
  export const googleProvider = {};
  export const SUPPORT_EMAIL = ${JSON.stringify(ADMIN)};

  window.__llamadas = [];
  window.__guardado = ${JSON.stringify(porContexto)};

  export function httpsCallable(_f, nombre) {
    return async (datos) => {
      window.__llamadas.push({ nombre, datos });
      const cual = datos?.contexto ?? "";
      if (nombre === "leerDisenoDeMesaAdmin") {
        const suyo = window.__guardado[cual];
        if (suyo) return { data: { diseno: suyo, propio: true, heredado: false } };
        const general = window.__guardado[""];
        return {
          data: { diseno: general ?? {}, propio: false, heredado: Boolean(general) },
        };
      }
      if (nombre === "guardarDisenoDeMesaAdmin") {
        // El servidor de verdad borra el campo con FieldValue.delete(); acá
        // alcanza con sacarlo, que es lo que el navegador va a volver a leer.
        // Y escribir crea el documento del contexto, que es lo que lo
        // desengancha de la general.
        const doc = (window.__guardado[cual] ??= {});
        for (const [k, v] of Object.entries(datos)) {
          if (k === "contexto") continue;
          if (v === null) delete doc[k];
          else doc[k] = v;
        }
        const campos = Object.keys(datos).filter((k) => k !== "contexto");
        return { data: { guardado: campos.length > 0, campos } };
      }
      if (nombre === "listarCatalogoAdmin") return { data: { items: [] } };
      if (nombre === "listarSalasAdmin") {
        return { data: { salas: [], partidas: [], muertas: [], totales: { salas: 0, partidas: 0, muertas: 0, leyendasRetenidas: 0 } } };
      }
      if (nombre === "listarTorneosAdmin") return { data: { torneos: [] } };
      if (nombre === "leerUmbralesAdmin") return { data: { umbrales: {} } };
      return { data: {} };
    };
  }
  export function onAuthStateChanged(a, fn) {
    setTimeout(() => fn({ email: ${JSON.stringify(ADMIN)}, uid: "admin" }), 60);
    return () => {};
  }
  export async function signInWithEmailAndPassword(){}
  export async function signInWithPopup(){}
  export function signOut(){}
`;

async function abrirPanelCon(page, porContexto) {
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));
  await page.route("**/js/firebase.js", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: firebaseFalso(porContexto) }));
  await page.goto("/admin/index.html");
  await page.waitForSelector("#mesaBrujula");
  return errores;
}

/**
 * El panel con la configuración GENERAL puesta, y ninguna propia.
 *
 * Es el estado de producción: lo único que existe es lo que esta pantalla
 * guardó antes de que hubiera contextos. Así que el panel abre mostrando
 * eso, heredado, sobre la mesa que viene elegida.
 */
const abrirPanel = (page, guardado = {}) => abrirPanelCon(page, { "": guardado });

/** El contexto que el panel trae elegido al abrir. */
const CONTEXTO_INICIAL = "entrenamiento";

/** Lo último que se le pidió al servidor para guardar. */
const ultimoGuardado = (page) =>
  page.evaluate(() =>
    [...window.__llamadas].reverse().find((l) => l.nombre === "guardarDisenoDeMesaAdmin")?.datos ?? null);

// =====================================================================
// 1. El ciclo completo
// =====================================================================

test("sin nada guardado, el campo arranca vacío", async ({ page }) => {
  // Vacío quiere decir «la de siempre». No se escribe la ruta del SVG actual
  // para no hacerle creer a nadie que está configurada cuando no lo está.
  const errores = await abrirPanel(page, {});

  await expect(page.locator("#mesaBrujula")).toHaveValue("");
  expect(errores, errores.join(" | ")).toEqual([]);
});

test("lo que ya estaba guardado se muestra", async ({ page }) => {
  await abrirPanel(page, { brujula: "/img/mesa/brujulas/suya.webp" });

  await expect(page.locator("#mesaBrujula")).toHaveValue("/img/mesa/brujulas/suya.webp");
});

test("guardar una ruta la manda tal cual", async ({ page }) => {
  await abrirPanel(page, {});

  await page.fill("#mesaBrujula", "/img/mesa/brujulas/nueva.webp");
  await page.click("#btnGuardarMesa");

  // Van los DOS campos: «Guardar» guarda el formulario, y el formulario se
  // cargó con lo que había. La sala vacía viaja como `null` porque vacío
  // quiere decir «dejá la de siempre».
  //
  // Y va el contexto, que es A CUÁL de las cuatro mesas se escribe. Sin él
  // el servidor escribiría la configuración general, que es la que ven las
  // otras tres.
  await expect.poll(() => ultimoGuardado(page))
    .toEqual({ brujula: "/img/mesa/brujulas/nueva.webp", sala: null, contexto: CONTEXTO_INICIAL });
  await expect(page.locator("#avisoMesa")).toContainText(/Listo/i);
});

test("«ninguna» se guarda como palabra, no como ruta", async ({ page }) => {
  /*
   * Es la tercera opción: ni la de siempre ni una propia, sino que no haya
   * brújula. Tiene que llegar al servidor como la palabra, porque es lo que
   * su esquema acepta además de una ruta.
   */
  await abrirPanel(page, {});

  await page.fill("#mesaBrujula", "ninguna");
  await page.click("#btnGuardarMesa");

  await expect.poll(() => ultimoGuardado(page)).toEqual({ brujula: "ninguna", sala: null, contexto: CONTEXTO_INICIAL });
});

test("vaciar el campo manda null, que es volver a la de siempre", async ({ page }) => {
  /*
   * El caso que hace que cargar una brújula no sea una decisión sin vuelta.
   *
   * Y tiene que ser `null`, no `""`: la cadena vacía se guardaría como un
   * valor y la brújula de siempre no volvería nunca. Es la diferencia entre
   * borrar el campo y escribirle nada.
   */
  await abrirPanel(page, { brujula: "/img/mesa/brujulas/suya.webp" });
  await expect(page.locator("#mesaBrujula")).toHaveValue("/img/mesa/brujulas/suya.webp");

  await page.fill("#mesaBrujula", "");
  await page.click("#btnGuardarMesa");

  await expect.poll(() => ultimoGuardado(page)).toEqual({ brujula: null, sala: null, contexto: CONTEXTO_INICIAL });
  await expect(page.locator("#mesaBrujula")).toHaveValue("");
});

test("y el botón de volver atrás hace lo mismo sin tener que borrar a mano", async ({ page }) => {
  await abrirPanel(page, { brujula: "/img/mesa/brujulas/suya.webp" });

  await page.click("#btnBorrarBrujula");

  // Manda el formulario entero con la brújula apagada: la sala estaba vacía,
  // así que viaja como `null`, que es «dejá la de siempre».
  await expect.poll(() => ultimoGuardado(page))
    .toEqual({ brujula: null, sala: null, contexto: CONTEXTO_INICIAL });
  await expect(page.locator("#mesaBrujula")).toHaveValue("");
});

// =====================================================================
// 2. Lo que no se manda
// =====================================================================

test("una ruta de otro dominio se rechaza sin salir a la red", async ({ page }) => {
  await abrirPanel(page, {});

  await page.fill("#mesaBrujula", "https://otro.com/brujula.webp");
  await page.click("#btnGuardarMesa");

  await expect(page.locator("#avisoMesa")).toContainText(/\/img\//);
  expect(await ultimoGuardado(page), "salió igual a la red").toBeNull();
});

test("y una palabra cualquiera también", async ({ page }) => {
  // `ninguna` es la única palabra que significa algo. Cualquier otra es un
  // error de tipeo, y aceptarla dejaría la mesa sin brújula sin querer.
  await abrirPanel(page, {});

  await page.fill("#mesaBrujula", "ningina");
  await page.click("#btnGuardarMesa");

  await expect(page.locator("#avisoMesa")).toContainText(/ninguna/i);
  expect(await ultimoGuardado(page)).toBeNull();
});

// =====================================================================
// 3. Y no es el catálogo
// =====================================================================

test("la brújula NO aparece entre los tipos de artículo del catálogo", async ({ page }) => {
  /*
   * La distinción que sostiene toda la fase. El desplegable de artículos se
   * arma solo desde `TIPOS_VALIDOS`: si la brújula se colara ahí, se podría
   * crear un ARTÍCULO «brujula-mesa», con precio y equipable.
   */
  await abrirPanel(page, {});

  const tipos = await page.locator("#itemTipo option").allTextContents();
  expect(tipos.join(" "), tipos.join(", ")).not.toMatch(/brujula/i);
});

// =====================================================================
// 4. La sala: imagen o color, en un solo campo
// =====================================================================

test("una ruta se guarda como ruta", async ({ page }) => {
  await abrirPanel(page, {});

  await page.fill("#mesaSala", "/img/mesa/salas/cueva.webp");
  await page.click("#btnGuardarMesa");

  await expect.poll(() => ultimoGuardado(page))
    .toEqual({ brujula: null, sala: "/img/mesa/salas/cueva.webp", contexto: CONTEXTO_INICIAL });
});

test("un color se guarda en HEXADECIMAL, no como degradado armado", async ({ page }) => {
  /*
   * El degradado lo arma `capaDeSala` al DIBUJAR, no el panel al guardar.
   *
   * Si acá se guardara `linear-gradient(#1a1a2e, #1a1a2e)`, la base quedaría
   * con un detalle de CSS en vez del dato, y el día que la capa se dibuje de
   * otra forma —o que alguien quiera leer qué color es— habría que migrar
   * documentos para recuperar una información que ya estaba.
   */
  await abrirPanel(page, {});

  await page.fill("#mesaSala", "#1a1a2e");
  await page.click("#btnGuardarMesa");

  await expect.poll(() => ultimoGuardado(page))
    .toEqual({ brujula: null, sala: "#1a1a2e", contexto: CONTEXTO_INICIAL });
});

test("vaciar la sala manda null, que es volver a la de siempre", async ({ page }) => {
  await abrirPanel(page, { sala: "#101010" });
  await expect(page.locator("#mesaSala")).toHaveValue("#101010");

  await page.fill("#mesaSala", "");
  await page.click("#btnGuardarMesa");

  await expect.poll(() => ultimoGuardado(page)).toEqual({ brujula: null, sala: null, contexto: CONTEXTO_INICIAL });
});

test("y su botón de volver atrás toca SÓLO la sala", async ({ page }) => {
  /*
   * La diferencia con «Guardar»: deshacer una cosa puntual no puede tocar la
   * otra. Si mandara los dos campos, volver a la sala de siempre borraría
   * una brújula que alguien acababa de cargar.
   */
  await abrirPanel(page, { brujula: "/img/mesa/brujulas/suya.webp", sala: "#101010" });

  await page.click("#btnBorrarSala");

  /*
   * La brújula VIAJA, con el mismo valor que ya estaba.
   *
   * Mandar la sala sola parecía más prolijo y tenía un agujero: sobre una
   * mesa que hereda la general, un único campo borrado le crea documento
   * propio igual, y como el fallback es por documento entero la mesa perdía
   * también la brújula. Reenviándola, lo guardado cambia sólo en la sala.
   */
  await expect.poll(() => ultimoGuardado(page))
    .toEqual({ brujula: "/img/mesa/brujulas/suya.webp", sala: null, contexto: CONTEXTO_INICIAL });
  await expect(page.locator("#mesaSala")).toHaveValue("");
  await expect(page.locator("#mesaBrujula"), "se llevó puesta la brújula")
    .toHaveValue("/img/mesa/brujulas/suya.webp");
});

test("algo que no es ni ruta ni color se rechaza sin salir a la red", async ({ page }) => {
  await abrirPanel(page, {});

  await page.fill("#mesaSala", "azul oscuro");
  await page.click("#btnGuardarMesa");

  await expect(page.locator("#avisoMesa")).toContainText(/hexadecimal/i);
  expect(await ultimoGuardado(page), "salió igual a la red").toBeNull();
});

test("el panel dice qué entendió mientras se escribe", async ({ page }) => {
  /*
   * Un `#1a1a2` de cinco dígitos se parece a uno válido. Decirlo en el
   * momento evita guardar algo que el servidor rechace — y, peor, algo que
   * ACEPTE y no haga nada.
   */
  await abrirPanel(page, {});
  const leido = page.locator("#mesaSalaLeido");

  await expect(leido).toContainText(/de siempre/i);

  await page.fill("#mesaSala", "/img/x.webp");
  await expect(leido).toContainText(/imagen/i);

  await page.fill("#mesaSala", "#1a1a2e");
  await expect(leido).toContainText(/color/i);

  await page.fill("#mesaSala", "#1a1a2");
  await expect(leido).toContainText(/no se entiende/i);
});

// =====================================================================
// 5. Cuatro mesas, un formulario
// =====================================================================

/** Lo que el doble tiene guardado, por contexto. */
const guardadoDe = (page, cual) =>
  page.evaluate((c) => window.__guardado[c] ?? null, cual);

test("el selector tiene las cuatro mesas, torneo incluido", async ({ page }) => {
  /*
   * Las opciones se arman desde `CONTEXTOS_VALIDOS`, así que un contexto
   * nuevo aparece solo. Esta prueba es la que hace que «aparece solo» no sea
   * una promesa: si alguien armara el desplegable a mano en el HTML y se
   * olvidara uno, esa mesa no se podría vestir desde ningún lado.
   *
   * Torneo está aunque todavía no haya ninguna mesa de torneo que lo lea: se
   * guarda ahora para no tener que volver acá cuando la haya.
   */
  await abrirPanel(page, {});

  const valores = await page.locator("#mesaContexto option").evaluateAll(
    (ops) => ops.map((o) => o.value));
  expect(valores).toEqual(["entrenamiento", "publica", "privada", "torneo"]);

  const textos = await page.locator("#mesaContexto option").allTextContents();
  expect(textos.join(" | "), "alguna opción quedó sin nombre en castellano")
    .not.toMatch(/\b(entrenamiento|publica|privada|torneo)\b/);
});

test("guardar escribe en la mesa elegida, no en la general", async ({ page }) => {
  /*
   * LA AFIRMACIÓN QUE SOSTIENE LA FASE.
   *
   * Un panel que se olvidara el contexto se vería funcionando: el aviso
   * diría «listo», y lo guardado aparecería al recargar — porque la mesa
   * elegida hereda la general, así que lo escribido ahí vuelve igual. La
   * única forma de notarlo es mirar DÓNDE quedó.
   */
  await abrirPanelCon(page, { "": {} });

  await page.selectOption("#mesaContexto", "publica");
  await page.fill("#mesaBrujula", "/img/mesa/brujulas/de-la-publica.webp");
  await page.click("#btnGuardarMesa");

  await expect.poll(() => guardadoDe(page, "publica"))
    .toEqual({ brujula: "/img/mesa/brujulas/de-la-publica.webp" });
  expect(await guardadoDe(page, ""), "le escribió a la general").toEqual({});
});

test("cambiar de mesa muestra la de esa mesa", async ({ page }) => {
  await abrirPanelCon(page, {
    entrenamiento: { brujula: "/img/mesa/brujulas/sola.webp" },
    publica: { brujula: "/img/mesa/brujulas/multi.webp", sala: "#101010" },
  });

  await expect(page.locator("#mesaBrujula")).toHaveValue("/img/mesa/brujulas/sola.webp");
  await expect(page.locator("#mesaSala")).toHaveValue("");

  await page.selectOption("#mesaContexto", "publica");

  await expect(page.locator("#mesaBrujula")).toHaveValue("/img/mesa/brujulas/multi.webp");
  await expect(page.locator("#mesaSala")).toHaveValue("#101010");

  // Y de vuelta: no es que se quede con la última, es que lee cada vez.
  await page.selectOption("#mesaContexto", "entrenamiento");
  await expect(page.locator("#mesaSala")).toHaveValue("");
});

test("guardar una mesa no toca a las otras", async ({ page }) => {
  await abrirPanelCon(page, {
    entrenamiento: { brujula: "/img/mesa/brujulas/sola.webp" },
    publica: { brujula: "/img/mesa/brujulas/multi.webp" },
  });

  await page.selectOption("#mesaContexto", "publica");
  await page.fill("#mesaBrujula", "/img/mesa/brujulas/otra.webp");
  await page.click("#btnGuardarMesa");
  // `sala: null` BORRA: lo que queda guardado no tiene la clave.
  await expect.poll(() => guardadoDe(page, "publica"))
    .toEqual({ brujula: "/img/mesa/brujulas/otra.webp" });

  expect(await guardadoDe(page, "entrenamiento"), "se llevó puesta la de entrenamiento")
    .toEqual({ brujula: "/img/mesa/brujulas/sola.webp" });
});

test("una mesa que hereda lo dice, y una propia también", async ({ page }) => {
  /*
   * Editar lo propio y editar una copia de la general se ven idénticos en el
   * formulario, y sólo uno de los dos desengancha esta mesa para siempre.
   */
  await abrirPanelCon(page, {
    "": { brujula: "/img/mesa/brujulas/general.webp" },
    publica: { brujula: "/img/mesa/brujulas/propia.webp" },
  });

  const dice = page.locator("#mesaContextoLeido");

  // Entrenamiento no tiene el suyo: muestra la general, prestada.
  await expect(dice).toContainText(/hereda/i);
  await expect(page.locator("#mesaBrujula")).toHaveValue("/img/mesa/brujulas/general.webp");

  await page.selectOption("#mesaContexto", "publica");
  await expect(dice).toContainText(/propia/i);
  await expect(dice, "sigue diciendo que hereda").not.toContainText(/hereda/i);
});

test("guardar sobre una mesa que hereda la desengancha, y se nota", async ({ page }) => {
  await abrirPanelCon(page, { "": { brujula: "/img/mesa/brujulas/general.webp" } });
  await expect(page.locator("#mesaContextoLeido")).toContainText(/hereda/i);

  await page.click("#btnGuardarMesa");

  await expect(page.locator("#mesaContextoLeido")).toContainText(/propia/i);
  // Adoptó lo que mostraba: la mesa se ve igual que antes de guardar.
  await expect.poll(() => guardadoDe(page, "entrenamiento"))
    .toEqual({ brujula: "/img/mesa/brujulas/general.webp" });
});

test("los botones de volver atrás también mandan el contexto", async ({ page }) => {
  /*
   * Es el camino más fácil de romper: son dos botones que mandan un solo
   * campo, y si se olvidaran el contexto borrarían el de la configuración
   * GENERAL —la que ven las otras tres mesas— mientras el aviso dice que
   * todo salió bien.
   */
  await abrirPanelCon(page, {
    "": { brujula: "/img/mesa/brujulas/general.webp" },
    publica: { brujula: "/img/mesa/brujulas/propia.webp", sala: "#101010" },
  });

  await page.selectOption("#mesaContexto", "publica");
  await page.click("#btnBorrarBrujula");

  await expect.poll(() => ultimoGuardado(page))
    .toEqual({ brujula: null, sala: "#101010", contexto: "publica" });
  await expect.poll(() => guardadoDe(page, "publica")).toEqual({ sala: "#101010" });
  expect(await guardadoDe(page, ""), "le borró la brújula a la general")
    .toEqual({ brujula: "/img/mesa/brujulas/general.webp" });
});

test("volver atrás sobre una mesa que hereda no se lleva el otro campo", async ({ page }) => {
  /*
   * EL CASO QUE HIZO CAMBIAR LOS BOTONES.
   *
   * La mesa hereda la general, que tiene las dos cosas puestas. Volver a la
   * sala de siempre le crea documento propio —eso es inevitable, es lo que
   * significa dejar de heredar— pero la brújula tiene que seguir ahí.
   *
   * Con un solo campo por botón, lo guardado quedaba vacío y la mesa perdía
   * la brújula mientras el aviso decía que todo había salido bien.
   */
  await abrirPanelCon(page, {
    "": { brujula: "/img/mesa/brujulas/general.webp", sala: "#101010" },
  });

  await page.click("#btnBorrarSala");

  await expect.poll(() => guardadoDe(page, "entrenamiento"))
    .toEqual({ brujula: "/img/mesa/brujulas/general.webp" });
  await expect(page.locator("#mesaBrujula")).toHaveValue("/img/mesa/brujulas/general.webp");
  await expect(page.locator("#mesaContextoLeido")).toContainText(/propia/i);
});

test("y arrastra lo que haya escrito sin guardar en el otro campo", async ({ page }) => {
  /*
   * La contracara de mandar el formulario: lo que viaja es LO QUE SE VE, así
   * que un valor tipeado en el otro campo se guarda también.
   *
   * Queda afirmado para que sea una decisión y no una sorpresa. Lo contrario
   * —mandar el valor que trajo el servidor en vez del que está a la vista—
   * descartaría silenciosamente algo que la persona acaba de escribir, que
   * es peor.
   */
  await abrirPanelCon(page, { "": { brujula: "/img/mesa/brujulas/vieja.webp" } });

  await page.fill("#mesaBrujula", "/img/mesa/brujulas/tipeada.webp");
  await page.click("#btnBorrarSala");

  await expect.poll(() => ultimoGuardado(page))
    .toEqual({ brujula: "/img/mesa/brujulas/tipeada.webp", sala: null, contexto: CONTEXTO_INICIAL });
});

test("y algo inválido en el otro campo frena el botón", async ({ page }) => {
  /*
   * Incómodo y correcto: para poder deshacer no se escribe un documento a
   * medio validar. El aviso dice qué campo lo frena.
   */
  await abrirPanelCon(page, { "": { sala: "#101010" } });

  await page.fill("#mesaBrujula", "https://otro.com/x.webp");
  await page.click("#btnBorrarSala");

  await expect(page.locator("#avisoMesa")).toContainText(/\/img\//);
  expect(await ultimoGuardado(page), "salió igual a la red").toBeNull();
});

// =====================================================================
// 6. De quién es lo que el panel muestra
// =====================================================================

test("con la base vacía, el panel NO dice que la mesa tenga lo suyo", async ({ page }) => {
  /*
   * Es el estado de producción de hoy: no existe ni `config/mesa`.
   *
   * Con dos mensajes, esto caía en «tiene su propia configuración» y el
   * panel lo decía con la cara seria sobre una base vacía. Son tres estados
   * y necesitan tres palabras.
   */
  await abrirPanelCon(page, {});
  const dice = page.locator("#mesaContextoLeido");

  await expect(dice).toContainText(/todavía no hay nada/i);
  await expect(dice, "dijo que la mesa tiene lo suyo").not.toContainText(/propia/i);
  await expect(dice, "dijo que hereda algo que no existe").not.toContainText(/hereda/i);
});

test("un documento propio VACÍO es propio, no «no hay nada»", async ({ page }) => {
  /*
   * EL CASO QUE OBLIGA A QUE EL SERVIDOR MANDE LA BANDERA.
   *
   * Vaciar los dos campos y guardar es la forma de decir «esta mesa usa la
   * de siempre y NO hereda la general». El diseño que llega es `{}`, igual
   * que cuando no hay nada: mirar el diseño no alcanza, hay que saber si el
   * documento existe.
   */
  await abrirPanelCon(page, { "": { sala: "#101010" }, entrenamiento: {} });
  const dice = page.locator("#mesaContextoLeido");

  await expect(dice).toContainText(/propia/i);
  await expect(dice, "lo confundió con la base vacía").not.toContainText(/no hay nada/i);
  // Y no muestra la general, porque esta mesa dejó de heredarla.
  await expect(page.locator("#mesaSala")).toHaveValue("");
});
