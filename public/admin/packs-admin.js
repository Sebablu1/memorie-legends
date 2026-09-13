/**
 * Los paquetes de Leyendas, desde el panel.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ACÁ SE TOCA DINERO DE VERDAD
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Todo lo demás del panel mueve Leyendas, que las emite la casa. Esto mueve
 * PESOS: el precio que se escriba en este formulario es el que Mercado Pago le
 * va a cobrar a una persona. Un cero de más es una venta al décuplo y un cero
 * de menos es regalar 15.000 Leyendas por $500.
 *
 * De ahí las tres cosas que hace esta pantalla y que las otras no:
 *
 *   - el total se CALCULA a la vista mientras se escribe, para que el error de
 *     tipeo se vea antes de guardar y no después de la primera venta;
 *   - el precio por Leyenda también, porque es donde un precio torcido salta:
 *     un pack caro que rinde peor que el barato está mal aunque los dos
 *     números parezcan razonables;
 *   - borrar pide confirmación escribiendo el id, no un «¿seguro?».
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE ESTA PANTALLA NO DECIDE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Nada. `problemasDelPaquete` corre acá para avisar antes de guardar y DENTRO
 * de `guardarPackAdmin` para decidir; el panel manda un objeto a una Cloud
 * Function y quien abra la consola manda el que quiera. Y los artículos
 * exclusivos los vuelve a comprobar el servidor contra el catálogo, porque
 * prometer un id que no existe hace que el comprador pague y no reciba.
 */

import { funciones, httpsCallable } from "../js/firebase.js";
import {
  problemasDelPaquete,
  leyendasDePaquete,
  precioPorLeyenda,
  PRECIO_MINIMO_PACK,
  PRECIO_MAXIMO_PACK,
} from "../js/reglas/economia.js";
import { esExclusivoDePack, ETIQUETA_TIPO } from "../js/reglas/catalogo.js";

const $ = (id) => document.getElementById(id);
const llamar = (nombre) => httpsCallable(funciones, nombre);

const limpio = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const pesos = (n) => `$U ${Number(n ?? 0).toLocaleString("es-UY")}`;
const leyendas = (n) => Number(n ?? 0).toLocaleString("es-UY");

/** Lo último que contestó el servidor, para poder editar sin volver a pedir. */
let packs = [];
/** Los artículos del catálogo que se pueden poner en un pack. */
let exclusivos = [];
/** El id que se está editando, o `null` si es uno nuevo. */
let editando = null;

function avisar(texto, malo = false) {
  const caja = $("avisoPacks");
  if (!caja) return;
  caja.textContent = texto ?? "";
  caja.classList.toggle("malo", Boolean(malo));
}

// ---------------------------------------------------------------- leer

async function refrescar() {
  avisar("Leyendo…");
  try {
    const [r, cat] = await Promise.all([
      llamar("listarPacksAdmin")(),
      llamar("listarCatalogoAdmin")(),
    ]);

    packs = r.data?.packs ?? [];
    exclusivos = (cat.data?.items ?? []).filter(esExclusivoDePack);

    dibujar(Boolean(r.data?.desdeLaSemilla));
    llenarSelectorDeItems();

    avisar(
      r.data?.desdeLaSemilla
        ? "Todavía no hay ningún paquete guardado: esto es la semilla del código. Tocá «Sembrar paquetes» para poder editarlos."
        : `${packs.length} paquetes.`,
      Boolean(r.data?.desdeLaSemilla),
    );
  } catch (e) {
    avisar(e?.message ?? "No se pudieron leer los paquetes.", true);
  }
}

function dibujar(desdeLaSemilla) {
  const caja = $("listaPacks");
  if (!caja) return;

  if (!packs.length) {
    caja.innerHTML = '<p class="nota">No hay paquetes.</p>';
    return;
  }

  // El de mejor precio por Leyenda, que es el que la tienda marca. Se muestra
  // acá para que se note cuando queda en uno del medio, que es la señal de
  // que algún precio está torcido.
  const mejor = packs.reduce((a, b) => (precioPorLeyenda(b) < precioPorLeyenda(a) ? b : a));

  caja.innerHTML = packs
    .map((p) => {
      const total = leyendasDePaquete(p);
      const cuantos = Array.isArray(p.itemsExclusivos) ? p.itemsExclusivos.length : 0;
      const apagado = p.activo === false;

      return `
      <div class="fila ${apagado ? "apagada" : ""}">
        <span class="codigo">${limpio(p.id)}</span>
        <span class="campo"><b>${limpio(p.nombre)}</b><br />orden ${Number(p.orden ?? 0)}</span>
        <span class="campo">${pesos(p.precioUYU)}</span>
        <span class="campo">${leyendas(p.leyendasBase)} + ${leyendas(p.leyendasRegalo)}<br />= <b>${leyendas(total)}</b></span>
        <span class="campo">${precioPorLeyenda(p).toFixed(3)} $U/L${p.id === mejor.id ? " 🏷️" : ""}</span>
        <span class="campo">${cuantos} ${cuantos === 1 ? "artículo" : "artículos"}</span>
        <span class="campo">${apagado ? "🚫 retirado" : "✅ a la venta"}</span>
        <button class="btn sobrio chico" data-editar-pack="${limpio(p.id)}" type="button">Editar</button>
        <button class="btn sobrio chico" data-activar-pack="${limpio(p.id)}"
                data-a="${apagado ? "1" : "0"}" type="button">
          ${apagado ? "Poner a la venta" : "Retirar"}
        </button>
        <button class="btn peligro chico" data-borrar-pack="${limpio(p.id)}" type="button">Borrar</button>
      </div>`;
    })
    .join("");

  if (desdeLaSemilla) {
    caja.insertAdjacentHTML(
      "afterbegin",
      '<p class="nota">⚠️ Estos son los del código, no los de la base. Editarlos no hace nada hasta que siembres.</p>',
    );
  }
}

/**
 * El selector sólo ofrece artículos marcados como exclusivos de un pack.
 *
 * No es una comodidad: poner un avatar normal en un pack lo regalaría a quien
 * pague sin sacarlo de la tienda, así que el mismo avatar se vendería con
 * Leyendas y con pesos. Lo que va en un pack se marca primero en el catálogo.
 */
function llenarSelectorDeItems() {
  const sel = $("packItems");
  if (!sel) return;

  if (!exclusivos.length) {
    sel.innerHTML = '<option disabled>No hay artículos marcados como exclusivos de un pack.</option>';
    return;
  }

  sel.innerHTML = exclusivos
    .map((i) => {
      const tipo = ETIQUETA_TIPO[i.tipo]?.tienda ?? i.tipo;
      return `<option value="${limpio(i.id)}">${limpio(i.nombre)} — ${limpio(tipo)} (${limpio(i.id)})</option>`;
    })
    .join("");
}

// ------------------------------------------------------------ formulario

function abrirFormulario(pack = null) {
  editando = pack?.id ?? null;

  $("packId").value = pack?.id ?? "";
  $("packId").disabled = Boolean(pack);
  $("packNombre").value = pack?.nombre ?? "";
  $("packPrecio").value = pack?.precioUYU ?? 0;
  $("packBase").value = pack?.leyendasBase ?? 0;
  $("packRegalo").value = pack?.leyendasRegalo ?? 0;
  $("packOrden").value = pack?.orden ?? 0;
  $("packActivo").checked = pack?.activo !== false;

  const elegidos = new Set(pack?.itemsExclusivos ?? []);
  for (const opcion of $("packItems").options) opcion.selected = elegidos.has(opcion.value);

  actualizarResumen();
  $("formPack").hidden = false;
  $("packNombre").focus();
}

function cerrarFormulario() {
  $("formPack").hidden = true;
  editando = null;
  avisar("");
}

/** Lo que el formulario dice ahora mismo, con la forma que espera el servidor. */
function leerFormulario() {
  return {
    id: $("packId").value.trim(),
    nombre: $("packNombre").value.trim(),
    precioUYU: Number.parseInt($("packPrecio").value, 10),
    leyendasBase: Number.parseInt($("packBase").value, 10),
    leyendasRegalo: Number.parseInt($("packRegalo").value, 10),
    orden: Number.parseInt($("packOrden").value, 10) || 0,
    activo: $("packActivo").checked,
    itemsExclusivos: [...$("packItems").selectedOptions].map((o) => o.value),
  };
}

/**
 * El total y el precio por Leyenda, mientras se escribe.
 *
 * Es la defensa barata contra el cero de más: un precio de $25.000 se lee
 * parecido a $2.500, pero «0,004 $U por Leyenda» al lado no se parece a nada.
 */
function actualizarResumen() {
  const p = leerFormulario();
  const total = leyendasDePaquete(p);
  const caja = $("packResumen");
  if (!caja) return;

  if (!total || !Number.isFinite(p.precioUYU)) {
    caja.textContent = "Completá el precio y las Leyendas para ver el total.";
    return;
  }

  const unitario = precioPorLeyenda(p);
  const fuera =
    !Number.isInteger(p.precioUYU) ||
    p.precioUYU < PRECIO_MINIMO_PACK ||
    p.precioUYU > PRECIO_MAXIMO_PACK;

  caja.innerHTML =
    `Total: <b>${leyendas(total)} Leyendas</b> por ${pesos(p.precioUYU)} ` +
    `— ${unitario.toFixed(3)} $U por Leyenda.` +
    (fuera
      ? ` <b class="malo">El precio tiene que estar entre ${PRECIO_MINIMO_PACK} y ${PRECIO_MAXIMO_PACK}.</b>`
      : "");
}

async function guardar() {
  const pack = leerFormulario();

  // Avisar antes de mandar. Lo que decide es el servidor, que corre esta misma
  // función adentro de `guardarPackAdmin`.
  const problemas = problemasDelPaquete(pack);
  if (problemas.length) {
    avisar(problemas.join(" "), true);
    return;
  }

  $("btnGuardarPack").disabled = true;
  avisar("Guardando…");
  try {
    await llamar("guardarPackAdmin")({ pack });
    cerrarFormulario();
    await refrescar();
    avisar(editando ? "Paquete actualizado." : "Paquete creado.");
  } catch (e) {
    avisar(e?.message ?? "No se pudo guardar.", true);
  } finally {
    $("btnGuardarPack").disabled = false;
  }
}

/**
 * Borrar pide escribir el id.
 *
 * No es ceremonia: es lo único que distingue «quiero borrar ESTE» de «apreté
 * el botón de la fila de abajo». Un pack borrado por error se recrea, pero
 * mientras tanto la tienda le muestra a la gente una opción menos.
 */
async function borrar(id) {
  const escrito = window.prompt(
    `Vas a borrar el paquete «${id}». Escribí su id para confirmarlo.\n\n` +
      "Las compras ya hechas no se tocan: cada orden guarda su propio precio y sus Leyendas.",
  );
  if (escrito == null) return;
  if (escrito.trim() !== id) {
    avisar("No coincide el id: no se borró nada.", true);
    return;
  }

  try {
    await llamar("borrarPackAdmin")({ id });
    await refrescar();
    avisar(`Paquete «${id}» borrado.`);
  } catch (e) {
    avisar(e?.message ?? "No se pudo borrar.", true);
  }
}

async function activar(id, activo) {
  try {
    await llamar("activarPackAdmin")({ id, activo });
    await refrescar();
  } catch (e) {
    avisar(e?.message ?? "No se pudo cambiar.", true);
  }
}

async function sembrar() {
  try {
    const r = await llamar("sembrarPacksAdmin")();
    await refrescar();
    const creados = r.data?.creados ?? [];
    avisar(
      creados.length
        ? `Creados: ${creados.join(", ")}.`
        : "No hacía falta crear ninguno: ya estaban todos.",
    );
  } catch (e) {
    avisar(e?.message ?? "No se pudo sembrar.", true);
  }
}

// --------------------------------------------------------------- montaje

export function montarPacksAdmin() {
  if (!$("listaPacks")) return;

  $("btnRefrescarPacks")?.addEventListener("click", refrescar);
  $("btnSembrarPacks")?.addEventListener("click", sembrar);
  $("btnNuevoPack")?.addEventListener("click", () => abrirFormulario(null));
  $("btnCancelarPack")?.addEventListener("click", cerrarFormulario);
  $("btnGuardarPack")?.addEventListener("click", guardar);

  // El resumen se recalcula con cada tecla: el error de tipeo tiene que verse
  // mientras se escribe, no al guardar.
  for (const campo of ["packPrecio", "packBase", "packRegalo"]) {
    $(campo)?.addEventListener("input", actualizarResumen);
  }

  // Un solo escuchador en el contenedor: las filas se redibujan enteras en
  // cada cambio, y volver a colgar tres escuchadores por fila es cómo se
  // duplican los clics.
  $("listaPacks").addEventListener("click", (e) => {
    const editar = e.target.closest("[data-editar-pack]");
    if (editar) {
      const pack = packs.find((p) => p.id === editar.dataset.editarPack);
      if (pack) abrirFormulario(pack);
      return;
    }

    const prender = e.target.closest("[data-activar-pack]");
    if (prender) return activar(prender.dataset.activarPack, prender.dataset.a === "1");

    const quitar = e.target.closest("[data-borrar-pack]");
    if (quitar) return borrar(quitar.dataset.borrarPack);
  });
}
