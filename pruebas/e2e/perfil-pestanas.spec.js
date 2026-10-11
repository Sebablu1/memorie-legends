/**
 * Las pestañas de «Mi perfil», y la dirección que las recuerda.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque `perfil.js` inventó un patrón que el sitio no tenía. Las otras dos
 * tiras de pestañas —la del ranking y la de la tienda— guardan el estado en
 * memoria y lo pierden al recargar; ésta lo escribe en la dirección, y de eso
 * dependen tres cosas que no se ven mirando la pantalla:
 *
 *   - Que la oferta de dos pasos del tablero pueda apuntar a una sección y no
 *     a «el perfil, y buscá vos».
 *   - Que recargar no te devuelva a la primera pestaña.
 *   - Que el botón «atrás» signifique «la página anterior» y no «la pestaña
 *     anterior», que es lo que pasa si uno escribe `location.hash = …` en vez
 *     de `history.replaceState`.
 *
 * Las tres son invisibles hasta que se rompen, y ninguna la cubre `sitio.mjs`
 * —que mira el HTML servido, no lo que hace el JavaScript—.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE SE AFIRMA ES EL CONTRATO, NO EL DIBUJO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `hidden` en los paneles y `aria-selected` en los botones. No se mira ningún
 * color ni ninguna clase de CSS: `.activa` se comprueba sólo para que la
 * marca visible y la accesible no se separen, que es el error clásico de una
 * pestaña —la que se ve encendida no es la que el lector de pantalla
 * anuncia—.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL CONTENIDO DE LOS PANELES NO SE PRUEBA ACÁ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * En esta etapa están vacíos a propósito: la mudanza es A2. Cuando llegue, lo
 * que vaya adentro se prueba por su cuenta —la colección ya tiene
 * `inventario.spec.js`— y este archivo sigue cubriendo lo único que es suyo,
 * que es el mecanismo de las pestañas.
 */

import { test, expect } from "@playwright/test";

const js = (body) => ({ status: 200, contentType: "text/javascript; charset=utf-8", body });

const SESION = `
  export const COLECCION = "users";
  export const CAMPO_SALDO = "credits";
  export async function exigirSesion() {
    return { usuario: { uid: "ana", email: "a@b.c", photoURL: null },
             perfil: { uid: "ana", nombre: "Ana", saldo: 777,
                       partidas: 42, victorias: 7 } };
  }
  export function mostrarSaldo(saldo) {
    const nodo = document.getElementById("saldoValor");
    if (nodo) nodo.textContent = String(saldo);
  }
  export function conectarBotonSalir() {}
`;

/** La misma puerta, pero cerrada: `exigirSesion` manda al login y no vuelve. */
const SIN_SESION = `
  export const COLECCION = "users";
  export const CAMPO_SALDO = "credits";
  export async function exigirSesion() {
    window.location.href = "login.html";
    return null;
  }
  export function mostrarSaldo() {}
  export function conectarBotonSalir() {}
`;

const SECCIONES = ["perfil", "coleccion", "logros", "numeros", "cuenta"];

async function abrirPerfil(page, { hash = "", sesion = SESION } = {}) {
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|404 \(Not Found\)/.test(m.text())) {
      errores.push(m.text());
    }
  });

  await page.route("**/js/sesion.js", (r) => r.fulfill(js(sesion)));
  await page.goto(`/perfil.html${hash}`);
  return errores;
}

/** Qué sección está a la vista, según las tres marcas que importan. */
const alaVista = (page) =>
  page.evaluate(() => {
    const paneles = [...document.querySelectorAll('[role="tabpanel"]')];
    const elegida = document.querySelector('[role="tab"][aria-selected="true"]');
    return {
      panelVisible: paneles.filter((p) => !p.hidden).map((p) => p.id),
      pestanaElegida: elegida?.dataset.panel ?? null,
      pestanasElegidas: document.querySelectorAll('[role="tab"][aria-selected="true"]').length,
      conClaseActiva: [...document.querySelectorAll(".pestana.activa")].map((b) => b.dataset.panel),
      hash: location.hash,
    };
  });

// =====================================================================
// 1. La sección por omisión
// =====================================================================

test("sin hash abre la primera, y las otras cuatro quedan escondidas", async ({ page }) => {
  const errores = await abrirPerfil(page);
  const v = await alaVista(page);

  expect(v.panelVisible, "tiene que haber exactamente un panel a la vista").toEqual(["panelPerfil"]);
  expect(v.pestanaElegida).toBe("perfil");
  expect(v.pestanasElegidas, "dos pestañas elegidas a la vez").toBe(1);
  expect(v.conClaseActiva, "la marca visible y la accesible, en la misma").toEqual(["perfil"]);

  expect(errores, `la página tiró errores: ${errores.join(" | ")}`).toEqual([]);
});

test("las cinco secciones están y cada una tiene su panel", async ({ page }) => {
  await abrirPerfil(page);

  /*
   * El par botón/panel se afirma por `aria-controls` y `aria-labelledby`, que
   * es lo que ata una pestaña a su contenido para quien no ve la pantalla. Si
   * alguien agrega una sexta sección y se olvida de uno de los dos, el panel
   * queda huérfano: se ve bien y no se anuncia.
   */
  await expect(page.locator('#pestanasPerfil [role="tab"]')).toHaveCount(SECCIONES.length);

  for (const seccion of SECCIONES) {
    const boton = page.locator(`#pestanasPerfil [data-panel="${seccion}"]`);
    await expect(boton, `falta la pestaña «${seccion}»`).toHaveCount(1);

    const idPanel = await boton.getAttribute("aria-controls");
    const panel = page.locator(`#${idPanel}`);
    await expect(panel, `«${seccion}» apunta a un panel que no existe`).toHaveCount(1);
    await expect(panel).toHaveAttribute("role", "tabpanel");
    await expect(panel).toHaveAttribute("aria-labelledby", (await boton.getAttribute("id")) ?? "");
  }
});

// =====================================================================
// 2. Tocar una pestaña
// =====================================================================

test("tocar una pestaña cambia el panel y escribe la dirección", async ({ page }) => {
  await abrirPerfil(page);

  await page.locator('[data-panel="numeros"]').click();

  const v = await alaVista(page);
  expect(v.panelVisible).toEqual(["panelNumeros"]);
  expect(v.pestanaElegida).toBe("numeros");
  expect(v.conClaseActiva).toEqual(["numeros"]);
  expect(v.hash, "la dirección no quedó apuntando a la sección").toBe("#numeros");
});

test("y no llena el historial: atrás sigue siendo la página anterior", async ({ page }) => {
  /*
   * ÉSTA ES LA RAZÓN DE `replaceState`.
   *
   * Con `location.hash = …` cada pestaña tocada deja una entrada. Quien mira
   * las cinco y aprieta «atrás» esperando volver al tablero lo aprieta cinco
   * veces y no entiende por qué.
   */
  await abrirPerfil(page);
  const antes = await page.evaluate(() => history.length);

  for (const seccion of ["coleccion", "logros", "numeros", "cuenta"]) {
    await page.locator(`[data-panel="${seccion}"]`).click();
  }

  const despues = await page.evaluate(() => history.length);
  expect(despues, "cada pestaña dejó una entrada en el historial").toBe(antes);
});

test("el foco va al panel, no se queda en la pestaña", async ({ page }) => {
  // Quien navega con teclado acaba de pedir ver algo: dejarle el foco en la
  // pestaña lo obliga a tabular hasta el contenido que pidió.
  await abrirPerfil(page);
  await page.locator('[data-panel="logros"]').click();

  const enfocado = await page.evaluate(() => document.activeElement?.id ?? null);
  expect(enfocado).toBe("panelLogros");
});

// =====================================================================
// 3. Llegar con la dirección puesta
// =====================================================================

for (const seccion of SECCIONES) {
  test(`entrar directo a #${seccion} abre esa sección`, async ({ page }) => {
    await abrirPerfil(page, { hash: `#${seccion}` });

    const v = await alaVista(page);
    expect(v.pestanaElegida).toBe(seccion);
    expect(v.panelVisible).toHaveLength(1);
  });
}

test("recargar deja la misma sección", async ({ page }) => {
  await abrirPerfil(page);
  await page.locator('[data-panel="cuenta"]').click();

  await page.reload();

  const v = await alaVista(page);
  expect(v.pestanaElegida, "la recarga volvió a la primera").toBe("cuenta");
  expect(v.panelVisible).toEqual(["panelCuenta"]);
});

test("un hash que no es ninguna sección cae en la primera, sin romperse", async ({ page }) => {
  /*
   * Puede llegar de un enlace viejo, de un dedo en la barra de direcciones o
   * de una sección que se renombró. Lo que NO puede pasar es que no se vea
   * ninguna pestaña: una página de perfil en blanco se lee como rota.
   */
  const errores = await abrirPerfil(page, { hash: "#noexiste" });

  const v = await alaVista(page);
  expect(v.pestanaElegida).toBe("perfil");
  expect(v.panelVisible).toEqual(["panelPerfil"]);
  expect(errores).toEqual([]);
});

test("cambiar el hash desde afuera mueve la pestaña", async ({ page }) => {
  // Es el caso de un enlace de otra pantalla a `perfil.html#cuenta` estando ya
  // en el perfil: el navegador no recarga, sólo dispara `hashchange`.
  await abrirPerfil(page);

  await page.evaluate(() => { window.location.hash = "#coleccion"; });

  await expect
    .poll(async () => (await alaVista(page)).pestanaElegida)
    .toBe("coleccion");
});

// =====================================================================
// 4. La colección vacía
// =====================================================================

test("sin colección que mostrar, la pestaña lo dice en vez de quedar en blanco", async ({ page }) => {
  /*
   * `montarInventario` destapa `#miInventario` sólo si el jugador tiene algo,
   * y se va sin tocar nada si no —o si el catálogo no contesta, que acá es lo
   * que pasa: este archivo no dobla `firebase.js` a propósito—.
   *
   * En el tablero, de donde esto se mudó, con eso alcanzaba: la sección no
   * aparecía entre otras siete y nadie la extrañaba. Acá es una pestaña
   * entera, y una pestaña en blanco se lee como una pantalla rota.
   */
  await abrirPerfil(page, { hash: "#coleccion" });

  await expect(page.locator("#sinColeccion")).toBeVisible();
  await expect(page.locator("#miInventario")).toBeHidden();
  await expect(page.locator("#sinColeccion")).toContainText("la tienda");
});

test("los números salen del perfil, sin pedir nada de nuevo", async ({ page }) => {
  await abrirPerfil(page, { hash: "#numeros" });

  // Son los del doble de `sesion.js`, que es el único que contesta acá.
  await expect(page.locator("#statSaldo")).toHaveText("777");
  await expect(page.locator("#statPartidas")).toHaveText("42");
  await expect(page.locator("#statVictorias")).toHaveText("7");
});

// =====================================================================
// 5. La puerta
// =====================================================================

test("sin sesión no se ve el perfil: manda al login", async ({ page }) => {
  await abrirPerfil(page, { sesion: SIN_SESION });

  await expect
    .poll(() => new URL(page.url()).pathname, { message: "se quedó en el perfil sin sesión" })
    .toBe("/login.html");
});

test("las pestañas andan aunque la sesión tarde", async ({ page }) => {
  /*
   * `perfil.js` engancha las pestañas ANTES de esperar la sesión, y esto es lo
   * que lo defiende. Al revés —primero la sesión, después las pestañas— hay un
   * rato, el que tarde Firebase en contestar, en el que tocar una pestaña no
   * hace nada: la pantalla está dibujada y no responde, que es la peor de las
   * dos esperas.
   */
  const LENTA = SESION.replace(
    "return { usuario:",
    "await new Promise((r) => setTimeout(r, 3000)); return { usuario:",
  );
  await abrirPerfil(page, { sesion: LENTA });

  // Todavía sin saldo: la sesión no contestó.
  await expect(page.locator("#saldoValor")).toHaveText("—");

  await page.locator('[data-panel="numeros"]').click();
  expect((await alaVista(page)).pestanaElegida, "la pestaña no respondió mientras cargaba").toBe("numeros");

  // Y cuando contesta, el saldo llega sin pisar la pestaña elegida.
  await expect(page.locator("#saldoValor")).toHaveText("777", { timeout: 10_000 });
  expect((await alaVista(page)).pestanaElegida).toBe("numeros");
});
