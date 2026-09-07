/**
 * Economía de Memorie Legends: Leyendas (la moneda del juego), apuestas y paquetes.
 *
 * Módulo puro y determinista (acepta un rng inyectable). No toca Firestore
 * ni el DOM: las mutaciones de saldo tienen que ejecutarse en el servidor.
 */

// ------------------------------------------------------------- entradas

/**
 * Las Leyendas de bienvenida. Una sola vez, al crear la cuenta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ESTE NÚMERO ESTÁ ATADO A `firestore.rules`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La regla `saldoDeBienvenidaValido()` exige que un perfil nuevo se cree con
 * EXACTAMENTE este saldo. Es lo que impide que alguien se cree la cuenta con
 * un millón: el perfil lo escribe el navegador, así que el único control
 * posible es esa comparación.
 *
 * O sea que cambiar este número sin cambiar la regla no sube el regalo: deja
 * a TODO el mundo sin poder registrarse, porque Firestore rechaza la creación
 * del documento. Y al revés también. Por eso hay una prueba
 * —`pruebas/leyendas-iniciales.mjs`— que compara los dos y falla si difieren.
 *
 * Decía 50 y nadie la usaba: `register.js` y `auth.js` tenían cada uno su
 * propio 100 escrito a mano, y la regla pedía 100. Tres copias, una de ellas
 * mintiendo, y la que mentía era justamente la que decía ser la oficial.
 */
export const LEYENDAS_REGISTRO = 100;
export const LEYENDAS_POR_REFERIDO = 25;

/**
 * Hubo un bono diario de 10 Leyendas cada 24 horas. Ya no.
 *
 * Estaba desplegado y era llamable, pero ningún botón lo llamaba: existía
 * entero en el servidor y no existía en el juego. Se eliminó en vez de
 * terminarlo, porque regalar saldo por entrar premia abrir la aplicación y no
 * jugar, que es lo contrario de lo que mide todo el resto de la economía.
 *
 * `MOTIVOS.BONO_DIARIO` también se fue. Si alguien llegó a cobrarlo llamando a
 * la función a mano, su asiento en el libro mayor conserva la cadena
 * `"bono_diario"` y se sigue leyendo igual: los motivos se guardan como texto
 * y nadie los valida contra esta lista al leer.
 */

// ------------------------------------------------------------- apuestas

export const NIVELES_APUESTA = {
  baja: { apuesta: 10, etiqueta: "Baja", tipo: "Casual", color: "#4caf50" },
  media: { apuesta: 50, etiqueta: "Media", tipo: "Estándar", color: "#ffc107" },
  alta: { apuesta: 100, etiqueta: "Alta", tipo: "Premium", color: "#ff9800" },
  elite: { apuesta: 200, etiqueta: "Élite", tipo: "High Roller", color: "#e94560" },
};

export const nivelDeApuesta = (apuesta) =>
  Object.entries(NIVELES_APUESTA).find(([, n]) => n.apuesta === apuesta)?.[0] ?? null;

/**
 * Multiplicador de puntos de ranking y experiencia según lo apostado.
 *
 * ⚠️ La especificación lo llama `puntos_ranking` con valores 1/2/4/8. Se
 * interpreta como MULTIPLICADOR (apostar 200 vale 8 veces más que apostar 10),
 * porque como suma fija 8 puntos sobre los 100 del primer puesto sería
 * irrelevante y no premiaría nada. Si la intención era sumar, alcanza con
 * usar `bonos.puntos` como sumando en vez de factor.
 */
export const BONOS_APUESTA = {
  10: { multiplicador: 1, exp: 10 },
  50: { multiplicador: 2, exp: 30 },
  100: { multiplicador: 4, exp: 60 },
  200: { multiplicador: 8, exp: 120 },
};

export const bonoDeApuesta = (apuesta) =>
  BONOS_APUESTA[apuesta] ?? { multiplicador: 1, exp: 0 };

/**
 * Políticas de reparto del pote.
 *
 * ⚠️ `dobleApuesta` es lo que dice la especificación: el ganador cobra
 * apuesta x2. Sólo queda parejo en mesas de 2. Con 3 jugadores la casa
 * retiene el 33% del pote y con 4 el 50%. Si no era la intención, usar
 * `potePleno`: el ganador se lleva todo y la casa no retiene nada.
 */
export const POLITICAS_PAGO = {
  dobleApuesta: (apuesta) => apuesta * 2,
  potePleno: (apuesta, jugadores) => apuesta * jugadores,
};

export const POLITICA_POR_DEFECTO = "dobleApuesta";

/**
 * Reparto de una partida apostada.
 * Devuelve el movimiento de cada jugador y lo que retiene la casa.
 */
export function calcularReparto({ apuesta, jugadores, ganadorId, politica = POLITICA_POR_DEFECTO }) {
  const calcular = POLITICAS_PAGO[politica];
  if (!calcular) throw new Error(`Política de pago desconocida: ${politica}`);

  const cantidad = jugadores.length;
  const pote = apuesta * cantidad;
  const pago = calcular(apuesta, cantidad);

  const movimientos = jugadores.map((j) => ({
    jugadorId: j.id ?? j,
    // Todos pusieron la apuesta; el ganador además cobra el premio.
    delta: (j.id ?? j) === ganadorId ? pago - apuesta : -apuesta,
  }));

  const repartido = movimientos.reduce((s, m) => s + m.delta, 0);

  return {
    pote,
    pago,
    movimientos,
    // Lo que no vuelve a los jugadores se lo queda la casa.
    comisionCasa: -repartido,
    porcentajeCasa: pote ? -repartido / pote : 0,
  };
}

// --------------------------------------------------- premios de ranking

export const PREMIOS_RANKING = [
  { hasta: 1, leyendas: 500, insignia: "dorada", etiqueta: "🏆 Insignia Dorada" },
  { hasta: 2, leyendas: 300, insignia: "plateada", etiqueta: "🥈 Insignia Plateada" },
  { hasta: 3, leyendas: 100, insignia: "bronce", etiqueta: "🥉 Insignia Bronce" },
  { hasta: 10, leyendas: 50, insignia: "top10", etiqueta: "Insignia Top 10" },
  { hasta: 50, leyendas: 20, insignia: null, etiqueta: "Top 50" },
];

/**
 * Recompensa por puesto. Se cobra sólo el tramo más alto alcanzado:
 * el #1 se lleva 500, no 500+50+20.
 */
export function premioPorPuesto(puesto) {
  const tramo = PREMIOS_RANKING.find((p) => puesto <= p.hasta);
  return tramo ? { leyendas: tramo.leyendas, insignia: tramo.insignia, etiqueta: tramo.etiqueta } : null;
}

// ------------------------------------------------------------- paquetes

export const MONEDA = "UYU";

export const PAQUETES = [
  { id: "basico", nombre: "Pack Básico", leyendas: 100, bonificacion: 0, precio: 100 },
  { id: "popular", nombre: "Pack Popular", leyendas: 300, bonificacion: 50, precio: 250 },
  { id: "premium", nombre: "Pack Premium", leyendas: 600, bonificacion: 150, precio: 450 },
  {
    id: "elite",
    nombre: "Pack Élite",
    leyendas: 1500,
    bonificacion: 500,
    precio: 1000,
    insignia: "comprador-elite",
  },
];

export const paquetePorId = (id) => PAQUETES.find((p) => p.id === id) ?? null;

/** Leyendas totales que entrega un paquete, bonificación incluida. */
export const leyendasDePaquete = (paquete) => paquete.leyendas + paquete.bonificacion;

/** Precio por Leyenda, para poder mostrar cuál conviene. */
export const precioPorLeyenda = (paquete) => paquete.precio / leyendasDePaquete(paquete);

// ---------------------------------------------------------- movimientos

/** Motivos válidos de un movimiento de Leyendas, para auditar el libro mayor. */
export const MOTIVOS = {
  REGISTRO: "registro",
  REFERIDO: "referido",
  APUESTA: "apuesta",
  // Sumidero de la casa: no va al pozo ni a otro jugador.
  PENALIZACION_ABANDONO: "penalizacion_abandono",
  PREMIO_PARTIDA: "premio_partida",
  PREMIO_RANKING: "premio_ranking",

  /**
   * Los tres movimientos de un torneo, separados a propósito.
   *
   * Podrían reusar `APUESTA` y `PREMIO_PARTIDA`, y sería un error: el libro
   * mayor existe para poder preguntarle "¿en qué se fue el saldo?" y que la
   * respuesta sirva. Con motivos compartidos, la entrada de un torneo y una
   * apuesta de mesa serían indistinguibles, y una devolución de torneo
   * parecería un premio.
   *
   * La devolución es su propio motivo y no un premio negativo porque va en la
   * dirección contraria —acredita— y por un motivo distinto: al jugador no le
   * fue bien, es que el torneo no se jugó.
   */
  TORNEO_ENTRADA: "torneo_entrada",
  TORNEO_PREMIO: "torneo_premio",
  TORNEO_DEVOLUCION: "torneo_devolucion",
  COMPRA: "compra",

  /**
   * Gastar Leyendas en un avatar, una insignia o un dorso.
   *
   * Ocupa el lugar del viejo `TIENDA: "tienda"`, que estaba declarado y no lo
   * usaba nadie. Agregar un motivo nuevo al lado habría dejado dos nombres
   * para lo mismo, y la gracia del libro mayor es poder preguntarle "¿en qué
   * se fue el saldo?" y que la respuesta signifique algo.
   *
   * Se distingue de `COMPRA`, que es al revés: ésa ACREDITA Leyendas pagadas
   * con dinero. Ésta las gasta.
   */
  COMPRA_PERSONALIZACION: "compra_personalizacion",
};
