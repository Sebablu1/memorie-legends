/**
 * El código que llegó por un link corto y todavía no se usó.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PARA QUÉ EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Quien recibe `memorielegends.com/s/ABCD1234` puede no tener la sesión
 * abierta. En ese caso el camino es: link → lobby → login → y de vuelta. El
 * código tiene que sobrevivir ese viaje, y no puede hacerlo en la dirección:
 * `pruebas/e2e/lobby.spec.js` comprueba que un código privado NO termine en la
 * URL, para que no quede en el historial del navegador ni en los registros de
 * nadie.
 *
 * Así que viaja acá, en el almacenamiento de la pestaña.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ `sessionStorage` Y NO `localStorage`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque un código es de un momento. Si alguien abre el link y cierra la
 * pestaña, no tiene que encontrárselo puesto tres días después en otra visita.
 * `sessionStorage` se vacía solo al cerrar la pestaña; `localStorage` no.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SE CONSUME, NO SE LEE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `consumir` devuelve el código y lo borra en el mismo paso. Un código que se
 * queda guardado después de usarse vuelve a aparecer en la próxima visita al
 * lobby, encima de lo que la persona estuviera escribiendo.
 */

/** Dónde vive. */
const CLAVE = "codigoPendiente";

/**
 * Cuánto vale. Media hora, lo mismo que dura un código de sala privada.
 *
 * El sello se guarda y se compara al consumir: un código guardado hace tres
 * horas ya no sirve para nada, y ponerlo en el campo sólo haría que la persona
 * toque «Entrar» para que el servidor le diga que no.
 */
const MS_VIGENCIA = 30 * 60 * 1000;

/**
 * La forma que se acepta: ocho caracteres, letras y dígitos.
 *
 * NO es el alfabeto exacto de los códigos privados —ése vive en el servidor,
 * en `functions/salas-privadas.js`, y no se copia acá para que no se
 * desacomoden—. Esto sólo evita guardar basura. Quién decide si un código
 * existe es el servidor, cuando se pide entrar.
 */
const FORMA = /^[A-Z0-9]{8}$/;

/**
 * El almacenamiento, o nada.
 *
 * En una ventana privada, con el almacenamiento de terceros bloqueado o con
 * ciertas extensiones, `sessionStorage` puede tirar al leerlo. Si pasa, el
 * link corto simplemente no pre-llena el campo: la persona pega el código a
 * mano, que es lo que hacía antes. No se rompe nada.
 */
function almacen() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Deja el código como se guarda: mayúsculas y sin espacios. */
export const normalizar = (codigo) => String(codigo ?? "").trim().toUpperCase().replace(/\s+/g, "");

/** ¿Tiene forma de código privado? Ver `FORMA`. */
export const tieneForma = (codigo) => FORMA.test(normalizar(codigo));

/**
 * Guarda el código para el próximo lobby. Devuelve si lo guardó.
 *
 * Un código sin la forma correcta NO se guarda: mejor que el campo quede vacío
 * a que se llene con algo que el servidor va a rechazar igual.
 */
export function guardar(codigo) {
  const limpio = normalizar(codigo);
  if (!tieneForma(limpio)) return false;
  const a = almacen();
  if (!a) return false;
  try {
    a.setItem(CLAVE, JSON.stringify({ codigo: limpio, cuando: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Devuelve el código guardado Y LO BORRA. `null` si no hay, si venció o si
 * está ilegible.
 */
export function consumir() {
  const a = almacen();
  if (!a) return null;
  let crudo = null;
  try {
    crudo = a.getItem(CLAVE);
    a.removeItem(CLAVE);
  } catch {
    return null;
  }
  if (!crudo) return null;
  try {
    const { codigo, cuando } = JSON.parse(crudo);
    if (!tieneForma(codigo)) return null;
    if (!Number.isFinite(cuando) || Date.now() - cuando > MS_VIGENCIA) return null;
    return normalizar(codigo);
  } catch {
    return null;
  }
}

/**
 * ¿Hay uno esperando? NO lo consume.
 *
 * Lo usa el login para decidir adónde mandar a alguien que acaba de entrar: al
 * lobby si vino por un link corto, al tablero si no. El lobby es quien lo
 * consume, y tiene que encontrarlo entero cuando llegue.
 */
export function hay() {
  const a = almacen();
  if (!a) return false;
  try {
    const crudo = a.getItem(CLAVE);
    if (!crudo) return false;
    const { codigo, cuando } = JSON.parse(crudo);
    return tieneForma(codigo) && Number.isFinite(cuando) && Date.now() - cuando <= MS_VIGENCIA;
  } catch {
    return false;
  }
}
