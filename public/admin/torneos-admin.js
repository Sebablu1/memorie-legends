/**
 * El panel de torneos.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ CADA PASO ES UN BOTÓN DISTINTO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque cada paso hace algo irreversible con la plata de otra gente: abrir
 * inscripciones deja que se cobre, iniciar impide devolver, finalizar paga.
 * Un solo botón de "avanzar" ahorraría clics y haría que un doble toque
 * distraído cobrara y pagara de una.
 *
 * Los botones que se ven salen del ESTADO del torneo, no de una lista fija: si
 * un torneo está en curso, el botón de cancelar directamente no existe. Es la
 * misma decisión que toma el servidor, dibujada — y el servidor la vuelve a
 * tomar igual, porque esconder un botón no es impedir una llamada.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE ESTE ARCHIVO NUNCA MANDA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Montos. Al finalizar viajan los UID de los ganadores en orden y nada más:
 * cuánto cobra cada uno lo calcula el servidor con el pozo que el servidor
 * guardó. Si el monto saliera de acá, un error de tipeo pagaría el pozo entero
 * al primero.
 */

import { funciones, httpsCallable } from "../js/firebase.js";
import { ESTADOS, camposEditables } from "../js/reglas/torneos.js";
import { ENTRADAS_SUGERIDAS } from "../js/reglas/configuracion.js";

const $ = (id) => document.getElementById(id);

const crearTorneo = httpsCallable(funciones, "crearTorneoAdmin");
const abrirInscripciones = httpsCallable(funciones, "abrirInscripcionesAdmin");
const cerrarInscripciones = httpsCallable(funciones, "cerrarInscripcionesAdmin");
const iniciarTorneo = httpsCallable(funciones, "iniciarTorneoAdmin");
const finalizarTorneo = httpsCallable(funciones, "finalizarTorneoAdmin");
const cancelarTorneo = httpsCallable(funciones, "cancelarTorneoAdmin");
const editarTorneo = httpsCallable(funciones, "editarTorneoAdmin");
const detalleTorneo = httpsCallable(funciones, "detalleTorneoAdmin");
// La del PANEL, que trae todos. La del jugador —`listarTorneos`— devuelve
// sólo los que tienen inscripciones abiertas, y con ésa el panel no veía
// sus propios borradores ni los torneos ya cerrados o en curso.
const listarTorneos = httpsCallable(funciones, "listarTorneosAdmin");
const leerUmbrales = httpsCallable(funciones, "leerUmbralesAdmin");
const guardarUmbrales = httpsCallable(funciones, "guardarUmbralesAdmin");

const escapar = (t) =>
  String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function decir(caja, texto, clase = "") {
  if (!caja) return;
  caja.textContent = texto ?? "";
  caja.className = `aviso ${clase}`;
}

/** Cómo se lee cada estado en pantalla. */
const ETIQUETA = {
  [ESTADOS.BORRADOR]: "Borrador",
  [ESTADOS.INSCRIPCIONES_ABIERTAS]: "Inscripciones abiertas",
  [ESTADOS.COMPLETO]: "Completo",
  [ESTADOS.EN_CURSO]: "En curso",
  [ESTADOS.FINALIZADO]: "Finalizado",
  [ESTADOS.CANCELADO]: "Cancelado",
};

/**
 * Qué se puede hacer con un torneo, según dónde esté.
 *
 * Sale del estado y no de una lista fija. Cuando el torneo está en curso o ya
 * terminó, la lista queda vacía y no se dibuja ningún botón: no hay nada que
 * hacer que no sea peligroso.
 */
function accionesDe(estado) {
  /**
   * Renombrar sale de las REGLAS, no de esta lista.
   *
   * `camposEditables` dice qué se puede tocar en cada estado, y es la misma
   * función que usa el servidor para decidir. Si mañana se congela el
   * nombre en algún estado, el botón desaparece solo: no hay dos listas que
   * mantener de acuerdo.
   *
   * La entrada y el cupo no están acá a propósito. Se editan en borrador,
   * con el formulario de creación; una vez publicadas ya hay gente que pagó
   * mirando esos números.
   */
  const editar = camposEditables(estado).includes("nombre")
    ? [{ accion: "editar", texto: "Editar" }]
    : [];

  if (estado === ESTADOS.BORRADOR) {
    return [
      { accion: "abrir", texto: "Abrir inscripciones" },
      ...renombrar,
      { accion: "cancelar", texto: "Cancelar", clase: "peligro" },
    ];
  }
  if (estado === ESTADOS.INSCRIPCIONES_ABIERTAS) {
    return [
      { accion: "cerrar", texto: "Cerrar inscripciones" },
      ...renombrar,
      { accion: "cancelar", texto: "Cancelar y devolver", clase: "peligro" },
    ];
  }
  if (estado === ESTADOS.COMPLETO) {
    return [
      { accion: "iniciar", texto: "Armar mesas y empezar" },
      ...renombrar,
      { accion: "cancelar", texto: "Cancelar y devolver", clase: "peligro" },
    ];
  }
  if (estado === ESTADOS.EN_CURSO) {
    return [{ accion: "finalizar", texto: "Cargar ganadores y pagar" }, ...renombrar];
  }
  return [];
}

function dibujarTorneo(t) {
  const botones = accionesDe(t.estado)
    .map(
      (b) =>
        `<button class="btn chico ${b.clase ?? "sobrio"}" type="button"
                 data-accion="${b.accion}" data-id="${escapar(t.id)}">${b.texto}</button>`,
    )
    .join(" ");

  const pozo = Number(t.pozo ?? 0);

  return `
    <div class="fila ${t.estado === ESTADOS.CANCELADO || t.estado === ESTADOS.FINALIZADO ? "apagada" : ""}">
      <span class="codigo">${escapar(t.nombre ?? t.id)}</span>
      <span class="campo">estado <b>${escapar(ETIQUETA[t.estado] ?? t.estado)}</b></span>
      <span class="campo">entrada <b>${Number(t.entrada ?? 0).toLocaleString("es-UY")}</b></span>
      <span class="campo">inscriptos <b>${Number(t.inscriptos ?? 0)}</b></span>
      <span class="campo">pozo <b>${pozo.toLocaleString("es-UY")}</b></span>
      ${t.ganadores?.length ? `<span class="campo">ganó <b>${escapar(t.ganadores[0])}</b></span>` : ""}
      ${t.devueltos ? `<span class="campo">devueltos <b>${t.devueltos}</b></span>` : ""}
      ${botones}
      <button class="btn chico sobrio" type="button"
              data-accion="ver" data-id="${escapar(t.id)}">Ver inscriptos</button>
    </div>`;
}

/**
 * La lista.
 *
 * `listarTorneos` devuelve sólo los abiertos —es la cartelera del jugador—, así
 * que el panel pide el detalle de cada uno para poder mostrar también los
 * borradores y los terminados. Son decenas de documentos, no miles.
 */
let ultimos = [];

async function refrescar() {
  decir($("avisoTorneos"), "Cargando…");
  try {
    const { data } = await listarTorneos();
    ultimos = data.torneos ?? [];
    $("listaTorneos").innerHTML = ultimos.length
      ? ultimos.map(dibujarTorneo).join("")
      : '<p class="nota">Todavía no creaste ningún torneo.</p>';
    decir($("avisoTorneos"), `${ultimos.length} torneo${ultimos.length === 1 ? "" : "s"}.`);
  } catch (error) {
    decir($("avisoTorneos"), error?.message ?? "No se pudieron leer los torneos.", "mal");
  }
}

/**
 * Lo que escribe un `datetime-local`, a milisegundos.
 *
 * El campo da una hora LOCAL sin zona —`2026-09-20T20:00`— y `new Date` la
 * interpreta en la zona del navegador, que es justo lo que se quiere: el
 * administrador escribe la hora de su reloj y eso es lo que se guarda.
 *
 * Vacío devuelve `null`, que el servidor entiende como «todavía sin fecha».
 */
function enMilisegundos(valor) {
  if (!valor) return null;
  const t = new Date(valor).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Y la vuelta, para poder editar la fecha guardada. */
function comoCampo(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const d = new Date(ms);
  const dos = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}` +
    `T${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

async function crear() {
  const boton = $("btnCrearTorneo");
  boton.disabled = true;
  decir($("avisoTorneos"), "Creando…");

  try {
    const { data } = await crearTorneo({
      nombre: $("torneoNombre").value.trim(),
      entrada: Number($("torneoEntrada").value),
      maxJugadores: Number($("torneoMaximo").value),
      tipo: $("torneoTipo").value,
      descripcion: $("torneoDescripcion").value.trim(),
      comienzaEn: enMilisegundos($("torneoComienza").value),
    });
    decir($("avisoTorneos"), `Creado «${data.nombre}» en borrador. Abrí las inscripciones cuando quieras.`, "bien");
    $("torneoNombre").value = "";
    $("torneoDescripcion").value = "";
    $("torneoComienza").value = "";
    await refrescar();
  } catch (error) {
    decir($("avisoTorneos"), error?.message ?? "No se pudo crear.", "mal");
  } finally {
    boton.disabled = false;
  }
}

/**
 * Corrige lo que se puede corregir sin cambiarle el trato a nadie.
 *
 * Nombre, descripción y fecha. La entrada y el cupo no: son las dos cosas
 * que el jugador miró antes de pagar, y el servidor las rechaza igual si
 * llegaran cambiadas.
 *
 * Se pide de a un campo con `prompt`, que es el modo del resto de este
 * panel. Cancelar en cualquiera corta todo: no se guarda a medias.
 *
 * Los valores actuales salen de `ultimos`, la última lista traída, en vez
 * de volver a pedirla: la fila desde la que se tocó el botón se dibujó con
 * esos mismos datos.
 */
async function editarEtiquetas(id) {
  const t = ultimos.find((x) => x.id === id);
  if (!t) {
    decir($("avisoTorneos"), "Ese torneo ya no está en la lista. Refrescá.", "mal");
    return false;
  }

  const nombre = prompt("Nombre del torneo:", t.nombre ?? "");
  if (nombre === null) return false;

  const descripcion = prompt(
    "De qué va (lo lee el jugador antes de pagar):",
    t.descripcion ?? "",
  );
  if (descripcion === null) return false;

  const cuando = prompt(
    "Cuándo empieza, con formato 2026-09-20T20:00.\nVacío = sin fecha.",
    comoCampo(t.comienzaEn),
  );
  if (cuando === null) return false;

  const { data } = await editarTorneo({
    torneoId: id,
    nombre,
    descripcion,
    comienzaEn: enMilisegundos(cuando),
  });
  decir($("avisoTorneos"), `«${data.nombre}» actualizado.`, "bien");
  return true;
}

/**
 * Cargar ganadores.
 *
 * Se piden los UID separados por coma y EN ORDEN: el primero es el campeón. El
 * servidor comprueba que los tres estén inscriptos y calcula cuánto cobra cada
 * uno; acá sólo se junta la lista.
 */
async function pedirGanadores(id) {
  const { data } = await detalleTorneo({ torneoId: id });
  const inscriptos = (data.inscriptos ?? []).map((i) => i.uid);

  const respuesta = window.prompt(
    `Ganadores de «${data.nombre}», en orden y separados por coma ` +
      `(1.º primero).\n\nInscriptos:\n${inscriptos.join("\n")}`,
    "",
  );
  if (!respuesta) return null;

  return respuesta
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function ejecutar(accion, id) {
  decir($("avisoTorneos"), "…");

  try {
    if (accion === "editar") {
      if (!(await editarEtiquetas(id))) return;
    } else if (accion === "abrir") {
      await abrirInscripciones({ torneoId: id });
      decir($("avisoTorneos"), "Inscripciones abiertas: ya se cobra la entrada.", "bien");
    } else if (accion === "cerrar") {
      const { data } = await cerrarInscripciones({ torneoId: id });
      decir(
        $("avisoTorneos"),
        data.cancelado
          ? `No llegaron los cuatro mínimos: el torneo se canceló y se devolvieron ${data.devueltos} entradas.`
          : `Inscripciones cerradas con ${data.inscriptos} jugadores.`,
        "bien",
      );
    } else if (accion === "iniciar") {
      const { data } = await iniciarTorneo({ torneoId: id });
      decir(
        $("avisoTorneos"),
        `${data.mesas.length} mesa${data.mesas.length === 1 ? "" : "s"} armada${data.mesas.length === 1 ? "" : "s"}` +
          (data.devueltos.length ? `, ${data.devueltos.length} entrada(s) devuelta(s) a los que sobraban` : "") +
          `. Pozo: ${data.pozo.toLocaleString("es-UY")} Leyendas.`,
        "bien",
      );
    } else if (accion === "finalizar") {
      const ganadores = await pedirGanadores(id);
      if (!ganadores) return;
      const { data } = await finalizarTorneo({ torneoId: id, ganadores });
      decir(
        $("avisoTorneos"),
        `Pagado: ${data.repartido.toLocaleString("es-UY")} Leyendas repartidas, ` +
          `${data.comisionCasa.toLocaleString("es-UY")} para la casa.`,
        "bien",
      );
    } else if (accion === "cancelar") {
      const motivo = window.prompt("¿Por qué se cancela? (queda escrito)", "");
      if (motivo === null) return;
      const { data } = await cancelarTorneo({ torneoId: id, motivo });
      decir($("avisoTorneos"), `Cancelado. ${data.devueltos} entrada(s) devuelta(s).`, "bien");
    } else if (accion === "ver") {
      const { data } = await detalleTorneo({ torneoId: id });
      const quienes = (data.inscriptos ?? []).map((i) => i.uid).join(", ");
      decir($("avisoTorneos"), quienes ? `Inscriptos: ${quienes}` : "Todavía no se anotó nadie.");
      return;
    }

    await refrescar();
  } catch (error) {
    decir($("avisoTorneos"), error?.message ?? "No se pudo.", "mal");
  }
}

// ---------------------------------------------------- umbrales del ranking

async function cargarUmbrales() {
  try {
    const { data } = await leerUmbrales();
    for (const u of data.umbrales ?? []) {
      if (u.premio === "remera") $("umbralRemera").value = u.minimoPuntos;
      if (u.premio === "llavero") $("umbralLlavero").value = u.minimoPuntos;
    }
  } catch {
    // Si no se pueden leer, quedan los de fábrica que ya están en el HTML. El
    // panel sigue sirviendo para todo lo demás.
  }
}

async function guardarLosUmbrales() {
  const boton = $("btnGuardarUmbrales");
  boton.disabled = true;

  try {
    await guardarUmbrales({
      remera: Number($("umbralRemera").value),
      llavero: Number($("umbralLlavero").value),
    });
    decir($("avisoUmbrales"), "Guardado. Rige a partir del próximo cierre de mes.", "bien");
  } catch (error) {
    decir($("avisoUmbrales"), error?.message ?? "No se pudo guardar.", "mal");
  } finally {
    boton.disabled = false;
  }
}

// ------------------------------------------------------------- arranque

/** La engancha `admin.js` cuando la sesión ya es de administrador. */
export function montarTorneosAdmin() {
  if (!$("listaTorneos")) return;

  // Las entradas sugeridas como `datalist`: son un atajo, no las únicas
  // válidas. El rango entero lo comprueba el servidor.
  const lista = document.createElement("datalist");
  lista.id = "entradasSugeridas";
  lista.innerHTML = ENTRADAS_SUGERIDAS.map((e) => `<option value="${e}"></option>`).join("");
  document.body.appendChild(lista);
  $("torneoEntrada").setAttribute("list", "entradasSugeridas");

  $("btnCrearTorneo").addEventListener("click", crear);
  $("btnRefrescarTorneos").addEventListener("click", refrescar);
  $("btnGuardarUmbrales").addEventListener("click", guardarLosUmbrales);

  // Delegación: la lista se repinta entera en cada operación, así que
  // enganchar botón por botón dejaría escuchadores muertos en cada vuelta.
  $("listaTorneos").addEventListener("click", (evento) => {
    const boton = evento.target.closest("button[data-accion]");
    if (boton) ejecutar(boton.dataset.accion, boton.dataset.id);
  });

  refrescar();
  cargarUmbrales();
}
