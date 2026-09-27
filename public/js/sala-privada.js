/**
 * Crear una sala privada y mostrar su código. Lo usan el tablero y el lobby.
 *
 * El cartel se dibuja desde acá y no está en el HTML de cada página: así hay un
 * solo cartel, con sus textos, su logo y sus botones, y no dos copias que se
 * desacomoden. Cada página pone un `<div class="codigo-privado" hidden>` vacío
 * donde va.
 *
 * El código no está guardado en claro en ninguna parte —la base tiene sólo su
 * resumen—: si se cierra el cartel sin copiarlo, la única salida es abrir otra
 * sala. Por eso el aviso, y por eso el botón para seguir, «Ya lo copié», va
 * DESPUÉS de los de copiar y compartir. El código no va en ninguna dirección
 * del sitio ni se guarda en el navegador: viaja sólo dentro del mensaje que la
 * persona decide mandar.
 */

import { crearSalaPrivada, ErrorDeServidor } from "./servidor.js";
import { irALaSala } from "./entrar-por-codigo.js";

/**
 * El mensaje para invitar. El código va SIN el espacio con que se lo muestra:
 * el campo donde se escribe acepta ocho caracteres, y pegado con el espacio
 * se perdería la última letra.
 */
export const mensajeDeInvitacion = (codigo) =>
  "Te invito a jugar Memorie Legends conmigo. Entrá a https://memorielegends.com/lobby.html " +
  `y usá el código ${codigo} para unirte a mi sala privada.`;

/** «ABCD EFGH»: en dos grupos se lee y se dicta mejor. Sólo para mostrar. */
export const agrupado = (codigo) => codigo.replace(/^(.{4})(.+)$/, "$1 $2");

/**
 * El cartel, dentro de `caja`.
 *
 * El logo es el archivo oficial del kit de marca de WhatsApp, sin tocar:
 * verde, chico y al lado de la palabra, nunca en su lugar. `pruebas/sitio.mjs`
 * compara su huella con la del archivo del kit y mira cómo se usa acá.
 */
export function mostrarCodigoPrivado(caja, { codigo, sala, vence }) {
  caja.innerHTML = `
    <p class="titulo-codigo">Tu sala privada está abierta</p>
    <p class="codigo-grande" id="codigoPrivadoTexto"></p>
    <p class="aviso-codigo"><b>Copiá este código ahora. No se vuelve a mostrar.</b></p>
    <p class="vigencia-codigo" id="vigenciaCodigo" hidden></p>
    <div class="botonera-codigo">
      <button class="accion sobria" id="btnCopiarCodigoPrivado" type="button">Copiar</button>
      <a class="accion sobria boton-whatsapp" id="enlaceWhatsApp" href="https://wa.me/" target="_blank" rel="noopener noreferrer"><img src="img/whatsapp/Digital_Glyph_Green_RGB_2026.svg" alt="" width="20" height="20" /><span>Compartir por WhatsApp</span></a>
      <button class="accion sobria" id="btnCompartirCodigo" type="button" hidden>Compartir…</button>
      <button class="accion" id="btnYaLoCopie" type="button">Ya lo copié</button>
    </div>`;
  const $ = (id) => caja.querySelector(`#${id}`);

  $("codigoPrivadoTexto").textContent = agrupado(codigo);

  // Cuánto vale, según el servidor: el número no se escribe acá.
  const minutos = Math.round((Number(vence) - Date.now()) / 60_000);
  if (Number.isFinite(minutos) && minutos > 0) {
    $("vigenciaCodigo").textContent = `Vale ${minutos} ${minutos === 1 ? "minuto" : "minutos"}.`;
    $("vigenciaCodigo").hidden = false;
  }

  const mensaje = mensajeDeInvitacion(codigo);
  $("enlaceWhatsApp").href = `https://wa.me/?text=${encodeURIComponent(mensaje)}`;

  // Sólo donde el navegador sabe compartir: sobre todo, teléfonos.
  if (typeof navigator.share === "function") {
    $("btnCompartirCodigo").hidden = false;
    $("btnCompartirCodigo").onclick = () => navigator.share({ text: mensaje }).catch(() => {});
  }

  $("btnCopiarCodigoPrivado").onclick = async () => {
    try {
      await navigator.clipboard.writeText(codigo);
      $("btnCopiarCodigoPrivado").textContent = "¡Copiado!";
    } catch {
      $("btnCopiarCodigoPrivado").textContent = "Copialo a mano";
    }
  };
  $("btnYaLoCopie").onclick = () => irALaSala(sala);

  caja.hidden = false;
}

/**
 * El botón de crear: pide la sala y muestra el cartel.
 *
 * El saldo que se mira acá es un aviso por cortesía; el servidor lo vuelve a
 * comprobar y es el que decide.
 */
export async function crearYMostrar({ boton, caja, entrada, duracion, nombre, saldo, avisar, limpiarAviso }) {
  if (Number.isFinite(saldo) && saldo < entrada) {
    avisar?.(`Te faltan Leyendas: la entrada es de ${entrada} y tenés ${saldo}.`, "error");
    return;
  }

  const textoOriginal = boton.textContent;
  boton.disabled = true;
  boton.textContent = "Creando…";
  limpiarAviso?.();

  try {
    // Devuelve TRES cosas: el identificador de la sala, con el que se abre su
    // pantalla; el código, que se muestra una vez; y hasta cuándo vale.
    const { sala, codigo, vence } = await crearSalaPrivada(entrada, nombre, duracion);
    if (!caja) {
      // Sin el lugar del cartel —un HTML viejo en caché— igual no se pierde la sala.
      irALaSala(sala);
      return;
    }
    mostrarCodigoPrivado(caja, { codigo, sala, vence });
    // Queda deshabilitado mientras se ve el cartel: se sigue con «Ya lo copié».
    boton.textContent = "Sala creada";
  } catch (error) {
    avisar?.(error instanceof ErrorDeServidor ? error.message : "No pudimos crear la sala.", "error");
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}
