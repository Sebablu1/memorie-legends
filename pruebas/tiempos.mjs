/**
 * El cronómetro de la mesa.
 *
 * Mide lo que dura cada fase DE VERDAD, que no es lo mismo que lo que dice la
 * constante: entre `MS_DESCARTE = 5000` y lo que vive el jugador hay un
 * navegador, tres IA con relojes propios y, en red, un servidor.
 *
 * Acá se prueba la contabilidad con un reloj de mentira —sin esperar cinco
 * segundos de verdad—: que abrir cierre la anterior, que el desvío tenga el
 * signo correcto, que el historial no crezca para siempre y que una fase sin
 * duración fija no invente un desvío.
 *
 * Que los tiempos MEDIDOS coincidan con los configurados en una mesa que corre
 * se prueba en el navegador: `pruebas/e2e/tiempos.spec.js`.
 */

import { crearMedidorDeTiempos, TOPE_HISTORIAL } from "../public/js/modulos/tiempos.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

/** Un reloj que avanza sólo cuando se lo pide. */
function relojFalso(desde = 1_000_000) {
  let t = desde;
  return { ahora: () => t, avanzar: (ms) => { t += ms; } };
}

// =====================================================================
console.log("\n=== 1. Una fase se abre, corre y se cierra ===");
// =====================================================================
{
  const reloj = relojFalso();
  const m = crearMedidorDeTiempos({ ahora: reloj.ahora });

  ok(m.enCurso() === null, "sin nada abierto, no hay fase en curso");

  m.abrir("descarte", 5000);
  reloj.avanzar(1200);

  const enCurso = m.enCurso();
  ok(enCurso.fase === "descarte", "la fase en curso es la que se abrió", enCurso.fase);
  ok(enCurso.transcurrido === 1200, "con lo que lleva", enCurso.transcurrido);
  ok(enCurso.restante === 3800, "y lo que le queda", enCurso.restante);

  reloj.avanzar(3800);
  const fila = m.cerrar();
  ok(fila.real === 5000, "al cerrar, duró lo que duró", fila.real);
  ok(fila.desvio === 0, "y el desvío es cero cuando duró lo pedido", fila.desvio);
  ok(m.enCurso() === null, "y ya no hay nada en curso");
}

// =====================================================================
console.log("\n=== 2. El desvío tiene signo ===");
// =====================================================================
{
  const reloj = relojFalso();
  const m = crearMedidorDeTiempos({ ahora: reloj.ahora });

  m.abrir("mirar", 2000);
  reloj.avanzar(1400);
  const corta = m.cerrar("cancelada");
  ok(corta.desvio === -600, "cerrar antes da desvío negativo", corta.desvio);
  ok(corta.motivo === "cancelada", "y queda anotado por qué se cerró", corta.motivo);

  m.abrir("turno", 8000);
  reloj.avanzar(8600);
  ok(m.cerrar().desvio === 600, "pasarse da desvío positivo");
}

// =====================================================================
console.log("\n=== 3. Abrir cierra lo anterior: nunca hay dos relojes ===");
// =====================================================================
{
  const reloj = relojFalso();
  const m = crearMedidorDeTiempos({ ahora: reloj.ahora });

  m.abrir("elegirMirada", 5000);
  reloj.avanzar(900);
  m.abrir("mirar", 2000);

  const h = m.historial();
  ok(h.length === 1, "la anterior quedó cerrada sola", h.length);
  ok(h[0].fase === "elegirMirada" && h[0].real === 900,
     "con lo que llegó a durar", h[0]);
  ok(h[0].motivo === "reemplazada", "y dice que la reemplazaron", h[0].motivo);
  ok(m.enCurso().fase === "mirar", "y la nueva quedó en curso");

  ok(m.cerrar() !== null, "cerrar la que está devuelve su fila");
  ok(m.cerrar() === null, "cerrar dos veces no inventa una segunda");
}

// =====================================================================
console.log("\n=== 4. Las rondas agrupan ===");
// =====================================================================
{
  const reloj = relojFalso();
  const m = crearMedidorDeTiempos({ ahora: reloj.ahora });

  m.ronda(1);
  m.abrir("descarte", 5000);
  reloj.avanzar(5000);
  m.cerrar();

  m.ronda(2);
  m.abrir("descarte", 5000);
  reloj.avanzar(4800);
  m.cerrar();

  const descartes = m.de("descarte");
  ok(descartes.length === 2, "dos descartes en el historial", descartes.length);
  ok(descartes[0].ronda === 1 && descartes[1].ronda === 2,
     "cada uno con su ronda", descartes.map((d) => d.ronda));
  ok(m.de("turno").length === 0, "y preguntar por una fase que no pasó no devuelve nada");
}

// =====================================================================
console.log("\n=== 5. Una fase sin duración fija no inventa desvío ===");
// =====================================================================
{
  const reloj = relojFalso();
  const m = crearMedidorDeTiempos({ ahora: reloj.ahora });

  m.abrir("esperandoJugadores");
  reloj.avanzar(3000);
  ok(m.enCurso().restante === null, "sin duración pedida, no hay restante");

  const fila = m.cerrar();
  ok(fila.configurado === null, "ni configurado", fila.configurado);
  ok(fila.real === 3000, "pero sí lo que duró", fila.real);
}

// =====================================================================
console.log("\n=== 6. El historial no crece para siempre ===");
// =====================================================================
{
  const reloj = relojFalso();
  const m = crearMedidorDeTiempos({ ahora: reloj.ahora });

  for (let i = 0; i < TOPE_HISTORIAL + 20; i++) {
    m.abrir(`fase${i}`, 1000);
    reloj.avanzar(1000);
    m.cerrar();
  }

  const h = m.historial();
  ok(h.length === TOPE_HISTORIAL, `se guardan ${TOPE_HISTORIAL} y no más`, h.length);
  ok(h.at(-1).fase === `fase${TOPE_HISTORIAL + 19}`, "las últimas son las que quedan", h.at(-1).fase);
  ok(h[0].fase === "fase20", "y las viejas se van por el principio", h[0].fase);
}

// =====================================================================
console.log("\n=== 7. El historial que sale es una copia ===");
// =====================================================================
{
  const m = crearMedidorDeTiempos({ ahora: () => 0 });
  m.abrir("descarte", 5000);
  m.cerrar();

  const h = m.historial();
  h[0].real = 99999;
  ok(m.historial()[0].real === 0,
     "tocar lo que devuelve no cambia lo medido", m.historial()[0].real);
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
