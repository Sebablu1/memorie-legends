/**
 * Que nada se salga de la pantalla en un teléfono.
 *
 * Dos desbordes reportados desde un celular en producción, los dos medidos
 * antes de tocar una línea de CSS:
 *
 *   ADMIN, botón "Salir"      375px: entraba · 360px: +8 · 344px: +24 y la
 *                             página entera scrolleaba de costado.
 *   SALA, "✅ Listo"          375px: +11 · 360px: +26 · 344px: +42 y scroll.
 *
 * Medir primero importó: a 375 px —el ancho con el que uno prueba por
 * reflejo— el de admin todavía entraba. Sin bajar a 360 y 320 habría "arreglado"
 * algo que no se veía roto y dado el problema por cerrado.
 *
 * Se mide la geometría, no el aspecto. "Se ve mejor" no es comprobable; que el
 * borde derecho de un hijo quede dentro del de su contenedor, sí.
 */

import { test, expect } from "@playwright/test";

/** Anchos reales de teléfonos, del más ancho al más angosto que se usa. */
const ANCHOS = [430, 412, 393, 375, 360, 344, 320];

const SESION_FALSA = `
  export const COLECCION="users"; export const CAMPO_SALDO="credits";
  export async function exigirSesion(){return{usuario:{uid:"u1",photoURL:null},
    perfil:{uid:"u1",nombre:"Probador",saldo:500,partidas:0,victorias:0,ultimoGiro:0,ultimoBono:0}};}
  export function mostrarSaldo(){} export function conectarBotonSalir(){}
  export function formatearEspera(){return "listo";}`;

test("admin: el botón Salir no se sale de la cabecera", async ({ page }) => {
  await page.goto("/admin/index.html");

  for (const ancho of ANCHOS) {
    await page.setViewportSize({ width: ancho, height: 780 });
    await page.waitForTimeout(120);

    // Mostrar el botón y medir van en la MISMA evaluación a propósito:
    // `admin.js` lo vuelve a esconder cuando Firebase confirma que no hay
    // sesión, y hacerlo en dos pasos daba medidas en cero de vez en cuando.
    // Era un fallo de la prueba, no de la página.
    const m = await page.evaluate(() => {
      document.getElementById("btnSalir").hidden = false;
      document.getElementById("quien").textContent = "unnombredecorreolargo@gmail.com";
      const barra = document.querySelector(".barra");
      const boton = document.getElementById("btnSalir");
      barra.getBoundingClientRect(); // fuerza el reflow antes de medir
      return {
        seSale: Math.round(boton.getBoundingClientRect().right - barra.getBoundingClientRect().right),
        scrollHorizontal:
          document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });

    expect(m.seSale, `a ${ancho}px el botón se sale ${m.seSale}px`).toBeLessThanOrEqual(0);
    expect(m.scrollHorizontal, `a ${ancho}px la página scrollea de costado`).toBe(false);
  }
});

test("sala: la fila del jugador no se corta por la derecha", async ({ page }) => {
  await page.route("**/js/sesion.js", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: SESION_FALSA }),
  );
  await page.goto("/room.html?code=ABC234");
  await page.waitForSelector("#listaJugadores", { state: "attached", timeout: 10_000 });

  for (const ancho of ANCHOS) {
    await page.setViewportSize({ width: ancho, height: 780 });
    await page.waitForTimeout(120);

    const m = await page.evaluate(() => {
      // `#sala` arranca oculta hasta que llegan los datos de Firestore; sin
      // destaparla la fila mide cero y la medición no dice nada.
      document.getElementById("sala").hidden = false;
      document.getElementById("cargando").hidden = true;
      // El mismo marcado que produce room.js, con un nombre largo de verdad:
      // es el nombre el que empujaba todo lo demás fuera de la fila.
      document.getElementById("listaJugadores").innerHTML = `
        <li class="jugador-fila es-mio">
          <span class="avatar-inicial" aria-hidden="true">S</span>
          <span class="nombre-jugador">Sebastián Rodríguez Fernández</span>
          <span class="insignia">Anfitrión</span>
          <span class="marca-listo si">✅ Listo</span>
        </li>`;

      const fila = document.querySelector(".jugador-fila");
      const marca = fila.querySelector(".marca-listo");
      return {
        seSale: Math.round(marca.getBoundingClientRect().right - fila.getBoundingClientRect().right),
        desbordaFila: fila.scrollWidth > fila.clientWidth,
        scrollHorizontal:
          document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });

    expect(m.seSale, `a ${ancho}px el estado se sale ${m.seSale}px`).toBeLessThanOrEqual(0);
    expect(m.desbordaFila, `a ${ancho}px la fila desborda`).toBe(false);
    expect(m.scrollHorizontal, `a ${ancho}px la página scrollea de costado`).toBe(false);
  }
});

/**
 * El botón de Google en el login.
 *
 * Reportado como "el texto se ve desfasado respecto al logo". Medido antes de
 * tocar nada, el centrado vertical estaba bien —0.5px de diferencia entre el
 * centro del logo y el del texto— y lo que estaba mal eran otras dos cosas:
 *
 *   EL LOGO SE APLASTABA   Un SVG dentro de un flex se encoge como cualquier
 *                          otro elemento. La altura la clava el atributo
 *                          `height`, así que sólo cedía a lo ancho:
 *                          390px: 17.8 · 375px: 16.7 · 360px: 15.6 · 320px: 12.8
 *                          El círculo de Google, hecho un óvalo.
 *
 *   EL TEXTO SE PARTÍA     En dos líneas por debajo de 430px, con lo que el
 *                          botón pasaba de 48 a 64px de alto y el logo quedaba
 *                          centrado contra el bloque entero en vez de contra
 *                          la línea. De ahí la sensación de "desfasado".
 *
 *                          El ancho se lo comía una regla global
 *                          `button { text-transform: uppercase;
 *                          letter-spacing: 1px }`, más 100px de margen (body
 *                          20px + contenedor 30px) que en una pantalla de 320
 *                          es casi un tercio del ancho.
 *
 * Se comprueban las dos por separado porque se rompen por separado.
 */
test("login: el logo de Google no se deforma y el texto entra en una línea", async ({ page }) => {
  for (const ancho of ANCHOS) {
    await page.setViewportSize({ width: ancho, height: 780 });
    await page.goto("/login.html");
    await page.waitForSelector(".google-btn svg");

    const m = await page.evaluate(() => {
      const boton = document.querySelector(".google-btn");
      const svg = boton.querySelector("svg");
      const rs = svg.getBoundingClientRect();

      // El texto del botón es un nodo suelto, sin elemento propio. Un Range es
      // la única forma de medirlo: `getClientRects()` devuelve una caja por
      // línea, así que su cantidad ES el número de líneas.
      const nodo = [...boton.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      const rango = document.createRange();
      rango.selectNodeContents(nodo);
      const rt = rango.getBoundingClientRect();
      const rb = boton.getBoundingClientRect();

      return {
        anchoLogo: rs.width,
        altoLogo: rs.height,
        lineas: rango.getClientRects().length,
        // Distancia entre el centro del logo y el centro del texto.
        desfase: Math.abs(rs.top + rs.height / 2 - (rt.top + rt.height / 2)),
        // Lo que sobra dentro del botón. Negativo = el texto se sale.
        sobra: rb.right - rt.right - parseFloat(getComputedStyle(boton).paddingRight),
        pagina: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });

    // Cuadrado, siempre. Es lo que separa el logo de Google de un óvalo.
    expect(
      m.anchoLogo,
      `a ${ancho}px el logo mide ${m.anchoLogo.toFixed(1)} de ancho por ${m.altoLogo} de alto`,
    ).toBeCloseTo(m.altoLogo, 0);

    // Centrado con el texto, no un par de píxeles más arriba.
    expect(m.desfase, `a ${ancho}px el logo y el texto están a ${m.desfase.toFixed(1)}px`).toBeLessThan(1.5);

    // El texto nunca se sale del botón: partirse en dos líneas es aceptable,
    // quedar cortado no.
    expect(m.sobra, `a ${ancho}px el texto se pasa ${(-m.sobra).toFixed(0)}px del botón`).toBeGreaterThanOrEqual(0);
    expect(m.pagina, `a ${ancho}px el login desborda ${m.pagina}px a lo ancho`).toBeLessThanOrEqual(0);

    // Una sola línea en TODO ancho, hasta el teléfono más angosto. Se puede
    // exigir porque el texto va en minúsculas: en mayúsculas y con el
    // letter-spacing global no entraba ni bajando la letra a 0.9rem.
    expect(m.lineas, `a ${ancho}px el texto del botón se parte en ${m.lineas} líneas`).toBe(1);
  }
});
