/**
 * Verificación en dos pasos (TOTP: Google Authenticator, Authy, 1Password…).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO PRIMERO: ESTO PUEDE DEJAR A ALGUIEN AFUERA DE SU CUENTA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Y en este juego la cuenta tiene saldo. Quien pierde el teléfono con la
 * aplicación de códigos y no guardó nada, pierde el acceso: Firebase no tiene
 * un "olvidé mi segundo factor" automático, y sacarlo hay que hacerlo a mano
 * desde la consola.
 *
 * De ahí tres decisiones que no son negociables:
 *
 *   - Es OPCIONAL. Nadie queda inscripto sin haberlo pedido.
 *   - Antes de terminar, se exige escribir un código que la aplicación de
 *     verdad haya generado. Si el teléfono no funciona, se descubre AHORA y
 *     no la próxima vez que quiera entrar.
 *   - Se puede quitar desde la misma pantalla, teniendo la sesión abierta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ TOTP Y NO SMS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El SMS es peor de tres formas: cuesta por mensaje, obliga a pedirle el
 * teléfono a cada jugador —un dato personal que hoy no tenemos y que habría
 * que cuidar— y se lo roban con un cambio de SIM, que es un ataque común y
 * barato contra cuentas con dinero. Un código de una aplicación no viaja por
 * ningún lado.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ HACE FALTA EN LA CONSOLA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Firebase Auth a secas NO tiene segundo factor: hace falta subir el proyecto
 * a Identity Platform y habilitar TOTP. Mientras eso no esté, todo lo de acá
 * falla con `auth/operation-not-allowed`, y esta pantalla lo explica en vez de
 * mostrar el error crudo. Los pasos están en `HACER-EN-LA-CONSOLA.md`.
 */

import { auth } from "./firebase.js";

const SDK_AUTH = "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

/**
 * Las piezas de MFA se cargan sólo cuando hacen falta.
 *
 * Están en el mismo módulo que ya baja `firebase.js`, así que esto no agrega
 * ninguna descarga: es sólo para no llenar de importaciones el archivo común
 * cuando la mayoría de las pantallas nunca las usa.
 */
const piezas = () => import(SDK_AUTH);

/** Un error nuestro, con un código que la pantalla pueda mirar. */
export class ErrorMfa extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo;
  }
}

/**
 * Traduce lo que devuelve Firebase.
 *
 * `operation-not-allowed` es el que más importa: no es un fallo del jugador
 * sino que falta habilitar TOTP en la consola. Mostrarle a alguien "Firebase:
 * Error (auth/operation-not-allowed)" lo deja pensando que hizo algo mal.
 */
function traducir(error) {
  const codigo = error?.code ?? "";
  const textos = {
    "auth/operation-not-allowed":
      "La verificación en dos pasos todavía no está habilitada en el servidor.",
    "auth/unverified-email":
      "Antes de activar los dos pasos hay que verificar tu correo.",
    "auth/requires-recent-login":
      "Por seguridad, volvé a iniciar sesión antes de cambiar esto.",
    "auth/invalid-verification-code":
      "Ese código no es válido. Fijate que sea el que muestra la aplicación ahora.",
    "auth/missing-verification-code": "Escribí el código de seis dígitos.",
    "auth/second-factor-already-in-use":
      "Esa aplicación ya está registrada en tu cuenta.",
    "auth/maximum-second-factor-count-exceeded":
      "Ya tenés el máximo de métodos registrados.",
  };
  return new ErrorMfa(codigo, textos[codigo] ?? error?.message ?? "No pudimos completar la operación.");
}

// ─────────────────────────────────────────────────────────── consultar

/**
 * Qué segundos factores tiene puestos esta cuenta.
 *
 * Se lee del usuario que ya está en memoria, sin pedirle nada al servidor.
 */
export async function estadoMfa(usuario = auth.currentUser) {
  if (!usuario) return { activo: false, factores: [], correoVerificado: false };

  const { multiFactor } = await piezas();
  const factores = multiFactor(usuario).enrolledFactors ?? [];

  return {
    activo: factores.length > 0,
    factores: factores.map((f) => ({
      uid: f.uid,
      nombre: f.displayName ?? "Aplicación de códigos",
      // Cuándo se registró. Sirve para reconocer uno viejo que ya no se usa.
      desde: f.enrollmentTime ?? null,
    })),
    correoVerificado: usuario.emailVerified === true,
  };
}

/**
 * Manda el correo de verificación.
 *
 * Firebase no deja inscribir un segundo factor si el correo no está
 * verificado, y con razón: si no lo está, quien recupere la contraseña por
 * correo no es necesariamente el dueño, y el segundo factor estaría
 * protegiendo una cuenta que ya era de otro.
 */
export async function verificarCorreo(usuario = auth.currentUser) {
  if (!usuario) throw new ErrorMfa("sin-sesion", "Iniciá sesión primero.");
  try {
    const { sendEmailVerification } = await piezas();
    await sendEmailVerification(usuario);
  } catch (error) {
    throw traducir(error);
  }
}

// ─────────────────────────────────────────────────────── inscripción

/**
 * Primer paso: genera el secreto que hay que cargar en la aplicación.
 *
 * Devuelve el secreto EN CRUDO —para escribirlo a mano— y la URI `otpauth://`
 * que las aplicaciones entienden. No se guarda nada todavía: hasta que no se
 * confirme con un código, la cuenta sigue igual que estaba.
 *
 * El objeto `secreto` hay que conservarlo entre este paso y el siguiente. Vive
 * en memoria de la pantalla y no se escribe en ningún lado: guardarlo en
 * `localStorage` sería dejar el segundo factor al alcance de cualquiera que
 * abra la consola, que es justo lo contrario de lo que se está construyendo.
 */
export async function empezarInscripcion(usuario = auth.currentUser) {
  if (!usuario) throw new ErrorMfa("sin-sesion", "Iniciá sesión primero.");
  if (!usuario.emailVerified) {
    throw new ErrorMfa("auth/unverified-email", traducir({ code: "auth/unverified-email" }).message);
  }

  try {
    const { multiFactor, TotpMultiFactorGenerator } = await piezas();
    const sesion = await multiFactor(usuario).getSession();
    const secreto = await TotpMultiFactorGenerator.generateSecret(sesion);

    return {
      secreto,
      // Para escribir a mano si la cámara no anda.
      clave: secreto.secretKey,
      // Lo que lee un lector de QR. El nombre de la cuenta que se ve en la
      // aplicación sale de acá.
      uri: secreto.generateQrCodeUrl(usuario.email ?? "jugador", "Memorie Legends"),
    };
  } catch (error) {
    throw traducir(error);
  }
}

/**
 * Segundo paso: confirmar con un código de la aplicación.
 *
 * Recién acá queda inscripta la cuenta. Exigir el código ANTES de guardar nada
 * es lo que evita el caso peor: alguien que activa los dos pasos, cierra la
 * pantalla creyendo que quedó, y descubre que la aplicación nunca tuvo el
 * secreto la próxima vez que quiere entrar.
 */
export async function confirmarInscripcion(secreto, codigo, nombre = "Aplicación de códigos") {
  const usuario = auth.currentUser;
  if (!usuario) throw new ErrorMfa("sin-sesion", "Iniciá sesión primero.");
  if (!/^\d{6}$/.test(String(codigo ?? "").trim())) {
    throw new ErrorMfa("auth/missing-verification-code", "Escribí el código de seis dígitos.");
  }

  try {
    const { multiFactor, TotpMultiFactorGenerator } = await piezas();
    const credencial = TotpMultiFactorGenerator.assertionForEnrollment(
      secreto,
      String(codigo).trim(),
    );
    await multiFactor(usuario).enroll(credencial, nombre);
    return true;
  } catch (error) {
    throw traducir(error);
  }
}

/** Quitar un segundo factor. Hace falta tener la sesión abierta y reciente. */
export async function quitarFactor(uidFactor) {
  const usuario = auth.currentUser;
  if (!usuario) throw new ErrorMfa("sin-sesion", "Iniciá sesión primero.");
  try {
    const { multiFactor } = await piezas();
    await multiFactor(usuario).unenroll(uidFactor);
    return true;
  } catch (error) {
    throw traducir(error);
  }
}

// ────────────────────────────────────────────────────────────── entrar

/**
 * ¿Este error de login es "falta el segundo paso"?
 *
 * No es un fallo: es la mitad del camino. La contraseña estaba bien y ahora
 * falta el código.
 */
export const necesitaSegundoPaso = (error) =>
  error?.code === "auth/multi-factor-auth-required";

/**
 * Qué métodos puede usar quien está entrando.
 *
 * Se le pasa el error tal cual vino de `signInWithEmailAndPassword`: ese
 * objeto lleva adentro la "resolución" pendiente, que es lo que permite
 * terminar de entrar. Si se pierde ese objeto, hay que empezar el login de
 * cero — de ahí que la pantalla lo guarde en una variable y no lo tire.
 */
export async function opcionesDeSegundoPaso(error) {
  const { getMultiFactorResolver } = await piezas();
  const resolucion = getMultiFactorResolver(auth, error);
  return {
    resolucion,
    metodos: resolucion.hints.map((h, i) => ({
      indice: i,
      nombre: h.displayName ?? "Aplicación de códigos",
      tipo: h.factorId,
    })),
  };
}

/**
 * Termina de entrar con el código.
 *
 * Devuelve las credenciales completas. A partir de acá `onAuthStateChanged`
 * se entera solo y sigue el camino de siempre.
 */
export async function terminarConCodigo(resolucion, codigo, indice = 0) {
  if (!/^\d{6}$/.test(String(codigo ?? "").trim())) {
    throw new ErrorMfa("auth/missing-verification-code", "Escribí el código de seis dígitos.");
  }

  try {
    const { TotpMultiFactorGenerator } = await piezas();
    const pista = resolucion.hints[indice];
    const credencial = TotpMultiFactorGenerator.assertionForSignIn(
      pista.uid,
      String(codigo).trim(),
    );
    return await resolucion.resolveSignIn(credencial);
  } catch (error) {
    throw traducir(error);
  }
}
