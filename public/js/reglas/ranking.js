/**
 * Ranking de Memorie Legends.
 *
 * Sólo puntúan las partidas de pago: las gratis no suman nada. Cada partida
 * puntuable reparte puntos por posición y bonos por hazañas concretas.
 *
 * Módulo puro: no toca Firestore ni el DOM. Recibe el resumen de la partida
 * (motor.resumenPartida) y devuelve cuántos puntos gana cada jugador.
 */

import { bonoDeApuesta } from "./economia.js";

export const PUNTOS_RANKING = {
  PRIMER_LUGAR: 100,
  SEGUNDO_LUGAR: 50,
  TERCER_LUGAR: 25,
  CUARTO_LUGAR: 10,

  BONO_ELIMINACION: 20, // Eliminar a un jugador (que supere 150 pts)
  BONO_CORTE_PERFECTO: 15, // Quedarse sin cartas al cortar (-10 pts)
  BONO_RAYA: 10, // Ganar 3 partidas seguidas
  BONO_REMONTADA: 25, // Ganar yendo último en puntos
};

/** Rachas: a partir de cuántas victorias seguidas se paga el bono. */
export const RAYA_MINIMA = 3;

const PUNTOS_POR_POSICION = [
  PUNTOS_RANKING.PRIMER_LUGAR,
  PUNTOS_RANKING.SEGUNDO_LUGAR,
  PUNTOS_RANKING.TERCER_LUGAR,
  PUNTOS_RANKING.CUARTO_LUGAR,
];

/**
 * La tabla del reglamento está definida para 4 jugadores. En mesas de 2 o 3
 * se usa la misma escala recortada: el ganador siempre cobra 100.
 */
export function puntosPorPosicion(posicion) {
  return PUNTOS_POR_POSICION[posicion - 1] ?? 0;
}

// --------------------------------------------------------------- períodos

export const PERIODOS = ["semanal", "mensual", "anual"];

/**
 * Zona horaria en la que caen los reinicios (lunes 00:00, 1° 00:00).
 * Uruguay, que es donde se cobra (UYU). Hoy coincide con UTC-3.
 */
export const ZONA_POR_DEFECTO = "America/Montevideo";

/** Descompone una fecha en año/mes/día según la zona indicada. */
function partesLocales(fecha, zona) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const partes = Object.fromEntries(fmt.formatToParts(fecha).map((p) => [p.type, p.value]));
  const diasEn = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    anio: Number(partes.year),
    mes: Number(partes.month),
    dia: Number(partes.day),
    // 1 = lunes … 7 = domingo, como ISO.
    diaSemana: diasEn[partes.weekday] ?? 1,
  };
}

/**
 * Clave del período semanal: `semanal_` + la fecha del LUNES de esa semana.
 *
 * Se deriva del lunes y no del día en que corre el reinicio, para que sea
 * determinista: cualquier partida jugada durante la semana calcula la misma
 * clave sin tener que leer antes qué ranking está activo.
 */
export function claveSemanal(fecha = new Date(), zona = ZONA_POR_DEFECTO) {
  const { anio, mes, dia, diaSemana } = partesLocales(fecha, zona);
  const lunes = new Date(Date.UTC(anio, mes - 1, dia) - (diaSemana - 1) * 86400000);
  const iso = lunes.toISOString().slice(0, 10);
  return `semanal_${iso}`;
}

export function claveMensual(fecha = new Date(), zona = ZONA_POR_DEFECTO) {
  const { anio, mes } = partesLocales(fecha, zona);
  return `mensual_${anio}-${String(mes).padStart(2, "0")}`;
}

export function claveAnual(fecha = new Date(), zona = ZONA_POR_DEFECTO) {
  return `anual_${partesLocales(fecha, zona).anio}`;
}

export function clavePeriodo(periodo, fecha = new Date(), zona = ZONA_POR_DEFECTO) {
  if (periodo === "semanal") return claveSemanal(fecha, zona);
  if (periodo === "mensual") return claveMensual(fecha, zona);
  if (periodo === "anual") return claveAnual(fecha, zona);
  throw new Error(`Período desconocido: ${periodo}`);
}

/** Las tres claves de una fecha, para escribir las tres tablas a la vez. */
export function clavesDePeriodos(fecha = new Date(), zona = ZONA_POR_DEFECTO) {
  return {
    semanal: claveSemanal(fecha, zona),
    mensual: claveMensual(fecha, zona),
    anual: claveAnual(fecha, zona),
  };
}

// -------------------------------------------------------------- puntuación

/** Sólo entran al ranking las partidas donde se apostaron Leyendas. */
export const esPartidaPuntuable = (partida) =>
  Boolean(partida?.dePago) && Number(partida?.apuesta) > 0;

/**
 * Puntos de un jugador en una partida.
 *
 * @param resumen     lo que devuelve motor.resumenPartida()
 * @param jugadorId   de quién se calcula
 * @param historial   { rayaPrevia, ibaUltimo } — contexto que el motor no conoce:
 *                    victorias seguidas ANTES de esta partida, y si el jugador
 *                    venía último en puntos al empezar la ronda final.
 */
export function puntosDePartida(resumen, jugadorId, historial = {}, apuesta = 0) {
  const entrada = resumen.posiciones.find((p) => p.id === jugadorId);
  if (!entrada) return null;

  const { multiplicador, exp } = bonoDeApuesta(apuesta);

  const gano = resumen.ganadorId === jugadorId;
  const posicion = puntosPorPosicion(entrada.posicion);

  const eliminaciones = resumen.eventos.filter(
    (ev) => ev.tipo === "eliminacion" && ev.porId === jugadorId,
  ).length;

  const cortesPerfectos = resumen.eventos.filter(
    (ev) => ev.tipo === "cortePerfecto" && ev.id === jugadorId,
  ).length;

  const rayaNueva = gano ? (historial.rayaPrevia ?? 0) + 1 : 0;
  const cobraRaya = rayaNueva >= RAYA_MINIMA;
  const cobraRemontada = gano && Boolean(historial.ibaUltimo);

  const desglose = {
    posicion,
    eliminaciones: eliminaciones * PUNTOS_RANKING.BONO_ELIMINACION,
    cortePerfecto: cortesPerfectos * PUNTOS_RANKING.BONO_CORTE_PERFECTO,
    raya: cobraRaya ? PUNTOS_RANKING.BONO_RAYA : 0,
    remontada: cobraRemontada ? PUNTOS_RANKING.BONO_REMONTADA : 0,
  };

  const base = Object.values(desglose).reduce((a, b) => a + b, 0);

  return {
    jugadorId,
    posicionFinal: entrada.posicion,
    gano,
    rayaNueva,
    desglose,
    base,
    // Apostar más multiplica lo ganado en la mesa.
    multiplicador,
    exp,
    eliminaciones,
    cortesPerfectos,
    remontada: cobraRemontada,
    total: base * multiplicador,
  };
}

/**
 * Puntos de todos los jugadores humanos de una partida.
 * Las IAs no puntúan: el ranking es de personas.
 */
export function puntosDeLaMesa(resumen, partida, historiales = {}) {
  if (!esPartidaPuntuable(partida)) return [];

  return resumen.posiciones
    .filter((p) => !p.esIA)
    .map((p) => puntosDePartida(resumen, p.id, historiales[p.id], Number(partida.apuesta)))
    .filter(Boolean);
}

// ------------------------------------------------------------- tabla

/**
 * Fila acumulada de un jugador, con los campos del esquema de Firestore.
 */
export const filaVacia = () => ({
  puntos: 0,
  partidasJugadas: 0,
  partidasGanadas: 0,
  eliminaciones: 0,
  cortesPerfectos: 0,
  rachaActual: 0,
  mejorRacha: 0,
  remontadas: 0,
  exp: 0,
});

/** Suma un resultado de partida sobre la fila acumulada de un jugador. */
export function acumularFila(previo, r) {
  const base = { ...filaVacia(), ...previo };
  return {
    puntos: base.puntos + r.total,
    partidasJugadas: base.partidasJugadas + 1,
    partidasGanadas: base.partidasGanadas + (r.gano ? 1 : 0),
    eliminaciones: base.eliminaciones + r.eliminaciones,
    cortesPerfectos: base.cortesPerfectos + r.cortesPerfectos,
    rachaActual: r.rayaNueva,
    mejorRacha: Math.max(base.mejorRacha, r.rayaNueva),
    remontadas: base.remontadas + (r.remontada ? 1 : 0),
    exp: base.exp + r.exp,
  };
}

export function acumularEnTabla(tabla, resultados) {
  const nueva = { ...tabla };
  for (const r of resultados) {
    nueva[r.jugadorId] = acumularFila(nueva[r.jugadorId], r);
  }
  return nueva;
}

/** Ordena una tabla para mostrarla: más puntos primero. */
export function ordenarTabla(tabla) {
  return Object.entries(tabla)
    .map(([jugadorId, datos]) => ({ jugadorId, ...datos }))
    .sort(
      (a, b) =>
        b.puntos - a.puntos ||
        b.partidasGanadas - a.partidasGanadas ||
        a.partidasJugadas - b.partidasJugadas,
    )
    .map((fila, i) => ({ ...fila, puesto: i + 1 }));
}
