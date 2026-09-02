/**
 * Las cuentas, desde la terminal.
 *
 *   node herramientas/cuentas.mjs              lista todo
 *   node herramientas/cuentas.mjs --baja UID   da de baja una cuenta
 *   node herramientas/cuentas.mjs --nombres    revisa los nombres guardados
 *
 * ────────────────────────────────────────────────────────────────────────
 * LA CONTRASEÑA NO PASA POR NINGÚN LADO
 * ────────────────────────────────────────────────────────────────────────
 *
 * Se pide acá, en tu terminal, con el eco apagado. No se imprime, no se
 * guarda, no se pone en una variable de entorno —eso la deja visible en la
 * lista de procesos y en el historial del shell— y no viaja a ningún sitio
 * que no sea Google.
 *
 * Por eso este script tenés que correrlo VOS. Yo no puedo: mi terminal tiene
 * la entrada cerrada, así que el pedido de contraseña leería el final del
 * archivo y fallaría. Es a propósito.
 *
 * ────────────────────────────────────────────────────────────────────────
 * QUÉ HACE Y QUÉ NO
 * ────────────────────────────────────────────────────────────────────────
 *
 * No toca Firestore directamente. Inicia sesión como cualquier jugador y llama
 * a las MISMAS Cloud Functions que usa el panel, que comprueban el correo del
 * administrador antes de mirar nada. Si mañana cambian los permisos, este
 * script se entera solo.
 *
 * La clave de abajo es la clave web pública de Firebase: viaja en cada carga
 * del sitio y no es un secreto. Lo que protege la cuenta es la contraseña y
 * las reglas, no esconderla.
 */

import { createInterface } from "node:readline";
import { stdin, stdout, argv, exit } from "node:process";

const API_KEY = "AIzaSyAd3EscVwcQwXOq3oudzGb3NBLK_AAAdh0";
const PROYECTO = "memorie-legends";
const REGION = "us-central1";
const ADMIN = "soporte.memorie.legends@gmail.com";

// ─────────────────────────────────────────────────────── preguntar

const preguntar = (texto) =>
  new Promise((listo) => {
    const rl = createInterface({ input: stdin, output: stdout });
    rl.question(texto, (r) => {
      rl.close();
      listo(r.trim());
    });
  });

/**
 * Pide algo sin mostrarlo mientras se escribe.
 *
 * El truco es interceptar lo que readline manda a la pantalla y tragárselo.
 * Sin esto la contraseña queda escrita en el terminal, y de ahí al historial
 * de la sesión o a la captura que alguien saque.
 */
function preguntarEnSecreto(texto) {
  return new Promise((listo) => {
    // El prompt se escribe a mano ANTES de silenciar, así se ve; después no
    // sale nada. Silenciar y confiar en que readline reimprima el prompt es
    // frágil entre terminales.
    stdout.write(texto);

    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    // eslint-disable-next-line no-underscore-dangle
    rl._writeToOutput = () => {
      // Nada. Ni asteriscos: revelan el largo de la contraseña.
    };

    rl.question("", (r) => {
      stdout.write("\n");
      rl.close();
      listo(r);
    });
  });
}

// ─────────────────────────────────────────────────────── sesión

/**
 * Inicia sesión y devuelve el token con el que se llaman las funciones.
 *
 * El token dura una hora y vive sólo en memoria: cuando el proceso termina,
 * desaparece. No se escribe a disco a propósito, para que no quede un archivo
 * con una credencial válida esperando a que alguien lo encuentre.
 */
async function entrar() {
  const correo = (await preguntar(`Correo [${ADMIN}]: `)) || ADMIN;
  const clave = await preguntarEnSecreto("Contraseña: ");

  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: correo, password: clave, returnSecureToken: true }),
    },
  );

  const datos = await r.json();
  if (!r.ok) {
    // Sin decir si falló el correo o la contraseña.
    console.error("No pudimos entrar con esos datos.");
    if (datos?.error?.message === "INVALID_LOGIN_CREDENTIALS") {
      console.error("(correo o contraseña incorrectos)");
    } else if (datos?.error?.message) {
      console.error(`(${datos.error.message})`);
    }
    exit(1);
  }

  if (correo.toLowerCase() !== ADMIN.toLowerCase()) {
    console.error(`Esa cuenta no es la de administración. Las funciones la van a rechazar igual.`);
  }
  return datos.idToken;
}

/** Llama a una Cloud Function callable, como lo haría el navegador. */
async function llamar(nombre, token, datos = {}) {
  const r = await fetch(`https://${REGION}-${PROYECTO}.cloudfunctions.net/${nombre}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data: datos }),
  });
  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok || cuerpo.error) {
    throw new Error(cuerpo?.error?.message ?? `${nombre} respondió ${r.status}`);
  }
  return cuerpo.result;
}

// ─────────────────────────────────────────────────────── acciones

const rellenar = (t, n) => String(t ?? "").padEnd(n).slice(0, n);

async function listar(token) {
  const { total, vacias, cuentas } = await llamar("listarUsuariosAdmin", token);

  console.log(`\n${total} cuenta(s) · ${vacias} sin saldo ni partidas\n`);
  console.log(
    "  " + rellenar("ESTADO", 14) + rellenar("NOMBRE", 24) +
    rellenar("SALDO", 9) + rellenar("PARTIDAS", 10) + "UID",
  );
  console.log("  " + "-".repeat(86));

  for (const c of cuentas) {
    const estado = c.desactivado ? "desactivada" : c.vacia ? "VACÍA" : "con datos";
    console.log(
      "  " + rellenar(estado, 14) + rellenar(c.nombre || "(sin nombre)", 24) +
      rellenar(c.saldo, 9) + rellenar(`${c.partidas}/${c.victorias}`, 10) + c.uid,
    );
  }

  console.log(
    `\n  Para dar de baja una:  node herramientas/cuentas.mjs --baja <UID>\n` +
    `  VACÍA = sin saldo ni partidas, se borra del todo.\n` +
    `  con datos = se desactiva, conservando el historial.\n`,
  );
}

async function revisarNombres(token) {
  const r = await llamar("revisarNombresAdmin", token);
  console.log(`\n${r.revisados} perfiles revisados.`);
  if (!r.sospechosos.length) {
    console.log("✅ Ningún nombre con caracteres peligrosos.\n");
    return;
  }
  console.log(`⚠️  ${r.sospechosos.length} con caracteres raros, ${r.ataques} parecen un intento.\n`);
  for (const s of r.sospechosos) {
    console.log(`  ${s.pareceAtaque ? "ATAQUE" : "raro  "}  ${s.uid}  ${JSON.stringify(s.nombre)}`);
  }
  console.log("");
}

/**
 * Da de baja una cuenta.
 *
 * Se muestra PRIMERO qué cuenta es y qué va a pasar con ella, y recién después
 * se pide confirmación escribiendo el nombre. Un "s/n" se contesta sin leer, y
 * esto borra la cuenta de una persona.
 */
async function darDeBaja(token, uid) {
  const { cuentas } = await llamar("listarUsuariosAdmin", token);
  const cuenta = cuentas.find((c) => c.uid === uid);

  if (!cuenta) {
    console.error(`No hay ninguna cuenta con el uid ${uid}.`);
    console.error("Listalas con:  node herramientas/cuentas.mjs");
    exit(1);
  }

  const nombre = cuenta.nombre || "(sin nombre)";
  console.log(`\n  Cuenta:    ${nombre}`);
  console.log(`  UID:       ${cuenta.uid}`);
  console.log(`  Saldo:     ${cuenta.saldo} Leyendas`);
  console.log(`  Partidas:  ${cuenta.partidas} (${cuenta.victorias} ganadas)`);

  if (cuenta.desactivado) {
    console.log("\n  Ya estaba desactivada. No hay nada que hacer.\n");
    return;
  }

  console.log(
    cuenta.vacia
      ? "\n  → Se va a BORRAR del todo. No tiene historial que perder y no se puede deshacer."
      : "\n  → NO se va a borrar: tiene datos. Se DESACTIVA, conservando el historial.",
  );

  const escrito = await preguntar(`\n  Escribí el nombre para confirmar (${nombre}): `);
  if (escrito !== nombre) {
    console.log("  No coincide. No se tocó nada.\n");
    return;
  }

  const r = await llamar("eliminarUsuarioAdmin", token, { uid });
  const que = { eliminado: "borrada", desactivado: "desactivada", no_existia: "ya no estaba" };
  console.log(`\n  ✅ Cuenta ${que[r.hizo] ?? r.hizo}.\n`);
}

// ─────────────────────────────────────────────────────── arranque

const args = argv.slice(2);

/**
 * Sin terminal interactiva no hay forma de pedir una contraseña sin que quede
 * escrita en algún lado. Mejor decirlo que colgarse esperando una entrada que
 * no va a llegar: así se veía si lo corría un agente o un script, con un
 * "unsettled top-level await" que no explica nada.
 */
if (!stdin.isTTY) {
  console.error("Esto hay que correrlo en una terminal de verdad: pide una contraseña.");
  console.error("Abrí una consola en la carpeta del proyecto y ejecutá:");
  console.error("  node herramientas/cuentas.mjs");
  exit(1);
}

const token = await entrar();

if (args.includes("--nombres")) {
  await revisarNombres(token);
} else if (args.includes("--baja")) {
  const uid = args[args.indexOf("--baja") + 1];
  if (!uid) {
    console.error("Falta el uid:  node herramientas/cuentas.mjs --baja <UID>");
    exit(1);
  }
  await darDeBaja(token, uid);
} else {
  await listar(token);
}
