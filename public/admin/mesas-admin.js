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
 */

import { funciones, httpsCallable } from "../js/firebase.js";

const $ = (id) => document.getElementById(id);

const leerDiseno = httpsCallable(funciones, "leerDisenoDeMesaAdmin");
const guardarDiseno = httpsCallable(funciones, "guardarDisenoDeMesaAdmin");

/** Lo mismo que acepta el servidor, para avisar antes de ir y volver. */
const SIN_BRUJULA = "ninguna";
const esRuta = (v) => v.startsWith("/img/");

export function montarMesasAdmin() {
  const campo = $("mesaBrujula");
  if (!campo) return;

  const aviso = $("avisoMesa");
  const decir = (texto, clase = "") => {
    if (!aviso) return;
    aviso.textContent = texto;
    aviso.className = `aviso ${clase}`.trim();
  };

  async function cargar() {
    try {
      const { data } = await leerDiseno();
      // Un campo ausente es «la de siempre», y el campo vacío lo dice igual.
      campo.value = data?.diseno?.brujula ?? "";
      decir("");
    } catch (error) {
      console.error("No se pudo leer el diseño de la mesa:", error);
      decir("No pudimos leer el diseño guardado.", "mal");
    }
  }

  /**
   * Guarda, o borra.
   *
   * `null` BORRA el campo y devuelve la brújula de siempre; un valor lo
   * reemplaza. El campo vacío se traduce a `null` acá y no en el servidor
   * porque es una decisión de esta pantalla: «lo dejé en blanco» quiere
   * decir «volvé a la de antes».
   */
  async function mandar(valor) {
    try {
      decir("Guardando…");
      const { data } = await guardarDiseno({ brujula: valor });
      await cargar();
      decir(
        data?.guardado
          ? valor === null
            ? "Listo: vuelve la brújula de siempre."
            : "Listo. Recargá una mesa para verlo."
          : "No había nada que cambiar.",
        "bien",
      );
    } catch (error) {
      console.error("No se pudo guardar el diseño de la mesa:", error);
      decir(error?.message ?? "No pudimos guardar el diseño.", "mal");
    }
  }

  $("btnGuardarMesa")?.addEventListener("click", () => {
    const valor = campo.value.trim();

    // Vacío es borrar, que es volver a la de siempre.
    if (!valor) return mandar(null);

    // Se avisa acá además de en el servidor: un viaje de ida y vuelta para
    // que vuelva «la ruta tiene que empezar con /img/» es peor experiencia
    // que decirlo al instante. El servidor lo valida igual — esto es
    // comodidad, no seguridad.
    if (valor !== SIN_BRUJULA && !esRuta(valor)) {
      decir("Tiene que ser una ruta que empiece con /img/, o la palabra «ninguna».", "mal");
      return;
    }
    return mandar(valor);
  });

  $("btnBorrarBrujula")?.addEventListener("click", () => {
    campo.value = "";
    mandar(null);
  });

  cargar();
}
