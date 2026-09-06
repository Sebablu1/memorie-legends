/**
 * El avatar equipado, en la barra de arriba.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO ALCANZA CON PONER UN `src`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Lo que el perfil guarda en `avatar` es un ID del catálogo —"avatar-dragon"—,
 * no una imagen. Y la imagen de ese artículo puede ser dos cosas distintas: un
 * archivo, o un glifo. El catálogo de demostración usa emojis para no inventar
 * veinte PNG que después habría que reemplazar, y un emoji no entra en un
 * `<img src>`.
 *
 * Así que hay dos caminos: con archivo se le cambia el `src` a la imagen que ya
 * está; con glifo hay que reemplazar el nodo por un `<span>`, porque no existe
 * forma de meter texto dentro de un `<img>`. El reemplazo conserva el `id` y
 * las clases para que el CSS y cualquier otro código sigan encontrándolo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL ORDEN DE PRECEDENCIA
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   1. El avatar COMPRADO y equipado, si hay uno.
 *   2. La foto de Google, que es lo que se mostraba hasta ahora.
 *   3. El logo, que ya venía puesto en el HTML.
 *
 * El comprado va primero porque es una elección explícita: alguien gastó
 * Leyendas para verse así. La foto de Google no se borra ni se pisa en el
 * perfil — sigue viniendo de Auth—, simplemente deja de ganar.
 *
 * Si la lectura del catálogo falla, no pasa nada visible: queda la foto de
 * Google. Un avatar es decoración, y una decoración no puede romper la carga
 * de la pantalla principal.
 */

import { db, doc, getDoc } from "./firebase.js";
import { imagenEsArchivo, COLECCION_CATALOGO } from "./reglas/catalogo.js";

/**
 * Pinta el avatar del jugador en la barra.
 *
 * @param {object} opciones
 * @param {string|null} opciones.equipado  id del artículo, o null
 * @param {string|null} opciones.foto      photoURL de Auth, como respaldo
 * @param {string} opciones.id             id del nodo en el HTML
 */
export async function pintarAvatarCabecera({ equipado, foto, id = "avatar" }) {
  const nodo = document.getElementById(id);
  if (!nodo) return;

  // Sin nada comprado, se mantiene lo de siempre.
  if (!equipado) {
    if (foto && nodo.tagName === "IMG") nodo.src = foto;
    return;
  }

  let item;
  try {
    const snap = await getDoc(doc(db, COLECCION_CATALOGO, equipado));
    if (!snap.exists()) return;
    item = snap.data();
  } catch (error) {
    // El catálogo puede no estar sembrado todavía, o la red puede fallar.
    console.warn("No se pudo leer el avatar equipado:", error);
    return;
  }

  if (imagenEsArchivo(item.imagen)) {
    if (nodo.tagName === "IMG") nodo.src = item.imagen;
    else reemplazarPor(nodo, crearImagen(nodo, item));
    return;
  }

  reemplazarPor(nodo, crearGlifo(nodo, item));
}

function crearImagen(viejo, item) {
  const img = document.createElement("img");
  img.src = item.imagen;
  img.alt = "";
  img.id = viejo.id;
  img.className = viejo.className;
  return img;
}

function crearGlifo(viejo, item) {
  const span = document.createElement("span");
  span.id = viejo.id;
  span.className = `${viejo.className} avatar-glifo`;
  span.textContent = item.imagen ?? "";
  // El nombre del avatar no aporta nada a quien usa lector de pantalla —la
  // barra ya dice de quién es la sesión— y leer "dragón" en medio del menú
  // sería ruido. Se anuncia como decoración, igual que la imagen que
  // reemplaza, que va con `alt=""`.
  span.setAttribute("aria-hidden", "true");
  return span;
}

const reemplazarPor = (viejo, nuevo) => viejo.replaceWith(nuevo);
