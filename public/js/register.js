import {
  auth,
  createUserWithEmailAndPassword,
  db,
  doc,
  setDoc,
} from "./firebase-config.js";

document
  .getElementById("registerForm")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("username").value;
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    const mensaje = document.getElementById("mensaje");

    try {
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password,
      );
      const user = userCredential.user;

      await setDoc(doc(db, "users", user.uid), {
        username: username,
        email: email,
        credits: 50,
        gamesPlayed: 0,
        wins: 0,
        createdAt: new Date().toISOString(),
      });

      localStorage.setItem(
        "user",
        JSON.stringify({
          id: user.uid,
          username: username,
          credits: 50,
        }),
      );

      window.location.href = "lobby.html";
    } catch (error) {
      mensaje.textContent = "❌ " + error.message;
    }
  });
