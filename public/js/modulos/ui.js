/**
 * Lo que la mesa le dice al jugador: carteles, marcas y modales.
 *
 * Nada de acá decide nada del juego. Recibe qué mostrar y lo muestra. Por eso
 * pudo salir de `mesa.js` sin arrastrar el estado de la partida: ninguna de
 * estas funciones pregunta de quién es el turno ni qué carta hay dónde.
 *
 * La marca de la mirada es la única que merece una aclaración, y es una regla
 * del juego, no un detalle visual: dice QUE alguien miró una carta y de quién,
 * nunca cuál ni en qué posición. Que la mesa se entere es deliberado —los
 * demás tienen derecho a saber que ese jugador ahora sabe algo— y que no se
 * sepa qué vio, también.
 */

/**
 * Se re-exporta desde `texto.js`, donde vive ahora.
 *
 * Se mudó cuando hizo falta en la sala de espera y en el listado de salas: que
 * esas pantallas importaran la interfaz de la mesa para escapar un nombre
 * habría sido una dependencia falsa. Se sigue exportando desde acá para no
 * tocar a `mesa.js`, que ya la importaba.
 */
export { escapar } from "./texto.js";

const ESTILO_PODER = {
  mirarPropia: { icono: "👁", clase: "poder-7" },
  mirarRival: { icono: "🔍", clase: "poder-8" },
  cambioCiego: { icono: "🌀", clase: "poder-9" },
  cambioConVista: { icono: "🔄", clase: "poder-10" },
};

/**
 * @param dom          los nodos que ya resolvió mesa.js
 * @param sonidos      el módulo de sonidos
 * @param titulos      TITULOS_PODER: nombre visible de cada poder
 * @param esperar      la espera del módulo de temporizadores
 * @param msAnuncio    cuánto queda en pantalla el cartel de un poder
 * @param msMarcaPoder cuánto dura la marca de una mirada (la regla: 1 s)
 */
export function crearInterfaz({ dom, sonidos, titulos, esperar, msAnuncio, msMarcaPoder }) {
  // ----------------------------------------------------------- textos

  const pista = (texto) => {
    dom.pista.innerHTML = texto;
  };

  // ----------------------------------------------------------- modal

  /**
   * La cuenta atrás, DENTRO del modal.
   *
   * ───────────────────────────────────────────────────────────────────
   * POR QUÉ NO ALCANZA CON LA DEL CARTEL
   * ───────────────────────────────────────────────────────────────────
   *
   * Porque el modal la tapa, y no hay z-index que lo arregle: `.escena` se
   * declara `position: relative; z-index: 2`, así que todo lo que vive
   * adentro —el cartel de la pista incluido— se pinta dentro de ESE nivel, y
   * el velo es hermano de `.escena`, no suyo. Subirle el número al cartel no
   * cambia nada; se midió.
   *
   * Las fases que abren modal son justamente las que tienen reloj: levantar
   * una carta de poder y elegir a quién aplicárselo vencen a los diez
   * segundos. El jugador estaba decidiendo contra una cuenta que no veía.
   *
   * ───────────────────────────────────────────────────────────────────
   * ES LA MISMA CUENTA, NO OTRA
   * ───────────────────────────────────────────────────────────────────
   *
   * Acá va sólo el hueco. Lo rellena `pintarReloj` desde `relojTurno`, igual
   * que pinta el cartel y el aro del retrato: una sola cuenta, tres
   * superficies.
   *
   * Un `setTimeout` propio del modal habría sido más corto de escribir y es
   * exactamente lo que este archivo ya advierte en `iniciarRelojTurno`: dos
   * relojes para lo mismo terminan discrepando en cuanto uno se cancela y el
   * otro no, y entonces el modal se cerraría solo mientras el número del
   * cartel sigue corriendo.
   *
   * Va en TODOS los modales y no sólo en los de poder, para que el día que
   * una fase nueva con reloj abra el suyo no haya que acordarse de nada. Nace
   * `hidden`; si no hay reloj corriendo, `pintarReloj` lo deja así.
   *
   * Aparece en el tick siguiente, hasta 120 ms después. Se prefirió eso a que
   * la interfaz tenga que conocer al reloj para pedirle un repintado: 120 ms
   * no se ven, y el acoplamiento sí se paga.
   */
  const RELOJ_DEL_MODAL = [
    '<span class="reloj-modal" aria-hidden="true" hidden>',
    '<span class="reloj-modal-barra"><i class="reloj-modal-relleno"></i></span>',
    '<b class="reloj-modal-numero"></b>',
    "</span>",
  ].join("");

  const abrirModal = (html) => {
    dom.modal.innerHTML = RELOJ_DEL_MODAL + html;
    dom.velo.classList.add("abierto");
  };

  const cerrarModal = () => {
    dom.velo.classList.remove("abierto");
    dom.modal.innerHTML = "";
  };

  // --------------------------------------------------------- efectos

  /** Pinta un efecto sobre una carta concreta y lo limpia solo. */
  function marcarEfecto(i, pos, clase, ms = 900) {
    const el = document.querySelector(
      `.jugador[data-jugador="${i}"] .carta[data-posicion="${pos}"]`,
    );
    if (!el) return;
    el.classList.add(clase);
    setTimeout(() => el.classList.remove(clase), ms);
  }

  /**
   * El cartel corto: un ícono grande y una o dos palabras.
   *
   * Reemplaza a los carteles que contaban la jugada en una frase — "Ana miró
   * una carta de Bruno", "Vos miró las dos cartas y NO cambió". En el medio de
   * una mano nadie lee una frase: se mira, se reconoce la forma y se sigue
   * jugando. Un ícono se reconoce sin leer.
   *
   * La frase larga NO se pierde: sigue entera en el registro, que es donde uno
   * va justamente a leer con calma qué pasó.
   *
   * `texto` viaja por `textContent` aunque hoy sean palabras fijas escritas
   * acá. Cuesta nada y cierra la puerta a que mañana alguien le pase un nombre
   * de jugador, que es texto que elige un desconocido.
   */
  function mostrarCartel(icono, texto, { clase = "" } = {}) {
    const cartel = document.createElement("div");
    cartel.className = `cartel-corto ${clase}`.trim();

    const marca = document.createElement("span");
    marca.className = "icono";
    // El ícono no se lee en voz alta: lo dice la palabra de al lado, y un
    // lector de pantalla que anuncie "emoji de ojo Miró" dice la cosa dos
    // veces.
    marca.setAttribute("aria-hidden", "true");
    marca.textContent = icono;

    const palabra = document.createElement("b");
    palabra.textContent = texto;

    cartel.append(marca, palabra);
    dom.mesa.appendChild(cartel);

    setTimeout(() => {
      cartel.classList.add("saliendo");
      setTimeout(() => cartel.remove(), 260);
    }, msMarcaPoder);
  }

  /** Marca la mano entera de quien fue mirado, sin señalar qué carta. */
  function marcarManoMirada(indiceJugador) {
    const mano = document.querySelector(`.jugador[data-jugador="${indiceJugador}"]`);
    if (!mano) return;
    mano.classList.add("mano-mirada");
    setTimeout(() => mano.classList.remove("mano-mirada"), msMarcaPoder);
  }

  /** Cartel sobre la mesa anunciando qué poder se activó y quién lo usa. */
  async function anunciarPoder(poder, nombre) {
    if (!poder) return;
    sonidos.poder();
    const { icono, clase } = ESTILO_PODER[poder.tipo] ?? { icono: "✨", clase: "" };

    const cartel = document.createElement("div");
    cartel.className = `anuncio-poder ${clase}`;
    cartel.innerHTML = `
      <span class="icono">${icono}</span>
      <span class="detalle">
        <b>Poder ${poder.numero}</b>
        <i>${titulos[poder.tipo]}</i>
        <em></em>
      </span>`;
    // El nombre se pone aparte, por lo mismo que arriba: lo elige el jugador.
    cartel.querySelector("em").textContent = nombre;
    dom.mesa.appendChild(cartel);

    await esperar(msAnuncio);
    cartel.classList.add("saliendo");
    setTimeout(() => cartel.remove(), 320);
  }

  /** Resalta las dos posiciones que participan de un intercambio. */
  function efectoCambio(tipo, yo, posPropia, indiceRival, posRival) {
    const clase = tipo === "cambioCiego" ? "efecto-ciego" : "efecto-vista";
    marcarEfecto(yo, posPropia, clase, 1100);
    marcarEfecto(indiceRival, posRival, clase, 1100);
  }

  return {
    pista, abrirModal, cerrarModal,
    marcarEfecto, mostrarCartel, marcarManoMirada, anunciarPoder, efectoCambio,
  };
}
