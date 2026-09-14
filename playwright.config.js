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

  /**
   * Cuatro a la vez, y el número está medido.
   *
   * ───────────────────────────────────────────────────────────────────────
   * POR QUÉ ESTABA EN 1
   * ───────────────────────────────────────────────────────────────────────
   *
   * Porque las cuatro IA corren con temporizadores REALES —dos segundos de
   * ventana, dos de revelación, el ritmo entre jugadas— y el miedo era que
   * varias mesas a la vez se pisaran por CPU y aparecieran pruebas
   * intermitentes. Es un miedo razonable y resultó infundado en esta máquina.
   *
   * ───────────────────────────────────────────────────────────────────────
   * QUÉ SE MIDIÓ ANTES DE SUBIRLO
   * ───────────────────────────────────────────────────────────────────────
   *
   * Las cinco pruebas más cargadas de temporizadores —`carteles`,
   * `partida-completa`, `poder10`, `descarte`, `entrenamiento-ux`— corridas
   * DOS VECES cada una con cuatro trabajadores: 60 pruebas, ninguna
   * intermitente. Y después la suite entera, en verde.
   *
   * ───────────────────────────────────────────────────────────────────────
   * Y POR QUÉ NO MÁS DE CUATRO
   * ───────────────────────────────────────────────────────────────────────
   *
   * Porque no rinde. De 1 a 2 trabajadores el subconjunto rápido bajó de 90 a
   * 61 segundos; de 2 a 4, sólo a 54. La ganancia se aplana porque estas
   * pruebas pasan el tiempo ESPERANDO relojes, no calculando: paralelizar
   * superpone esperas, y las esperas ya se superponen casi todas con cuatro.
   *
   * Del otro lado, cada trabajador es un Chromium. Esta máquina tiene 8 GB y
   * anda con 2,5 libres, así que el sexto o el séptimo empiezan a competir por
   * memoria — y una prueba que falla por falta de memoria se lee igual que una
   * intermitente.
   *
   * Si en otra máquina hicieran falta menos, `--workers=N` en la línea de
   * comandos manda sobre esto sin tocar el archivo.
   */
  workers: 4,

  /**
   * Pero NO en paralelo dentro de un archivo.
   *
   * `fullyParallel` repartiría también las pruebas de un mismo archivo, y
   * varias de éstas comparten estado del navegador a propósito —
   * `sessionStorage` entre pasos, por ejemplo en `dos-vistas`. El paralelismo
   * queda entre archivos, que es donde no hay nada compartido.
   */
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
