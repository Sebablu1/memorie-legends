/**
 * La cuenta con la que entra la administración.
 *
 * NO es el correo de contacto, aunque hasta hace poco fueran el mismo. El de
 * contacto es `SUPPORT_EMAIL`, en `firebase-nucleo.js`, y es el que se le
 * muestra a la gente. Éste es la cuenta de Firebase con la que se inicia
 * sesión para administrar, y lo usan el tablero —para mostrar el enlace al
 * panel— y el panel, para abrirse.
 *
 * Ninguno de los dos es una comprobación de seguridad: quien edite el DOM los
 * destapa. Lo que decide son las Cloud Functions, que tienen la misma cuenta
 * cableada como administrador raíz (`CORREO_ADMIN` en `functions/index.js`) y
 * miran el correo verificado del token.
 *
 * Por eso cambiar esta dirección no es buscar y reemplazar: hay que cambiar
 * primero el correo de la cuenta en Firebase Authentication, después
 * `CORREO_ADMIN` y desplegar las funciones, y recién entonces esto. Al revés,
 * la administración queda afuera.
 */
export const CORREO_ADMINISTRACION = "soporte.memorie.legends@gmail.com";
