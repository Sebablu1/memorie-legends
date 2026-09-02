/**
 * Los dos relojes de la mesa.
 *
 * Son distintos y conviene no confundirlos:
 *
 *   - El TEMPORIZADOR es la barra grande: cuánto falta para que se cierre la
 *     mirada o la ventana de reflejos. Lo mira toda la mesa.
 *   - El RELOJ DEL TURNO es la cuenta atrás de quien tiene que levantar. Si se
 *     agota, pierde la levantada.
 *
 * Se arma con una fábrica —como `crearMotorEnRed` o `crearLimiteDeRitmo`— y no
 * como un puñado de funciones sueltas, porque los dos guardan estado propio:
 * el intervalo que están corriendo. Encerrarlo acá es justamente el punto: en
 * `mesa.js` eran dos variables más entre veintidós, y cualquier función del
 * archivo podía pisarlas.
 *
 * Lo que NO se movió: qué hacer cuando el reloj del turno llega a cero. Eso
 * depende del estado de la partida, así que entra como `alVencer` y se queda
 * viviendo en `mesa.js`. La alternativa era que este módulo importara el
 * estado del juego, y entonces no habría módulo: habría el mismo archivo con
 * un import de por medio.
 */

/** Espera `ms`. Lo único de este archivo que no toca el DOM. */
export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

export function crearTemporizadores({ dom, msTurno }) {
  let temporizadorActual = null;
  let relojTurno = null;

  // ------------------------------------------------ la barra grande

  function correr(ms, etiqueta, { reflejos = false } = {}) {
    cancelar();
    dom.temporizador.classList.add("activo");
    dom.temporizador.classList.toggle("reflejos", reflejos);

    const relleno = dom.temporizadorRelleno;
    relleno.style.transition = "none";
    relleno.style.transform = "scaleX(1)";
    // Fuerza un reflow para que la transición arranque desde el estado inicial.
    void relleno.offsetWidth;
    relleno.style.transition = `transform ${ms}ms linear`;
    relleno.style.transform = "scaleX(0)";

    const fin = Date.now() + ms;
    const pintar = () => {
      const restante = Math.max(0, fin - Date.now());
      dom.temporizadorTexto.textContent = `${etiqueta} ${(restante / 1000).toFixed(1)}s`;
    };
    pintar();
    temporizadorActual = setInterval(pintar, 80);
  }

  function cancelar() {
    if (temporizadorActual) clearInterval(temporizadorActual);
    temporizadorActual = null;
    dom.temporizador.classList.remove("activo", "reflejos");
  }

  // --------------------------------------------- el reloj del turno

  function pintarReloj() {
    const caja = dom.reloj;
    if (!caja) return;

    if (!relojTurno) {
      caja.hidden = true;
      return;
    }

    const restante = Math.max(0, relojTurno.fin - Date.now());
    const segundos = Math.ceil(restante / 1000);

    caja.hidden = false;
    dom.relojNumero.textContent = segundos;
    dom.relojRelleno.style.width = `${(restante / msTurno) * 100}%`;
    // Dorado hasta los 2 segundos; de ahí en más, rojo.
    caja.classList.toggle("apurado", segundos <= 2);
  }

  function cancelarRelojTurno() {
    if (relojTurno?.intervalo) clearInterval(relojTurno.intervalo);
    relojTurno = null;
    if (dom.reloj) dom.reloj.hidden = true;
  }

  /**
   * @param alVencer  qué hacer al llegar a cero, con el índice del jugador.
   *                  Se llama DESPUÉS de cancelar el reloj, para que lo que
   *                  haga —saltar el turno, redibujar— no encuentre en pie un
   *                  reloj que ya venció.
   */
  function iniciarRelojTurno(fase, indice, alVencer) {
    cancelarRelojTurno();
    relojTurno = {
      fase,
      indice,
      fin: Date.now() + msTurno,
      intervalo: setInterval(() => {
        pintarReloj();
        if (relojTurno && Date.now() >= relojTurno.fin) {
          const quien = relojTurno.indice;
          cancelarRelojTurno();
          alVencer(quien);
        }
      }, 120),
    };
    pintarReloj();
  }

  /** Qué fase e índice está contando, o null. Sólo para consultar. */
  const turnoEnCurso = () => (relojTurno ? { fase: relojTurno.fase, indice: relojTurno.indice } : null);

  return { correr, cancelar, pintarReloj, cancelarRelojTurno, iniciarRelojTurno, turnoEnCurso };
}
