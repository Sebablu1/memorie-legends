/**
 * El catálogo de la tienda, desde el panel.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ UN MÓDULO APARTE Y NO MÁS LÍNEAS EN `admin.js`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `admin.js` ya lleva siete secciones y ochocientas líneas. El catálogo tiene
 * un formulario, una lista, cuatro operaciones y su propio estado —qué
 * artículo se está editando—, y meterlo ahí adentro haría del archivo algo que
 * nadie vuelve a abrir con gusto.
 *
 * No es un panel nuevo: es el MISMO panel. Se carga desde el mismo HTML, usa
 * su hoja de estilos, sus clases y su misma puerta de entrada — si la sesión no
 * es de administrador, las Cloud Functions rechazan las cuatro llamadas igual.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE ESTA PANTALLA NO DECIDE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Nada. Valida antes de mandar para poder decir QUÉ está mal —"el precio no
 * puede ser negativo" se arregla, "los datos no son válidos" no— pero la
 * validación que cuenta corre en el servidor, con el mismo módulo de reglas.
 * Lo de acá es cortesía; lo de allá es la puerta.
 */

import { funciones, httpsCallable } from "../js/firebase.js";
import { TIPOS_VALIDOS, problemasDelItem, imagenEsArchivo } from "../js/reglas/catalogo.js";

const $ = (id) => document.getElementById(id);

const listarCatalogo = httpsCallable(funciones, "listarCatalogoAdmin");
const guardarItem = httpsCallable(funciones, "guardarItemAdmin");
const activarItem = httpsCallable(funciones, "activarItemAdmin");
const borrarItem = httpsCallable(funciones, "borrarItemAdmin");
const apagarViejos = httpsCallable(funciones, "apagarCatalogoViejoAdmin");

/** Escapa lo que venga de la base. Mismo criterio que `admin.js`. */
const limpio = (t) =>
  String(t ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const decir = (donde, texto, clase = "") => {
  if (!donde) return;
  donde.textContent = texto;
  donde.className = `aviso ${clase}`;
};

/** Lo último que devolvió el servidor. La lista se repinta desde acá. */
let catalogo = [];

// ------------------------------------------------------------- la lista

function dibujarLista() {
  const caja = $("listaCatalogo");
  if (!caja) return;

  if (!catalogo.length) {
    caja.innerHTML =
      '<p class="nota">El catálogo está vacío. Sembralo con el botón de arriba, o creá un artículo.</p>';
    return;
  }

  caja.innerHTML = catalogo
    .map((item) => {
      const figura = imagenEsArchivo(item.imagen)
        ? `<img src="${limpio(item.imagen)}" alt="" style="width:34px;height:34px;object-fit:contain;border-radius:8px" />`
        : `<span style="font-size:1.6rem;line-height:1">${limpio(item.imagen)}</span>`;

      return `
      <div class="fila ${item.activo === false ? "apagada" : ""}">
        ${figura}
        <span class="codigo">${limpio(item.tipo)}</span>
        <span class="campo"><b>${limpio(item.nombre)}</b><br />${limpio(item.id)}</span>
        <span class="campo">${Number(item.precio).toLocaleString("es-UY")} Leyendas</span>
        <span class="campo">orden ${Number(item.orden ?? 0)}</span>
        <span class="campo">${item.activo === false ? "🚫 apagado" : "✅ a la venta"}</span>
        <button class="btn sobrio chico" data-editar="${limpio(item.id)}" type="button">Editar</button>
        <button class="btn sobrio chico" data-activar="${limpio(item.id)}"
                data-a="${item.activo === false ? "1" : "0"}" type="button">
          ${item.activo === false ? "Encender" : "Apagar"}
        </button>
        <button class="btn peligro chico" data-borrar="${limpio(item.id)}" type="button">Borrar</button>
      </div>`;
    })
    .join("");
}

// ---------------------------------------------------------- el formulario

/** Vacía el formulario y lo deja listo para crear uno nuevo. */
function limpiarFormulario() {
  $("itemId").value = "";
  $("itemId").disabled = false;
  $("itemTipo").value = TIPOS_VALIDOS[0];
  $("itemNombre").value = "";
  $("itemDescripcion").value = "";
  $("itemPrecio").value = "0";
  $("itemImagen").value = "";
  $("itemOrden").value = "0";
  $("itemActivo").checked = true;
  decir($("avisoItem"), "");
}

/**
 * Carga un artículo en el formulario para editarlo.
 *
 * El id queda BLOQUEADO. Cambiarlo no sería editar: sería crear otro artículo
 * y dejar el viejo donde estaba, con la gente que lo compró apuntando al que
 * quedó huérfano. Para tener otro id, se crea otro.
 */
function editar(id) {
  const item = catalogo.find((i) => i.id === id);
  if (!item) return;

  $("itemId").value = item.id;
  $("itemId").disabled = true;
  $("itemTipo").value = item.tipo;
  $("itemNombre").value = item.nombre ?? "";
  $("itemDescripcion").value = item.descripcion ?? "";
  $("itemPrecio").value = String(item.precio ?? 0);
  $("itemImagen").value = item.imagen ?? "";
  $("itemOrden").value = String(item.orden ?? 0);
  $("itemActivo").checked = item.activo !== false;

  decir($("avisoItem"), `Editando «${item.nombre}». El id no se puede cambiar.`);
  $("itemNombre").focus();
}

const delFormulario = () => ({
  id: $("itemId").value.trim(),
  tipo: $("itemTipo").value,
  nombre: $("itemNombre").value.trim(),
  descripcion: $("itemDescripcion").value.trim(),
  precio: Number($("itemPrecio").value),
  imagen: $("itemImagen").value.trim(),
  orden: Number($("itemOrden").value),
  activo: $("itemActivo").checked,
});

// ------------------------------------------------------------- acciones

async function refrescar() {
  decir($("avisoCatalogoLista"), "Cargando…");
  try {
    const { data } = await listarCatalogo();
    catalogo = data.items ?? [];
    dibujarLista();
    decir(
      $("avisoCatalogoLista"),
      `${catalogo.length} artículo${catalogo.length === 1 ? "" : "s"} en el catálogo.`,
      "bien",
    );
  } catch (error) {
    decir($("avisoCatalogoLista"), error?.message ?? "No se pudo leer el catálogo.", "mal");
  }
}

async function guardar() {
  const item = delFormulario();

  // Se valida con el MISMO módulo que usa el servidor: `catalogo.js` viaja a
  // los dos lados. Así lo que se rechaza acá es exactamente lo que se
  // rechazaría allá, y el administrador se entera antes de mandar.
  const problemas = problemasDelItem(item);
  if (problemas.length) {
    decir($("avisoItem"), problemas.join(" "), "mal");
    return;
  }

  $("btnGuardarItem").disabled = true;
  decir($("avisoItem"), "Guardando…");
  try {
    const { data } = await guardarItem(item);
    decir(
      $("avisoItem"),
      data.creado ? `Creado «${item.nombre}».` : `Actualizado «${item.nombre}».`,
      "bien",
    );
    limpiarFormulario();
    await refrescar();
  } catch (error) {
    decir($("avisoItem"), error?.message ?? "No se pudo guardar.", "mal");
  } finally {
    $("btnGuardarItem").disabled = false;
  }
}

async function alternar(id, encender) {
  try {
    await activarItem({ itemId: id, activo: encender });
    await refrescar();
  } catch (error) {
    decir($("avisoCatalogoLista"), error?.message ?? "No se pudo cambiar el estado.", "mal");
  }
}

/**
 * Borrar pregunta dos veces: acá y en el servidor.
 *
 * Acá porque es la única operación de esta pantalla que destruye algo, y el
 * botón está al lado de "Apagar", que es lo que casi siempre se quiere. Y en
 * el servidor porque una confirmación del navegador no protege nada: ahí se
 * comprueba que nadie lo haya comprado, que es lo que de verdad importa.
 */
async function borrar(id) {
  const item = catalogo.find((i) => i.id === id);
  if (!confirm(`¿Borrar «${item?.nombre ?? id}» del catálogo?\n\nSi alguien ya lo compró, el servidor lo va a rechazar: en ese caso apagalo en vez de borrarlo.`)) {
    return;
  }

  try {
    await borrarItem({ itemId: id });
    decir($("avisoCatalogoLista"), `Borrado «${item?.nombre ?? id}».`, "bien");
    await refrescar();
  } catch (error) {
    decir($("avisoCatalogoLista"), error?.message ?? "No se pudo borrar.", "mal");
  }
}

// ------------------------------------- limpiar el catálogo de demostración

/**
 * Apaga los artículos que quedaron del catálogo de mentira, en dos pasos.
 *
 * El primer toque SIMULA: le pregunta al servidor cuáles apagaría y los nombra
 * sin tocar nada. El segundo apaga. Es la misma llamada con una bandera
 * distinta, así que la lista que se ve es exactamente la que se va a apagar —
 * no una segunda consulta que podría contestar otra cosa.
 *
 * Dos pasos y no uno porque un botón que apaga diez artículos sin decir cuáles
 * es un botón que nadie se anima a tocar.
 */
let viejosPorApagar = null;

async function limpiarViejos() {
  const boton = $("btnVerViejos");
  boton.disabled = true;

  try {
    if (!viejosPorApagar) {
      const { data } = await apagarViejos({ simular: true });
      viejosPorApagar = data.candidatos ?? [];

      if (!viejosPorApagar.length) {
        decir($("avisoCatalogoLista"), "No quedan artículos de demostración.", "bien");
        return;
      }

      $("notaViejos").hidden = false;
      decir(
        $("avisoCatalogoLista"),
        `${viejosPorApagar.length} para apagar: ` +
          viejosPorApagar.map((c) => `${c.nombre} (${c.imagen})`).join(", ") +
          ". Tocá de nuevo para apagarlos.",
      );
      boton.textContent = `Apagar esos ${viejosPorApagar.length}`;
      return;
    }

    const { data } = await apagarViejos();
    decir($("avisoCatalogoLista"), `Listo: ${data.apagados} apagados.`, "bien");
    viejosPorApagar = null;
    boton.textContent = "Buscar artículos de demostración";
    $("notaViejos").hidden = true;
    await refrescar();
  } catch (error) {
    decir($("avisoCatalogoLista"), error?.message ?? "No se pudo.", "mal");
  } finally {
    boton.disabled = false;
  }
}

// ------------------------------------------------------------- arranque

/**
 * Engancha la sección. La llama `admin.js` cuando la sesión ya es de
 * administrador: antes no tiene sentido, porque las cuatro llamadas fallarían.
 */
export function montarTiendaAdmin() {
  if (!$("listaCatalogo")) return;

  // El desplegable de tipos sale de las reglas: agregar un tipo nuevo no
  // debería obligar a acordarse de tocar este HTML.
  $("itemTipo").innerHTML = TIPOS_VALIDOS.map(
    (t) => `<option value="${t}">${t}</option>`,
  ).join("");

  $("btnGuardarItem").addEventListener("click", guardar);
  $("btnNuevoItem").addEventListener("click", limpiarFormulario);
  $("btnRefrescarCatalogo").addEventListener("click", refrescar);
  $("btnVerViejos")?.addEventListener("click", limpiarViejos);

  // Delegación: la lista se repinta entera en cada operación, así que
  // enganchar botón por botón dejaría escuchadores muertos en cada vuelta.
  $("listaCatalogo").addEventListener("click", (evento) => {
    const boton = evento.target.closest("button");
    if (!boton) return;
    if (boton.dataset.editar) editar(boton.dataset.editar);
    else if (boton.dataset.activar) alternar(boton.dataset.activar, boton.dataset.a === "1");
    else if (boton.dataset.borrar) borrar(boton.dataset.borrar);
  });

  refrescar();
}
