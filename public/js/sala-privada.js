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
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ES UNA VENTANA Y NO UN CARTEL DENTRO DE LA PÁGINA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque el código se muestra UNA vez. Mientras está a la vista, nada puede
 * taparlo ni llevarse el foco: el resto de la página queda apagado con
 * `inert` —la misma técnica del cajón del menú— y el velo va por encima de
 * todo lo demás del sitio.
 *
 * Y se muda al `<body>`. Vive dentro de la tarjeta de jugar, y un ancestro con
 * `transform` o `filter` convierte cualquier `position: fixed` en relativo a
 * él: la ventana quedaría encerrada en la tarjeta. `menu.js` muda el cajón por
 * lo mismo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DOS SALIDAS, Y NINGUNA POR ACCIDENTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   · «Ya lo copié» entra a la sala.
 *   · La cruz y la tecla Escape cierran y dejan la página como estaba. La sala
 *     ya existe y queda listada en «Mis salas»; lo que no vuelve es el código.
 *
 * Tocar el velo NO cierra. El toque de más en el velo es el accidente típico,
 * y acá el accidente cuesta el código.
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

/* ─────────────────────────────────────────── los dibujos del marco

   Van en línea y no como archivos: son cuatro adornos chicos que aparecen de
   golpe, junto con el código, y cuatro pedidos de red en ese momento se verían
   como un cartel que se arma a pedazos. Todos llevan `aria-hidden`: no dicen
   nada que el texto no diga.

   El rizo de la esquina es UNO solo, repetido cuatro veces y espejado con CSS:
   una carta de tarot tiene el mismo adorno en las cuatro puntas. */
const RIZO = `<svg class="rizo" viewBox="0 0 48 48" aria-hidden="true">
      <path d="M1 47V15C1 7.3 7.3 1 15 1h32" />
      <path class="tenue" d="M7 41V17c0-5 4-10 10-10h24" />
    </svg>`;

const CORONA = `<svg viewBox="0 0 120 44" aria-hidden="true">
      <path d="M32 36h56l-5-22-12 9L60 6 49 23l-12-9z" />
      <circle cx="60" cy="3" r="3" />
      <path d="M8 22l5-5 5 5-5 5z" />
      <path d="M102 22l5-5 5 5-5 5z" />
    </svg>`;

const RELOJ = `<svg class="reloj" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6.5V12l3.8 2.2" />
    </svg>`;

/** El cajón del menú, si estuviera abierto, se cierra antes de la ventana. */
function cerrarElMenu() {
  const cajon = document.getElementById("cajonMenu");
  if (cajon?.classList.contains("abierto")) cajon.querySelector(".cerrar-menu")?.click();
}

/**
 * El cartel, dentro de `caja`.
 *
 * El logo es el archivo oficial del kit de marca de WhatsApp, sin tocar:
 * verde, chico y al lado de la palabra, nunca en su lugar. `pruebas/sitio.mjs`
 * compara su huella con la del archivo del kit y mira cómo se usa acá.
 */
export function mostrarCodigoPrivado(caja, { codigo, sala, vence, alCerrar } = {}) {
  caja.innerHTML = `
    <div class="cartel-tarot" role="dialog" aria-modal="true" aria-labelledby="tituloCartel" tabindex="-1">
      ${RIZO}${RIZO}${RIZO}${RIZO}
      <button class="cerrar-cartel" id="btnCerrarCartel" type="button" aria-label="Cerrar">×</button>
      <p class="corona" aria-hidden="true">${CORONA}</p>
      <p class="titulo-codigo" id="tituloCartel">Tu sala privada está abierta</p>
      <div class="placa-codigo">
        <span class="diamante" aria-hidden="true"></span>
        <p class="codigo-grande" id="codigoPrivadoTexto"></p>
        <span class="diamante" aria-hidden="true"></span>
      </div>
      <p class="aviso-codigo"><b>Copiá este código ahora. No se vuelve a mostrar.</b></p>
      <p class="fila-reloj" id="filaReloj" hidden>${RELOJ}<span class="vigencia-codigo" id="vigenciaCodigo"></span></p>
      <div class="botonera-codigo">
        <button class="accion sobria" id="btnCopiarCodigoPrivado" type="button">Copiar</button>
        <a class="accion sobria boton-whatsapp" id="enlaceWhatsApp" href="https://wa.me/" target="_blank" rel="noopener noreferrer"><img src="img/whatsapp/Digital_Glyph_Green_RGB_2026.svg" alt="" width="20" height="20" /><span>Compartir por WhatsApp</span></a>
        <button class="accion" id="btnEntrarSala" type="button">Entrar a la sala</button>
      </div>
    </div>`;
  const $ = (id) => caja.querySelector(`#${id}`);

  $("codigoPrivadoTexto").textContent = agrupado(codigo);

  // Cuánto vale, según el servidor: el número no se escribe acá.
  const minutos = Math.round((Number(vence) - Date.now()) / 60_000);
  if (Number.isFinite(minutos) && minutos > 0) {
    $("vigenciaCodigo").textContent = `Vale ${minutos} ${minutos === 1 ? "minuto" : "minutos"}.`;
    $("filaReloj").hidden = false;
  }

  const mensaje = mensajeDeInvitacion(codigo);
  $("enlaceWhatsApp").href = `https://wa.me/?text=${encodeURIComponent(mensaje)}`;

  // Tres botones, los tres siempre a la vista y ninguno se convierte en otro:
  // copiar el código, compartirlo por WhatsApp, y entrar a la sala. Lo único
  // que cambia es el acuse de «Copiar», que vuelve solo a los dos segundos.
  const copiar = $("btnCopiarCodigoPrivado");
  copiar.onclick = async () => {
    try {
      await navigator.clipboard.writeText(codigo);
      copiar.textContent = "¡Copiado!";
      // Dos segundos con el acuse a la vista, y vuelve a decir lo que hace.
      setTimeout(() => { copiar.textContent = "Copiar"; }, 2000);
    } catch {
      // Si el navegador no deja copiar, el botón no miente ni cambia de
      // trabajo: el código está en pantalla, se puede copiar a mano, y entrar
      // a la sala es otro botón que no depende de esto.
    }
  };

  $("btnEntrarSala").onclick = () => irALaSala(sala);

  abrirLaVentana(caja, alCerrar);
}

/**
 * Pone la ventana en pantalla: la muda al cuerpo, apaga el resto y escucha la
 * tecla de salida. Devuelve la función que la cierra.
 */
function abrirLaVentana(caja, alCerrar) {
  cerrarElMenu();
  if (caja.parentElement !== document.body) document.body.append(caja);
  caja.hidden = false;
  document.body.classList.add("con-cartel-abierto");

  // Todo lo demás del cuerpo queda fuera del tabulado Y del lector de
  // pantalla. Es lo mismo que hace el cajón del menú, y por el mismo motivo:
  // una trampa de foco escrita a mano se rompe con cada elemento nuevo.
  const loDemas = [...document.body.children].filter((e) => e !== caja);
  for (const e of loDemas) e.inert = true;

  const volverA = document.activeElement;
  caja.querySelector(".cartel-tarot").focus();

  const cerrar = () => {
    document.removeEventListener("keydown", enTecla);
    for (const e of loDemas) e.inert = false;
    document.body.classList.remove("con-cartel-abierto");
    caja.hidden = true;
    caja.innerHTML = "";
    // El foco vuelve a donde estaba: con teclado, cerrar no puede dejar a
    // nadie al principio de la página.
    if (volverA instanceof HTMLElement && volverA.isConnected) volverA.focus();
    alCerrar?.();
  };

  const enTecla = (e) => {
    if (e.key === "Escape") cerrar();
  };
  document.addEventListener("keydown", enTecla);
  caja.querySelector("#btnCerrarCartel").onclick = cerrar;
  return cerrar;
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
    // Al cerrar la ventana, el botón vuelve a estar disponible: la sala quedó
    // creada y listada, y quien quiera abrir otra puede.
    const devolverElBoton = () => {
      boton.disabled = false;
      boton.textContent = textoOriginal;
    };
    mostrarCodigoPrivado(caja, { codigo, sala, vence, alCerrar: devolverElBoton });
    // Queda deshabilitado mientras se ve el cartel: se sigue con «Ya lo copié».
    boton.textContent = "Sala creada";
  } catch (error) {
    avisar?.(error instanceof ErrorDeServidor ? error.message : "No pudimos crear la sala.", "error");
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}
