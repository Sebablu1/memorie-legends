/**
 * La versión de las imágenes del sitio, en un solo lugar.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA UNA VERSIÓN EN LA DIRECCIÓN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Las imágenes se guardan en el navegador un mes —ver `firebase.json`— y una
 * copia guardada NO vuelve a preguntar. Así que reemplazar un archivo
 * manteniendo el nombre deja a quien ya lo tenía viendo el viejo hasta que
 * venza, y cambiar el encabezado no lo arregla.
 *
 * Acá decía «un mes casi todas, un día los avatares», y era FALSO. La regla
 * de un día para `img/avatar/**` existía desde C2 pero estaba debajo de la
 * genérica de imágenes, y Firebase aplica la PRIMERA que coincide: el
 * servidor entregaba los avatares con el mes, como se comprobó con curl
 * contra producción. O sea que la única red contra el problema de C2 fue
 * siempre esta versión, nunca el encabezado. Ahora la regla va primero y sí
 * se aplica, pero lo que sostiene esto sigue siendo el `?v=`.
 *
 * Pasó dos veces. Las cartas rediseñadas con los mismos nombres, y después los
 * trece avatares de C2: el archivo nuevo estaba en el servidor, se veía
 * pidiéndolo con cualquier query, y no había forma de que llegara solo.
 *
 * Con la versión en la dirección, cada reemplazo es una dirección que el
 * navegador nunca vio.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ UNA SOLA Y NO UNA POR CARPETA (§66)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque estaba partida en tres y cubría la mitad. Los avatares tenían la
 * suya, los dorsos de la casa otra, las cartas una tercera — y las insignias,
 * los marcos, los paños y los mazos NO TENÍAN NINGUNA. Eso último era el §66
 * de `PENDIENTE.md`: reemplazar una insignia era desplegarla y esperar un mes.
 *
 * Y lo peor no era el agujero sino la inconsistencia dentro de un mismo
 * archivo: `/img/dorsos/dorso-azul.webp` llevaba `?v=1` cuando lo repartía la
 * casa, y llegaba SIN versión cuando era el dorso que alguien compró, porque
 * esa ruta sale del catálogo de Firestore y nadie la envolvía. Mismo archivo,
 * dos comportamientos según el camino.
 *
 * Un número para todo `/img/` cuesta que, al subirlo, se vuelvan a pedir
 * también las imágenes que no cambiaron. Son menos de dos megas entre todas,
 * una vez, contra un agujero que ya mordió dos veces.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LAS CARTAS NO ENTRAN, Y ES A PROPÓSITO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `imagenCarta` en `baraja.js` sigue con `VERSION_CARTAS`. Viven bajo
 * `/assets/`, son cuarenta y ocho archivos y 3,3 MB, y su número cuenta otra
 * cosa: un rediseño de la baraja. Unificarlas haría que recortar un avatar
 * obligue a redescargar el mazo entero.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Y POR QUÉ VIVE EN `reglas/` Y NO EN `modulos/`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque `baraja.js` lo necesita para los dorsos, y `reglas/` es
 * autocontenida: `copiar-reglas.js` copia la carpeta entera al servidor, así
 * que un import hacia afuera la rompería. El precedente ya estaba: las dos
 * versiones que había —cartas y dorsos— viven acá desde siempre.
 */

/**
 * 3 — el número unificado.
 *
 * Arranca en 3 y no en 1 por una razón concreta: es el valor que ya tenía
 * `VERSION_AVATARES`, así que los trece avatares conservan EXACTAMENTE la
 * dirección que los navegadores acaban de guardar y nadie vuelve a bajar el
 * mega que se desplegó anteayer.
 *
 * Los que sí cambian de dirección son los que lo necesitan: los dorsos
 * —venían de `?v=1`— y las insignias, los paños y los mazos, que no tenían
 * ninguna. Una vez.
 *
 * Al subirlo, SIEMPRE monótono. Bajarlo o reusar un número viejo devuelve una
 * dirección que ya está guardada en los navegadores, y entonces la versión
 * deja de servir para lo único que sirve.
 */
export const VERSION_IMAGENES = 3;

/**
 * La dirección de una imagen del sitio, con su versión.
 *
 * Deja pasar sin tocar todo lo que no sea una imagen servida por nosotros:
 *
 *   · lo que no es texto —un `null` de un perfil sin retrato—;
 *   · los emojis del catálogo, que no son rutas;
 *   · la foto de Google y cualquier otro dominio;
 *   · `/assets/`, que son las cartas y tienen su propia versión;
 *   · y cualquier ruta que YA traiga una query.
 *
 * Ese último caso importa más de lo que parece y no es defensivo: la ruta
 * puede venir del `localStorage` de una visita anterior o de una fila vieja
 * del ranking, ya versionada, y concatenar dos veces daría `?v=3?v=3`.
 */
export function imagenUrl(ruta) {
  if (typeof ruta !== "string") return ruta;
  if (!ruta.startsWith("/img/")) return ruta;
  if (ruta.includes("?")) return ruta;
  return `${ruta}?v=${VERSION_IMAGENES}`;
}
