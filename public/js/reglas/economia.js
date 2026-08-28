/**
 * Economía de Memorie Legends: Leyendas (la moneda del juego), apuestas, ruleta y paquetes.
 *
 * Módulo puro y determinista (acepta un rng inyectable). No toca Firestore
 * ni el DOM: las mutaciones de saldo tienen que ejecutarse en el servidor.
 */

// ------------------------------------------------------------- entradas

export const LEYENDAS_REGISTRO = 50; // una sola vez, al crear la cuenta
export const BONO_DIARIO = 10;
export const HORAS_BONO_DIARIO = 24;
export const LEYENDAS_POR_REFERIDO = 20;

// --------------------------------------------------------------- ruleta

export const HORAS_RULETA = 48;

/**
 * Premios de la ruleta con su peso relativo.
 *
 * ⚠️ El peso es la fuente de verdad; el porcentaje de la tabla original
 * coincide en 11 de los 12 premios. La excepción es el de 2500: la tabla
 * dice 0,001% (1 en 100.000) pero el peso 1 sobre 9931 da 0,0101%
 * (1 en 9.931), diez veces más frecuente. Para respetar el 1-en-100.000
 * hay que poner PESO_JACKPOT en 0.09931 (o multiplicar los otros pesos x10).
 */
export const PESO_JACKPOT = 1;

export const PREMIOS_RULETA = [
  { premio: 1, peso: 4000, rareza: "comun" },
  { premio: 2, peso: 2500, rareza: "comun" },
  { premio: 3, peso: 1500, rareza: "normal" },
  { premio: 4, peso: 800, rareza: "normal" },
  { premio: 5, peso: 500, rareza: "raro" },
  { premio: 10, peso: 300, rareza: "raro" },
  { premio: 50, peso: 150, rareza: "epico" },
  { premio: 100, peso: 100, rareza: "epico" },
  { premio: 200, peso: 50, rareza: "legendario" },
  { premio: 500, peso: 20, rareza: "legendario" },
  { premio: 1000, peso: 10, rareza: "mitico" },
  { premio: 2500, peso: PESO_JACKPOT, rareza: "mitico" },
];

export const PESO_TOTAL_RULETA = PREMIOS_RULETA.reduce((s, p) => s + p.peso, 0);

/** Probabilidad real de cada premio, para mostrarla sin mentirle al jugador. */
export const probabilidadesRuleta = () =>
  PREMIOS_RULETA.map((p) => ({
    ...p,
    probabilidad: p.peso / PESO_TOTAL_RULETA,
    unoEn: PESO_TOTAL_RULETA / p.peso,
  }));

/** Leyendas que la ruleta entrega en promedio por giro. */
export const valorEsperadoRuleta = () =>
  PREMIOS_RULETA.reduce((s, p) => s + p.premio * p.peso, 0) / PESO_TOTAL_RULETA;

/**
 * Un giro. El rng se inyecta para poder testearlo y para que el servidor
 * use una fuente criptográfica en lugar de Math.random.
 */
export function girarRuleta(rng = Math.random) {
  let acumulado = rng() * PESO_TOTAL_RULETA;
  for (const p of PREMIOS_RULETA) {
    acumulado -= p.peso;
    if (acumulado <= 0) return { premio: p.premio, rareza: p.rareza };
  }
  const ultimo = PREMIOS_RULETA[PREMIOS_RULETA.length - 1];
  return { premio: ultimo.premio, rareza: ultimo.rareza };
}

/** Milisegundos que faltan para el próximo giro (0 si ya está disponible). */
export function esperaRuleta(ultimoGiro, ahora = Date.now()) {
  if (!ultimoGiro) return 0;
  const listo = new Date(ultimoGiro).getTime() + HORAS_RULETA * 3600_000;
  return Math.max(0, listo - ahora);
}

export function esperaBonoDiario(ultimoBono, ahora = Date.now()) {
  if (!ultimoBono) return 0;
  const listo = new Date(ultimoBono).getTime() + HORAS_BONO_DIARIO * 3600_000;
  return Math.max(0, listo - ahora);
}

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
  BONO_DIARIO: "bono_diario",
  RULETA: "ruleta",
  REFERIDO: "referido",
  APUESTA: "apuesta",
  // Sumidero de la casa: no va al pozo ni a otro jugador.
  PENALIZACION_ABANDONO: "penalizacion_abandono",
  PREMIO_PARTIDA: "premio_partida",
  PREMIO_RANKING: "premio_ranking",
  COMPRA: "compra",
  TIENDA: "tienda",
};
