import {
  auth,
  db,
  doc,
  getDoc,
  updateDoc,
  onSnapshot,
  collection,
  query,
  where,
  getDocs,
  deleteDoc,
  increment,
} from "./firebase.js"; // ✅ Cambiado de firebase-config.js a firebase.js

import { crearBaraja, barajar, calcularPuntaje, esIgual } from "./gameLogic.js";

const user = JSON.parse(localStorage.getItem("user"));
const roomCode = localStorage.getItem("roomCode");
if (!user || !roomCode) window.location.href = "lobby.html";

let roomId = null;
let roomData = null;
let cartaLevantada = null;

document.getElementById("roomCode").textContent = roomCode;

const q = query(collection(db, "rooms"), where("code", "==", roomCode));
const unsubscribe = onSnapshot(q, async (snapshot) => {
  if (snapshot.empty) {
    document.getElementById("mensaje").textContent = "❌ Sala no encontrada";
    return;
  }

  const doc = snapshot.docs[0];
  roomId = doc.id;
  roomData = doc.data();

  actualizarUI(roomData);
});

function actualizarUI(data) {
  const { players, state, muestra, turnoActual, ganador } = data;

  document.getElementById("fase").textContent =
    `📌 Fase: ${state === "waiting" ? "Esperando" : state === "playing" ? "Jugando" : "Terminada"}`;

  const jugadorTurno = players?.find((p) => p.id === turnoActual);
  document.getElementById("turnoJugador").textContent = jugadorTurno
    ? jugadorTurno.username
    : "Nadie";

  const muestraText = muestra
    ? `${muestra.numero} de ${muestra.palo}`
    : "Sin muestra";
  document.getElementById("muestra").textContent = muestraText;

  const container = document.getElementById("jugadores");
  container.innerHTML = "";

  if (players) {
    players.forEach((j) => {
      const div = document.createElement("div");
      div.className = "jugador" + (j.id === turnoActual ? " esTurno" : "");

      const cartasHTML = j.cartas
        ? j.cartas
            .map((c, idx) => {
              const isOwn = j.id === user.id;
              return `<div class="carta ${isOwn ? "" : "bocaAbajo"}" 
                  onclick="${isOwn && state === "playing" ? `descartarCarta(${idx})` : ""}"
                  style="${isOwn && state === "playing" ? "cursor:pointer;" : ""}">
                  ${isOwn ? `${c.numero} ${c.palo}` : "?"}
                </div>`;
            })
            .join("")
        : '<div class="carta bocaAbajo">?</div>';

      div.innerHTML = `
        <div class="nombre">${j.username} ${j.id === turnoActual ? "🎯" : ""}</div>
        <div class="puntos">⭐ ${j.totalPuntos || 0} pts</div>
        <div class="cartas">${cartasHTML}</div>
      `;
      container.appendChild(div);
    });
  }

  const esMiTurno = turnoActual === user.id;
  document.getElementById("levantarBtn").disabled =
    !esMiTurno || state !== "playing";
  document.getElementById("corteBtn").disabled =
    !esMiTurno || state !== "playing";

  const iniciarBtn = document.getElementById("iniciarBtn");
  if (state === "waiting" && data.hostId === user.id && players?.length >= 2) {
    iniciarBtn.style.display = "inline";
    iniciarBtn.onclick = iniciarPartida;
  } else {
    iniciarBtn.style.display = "none";
  }

  if (ganador) {
    const ganadorObj = players?.find((p) => p.id === ganador);
    document.getElementById("mensaje").textContent =
      `🏆 ¡${ganadorObj?.username || "Alguien"} ganó la partida!`;
  }
}

async function iniciarPartida() {
  try {
    let mazo = crearBaraja();
    barajar(mazo);

    const players = roomData.players;
    const cartasPorJugador = players.map(() => {
      return Array.from({ length: 4 }, () => mazo.pop());
    });

    const muestra = mazo.pop();

    await updateDoc(doc(db, "rooms", roomId), {
      state: "playing",
      mazo: mazo,
      muestra: muestra,
      turnoActual: players[0].id,
      players: players.map((p, idx) => ({
        ...p,
        cartas: cartasPorJugador[idx],
        totalPuntos: 0,
        penalizaciones: 0,
      })),
    });

    document.getElementById("mensaje").textContent = "🎮 ¡Partida iniciada!";
  } catch (error) {
    document.getElementById("mensaje").textContent = "❌ " + error.message;
  }
}

window.descartarCarta = async (index) => {
  if (!roomData || roomData.turnoActual !== user.id) {
    document.getElementById("mensaje").textContent = "❌ No es tu turno";
    return;
  }

  try {
    const jugador = roomData.players.find((p) => p.id === user.id);
    const carta = jugador.cartas[index];

    if (!carta) return;

    if (!esIgual(carta, roomData.muestra)) {
      const nuevaCarta = roomData.mazo.pop();
      if (nuevaCarta) {
        jugador.cartas.push(nuevaCarta);
      }
      jugador.penalizaciones = (jugador.penalizaciones || 0) + 1;

      await updateDoc(doc(db, "rooms", roomId), {
        players: roomData.players,
        mazo: roomData.mazo,
      });

      pasarTurno();
      document.getElementById("mensaje").textContent =
        "❌ Carta no coincide. Penalización +1 carta";
      return;
    }

    jugador.cartas.splice(index, 1);

    await updateDoc(doc(db, "rooms", roomId), {
      players: roomData.players,
      mazo: roomData.mazo,
    });

    pasarTurno();
    document.getElementById("mensaje").textContent =
      "✅ Carta descartada correctamente";
  } catch (error) {
    document.getElementById("mensaje").textContent = "❌ " + error.message;
  }
};

function pasarTurno() {
  const players = roomData.players;
  const idx = players.findIndex((p) => p.id === roomData.turnoActual);
  const nextIdx = (idx + 1) % players.length;

  updateDoc(doc(db, "rooms", roomId), {
    turnoActual: players[nextIdx].id,
  });
}

document.getElementById("levantarBtn").addEventListener("click", async () => {
  if (!roomData || roomData.turnoActual !== user.id) {
    document.getElementById("mensaje").textContent = "❌ No es tu turno";
    return;
  }

  try {
    const carta = roomData.mazo.pop();
    if (!carta) {
      document.getElementById("mensaje").textContent =
        "❌ No hay cartas en el mazo";
      return;
    }

    cartaLevantada = carta;

    const opcion = confirm(
      `📤 Has levantado: ${carta.numero} de ${carta.palo}\n\n¿Quieres cambiarla por una de tus cartas?\n(Aceptar = Cambiar, Cancelar = Tirar)`,
    );

    if (opcion) {
      const index = prompt("¿Qué carta quieres cambiar? (0-3):");
      if (index !== null && !isNaN(index) && index >= 0 && index < 4) {
        await cambiarCarta(parseInt(index));
      } else {
        await tirarCarta();
      }
    } else {
      await tirarCarta();
    }
  } catch (error) {
    document.getElementById("mensaje").textContent = "❌ " + error.message;
  }
});

async function cambiarCarta(index) {
  const jugador = roomData.players.find((p) => p.id === user.id);
  const cartaVieja = jugador.cartas[index];
  jugador.cartas[index] = cartaLevantada;
  roomData.mazo.push(cartaVieja);

  await updateDoc(doc(db, "rooms", roomId), {
    players: roomData.players,
    mazo: roomData.mazo,
  });

  cartaLevantada = null;
  pasarTurno();
  document.getElementById("mensaje").textContent = "🔄 Carta cambiada";
}

async function tirarCarta() {
  const num = cartaLevantada.numero;
  if (num === 7 || num === 8 || num === 9 || num === 10) {
    document.getElementById("mensaje").textContent =
      `⚡ Poder ${num} activado!`;
  }

  roomData.mazo.push(cartaLevantada);

  await updateDoc(doc(db, "rooms", roomId), {
    mazo: roomData.mazo,
  });

  cartaLevantada = null;
  pasarTurno();
}

document.getElementById("corteBtn").addEventListener("click", async () => {
  if (!roomData || roomData.turnoActual !== user.id) {
    document.getElementById("mensaje").textContent = "❌ No es tu turno";
    return;
  }

  try {
    const jugador = roomData.players.find((p) => p.id === user.id);
    const puntajes = roomData.players.map((p) => ({
      id: p.id,
      puntaje: calcularPuntaje(p.cartas || []),
    }));
    const minPuntaje = Math.min(...puntajes.map((p) => p.puntaje));
    const esElMenor =
      puntajes.find((p) => p.id === user.id).puntaje === minPuntaje;

    if (esElMenor) {
      jugador.totalPuntos = (jugador.totalPuntos || 0) - 10;
      document.getElementById("mensaje").textContent =
        "✅ ¡Corte exitoso! -10 puntos";
    } else {
      jugador.totalPuntos = (jugador.totalPuntos || 0) + 10;
      document.getElementById("mensaje").textContent =
        "❌ Corte fallido. +10 puntos";
    }

    await terminarRonda();
  } catch (error) {
    document.getElementById("mensaje").textContent = "❌ " + error.message;
  }
});

async function terminarRonda() {
  for (const p of roomData.players) {
    const puntosRonda = calcularPuntaje(p.cartas || []);
    p.totalPuntos = (p.totalPuntos || 0) + puntosRonda;
  }

  const ganador = roomData.players.find((p) => p.totalPuntos >= 150);
  if (ganador) {
    await updateDoc(doc(db, "rooms", roomId), {
      state: "finished",
      ganador: ganador.id,
    });

    // Las estadísticas las llevará el servidor. Antes se escribían desde el
    // navegador sobre los documentos de LOS DEMÁS jugadores, así que
    // cualquiera podía inflar o borrar las victorias ajenas.

    document.getElementById("mensaje").textContent =
      `🏆 ¡${ganador.username} ganó la partida!`;
    return;
  }

  let mazo = crearBaraja();
  barajar(mazo);

  for (const p of roomData.players) {
    p.cartas = Array.from({ length: 4 }, () => mazo.pop());
  }

  const muestra = mazo.pop();

  await updateDoc(doc(db, "rooms", roomId), {
    mazo: mazo,
    muestra: muestra,
    turnoActual: roomData.players[0].id,
    players: roomData.players,
  });

  document.getElementById("mensaje").textContent = "🔄 Nueva ronda iniciada";
}

document.getElementById("salirBtn").addEventListener("click", async () => {
  if (roomId && roomData) {
    const players = roomData.players.filter((p) => p.id !== user.id);
    if (players.length === 0) {
      await deleteDoc(doc(db, "rooms", roomId));
    } else {
      await updateDoc(doc(db, "rooms", roomId), {
        players: players,
      });
    }
  }
  localStorage.removeItem("roomCode");
  window.location.href = "lobby.html";
});
