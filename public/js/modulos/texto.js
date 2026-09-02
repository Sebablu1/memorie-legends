/**
 * Texto que entra a innerHTML sin poder hacer daño.
 *
 * POR QUÉ ESTO EXISTE
 *
 * Las reglas de Firestore dejan que cada jugador escriba su propio nombre
 * —`allow update: if esDuenio(uid)`— y ese nombre lo leen todos los demás:
 * para dibujar la mesa, para la lista de la sala de espera y para el listado
 * de salas abiertas. Estaba entrando sin escapar en las tres pantallas, así
 * que un jugador llamado `<img src=x onerror="...">` ejecutaba lo que quisiera
 * en el navegador de los otros, con la sesión de ellos abierta. En una partida
 * por Leyendas ésa es la sesión con la que se mueve el saldo.
 *
 * POR QUÉ AL SALIR Y NO AL ENTRAR
 *
 * El nombre puede llegar de Firestore, de una vista publicada por el servidor
 * o de la configuración local. Tapar cada una de esas puertas es una pelea que
 * se pierde: siempre queda una. El único punto por el que pasa todo es el de
 * dibujarlo, y es acá.
 *
 * POR QUÉ EN SU PROPIO ARCHIVO
 *
 * Vive suelto y no dentro de `ui.js` porque lo necesitan tres pantallas que no
 * tienen nada que ver entre sí. Que la sala de espera tuviera que importar la
 * interfaz de la mesa para escapar un nombre sería una dependencia falsa, y la
 * alternativa —copiar la función— es peor: el día que haya que arreglar algo
 * en el escapado, se arreglaría en una copia sola.
 */

const REEMPLAZOS = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escapa lo que vaya a interpolarse dentro de HTML.
 *
 * Cubre también comillas simples y dobles, no sólo `<` y `>`: sirve dentro del
 * texto de un elemento y también dentro del valor de un atributo, que es donde
 * se usa para cosas como `data-codigo="..."`.
 *
 * El `&` va primero en el objeto pero eso no basta por sí solo: lo que lo hace
 * correcto es que `replace` recorre la cadena UNA vez, así que un `&` recién
 * insertado nunca se vuelve a mirar. Encadenar cinco `replace` sí produciría
 * `&amp;lt;` a partir de un `<`.
 */
export const escapar = (texto) =>
  String(texto ?? "").replace(/[&<>"']/g, (caracter) => REEMPLAZOS[caracter]);
