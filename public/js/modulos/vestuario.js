/**
 * Lo que el jugador lleva puesto, recordado en el propio navegador.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ PROBLEMA RESUELVE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La mesa arrancaba con las caras y los dorsos de la casa y recién después
 * aparecía lo comprado. El salto se veía: uno se sentaba, veía el dorso azul
 * de siempre, y medio segundo más tarde le cambiaba abajo de la mano.
 *
 * Pasaba porque traducir «lo que tengo puesto» a imágenes son TRES lecturas de
 * Firestore —el perfil, y el artículo de cada tipo— y la mesa no las espera, a
 * propósito: hacerlo dejaría la pantalla en blanco por una decoración.
 *
 * Acá se guarda el resultado de esas lecturas. La próxima vez la mesa se
 * dibuja ya vestida, con lo último que se supo, y cuando el servidor contesta
 * se corrige si hiciera falta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SE GUARDAN RUTAS, NO IDENTIFICADORES
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Guardar `avatar-dragon` no serviría de nada: para saber qué imagen es ese
 * artículo hay que leer el catálogo, que es justamente la lectura que se
 * quiere evitar. Lo que se guarda es lo que se va a poner en un `src`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ES UNA PISTA, NO LA VERDAD
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Puede estar vieja: si el panel le cambia la imagen a un artículo, o si el
 * jugador se cambió el avatar desde otro dispositivo, acá quedó lo de antes.
 * No importa —la lectura de verdad llega igual y pisa esto— y el costo de
 * equivocarse es medio segundo con la imagen anterior, contra el salto que
 * había siempre.
 *
 * Lo que NO puede hacer es decidir nada. La mesa vuelve a pasar cada ruta por
 * `esRutaDelSitio` antes de tocar un `src`: esto es `localStorage`, o sea que
 * lo escribe cualquiera que abra la consola.
 */

import { TIPOS } from "../reglas/catalogo.js";

const CLAVE = "vestuario";

/**
 * De «qué tengo puesto» a «qué imágenes son».
 *
 * Vive acá y no en cada pantalla porque el par que importa es
 * `mazo` ↔ `pano`: confundirlos le pone el paño de la mesa en el reverso
 * del mazo, y son dos campos contiguos que se escriben casi igual. Una
 * sola traducción, usada por las dos vistas y por la mesa.
 *
 * `imagenDe` la pone quien llama porque cada pantalla guarda el catálogo a
 * su manera —la tienda en una lista, la colección en un Map—.
 */
export function rutasDeLoEquipado(equipado, imagenDe) {
  const de = (tipo) => imagenDe(equipado?.[tipo]) ?? null;
  return {
    retrato: de(TIPOS.AVATAR),
    dorso: de(TIPOS.DORSO),
    mazo: de(TIPOS.MAZO),
    pano: de(TIPOS.FONDO),
  };
}

/**
 * Va con el uid adentro.
 *
 * Dos cuentas en el mismo navegador —el que prueba con la suya y con la del
 * hermano— compartirían la misma clave, y el segundo abriría la mesa con las
 * cosas del primero hasta que llegara la lectura.
 */
export function guardarVestuario(uid, equipo) {
  if (!uid) return;
  try {
    localStorage.setItem(
      CLAVE,
      JSON.stringify({
        uid,
        retrato: equipo?.retrato ?? null,
        dorso: equipo?.dorso ?? null,
        mazo: equipo?.mazo ?? null,
        pano: equipo?.pano ?? null,
      }),
    );
  } catch {
    // Modo privado, cuota llena, almacenamiento bloqueado. Se pierde la
    // ventaja y no pasa nada más: la mesa sigue leyendo del servidor.
  }
}

/** Lo último que se supo de este jugador, o `null`. */
export function vestuarioGuardado(uid) {
  if (!uid) return null;
  try {
    const crudo = localStorage.getItem(CLAVE);
    if (!crudo) return null;
    const guardado = JSON.parse(crudo);
    // De otra cuenta no sirve, y ponérselo sería peor que no tener nada.
    return guardado?.uid === uid ? guardado : null;
  } catch {
    return null;
  }
}

/** Al cerrar sesión no queda nada puesto de nadie. */
export function olvidarVestuario() {
  try {
    localStorage.removeItem(CLAVE);
  } catch {
    // Ver arriba: que no se pueda borrar no rompe nada.
  }
}
