import { defineConfig, devices } from "@playwright/test";

/**
 * Pruebas de navegador.
 *
 * QUÉ CUBREN Y QUÉ NO
 *
 * Cubren el modo ENTRENAMIENTO, que es donde vive la interfaz: `mesa.js` es el
 * mismo archivo en los dos modos, así que lo que se rompe acá se rompe también
 * en las partidas por Leyendas.
 *
 * NO cubren el modo red, y es una decisión, no un olvido. Una partida por
 * Leyendas necesita cuatro sesiones autenticadas de verdad y COBRA la entrada:
 * una suite que corra sola no puede estar gastando el saldo de nadie. Esa
 * mitad la cubren las 23 suites de `pruebas/`, que ejercitan el motor en red
 * contra un Firestore falso.
 *
 * POR QUÉ NO SON INTERMITENTES
 *
 * Dos cosas, y las dos son deliberadas:
 *
 *   - `?semilla=N` fija el reparto. Sin eso cada carga trae otra mesa y lo
 *     único que se podría afirmar es que "algo pasó".
 *   - Nada se espera con un `sleep`. Se espera a que el DOM diga lo que tiene
 *     que decir, con los reintentos de Playwright. Un `sleep` calibrado a mano
 *     es una prueba que funciona en esta máquina y falla en la de al lado.
 */
export default defineConfig({
  testDir: "./pruebas/e2e",
  // La mesa es una máquina de temporizadores: dos segundos de ventana, dos de
  // revelación, el ritmo entre jugadas de las IA. Un turno completo lleva su
  // tiempo y el tope de 30 s de fábrica se queda corto.
  timeout: 90_000,
  expect: { timeout: 15_000 },

  // En serie: las cuatro IA corren con temporizadores reales y varias mesas a
  // la vez se pisan por CPU, que es la receta para una prueba intermitente.
  workers: 1,
  fullyParallel: false,

  // Sólo en CI. En local, un reintento esconde justo lo que se vino a buscar.
  retries: process.env.CI ? 2 : 0,
  forbidOnly: Boolean(process.env.CI),

  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],

  use: {
    baseURL: "http://localhost:5000",
    trace: "on-first-retry",
    video: process.env.CI ? "retain-on-failure" : "off",
    screenshot: "only-on-failure",

    /**
     * Las pruebas corren como quien pidió menos movimiento.
     *
     * La mesa de entrenamiento reparte con las cartas volando y arranca con una
     * cuenta regresiva de cuatro segundos. Eso está bien para jugar y es un
     * estorbo para probar: cada prueba de mesa esperaría esos cuatro segundos
     * antes de poder mirar nada, y son cuarenta pruebas.
     *
     * No es un atajo para las pruebas: `prefers-reduced-motion` es una
     * preferencia real del sistema, la mesa la respeta de verdad y hay gente
     * que la tiene puesta. Probar con ella activada es probar un camino que
     * existe, no uno inventado para la ocasión.
     */
    reducedMotion: "reduce",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    command: "node herramientas/servir.mjs",
    url: "http://localhost:5000/mesa.html",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
