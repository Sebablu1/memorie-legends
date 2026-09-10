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
import {
  TIPOS_VALIDOS,
  TIPOS_VENDIBLES,
  esVendible,
  problemasDelItem,
  imagenEsArchivo,
  ETIQUETA_TIPO,
} from "../js/reglas/catalogo.js";

/**
 * Lo que se vende y lo que se gana, separados.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO ALCANZA CON ORDENAR LA LISTA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Mezcladas, las insignias se leían como productos apagados: la fila decía
 * «🚫 apagado» y ofrecía «Encender», que en un artículo de venta significa
 * ponerlo a la venta. Un administrador nuevo las enciende creyendo que
 * están mal, y lo que hace en realidad es marcar el logro como disponible
 * — otra cosa, con el mismo botón.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * VENDIBLE ES POR TIPO, NO POR PRECIO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Cuatro artículos que sí se venden cuestan CERO: el avatar predeterminado,
 * el dorso azul, el paño de piedra y el mazo azul, que son los que le tocan
 * a toda cuenta nueva. Separar por precio los mandaría al lado equivocado.
 * Lo que decide es `TIPOS_VENDIBLES`, que es lo mismo que mira el servidor.
 */
const GRUPOS_DEL_CATALOGO = [
  {
    titulo: "Vendibles",
    tipos: TIPOS_VENDIBLES,
    nota: "Se compran con Leyendas. El precio tiene que caer en la escala de su tipo.",
  },
  {
    titulo: "No vendibles (logros)",
    tipos: TIPOS_VALIDOS.filter((t) => !esVendible(t)),
    nota: "Las insignias son logros. No se venden: las otorga el servidor al cerrar una partida o un período de ranking. Su precio es siempre 0.",
  },
];

const $ = (id) => document.getElementById(id);

const listarCatalogo = httpsCallable(funciones, "listarCatalogoAdmin");
const guardarItem = httpsCallable(funciones, "guardarItemAdmin");
const activarItem = httpsCallable(funciones, "activarItemAdmin");
const borrarItem = httpsCallable(funciones, "borrarItemAdmin");
const apagarViejos = httpsCallable(funciones, "apagarCatalogoViejoAdmin");
const listarPoseedores = httpsCallable(funciones, "listarPoseedoresItemAdmin");
const desposeerItem = httpsCallable(funciones, "desposeerItemAdmin");
const forzarBorrar = httpsCallable(funciones, "forzarBorrarItemAdmin");

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

  caja.innerHTML = GRUPOS_DEL_CATALOGO.map((grupo) => dibujarGrupo(grupo, catalogo)).join("");
}

/** Un grupo del catálogo, con sus tipos adentro y su cuenta. */
function dibujarGrupo(grupo, catalogo) {
  const delGrupo = catalogo.filter((i) => grupo.tipos.includes(i.tipo));
  const vende = grupo.tipos.some((t) => esVendible(t));

  const porTipo = grupo.tipos
    .map((tipo) => {
      const items = catalogo.filter((i) => i.tipo === tipo);
      if (!items.length) return "";
      const nombre = ETIQUETA_TIPO[tipo]?.tienda ?? tipo;
      return `
        <h4 class="titulo-tipo">${limpio(nombre)} <span class="cuenta">(${items.length})</span></h4>
        ${items.map((i) => dibujarFila(i, vende)).join("")}`;
    })
    .join("");

  return `
    <section class="grupo-catalogo ${vende ? "" : "no-vendible"}">
      <h3>${limpio(grupo.titulo)} <span class="cuenta">(${delGrupo.length})</span></h3>
      <p class="nota">${limpio(grupo.nota)}</p>
      ${porTipo || '<p class="nota">Nada de este grupo en el catálogo.</p>'}
    </section>`;
}

/**
 * Una fila del catálogo.
 *
 * `vende` cambia lo que se DICE, no lo que se puede hacer. Un logro se
 * apaga y se enciende igual que un producto —es el mismo campo `activo`—
 * pero apagar un producto es sacarlo de la venta y apagar un logro es
 * dejar de ofrecerlo. Con las mismas palabras para las dos cosas, un
 * administrador nuevo enciende una insignia creyendo que la arregla.
 */
function dibujarFila(item, vende) {
  const figura = imagenEsArchivo(item.imagen)
    ? `<img src="${limpio(item.imagen)}" alt="" style="width:34px;height:34px;object-fit:contain;border-radius:8px" />`
    : `<span style="font-size:1.6rem;line-height:1">${limpio(item.imagen)}</span>`;

  const apagado = item.activo === false;
  const estado = vende
    ? (apagado ? "🚫 apagado" : "✅ a la venta")
    : (apagado ? "🚫 no disponible" : "🏅 disponible");

  // Un logro no tiene precio, y mostrar «0 Leyendas» al lado invita a
  // pensar que es un producto gratis. No lo es: no está en venta.
  const precio = vende
    ? `${Number(item.precio).toLocaleString("es-UY")} Leyendas`
    : "se gana jugando";

  return `
    <div class="fila ${apagado ? "apagada" : ""}">
      ${figura}
      <span class="codigo">${limpio(item.tipo)}</span>
      <span class="campo"><b>${limpio(item.nombre)}</b><br />${limpio(item.id)}</span>
      <span class="campo">${precio}</span>
      <span class="campo">orden ${Number(item.orden ?? 0)}</span>
      <span class="campo">${estado}</span>
      <button class="btn sobrio chico" data-editar="${limpio(item.id)}" type="button">Editar</button>
      <button class="btn sobrio chico" data-activar="${limpio(item.id)}"
              data-a="${apagado ? "1" : "0"}" type="button">
        ${apagado ? (vende ? "Encender" : "Ofrecer") : (vende ? "Apagar" : "Retirar")}
      </button>
      <button class="btn sobrio chico" data-quien="${limpio(item.id)}" type="button">Quién lo tiene</button>
      <button class="btn peligro chico" data-borrar="${limpio(item.id)}" type="button">Borrar</button>
    </div>`;
}

// ---------------------------------------------------------- el formulario

/**
 * Acomoda el formulario a lo que el tipo elegido permite.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ESTO NO ES LO QUE IMPIDE NADA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Bloquear un campo es una cortesía: avisa antes de que alguien escriba un
 * número que va a ser rechazado. Quien abra la consola manda el objeto que
 * quiera. Lo que de verdad impide guardar una insignia con precio es
 * `problemasDelItem`, que corre acá para avisar y DENTRO de `guardarItem`
 * para decidir.
 *
 * Es la misma división que el resto del panel: la pantalla explica, el
 * servidor manda.
 */
function ajustarFormularioAlTipo() {
  const tipo = $("itemTipo").value;
  const vende = esVendible(tipo);

  const precio = $("itemPrecio");
  precio.disabled = !vende;
  if (!vende) precio.value = "0";

  const aviso = $("avisoNoVendible");
  if (aviso) aviso.hidden = vende;

  // El campo no se esconde: se explica. Un logro también se ofrece y se
  // retira —es el mismo `activo`— y esconder la casilla dejaría al
  // administrador sin poder sacar una insignia de circulación.
  const etiqueta = $("etiquetaActivo");
  if (etiqueta) etiqueta.textContent = vende ? "A la venta" : "Logro disponible";
}

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
  ajustarFormularioAlTipo();
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
  ajustarFormularioAlTipo();

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
// ------------------------------------------------- quién tiene un artículo

/**
 * La lista de quienes compraron un artículo, debajo de su fila.
 *
 * Va en la lista y no en una ventana aparte a propósito: lo que se hace acá
 * es decidir si sacárselo a alguien, y esa decisión se toma mirando la fila
 * del artículo. Una ventana modal taparía justamente eso.
 *
 * El panel no guarda esta lista: cada vez que se abre se vuelve a pedir. Es
 * la consulta más cara que hay —recorre todas las compras— pero una lista
 * vieja acá haría que el administrador le quite algo a quien ya no lo tiene.
 */
async function verPoseedores(id) {
  const item = catalogo.find((i) => i.id === id);
  const caja = $(`poseedores-${id}`);

  // Segundo clic: se cierra. Es un desplegable, no una ventana.
  if (caja) {
    caja.remove();
    return;
  }

  const fila = $("listaCatalogo").querySelector(`[data-quien="${CSS.escape(id)}"]`)?.closest(".fila");
  if (!fila) return;

  const panel = document.createElement("div");
  panel.id = `poseedores-${id}`;
  panel.className = "poseedores";
  panel.innerHTML = '<p class="nota">Buscando…</p>';
  fila.after(panel);

  try {
    const { data } = await listarPoseedores({ itemId: id });
    const gente = data?.poseedores ?? [];

    if (!gente.length) {
      panel.innerHTML = '<p class="nota">No lo tiene nadie. Se puede borrar con el botón de al lado.</p>';
      return;
    }

    panel.innerHTML = `
      <p class="nota">Lo tienen ${gente.length} jugador${gente.length === 1 ? "" : "es"}.
         Quitárselo les devuelve lo que pagaron.</p>
      ${gente
        .map(
          (p) => `
        <div class="fila chica">
          <span class="campo"><b>${limpio(p.username ?? "(sin nombre)")}</b><br />${limpio(p.email ?? p.uid)}</span>
          <span class="campo">${Number(p.precioPagado ?? 0).toLocaleString("es-UY")} Leyendas</span>
          <span class="campo">${p.equipado ? "lo lleva puesto" : ""}</span>
          <button class="btn peligro chico" data-quitar="${limpio(id)}"
                  data-a="${limpio(p.uid)}" type="button">Quitárselo</button>
        </div>`,
        )
        .join("")}
      <button class="btn peligro chico" data-forzar="${limpio(id)}" type="button">
        ⚠️ Sacárselo a todos y borrar «${limpio(item?.nombre ?? id)}»
      </button>`;
  } catch (error) {
    panel.innerHTML = `<p class="nota mal">${limpio(error?.message ?? "No se pudo consultar.")}</p>`;
  }
}

/** Le saca el artículo a una persona. */
async function quitar(id, uid) {
  const item = catalogo.find((i) => i.id === id);
  if (!confirm(
    `¿Quitarle «${item?.nombre ?? id}» a este jugador?\n\n` +
      "Se le devuelven las Leyendas que pagó y, si lo tenía puesto, se lo saca.",
  )) return;

  try {
    const { data } = await desposeerItem({ itemId: id, uid });
    decir(
      $("avisoCatalogoLista"),
      data?.yaEstaba
        ? "Ese jugador ya no lo tenía."
        : `Se lo quitaste. Le devolvimos ${Number(data?.devueltas ?? 0).toLocaleString("es-UY")} Leyendas.`,
      "bien",
    );
    $(`poseedores-${id}`)?.remove();
    await verPoseedores(id);
  } catch (error) {
    decir($("avisoCatalogoLista"), error?.message ?? "No se pudo quitar.", "mal");
  }
}

/**
 * Se lo saca a todos y lo borra.
 *
 * Dos confirmaciones y la segunda pide escribir el id. Es la única operación
 * del panel que le quita algo a gente que no está mirando, y un `confirm` se
 * acepta sin leerlo — escribir el nombre obliga a mirar cuál se está
 * borrando.
 */
async function forzar(id) {
  const item = catalogo.find((i) => i.id === id);
  const nombre = item?.nombre ?? id;

  if (!confirm(
    `⚠️ Esto le saca «${nombre}» a TODOS los que lo compraron y después lo borra ` +
      "del catálogo.\n\nA cada uno se le devuelven las Leyendas que pagó. No se puede deshacer.",
  )) return;

  const escrito = prompt(`Para confirmar, escribí el id del artículo:\n\n${id}`);
  if (escrito?.trim() !== id) {
    decir($("avisoCatalogoLista"), "No se borró: el id no coincide.", "mal");
    return;
  }

  try {
    const { data } = await forzarBorrar({ itemId: id });
    await refrescar();
    decir(
      $("avisoCatalogoLista"),
      `Borrado «${nombre}». Se lo quitamos a ${data?.quitadoA ?? 0} y devolvimos ` +
        `${Number(data?.devueltasEnTotal ?? 0).toLocaleString("es-UY")} Leyendas.`,
      "bien",
    );
  } catch (error) {
    decir($("avisoCatalogoLista"), error?.message ?? "No se pudo borrar.", "mal");
  }
}

async function borrar(id) {
  const item = catalogo.find((i) => i.id === id);
  if (!confirm(`¿Borrar «${item?.nombre ?? id}» del catálogo?\n\nSi alguien ya lo compró, el servidor lo va a rechazar: en ese caso apagalo en vez de borrarlo.`)) {
    return;
  }

  try {
    await borrarItem({ itemId: id });
    await refrescar();
    decir($("avisoCatalogoLista"), `Borrado «${item?.nombre ?? id}».`, "bien");
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

  // El formulario se ajusta al tipo elegido en cuanto se elige, no al
  // guardar: enterarse de que una insignia no lleva precio DESPUÉS de
  // escribirlo es enterarse tarde.
  $("itemTipo").addEventListener("change", ajustarFormularioAlTipo);
  ajustarFormularioAlTipo();

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
    else if (boton.dataset.quien) verPoseedores(boton.dataset.quien);
    else if (boton.dataset.quitar) quitar(boton.dataset.quitar, boton.dataset.a);
    else if (boton.dataset.forzar) forzar(boton.dataset.forzar);
  });

  refrescar();
}
