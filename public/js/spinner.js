/**
 * El indicador de "esperando al servidor".
 *
 * CUÁNDO APARECE, Y CUÁNDO NO
 *
 * No aparece apenas se manda un pedido. Espera un momento primero, y ésa es la
 * decisión que importa: una llamada que vuelve en 120 ms con el spinner puesto
 * produce un parpadeo que se lee como un fallo, no como una espera. La mayoría
 * de las jugadas vuelven así de rápido, y para ésas lo mejor es no mostrar
 * nada.
 *
 * Con el retraso, sólo se ve cuando de verdad hay que esperar.
 *
 * NO BLOQUEA
 *
 * El indicador no tapa la mesa ni intercepta clics. Quien decide si una acción
 * se puede pedir es `pedir()`, con su bandera `pidiendo`; si además esto
 * pusiera un velo por encima, habría dos cosas decidiendo lo mismo y bastaría
 * con que una se quedara colgada para dejar la mesa muerta. Ya pasó algo así
 * con un parche que congelaba el repintado.
 */

/** Cuánto se espera antes de mostrar nada. */
const MS_ANTES_DE_MOSTRAR = 400;

let caja = null;
let pendiente = null;
let cuantos = 0;

function asegurarCaja() {
  if (caja) return caja;
  caja = document.getElementById("cargando");
  if (caja) return caja;

  caja = document.createElement("div");
  caja.id = "cargando";
  caja.className = "cargando-global";
  caja.hidden = true;
  // `role="status"` y `aria-live="polite"`: se anuncia una vez, sin cortar lo
  // que el lector esté diciendo. El aro que gira es decorativo.
  caja.setAttribute("role", "status");
  caja.setAttribute("aria-live", "polite");
  caja.innerHTML = '<span class="aro" aria-hidden="true"></span><span class="texto"></span>';
  document.body.appendChild(caja);
  return caja;
}

/**
 * Muestra el indicador, con retraso.
 *
 * Cuenta llamadas anidadas: dos acciones a la vez no dejan el indicador colgado
 * cuando termina la primera.
 */
export function mostrarCargando(texto = "Enviando…") {
  cuantos++;
  if (pendiente) return;

  pendiente = setTimeout(() => {
    pendiente = null;
    if (cuantos <= 0) return;
    const c = asegurarCaja();
    c.querySelector(".texto").textContent = texto;
    c.hidden = false;
  }, MS_ANTES_DE_MOSTRAR);
}

/** Lo esconde. Si la espera fue corta, no llegó a verse nunca. */
export function ocultarCargando() {
  cuantos = Math.max(0, cuantos - 1);
  if (cuantos > 0) return;

  if (pendiente) {
    clearTimeout(pendiente);
    pendiente = null;
  }
  if (caja) caja.hidden = true;
}

/**
 * Envuelve una promesa: muestra mientras corre y esconde pase lo que pase.
 *
 * El `finally` es lo que evita el indicador eterno. Sin él, una jugada que
 * falla deja girando un aro que ya no espera nada.
 */
export async function conCargando(promesa, texto) {
  mostrarCargando(texto);
  try {
    return await promesa;
  } finally {
    ocultarCargando();
  }
}
