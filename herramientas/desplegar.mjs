/**
 * `firebase deploy`, con la ventana de descubrimiento más ancha.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ PROBLEMA RESUELVE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Desplegar functions falla cada tantas veces con:
 *
 *   Error: User code failed to load. Cannot determine backend specification.
 *   Timeout after 10000.
 *
 * El mensaje dice «el código de usuario no cargó», y eso manda a buscar el
 * problema en el código. No está ahí: `import('./functions/index.js')` carga
 * en 1,6 s, muy por debajo de los diez segundos, y el log muestra
 * `Serving at port XXXX` — o sea que el servidor de descubrimiento arrancó
 * bien y la CLI no llegó a hablarle a tiempo. Es entre la CLI y su propio
 * servidor, en Windows.
 *
 * `FUNCTIONS_DISCOVERY_TIMEOUT` es la variable que la CLI lee para eso.
 * Sesenta segundos no esconden un problema real: si el código de verdad no
 * cargara, fallaría igual, sólo que después de esperar más.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ UN SCRIPT Y NO LA VARIABLE EN EL COMANDO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque `VAR=valor comando` no funciona en Windows, que es donde se
 * despliega. En PowerShell hay que escribir `$env:VAR = "60"` antes, y en
 * cmd.exe `set VAR=60 &&`. Tres formas distintas de escribir lo mismo es
 * exactamente lo que alguien no se va a acordar el día que apure un deploy.
 *
 * Y no se agrega `cross-env`: una dependencia entera para exportar una
 * variable, en un proyecto que no tiene ninguna de ese tipo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * USO
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   npm run deploy                                  (todo)
 *   npm run deploy -- --only hosting
 *   npm run deploy -- --only functions:avanzarPartida,functions:cerrarPartida
 *
 * Los argumentos pasan tal cual a `firebase deploy`.
 */

import { spawn } from "node:child_process";

/** Segundos. Se puede pisar desde afuera si alguna vez hiciera falta más. */
const ESPERA = process.env.FUNCTIONS_DISCOVERY_TIMEOUT ?? "60";

const argumentos = process.argv.slice(2);

console.log(
  `\nfirebase deploy ${argumentos.join(" ")}`.trimEnd() +
    `\n  (FUNCTIONS_DISCOVERY_TIMEOUT=${ESPERA})\n`,
);

/**
 * Cómo se llama a `firebase`, y por qué no es obvio en Windows.
 *
 * Ahí `firebase` es un `.cmd`, y Windows NO puede ejecutar un archivo por
 * lotes directamente: `CreateProcess` lo rechaza, así que `spawn("firebase")`
 * y `spawn("firebase.cmd")` fallan los dos con ENOENT. Hay que pasarlo por
 * `cmd.exe`, que es quien sabe interpretarlo.
 *
 * La salida fácil sería `shell: true`, y funciona. Pero entonces Node avisa
 * —con razón— que los argumentos se concatenan en vez de escaparse, y ese
 * aviso saldría en CADA despliegue. Un aviso que aparece siempre es uno que
 * nadie lee, incluido el día que diga otra cosa.
 *
 * Nombrando `cmd.exe` se dice explícitamente quién interpreta, y los
 * argumentos siguen viajando como lista.
 */
const [PROGRAMA, PREFIJO] =
  process.platform === "win32" ? ["cmd.exe", ["/c", "firebase"]] : ["firebase", []];

const hijo = spawn(PROGRAMA, [...PREFIJO, "deploy", ...argumentos], {
  stdio: "inherit",
  env: { ...process.env, FUNCTIONS_DISCOVERY_TIMEOUT: ESPERA },
});

hijo.on("error", (e) => {
  console.error(`\n❌ No se pudo ejecutar firebase: ${e.message}\n`);
  process.exit(1);
});

// El código de salida se propaga tal cual: un deploy que falla tiene que
// hacer fallar al `npm run` que lo llamó, o un script encadenado seguiría
// como si nada.
hijo.on("close", (codigo) => process.exit(codigo ?? 1));
