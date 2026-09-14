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
   * Dos a la vez, y el número está medido — dos veces.
   *
   * ───────────────────────────────────────────────────────────────────────
   * PRIMERO SE SUBIÓ A CUATRO, Y ESTUVO MAL
   * ───────────────────────────────────────────────────────────────────────
   *
   * Estaba en 1 porque las cuatro IA corren con temporizadores REALES y el
   * miedo era que varias mesas a la vez se pisaran por CPU. Se subió a cuatro
   * después de medir: el subconjunto rápido bajó de 90 a 54 segundos y las
   * cinco suites más cargadas de relojes pasaron dos veces cada una sin
   * intermitencias.
   *
   * Esa medición no alcanzó. La suite entera creció seis pruebas y
   * `menu.spec.js` empezó a fallar por tiempo de espera al hacer clic. Con
   * `--repeat-each=4`:
   *
   *     workers=4 → 62 de 64, y tardó 2,2 min
   *     workers=3 → 64 de 64, 1,0 min
   *     workers=2 → 64 de 64, 1,0 min
   *     workers=1 → 64 de 64, 1,3 min
   *
   * O sea que en esta máquina cuatro trabajadores no sólo son frágiles: son
   * MÁS LENTOS que dos. Ocho núcleos pero 8 GB de RAM con 2,5 libres, y cada
   * trabajador es un Chromium entero; pasado cierto punto se compite por
   * memoria y todo el mundo espera.
   *
   * ───────────────────────────────────────────────────────────────────────
   * POR QUÉ DOS Y NO TRES
   * ───────────────────────────────────────────────────────────────────────
   *
   * Los dos midieron igual y los dos pasaron. Dos deja más aire para la
   * máquina que corra esto — puede no ser ésta — y el margen se paga con nada,
   * porque el tiempo es el mismo.
   *
   * La lección de fondo: estas pruebas pasan el tiempo ESPERANDO relojes, no
   * calculando, así que el paralelismo rinde poco y se acaba rápido. Antes de
   * volver a subirlo hay que medirlo con `--repeat-each`, y sobre la suite
   * completa, no sobre un subconjunto.
   *
   * En otra máquina, `--workers=N` manda sobre esto sin tocar el archivo.
   */
  workers: 2,

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
