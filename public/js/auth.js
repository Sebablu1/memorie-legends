import {
  auth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  db,
  doc,
  getDoc,
} from "./firebase-config.js";

onAuthStateChanged(auth, (user) => {
  if (user) {
    window.location.href = "lobby.html";
  }
});

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const mensaje = document.getElementById("mensaje");

  try {
    const userCredential = await signInWithEmailAndPassword(
      auth,
      email,
      password,
    );
    const user = userCredential.user;

    const userDoc = await getDoc(doc(db, "users", user.uid));
    const userData = userDoc.data();

    localStorage.setItem(
      "user",
      JSON.stringify({
        id: user.uid,
        username: userData.username,
        credits: userData.credits || 50,
      }),
    );

    window.location.href = "lobby.html";
  } catch (error) {
    mensaje.textContent = "❌ " + error.message;
  }
});
