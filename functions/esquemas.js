/**
 * Qué forma tiene que tener lo que manda el cliente.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Qué defiende esto y qué NO
 * ────────────────────────────────────────────────────────────────────────
 *
 * NO defiende las reglas del juego. Que sea tu turno, que la carta exista, que
 * la ventana siga abierta: eso lo decide el motor y lo seguirá decidiendo.
 * Meter reglas acá sería tener dos jueces que pueden discrepar.
 *
 * Lo que defiende es la puerta. Hasta ahora `codigo` se leía con
 * `String(data?.codigo ?? "").trim().toUpperCase()` en once sitios y se
 * comprobaba de verdad en UNO. Los otros diez hacían una lectura de Firestore
 * con lo que llegara: mandando basura larga se conseguía gastar cuota ajena
 * sin haber entrado a ninguna sala.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Por qué no se usan los límites que venían propuestos
 * ────────────────────────────────────────────────────────────────────────
 *
 * El esquema sugerido decía `codigo: z.string().min(4).max(10)`. Eso es MÁS
 * PERMISIVO que lo que el proyecto ya tenía: `esCodigoValido` exige seis
 * caracteres exactos de un alfabeto sin I, O, U, 0 ni 1 —justamente para que
 * nadie confunda un cero con una o al dictar un código por teléfono—. Cambiar
 * a la versión de zod habría aflojado la validación creyendo que la apretaba.
 *
 * Así que el esquema delega en el validador que ya existe. Una sola definición
 * de qué es un código válido, y vive en las reglas, donde el navegador también
 * la lee.
 */

import { z } from "zod";
import { esCodigoValido, LARGO_CODIGO } from "./reglas/salas.js";
import { TAM_MANO } from "./reglas/baraja.js";
import { ACCIONES } from "./partida-red.js";

/**
 * El código de sala.
 *
 * Se normaliza antes de validar —recortar y pasar a mayúsculas— porque es lo
 * que el cliente ya venía haciendo y porque un código dictado en voz alta
 * llega en minúsculas la mitad de las veces. Lo que NO se hace es aceptar
 * cualquier cosa y confiar en la búsqueda.
 */
export const Codigo = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .refine(esCodigoValido, `Un código de sala son ${LARGO_CODIGO} caracteres.`);

/**
 * Una posición en una mano.
 *
 * El tope sale de `TAM_MANO`, que es 4, y no de un número escrito a mano: si
 * mañana se reparten cinco cartas, este esquema se entera solo.
 *
 * Ojo: una mano PUEDE crecer más allá de TAM_MANO —cada error suma una carta
 * de castigo—, así que esto no es "la posición existe". Es "esta posición no
 * es un disparate". Que exista de verdad lo comprueba el motor, que además
 * devuelve el estado sin tocar cuando no.
 */
export const Posicion = z.coerce.number().int().min(0).max(TAM_MANO * 6);

/** Identificador que manda el cliente para reconocer un reintento suyo. */
const ClaveDeAccion = z.string().min(1).max(120);

/** Milisegundos declarados por el cliente. El servidor los acota igual. */
const Milisegundos = z.coerce.number().finite().min(0).max(600_000);

export const EsquemaDeSala = z.object({ codigo: Codigo });

export const EsquemaCrearSala = z.object({
  entrada: z.coerce.number().int().min(0),
  nombre: z.string().max(40).optional(),
});

export const EsquemaMarcarListo = z.object({
  codigo: Codigo,
  listo: z.coerce.boolean().optional(),
});

export const EsquemaDescarte = z.object({
  codigo: Codigo,
  windowId: z.string().min(1).max(120),
  posicion: Posicion,
  clientActionId: ClaveDeAccion,
  declarado: Milisegundos,
  latencia: Milisegundos,
  incertidumbre: Milisegundos,
  // Contra la mano de un rival: a quién y qué carta propia se entrega.
  objetivo: z.string().min(1).max(128).nullable().optional(),
  posicionEntrega: Posicion.nullable().optional(),
});

export const EsquemaAccion = z.object({
  codigo: Codigo,
  // Lista blanca, y sale de la misma constante que usa el motor: una acción
  // nueva no puede quedarse fuera por olvido, ni una vieja seguir aceptándose
  // después de borrarla.
  accion: z.enum(Object.values(ACCIONES)),
  clientActionId: ClaveDeAccion,
  posicion: Posicion.optional(),
  /**
   * `objetivo` significa tres cosas distintas segun la accion, y por eso
   * acepta tres formas:
   *
   *   - un jugador y su posicion, para los poderes de cambio;
   *   - un uid, para el descarte contra la mano de un rival;
   *   - un booleano, que es el si o el no del 10 despues de ver las cartas.
   *
   * Reusar el mismo campo para tres cosas no es lindo, pero cambiarle el
   * nombre obligaria a tocar el protocolo entero. Lo que si hace falta es que
   * el esquema las contemple: sin el booleano, la segunda mitad del 10 se
   * rechazaba en la puerta con "los datos de la jugada no son validos".
   */
  objetivo: z
    .object({ indice: z.coerce.number().int().min(0).max(3), posicion: Posicion.optional() })
    .or(z.string().min(1).max(128))
    .or(z.boolean())
    .optional(),
});

export const EsquemaCompra = z.object({ paqueteId: z.string().min(1).max(64) });

export const EsquemaReferido = z.object({ referidoUid: z.string().min(1).max(128) });

/**
 * Valida y devuelve los datos ya normalizados.
 *
 * El mensaje que sale es el del esquema, no el volcado de zod: al jugador no
 * le sirve "expected string, received undefined at path codigo", y a quien
 * está probando el borde tampoco hay por qué regalarle el mapa.
 */
export function validar(esquema, datos, error) {
  const r = esquema.safeParse(datos ?? {});
  if (r.success) return r.data;

  // Sólo salen los mensajes escritos por nosotros, que son los de `refine` y
  // llegan con `code: "custom"`. Los de zod vienen en inglés y hablan de tipos
  // —"Too small: expected number to be >=0"—: al jugador no le dicen nada, y a
  // quien está tanteando el borde le regalan el mapa.
  const custom = r.error.issues.find((i) => i.code === "custom" && i.message);
  throw error("invalid-argument", custom?.message ?? "Los datos de la jugada no son válidos.");
}
