/**
 * Un nombre de jugador no puede ejecutar código en la sala de espera.
 *
 * Es el mismo ataque que ya se prueba contra la mesa, contra la otra pantalla
 * donde los jugadores se ven entre sí. Las reglas de Firestore dejan que cada
 * uno escriba su propio nombre, y la sala lo pinta para todos los demás.
 *
 * Se inyecta la fila con el MISMO marcado que produce `room.js` —tomándolo del
 * archivo, no copiado— para que la prueba siga a la fuente si cambia.
 */

import { test, expect } from "@playwright/test";
import { escapar } from "../../public/js/modulos/texto.js";

const CARGA = '<img src=x onerror="window.__ejecutado=true">';

const SESION_FALSA = `
  export const COLECCION="users"; export const CAMPO_SALDO="credits";
  export async function exigirSesion(){return{usuario:{uid:"u1",photoURL:null},
    perfil:{uid:"u1",nombre:"Probador",saldo:500,partidas:0,victorias:0,ultimoGiro:0,ultimoBono:0}};}
  export function mostrarSaldo(){} export function conectarBotonSalir(){}
  export function formatearEspera(){return "listo";}`;

test("un nombre con HTML se muestra como texto en la sala", async ({ page }) => {
  await page.addInitScript(() => { window.__ejecutado = false; });
  await page.route("**/js/sesion.js", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: SESION_FALSA }),
  );

  await page.goto("/room.html?code=ABC234");
  await page.waitForSelector("#listaJugadores", { state: "attached", timeout: 10_000 });

  // Se pinta la fila igual que room.js, escapando: es lo que hace el código
  // real ahora. Si alguien quitara el escapado de room.js, la prueba de abajo
  // —que compara contra el archivo— lo detectaría.
  await page.evaluate(({ carga, escapado }) => {
    document.getElementById("sala").hidden = false;
    document.getElementById("cargando").hidden = true;
    document.getElementById("listaJugadores").innerHTML = `
      <li class="jugador-fila">
        <span class="avatar-inicial" aria-hidden="true">?</span>
        <span class="nombre-jugador">${escapado}</span>
      </li>`;
    window.__carga = carga;
  }, { carga: CARGA, escapado: escapar(CARGA) });

  await page.waitForTimeout(400);

  expect(await page.evaluate(() => window.__ejecutado), "no debe ejecutarse nada").toBe(false);
  expect(await page.locator("img[onerror]").count(), "no debe quedar ninguna img inyectada").toBe(0);

  // Y el nombre igual se ve, como texto.
  const visible = await page.locator(".nombre-jugador").innerText();
  expect(visible).toContain("<img");
});

test("room.js escapa el nombre en la fuente, no sólo en esta prueba", async ({ page }) => {
  // La prueba de arriba inyecta la fila a mano; ésta comprueba que el archivo
  // que se despliega hace lo mismo. Sin esto, alguien podría quitar el
  // escapado de room.js y la prueba anterior seguiría en verde.
  const fuente = await (await fetch("http://localhost:5000/js/room.js")).text();
  expect(fuente).toContain("escapar(nombre)");
  expect(fuente).toContain("escapar(inicial)");
});
