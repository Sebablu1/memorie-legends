/**
 * Panel de administración.
 *
 * Acá NO se decide nada. Este archivo muestra lo que el servidor manda y pide
 * lo que el administrador toca; quién puede hacer qué se comprueba en las
 * Cloud Functions, contra el correo verificado del token.
 *
 * Que el correo se mire también acá es sólo para no dibujar una pantalla que
 * no va a funcionar. Cambiarlo en el navegador no habilita nada: las tres
 * funciones lo vuelven a comprobar y rechazan.
 *
 * Y no lee `partidas`: ese documento tiene las manos de los cuatro y el orden
 * del mazo, y las reglas lo niegan a todo el mundo. Lo que llega es un resumen
 * que arma el servidor y no lleva ni una carta.
 */

import {
  auth,
  funciones,
  httpsCallable,
  SUPPORT_EMAIL,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from "../js/firebase.js";

const $ = (id) => document.getElementById(id);

const dom = {
  quien: $("quien"),
  btnSalir: $("btnSalir"),
  entrar: $("entrar"),
  formEntrar: $("formEntrar"),
  correo: $("correo"),
  clave: $("clave"),
  avisoEntrar: $("avisoEntrar"),
  panel: $("panel"),
  totalSalas: $("totalSalas"),
  totalPartidas: $("totalPartidas"),
  totalRetenido: $("totalRetenido"),
  btnRefrescar: $("btnRefrescar"),
  btnCancelarTodas: $("btnCancelarTodas"),
  aviso: $("aviso"),
  salas: $("salas"),
  partidas: $("partidas"),
};

const listar = httpsCallable(funciones, "listarSalasAdmin");
const cancelar = httpsCallable(funciones, "cancelarSalaAdmin");
const cancelarTodas = httpsCallable(funciones, "cancelarSalasEnEsperaAdmin");

const decir = (donde, texto, clase = "") => {
  donde.textContent = texto;
  donde.className = `aviso ${clase}`;
};

/** Escapa lo que venga de la base: los nombres los eligen los jugadores. */
const limpio = (t) =>
  String(t ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const fecha = (ms) =>
  ms ? new Date(ms).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "—";

// ------------------------------------------------------------- sesión

dom.formEntrar.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  decir(dom.avisoEntrar, "Entrando…");
  try {
    await signInWithEmailAndPassword(auth, dom.correo.value.trim(), dom.clave.value);
    dom.clave.value = "";
  } catch (error) {
    // Sin detallar si falló el correo o la contraseña.
    decir(dom.avisoEntrar, "No pudimos entrar con esos datos.", "mal");
    console.error(error);
  }
});

dom.btnSalir.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (usuario) => {
  const correo = (usuario?.email ?? "").toLowerCase();
  const esAdmin = correo === SUPPORT_EMAIL.toLowerCase();

  dom.quien.textContent = usuario ? usuario.email : "Sin sesión";
  dom.btnSalir.hidden = !usuario;
  dom.entrar.hidden = Boolean(esAdmin);
  dom.panel.hidden = !esAdmin;

  if (usuario && !esAdmin) {
    decir(dom.avisoEntrar, "Esta sección no es para esta cuenta.", "mal");
    return;
  }
  if (esAdmin) refrescar();
});

// ------------------------------------------------------------- pintar

function filaDeSala(s) {
  const div = document.createElement("div");
  div.className = "fila";
  div.innerHTML = `
    <span class="codigo">${limpio(s.codigo)}</span>
    <span class="etiqueta ${limpio(s.estado)}">${limpio(s.estado)}</span>
    <span class="campo"><b>${s.cuantos}</b>/${s.maxJugadores} · ${
      s.jugadores.length ? s.jugadores.map(limpio).join(", ") : "sin nadie"
    }</span>
    <span class="campo">entrada <b>${s.entrada}</b></span>
    <span class="campo">retiene <b>${s.leyendasRetenidas}</b></span>
    <span class="campo">${limpio(fecha(s.creada))}</span>`;

  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "btn peligro chico";
  if (s.cancelable) {
    boton.textContent = "Cancelar y devolver";
    boton.addEventListener("click", () => cancelarUna(s, boton));
  } else {
    boton.textContent = "En juego";
    boton.disabled = true;
    boton.title = "Sus Leyendas están en juego. Para salir, cada jugador abandona.";
  }
  div.appendChild(boton);
  return div;
}

function filaDePartida(p) {
  const div = document.createElement("div");
  div.className = "fila";
  div.innerHTML = `
    <span class="codigo">${limpio(p.codigo)}</span>
    <span class="campo">fase <b>${limpio(p.fase)}</b></span>
    <span class="campo">ronda <b>${p.ronda ?? "—"}</b></span>
    <span class="campo"><b>${p.jugadores}</b> jugando${
      p.abandonaron ? ` · ${p.abandonaron} abandonaron` : ""
    }</span>
    <span class="campo">${limpio(fecha(p.actualizada))}</span>`;
  return div;
}

function pintar(datos) {
  dom.totalSalas.textContent = datos.totales.salas;
  dom.totalPartidas.textContent = datos.totales.partidas;
  dom.totalRetenido.textContent = datos.totales.leyendasRetenidas;

  dom.salas.replaceChildren();
  if (!datos.salas.length) {
    dom.salas.innerHTML = '<p class="vacio">No hay salas vivas.</p>';
  } else {
    datos.salas.forEach((s) => dom.salas.appendChild(filaDeSala(s)));
  }

  dom.partidas.replaceChildren();
  if (!datos.partidas.length) {
    dom.partidas.innerHTML = '<p class="vacio">Ninguna partida en curso.</p>';
  } else {
    datos.partidas.forEach((p) => dom.partidas.appendChild(filaDePartida(p)));
  }

  const enEspera = datos.salas.filter((s) => s.cancelable).length;
  dom.btnCancelarTodas.disabled = enEspera === 0;
  dom.btnCancelarTodas.textContent = enEspera
    ? `Cancelar las ${enEspera} que esperan`
    : "Ninguna esperando";
}

// ------------------------------------------------------------ acciones

async function refrescar() {
  dom.btnRefrescar.disabled = true;
  decir(dom.aviso, "Cargando…");
  try {
    const { data } = await listar();
    pintar(data);
    decir(dom.aviso, "");
  } catch (error) {
    decir(dom.aviso, error?.message ?? "No pudimos cargar las salas.", "mal");
    console.error(error);
  } finally {
    dom.btnRefrescar.disabled = false;
  }
}

async function cancelarUna(sala, boton) {
  const cuantos = sala.cuantos;
  const aviso = cuantos
    ? `Cancelar ${sala.codigo} y devolver ${sala.leyendasRetenidas} Leyendas a ${cuantos} jugador(es)?`
    : `Cancelar ${sala.codigo}? No hay nadie adentro.`;
  if (!confirm(aviso)) return;

  boton.disabled = true;
  decir(dom.aviso, `Cancelando ${sala.codigo}…`);
  try {
    const { data } = await cancelar({ codigo: sala.codigo });
    decir(
      dom.aviso,
      data.yaEstaba
        ? `${data.codigo} ya estaba cancelada.`
        : `${data.codigo} cancelada. Devueltas ${data.devueltas} Leyendas a ${data.jugadores.length} jugador(es).`,
      "bien",
    );
    await refrescar();
  } catch (error) {
    decir(dom.aviso, error?.message ?? "No se pudo cancelar.", "mal");
    console.error(error);
    boton.disabled = false;
  }
}

dom.btnRefrescar.addEventListener("click", refrescar);

dom.btnCancelarTodas.addEventListener("click", async () => {
  // Dos confirmaciones: la primera dice cuánto se mueve, la segunda pide
  // escribirlo. Es dinero de jugadores y no se toca por un clic de más.
  const { data: antes } = await listar();
  const enEspera = antes.salas.filter((s) => s.cancelable);
  if (!enEspera.length) return;

  const total = enEspera.reduce((s, x) => s + x.leyendasRetenidas, 0);
  if (!confirm(`Cancelar ${enEspera.length} salas y devolver ${total} Leyendas?`)) return;
  if (prompt('Escribí CANCELAR para confirmar') !== "CANCELAR") {
    decir(dom.aviso, "Cancelado. No se tocó nada.");
    return;
  }

  dom.btnCancelarTodas.disabled = true;
  decir(dom.aviso, "Cancelando…");
  try {
    const { data } = await cancelarTodas();
    const fallos = data.fallidas.length
      ? ` ${data.fallidas.length} fallaron: ${data.fallidas.map((f) => f.codigo).join(", ")}.`
      : "";
    decir(
      dom.aviso,
      `${data.canceladas} canceladas, ${data.devueltasEnTotal} Leyendas devueltas.${fallos}`,
      data.fallidas.length ? "mal" : "bien",
    );
    if (data.fallidas.length) console.warn("Fallaron:", data.fallidas);
    await refrescar();
  } catch (error) {
    decir(dom.aviso, error?.message ?? "No se pudo cancelar.", "mal");
    console.error(error);
    dom.btnCancelarTodas.disabled = false;
  }
});
