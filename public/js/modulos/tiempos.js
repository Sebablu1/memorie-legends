/**
 * El cronómetro de la mesa: cuánto dura de VERDAD cada fase.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PARA QUÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El reglamento dice que el descarte dura cinco segundos y el motor tiene
 * `MS_DESCARTE = 5000`. Entre esas dos cosas y lo que vive el jugador hay un
 * navegador, tres IA con temporizadores propios, una pestaña que se puede ir
 * a segundo plano y —en red— un servidor y la latencia.
 *
 * Nada de eso lo mide una prueba de reglas: el motor sigue diciendo 5000
 * aunque en pantalla la ventana dure tres segundos o siete. Esto mide lo que
 * pasó, no lo que estaba escrito.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ ES UNA FASE ACÁ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un tramo con reloj: la mesa muestra la barra grande, corre un tiempo y se
 * cierra. Abrir una cierra la anterior, porque la mesa nunca tiene dos barras
 * a la vez. Lo que no tiene reloj —el reparto, el modal de fin de ronda— no
 * pasa por acá.
 *
 * `configurado` es lo que se pidió; `real`, lo que se midió al cerrar. La
 * diferencia es el dato: si una fase cierra sistemáticamente antes, alguien
 * la está cortando.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NO CAMBIA NADA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Mide y guarda. El panel sólo aparece con `?debug-tiempos=1`, y sin él esto
 * sigue midiendo en silencio: cuesta un objeto por fase y nada más, y así el
 * historial está entero cuando alguien abre el panel a mitad de partida.
 */

/** Cuántas fases cerradas se recuerdan. Las viejas se van por el principio. */
export const TOPE_HISTORIAL = 60;

/**
 * @param ahora  de dónde sale la hora. Se inyecta para poder probarlo sin
 *               esperar cinco segundos de verdad.
 */
export function crearMedidorDeTiempos({ ahora = () => Date.now() } = {}) {
  let abierta = null;
  let ronda = 0;
  const cerradas = [];

  /** Cierra la que esté abierta y la guarda en el historial. */
  function cerrar(motivo = "fin") {
    if (!abierta) return null;
    const real = ahora() - abierta.desde;
    const fila = {
      ronda: abierta.ronda,
      fase: abierta.fase,
      configurado: abierta.configurado,
      real,
      // Positivo: duró de más. Negativo: se cortó antes.
      desvio: real - abierta.configurado,
      motivo,
    };
    cerradas.push(fila);
    if (cerradas.length > TOPE_HISTORIAL) cerradas.shift();
    abierta = null;
    return fila;
  }

  /**
   * Abre una fase con reloj. Cierra la anterior, si había.
   *
   * `configurado` puede venir sin número —una fase sin duración fija— y
   * entonces no hay desvío que calcular: queda en null.
   */
  function abrir(fase, configurado) {
    cerrar("reemplazada");
    abierta = {
      fase: String(fase ?? "?"),
      configurado: Number.isFinite(configurado) ? Math.round(configurado) : null,
      desde: ahora(),
      ronda,
    };
    return abierta;
  }

  /** Lo que está corriendo ahora, con lo que lleva y lo que le queda. */
  function enCurso() {
    if (!abierta) return null;
    const transcurrido = ahora() - abierta.desde;
    return {
      fase: abierta.fase,
      ronda: abierta.ronda,
      configurado: abierta.configurado,
      transcurrido,
      restante: abierta.configurado == null
        ? null
        : Math.max(0, abierta.configurado - transcurrido),
    };
  }

  return {
    abrir,
    cerrar,
    enCurso,
    /** La ronda a la que se le anotan las fases que vengan. */
    ronda: (n) => { ronda = Number(n) || 0; },
    historial: () => cerradas.map((f) => ({ ...f })),
    /** Las de una fase concreta, para preguntarle «¿cuánto duró el descarte?». */
    de: (fase) => cerradas.filter((f) => f.fase === fase).map((f) => ({ ...f })),
  };
}

/**
 * El panel de `?debug-tiempos=1`.
 *
 * Fuera del juego: no recibe toques, no ocupa sitio en la mesa y no existe si
 * no se lo pide. Se repinta diez veces por segundo, que es suficiente para
 * ver correr el restante sin que se note en el consumo.
 *
 * Devuelve una función para apagarlo, que usan las pruebas.
 */
export function encenderPanelDeTiempos(medidor, { document: doc = document } = {}) {
  const caja = doc.createElement("div");
  caja.className = "debug-tiempos";
  caja.setAttribute("aria-hidden", "true");
  doc.body.appendChild(caja);

  const seg = (ms) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)}s`);
  const signo = (ms) => (ms > 0 ? `+${seg(ms)}` : seg(ms));

  const pintar = () => {
    const ahora = medidor.enCurso();
    const filas = medidor.historial().slice(-12).reverse();

    caja.innerHTML = `
      <b>⏱ tiempos</b>
      ${ahora
        ? `<div class="en-curso">
             <b>${escapar(ahora.fase)}</b> · r${ahora.ronda}
             <br>lleva ${seg(ahora.transcurrido)} de ${seg(ahora.configurado)}
             <br>queda ${seg(ahora.restante)}
           </div>`
        : `<div class="en-curso">sin reloj</div>`}
      <table>
        <tr><th>r</th><th>fase</th><th>pedido</th><th>real</th><th>Δ</th></tr>
        ${filas
          .map(
            (f) => `<tr class="${Math.abs(f.desvio ?? 0) > 500 ? "lejos" : ""}">
                      <td>${f.ronda}</td><td>${escapar(f.fase)}</td>
                      <td>${seg(f.configurado)}</td><td>${seg(f.real)}</td>
                      <td>${f.configurado == null ? "—" : signo(f.desvio)}</td>
                    </tr>`,
          )
          .join("")}
      </table>`;
  };

  pintar();
  const latido = setInterval(pintar, 100);
  return () => {
    clearInterval(latido);
    caja.remove();
  };
}

/** Los nombres de fase salen del juego, pero el panel no se fía de nadie. */
const escapar = (t) =>
  String(t).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
