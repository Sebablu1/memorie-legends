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
import { pintarAvatarCabecera } from "./equipado.js";
import { montarInventario } from "./inventario.js";
import { montarLogros } from "./logros.js";
import { montarCuenta } from "./cuenta.js";

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

/**
 * La cuenta se monta cuando se la mira, y es la única de las cinco.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * POR QUÉ ÉSTA SÍ Y LA COLECCIÓN NO
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Son dos preguntas distintas y dan respuestas distintas.
 *
 * La colección se monta al entrar porque su panel nace VACÍO: el HTML no
 * tiene nada hasta que llega el catálogo, y montarla al tocar abriría una
 * pestaña en blanco que se llena después. Además `#sinColeccion` depende de
 * lo que encuentre.
 *
 * La cuenta es al revés: su panel está escrito entero en el HTML —el aviso,
 * los botones, el formulario— y se ve completo apenas se abre. Lo único que
 * llega de afuera son los dos números de los bolsillos y la lista de
 * aplicaciones registradas.
 *
 * Y su montaje hace algo que ninguno de los otros hace: `auth.currentUser
 * .reload()`, un viaje de AUTENTICACIÓN. Hacerlo en cada visita al perfil, le
 * interese o no la cuenta a quien entró, es trabajo que nadie pidió sobre la
 * parte más delicada del sistema.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * DOS DISPARADORES, UNA SOLA VEZ
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Hacen falta dos cosas para montar: que la pestaña esté a la vista y que la
 * sesión haya contestado. Y pueden llegar en cualquier orden —entrar con
 * `#cuenta` en la dirección pone la pestaña primero; tocarla después de un
 * rato pone la sesión primero—, así que lo comprueban las dos y monta la que
 * complete el par. `montada` es lo que impide que monte dos veces y cuelgue
 * los escuchadores por duplicado.
 */
let montada = false;
let aLaVista = null;
let miPerfil = null;

function quizasMontarLaCuenta() {
  if (montada || aLaVista !== "cuenta" || !miPerfil) return;
  montada = true;
  montarCuenta({ perfil: miPerfil });
}

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
  aLaVista = seccion;

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

  quizasMontarLaCuenta();
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

  /**
   * El avatar comprado, en la barra.
   *
   * Hasta acá lo pintaba sólo el tablero, porque era la única página con un
   * `#avatar` en la barra. Eso alcanzaba mientras «Mi colección» vivía ahí:
   * equipar un avatar llamaba a `pintarAvatarCabecera` y el cambio se veía al
   * instante. Desde A2a la colección vive en esta página, que no tenía el
   * nodo — así que la llamada de `inventario.js` no encontraba nada y se iba
   * en silencio: el jugador se ponía un avatar y la barra no se enteraba
   * hasta volver al tablero.
   *
   * El orden de precedencia —comprado, foto de Google, logo— lo decide
   * `pintarAvatarCabecera`; acá sólo se le pasa lo que el perfil ya trajo.
   */
  pintarAvatarCabecera({
    equipado: sesion.perfil.equipado?.avatar,
    foto: sesion.usuario.photoURL,
  });

  // Los tres números salen del perfil que ya se leyó. No hay viaje nuevo.
  $("statSaldo").textContent = sesion.perfil.saldo.toLocaleString("es-UY");
  $("statPartidas").textContent = sesion.perfil.partidas;
  $("statVictorias").textContent = sesion.perfil.victorias;

  /**
   * Las dos secciones se montan AL ENTRAR, no al tocar su pestaña.
   *
   * ───────────────────────────────────────────────────────────────────────
   * POR QUÉ NO PEREZOSO, QUE ERA LO ESPERABLE
   * ───────────────────────────────────────────────────────────────────────
   *
   * Montar al tocar ahorra dos lecturas a quien entra sólo a mirar sus
   * números. El precio es que la pestaña se abre VACÍA y se llena un
   * instante después, cuando el catálogo vuelve del servidor. Es la misma
   * pantalla dibujada que no responde contra la que este archivo ya decide
   * más abajo, con la sesión: una espera sin aviso en el momento en que el
   * jugador acaba de pedir algo se siente peor que la misma espera hecha
   * antes, mientras todavía está leyendo la primera pestaña.
   *
   * Y el costo no es nuevo: el tablero hacía estas dos lecturas en CADA
   * visita, y el tablero se abre mucho más que el perfil. Esto no agrega
   * tráfico, lo mueve a una pantalla que se abre menos.
   *
   * Hay además una razón que decide sola: `#sinColeccion` depende de si el
   * inventario encontró algo. Perezoso, ese cartel aparecería recién al
   * tocar la pestaña, y por un rato la pestaña no diría ni que está vacía.
   *
   * Las dos arrancan JUNTAS —`montarLogros` sin esperar a la otra— porque
   * son dos viajes independientes y encadenarlos duplicaría la espera.
   */
  const coleccion = montarInventario({
    foto: sesion.usuario.photoURL,
    uid: sesion.usuario.uid,
  });
  montarLogros();

  /*
   * El cartel de la colección vacía.
   *
   * `montarInventario` destapa `#miInventario` sólo si hay algo; si no, se
   * va sin tocar nada y la sección se queda escondida. En el tablero eso
   * alcanzaba —la sección no aparecía entre otras siete y nadie la
   * extrañaba—, pero acá es una pestaña entera: sin este cartel, «Colección»
   * se abre en blanco y se lee como una pantalla rota.
   *
   * Se mira el `hidden` que dejó el montaje en vez de volver a preguntar qué
   * tiene el jugador: la respuesta ya está en el DOM y preguntarla de nuevo
   * sería un segundo viaje para saber lo mismo.
   */
  // Y la cuenta, si es la pestaña que se está mirando. Ver
  // `quizasMontarLaCuenta`: el otro disparador es `mostrar`.
  miPerfil = sesion.perfil;
  quizasMontarLaCuenta();

  await coleccion;
  const vacia = $("miInventario")?.hidden !== false;
  if ($("sinColeccion")) $("sinColeccion").hidden = !vacia;
}
