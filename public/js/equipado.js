/**
 * Lo que el jugador lleva puesto, dibujado donde corresponde.
 *
 * Se llamaba `avatar-cabecera.js` mientras sólo existían los avatares. Al
 * aparecer las insignias, el archivo pasó a hacer dos cosas y el nombre dejó de
 * ser cierto: el problema que resuelve no es "la cabecera", es "traducir un id
 * del catálogo a algo que se ve".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO ALCANZA CON PONER UN `src`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Lo que el perfil guarda es un ID del catálogo —"avatar-dragon"—, no una
 * imagen. Y la imagen de ese artículo puede ser dos cosas distintas: un
 * archivo, o un glifo. El catálogo de demostración usa emojis para no inventar
 * veinte PNG que después habría que reemplazar, y un emoji no entra en un
 * `<img src>`.
 *
 * De ahí los dos caminos: con archivo se cambia el `src` de la imagen que ya
 * está; con glifo hay que reemplazar el nodo por un `<span>`, porque no existe
 * forma de meter texto dentro de un `<img>`. El reemplazo conserva el `id` y
 * las clases para que el CSS y cualquier otro código sigan encontrándolo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NADA DE ESTO PUEDE ROMPER LA PANTALLA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Si el catálogo no responde —puede no estar sembrado todavía— no pasa nada
 * visible: el avatar se queda con la foto de Google y la insignia no aparece.
 * Es decoración, y una decoración que tumba el tablero es peor que ninguna.
 */

import { db, doc, getDoc } from "./firebase.js";
import { imagenEsArchivo, COLECCION_CATALOGO } from "./reglas/catalogo.js";

/** Un artículo del catálogo, o null si no está o si la lectura falla. */
async function leerItem(id) {
  if (!id) return null;
  try {
    const snap = await getDoc(doc(db, COLECCION_CATALOGO, id));
    return snap.exists() ? snap.data() : null;
  } catch (error) {
    console.warn(`No se pudo leer el artículo «${id}»:`, error);
    return null;
  }
}

// ------------------------------------------------------------ el avatar

/**
 * Pinta el avatar del jugador en la barra.
 *
 * El orden de precedencia:
 *
 *   1. El avatar COMPRADO y equipado, si hay uno.
 *   2. La foto de Google, que es lo que se mostraba hasta ahora.
 *   3. El logo, que ya venía puesto en el HTML.
 *
 * El comprado va primero porque es una elección explícita: alguien gastó
 * Leyendas para verse así. La foto de Google no se borra ni se pisa en el
 * perfil —sigue viniendo de Auth—, simplemente deja de ganar.
 *
 * @param {object} opciones
 * @param {string|null} opciones.equipado  id del artículo, o null
 * @param {string|null} opciones.foto      photoURL de Auth, como respaldo
 * @param {string} opciones.id             id del nodo en el HTML
 */
export async function pintarAvatarCabecera({ equipado, foto, id = "avatar" }) {
  const nodo = document.getElementById(id);
  if (!nodo) return;

  if (!equipado) {
    if (foto && nodo.tagName === "IMG") nodo.src = foto;
    return;
  }

  const item = await leerItem(equipado);
  if (!item) return;

  if (imagenEsArchivo(item.imagen)) {
    if (nodo.tagName === "IMG") nodo.src = item.imagen;
    else nodo.replaceWith(crearImagen(nodo, item));
    return;
  }

  nodo.replaceWith(crearGlifo(nodo, item));
}

// ---------------------------------------------------------- la insignia

/**
 * Pone la insignia equipada al lado de un texto — el saludo del tablero.
 *
 * A diferencia del avatar, acá NO hay un nodo que reemplazar: la insignia se
 * agrega o no existe. Por eso se crea el elemento y se cuelga del contenedor
 * que se le pase, y por eso una llamada sin insignia equipada no hace nada en
 * vez de dejar un hueco.
 *
 * Y a diferencia del avatar, ésta SÍ se anuncia. El avatar de la barra es
 * decoración —quién sos ya lo dice la sesión— pero la insignia es algo que el
 * jugador eligió mostrar, y no leerla sería esconder justo lo que se compró
 * para que se vea.
 *
 * @param {object} opciones
 * @param {string|null} opciones.equipado  id de la insignia, o null
 * @param {string} opciones.dentroDe       id del contenedor donde colgarla
 */
export async function pintarInsignia({ equipado, dentroDe = "saludo" }) {
  const caja = document.getElementById(dentroDe);
  if (!caja) return;

  // Si ya había una puesta —esta función puede correr dos veces en una misma
  // pantalla al cambiar de insignia— se saca antes de poner la nueva.
  caja.querySelector(".insignia-equipada")?.remove();

  const item = await leerItem(equipado);
  if (!item) return;

  const marca = document.createElement("span");
  marca.className = "insignia-equipada";
  marca.title = item.nombre ?? "";
  marca.setAttribute("aria-label", `Insignia: ${item.nombre ?? ""}`);
  marca.setAttribute("role", "img");

  if (imagenEsArchivo(item.imagen)) {
    const img = document.createElement("img");
    img.src = item.imagen;
    img.alt = "";
    marca.append(img);
  } else {
    marca.textContent = item.imagen ?? "";
  }

  caja.append(marca);
}

// ------------------------------------------------------------- ayudantes

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
