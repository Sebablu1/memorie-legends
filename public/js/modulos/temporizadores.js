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

  /**
   * Arranca la barra grande.
   *
   * Ya no lleva etiqueta ni sabe si es una ventana de reflejos. Llevaba las
   * dos cosas —"DESCARTE" y una clase que la pintaba de rojo— y las dos las
   * dice ahora el cartel: el rótulo es la pista, y el color sale de la fase.
   * Este reloj pinta lo único que sabe: cuánto queda.
   */
  function correr(ms) {
    cancelar();
    dom.temporizador.classList.add("activo");

    const fin = Date.now() + ms;
    const relleno = dom.temporizadorRelleno;

    // La barra se pinta a mano, tick a tick, igual que la del reloj del turno.
    //
    // Antes era una transición de CSS de `scaleX(1)` a `scaleX(0)` que duraba
    // lo mismo que la ventana. Se veía mejor —el navegador la interpola sin
    // pasar por JavaScript— pero se apagaba entera con `prefers-reduced-motion`:
    // la regla general que baja todas las transiciones a 0.05 ms la mandaba al
    // final de una, y quien tiene esa preferencia puesta veía la barra vacía
    // desde el primer momento. Vacía no es "sin animación": es un dato
    // equivocado, que dice que no queda tiempo cuando quedan cinco segundos.
    const pintar = () => {
      const restante = Math.max(0, fin - Date.now());
      dom.temporizadorTexto.textContent = `${(restante / 1000).toFixed(1)}s`;
      relleno.style.width = `${(restante / ms) * 100}%`;
    };
    pintar();
    temporizadorActual = setInterval(pintar, 80);
  }

  function cancelar() {
    if (temporizadorActual) clearInterval(temporizadorActual);
    temporizadorActual = null;
    dom.temporizador.classList.remove("activo");
  }

  // --------------------------------------------- el reloj del turno

  function pintarReloj() {
    const caja = dom.reloj;
    if (!caja) return;

    if (!relojTurno) {
      caja.hidden = true;
      dom.anuncio?.classList.remove("apurado");
      return;
    }

    const restante = Math.max(0, relojTurno.fin - Date.now());
    const segundos = Math.ceil(restante / 1000);

    caja.hidden = false;
    // Con la "s" puesta, y no un número pelado: los dos relojes viven en el
    // mismo cartel y tienen que leerse como lo mismo medido igual.
    dom.relojNumero.textContent = `${segundos}s`;
    // La barra se mide contra la duración de ESTE reloj, no contra una fija:
    // el de levantar dura 8 segundos y el de decidir el corte, 30. Con un
    // divisor único, el de 30 arrancaba con la barra ya casi vacía.
    dom.relojRelleno.style.width = `${(restante / relojTurno.ms) * 100}%`;
    // Dorado hasta los 2 segundos; de ahí en más, rojo. La marca va también en
    // el cartel, que es lo que se pinta: adentro está sólo la barra.
    const apurado = segundos <= 2;
    caja.classList.toggle("apurado", apurado);
    dom.anuncio?.classList.toggle("apurado", apurado);
  }

  function cancelarRelojTurno() {
    if (relojTurno?.intervalo) clearInterval(relojTurno.intervalo);
    relojTurno = null;
    if (dom.reloj) dom.reloj.hidden = true;
    // Sin esto el cartel se queda rojo después de que el reloj se fue.
    dom.anuncio?.classList.remove("apurado");
  }

  /**
   * @param alVencer  qué hacer al llegar a cero, con el índice del jugador.
   *                  Se llama DESPUÉS de cancelar el reloj, para que lo que
   *                  haga —saltar el turno, redibujar— no encuentre en pie un
   *                  reloj que ya venció.
   * @param ms        cuánto dura. Por defecto el del turno; la decisión de
   *                  cortar o pasar usa uno más largo.
   */
  function iniciarRelojTurno(fase, indice, alVencer, ms = msTurno) {
    cancelarRelojTurno();
    relojTurno = {
      fase,
      indice,
      ms,
      fin: Date.now() + ms,
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
