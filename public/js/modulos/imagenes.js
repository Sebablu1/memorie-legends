/**
 * La puerta del navegador a la versión de las imágenes.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ACÁ NO VIVE EL MECANISMO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Vive en `reglas/imagenes.js`, con el número y la función. Tuvo que mudarse
 * ahí cuando `dorsoUrl` pasó a usarlo: `baraja.js` está en `reglas/`, y esa
 * carpeta es autocontenida —`copiar-reglas.js` la copia entera al servidor—
 * así que un import hacia `modulos/` la habría roto.
 *
 * Este archivo queda como la puerta: las ocho pantallas que dibujan una
 * imagen lo importan desde acá, que es donde lo buscaban antes.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ AL DIBUJAR Y NO EN EL DATO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Es la decisión que explica toda la forma, y por eso se queda escrita acá,
 * al lado de quienes dibujan.
 *
 * La dirección de un avatar no vive en el código: vive en Firestore —el
 * documento del artículo— y copiada en las filas del ranking, en los
 * documentos de sala y en el `localStorage` de cada navegador. Cambiarla en
 * el dato obligaría a migrar las cuatro cosas, y mientras tanto quedarían
 * conviviendo la vieja y la nueva.
 *
 * Puesta al dibujar, la versión la decide siempre el código de ahora. Es lo
 * mismo que hace `caraDeCarta` con las cartas y por el mismo motivo.
 *
 * Y es también la razón de que `imagenUrl` deje pasar una ruta que ya trae
 * query: algunas de esas copias guardadas se escribieron YA versionadas, y
 * concatenar dos veces daría `?v=3?v=3`.
 */

export { VERSION_IMAGENES, imagenUrl } from "../reglas/imagenes.js";
