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
