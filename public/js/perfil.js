/**
 * Mi perfil: cinco secciones en una página, elegidas por la dirección.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ UNA PÁGINA CON PESTAÑAS Y NO CINCO PÁGINAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Cinco `.html` serían cinco barras, cinco navegaciones y cinco juegos de
 * `<link>` que hay que mantener idénticos a mano —el nav de este sitio está
 * escrito en cada archivo, no lo inyecta nadie—. Y lo que se muestra en las
 * cinco sale de la MISMA lectura del perfil: cinco páginas serían cinco
 * lecturas para el mismo jugador.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL HASH, Y POR QUÉ ES NUEVO ACÁ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El sitio tiene dos juegos de pestañas antes que éste —las del ranking y las
 * de la tienda— y ninguno toca la dirección: el estado vive en memoria y se
 * pierde al recargar. Para una tienda da igual. Para esto no:
 *
 *   - La oferta de dos pasos del tablero tiene que poder apuntar a la
 *     sección de la cuenta, y no a «el perfil, y buscá vos».
 *   - Recargar con F5 no puede devolverte a la primera pestaña.
 *   - «Andá a tu colección» tiene que ser un enlace que se pueda pegar.
 *
 * Así que acá se inventa el patrón, y es deliberadamente chico: leer el hash
 * al cargar, escucharlo, y escribirlo al tocar una pestaña. Nada de un
 * enrutador.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * `replaceState` Y NO `location.hash = …`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Asignar el hash agrega una entrada al historial por cada pestaña tocada.
 * Quien mira las cinco y aprieta «atrás» esperando volver al tablero tiene
 * que apretarlo cinco veces. Con `replaceState` la dirección queda igual de
 * compartible y el botón de atrás sigue significando «la página anterior».
 *
 * Lo que sí hay que escuchar es `hashchange`, para el caso contrario: alguien
 * que llega con `#cuenta` desde otra pantalla, o que edita la barra de
 * direcciones a mano.
 */

import { exigirSesion, mostrarSaldo, conectarBotonSalir } from "./sesion.js";

/**
 * Las cinco, y el orden es el de la pantalla.
 *
 * La lista vive acá y no se deduce del DOM a propósito: es la que decide cuál
 * es la de por omisión —la primera— y la que valida un hash de afuera. Leer
 * los botones y confiar en lo que haya haría que una pestaña mal escrita en
 * el HTML pasara inadvertida.
 */
const SECCIONES = ["perfil", "coleccion", "logros", "numeros", "cuenta"];
const POR_OMISION = SECCIONES[0];

const $ = (id) => document.getElementById(id);

/** El nombre de sección que pide la dirección, si es una de las nuestras. */
function seccionPedida() {
  const pedida = decodeURIComponent(location.hash.replace(/^#/, "")).trim();
  return SECCIONES.includes(pedida) ? pedida : POR_OMISION;
}

/**
 * Muestra una sección y esconde las otras cuatro.
 *
 * `aria-selected` en los botones y `hidden` en los paneles. No hace falta
 * tocar `aria-hidden`: un elemento con `hidden` ya está fuera del lector de
 * pantalla, y ponerle los dos es una de esas cosas que un día quedan
 * contradiciéndose.
 */
function mostrar(seccion, { moverFoco = false } = {}) {
  for (const nombre of SECCIONES) {
    const esta = nombre === seccion;
    const boton = document.querySelector(`#pestanasPerfil [data-panel="${nombre}"]`);
    const panel = $(`panel${nombre[0].toUpperCase()}${nombre.slice(1)}`);

    if (boton) {
      boton.setAttribute("aria-selected", String(esta));
      boton.classList.toggle("activa", esta);
    }
    if (panel) panel.hidden = !esta;
  }

  /*
   * El foco va al PANEL, no al botón, y sólo cuando el cambio salió de un
   * toque.
   *
   * Quien navega con teclado acaba de pedir ver algo: dejarle el foco en la
   * pestaña lo obliga a tabular hasta el contenido que pidió. Y los paneles
   * llevan `tabindex="0"` justamente para poder recibirlo.
   *
   * Al cargar la página no se mueve nada: robar el foco en el arranque le
   * saltea a todo el mundo la barra y el menú.
   */
  if (moverFoco) {
    const panel = $(`panel${seccion[0].toUpperCase()}${seccion.slice(1)}`);
    panel?.focus({ preventScroll: true });
  }
}

/** La dirección, sin ensuciar el historial. Ver el encabezado. */
function anotarEnLaDireccion(seccion) {
  const nueva = `${location.pathname}${location.search}#${seccion}`;
  history.replaceState(null, "", nueva);
}

// ------------------------------------------------------------- arranque

conectarBotonSalir();

mostrar(seccionPedida());

$("pestanasPerfil")?.addEventListener("click", (evento) => {
  const boton = evento.target.closest("[data-panel]");
  if (!boton) return;

  const seccion = boton.dataset.panel;
  if (!SECCIONES.includes(seccion)) return;

  mostrar(seccion, { moverFoco: true });
  anotarEnLaDireccion(seccion);
});

/*
 * Y si la dirección cambia desde afuera —otra pantalla que enlaza a
 * `#cuenta`, o alguien que la escribe a mano— la pantalla la sigue.
 *
 * Sin foco: el cambio no salió de un toque en esta página, así que mover el
 * foco sería moverlo por algo que el jugador no hizo acá.
 */
window.addEventListener("hashchange", () => mostrar(seccionPedida()));

/*
 * La sesión va ÚLTIMA, y no es desprolijidad.
 *
 * Las pestañas son HTML y no dependen de quién entró: si se esperara la
 * sesión para engancharlas, habría un rato —el que tarda Firebase en
 * contestar— en el que tocar una pestaña no haría nada. Y `exigirSesion`
 * manda al login por su cuenta cuando no hay nadie, así que esta página no
 * tiene que decidir nada al respecto.
 */
const sesion = await exigirSesion();
if (sesion) {
  mostrarSaldo(sesion.perfil.saldo);
}
