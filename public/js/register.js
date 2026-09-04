import {
  auth,
  createUserWithEmailAndPassword,
  signInWithPopup,
  googleProvider,
  db,
  doc,
  getDoc,
  setDoc,
} from "./firebase.js";

const form = document.getElementById("registerForm");
const mensaje = document.getElementById("mensaje");
const boton = form.querySelector('button[type="submit"]');
const botonGoogle = document.getElementById("googleBtn");

/** Las Leyendas de bienvenida. Un solo número, para las dos formas de entrar. */
const LEYENDAS_DE_REGALO = 100;

const avisar = (texto, clase = "") => {
  mensaje.textContent = texto;
  mensaje.className = `mensaje ${clase}`;
};

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

  if (!password || password.length < 6) {
    mensaje.textContent = "⚠️ La contraseña debe tener al menos 6 caracteres";
    mensaje.className = "mensaje error";
    return;
  }

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

    // 2. Guardar en Firestore con 100 CRÉDITOS GRATIS
    await setDoc(doc(db, "users", user.uid), {
      username: username,
      email: email,
      credits: 100, // ✅ 100 CRÉDITOS GRATIS
      gamesPlayed: 0,
      wins: 0,
      createdAt: new Date().toISOString(),
      lastSpin: 0, // ✅ Para la ruleta (timestamp)
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
    mensaje.textContent = "🎉 ¡Cuenta creada! +100 Leyendas de regalo";
    mensaje.className = "mensaje success";
    boton.textContent = "Entrando...";

    // 5. Redirigir al lobby
    setTimeout(() => {
      window.location.href = "dashboard.html";
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
    credits: LEYENDAS_DE_REGALO,
    gamesPlayed: 0,
    wins: 0,
    createdAt: new Date().toISOString(),
    lastSpin: 0,
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
    "auth/unauthorized-domain": "Dominio no autorizado. Escribinos a soporte.memorie.legends@gmail.com",
    "auth/network-request-failed": "No hay conexión. Revisá tu red y probá de nuevo.",
    // Pasa cuando ese correo ya está registrado con contraseña. Decirlo con
    // claridad ahorra el rato de probar el botón una y otra vez.
    "auth/account-exists-with-different-credential":
      "Ese correo ya tiene cuenta con contraseña. Entrá desde «Inicia sesión».",
  };
  return textos[error?.code] ?? error?.message ?? "No pudimos crear la cuenta.";
}

botonGoogle?.addEventListener("click", async () => {
  botonGoogle.disabled = true;
  avisar("Conectando con Google…", "info");

  try {
    const { user } = await signInWithPopup(auth, googleProvider);
    const { nueva, nombre } = await crearPerfilSiFalta(user);

    // Sólo lo que sirve para identificar. El saldo vive en Firestore: acá
    // sería un número que cualquiera edita desde la consola del navegador.
    localStorage.setItem(
      "user",
      JSON.stringify({ id: user.uid, username: nombre }),
    );

    avisar(
      nueva
        ? `🎉 ¡Cuenta creada! +${LEYENDAS_DE_REGALO} Leyendas de regalo`
        : "Ya tenías cuenta. Entrando…",
      "success",
    );
    window.location.replace("dashboard.html");
  } catch (error) {
    botonGoogle.disabled = false;
    avisar(explicar(error), "error");
    console.error(error);
  }
});
