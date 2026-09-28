/**
 * El lobby: las tres formas de jugar con otros —torneos, mesas públicas y
 * salas privadas— y la puerta al entrenamiento.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ JUEGOS HAY NO ESTÁ ESCRITO ACÁ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Sale de la colección `juegos/{id}`: se muestran los que dicen
 * `activo: true`, ordenados por `orden`, con su nombre y su logo. Agregar un
 * juego es agregar un documento; ninguna línea de este archivo sabe cómo se
 * llama. Una mesa pública de un juego inactivo —o de uno que no está en la
 * colección— no aparece.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE ESTA PÁGINA SÓLO PIDE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Sentarse, crear una sala privada, abrir, editar o borrar una mesa pública:
 * todo pasa por el servidor, que decide. Los controles de la administración
 * se muestran si `soyAdministrador` dice que sí, pero no protegen nada: las
 * tres llamadas lo vuelven a comprobar con el correo verificado.
 *
 * Las mesas públicas se escuchan con la consulta que las reglas permiten
 * —`publica == true`—: una que pidiera todas las salas la rechazarían entera.
 */

import { db, collection, query, where, onSnapshot, getDocs } from "./firebase.js";
import { exigirSesion, mostrarSaldo, conectarBotonSalir } from "./sesion.js";
import { ENTRADAS, ESTADOS_SALA, MAX_JUGADORES } from "./reglas/salas.js";
import { juegoDe } from "./reglas/juegos.js";
import { esRutaDelSitio } from "./reglas/catalogo.js";
import { opcionesDeDuracion } from "./rivales.js";
import {
  soyAdministrador, crearSalaPublica, editarSalaPublica, borrarSalaPublica, ErrorDeServidor,
} from "./servidor.js";
import { crearYMostrar } from "./sala-privada.js";
import { conectarCampoDeCodigo, entrarConCodigo, irALaSala } from "./entrar-por-codigo.js";
import { consumir as consumirCodigoPendiente } from "./codigo-pendiente.js";
import { montarCarteleraTorneos } from "./cartelera-torneos.js";
import { escapar } from "./modulos/texto.js";

const $ = (id) => document.getElementById(id);

conectarBotonSalir();

let miUid = null;
let saldo = 0;
let miNombre = "Jugador";
let esAdmin = false;
/** Los juegos activos, en su orden. `null` mientras no llegan. */
let juegos = null;
/** Las mesas públicas en espera, tal como llegan. `null` mientras no llegan. */
let mesas = null;
/** El código de la mesa que se está editando, o `null` si se abre una nueva. */
let editando = null;

// ------------------------------------------------------------- avisos

function avisar(texto, tipo = "info") {
  const caja = $("mensaje");
  caja.textContent = texto;
  caja.className = `aviso-salas visible ${tipo}`;
}

function limpiarAviso() {
  $("mensaje").textContent = "";
  $("mensaje").className = "aviso-salas";
}

const mensajeDe = (error, porOmision) => (error instanceof ErrorDeServidor ? error.message : porOmision);

// ------------------------------------------------------ los desplegables

// Las entradas y las duraciones salen de las reglas, no escritas a mano.
const opcionesDeEntrada = (elegida) =>
  ENTRADAS.map((e) => `<option value="${e}"${e === elegida ? " selected" : ""}>${e} Leyendas</option>`).join("");
const opcionesDeLaDuracion = () =>
  opcionesDeDuracion()
    .map((o) => `<option value="${o.valor}"${o.porDefecto ? " selected" : ""}>${o.etiqueta}</option>`)
    .join("");

$("entradaSala").innerHTML = opcionesDeEntrada(10);
$("duracionSala").innerHTML = opcionesDeLaDuracion();
$("publicaEntrada").innerHTML = opcionesDeEntrada(10);
$("publicaDuracion").innerHTML = opcionesDeLaDuracion();

// ------------------------------------------------------ sesión y perfil

const sesion = await exigirSesion();
if (sesion) {
  miUid = sesion.usuario.uid;
  saldo = sesion.perfil.saldo;
  miNombre = sesion.perfil.nombre;
  mostrarSaldo(saldo);

  montarCarteleraTorneos();
  cargarJuegos();
  escucharMesasPublicas();

  // Sin `await`: si la pregunta tarda o falla, el lobby se usa igual y los
  // controles de la administración simplemente no aparecen.
  soyAdministrador()
    .then((respuesta) => {
      esAdmin = respuesta?.admin === true;
      $("adminPublicas").hidden = !esAdmin;
      pintarMesas();
    })
    .catch(() => {});
}

// --------------------------------------------------------- los juegos

async function cargarJuegos() {
  try {
    const snap = await getDocs(collection(db, "juegos"));
    juegos = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((j) => j.activo === true)
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  } catch (error) {
    console.error("No se pudieron leer los juegos:", error);
    juegos = [];
  }
  pintarMesas();
}

// ------------------------------------------------- las mesas públicas

function escucharMesasPublicas() {
  // Sólo las públicas: las reglas no dejan leer una sala privada ajena, y una
  // consulta que pudiera traer alguna la rechazan entera.
  const consulta = query(
    collection(db, "rooms"),
    where("publica", "==", true),
    where("estado", "==", ESTADOS_SALA.ESPERANDO),
  );

  onSnapshot(
    consulta,
    (snap) => {
      mesas = snap.docs.map((d) => d.data());
      pintarMesas();
    },
    (error) => {
      console.error("No se pudieron leer las mesas públicas:", error);
      $("listaPublicas").innerHTML =
        '<p class="vacio-simple">No pudimos cargar las mesas. Probá recargar la página.</p>';
    },
  );
}

/** El logo de un juego, sólo si es un archivo del sitio. */
function logoDe(juego) {
  if (!juego.logo || !esRutaDelSitio(juego.logo)) return "";
  return `<img class="juego-logo" src="${escapar(juego.logo)}" alt="" width="28" height="28" />`;
}

function filaDeMesa(mesa) {
  const sentados = (mesa.jugadores ?? []).length;
  const cupo = mesa.maxJugadores ?? MAX_JUGADORES;
  const estoy = (mesa.jugadores ?? []).includes(miUid);
  const llena = sentados >= cupo;

  const accion = estoy
    ? `<button class="accion chica" type="button" data-volver="${escapar(mesa.codigo)}">Volver</button>`
    : llena
      ? '<button class="accion chica" type="button" disabled>Llena</button>'
      : `<button class="accion chica" type="button" data-sentarse="${escapar(mesa.codigo)}">Sentarse</button>`;

  const admin = esAdmin
    ? `<button class="accion sobria chica" type="button" data-editar="${escapar(mesa.codigo)}">Editar</button>
       <button class="accion sobria chica" type="button" data-borrar="${escapar(mesa.codigo)}">Borrar</button>`
    : "";

  return `
    <div class="mesa-publica" data-codigo="${escapar(mesa.codigo)}">
      <div class="mesa-nombre">${escapar(mesa.nombre ?? "Mesa")}</div>
      <div class="mesa-datos">
        <span>👥 ${sentados}/${cupo}</span>
        <span>Entrada ${Number(mesa.entrada) || 0} Leyendas Ganadas</span>
        <span>Hasta ${Number(mesa.limitePuntos) || 0} puntos</span>
      </div>
      <div class="mesa-acciones">${accion}${admin}</div>
    </div>`;
}

function pintarMesas() {
  const caja = $("listaPublicas");
  if (juegos === null || mesas === null) return;

  if (!juegos.length) {
    caja.innerHTML = '<p class="vacio-simple">No hay juegos disponibles por ahora.</p>';
    return;
  }

  const bloques = juegos
    .map((juego) => ({
      juego,
      suyas: mesas
        .filter((m) => juegoDe(m) === juego.id)
        .sort((a, b) => (a.entrada ?? 0) - (b.entrada ?? 0)),
    }))
    .filter((b) => b.suyas.length > 0);

  if (!bloques.length) {
    caja.innerHTML = '<p class="vacio-simple">Todavía no hay mesas públicas abiertas.</p>';
    return;
  }

  caja.innerHTML = bloques
    .map(
      ({ juego, suyas }) => `
        <div class="juego-bloque" data-juego="${escapar(juego.id)}">
          <h3 class="juego-titulo">${logoDe(juego)}<span>${escapar(juego.nombre ?? juego.id)}</span></h3>
          ${suyas.map(filaDeMesa).join("")}
        </div>`,
    )
    .join("");
}

$("listaPublicas").addEventListener("click", async (evento) => {
  const boton = evento.target.closest("button");
  if (!boton) return;

  if (boton.dataset.sentarse) {
    await entrarConCodigo(boton.dataset.sentarse, { boton, avisar, limpiarAviso });
  } else if (boton.dataset.volver) {
    irALaSala(boton.dataset.volver);
  } else if (boton.dataset.editar) {
    empezarEdicion(boton.dataset.editar);
  } else if (boton.dataset.borrar) {
    await borrar(boton);
  }
});

// -------------------------------------------- la administración de mesas

function formularioAbrir() {
  editando = null;
  $("tituloAdminPublicas").textContent = "Abrir una mesa pública";
  $("btnGuardarPublica").textContent = "Abrir mesa";
  $("btnCancelarEdicion").hidden = true;
  $("publicaNombre").value = "";
  $("publicaEntrada").value = "10";
  $("publicaDuracion").innerHTML = opcionesDeLaDuracion();
  $("publicaCupo").value = String(MAX_JUGADORES);
}

function empezarEdicion(codigo) {
  const mesa = (mesas ?? []).find((m) => m.codigo === codigo);
  if (!mesa) return;
  editando = codigo;
  $("tituloAdminPublicas").textContent = `Editar la mesa ${codigo}`;
  $("btnGuardarPublica").textContent = "Guardar cambios";
  $("btnCancelarEdicion").hidden = false;
  $("publicaNombre").value = mesa.nombre ?? "";
  $("publicaEntrada").value = String(mesa.entrada);
  $("publicaDuracion").value = String(mesa.limitePuntos);
  $("publicaCupo").value = String(mesa.maxJugadores ?? MAX_JUGADORES);
  $("adminPublicas").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

$("btnCancelarEdicion").addEventListener("click", formularioAbrir);

$("adminPublicas").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const boton = $("btnGuardarPublica");
  const datos = {
    nombre: $("publicaNombre").value.trim() || undefined,
    entrada: Number($("publicaEntrada").value),
    limitePuntos: Number($("publicaDuracion").value),
    maxJugadores: Number($("publicaCupo").value),
  };

  boton.disabled = true;
  limpiarAviso();
  try {
    if (editando) {
      await editarSalaPublica({ codigo: editando, ...datos });
      avisar("Cambios guardados.");
    } else {
      await crearSalaPublica(datos);
      avisar("Mesa abierta.");
    }
    formularioAbrir();
  } catch (error) {
    avisar(mensajeDe(error, "No pudimos guardar la mesa."), "error");
  } finally {
    boton.disabled = false;
  }
});

/**
 * Borrar pide dos toques: el primero pregunta, el segundo borra. Una mesa con
 * gente sentada se cancela y se les devuelve la entrada; un solo toque de más
 * no debería poder hacer eso.
 */
async function borrar(boton) {
  if (boton.dataset.confirmar !== "1") {
    boton.dataset.confirmar = "1";
    boton.textContent = "¿Borrar? Tocá de nuevo";
    setTimeout(() => {
      if (boton.isConnected && boton.dataset.confirmar === "1") {
        boton.dataset.confirmar = "";
        boton.textContent = "Borrar";
      }
    }, 4000);
    return;
  }
  boton.disabled = true;
  limpiarAviso();
  try {
    await borrarSalaPublica(boton.dataset.borrar);
    avisar("Mesa borrada. Si alguien había pagado la entrada, se le devolvió.");
  } catch (error) {
    avisar(mensajeDe(error, "No pudimos borrar la mesa."), "error");
    boton.disabled = false;
  }
}

// ------------------------------------------------------ salas privadas

$("btnCrearSala").addEventListener("click", () =>
  crearYMostrar({
    boton: $("btnCrearSala"),
    caja: $("codigoPrivado"),
    entrada: Number($("entradaSala").value),
    duracion: Number($("duracionSala").value),
    nombre: `Sala de ${miNombre}`,
    saldo,
    avisar,
    limpiarAviso,
  }),
);

conectarCampoDeCodigo($("codigoSala"), $("btnUnirse"), { avisar, limpiarAviso });

/*
 * El código que llegó por un link corto, si llegó.
 *
 * Se CONSUME —se lee y se borra de una— así que una segunda visita al lobby
 * abre con el campo vacío y no pisa lo que la persona esté escribiendo.
 *
 * Y NO se une solo, a propósito: se llena el campo y se enfoca el botón, pero
 * el último paso lo da quien recibió la invitación. Entrar a una sala cuesta
 * Leyendas, y gastar la plata de alguien por haber tocado un link es
 * exactamente lo que no se hace.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SÓLO SI HAY SESIÓN, Y ESTO NO ES UN DETALLE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `exigirSesion()` manda al login cuando no hay sesión, pero NO corta este
 * archivo: asignar `location.href` pide una navegación y el resto del módulo
 * sigue corriendo igual hasta que el navegador se va.
 *
 * Sin esta guarda, quien tocaba el link sin sesión perdía el código: el lobby
 * lo consumía —lo leía y lo borraba— en ese instante muerto, y cuando la
 * persona terminaba de entrar ya no quedaba nada. Se descubrió probándolo
 * contra producción, no leyéndolo.
 */
if (sesion) {
  const pendiente = consumirCodigoPendiente();
  if (pendiente) {
    $("codigoSala").value = pendiente;
    $("btnUnirse").focus();
    avisar("Te invitaron a una sala. Tocá «Entrar» para unirte.");
  }
}
