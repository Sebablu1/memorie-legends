import {
  auth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  googleProvider,
  signInWithPopup,
  db,
  doc,
  getDoc,
  setDoc,
  SUPPORT_EMAIL,
} from "./firebase.js";

console.log("🔍 auth.js cargado");

// ========== VERIFICAR ESTADO ==========
onAuthStateChanged(auth, async (user) => {
  console.log(
    "🔍 onAuthStateChanged - Usuario:",
    user ? "Autenticado" : "No autenticado",
  );

  if (!user) {
    localStorage.removeItem("user");
    console.log("❌ Usuario no autenticado, localStorage limpiado");
    return;
  }

  if (user) {
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      let userData = userDoc.data();

      if (!userData) {
        console.log("⚠️ Usuario sin datos, creando en Firestore...");
        const email = user.email || "usuario@email.com";
        const username = user.displayName || email.split("@")[0] || "Usuario";

        await setDoc(doc(db, "users", user.uid), {
          username: username,
          email: email,
          credits: 100,
          gamesPlayed: 0,
          wins: 0,
          createdAt: new Date().toISOString(),
          lastSpin: 0,
          provider: "google",
        });
        userData = { username, credits: 100 };
        console.log("✅ Usuario de Google creado en Firestore");
      }

      // El saldo NO se guarda acá. localStorage lo edita cualquiera desde la
      // consola, así que guardarlo invita a tratarlo como cierto en algún
      // punto. Las Leyendas se leen siempre de Firestore, con sesion.js.
      localStorage.setItem(
        "user",
        JSON.stringify({
          id: user.uid,
          username: userData.username || user.displayName || "Usuario",
        }),
      );
      console.log("✅ Usuario guardado en localStorage");

      const currentPage = window.location.pathname;
      if (
        currentPage.includes("login.html") ||
        currentPage === "/" ||
        currentPage === "/index.html"
      ) {
        console.log("✅ Redirigiendo al panel...");
        window.location.href = "dashboard.html";
      }
    } catch (error) {
      console.error("❌ Error al obtener datos:", error);
    }
  }
});

// ========== LOGIN CON GOOGLE ==========
const googleBtn = document.getElementById("googleBtn");
if (googleBtn) {
  googleBtn.addEventListener("click", async () => {
    console.log("🔍 Click en botón de Google");
    const mensaje = document.getElementById("mensaje");

    try {
      mensaje.textContent = "⏳ Conectando con Google...";
      mensaje.className = "mensaje info";

      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      console.log("✅ Login con Google exitoso:", user.uid);

      mensaje.textContent = "✅ ¡Bienvenido!";
      mensaje.className = "mensaje success";
    } catch (error) {
      console.error("❌ Error en Google Login:", error);

      let mensajeError = "❌ " + error.message;
      if (error.code === "auth/popup-closed-by-user") {
        mensajeError = "❌ Cerraste la ventana de Google. Intenta de nuevo";
      } else if (error.code === "auth/popup-blocked") {
        mensajeError = "❌ El navegador bloqueó la ventana. Permite popups";
      } else if (error.code === "auth/unauthorized-domain") {
        mensajeError = `❌ Dominio no autorizado. Contacta a soporte: ${SUPPORT_EMAIL}`;
      }

      mensaje.textContent = mensajeError;
      mensaje.className = "mensaje error";
    }
  });
} else {
  console.error("❌ Botón de Google no encontrado en el DOM");
}

// ========== LOGIN TRADICIONAL ==========
document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  console.log("🔍 Formulario de login enviado");

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const mensaje = document.getElementById("mensaje");

  mensaje.textContent = "⏳ Iniciando sesión...";
  mensaje.className = "mensaje info";

  try {
    const userCredential = await signInWithEmailAndPassword(
      auth,
      email,
      password,
    );
    const user = userCredential.user;
    console.log("✅ Login exitoso - UID:", user.uid);

    mensaje.textContent = "✅ ¡Bienvenido!";
    mensaje.className = "mensaje success";
  } catch (error) {
    console.error("❌ Error de login:", error);

    let mensajeError = "❌ " + error.message;
    if (error.code === "auth/user-not-found") {
      mensajeError = `❌ No existe cuenta con ese email. Contacta a soporte: ${SUPPORT_EMAIL}`;
    } else if (error.code === "auth/wrong-password") {
      mensajeError = "❌ Contraseña incorrecta";
    } else if (error.code === "auth/too-many-requests") {
      mensajeError = "❌ Demasiados intentos. Espera 5 minutos";
    }

    mensaje.textContent = mensajeError;
    mensaje.className = "mensaje error";
  }
});

// ========== RESTABLECER CONTRASEÑA ==========
document
  .getElementById("resetPasswordBtn")
  .addEventListener("click", async () => {
    console.log("🔍 Botón de restablecimiento clickeado");
    const email = document.getElementById("email").value;
    const mensaje = document.getElementById("mensaje");

    if (!email) {
      mensaje.textContent = "⚠️ Ingresa tu email primero";
      mensaje.className = "mensaje warning";
      return;
    }

    mensaje.textContent = "⏳ Enviando correo...";
    mensaje.className = "mensaje info";

    try {
      await sendPasswordResetEmail(auth, email);
      mensaje.textContent = `📧 Revisa tu correo: ${email}`;
      mensaje.className = "mensaje success";
      console.log("✅ Email de restablecimiento enviado a:", email);
    } catch (error) {
      console.error("❌ Error al enviar restablecimiento:", error);
      let mensajeError = "❌ " + error.message;
      if (error.code === "auth/user-not-found") {
        mensajeError = `❌ No existe cuenta con ese email. Contacta a soporte: ${SUPPORT_EMAIL}`;
      } else if (error.code === "auth/invalid-email") {
        mensajeError = "❌ El email no es válido";
      }
      mensaje.textContent = mensajeError;
      mensaje.className = "mensaje error";
    }
  });

console.log("✅ auth.js completamente cargado");
