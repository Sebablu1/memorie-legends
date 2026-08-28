import {
  auth,
  createUserWithEmailAndPassword,
  db,
  doc,
  setDoc,
} from "./firebase.js";

const form = document.getElementById("registerForm");
const mensaje = document.getElementById("mensaje");
const boton = form.querySelector('button[type="submit"]');

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
