import {
  auth,
  createUserWithEmailAndPassword,
  signInWithPopup,
  onAuthStateChanged,
  googleProvider,
  db,
  doc,
  getDoc,
  setDoc,
} from "./firebase.js";

// Un solo número para las dos formas de entrar, y el mismo que exige la regla
// de Firestore. Antes cada archivo tenía el suyo escrito a mano.
import {
  LEYENDAS_REGISTRO,
  saldoDeRegistro,
  aceptacionTerminos,
} from "./reglas/economia.js";

// Quien llegó por un link corto vuelve al LOBBY, no al tablero: es el caso
// más común de una invitación, porque a quien te invita un amigo suele no
// tener cuenta todavía.
import { hay as hayCodigoPendiente } from "./codigo-pendiente.js";

const form = document.getElementById("registerForm");
const mensaje = document.getElementById("mensaje");
const boton = form.querySelector('button[type="submit"]');
const botonGoogle = document.getElementById("googleBtn");

const avisar = (texto, clase = "") => {
  mensaje.textContent = texto;
  mensaje.className = `mensaje ${clase}`;
};

/**
 * Hay un registro en marcha en esta misma pestaña.
 *
 * Existe por una carrera concreta. `createUserWithEmailAndPassword` deja la
 * sesión abierta ANTES de que corra el `setDoc`, así que el
 * `onAuthStateChanged` del final de este archivo se despierta en un instante
 * en el que hay sesión y todavía no hay perfil — que es exactamente la
 * situación que ese bloque trata como «entró con Google y no terminó». Sin
 * esta bandera, crear una cuenta por correo mostraría el cartel de terminar
 * con Google en el medio.
 */
let registrandoAhora = false;

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const username = document.getElementById("username").value.trim();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  // Validaciones básicas
  if (!username || username.length < 3) {
    mensaje.textContent =
      "⚠️ El nombre de usuario debe tener al menos 3 caracteres";
    mensaje.className = "mensaje error";
    return;
  }

  if (!email || !email.includes("@")) {
    mensaje.textContent = "⚠️ Ingresa un email válido";
    mensaje.className = "mensaje error";
    return;
  }

  const acepto = document.getElementById("aceptoTerminos")?.checked;
  if (!acepto) {
    mensaje.textContent = "⚠️ Tenés que aceptar los Términos y Condiciones";
    mensaje.className = "mensaje error";
    return;
  }

  if (!password || password.length < 6) {
    mensaje.textContent = "⚠️ La contraseña debe tener al menos 6 caracteres";
    mensaje.className = "mensaje error";
    return;
  }

  registrandoAhora = true;
  boton.disabled = true;
  boton.textContent = "Creando cuenta...";
  mensaje.textContent = "";
  mensaje.className = "mensaje";

  try {
    // 1. Crear usuario en Firebase Auth
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password,
    );
    const user = userCredential.user;
    console.log("✅ Usuario creado:", user.uid);

    // 2. Guardar en Firestore con las Leyendas de bienvenida.
    await setDoc(doc(db, "users", user.uid), {
      username: username,
      email: email,
      ...saldoDeRegistro(),
      gamesPlayed: 0,
      wins: 0,
      createdAt: new Date().toISOString(),
      terminos: aceptacionTerminos(),
    });

    console.log("✅ Usuario guardado en Firestore");

    // 3. Guardar en localStorage lo que sirve para identificar, y nada más.
    // El saldo vive en Firestore: acá sería un valor editable por el jugador.
    localStorage.setItem(
      "user",
      JSON.stringify({
        id: user.uid,
        username: username,
      }),
    );

    console.log("✅ Datos guardados en localStorage");

    // 4. Mostrar mensaje de éxito
    mensaje.textContent = `🎉 ¡Cuenta creada! +${LEYENDAS_REGISTRO} Leyendas de bienvenida`;
    mensaje.className = "mensaje success";
    boton.textContent = "Entrando...";

    // 5. Redirigir: al lobby si vino por una invitación, al tablero si no.
    setTimeout(() => {
      window.location.href = hayCodigoPendiente() ? "lobby.html" : "dashboard.html";
    }, 1500);
  } catch (error) {
    console.error("❌ Error de registro:", error);

    // Mensajes de error amigables
    let msg = "❌ " + error.message;
    if (error.code === "auth/email-already-in-use") {
      msg = "❌ Este email ya está registrado. ¿Quieres iniciar sesión?";
    } else if (error.code === "auth/weak-password") {
      msg = "❌ La contraseña debe tener al menos 6 caracteres";
    } else if (error.code === "auth/invalid-email") {
      msg = "❌ El email no es válido";
    } else if (error.code === "auth/network-request-failed") {
      msg = "❌ Error de conexión. Verifica tu internet";
    }

    mensaje.textContent = msg;
    mensaje.className = "mensaje error";
    boton.disabled = false;
    boton.textContent = "Registrarse";
  }
});


// ==========================================================
// CREAR CUENTA CON GOOGLE
// ==========================================================

/**
 * Crea el perfil en Firestore SÓLO si no existía.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ESTO ES LO MÁS IMPORTANTE DE TODO EL ARCHIVO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * "Crear cuenta con Google" también deja entrar a quien YA tiene cuenta: es
 * el mismo botón, y Google no distingue registrarse de iniciar sesión. Así
 * que este camino lo va a recorrer gente con partidas jugadas y con Leyendas
 * compradas.
 *
 * Un `setDoc` a secas les pondría el saldo en 100 y las partidas en cero. A
 * alguien con 2.500 Leyendas eso le borra lo que pagó, y no hay forma de
 * saberlo mirando la pantalla: entra, ve un número más chico y no entiende.
 *
 * Por eso se lee ANTES y sólo se escribe si no había nada. Devuelve si la
 * cuenta es nueva, para no decirle "¡Cuenta creada!" a quien ya la tenía.
 */
async function crearPerfilSiFalta(usuario) {
  const ref = doc(db, "users", usuario.uid);
  const perfil = await getDoc(ref);

  if (perfil.exists()) return { nueva: false, nombre: perfil.data().username };

  const correo = usuario.email ?? "";
  const nombre = usuario.displayName || correo.split("@")[0] || "Jugador";

  await setDoc(ref, {
    username: nombre,
    email: correo,
    ...saldoDeRegistro(),
    gamesPlayed: 0,
    wins: 0,
    createdAt: new Date().toISOString(),
    terminos: aceptacionTerminos(),
    provider: usuario.providerData?.[0]?.providerId ?? "google.com",
  });

  return { nueva: true, nombre };
}

/** Qué decirle a la persona según lo que falló. */
function explicar(error) {
  const textos = {
    "auth/popup-closed-by-user": "Cerraste la ventana de Google. Probá de nuevo.",
    "auth/cancelled-popup-request": "Cerraste la ventana de Google. Probá de nuevo.",
    "auth/popup-blocked": "El navegador bloqueó la ventana. Permitile abrir ventanas a este sitio.",
    "auth/unauthorized-domain": "Dominio no autorizado. Escribinos a soporte@memorielegends.com",
    "auth/network-request-failed": "No hay conexión. Revisá tu red y probá de nuevo.",
    // Pasa cuando ese correo ya está registrado con contraseña. Decirlo con
    // claridad ahorra el rato de probar el botón una y otra vez.
    "auth/account-exists-with-different-credential":
      "Ese correo ya tiene cuenta con contraseña. Entrá desde «Inicia sesión».",
  };
  return textos[error?.code] ?? error?.message ?? "No pudimos crear la cuenta.";
}

/**
 * ¿Marcó la casilla?
 *
 * La misma pregunta para los dos caminos. El formulario además la tiene como
 * `required`, así que el navegador la pide solo; el botón de Google no está
 * dentro de ningún `<form>` y no tiene quién se la pida, de ahí esta función.
 */
const aceptoLosTerminos = () =>
  document.getElementById("aceptoTerminos")?.checked === true;

const PEDIR_CASILLA = "⚠️ Tenés que aceptar los Términos y Condiciones";

botonGoogle?.addEventListener("click", async () => {
  /*
   * La casilla también acá, y no es un detalle de formulario.
   *
   * Antes este botón no la miraba: estaba fuera del `<form>`, así que ni el
   * navegador ni el `submit` la alcanzaban. Pero el perfil que crea escribe
   * `terminos.aceptado` igual, con la fecha del momento. O sea que dejaba
   * asentada una aceptación que nunca ocurrió.
   *
   * Eso es peor que no guardar nada. Lo único que ese campo tiene que poder
   * decir es «esta persona vio el texto y dijo que sí»; si se escribe sin
   * casilla, dice algo que no pasó, y entonces no sirve para lo único que se
   * escribió. Se pregunta antes de abrir la ventana de Google para no dejar a
   * nadie a medio registrar.
   */
  if (!aceptoLosTerminos()) {
    avisar(PEDIR_CASILLA, "error");
    document.getElementById("aceptoTerminos")?.focus();
    return;
  }

  registrandoAhora = true;
  botonGoogle.disabled = true;
  avisar("Conectando con Google…", "info");

  try {
    const { user } = await signInWithPopup(auth, googleProvider);
    await crearPerfilYEntrar(user);
  } catch (error) {
    botonGoogle.disabled = false;
    avisar(explicar(error), "error");
    console.error(error);
  }
});

/**
 * Crea el perfil si falta y entra. Lo comparten los dos botones de Google: el
 * de esta pantalla y el cartel de abajo, que atiende a quien llegó con la
 * sesión ya abierta desde el login.
 */
async function crearPerfilYEntrar(user) {
  const { nueva, nombre } = await crearPerfilSiFalta(user);

  // Sólo lo que sirve para identificar. El saldo vive en Firestore: acá
  // sería un número que cualquiera edita desde la consola del navegador.
  localStorage.setItem(
    "user",
    JSON.stringify({ id: user.uid, username: nombre }),
  );

  avisar(
    nueva
      ? `🎉 ¡Cuenta creada! +${LEYENDAS_REGISTRO} Leyendas de bienvenida`
      : "Ya tenías cuenta. Entrando…",
    "success",
  );
  window.location.replace(hayCodigoPendiente() ? "lobby.html" : "dashboard.html");
}

// ==========================================================
// QUIEN YA ENTRÓ CON GOOGLE Y NO TIENE PERFIL
// ==========================================================
//
// `auth.js` manda acá a quien abrió sesión con Google desde el login y no
// tiene perfil. Antes esa persona nacía allá, sin ver ninguna casilla; ahora
// se termina de registrar en esta pantalla, que es la única que crea perfiles
// y la única que muestra los Términos.
//
// Lo que ve es el cartel y la casilla, no el formulario entero: ya se
// identificó con Google y pedirle usuario, correo y contraseña sería hacerle
// repetir lo que acaba de hacer.
//
// La sesión se lee de Firebase y no de un parámetro en la dirección. Un
// `?google=1` lo escribe cualquiera y queda pegado en el historial; la sesión
// es lo único que de verdad dice si hay alguien adentro.

const cajaTerminar = document.getElementById("terminarGoogle");
const botonTerminar = document.getElementById("terminarGoogleBtn");

onAuthStateChanged(auth, async (usuario) => {
  // Un registro en curso en esta pestaña pasa por acá a mitad de camino, con
  // sesión y sin perfil todavía. No es el caso que este bloque atiende.
  if (!usuario || registrandoAhora || !cajaTerminar) return;

  try {
    const perfil = await getDoc(doc(db, "users", usuario.uid));
    if (perfil.exists()) return;

    // El formulario de correo no sirve para esta persona: ya tiene con qué
    // identificarse. Se esconde para que no haya dos caminos a la vista.
    form.hidden = true;
    botonGoogle.hidden = true;
    document.querySelector(".or-divider")?.setAttribute("hidden", "");
    cajaTerminar.hidden = false;
  } catch (error) {
    // Si no se pudo leer el perfil, se deja la pantalla como estaba: el
    // formulario sigue ahí y la persona tiene cómo seguir.
    console.error("No se pudo saber si ya hay perfil:", error);
  }
});

botonTerminar?.addEventListener("click", async () => {
  if (!aceptoLosTerminos()) {
    avisar(PEDIR_CASILLA, "error");
    document.getElementById("aceptoTerminos")?.focus();
    return;
  }

  const usuario = auth.currentUser;
  if (!usuario) {
    avisar("Se cerró la sesión. Entrá de nuevo con Google.", "error");
    return;
  }

  registrandoAhora = true;
  botonTerminar.disabled = true;
  botonTerminar.textContent = "Creando cuenta…";

  try {
    await crearPerfilYEntrar(usuario);
  } catch (error) {
    botonTerminar.disabled = false;
    botonTerminar.textContent = "Crear mi cuenta";
    avisar(explicar(error), "error");
    console.error(error);
  }
});
