/**
 * El tablero: por dónde se entra a jugar.
 *
 * Absorbe lo que hacía el lobby —crear sala, entrar por código, ver las salas
 * abiertas— para que haya UNA sola puerta de entrada. `lobby.html` sigue en el
 * repositorio pero ya no se enlaza desde ninguna parte.
 *
 * Las dos formas de jugar están separadas también acá:
 *
 *   Entrenamiento  es un enlace a mesa.html y nada más. No llama al servidor,
 *                  no mira el saldo y no puede cobrar nada.
 *   Por Leyendas   sólo PIDE. `crearSala` y `unirseASala` son Cloud Functions;
 *                  el navegador no escribe una línea en Firestore, y de hecho
 *                  las reglas se lo prohíben (`rooms` es de sólo lectura).
 *
 * Las comprobaciones de saldo y de código que hay acá son por cortesía: sirven
 * para avisar antes de pedir. El servidor las vuelve a hacer igual, y es el
 * que decide.
 */

import { db, collection, query, where, onSnapshot } from "./firebase.js";
import { exigirSesion, mostrarSaldo, conectarBotonSalir, formatearEspera } from "./sesion.js";
import { estadoMfa } from "./mfa.js";
import { SUPPORT_EMAIL } from "./firebase.js";
import { crearSala, unirseASala, ErrorDeServidor } from "./servidor.js";
import { ENTRADAS, ESTADOS_SALA, MAX_JUGADORES, esCodigoValido } from "./reglas/salas.js";
import { esperaRuleta } from "./reglas/economia.js";

const $ = (id) => document.getElementById(id);

conectarBotonSalir();

/** Saldo y nombre autoritativos: salen de Firestore, nunca de localStorage. */
let saldoActual = 0;
let nombreJugador = "Jugador";
let miUid = null;

// ------------------------------------------------------------- avisos

function avisar(texto, tipo = "info") {
  const caja = $("mensaje");
  caja.textContent = texto;
  caja.className = `aviso-salas visible ${tipo}`;
}

const limpiarAviso = () => {
  $("mensaje").textContent = "";
  $("mensaje").className = "aviso-salas";
};

/**
 * El motivo por el que la mesa te mandó de vuelta, si te mandó.
 *
 * `mesa.js` lo deja en sessionStorage antes de redirigir —"esa partida ya
 * terminó", "no estás en esa sala"— y lo muestra quien recibe al jugador. Eso
 * era el lobby; ahora es esta pantalla. Se lee ANTES de pedir la sesión para
 * que el aviso esté puesto aunque la carga del perfil tarde.
 */
const avisoPendiente = sessionStorage.getItem("avisoLobby");
if (avisoPendiente) {
  const caja = $("avisoServidor");
  caja.textContent = avisoPendiente;
  caja.className = "aviso-salas visible error";
  sessionStorage.removeItem("avisoLobby");
}

/**
 * Cuánto se calla después de un "ahora no".
 *
 * Una semana. El ofrecimiento vale la pena —quien tiene Leyendas guardadas se
 * juega dinero— pero un aviso que reaparece en cada carga deja de ser una
 * sugerencia y pasa a ser algo que uno aprende a saltear sin leer. Y entonces
 * tampoco lo lee el día que sí lo habría aceptado.
 */
const MS_ENTRE_OFRECIMIENTOS = 7 * 24 * 60 * 60 * 1000;

const LLAVE_OFERTA = "ofertaDosPasosPospuesta";

// ------------------------------------------------------ sesión y perfil

const sesion = await exigirSesion();
if (sesion) {
  const { usuario, perfil } = sesion;
  miUid = usuario.uid;
  saldoActual = perfil.saldo;
  nombreJugador = perfil.nombre;

  $("saludo").textContent = `Hola, ${perfil.nombre}`;
  $("subtitulo").textContent =
    perfil.partidas > 0
      ? `Llevás ${perfil.partidas} partida${perfil.partidas === 1 ? "" : "s"} y ${perfil.victorias} victoria${perfil.victorias === 1 ? "" : "s"}.`
      : "Todavía no jugaste ninguna partida. Empezá por el entrenamiento.";

  if (usuario.photoURL) $("avatar").src = usuario.photoURL;

  mostrarSaldo(perfil.saldo);
  ofrecerDosPasos();

  // El enlace al panel, sólo para la cuenta de soporte.
  //
  // Esto NO es una comprobación de seguridad y no hay que confundirlo con una:
  // quien edite el DOM lo destapa en dos segundos. Lo que decide quién entra
  // son las ocho Cloud Functions, que miran el correo del token verificado y
  // rechazan a todos los demás — está probado con una cuenta real. Esto sólo
  // ahorra tener que acordarse de la URL.
  if ((usuario.email ?? "").toLowerCase() === SUPPORT_EMAIL.toLowerCase()) {
    const enlace = $("enlaceAdmin");
    if (enlace) enlace.hidden = false;
  }
  $("statSaldo").textContent = perfil.saldo.toLocaleString("es-UY");
  $("statPartidas").textContent = perfil.partidas;
  $("statVictorias").textContent = perfil.victorias;

  // Estado de la ruleta: mismo cálculo que usa la propia página.
  const restante = esperaRuleta(perfil.ultimoGiro || null);
  $("statRuleta").textContent = formatearEspera(restante);

  const etiqueta = $("etiquetaRuleta");
  const pie = $("pieRuleta");
  if (restante > 0) {
    etiqueta.textContent = formatearEspera(restante);
    etiqueta.className = "etiqueta espera";
    pie.textContent = "Todavía no →";
  } else {
    etiqueta.textContent = "Giro listo";
    etiqueta.className = "etiqueta lista";
    pie.textContent = "Girar ahora →";
  }

  arrancarSalas();
}

// --------------------------------------------------------- el modo

/**
 * Qué se muestra según el modo elegido.
 *
 * Los dos paneles existen siempre en el HTML: sólo se esconde uno. Eso importa
 * porque `dashboard.js` llena el desplegable de entradas al arrancar, sin
 * esperar a que nadie elija nada — si el panel se construyera al cambiar de
 * modo, habría dos momentos distintos en que la página puede estar a medias.
 *
 * La sección de salas abiertas también sigue el modo: sólo tiene sentido
 * cuando se está mirando el juego por Leyendas.
 */
function mostrarModo(modo) {
  const enLeyendas = modo === "leyendas";
  $("panelEntrenamiento").hidden = enLeyendas;
  $("panelLeyendas").hidden = !enLeyendas;

  const salas = document.querySelector(".panel-salas");
  if (salas) salas.hidden = !enLeyendas;

  limpiarAviso();
}

for (const id of ["modoEntrenamiento", "modoLeyendas"]) {
  $(id).addEventListener("change", (evento) => {
    if (evento.target.checked) mostrarModo(evento.target.value);
  });
}

// El estado inicial sale del radio marcado en el HTML, no de un valor escrito
// acá: si mañana cambia cuál viene marcado, esto lo sigue sin tocarse.
mostrarModo(document.querySelector('input[name="modo"]:checked')?.value ?? "entrenamiento");

// ------------------------------------------------------------ entradas

// Las entradas salen de las reglas, no escritas a mano: si mañana se agrega
// una, aparece sola en el desplegable y el servidor la acepta.
$("entradaSala").innerHTML = ENTRADAS.map(
  (e) => `<option value="${e}"${e === 10 ? " selected" : ""}>${e} Leyendas</option>`,
).join("");

function actualizarAyudaEntrada() {
  const entrada = Number($("entradaSala").value);
  const pozo = entrada * MAX_JUGADORES;
  $("ayudaEntrada").textContent =
    `Con ${MAX_JUGADORES} jugadores el pozo llega a ${pozo}: ` +
    `${Math.round(pozo * 0.75)} para el primero y ${Math.round(pozo * 0.25)} para el segundo.`;
}

$("entradaSala").addEventListener("change", actualizarAyudaEntrada);
actualizarAyudaEntrada();

// --------------------------------------------------------- crear sala

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
    irALaSala(codigo);
  } catch (error) {
    avisar(error instanceof ErrorDeServidor ? error.message : "No pudimos crear la sala.", "error");
    boton.disabled = false;
    boton.textContent = "Crear sala";
  }
});

// ------------------------------------------------------ entrar por código

$("codigoSala").addEventListener("input", (evento) => {
  // Sólo el alfabeto de los códigos, y en mayúsculas. Se limpia mientras se
  // escribe para que nadie descubra al enviar que su "0" era una "O".
  evento.target.value = evento.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});

$("codigoSala").addEventListener("keydown", (evento) => {
  if (evento.key === "Enter") $("btnUnirse").click();
});

$("btnUnirse").addEventListener("click", () => entrarA($("codigoSala").value, $("btnUnirse")));

/**
 * Pide entrar a una sala. Es el único camino: lo usan el botón de código y los
 * de la tabla, para que no haya dos formas de hacer lo mismo.
 */
async function entrarA(codigoCrudo, boton) {
  const codigo = String(codigoCrudo ?? "").trim().toUpperCase();

  if (!esCodigoValido(codigo)) {
    avisar("El código tiene que ser de seis caracteres.", "error");
    $("codigoSala").focus();
    return;
  }

  const textoOriginal = boton?.textContent;
  if (boton) {
    boton.disabled = true;
    boton.textContent = "Entrando…";
  }
  limpiarAviso();

  try {
    await unirseASala(codigo);
    irALaSala(codigo);
  } catch (error) {
    avisar(
      error instanceof ErrorDeServidor ? error.message : "No pudimos entrar a la sala.",
      "error",
    );
    if (boton) {
      boton.disabled = false;
      boton.textContent = textoOriginal;
    }
  }
}

/**
 * Guarda el código y va a la sala.
 *
 * `roomCode` en localStorage es una comodidad para volver, NO una autoridad:
 * quien decide en qué sala está cada uno es el servidor. Editarlo a mano no
 * mete a nadie en ningún lado.
 */
function irALaSala(codigo) {
  localStorage.setItem("roomCode", codigo);
  window.location.href = `room.html?code=${encodeURIComponent(codigo)}`;
}

// -------------------------------------------------------- salas en vivo

const ETIQUETA_ESTADO = {
  [ESTADOS_SALA.ESPERANDO]: "Esperando",
  [ESTADOS_SALA.JUGANDO]: "En juego",
  [ESTADOS_SALA.TERMINADA]: "Terminada",
  [ESTADOS_SALA.CANCELADA]: "Cancelada",
};

/**
 * Una fila de la tabla, construida con DOM y no con innerHTML.
 *
 * No es manía: el nombre de la sala lo elige quien la crea —`Sala de X`, con
 * el X que cada uno se puso— y `textContent` no interpreta HTML. El lobby
 * viejo lo interpolaba directo, que es la misma vía por la que un nombre podía
 * ejecutar código en la mesa de los demás.
 */
function filaDeSala(sala) {
  const ocupados = (sala.jugadores ?? []).length;
  const estoyDentro = (sala.jugadores ?? []).includes(miUid);
  const llena = ocupados >= MAX_JUGADORES;

  const fila = document.createElement("tr");
  if (estoyDentro) fila.className = "sala-mia";

  const celda = (texto, clase) => {
    const td = document.createElement("td");
    td.textContent = texto;
    if (clase) td.className = clase;
    return td;
  };

  fila.append(
    celda(sala.codigo ?? "—", "celda-codigo"),
    celda(`${ocupados}/${MAX_JUGADORES}`),
    celda(`${sala.entrada ?? 0}`),
    celda(estoyDentro ? "Ya estás" : (ETIQUETA_ESTADO[sala.estado] ?? sala.estado ?? "—")),
  );

  const accion = document.createElement("td");
  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "accion chica";

  if (estoyDentro) {
    // Ya pagó la entrada: volver no vuelve a cobrar, y por eso no se pide
    // `unirseASala` otra vez.
    boton.textContent = "Volver";
    boton.addEventListener("click", () => irALaSala(sala.codigo));
  } else if (llena) {
    boton.textContent = "Llena";
    boton.disabled = true;
  } else {
    boton.textContent = "Unirse";
    boton.addEventListener("click", () => entrarA(sala.codigo, boton));
  }

  accion.appendChild(boton);
  fila.appendChild(accion);
  return fila;
}

function arrancarSalas() {
  const consulta = query(
    collection(db, "rooms"),
    where("estado", "==", ESTADOS_SALA.ESPERANDO),
  );

  onSnapshot(
    consulta,
    (snap) => {
      const cuerpo = $("filasSalas");
      const vacias = $("salasVacias");

      const salas = snap.docs
        .map((d) => d.data())
        // Las llenas se muestran igual —para saber que existen— pero las mías
        // van primero: si me cayó la conexión, lo que quiero es volver.
        .sort((a, b) => {
          const miaA = (a.jugadores ?? []).includes(miUid) ? 0 : 1;
          const miaB = (b.jugadores ?? []).includes(miUid) ? 0 : 1;
          return miaA - miaB || (a.entrada ?? 0) - (b.entrada ?? 0);
        });

      cuerpo.replaceChildren(...salas.map(filaDeSala));

      const hay = salas.length > 0;
      vacias.hidden = hay;
      if (!hay) vacias.textContent = "No hay salas esperando. Creá una y pasale el código a alguien.";
      $("filasSalas").closest(".tabla-salas-caja").hidden = !hay;
    },
    (error) => {
      console.error("No se pudieron leer las salas:", error);
      $("filasSalas").replaceChildren();
      $("filasSalas").closest(".tabla-salas-caja").hidden = true;
      const vacias = $("salasVacias");
      vacias.hidden = false;
      vacias.textContent = "No pudimos cargar las salas. Probá recargar la página.";
    },
  );
}


// ------------------------------------------ ofrecer los dos pasos

/**
 * Muestra el ofrecimiento, si corresponde.
 *
 * No corresponde en tres casos: si ya tiene los dos pasos puestos, si los
 * pospuso hace poco, o si no se pudo averiguar. Ese último es importante: ante
 * la duda NO se muestra. Ofrecerle activar los dos pasos a alguien que ya los
 * tiene no es un error inocente —lo manda a una pantalla donde va a leer que
 * ya está activo y va a pensar que algo se rompió—.
 *
 * El "ahora no" se recuerda en `localStorage`, que es por dispositivo y lo
 * puede borrar cualquiera. Está bien que así sea: acá no se decide nada, sólo
 * se evita repetir un cartel. Lo que NO puede vivir ahí es si la cuenta tiene
 * o no los dos pasos, y eso se le pregunta siempre a Firebase.
 */
async function ofrecerDosPasos() {
  const caja = $("ofertaDosPasos");
  if (!caja) return;

  const pospuesto = Number(localStorage.getItem(LLAVE_OFERTA) ?? 0);
  if (Date.now() - pospuesto < MS_ENTRE_OFRECIMIENTOS) return;

  try {
    const { activo } = await estadoMfa();
    if (activo) return;
  } catch {
    // Si no se pudo saber, no se ofrece. Ver la nota de arriba.
    return;
  }

  caja.hidden = false;
}

$("btnAhoraNo")?.addEventListener("click", () => {
  localStorage.setItem(LLAVE_OFERTA, String(Date.now()));
  $("ofertaDosPasos").hidden = true;
});
