/**
 * Persistencia del ranking en Firestore.
 *
 * ⚠️ IMPORTANTE — SEGURIDAD
 * Tal como está, los puntos se escriben desde el navegador. Eso alcanza para
 * probar, pero NO para una tabla atada a dinero real: cualquiera con la consola
 * abierta puede escribirse los puntos que quiera. Antes de cobrar, `registrarPartida`
 * tiene que ejecutarse en una Cloud Function que reciba el resumen de la partida,
 * lo valide contra el servidor y escriba con permisos de admin; las reglas de
 * Firestore deben dejar estas colecciones en sólo lectura para los clientes:
 *
 *   match /rankings/{periodo}/jugadores/{uid} { allow read: if true; allow write: if false; }
 *   match /partidas/{id}                     { allow read: if false; allow write: if false; }
 *
 * Estructura:
 *   partidas/{partidaId}                          → registro inmutable de la partida
 *   rankings/{clavePeriodo}/jugadores/{jugadorId}  → fila acumulada de la tabla
 *   jugadores/{jugadorId}/rachas/actual           → raya de victorias en curso
 */

import {
  db,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  runTransaction,
  serverTimestamp,
} from "./firebase.js";

import {
  PERIODOS,
  clavesDePeriodos,
  esPartidaPuntuable,
  puntosDePartida,
  acumularFila,
  filaVacia,
  ZONA_POR_DEFECTO,
} from "./reglas/ranking.js";

/** Raya de victorias vigente de un jugador (0 si nunca ganó seguido). */
export async function leerRaya(jugadorId) {
  const ref = doc(db, "jugadores", jugadorId, "rachas", "actual");
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data().raya ?? 0) : 0;
}

/**
 * Registra una partida terminada y acumula sus puntos en las tres tablas.
 *
 * @param resumen  motor.resumenPartida(estado)
 * @param partida  { id, dePago, apuesta, jugadores: [...] }
 * @param opciones { fecha, zona, contexto } — `contexto[jugadorId].ibaUltimo`
 *                 indica si venía último al entrar en la ronda final.
 * @returns los resultados aplicados, o [] si la partida no puntuaba.
 */
export async function registrarPartida(resumen, partida, opciones = {}) {
  if (!esPartidaPuntuable(partida)) return [];

  const fecha = opciones.fecha ?? new Date();
  const zona = opciones.zona ?? ZONA_POR_DEFECTO;
  const contexto = opciones.contexto ?? {};
  const claves = clavesDePeriodos(fecha, zona);

  const humanos = resumen.posiciones.filter((p) => !p.esIA);

  // Las rayas se leen antes de la transacción: son de sólo lectura acá.
  const rayas = Object.fromEntries(
    await Promise.all(humanos.map(async (p) => [p.id, await leerRaya(p.id)])),
  );

  const resultados = humanos
    .map((p) =>
      puntosDePartida(
        resumen,
        p.id,
        { rayaPrevia: rayas[p.id], ibaUltimo: contexto[p.id]?.ibaUltimo },
        Number(partida.apuesta),
      ),
    )
    .filter(Boolean);

  await runTransaction(db, async (tx) => {
    const refPartida = doc(db, "partidas", partida.id);
    if ((await tx.get(refPartida)).exists()) {
      // Ya se contabilizó: evita que un reintento duplique los puntos.
      throw new Error(`La partida ${partida.id} ya estaba registrada`);
    }

    // Firestore exige todas las lecturas antes de cualquier escritura.
    const objetivos = [];
    for (const r of resultados) {
      for (const periodo of PERIODOS) {
        const ref = doc(db, "rankings", claves[periodo], "jugadores", r.jugadorId);
        objetivos.push({ ref, r, previo: (await tx.get(ref)).data() ?? filaVacia() });
      }
    }

    tx.set(refPartida, {
      ...partida,
      resumen,
      claves,
      resultados,
      creada: serverTimestamp(),
    });

    for (const { ref, r, previo } of objetivos) {
      tx.set(ref, {
        uid: r.jugadorId,
        jugadorId: r.jugadorId,
        ...acumularFila(previo, r),
        actualizada: serverTimestamp(),
      });
    }

    for (const r of resultados) {
      tx.set(doc(db, "jugadores", r.jugadorId, "rachas", "actual"), {
        raya: r.rayaNueva,
        actualizada: serverTimestamp(),
      });
    }
  });

  return resultados;
}

/**
 * Lee una tabla de clasificación ya ordenada.
 * @param periodo "semanal" | "mensual" | "anual"
 */
export async function leerTabla(periodo, { fecha = new Date(), zona = ZONA_POR_DEFECTO, tope = 50 } = {}) {
  const clave = clavesDePeriodos(fecha, zona)[periodo];
  if (!clave) throw new Error(`Período desconocido: ${periodo}`);

  const consulta = query(
    collection(db, "rankings", clave, "jugadores"),
    orderBy("puntos", "desc"),
    limit(tope),
  );

  const snap = await getDocs(consulta);
  return snap.docs.map((d, i) => ({ puesto: i + 1, ...d.data() }));
}

/** Puesto y puntos de un jugador concreto en un período. */
export async function leerPuestoDe(jugadorId, periodo, opciones = {}) {
  const tabla = await leerTabla(periodo, { ...opciones, tope: 500 });
  return tabla.find((f) => f.jugadorId === jugadorId) ?? null;
}
