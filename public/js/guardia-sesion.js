/**
 * La puerta de la mesa: sin sesión no se entra.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ES UN ARCHIVO APARTE Y NO DOS LÍNEAS EN `mesa.js`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque así hay una costura donde apoyarse.
 *
 * Cuarenta pruebas de Playwright abren `/mesa.html` para comprobar cosas del
 * juego —el reparto, los poderes, el corte, el doble toque—. Ninguna tiene
 * sesión, y ninguna debería necesitarla: lo que miden no tiene nada que ver
 * con quién entró. Con el guardia adentro de `mesa.js`, todas terminarían en
 * `login.html` y habría que falsificarles `firebase.js` entero, con sus
 * veintitantas exportaciones, en cada una.
 *
 * Estando acá, esas pruebas sustituyen UN módulo de dos funciones, y hay una
 * prueba dedicada —`mesa-sesion.spec.js`— que comprueba la puerta de verdad:
 * que sin sesión redirige, y que con sesión deja pasar.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ESTO NO ES LA CERRADURA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Es la puerta, no la cerradura. Un guardia en el navegador se saltea con las
 * herramientas de desarrollo, y está bien que así sea: no hay nada que robar
 * del otro lado. La mesa de entrenamiento corre entera en el navegador, no
 * cuesta Leyendas y no toca el ranking.
 *
 * Lo que sí protege está en el servidor: las funciones que mueven saldo o
 * partidas por Leyendas comprueban el token en cada llamada. Forzar la URL de
 * la mesa consigue jugar contra la máquina, que es gratis igual.
 */

import { auth, onAuthStateChanged } from "./firebase.js";

/**
 * Cuánto se espera a que Firebase diga quién es.
 *
 * La sesión se lee de IndexedDB, así que normalmente contesta en milisegundos
 * incluso sin red. Pasado este plazo algo anda mal de verdad, y el mejor lugar
 * para caer es el login: desde ahí se puede reintentar. Quedarse esperando
 * dejaría una pantalla de carga eterna, que es la peor de las dos opciones
 * porque no ofrece ninguna salida.
 */
const MS_ESPERA_MAXIMA = 8000;

/** A dónde se manda a quien no tiene sesión. */
const PUERTA = "login.html";

/**
 * Exige sesión antes de dejar arrancar la mesa.
 *
 * Devuelve el usuario cuando lo hay. Cuando NO lo hay, redirige y devuelve una
 * promesa que no se resuelve nunca — a propósito.
 *
 * Que no se resuelva es lo que evita el parpadeo: `mesa.js` la espera arriba de
 * todo, así que si esto resolviera con `null`, el navegador alcanzaría a
 * repartir y dibujar una mesa entera durante el instante que tarda la
 * redirección. Dejando la promesa colgada, no se dibuja nada y la página se va
 * como corresponde.
 */
export function exigirSesionEnMesa() {
  return new Promise((resolve) => {
    let resuelto = false;

    const irAlLogin = () => {
      if (resuelto) return;
      resuelto = true;
      // `replace` y no `href`: quien no tiene sesión no debería poder volver a
      // la mesa con el botón de atrás para encontrarse la misma puerta.
      window.location.replace(
        `${PUERTA}?volver=${encodeURIComponent(location.pathname + location.search)}`,
      );
      // Sin `resolve`: ver el comentario de arriba.
    };

    const plazo = setTimeout(irAlLogin, MS_ESPERA_MAXIMA);

    const cortar = onAuthStateChanged(auth, (usuario) => {
      cortar();
      clearTimeout(plazo);
      if (!usuario) return irAlLogin();
      if (resuelto) return;
      resuelto = true;
      resolve(usuario);
    });
  });
}
