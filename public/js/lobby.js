import { db, auth, signOut } from "./firebase.js";
import {
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  runTransaction,
  increment,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

console.log("🔍 Iniciando lobby...");

// ========== VERIFICAR USUARIO ==========
const userData = localStorage.getItem("user");
if (!userData) {
  window.location.href = "login.html";
  throw new Error("Usuario no autenticado");
}

const user = JSON.parse(userData);
if (!user.username || !user.id) {
  localStorage.removeItem("user");
  window.location.href = "login.html";
  throw new Error("Datos de usuario inválidos");
}

console.log("✅ Usuario válido:", user.username, "Créditos:", user.credits);

// ========== REFERENCIAS A ELEMENTOS ==========
const usernameEl = document.getElementById("username");
const creditsEl = document.getElementById("creditsDisplay");
const winsEl = document.getElementById("winsDisplay");
const shopBtn = document.getElementById("shopBtn");
const rouletteBtn = document.getElementById("rouletteBtn");
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const roomCodeInput = document.getElementById("roomCode");
const roomNameInput = document.getElementById("roomName");
const maxPlayersSelect = document.getElementById("maxPlayers");
const betAmountSelect = document.getElementById("betAmount");
const mensajeEl = document.getElementById("mensaje");
const salasContainer = document.getElementById("salasContainer");
const logoutBtn = document.getElementById("logoutBtn");
const shopModal = document.getElementById("shopModal");
const closeShopBtn = document.getElementById("closeShopBtn");

// ========== MOSTRAR INFO USUARIO ==========
usernameEl.textContent = user.username;
creditsEl.textContent = user.credits || 0;
winsEl.textContent = user.wins || 0;

// ========== FUNCIONES AUXILIARES ==========
function mostrarMensaje(texto, tipo = "info") {
  mensajeEl.textContent = texto;
  mensajeEl.className = `mensaje ${tipo}`;
  setTimeout(() => {
    mensajeEl.textContent = "";
    mensajeEl.className = "mensaje";
  }, 4000);
}

function actualizarCredits(nuevosCredits) {
  user.credits = nuevosCredits;
  creditsEl.textContent = nuevosCredits;
  localStorage.setItem("user", JSON.stringify(user));
}

function generarCodigoSala() {
  const letras = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const numeros = "0123456789";
  let codigo = "";
  for (let i = 0; i < 4; i++) {
    codigo += letras.charAt(Math.floor(Math.random() * letras.length));
  }
  for (let i = 0; i < 2; i++) {
    codigo += numeros.charAt(Math.floor(Math.random() * numeros.length));
  }
  return codigo;
}

// ========== TIENDA ==========
shopBtn.addEventListener("click", () => {
  shopModal.style.display = "flex";
});

closeShopBtn.addEventListener("click", () => {
  shopModal.style.display = "none";
});

shopModal.addEventListener("click", (e) => {
  if (e.target === shopModal) {
    shopModal.style.display = "none";
  }
});

document.querySelectorAll(".shop-item").forEach((item) => {
  item.addEventListener("click", async () => {
    const credits = parseInt(item.dataset.credits);
    const price = parseInt(item.dataset.price);

    const confirmar = confirm(
      `💳 ¿Comprar ${credits} créditos por $${price} reales?`,
    );
    if (!confirmar) return;

    mostrarMensaje(`⏳ Procesando compra de ${credits} créditos...`, "info");

    setTimeout(async () => {
      try {
        const userRef = doc(db, "users", user.id);
        await updateDoc(userRef, {
          credits: increment(credits),
        });

        const nuevosCredits = (user.credits || 0) + credits;
        actualizarCredits(nuevosCredits);
        mostrarMensaje(`✅ ¡Compra exitosa! +${credits} créditos`, "exito");
        shopModal.style.display = "none";
      } catch (error) {
        console.error("Error:", error);
        mostrarMensaje("❌ Error al procesar la compra", "error");
      }
    }, 1500);
  });
});

// ========== RULETA GRATIS ==========
rouletteBtn.addEventListener("click", async () => {
  try {
    const userRef = doc(db, "users", user.id);
    const userDoc = await getDoc(userRef);
    const data = userDoc.data();

    const now = Date.now();
    const lastSpin = data.lastSpin || 0;
    const twoDays = 2 * 24 * 60 * 60 * 1000;

    if (now - lastSpin < twoDays) {
      const remaining = twoDays - (now - lastSpin);
      const hours = Math.floor(remaining / (60 * 60 * 1000));
      const mins = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
      mostrarMensaje(
        `⏳ Espera ${hours}h ${mins}m para girar de nuevo`,
        "warning",
      );
      return;
    }

    await updateDoc(userRef, {
      credits: increment(5),
      lastSpin: now,
    });

    const nuevosCredits = (user.credits || 0) + 5;
    actualizarCredits(nuevosCredits);
    mostrarMensaje(`🎰 ¡Ganaste 5 créditos gratis! Vuelve en 2 días`, "exito");
  } catch (error) {
    console.error("Error:", error);
    mostrarMensaje("❌ Error al girar la ruleta", "error");
  }
});

// ========== CREAR SALA ==========
createBtn.addEventListener("click", async () => {
  try {
    const codigo = generarCodigoSala();
    const nombre = roomNameInput.value.trim() || `Sala de ${user.username}`;
    const maxJugadores = parseInt(maxPlayersSelect.value);
    const apuesta = parseInt(betAmountSelect.value);

    if ((user.credits || 0) < apuesta) {
      mostrarMensaje(
        `❌ Necesitas ${apuesta} créditos para esta apuesta`,
        "error",
      );
      return;
    }

    const salaRef = collection(db, "rooms");
    await addDoc(salaRef, {
      codigo: codigo,
      nombre: nombre,
      creador: user.id,
      creadorNombre: user.username,
      jugadores: [user.id],
      jugadoresNombres: [user.username],
      maxJugadores: maxJugadores,
      apuesta: apuesta,
      estado: "esperando",
      createdAt: serverTimestamp(),
    });

    const nuevosCredits = (user.credits || 0) - apuesta;
    const userRef = doc(db, "users", user.id);
    await updateDoc(userRef, { credits: nuevosCredits });
    actualizarCredits(nuevosCredits);

    mostrarMensaje(`✅ Sala "${nombre}" creada! Código: ${codigo}`, "exito");

    localStorage.setItem("roomCode", codigo);
    setTimeout(() => {
      window.location.href = `room.html?code=${codigo}`;
    }, 1500);
  } catch (error) {
    console.error("Error al crear sala:", error);
    mostrarMensaje("❌ Error al crear la sala", "error");
  }
});

// ========== UNIRSE A SALA ==========
joinBtn.addEventListener("click", async () => {
  const codigo = roomCodeInput.value.trim().toUpperCase();
  if (!codigo) {
    mostrarMensaje("⚠️ Ingresa un código de sala", "info");
    return;
  }

  try {
    const roomsRef = collection(db, "rooms");
    const q = query(
      roomsRef,
      where("codigo", "==", codigo),
      where("estado", "==", "esperando"),
    );
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      mostrarMensaje("❌ Sala no encontrada o ya está en juego", "error");
      return;
    }

    const salaDoc = querySnapshot.docs[0];
    const salaData = salaDoc.data();
    const apuesta = salaData.apuesta || 10;

    if ((user.credits || 0) < apuesta) {
      mostrarMensaje(`❌ Necesitas ${apuesta} créditos para unirte`, "error");
      return;
    }

    if (
      salaData.jugadores &&
      salaData.jugadores.length >= salaData.maxJugadores
    ) {
      mostrarMensaje("❌ Sala llena", "error");
      return;
    }

    if (salaData.jugadores && salaData.jugadores.includes(user.id)) {
      mostrarMensaje("⚠️ Ya estás en esta sala", "info");
      window.location.href = `room.html?code=${codigo}`;
      return;
    }

    const salaRef = doc(db, "rooms", salaDoc.id);
    await updateDoc(salaRef, {
      jugadores: [...(salaData.jugadores || []), user.id],
      jugadoresNombres: [...(salaData.jugadoresNombres || []), user.username],
    });

    const nuevosCredits = (user.credits || 0) - apuesta;
    const userRef = doc(db, "users", user.id);
    await updateDoc(userRef, { credits: nuevosCredits });
    actualizarCredits(nuevosCredits);

    mostrarMensaje(`✅ Unido a sala ${codigo}`, "exito");
    roomCodeInput.value = "";
    localStorage.setItem("roomCode", codigo);

    setTimeout(() => {
      window.location.href = `room.html?code=${codigo}`;
    }, 1500);
  } catch (error) {
    console.error("Error al unirse:", error);
    mostrarMensaje("❌ Error al unirse a la sala", "error");
  }
});

// ========== ESCUCHAR SALAS ACTIVAS ==========
function escucharSalasActivas() {
  const roomsRef = collection(db, "rooms");
  const q = query(roomsRef, where("estado", "==", "esperando"));

  onSnapshot(
    q,
    (snapshot) => {
      salasContainer.innerHTML = "";

      if (snapshot.empty) {
        salasContainer.innerHTML =
          "<p style='color: #999;'>No hay salas activas</p>";
        return;
      }

      snapshot.forEach((doc) => {
        const sala = doc.data();
        const jugadores = sala.jugadores ? sala.jugadores.length : 0;
        const maxJugadores = sala.maxJugadores || 4;
        const apuesta = sala.apuesta || 10;

        const salaDiv = document.createElement("div");
        salaDiv.className = "sala-item";
        salaDiv.innerHTML = `
        <div class="sala-info">
          <strong>${sala.nombre || "Sala"}</strong>
          <span>📋 ${sala.codigo}</span>
          <span>👤 ${jugadores}/${maxJugadores}</span>
          <span>💰 ${apuesta} créditos</span>
          <span>Creador: ${sala.creadorNombre || "Anónimo"}</span>
        </div>
        <button class="btn-join-sala" data-codigo="${sala.codigo}">
          Unirse
        </button>
      `;

        const joinBtnSala = salaDiv.querySelector(".btn-join-sala");
        joinBtnSala.addEventListener("click", () => {
          roomCodeInput.value = sala.codigo;
          joinBtn.click();
        });

        salasContainer.appendChild(salaDiv);
      });
    },
    (error) => {
      console.error("Error al escuchar salas:", error);
    },
  );
}

escucharSalasActivas();

// ========== CERRAR SESIÓN ==========
logoutBtn.addEventListener("click", async () => {
  console.log("🔍 Cerrando sesión...");

  try {
    await signOut(auth);
    console.log("✅ Sesión cerrada en Firebase");
    localStorage.removeItem("user");
    localStorage.removeItem("roomCode");
    console.log("✅ localStorage limpiado");
    window.location.href = "login.html";
  } catch (error) {
    console.error("❌ Error al cerrar sesión:", error);
    localStorage.removeItem("user");
    window.location.href = "login.html";
  }
});

// ========== PERMITIR ENTER EN INPUT ==========
roomCodeInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    joinBtn.click();
  }
});

console.log("✅ Lobby inicializado correctamente");
