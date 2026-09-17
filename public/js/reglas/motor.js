import { crearBaraja, barajar, TAM_MANO } from "./baraja.js";
import {
  resolverCorte,
  aplicarEliminacion,
  comprobarFinPartida,
  cartasVivas,
  LIMITE_ELIMINACION,
} from "./puntaje.js";
import { azarDesde, semillaAleatoria } from "./azar.js";

export const MS_MIRAR = 2000;

/**
 * La ventana del principio de la ronda.
 *
 * Cinco segundos, y son necesarios: se viene de memorizar una sola carta y hay
 * que buscar en cuatro manos a la vez. Es el único momento de la ronda en que
 * nadie tiene todavía ninguna referencia.
 *
 * Se probó unificarla con la de las reaperturas en 2 s y el juego se volvía
 * frenético: entre la mirada y esta ventana el ciclo de apertura caía de 7 s a
 * 4, sin que nadie hubiera pedido eso.
 */
export const MS_DESCARTE = 5000;

/**
 * Las ventanas que abren tirar y cambiar.
 *
 * Tres segundos. Más cortas que la de la ronda a propósito —acá la mesa ya
 * está mirando la muestra y sólo reacciona al número nuevo— pero no dos, que
 * fue lo primero que se probó y quedó corto: hay que mirar la carta, buscarla
 * en la propia mano y hacer DOBLE clic, y en red además el pedido tiene que
 * viajar. Dos segundos alcanzaban para reaccionar, no para jugar.
 *
 * Ocurren varias veces por ronda —una por tiro y una por cambio— así que cada
 * segundo se paga muchas veces; de ahí que no sean cinco.
 */
export const MS_REAPERTURA = 3000;

/**
 * Cuánto se espera a que el del turno decida si corta o pasa.
 *
 * Treinta segundos. Es la única fase sin reloj en la que la mesa entera queda
 * esperando a una sola persona: levantar tiene sus 8 segundos, y la mirada y
 * los reflejos se cierran solos. `postLevantada` no tenía nada, y eso alcanza
 * para que alguien que se levantó de la silla —con la pestaña abierta, así que
 * sigue latiendo y `saltarAusente` no lo toca— congele la partida para los
 * otros tres sin querer.
 *
 * No es un reloj de reflejos y por eso es largo: cortar o pasar es la decisión
 * con más peso de la ronda y hay que poder pensarla.
 *
 * Fueron treinta segundos, con el argumento de que era «tiempo de sobra para
 * decidir y poco para quedarse mirando la pared». La primera mitad resultó
 * cierta y la segunda no: en la mesa, treinta segundos es un rato en el que no
 * pasa nada y los demás miran. Veinte siguen alcanzando para pensarlo —no es
 * una cuenta, es elegir entre dos— y no dejan la partida detenida.
 *
 * Diez, que es lo que dura decidir qué hacer con la carta levantada, sí es
 * poco: aquello es seguir jugando y esto es apostar la ronda entera.
 *
 * Vale para los DOS modos, porque es literalmente la misma constante:
 * `partida-red.js` la reexporta desde acá en vez de escribir su propio número.
 *
 * Al vencerse se PASA, nunca se corta. Pasar es lo que no arriesga nada de
 * quien no contestó: cortar por él podría eliminarlo.
 */
export const MS_PASO_AUTOMATICO = 20000;

/**
 * Lo que espera la mesa a que alguien levante antes de saltarle el turno.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * VIVE ACÁ PORQUE LOS DOS LADOS LA NECESITAN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Estaba declarada DOS veces con el mismo valor: `functions/partida-red.js`
 * la exportaba y `public/js/mesa.js` tenía su propia copia. El cliente pinta
 * la cuenta atrás y el servidor aplica el salto, así que si alguien cambiara
 * una sola, el reloj que ve el jugador y el que decide dejarían de coincidir
 * — y nadie se enteraría hasta que a alguien le salten el turno con el reloj
 * por la mitad.
 *
 * Es el mismo patrón que ya nos costó una divergencia con `LEYENDAS_REGISTRO`,
 * y el mismo que explica la nota de `MS_VENTANA` en `reglas/red.js`: son la
 * misma regla y tienen que salir del mismo lugar.
 */
export const MS_TURNO = 8000;

/**
 * Lo que se muestran los resultados antes de repartir la ronda siguiente.
 *
 * Vive acá por la misma razón que `MS_TURNO`: lo usan los dos lados. El
 * servidor lo aplica en su plazo de `finRonda`, y desde que existe la marca de
 * ausente la mesa de entrenamiento también lo necesita — con el jugador
 * ausente, «Siguiente ronda» se aprieta sola, y tiene que tardar lo mismo que
 * en una partida por Leyendas. Dos copias de un número que tiene que ser el
 * mismo es como se separan.
 */
export const MS_ENTRE_RONDAS = 6000;

/**
 * La cuenta regresiva antes de la primera mirada: «3, 2, 1, Preparate…».
 *
 * Cuatro pasos de un segundo. La mesa de entrenamiento la muestra desde hace
 * tiempo; en red se agregó cuando se vio que la primera mirada terminaba
 * antes de que nadie llegara a la mesa, y tiene que ser la misma: el
 * servidor abre la ventana cuando esta cuenta termina, y las cuatro pantallas
 * la dibujan contra esa hora.
 *
 * Vive en el motor porque la usan los dos lados, igual que `MS_TURNO`.
 */
export const MS_CUENTA_REGRESIVA = 4000;

/**
 * Cuánto tiene quien le acertó a un rival para elegir qué carta le da.
 *
 * La regla dice que la carta se elige DESPUÉS de acertar, y a ciegas. Mientras
 * tanto la ventana puede terminar: la de un poder dura tres segundos, y llegar
 * a la carta del rival ya se come parte. Así que la elección tiene su propio
 * reloj, y la ventana espera a que termine antes de resolverse. Al vencer, la
 * carta sale al azar.
 */
export const MS_PARA_ENTREGAR = 5000;

export const PODERES = {
  7: "mirarPropia",
  8: "mirarRival",
  9: "cambioCiego",
  10: "cambioConVista",
};

export const esPoder = (carta) => Boolean(carta && PODERES[carta.numero]);

/**
 * Un descarte es correcto si la carta tiene el MISMO NÚMERO que la muestra.
 * No se compara el palo: sólo existe una carta por palo+número, así que
 * exigir ambos haría imposible acertar.
 */
export const esDescarteValido = (carta, muestra) =>
  Boolean(carta && muestra && carta.numero === muestra.numero);

const cima = (pila) => pila[0] ?? null;

const siguienteActivo = (jugadores, desde) => {
  for (let paso = 1; paso <= jugadores.length; paso++) {
    const i = (desde + paso) % jugadores.length;
    if (!jugadores[i].eliminado) return i;
  }
  return desde;
};

/**
 * Un jugador nuevo.
 *
 * `retrato`, `dorso`, `insignia` y `marco` son rutas de imagen: la cara, el
 * reverso de sus cartas, el logro que eligió mostrar y el borde que rodea su
 * cara. `titulo` es la excepción: es TEXTO, la palabra que va al lado del
 * nombre. Viajan acá al lado de `nombre` por
 * la misma razón que el nombre: son identidad, y la identidad se fija al
 * repartir. En una partida por Leyendas las elige el servidor cuando el
 * jugador entra a la sala; en entrenamiento no se pasan y quedan en `null`,
 * que es lo que hace que la mesa use las caras y los dorsos de la casa.
 *
 * Son lo único de este objeto que no participa de ninguna regla. Se aceptan
 * porque la alternativa —llevarlas por un canal aparte, indexadas igual que
 * los jugadores— son tres listas paralelas que tarde o temprano se desfasan;
 * y porque `nombre` ya sentó el precedente.
 */
export const crearJugador = ({
  id,
  nombre,
  esIA = false,
  dificultad = "medio",
  retrato = null,
  dorso = null,
  insignia = null,
  marco = null,
  titulo = null,
}) => ({
  id,
  nombre,
  retrato,
  dorso,
  insignia,
  marco,
  titulo,
  esIA,
  dificultad,
  mano: [],
  puntos: 0,
  puntosRonda: 0,
  eliminado: false,
  eliminadoEnRonda: null,
  posicionMirada: null,
});

/**
 * Estado inicial. Todo lo que devuelve es JSON puro: números, cadenas,
 * booleanos, arrays y objetos planos. Ninguna función, ningún Map, ninguna
 * instancia de clase. Eso es lo que permite guardarlo y recuperarlo tal cual.
 */
export const crearPartida = (
  configuracion,
  { semilla = semillaAleatoria(), limitePuntos = LIMITE_ELIMINACION } = {},
) => ({
  fase: "inicio",
  /**
   * Con cuántos puntos se queda afuera.
   *
   * Viaja en el estado y no en una constante del módulo porque el
   * entrenamiento deja elegir partidas más cortas. Por defecto, 150: quien
   * cree la partida sin decir nada juega lo de siempre.
   */
  limitePuntos,
  ronda: 0,
  indiceMano: 0,
  indiceTurno: 0,
  turnosRonda: 0,
  jugadores: configuracion.map(crearJugador),
  mazo: [],
  descarte: [],
  levantada: null,
  poderPendiente: null,
  cambioPendiente: null,
  ventanaDescarte: null,
  indiceCortador: null,
  ganador: null,
  desempate: false,
  registro: [],
  // Hechos puntuables de la partida, que consume el ranking.
  eventos: [],
  /**
   * Qué CARTAS conoce cada jugador.
   *
   *   { actor, idCarta, origen, ronda }
   *
   * Se guarda la carta —su `id`—, no el número ni la posición. La posición se
   * busca en las manos cada vez que hace falta: si la carta se mueve con un 9
   * o un 10, quien la conocía la sigue conociendo en su lugar nuevo. Y cuando
   * sale de las manos, el recuerdo se borra en esa misma jugada: ver
   * `olvidarLoQueSalio`.
   *
   * Conocer una carta de otro es lo que habilita a descartársela, y sólo a
   * ella. Ver `puedeAtacarEn`.
   *
   * Es un array de objetos planos: viaja con el estado y sobrevive el JSON.
   * NUNCA sale hacia una vista: al cliente le llegan las POSICIONES que puede
   * atacar, jamás qué carta conoce. Ver `vista.js`.
   */
  conocimientos: [],
  // El azar es un número, no una función: avanza con cada barajada y viaja
  // con el estado. Ver azar.js.
  semilla: semilla >>> 0,
});

/**
 * Suma una línea al registro.
 *
 * `extra` deja marcar la línea con datos que la interfaz pueda leer sin
 * adivinar. Se usa para la mirada de los poderes 7 y 8: la mesa tiene que
 * pintar una marca sobre la carta mirada, y reconocer el evento por el texto
 * —buscando "miró una carta"— se rompería con sólo cambiarle una palabra al
 * mensaje. El registro viaja entero en la vista, así que lo que se ponga acá
 * lo ve toda la mesa: nunca el número de la carta ni su posición.
 */
const anotar = (estado, texto, extra = null) => ({
  ...estado,
  registro: [...estado.registro, { ronda: estado.ronda, texto, ...(extra ?? {}) }],
});

// --------------------------------------------------------------- reparto

export function empezarRonda(estado) {
  const azar = azarDesde(estado.semilla);
  const mazo = barajar(crearBaraja(), azar);
  const jugadores = estado.jugadores.map((j) =>
    j.eliminado
      ? { ...j, mano: [], posicionMirada: null }
      : { ...j, mano: mazo.splice(0, TAM_MANO), puntosRonda: 0, posicionMirada: null },
  );
  const muestra = { ...mazo.pop(), visible: true };

  return anotar(
    {
      ...estado,
      fase: "mirar",
      ronda: estado.ronda + 1,
      jugadores,
      mazo,
      descarte: [muestra],
      levantada: null,
      poderPendiente: null,
      ventanaDescarte: null,
      indiceCortador: null,
      turnosRonda: 0,
      indiceTurno: estado.indiceMano,
      // Se reparte de nuevo: lo que alguien sabía de la mano de otro ya no
      // corresponde a ninguna carta que siga ahí.
      conocimientos: [],
      // La semilla avanza con la barajada: la ronda siguiente no repite el
      // mismo reparto.
      semilla: azar.semilla(),
    },
    estado.desempate
      ? "Ronda de desempate"
      : `Ronda ${estado.ronda + 1}: cada jugador mira una carta`,
  );
}

/**
 * Cada jugador elige UNA carta y la ve durante MS_MIRAR.
 *
 * Queda anotado QUÉ vio, no sólo dónde miró. `posicionMirada` ya guardaba la
 * posición, pero la posición sola no dice qué carta había: si después se la
 * cambian, nadie puede distinguir "sabía y se la robaron" de "nunca supo".
 * Esa diferencia es la que hace falta para que el 9 y el 10 le enseñen algo a
 * quien los sufre.
 */
export const mirar = (estado, indiceJugador, posicion = 0) =>
  anotar(
    {
      ...estado,
      conocimientos: conocer(
        estado.conocimientos ?? [],
        [indiceJugador],
        estado.jugadores[indiceJugador]?.mano?.[posicion],
        "mirada",
        estado.ronda,
      ),
      jugadores: estado.jugadores.map((j, i) =>
        i === indiceJugador ? { ...j, posicionMirada: posicion } : j,
      ),
    },
    `${estado.jugadores[indiceJugador]?.nombre ?? "Alguien"} miró una de sus cartas`,
    /**
     * La mirada inicial también deja constancia, y también con la posición.
     *
     * ───────────────────────────────────────────────────────────────────
     * POR QUÉ UN EVENTO Y NO `posicionMirada`
     * ───────────────────────────────────────────────────────────────────
     *
     * La posición ya vivía en el jugador, pero no viaja en la vista — y
     * aunque viajara, sería un dato PERMANENTE: dice "miró la tercera" durante
     * toda la ronda, y la mesa tendría que compararlo con el anterior para
     * saber que recién pasó.
     *
     * El registro da eso gratis: una línea aparece una vez, en el momento. Es
     * el mismo canal por el que se anuncian las miradas de los poderes, así
     * que la mesa las pinta todas con el mismo mecanismo.
     *
     * Tipo propio y no `miroCarta` porque el aviso es distinto: cuatro
     * jugadores mirando a la vez no pueden disparar cuatro carteles y cuatro
     * sonidos. Lo único que comparten es el ojo.
     */
    { tipo: "miradaInicial", actor: indiceJugador, posicion },
  );

/**
 * Qué cartas marcó como miradas una línea del registro.
 *
 * ─────────────────────────────────────────────────────────────────────
 * UNA SOLA FUNCIÓN PARA TODAS LAS MIRADAS
 * ─────────────────────────────────────────────────────────────────────
 *
 * Mirar una carta pasa en cuatro momentos distintos —la mirada inicial, el 7,
 * el 8 y el 10— y cada uno guarda las posiciones a su manera, porque cada uno
 * mira cosas distintas: el 7 una propia, el 8 una ajena, el 10 una de cada.
 *
 * La mesa no tiene por qué saber nada de eso. Pregunta "¿qué cartas se
 * miraron acá?" y pinta un ojo en cada una. Con una rama por poder, agregar
 * un poder nuevo obligaba a acordarse de agregar también su rama — y olvidarse
 * no rompe nada: simplemente no aparece el ojo.
 *
 * Tolera líneas sin posición. Las partidas que ya estaban en curso cuando esto
 * se desplegó las tienen, y una posición ausente tiene que ser "ninguna carta",
 * no un ojo en la posición `undefined`.
 */
export function cartasMiradasEn(linea) {
  const enPosicion = (jugador, posicion) =>
    Number.isInteger(jugador) && Number.isInteger(posicion) ? [{ jugador, posicion }] : [];

  switch (linea?.tipo) {
    case "miradaInicial":
      return enPosicion(linea.actor, linea.posicion);

    // El 7 mira una propia y el 8 una ajena. En los dos, `objetivo` es de
    // quién es la carta — con el 7, uno mismo.
    case "miroCarta":
      return enPosicion(linea.objetivo, linea.posicion);

    // El 10, que mira dos: una de cada mano.
    case "miroParaCambiar":
      return [
        ...enPosicion(linea.actor, linea.posicionPropia),
        ...enPosicion(linea.objetivo, linea.posicionRival),
      ];

    default:
      return [];
  }
}

/** Al agotarse los 2 segundos: quien no eligió se queda con la posición 0. */
export const terminarMirada = (estado) =>
  anotar(
    {
      ...estado,
      fase: "descarte",
      jugadores: estado.jugadores.map((j) =>
        j.posicionMirada == null ? { ...j, posicionMirada: 0 } : j,
      ),
      ventanaDescarte: { huboPrimero: false, intentos: [] },
    },
    "Fase de descarte: 5 segundos",
  );

// ------------------------------------------------------ descarte simultáneo

/** Recicla el descarte cuando el mazo se agota, dejando la muestra arriba. */
const rellenarMazo = (estado) => {
  if (estado.mazo.length) return estado;
  const [muestra, ...resto] = estado.descarte;
  if (!resto.length) return estado;
  const azar = azarDesde(estado.semilla);
  const mazo = barajar(resto.map((c) => ({ ...c, visible: false })), azar);
  // La semilla avanzada vuelve al estado: si no, la próxima barajada
  // repetiría exactamente la misma mezcla.
  return { ...estado, mazo, descarte: [muestra], semilla: azar.semilla() };
};

/**
 * Intento de descarte durante la ventana de reflejos.
 *
 * Las tres salidas están graduadas a propósito:
 *
 * - PRIMERO: la carta sale de la mano y no hay castigo.  → una carta menos
 * - TARDE:   la carta sale igual, pero recibe una más.   → queda igual
 * - ERROR:   conserva la carta, recibe una más, y su      → una carta más,
 *            posición queda pública para toda la partida.   y expuesto
 *
 * Si el que llega tarde conservara su carta, acertar tarde y equivocarse
 * tendrían la misma consecuencia y acertar dejaría de valer la pena.
 */
export function intentarDescarte(estado, indiceJugador, posicion) {
  if (estado.fase !== "descarte" || !estado.ventanaDescarte) return estado;

  /**
   * La ventana que sigue a un poder es sólo para atacar.
   *
   * Quien la abrió ya tuvo su turno de descartar en la ventana de reflejos,
   * con esta misma muestra. Si pudiera descartar acá también, tendría dos
   * oportunidades sobre la misma carta y los otros tres una — y encima en
   * privado, porque esta ventana no es de ellos.
   *
   * Se rechaza para TODOS y no sólo para el dueño: los demás caen igual en
   * `soloPara`, dos líneas más abajo en `intentarDescarteRival`, y acá no
   * tienen nada que hacer de ninguna manera.
   */
  if (estado.ventanaDescarte.soloAtaques) return estado;

  const jugador = estado.jugadores[indiceJugador];
  const carta = jugador.mano[posicion];
  if (!carta) return estado;

  const muestra = cima(estado.descarte);
  const correcto = esDescarteValido(carta, muestra);
  const fuePrimero = correcto && !estado.ventanaDescarte.huboPrimero;

  const origen = rellenarMazo(estado);
  const mazo = [...origen.mazo];
  const descarte = [...origen.descarte];
  const mano = [...jugador.mano];
  const cartaCastigo = () => (mazo.length ? mazo.shift() : null);

  let castigo = null;
  if (correcto && fuePrimero) {
    // Llegó primero: la carta se va y pasa a ser la muestra.
    mano[posicion] = null;
    descarte.unshift({ ...carta, visible: true });
  } else {
    /**
     * Todo lo demás: la carta se queda y encima recibe otra.
     *
     * ───────────────────────────────────────────────────────────────────
     * SÓLO EL PRIMERO SE SALVA, Y AHORA DE VERDAD
     * ───────────────────────────────────────────────────────────────────
     *
     * Antes el acierto TARDE también sacaba la carta de la mano y la
     * apilaba en la muestra; el beneficio se compensaba con una carta de
     * castigo, así que quedaba neto cero. Eso tenía dos problemas.
     *
     * Uno visible: la muestra crecía con una carta que nadie ganó. Dos
     * jugadores descartando el mismo número dejaban las dos arriba, y lo
     * que se ve como muestra es lo que decide qué se puede descartar
     * después.
     *
     * Uno de fondo: llegar tarde cambiaba una carta conocida por una
     * desconocida sin costo neto, así que intentar siempre convenía.
     *
     * Ahora el escalón es parejo: ser primero saca la carta, llegar tarde
     * la deja y suma una, y fallar hace lo mismo Y ADEMÁS le regala a los
     * rivales el derecho a descartársela — ver `recordarFallo`.
     */
    castigo = cartaCastigo();
    mano.push(castigo);
  }

  const resultado = correcto ? (fuePrimero ? "primero" : "tarde") : "error";

  /**
   * Un error deja DOS cartas a la vista de los cuatro, y las dos quedan
   * conocidas: la que se falló, que sigue en su lugar, y la de castigo, que
   * entra al final de la mano.
   *
   * SÓLO el error, nunca el acierto tarde. Los dos exponen la carta tocada,
   * pero sólo el error regala el derecho sobre ella y sólo el error muestra el
   * castigo: así fallar sigue siendo peor que llegar tarde, y llegar tarde
   * peor que ser primero.
   */
  const conocimientos =
    resultado === "error"
      ? conocerCastigo(estado, recordarFallo(estado, carta), castigo)
      : (estado.conocimientos ?? []);

  return anotar(
    olvidarLoQueSalio({
      ...estado,
      mazo,
      descarte,
      conocimientos,
      jugadores: estado.jugadores.map((j, i) => (i === indiceJugador ? { ...j, mano } : j)),
      ventanaDescarte: {
        // El spread NO es decorativo: la ventana lleva `volverA`, que dice
        // adónde devolver la mesa al cerrarse. Sin él, esto reconstruía la
        // ventana desde cero y lo perdía, así que un acierto de CUALQUIERA
        // durante la ventana que abrió un tiro le borraba al que tiró su
        // decisión de cortar: la mesa volvía a `turno` en vez de a
        // `postLevantada`. `intentarDescarteRival`, dos funciones más abajo,
        // siempre lo hizo bien; esta no.
        ...estado.ventanaDescarte,
        huboPrimero: estado.ventanaDescarte.huboPrimero || fuePrimero,
        intentos: [
          ...estado.ventanaDescarte.intentos,
          // La carta viaja en el intento para que la mesa pueda mostrarla un
          // momento. Sólo la del primero no se muestra: ya está en el descarte.
          {
            indiceJugador,
            posicion,
            resultado,
            carta: fuePrimero ? null : carta,
            ...castigoALaVista(resultado === "error", indiceJugador, mano.length - 1, castigo),
          },
        ],
      },
    }),
    `${jugador.nombre}: descarte ${resultado}`,
  );
}

/**
 * ¿Puede `actor` intentar descartarle a `objetivo` la carta de `posicion`?
 *
 * Sólo si CONOCE esa carta. No el número: la carta. Si la conoce, puede
 * intentar siempre —el resultado lo decide la muestra, no un permiso—; si no
 * la conoce, ni siquiera puede intentar.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ANTES ERA POR NÚMERO, Y SOBRE LA MANO ENTERA
 * ─────────────────────────────────────────────────────────────────────
 *
 * Un 8 guardaba el número visto y habilitaba cualquier posición de esa mano.
 * Tenía tres agujeros, y los tres rompían la jugada:
 *
 *   - No viajaba. Si la carta se movía con un 9, el derecho se quedaba en la
 *     mano vieja en vez de seguirla.
 *   - No caducaba. Si la carta se descartaba, el derecho seguía vivo sobre
 *     una mano donde ya no estaba, y cada intento costaba una carta.
 *   - No alcanzaba. Pasarle a otro con un 9 una carta propia conocida, o ver
 *     la de castigo de un error, no daba ningún derecho.
 *
 * Ahora la carta se busca en la mano en el momento: el derecho la sigue
 * adonde vaya, y se va con ella cuando sale de las manos.
 */
export function puedeAtacarEn(estado, actor, objetivo, posicion) {
  if (actor === objetivo) return false;
  if (estado.jugadores[actor]?.eliminado || estado.jugadores[objetivo]?.eliminado) return false;
  const carta = estado.jugadores[objetivo]?.mano?.[posicion];
  return Boolean(carta) && conoceCarta(estado, actor, carta.id);
}

/**
 * Las posiciones ajenas que `actor` puede atacar: una por cada carta que
 * conoce en la mano de otro.
 *
 * Es lo único de todo esto que viaja al navegador: quién y dónde. Nunca qué
 * carta es.
 */
export function posicionesAtacablesDe(estado, actor) {
  const salida = [];
  estado.jugadores.forEach((jugador, objetivo) => {
    (jugador.mano ?? []).forEach((_, posicion) => {
      if (puedeAtacarEn(estado, actor, objetivo, posicion)) salida.push({ objetivo, posicion });
    });
  });
  return salida;
}

/** ¿Conoce `actor` alguna carta de `objetivo`? */
export const puedeAtacarA = (estado, actor, objetivo) =>
  posicionesAtacablesDe(estado, actor).some((p) => p.objetivo === objetivo);

/** A quién puede atacar cada jugador. */
export const objetivosDe = (estado, actor) => [
  ...new Set(posicionesAtacablesDe(estado, actor).map((p) => p.objetivo)),
];

// ------------------------------------------ qué cartas conoce cada uno

/** Dónde está una carta ahora: en qué mano y en qué posición, o null. */
export function dondeEsta(estado, idCarta) {
  for (let jugador = 0; jugador < estado.jugadores.length; jugador++) {
    const posicion = (estado.jugadores[jugador].mano ?? []).findIndex((c) => c?.id === idCarta);
    if (posicion >= 0) return { jugador, posicion };
  }
  return null;
}

/**
 * ¿`actor` conoce la carta `idCarta`?
 *
 * Sin `id` no hay nada que conocer. Sin esta guarda, una carta sin `id` y un
 * recuerdo viejo sin `idCarta` coincidían —`undefined === undefined`— y el
 * derecho aparecía de la nada.
 */
export function conoceCarta(estado, actor, idCarta) {
  if (idCarta == null) return false;
  return (estado.conocimientos ?? []).some((c) => c.actor === actor && c.idCarta === idCarta);
}

/**
 * Suma que `actores` conocen `carta`.
 *
 * Saber dos veces lo mismo no da dos derechos: repetido no se duplica, y queda
 * el origen de la primera vez.
 */
function conocer(conocimientos, actores, carta, origen, ronda) {
  if (!carta?.id) return conocimientos;
  let salida = conocimientos;
  for (const actor of actores) {
    if (salida.some((c) => c.actor === actor && c.idCarta === carta.id)) continue;
    salida = [...salida, { actor, idCarta: carta.id, origen, ronda }];
  }
  return salida;
}

/** Los que siguen en la partida: los que ven lo que se muestra en la mesa. */
const enJuego = (estado) =>
  estado.jugadores.map((_, i) => i).filter((i) => !estado.jugadores[i].eliminado);

/**
 * Borra lo que se sabía de cartas que ya no están en ninguna mano.
 *
 * ─────────────────────────────────────────────────────────────────────
 * POR QUÉ AL FINAL DE LA JUGADA Y NO DONDE SALE CADA CARTA
 * ─────────────────────────────────────────────────────────────────────
 *
 * Porque así no hay que acordarse de nada. Las cartas salen de las manos en
 * tres jugadas —descartar la propia, acertarle a un rival, cambiar por la
 * levantada— y las tres terminan pasando por acá.
 *
 * Y olvidarse de una costaría caro: la carta va al descarte, el descarte se
 * rebaraja cuando se acaba el mazo, y esa misma carta puede volver a entrar
 * en una mano como castigo. Con su `id` todavía anotado, el recuerdo viejo
 * revivía y le daba a alguien un derecho que nunca se ganó.
 *
 * Los recuerdos sin `id` —de partidas empezadas antes de este modelo— no
 * corresponden a ninguna carta y se van la primera vez que pasan por acá.
 */
function olvidarLoQueSalio(estado) {
  const enMano = new Set();
  for (const jugador of estado.jugadores) {
    for (const carta of jugador.mano ?? []) if (carta?.id) enMano.add(carta.id);
  }
  const previos = estado.conocimientos ?? [];
  const conocimientos = previos.filter((c) => enMano.has(c.idCarta));
  return conocimientos.length === previos.length ? estado : { ...estado, conocimientos };
}

/**
 * Un error deja la carta tocada a la vista: desde ahí la conocen todos los que
 * siguen en juego, el que falló incluido.
 *
 * Al que falló no le da ningún derecho —nadie se ataca a sí mismo—, pero si
 * después se la cambian con un 9, la sigue igual que los demás.
 */
function recordarFallo(estado, carta) {
  return conocer(estado.conocimientos ?? [], enJuego(estado), carta, "fallo", estado.ronda);
}

/**
 * La de castigo de un error se muestra a los cuatro, y desde ahí la conocen
 * todos: se sabe que la tiene, y dónde.
 */
function conocerCastigo(estado, conocimientos, castigo) {
  return conocer(conocimientos, enJuego(estado), castigo, "castigo", estado.ronda);
}

/** Lo que el intento lleva de la carta de castigo: nada, salvo en un error. */
const castigoALaVista = (esError, indiceJugador, posicion, carta) =>
  esError && carta ? { castigo: { indiceJugador, posicion, carta } } : {};

/**
 * Qué cartas quedaron a la vista de la mesa en una ventana, y dónde.
 *
 * Dos por intento, como mucho: la carta que se tocó —salvo la del primero,
 * que ya está en el descarte, y la del rival acertada, que también— y la de
 * castigo de un error.
 *
 * Una sola lista para los tres que la leen: la vista que arma el servidor, la
 * mesa de entrenamiento y la memoria de la IA. Con una lista por lugar, la
 * carta de castigo se habría mostrado en un modo y en el otro no.
 */
export function cartasExpuestas(intentos = []) {
  const salida = [];
  for (const intento of intentos) {
    if (intento.carta) {
      salida.push({
        indiceJugador: intento.indiceJugador,
        posicion: intento.posicion,
        carta: intento.carta,
      });
    }
    if (intento.castigo?.carta) {
      salida.push({
        indiceJugador: intento.castigo.indiceJugador,
        posicion: intento.castigo.posicion,
        carta: intento.castigo.carta,
      });
    }
  }
  return salida;
}

/**
 * Qué pasaría si `actor` atacara ahora la carta de `objetivo` en `posicion`.
 *
 *   "sinDerecho"  no hay intento: no la conoce, no hay ventana, o la ventana es
 *                 de otro.
 *   "acierto"     va con la muestra: ahora tiene que elegir qué carta entrega.
 *   "error"       no va: se come una de castigo, y no elige nada.
 *
 * Es lo que se pregunta ANTES de pedir la carta a entregar, porque la regla
 * dice que sólo se elige al acertar. No cambia nada: `intentarDescarteRival`
 * vuelve a comprobarlo todo al aplicar.
 */
export function evaluarAtaque(estado, actor, objetivo, posicion) {
  if (estado.fase !== "descarte" || !estado.ventanaDescarte) return "sinDerecho";
  const { soloPara } = estado.ventanaDescarte;
  if (soloPara != null && actor !== soloPara) return "sinDerecho";
  if (!puedeAtacarEn(estado, actor, objetivo, posicion)) return "sinDerecho";
  const carta = estado.jugadores[objetivo].mano[posicion];
  return esDescarteValido(carta, cima(estado.descarte)) ? "acierto" : "error";
}

/**
 * Intento de descarte sobre la mano de OTRO.
 *
 * Sólo sobre una carta que `actor` conoce: ver `puedeAtacarEn`. Si no la
 * conoce no hay intento, y no pasa nada. `posicionEntrega` es la carta propia
 * que da si acierta, elegida por posición y a ciegas. Si no llega —se le
 * acabó el tiempo de elegir—, sale una al azar.
 *
 * ACIERTO: la carta del rival va con la muestra. Se va al descarte y la
 *          propia ocupa EXACTAMENTE ese hueco, boca abajo. Quien la dio queda
 *          con una carta menos; el rival, con las mismas.
 *
 * ERROR:   no va. La carta del rival no se mueve, y el atacante se come una de
 *          castigo que ven los cuatro. Sigue conociendo la del rival, así que
 *          puede volver a intentar mientras dure la ventana; cada error vuelve
 *          a costar.
 */
export function intentarDescarteRival(
  estado, actor, objetivo, posicionObjetivo, posicionEntrega,
) {
  if (estado.fase !== "descarte" || !estado.ventanaDescarte) return estado;

  /**
   * La ventana que sigue a un poder es de quien lo usó, y de nadie más.
   *
   * Los otros tres ya tuvieron la suya en la ventana de reflejos, con esta
   * misma muestra; ésta existe porque a uno solo le llegó un dato después.
   *
   * `soloPara` sólo está en esa ventana: en las normales es `undefined` y esto
   * no frena a nadie. Se compara contra `!= null` y no por verdadero, porque
   * el jugador 0 es un índice legítimo.
   */
  const { soloPara } = estado.ventanaDescarte;
  if (soloPara != null && actor !== soloPara) return estado;

  // La única condición para intentar: conocer la carta. Antes había dos
  // derechos —uno por número sobre la mano entera y otro por posición— y la
  // mesa ofrecía uno y el servidor aceptaba el otro.
  if (!puedeAtacarEn(estado, actor, objetivo, posicionObjetivo)) return estado;

  const manoObjetivo = [...estado.jugadores[objetivo].mano];
  const manoActor = [...estado.jugadores[actor].mano];
  const carta = manoObjetivo[posicionObjetivo];

  const muestra = cima(estado.descarte);
  const correcto = esDescarteValido(carta, muestra);

  const origen = rellenarMazo(estado);
  const mazo = [...origen.mazo];
  const descarte = [...origen.descarte];

  let conocimientos = estado.conocimientos ?? [];
  let castigo = null;
  let semilla = estado.semilla;
  let alAzar = false;

  if (correcto) {
    /**
     * Sin carta elegida, una al azar entre las que tiene.
     *
     * Con la semilla de la partida, como toda la suerte del juego: el
     * servidor y la mesa de entrenamiento llegan al mismo resultado, y la
     * partida se puede repetir. La semilla avanzada vuelve al estado.
     */
    let entrega = posicionEntrega;
    if (!Number.isInteger(entrega)) {
      const propias = manoActor.map((c, p) => (c ? p : null)).filter((p) => p !== null);
      if (!propias.length) return estado;
      const azar = azarDesde(estado.semilla);
      entrega = propias[Math.floor(azar() * propias.length)];
      semilla = azar.semilla();
      alAzar = true;
    }

    // La entrega tiene que ser una carta que exista de verdad.
    const entregada = manoActor[entrega];
    if (!entregada) return estado;

    // La transferencia, en una sola transición y sin desplazar nada:
    // la del rival se va al descarte y la propia ocupa ese mismo hueco.
    descarte.unshift({ ...carta, visible: true });
    manoObjetivo[posicionObjetivo] = { ...entregada, visible: false };
    manoActor[entrega] = null;

    // La encontrada salió de las manos: `olvidarLoQueSalio` borra lo que se
    // sabía de ella. La entregada conserva su `id`, así que quien ya la
    // conocía —el que la dio, si la había visto— la sigue en su lugar nuevo.
  } else {
    castigo = mazo.length ? mazo.shift() : null;
    manoActor.push(castigo);
    conocimientos = conocerCastigo(estado, conocimientos, castigo);
  }

  return anotar(
    olvidarLoQueSalio({
      ...estado,
      mazo,
      descarte,
      conocimientos,
      semilla,
      jugadores: estado.jugadores.map((j, i) =>
        i === actor ? { ...j, mano: manoActor }
          : i === objetivo ? { ...j, mano: manoObjetivo }
          : j,
      ),
      ventanaDescarte: {
        ...estado.ventanaDescarte,
        intentos: [
          ...estado.ventanaDescarte.intentos,
          {
            indiceJugador: objetivo,
            posicion: posicionObjetivo,
            actor,
            resultado: correcto ? "rivalAcierto" : "rivalError",
            // La fallada se muestra a la mesa. La acertada se fue al
            // descarte, donde ya se ve; la entregada no se muestra jamás.
            carta: correcto ? null : carta,
            // Para que la mesa pueda decir que la carta la eligió el azar.
            ...(alAzar ? { entregaAlAzar: true } : {}),
            ...castigoALaVista(!correcto, actor, manoActor.length - 1, castigo),
          },
        ],
      },
    }),
    correcto
      ? `${estado.jugadores[actor].nombre} encontró el ${carta.numero} de ${estado.jugadores[objetivo].nombre}`
      : `${estado.jugadores[actor].nombre} se equivocó buscando en ${estado.jugadores[objetivo].nombre}`,
  );
}

/**
 * Cierra la ventana de reflejos y devuelve la mesa a donde corresponda.
 *
 * La del principio de la ronda desemboca en el turno. La que abre `tirarCarta`
 * lleva `volverA: "postLevantada"`, porque el que tiró todavía tiene que
 * decidir si corta.
 */
/**
 * Cierra la ventana de reflejos y devuelve la mesa a donde corresponda.
 *
 * ...salvo que alguien se haya quedado sin cartas, en cuyo caso la ronda no
 * vuelve a ningún lado: se corta.
 *
 * Va acá y no en las dos funciones que vacían manos porque éste es el único
 * punto por el que pasan las dos, y porque es el único momento en que la
 * pregunta tiene una respuesta estable. Ver `quienSeQuedoSinCartas`.
 *
 * Que el corte automático viva DENTRO de esta función y no al lado importa:
 * la llaman la mesa local y el servidor, cada uno por su cuenta. Puesto
 * afuera habría que acordarse en los dos lugares, y el día que uno se
 * olvide, el entrenamiento y las partidas por Leyendas terminarían las
 * rondas con reglas distintas.
 */
export const cerrarVentanaDescarte = (estado) => {
  const cerrada = {
    ...estado,
    fase: estado.ventanaDescarte?.volverA ?? "turno",
    ventanaDescarte: null,
  };

  // Se pregunta sobre el estado ANTERIOR: `cerrada` ya no tiene la ventana, y
  // el desempate entre dos manos vacías sale justamente de sus intentos.
  const sinCartas = quienSeQuedoSinCartas(estado);
  if (sinCartas == null) return cerrada;

  return resolverCorteDesde(cerrada, sinCartas, { automatico: true });
};

/**
 * La ventana corta que sigue a un poder, para el que lo usó.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL AGUJERO QUE TAPA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Desde que rige «primero los reflejos de todos, después el poder del que
 * tiró», tirar un 8 sale así:
 *
 *   1. tira el 8            → queda de muestra
 *   2. ventana de reflejos  → acá TODAVÍA no sabe nada: el poder no se usó
 *   3. se resuelve el poder → recién acá ve el 8 del rival
 *   4. `postLevantada`      → sin ninguna ventana abierta
 *
 * El conocimiento llegaba un paso después de la única ventana donde servía, y
 * para cuando hubiera otra la muestra ya sería otra carta. Tirar un poder que
 * revela un par con su propia muestra era una jugada imposible de completar.
 *
 * Resolver el poder ANTES de los reflejos taparía esto y devolvería el
 * problema que el orden nuevo vino a arreglar: las cartas de poder salteaban
 * la ventana de todos. Se agrega un paso 5 en vez de deshacer el 2.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CUÁNDO SE ABRE: `objetivosDe`, NO «TRAS UN PODER»
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un 7 mira una carta PROPIA y no da derecho sobre nadie —`puedeAtacarA`
 * empieza pidiendo `actor !== objetivo`—, así que abriría tres segundos
 * muertos cada vez. El 9 no mira nada.
 *
 * Y al revés: si ya sabía algo de un poder anterior de la ronda, la ventana
 * corresponde igual. Lo que se le devuelve es el momento de usar contra ESTA
 * muestra lo que sabe, no específicamente lo que acaba de aprender.
 *
 * Nada de esto es una regla nueva: quién puede atacar a quién ya lo decidía
 * `objetivosDe`, y acá sólo se le pregunta. El poder abre el momento.
 *
 * `saltarPoder` no llama a esto aunque quien declinó sepa cosas: ahí el poder
 * no se usó, y una ventana privada extra por renunciar sería un premio por no
 * jugar.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LAS DOS MARCAS DE LA VENTANA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `soloPara` — los otros tres ya tuvieron su ventana en el paso 2, con esta
 * misma muestra. Ésta existe por algo que le pasó a uno solo.
 *
 * `soloAtaques` — si además pudiera descartar una carta propia, tendría DOS
 * oportunidades sobre la misma muestra y los demás una.
 *
 * Van separadas y no en un solo campo «es una ventana de poder» porque son
 * dos restricciones distintas: una dice QUIÉN y la otra QUÉ. Las comprueban
 * `intentarDescarte` e `intentarDescarteRival`, cada una la suya.
 *
 * `volverA: "postLevantada"` no es decorativo. Lo lee `cerrarVentanaDescarte`
 * para devolverle a quien tiró su decisión de cortar —sin él la mesa volvería
 * a `turno`— y lo lee el servidor para elegir la duración: con `volverA` son
 * tres segundos, sin él cinco. Por eso acá no hace falta ninguna constante de
 * tiempo nueva.
 */
export function ventanaTrasPoder(estado, actor) {
  // Conservadora a propósito, como el resto de las transiciones: si ya hay una
  // ventana abierta, reemplazarla les quitaría a los otros tres los reflejos
  // que están corriendo y borraría los intentos ya anotados.
  if (estado.fase !== "postLevantada" || estado.ventanaDescarte) return estado;
  if (!objetivosDe(estado, actor).length) return estado;

  return {
    ...estado,
    fase: "descarte",
    ventanaDescarte: {
      // `huboPrimero` en `true`: nadie puede "llegar primero" acá. No es lo
      // que impide el descarte propio —de eso se ocupa `soloAtaques`— pero
      // deja el dato coherente para quien lo lea, porque el primero de esta
      // muestra ya se definió en la ventana del paso 2.
      huboPrimero: true,
      intentos: [],
      volverA: "postLevantada",
      soloPara: actor,
      soloAtaques: true,
    },
  };
}

// ----------------------------------------------------------------- turnos

export function levantar(estado) {
  if (estado.fase !== "turno" || estado.levantada) return estado;
  const lleno = rellenarMazo(estado);
  if (!lleno.mazo.length) return lleno;
  const mazo = [...lleno.mazo];
  const carta = mazo.shift();
  return {
    ...lleno,
    mazo,
    levantada: { ...carta, visible: true },
    fase: "levantada",
    turnosRonda: lleno.turnosRonda + 1,
  };
}

/**
 * Lo que sigue después de poner una carta nueva como muestra.
 *
 * Tirar y cambiar terminan igual: la carta que se va queda arriba del
 * descarte, la mesa tiene un número nuevo al que reaccionar, y se abre la
 * ventana de reflejos. Recién cuando esa ventana cierra sigue el turno.
 *
 * `volverA` es lo que decide adónde. Si la carta que quedó de muestra es un
 * poder, la ventana desemboca en `poder` y el que la tiró elige si lo usa; si
 * no, desemboca en `postLevantada`, donde corta o pasa. En los dos casos es
 * SU turno lo que sigue: por eso no se vuelve a `turno`, que es adonde vuelve
 * la ventana del principio de la ronda.
 *
 * El poder se deja anotado acá, al abrir la ventana, y no al cerrarla. Durante
 * esos dos segundos la muestra puede cambiar —alguien acierta y su carta pasa
 * a ser la cima—, así que preguntarle después al descarte qué poder tocaba
 * daría el de otra carta. Se fija en el momento del tiro y no se mueve.
 */
function abrirReflejos(estado, cartaDeMuestra, indiceQuienTiro, { conPoder }) {
  // `conPoder` lo decide QUIEN LLAMA, no esta función mirando la carta. Un 7
  // tirado desde el mazo activa; el mismo 7 entregado desde la mano, no. Es la
  // misma carta y el mismo lugar del descarte: lo que cambia es de dónde vino.
  const hayPoder = conPoder && esPoder(cartaDeMuestra);
  return {
    ...estado,
    fase: "descarte",
    ventanaDescarte: {
      huboPrimero: false,
      intentos: [],
      volverA: hayPoder ? "poder" : "postLevantada",
    },
    poderPendiente: hayPoder
      ? {
          tipo: PODERES[cartaDeMuestra.numero],
          numero: cartaDeMuestra.numero,
          indiceJugador: indiceQuienTiro,
        }
      : null,
  };
}

/**
 * Opción A: cambiar la levantada por una carta propia.
 *
 * La que sale de la mano queda como muestra, así que esto abre reflejos igual
 * que tirar. Lo que NO hace es activar ningún poder, y ésa es la regla:
 *
 *   El poder sale de la carta que se LEVANTA DEL MAZO, y de ninguna otra.
 *
 * Las cartas repartidas boca abajo no son poderes. Un 7 en la mano es siete
 * puntos y nada más. Por eso, entregarlo al cambiar lo manda al descarte como
 * cualquier número, y por eso también, levantar un 7 y meterlo en la mano en
 * vez de tirarlo es renunciar a su poder: adentro de la mano deja de serlo.
 *
 * Esto estuvo implementado al revés y se notó jugando: entregar una carta que
 * uno ni sabía que tenía activaba un poder. Además de no ser la regla, hacía
 * al cambio impredecible justo en el juego donde todo depende de acordarse.
 */
export function cambiarCarta(estado, posicion) {
  if (estado.fase !== "levantada" || !estado.levantada) return estado;
  const i = estado.indiceTurno;
  const mano = [...estado.jugadores[i].mano];
  const descartada = mano[posicion];
  mano[posicion] = { ...estado.levantada, visible: false };

  const conLaMuestraNueva = olvidarLoQueSalio({
    ...estado,
    // La que se queda la vio al levantarla: la conoce, y el recuerdo va con
    // ella si después se la cambian. La que se va deja de conocerse al salir.
    conocimientos: conocer(
      estado.conocimientos ?? [], [i], estado.levantada, "levantada", estado.ronda,
    ),
    jugadores: estado.jugadores.map((j, idx) => (idx === i ? { ...j, mano } : j)),
    descarte: descartada
      ? [{ ...descartada, visible: true }, ...estado.descarte]
      : estado.descarte,
    levantada: null,
  });

  // Si la posición estaba vacía no hay carta nueva arriba del descarte, así
  // que no hay a qué reaccionar: no se abre ninguna ventana.
  if (!descartada) {
    return anotar(
      { ...conLaMuestraNueva, fase: "postLevantada" },
      `${estado.jugadores[i].nombre} cambió la posición ${posicion}`,
    );
  }

  return anotar(
    // Sin poder: la carta salió de la mano, no del mazo.
    abrirReflejos(conLaMuestraNueva, descartada, i, { conPoder: false }),
    `${estado.jugadores[i].nombre} cambió la posición ${posicion} y tiró un ${descartada.numero}`,
  );
}

/**
 * Opción B: tirar la levantada.
 *
 * Sea poder o no, primero se abren los reflejos. Antes las cartas de poder
 * salteaban la ventana e iban directo a `poder`, y eso le daba al que tiraba
 * una ventaja que no se justificaba: tirar un 7 cambiaba la muestra igual que
 * tirar un 3, pero sólo en un caso los demás podían aprovecharlo. Ahora la
 * mesa siempre tiene sus dos segundos, y recién después el poder se decide.
 */
export function tirarCarta(estado, { porTiempo = false } = {}) {
  if (estado.fase !== "levantada" || !estado.levantada) return estado;
  const carta = estado.levantada;
  const conLaMuestraNueva = {
    ...estado,
    descarte: [{ ...carta, visible: true }, ...estado.descarte],
    levantada: null,
  };

  /**
   * `porTiempo` cambia lo que dice el registro, no lo que pasa.
   *
   * ───────────────────────────────────────────────────────────────────
   *
   * La jugada es la misma: la carta va al descarte y se abre la ventana de
   * reflejos. Lo que cambia es de quién fue la decisión, y eso tiene que
   * quedar escrito. Es la primera vez que el servidor tira una carta que
   * nadie tocó, y pasa en partidas que cobran entrada: si después alguien
   * pregunta por qué perdió esa mano, el registro tiene que poder contestar.
   *
   * Va con `tipo` además del texto por lo mismo que la mirada de los poderes
   * 7 y 8: reconocer el evento buscando palabras en el mensaje se rompe con
   * sólo cambiarle una coma.
   *
   * No revela nada nuevo. El número ya estaba a la vista —la carta quedó
   * arriba del descarte, boca arriba— así que el texto dice lo que la mesa
   * ya ve.
   */
  const nombre = estado.jugadores[estado.indiceTurno].nombre;

  return anotar(
    // Con poder: es la carta que se acaba de levantar del mazo.
    abrirReflejos(conLaMuestraNueva, carta, estado.indiceTurno, { conPoder: true }),
    porTiempo
      ? `A ${nombre} se le acabó el tiempo y se tiró el ${carta.numero}`
      : `${nombre} tiró un ${carta.numero}`,
    porTiempo ? { tipo: "tiroPorTiempo", actor: estado.indiceTurno } : null,
  );
}

/**
 * ¿La víctima de un 9 o un 10 conocía la carta que le sacaron?
 *
 * Si la conocía, ahora sabe en qué mano está: la sigue conociendo —el
 * recuerdo es de la carta, no del lugar— y eso le da derecho a intentar
 * descartársela al que usó el poder. No hay nada que anotar; lo único que se
 * agrega es el aviso a la mesa.
 *
 * Se pregunta ANTES del intercambio, sobre la carta que estaba ahí.
 */
const conociaLaQueLeSacaron = (estado, victima, carta) =>
  Boolean(carta) && conoceCarta(estado, victima, carta.id);

/** Poderes 7 y 8: mirar. Devuelve la carta para que la UI la muestre un instante. */
export function usarPoderMirar(estado, indiceObjetivo, posicion) {
  const poder = estado.poderPendiente;
  if (estado.fase !== "poder" || !poder) return { estado, revelada: null };
  if (poder.tipo === "mirarPropia" && indiceObjetivo !== poder.indiceJugador) {
    return { estado, revelada: null };
  }
  if (poder.tipo === "mirarRival" && indiceObjetivo === poder.indiceJugador) {
    return { estado, revelada: null };
  }

  const carta = estado.jugadores[indiceObjetivo].mano[posicion];

  // Los dos dejan conocida la carta que se miró. La del 8 es de otro, y de ahí
  // sale el derecho a descartársela. La del 7 es propia y no autoriza nada
  // sobre nadie —nadie se ataca a sí mismo—, pero el recuerdo viaja con ella:
  // si después pasa a otra mano con un 9, se sabe dónde quedó.
  const conocimientos = conocer(
    estado.conocimientos ?? [],
    [poder.indiceJugador],
    carta,
    poder.tipo === "mirarPropia" ? "poder7" : "poder8",
    estado.ronda,
  );

  // Queda escrito en el registro QUÉ se hizo y SOBRE QUIÉN, nunca qué carta
  // era ni en qué posición estaba. El registro lo lee toda la mesa: decir "la
  // segunda de Bruno" convertiría un poder en un anuncio público, y decir el
  // número lo regalaría directamente. Que se sepa que Ana miró algo de Bruno
  // es justamente lo que se quiere: los demás pueden contar con que ella
  // ahora sabe algo, sin enterarse de qué.
  const nombre = (i) => estado.jugadores[i].nombre;
  const texto =
    poder.tipo === "mirarPropia"
      ? `${nombre(poder.indiceJugador)} usó el poder ${poder.numero} y miró una carta suya`
      : `${nombre(poder.indiceJugador)} usó el poder ${poder.numero} y miró una carta de ${nombre(indiceObjetivo)}`;

  return {
    estado: anotar(
      { ...estado, fase: "postLevantada", poderPendiente: null, conocimientos },
      texto,
      /**
       * Con la posición, y SIN el número.
       *
       * ───────────────────────────────────────────────────────────────────
       * ESTO ES UNA DECISIÓN DE DISEÑO, NO UN DESCUIDO
       * ───────────────────────────────────────────────────────────────────
       *
       * Acá no viajaba la posición, y el argumento era bueno: decir «miró la
       * segunda de Bruno» convierte el poder en un anuncio público de dónde
       * está lo que se vio.
       *
       * Se decidió al revés a propósito: que la información sea pública. Saber
       * qué carta conoce un rival pasa a ser parte de la estrategia — el juego
       * se vuelve más sobre leer al otro y menos sobre esconder.
       *
       * El NÚMERO sigue sin viajar, y eso no es negociable: es la carta. Lo
       * que se hace público es DÓNDE miró, no QUÉ vio.
       */
      { tipo: "miroCarta", actor: poder.indiceJugador, objetivo: indiceObjetivo, posicion },
    ),
    revelada: { indiceJugador: indiceObjetivo, posicion, carta },
  };
}

/** Poderes 9 y 10: intercambiar posiciones entre dos manos. La 10 revela ambas. */
export function usarPoderCambio(estado, posicionPropia, indiceRival, posicionRival) {
  const poder = estado.poderPendiente;
  if (estado.fase !== "poder" || !poder) return { estado, revelada: null };
  if (indiceRival === poder.indiceJugador) return { estado, revelada: null };

  const yo = poder.indiceJugador;
  const miMano = [...estado.jugadores[yo].mano];
  const manoRival = [...estado.jugadores[indiceRival].mano];

  // El 10 muestra las dos cartas y AHÍ SE DETIENE.
  //
  // Antes revelaba y cambiaba en la misma jugada, que es lo mismo que no
  // mostrarlas: ver algo que ya no podés usar para decidir no es información,
  // es un aviso de lo que te pasó. El texto del propio juego promete otra cosa
  // —"viendo ambas antes"—, y ese "antes" sólo significa algo si después hay
  // una decisión.
  //
  // Lo que se guarda son POSICIONES, nunca las cartas. Las cartas viajan por
  // la respuesta a quien usó el poder y se pierden; guardarlas en el estado
  // las pondría a un `vistaDe` mal escrito de distancia de toda la mesa.
  if (poder.tipo === "cambioConVista") {
    return {
      estado: anotar(
        {
          ...estado,
          fase: "cambioConVista",
          poderPendiente: null,
          cambioPendiente: { indiceJugador: yo, posicionPropia, indiceRival, posicionRival },
          // Vio las dos, así que las conoce desde ya, cambie o no. Si cambia,
          // cada una sigue conocida en su mano nueva.
          conocimientos: conocer(
            conocer(estado.conocimientos ?? [], [yo], miMano[posicionPropia], "poder10", estado.ronda),
            [yo],
            manoRival[posicionRival],
            "poder10",
            estado.ronda,
          ),
        },
        `${estado.jugadores[yo].nombre} mira su carta y una de ${estado.jugadores[indiceRival].nombre}`,
        // Las DOS posiciones, por lo mismo que en `usarPoderMirar`: la mesa
        // entera ve dónde miró. Los números no van — ésos son las cartas.
        {
          tipo: "miroParaCambiar",
          actor: yo,
          objetivo: indiceRival,
          posicionPropia,
          posicionRival,
        },
      ),
      revelada: { propia: miMano[posicionPropia], rival: manoRival[posicionRival] },
    };
  }

  const revelada = null;
  const mia = miMano[posicionPropia];
  const suya = manoRival[posicionRival];
  miMano[posicionPropia] = suya;
  manoRival[posicionRival] = mia;

  /**
   * El 9 no le muestra nada a nadie, y no anota nada. No hace falta.
   *
   * Lo que se sabía era de las CARTAS, y las cartas sólo cambiaron de lugar.
   * Si el que lo usa conocía la suya —la miró al empezar la ronda, o con un
   * 7— ahora la conoce en la mano del rival, y puede descartársela. Si la
   * víctima conocía la que le sacaron, la conoce en la mano del que usó el
   * poder. Y lo mismo cualquier otro que las conociera.
   */
  const supo = conociaLaQueLeSacaron(estado, indiceRival, suya);

  const cambiado = {
    ...estado,
    fase: "postLevantada",
    poderPendiente: null,
    jugadores: estado.jugadores.map((j, i) =>
      i === yo ? { ...j, mano: miMano } : i === indiceRival ? { ...j, mano: manoRival } : j,
    ),
  };

  const conElCambio = anotar(
    cambiado,
    `${estado.jugadores[yo].nombre} cambió su ${posicionPropia} por la ${posicionRival} de ${estado.jugadores[indiceRival].nombre}`,
  );

  return {
    estado: supo ? anotarLoQueSupo(conElCambio, indiceRival, yo) : conElCambio,
    revelada,
  };
}

/**
 * Anuncia que a alguien le robaron una carta que conocía.
 *
 * Sin el número y sin la posición, como todos los avisos de este juego. Que la
 * mesa se entere de que la víctima ahora sabe algo del que usó el poder es
 * legítimo y hasta necesario —cualquiera pudo ver el intercambio— pero de qué
 * carta se trata no lo sabe nadie más que ella.
 */
const anotarLoQueSupo = (estado, victima, activador) =>
  anotar(
    estado,
    `${estado.jugadores[victima].nombre} sabe qué carta le tocó a ${estado.jugadores[activador].nombre}`,
    { tipo: "supoPorCambio", actor: victima, objetivo: activador },
  );

/**
 * Segunda mitad del 10: ya vio las dos cartas y decide.
 *
 * Lo que vio quedó anotado al mirar, en `usarPoderCambio`. Decida lo que
 * decida no hay nada nuevo que saber: si no cambia, cada carta sigue donde la
 * vio; si cambia, las dos se mueven y el recuerdo va con ellas.
 */
export function resolverCambioConVista(estado, cambiar) {
  const pendiente = estado.cambioPendiente;
  if (estado.fase !== "cambioConVista" || !pendiente) return estado;

  const { indiceJugador: yo, posicionPropia, indiceRival, posicionRival } = pendiente;
  const miMano = [...estado.jugadores[yo].mano];
  const manoRival = [...estado.jugadores[indiceRival].mano];
  const mia = miMano[posicionPropia];
  const suya = manoRival[posicionRival];

  const sinPendiente = { ...estado, fase: "postLevantada", cambioPendiente: null };

  if (!cambiar) {
    return anotar(
      sinPendiente,
      `${estado.jugadores[yo].nombre} miró las dos cartas y NO cambió`,
      // Sin posiciones: no se movió nada, así que no hay nada que la mesa
      // pueda haber visto moverse.
      { tipo: "resolvioElDiez", actor: yo, objetivo: indiceRival, cambio: false },
    );
  }

  miMano[posicionPropia] = suya;
  manoRival[posicionRival] = mia;

  // El mismo caso que en el 9: si la víctima conocía la carta que le sacaron,
  // ahora sabe en qué mano está. Va sólo en esta rama porque en la otra no se
  // cambió nada, y sin cambio no hay nada que aprender.
  const supo = conociaLaQueLeSacaron(estado, indiceRival, suya);

  const conElCambio = anotar(
    {
      ...sinPendiente,
      jugadores: estado.jugadores.map((j, i) =>
        i === yo ? { ...j, mano: miMano } : i === indiceRival ? { ...j, mano: manoRival } : j,
      ),
    },
    `${estado.jugadores[yo].nombre} cambió una carta con ${estado.jugadores[indiceRival].nombre}`,
    // Con las posiciones: son las que le permiten a los cuatro navegadores
    // dibujar el intercambio, no sólo al que lo hizo. Dos cartas cambiaron de
    // mano y eso se ve en la mesa de todos modos.
    {
      tipo: "resolvioElDiez",
      actor: yo,
      objetivo: indiceRival,
      cambio: true,
      posicionPropia,
      posicionRival,
    },
  );

  return supo ? anotarLoQueSupo(conElCambio, indiceRival, yo) : conElCambio;
}

/**
 * Renunciar al poder: la carta queda como una carta más.
 *
 * Ya no reabre nada. Antes sí, y con razón: el poder salteaba la ventana, así
 * que al renunciar había que devolverle a la mesa los reflejos que el tiro le
 * habría dado. Ahora la ventana ocurre ANTES de decidir el poder, siempre, así
 * que la mesa ya tuvo su turno de reaccionar. Reabrirla acá sería una segunda
 * ventana por la misma carta.
 */
export function saltarPoder(estado) {
  const poder = estado.poderPendiente;
  const siguiente = {
    ...estado,
    fase: "postLevantada",
    poderPendiente: null,
  };
  if (!poder) return siguiente;
  return anotar(
    siguiente,
    `${estado.jugadores[poder.indiceJugador].nombre} no usó el poder ${poder.numero}`,
  );
}

// ------------------------------------------------------------------ corte

/** Sólo se puede cortar en el turno propio y después de haber levantado. */
export const puedeCortar = (estado) => estado.fase === "postLevantada";

export function cortar(estado) {
  if (!puedeCortar(estado)) return estado;
  return resolverCorteDesde(estado, estado.indiceTurno);
}

/**
 * El corte, resuelto para un cortador cualquiera.
 *
 * Existe separado de `cortar` porque ahora hay DOS maneras de cerrar una
 * ronda y las dos tienen que hacer exactamente lo mismo con los puntos, las
 * eliminaciones y el fin de partida:
 *
 *   - cortar a propósito, en el turno propio y después de levantar;
 *   - quedarse sin cartas, que corta solo.
 *
 * Si el corte automático hubiera copiado este cuerpo, la primera diferencia
 * entre las dos copias sería una ronda que se puntúa distinta según cómo
 * terminó, y eso no se ve hasta que alguien suma mal.
 */
function resolverCorteDesde(estado, indiceCortador, { automatico = false } = {}) {
  const cortador = estado.jugadores[indiceCortador];

  // Se mide ANTES de resolver: al resolver las manos quedan reveladas igual,
  // pero el bono es por haber llegado al corte sin cartas.
  const cortePerfecto = cartasVivas(cortador.mano).length === 0;

  const { jugadores, corteFallido } = resolverCorte(estado.jugadores, indiceCortador);
  const eliminados = aplicarEliminacion(
    jugadores,
    estado.ronda,
    estado.limitePuntos ?? LIMITE_ELIMINACION,
  );
  const fin = comprobarFinPartida(eliminados);

  // Si todos se pasaron de 150 en la misma ronda y quedaron empatados en el
  // puntaje más bajo, hay que jugar una ronda de desempate. Para eso los
  // empatados vuelven a la mesa: si siguieran eliminados no repartiría a
  // nadie, la ronda no cambiaría nada y la partida no terminaría nunca.
  const enDesempate = new Set(fin.desempate ? fin.empatados.map((j) => j.id) : []);
  const conEliminados = enDesempate.size
    ? eliminados.map((j) =>
        enDesempate.has(j.id) ? { ...j, eliminado: false, eliminadoEnRonda: null } : j,
      )
    : eliminados;

  const eventos = [...estado.eventos];
  if (cortePerfecto) {
    eventos.push({ tipo: "cortePerfecto", indice: indiceCortador, ronda: estado.ronda });
  }
  // Las eliminaciones de esta ronda se atribuyen a quien la cerró cortando.
  conEliminados.forEach((j, i) => {
    if (j.eliminado && !estado.jugadores[i].eliminado && i !== indiceCortador) {
      eventos.push({ tipo: "eliminacion", porIndice: indiceCortador, aIndice: i, ronda: estado.ronda });
    }
  });

  return anotar(
    {
      ...estado,
      fase: fin.terminada ? "finPartida" : "finRonda",
      jugadores: conEliminados,
      indiceCortador,
      eventos,
      ganador: fin.ganador,
      desempate: Boolean(fin.desempate),
    },
    automatico
      ? `${estado.jugadores[indiceCortador].nombre} se quedó sin cartas: corte automático`
      : corteFallido
        ? `${estado.jugadores[indiceCortador].nombre} cortó mal: +10 puntos`
        : `${estado.jugadores[indiceCortador].nombre} cortó correctamente`,
  );
}

/**
 * Quién se quedó sin cartas, si alguien.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE MIRA AL CERRAR LA VENTANA Y NO AL SACAR LA CARTA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque una mano sólo se puede vaciar durante la ventana de reflejos, y en
 * esa ventana los cuatro jugadores actúan A LA VEZ. Cortando en el instante
 * en que una mano queda vacía, la ronda terminaría con los reflejos de los
 * demás todavía en camino — y quién llega antes lo decidiría la conexión,
 * que es exactamente lo que `red.js` existe para impedir.
 *
 * Al cerrarse la ventana ya están todos los intentos resueltos y ordenados
 * por tiempo efectivo. Recién ahí se sabe quién quedó sin cartas de verdad.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SI SE VACIARON DOS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Corta el que se vació antes, y ese orden ya está resuelto: es el de
 * `intentos`, que la ventana dejó ordenado por tiempo efectivo. Elegir por
 * índice de jugador sería darle la ronda al que se sentó primero.
 *
 * A los eliminados no se los mira: no tienen cartas porque no están
 * jugando, y un eliminado no puede cortar nada.
 */
export function quienSeQuedoSinCartas(estado) {
  const vacios = estado.jugadores
    .map((j, i) => (!j.eliminado && cartasVivas(j.mano).length === 0 ? i : -1))
    .filter((i) => i >= 0);

  if (vacios.length <= 1) return vacios[0] ?? null;

  // El que perdió una carta en cada intento: el que descartó, o el que
  // entregó una al acertarle a un rival.
  const enOrden = (estado.ventanaDescarte?.intentos ?? []).map((x) =>
    x.actor != null ? x.actor : x.indiceJugador,
  );
  return enOrden.find((i) => vacios.includes(i)) ?? vacios[0];
}

/**
 * El jugador se quedó sin tiempo para levantar: pierde la levantada y el
 * turno pasa al siguiente. No es lo mismo que `pasarTurno`, que se usa
 * después de haber levantado.
 */
export function saltarTurno(estado) {
  if (estado.fase !== "turno" || estado.levantada) return estado;
  return anotar(
    {
      ...estado,
      indiceTurno: siguienteActivo(estado.jugadores, estado.indiceTurno),
    },
    `${estado.jugadores[estado.indiceTurno].nombre} no levantó a tiempo`,
  );
}

export function pasarTurno(estado) {
  if (estado.fase !== "postLevantada") return estado;
  return {
    ...estado,
    fase: "turno",
    indiceTurno: siguienteActivo(estado.jugadores, estado.indiceTurno),
  };
}

/** La mano pasa al siguiente jugador y se reparte de nuevo. */
export function siguienteRonda(estado) {
  if (estado.fase !== "finRonda") return estado;
  return empezarRonda({
    ...estado,
    indiceMano: siguienteActivo(estado.jugadores, estado.indiceMano),
  });
}

export const cartasEnMano = (jugador) => cartasVivas(jugador.mano).length;

/**
 * Orden final de la partida: 1º el ganador, después los eliminados del
 * último al primero. A igualdad de ronda de eliminación desempata el
 * puntaje más bajo.
 */
export function posicionesFinales(estado) {
  const conIndice = estado.jugadores.map((j, indice) => ({ ...j, indice }));
  const ganadorId = estado.ganador?.id;

  return conIndice
    .slice()
    .sort((a, b) => {
      if (a.id === ganadorId) return -1;
      if (b.id === ganadorId) return 1;
      if (a.eliminado !== b.eliminado) return a.eliminado ? 1 : -1;
      const rondaA = a.eliminadoEnRonda ?? Infinity;
      const rondaB = b.eliminadoEnRonda ?? Infinity;
      if (rondaA !== rondaB) return rondaB - rondaA;
      return a.puntos - b.puntos;
    })
    .map((j, orden) => ({
      posicion: orden + 1,
      indice: j.indice,
      id: j.id,
      nombre: j.nombre,
      esIA: j.esIA,
      puntos: j.puntos,
      eliminadoEnRonda: j.eliminadoEnRonda,
    }));
}

/** Todo lo que el ranking necesita saber de una partida terminada. */
export function resumenPartida(estado) {
  const posiciones = posicionesFinales(estado);
  const porIndice = new Map(posiciones.map((p) => [p.indice, p]));

  return {
    rondas: estado.ronda,
    ganadorId: estado.ganador?.id ?? null,
    posiciones,
    eventos: estado.eventos.map((ev) => ({
      ...ev,
      // Los eventos guardan índices; el ranking trabaja con ids de jugador.
      porId: ev.porIndice != null ? porIndice.get(ev.porIndice)?.id : undefined,
      aId: ev.aIndice != null ? porIndice.get(ev.aIndice)?.id : undefined,
      id: ev.indice != null ? porIndice.get(ev.indice)?.id : undefined,
    })),
  };
}
