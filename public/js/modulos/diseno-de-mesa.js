/**
 * El diseño de la mesa que decide la casa: la sala de atrás y la brújula.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ ES ESTO Y QUÉ NO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Dos cosas que el administrador cambia y el jugador NO elige. Son lo
 * contrario del paño y del dorso: aquéllos se compran, se equipan y viajan en
 * el perfil; esto es decoración de la casa y vive en un documento de
 * configuración.
 *
 * Por eso NO son artículos del catálogo. Un artículo tiene precio, aparece en
 * `misItems` y se equipa; nada de eso aplica, y forzarlo traería tres campos
 * que no significan nada para que signifiquen algo dos.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TODO PASA POR VARIABLES QUE EL CSS YA DECLARA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `--sala` y `--brujula` existen en `mesa.css` con su valor por omisión
 * puesto en el propio `var()`. Eso da las tres opciones sin una sola línea
 * condicional:
 *
 *   · No hay configuración  → no se escribe nada → queda lo de siempre.
 *   · Hay una propia        → se escribe → se ve la suya.
 *   · Se borró la propia    → vuelve a no escribirse → vuelve la de siempre.
 *
 * Y para la brújula hay una cuarta: `none`, que es «ninguna brújula».
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ UN COLOR SE ESCRIBE COMO DEGRADADO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque `--sala` ocupa una posición de CAPA DE IMAGEN dentro de un
 * `background`, y ahí CSS no acepta un color: `background: #000, url(...)`
 * es inválido —un color sólo puede ser la última capa—.
 *
 * `linear-gradient(#1a1a2e, #1a1a2e)` SÍ es una imagen para CSS, y pinta
 * exactamente igual que el color plano. Así el mismo campo guarda las dos
 * cosas y el CSS no se entera de cuál le tocó.
 */

/** Lo que se acepta guardado, y en qué se convierte. */
export const SIN_BRUJULA = "ninguna";

const esRutaDelSitio = (v) => typeof v === "string" && v.startsWith("/");
/**
 * Un hexadecimal que CSS acepte: 3, 4, 6 u 8 dígitos.
 *
 * NO «de 3 a 8». Cinco y siete son longitudes que no existen en CSS, y una
 * comprobación laxa las dejaría pasar: el panel diría que sí, el servidor lo
 * guardaría, y al dibujar el `linear-gradient` saldría inválido y el
 * navegador descartaría la declaración entera. O sea, aceptado y sin efecto,
 * que es la peor de las dos fallas — la que no se nota.
 */
const esColor = (v) =>
  typeof v === "string" && /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v.trim());
const esDegradado = (v) => typeof v === "string" && /^(linear|radial|conic)-gradient\(/i.test(v.trim());

/**
 * El valor CSS de la capa de la sala, o `null` si no hay que escribir nada.
 *
 * `null` NO es un error: es «dejá lo que había», que es el caso normal. Se
 * distingue de `"none"` —que sería apagar la capa— porque para la sala apagar
 * y no tocar son lo mismo, y el `var()` ya cae en `none` solo.
 *
 * `cover` y no `100% 100%`: el fondo cubre la ventana, que cambia de forma
 * entre un monitor y un teléfono. Estirar deformaría el dibujo; cubrir
 * recorta, que sobre una pared de fondo no se nota.
 */
export function capaDeSala(valor) {
  if (esRutaDelSitio(valor)) return `url("${valor}") center / cover no-repeat`;
  if (esColor(valor)) {
    const c = valor.trim();
    return `linear-gradient(${c}, ${c})`;
  }
  // Un degradado entero se escribe tal cual: ya es una imagen para CSS.
  if (esDegradado(valor)) return valor.trim();
  return null;
}

/**
 * El valor CSS de la máscara de la brújula, o `null` si no hay que tocar.
 *
 * Devuelve `"none"` para «ninguna brújula», que apaga la máscara y deja el
 * pseudo-elemento sin pintar nada.
 *
 * `contain` y `center 46%`, igual que la de siempre: la brújula tiene que
 * entrar ENTERA. Con `cover`, en una ventana ancha se le cortan el norte y el
 * sur y queda una figura que no se reconoce.
 */
export function capaDeBrujula(valor) {
  if (valor === SIN_BRUJULA) return "none";
  if (esRutaDelSitio(valor)) return `url("${valor}") center 46% / contain no-repeat`;
  return null;
}

/**
 * Escribe en la mesa lo que diga la configuración.
 *
 * Sólo escribe lo que corresponde: una configuración vacía, a medias o con
 * basura deja la mesa exactamente como estaba. Por eso cada valor pasa por su
 * traductor y sólo se escribe si devolvió algo.
 *
 * @param {Element|null} mesa  el nodo `.mesa`
 * @param {object} config      `{ sala, brujula }`, como viene de Firestore
 * @returns {string[]} qué se escribió, para poder contarlo en una prueba
 */
export function aplicarDisenoDeMesa(mesa, config = {}) {
  if (!mesa) return [];
  const escritas = [];

  const sala = capaDeSala(config?.sala);
  if (sala !== null) {
    // La sala se pinta en el `body`: es el fondo de la pantalla, no de la
    // mesa. La variable se escribe donde la lee el CSS.
    document.body.style.setProperty("--sala", sala);
    escritas.push("sala");
  }

  const brujula = capaDeBrujula(config?.brujula);
  if (brujula !== null) {
    mesa.style.setProperty("--brujula", brujula);
    escritas.push("brujula");
  }

  return escritas;
}
