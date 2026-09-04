/**
 * Un nombre de jugador no puede ejecutar código en la mesa de los demás.
 *
 * Las reglas de Firestore dejan que cada uno escriba su propio nombre
 * (`allow update: if esDuenio(uid)`), y ese nombre lo leen todos para dibujar
 * la mesa. Entraba sin escapar en cinco sitios —el asiento, el marcador, el
 * registro y las dos tablas de resultados—, así que un jugador llamado
 * `<img src=x onerror="...">` corría lo que quisiera en el navegador de sus
 * rivales, con la sesión de ellos abierta.
 *
 * La configuración de la mesa vive en localStorage, así que desde acá se puede
 * montar exactamente ese ataque.
 */

import { test, expect } from "@playwright/test";

const CARGA = '<img src=x onerror="window.__ejecutado=true">';

test("un nombre con HTML se muestra como texto, no se ejecuta", async ({ page }) => {
  await page.addInitScript((nombre) => {
    window.__ejecutado = false;
    // La forma tiene que ser la que espera `leerConfiguracion`: humanos e
    // ias. Con una forma distinta cae en CONFIG_POR_DEFECTO y la prueba
    // pasaría sin haber probado nada.
    localStorage.setItem("configMesa", JSON.stringify({
      humanos: [{ nombre }],
      ias: [
        { nombre: "Nara", dificultad: "medio" },
        { nombre: "Bruno", dificultad: "dificil" },
        { nombre: "Vex", dificultad: "experto" },
      ],
    }));
  }, CARGA);

  // La mesa exige sesión, y esta prueba no usa `abrirMesa` —necesita escribir
  // `configMesa` con el nombre atacante antes de entrar—, así que se pone acá
  // el mismo reemplazo. Sin esto la mesa se va a `login.html` y el ataque no
  // llega a montarse: la prueba pasaría sin haber probado nada, que es la peor
  // forma de pasar para una prueba de seguridad.
  await page.route("**/js/guardia-sesion.js", (ruta) =>
    ruta.fulfill({
      status: 200,
      contentType: "text/javascript; charset=utf-8",
      body: `export async function exigirSesionEnMesa() {
        return { uid: "jugador-de-prueba", email: "prueba@example.com" };
      }`,
    }),
  );

  await page.goto("/mesa.html?semilla=4242");
  await expect(page.locator("#pista")).toContainText(/Elegí|carta/i);

  // Lo que importa: no corrió nada.
  expect(await page.evaluate(() => window.__ejecutado)).toBe(false);
  expect(await page.locator("img[onerror]").count()).toBe(0);

  // Y el nombre igual se ve, como texto.
  const mesa = await page.locator("#mesa").innerText();
  expect(mesa).toContain("<img");
});
