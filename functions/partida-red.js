/**
 * Motor en red: la partida vive en el servidor.
 *
 * MODELO DE DATOS
 *
 *   partidas/{codigo}                  ← estado COMPLETO. Secreto.
 *     jugadores      [uid, ...]        el índice en este array es el índice
 *                                      del jugador en el motor, y no cambia
 *     estado         {...}             el estado del motor, con TODAS las
 *                                      cartas: manos, mazo y orden del mazo
 *     ventana        {...}             ventana de descarte abierta, si hay
 *     latidos        { uid: ms }       última señal de vida de cada uno
 *     ausentes       [uid, ...]        los que dejaron de dar señales
 *     ausentesPorTiempo [uid, ...]     los que dejaron vencer la decisión de
 *                                      cortar; sólo los saca «he vuelto»
 *     abandonaron    [uid, ...]        los que se fueron pagando la penalización
 *     version        n                 sube en cada cambio; ordena los avisos
 *
 *   partidas/{codigo}/vistas/{uid}     ← lo que ese jugador puede saber
 *
 * Este documento maestro NO puede ser legible por nadie: contiene las manos
 * de los cuatro y el orden del mazo. Las reglas de Firestore tienen que
 * negarlo explícitamente, y cada jugador lee sólo su propia vista, que se
 * escribe en la misma transacción con `vistaDe`.
 *
 * Si algún día alguien "arregla" las reglas dejando leer `partidas`, el juego
 * se termina en silencio: cualquiera abriría la consola y vería las manos.
 * Por eso la comprobación está también en las pruebas.
 */

import { vistaDe, filtracionesEn, MS_REVELACION } from "./reglas/vista.js";
import * as motor from "./reglas/motor.js";
import { semillaAleatoria } from "./reglas/azar.js";
import { JUEGO_POR_DEFECTO } from "./reglas/juegos.js";
import {
  MS_VENTANA,
  MS_VENTANA_REAPERTURA,
  MS_VENTANA_TOTAL,
  crearVentana,
  registrarIntento,
  yaVencio,
  entregasPendientes,
  MS_GRACIA_ENTREGA,
  MS_PARA_DECIDIR,
  msDeLaDecision,
  decisionQueVence,
} from "./reglas/red.js";

/** Sin señales durante este tiempo, se considera que el jugador se cayó. */
export const MS_SIN_SENALES = 15000;

/**
 * Sin señales de NADIE durante este tiempo, la mesa se da por desierta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ DIEZ MINUTOS Y NO QUINCE SEGUNDOS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `MS_SIN_SENALES` mide a UNO para saltarle el turno, y equivocarse ahí
 * cuesta un turno. Esto mide a los CUATRO para terminar la partida y
 * devolver el pozo, y equivocarse cuesta una partida en curso.
 *
 * Los latidos siguen saliendo con la pestaña escondida —`mantenerVivo` es un
 * `setInterval` sin condición de visibilidad, a diferencia de
 * `mantenerEnMarcha`— pero el navegador los frena a uno por minuto en una
 * pestaña de fondo, y pasados unos minutos puede congelar la página del
 * todo. Quince segundos de silencio no significan nada; diez minutos sí.
 *
 * Y el error, si lo hubiera, cae del lado bueno: una mesa cerrada de más le
 * devuelve a cada uno lo que puso. Nadie pierde Leyendas por esto.
 */
export const MS_MESA_DESIERTA = 10 * 60 * 1000;

/** Lo que espera la mesa a que alguien levante. Vive en el motor: la pinta el
    cliente y la aplica el servidor, y dos copias se separan en silencio. */
export const MS_TURNO = motor.MS_TURNO;

/**
 * Lo que dura la mirada del principio de la ronda.
 *
 * Se re-exporta la del motor en vez de declarar otra. Tenerlo escrito dos
 * veces ya nos costó una divergencia silenciosa: alguien cambió el del motor a
 * 4000 y el entrenamiento pasó a medir el doble que las partidas por Leyendas,
 * con las pruebas en verde porque cada modo miraba su propia copia.
 */
export const MS_MIRAR = motor.MS_MIRAR;

/**
 * Los otros dos tiempos de la mirada, por lo mismo: elegir cuál, y el total.
 *
 * La fase `mirar` dura el TOTAL. Antes duraba `MS_MIRAR` a secas, así que en
 * red había que elegir y llegar al servidor en dos segundos mientras que en
 * entrenamiento había cinco para elegir y dos para ver. Ver el motor.
 */
export const MS_ELEGIR_MIRADA = motor.MS_ELEGIR_MIRADA;
export const MS_MIRADA_TOTAL = motor.MS_MIRADA_TOTAL;

/**
 * Lo que espera el servidor a que el del turno corte o pase.
 *
 * Sale del motor y no se escribe acá otra vez: la mesa de entrenamiento usa la
 * misma cuenta, y tenerla duplicada es como se separan dos números que tenían
 * que ser el mismo.
 */
export const MS_PASO_AUTOMATICO = motor.MS_PASO_AUTOMATICO;

/** Lo que se muestran los resultados antes de repartir la ronda siguiente.
    Vive en el motor: la mesa de entrenamiento la necesita para avanzar sola
    cuando el jugador está ausente. */
export const MS_ENTRE_RONDAS = motor.MS_ENTRE_RONDAS;

/**
 * Cuánto se espera, como mucho, a que todos lleguen a la mesa.
 *
 * La partida se crea desde la sala, y los jugadores todavía tienen que
 * redirigirse, cargar la mesa y abrir la sesión: en producción eso llevó unos
 * seis segundos. Antes la primera mirada arrancaba en el reparto y se
 * terminaba antes de que nadie pudiera tocar una carta.
 *
 * Ahora se abre cuando llega el último. Este tope es para el que no llega
 * nunca —una pestaña que no carga no puede trabar la mesa de los demás—: al
 * cumplirse, la partida arranca igual, y el que falta se pierde su mirada como
 * si se hubiera desconectado.
 */
export const MS_ESPERA_LLEGADAS = 15_000;

/** La cuenta regresiva antes de la primera mirada. Vive en el motor. */
export const MS_CUENTA_REGRESIVA = motor.MS_CUENTA_REGRESIVA;

/**
 * Lo que se muestra el resultado final antes de repartir el pozo.
 *
 * Corto a propósito: el dinero de la gente no puede quedar esperando. Pero no
 * cero, para que los cuatro alcancen a recibir la vista con el resultado antes
 * de que la sala pase a terminada.
 */
export const MS_ANTES_DE_CERRAR = 4000;

/**
 * Acciones que un jugador puede pedir. Cualquier otra cosa se rechaza sin
 * mirarla: la lista es blanca a propósito.
 */
export const ACCIONES = {
  MIRAR: "mirar",
  DESCARTAR: "descartar",
  LEVANTAR: "levantar",
  CAMBIAR: "cambiar",
  TIRAR: "tirar",
  PODER_MIRAR: "poderMirar",
  PODER_CAMBIO: "poderCambio",
  SALTAR_PODER: "saltarPoder",
  // Segunda mitad del 10: ya vio las dos cartas y dice si cambia.
  RESOLVER_CAMBIO: "resolverCambio",
  CORTAR: "cortar",
  PASAR: "pasar",
};

/**
 * En qué fase del motor tiene sentido cada acción.
 *
 * Descartar vale en dos, por lo de arriba. Las demás siguen atadas a una.
 */
const FASE_DE = {
  [ACCIONES.MIRAR]: "mirar",
  [ACCIONES.DESCARTAR]: ["mirar", "descarte"],
  [ACCIONES.LEVANTAR]: "turno",
  [ACCIONES.CAMBIAR]: "levantada",
  [ACCIONES.TIRAR]: "levantada",
  [ACCIONES.PODER_MIRAR]: "poder",
  [ACCIONES.PODER_CAMBIO]: "poder",
  [ACCIONES.SALTAR_PODER]: "poder",
  [ACCIONES.RESOLVER_CAMBIO]: "cambioConVista",
  [ACCIONES.CORTAR]: "postLevantada",
  [ACCIONES.PASAR]: "postLevantada",
};

/** Acciones que sólo puede pedir quien tiene el turno. */
const EXIGEN_TURNO = new Set([
  ACCIONES.LEVANTAR, ACCIONES.CAMBIAR, ACCIONES.TIRAR,
  ACCIONES.PODER_MIRAR, ACCIONES.PODER_CAMBIO, ACCIONES.SALTAR_PODER,
  ACCIONES.RESOLVER_CAMBIO,
  ACCIONES.CORTAR, ACCIONES.PASAR,
]);

/**
 * Las jugadas que CIERRAN la ventana de reflejos. (Etapa 3b/3)
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * En red la ventana no vence por tiempo: vive mientras viva la MUESTRA. Así
 * que la lista no se elige, se deduce — son las jugadas que dejan de haber
 * muestra a la que reaccionar, y son exactamente tres:
 *
 *   - `tirar`, que pone otra carta arriba del descarte;
 *   - `cambiar`, que pone arriba una carta de la mano (`cambiarCarta` llama a
 *     `abrirReflejos` igual que `tirarCarta`: es el mismo cambio de muestra);
 *   - `cortar`, que termina la ronda y con ella cualquier reflejo.
 *
 * Las dos primeras abren una ventana nueva en el acto; la tercera no abre
 * ninguna.
 *
 * Y lo que NO está acá importa tanto como lo que está:
 *
 *   - `pasar` no cierra nada. La muestra sigue siendo la misma, así que los
 *     reflejos sobre ella siguen valiendo y la ventana puede atravesar varios
 *     turnos. Es la regla, no un efecto secundario.
 *   - `mirar` y `levantar` tampoco, y esto fue un error real: cerrar en toda
 *     jugada hacía que la primera mirada de la ronda cerrara la ventana que
 *     `repartir` había abierto, y después nadie podía descartar en la mesa
 *     entera. Lo encontró `mesa-red.mjs` con cuatro «Llegaste fuera de
 *     tiempo».
 *   - Los poderes mueven cartas de mano en mano, nunca el descarte.
 */
const CIERRAN_LA_VENTANA = new Set([
  ACCIONES.TIRAR, ACCIONES.CAMBIAR, ACCIONES.CORTAR,
]);

/** Las fases en que la ronda ya terminó y no queda muestra viva. */
const RONDA_TERMINADA = new Set(["finRonda", "finPartida"]);

export function crearMotorEnRed({
  db, partidas, ahora, idAleatorio, marcaDeTiempo, error, semillaDe = semillaAleatoria,
  /**
   * Las tres primitivas de `cierre.js`. Se inyectan para que el cierre pueda
   * ocurrir DENTRO de la transacción que abre `avanzarPartida`: llamar a la
   * callable desde acá abriría una segunda transacción, que Firestore no
   * admite anidar.
   *
   * Sin ellas el motor funciona igual, pero una partida que llegue a
   * `finPartida` se queda ahí. Es lo que pasaba hasta ahora.
   */
  cierre = null,
}) {
  const refPartida = (codigo) => db.collection(partidas).doc(codigo);
  const refVista = (codigo, uid) =>
    db.collection(`${partidas}/${codigo}/vistas`).doc(uid);

  /**
   * El estado del motor es JSON puro y viaja tal cual: no hay nada que quitar
   * al escribir ni que reponer al leer. El azar vive dentro como una semilla
   * entera (ver reglas/azar.js), no como una función.
   *
   * Esto no es un detalle de implementación: si el estado necesitara
   * "hidratarse", habría dos formas del estado dando vueltas y tarde o
   * temprano una acción correría sobre la equivocada.
   */
  const comprobarSerializable = (estado) => {
    const sospechosos = [];
    (function buscar(v, ruta) {
      if (typeof v === "function") return sospechosos.push(`${ruta} es una función`);
      if (v instanceof Map || v instanceof Set) return sospechosos.push(`${ruta} es un ${v.constructor.name}`);
      if (v && typeof v === "object") {
        if (Object.getPrototypeOf(v) !== Object.prototype && !Array.isArray(v)) {
          return sospechosos.push(`${ruta} es una instancia de ${v.constructor?.name}`);
        }
        for (const [k, x] of Object.entries(v)) buscar(x, `${ruta}.${k}`);
      }
    })(estado, "estado");
    if (sospechosos.length) {
      throw error("internal", `El estado no es serializable: ${sospechosos.join("; ")}`);
    }
    return estado;
  };

  // ------------------------------------------------------------ escritura

  /**
   * Desde cuándo está expuesta cada carta errada. (Etapa 3b/3)
   *
   * Errar expone tu carta dos segundos. El motor no puede medirlos —no mira
   * relojes, y así tiene que quedar— y hasta ahora no hacía falta: la ventana
   * entera duraba eso. Con la ventana durando todo el turno del siguiente, el
   * dato viajaría un turno completo, y de eso se ocupa esto.
   *
   * Devuelve un mapa `"duenio:posicion" → hora de pared`. Las dos puntas lo
   * usan: `publicar`, para filtrar la vista, y `plazoDePartida`, para saber
   * cuándo hay que volver a publicar.
   *
   * Qué está expuesto lo dice el MOTOR —es su lista de intentos la que lleva
   * la carta— y cuándo lo dice la ventana de RED, que sella cada llegada. Se
   * cruzan por el dueño de la carta y la posición, que en los dos lados son
   * lo mismo: el dueño es el ATACADO (`objetivo` si lo hay, el propio jugador
   * si no).
   *
   * Sin intento que la respalde no se expone. Toda carta expuesta viene de un
   * intento, y todo intento pasó por `registrarIntento`: si no aparece, algo
   * no cuadra, y lo prudente con una carta ajena es taparla.
   */
  function horasDeExposicion(partida) {
    const { estado, jugadores, ventana } = partida;
    const expuestas = new Set(
      motor.cartasExpuestas(estado.ventanaDescarte?.intentos ?? [])
        .map((r) => `${r.indiceJugador}:${r.posicion}`),
    );
    if (!expuestas.size) return new Map();

    const horas = new Map();
    for (const i of Object.values(ventana?.intentos ?? {})) {
      const duenio = jugadores.indexOf(i.objetivo ?? i.uid);
      if (duenio < 0) continue;
      const clave = `${duenio}:${i.posicion}`;
      if (!expuestas.has(clave)) continue;
      /*
       * Los 2 s cuentan desde que se APLICÓ, no desde que llegó.
       *
       * Casi siempre es el mismo instante: el reflejo se aplica al llegar.
       * Pero un toque hecho durante la MIRADA no lo acepta el motor —todavía
       * no hay ventana— y queda esperando a que alguien tire. Ése se expone
       * cuando se aplica, varios segundos después, y anclarlo a su llegada lo
       * habría dejado invisible desde el primer momento. Lo encontró
       * `mirar-descarte.mjs`.
       *
       * `i.llegada` es RELATIVO a `abiertaEn` —son milisegundos desde que la
       * ventana abrió, igual que `efectivo`— y acá hace falta la hora de
       * pared, así que se le suma. Restarle un número relativo a `ahora()`
       * daba diferencias de días y nada se veía nunca: lo encontró
       * `mesa-red.mjs`, con cuatro revelaciones en cero.
       */
      const desde = i.aplicadoEn
        ?? (i.aplicadoAlLlegar ? ventana.abiertaEn + i.llegada : ventana?.resueltaEn);
      if (desde != null) horas.set(clave, desde);
    }
    return horas;
  }

  /**
   * Cuándo hay que tapar la primera carta que se destape. (Etapa 3b/3)
   *
   * Sólo las que todavía están expuestas: una hora ya pasada no es un plazo.
   * Eso es lo que impide que `taparExpuestas` se cumpla dos veces y vuelva a
   * publicar para siempre.
   */
  function finDeExposicion(partida, t) {
    const horas = [...horasDeExposicion(partida).values()]
      .map((desde) => desde + MS_REVELACION)
      .filter((hasta) => hasta > t);
    return horas.length ? Math.min(...horas) : null;
  }

  /**
   * Cuándo se le acaba el tiempo al primero que debe una carta. (Etapa 3b/3)
   *
   * Acertarle a un rival obliga a elegir qué carta se entrega, y para eso hay
   * cinco segundos más la gracia: `entregaHasta`. Pasados, la carta sale al
   * azar, que es lo que el reglamento dice.
   *
   * Ese plazo existía y no era un cronómetro de reflejos: era el cierre de la
   * ventana el que lo esperaba, por `venceEn`. Al irse el cierre por tiempo
   * se fue con él, y la entrega quedaba pendiente hasta que alguien tirara —
   * un turno entero con la carta del rival todavía en su mano y la del
   * atacante todavía en la suya, cuando la regla ya la había resuelto.
   *
   * A diferencia de la exposición, acá no hace falta filtrar las horas ya
   * pasadas: cumplir el plazo RESUELVE la entrega, así que al golpe siguiente
   * ya no está en la lista y no se puede cumplir dos veces.
   */
  function finDeEntregas(partida) {
    if (!partida.ventana || partida.ventana.cerrada) return null;
    const horas = entregasPendientes(partida.ventana)
      .map((i) => i.entregaHasta)
      .filter((hasta) => hasta != null);
    return horas.length ? Math.min(...horas) : null;
  }

  /**
   * Escribe el estado maestro y, en la MISMA transacción, la vista recortada
   * de cada jugador. Que vayan juntas es lo que impide que alguien lea una
   * vista de una jugada y el estado de otra.
   *
   * Antes de publicar, cada vista pasa por el detector de filtraciones. Es
   * una red de seguridad cara en líneas y barata en tiempo: si un cambio
   * futuro agrega un campo con cartas, revienta acá y no en producción.
   */
  function publicar(tx, codigo, partida) {
    const { estado, jugadores } = partida;
    partida = {
      ...partida,
      plazo: plazoDePartida(partida, partida.plazo, ahora()),
    };

    const expuestaDesde = horasDeExposicion(partida);
    const t = ahora();
    const sigueExpuesta = (indiceJugador, posicion) => {
      const desde = expuestaDesde.get(`${indiceJugador}:${posicion}`);
      return desde != null && t - desde < MS_REVELACION;
    };

    jugadores.forEach((uid, indice) => {
      const vista = vistaDe(estado, indice, sigueExpuesta);
      const fugas = filtracionesEn(vista, estado);
      if (fugas.length) {
        throw error("internal", `La vista de un jugador filtraba cartas: ${fugas.join("; ")}`);
      }
      tx.set(refVista(codigo, uid), {
        ...vista,
        version: partida.version,
        ventana: resumenDeVentana(partida.ventana),

        // El plazo, para que el jugador VEA lo que le queda.
        //
        // Lo decide el servidor y lo sigue decidiendo el servidor: esto no
        // le da al navegador ninguna autoridad sobre el tiempo, le da la
        // cuenta que ya estaba corriendo sin que nadie se la mostrara. En
        // entrenamiento esa cuenta se ve desde siempre; en una partida por
        // Leyendas el jugador se quedaba pensando y lo pasaban sin aviso.
        //
        // No lleva cartas —fase, marca, vencimiento y qué hacer— así que no
        // hay nada que redactar. `filtracionesEn` ya corrió sobre `vista`.
        plazo: partida.plazo ?? null,
        ausentes: partida.ausentes ?? [],
        // La otra lista de ausentes, y NO mezclada con la de arriba: ver
        // `ausentesPorTiempo` en `transicion`. La mesa dibuja a los de las dos
        // como ausentes, pero sólo ésta ofrece «he vuelto».
        ausentesPorTiempo: partida.ausentesPorTiempo ?? [],
        // Mientras la primera ronda espera a que lleguen todos: cuántos van.
        // Sólo la cuenta, que es lo que la mesa muestra.
        esperando: partida.esperandoLlegadas
          ? { llegaron: (partida.llegadas ?? []).length, total: partida.jugadores.length }
          : null,
        abandonaron: partida.abandonaron ?? [],
        actualizado: marcaDeTiempo(),
      });
    });

    // Se comprueba en cada escritura, no sólo en las pruebas: un estado no
    // serializable llegaría a Firestore mutilado y en silencio.
    tx.set(refPartida(codigo), {
      ...partida,
      estado: comprobarSerializable(estado),
      actualizado: marcaDeTiempo(),
    });
  }

  /**
   * Lo que el cliente necesita saber de la ventana, sin los intentos ajenos.
   *
   * Los intentos de los demás NO viajan: saber que otro ya descartó, y en qué
   * posición, es información que en la mesa de verdad no se tiene hasta que
   * se resuelve.
   */
  function resumenDeVentana(ventana) {
    if (!ventana) return null;
    return {
      id: ventana.id,
      abiertaEn: ventana.abiertaEn,
      duracionMs: ventana.duracionMs,
      graciaMs: ventana.graciaMs,
      cerrada: ventana.cerrada,
    };
  }

  // -------------------------------------------------------------- plazos

  /**
   * Cuándo vence lo que la partida está esperando.
   *
   * ACÁ ESTÁ LA AUTORIDAD DEL TIEMPO. El plazo se guarda en la partida, con el
   * reloj del servidor, y desde ese momento existe independientemente de que
   * haya alguien mirando. Los clientes sólo golpean la puerta con
   * `avanzarPartida`; no pueden hacer que el tiempo pase ni que no pase.
   *
   * `marca` es lo que distingue un plazo de otro dentro de la misma fase. Sin
   * ella, cada publicación —un latido, por ejemplo— recalcularía `hasta` y el
   * reloj de turno no se agotaría nunca: bastaría con respirar para congelar
   * la partida.
   */
  /**
   * ¿El que tiene el turno está marcado como ausente por tiempo?
   *
   * Sólo la lista nueva. Los ausentes por SILENCIO ya tienen su rescate
   * —`saltarAusente`— y mezclarlos acá haría que un mismo jugador fuera
   * salteado por dos caminos a la vez.
   */
  const turnoDeUnAusente = (partida) =>
    (partida.ausentesPorTiempo ?? []).includes(partida.jugadores?.[partida.estado?.indiceTurno]);

  /**
   * El plazo de una partida, con TODO lo que hace falta saber de ella.
   *
   * Existe para que los dos llamadores no puedan pasar datos distintos. Ya
   * pasó una vez: el segundo se olvidó de `cerrada`, calculó un plazo de cierre
   * para una partida cerrada, se creyó desfasado y republicó en cada golpe,
   * para siempre. Con un dato nuevo —el ausente en turno— la misma trampa
   * volvía a estar servida, así que en vez de acordarse en dos lugares se
   * pregunta en uno.
   */
  /**
   * El plazo vigente: el de la fase, salvo que haya que tapar algo antes.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * POR QUÉ LA EXPOSICIÓN NECESITA UN PLAZO PROPIO (Etapa 3b/3)
   * ─────────────────────────────────────────────────────────────────────────
   *
   * La vista ya filtra cada carta expuesta por su hora, en `publicar`. Pero
   * filtrar no alcanza, porque filtrar pasa AL PUBLICAR: si en esos dos
   * segundos nadie publica nada, la última vista que el cliente recibió —con
   * la carta adentro— sigue siendo la que tiene, y la carta se queda a la
   * vista hasta la próxima publicación. Con los cuatro jugadores quietos, esa
   * próxima publicación es el salto de turno: ocho segundos en vez de dos.
   *
   * Antes esto lo cubría `cerrarRevelacion`, que era un plazo de verdad. Se
   * fue con los cronómetros de reflejos y hay que devolverlo, porque NO era
   * uno de ellos: no cierra ninguna ventana, no resuelve ningún intento y no
   * corta nada. Es la duración de un castigo de información, y es la que el
   * reglamento publica.
   *
   * Son dos los plazos que ya no dependen de la fase —tapar lo expuesto y
   * resolver la entrega que nadie eligió— y los dos son castigos con duración
   * publicada, no cronómetros de reflejos.
   *
   * Gana el que vence primero. Un empate se lo queda la fase, que es la que
   * mueve la mesa: tapar puede esperar un milisegundo, repartir no.
   */
  const plazoDePartida = (partida, previo, t) => {
    const deLaFase = plazoDe(partida.estado, partida.ventana, previo, t, {
      cerrada: Boolean(partida.cerrada),
      ausenteEnTurno: turnoDeUnAusente(partida),
      esperandoDesde: partida.esperandoLlegadas ? partida.esperandoDesde : null,
    });

    const sueltos = [
      { que: "resolverEntregas", hasta: finDeEntregas(partida) },
      { que: "taparExpuestas", hasta: finDeExposicion(partida, t) },
    ].filter((x) => x.hasta != null).sort((a, b) => a.hasta - b.hasta);

    const primero = sueltos[0];
    if (!primero) return deLaFase;
    if (deLaFase && deLaFase.hasta <= primero.hasta) return deLaFase;

    const marca = `${primero.que}-${primero.hasta}`;
    if (previo && previo.que === primero.que && previo.marca === marca) return previo;
    return { fase: partida.estado.fase, marca, hasta: primero.hasta, que: primero.que };
  };

  function plazoDe(
    estado, ventana, previo, ahoraMs,
    { cerrada = false, ausenteEnTurno = false, esperandoDesde = null } = {},
  ) {
    const nuevo = (fase, marca, hasta, que) => {
      // Mismo plazo que ya estaba: se conserva su vencimiento original.
      if (previo && previo.fase === fase && previo.marca === marca) return previo;
      return { fase, marca, hasta, que };
    };

    switch (estado.fase) {
      case "mirar":
        /**
         * Esperando a que lleguen todos: el único plazo es el tope.
         *
         * Sin este caso, la línea de abajo calculaba «cerrar la mirada dentro
         * de dos segundos» con una ventana que todavía no existe —el `??
         * ahoraMs`—, y la primera ronda se habría saltado entera. Su marca es
         * otra que la de la mirada, así que cuando la ventana abre se calcula
         * un plazo nuevo en vez de heredar éste.
         */
        if (esperandoDesde != null) {
          return nuevo("mirar", `llegadas-r${estado.ronda}`,
                       esperandoDesde + MS_ESPERA_LLEGADAS, "abrirPrimeraRonda");
        }
        // Los siete segundos —cinco para elegir, dos para ver— se cuentan
        // desde que abrió la ventana, no desde este golpe: si no, una
        // publicación posterior recortaría la mirada.
        return nuevo("mirar", `r${estado.ronda}`,
                     (ventana?.abiertaEn ?? ahoraMs) + MS_MIRADA_TOTAL, "cerrarMirada");

      case "descarte":
        /*
         * LOS REFLEJOS YA NO TIENEN RELOJ. (Etapa 3b/3)
         *
         * Acá vivían los dos cronómetros que se fueron:
         *
         *   - `cerrarVentana`, que vencía a los 2 s de la ronda o a los 3 de
         *     una reapertura. Ahora la ventana dura lo que dure la MUESTRA: la
         *     cierra el que tira, en `accionDeTurno`. Pasar el turno NO la
         *     cierra, porque la muestra sigue siendo la misma.
         *
         *   - `cerrarRevelacion`, que mantenía la fase en `descarte` dos
         *     segundos más para que se vieran las cartas expuestas. Con los
         *     descartes aplicándose al llegar no hay nada que revelar después:
         *     se vio cuando pasó.
         *
         * Lo único que queda es abrir la ventana si todavía no existe. Y en
         * cuanto existe, `seguirConLaVentanaAbierta` devuelve el turno, así
         * que esta rama deja de visitarse: el plazo pasa a ser el del turno,
         * que es externo a los reflejos y no se tocó.
         */
        if (!ventana) {
          return nuevo("descarte", `abrir-r${estado.ronda}`, ahoraMs, "abrirVentana");
        }
        /*
         * Con la ventana abierta, el turno arranca YA.
         *
         * Vence en `ahoraMs`, igual que el plazo del ausente en turno: el
         * golpe siguiente lo encuentra vencido, y la mesa golpea varias veces
         * por segundo.
         *
         * Va por acá y no sólo en los sitios que abren la ventana, porque hay
         * un camino que no pasa por ninguno: la ventana de la RONDA la crea
         * `repartir`, antes de la mirada. Cuando la mirada termina, la fase
         * entra en `descarte` con la ventana YA creada, así que `abrirVentana`
         * no dispara nunca. Sin esta rama la mesa se queda ahí para siempre, y
         * eso lo encontró `barrido.mjs`.
         */
        return nuevo("descarte", `seguir-${ventana.id}`, ahoraMs, "seguirTurno");

      case "turno":
        /**
         * Un ausente por tiempo no se espera: se lo saltea ya.
         *
         * Es la regla: «los demás no pierden tiempo esperando». Si la marca
         * sólo se viera, los otros tres esperarían los ocho segundos de
         * levantar, los diez de decidir y los veinte de cortar, en CADA turno
         * suyo, por alguien que ya demostró que no está.
         *
         * `ahoraMs` y no un número: el golpe siguiente lo encuentra vencido.
         * La mesa golpea cada menos de un segundo, así que en la práctica es
         * inmediato — y sigue pasando por el mismo camino que cualquier otro
         * plazo, sin un atajo aparte que haya que mantener.
         *
         * La MARCA lleva `-ausente` y no es un detalle. `nuevo()` conserva el
         * vencimiento de un plazo si la marca no cambió; sin esto, apretar «he
         * vuelto» un instante antes del golpe dejaría vivo este plazo
         * inmediato y lo saltearían igual. Con la marca distinta, al volver se
         * calcula uno nuevo de ocho segundos.
         */
        if (ausenteEnTurno) {
          return nuevo("turno", `t${estado.turnosRonda}-${estado.indiceTurno}-ausente`,
                       ahoraMs, "saltarTurno");
        }
        // El reloj corre por turno, no por publicación.
        return nuevo("turno", `t${estado.turnosRonda}-${estado.indiceTurno}`,
                     ahoraMs + MS_TURNO, "saltarTurno");

      case "finRonda":
        return nuevo("finRonda", `r${estado.ronda}`, ahoraMs + MS_ENTRE_RONDAS, "siguienteRonda");

      case "finPartida":
        // Una partida terminada NO es un estado final: falta repartir el pozo.
        // Que este caso devolviera `null` —cayendo en el `default`— es lo que
        // dejaba la partida viva para siempre, con las entradas cobradas y el
        // pozo retenido, esperando a alguien que nunca iba a llamar.
        //
        // El plazo es corto pero no cero: son los segundos en que los cuatro
        // jugadores ven el resultado antes de que la sala se cierre. Y una vez
        // cerrada vuelve a ser `null`, porque ahí sí no queda nada que hacer.
        if (cerrada) return null;
        return nuevo("finPartida", `r${estado.ronda}`, ahoraMs + MS_ANTES_DE_CERRAR, "cerrarPartida");

      case "postLevantada":
        // `saltarAusente` no cubre este caso y por eso hace falta el plazo.
        // Aquél mide SILENCIO: pide 15 segundos sin latidos. Alguien que dejó
        // la pestaña abierta y se fue a hacer otra cosa sigue latiendo, así
        // que nunca cuenta como ausente, y la mesa se queda esperándolo sin
        // que nada la destrabe. Los otros tres no pueden hacer nada.
        //
        // La marca lleva el turno, no la ronda: en una ronda me toca decidir
        // varias veces, y con `r${estado.ronda}` la segunda heredaría el
        // vencimiento de la primera y pasaría de inmediato.
        return nuevo("postLevantada", `t${estado.turnosRonda}-${estado.indiceTurno}`,
                     ahoraMs + MS_PASO_AUTOMATICO, "pasarPorTiempo");

      /**
       * Levantada y poderes: diez segundos para decidir.
       *
       * ───────────────────────────────────────────────────────────────────
       * ESTAS FASES NO TENÍAN RELOJ, Y ERA UN ERROR
       * ───────────────────────────────────────────────────────────────────
       *
       * El razonamiento viejo era que el que levantó una carta o usó un poder
       * TIENE la carta y va a hacer algo con ella, así que no deja a nadie
       * esperando. Eso vale en una mesa de living. En red no: quien se levanta
       * con una carta en la mano congela la partida de los otros tres, y
       * `saltarAusente` no lo rescata —aquél mide SILENCIO, quince segundos
       * sin latidos, y una pestaña abierta late igual.
       *
       * ───────────────────────────────────────────────────────────────────
       * LA MARCA LLEVA EL TURNO, NO LA RONDA
       * ───────────────────────────────────────────────────────────────────
       *
       * Es el mismo error que ya documenta `postLevantada` unas líneas arriba:
       * en una ronda me toca decidir varias veces, y con `r${estado.ronda}` la
       * segunda heredaría el vencimiento de la primera y pasaría de inmediato.
       *
       * ───────────────────────────────────────────────────────────────────
       * Y ARRANCA CUANDO LEVANTA, NO CUANDO EMPEZÓ EL TURNO
       * ───────────────────────────────────────────────────────────────────
       *
       * `ahoraMs + msDeLaDecision(fase)`, contado desde este golpe. El turno
       * dura ocho segundos y la levantada decide en otros ocho, así que
       * levantar con dos segundos de turno restante NO deja dos segundos para
       * decidir: deja ocho, y el turno completo puede llegar a dieciséis. El
       * plazo es de la decisión, no lo que sobra del turno.
       *
       * Qué pasa al vencer sale de `decisionQueVence`, en `reglas/red.js`: con
       * una carta levantada se descarta —es la única jugada posible— y con un
       * poder se salta, porque elegir con qué carta cambia el 9 sería jugar por
       * otro.
       */
      default: {
        const decision = decisionQueVence(estado.fase);
        if (!decision) return null;
        return nuevo(estado.fase, `t${estado.turnosRonda}-${estado.indiceTurno}`,
                     ahoraMs + msDeLaDecision(estado.fase), decision);
      }
    }
  }

  // ---------------------------------------------------------- validación

  function exigirPartida(snap, codigo) {
    if (!snap.exists) throw error("not-found", `No encontramos la partida ${codigo}.`);
    return snap.data();
  }

  function exigirJugador(partida, uid) {
    const indice = partida.jugadores.indexOf(uid);
    if (indice < 0) throw error("permission-denied", "No estás jugando esta partida.");
    if ((partida.abandonaron ?? []).includes(uid)) {
      throw error("failed-precondition", "Abandonaste esta partida.");
    }
    if (partida.estado.jugadores[indice]?.eliminado) {
      throw error("failed-precondition", "Quedaste eliminado de esta partida.");
    }
    return indice;
  }

  /**
   * Posiciones y objetivos dentro de rango.
   *
   * `usarPoderCambio` no comprueba los índices: si le llega una posición que
   * no existe, mete `undefined` dentro de una mano y la partida queda con una
   * carta fantasma. En la mesa local eso no podía pasar porque las posiciones
   * salían de un clic sobre una carta dibujada; acá llegan por la red y hay
   * que comprobarlas.
   */
  function exigirPosiciones(partida, indice, accion, { posicion, objetivo }) {
    const manoDe = (i) => partida.estado.jugadores[i]?.mano;
    const enRango = (i, pos) =>
      Number.isInteger(pos) && pos >= 0 && pos < (manoDe(i)?.length ?? 0);

    if (accion === ACCIONES.MIRAR || accion === ACCIONES.CAMBIAR) {
      if (!enRango(indice, posicion)) {
        throw error("invalid-argument", "Esa posición no existe en tu mano.");
      }
    }

    // La segunda mitad del 10 la decide QUIEN lo uso, no quien tenga el turno.
    // Son la misma persona hoy, pero atar el permiso al turno seria confiar en
    // una coincidencia: si manana el turno pudiera moverse durante la
    // decision, el cambio lo resolveria otro.
    if (accion === ACCIONES.RESOLVER_CAMBIO) {
      const pendiente = partida.estado.cambioPendiente;
      if (!pendiente || pendiente.indiceJugador !== indice) {
        throw error("permission-denied", "Ese cambio no es tuyo.");
      }
    }

    if (accion === ACCIONES.PODER_MIRAR || accion === ACCIONES.PODER_CAMBIO) {
      const poder = partida.estado.poderPendiente;
      // El poder es de quien lo levantó, y de nadie más. `usarPoderCambio`
      // toma al dueño del poder como sujeto sin mirar quién llamó, así que si
      // esto no estuviera, un jugador podría disparar el poder de otro.
      if (!poder || poder.indiceJugador !== indice) {
        throw error("permission-denied", "Ese poder no es tuyo.");
      }
      const otro = objetivo?.indice;
      if (!Number.isInteger(otro) || otro < 0 || otro >= partida.jugadores.length) {
        throw error("invalid-argument", "Ese jugador no está en la partida.");
      }
      if (partida.estado.jugadores[otro]?.eliminado) {
        throw error("failed-precondition", "Ese jugador ya no está en juego.");
      }
      if (accion === ACCIONES.PODER_MIRAR && !enRango(otro, posicion)) {
        throw error("invalid-argument", "Esa posición no existe.");
      }
      if (accion === ACCIONES.PODER_CAMBIO) {
        if (!enRango(indice, posicion)) {
          throw error("invalid-argument", "Esa posición no existe en tu mano.");
        }
        if (!enRango(otro, objetivo?.posicion)) {
          throw error("invalid-argument", "Esa posición no existe en la mano del otro.");
        }
      }
    }
  }

  /**
   * Ventana de una ronda: se abre con la mirada y dura hasta el final del
   * descarte.
   *
   * Va acá y no en un plazo `abrirVentana` a propósito. Si la abriera un golpe
   * posterior, `abiertaEn` sería el momento de ese golpe —hasta 900 ms
   * después, que es cada cuánto golpean los clientes— y la mirada perdería esa
   * porción de sus dos segundos.
   */
  const ventanaDeRonda = (t) =>
    crearVentana({ id: `v_${idAleatorio()}`, abiertaEn: t, duracionMs: MS_VENTANA_TOTAL });

  /**
   * ACÁ ESTABA `reabreDescarte`. (Etapa 3b/3)
   *
   * Preguntaba si el motor había abierto una ventana que la red no tenía, y
   * la segunda mitad de la pregunta era «y la de la red ya se cerró». Eso era
   * cierto porque la ventana se cerraba por su propio reloj a los 2 s, mucho
   * antes de que nadie pudiera tirar. Sin reloj es siempre falso: la vieja
   * sigue abierta, y no se abriría nunca ninguna nueva.
   *
   * Lo reemplazan las dos funciones de abajo, que además hacen lo que aquélla
   * no hacía: resolver lo que la ventana vieja dejó pendiente.
   */

  /**
   * uid → índice en la mesa, o `null` si no juega.
   *
   * Estaba copiada en cuatro sitios con el mismo cuerpo. Se unifica ahora
   * porque los dos lugares nuevos la necesitaban y habrían sido seis.
   */
  const indiceDeEn = (partida) => (uid) => {
    const i = partida.jugadores.indexOf(uid);
    return i < 0 ? null : i;
  };

  /**
   * Lo que la ventana abierta deja resuelto ANTES de cambiar la muestra.
   *
   * Devuelve `null` si no hay ventana abierta. Se llama antes de tirar y no
   * después, y eso no es un detalle de orden: `intentarDescarteRival` vuelve a
   * comparar la carta contra la muestra, así que un acierto pendiente
   * resuelto después del tiro se convertiría en error contra una muestra que
   * ya cambió.
   */
  function antesDeCambiarLaMuestra(partida, t) {
    if (!partida.ventana || partida.ventana.cerrada) return null;
    return cerrarReflejos(partida.estado, partida.ventana, indiceDeEn(partida), t);
  }

  /**
   * La ventana y la fase que quedan después de una jugada que cambia la muestra.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * TRES CAMINOS, UNA SOLA REGLA
   * ─────────────────────────────────────────────────────────────────────────
   *
   * Son tres los lugares donde la muestra cambia, y dos de ellos los juega el
   * SERVIDOR por alguien que no está:
   *
   *   - `accionDeTurno`, cuando alguien tira o cambia una carta;
   *   - `descartarPorTiempo`, cuando se le acaban los diez segundos de la
   *     levantada;
   *   - `saltarAusente`, cuando lleva quince segundos sin dar señales.
   *
   * Los dos últimos no tocaban la ventana y funcionaban igual, de rebote: la
   * vieja ya se había cerrado por su reloj y `abrirVentana` creaba la
   * siguiente en el golpe de después. Sin ese reloj dejaron de funcionar, y en
   * silencio — que es lo peor que podían hacer: la ventana vieja seguía
   * abierta sobre una muestra que ya no estaba, así que un reflejo con su id
   * se evaluaba contra la nueva y el que acertaba se comía un castigo.
   *
   * `abreReflejos` se lee del MOTOR, no de la acción: si abrió su ventana de
   * descarte, hay muestra nueva. Y si no abrió ninguna —porque la jugada
   * terminó la ronda— la vieja queda cerrada, porque ya no hay a qué
   * reaccionar.
   */
  function trasCambiarLaMuestra(partida, resuelto, estado, t) {
    const abreReflejos = estado.fase === "descarte" && Boolean(estado.ventanaDescarte);
    if (!abreReflejos) {
      return { estado, ventana: resuelto?.ventana ?? partida.ventana };
    }
    return {
      /*
       * Y con la ventana abierta, la fase vuelve al turno.
       *
       * Es la pieza que trajo 3a. Sin esto la mesa se traba: la ventana no se
       * cierra por tiempo, y mientras la fase sea `descarte` el siguiente no
       * puede levantar, así que nadie llegaría nunca a tirar para cerrarla.
       */
      estado: motor.seguirConLaVentanaAbierta(estado),
      ventana: crearVentana({
        id: `v_${idAleatorio()}`,
        abiertaEn: t,
        duracionMs: duracionDeVentana(estado),
      }),
    };
  }

  /**
   * Cuánto dura la ventana que corresponde abrir ahora.
   *
   * No son todas iguales. La del principio de la ronda dura 5 s: se viene de
   * memorizar una sola carta y hay que buscar en cuatro manos. Las que abren
   * tirar y cambiar duran 2: la mesa ya está mirando la muestra y sólo tiene
   * que reaccionar al número nuevo, y encima ocurren varias veces por ronda.
   *
   * Se distinguen por `volverA`, que es la marca que el motor ya le pone a las
   * reaperturas para saber adónde devolver el turno: la de la ronda no lo
   * lleva —desemboca en `turno`— y las otras sí. Preguntárselo al estado es
   * más seguro que confiar en desde qué línea se llamó, porque los dos sitios
   * genéricos de abajo abren tanto una como la otra.
   */
  const duracionDeVentana = (estado) =>
    estado?.ventanaDescarte?.volverA ? MS_VENTANA_REAPERTURA : MS_VENTANA;

  function exigirFase(partida, accion) {
    const esperada = FASE_DE[accion];
    if (!esperada) throw error("invalid-argument", "Acción desconocida.");

    /*
     * Descartar lo autoriza la VENTANA, no la fase. (Etapa 3b/3)
     *
     * Es la misma regla que 3a llevó al motor, y acá tiene que valer igual:
     * en red la ventana queda abierta mientras el siguiente juega su turno,
     * así que exigir `fase === "descarte"` rechazaría todos los reflejos con
     * un «la partida está en "turno"».
     *
     * El motor sigue teniendo la última palabra: `intentarDescarte` comprueba
     * la ventana por su cuenta y no aplica nada sin ella.
     */
    if (accion === ACCIONES.DESCARTAR) {
      // La mirada sigue valiendo aparte: ahí todavía NO hay ventana —la abre
      // `terminarMirada`— y descartar durante la mirada es legal desde
      // siempre. Pedir sólo la ventana rompía ese caso, y lo encontraron
      // `mirar-descarte.mjs` y `llegada-sellada.mjs`.
      if (partida.estado.fase === "mirar" || partida.estado.ventanaDescarte) return;
      throw error("failed-precondition", "La ventana de descarte ya se cerró.");
    }

    const validas = Array.isArray(esperada) ? esperada : [esperada];
    if (!validas.includes(partida.estado.fase)) {
      throw error(
        "failed-precondition",
        `Eso no se puede hacer ahora: la partida está en "${partida.estado.fase}".`,
      );
    }
  }

  // ------------------------------------------------------------ reparto

  /**
   * La primera ronda empieza: se abre su ventana, con la cuenta por delante.
   *
   * `abiertaEn` queda en el FUTURO, al terminar la cuenta regresiva. Las
   * cuatro pantallas dibujan «3, 2, 1, Preparate…» contra esa hora, así que
   * empiezan a mirar en el mismo instante; y todo lo que llegue antes —una
   * mirada, un descarte— cae fuera de la ventana y se rechaza solo.
   */
  const abrirPrimeraRonda = (partida, t) => ({
    ...partida,
    esperandoLlegadas: false,
    ventana: ventanaDeRonda(t + MS_CUENTA_REGRESIVA),
  });

  /**
   * ¿Llegaron todos los que siguen en la partida?
   *
   * Los que abandonaron no cuentan: esperar a quien ya se fue sería esperar al
   * tope siempre.
   */
  const llegaronTodos = (partida) => {
    const idos = partida.abandonaron ?? [];
    const llegadas = partida.llegadas ?? [];
    return partida.jugadores.every((uid) => idos.includes(uid) || llegadas.includes(uid));
  };

  /**
   * Reparto DENTRO de una transacción que ya está abierta.
   *
   * Existe separado de `repartir` porque `iniciarPartida` tiene que cobrar la
   * entrada y crear la partida en la MISMA transacción. Si fueran dos, una
   * partida podría quedar iniciada sin documento maestro —o al revés— y no
   * habría forma de saber cuál de las dos cosas pasó.
   */
  async function repartirEn(
    tx, { codigo, jugadores, nombres, luce, limitePuntos, juego, yaSentados = false },
  ) {
    const snap = await tx.get(refPartida(codigo));
    // Idempotente: repartir dos veces la misma partida no la reinicia.
    if (snap.exists) return { codigo, yaExistia: true, version: snap.data().version };

    // El retrato se fija ACÁ y no se vuelve a mirar.
    //
    // Queda dentro del estado de la partida, igual que el nombre, así que si
    // alguien se cambia el avatar a mitad de la mesa los demás siguen viendo
    // la cara con la que se sentó. Es lo que corresponde: una partida en
    // curso no puede cambiar de aspecto debajo de quien la está mirando.
    const configuracion = jugadores.map((uid, i) => ({
      id: uid,
      nombre: nombres?.[i] ?? `Jugador ${i + 1}`,
      retrato: luce?.[i]?.retrato ?? null,
      dorso: luce?.[i]?.dorso ?? null,
      insignia: luce?.[i]?.insignia ?? null,
      marco: luce?.[i]?.marco ?? null,
      titulo: luce?.[i]?.titulo ?? null,
      esIA: false,
    }));

    const t = ahora();
    const partida = {
      codigo,
      jugadores,
      // De qué juego es. Lo dice la sala: ver `reglas/juegos.js`. Hoy todo es
      // Memorie; el campo existe para que un segundo juego no obligue a
      // reescribir las partidas ni a adivinar de qué eran las viejas.
      juego: juego ?? JUEGO_POR_DEFECTO,
      /**
       * La semilla la elige el SERVIDOR, y la duración sale de la sala.
       *
       * Si la semilla la mandara el cliente, podría probar semillas hasta dar
       * con un reparto que le convenga. Y el límite se vuelve a comprobar acá
       * aunque ya lo haya validado quien creó la sala: esta función es la que
       * arma el estado, y un valor raro en el documento dejaría una partida
       * que no termina nunca o que elimina a todos en la primera ronda.
       */
      estado: motor.empezarRonda(motor.crearPartida(configuracion, {
        semilla: semillaDe(),
        limitePuntos: motor.esLimiteDePartida(limitePuntos)
          ? Number(limitePuntos)
          : motor.LIMITE_ELIMINACION,
      })),

      /**
       * La ventana NO nace con el reparto: nace cuando llegan todos.
       *
       * ───────────────────────────────────────────────────────────────────
       * EL BUG QUE ESTO ARREGLA
       * ───────────────────────────────────────────────────────────────────
       *
       * Nacía acá, y la primera mirada dura dos segundos. Pero quien reparte
       * es la SALA: los jugadores todavía tienen que redirigirse, cargar la
       * mesa y abrir la sesión, y en producción eso llevó unos seis segundos.
       * El primero en llegar golpeaba al entrar, el servidor encontraba la
       * mirada vencida y la cerraba, y el toque para mirar rebotaba con un
       * 400. Nadie veía su primera carta.
       *
       * Ahora la partida arranca esperando. `latir` anota quién llegó, y
       * cuando llega el último se abre la ventana, con la cuenta regresiva
       * por delante. Si alguien no llega nunca, el plazo de
       * `MS_ESPERA_LLEGADAS` la abre igual.
       *
       * ───────────────────────────────────────────────────────────────────
       * POR QUÉ LAS LLEGADAS VAN APARTE Y NO EN LOS LATIDOS
       * ───────────────────────────────────────────────────────────────────
       *
       * Sería lo más corto: arrancar los latidos en cero y considerar llegado
       * al que latió una vez. Y destruiría todas las partidas nuevas.
       * `vaciarMesaDesierta` mira el latido MÁS RECIENTE de los que siguen, y
       * con todos en cero el silencio sería enorme: el barredor —que pasa cada
       * minuto— daría por abandonada cada mesa recién creada. Los latidos
       * siguen arrancando con la hora del reparto, y eso le da a una mesa que
       * espera los mismos diez minutos de gracia que tenía siempre.
       *
       * ───────────────────────────────────────────────────────────────────
       * `yaSentados`
       * ───────────────────────────────────────────────────────────────────
       *
       * Es el comportamiento de antes: la ventana abre en el acto, sin cuenta.
       * Sirve para las pruebas que no miran el arranque y parten de una mesa
       * con todos sentados. `iniciarPartida` NO lo pasa —nadie está sentado
       * cuando se reparte— y `pruebas/primera-ronda.mjs` lo vigila, porque
       * olvidarlo allá es exactamente el bug de arriba.
       */
      ...(yaSentados
        ? { ventana: ventanaDeRonda(t), esperandoLlegadas: false, llegadas: [...jugadores] }
        : { ventana: null, esperandoLlegadas: true, llegadas: [], esperandoDesde: t }),
      latidos: Object.fromEntries(jugadores.map((uid) => [uid, t])),
      ausentes: [],
      ausentesPorTiempo: [],
      abandonaron: [],
      version: 1,
      creada: marcaDeTiempo(),
    };

    publicar(tx, codigo, partida);
    return { codigo, yaExistia: false, version: 1 };
  }

  const repartir = (datos) => db.runTransaction((tx) => repartirEn(tx, datos));

  // ------------------------------------------------------- ventana

  /**
   * Abre la ventana de reflejos. La abre el SERVIDOR, con su reloj, y el
   * identificador es impredecible: es la semilla del desempate.
   */
  async function abrirVentana({ codigo }) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(refPartida(codigo));
      const partida = exigirPartida(snap, codigo);

      /*
       * Primero lo idempotente, después la fase. (Etapa 3b/3)
       *
       * El orden estaba al revés y dejó de servir: con una ventana que vive
       * mientras vive la muestra, la fase ya está en el turno del siguiente
       * mientras los reflejos siguen abiertos. Preguntar por la fase antes
       * contestaba «la partida no está en fase de descarte» a quien pedía una
       * ventana que estaba ahí, abierta. Lo encontró `orquestador.mjs`.
       *
       * La guarda de fase se queda, y se queda para lo único que le toca:
       * CREAR una ventana donde no hay. Eso sólo tiene sentido con una
       * muestra recién puesta, que es lo que la fase `descarte` significa.
       */
      if (partida.ventana && !partida.ventana.cerrada) {
        return { ventana: resumenDeVentana(partida.ventana), yaEstaba: true };
      }
      if (partida.estado.fase !== "descarte") {
        throw error("failed-precondition", "La partida no está en fase de descarte.");
      }

      const ventana = crearVentana({
        id: `v_${idAleatorio()}`,
        abiertaEn: ahora(),
        duracionMs: duracionDeVentana(partida.estado),
      });

      const siguiente = { ...partida, ventana, version: partida.version + 1 };
      publicar(tx, codigo, siguiente);
      return { ventana: resumenDeVentana(ventana), yaEstaba: false };
    });
  }

  /**
   * Anota un intento de descarte. NO resuelve: sólo lo guarda.
   *
   * Que no resuelva es la decisión central del diseño. Si resolviera acá,
   * "el primero" sería el primero en llegar, y ganaría siempre la mejor
   * conexión. Se junta todo y se ordena al cerrar.
   */
  async function intentarDescarte({
    uid, codigo, windowId, posicion, clientActionId, declarado, latencia, incertidumbre,
    objetivo = null, posicionEntrega = null,
  }) {
    /**
     * La llegada se sella ACÁ, antes de cualquier espera.
     *
     * ─────────────────────────────────────────────────────────────────────
     * DÓNDE SE LEÍA ANTES, Y QUÉ LE SUMABA
     * ─────────────────────────────────────────────────────────────────────
     *
     * Se leía dentro de la transacción, después de `tx.get`. Todo lo que pasa
     * hasta ese punto quedaba cargado a la cuenta del jugador, que no tiene
     * ningún control sobre ello:
     *
     *   - La primera conexión con Firestore de una instancia nueva. En los
     *     registros de producción, la primera llamada de cada instancia pasó
     *     unos DOS SEGUNDOS dentro del handler —1963 ms en un descarte real,
     *     que además fue rechazado— y las siguientes, 200 a 290 ms.
     *
     *   - La cola. Cuando varios descartan a la vez, las transacciones chocan
     *     sobre el mismo documento y esperan su turno; cada una tarda ~250 ms.
     *     El cuarto en entrar llegaba con unos 750 ms de más, cinco veces la
     *     incertidumbre típica de sincronización. Esto pasaba TIBIO, sin
     *     ningún arranque en frío: el que pierde es el que tuvo mala suerte en
     *     la cola, no el más lento.
     *
     *   - Cada reintento de la transacción, que volvía a leer la hora, más
     *     tarde.
     *
     * Con 2 s de gracia y el piso del tiempo efectivo empujado por esa llegada
     * inflada, un toque a tiempo terminaba rechazado o contado segundos más
     * tarde de lo que fue.
     *
     * ─────────────────────────────────────────────────────────────────────
     * POR QUÉ ES SEGURO
     * ─────────────────────────────────────────────────────────────────────
     *
     * La hora de entrada al handler nunca es ANTERIOR a la llegada real del
     * pedido: el handler corre después de que el pedido llegó. Así que esto no
     * le acredita a nadie un tiempo que no tuvo — sólo deja de cobrarle uno que
     * no era suyo. La garantía del protocolo sigue intacta: mentir no da
     * ventaja. Ver PROTOCOLO-REFLEJOS.md.
     *
     * Lo que NO corrige: el arranque del contenedor, que ocurre antes de que
     * exista este handler. Eso lo reduce `calentar`, y lo resuelve de raíz que
     * el toque deje de pasar por una función.
     */
    const llegada = ahora();

    return db.runTransaction(async (tx) => {
      const snap = await tx.get(refPartida(codigo));
      const partida = exigirPartida(snap, codigo);
      const indice = exigirJugador(partida, uid);
      exigirFase(partida, ACCIONES.DESCARTAR);

      if (!partida.ventana) throw error("failed-precondition", "No hay ninguna ventana abierta.");

      // ¿Va contra la mano de otro? Todo se deriva del estado maestro: del
      // cliente sólo se aceptan POSICIONES y a quién apunta. Nada de valores,
      // ni de ids, ni de "yo conozco su carta".
      const contraRival = objetivo && objetivo !== uid;
      let indiceObjetivo = indice;

      if (contraRival) {
        indiceObjetivo = partida.jugadores.indexOf(objetivo);
        if (indiceObjetivo < 0) {
          throw error("not-found", "Ese jugador no está en la partida.");
        }
        if (partida.estado.jugadores[indiceObjetivo].eliminado) {
          throw error("failed-precondition", "Ese jugador ya no está en juego.");
        }
        // LA autorización: la da el estado, no el navegador. Es sobre ESA
        // carta: conocer otra de la misma mano no alcanza.
        if (!motor.puedeAtacarEn(partida.estado, indice, indiceObjetivo, posicion)) {
          throw error("permission-denied", "No conocés esa carta.");
        }
        // La carta a entregar ya no viene con el ataque: se elige después, y
        // sólo si acierta. Si viene igual —una pestaña con la mesa de antes—,
        // tiene que ser una carta que exista de verdad.
        if (posicionEntrega != null) {
          const miMano = partida.estado.jugadores[indice].mano;
          if (!Number.isInteger(posicionEntrega) || !miMano[posicionEntrega]) {
            throw error("invalid-argument", "Elegí una carta tuya para entregar.");
          }
        }
      }

      /**
       * El resultado de un ataque se sabe al llegar.
       *
       * La carta del rival es una que el atacante conoce, y la muestra no cambia
       * de número mientras dure la ventana: acertar o no ya está decidido. Se
       * le contesta ahora porque la regla dice que la carta a entregar se elige
       * DESPUÉS de acertar, y nunca al errar.
       *
       * No le dice nada que no sepa: la carta la vio él, y la muestra está a la
       * vista de todos. Lo que sí sigue esperando al cierre es el orden, que es
       * lo que decide quién llegó antes a una carta que conocían dos.
       */
      const evaluado = contraRival
        ? motor.evaluarAtaque(partida.estado, indice, indiceObjetivo, posicion)
        : null;
      if (evaluado === "sinDerecho") {
        // Conoce la carta, así que lo que falta es la ventana: es la que abrió
        // otro con un poder, y ésa es sólo de él.
        throw error("failed-precondition", "Esta ventana es de quien usó el poder.");
      }
      const esperaEntrega = evaluado === "acierto" && posicionEntrega == null;
      const previo = partida.ventana.intentos?.[clientActionId];
      const entregaHasta = previo?.entregaHasta ??
        (esperaEntrega ? llegada + motor.MS_PARA_ENTREGAR + MS_GRACIA_ENTREGA : null);
      const delAtaque = contraRival
        ? { acierta: evaluado === "acierto", ...(entregaHasta != null ? { entregaHasta } : {}) }
        : {};

      const resultado = registrarIntento(
        partida.ventana,
        {
          windowId, clientActionId, uid, posicion, declarado, latencia, incertidumbre,
          objetivo: contraRival ? objetivo : uid,
          posicionEntrega: contraRival ? posicionEntrega : null,
          esperaEntrega,
          entregaHasta,
        },
        {
          // El tiro propio se gasta por MUESTRA, y esta ventana puede ser la
          // segunda sobre la misma: la corta que abre un poder. `registrarIntento`
          // sólo ve la ventana que recibe, así que la otra mitad del dato se la
          // pasa el estado del motor.
          tiroGastado: motor.gastoElTiroDeLaMuestra(partida.estado, indice),
          // La sellada al entrar, no la de ahora: ver arriba. Es la misma en
          // cada reintento de esta transacción.
          ahora: llegada,
          // El rango se mide contra la mano que se toca, no siempre la propia.
          cantidadDeCartas: partida.estado.jugadores[indiceObjetivo].mano.length,
        },
      );

      if (!resultado.ok) {
        throw error("failed-precondition", mensajeDeRechazo(resultado.motivo));
      }
      // Duplicado: se contesta que sí sin escribir nada. Un reintento por una
      // respuesta que se perdió no puede costar una carta de castigo.
      if (resultado.duplicado) {
        return { anotado: true, duplicado: true, version: partida.version, ...delAtaque };
      }

      /**
       * El descarte sobre la mano PROPIA se aplica acá, al llegar. (Etapa 1/3)
       *
       * ─────────────────────────────────────────────────────────────────────
       * QUÉ CAMBIÓ
       * ─────────────────────────────────────────────────────────────────────
       *
       * Antes esto sólo ANOTABA el intento y todo se aplicaba junto al cerrar
       * la ventana, ordenado por tiempo efectivo. Ese ordenamiento existía
       * para que no ganara el de mejor internet en un empate de milisegundos.
       *
       * Se cambió a propósito, con el costo asumido: si dos tocan casi juntos,
       * gana el que llegó primero al servidor. A cambio, el descarte se ve en
       * la mesa en el momento en que ocurre, que es la mitad de lo que hace
       * que esto se sienta un juego de reflejos y no un formulario.
       *
       * Las transacciones de Firestore se serializan sobre el documento de la
       * partida, así que «el orden de llegada» es un orden real y no una
       * carrera: dos descartes simultáneos se aplican uno después del otro,
       * nunca encima.
       *
       * ─────────────────────────────────────────────────────────────────────
       * POR QUÉ SÓLO LA MANO PROPIA, POR AHORA
       * ─────────────────────────────────────────────────────────────────────
       *
       * Porque `motor.intentarDescarte(estado, indice, posicion)` es una sola
       * llamada y no necesita nada más. El ataque a un rival sí: hoy
       * `intentarDescarteRival` aplica ataque Y entrega en la misma llamada, y
       * la entrega se elige DESPUÉS de saber que acertó. Partir eso en dos
       * pasos es la etapa 2; hasta entonces el ataque sigue resolviéndose al
       * cerrar, por `resolverVentana`.
       *
       * `aplicadoAlLlegar` es lo que evita que se aplique dos veces: lo lee
       * `resolverVentana` para saltearlo.
       */
      let estadoNuevo = partida.estado;
      let ventanaNueva = resultado.ventana;

      /*
       * El ataque ERRADO también se aplica al llegar. (Etapa 2/3)
       *
       * Un error no necesita nada más: la carta del rival se queda donde
       * está y el atacante se lleva su castigo. Es una sola llamada al motor,
       * igual que el descarte propio.
       *
       * El ACIERTO no, y no es por prudencia: no se puede. La regla dice que
       * la carta a entregar se elige DESPUÉS de saber que acertó, así que
       * todavía no existe. Aplicarlo igual dejaría un hueco en la mano del
       * rival, y un hueco se lee como «tiene una carta menos» — hasta por
       * `quienSeQuedoSinCartas`, que dispara el corte automático. Se habría
       * cortado la ronda por una carta que estaba en camino.
       *
       * Así que el acierto espera su entrega y se aplica entero cuando ésta
       * llega, en `entregarCarta`. Si no llega a tiempo, lo aplica
       * `cerrarVentana` con una carta al azar, que es lo que la regla dice.
       */
      /*
       * Y EL ACIERTO QUE YA TRAE SU ENTREGA, TAMBIÉN. (Etapa 3b/3)
       *
       * El párrafo de arriba dice por qué el acierto espera: la carta a
       * entregar todavía no existe. Cuando SÍ existe —el camino viejo, donde
       * la mesa mandaba `posicionEntrega` junto con el ataque— no hay nada que
       * esperar y no hay hueco que dejar: la llamada al motor está completa.
       *
       * Antes no se notaba, porque el cierre por tiempo llegaba a los 2 s y
       * lo resolvía. Sin cronómetro, ese acierto se quedaba pendiente hasta
       * que alguien tirara, y entretanto la carta del rival seguía en su mano
       * y el atacante con la suya. Una pestaña vieja jugaba a otro juego.
       */
      const entregaYaElegida = contraRival && Number.isInteger(posicionEntrega);
      const aplicarAhora = !contraRival || evaluado === "error" || entregaYaElegida;

      if (aplicarAhora) {
        const despues = contraRival
          ? motor.intentarDescarteRival(
              partida.estado, indice, indiceObjetivo, posicion,
              // En el error no se entrega nada; en el acierto, la que eligió.
              evaluado === "error" ? null : posicionEntrega,
            )
          : motor.intentarDescarte(partida.estado, indice, posicion);

        /*
         * Sólo se marca como aplicado si el motor REALMENTE lo tomó.
         *
         * Descartar vale en dos fases —`mirar` y `descarte`, ver `FASE_DE`—
         * pero `motor.intentarDescarte` exige `fase === "descarte"` con la
         * ventana abierta. Un toque durante la mirada vuelve con el estado
         * intacto, y ésos tienen que seguir esperando al cierre como siempre.
         *
         * Marcarlos igual los habría hecho desaparecer: `resolverVentana` los
         * saltearía por creerlos aplicados, y nunca se habrían aplicado.
         */
        if (despues !== partida.estado) {
          estadoNuevo = despues;

          // El resultado lo escribe el motor en su propia ventana. Se copia al
          // intento porque al cerrar ya no se va a volver a mirar ahí.
          const ultimo = despues.ventanaDescarte?.intentos?.at(-1);
          const anotado = ventanaNueva.intentos[clientActionId];
          ventanaNueva = {
            ...ventanaNueva,
            intentos: {
              ...ventanaNueva.intentos,
              [clientActionId]: {
                ...anotado,
                aplicadoAlLlegar: true,
                // Acá sí: aplicado en el instante sellado de la llegada. Es de
                // esta hora que cuentan los 2 s de exposición de una errada.
                aplicadoEn: llegada,
                resultado: ultimo?.resultado ?? null,
              },
            },
          };
        }
      }

      /*
       * ¿Alguien se quedó sin cartas? Se corta YA. (Etapa 3b/3)
       *
       * Antes esto lo miraba `cerrarVentanaDescarte`, al cerrar la ventana por
       * tiempo. Ahora la ventana dura lo que dure la muestra, así que esperar
       * al cierre dejaría la ronda terminando DESPUÉS de que el siguiente ya
       * levantó, decidió y tiró — con jugadas hechas sobre una ronda que ya no
       * debería existir.
       *
       * En una mesa real, si alguien se queda sin cartas la mano se termina
       * ahí. Así que se pregunta en cada reflejo aplicado, que es el único
       * momento en que la cuenta de cartas de alguien puede bajar.
       *
       * `cerrarVentanaDescarte` hace las dos cosas que hacen falta: cierra la
       * ventana del motor y resuelve el corte. La fase ya está adelantada, y
       * desde 3a no la pisa.
       */
      const cortaAhora = motor.quienSeQuedoSinCartas(estadoNuevo) != null;
      if (cortaAhora) {
        estadoNuevo = motor.cerrarVentanaDescarte(estadoNuevo);
        ventanaNueva = { ...ventanaNueva, cerrada: true, resueltaEn: llegada };
      }

      const siguiente = {
        ...partida,
        estado: estadoNuevo,
        ventana: ventanaNueva,
        // La señal de vida fue la llegada del pedido.
        latidos: { ...partida.latidos, [uid]: llegada },
        version: partida.version + 1,
      };
      // Ojo: no se republican las vistas con los intentos ajenos dentro; el
      // resumen de ventana que viaja no los incluye.
      publicar(tx, codigo, siguiente);
      return { anotado: true, duplicado: false, version: siguiente.version, ...delAtaque };
    });
  }

  /**
   * La carta que da quien le acertó a un rival.
   *
   * Llega después del ataque, que ya está anotado y esperándola. Tiene hasta
   * `entregaHasta`; después, al resolverse la ventana, la carta sale al azar.
   * Va por el mismo callable que el descarte para caer en una instancia que
   * ya está caliente: ese ataque acaba de pasar por ella.
   *
   * Idempotente: la primera carta que llega es la que vale. Un reintento —o un
   * segundo toque— no cambia la elección.
   */
  async function entregarCarta({ uid, codigo, windowId, clientActionId, posicionEntrega }) {
    const llegada = ahora();

    return db.runTransaction(async (tx) => {
      const snap = await tx.get(refPartida(codigo));
      const partida = exigirPartida(snap, codigo);
      const indice = exigirJugador(partida, uid);
      const ventana = partida.ventana;

      if (!ventana || ventana.id !== windowId) {
        throw error("failed-precondition", "Esa jugada era de otra ventana.");
      }
      const intento = ventana.intentos?.[clientActionId];
      if (!intento || intento.uid !== uid || !intento.esperaEntrega) {
        throw error("failed-precondition", "No hay ninguna carta que entregar.");
      }
      if (intento.posicionEntrega != null) {
        return { entregada: true, duplicado: true, version: partida.version };
      }
      if (ventana.cerrada || llegada > intento.entregaHasta) {
        throw error("failed-precondition", "Se terminó el tiempo: la carta salió al azar.");
      }

      const mano = partida.estado.jugadores[indice].mano;
      if (!Number.isInteger(posicionEntrega) || !mano[posicionEntrega]) {
        throw error("invalid-argument", "Elegí una carta tuya para entregar.");
      }

      /*
       * Y ACÁ se aplica el ataque entero. (Etapa 2/3)
       *
       * Antes esto sólo anotaba la carta elegida y todo se resolvía al cerrar
       * la ventana. Ahora el acierto se completa en el momento en que llega su
       * entrega: se va la carta del rival, entra la que se dio, y la mesa lo
       * ve sin esperar nada.
       *
       * Es una sola llamada al motor porque el ataque acertado ES la
       * transferencia: separarlo en dos escrituras dejaría a la mano del rival
       * con un hueco, y un hueco se lee como una carta menos.
       */
      const objetivo = partida.jugadores.indexOf(intento.objetivo ?? uid);
      const estadoNuevo = motor.intentarDescarteRival(
        partida.estado, indice, objetivo, intento.posicion, posicionEntrega,
      );

      if (estadoNuevo === partida.estado) {
        throw error("failed-precondition", "Esa entrega ya no es posible.");
      }

      const ultimo = estadoNuevo.ventanaDescarte?.intentos?.at(-1);

      // El mismo corte que en `intentarDescarte`, por el mismo motivo: una
      // entrega acertada le saca una carta al rival, así que es el otro
      // momento en que alguien puede quedarse sin ninguna.
      let conCorte = estadoNuevo;
      let ventanaFinal = ventana;
      if (motor.quienSeQuedoSinCartas(estadoNuevo) != null) {
        conCorte = motor.cerrarVentanaDescarte(estadoNuevo);
        ventanaFinal = { ...ventana, cerrada: true, resueltaEn: llegada };
      }

      const siguiente = {
        ...partida,
        estado: conCorte,
        ventana: {
          ...ventanaFinal,
          intentos: {
            ...ventana.intentos,
            [clientActionId]: {
              ...intento,
              posicionEntrega,
              aplicadoAlLlegar: true,
              aplicadoEn: llegada,
              resultado: ultimo?.resultado ?? null,
            },
          },
        },
        latidos: { ...partida.latidos, [uid]: llegada },
        version: partida.version + 1,
      };
      publicar(tx, codigo, siguiente);
      return { entregada: true, duplicado: false, version: siguiente.version };
    });
  }

  const mensajeDeRechazo = (motivo) => ({
    ventana_distinta: "Esa jugada era de otra ronda.",
    ventana_cerrada: "La ventana de descarte ya se cerró.",
    fuera_de_tiempo: "Llegaste fuera de tiempo.",
    posicion_invalida: "Esa posición no existe en tu mano.",
    falta_identificador: "A la jugada le falta su identificador.",
    no_jugador: "No estás jugando esta partida.",
    ya_intento: "Ya registraste una carta en esta ventana.",
  })[motivo] ?? "No pudimos registrar la jugada.";

  /**
   * Cierra la ventana y aplica todos los intentos en el orden calculado.
   *
   * Es idempotente: cerrar dos veces no vuelve a aplicar nada, porque lo
   * primero que se mira es si ya estaba cerrada. Puede pedirla cualquiera
   * (el primer cliente que ve que venció), y por eso tiene que aguantar que
   * la pidan los cuatro a la vez: la transacción deja pasar una sola.
   */

  /**
   * Aplica lo que todavía no se aplicó, y devuelve el parte de todo.
   *
   * Lo usan los dos cierres de ventana: el callable `cerrarVentana` y el
   * plazo del mismo nombre en `transicion`. Son el mismo cierre por dos
   * puertas, y antes cada uno llamaba a `resolverVentana` con los mismos
   * cinco argumentos.
   */
  function aplicarPendientes(estadoInicial, ventana, indiceDe, t) {
    /*
     * Al cerrar ya no queda casi nada que resolver. (Etapa 2/3)
     *
     * Acá se llamaba a `resolverVentana`, que ordenaba TODOS los intentos
     * por tiempo efectivo —con su empate técnico de 60 ms— y los aplicaba en
     * ese orden. Desde la etapa 1 el descarte propio se aplica al llegar, y
     * desde ésta también el ataque errado y el acertado con su entrega.
     *
     * Lo único que puede quedar pendiente es un acierto cuya entrega nunca
     * llegó. Para ésos la regla ya estaba escrita: la carta sale al azar, y
     * la elige el motor cuando se le pasa `posicionEntrega` sin número.
     *
     * Se recorren en el orden en que se anotaron, que es el de llegada. Ya
     * no hay nada que ordenar: `ordenarIntentos`, `esEmpateTecnico`,
     * `favorecido` y `MS_EMPATE_TECNICO` se fueron con este cambio.
     */
    /*
     * Y DEVUELVE LA VENTANA MARCADA. (Etapa 3b/3)
     *
     * Hasta ahora el único que llamaba a esto era el cierre, y el cierre
     * ponía `cerrada: true`: nadie volvía a pasar por acá, así que daba igual
     * que los intentos quedaran sin marcar.
     *
     * Ya no. `resolverEntregas` resuelve lo pendiente SIN cerrar la ventana
     * —la muestra no cambió— y si los intentos quedaran sin marcar seguirían
     * figurando como pendientes: el plazo se recalcularía igual, el golpe
     * siguiente volvería a cumplirlo, y la entrega se aplicaría una y otra
     * vez. Una carta por golpe, y la mesa golpea varias veces por segundo.
     *
     * Se marcan con lo mismo que usa `intentarDescarte`: `aplicadoAlLlegar`
     * más el `resultado` que escribió el motor. `entregasPendientes` mira esa
     * marca, así que un intento ya aplicado deja de contar como pendiente.
     */
    let estado = estadoInicial;
    const orden = [];
    const intentos = { ...(ventana.intentos ?? {}) };

    for (const intento of Object.values(ventana.intentos ?? {})) {
      const indice = indiceDe(intento.uid);
      if (indice == null || indice < 0) continue;

      if (intento.aplicadoAlLlegar) {
        orden.push({ ...intento, indice, aplicado: true, resultado: intento.resultado ?? null });
        continue;
      }

      const antes = estado;
      const objetivo = indiceDe(intento.objetivo ?? intento.uid);

      estado = objetivo != null && objetivo >= 0 && objetivo !== indice
        ? motor.intentarDescarteRival(estado, indice, objetivo, intento.posicion, intento.posicionEntrega)
        : motor.intentarDescarte(estado, indice, intento.posicion);

      const ultimo = estado.ventanaDescarte?.intentos?.at(-1);
      const resultado = estado !== antes ? (ultimo?.resultado ?? null) : null;
      orden.push({ ...intento, indice, aplicado: estado !== antes, resultado });

      if (estado !== antes) {
        intentos[intento.clientActionId] = {
          ...intento,
          aplicadoAlLlegar: true,
          resultado,
          // La hora REAL de la aplicación, que acá no es la de la llegada:
          // este intento esperaba. De ella cuentan los 2 s de exposición.
          aplicadoEn: t,
        };
      }
    }

    return { estado, orden, intentos };
  }

  /**
   * El cierre completo de una ventana de reflejos: lo pendiente y el corte.
   *
   * Es el único cierre, y lo usan las dos puertas que quedan: la jugada que
   * cambia la muestra (`accionDeTurno`) y el callable `cerrarVentana`. Antes
   * eran dos cuerpos parecidos y uno de los dos se olvidaba del corte.
   *
   * El corte va acá por lo mismo que va en `intentarDescarte`: una entrega
   * resuelta al azar saca una carta de la mano del que acertó, y ésa puede ser
   * su última. Quedarse sin cartas corta la ronda, se vacíe la mano cuando se
   * vacíe. `cerrarVentanaDescarte` hace las dos cosas —cierra la ventana del
   * motor y resuelve el corte— y desde 3a no pisa la fase si ya se adelantó.
   */
  function cerrarReflejos(estadoInicial, ventana, indiceDe, t) {
    const { estado, orden, intentos } = aplicarPendientes(estadoInicial, ventana, indiceDe, t);
    const cortado = motor.quienSeQuedoSinCartas(estado) != null
      ? motor.cerrarVentanaDescarte(estado)
      : estado;
    return {
      estado: cortado,
      orden,
      ventana: { ...ventana, intentos, cerrada: true, resueltaEn: t },
    };
  }

  /**
   * Resuelve lo pendiente SIN cerrar la ventana.
   *
   * La diferencia con `cerrarReflejos` es una sola y es la que importa: acá la
   * ventana sigue abierta, porque la muestra no cambió. Lo usan los dos
   * momentos en que hay pendientes que ya se pueden aplicar y la mano sigue:
   *
   *   - el final de la MIRADA, donde los toques que el motor no pudo aceptar
   *     —todavía no existía su ventana— recién ahora se pueden aplicar;
   *   - el vencimiento de una ENTREGA que nadie eligió, que sale al azar.
   *
   * El corte va acá por lo mismo que en los otros tres sitios: aplicar un
   * reflejo puede dejar a alguien sin cartas, y entonces la mano se termina.
   * Si corta, la ventana se cierra con ella: ya no hay a qué reaccionar.
   */
  function resolverPendientes(partida, indiceDe, t) {
    const { estado, intentos } = aplicarPendientes(partida.estado, partida.ventana, indiceDe, t);
    const ventana = { ...partida.ventana, intentos };
    if (motor.quienSeQuedoSinCartas(estado) != null) {
      return {
        estado: motor.cerrarVentanaDescarte(estado),
        ventana: { ...ventana, cerrada: true, resueltaEn: t },
      };
    }
    return { estado, ventana };
  }

  async function cerrarVentana({ codigo, forzar = false }) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(refPartida(codigo));
      const partida = exigirPartida(snap, codigo);

      if (!partida.ventana) throw error("failed-precondition", "No hay ventana que cerrar.");
      if (partida.ventana.cerrada) {
        return { yaEstaba: true, orden: [], version: partida.version };
      }
      if (!forzar && !yaVencio(partida.ventana, ahora())) {
        throw error("failed-precondition", "La ventana todavía no terminó.");
      }

      const { estado, orden, ventana } = cerrarReflejos(
        partida.estado, partida.ventana, indiceDeEn(partida), ahora(),
      );

      // La fase NO se toca. Puede seguir en `descarte` —si nadie tiró
      // todavía— o estar ya en el turno del siguiente: cerrar la ventana no
      // es avanzar la mesa. Lo único que la avanza es `seguirTurno`.
      const siguiente = {
        ...partida,
        estado,
        ventana,
        version: partida.version + 1,
      };

      publicar(tx, codigo, siguiente);
      return {
        yaEstaba: false,
        version: siguiente.version,
        // Se devuelve el orden para que la mesa pueda animar quién ganó.
        orden: orden.map((o) => ({ uid: o.uid, posicion: o.posicion, resultado: o.resultado })),
      };
    });
  }

  /**
   * Cierra la fase de mirar. La decide el servidor con su reloj, igual que la
   * ventana: si dependiera de que cada cliente avise, el que tarda en avisar
   * le regalaría segundos de memorización a los demás.
   */
  async function cerrarMirada({ codigo }) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(refPartida(codigo));
      const partida = exigirPartida(snap, codigo);
      if (partida.estado.fase !== "mirar") {
        return { yaEstaba: true, version: partida.version };
      }

      /**
       * No se puede terminar una mirada que todavía no empezó.
       *
       * Esta función terminaba la mirada sin preguntar la hora. Con la primera
       * ronda esperando jugadores —que es fase `mirar` sin ventana— o durante
       * la cuenta regresiva, cualquiera podía llamarla y saltarles la mirada a
       * todos, dejando además la partida en `descarte` sin ventana.
       */
      const t = ahora();
      if (partida.esperandoLlegadas || !partida.ventana || t < partida.ventana.abiertaEn) {
        throw error("failed-precondition", "La mirada todavía no empezó.");
      }
      if (t < partida.ventana.abiertaEn + MS_MIRADA_TOTAL) {
        throw error("failed-precondition", "La mirada todavía no venció.");
      }
      // Y lo que se tocó durante la mirada se aplica acá mismo, igual que por
      // la otra puerta. El motivo largo está en `transicion`, caso
      // `cerrarMirada`: es el primer instante en que se puede.
      const conLaVentanaAbierta = {
        ...partida,
        estado: motor.terminarMirada(partida.estado),
      };
      const siguiente = {
        ...conLaVentanaAbierta,
        ...resolverPendientes(conLaVentanaAbierta, indiceDeEn(partida), t),
        version: partida.version + 1,
      };
      publicar(tx, codigo, siguiente);
      return { yaEstaba: false, version: siguiente.version };
    });
  }

  // ------------------------------------------------------- turnos

  /**
   * Acciones de turno. Una sola puerta para todas: cada una declara en qué
   * fase vive y si exige el turno, y acá se comprueba siempre, sin excepción.
   *
   * `clientActionId` las hace idempotentes: un doble clic o un reintento no
   * levanta dos cartas.
   */
  async function accionDeTurno({ uid, codigo, accion, clientActionId, posicion, objetivo }) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(refPartida(codigo));
      const partida = exigirPartida(snap, codigo);
      const indice = exigirJugador(partida, uid);

      if (!clientActionId) throw error("invalid-argument", "Falta el identificador de la jugada.");
      // Ya aplicada: se contesta con el estado de entonces, sin repetirla.
      if (partida.aplicadas?.[clientActionId]) {
        return { duplicado: true, version: partida.version };
      }

      exigirFase(partida, accion);

      // Mirar, sólo con la ventana abierta. Mientras la primera ronda espera
      // jugadores, o durante la cuenta regresiva, la fase ya es `mirar` pero
      // la mirada no empezó: quien tocara antes miraría con ventaja sobre los
      // que todavía están cargando la mesa.
      if (
        accion === ACCIONES.MIRAR &&
        (partida.esperandoLlegadas || !partida.ventana || ahora() < partida.ventana.abiertaEn)
      ) {
        throw error("failed-precondition", "La mirada todavía no empezó.");
      }

      if (EXIGEN_TURNO.has(accion) && partida.estado.indiceTurno !== indice) {
        throw error("failed-precondition", "No es tu turno.");
      }

      exigirPosiciones(partida, indice, accion, { posicion, objetivo });

      /*
       * LO QUE QUEDABA DE LA VENTANA ANTERIOR SE RESUELVE ANTES. (Etapa 3b/3)
       *
       * La ventana de reflejos ya no vence sola: dura lo que dure la MUESTRA.
       * Quien la cierra es el que cambia la muestra —o el que corta—, y la
       * lista exacta está en `CIERRAN_LA_VENTANA`.
       *
       * Lo único que puede quedarle pendiente es un acierto cuya entrega nunca
       * llegó, y se resuelve ACÁ, ANTES de aplicar la jugada. El orden importa
       * y no es un detalle: `intentarDescarteRival` vuelve a comparar la carta
       * contra la muestra, así que si la jugada fuera primero, un acierto
       * válido se convertiría en error contra una muestra que ya cambió.
       *
       * Y se resuelve SÓLO si esta jugada cierra. Una mirada o un levantar no
       * tocan la ventana, así que la entrega sigue pendiente con su propio
       * plazo: adelantarla sería tirar la carta al azar antes de que al dueño
       * se le acabara el tiempo de elegirla.
       */
      const resuelto = CIERRAN_LA_VENTANA.has(accion)
        ? antesDeCambiarLaMuestra(partida, ahora())
        : null;
      const base = resuelto ? resuelto.estado : partida.estado;

      /*
       * Si al resolver lo pendiente se cortó la ronda, la jugada no pasa.
       *
       * La entrega que se resuelve al azar puede dejar sin cartas al que
       * acertó —es la jugada ganadora: te quedás sin mano atacando—, y eso
       * corta la ronda en el acto. La mano se terminó ANTES de este tiro, así
       * que aplicarlo sería jugar sobre una ronda que ya no existe.
       *
       * No se contesta con un error porque no hay nada que el jugador hiciera
       * mal, y porque el corte hay que publicarlo: en una transacción no se
       * puede escribir y fallar a la vez. Se publica el corte y se le dice que
       * su jugada no entró.
       */
      if (resuelto && RONDA_TERMINADA.has(base.fase)) {
        const cortada = {
          ...partida,
          estado: base,
          ventana: resuelto.ventana,
          latidos: { ...partida.latidos, [uid]: ahora() },
          version: partida.version + 1,
        };
        publicar(tx, codigo, cortada);
        return {
          duplicado: false, aplicada: false, motivo: "ronda_cortada",
          version: cortada.version, fase: base.fase,
        };
      }

      const estado = aplicar(base, indice, accion, { posicion, objetivo });
      if (estado === base) {
        throw error("failed-precondition", "Esa jugada no cambia nada.");
      }

      // Lo que este jugador tiene derecho a VER por haber hecho esta jugada.
      // Viaja en la RESPUESTA, no en la partida: se muestra unos segundos en
      // su pantalla y se olvida. Guardarlo en el estado sería reinventar
      // `infoPublica`, que se sacó justamente para que no quedara rastro.
      const revelado = queRevela(partida.estado, indice, accion, { posicion, objetivo });

      const siguiente = {
        ...partida,
        ...trasCambiarLaMuestra(partida, resuelto, estado, ahora()),
        latidos: { ...partida.latidos, [uid]: ahora() },
        // Se recuerdan las últimas jugadas para poder reconocer un reintento.
        aplicadas: recortar({ ...(partida.aplicadas ?? {}), [clientActionId]: true }),
        version: partida.version + 1,
      };
      publicar(tx, codigo, siguiente);
      return { duplicado: false, version: siguiente.version, fase: estado.fase, ...revelado };
    });
  }

  /** Se guardan las últimas 40 jugadas: alcanza de sobra para un reintento. */
  function recortar(aplicadas) {
    const claves = Object.keys(aplicadas);
    if (claves.length <= 40) return aplicadas;
    return Object.fromEntries(claves.slice(-40).map((k) => [k, true]));
  }

  /**
   * Qué ve el jugador que hizo la jugada, y sólo él.
   *
   * Mirar una carta propia al empezar la ronda, o usar un poder de mirada,
   * son jugadas cuyo resultado es información privada. El estado publicado no
   * la lleva —ninguna vista, ni la suya— porque ahí quedaría escrita; viaja
   * una sola vez, en la respuesta a quien la pidió.
   */
  function queRevela(estado, indice, accion, { posicion, objetivo }) {
    if (accion === ACCIONES.MIRAR) {
      return { carta: estado.jugadores[indice].mano[posicion] ?? null };
    }
    if (accion === ACCIONES.PODER_MIRAR) {
      const objetivoIndice = objetivo?.indice ?? indice;
      return { carta: estado.jugadores[objetivoIndice]?.mano[posicion] ?? null };
    }
    if (accion === ACCIONES.PODER_CAMBIO) {
      const { revelada } = motor.usarPoderCambio(
        estado, posicion, objetivo?.indice, objetivo?.posicion,
      );
      return { revelada: revelada ?? null };
    }
    return {};
  }

  function aplicar(estado, indice, accion, { posicion, objetivo }) {
    switch (accion) {
      case ACCIONES.MIRAR: return motor.mirar(estado, indice, posicion);
      case ACCIONES.LEVANTAR: return motor.levantar(estado);
      case ACCIONES.CAMBIAR: return motor.cambiarCarta(estado, posicion);
      case ACCIONES.TIRAR: return motor.tirarCarta(estado);
      case ACCIONES.SALTAR_PODER: return motor.saltarPoder(estado);
      // `objetivo` acá no es un jugador: es el sí o el no. Se lee como
      // booleano estricto para que un objetivo ausente NO cambie las cartas,
      // que es la salida conservadora.
      case ACCIONES.RESOLVER_CAMBIO:
        return motor.resolverCambioConVista(estado, objetivo === true);
      case ACCIONES.CORTAR: return motor.cortar(estado);
      case ACCIONES.PASAR: return motor.pasarTurno(estado);
      // Los dos poderes devuelven { estado, revelada }. Lo revelado NO se
      // guarda en la partida: viaja sólo en la respuesta a quien lo usó, y se
      // pierde. Guardarlo sería reinventar `infoPublica` por la puerta de
      // atrás, que es justamente lo que se sacó del motor.
      case ACCIONES.PODER_MIRAR:
        return motor.usarPoderMirar(estado, objetivo?.indice ?? indice, posicion).estado;
      case ACCIONES.PODER_CAMBIO:
        return motor.usarPoderCambio(
          estado, posicion, objetivo?.indice, objetivo?.posicion,
        ).estado;
      default: throw error("invalid-argument", "Acción desconocida.");
    }
  }

  // ------------------------------------------------------ orquestador

  /**
   * Hace avanzar la partida si algo venció. La llaman los clientes.
   *
   * Que la llamen los clientes NO significa que decidan ellos. En Firebase no
   * hay un proceso vivo esperando, así que alguien tiene que golpear la
   * puerta; pero quien mira el reloj es el servidor, y mira el suyo. Golpear
   * temprano no adelanta nada —se contesta "todavía no"— y golpear mil veces
   * es lo mismo que golpear una: el plazo está guardado y sólo se cumple
   * cuando se cumple.
   *
   * De ahí salen las cuatro garantías que hacen falta:
   *
   *   - no se duplica una ventana: abrirla dos veces devuelve la misma;
   *   - no se cierra dos veces: lo primero que se mira es si ya está cerrada;
   *   - no se avanza dos rondas: la transición cambia la fase, y el plazo
   *     siguiente ya es otro;
   *   - no se crean dos estados: todo pasa dentro de una transacción, y dos
   *     llamadas simultáneas chocan y una reintenta.
   *
   * Hace UNA transición por llamada. Es a propósito: cada paso publica vistas,
   * y encadenar varios en una transacción dejaría a los jugadores sin ver los
   * pasos intermedios.
   */
  /**
   * Las partidas cuyo plazo ya venció.
   *
   * `plazo.hasta` es un número de milisegundos, así que la desigualdad
   * funciona con el índice que Firestore arma solo para cada campo. Una
   * partida cerrada no tiene plazo —`plazoDe` devuelve null— y un campo
   * ausente no entra en una comparación: quedan afuera sin filtrar nada.
   *
   * El tope existe para que un barrido no se vuelva ilimitado si algo se
   * acumula. Con el barredor corriendo cada minuto, veinte partidas por
   * vuelta es más de lo que este juego va a tener vencidas a la vez, y si
   * alguna vez lo fuera, la vuelta siguiente sigue donde quedó.
   */
  async function vencidas({ hasta = ahora(), tope = 20 } = {}) {
    const snap = await db
      .collection(partidas)
      .where("plazo.hasta", "<=", hasta)
      .limit(tope)
      .get();

    const codigos = [];
    snap.forEach((d) => codigos.push(d.id));
    return codigos;
  }

  async function avanzarPartida({ codigo }) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(refPartida(codigo));
      const partida = exigirPartida(snap, codigo);
      const t = ahora();

      /**
       * Una partida cerrada no vuelve a moverse. Nunca.
       *
       * `cerrada` la pone el cierre cuando ya repartió el pozo, y también
       * la administración cuando cancela una sala en juego y devuelve las
       * entradas. En los dos casos la plata ya se movió.
       *
       * Sin esta línea, una partida cancelada a mitad —que sigue en `turno`,
       * no en `finPartida`— vuelve a calcular su plazo en el golpe
       * siguiente, el barredor la encuentra vencida y la empuja hasta el
       * final. Ahí el cierre pagaría premios de un pozo que ya se devolvió:
       * la misma plata dos veces.
       */
      if (partida.cerrada) {
        return { hizo: null, motivo: "cerrada", fase: partida.estado.fase };
      }

      const plazo = partida.plazo;

      // Un plazo que no corresponde a la fase actual sería una partida
      // colgada para siempre: el orquestador no actuaría nunca y nadie
      // recalcularía el plazo. No debería ocurrir —toda mutación pasa por
      // `publicar`, que lo recalcula— pero si ocurriera, la partida quedaría
      // muerta sin que nada lo señale. Se arregla republicando: `publicar`
      // pone el plazo que corresponde y el golpe siguiente ya puede actuar.
      const desfasado = plazo && plazo.fase !== partida.estado.fase;
      // Con `cerrada`, igual que en `publicar`. Sin ese dato, una partida ya
      // cerrada calcularía un plazo de cierre, se creería desfasada y se
      // republicaría en CADA golpe: cinco documentos escritos por segundo,
      // para siempre. Lo destapó la prueba del cierre repetido.
      const faltaPlazo = !plazo && plazoDePartida(partida, null, t);

      if (desfasado || faltaPlazo) {
        publicar(tx, codigo, { ...partida, plazo: null, version: partida.version + 1 });
        return {
          hizo: "recalcularPlazo",
          motivo: desfasado ? "plazo_desfasado" : "plazo_faltante",
          fase: partida.estado.fase,
          version: partida.version + 1,
        };
      }

      if (!plazo) return { hizo: null, motivo: "sin_plazo", fase: partida.estado.fase };
      if (t < plazo.hasta) {
        return { hizo: null, motivo: "todavia_no", faltanMs: plazo.hasta - t, fase: partida.estado.fase };
      }

      // El cierre es la única transición que necesita LEER otro documento —la
      // sala, por el pozo— y mover Leyendas. Por eso no pasa por `transicion`,
      // que es sincrónica y sólo transforma el estado: va acá, donde todavía
      // no se escribió nada y las lecturas siguen siendo legales.
      if (plazo.que === "cerrarPartida") {
        if (!cierre) {
          // Sin las primitivas de cierre inyectadas no se puede repartir. Se
          // dice, en vez de fingir que no había nada que hacer.
          return { hizo: null, motivo: "sin_cierre_configurado", fase: partida.estado.fase };
        }

        // 1. LEER: la sala, con el pozo y los abandonos.
        const datos = await cierre.leer(tx, codigo);

        // 2. PENSAR: quién cobra y cuánto. Puro, sin tocar nada.
        const plan = cierre.planificar(datos);
        if (plan.yaEstaba) {
          // Otro golpe llegó primero. Se republica para que el plazo se
          // recalcule a null y esta partida deje de pedir cierre.
          publicar(tx, codigo, { ...partida, cerrada: true, version: partida.version + 1 });
          return { hizo: "cerrarPartida", yaEstaba: true, fase: partida.estado.fase };
        }

        // 3. ESCRIBIR: pagar y cerrar la sala.
        const { cierre: registro, jugadores, puntuable } = await cierre.aplicar(tx, {
          ...datos,
          plan,
          // No lo pidió ningún jugador: lo disparó el vencimiento del plazo.
          cerradaPor: "servidor",
        });

        publicar(tx, codigo, {
          ...partida,
          cerrada: true,
          cierre: registro,
          version: partida.version + 1,
        });

        return {
          hizo: "cerrarPartida",
          yaEstaba: false,
          fase: partida.estado.fase,
          version: partida.version + 1,
          pozo: registro.pozo,
          repartido: registro.repartido,
          sobrante: registro.sobrante,
          premios: registro.premios,
          // Quiénes terminaron la partida, y con qué puntuarla. Quien llame a
          // esto revisa después —fuera de la transacción— las insignias y
          // escribe el ranking: las dos cosas necesitan LEER algo que se acaba
          // de escribir, y adentro Firestore no lo permite.
          jugadores,
          puntuable,
        };
      }

      const siguiente = transicion(partida, plazo, t);
      if (!siguiente) return { hizo: null, motivo: "nada_que_hacer", fase: partida.estado.fase };

      publicar(tx, codigo, { ...siguiente, version: partida.version + 1 });
      return {
        hizo: plazo.que,
        fase: siguiente.estado.fase,
        version: partida.version + 1,
        ...(siguiente.extra ?? {}),
      };
    });
  }

  /** La transición concreta que toca. Devuelve la partida nueva, o null. */
  function transicion(partida, plazo, t) {
    switch (plazo.que) {
      // Venció la espera y falta alguien: la partida arranca igual. El que no
      // llegó se pierde su mirada, como si se hubiera desconectado; trabar la
      // mesa de los otros por una pestaña que no carga no es una opción.
      case "abrirPrimeraRonda":
        if (!partida.esperandoLlegadas) return null;
        return abrirPrimeraRonda(partida, t);

      /*
       * Y LO QUE SE TOCÓ DURANTE LA MIRADA SE APLICA ACÁ MISMO.
       *
       * ───────────────────────────────────────────────────────────────────
       * POR QUÉ NO PODÍA ESPERAR AL TIRO SIGUIENTE
       * ───────────────────────────────────────────────────────────────────
       *
       * Un toque hecho durante la mirada queda pendiente: el motor no lo
       * acepta en el momento porque su ventana todavía no existe —la abre
       * `terminarMirada`, dos líneas más abajo—. Hasta ahora se resolvía en el
       * cierre, o sea en el tiro del jugador en turno.
       *
       * Eso le daba la mano a quien tocó DESPUÉS. El que toca ya en la fase de
       * reflejos se aplica al llegar y se lleva el «primero»; el de la mirada
       * se aplicaba al final y se llevaba el «tarde». O sea que reaccionar
       * antes y llegar antes perdía contra reaccionar después, que es lo
       * contrario de lo que el orden de llegada promete.
       *
       * Acá es el PRIMER instante en que se pueden aplicar, así que es donde
       * van. Y es seguro porque la muestra no puede haber cambiado: en `mirar`
       * las únicas acciones que existen son mirar y descartar, el motor
       * rechaza los descartes mientras no haya ventana, y `rellenarMazo`
       * conserva la muestra. Nada mueve la pila entre un momento y el otro.
       *
       * Si dos tocaron durante la mirada, se aplican en el orden en que
       * llegaron al servidor: `aplicarPendientes` recorre `intentos` en orden
       * de inserción.
       */
      case "cerrarMirada": {
        const conLaVentanaAbierta = { ...partida, estado: motor.terminarMirada(partida.estado) };
        return {
          ...conLaVentanaAbierta,
          ...resolverPendientes(conLaVentanaAbierta, indiceDeEn(partida), t),
        };
      }

      case "abrirVentana": {
        const ventana = crearVentana({
          id: `v_${idAleatorio()}`,
          abiertaEn: t,
          duracionMs: duracionDeVentana(partida.estado),
        });
        // Y con la ventana abierta, el turno arranca. (Etapa 3b/3)
        //
        // Es la ventana de la RONDA, la que sigue a la mirada inicial. Sin
        // esto la mesa quedaría esperando un cierre por tiempo que ya no
        // existe: nadie podría levantar, así que nadie llegaría a tirar, y la
        // única cosa que cierra la ventana no pasaría nunca.
        return { ...partida, ventana, estado: motor.seguirConLaVentanaAbierta(partida.estado) };
      }

      /*
       * ACÁ VIVÍAN `cerrarVentana` Y `cerrarRevelacion`. (Etapa 3b/3)
       *
       * Las dos eran transiciones por RELOJ y las dos se fueron con los
       * cronómetros de reflejos: `plazoDe` ya no puede devolver ninguna de
       * esas marcas, así que los casos quedaban inalcanzables.
       *
       * Lo que hacía cada una no se perdió, cambió de puerta:
       *
       *   - el cierre con sus pendientes es `cerrarReflejos`, y lo llama el
       *     que cambia la muestra;
       *   - la revelación de dos segundos ya no necesita mantener ninguna
       *     fase: la vista filtra cada carta expuesta por su propia hora, en
       *     `sigueExpuesta`.
       */

      /*
       * Se acabaron los dos segundos de una carta expuesta: se republica.
       *
       * No cambia NADA del estado, y eso es todo lo que tiene que hacer:
       * `publicar` vuelve a filtrar las vistas con la hora de ahora, y la
       * carta ya no pasa el filtro. Ver `plazoDePartida`.
       */
      case "taparExpuestas":
        return { ...partida };

      /*
       * Se le acabó el tiempo de elegir: la carta sale al azar.
       *
       * Resuelve lo pendiente y NO cierra la ventana — la muestra sigue
       * siendo la misma, así que los reflejos sobre ella siguen valiendo. La
       * elige el motor cuando se le pasa `posicionEntrega` sin número, y eso
       * es lo que `aplicarPendientes` le pasa.
       *
       * El corte va acá por lo mismo que en `cerrarReflejos`: la carta que
       * sale al azar puede ser la última del que acertó. Si corta, la ronda
       * terminó y la ventana se cierra con ella.
       */
      case "resolverEntregas":
        return { ...partida, ...resolverPendientes(partida, indiceDeEn(partida), t) };

      // El turno arranca con la ventana de reflejos todavía abierta. Ver la
      // rama `descarte` de `plazoDe`. Es idempotente: si la fase ya se
      // adelantó, `seguirConLaVentanaAbierta` devuelve el mismo estado.
      case "seguirTurno":
        return { ...partida, estado: motor.seguirConLaVentanaAbierta(partida.estado) };

      case "saltarTurno":
        return { ...partida, estado: motor.saltarTurno(partida.estado) };

      // Se acabó el tiempo de decidir: pasa, nunca corta. Cortar por alguien
      // que no contestó podría eliminarlo; pasar no le cuesta nada.
      case "pasarPorTiempo": {
        /**
         * Y queda marcado como ausente.
         *
         * ─────────────────────────────────────────────────────────────────
         * POR QUÉ ÉSTA ES LA SEÑAL
         * ─────────────────────────────────────────────────────────────────
         *
         * Veinte segundos frente a la decisión que más se piensa de la ronda,
         * sin tocar nada, dicen algo que los latidos no pueden decir: la
         * pestaña está abierta —late— pero nadie la mira. `saltarAusente` no
         * lo agarra nunca, porque mide SILENCIO.
         *
         * No es la única señal y no reemplaza a aquélla. Son dos casos: el que
         * se fue de verdad deja de latir y lo rescata `saltarAusente` sin que
         * tenga que apretar nada; el que dejó la pestaña abierta cae acá, y
         * cuando vuelve aprieta «he vuelto».
         *
         * ─────────────────────────────────────────────────────────────────
         * POR QUÉ UNA LISTA APARTE Y NO `ausentes`
         * ─────────────────────────────────────────────────────────────────
         *
         * `latir` recalcula `ausentes` ENTERA en cada llamada, a partir de los
         * latidos. Este jugador sigue latiendo, así que el próximo latido de
         * cualquiera lo borraría de ahí. Y `ausentes` es lo que dispara
         * `saltarAusente`, que rechaza a quien todavía late: meterlo ahí
         * haría que los navegadores tocaran ese timbre cada pocos segundos
         * para nada.
         *
         * Sólo ESTE caso marca. Los plazos de diez segundos —tirar la carta,
         * soltar el poder— son decisiones que vencen, no ausencias: vencer una
         * es jugar apurado, no haberse ido.
         */
        const quien = partida.jugadores[partida.estado.indiceTurno];
        const previos = partida.ausentesPorTiempo ?? [];
        return {
          ...partida,
          estado: motor.pasarTurno(partida.estado),
          ausentesPorTiempo: previos.includes(quien) ? previos : [...previos, quien],
        };
      }

      /**
       * Se acabaron los diez segundos con la carta levantada: se tira.
       *
       * Es el ÚNICO caso en que el servidor juega una carta que nadie tocó, y
       * se banca porque no hay nada que elegir: o se la queda o la tira, y
       * tirarla es lo único que no le cambia la mano sin que él lo pida.
       *
       * Queda anotado como automático en el registro —ver `tirarCarta`— para
       * que después se pueda explicar.
       */
      case "descartarPorTiempo": {
        /*
         * Y la ventana cambia con la muestra, igual que si hubiera tirado él.
         *
         * Esta línea era sólo `estado: motor.tirarCarta(...)`, sin tocar la
         * ventana, y alcanzaba: a los diez segundos la de los reflejos ya se
         * había cerrado por su propio reloj. Ver `trasCambiarLaMuestra`.
         */
        const resuelto = antesDeCambiarLaMuestra(partida, t);
        const base = resuelto ? resuelto.estado : partida.estado;
        // Si al resolver lo pendiente se cortó la ronda, `tirarCarta` no hace
        // nada —exige fase `levantada`— y lo que se publica es el corte.
        const tirado = motor.tirarCarta(base, { porTiempo: true });
        return { ...partida, ...trasCambiarLaMuestra(partida, resuelto, tirado, t) };
      }

      /**
       * Se acabaron los diez segundos con un poder pendiente: se salta.
       *
       * ───────────────────────────────────────────────────────────────────
       * POR QUÉ SON DOS PASOS Y NO UNO
       * ───────────────────────────────────────────────────────────────────
       *
       * `saltarTurno` no sirve acá: exige fase `turno` y sin carta levantada,
       * así que desde `poder` devuelve el estado sin tocarlo — la partida se
       * quedaría colgada exactamente igual, con el plazo venciendo una y otra
       * vez.
       *
       * Lo que corresponde es lo que hace el jugador cuando declina: soltar el
       * poder, que lo deja en `postLevantada`, y de ahí pasar el turno. Son
       * las dos funciones del motor que ya existen y ya están probadas.
       *
       * El 10 a medio resolver es su propio caso: ya vio las dos cartas, así
       * que lo que se declina no es el poder sino el cambio. `false` es "no
       * cambio", que es lo único honesto — cambiar por él usaría información
       * que él tiene y el servidor no puede interpretar.
       */
      case "saltarPorTiempo": {
        const sinPendiente =
          partida.estado.fase === "cambioConVista"
            ? motor.resolverCambioConVista(partida.estado, false)
            : motor.saltarPoder(partida.estado);
        return { ...partida, estado: motor.pasarTurno(sinPendiente) };
      }

      case "siguienteRonda": {
        // Si la partida terminó, no hay ronda siguiente que repartir.
        if (partida.estado.fase === "finPartida") return null;
        return {
          ...partida,
          estado: motor.siguienteRonda(partida.estado),
          // La ronda nueva empieza mirando, así que su ventana abre acá.
          ventana: ventanaDeRonda(t),
          // Las jugadas recordadas eran de la ronda anterior.
          aplicadas: {},
        };
      }

      default:
        return null;
    }
  }

  // -------------------------------------------------- desconexiones

  /**
   * Señal de vida. La manda la mesa cada pocos segundos.
   *
   * Perder la conexión NO cuesta Leyendas: sería cobrarle a alguien por un
   * corte de luz. Lo único que pasa es que, si le toca el turno y no está,
   * se le salta —igual que si se le acabara el reloj— y la partida sigue.
   * Para irse de verdad hay que abandonar, que es una decisión explícita y
   * tiene su penalización.
   */
  async function latir({ uid, codigo }) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(refPartida(codigo));
      const partida = exigirPartida(snap, codigo);
      const indice = partida.jugadores.indexOf(uid);
      if (indice < 0) throw error("permission-denied", "No estás jugando esta partida.");

      const t = ahora();
      const latidos = { ...partida.latidos, [uid]: t };
      const ausentes = partida.jugadores.filter(
        (u) => u !== uid && t - (latidos[u] ?? 0) > MS_SIN_SENALES,
      );

      /**
       * Latir es también LLEGAR.
       *
       * La mesa manda su primer latido en cuanto carga, así que el primero de
       * cada jugador dice «estoy sentado». Cuando llega el último mientras la
       * partida espera, se abre la primera ronda. No hizo falta una función
       * nueva —que tendría su propio arranque en frío— para algo que ésta ya
       * recibía.
       */
      const previas = partida.llegadas ?? [];
      const llegadas = previas.includes(uid) ? previas : [...previas, uid];
      const llego = llegadas !== previas;

      let conLlegadas = { ...partida, latidos, ausentes, llegadas };
      const abre = conLlegadas.esperandoLlegadas && llegaronTodos(conLlegadas);
      if (abre) conLlegadas = abrirPrimeraRonda(conLlegadas, t);

      // Sólo se republican las vistas si CAMBIÓ algo que se ve: quién está
      // ausente, quién llegó, o que la ronda abrió. Un latido cada cinco
      // segundos por cuatro jugadores serían miles de escrituras por partida,
      // y encima cada publicación recalcularía plazos.
      const cambio =
        llego || abre ||
        JSON.stringify(ausentes) !== JSON.stringify(partida.ausentes ?? []);
      if (!cambio) {
        tx.set(refPartida(codigo), { ...partida, latidos, actualizado: marcaDeTiempo() });
        return { ausentes, version: partida.version };
      }

      const siguiente = { ...conLlegadas, version: partida.version + 1 };
      publicar(tx, codigo, siguiente);
      return { ausentes, abrio: abre, version: siguiente.version };
    });
  }

  /**
   * Le salta el turno a quien no está. Cualquier jugador puede pedirlo, pero
   * sólo prospera si se cumplen las dos condiciones a la vez: que le toque a
   * ese jugador y que efectivamente lleve sin dar señales más de la cuenta.
   * Así nadie puede usarlo para saltear al rival que está pensando.
   */
  async function saltarAusente({ codigo }) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(refPartida(codigo));
      const partida = exigirPartida(snap, codigo);

      const enTurno = partida.jugadores[partida.estado.indiceTurno];
      const t = ahora();
      const silencio = t - (partida.latidos?.[enTurno] ?? 0);

      if (silencio <= MS_SIN_SENALES) {
        throw error("failed-precondition", "El jugador en turno sigue conectado.");
      }

      // Levantada, poder y postLevantada tienen su propio reloj —diez, diez y
      // veinte segundos— y al vencer lo resuelven solos. Este rescate llega
      // ANTES: quien dejó de latir quince segundos no va a volver en los que le
      // quedan, y esperarlos es hacer esperar a los otros tres por nadie.
      //
      // Decía que esas fases «no tienen reloj», y era cierto cuando se
      // escribió. Dejó de serlo con los cronómetros de decisión.
      //
      // Se resuelve por él de la forma más neutra posible —sin usar el poder,
      // sin cambiar cartas y sin cortar—, que es también lo que hacen esos
      // relojes al vencer.
      const estado = partida.estado;

      /*
       * Tirarle la carta al ausente CAMBIA LA MUESTRA. (Etapa 3b/3)
       *
       * Así que esa rama pasa por el mismo camino que cualquier tiro: se
       * resuelve lo que la ventana vieja dejó pendiente, y después se le abre
       * una nueva con la hora del tiro. Sólo esa rama: saltar el turno, saltar
       * el poder y pasar no tocan el descarte, y la ventana que haya abierta
       * sigue valiendo porque la muestra no se movió.
       *
       * Antes esto lo hacía `reabreDescarte` y no resolvía nada: la vieja ya
       * se había cerrado por su reloj, así que no tenía qué resolver.
       */
      const cambiaLaMuestra = estado.fase === "levantada";
      const resuelto = cambiaLaMuestra ? antesDeCambiarLaMuestra(partida, t) : null;
      const base = resuelto ? resuelto.estado : estado;

      let avanzado;
      switch (base.fase) {
        case "turno": avanzado = motor.saltarTurno(base); break;
        // Se le tira la carta al ausente. Eso reabre los reflejos, así que
        // acá NO se pasa el turno: la mesa reacciona, el que tiró queda en
        // `postLevantada`, y un segundo rescate —el ausente sigue en
        // silencio— pasa el turno.
        case "levantada": avanzado = motor.tirarCarta(base); break;
        case "poder": avanzado = motor.saltarPoder(base); break;
        case "postLevantada": avanzado = motor.pasarTurno(base); break;
        // Resolver lo pendiente puede haber cortado la ronda: la entrega que
        // sale al azar deja sin cartas al que acertó. No queda nada que
        // saltar, y lo que hay que hacer es publicar ese corte.
        case "finRonda":
        case "finPartida": avanzado = base; break;
        default:
          throw error("failed-precondition", "No hay nada que saltar en esta fase.");
      }

      const siguiente = {
        ...partida,
        ...trasCambiarLaMuestra(partida, resuelto, avanzado, t),
        version: partida.version + 1,
      };
      publicar(tx, codigo, siguiente);
      return { salteado: enTurno, version: siguiente.version };
    });
  }

  /**
   * Deja lista una instancia de `intentarDescarte` antes de que haga falta.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * POR QUÉ
   * ─────────────────────────────────────────────────────────────────────────
   *
   * Las funciones son de primera generación: cada instancia atiende UN pedido
   * a la vez, y una instancia nueva tarda 3 a 4 segundos en arrancar —medido
   * en producción—. Un toque que cae en una instancia así llega tarde por
   * algo que el jugador no controla, y en una ventana de reapertura de tres
   * segundos eso es un descarte perdido seguro.
   *
   * Sellar la llegada al entrar al handler no alcanza para ese caso: el
   * arranque ocurre ANTES de que el handler exista. Lo que sí sirve es que el
   * arranque lo pague otro pedido, uno que no importa cuándo llega.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * POR QUÉ UNA LECTURA Y NO UNA LLAMADA VACÍA
   * ─────────────────────────────────────────────────────────────────────────
   *
   * Una llamada vacía calienta el contenedor y las claves con que se
   * verifican los tokens, pero NO la conexión con Firestore. Y esa conexión
   * es la otra mitad del problema: en producción, la primera llamada de cada
   * instancia pasó unos dos segundos dentro del handler, casi todos en su
   * primera transacción. Una lectura la abre.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * QUÉ LECTURA, Y POR QUÉ ÉSA
   * ─────────────────────────────────────────────────────────────────────────
   *
   * La vista propia, fuera de transacción:
   *
   *   - Fuera de transacción no toma bloqueos. Leer el documento de la partida
   *     dentro de una haría esperar a los descartes de verdad justo en la
   *     ventana, que es el problema que esto viene a resolver.
   *
   *   - Y sirve de control sin costo extra: la vista sólo existe para quien
   *     juega esa partida. Nadie de afuera recibe un «listo».
   *
   * No escribe, no anota ningún intento y no sube la versión. Cuesta una
   * lectura.
   */
  async function calentar({ uid, codigo }) {
    const vista = await refVista(codigo, uid).get();
    if (!vista.exists) {
      throw error("permission-denied", "No estás jugando esta partida.");
    }
    return { caliente: true };
  }

  /**
   * «He vuelto»: sale de la lista de ausentes por tiempo.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * QUÉ HACE, Y QUÉ NO
   * ─────────────────────────────────────────────────────────────────────────
   *
   * Lo saca de `ausentesPorTiempo` y nada más. Se reincorpora a la mano que se
   * está jugando AHORA: el turno que le saltearon mientras no estaba queda
   * perdido. No se le devuelve la jugada ni se le da un turno de más — eso
   * sería premiar la ausencia con una decisión que los otros tres no tuvieron.
   *
   * Si justo le toca a él, el próximo `publicar` calcula un plazo NUEVO de
   * ocho segundos: la marca del plazo de un ausente lleva `-ausente`, así que
   * deja de coincidir y `nuevo()` no conserva el vencimiento inmediato. Ver
   * el caso `turno` de `plazoDe`.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * Y POR QUÉ NO TOCA `ausentes`
   * ─────────────────────────────────────────────────────────────────────────
   *
   * Esa lista la mantiene `latir` desde los latidos, y quien puede apretar un
   * botón está latiendo: ya no figura ahí. Tocarla acá sería pisar el trabajo
   * de otra función con un dato que ella calcula mejor.
   *
   * Idempotente. Dos clics, o un reintento de la red, no escriben dos veces:
   * si ya no estaba, se contesta sin tocar la partida — y sin subir la versión,
   * que haría republicar las cuatro vistas por nada.
   */
  async function volver({ uid, codigo }) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(refPartida(codigo));
      const partida = exigirPartida(snap, codigo);
      if (partida.jugadores.indexOf(uid) < 0) {
        throw error("permission-denied", "No estás jugando esta partida.");
      }

      const previos = partida.ausentesPorTiempo ?? [];
      if (!previos.includes(uid)) {
        return { yaEstaba: true, version: partida.version };
      }

      const siguiente = {
        ...partida,
        ausentesPorTiempo: previos.filter((u) => u !== uid),
        // Volver es también una señal de vida: si justo después hubiera que
        // decidir quién está en silencio, que no se lo cuente como ido.
        latidos: { ...partida.latidos, [uid]: ahora() },
        version: partida.version + 1,
      };
      publicar(tx, codigo, siguiente);
      return { yaEstaba: false, version: siguiente.version };
    });
  }

  /**
   * Lee la partida para que `abandonarPartida` pueda cobrar y marcar el
   * abandono en UNA sola transacción.
   *
   * Existe separada de la escritura por una razón concreta: Firestore exige
   * que todas las lecturas de una transacción ocurran ANTES de cualquier
   * escritura. `moverLeyendas` lee y escribe, así que la partida hay que
   * leerla antes de que él toque nada, o la transacción falla en producción
   * —no en las pruebas, si las pruebas no lo comprueban.
   */
  async function leerPartidaParaAbandono(tx, codigo) {
    const snap = await tx.get(refPartida(codigo));
    return snap.exists ? snap.data() : null;
  }

  /**
   * Efecto del abandono sobre la mesa. No escribe: devuelve la partida.
   *
   * Su entrada ya está en el pozo y se queda. Se lo marca eliminado para que
   * los turnos lo salteen, y `abandono: true` lo distingue de un eliminado
   * por puntos: no es lo mismo perder que irse.
   *
   * Es pura para poder aplicarla VARIAS VECES antes de escribir. Vaciar una
   * mesa desierta marca a los cuatro de una vez, y dentro de una transacción
   * no se puede releer lo que uno mismo acaba de escribir: cuatro llamadas
   * con la misma partida de partida habrían dejado sólo el último abandono.
   *
   * @returns la partida con el abandono aplicado, o null si no cambió nada
   */
  function conAbandono(partida, uid) {
    if (!partida) return null;
    const indice = partida.jugadores.indexOf(uid);
    if (indice < 0) return null;
    if ((partida.abandonaron ?? []).includes(uid)) return null;

    const estado = {
      ...partida.estado,
      jugadores: partida.estado.jugadores.map((j, i) =>
        i === indice ? { ...j, eliminado: true, abandono: true } : j,
      ),
    };
    // Si le tocaba a él, el turno pasa al siguiente que siga jugando: la
    // partida tiene que poder continuar sin el que se fue.
    const enJuego = ["finRonda", "finPartida"].includes(estado.fase);
    const conTurno = estado.indiceTurno === indice && !enJuego
      ? motor.saltarTurno(estado)
      : estado;

    /**
     * Si no queda nadie jugando, la partida TERMINA acá.
     *
     * ─────────────────────────────────────────────────────────────────────
     * POR QUÉ NO TERMINABA SOLA
     * ─────────────────────────────────────────────────────────────────────
     *
     * El fin de partida se evalúa dentro de `cortar`, y cortar necesita que
     * alguien esté jugando. Con los cuatro afuera no cortaba nadie nunca: el
     * turno se le pasaba al siguiente activo y, como no había ninguno,
     * `siguienteActivo` devolvía el mismo índice. La partida giraba en
     * `turno` para siempre.
     *
     * Eso dejaba la sala en «jugando» con las entradas cobradas y el pozo
     * retenido, sin forma de cerrarla: es la mitad del problema de las salas
     * colgadas. La otra mitad era que nadie llamaba a `avanzarPartida` con
     * todas las pestañas escondidas, y la arregla el barredor.
     *
     * ─────────────────────────────────────────────────────────────────────
     * SIN DESEMPATE
     * ─────────────────────────────────────────────────────────────────────
     *
     * `comprobarFinPartida` sabe resolver «no queda nadie», pero cuando eso
     * pasa por PUNTOS manda a jugar una ronda de desempate. Acá no queda
     * nadie porque se fueron todos, y no hay a quién sentar a desempatar.
     * Termina sin ganador, y el cierre le devuelve el pozo a cada uno.
     *
     * Con uno solo en pie gana él, que es la regla de siempre: el último que
     * queda gana la partida.
     */
    const siguen = conTurno.jugadores.filter((j) => !j.eliminado);
    const terminada =
      siguen.length <= 1 && !enJuego
        ? {
            ...conTurno,
            fase: "finPartida",
            ganador: siguen[0] ?? null,
            desempate: false,
          }
        : conTurno;

    return {
      ...partida,
      estado: terminada,
      abandonaron: [...(partida.abandonaron ?? []), uid],
      version: partida.version + 1,
    };
  }

  /**
   * Lo mismo, escrito. Con la partida YA leída: sólo escribe.
   *
   * @returns true si cambió algo; false si ya estaba abandonado
   */
  function marcarAbandonoEn(tx, codigo, partida, uid) {
    const siguiente = conAbandono(partida, uid);
    if (!siguiente) return false;
    publicar(tx, codigo, siguiente);
    return true;
  }

  /**
   * Marca que un jugador abandonó. El cobro de la penalización NO ocurre acá:
   * lo hace `abandonarPartida`, que es la única función que mueve Leyendas.
   * Esto es sólo el efecto sobre la mesa.
   *
   * Su entrada ya está en el pozo y se queda. En el motor se lo marca como
   * eliminado para que los turnos lo salteen; sigue figurando entre los
   * jugadores, porque el pozo se calculó con él.
   */
  async function marcarAbandono({ codigo, uid }) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(refPartida(codigo));
      const partida = exigirPartida(snap, codigo);
      if (partida.jugadores.indexOf(uid) < 0) {
        throw error("permission-denied", "No estaba en esta partida.");
      }

      // Delega en `marcarAbandonoEn` en vez de repetir la marca.
      //
      // Eran dos copias del mismo cuerpo —ésta y la que usa
      // `abandonarPartida`— y ya se habían separado: al agregar el fin de
      // partida cuando no queda nadie, la otra lo aprendió y ésta no. Con eso,
      // abandonar desde el juego terminaba la partida y abandonar desde el
      // servidor la dejaba girando para siempre, según por dónde se hubiera
      // entrado. Una regla, un lugar.
      const marcado = marcarAbandonoEn(tx, codigo, partida, uid);
      return marcado
        ? { yaEstaba: false, version: partida.version + 1 }
        : { yaEstaba: true, version: partida.version };
    });
  }

  /**
   * Cierra la mesa que se quedó sin nadie.
   *
   * ───────────────────────────────────────────────────────────────────────
   * POR QUÉ EL BARREDOR SOLO NO ALCANZABA
   * ───────────────────────────────────────────────────────────────────────
   *
   * El barredor destraba la partida —le da los golpes que nadie estaba
   * dando— pero destrabar no es terminar. Una mesa en `turno` donde no queda
   * nadie recibe `saltarTurno`, y `saltarTurno` no hace más que correr el
   * turno al siguiente y anotar un renglón: no mueve una carta, no elimina a
   * nadie y no termina la ronda. Con los cuatro ausentes el turno da vueltas
   * a la mesa para siempre.
   *
   * Se vio en producción a los doce minutos de desplegar el barredor: dos
   * partidas, un paso cada una, cada minuto, `cerradas: 0` siempre. Ni un
   * error. Y cada vuelta escribía cinco documentos y le sumaba un renglón al
   * registro, que vive dentro del documento de la partida y tiene un tope de
   * un mega: la partida no se colgaba, se iba llenando.
   *
   * ───────────────────────────────────────────────────────────────────────
   * ES LA MISMA REGLA QUE YA EXISTÍA, APLICADA A LOS CUATRO
   * ───────────────────────────────────────────────────────────────────────
   *
   * No inventa una forma nueva de terminar una partida: marca el abandono
   * que ya sabía marcarse, con `conAbandono`, uno por jugador. Cuando no
   * queda ninguno en pie, esa misma función pone `finPartida`, y de ahí en
   * adelante todo es el camino de siempre: el plazo de `finPartida`, el
   * cierre, y el pozo devuelto por cabeza porque no hay a quién premiar.
   *
   * NO cobra la penalización de abandono. La cobra `abandonarPartida`, que
   * es una decisión de una persona; acá nadie decidió nada — la mesa se
   * murió sola, y encima por un fallo nuestro.
   */
  async function vaciarMesaDesierta({ codigo, silencioMs = MS_MESA_DESIERTA } = {}) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(refPartida(codigo));
      if (!snap.exists) return { vaciada: false, motivo: "no_existe" };

      const partida = snap.data();
      if (partida.cerrada) return { vaciada: false, motivo: "ya_cerrada" };

      const idos = partida.abandonaron ?? [];
      const quedan = partida.jugadores.filter(
        (uid, i) => !idos.includes(uid) && !partida.estado.jugadores[i]?.eliminado,
      );
      if (!quedan.length) return { vaciada: false, motivo: "no_queda_nadie" };

      // El latido MÁS RECIENTE de los que siguen en pie. Basta con que UNO
      // esté mirando para que la mesa no sea de nadie más que suya.
      const t = ahora();
      const latidos = partida.latidos ?? {};
      const ultimo = Math.max(...quedan.map((uid) => latidos[uid] ?? 0));
      const silencio = t - ultimo;
      if (silencio <= silencioMs) return { vaciada: false, motivo: "alguien_sigue", silencio };

      let acumulada = partida;
      const marcados = [];
      for (const uid of quedan) {
        const siguiente = conAbandono(acumulada, uid);
        if (!siguiente) continue;
        acumulada = siguiente;
        marcados.push(uid);
      }
      if (!marcados.length) return { vaciada: false, motivo: "nada_que_marcar" };

      // Una sola escritura para los cuatro: dentro de una transacción no se
      // relee lo propio, y publicar cuatro veces dejaría valer sólo la última.
      publicar(tx, codigo, acumulada);
      return {
        vaciada: true,
        marcados,
        silencio,
        fase: acumulada.estado.fase,
        version: acumulada.version,
      };
    });
  }

  return {
    repartir,
    repartirEn,
    leerPartidaParaAbandono,
    marcarAbandonoEn,
    vaciarMesaDesierta,
    avanzarPartida,
    cerrarMirada,
    abrirVentana,
    intentarDescarte,
    entregarCarta,
    cerrarVentana,
    accionDeTurno,
    latir,
    saltarAusente,
    volver,
    calentar,
    vencidas,
    marcarAbandono,
    ACCIONES,
  };
}
