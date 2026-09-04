/**
 * El menú de la barra: horizontal en pantalla grande, cajón en el teléfono.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MUEVE LOS NODOS, NO LOS COPIA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El `<nav>` y el bloque `.derecha` que ya están en el HTML son los MISMOS
 * elementos que terminan dentro del cajón: se mudan de lugar, no se clonan.
 *
 * Importa por dos motivos, y los dos son fallos que una copia habría
 * provocado en silencio:
 *
 *   - `dashboard.js` destapa el enlace de Administración por id
 *     (`enlaceAdmin`). Con una copia habría dos elementos con ese id, el
 *     destape le tocaría a uno solo, y el del cajón se quedaría escondido —o
 *     peor, visible para quien no debe—.
 *   - `conectarBotonSalir()` engancha su escuchador en `#btnSalir`. Mover un
 *     nodo conserva sus escuchadores; copiarlo no. El botón del cajón sería
 *     un botón que no hace nada.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL CAJÓN CUELGA DEL `body` Y NO DE LA BARRA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque `.barra` tiene `backdrop-filter`, y eso la convierte en el bloque
 * contenedor de todo `position: fixed` que tenga adentro. Un cajón puesto ahí
 * mediría `inset: 0` contra la barra —cuarenta y pico de píxeles de alto— en
 * vez de contra la pantalla. Se ve raro y no hay CSS que lo arregle desde
 * adentro: hay que estar afuera.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL RESTO DE LA PÁGINA QUEDA `inert` MIENTRAS ESTÁ ABIERTO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * En vez de programar una trampa de foco a mano —que hay que mantener y que
 * se rompe con cada elemento nuevo— se apaga todo lo demás. `inert` saca esos
 * elementos del tabulado Y del lector de pantalla de una sola vez, que es
 * justo lo que un panel encima de la página necesita.
 */

/**
 * Hasta acá, en la barra no entra nada más que el logo y el botón.
 *
 * Ojo: esto YA NO decide si hay cajón. El cajón es el menú en todos los
 * tamaños —los enlaces viven siempre ahí— y lo único que este corte decide es
 * dónde se dibujan el saldo y el botón de salir: en la barra si hay lugar, y
 * dentro del cajón si no.
 *
 * 768px es el ancho de una tableta en vertical. Por debajo, el saldo al lado
 * del logo deja la barra apretada y sin aire.
 */
const CORTE = 768;

const barra = document.querySelector(".barra-contenido");
const nav = barra?.querySelector("nav");
const derecha = barra?.querySelector(".derecha");

// Sin barra, o con una barra vacía, no hay nada que plegar. Le pasa a las
// pantallas de entrar y de registro, que sólo tienen el logo.
if (barra && (nav || derecha)) {
  const angosta = window.matchMedia(`(max-width: ${CORTE}px)`);

  // ---------------------------------------------------------------- piezas

  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "hamburguesa";
  boton.id = "btnMenu";
  boton.setAttribute("aria-label", "Abrir menú");
  boton.setAttribute("aria-expanded", "false");
  boton.setAttribute("aria-controls", "cajonMenu");
  boton.innerHTML =
    '<span class="rayas" aria-hidden="true"><i></i><i></i><i></i></span>';
  barra.append(boton);

  const fondo = document.createElement("div");
  fondo.className = "fondo-menu";

  const cajon = document.createElement("div");
  cajon.className = "cajon-menu";
  cajon.id = "cajonMenu";
  // `dialog` y no `navigation`: lo que se anuncia es que hay algo encima de la
  // página esperando una decisión. El `<nav>` de adentro ya dice que es un
  // menú, y decirlo dos veces sólo alarga lo que el lector tiene que leer.
  cajon.setAttribute("role", "dialog");
  cajon.setAttribute("aria-modal", "true");
  cajon.setAttribute("aria-label", "Menú");

  // La portada no tiene `<nav>`: su barra son sólo "Iniciar sesión" y "Crear
  // cuenta". Sin esta marca, el CSS empuja esos dos botones al pie del cajón
  // —que es lo correcto cuando arriba hay una lista de enlaces— y queda una
  // pantalla casi vacía con dos botones abajo de todo.
  if (!nav) cajon.classList.add("sin-enlaces");

  const cabecera = document.createElement("div");
  cabecera.className = "cabecera-cajon";
  cabecera.innerHTML = '<p class="titulo-cajon">Menú</p>';

  const cerrar = document.createElement("button");
  cerrar.type = "button";
  cerrar.className = "cerrar-menu";
  cerrar.setAttribute("aria-label", "Cerrar menú");
  cerrar.innerHTML = '<span aria-hidden="true">×</span>';
  cabecera.append(cerrar);
  cajon.append(cabecera);

  document.body.append(fondo, cajon);

  // ------------------------------------------------------------- abrir y cerrar

  let abierto = false;

  /** Todo lo que NO es el cajón: se apaga mientras está abierto. */
  const loDemas = () =>
    [...document.body.children].filter((el) => el !== cajon && el !== fondo);

  function abrir() {
    if (abierto) return;
    abierto = true;

    cajon.classList.add("abierto");
    fondo.classList.add("visible");
    document.body.classList.add("con-menu-abierto");

    boton.setAttribute("aria-expanded", "true");
    boton.setAttribute("aria-label", "Cerrar menú");
    cajon.removeAttribute("inert");
    cajon.removeAttribute("aria-hidden");
    for (const el of loDemas()) el.inert = true;

    cerrar.focus();
  }

  function cerrarMenu({ devolverFoco = true } = {}) {
    if (!abierto) return;
    abierto = false;

    cajon.classList.remove("abierto");
    fondo.classList.remove("visible");
    document.body.classList.remove("con-menu-abierto");

    boton.setAttribute("aria-expanded", "false");
    boton.setAttribute("aria-label", "Abrir menú");
    for (const el of loDemas()) el.inert = false;

    // El foco vuelve al botón ANTES de apagar el cajón. Al revés, el foco
    // estaría adentro de algo que se acaba de volver `inert` y el navegador lo
    // manda al principio de la página: quien navega con teclado pierde el
    // lugar y tiene que tabular todo de nuevo.
    if (devolverFoco) boton.focus();
    apagarCajon();
  }

  /** Deja el cajón fuera del tabulado y del lector. */
  function apagarCajon() {
    cajon.inert = true;
    cajon.setAttribute("aria-hidden", "true");
  }

  // ------------------------------------------------------ dónde vive cada cosa

  /**
   * Muda el menú entre la barra y el cajón según el ancho.
   *
   * Se llama al arrancar y en cada cambio de tamaño. Como son los mismos
   * nodos, girar el teléfono no pierde nada: ni el escuchador de salir, ni el
   * estado del enlace de administración, ni el saldo ya pintado.
   */
  /**
   * La portada no tiene `<nav>`, y eso cambia las cosas.
   *
   * Su barra son "Iniciar sesión" y "Crear cuenta": no hay ningún menú que
   * plegar. En un teléfono igual conviene guardarlos —al lado del logo no
   * entran— pero en una pantalla ancha sobra lugar, y esconder las dos
   * llamadas principales detrás de un botón que además abriría un cuarto
   * vacío sería peor de todas las formas posibles.
   *
   * Así que ahí el hamburguesa se muestra sólo en pantalla angosta. Lo hace el
   * CSS con esta clase; la decisión de si existe un menú se toma acá, que es
   * donde se sabe.
   */
  if (!nav) boton.classList.add("solo-si-no-entra");

  function acomodar() {
    // Los enlaces viven SIEMPRE en el cajón, en cualquier tamaño.
    if (nav) cajon.append(nav);

    // El saldo y el botón de salir, en cambio, se quedan en la barra mientras
    // haya lugar. Es información que conviene tener a la vista sin abrir nada.
    if (derecha) {
      if (angosta.matches) cajon.append(derecha);
      else barra.insertBefore(derecha, boton);
    }

    if (!abierto) apagarCajon();
  }

  // --------------------------------------------------------------- escuchas

  boton.addEventListener("click", () => (abierto ? cerrarMenu() : abrir()));
  cerrar.addEventListener("click", () => cerrarMenu());
  fondo.addEventListener("click", () => cerrarMenu());

  // Tocar cualquier enlace o botón de adentro cierra.
  //
  // No es sólo prolijidad: en el tablero, "Jugar" es un salto a `#jugar` DENTRO
  // de la misma página. Sin esto, el cajón se queda abierto tapando justo el
  // panel al que se acaba de saltar.
  cajon.addEventListener("click", (evento) => {
    if (evento.target === cerrar || cerrar.contains(evento.target)) return;
    if (evento.target.closest("a, button")) cerrarMenu({ devolverFoco: false });
  });

  document.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape") cerrarMenu();
  });

  // `addEventListener` sobre el media query y no un `resize`: avisa una sola
  // vez, al cruzar el corte, en vez de en cada píxel que se arrastra.
  angosta.addEventListener("change", acomodar);
  acomodar();
}
