import { db, auth, signOut } from "./firebase.js";
import { crearSala, unirseASala, ErrorDeServidor } from "./servidor.js";
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

console.log("✅ Usuario válido:", user.username);

/** Saldo autoritativo, tal como lo devuelve Firestore. Nunca se calcula acá. */
let saldoActual = 0;

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
// El saldo NUNCA sale de localStorage: es el dato que el usuario puede editar.
// La única fuente autoritativa es el documento de Firestore, y se escucha en
// vivo para que cualquier cambio hecho por el servidor se refleje solo.
creditsEl.textContent = "…";
onSnapshot(doc(db, "users", user.id), (snap) => {
  const saldo = snap.exists() ? (snap.data().credits ?? 0) : 0;
  creditsEl.textContent = saldo;
  saldoActual = saldo;
});
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

// El código de sala lo genera el servidor: es el ID del documento, así la
// unicidad la garantiza Firestore. El navegador ya no lo inventa.

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

    // GRIFO CERRADO. Este bloque acreditaba Leyendas con un confirm() y sin
    // ningún pago: se podía llamar desde la consola con el importe que fuera.
    // La compra real vive en tienda.html y sólo puede acreditar el servidor,
    // cuando haya Cloud Functions, contra un aviso firmado del proveedor.
    mostrarMensaje(
      "La compra de Leyendas todavía no está disponible. Muy pronto.",
      "info",
    );
    shopModal.style.display = "none";
  });
});

// ========== RULETA ==========
// El giro dejó de acreditar desde el navegador: cualquiera podía llamarlo
// desde la consola. La ruleta completa vive en ruleta.html y sólo va a
// acreditar cuando el sorteo y el saldo los maneje el servidor.
rouletteBtn.addEventListener("click", () => {
  window.location.href = "ruleta.html";
});

// ========== CREAR SALA ==========
createBtn.addEventListener("click", async () => {
  try {
    const nombre = roomNameInput.value.trim() || `Sala de ${user.username}`;
    const maxJugadores = parseInt(maxPlayersSelect.value);
    const apuesta = parseInt(betAmountSelect.value);

    // Aviso temprano usando el saldo autoritativo. El servidor vuelve a
    // comprobarlo igual: esto es sólo cortesía, no seguridad.
    if (saldoActual < apuesta) {
      mostrarMensaje(`❌ Te faltan Leyendas: la entrada es de ${apuesta}.`, "error");
      return;
    }

    // El servidor crea la sala y cobra la entrada en una sola transacción.
    // El navegador no calcula ni escribe saldo: sólo pide y muestra.
    let resultado;
    try {
      mostrarMensaje("⏳ Creando la sala…", "info");
      resultado = await crearSala(apuesta, nombre);
    } catch (error) {
      mostrarMensaje(
        error instanceof ErrorDeServidor ? `❌ ${error.message}` : "❌ No pudimos crear la sala.",
        "error",
      );
      return;
    }

    const codigo = resultado.codigo;
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

    // El servidor valida cupo, estado y saldo, y cobra la entrada, todo
    // dentro de una transacción: dos jugadores entrando a la vez no pueden
    // dejar la sala en cinco ni pagar dos veces.
    try {
      mostrarMensaje("⏳ Entrando a la sala…", "info");
      await unirseASala(codigo);
    } catch (error) {
      mostrarMensaje(
        error instanceof ErrorDeServidor ? `❌ ${error.message}` : "❌ No pudimos entrar a la sala.",
        "error",
      );
      return;
    }

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
