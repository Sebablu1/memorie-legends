/**
 * Un avatar, en grande y nada más.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ MUESTRA, Y QUÉ NO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El dibujo, centrado, hasta 320 px. Sin nombre, sin precio, sin descripción
 * y sin botones.
 *
 * Los 320 son de PANTALLA; el archivo mide 512. No es un descuido: en un
 * teléfono de 3× esos 320 CSS son 960 píxeles de verdad, así que con un
 * archivo de 320 el navegador agrandaba ×3 y el pelo se empastaba. Con 512
 * agranda ×1,88 y los mechones se separan. Medido con una comparación lado a
 * lado a 3×, no supuesto.
 *
 * Tampoco se llega a los 960, y es a propósito: 768 los cubriría casi enteros
 * y costaría el doble que 512 en una imagen que ya pesa 80 KB.
 *
 * Es a propósito: la tarjeta de la tienda ya dice todo eso a dos centímetros,
 * y repetirlo acá obligaría a mantener dos versiones del mismo texto. Lo único
 * que la tarjeta NO puede dar es el dibujo a un tamaño donde se vea el
 * trabajo, porque ahí mide 120 px.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DE DÓNDE SALE LA FORMA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Del cartel del código privado (`sala-privada.js`), que es la ventana más
 * completa del sitio, y de ahí vienen las tres decisiones que no se ven:
 *
 *   · SE MUDA AL `<body>`. Un ancestro con `transform` o `filter` convierte
 *     cualquier `position: fixed` en relativo a él, y la ventana quedaría
 *     encerrada en la tarjeta. Las de la tienda tienen degradado y viven
 *     dentro de un `.panel`.
 *
 *   · `inert` EN TODO LO DEMÁS, en vez de una trampa de foco escrita a mano
 *     —que hay que mantener y que se rompe con cada elemento nuevo—. Saca lo
 *     que hay detrás del tabulado Y del lector de pantalla de una sola vez.
 *
 *   · EL FOCO VUELVE a donde estaba. Con teclado, cerrar no puede dejar a
 *     nadie al principio de la página.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE HACE DISTINTO: TOCAR EL FONDO CIERRA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El cartel del código NO cierra al tocar el velo, y tiene razón: ahí el toque
 * de más cuesta un código que no se vuelve a mostrar. Acá no se pierde nada —
 * se vuelve a abrir tocando el mismo avatar— así que la salida fácil es la
 * correcta.
 *
 * El modal de la mesa (`modulos/ui.js`) no servía para esto: depende de un
 * `#velo` y un `#modal` que sólo existen en `mesa.html` y `room.html`, y le
 * inyecta a todas sus ventanas el reloj del turno.
 */

/** La cruz, dibujada y no escrita: una «×» de texto cambia de forma por fuente. */
const CRUZ = `<svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
  <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor"
        stroke-width="2.2" stroke-linecap="round" />
</svg>`;

/**
 * Abre la ventana con una imagen.
 *
 * @param {string} src     la dirección de la imagen, ya con su versión
 * @param {object} [opciones]
 * @param {string} [opciones.etiqueta]  el nombre accesible de la ventana
 * @returns {Function} para cerrarla desde afuera
 */
export function abrirZoom(src, { etiqueta = "Avatar en grande" } = {}) {
  // Si ya había una abierta —dos toques rápidos en dos avatares— se cierra
  // antes. Dos ventanas apiladas dejarían la de abajo inalcanzable y con su
  // `inert` puesto sobre la de arriba.
  document.querySelector(".zoom-avatar")?.remove();

  const velo = document.createElement("div");
  velo.className = "zoom-avatar";

  const caja = document.createElement("div");
  caja.className = "zoom-caja";
  caja.setAttribute("role", "dialog");
  caja.setAttribute("aria-modal", "true");
  caja.setAttribute("aria-label", etiqueta);
  caja.tabIndex = -1;

  const cerrarBtn = document.createElement("button");
  cerrarBtn.type = "button";
  cerrarBtn.className = "cerrar-zoom";
  cerrarBtn.setAttribute("aria-label", "Cerrar");
  cerrarBtn.innerHTML = CRUZ;

  const img = document.createElement("img");
  // `src` por propiedad y no por plantilla: no hay escapado que valga sobre un
  // `innerHTML` con una dirección adentro, y acá además viene del catálogo,
  // que lo escribe un administrador.
  img.src = src;
  img.alt = "";

  caja.append(cerrarBtn, img);
  velo.append(caja);
  document.body.append(velo);

  const loDemas = [...document.body.children].filter((e) => e !== velo);
  for (const e of loDemas) e.inert = true;

  const volverA = document.activeElement;
  caja.focus();

  const cerrar = () => {
    document.removeEventListener("keydown", enTecla);
    for (const e of loDemas) e.inert = false;
    velo.remove();
    if (volverA instanceof HTMLElement && volverA.isConnected) volverA.focus();
  };

  const enTecla = (evento) => {
    if (evento.key === "Escape") cerrar();
  };
  document.addEventListener("keydown", enTecla);

  cerrarBtn.addEventListener("click", cerrar);

  // El fondo cierra; la caja no. Se compara contra `velo` y no se usa
  // `closest`: un clic sobre la imagen tiene al velo entre sus ancestros, así
  // que preguntar por el ancestro cerraría también tocando el dibujo.
  velo.addEventListener("click", (evento) => {
    if (evento.target === velo) cerrar();
  });

  return cerrar;
}
