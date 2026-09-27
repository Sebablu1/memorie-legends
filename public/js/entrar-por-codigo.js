/**
 * Entrar a una sala con un código. Lo usan el tablero y el lobby.
 *
 * Un mismo campo recibe los dos códigos que existen, y el LARGO decide por qué
 * puerta entra:
 *
 *   6 caracteres  una sala pública: el código ES la sala.
 *   8 caracteres  una invitación a una sala privada: el servidor busca su
 *                 resumen y devuelve a qué sala pertenece. El código no sale
 *                 de esta llamada: a la dirección va el identificador.
 *
 * Dos campos separados obligarían a quien recibe un código a saber de qué tipo
 * es. Estaba escrito en el tablero; se mudó acá cuando el lobby necesitó lo
 * mismo, para que no haya dos copias que se desacomoden.
 */

import { unirseASala, unirseConCodigo, ErrorDeServidor } from "./servidor.js";
import { esCodigoValido } from "./reglas/salas.js";

/** Los caracteres de un código privado. Los de uno público son seis. */
export const LARGO_CODIGO_PRIVADO = 8;

/**
 * Guarda el código y va a la sala.
 *
 * `roomCode` en localStorage es una comodidad para volver, NO una autoridad:
 * quien decide en qué sala está cada uno es el servidor. Editarlo a mano no
 * mete a nadie en ningún lado.
 */
export function irALaSala(codigo) {
  localStorage.setItem("roomCode", codigo);
  window.location.href = `room.html?code=${encodeURIComponent(codigo)}`;
}

/**
 * Pide entrar. Es el único camino: lo usan el campo del código y los botones
 * de las listas, para que no haya dos formas de hacer lo mismo.
 */
export async function entrarConCodigo(codigoCrudo, { boton, avisar, limpiarAviso, campo } = {}) {
  const codigo = String(codigoCrudo ?? "").trim().toUpperCase();
  const esPrivado = codigo.length === LARGO_CODIGO_PRIVADO;

  if (!esPrivado && !esCodigoValido(codigo)) {
    avisar?.("El código tiene que ser de seis caracteres, u ocho si es privado.", "error");
    campo?.focus();
    return;
  }

  const textoOriginal = boton?.textContent;
  if (boton) {
    boton.disabled = true;
    boton.textContent = "Entrando…";
  }
  limpiarAviso?.();

  try {
    if (esPrivado) {
      const { sala } = await unirseConCodigo(codigo);
      irALaSala(sala);
      return;
    }
    await unirseASala(codigo);
    irALaSala(codigo);
  } catch (error) {
    avisar?.(
      error instanceof ErrorDeServidor ? error.message : "No pudimos entrar a la sala.",
      "error",
    );
    if (boton) {
      boton.disabled = false;
      boton.textContent = textoOriginal;
    }
  }
}

/**
 * Conecta un campo de código con su botón: sólo el alfabeto de los códigos, en
 * mayúsculas, y Enter para entrar. Se limpia mientras se escribe para que
 * nadie descubra al enviar que su "0" era una "O".
 */
export function conectarCampoDeCodigo(campo, boton, opciones = {}) {
  campo.addEventListener("input", (evento) => {
    evento.target.value = evento.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });
  campo.addEventListener("keydown", (evento) => {
    if (evento.key === "Enter") boton.click();
  });
  boton.addEventListener("click", () => entrarConCodigo(campo.value, { ...opciones, boton, campo }));
}
