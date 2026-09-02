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
import { iniciarPartida, salirDeSalaEnEspera, marcarListo, reportarJugador, ErrorDeServidor } from "./servidor.js";
import { ESTADOS_SALA, MIN_JUGADORES, MAX_JUGADORES } from "./reglas/salas.js";
import { escapar } from "./modulos/texto.js";

const $ = (id) => document.getElementById(id);

const codigo = (new URLSearchParams(location.search).get("code") ?? "")
  .trim()
  .toUpperCase();

/** Deja de escuchar la sala; se llama al salir o al irse a la mesa. */
let dejarDeEscuchar = null;
let yaRedirigido = false;
/** Última foto de la sala, para que los botones no dependan del texto. */
let salaActual = null;
let miUid = null;

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

function pintar(sala, uid) {
  salaActual = sala;
  miUid = uid;
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
  const listos = new Set(sala.listos ?? []);
  const capacidad = Math.min(sala.maxJugadores ?? MAX_JUGADORES, MAX_JUGADORES);
  const soyCreador = sala.creador === uid;
  const todosListos = jugadores.length > 0 && jugadores.every((j) => listos.has(j));

  $("tituloSala").textContent = sala.nombre ?? "Sala";
  $("codigoSala").textContent = sala.codigo ?? codigo;
  $("entradaSala").textContent = `${sala.entrada} Leyendas`;
  $("pozoSala").textContent = `${sala.entrada * jugadores.length} Leyendas`;
  $("contadorJugadores").textContent = `${jugadores.length} / ${capacidad}`;

  // Lista: los que están, más los lugares libres.
  //
  // Los nombres se escapan. Los elige cada jugador y los ve toda la sala, así
  // que sin esto uno llamado `<img src=x onerror="...">` corría lo que
  // quisiera en la pantalla de los demás, con la sesión de ellos abierta.
  const filas = jugadores.map((jugadorUid, i) => {
    const nombre = nombres[i] ?? "Jugador";
    const inicial = nombre.trim().charAt(0).toUpperCase() || "?";
    const estaListo = listos.has(jugadorUid);
    const etiquetas = [
      jugadorUid === sala.creador ? '<span class="insignia">Creador</span>' : "",
      jugadorUid === uid ? '<span class="insignia propio">Vos</span>' : "",
    ].join("");
    // El botón de reportar, sólo en las filas ajenas. Va acá y no en la mesa
    // a propósito: durante una partida hay ventanas de reflejos de tres
    // segundos, y un diálogo encima de eso le hace perder la jugada a quien
    // lo abre. Acá nadie está apurado.
    const reportar =
      jugadorUid === uid
        ? ""
        : `<button class="reportar" type="button"
             data-reportar="${escapar(jugadorUid)}"
             data-nombre="${escapar(nombre)}"
             title="Reportar a ${escapar(nombre)}"
             aria-label="Reportar a ${escapar(nombre)}">⚑</button>`;

    return `
      <li class="jugador-fila ${jugadorUid === uid ? "es-mio" : ""}">
        <span class="avatar-inicial" aria-hidden="true">${escapar(inicial)}</span>
        <span class="nombre-jugador">${escapar(nombre)}</span>
        ${etiquetas}
        <span class="marca-listo ${estaListo ? "si" : "no"}">
          ${estaListo ? "✅ Listo" : "esperando"}
        </span>
        ${reportar}
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

  // --- estado ---
  const faltanJugadores = MIN_JUGADORES - jugadores.length;
  const cuentaListos = `${listos.size}/${jugadores.length} listos`;

  if (faltanJugadores > 0) {
    $("estadoSala").textContent =
      `Falta ${faltanJugadores} jugador${faltanJugadores === 1 ? "" : "es"} para poder empezar.`;
  } else if (!todosListos) {
    $("estadoSala").textContent = `Esperando que todos se marquen listos · ${cuentaListos}`;
  } else if (jugadores.length < capacidad) {
    $("estadoSala").textContent = `Todos listos (${cuentaListos}). Se puede empezar, o esperar a alguien más.`;
  } else {
    $("estadoSala").textContent = `Sala completa y todos listos (${cuentaListos}).`;
  }

  // --- botón de listo ---
  const estoyListo = listos.has(uid);
  const btnListo = $("btnListo");
  btnListo.textContent = estoyListo ? "Estoy listo ✅ (tocá para deshacer)" : "✅ Estoy listo";
  btnListo.classList.toggle("btn-plata", estoyListo);
  btnListo.classList.toggle("btn-oro", !estoyListo);
  btnListo.setAttribute("aria-pressed", String(estoyListo));
  btnListo.disabled = false;

  // --- botón de arranque ---
  const btnIniciar = $("btnIniciar");
  btnIniciar.hidden = !soyCreador;
  btnIniciar.disabled = jugadores.length < MIN_JUGADORES || !todosListos;
  btnIniciar.textContent = todosListos
    ? "Comenzar partida"
    : `Comenzar partida (${cuentaListos})`;

  $("notaSala").textContent = soyCreador
    ? "La partida arranca cuando todos, vos incluido, estén listos. Si salís, la sala se cancela y se devuelven las entradas."
    : "Marcá que estás listo. Quien creó la sala es quien la empieza.";
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

$("btnListo").addEventListener("click", async () => {
  const boton = $("btnListo");
  const estoyListo = (salaActual?.listos ?? []).includes(miUid);
  boton.disabled = true;
  try {
    await marcarListo(codigo, !estoyListo);
    // El onSnapshot repinta solo con el estado nuevo.
  } catch (error) {
    boton.disabled = false;
    $("estadoSala").textContent =
      error instanceof ErrorDeServidor ? error.message : "No pudimos cambiar tu estado.";
  }
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
  const soyCreador = salaActual?.creador === miUid;
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
  if (evento.key !== "Escape") return;
  if (!$("velo").hidden) $("velo").hidden = true;
  if (!$("veloReporte").hidden) cerrarReporte();
});

$("btnConfirmarSalida").addEventListener("click", async () => {
  const boton = $("btnConfirmarSalida");
  boton.disabled = true;
  boton.textContent = "Saliendo…";
  try {
    await salirDeSalaEnEspera(codigo);
    if (dejarDeEscuchar) dejarDeEscuchar();
    localStorage.removeItem("roomCode");
    window.location.href = "dashboard.html";
  } catch (error) {
    boton.disabled = false;
    boton.textContent = "Salir de la sala";
    $("textoModal").textContent =
      error instanceof ErrorDeServidor ? error.message : "No pudimos procesar la salida.";
  }
});

// --- reportar a alguien ---

/**
 * A quién se está por reportar. Se guarda al abrir el diálogo y no se lee del
 * DOM al enviar: la lista se repinta sola cada vez que llega la sala, así que
 * el botón que se tocó puede haber dejado de existir para cuando se confirma.
 */
let aQuienReporto = null;

const cerrarReporte = () => {
  $("veloReporte").hidden = true;
  aQuienReporto = null;
};

// Delegado en la lista, no en cada botón: las filas se vuelven a dibujar en
// cada actualización de la sala, y los oyentes puestos uno por uno se
// perderían con ellas.
$("listaJugadores").addEventListener("click", (evento) => {
  const boton = evento.target.closest("[data-reportar]");
  if (!boton) return;

  aQuienReporto = { uid: boton.dataset.reportar, nombre: boton.dataset.nombre };
  // textContent: el nombre lo elige quien juega.
  $("textoReporte").textContent = `Vas a reportar a ${aQuienReporto.nombre}.`;
  $("avisoReporte").textContent = "";
  $("comentarioReporte").value = "";
  $("btnEnviarReporte").disabled = false;
  $("btnEnviarReporte").textContent = "Enviar reporte";
  $("veloReporte").hidden = false;
  $("motivoReporte").focus();
});

$("btnCancelarReporte").addEventListener("click", cerrarReporte);

$("veloReporte").addEventListener("click", (evento) => {
  if (evento.target === $("veloReporte")) cerrarReporte();
});

$("btnEnviarReporte").addEventListener("click", async () => {
  if (!aQuienReporto) return;
  const boton = $("btnEnviarReporte");
  boton.disabled = true;
  boton.textContent = "Enviando…";

  try {
    await reportarJugador({
      denunciado: aQuienReporto.uid,
      motivo: $("motivoReporte").value,
      comentario: $("comentarioReporte").value,
      codigo,
    });
    $("avisoReporte").textContent = "Gracias. Lo vamos a revisar.";
    boton.textContent = "Enviado";
    setTimeout(cerrarReporte, 1600);
  } catch (error) {
    boton.disabled = false;
    boton.textContent = "Enviar reporte";
    // El servidor tiene mensajes escritos para esto —"ya reportaste a esta
    // persona hace poco"— y son mejores que cualquier cosa genérica.
    $("avisoReporte").textContent =
      error instanceof ErrorDeServidor ? error.message : "No pudimos enviar el reporte.";
  }
});

// Al cerrar la pestaña se corta el listener; sin esto quedaría abierto.
window.addEventListener("pagehide", () => {
  if (dejarDeEscuchar) dejarDeEscuchar();
});
