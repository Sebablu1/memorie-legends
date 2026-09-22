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
                partidas: 3, victorias: 1 },
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

/**
 * Un `servidor.js` de mentira: anota lo que se le pide y contesta.
 *
 * Las Cloud Functions no existen en esta suite. Lo que se comprueba acá es lo
 * del NAVEGADOR: qué llamada sale con qué largo de código, y que el código de
 * una sala privada no termine en la URL.
 */
const SERVIDOR_FALSO = `
  export class ErrorDeServidor extends Error {}
  window.__llamadas = [];
  export const crearSala = async (entrada, nombre, limitePuntos) => {
    window.__llamadas.push(["crearSala", entrada, limitePuntos]);
    return { codigo: "PUB123" };
  };
  export const crearSalaPrivada = async (entrada, nombre, limitePuntos) => {
    window.__llamadas.push(["crearSalaPrivada", entrada, limitePuntos]);
    // Como el real: el vencimiento es una hora del reloj, no una duración.
    return { sala: "SAL001", codigo: "K7M2PQRS", vence: Date.now() + 30 * 60_000 };
  };
  export const unirseASala = async (codigo) => {
    window.__llamadas.push(["unirseASala", codigo]);
    return { codigo };
  };
  export const unirseConCodigo = async (codigo) => {
    window.__llamadas.push(["unirseConCodigo", codigo]);
    return { sala: "SAL001" };
  };
  export const misItems = async () => ({ items: [] });
  export const misInsignias = async () => ({ insignias: [] });
  export const equiparItem = async () => ({});
  export const desequiparItem = async () => ({});
  export const listarTorneos = async () => ({ torneos: [] });
  export const inscribirseATorneo = async () => ({});
  // El resto de la puerta: un doble tiene que exportar TODO lo que exporta el
  // real, aunque esta prueba no lo use. Lo vigila pruebas/dobles-de-partida.mjs.
  export const revanchaDeSala = async () => ({});
  export const abandonarPartida = async () => ({});
  export const marcarListo = async () => ({});
  export const iniciarPartida = async () => ({});
  export const salirDeSalaEnEspera = async () => ({});
  export const reportarJugador = async () => ({});
  export const comprarItem = async () => ({});
  export const listarPacks = async () => ({ packs: [] });
  export const crearOrdenDeCompra = async () => ({});
  export const comprarPack = async () => ({});
`;

/**
 * El tablero con el servidor sustituido, en el modo por Leyendas y sin
 * navegar a ningún lado.
 */
async function tableroConServidorFalso(page) {
  await page.route("**/js/servidor.js", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: SERVIDOR_FALSO }),
  );
  // Ir a la sala es una navegación: se bloquea para poder mirar lo que quedó.
  await page.route("**/room.html*", (r) =>
    r.fulfill({ status: 200, contentType: "text/html", body: "<html><body>sala</body></html>" }),
  );
  const errores = await abrirTablero(page);
  // El panel de Leyendas está escondido hasta que se elige ese modo, y lo que
  // se prueba acá vive adentro.
  await elegirModo(page, "modoLeyendas");
  return errores;
}

test("la sala privada muestra su código, y el código no va en la URL", async ({ page }) => {
  await tableroConServidorFalso(page);

  // No hay nada que elegir: desde el tablero, toda sala es privada.
  await expect(page.locator("#salaPrivada"), "volvió la casilla de sala privada").toHaveCount(0);
  await expect(page.locator("#ayudaPrivada")).toHaveText(
    "Se creará una sala privada. Compartí el código con quien quieras invitar.",
  );

  await page.locator("#btnCrearSala").click();

  const caja = page.locator("#codigoPrivado");
  await expect(caja).toBeVisible();
  // En dos grupos, para leerlo y dictarlo.
  await expect(page.locator("#codigoPrivadoTexto")).toHaveText("K7M2 PQRS");
  await expect(caja).toContainText("Copiá este código ahora. No se vuelve a mostrar.");

  // Lo que se llamó, y lo que NO: el tablero ya no pasa por `crearSala`, que
  // es de la administración.
  const llamadas = await page.evaluate(() => window.__llamadas);
  expect(llamadas.map((l) => l[0])).toEqual(["crearSalaPrivada"]);

  // Y el código no está en la URL ni en el almacenamiento del navegador.
  expect(page.url()).not.toContain("K7M2PQRS");
  const guardado = await page.evaluate(() =>
    JSON.stringify([{ ...localStorage }, { ...sessionStorage }]),
  );
  expect(guardado, "el código quedó guardado en el navegador").not.toContain("K7M2PQRS");

  // Al entrar, lo que viaja es el identificador de la sala.
  await page.locator("#btnYaLoCopie").click();
  await expect.poll(() => page.url()).toContain("SAL001");
  expect(page.url()).not.toContain("K7M2PQRS");
});

/** El cartel del código, abierto con el portapapeles y el «compartir» anotados. */
async function abrirElCartel(page, { conCompartir = false } = {}) {
  await page.addInitScript((compartir) => {
    window.__copiado = null;
    window.__compartido = null;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (texto) => { window.__copiado = texto; } },
    });
    if (compartir) navigator.share = async (datos) => { window.__compartido = datos; };
    else delete Navigator.prototype.share;
  }, conCompartir);
  await tableroConServidorFalso(page);
  await page.locator("#btnCrearSala").click();
  await expect(page.locator("#codigoPrivado")).toBeVisible();
}

const MENSAJE =
  "Te invito a jugar Memorie Legends conmigo. Entrá a https://memorielegends.com/lobby.html " +
  "y usá el código K7M2PQRS para unirte a mi sala privada.";

test("el cartel dice cuánto vale el código, y se copia sin el espacio", async ({ page }) => {
  await abrirElCartel(page);

  // Los minutos salen del vencimiento que manda el servidor, no de un número
  // escrito en el tablero.
  await expect(page.locator("#vigenciaCodigo")).toHaveText("Vale 30 minutos.");

  // Se copia sin el espacio: el campo para entrar acepta ocho caracteres.
  await page.locator("#btnCopiarCodigoPrivado").click();
  await expect(page.locator("#btnCopiarCodigoPrivado")).toHaveText("¡Copiado!");
  expect(await page.evaluate(() => window.__copiado)).toBe("K7M2PQRS");
});

test("compartir por WhatsApp lleva el mensaje exacto, con el logo oficial", async ({ page }) => {
  await abrirElCartel(page);

  const enlace = page.locator("#enlaceWhatsApp");
  await expect(enlace).toHaveAttribute("href", `https://wa.me/?text=${encodeURIComponent(MENSAJE)}`);
  await expect(enlace).toHaveAttribute("target", "_blank");
  await expect(enlace).toHaveAttribute("rel", /noopener/);
  await expect(enlace).toContainText("Compartir por WhatsApp");
  // Como se VE, no como está escrito: los botones van en mayúsculas por CSS,
  // y la marca pide «WhatsApp» exactamente así.
  expect(await enlace.evaluate((a) => a.innerText.trim())).toBe("Compartir por WhatsApp");

  // El logo: el archivo del kit, cargado, chico, y sin tomar el lugar de la
  // palabra —por eso el `alt` vacío—.
  const logo = enlace.locator("img");
  await expect(logo).toHaveAttribute("src", "img/whatsapp/Digital_Glyph_Green_RGB_2026.svg");
  await expect(logo).toHaveAttribute("alt", "");
  const m = await logo.evaluate((img) => ({
    cargo: img.complete && img.naturalWidth > 0,
    ancho: img.getBoundingClientRect().width,
    alto: img.getBoundingClientRect().height,
  }));
  expect(m.cargo, "el logo de WhatsApp no cargó").toBe(true);
  expect(m.ancho).toBe(20);
  expect(m.alto).toBe(20);

  // El código sigue sin estar en ninguna dirección del sitio.
  expect(page.url()).not.toContain("K7M2PQRS");
});

test("«Compartir…» aparece sólo donde el navegador sabe compartir", async ({ page }) => {
  await abrirElCartel(page);
  await expect(page.locator("#btnCompartirCodigo")).toBeHidden();
});

test("y donde sabe, comparte el mismo mensaje", async ({ page }) => {
  await abrirElCartel(page, { conCompartir: true });
  const boton = page.locator("#btnCompartirCodigo");
  await expect(boton).toBeVisible();
  await boton.click();
  expect(await page.evaluate(() => window.__compartido)).toEqual({ text: MENSAJE });
});

test("«Mis salas» vacía invita a crear una privada", async ({ page }) => {
  await page.addInitScript(() => { window.__salas = []; });
  await page.route("**/js/firebase.js", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: FIREBASE_CON_SALAS }),
  );
  await abrirTablero(page);
  await elegirModo(page, "modoLeyendas");
  await expect(page.locator(".panel-salas h2")).toHaveText("🏠 Mis salas");
  await expect(page.locator("#salasVacias")).toHaveText(
    "No estás en ninguna sala. Creá una privada y compartí el código.",
  );
});

test("seis caracteres entran por una puerta y ocho por la otra", async ({ page }) => {
  await tableroConServidorFalso(page);

  // Seis: la puerta de siempre, donde el código ES la sala.
  await page.locator("#codigoSala").fill("ABC234");
  await page.locator("#btnUnirse").click();
  await expect.poll(() => page.url()).toContain("ABC234");

  // Ocho: la otra puerta. El servidor traduce el código a un identificador de
  // sala, y es ÉSE el que llega a la URL.
  await page.goto("/dashboard.html");
  await page.waitForFunction(() => document.querySelectorAll("#entradaSala option").length > 0);
  await elegirModo(page, "modoLeyendas");
  await page.locator("#codigoSala").fill("K7M2PQRS");
  await page.locator("#btnUnirse").click();

  await expect.poll(() => page.url()).toContain("SAL001");
  expect(page.url(), "el código privado terminó en la URL").not.toContain("K7M2PQRS");
});

/**
 * Un `firebase.js` de mentira que le entrega al tablero la lista de salas.
 *
 * Exporta todo lo que exporta el real —un `import` con nombre de algo que no
 * existe rompe el módulo entero al enlazarlo— y `onSnapshot` contesta con
 * `window.__salas`, que pone cada prueba.
 */
const FIREBASE_CON_SALAS = `
  export const app = {};
  export const auth = { currentUser: { uid: "uid-de-prueba" } };
  export const googleProvider = {};
  export const SUPPORT_EMAIL = "soporte@example.com";
  export async function createUserWithEmailAndPassword() { return { user: {} }; }
  export async function signInWithEmailAndPassword() { return { user: {} }; }
  export function onAuthStateChanged(a, fn) { setTimeout(() => fn({ uid: "uid-de-prueba" }), 0); return () => {}; }
  export async function signOut() {}
  export async function sendPasswordResetEmail() {}
  export const GoogleAuthProvider = class {};
  export async function signInWithPopup() { return { user: {} }; }
  export const db = {};
  export const funciones = {};
  export function httpsCallable() { return async () => ({ data: {} }); }
  export const doc = (...a) => a;
  export async function getDoc() { return { exists: () => false, data: () => undefined }; }
  export async function setDoc() {}
  export async function updateDoc() {}
  export const arrayUnion = (x) => x;
  export const arrayRemove = (x) => x;
  export const collection = (db, nombre) => ({ nombre });
  export const query = (c, ...filtros) => ({ ...c, filtros });
  export const where = (campo, op, valor) => ({ campo, op, valor });
  export const orderBy = () => ({});
  export const limit = () => ({});
  export async function getDocs() { return { docs: [], forEach() {} }; }
  export async function deleteDoc() {}
  export async function addDoc() { return {}; }
  export const serverTimestamp = () => null;
  export const increment = (n) => n;
  export async function runTransaction(f) { return f({}); }
  // Contesta DESPUÉS, como el real: Firestore nunca llama al oyente en el
  // mismo tick en que se lo registra. Llamándolo en el acto, el tablero
  // todavía no había terminado de cargar su módulo y \`filaDeSala\` se
  // encontraba con constantes sin inicializar.
  //
  // Y FILTRA, como el real: lo que devuelve es lo que la consulta pidió, no
  // todo. Cada consulta queda anotada en \`window.__consultas\` para ver qué
  // se pidió.
  export const onSnapshot = (ref, alRecibir) => {
    const filtros = ref?.filtros ?? [];
    (window.__consultas ??= []).push({ coleccion: ref?.nombre, filtros });
    const cumple = (s) => filtros.every(({ campo, op, valor }) =>
      op === "==" ? s[campo] === valor
      : op === "array-contains" ? (s[campo] ?? []).includes(valor)
      : true);
    setTimeout(() => {
      const salas = (window.__salas ?? []).filter(cumple);
      alRecibir({ docs: salas.map((s) => ({ data: () => s })) });
    }, 0);
    return () => {};
  };
`;

test("una sala privada propia se lista como privada, sin su identificador", async ({ page }) => {
  /**
   * La tabla le muestra a cada uno las salas en las que YA está: así se
   * vuelve después de un corte. Una privada propia aparece por eso — y
   * aparecía con su identificador bajo «Código», que no sirve para entrar y
   * que cualquiera podía copiar y pasar.
   *
   * Desde el Bloque 2 el tablero pide SÓLO las salas propias, así que la
   * pública ajena tampoco aparece: las públicas se ofrecen en el lobby.
   */
  await page.addInitScript(() => {
    window.__salas = [
      { codigo: "PUB234", estado: "esperando", entrada: 10, jugadores: ["otro"] },
      { codigo: "MESCME", estado: "esperando", entrada: 10, privada: true, listada: false,
        jugadores: ["uid-de-prueba"] },
      // Y una privada AJENA, que no tiene por qué aparecer.
      { codigo: "AJENA9", estado: "esperando", entrada: 10, privada: true, listada: false,
        jugadores: ["otro"] },
    ];
  });
  await page.route("**/js/firebase.js", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: FIREBASE_CON_SALAS }),
  );
  await abrirTablero(page);
  await elegirModo(page, "modoLeyendas");

  const filas = page.locator("#filasSalas tr");
  await expect(filas).toHaveCount(1);

  const tabla = await page.locator("#filasSalas").innerText();
  expect(tabla, "una sala ajena se coló en el tablero").not.toContain("PUB234");
  expect(tabla, "la privada propia se ve como privada").toMatch(/privada/i);
  expect(tabla, "el identificador de la privada quedó a la vista").not.toContain("MESCME");
  expect(tabla, "una privada ajena se coló en la tabla").not.toContain("AJENA9");
});

test("el tablero le pide a Firestore sólo las salas propias", async ({ page }) => {
  /**
   * Las reglas dejan leer una sala si es pública o si estás en ella, y una
   * consulta que PODRÍA traer una sala ajena la rechazan entera. Antes el
   * tablero pedía todas las salas en espera y filtraba después: con las
   * reglas nuevas esa consulta falla y la tabla queda vacía para siempre.
   *
   * Se mira la consulta misma —qué filtros lleva— y lo que termina en la
   * tabla con un Firestore de mentira que filtra como el real.
   */
  await page.addInitScript(() => {
    window.__salas = [
      { codigo: "MIA234", estado: "esperando", entrada: 10, jugadores: ["uid-de-prueba", "otro"] },
      { codigo: "PUB234", estado: "esperando", entrada: 10, publica: true, jugadores: ["otro"] },
      { codigo: "PRV234", estado: "esperando", entrada: 10, jugadores: ["otro"] },
      { codigo: "JUG234", estado: "jugando", entrada: 10, jugadores: ["uid-de-prueba"] },
    ];
  });
  await page.route("**/js/firebase.js", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: FIREBASE_CON_SALAS }),
  );
  await abrirTablero(page);
  await elegirModo(page, "modoLeyendas");

  const deSalas = await page.evaluate(() => (window.__consultas ?? []).filter((c) => c.coleccion === "rooms"));
  expect(deSalas.length, "el tablero no escuchó las salas").toBeGreaterThan(0);
  for (const { filtros } of deSalas) {
    expect(filtros, "la consulta no se limita a las salas propias").toContainEqual(
      { campo: "jugadores", op: "array-contains", valor: "uid-de-prueba" },
    );
    expect(filtros).toContainEqual({ campo: "estado", op: "==", valor: "esperando" });
  }

  await expect(page.locator("#filasSalas tr")).toHaveCount(1);
  const tabla = await page.locator("#filasSalas").innerText();
  expect(tabla).toContain("MIA234");
  for (const ajena of ["PUB234", "PRV234", "JUG234"]) expect(tabla).not.toContain(ajena);
});

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
  // Y que el tamaño CREZCA Y SE ACHIQUE: un ancho fijo que se ve bien en el
  // escritorio desborda la caja en un teléfono.
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

    expect(m.cargo, `la imagen del logo no cargó (¿falta public/img/escudo-320.webp?)`).toBe(true);
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
  // Ocho, no seis: el mismo campo recibe el código de una sala privada, que
  // es más largo. El de una sala normal sigue siendo de seis y lo comprueba
  // el servidor.
  await expect(campo).toHaveAttribute("maxlength", "8");
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

test("el tablero lleva al lobby, donde están las mesas públicas", async ({ page }) => {
  // Hubo un tiempo en que el lobby se había dado de baja y esta prueba exigía
  // lo contrario. Desde el rediseño, el tablero crea sólo salas privadas y las
  // públicas se juegan desde el lobby: el tablero tiene que llevar ahí.
  await abrirTablero(page);
  await elegirModo(page, "modoLeyendas");
  const boton = page.locator("a.enlace-ir-lobby");
  await expect(boton).toBeVisible();
  await expect(boton).toHaveText("Ir al lobby");
  await expect(boton).toHaveAttribute("href", "lobby.html");
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
    "tienda.html",
    "cuenta.html",
    "como-se-juega.html",
    "reglamento-partidas.html",
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

  // El menú vive en el cajón, así que hay que abrirlo para verlo. Antes estaba
  // suelto en la barra; el enlace es el mismo, cambió dónde se lo encuentra.
  await page.locator("#btnMenu").click();
  await expect(page.locator('#cajonMenu nav a[href="#jugar"]')).toBeVisible();

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

test("la ayuda repite la duración elegida", async ({ page }) => {
  await abrirTablero(page);

  await page.selectOption("#tipoPartida", "corta");
  await expect(page.locator("#ayudaEntrenamiento")).toContainText(/60 puntos/);

  await page.selectOption("#tipoPartida", "extendida");
  await expect(page.locator("#ayudaEntrenamiento")).toContainText(/150 puntos/);
});
