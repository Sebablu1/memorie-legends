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

  const abrirModal = (html) => {
    dom.modal.innerHTML = html;
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

  /** Cartel de un segundo: "Ana miró una carta de Bruno". */
  function anunciarMirada(texto) {
    const cartel = document.createElement("div");
    cartel.className = "anuncio-mirada";
    // textContent y no innerHTML: el texto lleva nombres que eligen los
    // jugadores, y un nombre puede ser `<img onerror=...>`.
    cartel.textContent = texto;
    dom.mesa.appendChild(cartel);
    setTimeout(() => cartel.remove(), msMarcaPoder);
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
    marcarEfecto, anunciarMirada, marcarManoMirada, anunciarPoder, efectoCambio,
  };
}
