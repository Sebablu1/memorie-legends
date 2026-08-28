/**
 * Lobby unificado: las dos formas de jugar en una sola pantalla.
 *
 *   🎯 Entrenamiento vs IA  — gratis, no toca Leyendas jamás.
 *   🏆 Partida por Leyendas — crear o unirse a una sala, cobrando entrada.
 *
 * Las dos ramas están separadas también en el código: el entrenamiento no
 * llama a ninguna función del servidor ni mira el saldo, y la rama de
 * Leyendas no escribe nada en Firestore: sólo pide, y el servidor decide.
 */

import { db, auth, signOut, doc, collection, query, where, onSnapshot } from "./firebase.js";
import { exigirSesion, mostrarSaldo } from "./sesion.js";
import { crearSala, unirseASala, ErrorDeServidor } from "./servidor.js";
import { ENTRADAS, ESTADOS_SALA, MAX_JUGADORES, esCodigoValido } from "./reglas/salas.js";
import { DIFICULTADES } from "./reglas/ia.js";

const $ = (id) => document.getElementById(id);

/** Saldo autoritativo. Sale de Firestore, nunca de localStorage. */
let saldoActual = 0;
let nombreJugador = "Jugador";

function avisar(texto, tipo = "info") {
  const caja = $("mensaje");
  caja.textContent = texto;
  caja.className = `mensaje-global visible ${tipo}`;
}

const limpiarAviso = () => ($("mensaje").className = "mensaje-global");

// =====================================================================
// 🎯 ENTRENAMIENTO — no toca Leyendas en ningún punto
// =====================================================================

const NOMBRES_IA = ["Nara", "Bruno", "Vex"];
let cantidadIAs = 2;

// Las dificultades salen del módulo de IA, para no repetir las etiquetas.
$("nivelIA").innerHTML = Object.entries(DIFICULTADES)
  .map(
    ([clave, d]) =>
      `<option value="${clave}"${clave === "medio" ? " selected" : ""}>${d.etiqueta}</option>`,
  )
  .join("");

$("cantidadIAs").addEventListener("click", (evento) => {
  const boton = evento.target.closest(".opcion");
  if (!boton) return;
  cantidadIAs = Number(boton.dataset.ias);
  $("cantidadIAs")
    .querySelectorAll(".opcion")
    .forEach((b) => {
      const activa = b === boton;
      b.classList.toggle("activa", activa);
      b.setAttribute("aria-checked", String(activa));
    });
});

$("btnEntrenar").addEventListener("click", () => {
  const dificultad = $("nivelIA").value;

  // `modo: entrenamiento` es lo que garantiza que ninguna parte del sistema
  // la trate como partida con entrada. Aun sin ese campo, usaLeyendas()
  // devolvería false: hace falta modo explícito Y entrada válida.
  localStorage.setItem(
    "configMesa",
    JSON.stringify({
      modo: "entrenamiento",
      humanos: [{ nombre: nombreJugador }],
      ias: NOMBRES_IA.slice(0, cantidadIAs).map((nombre) => ({ nombre, dificultad })),
    }),
  );
  localStorage.removeItem("roomCode");
  window.location.href = "mesa.html";
});

// =====================================================================
// 🏆 PARTIDA POR LEYENDAS
// =====================================================================

// El desplegable se arma desde la lista compartida: agregar una entrada en
// salas.js la hace aparecer acá sin tocar el HTML.
$("entradaSala").innerHTML = ENTRADAS.map(
  (e) => `<option value="${e}">${e} Leyendas</option>`,
).join("");

function actualizarAyudaEntrada() {
  const entrada = Number($("entradaSala").value);
  const pozo = entrada * MAX_JUGADORES;
  const primero = Math.floor(pozo * 0.75);
  $("ayudaEntrada").textContent =
    `Con la sala llena el pozo llega a ${pozo} Leyendas: ${primero} para el primero ` +
    `y ${pozo - primero} para el segundo.`;
}

$("entradaSala").addEventListener("change", actualizarAyudaEntrada);
actualizarAyudaEntrada();

$("btnCrearSala").addEventListener("click", async () => {
  const entrada = Number($("entradaSala").value);
  const boton = $("btnCrearSala");

  // Aviso temprano por cortesía. El servidor lo vuelve a comprobar igual.
  if (saldoActual < entrada) {
    avisar(`Te faltan Leyendas: la entrada es de ${entrada} y tenés ${saldoActual}.`, "error");
    return;
  }

  boton.disabled = true;
  boton.textContent = "Creando…";
  limpiarAviso();

  try {
    const { codigo } = await crearSala(entrada, `Sala de ${nombreJugador}`);
    localStorage.setItem("roomCode", codigo);
    window.location.href = `room.html?code=${codigo}`;
  } catch (error) {
    avisar(error instanceof ErrorDeServidor ? error.message : "No pudimos crear la sala.", "error");
    boton.disabled = false;
    boton.textContent = "Crear sala";
  }
});

$("codigoSala").addEventListener("input", (evento) => {
  evento.target.value = evento.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});

$("codigoSala").addEventListener("keydown", (evento) => {
  if (evento.key === "Enter") $("btnUnirse").click();
});

$("btnUnirse").addEventListener("click", async () => {
  const codigo = $("codigoSala").value.trim().toUpperCase();
  const boton = $("btnUnirse");

  if (!esCodigoValido(codigo)) {
    avisar("El código tiene que ser de seis caracteres.", "error");
    $("codigoSala").focus();
    return;
  }

  boton.disabled = true;
  boton.textContent = "Entrando…";
  limpiarAviso();

  try {
    await unirseASala(codigo);
    localStorage.setItem("roomCode", codigo);
    window.location.href = `room.html?code=${codigo}`;
  } catch (error) {
    avisar(
      error instanceof ErrorDeServidor ? error.message : "No pudimos entrar a la sala.",
      "error",
    );
    boton.disabled = false;
    boton.textContent = "Unirse a la sala";
  }
});

// =====================================================================
// Salas abiertas, en vivo
// =====================================================================

let dejarDeEscucharSalas = null;

function escucharSalas() {
  const consulta = query(collection(db, "rooms"), where("estado", "==", ESTADOS_SALA.ESPERANDO));

  dejarDeEscucharSalas = onSnapshot(
    consulta,
    (snap) => {
      const salas = snap.docs
        .map((d) => d.data())
        .filter((s) => (s.jugadores ?? []).length < MAX_JUGADORES);

      if (!salas.length) {
        $("listaSalas").innerHTML =
          '<p class="vacio-simple">No hay salas esperando. Creá una y pasale el código a alguien.</p>';
        return;
      }

      $("listaSalas").innerHTML = salas
        .sort((a, b) => a.entrada - b.entrada)
        .map((s) => {
          const ocupados = (s.jugadores ?? []).length;
          return `
            <div class="sala-fila">
              <div>
                <b>${s.nombre ?? "Sala"}</b>
                <span class="sala-meta">${s.entrada} Leyendas · ${ocupados}/${MAX_JUGADORES} jugadores</span>
              </div>
              <button class="btn-plata" data-codigo="${s.codigo}" type="button">Entrar</button>
            </div>`;
        })
        .join("");
    },
    (error) => {
      console.error("No se pudieron leer las salas:", error);
      $("listaSalas").innerHTML = '<p class="vacio-simple">No pudimos cargar las salas.</p>';
    },
  );
}

$("listaSalas").addEventListener("click", (evento) => {
  const boton = evento.target.closest("[data-codigo]");
  if (!boton) return;
  $("codigoSala").value = boton.dataset.codigo;
  $("btnUnirse").click();
});

// Los listeners se cortan al irse: si no, quedan abiertos consumiendo lecturas.
let dejarDeEscucharSaldo = null;
window.addEventListener("pagehide", () => {
  if (dejarDeEscucharSalas) dejarDeEscucharSalas();
  if (dejarDeEscucharSaldo) dejarDeEscucharSaldo();
});

// =====================================================================
// Arranque
// =====================================================================

$("btnSalir").addEventListener("click", async () => {
  await signOut(auth);
  localStorage.removeItem("user");
  localStorage.removeItem("roomCode");
  window.location.href = "login.html";
});

// Si la mesa o la sala nos devolvieron acá, se explica por qué.
const avisoPendiente = sessionStorage.getItem("avisoLobby");
if (avisoPendiente) {
  avisar(avisoPendiente, "error");
  sessionStorage.removeItem("avisoLobby");
}

const sesion = await exigirSesion();
if (sesion) {
  nombreJugador = sesion.perfil.nombre;
  saldoActual = sesion.perfil.saldo;

  $("saludo").textContent = `Hola, ${nombreJugador}`;
  mostrarSaldo(saldoActual);

  // El saldo se sigue en vivo: si el servidor lo mueve, se ve al instante.
  dejarDeEscucharSaldo = onSnapshot(doc(db, "users", sesion.usuario.uid), (snap) => {
    saldoActual = snap.exists() ? (snap.data().credits ?? 0) : 0;
    mostrarSaldo(saldoActual);
  });

  escucharSalas();
}
