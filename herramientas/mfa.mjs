/**
 * El segundo factor del proyecto, desde la terminal.
 *
 *   node herramientas/mfa.mjs                    muestra cómo está
 *   node herramientas/mfa.mjs --activar          enciende TOTP
 *   node herramientas/mfa.mjs --apagar           lo apaga
 *   node herramientas/mfa.mjs --probar           prueba que funcione de verdad
 *
 * ────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO EXISTE
 * ────────────────────────────────────────────────────────────────────────
 *
 * La consola de Firebase no muestra la opción de TOTP mientras el segundo
 * factor esté apagado del todo, así que no hay dónde tocar para encenderlo:
 * hay que hacerlo por la API. De ahí este archivo.
 *
 * Y sigue existiendo después de encenderlo por una razón más importante: si
 * algo sale mal con los dos pasos, `--apagar` es la vuelta atrás, y tiene que
 * poder hacerse sin esperar a nadie. Un interruptor que sólo sabe accionar
 * quien lo instaló no es un interruptor.
 *
 * ────────────────────────────────────────────────────────────────────────
 * LA CREDENCIAL
 * ────────────────────────────────────────────────────────────────────────
 *
 * Hace falta una clave de cuenta de servicio, que da control TOTAL sobre el
 * proyecto: puede leer cualquier dato, borrar cualquier cuenta y mover
 * cualquier saldo. No se guarda acá, no se imprime nunca y no entra al
 * repositorio. Se pasa por variable de entorno:
 *
 *   CLAVE=/ruta/a/la/clave.json node herramientas/mfa.mjs
 *
 * Si esa clave se filtra, hay que revocarla en la consola de Google Cloud
 * —IAM → Cuentas de servicio— y generar otra. Perderla es peor que perder la
 * contraseña del administrador.
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { argv, env, exit } from "node:process";

/**
 * `firebase-admin` se toma de `functions/`, a propósito.
 *
 * Un `import "firebase-admin/app"` a secas parece funcionar, y ahí está la
 * trampa: Node lo busca subiendo carpetas, así que termina resolviéndolo
 * contra un paquete suelto en la carpeta del usuario —fuera de todo proyecto,
 * sin versión declarada en ningún lado, y que desaparece la primera vez que
 * alguien limpia—. La herramienta andaría por casualidad hasta que dejara de
 * andar sin que nadie hubiera tocado nada.
 *
 * La copia de `functions/` sí está declarada y sí tiene que existir: sin ella
 * no se pueden desplegar las Cloud Functions. Se apunta ahí y se termina la
 * ambigüedad.
 */
const desdeFunctions = createRequire(new URL("../functions/package.json", import.meta.url));

let initializeApp, cert, getAuth;
try {
  ({ initializeApp, cert } = desdeFunctions("firebase-admin/app"));
  ({ getAuth } = desdeFunctions("firebase-admin/auth"));
} catch {
  console.error("Falta firebase-admin. Instalá las dependencias de las funciones:");
  console.error("  npm --prefix functions install");
  exit(1);
}

const PROYECTO = "memorie-legends";
const CLAVE_WEB = "AIzaSyAd3EscVwcQwXOq3oudzGb3NBLK_AAAdh0";

/**
 * Cuántas ventanas de 30 segundos se aceptan antes y después de la actual.
 *
 * Cinco, o sea ±2,5 minutos. Es holgado a propósito: un teléfono con la hora
 * unos segundos corrida es lo más común del mundo, y el precio de ser estricto
 * lo paga alguien que no puede entrar a su cuenta. El rango que admite Firebase
 * va de 1 a 10.
 */
const VENTANAS = 5;

// ─────────────────────────────────────────────────────────── arranque

if (!env.CLAVE) {
  console.error("Falta la credencial. Ejecutá:");
  console.error("  CLAVE=/ruta/a/la/clave.json node herramientas/mfa.mjs");
  exit(1);
}

let clave;
try {
  clave = JSON.parse(readFileSync(env.CLAVE, "utf8"));
} catch (e) {
  console.error(`No pude leer la credencial: ${e.message}`);
  exit(1);
}

// Que la clave sea de ESTE proyecto. Hay más de un JSON de cuenta de servicio
// dando vueltas en cualquier máquina de desarrollo, y equivocarse acá significa
// cambiarle la autenticación a otro proyecto.
if (clave.project_id !== PROYECTO) {
  console.error(`Esa credencial es del proyecto "${clave.project_id}", no de ${PROYECTO}.`);
  exit(1);
}

initializeApp({ credential: cert(clave), projectId: PROYECTO });
const gestor = getAuth().projectConfigManager();

// ─────────────────────────────────────────────────────────── acciones

const describir = (mfa) => {
  if (!mfa || mfa.state !== "ENABLED") return "APAGADO";
  const totp = (mfa.providerConfigs ?? []).find((p) => p.totpProviderConfig);
  const partes = [];
  if (totp?.state === "ENABLED") {
    partes.push(`TOTP (±${totp.totpProviderConfig.adjacentIntervals} ventanas de 30 s)`);
  }
  if ((mfa.factorIds ?? []).includes("PHONE_SMS")) partes.push("SMS");
  return partes.length ? partes.join(" + ") : "encendido, pero sin ningún factor";
};

async function mostrar() {
  const { multiFactorConfig } = await gestor.getProjectConfig();
  console.log(`\n  Segundo factor: ${describir(multiFactorConfig)}\n`);
  console.log(JSON.stringify(multiFactorConfig ?? null, null, 2));
  console.log("");
}

async function activar() {
  const antes = (await gestor.getProjectConfig()).multiFactorConfig;
  console.log(`  antes:   ${describir(antes)}`);

  await gestor.updateProjectConfig({
    multiFactorConfig: {
      state: "ENABLED",
      // El SMS vive acá y se deja como esté. Este comando agrega TOTP; no es
      // asunto suyo apagar lo que alguien haya encendido a propósito.
      factorIds: antes?.factorIds ?? [],
      providerConfigs: [
        { state: "ENABLED", totpProviderConfig: { adjacentIntervals: VENTANAS } },
      ],
    },
  });

  // Se relee del servidor en vez de confiar en lo que devolvió la escritura:
  // lo que importa es qué quedó guardado, no qué pedimos.
  const despues = (await gestor.getProjectConfig()).multiFactorConfig;
  console.log(`  después: ${describir(despues)}\n`);
}

async function apagar() {
  const antes = (await gestor.getProjectConfig()).multiFactorConfig;
  console.log(`  antes:   ${describir(antes)}`);

  // Apagar NO desinscribe a nadie: quien ya tenga su aplicación configurada
  // conserva el factor guardado en su cuenta. Lo que deja de poder hacerse es
  // inscribir uno nuevo, y el ingreso de los que ya lo tienen puede quedar
  // bloqueado. Por eso se avisa.
  console.log("\n  ⚠️  Esto NO le quita el segundo factor a quien ya lo tenga puesto.");
  console.log("     Para sacárselo a alguien: Consola → Authentication → Users.\n");

  await gestor.updateProjectConfig({
    multiFactorConfig: { state: "DISABLED", factorIds: [], providerConfigs: [] },
  });

  const despues = (await gestor.getProjectConfig()).multiFactorConfig;
  console.log(`  después: ${describir(despues)}\n`);
}

/**
 * Prueba de punta a punta.
 *
 * Leer la configuración dice que el ajuste quedó guardado. Esto dice otra cosa
 * y más útil: que una sesión de verdad consigue que el servidor le emita un
 * secreto. Es la diferencia entre "el interruptor está puesto" y "la luz
 * enciende".
 *
 * Crea UNA cuenta y la borra en el `finally`, pase lo que pase.
 */
async function probar() {
  const correo = `verificacion-totp-${Date.now()}@${PROYECTO}-prueba.invalid`;
  const contrasena = randomBytes(24).toString("base64url");
  let uid = null;

  try {
    const usuario = await getAuth().createUser({
      email: correo, password: contrasena, emailVerified: true,
      displayName: "verificación TOTP (temporal)",
    });
    uid = usuario.uid;
    console.log("  1. cuenta temporal creada");

    const entrada = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${CLAVE_WEB}`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: correo, password: contrasena, returnSecureToken: true }) },
    ).then((r) => r.json());
    if (!entrada.idToken) throw new Error(JSON.stringify(entrada.error));
    console.log("  2. sesión iniciada");

    // Acá está la prueba: con TOTP apagado, esto contesta OPERATION_NOT_ALLOWED.
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v2/accounts/mfaEnrollment:start?key=${CLAVE_WEB}`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: entrada.idToken, totpEnrollmentInfo: {} }) },
    );
    const d = await r.json();
    const info = d?.totpSessionInfo;

    if (info?.sharedSecretKey) {
      console.log("  3. el servidor emitió un secreto ✓");
      console.log(`     ${info.verificationCodeLength} dígitos cada ${info.periodSec} s`);
      console.log("\n  ✅ TOTP funciona.\n");
    } else {
      console.log("  3. el servidor NO emitió secreto");
      console.log(`     HTTP ${r.status}: ${JSON.stringify(d.error ?? d)}`);
      console.log("\n  ❌ TOTP no funciona.\n");
      process.exitCode = 1;
    }
  } finally {
    if (uid) {
      await getAuth().deleteUser(uid);
      console.log(`  (cuenta temporal borrada: ${uid})`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────

const args = argv.slice(2);
if (args.includes("--activar")) await activar();
else if (args.includes("--apagar")) await apagar();
else if (args.includes("--probar")) await probar();
else await mostrar();
