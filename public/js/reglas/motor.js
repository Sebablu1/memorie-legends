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
   * Lo que cada jugador SABE de las manos ajenas, por haber usado un poder.
   *
   *   { actor, objetivo, numero, origen, ronda }
   *
   * Guarda el NÚMERO, no la posición: ésa es toda la mecánica. Ver un 5 en la
   * mano de otro no es saber dónde está el 5 dentro de un rato, porque las
   * cartas se mueven y la memoria falla. Por eso conocer una carta habilita a
   * intentar sobre CUALQUIER posición de esa mano, y equivocarse cuesta.
   *
   * Es un array de objetos planos: viaja con el estado y sobrevive el JSON.
   * NUNCA sale hacia una vista: al cliente sólo le llega a quién puede
   * atacar, jamás qué número conoce. Ver `vista.js`.
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
      conocimientos: recordarPropia(estado, {
        jugador: indiceJugador,
        posicion,
        carta: estado.jugadores[indiceJugador]?.mano?.[posicion],
        origen: "mirada",
      }),
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
    mano.push(cartaCastigo());
  }

  const resultado = correcto ? (fuePrimero ? "primero" : "tarde") : "error";

  /**
   * Un fallo le muestra a la mesa la carta Y dónde estaba.
   *
   * ───────────────────────────────────────────────────────────────────
   *
   * Hasta ahora eso no servía de nada: la carta se exponía dos segundos, los
   * rivales la veían, y no podían hacer nada con ella — `puedeAtacarA` exige un
   * conocimiento, y los conocimientos sólo los daban los poderes 8 y 10.
   *
   * SÓLO el error, nunca el acierto tarde. Los dos exponen la carta, pero sólo
   * el error regala el derecho: así fallar sigue siendo peor que llegar tarde,
   * y llegar tarde peor que ser primero.
   */
  const conocimientos =
    resultado === "error"
      ? recordarFallo(estado, { objetivo: indiceJugador, posicion, carta })
      : (estado.conocimientos ?? []);

  return anotar(
    {
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
          { indiceJugador, posicion, resultado, carta: fuePrimero ? null : carta },
        ],
      },
    },
    `${jugador.nombre}: descarte ${resultado}`,
  );
}

/**
 * ¿Puede `actor` intentar sobre la mano de `objetivo`?
 *
 * Basta con conocer UNA carta suya. Conocer un número no es conocer una
 * posición, así que el derecho es sobre la mano entera: si el permiso se
 * limitara a la posición donde se vio, el poder sería un acierto garantizado
 * y no habría nada que recordar.
 */
export const puedeAtacarA = (estado, actor, objetivo) =>
  actor !== objetivo &&
  !estado.jugadores[objetivo]?.eliminado &&
  (estado.conocimientos ?? []).some(
    (c) =>
      c.actor === actor &&
      c.objetivo === objetivo &&
      /**
       * Menos lo que dejó un fallo ajeno, que da derecho por POSICIÓN.
       *
       * Sin este filtro, el conocimiento del fallo satisfacía la condición de
       * arriba y habilitaba la mano entera — que es exactamente lo que no
       * corresponde: la mesa vio dónde estaba esa carta, no las otras tres.
       *
       * Ese derecho lo contesta `puedeAtacarEn`, que además compara el `id` de
       * la carta contra la que hay ahí ahora.
       */
      c.origen !== "fallo",
  );

/** A quién puede atacar cada jugador. Es lo ÚNICO de esto que puede viajar. */
export const objetivosDe = (estado, actor) =>
  estado.jugadores
    .map((_, i) => i)
    .filter((i) => puedeAtacarA(estado, actor, i));

/**
 * El otro derecho: el que deja un descarte FALLIDO, y que es por POSICIÓN.
 *
 * ─────────────────────────────────────────────────────────────────────
 * POR QUÉ ÉSTE NO ES SOBRE LA MANO ENTERA
 * ─────────────────────────────────────────────────────────────────────
 *
 * El de los poderes sí lo es, y con razón: quien usa un 8 se lleva un NÚMERO,
 * no una posición, así que limitarlo al lugar donde lo vio volvería el poder
 * un acierto garantizado y no habría nada que recordar.
 *
 * Acá al revés. Cuando alguien falla un descarte, la mesa entera ve la carta
 * Y dónde estaba: los dos datos, a la vez y sin esfuerzo. Darle derecho sobre
 * la mano entera regalaría un permiso que nadie se ganó.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Y POR QUÉ NO HACE FALTA INVALIDARLO NUNCA
 * ─────────────────────────────────────────────────────────────────────
 *
 * Porque se guarda el `id` de la carta y acá se compara contra la que HAY en
 * esa posición. Si se la cambiaron con un 9, se la descartaron, o volvió a
 * fallar y ahora hay otra, el recuerdo deja de valer solo.
 *
 * La alternativa era borrarlo a mano en las funciones que mueven cartas de una
 * mano —`usarPoderCambio`, `intentarDescarteRival`, `intentarDescarte`— y
 * olvidarse de una sola le daría a alguien derecho sobre una carta que ya no
 * está donde él cree. Es el mismo truco que `loQueSabeDeSuCarta`, y por el
 * mismo motivo.
 */
export const puedeAtacarEn = (estado, actor, objetivo, posicion) => {
  if (actor === objetivo || estado.jugadores[objetivo]?.eliminado) return false;

  const memo = (estado.conocimientos ?? []).find(
    (c) =>
      c.actor === actor &&
      c.objetivo === objetivo &&
      c.posicion === posicion &&
      c.origen === "fallo",
  );
  if (!memo) return false;

  const actual = estado.jugadores[objetivo]?.mano?.[posicion];
  return Boolean(actual) && actual.id === memo.idCarta;
};

/**
 * Las posiciones sueltas que `actor` puede atacar, por un fallo ajeno.
 *
 * Esto SÍ puede viajar, y no filtra nada: la carta y su posición se
 * expusieron a los cuatro cuando el fallo ocurrió. Lo que viaja es el
 * permiso —quién y dónde— nunca el número.
 */
export const posicionesAtacablesDe = (estado, actor) => {
  const salida = [];
  for (const c of estado.conocimientos ?? []) {
    if (c.actor !== actor || c.origen !== "fallo") continue;
    if (puedeAtacarEn(estado, actor, c.objetivo, c.posicion)) {
      salida.push({ objetivo: c.objetivo, posicion: c.posicion });
    }
  }
  return salida;
};

/**
 * Anota que TODA la mesa vio dónde estaba la carta que alguien falló.
 *
 * Sólo el error, nunca el acierto tarde. Los dos exponen la carta dos segundos
 * —eso no cambió— pero sólo el error regala el derecho a atacarla. Es lo que
 * mantiene el escalón: fallar es peor que llegar tarde, y llegar tarde es peor
 * que ser primero.
 */
function recordarFallo(estado, { objetivo, posicion, carta }) {
  if (!carta) return estado.conocimientos ?? [];

  let conocimientos = estado.conocimientos ?? [];
  for (let actor = 0; actor < estado.jugadores.length; actor++) {
    if (actor === objetivo || estado.jugadores[actor]?.eliminado) continue;

    // Una creencia por actor y posición: si esa posición vuelve a fallar con
    // otra carta, lo que vale es lo último que se vio.
    conocimientos = conocimientos.filter(
      (c) => !(c.actor === actor && c.objetivo === objetivo && c.posicion === posicion && c.origen === "fallo"),
    );
    conocimientos = [
      ...conocimientos,
      {
        actor,
        objetivo,
        numero: carta.numero,
        posicion,
        idCarta: carta.id,
        origen: "fallo",
        ronda: estado.ronda,
      },
    ];
  }
  return conocimientos;
}

/**
 * Intento de descarte sobre la mano de OTRO, habilitado por un poder 8 o 10.
 *
 * `posicionObjetivo` es una apuesta, no una afirmación: el jugador cree que
 * ahí está la carta que vio. `posicionEntrega` es la carta propia que va a
 * dar a cambio SI acierta, elegida por posición y a ciegas —no sabe cuál es—.
 *
 * ACIERTO: la carta del rival se va al descarte y la carta propia ocupa
 *          EXACTAMENTE ese hueco, boca abajo. Nadie ve su valor, ni siquiera
 *          quien la entregó. El conocimiento de ese número se consume.
 *
 * ERROR:   la carta del rival no se mueve, se expone un momento a la mesa, y
 *          el atacante recibe una carta de castigo. El conocimiento queda:
 *          equivocarse de posición no borra lo que se vio, así que puede
 *          seguir buscando y cada error vuelve a costar.
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

  /**
   * Dos derechos distintos, y alcanza con cualquiera.
   *
   * ───────────────────────────────────────────────────────────────────
   *
   * `puedeAtacarA` es el de los poderes: vale sobre la mano ENTERA, porque lo
   * que se supo fue un número y no un lugar.
   *
   * `puedeAtacarEn` es el que deja un fallo ajeno: vale sobre ESA posición y
   * ninguna otra, porque la mesa vio exactamente dónde estaba.
   *
   * Se comprueban los dos y no uno: quien tiene el derecho de un poder puede
   * atacar donde quiera, y quien sólo vio un fallo, sólo ahí.
   */
  if (
    !puedeAtacarA(estado, actor, objetivo) &&
    !puedeAtacarEn(estado, actor, objetivo, posicionObjetivo)
  ) {
    return estado;
  }

  const manoObjetivo = [...estado.jugadores[objetivo].mano];
  const manoActor = [...estado.jugadores[actor].mano];
  const carta = manoObjetivo[posicionObjetivo];
  if (!carta) return estado;

  const muestra = cima(estado.descarte);
  const correcto = esDescarteValido(carta, muestra);

  const origen = rellenarMazo(estado);
  const mazo = [...origen.mazo];
  const descarte = [...origen.descarte];

  let conocimientos = estado.conocimientos ?? [];

  if (correcto) {
    // La entrega tiene que ser una carta que exista de verdad.
    const entregada = manoActor[posicionEntrega];
    if (!entregada) return estado;

    // La transferencia, en una sola transición y sin desplazar nada:
    // la del rival se va al descarte y la propia ocupa ese mismo hueco.
    descarte.unshift({ ...carta, visible: true });
    manoObjetivo[posicionObjetivo] = { ...entregada, visible: false };
    manoActor[posicionEntrega] = null;

    // El número encontrado ya no está en esa mano: el conocimiento se gastó.
    // Lo que se entregó NO hereda nada: quien la dio no sabe cuál era.
    conocimientos = conocimientos.filter(
      (c) => !(c.actor === actor && c.objetivo === objetivo && c.numero === carta.numero),
    );
  } else {
    // Se equivocó de posición: la carta del rival no se toca y paga con una.
    manoActor.push(mazo.length ? mazo.shift() : null);
  }

  return anotar(
    {
      ...estado,
      mazo,
      descarte,
      conocimientos,
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
            // Sólo la fallada se expone a la mesa. La acertada se fue al
            // descarte, donde ya se ve; la entregada no se muestra jamás.
            carta: correcto ? null : carta,
          },
        ],
      },
    },
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

  const conLaMuestraNueva = {
    ...estado,
    jugadores: estado.jugadores.map((j, idx) => (idx === i ? { ...j, mano } : j)),
    descarte: descartada
      ? [{ ...descartada, visible: true }, ...estado.descarte]
      : estado.descarte,
    levantada: null,
  };

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

/** Poderes 7 y 8: mirar. Devuelve la carta para que la UI la muestre un instante. */
/**
 * Anota que `actor` sabe que `objetivo` tiene una carta de ese número.
 *
 * Se guarda el número y no la carta ni su posición: es lo único que el
 * jugador se lleva de verdad. Repetido no se duplica —saber dos veces lo
 * mismo no da dos derechos— pero sí se guardan números distintos.
 */
function recordar(estado, { actor, objetivo, numero, origen }) {
  if (actor === objetivo || !Number.isInteger(numero)) return estado.conocimientos ?? [];
  const previos = estado.conocimientos ?? [];
  const repetido = previos.some(
    (c) => c.actor === actor && c.objetivo === objetivo && c.numero === numero,
  );
  if (repetido) return previos;
  return [...previos, { actor, objetivo, numero, origen, ronda: estado.ronda }];
}

/**
 * Anota que un jugador vio una carta SUYA.
 *
 * Va en `conocimientos`, la misma lista que lo demás, y con `actor` igual a
 * `objetivo`. Eso no le da ningún derecho: `puedeAtacarA` empieza pidiendo
 * `actor !== objetivo`, así que estas entradas no habilitan nada por sí solas.
 * Se guardan acá y no en una lista aparte por seguridad: `filtracionesEn`
 * caza cualquier objeto con `actor`, `objetivo` y `numero`, así que si un día
 * alguien publicara esto en la vista, el detector lo vería. Una estructura
 * nueva con otra forma se le escaparía.
 *
 * Se guarda el `id` de la carta además del número. Ahí está el truco que hace
 * que esto no necesite limpiarse nunca: al leerlo se compara contra la carta
 * que HAY en esa posición, y si no es la misma, el recuerdo simplemente no
 * cuenta. Sin eso habría que invalidarlo a mano en las cinco funciones que
 * mueven cartas de una mano —cambiar, descartar, acertarle a un rival,
 * fallarle, y los propios poderes 9 y 10— y olvidarse de una sola le daría a
 * alguien un derecho sobre una carta que ya no está donde él cree.
 */
function recordarPropia(estado, { jugador, posicion, carta, origen }) {
  const previos = estado.conocimientos ?? [];
  if (!carta) return previos;
  // Una creencia por posición: mirar dos veces la misma no acumula, reemplaza.
  const otros = previos.filter(
    (c) => !(c.actor === jugador && c.objetivo === jugador && c.posicion === posicion),
  );
  return [
    ...otros,
    {
      actor: jugador,
      objetivo: jugador,
      numero: carta.numero,
      posicion,
      idCarta: carta.id,
      origen,
      ronda: estado.ronda,
    },
  ];
}

/**
 * Qué recuerda un jugador de su propia carta ahí, si todavía es verdad.
 *
 * Devuelve el recuerdo sólo si la carta que hay en esa posición es la misma
 * que vio. Si se la cambiaron, se la descartaron o le pusieron otra boca
 * abajo, el recuerdo está viejo y esto devuelve null — que es lo correcto: el
 * jugador cree saber algo que ya no es cierto, y el juego no puede premiarlo
 * por una creencia equivocada.
 */
function loQueSabeDeSuCarta(estado, jugador, posicion) {
  const memo = (estado.conocimientos ?? []).find(
    (c) => c.actor === jugador && c.objetivo === jugador && c.posicion === posicion,
  );
  if (!memo) return null;
  const actual = estado.jugadores[jugador]?.mano?.[posicion];
  return actual && actual.id === memo.idCarta ? memo : null;
}

/**
 * A la víctima de un 9 o un 10 le sacaron una carta que ella conocía.
 *
 * Entonces ahora sabe dónde está: en la mano del que usó el poder. Es
 * conocimiento ganado igual que cualquier otro —lo vio con sus ojos— y le da
 * el mismo derecho: puede intentar descartársela.
 *
 * Se comprueba ANTES del intercambio, contra el estado sin tocar, porque
 * después la carta ya no está ahí y el recuerdo dejaría de validar.
 *
 * Devuelve `{ conocimientos, supo }`. `supo` es null si no sabía nada, y
 * entonces no se agrega ni se anuncia nada: no todo cambio enseña algo.
 */
function loQueAprendeLaVictima(estado, conocimientos, { victima, activador, posicion }) {
  const memo = loQueSabeDeSuCarta(estado, victima, posicion);
  if (!memo) return { conocimientos, supo: null };
  return {
    conocimientos: recordar({ ...estado, conocimientos }, {
      actor: victima,
      objetivo: activador,
      numero: memo.numero,
      origen: "cambio",
    }),
    supo: memo,
  };
}

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

  // El 8 mira la mano de otro: de ahí sale el derecho a atacarlo. El 7 mira la
  // propia y sigue sin dar ninguno —saber lo tuyo no te autoriza sobre nadie—,
  // pero ahora SÍ queda anotado qué vio.
  //
  // Es un recuerdo, no un permiso: `puedeAtacarA` exige `actor !== objetivo`,
  // así que esta entrada no habilita nada. Sirve para una sola cosa: si
  // después alguien le cambia esa carta con un 9 o un 10, se puede distinguir
  // a quien le robaron algo que conocía de quien nunca supo qué tenía.
  const conocimientos =
    poder.tipo === "mirarPropia"
      ? recordarPropia(estado, {
          jugador: poder.indiceJugador,
          posicion,
          carta,
          origen: "poder7",
        })
      : recordar(estado, {
          actor: poder.indiceJugador,
          objetivo: indiceObjetivo,
          numero: carta?.numero,
          origen: "poder8",
        });

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
  miMano[posicionPropia] = manoRival[posicionRival];
  manoRival[posicionRival] = mia;

  // Qué conocimiento deja el 10, derivado de lo que REALMENTE pasó:
  //
  // El 10 muestra las dos cartas y después las intercambia. La que era del
  // rival ahora es propia, así que saber su número ya no es saber nada de
  // nadie. Pero la carta que uno entregó SÍ quedó en la mano del rival, y su
  // número se vio. Ése es el conocimiento que queda: "el rival tiene esto".
  //
  // El 9 cambia a ciegas —`revelada` es null— y por eso no deja ninguno: no
  // se puede recordar lo que no se vio.
  const delActivador = revelada
    ? recordar(estado, {
        actor: yo,
        objetivo: indiceRival,
        numero: mia?.numero,
        origen: "poder10",
      })
    : (estado.conocimientos ?? []);

  // Y lo que aprende el otro. El 9 cambia a ciegas para QUIEN LO USA, pero no
  // para quien lo sufre: si la víctima sabía qué carta tenía ahí —la miró al
  // principio de la ronda, o con un 7— acaba de ver adónde se fue. Eso es
  // conocimiento ganado con los ojos, igual que el de cualquier poder, y da
  // el mismo derecho.
  const { conocimientos, supo } = loQueAprendeLaVictima(estado, delActivador, {
    victima: indiceRival,
    activador: yo,
    posicion: posicionRival,
  });

  const cambiado = {
    ...estado,
    fase: "postLevantada",
    poderPendiente: null,
    conocimientos,
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
 * El conocimiento que queda depende de lo que decidió, y no es lo mismo:
 *
 *   - Si CAMBIA, la carta que era del rival pasa a ser suya, así que saber su
 *     número ya no es saber nada de nadie. Lo que sí queda es que la carta que
 *     él entregó está ahora en la mano del rival, y su número lo vio.
 *   - Si NO CAMBIA, cada carta se queda donde estaba, y lo que vio es la carta
 *     del rival, que sigue siendo del rival. Ése es el conocimiento.
 *
 * Derivarlo mal en cualquiera de los dos casos le daría al jugador un derecho
 * sobre una carta que no está donde él cree.
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
      {
        ...sinPendiente,
        conocimientos: recordar(estado, {
          actor: yo,
          objetivo: indiceRival,
          numero: suya?.numero,
          origen: "poder10",
        }),
      },
      `${estado.jugadores[yo].nombre} miró las dos cartas y NO cambió`,
      // Sin posiciones: no se movió nada, así que no hay nada que la mesa
      // pueda haber visto moverse.
      { tipo: "resolvioElDiez", actor: yo, objetivo: indiceRival, cambio: false },
    );
  }

  miMano[posicionPropia] = suya;
  manoRival[posicionRival] = mia;

  const delActivador = recordar(estado, {
    actor: yo,
    objetivo: indiceRival,
    numero: mia?.numero,
    origen: "poder10",
  });

  // El mismo caso que en el 9: si la víctima conocía la carta que le sacaron,
  // ahora sabe en qué mano está. Va sólo en esta rama porque en la otra no se
  // cambió nada, y sin cambio no hay nada que aprender.
  const { conocimientos, supo } = loQueAprendeLaVictima(estado, delActivador, {
    victima: indiceRival,
    activador: yo,
    posicion: posicionRival,
  });

  const conElCambio = anotar(
    {
      ...sinPendiente,
      conocimientos,
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
