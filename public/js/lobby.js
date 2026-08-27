import {
  auth,
  db,
  doc,
  getDoc,
  updateDoc,
  increment,
  collection,
  query,
  where,
  onSnapshot,
  signOut,
  addDoc,
  serverTimestamp,
} from "./firebase-config.js";

const user = JSON.parse(localStorage.getItem("user"));
if (!user) window.location.href = "login.html";

document.getElementById("username").textContent = user.username;
document.getElementById("credits").textContent = user.credits;

onSnapshot(doc(db, "users", user.id), (doc) => {
  if (doc.exists()) {
    const data = doc.data();
    user.credits = data.credits;
    document.getElementById("credits").textContent = data.credits;
    localStorage.setItem("user", JSON.stringify(user));
  }
});

document.getElementById("rechargeBtn").addEventListener("click", async () => {
  try {
    await updateDoc(doc(db, "users", user.id), {
      credits: increment(50),
    });
    document.getElementById("mensaje").textContent = "✅ +50 créditos añadidos";
  } catch (error) {
    document.getElementById("mensaje").textContent = "❌ " + error.message;
  }
});

document.getElementById("createBtn").addEventListener("click", async () => {
  try {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    await addDoc(collection(db, "rooms"), {
      code: roomCode,
      hostId: user.id,
      hostName: user.username,
      players: [{ id: user.id, username: user.username }],
      state: "waiting",
      createdAt: serverTimestamp(),
    });

    localStorage.setItem("roomCode", roomCode);
    window.location.href = "game.html";
  } catch (error) {
    document.getElementById("mensaje").textContent = "❌ " + error.message;
  }
});

document.getElementById("joinBtn").addEventListener("click", async () => {
  const code = document.getElementById("roomCode").value.trim().toUpperCase();
  if (!code) {
    document.getElementById("mensaje").textContent = "❌ Ingresa un código";
    return;
  }

  try {
    const q = query(collection(db, "rooms"), where("code", "==", code));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      document.getElementById("mensaje").textContent = "❌ Sala no encontrada";
      return;
    }

    const roomDoc = querySnapshot.docs[0];
    const roomData = roomDoc.data();

    if (roomData.state !== "waiting") {
      document.getElementById("mensaje").textContent =
        "❌ La partida ya comenzó";
      return;
    }

    if (roomData.players.some((p) => p.id === user.id)) {
      localStorage.setItem("roomCode", code);
      window.location.href = "game.html";
      return;
    }

    await updateDoc(doc(db, "rooms", roomDoc.id), {
      players: [...roomData.players, { id: user.id, username: user.username }],
    });

    localStorage.setItem("roomCode", code);
    window.location.href = "game.html";
  } catch (error) {
    document.getElementById("mensaje").textContent = "❌ " + error.message;
  }
});

const q = query(collection(db, "rooms"), where("state", "==", "waiting"));
onSnapshot(q, (snapshot) => {
  const container = document.getElementById("salasContainer");
  container.innerHTML = "";

  if (snapshot.empty) {
    container.innerHTML =
      '<p style="color: #888;">No hay salas activas. ¡Crea una!</p>';
    return;
  }

  snapshot.forEach((doc) => {
    const data = doc.data();
    const div = document.createElement("div");
    div.className = "sala-item";
    div.innerHTML = `
      <span class="sala-code">${data.code}</span>
      <span class="sala-players">👥 ${data.players.length}/6</span>
      <button onclick="unirseSala('${data.code}')" class="btn-small">Unirse</button>
    `;
    container.appendChild(div);
  });
});

window.unirseSala = (code) => {
  document.getElementById("roomCode").value = code;
  document.getElementById("joinBtn").click();
};

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  localStorage.clear();
  window.location.href = "login.html";
});
