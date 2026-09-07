/**
 * La vitrina de logros del panel: qué insignias se ganaron y cuánto falta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO NO ESTÁ EN LA TIENDA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque una insignia no se compra. Ponerla entre los avatares con un precio
 * al lado le enseña al jugador que las seis se consiguen igual, y después hay
 * que desenseñárselo. Acá no hay botón de comprar: hay una condición, un
 * progreso y —cuando está cumplida— un botón para ponérsela.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LAS SEIS SE MUESTRAN SIEMPRE, GANADAS O NO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Mostrar sólo las conseguidas deja la vitrina vacía justo cuando más falta
 * hace que no lo esté: al principio. Las que faltan van apagadas y con su
 * condición escrita, que es la única forma de que "ganar 50 partidas" sea una
 * meta y no una sorpresa.
 *
 * El progreso lo calcula `reglas/insignias.js`, el MISMO módulo con el que el
 * servidor decide otorgar. Si acá se calculara aparte, la barra podría llegar
 * al final sin que llegara la insignia, y no habría forma de saber cuál de
 * los dos miente.
 */

import { misInsignias, equiparItem, desequiparItem, ErrorDeServidor } from "./servidor.js";
import { db, collection, getDocs, query, orderBy } from "./firebase.js";
import { COLECCION_CATALOGO, TIPOS, imagenEsArchivo } from "./reglas/catalogo.js";
import { CONDICIONES, cumple, progreso } from "./reglas/insignias.js";

const $ = (id) => document.getElementById(id);

const escapar = (t) =>
  String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Lo último que dijo el servidor. Se guarda para no volver a pedirlo por clic. */
let insigniasDelCatalogo = new Map();
let tengo = new Set();
let equipada = null;
let estadisticas = {};

function avisar(texto, esError = false) {
  const caja = $("avisoLogros");
  if (!caja) return;
  caja.textContent = texto ?? "";
  caja.classList.toggle("error", Boolean(esError));
}

/**
 * La figura de una insignia.
 *
 * El catálogo puede traer una ruta o un emoji —el panel deja escribir el campo
 * a mano—, y un emoji dentro de un `src` no es una imagen rota: es un pedido a
 * una URL que no existe.
 */
function dibujarFigura(item) {
  if (!item) return '<span class="figura-logro glifo" aria-hidden="true">🏅</span>';
  if (imagenEsArchivo(item.imagen)) {
    return `<img class="figura-logro" src="${escapar(item.imagen)}" alt="" loading="lazy" />`;
  }
  return `<span class="figura-logro glifo" aria-hidden="true">${escapar(item.imagen)}</span>`;
}

function dibujarTarjeta(condicion) {
  const item = insigniasDelCatalogo.get(condicion.id);
  const ganada = tengo.has(condicion.id);
  const puesta = equipada === condicion.id;

  // `cumple` y `ganada` no son lo mismo, y la diferencia importa: se cumple la
  // condición al terminar la partida, y se otorga un instante después. En ese
  // hueco la tarjeta dice "ya casi", que es verdad, en vez de mentir en
  // cualquiera de las dos direcciones.
  const alcanzada = cumple(condicion, estadisticas);
  const avance = progreso(condicion, estadisticas);

  const boton = ganada
    ? puesta
      ? `<button class="accion sobria" type="button" data-sacar="${escapar(condicion.id)}">Sacármela</button>`
      : `<button class="accion" type="button" data-poner="${escapar(condicion.id)}">Ponérmela</button>`
    : "";

  const barra =
    !ganada && typeof condicion.minimo === "number"
      ? `<div class="barra-logro" role="img"
              aria-label="Progreso: ${Math.round(avance * 100)} por ciento">
           <i style="width: ${Math.round(avance * 100)}%"></i>
         </div>`
      : "";

  return `
    <article class="logro ${ganada ? "ganado" : "pendiente"} ${puesta ? "puesto" : ""}">
      ${puesta ? '<span class="cinta-item">En uso</span>' : ""}
      ${dibujarFigura(item)}
      <h3>${escapar(item?.nombre ?? condicion.id)}</h3>
      <p class="condicion-logro">${escapar(condicion.texto)}</p>
      ${barra}
      <div class="estado-logro">${
        ganada ? "Conseguida" : alcanzada ? "Ya casi: se otorga al terminar tu próxima partida" : "Pendiente"
      }</div>
      ${boton}
    </article>`;
}

function dibujar() {
  const caja = $("rejillaLogros");
  if (!caja) return;
  caja.innerHTML = CONDICIONES.map(dibujarTarjeta).join("");
}

/** Poner o sacar. Las dos recargan lo mismo, así que comparten el camino. */
async function cambiar(boton, accion) {
  const textoPrevio = boton.textContent;
  boton.disabled = true;
  boton.textContent = "…";
  avisar("");

  try {
    await accion();
    await cargarLoMio();
    dibujar();
  } catch (e) {
    boton.disabled = false;
    boton.textContent = textoPrevio;
    avisar(
      e instanceof ErrorDeServidor ? e.message : "No se pudo. Probá de nuevo en un momento.",
      true,
    );
  }
}

async function cargarLoMio() {
  const r = await misInsignias();
  tengo = new Set(r.tengo ?? []);
  equipada = r.equipada ?? null;
  estadisticas = r.estadisticas ?? {};
}

async function cargarCatalogo() {
  const snap = await getDocs(query(collection(db, COLECCION_CATALOGO), orderBy("orden")));
  insigniasDelCatalogo = new Map(
    snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((i) => i.tipo === TIPOS.INSIGNIA)
      .map((i) => [i.id, i]),
  );
}

/**
 * Arranca la vitrina. La llama `dashboard.js` cuando ya hay sesión.
 *
 * Si algo falla, la sección se queda oculta y el panel sigue funcionando. Una
 * vitrina de logros rota no es motivo para que alguien no pueda entrar a
 * jugar.
 */
export async function montarLogros() {
  const seccion = $("vitrinaLogros");
  if (!seccion) return;

  try {
    await Promise.all([cargarCatalogo(), cargarLoMio()]);
  } catch {
    return;
  }

  seccion.hidden = false;
  dibujar();

  // Un solo escuchador en el contenedor: las tarjetas se redibujan enteras en
  // cada cambio, y volver a colgar seis escuchadores cada vez es cómo se
  // duplican los clics.
  $("rejillaLogros")?.addEventListener("click", (e) => {
    const poner = e.target.closest("[data-poner]");
    if (poner) return cambiar(poner, () => equiparItem(poner.dataset.poner));

    const sacar = e.target.closest("[data-sacar]");
    if (sacar) return cambiar(sacar, () => desequiparItem(TIPOS.INSIGNIA));
  });
}
