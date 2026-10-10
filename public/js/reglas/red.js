/**
 * Protocolo de la ventana de descarte en red.
 *
 * EL PROBLEMA
 *
 * Si el servidor resolviera "gana el primero" por el orden en que le llegan
 * los pedidos, el juego dejaría de medir reflejos y pasaría a medir conexión.
 * Con 40 ms contra 180 ms, el de la fibra gana siempre, aunque el otro haya
 * reaccionado antes de verdad.
 *
 * LA SOLUCIÓN
 *
 * El servidor NO resuelve al recibir. Abre una ventana, junta todos los
 * intentos que lleguen mientras dura (más un margen de gracia para los
 * paquetes lentos) y recién al cerrarla los ordena por el momento en que
 * cada jugador REACCIONÓ, no por el momento en que su pedido llegó.
 *
 * Ese momento lo dice el cliente, y el cliente miente. Por eso no se usa tal
 * cual: se acota al intervalo físicamente posible. El cliente puede afinar su
 * tiempo dentro de lo que su propia latencia ya justificaba, y nada más.
 * Declarar "reaccioné en el milisegundo cero" no sirve de nada: el reloj se
 * corrige hasta el borde de lo plausible, que es donde queda igualmente un
 * jugador honesto con esa misma conexión.
 *
 * Lo que queda sin resolver después de eso es el empate técnico, y ahí hace
 * falta una regla determinista. La hubo —`favorecido`, un sorteo sembrado con
 * el id de la ventana— y se fue cuando los descartes pasaron a aplicarse al
 * llegar: sin un cierre donde juntar y ordenar, no hay empate que romper.
 *
 * Módulo puro: ni Firestore ni DOM. Lo usan el navegador (para estimar su
 * desfase y armar el intento) y el servidor (que es el que decide).
 */

import { MS_DESCARTE, MS_MIRADA_TOTAL, MS_REAPERTURA } from "./motor.js";

// ------------------------------------------------------------ constantes

/**
 * Lo que duran las ventanas de reflejos: la de la ronda y las reaperturas.
 *
 * Las dos se re-exportan del motor en vez de escribir los números otra vez.
 * Tenerlos duplicados ya nos costó una divergencia silenciosa —el
 * entrenamiento midiendo el doble que las partidas por Leyendas, con las
 * pruebas en verde porque cada modo leía su propia copia—. Son la misma regla
 * y tienen que salir del mismo lugar.
 */
export const MS_VENTANA = MS_DESCARTE;
export const MS_VENTANA_REAPERTURA = MS_REAPERTURA;

/**
 * La ventana de la ronda arranca cuando arranca la MIRADA, no después.
 *
 * La muestra puede ser justo la carta que acabás de memorizar, y ese descarte
 * era imposible: la fase todavía era `mirar` y no existía ninguna ventana a la
 * que pertenecer.
 *
 *   0 s ───────────────── 5 s ─── 7 s ───────────────── 12 s ──── 14 s
 *        elegir qué mirar        verla      DESCARTE       gracia
 *        └──────────────── una sola ventana ──────────────────┘
 *
 * Son doce segundos: los siete de la mirada —cinco para elegir, dos para
 * ver— más los cinco de descarte de siempre. Lo que vive el jugador no cambia:
 * sólo cambia dónde empieza a contar la ventana.
 *
 * Vive acá, con las otras duraciones, y no en el servidor: es una regla del
 * juego y el navegador también tiene que poder leerla.
 */
export const MS_VENTANA_TOTAL = MS_MIRADA_TOTAL + MS_VENTANA;

/**
 * Margen extra en el que todavía se aceptan intentos ya enviados.
 *
 * Un jugador que tocó en el milisegundo 4990 con 300 ms de latencia llega al
 * servidor en el 5290: sin esta gracia, su acción legítima se perdería. Lo
 * que se acepta tarde es la LLEGADA, nunca la reacción: un intento cuyo
 * tiempo efectivo cae fuera de la ventana se descarta igual.
 */
export const MS_GRACIA = 2000;

/**
 * Lo que el servidor espera la carta de una entrega, además de lo que el
 * jugador ve en su pantalla (`MS_PARA_ENTREGAR`).
 *
 * El reloj de la pantalla arranca cuando llega la respuesta que dice «le
 * acertaste», y la elección tarda en volver lo mismo que tardó en ir. Sin
 * este margen, una elección hecha en el último segundo se perdería en el
 * viaje y la carta saldría al azar.
 */
export const MS_GRACIA_ENTREGA = 2000;


/** Tope de lo que se acepta como latencia de un solo sentido. */
export const MS_LATENCIA_MAXIMA = 1500;

// ------------------------------------------------- sincronización de reloj

/**
 * Una muestra de sincronización, al estilo NTP:
 *
 *   t0  el cliente manda el pedido
 *   t1  el servidor responde con SU reloj
 *   t2  el cliente recibe la respuesta
 *
 * El viaje de ida y el de vuelta se suponen simétricos. No lo son del todo,
 * y esa asimetría es justamente parte de la incertidumbre que se reporta.
 */
export function muestraDeReloj({ t0, t1, t2 }) {
  const viaje = t2 - t0;
  return {
    // Cuánto hay que sumarle al reloj del cliente para leer el del servidor.
    desfase: t1 - (t0 + t2) / 2,
    viaje,
    // Peor caso del error de esa estimación.
    incertidumbre: viaje / 2,
  };
}

/**
 * Mejor estimación a partir de varias muestras.
 *
 * Se queda con la de viaje más corto en vez de promediar: un promedio arrastra
 * las muestras que pasaron por un pico de congestión, y son justamente las
 * peores. La más rápida es la que menos se pudo distorsionar.
 */
export function estimarReloj(muestras) {
  if (!muestras?.length) return { desfase: 0, incertidumbre: MS_LATENCIA_MAXIMA, muestras: 0 };
  const mejor = muestras.reduce((a, b) => (b.viaje < a.viaje ? b : a));
  return {
    desfase: mejor.desfase,
    incertidumbre: Math.max(mejor.incertidumbre, 1),
    viaje: mejor.viaje,
    muestras: muestras.length,
  };
}

// -------------------------------------------------------------- ventanas

/**
 * Ventana de descarte.
 *
 * `id` lo genera el servidor y es impredecible: además de identificar la
 * ventana, es la semilla del desempate, y si se pudiera adivinar se podría
 * elegir cuándo conviene empatar.
 */
export function crearVentana({ id, abiertaEn, duracionMs = MS_VENTANA, graciaMs = MS_GRACIA }) {
  return {
    id,
    abiertaEn,
    duracionMs,
    graciaMs,
    cerrada: false,
    intentos: {},
  };
}

/**
 * ¿Todavía se aceptan LLEGADAS en esta ventana?
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA GRACIA DE 2 s SE FUE, Y NO ES UN OLVIDO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Decía `ahora <= abiertaEn + duracionMs + graciaMs`. La ventana vencía sola
 * a los 2 o 3 segundos, y los 2 de gracia existían para el paquete que salió
 * a tiempo y llegó tarde: tocar en el milisegundo 4990 con 300 ms de latencia
 * llegaba en el 5290, y sin el margen se perdía una jugada legítima.
 *
 * En red la ventana ya no vence sola: dura lo que dure la MUESTRA. La cierra
 * el que tira, porque tirar la cambia. Y ahí está el problema del margen: el
 * cierre y el cambio de muestra son el MISMO instante, así que no queda un
 * «después» en el que un reflejo tardío pueda aplicarse bien.
 * `intentarDescarte` vuelve a comparar la carta contra `cima(descarte)`, así
 * que un pedido de la muestra vieja se evaluaría contra la nueva — y el que
 * reaccionó bien se comería un castigo por haber acertado.
 *
 * Darle margen igual sería peor que no dárselo. Y el borde que cubría casi
 * desaparece: sin cronómetro nadie corre contra un reloj, la gente reacciona
 * cuando se da cuenta y tiene el turno entero del siguiente en vez de dos
 * segundos. Si algún día molesta, se agrega; no es irreversible.
 *
 * `duracionMs` y `graciaMs` siguen en el objeto —la mesa los lee para
 * dibujar, y `MS_GRACIA_ENTREGA` es otra cosa— pero acá ya no deciden nada.
 *
 * Esto es SÓLO de red: `aceptaLlegadas` tiene un único uso,
 * `registrarIntento`, y a ésa la llama sólo el orquestador. `mesa.js` no
 * nombra ninguna de las dos.
 */
export const aceptaLlegadas = (ventana, ahora) =>
  !ventana.cerrada && ahora >= ventana.abiertaEn;

/**
 * Los ataques acertados que todavía esperan que su dueño elija la carta.
 *
 * Mientras haya alguno, la ventana no se resuelve: resolverla sin la carta
 * dejaría un hueco en la mano del rival, y un hueco puede ser «se quedó sin
 * cartas» y cortar la ronda por un jugador que no se quedó sin nada.
 */
export const entregasPendientes = (ventana) =>
  Object.values(ventana?.intentos ?? {}).filter(
    // `aplicadoAlLlegar` es lo que hace que un acierto ya resuelto deje de
    // contar. Hace falta desde que la entrega tiene su propio plazo y no la
    // espera el cierre: sin esto, el plazo se volvía a calcular después de
    // cumplirse y la carta salía al azar una vez por golpe. (Etapa 3b/3)
    (i) => i.esperaEntrega && i.posicionEntrega == null && !i.aplicadoAlLlegar,
  );

/**
 * ¿Ya se puede cerrar?
 *
 * Al final de la ventana, o al final de la última entrega pendiente, lo que
 * pase después. Las entregas sólo pueden estirar el cierre, nunca adelantarlo.
 * Lo que NO estiran es el tiempo para intentar: eso lo sigue diciendo
 * `aceptaLlegadas`.
 */
export const venceEn = (ventana) =>
  Math.max(
    ventana.abiertaEn + ventana.duracionMs + ventana.graciaMs,
    ...entregasPendientes(ventana).map((i) => i.entregaHasta),
  );
export const yaVencio = (ventana, ahora) => ahora > venceEn(ventana);

// ------------------------------------------------- el tiempo que vale

/**
 * Momento de la reacción, medido desde que se abrió la ventana.
 *
 * `declarado` es lo que dice el cliente. Se acepta sólo dentro del intervalo
 * que su propia llegada hace posible:
 *
 *   - no puede ser POSTERIOR a la llegada: nadie reacciona después de que su
 *     pedido ya llegó;
 *   - no puede ser ANTERIOR a `llegada - latencia - incertidumbre`: por más
 *     que lo afirme, el paquete habría tenido que viajar hacia atrás.
 *
 * El borde inferior es el único que un tramposo quiere forzar, y ahí es donde
 * termina: exactamente donde queda un jugador honesto con su misma conexión.
 * Mentir no da ventaja; a lo sumo recupera la que la red le quitó.
 */
export function tiempoEfectivo({ declarado, llegada, latencia, incertidumbre }) {
  const lat = Math.min(Math.max(Number(latencia) || 0, 0), MS_LATENCIA_MAXIMA);
  const inc = Math.min(Math.max(Number(incertidumbre) || 0, 0), MS_LATENCIA_MAXIMA);

  const minimoPosible = Math.max(0, llegada - lat - inc);
  const maximoPosible = llegada;

  // Un declarado ausente o disparatado cae en la llegada: el peor caso para
  // quien no manda un tiempo utilizable, nunca el mejor.
  const base = Number.isFinite(declarado) ? declarado : maximoPosible;

  return Math.min(Math.max(base, minimoPosible), maximoPosible);
}

// ------------------------------------------------------------- desempate




/**
 * Qué cartas puede tocar quien está usando un poder.
 *
 * Es una regla de INTERFAZ, no de seguridad. El servidor valida lo mismo por
 * su cuenta en `exigirPosiciones` y rechaza cualquier cosa que no cumpla; esto
 * existe para que el jugador vea de antemano qué puede tocar, en vez de
 * probar y comerse un error.
 *
 * Las cuatro reglas salen del reglamento:
 *
 *   7   mirarPropia      una carta propia
 *   8   mirarRival       una carta de otro
 *   9   cambioCiego      primero una propia, después una de otro
 *   10  cambioConVista   igual que el 9, pero se ven las dos
 *
 * Un hueco —una posición de la que ya salió la carta— nunca es elegible: no
 * hay nada ahí que mirar ni que cambiar.
 *
 * @param numero          7, 8, 9 o 10
 * @param yo              índice del que usa el poder
 * @param jugadores       los jugadores tal como los ve la vista
 * @param propiaElegida   para el 9 y el 10: la posición propia ya elegida,
 *                        o null si todavía falta elegirla
 * @returns {(indiceJugador: number, posicion: number) => boolean}
 */
export function elegibleParaPoder({ numero, yo, jugadores, propiaElegida = null }) {
  const hayCarta = (i, pos) => Boolean(jugadores?.[i]?.mano?.[pos]);
  const enJuego = (i) => Boolean(jugadores?.[i]) && !jugadores[i].eliminado;

  return (indiceJugador, posicion) => {
    if (!hayCarta(indiceJugador, posicion)) return false;
    if (!enJuego(indiceJugador)) return false;

    // El 7 mira una carta propia; el 8, una ajena.
    if (numero === 7) return indiceJugador === yo;
    if (numero === 8) return indiceJugador !== yo;

    if (numero === 9 || numero === 10) {
      // Primero la propia, después la del rival. Nunca dos propias: cambiar
      // una carta consigo mismo no es una jugada.
      return propiaElegida === null ? indiceJugador === yo : indiceJugador !== yo;
    }

    return false;
  };
}

/** Qué hay que pedirle al jugador ahora mismo. */
export function pasoDelPoder({ numero, propiaElegida = null }) {
  // Cortas y sin negrita: la pista entera ya es `font-weight: 700`, y el
  // renglón del teléfono aguanta 38 caracteres. Ver `pistaDeRed`. (§55)
  if (numero === 7) return "Mirá una carta tuya.";
  if (numero === 8) return "Mirá una carta de otro.";
  if (numero === 9 || numero === 10) {
    return propiaElegida === null
      ? "Elegí una carta tuya para cambiar."
      : "Ahora una de otro jugador.";
  }
  return "";
}

// ------------------------------------------------- orden de las vistas

/**
 * Descarta las vistas que llegan viejas o repetidas.
 *
 * Firestore reenvía el documento actual al suscribirse, puede repetir una
 * versión ya entregada y, después de una reconexión, puede entregar
 * actualizaciones fuera de orden. Pintar una vista vieja encima de una nueva
 * haría reaparecer cartas ya jugadas y devolvería el turno a quien ya jugó:
 * el jugador vería la partida retroceder.
 *
 * Una vista sin número de versión se acepta —no hay con qué compararla— pero
 * no baja el listón para las que sí lo traen.
 *
 * @returns {(vista: object) => boolean} true si hay que pintarla
 */
export function crearFiltroDeVersion() {
  let ultima = -Infinity;
  return (vista) => {
    const v = vista?.version;
    if (typeof v !== "number") return true;
    if (v <= ultima) return false;
    ultima = v;
    return true;
  };
}

// ------------------------------------------------------------- registro

export const RECHAZO_INTENTO = {
  VENTANA_DISTINTA: "ventana_distinta",
  VENTANA_CERRADA: "ventana_cerrada",
  FUERA_DE_TIEMPO: "fuera_de_tiempo",
  NO_JUGADOR: "no_jugador",
  POSICION_INVALIDA: "posicion_invalida",
  FALTA_IDENTIFICADOR: "falta_identificador",
  YA_INTENTO: "ya_intento",
};

/**
 * Anota un intento en la ventana. No resuelve nada: sólo lo guarda.
 *
 * Es idempotente por `clientActionId`. Si el mismo identificador llega dos
 * veces —reintento por timeout, doble clic, recarga— la segunda no cambia
 * nada y se informa como duplicada. Eso importa más de lo que parece: sin
 * esto, un reintento por una respuesta perdida contaría como un intento nuevo
 * y podría costarle al jugador una carta de castigo que no merecía.
 *
 * @returns {{ok: true, ventana, duplicado: boolean} | {ok: false, motivo: string}}
 */
export function registrarIntento(
  ventana, intento, { ahora, cantidadDeCartas, tiroGastado = false },
) {
  const { windowId, clientActionId, uid, posicion } = intento;

  if (!clientActionId || !uid) return { ok: false, motivo: RECHAZO_INTENTO.FALTA_IDENTIFICADOR };
  if (windowId !== ventana.id) return { ok: false, motivo: RECHAZO_INTENTO.VENTANA_DISTINTA };
  if (ventana.cerrada) return { ok: false, motivo: RECHAZO_INTENTO.VENTANA_CERRADA };
  if (!aceptaLlegadas(ventana, ahora)) return { ok: false, motivo: RECHAZO_INTENTO.FUERA_DE_TIEMPO };

  if (!Number.isInteger(posicion) || posicion < 0 || posicion >= cantidadDeCartas) {
    return { ok: false, motivo: RECHAZO_INTENTO.POSICION_INVALIDA };
  }

  // Reintento TÉCNICO: el mismo pedido mandado dos veces porque se perdió la
  // respuesta. Se contesta que sí, sin volver a anotar. Un reintento de red no
  // puede costar una carta de castigo.
  //
  // Ojo: esto NO limita al jugador a un intento por ventana, y no debe
  // hacerlo. Sobre una carta conocida de un rival se puede volver a intentar
  // mientras dure la ventana —sumando un castigo por cada error—: es la regla.
  // Un identificador nuevo es un intento humano nuevo, y es legítimo.
  if (ventana.intentos[clientActionId]) {
    return { ok: true, ventana, duplicado: true };
  }

  // Y ACÁ, EN CAMBIO, SÍ SE LIMITA: pero sólo contra la mano PROPIA.
  //
  // Sobre lo propio el descarte es una carrera de reflejos: hay un tiro y se
  // vive con él. Sin este límite, tocar tres cartas costaba tres castigos —lo
  // reproduje: cuatro cartas antes, siete después— porque cada clic llegaba
  // con un identificador nuevo y al cerrar la ventana se aplicaban todos.
  //
  // Sobre la mano de un RIVAL no se limita, por lo que dice el comentario de
  // arriba: se puede intentar más de una vez sobre una carta que se conoce.
  const contraSuPropiaMano = (intento.objetivo ?? uid) === uid;
  const yaJugoLoSuyo = Object.values(ventana.intentos)
    .some((x) => x.uid === uid && (x.objetivo ?? x.uid) === x.uid);

  /**
   * `tiroGastado` lo trae quien llama, leyéndolo del estado del motor.
   *
   * El límite es de UNA por muestra, y sobre una misma muestra puede haber dos
   * ventanas: la de reflejos de todos y la corta que se abre tras un poder.
   * Esta función ve una sola —la que recibe— así que la otra mitad del dato
   * tiene que venir de afuera. Sin esto, quien gastó su tiro en la primera lo
   * recuperaba en la segunda, que es justo lo que la regla nueva no quiere.
   */
  if (contraSuPropiaMano && (yaJugoLoSuyo || tiroGastado)) {
    return { ok: false, motivo: RECHAZO_INTENTO.YA_INTENTO };
  }

  const llegada = ahora - ventana.abiertaEn;
  const efectivo = tiempoEfectivo({
    declarado: intento.declarado,
    llegada,
    latencia: intento.latencia,
    incertidumbre: intento.incertidumbre,
  });

  /*
   * ACÁ ESTABA EL ÚLTIMO CRONÓMETRO DE REFLEJOS. (Etapa 3b/3)
   *
   * Decía `if (efectivo > ventana.duracionMs) → fuera de tiempo`, y era la
   * otra mitad de la gracia: la LLEGADA podía caer en el margen, la REACCIÓN
   * no. Con una ventana que vencía a los 2 s era la regla; sin cronómetro es
   * un techo que ya no mide nada.
   *
   * Es el único de los relojes de reflejos que no estaba en `plazoDe`, y por
   * eso sobrevivió a la primera pasada: un descarte legítimo hecho en el
   * segundo 5 de una ventana abierta volvía con «Llegaste fuera de tiempo».
   *
   * `efectivo` se sigue calculando y se sigue guardando. No decide nada —el
   * orden es el de llegada desde la etapa 2— pero es el único registro de
   * CUÁNDO reaccionó cada uno, y eso es lo que se mira cuando alguien
   * pregunta por qué perdió una mano.
   *
   * Lo que sigue cerrando la puerta es `aceptaLlegadas`: la ventana del
   * intento tiene que ser la vigente y no estar cerrada. Y la cierra el que
   * cambia la muestra. Ver `CIERRAN_LA_VENTANA` en `partida-red.js`.
   */

  return {
    ok: true,
    duplicado: false,
    ventana: {
      ...ventana,
      intentos: {
        ...ventana.intentos,
        [clientActionId]: {
          clientActionId,
          uid,
          // De quién es la mano que se toca: la propia, o la de un rival
          // del que se conoce esa carta.
          objetivo: intento.objetivo ?? uid,
          posicion,
          // Qué carta propia se entrega si el intento sobre un rival acierta.
          // Es una POSICIÓN elegida a ciegas: el jugador no sabe cuál es.
          // Sobre la mano propia no significa nada y viaja como null.
          posicionEntrega: Number.isInteger(intento.posicionEntrega)
            ? intento.posicionEntrega
            : null,
          // Acertó y todavía no eligió qué carta da: la ventana lo espera
          // hasta `entregaHasta`, que es una hora del servidor.
          ...(intento.esperaEntrega
            ? { esperaEntrega: true, entregaHasta: intento.entregaHasta }
            : {}),
          declarado: Number.isFinite(intento.declarado) ? intento.declarado : null,
          llegada,
          efectivo,
          latencia: Number(intento.latencia) || 0,
          incertidumbre: Number(intento.incertidumbre) || 0,
        },
      },
    },
  };
}

// ------------------------------------------------ el reloj para decidir

/**
 * Cuánto tiene un jugador para decidir qué hace con lo que ya tiene en la mano.
 *
 * ───────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTAS TRES FASES NO TENÍAN RELOJ
 * ───────────────────────────────────────────────────────────────────────
 *
 * Porque el que levantó una carta o usó un poder TIENE la carta: no deja a la
 * mesa esperando por descuido, va a hacer algo con ella. Ese razonamiento vale
 * en una mesa de living, donde los cuatro se miran. En red no: quien se
 * levanta a atender el timbre con una carta en la mano congela la partida de
 * los otros tres, y `saltarAusente` no lo rescata porque exige quince segundos
 * de SILENCIO — una pestaña abierta sigue latiendo.
 *
 * ───────────────────────────────────────────────────────────────────────
 * POR QUÉ SALTAR Y NO DESCARTAR, SALVO EN UN CASO
 * ───────────────────────────────────────────────────────────────────────
 *
 * Descartar automáticamente es jugar por otro, y sólo se hace cuando hay una
 * sola jugada posible. Con una carta levantada la hay: se la queda o la tira, y
 * tirarla es lo único que no le cambia la mano sin que él lo pida.
 *
 * Con un poder no la hay. ¿Con qué carta cambia el 9? ¿Mira la propia o la del
 * rival con el 7 y el 8? Y el 10 es el peor: ya vio las dos cartas, así que
 * cualquier cosa que el servidor elija por él usa información que él tiene y
 * el servidor no puede interpretar. Ahí no se decide: se salta.
 *
 * ───────────────────────────────────────────────────────────────────────
 * ESTO NO DECIDE CUÁNDO VENCE, SÓLO QUÉ PASA AL VENCER
 * ───────────────────────────────────────────────────────────────────────
 *
 * El vencimiento lo calcula el servidor con su reloj, en `plazoDe`. Acá vive
 * la tabla —qué fase merece reloj y qué hacer cuando se agota— que es la parte
 * que se puede leer, discutir y probar sin levantar nada.
 */
export const MS_PARA_DECIDIR = 5_000;

/**
 * Lo que tiene el jugador para usar un poder, cuando la caja ya esta abierta.
 *
 * Diez segundos: elegir con que carta cambia el 9, o ver las dos del 10 y
 * decidir, es una jugada con informacion nueva en pantalla. Cinco alcanzan para
 * tirar o cambiar la levantada, no para esto.
 */
export const MS_PARA_USAR_PODER = 10_000;

/**
 * Cuanto dura la decision segun la fase.
 *
 * `levantada` (tirar/cambiar/usar sin abrir la caja) son cinco. `poder` y
 * `cambioConVista` (la caja abierta, con las cartas a la vista) son diez.
 */
export const msDeLaDecision = (fase) =>
  fase === 'levantada' ? MS_PARA_DECIDIR : MS_PARA_USAR_PODER;

/**
 * Qué hace el servidor cuando se agotan los diez segundos, por fase.
 *
 * Las cuatro cartas con poder —7, 8, 9 y 10— comparten la fase `poder`: el
 * número está en `poderPendiente`, no en la fase. Por eso la tabla tiene tres
 * entradas y no cinco, y por eso no hace falta distinguirlas: a las cuatro les
 * toca lo mismo.
 *
 * `cambioConVista` es la segunda mitad del 10, cuando ya vio las dos cartas y
 * le falta decir si cambia.
 */
export const AL_VENCER_LA_DECISION = Object.freeze({
  levantada: "descartarPorTiempo",
  poder: "saltarPorTiempo",
  cambioConVista: "saltarPorTiempo",
});

/**
 * Qué corresponde hacer en esta fase al vencer el plazo, o `null` si esta fase
 * no tiene reloj de decisión.
 *
 * Devolver `null` es lo normal: `turno`, `mirar`, `descarte`, `finRonda` y las
 * demás tienen sus propios plazos, más viejos y con otras duraciones.
 */
export const decisionQueVence = (fase) => AL_VENCER_LA_DECISION[fase] ?? null;

/** ¿Esta fase tiene reloj para decidir? */
export const esperaUnaDecision = (fase) => decisionQueVence(fase) !== null;
