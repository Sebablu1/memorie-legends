/**
 * Mi inventario: lo que tengo, y qué me pongo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACÍA FALTA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque hasta ahora un avatar o un dorso se podían poner pero no SACAR. La
 * tienda equipa, y como el perfil guarda un id por tipo, ponerse otro pisa el
 * anterior — pero «ninguno» no es un artículo que se pueda elegir. Quien se
 * probaba un avatar quedaba con uno puesto para siempre.
 *
 * Las insignias ya tenían las dos mitades en la vitrina de logros, que además
 * muestra las que faltan y cuánto falta para cada una. Por eso acá NO se
 * repiten: dos listas de lo mismo en la misma página no le sirven a nadie.
 * Este inventario es de lo que se compra; aquélla, de lo que se gana.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL CATÁLOGO SE LEE DE FIRESTORE, NO DE LA SEMILLA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `misItems` devuelve qué IDs tiene el jugador; el nombre, la imagen y la
 * rareza salen del catálogo vivo. Leerlos de `CATALOGO_INICIAL` mostraría el
 * nombre y el precio de fábrica aunque el panel los haya cambiado, que es
 * justamente lo que el catálogo en Firestore vino a evitar.
 */

import { misItems, equiparItem, desequiparItem, ErrorDeServidor } from "./servidor.js";
import { db, collection, getDocs, query, orderBy } from "./firebase.js";
import { COLECCION_CATALOGO, TIPOS, imagenEsArchivo } from "./reglas/catalogo.js";
import { pintarAvatarCabecera } from "./equipado.js";

const $ = (id) => document.getElementById(id);

const escapar = (t) =>
  String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/**
 * Los grupos del inventario, en orden.
 *
 * Las insignias no están: viven en la vitrina de logros, que ya las equipa y
 * las desequipa. Ver la nota de la cabecera.
 */
const GRUPOS = [
  { tipo: TIPOS.AVATAR, titulo: "Mis avatares", vacio: "Todavía no tenés ningún avatar." },
  { tipo: TIPOS.DORSO, titulo: "Mis dorsos", vacio: "Todavía no tenés ningún dorso." },
  { tipo: TIPOS.FONDO, titulo: "Mis paños de mesa", vacio: "Todavía no tenés ningún paño." },
  { tipo: TIPOS.MAZO, titulo: "Mis mazos", vacio: "Todavía no tenés ningún mazo." },
];

/**
 * Cómo se dice cada rareza, y de qué color.
 *
 * El color va acá y no en el CSS porque la rareza viene del catálogo, que se
 * edita desde el panel: una clase por rareza obligaría a tocar la hoja de
 * estilos cada vez que se invente una. Una rareza desconocida cae al color
 * neutro en vez de quedar sin estilo.
 */
const RAREZAS = {
  inicial: { nombre: "Inicial", color: "#9aa4b2" },
  comun: { nombre: "Común", color: "#9aa4b2" },
  poco_comun: { nombre: "Poco común", color: "#5fb37a" },
  raro: { nombre: "Raro", color: "#4a90d9" },
  epico: { nombre: "Épico", color: "#a367d4" },
  legendario: { nombre: "Legendario", color: "#d4a843" },
};

const rarezaDe = (item) =>
  RAREZAS[item?.metadata?.rareza] ?? { nombre: "", color: "#9aa4b2" };

/** Estado de la pantalla, para no volver a pedir todo en cada clic. */
let catalogo = new Map();
let tengo = [];
let equipado = {};

/**
 * La foto de Google, para cuando el jugador se saca el avatar.
 *
 * La entrega `dashboard.js`, que ya pidió la sesión. Pedirla de nuevo acá
 * serían dos lecturas del perfil en la misma carga y, peor, dos respuestas que
 * pueden diferir por un instante.
 */
let fotoDeGoogle = null;

function avisar(texto, esError = false) {
  const caja = $("avisoInventario");
  if (!caja) return;
  caja.textContent = texto ?? "";
  caja.classList.toggle("error", Boolean(esError));
}

/**
 * La figura de un artículo.
 *
 * El catálogo puede traer una ruta o un emoji —el panel deja escribir el campo
 * a mano—, y un emoji dentro de un `src` no es una imagen rota: es un pedido a
 * una URL que no existe.
 */
function dibujarFigura(item) {
  if (imagenEsArchivo(item?.imagen)) {
    return `<img class="figura-inv" src="${escapar(item.imagen)}" alt="" loading="lazy" />`;
  }
  return `<span class="figura-inv glifo" aria-hidden="true">${escapar(item?.imagen ?? "🎭")}</span>`;
}

function dibujarItem(id, tipo) {
  const item = catalogo.get(id);
  const nombre = item?.nombre ?? id;
  const puesto = equipado[tipo] === id;
  const rareza = rarezaDe(item);

  return `
    <article class="item-inv ${puesto ? "puesto" : ""}">
      ${dibujarFigura(item)}
      <h3>${escapar(nombre)}</h3>
      ${
        rareza.nombre
          ? `<span class="rareza" style="color: ${rareza.color}; border-color: ${rareza.color}44">${rareza.nombre}</span>`
          : ""
      }
      ${item?.descripcion ? `<p class="desc-inv">${escapar(item.descripcion)}</p>` : ""}
      <div class="estado-inv">${puesto ? "✅ Equipado" : "📦 Sin equipar"}</div>
      ${
        puesto
          ? `<button class="accion sobria" type="button" data-sacar="${escapar(tipo)}">Desequipar</button>`
          : `<button class="accion" type="button" data-poner="${escapar(id)}">Equipar</button>`
      }
    </article>`;
}

function dibujar() {
  const caja = $("rejillaInventario");
  if (!caja) return;

  const partes = [];
  for (const grupo of GRUPOS) {
    const mios = tengo.filter((i) => i.tipo === grupo.tipo).map((i) => i.id);
    partes.push(`
      <div class="grupo-inv">
        <h3 class="titulo-grupo">${escapar(grupo.titulo)}</h3>
        ${
          mios.length
            ? `<div class="rejilla-inv">${mios.map((id) => dibujarItem(id, grupo.tipo)).join("")}</div>`
            : `<p class="vacio-inv">${escapar(grupo.vacio)}</p>`
        }
      </div>`);
  }

  caja.innerHTML = partes.join("");
}

/**
 * Poner y sacar comparten forma: apagar el botón, pedir, repintar.
 *
 * Apagarlo antes de pedir evita el doble clic desde la interfaz. No es la
 * defensa de verdad —el servidor comprueba la posesión— pero es la que hace
 * que el caso normal no llegue nunca a necesitarla.
 */
async function cambiar(boton, trabajo) {
  const textoPrevio = boton.textContent;
  boton.disabled = true;
  boton.textContent = "…";
  avisar("");

  try {
    await trabajo();
    await cargarLoMio();
    dibujar();
    sincronizarCabecera();
  } catch (e) {
    boton.disabled = false;
    boton.textContent = textoPrevio;
    avisar(
      e instanceof ErrorDeServidor ? e.message : "No se pudo. Probá de nuevo en un momento.",
      true,
    );
  }
}

/**
 * La cabecera tiene que reflejar el cambio sin recargar la página.
 *
 * Si no, el jugador se pone un avatar, lo ve marcado como equipado en la
 * tarjeta y arriba sigue el anterior. Dos respuestas distintas a la misma
 * pregunta en la misma pantalla.
 */
function sincronizarCabecera() {
  // `equipado` es el ID del artículo, no su imagen: `pintarAvatarCabecera` lee
  // el artículo del catálogo por su cuenta. Y cuando es `null` vuelve a poner
  // la foto de Google, que es exactamente lo que tiene que pasar al sacarse el
  // avatar.
  pintarAvatarCabecera({
    equipado: equipado[TIPOS.AVATAR] ?? null,
    foto: fotoDeGoogle,
  });
}

async function cargarLoMio() {
  const r = await misItems();
  tengo = r.tengo ?? [];
  equipado = r.equipado ?? {};
}

async function cargarCatalogo() {
  const snap = await getDocs(query(collection(db, COLECCION_CATALOGO), orderBy("orden")));
  catalogo = new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
}

/**
 * Arranca el inventario. Lo llama `dashboard.js` cuando ya hay sesión.
 *
 * Si algo falla, la sección se queda oculta y el panel sigue funcionando. Un
 * inventario roto no es motivo para que alguien no pueda entrar a jugar.
 */
export async function montarInventario({ foto = null } = {}) {
  const seccion = $("miInventario");
  if (!seccion) return;

  fotoDeGoogle = foto;

  try {
    await Promise.all([cargarCatalogo(), cargarLoMio()]);
  } catch {
    return;
  }

  // Sin nada comprado no se muestra: una sección que dice «no tenés nada»
  // ocupa el mismo lugar que una con cosas y enseña a no mirarla.
  const hayAlgo = tengo.some((i) => GRUPOS.some((g) => g.tipo === i.tipo));
  if (!hayAlgo) return;

  seccion.hidden = false;
  dibujar();

  // Un solo escuchador en el contenedor: las tarjetas se redibujan enteras en
  // cada cambio, y volver a colgar escuchadores cada vez es cómo se duplican
  // los clics.
  $("rejillaInventario")?.addEventListener("click", (e) => {
    const poner = e.target.closest("[data-poner]");
    if (poner) return cambiar(poner, () => equiparItem(poner.dataset.poner));

    const sacar = e.target.closest("[data-sacar]");
    if (sacar) return cambiar(sacar, () => desequiparItem(sacar.dataset.sacar));
  });
}
