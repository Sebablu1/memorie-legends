/**
 * La sección de personalización de la tienda.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL CATÁLOGO SE LEE DE FIRESTORE, NO DEL ARCHIVO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `reglas/catalogo.js` tiene una constante `CATALOGO_INICIAL`, y sería cómodo
 * pintar la tienda con ella. Sería un error: esa constante es la SEMILLA con
 * la que se llena la colección la primera vez. Los precios de verdad —los que
 * el administrador cambia desde el panel, sin desplegar— viven en la colección
 * `catalogo`, y son los que el servidor cobra.
 *
 * Pintar la tienda con el archivo mostraría un precio y cobraría otro. De
 * `catalogo.js` se usan las FUNCIONES: qué tipos hay, cómo se ordenan, dónde
 * se guarda lo equipado.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE SE MUESTRA NO ES LO QUE DECIDE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El botón "Comprar" se apaga cuando no alcanza el saldo, y eso es una
 * cortesía: avisa antes de pedir. Quien lo encienda desde la consola va a
 * recibir el mismo "no te alcanza" del servidor, que es el que cuenta. Lo
 * mismo con "Equipar": la comprobación de que el artículo es tuyo la hace
 * `equiparItem`, acá sólo se dibuja.
 */

import { db, collection, getDocs, query, orderBy } from "./firebase.js";
import { escapar } from "./modulos/texto.js";
import { mostrarSaldo } from "./sesion.js";
import { comprarItem, equiparItem, misItems, ErrorDeServidor } from "./servidor.js";
import {
  TIPOS,
  itemsDeTipo,
  imagenEsArchivo,
  COLECCION_CATALOGO,
} from "./reglas/catalogo.js";

const $ = (id) => document.getElementById(id);

/**
 * Cómo se llama cada tipo en pantalla, y en qué orden aparecen.
 *
 * La lista es la que decide qué pestañas existen: agregar una categoría nueva
 * es agregar una línea acá, no una página. Las tres viven en la misma tienda a
 * propósito — son lo mismo con distinta forma, y separarlas en tres pantallas
 * obligaría a mantener tres copias del mismo circuito de compra.
 */
const CATEGORIAS = [
  { tipo: TIPOS.AVATAR, titulo: "Avatares", vacio: "Todavía no hay avatares a la venta." },
  { tipo: TIPOS.INSIGNIA, titulo: "Insignias", vacio: "Todavía no hay insignias a la venta." },
  { tipo: TIPOS.DORSO, titulo: "Dorsos", vacio: "Todavía no hay dorsos a la venta." },
];

/** Estado de la pantalla. Se guarda para no volver a pedir todo en cada clic. */
let catalogo = [];
let tengo = new Set();
let equipado = {};
let saldo = 0;
let categoriaActual = CATEGORIAS[0].tipo;

// ------------------------------------------------------------------ datos

/** El catálogo tal como está en el servidor, ordenado como se muestra. */
async function leerCatalogo() {
  // `orderBy("orden")` de entrada, y `ordenarItems` después para el desempate
  // alfabético: Firestore no sabe ordenar por dos criterios sin un índice, y
  // no vale la pena crear uno para una colección de veinte documentos.
  const snap = await getDocs(query(collection(db, COLECCION_CATALOGO), orderBy("orden")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Qué compré y qué llevo puesto. Una sola llamada al servidor. */
async function leerLoMio() {
  const r = await misItems();
  tengo = new Set((r.tengo ?? []).map((i) => i.id));
  equipado = r.equipado ?? {};
}

// ----------------------------------------------------------------- pintar

const precioTexto = (n) => (n === 0 ? "Gratis" : `${n.toLocaleString("es-UY")} Leyendas`);

/**
 * La imagen de un artículo.
 *
 * El catálogo de demostración usa emojis para no inventar veinte PNG que
 * después habría que reemplazar; cuando el panel permita subir imágenes, el
 * campo va a traer una ruta. `imagenEsArchivo` distingue las dos formas sin
 * que haya que migrar nada.
 */
function dibujarImagen(item) {
  if (imagenEsArchivo(item.imagen)) {
    return `<img class="figura-item" src="${escapar(item.imagen)}" alt="" loading="lazy" />`;
  }
  return `<span class="figura-item glifo" aria-hidden="true">${escapar(item.imagen ?? "")}</span>`;
}

/**
 * El botón de cada artículo, que es donde vive todo el estado.
 *
 * Cuatro situaciones y ni una más: no lo tenés y te alcanza, no lo tenés y no
 * te alcanza, lo tenés, lo tenés puesto. Se decide acá y no en el CSS para que
 * el `disabled` y el texto no puedan decir cosas distintas.
 */
function dibujarBoton(item) {
  const puesto = equipado[item.tipo] === item.id;
  if (puesto) {
    return `<button class="accion sobria" type="button" disabled>✓ Equipado</button>`;
  }
  if (tengo.has(item.id)) {
    return `<button class="accion" type="button" data-equipar="${escapar(item.id)}">Equipar</button>`;
  }
  const alcanza = saldo >= Number(item.precio ?? 0);
  return `<button class="accion" type="button" data-comprar="${escapar(item.id)}"
            ${alcanza ? "" : "disabled"}>${alcanza ? "Comprar" : "No alcanza"}</button>`;
}

function dibujarItem(item) {
  const puesto = equipado[item.tipo] === item.id;
  return `
    <article class="item-tienda ${puesto ? "puesto" : ""} ${tengo.has(item.id) ? "mio" : ""}">
      ${puesto ? '<span class="cinta-item">En uso</span>' : ""}
      ${dibujarImagen(item)}
      <h3>${escapar(item.nombre ?? item.id)}</h3>
      <p class="descripcion-item">${escapar(item.descripcion ?? "")}</p>
      <div class="precio-item">${tengo.has(item.id) ? "Tuyo" : precioTexto(Number(item.precio ?? 0))}</div>
      ${dibujarBoton(item)}
    </article>`;
}

function dibujar() {
  const categoria = CATEGORIAS.find((c) => c.tipo === categoriaActual) ?? CATEGORIAS[0];
  const items = itemsDeTipo(catalogo, categoria.tipo);
  const caja = $("rejillaPersonalizacion");
  if (!caja) return;

  caja.innerHTML = items.length
    ? items.map(dibujarItem).join("")
    : `<div class="vacio"><span class="icono">🎭</span>${escapar(categoria.vacio)}</div>`;

  for (const boton of document.querySelectorAll("#pestanasPersonalizacion [data-categoria]")) {
    const activa = boton.dataset.categoria === categoriaActual;
    boton.classList.toggle("activa", activa);
    boton.setAttribute("aria-selected", String(activa));
  }
}

function avisar(texto, tipo = "info") {
  const caja = $("avisoPersonalizacion");
  if (!caja) return;
  caja.textContent = texto;
  caja.className = `aviso-tienda visible ${tipo}`;
}

// ---------------------------------------------------------------- acciones

/**
 * Comprar y equipar comparten forma: apagar el botón, pedir, repintar.
 *
 * Apagarlo antes de pedir es lo que evita la compra doble desde la interfaz.
 * No es la defensa de verdad —ésa está en el servidor, que rechaza la segunda
 * con "ya lo tenés"— pero es la que hace que el caso normal no llegue nunca a
 * necesitarla.
 */
async function conBotonApagado(boton, trabajo) {
  const textoPrevio = boton.textContent;
  boton.disabled = true;
  boton.textContent = "…";
  try {
    await trabajo();
  } catch (error) {
    const mensaje =
      error instanceof ErrorDeServidor ? error.message : "No pudimos completar la operación.";
    avisar(mensaje, "error");
    boton.disabled = false;
    boton.textContent = textoPrevio;
  }
}

async function comprar(itemId, boton) {
  await conBotonApagado(boton, async () => {
    const r = await comprarItem(itemId);

    // El saldo que se muestra es el que devolvió el servidor, no una resta
    // hecha acá. Si fueran dos cuentas distintas, tarde o temprano diferirían.
    if (typeof r.saldo === "number") {
      saldo = r.saldo;
      mostrarSaldo(saldo);
    }
    tengo.add(itemId);
    avisar("¡Comprado! Ya podés equiparlo.", "bien");
    dibujar();
  });
}

async function equipar(itemId, boton) {
  await conBotonApagado(boton, async () => {
    const r = await equiparItem(itemId);
    equipado[r.tipo] = itemId;
    avisar("Listo, te lo pusiste.", "bien");
    dibujar();
  });
}

// ------------------------------------------------------------------ arranque

/**
 * Arranca la sección.
 *
 * Recibe el saldo de quien ya pidió la sesión —`tienda.js` lo hace para pintar
 * los paquetes— para no pedir el perfil dos veces en la misma carga.
 */
export async function montarPersonalizacion({ saldoInicial = 0 } = {}) {
  const caja = $("rejillaPersonalizacion");
  if (!caja) return;

  saldo = saldoInicial;

  // Las pestañas se dibujan desde la lista: agregar una categoría es agregar
  // una línea en CATEGORIAS, no tocar el HTML.
  const pestanas = $("pestanasPersonalizacion");
  if (pestanas) {
    pestanas.innerHTML = CATEGORIAS.map(
      (c) => `<button type="button" role="tab" data-categoria="${c.tipo}"
                aria-selected="${c.tipo === categoriaActual}">${escapar(c.titulo)}</button>`,
    ).join("");
    pestanas.addEventListener("click", (evento) => {
      const boton = evento.target.closest("[data-categoria]");
      if (!boton) return;
      categoriaActual = boton.dataset.categoria;
      dibujar();
    });
  }

  caja.innerHTML = '<div class="vacio">Cargando…</div>';

  try {
    const [items] = await Promise.all([leerCatalogo(), leerLoMio()]);
    catalogo = items;
  } catch (error) {
    console.error("No se pudo leer la tienda:", error);
    caja.innerHTML =
      '<div class="vacio"><span class="icono">⚠️</span>No pudimos cargar la tienda. Probá de nuevo en un momento.</div>';
    return;
  }

  dibujar();

  // Delegación: la rejilla se repinta entera en cada compra, así que enganchar
  // botón por botón dejaría escuchadores muertos en cada vuelta.
  caja.addEventListener("click", (evento) => {
    const boton = evento.target.closest("button");
    if (!boton) return;
    if (boton.dataset.comprar) comprar(boton.dataset.comprar, boton);
    else if (boton.dataset.equipar) equipar(boton.dataset.equipar, boton);
  });
}
