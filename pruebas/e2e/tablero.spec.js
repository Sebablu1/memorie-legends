/**
 * El tablero, que absorbió al lobby.
 *
 * No hay sesión de Firebase acá, así que `exigirSesion()` redirige a
 * `login.html`. Esa redirección se bloquea para poder mirar la página: lo que
 * se comprueba es lo que NO depende de estar logueado —que los módulos carguen,
 * que los controles existan con los ids acordados, que el desplegable se llene
 * de las reglas y que el campo de código se comporte—.
 *
 * Lo que sí depende de la sesión (crear sala, unirse, la tabla en vivo) lo
 * cubren las suites de Node contra las Cloud Functions.
 */

import { test, expect } from "@playwright/test";

/**
 * Un `sesion.js` de mentira, servido en lugar del real.
 *
 * Sin esto `exigirSesion()` manda a login.html y no queda nada que mirar. El
 * primer intento fue abortar esa navegación con `route.abort()`, y el
 * resultado era peor: la página quedaba muerta y las pruebas fallaban
 * diciendo "falta #entradaSala" cuando el problema era que no se estaba
 * mirando el tablero.
 *
 * Se sustituye el MÓDULO y no la autenticación de Firebase: es la frontera
 * más chica que hace falta cruzar, y deja correr el resto del tablero tal cual
 * se despliega.
 */
const SESION_FALSA = `
  export const COLECCION = "users";
  export const CAMPO_SALDO = "credits";
  export async function exigirSesion() {
    return {
      usuario: { uid: "uid-de-prueba", photoURL: null },
      perfil: { uid: "uid-de-prueba", nombre: "Probador", saldo: 500,
                partidas: 3, victorias: 1, ultimoGiro: 0, ultimoBono: 0 },
    };
  }
  export function mostrarSaldo() {}
  export function conectarBotonSalir() {}
  export function formatearEspera() { return "listo"; }
`;

/**
 * Elige un modo como lo hace un jugador: tocando la etiqueta.
 *
 * El radio está escondido a la vista —lo dibuja su `label`— así que `check()`
 * intenta pinchar una caja de un píxel y se choca con lo que tenga encima.
 * Tocar la etiqueta es lo que pasa de verdad, y de paso comprueba que la
 * etiqueta esté bien asociada a su radio.
 */
async function elegirModo(page, id) {
  await page.locator(`label[for="${id}"]`).click();
  await expect(page.locator(`#${id}`)).toBeChecked();
}

async function abrirTablero(page) {
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e.message)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|404|net::ERR|Firebase|permission/i.test(m.text())) {
      errores.push(m.text());
    }
  });

  await page.route("**/js/sesion.js", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: SESION_FALSA }),
  );

  await page.goto("/dashboard.html");
  // Se espera a que el desplegable TENGA opciones, no a que "se vea": un
  // <option> nunca cuenta como visible para Playwright, así que
  // `waitForSelector` se quedaba esperando algo que ya estaba ahí.
  await page.waitForFunction(
    () => document.querySelectorAll("#entradaSala option").length > 0,
    null,
    { timeout: 15_000 },
  );
  return errores;
}

test("los módulos cargan: ningún import roto", async ({ page }) => {
  const errores = await abrirTablero(page);
  await page.waitForTimeout(1500);
  // Un import mal escrito revienta antes de que corra una línea, así que esto
  // es lo que separa "la página anda" de "la página está en blanco".
  const deModulo = errores.filter((e) => /import|module|not defined|is not a function/i.test(e));
  expect(deModulo, `errores de módulo: ${deModulo.join(" | ")}`).toEqual([]);
});

test("están los controles con los ids acordados", async ({ page }) => {
  await abrirTablero(page);
  for (const id of ["entradaSala", "btnCrearSala", "codigoSala", "btnUnirse", "filasSalas"]) {
    await expect(page.locator(`#${id}`), `falta #${id}`).toHaveCount(1);
  }
  await expect(page.locator("#btnEntrenar")).toHaveAttribute("href", "mesa.html");
});

test("una sola caja de jugar, con el modo adentro", async ({ page }) => {
  await abrirTablero(page);

  // UNA caja, no dos tarjetas lado a lado: es el mismo juego, lo que cambia es
  // si la partida cuesta Leyendas.
  await expect(page.locator(".caja-jugar")).toHaveCount(1);
  await expect(page.locator("#modoEntrenamiento")).toHaveCount(1);
  await expect(page.locator("#modoLeyendas")).toHaveCount(1);

  // Arranca en entrenamiento: es el modo que no cuesta nada.
  await expect(page.locator("#modoEntrenamiento")).toBeChecked();
  await expect(page.locator("#panelEntrenamiento")).toBeVisible();
  await expect(page.locator("#panelLeyendas")).toBeHidden();
  await expect(page.locator("#btnEntrenar")).toBeVisible();

  // Al elegir Leyendas cambia lo que se ve, y aparecen los controles de sala.
  await elegirModo(page, "modoLeyendas");
  await expect(page.locator("#panelLeyendas")).toBeVisible();
  await expect(page.locator("#panelEntrenamiento")).toBeHidden();
  await expect(page.locator("#entradaSala")).toBeVisible();
  await expect(page.locator("#btnCrearSala")).toBeVisible();
  await expect(page.locator("#codigoSala")).toBeVisible();

  // Y se puede volver.
  await elegirModo(page, "modoEntrenamiento");
  await expect(page.locator("#panelEntrenamiento")).toBeVisible();
  await expect(page.locator("#panelLeyendas")).toBeHidden();
});

test("el logo carga y entra en la caja en cualquier pantalla", async ({ page }) => {
  // Esta prueba existe por dos cosas distintas que se rompen distinto.
  //
  // Que el archivo ESTÉ: un `src` mal escrito no rompe nada, no ensucia la
  // consola con un error de JavaScript y no lo ve nadie hasta que un jugador
  // abre el tablero y encuentra un hueco donde va la marca.
  //
  // Y que el tamaño CREZCA Y SE ACHIQUE: el logo es horizontal, y un ancho
  // fijo que se ve bien en el escritorio desborda la caja en un teléfono.
  for (const [donde, ancho] of [["escritorio", 1440], ["tablet", 768], ["móvil", 390], ["móvil chico", 320]]) {
    await page.setViewportSize({ width: ancho, height: 800 });
    await abrirTablero(page);

    const logo = page.locator(".caja-jugar .logo-caja");
    await expect(logo, `no hay logo en ${donde}`).toHaveCount(1);

    const m = await logo.evaluate((img) => {
      const r = img.getBoundingClientRect();
      const caja = img.closest(".caja-jugar").getBoundingClientRect();
      return {
        // `complete` sola dice "el navegador dejó de intentar", que también es
        // cierto cuando el archivo devolvió 404. El que separa las dos cosas
        // es `naturalWidth`: en una imagen rota vale 0.
        cargo: img.complete && img.naturalWidth > 0,
        ancho: r.width,
        // Cuánto se sale de la caja, por cualquiera de los dos lados.
        desborde: Math.max(0, r.right - caja.right, caja.left - r.left),
        texto: img.alt,
      };
    });

    expect(m.cargo, `la imagen del logo no cargó (¿falta public/img/memorie-legends.png?)`).toBe(true);
    expect(m.texto, "el logo necesita alt: es lo que se lee si no carga").toBeTruthy();
    expect(m.desborde, `el logo se sale ${m.desborde}px de la caja en ${donde}`).toBe(0);

    // Entre los dos extremos del clamp, con un pelín de margen por el redondeo.
    expect(m.ancho, `ancho raro en ${donde}: ${m.ancho}`).toBeGreaterThanOrEqual(89);
    expect(m.ancho, `ancho raro en ${donde}: ${m.ancho}`).toBeLessThanOrEqual(161);
  }

  // La página no queda con barra horizontal en el teléfono más chico.
  const seSale = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(seSale, "el tablero desborda a lo ancho en 320px").toBe(false);
});

test("las salas abiertas sólo se muestran en el modo por Leyendas", async ({ page }) => {
  // Un listado de salas por Leyendas no tiene sentido mientras se está
  // mirando el entrenamiento.
  await abrirTablero(page);
  await expect(page.locator(".panel-salas")).toBeHidden();

  await elegirModo(page, "modoLeyendas");
  await expect(page.locator(".panel-salas")).toBeVisible();
  await expect(page.locator(".panel-salas h2")).toContainText(/salas/i);
});

test("el título central y la tabla de salas", async ({ page }) => {
  await abrirTablero(page);
  await expect(page.locator(".titulo-elegir")).toHaveText(/cómo querés jugar/i);
  await elegirModo(page, "modoLeyendas");

  // Las cinco columnas pedidas.
  const encabezados = await page.locator(".tabla-salas thead th").allInnerTexts();
  expect(encabezados.length).toBe(5);
  expect(encabezados.slice(0, 4).join("|").toLowerCase()).toContain("código");
});

test("el desplegable de entradas sale de las reglas, no escrito a mano", async ({ page }) => {
  await abrirTablero(page);
  const { ENTRADAS } = await import("../../public/js/reglas/salas.js");
  const valores = await page.locator("#entradaSala option").evaluateAll(
    (os) => os.map((o) => Number(o.value)),
  );
  expect(valores).toEqual(ENTRADAS);
});

test("el campo de código fuerza mayúsculas y descarta lo que no va", async ({ page }) => {
  await abrirTablero(page);
  // Vive en el panel por Leyendas, que arranca escondido.
  await elegirModo(page, "modoLeyendas");
  const campo = page.locator("#codigoSala");
  await campo.fill("");
  await campo.type("ab-c 2*3");
  expect(await campo.inputValue()).toBe("ABC23");
  await expect(campo).toHaveAttribute("maxlength", "6");
});

test("el modo se puede elegir con el teclado", async ({ page }) => {
  // Ésta es la razón de usar `radio` de verdad y no dos botones con una clase
  // "activa": un radio ya sabe moverse con las flechas y llega marcado al
  // lector de pantalla, sin que haya que programar nada.
  await abrirTablero(page);
  await page.locator("#modoEntrenamiento").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#modoLeyendas")).toBeChecked();
  await expect(page.locator("#panelLeyendas")).toBeVisible();
});

test("el tablero no ofrece el lobby viejo por ningún lado", async ({ page }) => {
  await abrirTablero(page);
  const alLobby = await page.locator('a[href*="lobby"]').count();
  expect(alLobby, "el tablero no debe enlazar a lobby.html").toBe(0);
});

// =====================================================================
// La configuración del entrenamiento
// =====================================================================
//
// Esto vivía en `lobby.html`, una pantalla intermedia entre el tablero y la
// mesa. Ahora se elige acá y se entra de una.
//
// El canal con la mesa es `localStorage.configMesa`, así que lo que hay que
// comprobar no es qué se ve sino QUÉ SE ESCRIBE: la mesa no sabe nada de estos
// desplegables, sólo lee esa llave. Si la forma del objeto cambia sin querer,
// la mesa cae a su configuración por defecto y el jugador juega contra tres
// rivales que no eligió, sin ningún error a la vista.

/** Lo que quedó guardado para la mesa. */
const configGuardada = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("configMesa") ?? "null"));

/**
 * Deja que el enlace navegue, pero sirve una mesa vacía.
 *
 * La mesa de verdad exige sesión y, como acá no hay, se va sola a `login.html`
 * apenas carga. Esa segunda navegación destruía el contexto en mitad del
 * `page.evaluate` y las pruebas fallaban con "Execution context was destroyed"
 * — un error que no dice nada de lo que se estaba probando.
 *
 * Lo que se quiere comprobar es qué ESCRIBE el tablero antes de irse, así que
 * alcanza con que el destino exista y se quede quieto.
 */
const mesaQuieta = (page) =>
  page.route("**/mesa.html*", (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: "<!doctype html><title>mesa</title>",
    }),
  );

test("los dos selectores están, con sus opciones", async ({ page }) => {
  await abrirTablero(page);

  await expect(page.locator("#cantidadIAs")).toBeVisible();
  await expect(page.locator("#nivelIA")).toBeVisible();

  // Uno, dos o tres: son los asientos que hay alrededor de la mesa.
  expect(await page.locator("#cantidadIAs option").count()).toBe(3);

  // Los cuatro niveles del motor, más "mixto".
  const niveles = await page.locator("#nivelIA option").evaluateAll((os) =>
    os.map((o) => o.value),
  );
  expect(niveles).toEqual(["facil", "medio", "dificil", "experto", "mixto"]);
});

test("lo elegido llega a la mesa por localStorage", async ({ page }) => {
  await abrirTablero(page);
  await mesaQuieta(page);

  await page.selectOption("#cantidadIAs", "2");
  await page.selectOption("#nivelIA", "dificil");
  await page.locator("#btnEntrenar").click();
  await page.waitForURL(/mesa\.html/);

  const config = await configGuardada(page);
  expect(config.modo).toBe("entrenamiento");
  expect(config.ias).toHaveLength(2);
  expect(config.ias.every((ia) => ia.dificultad === "dificil")).toBe(true);

  // El nombre sale del perfil, no de un valor escrito a mano: es el que la
  // mesa muestra en el asiento de abajo.
  expect(config.humanos[0].nombre).toBe("Probador");
});

test("mixto reparte niveles DISTINTOS, que es lo único que significa", async ({
  page,
}) => {
  // Si "mixto" pusiera el mismo nivel a los tres, sería un quinto nivel
  // llamado raro. Lo que se compra al elegirlo es que no sean todos iguales.
  await abrirTablero(page);
  await mesaQuieta(page);

  await page.selectOption("#cantidadIAs", "3");
  await page.selectOption("#nivelIA", "mixto");
  await page.locator("#btnEntrenar").click();
  await page.waitForURL(/mesa\.html/);

  const config = await configGuardada(page);
  const niveles = config.ias.map((ia) => ia.dificultad);
  expect(niveles).toHaveLength(3);
  expect(new Set(niveles).size, `salieron repetidos: ${niveles.join(", ")}`).toBe(3);
  expect(niveles).not.toContain("mixto");
});

test("entrar a entrenar borra la sala vieja", async ({ page }) => {
  // Quien jugó por Leyendas tiene un `roomCode` guardado. Si queda ahí, la
  // mesa puede creerse en red y pedirle al servidor una partida que no existe.
  await abrirTablero(page);
  await mesaQuieta(page);
  await page.evaluate(() => localStorage.setItem("roomCode", "ABC234"));

  await page.locator("#btnEntrenar").click();
  await page.waitForURL(/mesa\.html/);

  expect(await page.evaluate(() => localStorage.getItem("roomCode"))).toBe(null);
});

test("la ayuda dice contra quién se va a jugar", async ({ page }) => {
  // "Mixto" es el que más lo necesita: sin esto no hay forma de saber contra
  // qué niveles se juega hasta estar sentado en la mesa.
  await abrirTablero(page);

  await page.selectOption("#cantidadIAs", "3");
  await page.selectOption("#nivelIA", "mixto");
  await expect(page.locator("#ayudaEntrenamiento")).toContainText(/Fácil/i);
  await expect(page.locator("#ayudaEntrenamiento")).toContainText(/Experto/i);

  await page.selectOption("#nivelIA", "facil");
  await expect(page.locator("#ayudaEntrenamiento")).toContainText(/Fácil/i);
  await expect(page.locator("#ayudaEntrenamiento")).not.toContainText(/Experto/i);
});

test("a la mesa se entra por el tablero, no desde el menú", async ({ page }) => {
  // El menú de las páginas con sesión llevaba directo a `mesa.html`, salteando
  // la configuración: se jugaba con lo último que hubiera quedado guardado, sin
  // pasar por los selectores de rivales y dificultad.
  //
  // Se leen las páginas servidas en vez de navegarlas: son HTML estático, así
  // que alcanza con pedirlas, y de paso se cubren de una vez todas las que
  // comparten el menú —incluidas las que exigen sesión, que habría que
  // falsificar una por una para visitarlas—.
  const conMenu = [
    "dashboard.html",
    "ranking.html",
    "ruleta.html",
    "tienda.html",
    "cuenta.html",
    "como-se-juega.html",
  ];

  for (const pagina of conMenu) {
    const html = await (await page.request.get(`/${pagina}`)).text();
    const aLaMesa = [...html.matchAll(/<a[^>]+href="[^"]*mesa\.html[^"]*"[^>]*>/g)].map(
      (m) => m[0],
    );

    // La única excepción es el botón de jugar del tablero: ése SÍ va a la mesa,
    // y es el que guarda la configuración antes de irse.
    const inesperados = aLaMesa.filter((a) => !a.includes('id="btnEntrenar"'));
    expect(
      inesperados,
      `${pagina} enlaza a la mesa sin pasar por la configuración: ${inesperados.join(" ")}`,
    ).toEqual([]);
  }
});

test("el ancla del menú cae en el panel de jugar", async ({ page }) => {
  // "Jugar" y "Inicio" apuntarían al mismo sitio si el enlace fuera sólo
  // `dashboard.html`: dos nombres para la misma cosa. Con el ancla, "Jugar"
  // deja al jugador mirando los selectores.
  await abrirTablero(page);
  await expect(page.locator('nav a[href="#jugar"]')).toBeVisible();
  await expect(page.locator("#jugar")).toContainText(/Elegí el modo/i);

  // Y el destino existe de verdad: un ancla rota no avisa, simplemente no
  // hace nada al tocarla.
  await expect(page.locator("#jugar #cantidadIAs")).toBeVisible();
});

test("la duración elegida viaja a la mesa como limitePuntos", async ({ page }) => {
  // La mesa no sabe nada de "corta" ni de "extendida": lee un número. Si el
  // tablero guardara la palabra en vez del número, el motor la ignoraría y
  // todas las partidas volverían a ser de 150 sin que nada fallara.
  await abrirTablero(page);
  await mesaQuieta(page);

  for (const [duracion, limite] of [
    ["corta", 60],
    ["normal", 100],
    ["extendida", 150],
  ]) {
    // Se vuelve al tablero en cada vuelta: el clic anterior navegó a la mesa,
    // y ahí ya no existe el desplegable. Las rutas quedaron registradas en la
    // página, así que alcanza con volver a pedirla.
    await page.goto("/dashboard.html");
    await page.waitForSelector("#tipoPartida");

    await page.selectOption("#tipoPartida", duracion);
    await page.locator("#btnEntrenar").click();
    await page.waitForURL(/mesa\.html/);

    const config = await configGuardada(page);
    expect(config.limitePuntos, `la partida ${duracion}`).toBe(limite);
  }
});

test("la duración viene en Extendida, que es la de siempre", async ({ page }) => {
  // Quien no toque nada tiene que jugar lo que jugaba antes de que estos modos
  // existieran. Un valor por defecto distinto cambiaría el juego para todos
  // sin avisar.
  await abrirTablero(page);
  await expect(page.locator("#tipoPartida")).toHaveValue("extendida");
});

test("la ayuda dice también con cuántos puntos se queda afuera", async ({ page }) => {
  await abrirTablero(page);

  await page.selectOption("#tipoPartida", "corta");
  await expect(page.locator("#ayudaEntrenamiento")).toContainText(/60 puntos/);

  await page.selectOption("#tipoPartida", "extendida");
  await expect(page.locator("#ayudaEntrenamiento")).toContainText(/150 puntos/);
});
