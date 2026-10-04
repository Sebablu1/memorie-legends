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

/** El link corto que lleva al lobby con el código ya puesto. */
export const linkDeInvitacion = (codigo) => `https://memorielegends.com/s/${codigo}`;

/**
 * El mensaje para invitar.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL LINK VA SOLO, EN SU PROPIA LÍNEA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque WhatsApp decide el TAMAÑO de la vista previa según cuánto texto
 * rodea al enlace. Con el link enterrado en una frase —como estaba— muestra la
 * versión compacta, que recorta la tarjeta a un cuadrado y parte el logo por
 * la mitad. Con el link separado y al final, muestra la grande, que es la que
 * se ve entera.
 *
 * Se comprobó con dos mensajes reales puestos uno al lado del otro: el que era
 * sólo un enlace salió grande y el que lo llevaba adentro de una oración, en
 * miniatura y cortado.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ UN LINK Y NO EL CÓDIGO SUELTO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque en WhatsApp no se puede copiar un pedazo de un mensaje: al tocarlo se
 * copia entero. Quien recibía «…usá el código ABCD1234 para unirte…» tenía que
 * transcribirlo a mano. Tocando el link, el código llega solo al campo.
 *
 * El cartel sigue mostrando el código además del link, para quien prefiera
 * dictarlo o pegarlo por otro lado.
 */
export const mensajeDeInvitacion = (codigo) =>
  `Te invito a jugar Memorie Legends conmigo:\n\n${linkDeInvitacion(codigo)}`;

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

/* Los íconos de los botones. Quietos los dos: una flecha acá diría «esto te
   lleva afuera», y afuera lleva uno solo, el de WhatsApp. */
const ICONO_COPIAR = `<svg class="icono" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2.5" />
      <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-7A2.5 2.5 0 0 0 3 5.5v7A2.5 2.5 0 0 0 5.5 15" />
    </svg>`;

const ICONO_ENTRAR = `<svg class="icono" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8" />
      <path d="M18 12H10" />
      <path d="M15 9l3 3-3 3" />
    </svg>`;

/** El cajón del menú, si estuviera abierto, se cierra antes de la ventana. */
function cerrarElMenu() {
  const cajon = document.getElementById("cajonMenu");
  if (cajon?.classList.contains("abierto")) cajon.querySelector(".cerrar-menu")?.click();
}

/**
 * El cartel, dentro de `caja`.
 *
 * El logo es el archivo oficial del kit de marca de WhatsApp, sin tocar: el
 * BLANCO, que es el que corresponde sobre el verde de la marca, al lado de la
 * palabra y nunca en su lugar. `pruebas/sitio.mjs` compara su huella con la
 * del archivo del kit y mira cómo se usa acá.
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
      <div class="fila-link">
        <span class="link-invitacion" id="linkInvitacion"><span id="linkBase"></span><span class="link-codigo" id="linkCodigo"></span></span>
        <button class="copiar-link" id="btnCopiarLink" type="button" aria-label="Copiar el link">${ICONO_COPIAR}</button>
      </div>
      <p class="fila-reloj" id="filaReloj" hidden>${RELOJ}<span class="vigencia-codigo" id="vigenciaCodigo"></span></p>
      <div class="botonera-codigo">
        <button class="accion boton-copiar" id="btnCopiarCodigoPrivado" type="button">${ICONO_COPIAR}<span class="texto">Copiar</span></button>
        <a class="accion boton-whatsapp" id="enlaceWhatsApp" href="https://wa.me/" target="_blank" rel="noopener noreferrer"><img src="img/whatsapp/Digital_Glyph_White_RGB_2026.svg" alt="" width="28" height="28" /><span class="texto"><span class="mayusculas">Compartir por</span> WhatsApp</span></a>
        <button class="accion boton-entrar" id="btnEntrarSala" type="button">${ICONO_ENTRAR}<span class="texto">Entrar a la sala</span></button>
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
  /**
   * `type` va PRIMERO, y no es decorativo.
   *
   * La lista «Redes sociales» de AdGuard trae seis reglas que esconden los
   * botones de compartir por WhatsApp, y las seis son por PREFIJO. La que
   * pegaba acá es su línea 15048:
   *
   *   ~whatsapp.com##a[href^="https://api.whatsapp.com/send?text="]
   *
   * Con otro parámetro delante, el `href` deja de empezar con esa cadena y
   * ninguna de las seis matchea. WhatsApp ignora lo que no conoce: comprobado
   * contra el servidor, las dos formas devuelven la misma página con el
   * mensaje ya escrito.
   *
   * Lo que esto NO resuelve: una regla por SUBCADENA —`a[href*="whatsapp"]`—
   * contra la que no hay dirección que sirva, porque el enlace tiene que
   * apuntar a WhatsApp. Hoy ninguna lista la tiene.
   */
  $("enlaceWhatsApp").href =
    `https://api.whatsapp.com/send?type=text&text=${encodeURIComponent(mensaje)}`;

  /*
   * El link, a la vista y con su propio botón de copiar.
   *
   * Va además del código, no en su lugar: el link sirve para mandarlo por
   * cualquier lado, y el código para dictarlo por teléfono o escribirlo a
   * mano. Sacar uno de los dos deja sin salida a la mitad de los casos.
   *
   * Se escribe con `textContent` y no con `innerHTML`: el código viene del
   * servidor, pero esta caja se arma con una plantilla y meter texto de
   * afuera como HTML es exactamente la costumbre que no queremos tomar.
   */
  /*
   * El link se escribe en DOS pedazos: la dirección y el código.
   *
   * No es un capricho de marcado. En un teléfono angosto el link no entra en
   * una línea, y partiéndolo donde sea cortaba el código a la mitad —`…/s/DZ2TP`
   * arriba y `UDH` abajo—. Un código partido se lee mal, se dicta peor, y
   * alguien lo va a copiar a mano sin la segunda mitad.
   *
   * Con el código en su propio elemento, el CSS le pone `white-space: nowrap`
   * y sólo a él: la dirección se parte si hace falta y el código no.
   */
  const link = linkDeInvitacion(codigo);
  $("linkBase").textContent = link.slice(0, link.length - codigo.length);
  $("linkCodigo").textContent = codigo;

  const copiarLink = $("btnCopiarLink");
  copiarLink.onclick = async () => {
    try {
      await navigator.clipboard.writeText(link);
      // El acuse va en el rótulo para lectores de pantalla y en una clase
      // para el ojo: el botón es sólo un ícono y no tiene dónde poner texto.
      copiarLink.classList.add("copiado");
      copiarLink.setAttribute("aria-label", "Link copiado");
      setTimeout(() => {
        copiarLink.classList.remove("copiado");
        copiarLink.setAttribute("aria-label", "Copiar el link");
      }, 2000);
    } catch {
      // Igual que el otro: el link está en pantalla y se puede copiar a mano.
    }
  };

  // Tres botones, los tres siempre a la vista y ninguno se convierte en otro:
  // copiar el código, compartirlo por WhatsApp, y entrar a la sala. Lo único
  // que cambia es el acuse de «Copiar», que vuelve solo a los dos segundos.
  const copiar = $("btnCopiarCodigoPrivado");
  // Se escribe la ETIQUETA, no el botón: `textContent` sobre el botón entero
  // borraría el ícono, que es un hijo más.
  const etiquetaCopiar = copiar.querySelector(".texto");
  copiar.onclick = async () => {
    try {
      await navigator.clipboard.writeText(codigo);
      etiquetaCopiar.textContent = "¡Copiado!";
      // Dos segundos con el acuse a la vista, y vuelve a decir lo que hace.
      setTimeout(() => { etiquetaCopiar.textContent = "Copiar"; }, 2000);
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
