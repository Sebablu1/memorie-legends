/**
 * Sala de espera.
 *
 * Escucha el documento de la sala en vivo y refleja su estado. No escribe
 * nada: crear, entrar, empezar y salir son todas Cloud Functions. Las reglas
 * de Firestore dejan `rooms` de sólo lectura para el navegador, así que ni
 * siquiera podría.
 */

import { db, doc, onSnapshot } from "./firebase.js";
import { exigirSesion, mostrarSaldo } from "./sesion.js";
import { iniciarPartida, salirDeSalaEnEspera, ErrorDeServidor } from "./servidor.js";
import { ESTADOS_SALA, MIN_JUGADORES, MAX_JUGADORES } from "./reglas/salas.js";

const $ = (id) => document.getElementById(id);

const codigo = (new URLSearchParams(location.search).get("code") ?? "")
  .trim()
  .toUpperCase();

/** Deja de escuchar la sala; se llama al salir o al irse a la mesa. */
let dejarDeEscuchar = null;
let yaRedirigido = false;

function mostrarFinal(icono, titulo, texto) {
  if (dejarDeEscuchar) dejarDeEscuchar();
  $("cargando").hidden = true;
  $("sala").hidden = true;
  $("avisoFinal").hidden = false;
  $("iconoFinal").textContent = icono;
  $("tituloFinal").textContent = titulo;
  $("textoFinal").textContent = texto;
}

// ------------------------------------------------------------ arranque

if (!codigo) {
  mostrarFinal("🤔", "Falta el código", "El enlace no trae ninguna sala.");
} else {
  const sesion = await exigirSesion();
  if (sesion) arrancar(sesion);
}

function arrancar({ usuario, perfil }) {
  mostrarSaldo(perfil.saldo);

  // Si la mesa nos devolvió acá, se explica por qué.
  const aviso = sessionStorage.getItem("avisoSala");
  if (aviso) {
    $("estadoSala").textContent = aviso;
    sessionStorage.removeItem("avisoSala");
  }

  dejarDeEscuchar = onSnapshot(
    doc(db, "rooms", codigo),
    (snap) => {
      if (!snap.exists()) {
        mostrarFinal("🔍", "Sala no encontrada", `No existe ninguna sala con el código ${codigo}.`);
        return;
      }
      pintar(snap.data(), usuario.uid);
    },
    (error) => {
      console.error("No se pudo escuchar la sala:", error);
      mostrarFinal("⚠️", "No pudimos leer la sala", "Probá de nuevo en un momento.");
    },
  );
}

// -------------------------------------------------------------- pintar

function pintar(sala, miUid) {
  // La partida arrancó: a la mesa.
  if (sala.estado === ESTADOS_SALA.JUGANDO) {
    if (yaRedirigido) return;
    yaRedirigido = true;
    if (dejarDeEscuchar) dejarDeEscuchar();
    localStorage.setItem("roomCode", codigo);
    $("estadoSala").textContent = "¡Arranca la partida!";
    setTimeout(() => (window.location.href = `mesa.html?sala=${codigo}`), 700);
    return;
  }

  if (sala.estado === ESTADOS_SALA.CANCELADA) {
    mostrarFinal(
      "🚫",
      "Sala cancelada",
      sala.motivoCancelacion
        ? `Se canceló porque ${sala.motivoCancelacion}. Si habías pagado la entrada, ya te la devolvimos.`
        : "Esta sala fue cancelada. Si habías pagado la entrada, ya te la devolvimos.",
    );
    return;
  }

  if (sala.estado === ESTADOS_SALA.TERMINADA) {
    mostrarFinal("🏁", "Partida terminada", "Esta sala ya jugó su partida.");
    return;
  }

  // --- estado: esperando ---
  $("cargando").hidden = true;
  $("sala").hidden = false;

  const jugadores = sala.jugadores ?? [];
  const nombres = sala.jugadoresNombres ?? [];
  const capacidad = Math.min(sala.maxJugadores ?? MAX_JUGADORES, MAX_JUGADORES);
  const soyCreador = sala.creador === miUid;

  $("tituloSala").textContent = sala.nombre ?? "Sala";
  $("codigoSala").textContent = sala.codigo ?? codigo;
  $("entradaSala").textContent = `${sala.entrada} Leyendas`;
  $("pozoSala").textContent = `${sala.entrada * jugadores.length} Leyendas`;
  $("contadorJugadores").textContent = `${jugadores.length} / ${capacidad}`;

  // Lista: los que están, más los lugares libres.
  const filas = jugadores.map((uid, i) => {
    const nombre = nombres[i] ?? "Jugador";
    const inicial = nombre.trim().charAt(0).toUpperCase() || "?";
    const etiquetas = [
      uid === sala.creador ? '<span class="insignia">Creador</span>' : "",
      uid === miUid ? '<span class="insignia propio">Vos</span>' : "",
    ].join("");
    return `
      <li class="jugador-fila ${uid === miUid ? "es-mio" : ""}">
        <span class="avatar-inicial" aria-hidden="true">${inicial}</span>
        <span class="nombre-jugador">${nombre}</span>
        ${etiquetas}
      </li>`;
  });

  for (let i = jugadores.length; i < capacidad; i++) {
    filas.push(`
      <li class="jugador-fila vacia">
        <span class="avatar-inicial" aria-hidden="true">·</span>
        <span class="nombre-jugador">Esperando…</span>
      </li>`);
  }
  $("listaJugadores").innerHTML = filas.join("");

  // Estado y botón de arranque.
  const faltan = MIN_JUGADORES - jugadores.length;
  if (faltan > 0) {
    $("estadoSala").textContent =
      `Falta ${faltan} jugador${faltan === 1 ? "" : "es"} para poder empezar.`;
  } else if (jugadores.length < capacidad) {
    $("estadoSala").textContent = "Ya se puede empezar, o esperar a que entre alguien más.";
  } else {
    $("estadoSala").textContent = "Sala completa.";
  }

  const btnIniciar = $("btnIniciar");
  btnIniciar.hidden = !soyCreador;
  btnIniciar.disabled = jugadores.length < MIN_JUGADORES;

  $("notaSala").textContent = soyCreador
    ? "Si salís de la sala, se cancela para todos y se devuelven las entradas."
    : "Quien creó la sala es quien la empieza.";
}

// ------------------------------------------------------------ acciones

$("btnCopiar").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(codigo);
    $("btnCopiar").textContent = "¡Copiado!";
  } catch {
    // Sin permiso de portapapeles: al menos se deja seleccionado.
    getSelection()?.selectAllChildren($("codigoSala"));
    $("btnCopiar").textContent = "Copialo a mano";
  }
  setTimeout(() => ($("btnCopiar").textContent = "Copiar código"), 1800);
});

$("btnIniciar").addEventListener("click", async () => {
  const boton = $("btnIniciar");
  boton.disabled = true;
  boton.textContent = "Empezando…";
  try {
    await iniciarPartida(codigo);
    // El onSnapshot detecta el cambio de estado y redirige solo.
  } catch (error) {
    boton.disabled = false;
    boton.textContent = "Comenzar partida";
    $("estadoSala").textContent =
      error instanceof ErrorDeServidor ? error.message : "No pudimos empezar la partida.";
  }
});

// --- salir, con confirmación ---

$("btnSalir").addEventListener("click", () => {
  const soyCreador = $("notaSala").textContent.startsWith("Si salís");
  $("textoModal").textContent = soyCreador
    ? "Sos quien creó la sala: al salir se cancela para todos y se devuelven todas las entradas."
    : "Como la partida todavía no empezó, se te devuelve la entrada completa. No hay penalización.";
  $("velo").hidden = false;
  $("btnConfirmarSalida").focus();
});

$("btnCancelarSalida").addEventListener("click", () => {
  $("velo").hidden = true;
});

$("velo").addEventListener("click", (evento) => {
  if (evento.target === $("velo")) $("velo").hidden = true;
});

document.addEventListener("keydown", (evento) => {
  if (evento.key === "Escape" && !$("velo").hidden) $("velo").hidden = true;
});

$("btnConfirmarSalida").addEventListener("click", async () => {
  const boton = $("btnConfirmarSalida");
  boton.disabled = true;
  boton.textContent = "Saliendo…";
  try {
    await salirDeSalaEnEspera(codigo);
    if (dejarDeEscuchar) dejarDeEscuchar();
    localStorage.removeItem("roomCode");
    window.location.href = "lobby.html";
  } catch (error) {
    boton.disabled = false;
    boton.textContent = "Salir de la sala";
    $("textoModal").textContent =
      error instanceof ErrorDeServidor ? error.message : "No pudimos procesar la salida.";
  }
});

// Al cerrar la pestaña se corta el listener; sin esto quedaría abierto.
window.addEventListener("pagehide", () => {
  if (dejarDeEscuchar) dejarDeEscuchar();
});
