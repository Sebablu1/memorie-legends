/**
 * El botón de comprar Leyendas: quién lo ve encendido y qué pasa al tocarlo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE ESTA SUITE DEFIENDE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Es la única pantalla del juego donde alguien entrega dinero de verdad, y la
 * parte del navegador estuvo sin escribir durante meses: el servidor cobraba
 * —orden, preferencia, webhook firmado, acreditación idempotente— y el botón
 * nacía `disabled` sin ningún manejador. Se mandó a probar el flujo de pago
 * dos veces antes de que alguien notara que no había por dónde empezarlo.
 *
 * Así que lo que se prueba acá no es el pago —eso vive en el servidor y en
 * `pruebas/pagos.mjs`— sino que el camino EXISTA y que no haga ninguna de las
 * tres cosas que arruinan una compra: cobrar dos veces, mandar al lugar
 * equivocado, o fallar sin decir nada.
 */

import { test, expect } from "@playwright/test";

const js = (body) => ({ status: 200, contentType: "text/javascript; charset=utf-8", body });

const SESION_FALSA = `
  export const COLECCION = "users";
  export const CAMPO_SALDO = "credits";
  export async function exigirSesion() {
    return {
      usuario: { uid: "ana", email: "a@b.c", photoURL: null },
      perfil: {
        uid: "ana", nombre: "Ana", saldo: 500, comprado: 0, ganado: 500,
        partidas: 0, victorias: 0,
        equipado: { avatar: null, insignia: null, dorso: null },
      },
    };
  }
  export function mostrarSaldo() {}
  export function conectarBotonSalir() {}
  export function formatearEspera() { return "listo"; }
  export async function leerPerfil() { return {}; }
  export async function guardarEnPerfil() {}
`;

const PACK = {
  id: "pack_basico",
  nombre: "Pack Básico",
  leyendasBase: 500,
  leyendasRegalo: 0,
  precioUYU: 250,
  activo: true,
  itemsExclusivos: [],
};

/**
 * El doble de `servidor.js`.
 *
 * `window.__compra` es lo que contesta el servidor sobre quién puede comprar y
 * si estamos en sandbox. `window.__llamadas` cuenta: es lo que permite afirmar
 * que dos clics seguidos NO son dos órdenes.
 */
const servidorFalso = (respuesta) => `
  export class ErrorDeServidor extends Error {
    constructor(mensaje, codigo) { super(mensaje); this.name = "ErrorDeServidor"; this.codigo = codigo; }
  }
  export async function listarPacks() {
    return { packs: [${JSON.stringify(PACK)}], compra: window.__compra };
  }
  export async function crearOrdenDeCompra(paqueteId) {
    window.__llamadas = (window.__llamadas ?? 0) + 1;
    window.__ultimoPaquete = paqueteId;
    ${respuesta}
  }
  export async function comprarItem() { return {}; }
  export async function equiparItem() { return {}; }
  export async function desequiparItem() { return {}; }
  export async function comprarPack() { return {}; }
  export async function misItems() { return { items: [] }; }
  export async function listarCatalogo() { return { items: [] }; }

  // El resto de servidor.js, que esta prueba no usa pero el modulo exporta.
  // Un import con nombre de algo que falta rompe el modulo entero al
  // enlazarlo, no solo la funcion que falta.
  //
  // Sin comillas invertidas en este comentario, a proposito: esto vive dentro
  // de un template literal, y una comilla suelta lo cierra antes de tiempo.
  // No rompe una prueba: rompe la CORRIDA ENTERA, porque Playwright no puede
  // cargar la suite y aborta antes de ejecutar nada.
  export async function crearSala() { return {}; }
  export async function revanchaDeSala() { return {}; }
  export async function abandonarPartida() { return {}; }
  export async function unirseASala() { return {}; }
  export async function crearSalaPrivada() { return {}; }
  export async function unirseConCodigo() { return {}; }
  export async function marcarListo() { return {}; }
  export async function iniciarPartida() { return {}; }
  export async function salirDeSalaEnEspera() { return {}; }
  export async function reportarJugador() { return {}; }
  export async function misInsignias() { return {}; }
  export async function listarTorneos() { return {}; }
  export async function inscribirseATorneo() { return {}; }
`;

/**
 * La respuesta buena mete el paquete y el número de llamada EN LA URL.
 *
 * Al principio esto se comprobaba leyendo `window.__ultimoPaquete` después del
 * clic, y salía `undefined`: aunque la navegación se anule, el intento de irse
 * ya descartó el contexto donde vivía esa variable.
 *
 * Viajando en la URL, lo que captura la ruta interceptada alcanza para probar
 * las dos cosas —qué paquete se pidió y cuántas veces— sin depender de que
 * sobreviva nada del lado de la página.
 */
const OK = `return { ordenId: "o1", importe: 250, moneda: "UYU", leyendas: 500,
                 urlCheckout: "https://sandbox.mercadopago.com.uy/checkout/v1/redirect"
                   + "?pref_id=X&pack=" + paqueteId + "&n=" + window.__llamadas };`;

const FALLA = (codigo, mensaje) =>
  `throw new ErrorDeServidor(${JSON.stringify(mensaje)}, ${JSON.stringify(codigo)});`;

async function abrirTienda(page, { compra, respuesta = OK } = {}) {
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));

  await page.addInitScript((c) => {
    window.__compra = c;
    window.__llamadas = 0;
  }, compra);

  await page.route("**/js/sesion.js", (r) => r.fulfill(js(SESION_FALSA)));
  await page.route("**/js/servidor.js", (r) => r.fulfill(js(servidorFalso(respuesta))));
  // La otra mitad de la tienda no es lo que se prueba acá, y arrastra media
  // docena de llamadas propias.
  await page.route("**/js/personalizacion.js", (r) =>
    r.fulfill(js("export function montarPersonalizacion() {}")));

  await page.goto("/tienda.html");
  await page.waitForSelector("#paquetes [data-paquete]", { timeout: 10_000 });
  return errores;
}

const boton = (page) => page.locator("#paquetes [data-paquete]").first();

// =====================================================================

test("sin permiso el botón queda apagado, y se explica por qué", async ({ page }) => {
  await abrirTienda(page, { compra: { habilitada: false, esSandbox: true } });

  await expect(boton(page)).toBeDisabled();
  await expect(page.locator("#avisoPaquetes")).toContainText("sólo puede comprar el equipo");

  // Y tocarlo no llama a nada: un botón apagado que igual dispara la compra
  // sería peor que uno encendido.
  await boton(page).click({ force: true });
  expect(await page.evaluate(() => window.__llamadas)).toBe(0);
});

test("con permiso el botón se enciende", async ({ page }) => {
  await abrirTienda(page, { compra: { habilitada: true, esSandbox: true } });
  await expect(boton(page)).toBeEnabled();
});

test("el cartel de modo prueba aparece sólo en sandbox", async ({ page }) => {
  await abrirTienda(page, { compra: { habilitada: true, esSandbox: true } });
  await expect(page.locator("#cartelSandbox")).toBeVisible();
  await expect(page.locator("#cartelSandbox")).toContainText("no son reales");
});

test("y NO aparece con credenciales de producción", async ({ page }) => {
  /**
   * La mitad que importa del cartel.
   *
   * Un cartel que aparece siempre es ruido que la gente deja de leer; uno que
   * se queda puesto en producción le dice a quien está pagando de verdad que
   * su pago no es real. `esSandbox` sale del prefijo `TEST-` del token, así
   * que al cambiar las credenciales tiene que desaparecer solo.
   */
  await abrirTienda(page, { compra: { habilitada: true, esSandbox: false } });
  await expect(page.locator("#cartelSandbox")).toBeHidden();
});

test("un clic pide la orden y lleva al checkout que devolvió el servidor", async ({ page }) => {
  await abrirTienda(page, { compra: { habilitada: true, esSandbox: true } });

  /**
   * La navegación se ANULA, no se cumple.
   *
   * La primera versión la cumplía con un `fulfill`, y las dos pruebas que
   * navegan fallaron por el mismo motivo: cumplirla descarga la tienda, así
   * que `window.__llamadas` y `window.__ultimoPaquete` dejan de existir —viven
   * en el documento que se acaba de ir— y el botón tampoco está más.
   *
   * Anulándola, el navegador intenta ir, se queda donde está, y lo que se
   * quería comprobar sigue a mano: a dónde iba y con qué paquete.
   */
  const destinos = [];
  await page.route("https://sandbox.mercadopago.com.uy/**", (r) => {
    destinos.push(r.request().url());
    return r.abort();
  });

  await boton(page).click();

  await expect.poll(() => destinos.length).toBe(1);
  expect(destinos[0]).toContain("pref_id=X");
  expect(destinos[0], "va al checkout del paquete que se tocó").toContain(`pack=${PACK.id}`);
});

test("dos clics seguidos piden UNA sola orden", async ({ page }) => {
  /**
   * El doble cobro por doble clic.
   *
   * No es la defensa de verdad —esa es el límite de ritmo del servidor— pero
   * es la que hace que el caso normal no llegue a necesitarla. Dos órdenes por
   * un clic nervioso son dos filas en `ordenes/` que alguien tiene que
   * conciliar a mano.
   */
  await abrirTienda(page, { compra: { habilitada: true, esSandbox: true } });
  // Anulada, para que la tienda siga en pie y se pueda clavar el botón otra
  // vez: con la navegación cumplida no habría segundo clic que dar.
  const destinos = [];
  await page.route("https://sandbox.mercadopago.com.uy/**", (r) => {
    destinos.push(r.request().url());
    return r.abort();
  });

  /**
   * Los dos clics van en el MISMO tick, desde la página.
   *
   * Con dos `locator.click()` seguidos hay un `await` en el medio, y para
   * cuando llega el segundo la página ya empezó a navegar: Playwright lo
   * espera para siempre. Pero además eso no era un doble clic —era un clic,
   * un viaje de ida y vuelta, y otro clic—.
   *
   * Un doble clic de verdad son dos eventos antes de que resuelva ningún
   * `await`, que es justo el caso donde la guarda tiene que servir: el primero
   * apaga el botón de forma síncrona, antes de pedir nada, y el segundo se
   * encuentra con el botón ya apagado.
   */
  await page.evaluate(() => {
    const b = document.querySelector("#paquetes [data-paquete]");
    b.click();
    b.click();
  });

  await page.waitForTimeout(400);

  // Una sola navegación, y de la PRIMERA llamada: `n=1`. Si el segundo clic
  // hubiera pedido otra orden, habría un segundo destino con `n=2`.
  expect(destinos.length, `hubo ${destinos.length} intentos de pago`).toBe(1);
  expect(destinos[0]).toContain("n=1");

  // Acá había un `expect(boton).toBeDisabled()` para comprobar que el botón
  // queda apagado después de una compra buena. No se puede: para cuando se
  // mira, el intento de navegar ya descartó el documento y no hay botón que
  // mirar. Que sólo haya UNA navegación ya prueba lo que importa — el segundo
  // clic no pidió nada — y afirmar dos veces lo mismo, una de ellas por un
  // camino que no existe, es cómo se llega a una prueba que miente.
});

test("si el servidor rechaza, se ve en pantalla y no en un alert", async ({ page }) => {
  /**
   * Un `alert` bloquea, no se puede copiar y en el teléfono tapa la página.
   * La tienda ya tenía esta regla para la compra con Leyendas; el pago con
   * dinero es justo donde más importa que el motivo quede a la vista.
   */
  let huboAlert = false;
  page.on("dialog", (d) => {
    huboAlert = true;
    d.dismiss();
  });

  await abrirTienda(page, {
    compra: { habilitada: true, esSandbox: true },
    respuesta: FALLA("unavailable", "No pudimos abrir el pago. Probá de nuevo."),
  });

  await boton(page).click();

  await expect(page.locator("#avisoPaquetes")).toContainText("No pudimos abrir el pago");
  expect(huboAlert, "no debe abrirse ningún alert").toBe(false);

  // Y el botón vuelve a quedar usable: un fallo no puede dejar la tienda
  // muerta hasta que alguien recargue.
  await expect(boton(page)).toBeEnabled();
});

test("un rechazo por permisos también se explica", async ({ page }) => {
  await abrirTienda(page, {
    compra: { habilitada: true, esSandbox: true },
    respuesta: FALLA("permission-denied", "Esta sección no es para vos."),
  });

  await boton(page).click();
  await expect(page.locator("#avisoPaquetes")).toContainText("no es para vos");
});

test("la tienda no tira errores al cargar", async ({ page }) => {
  const errores = await abrirTienda(page, { compra: { habilitada: true, esSandbox: false } });
  expect(errores, `la tienda tiró errores: ${errores.join(" | ")}`).toEqual([]);
});
