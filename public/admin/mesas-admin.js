/**
 * El diseño de la mesa, desde el panel.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NO ES EL CATÁLOGO, Y POR ESO ES UN MÓDULO APARTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La mesa no se compra, no se equipa y no aparece en la tienda: la pone la
 * casa y el jugador la encuentra puesta. Un artículo del catálogo tendría
 * precio, entraría en `misItems` y el servidor lo validaría con el esquema
 * de artículos — tres cosas que acá no significan nada.
 *
 * Vive en `config/mesa`, que el navegador puede LEER pero no escribir: las
 * reglas lo prohíben a propósito, porque un cliente que pudiera escribir ahí
 * le cambiaría la mesa a todo el mundo. De ahí que guardar sea un llamable.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL CONVERSOR NO SUBE NADA, Y ESTO TAMPOCO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El conversor del catálogo convierte y DESCARGA: no hay subida a ningún
 * lado, y hay una prueba que lo afirma. Así que el camino completo es:
 * convertir arriba, poner el archivo en `public/img/…`, desplegar, y recién
 * entonces escribir esa ruta acá.
 *
 * Esta pantalla guarda una RUTA, no un archivo. Decirlo en la nota de la
 * sección evita que alguien arrastre un PNG esperando que aparezca solo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA SALA ACEPTA DOS COSAS EN UN SOLO CAMPO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Una ruta o un color, y se distinguen por cómo empiezan — el mismo criterio
 * que el catálogo ya usa para «ruta o emoji». Dos campos, o un selector de
 * modo, obligarían a mantener sincronizado un estado que el valor ya dice.
 *
 * El color se guarda como hexadecimal y se convierte en
 * `linear-gradient(c, c)` AL DIBUJAR, no al guardar: ver `capaDeSala` en
 * `modulos/diseno-de-mesa.js`. Guardar el degradado armado dejaría en la
 * base un detalle de CSS en vez del dato, y el día que la capa se dibuje de
 * otra forma habría que migrar documentos.
 */

import { funciones, httpsCallable } from "../js/firebase.js";

const $ = (id) => document.getElementById(id);

const leerDiseno = httpsCallable(funciones, "leerDisenoDeMesaAdmin");
const guardarDiseno = httpsCallable(funciones, "guardarDisenoDeMesaAdmin");

/** Lo mismo que acepta el servidor, para avisar antes de ir y volver. */
const SIN_BRUJULA = "ninguna";
const esRuta = (v) => v.startsWith("/img/");
// 3, 4, 6 u 8 dígitos: las longitudes que CSS acepta. Cinco y siete se ven
// bien y no existen, y dejarlas pasar daría un color aceptado y sin efecto.
const esColor = (v) => /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v);

export function montarMesasAdmin() {
  const brujula = $("mesaBrujula");
  if (!brujula) return;

  const sala = $("mesaSala");
  const leido = $("mesaSalaLeido");
  const aviso = $("avisoMesa");

  const decir = (texto, clase = "") => {
    if (!aviso) return;
    aviso.textContent = texto;
    aviso.className = `aviso ${clase}`.trim();
  };

  /**
   * Qué entendió del campo de la sala, mientras se escribe.
   *
   * Un hexadecimal y una ruta no se parecen en nada, pero un `#1a1a2` de
   * cinco dígitos sí se parece a uno válido. Decir en el momento «esto lo
   * leo como un color» evita guardar algo que el servidor va a rechazar, y
   * sobre todo evita guardar algo que ACEPTE y no haga nada.
   */
  const mostrarLoLeido = () => {
    if (!leido || !sala) return;
    const v = sala.value.trim();
    if (!v) leido.textContent = "Vacío: queda la sala de siempre.";
    else if (esRuta(v)) leido.textContent = "Se lee como una imagen.";
    else if (esColor(v)) leido.textContent = "Se lee como un color plano.";
    else leido.textContent = "No se entiende: tiene que ser /img/… o #hexadecimal.";
  };

  async function cargar() {
    try {
      const { data } = await leerDiseno();
      // Un campo ausente es «lo de siempre», y el campo vacío lo dice igual.
      brujula.value = data?.diseno?.brujula ?? "";
      if (sala) sala.value = data?.diseno?.sala ?? "";
      mostrarLoLeido();
      decir("");
    } catch (error) {
      console.error("No se pudo leer el diseño de la mesa:", error);
      decir("No pudimos leer el diseño guardado.", "mal");
    }
  }

  /**
   * Guarda, o borra.
   *
   * `null` BORRA el campo y devuelve lo de siempre; un valor lo reemplaza.
   * El campo vacío se traduce a `null` acá y no en el servidor porque es una
   * decisión de esta pantalla: «lo dejé en blanco» quiere decir «volvé a lo
   * de antes».
   *
   * «Guardar» manda LOS DOS campos, y los botones de volver atrás mandan
   * uno solo. Es la diferencia entre guardar un formulario y deshacer una
   * cosa puntual: el formulario se cargó con lo que había, así que lo que
   * muestra ES el estado que se quiere dejar.
   */
  async function mandar(cambios, queDice) {
    try {
      decir("Guardando…");
      const { data } = await guardarDiseno(cambios);
      await cargar();
      decir(data?.guardado ? queDice : "No había nada que cambiar.", "bien");
    } catch (error) {
      console.error("No se pudo guardar el diseño de la mesa:", error);
      decir(error?.message ?? "No pudimos guardar el diseño.", "mal");
    }
  }

  sala?.addEventListener("input", mostrarLoLeido);

  $("btnGuardarMesa")?.addEventListener("click", () => {
    const cambios = {};

    const b = brujula.value.trim();
    if (!b) cambios.brujula = null;
    else if (b !== SIN_BRUJULA && !esRuta(b)) {
      // Se avisa acá además de en el servidor: un viaje de ida y vuelta para
      // que vuelva «la ruta tiene que empezar con /img/» es peor experiencia
      // que decirlo al instante. El servidor lo valida igual — esto es
      // comodidad, no seguridad.
      decir("La brújula tiene que ser una ruta /img/…, o la palabra «ninguna».", "mal");
      return;
    } else cambios.brujula = b;

    if (sala) {
      const s = sala.value.trim();
      if (!s) cambios.sala = null;
      else if (!esRuta(s) && !esColor(s)) {
        decir("La sala tiene que ser una ruta /img/… o un color #hexadecimal.", "mal");
        return;
      } else cambios.sala = s;
    }

    return mandar(cambios, "Listo. Recargá una mesa para verlo.");
  });

  $("btnBorrarBrujula")?.addEventListener("click", () => {
    brujula.value = "";
    mandar({ brujula: null }, "Listo: vuelve la brújula de siempre.");
  });

  $("btnBorrarSala")?.addEventListener("click", () => {
    if (sala) sala.value = "";
    mostrarLoLeido();
    mandar({ sala: null }, "Listo: vuelve la sala de siempre.");
  });

  cargar();
}
