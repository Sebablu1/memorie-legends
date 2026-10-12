/**
 * La versión de los avatares, pegada a su dirección al dibujar.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Las imágenes se guardan un mes: `firebase.json` les pone
 * `max-age=2592000`. Es seguro mientras una imagen que cambia cambie de
 * dirección, y el comentario de esa misma regla lo dice con todas las letras:
 * «Reemplazar un archivo con el mismo nombre deja la copia vieja en cada
 * navegador que ya la tenía, hasta que venza».
 *
 * En C2 se reemplazaron los trece avatares manteniendo el nombre. Resultado:
 * el archivo nuevo quedó en el servidor —se puede comprobar pidiéndolo con
 * cualquier query— y el borde del CDN siguió entregando el viejo. Pedirlo con
 * `Cache-Control: no-cache` tampoco lo movía.
 *
 * Es el mismo agujero que `VERSION_DORSOS` en `reglas/baraja.js` dejó tapado
 * «para la PRÓXIMA vez, que es cuando muerde». Esta fue la próxima vez, en
 * los avatares, que no tenían su versión.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ AL DIBUJAR Y NO EN EL DATO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque la dirección de un avatar no vive en el código: vive en Firestore
 * —el documento del artículo— y copiada en las filas del ranking, en los
 * documentos de sala y en el `localStorage` de cada navegador. Cambiarla en
 * el dato obligaría a migrar las cuatro cosas, y mientras tanto quedarían
 * convivindo la vieja y la nueva.
 *
 * Puesta al dibujar, la versión la decide siempre el código de ahora. Es lo
 * mismo que hace `caraDeCarta` con las cartas y por el mismo motivo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SÓLO LOS AVATARES, Y A PROPÓSITO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Los dorsos ya tienen la suya —`dorsoUrl`, con `VERSION_DORSOS`— y pasarles
 * ésta encima les dejaría dos. Las insignias, los marcos y los paños no se
 * tocaron, y versionarlos sin motivo haría que cuarenta imágenes que nadie
 * cambió se vuelvan a bajar.
 *
 * El día que se reemplace una insignia va a hacer falta lo mismo para ellas.
 * El lugar natural es el componente único de C1, cuando los siete dibujantes
 * de avatares e insignias sean uno.
 */

/**
 * 2 — los trece avatares rehechos: bustos que llenan el cuadro, 320x320,
 *     reemplazando a los medallones de 400x400 con el mismo nombre (C2).
 * 3 — los mismos trece, a 512x512, por el modal de zoom: ahí el dibujo se
 *     muestra a 320 CSS, que en un teléfono de 3x son 960 px de verdad.
 *
 * Al subir este número, el navegador pide una dirección que nunca vio y el
 * día de caché deja de importar. No hace falta tocar ningún dato guardado.
 *
 * Y hay que subirlo SIEMPRE que se reemplace un archivo manteniendo el
 * nombre. En C2 se desplegó sin hacerlo y el borde del CDN siguió entregando
 * los viejos: el archivo nuevo estaba en el servidor y no había forma de
 * verlo. La única salida fue esto.
 */
export const VERSION_AVATARES = 3;

/**
 * La dirección de un avatar, con su versión.
 *
 * Deja pasar sin tocar todo lo que no sea un avatar del sitio: la foto de
 * Google —que es de otro dominio—, los emojis del catálogo de demostración,
 * los dorsos, las insignias, y cualquier cosa que ya traiga una query. Esto
 * último importa más de lo que parece: la ruta puede venir del `localStorage`
 * de una visita anterior, y concatenar dos veces daría `?v=2?v=2`.
 */
export function avatarUrl(ruta) {
  if (typeof ruta !== "string") return ruta;
  if (!ruta.startsWith("/img/avatar/")) return ruta;
  if (ruta.includes("?")) return ruta;
  return `${ruta}?v=${VERSION_AVATARES}`;
}
