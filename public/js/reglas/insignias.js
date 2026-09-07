/**
 * Las insignias son logros: no se compran, se ganan.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO ES UN MÓDULO PURO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque la condición de una insignia se evalúa en dos lugares distintos y
 * tiene que dar lo mismo en los dos: el servidor la otorga al terminar una
 * partida, y el perfil dibuja la barra de "te faltan 12 victorias". Si el
 * cálculo viviera en el servidor, el perfil tendría que adivinarlo; si
 * viviera en el cliente, el servidor tendría que confiar en él.
 *
 * Acá no hay Firestore ni fechas ni red: entra un objeto con números, sale
 * qué se ganó. Eso se puede probar sin levantar nada.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE UNA INSIGNIA NO ES
 * ─────────────────────────────────────────────────────────────────────────
 *
 * No es saldo. Otorgarla no mueve una sola Leyenda, así que no pasa por
 * `moverLeyendas` ni deja asiento en el libro mayor. Y no es un artículo de
 * tienda: `TIPOS_VENDIBLES`, en `reglas/catalogo.js`, no incluye este tipo, y
 * el servidor rechaza la compra aunque sobre el saldo. La lista está en el
 * código y no en la base de datos a propósito: un precio se puede editar mal
 * desde el panel, una constante no.
 *
 * Sí se guarda donde se guarda todo lo demás que un jugador posee
 * —`users/{uid}/items/{id}`— para que equiparla use el mismo `equiparItem`
 * que un avatar. Un segundo lugar para "cosas que tenés" sería un segundo
 * lugar donde puede desincronizarse.
 */

/**
 * Qué hay que hacer para cada una.
 *
 * `minimo` es un piso (llegar a tanto) y `maximo` un techo (no pasar de tanto).
 * Los dos existen porque "ganar 250 partidas" y "quedar entre los 5 primeros"
 * son la misma clase de condición leída al revés: en un ranking, mejor es
 * MENOS. Escribirlo con un solo comparador obligaría a guardar el puesto
 * negado, y "tu mejor puesto es -3" no lo entiende nadie.
 */
export const CONDICIONES = Object.freeze([
  {
    id: "novato",
    campo: "partidasJugadas",
    minimo: 10,
    texto: "Jugar 10 partidas",
  },
  {
    id: "aventurero",
    campo: "partidasGanadas",
    minimo: 50,
    texto: "Ganar 50 partidas",
  },
  {
    id: "estratega",
    campo: "partidasGanadas",
    minimo: 100,
    texto: "Ganar 100 partidas",
  },
  {
    id: "heroe",
    campo: "partidasGanadas",
    minimo: 250,
    texto: "Ganar 250 partidas",
  },
  {
    id: "campeon",
    campo: "torneosGanados",
    minimo: 5,
    texto: "Ganar 5 torneos",
  },
  {
    id: "leyenda",
    campo: "mejorPuestoMensual",
    maximo: 5,
    texto: "Entrar al top 5 del ranking mensual",
  },
]);

/** Los seis ids, en orden de dificultad, para dibujar la vitrina. */
export const IDS_INSIGNIAS = Object.freeze(CONDICIONES.map((c) => c.id));

/** Las estadísticas que miran las condiciones, todas en cero. */
export const ESTADISTICAS_VACIAS = Object.freeze({
  partidasJugadas: 0,
  partidasGanadas: 0,
  torneosGanados: 0,
  // Sin puesto todavía. `null` y no `0`: cero sería el mejor puesto posible y
  // regalaría la insignia más difícil a quien nunca jugó.
  mejorPuestoMensual: null,
});

/** El valor de un campo, tolerando un perfil viejo al que le falte. */
const valor = (estadisticas, campo) => {
  const v = estadisticas?.[campo];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

/** ¿Esta condición ya está cumplida? */
export function cumple(condicion, estadisticas) {
  const v = valor(estadisticas, condicion.campo);
  if (v === null) return false;
  if (typeof condicion.minimo === "number") return v >= condicion.minimo;
  // El `v >= 1` no es decoración. Las condiciones de techo son puestos de un
  // ranking, y no existe el puesto 0: un cero sólo puede venir de un campo mal
  // escrito o de un perfil viejo. Sin este piso, "estar entre los 5 primeros"
  // lo cumple quien nunca jugó, y la insignia más difícil del juego se
  // regalaría al registrarse.
  if (typeof condicion.maximo === "number") return v >= 1 && v <= condicion.maximo;
  return false;
}

/**
 * Cuánto falta, entre 0 y 1, para dibujar una barra de progreso.
 *
 * Las de techo no tienen progreso honesto: entre "puesto 40" y "puesto 6" no
 * hay una fracción que signifique algo, porque el puesto depende de los demás
 * y puede empeorar sin que uno juegue peor. Devuelven 0 o 1, sin barra.
 */
export function progreso(condicion, estadisticas) {
  if (cumple(condicion, estadisticas)) return 1;
  if (typeof condicion.maximo === "number") return 0;
  const v = valor(estadisticas, condicion.campo) ?? 0;
  return Math.max(0, Math.min(1, v / condicion.minimo));
}

/** Todas las que las estadísticas justifican, se tengan o no. */
export function insigniasMerecidas(estadisticas) {
  return CONDICIONES.filter((c) => cumple(c, estadisticas)).map((c) => c.id);
}

/**
 * Las que hay que otorgar ahora: merecidas menos las que ya están.
 *
 * Devolver sólo la diferencia es lo que hace que otorgar sea barato de
 * repetir. El servidor la llama después de CADA partida; si devolviera las
 * merecidas a secas, cada partida reescribiría las seis.
 */
export function insigniasNuevas(estadisticas, yaTiene = []) {
  const tengo = new Set(yaTiene);
  return insigniasMerecidas(estadisticas).filter((id) => !tengo.has(id));
}

/** La condición de un id, para poder explicarla en pantalla. */
export const condicionDe = (id) => CONDICIONES.find((c) => c.id === id) ?? null;

/**
 * Suma una partida terminada a las estadísticas.
 *
 * Puro a propósito: el servidor lo usa para saber QUÉ escribir, y las pruebas
 * lo usan para simular doscientas partidas sin tocar Firestore.
 */
export function conPartida(estadisticas, gano) {
  const base = { ...ESTADISTICAS_VACIAS, ...(estadisticas ?? {}) };
  return {
    ...base,
    partidasJugadas: (valor(base, "partidasJugadas") ?? 0) + 1,
    partidasGanadas: (valor(base, "partidasGanadas") ?? 0) + (gano ? 1 : 0),
  };
}

/**
 * Registra un puesto del ranking mensual, quedándose con el mejor de la
 * historia.
 *
 * El mejor no se pierde nunca. Quien salió tercero una vez es "Leyenda" para
 * siempre, aunque al mes siguiente salga cuadragésimo: una insignia que se
 * puede perder no es un logro, es un estado.
 */
export function conPuestoMensual(estadisticas, puesto) {
  const base = { ...ESTADISTICAS_VACIAS, ...(estadisticas ?? {}) };
  if (!Number.isFinite(puesto) || puesto < 1) return base;
  const previo = valor(base, "mejorPuestoMensual");
  return { ...base, mejorPuestoMensual: previo === null ? puesto : Math.min(previo, puesto) };
}
