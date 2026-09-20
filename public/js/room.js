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
import { esRutaDelSitio } from "./reglas/catalogo.js";
import { LIMITE_ELIMINACION } from "./reglas/puntaje.js";

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

function mostrarFinal(icono, titulo, texto, revancha = null) {
  if (dejarDeEscuchar) dejarDeEscuchar();
  $("cargando").hidden = true;
  $("sala").hidden = true;
  $("avisoFinal").hidden = false;
  $("iconoFinal").textContent = icono;
  $("tituloFinal").textContent = titulo;
  $("textoFinal").textContent = texto;

  // Si esta sala ya tiene revancha, se ofrece en vez de dejar al jugador
  // en una pantalla sin salida. Quien llega acá es alguien que volvió al
  // enlace viejo —de la mesa se sale por el panel del final—.
  const enlace = $("enlaceRevancha");
  if (!enlace) return;
  enlace.hidden = !revancha?.codigo;
  if (revancha?.codigo) enlace.href = `room.html?code=${encodeURIComponent(revancha.codigo)}`;
}

/**
 * La cara, el marco y el título de cada jugador en la sala de espera.
 *
 * ─────────────────────────────────────────────────────────────────────
 * EL DATO YA ESTABA; LO QUE FALTABA ERA DIBUJARLO
 * ─────────────────────────────────────────────────────────────────────
 *
 * `jugadoresLuce` viaja en el documento de la sala desde que se armaron los
 * dorsos y las insignias: lo escribe `identidadEnSala` cuando cada uno entra.
 * La sala lo ignoraba y pintaba una inicial en un círculo, así que quien
 * compraba un avatar lo veía recién al empezar la partida.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Y POR QUÉ IMPORTA MÁS QUE EN LA MESA
 * ─────────────────────────────────────────────────────────────────────
 *
 * Porque la sala de espera es donde se mira a los demás. En la mesa uno mira
 * las cartas; acá no hay nada que hacer salvo ver quién llegó. Es el momento
 * en que un marco o un título comprado se ven de verdad.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Y POR QUÉ ESTÁN ACÁ ARRIBA Y NO AL LADO DE `pintar`
 * ─────────────────────────────────────────────────────────────────────
 *
 * Porque el arranque de este archivo tiene un `await` de nivel superior, y
 * eso PARTE la evaluación del módulo en dos: todo lo que está escrito debajo
 * del `await` no existe todavía cuando `arrancar()` engancha el `onSnapshot`.
 * Si la primera foto de la sala llega en el acto —una respuesta de caché, o
 * un doble en una prueba— `pintar` corre antes de que `luceDe` esté
 * inicializado y tira un ReferenceError en vez de dibujar la sala.
 *
 * Con Firestore de verdad la foto tarda lo suficiente como para que no se
 * note nunca, que es justo lo que lo vuelve peligroso. Arriba del `await` no
 * hay forma de que pase.
 */

/** El formato viejo por si queda alguna sala abierta de antes. */
const luceDe = (sala, i) => {
  const nuevo = sala.jugadoresLuce?.[i];
  if (nuevo) return nuevo;
  const retrato = sala.jugadoresRetratos?.[i] ?? null;
  return { retrato, dorso: null, insignia: null, marco: null, titulo: null };
};

/**
 * La cara: la comprada, o la inicial de siempre.
 *
 * `esRutaDelSitio` otra vez, igual que en la mesa. Lo que hay en la sala lo
 * escribió el servidor, pero un `src` que apunte afuera del sitio le avisa a
 * ese dominio quién está mirando esta sala y desde dónde.
 *
 * La inicial llega YA escapada, y no como nombre crudo, a propósito:
 * `pruebas/escapado.mjs` recorre los archivos y exige ver el `escapar(` en la
 * misma interpolación que mete el dato en el HTML. Escondiéndolo adentro de
 * esta función el código quedaría igual de seguro y la auditoría dejaría de
 * poder comprobarlo, que es peor que el riesgo que tapa.
 */
function caraEnLaSala(luce, inicialEscapada) {
  if (!esRutaDelSitio(luce?.retrato)) {
    return `<span class="avatar-inicial" aria-hidden="true">${inicialEscapada}</span>`;
  }
  return `<span class="avatar-inicial con-cara" aria-hidden="true">
      <img src="${escapar(luce.retrato)}" alt="" loading="lazy" />
    </span>`;
}

/**
 * El marco, superpuesto y no como borde.
 *
 * Por lo mismo que en la mesa: un `border` cambiaría el tamaño del círculo y
 * las filas de la lista dejarían de alinearse según quién tenga marco.
 */
function marcoEnLaSala(luce) {
  if (!esRutaDelSitio(luce?.marco)) return "";
  return `<img class="marco-sala" src="${escapar(luce.marco)}" alt="" aria-hidden="true" />`;
}

/** El título, al lado del nombre. Es texto de un administrador: va escapado. */
function tituloEnLaSala(luce) {
  const titulo = String(luce?.titulo ?? "").trim();
  if (!titulo) return "";
  return `<span class="titulo-jugador">${escapar(titulo)}</span>`;
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
    mostrarFinal(
      "🏁",
      "Partida terminada",
      sala.revancha?.codigo
        ? `Esta sala ya jugó su partida, y hay revancha por ${sala.revancha.entrada} Leyendas.`
        : "Esta sala ya jugó su partida.",
      sala.revancha,
    );
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
  // Con cuántos puntos se queda afuera. Se ve ANTES de marcarse listo: una
  // partida de 60 y una de 150 no duran lo mismo ni se juegan igual. Las salas
  // abiertas antes de que se pudiera elegir no lo traen: son de 150.
  $("duracionSala").textContent = `${sala.limitePuntos ?? LIMITE_ELIMINACION} puntos`;
  $("contadorJugadores").textContent = `${jugadores.length} / ${capacidad}`;

  // Lista: los que están, más los lugares libres.
  //
  // Los nombres se escapan. Los elige cada jugador y los ve toda la sala, así
  // que sin esto uno llamado `<img src=x onerror="...">` corría lo que
  // quisiera en la pantalla de los demás, con la sesión de ellos abierta.
  const filas = jugadores.map((jugadorUid, i) => {
    const nombre = nombres[i] ?? "Jugador";
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

    const luce = luceDe(sala, i);
    const inicial = nombre.trim().charAt(0).toUpperCase() || "?";

    return `
      <li class="jugador-fila ${jugadorUid === uid ? "es-mio" : ""}">
        <span class="ficha-jugador">
          ${caraEnLaSala(luce, escapar(inicial))}
          ${marcoEnLaSala(luce)}
        </span>
        <span class="nombre-jugador">${escapar(nombre)}</span>
        ${tituloEnLaSala(luce)}
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
