/**
 * La lista de suites de Node, en orden.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ UNA LISTA Y NO UN GLOB
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque el orden está elegido: las reglas puras primero y las de red después,
 * así que cuando algo se rompe abajo ya se sabe que lo de arriba está bien. Un
 * glob las corre por orden alfabético y esa señal se pierde.
 *
 * El precio de la lista es que hay que acordarse de agregar cada suite nueva, y
 * olvidarse no hace ruido: el archivo queda en el repositorio, se lee como una
 * prueba y no se ejecuta nunca. Ese precio ya está pagado —lo cobra
 * `suites-registradas.mjs`, que compara esta lista contra el disco en las dos
 * direcciones— así que el orden sale gratis.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Y POR QUÉ ES UN MÓDULO Y NO EL SCRIPT DE package.json
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Vivía ahí, como una cadena de ochenta y tres `node ... &&`. Mudarla acá es
 * lo que permite que `correr-todas.mjs` siga después de una falla en vez de
 * cortar, y de paso que el cerrojo lea una lista de verdad en vez de sacarla a
 * fuerza de expresiones regulares sobre un JSON.
 *
 * Los dos archivos de infraestructura —éste y el runner— NO van en la lista:
 * no son suites. `suites-registradas.mjs` los conoce por nombre.
 */
export const SUITES = [
  "puntaje.mjs",
  "salas.mjs",
  "salas-privadas.mjs",
  "salas-publicas.mjs",
  "juegos.mjs",
  "vista.mjs",
  "descarte.mjs",
  "estado.mjs",
  "transacciones.mjs",
  "saldos-separados.mjs",
  "devoluciones.mjs",
  "migrar-saldos.mjs",
  "ajustar-leyendas.mjs",
  "limpiar-perfiles.mjs",
  "limpiar-rankings.mjs",
  "abandono.mjs",
  "abandono-red.mjs",
  "salida.mjs",
  "cierre.mjs",
  "cierre-automatico.mjs",
  "red.mjs",
  "orquestador.mjs",
  "partida-completa.mjs",
  "red-e2e.mjs",
  "mesa-red.mjs",
  "desempate-red.mjs",
  "filtraciones.mjs",
  "rival.mjs",
  "descarte-al-rival.mjs",
  "ausente.mjs",
  "ausente-por-tiempo.mjs",
  "mirar-descarte.mjs",
  "tirar-reabre.mjs",
  // El cerrojo de la cadena de turno en red. Va después de las de red: lo
  // que mira son sus specs, no el juego.
  "cadena-de-turno.mjs",
  "admin.mjs",
  "ritmo.mjs",
  "validacion.mjs",
  "corte-ia.mjs",
  "escapado.mjs",
  "privacidad.mjs",
  "pagos.mjs",
  "paso-automatico.mjs",
  "cambio-victima.mjs",
  "reportes.mjs",
  "app-check.mjs",
  "administradores.mjs",
  "limite-puntos.mjs",
  "turnos-y-entrega.mjs",
  "tienda.mjs",
  "dorso.mjs",
  "cartas-imagenes.mjs",
  "leyendas-iniciales.mjs",
  "sin-ruleta.mjs",
  "sin-bono-diario.mjs",
  "insignias.mjs",
  "torneos.mjs",
  "ranking-servidor.mjs",
  "cierre-de-periodos.mjs",
  "migrar-rankings.mjs",
  "paginas-legales.mjs",
  "retratos-en-red.mjs",
  "corte-automatico.mjs",
  "panos.mjs",
  "imagenes-del-catalogo.mjs",
  "barrido.mjs",
  "revancha.mjs",
  "logros-y-packs.mjs",
  "premios-de-ranking.mjs",
  "dobles-de-partida.mjs",
  "packs.mjs",
  "reloj-para-decidir.mjs",
  "reloj-en-red.mjs",
  "llegada-sellada.mjs",
  "primera-ronda.mjs",
  "fallo-da-derecho.mjs",
  "ventana-tras-poder.mjs",
  "reglamento.mjs",
  "tiempos.mjs",
  "tiempos-en-prosa.mjs",
  "link-corto.mjs",
  "sitio.mjs",
  "css-incrustado.mjs",
  "reglas-de-salas.mjs",
  "sembrar-juegos.mjs",
  "suites-registradas.mjs",
];
