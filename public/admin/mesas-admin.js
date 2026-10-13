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
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CUATRO MESAS, UN FORMULARIO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El selector no es un filtro: es A CUÁL DE LOS CUATRO DOCUMENTOS se está
 * escribiendo. Cada contexto vive en `config/mesa-{contexto}` y el que no
 * tenga el suyo hereda `config/mesa`, el global que escribía esta pantalla
 * antes de que hubiera contextos.
 *
 * Por eso el contexto viaja en LOS TRES caminos —«Guardar» y los dos botones
 * de volver atrás—. Un botón que lo olvidara borraría el campo del global en
 * vez del de la mesa que está en pantalla: se vería que «funcionó», la mesa
 * seguiría igual, y encima se habría tocado lo que ven las otras tres.
 *
 * Cambiar el selector RECARGA, así que descarta lo que haya escrito sin
 * guardar. Es a propósito: lo contrario sería arrastrar un valor tipeado
 * para una mesa hasta el formulario de otra, y guardar eso sin querer es
 * peor que volver a escribirlo.
 *
 * Las opciones se arman desde `CONTEXTOS_VALIDOS` y no a mano en el HTML: si
 * algún día hay un quinto contexto, aparece acá solo o no aparece en ningún
 * lado — y hay una prueba que lo afirma. Los nombres en castellano sí viven
 * acá, porque son de esta pantalla y no de las reglas.
 */

import { funciones, httpsCallable } from "../js/firebase.js";
import { CONTEXTOS_DE_MESA, CONTEXTOS_VALIDOS } from "../js/reglas/salas.js";

const $ = (id) => document.getElementById(id);

const leerDiseno = httpsCallable(funciones, "leerDisenoDeMesaAdmin");
const guardarDiseno = httpsCallable(funciones, "guardarDisenoDeMesaAdmin");

/** Lo mismo que acepta el servidor, para avisar antes de ir y volver. */
const SIN_BRUJULA = "ninguna";
const esRuta = (v) => v.startsWith("/img/");
// 3, 4, 6 u 8 dígitos: las longitudes que CSS acepta. Cinco y siete se ven
// bien y no existen, y dejarlas pasar daría un color aceptado y sin efecto.
const esColor = (v) => /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v);

/** Cómo se llama cada contexto para quien lo mira, no para el código. */
const NOMBRES_DE_CONTEXTO = {
  [CONTEXTOS_DE_MESA.ENTRENAMIENTO]: "Entrenamiento — contra la máquina",
  [CONTEXTOS_DE_MESA.PUBLICA]: "Pública — sala abierta",
  [CONTEXTOS_DE_MESA.PRIVADA]: "Privada — sala con código",
  [CONTEXTOS_DE_MESA.TORNEO]: "Torneo — se guarda, todavía no se usa",
};

export function montarMesasAdmin() {
  const brujula = $("mesaBrujula");
  if (!brujula) return;

  const sala = $("mesaSala");
  const leido = $("mesaSalaLeido");
  const aviso = $("avisoMesa");
  const contexto = $("mesaContexto");
  const deQuien = $("mesaContextoLeido");

  /*
   * Las cuatro opciones, desde las reglas.
   *
   * Un contexto sin nombre en castellano aparece con su clave: se ve fea
   * pero se ve, que es mejor que una mesa a la que no se le puede entrar.
   */
  if (contexto && !contexto.options.length) {
    for (const c of CONTEXTOS_VALIDOS) {
      const op = document.createElement("option");
      op.value = c;
      op.textContent = NOMBRES_DE_CONTEXTO[c] ?? c;
      contexto.append(op);
    }
  }

  /** A cuál de los cuatro documentos se está escribiendo. */
  const elegido = () => contexto?.value || CONTEXTOS_DE_MESA.ENTRENAMIENTO;

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

  /**
   * Dice si lo que está en pantalla es de esta mesa o prestado.
   *
   * No es un detalle: editar lo propio y editar una copia de otra cosa se
   * ven idénticos en el formulario, y sólo uno de los dos desengancha esta
   * mesa de la general para siempre. Decirlo antes evita la sorpresa.
   */
  const mostrarDeQuien = (heredado) => {
    if (!deQuien) return;
    deQuien.textContent = heredado
      ? "Esto es la configuración general: esta mesa la hereda. Si guardás, pasa a tener la suya."
      : "Esta mesa tiene su propia configuración.";
  };

  async function cargar() {
    try {
      const { data } = await leerDiseno({ contexto: elegido() });
      // Un campo ausente es «lo de siempre», y el campo vacío lo dice igual.
      brujula.value = data?.diseno?.brujula ?? "";
      if (sala) sala.value = data?.diseno?.sala ?? "";
      mostrarLoLeido();
      mostrarDeQuien(data?.heredado === true);
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
   * Los tres botones mandan el formulario completo: se cargó con lo que
   * había, así que lo que muestra ES el estado que se quiere dejar. Los de
   * volver atrás sólo vacían su campo antes.
   */
  async function mandar(cambios, queDice) {
    try {
      decir("Guardando…");
      // El contexto se agrega ACÁ y no en cada botón: los tres caminos pasan
      // por esta función, así que ninguno puede olvidárselo.
      const { data } = await guardarDiseno({ ...cambios, contexto: elegido() });
      await cargar();
      decir(data?.guardado ? queDice : "No había nada que cambiar.", "bien");
    } catch (error) {
      console.error("No se pudo guardar el diseño de la mesa:", error);
      decir(error?.message ?? "No pudimos guardar el diseño.", "mal");
    }
  }

  /**
   * El formulario, listo para mandar — o el aviso que lo impide.
   *
   * Lo usan los tres botones, y tenerlo una sola vez no es prolijidad: la
   * traducción de «lo que se ve» a «lo que viaja» tiene reglas —vacío es
   * `null`, `ninguna` es una palabra válida, el hexadecimal tiene largos que
   * CSS acepta y largos que no— y tenerlas dos veces es tenerlas distintas.
   *
   * Lo que se avisa acá el servidor lo valida igual: esto es comodidad, para
   * no esperar un viaje de ida y vuelta que termine en «la ruta tiene que
   * empezar con /img/». No es seguridad.
   */
  function armarFormulario() {
    const cambios = {};

    const b = brujula.value.trim();
    if (!b) cambios.brujula = null;
    else if (b !== SIN_BRUJULA && !esRuta(b)) {
      return { error: "La brújula tiene que ser una ruta /img/…, o la palabra «ninguna»." };
    } else cambios.brujula = b;

    if (sala) {
      const s = sala.value.trim();
      if (!s) cambios.sala = null;
      else if (!esRuta(s) && !esColor(s)) {
        return { error: "La sala tiene que ser una ruta /img/… o un color #hexadecimal." };
      } else cambios.sala = s;
    }

    return { cambios };
  }

  /** Manda lo que muestra el formulario, o dice por qué no se puede. */
  function mandarFormulario(queDice) {
    const { cambios, error } = armarFormulario();
    if (error) return decir(error, "mal");
    return mandar(cambios, queDice);
  }

  sala?.addEventListener("input", mostrarLoLeido);

  // Cambiar de mesa es volver a cargar: lo que haya escrito sin guardar se
  // descarta a propósito, antes que arrastrarlo hasta otra mesa.
  contexto?.addEventListener("change", cargar);

  $("btnGuardarMesa")?.addEventListener("click", () =>
    mandarFormulario("Listo. Recargá una mesa para verlo."));

  /*
   * Volver atrás es VACIAR ese campo y mandar el formulario, no mandar ese
   * campo solo.
   *
   * Mandarlo solo parecía más prolijo y tenía un agujero: sobre una mesa que
   * HEREDA la general, escribir un único campo borrado le crea documento
   * propio igual, y como el fallback es por documento entero esa mesa deja
   * de heredar y pierde TAMBIÉN el otro campo. El aviso decía «listo: vuelve
   * la sala de siempre» y de paso se había llevado la brújula.
   *
   * Mandando el formulario completo, el otro campo se adopta con el valor
   * que está a la vista: la mesa se ve igual que antes de tocar el botón.
   * Y deja de depender de si Firestore crea el documento cuando el único
   * campo del `set` es un borrado — acá siempre se escribe algo de verdad.
   *
   * Lo que viaja es LO QUE SE VE, así que algo inválido tipeado en el otro
   * campo frena el botón con su aviso. Es incómodo y es correcto: para poder
   * deshacer no se escribe un documento a medio validar.
   */
  $("btnBorrarBrujula")?.addEventListener("click", () => {
    brujula.value = "";
    mandarFormulario("Listo: vuelve la brújula de siempre.");
  });

  $("btnBorrarSala")?.addEventListener("click", () => {
    if (sala) sala.value = "";
    mostrarLoLeido();
    mandarFormulario("Listo: vuelve la sala de siempre.");
  });

  cargar();
}
