/**
 * Límite de ritmo por jugador.
 *
 * Lo que de verdad se defiende acá no es el juego: las reglas ya rechazan las
 * jugadas inválidas y la ventana de reflejos ya acepta un intento por jugador.
 * Lo que se defiende es la factura. Una Cloud Function callable se puede
 * llamar en bucle desde una pestaña, y cada llamada lee y escribe Firestore.
 * Sin un techo, un solo navegador puede gastar plata sin ganar nada en el
 * juego.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Por qué hay dos almacenes y no uno
 * ────────────────────────────────────────────────────────────────────────
 *
 * La primera versión de esto contaba en Firestore para todo. Está mal por dos
 * razones, y la segunda es la grave:
 *
 * 1. Costo. Contar en Firestore agrega una lectura y una escritura a CADA
 *    llamada. `avanzarPartida` se llama cada 900 ms por jugador: cuatro
 *    jugadores son unas 264 llamadas por minuto en una sola mesa. El contador
 *    saldría más caro que lo que protege.
 *
 * 2. Latencia, que en este juego no es una molestia sino una injusticia.
 *    `intentarDescarte` decide quién reaccionó primero con una tolerancia
 *    técnica de 60 ms (ver PROTOCOLO-REFLEJOS.md). Meter una transacción de
 *    Firestore ANTES de resolver el intento agrega decenas de milisegundos
 *    **variables** a cada jugador por separado. Eso no retrasa a todos por
 *    igual: le mueve el reloj a uno y no al otro. El protocolo entero está
 *    construido para que los reflejos no sean una carrera de conexiones, y un
 *    contador mal puesto lo desarma desde adentro.
 *
 * Así que las acciones de juego se cuentan en memoria del proceso: cuesta
 * cero, no agrega ni un milisegundo, y alcanza para frenar el bucle de una
 * pestaña, que es la amenaza real. No es exacto entre instancias —quien abra
 * muchas conexiones a la vez puede tocar instancias distintas— y esa
 * imprecisión se acepta a cambio de no tocar el reloj de los reflejos.
 *
 * Las acciones de plata sí se cuentan en Firestore: son raras, no están en
 * ningún camino sensible al tiempo, y ahí la exactitud entre instancias vale
 * lo que cuesta.
 */

/**
 * Cuántas llamadas por minuto tolera cada acción.
 *
 * Los números no son redondos por gusto. `avanzarPartida` y `latir` los llama
 * un temporizador del navegador, no un dedo: a 900 ms son ~67 por minuto, y
 * hay que dejar aire para el golpe extra que dispara `visibilitychange` al
 * volver a la pestaña y para los reintentos tras un corte. Poner 30 acá
 * —que fue lo primero que se propuso— congela toda partida en curso a los
 * veintisiete segundos.
 */
export const LIMITES = {
  // El latido y el avance: los marca un reloj, no una persona.
  avanzarPartida: 150,
  latir: 150,

  // Reflejos y turno: los marca un dedo. Nadie hace tres por segundo.
  intentarDescarte: 90,
  accionDePartida: 90,
  abrirVentanaDescarte: 90,
  cerrarVentanaDescarte: 90,
  cerrarMirada: 90,
  saltarAusente: 60,
  // «He vuelto». Lo aprieta un dedo, una vez por ausencia: un jugador no
  // puede quedar marcado más de una vez cada veinte segundos. Treinta es
  // techo de sobra para una persona y corta el bucle de una pestaña.
  volver: 30,

  // Sala: se tocan unas pocas veces por partida.
  crearSala: 20,
  // La privada abre una sala y cobra una entrada, igual que `crearSala`.
  // Entrar con código tiene además su propio techo POR IP, que es el que
  // importa: ver `LIMITES_POR_IP`.
  crearSalaPrivada: 20,
  unirseConCodigo: 20,
  // La revancha abre una sala y cobra una entrada: es `crearSala` con otra
  // puerta, y lleva su mismo techo. No va en la tabla de plata por lo mismo
  // que no va `crearSala` —está en el camino del juego, y un contador en
  // Firestore por cada sala que se abre es una escritura en ese camino—.
  revanchaDeSala: 20,
  unirseASala: 20,
  marcarListo: 30,
  iniciarPartida: 20,
  salirDeSalaEnEspera: 20,
  abandonarPartida: 20,
  cerrarPartida: 30,
  horaDelServidor: 60,

  // Reportar. Se toca una vez cada muchas partidas, y encima hay un segundo
  // freno más fuerte en `reportes.js`: no se puede denunciar dos veces a la
  // misma persona en 24 horas. Este techo es contra el bucle de una pestaña.
  reportarJugador: 10,

  // Tienda de personalización. Ninguna de éstas mueve saldo —comprar sí, y por
  // eso está en la tabla de plata—: se tocan mirando la tienda y probándose
  // cosas, que es algo que se hace a mano y de a una.
  equiparItem: 30,
  desequiparItem: 30,
  misItems: 30,
  // La vitrina de logros del perfil. Se abre y se mira; no hay nada que tocar
  // repetido, así que alcanza con el mismo techo.
  misInsignias: 30,
  // Los paquetes de la tienda. Se leen al abrir la pantalla y al volver de
  // Mercado Pago; no hay nada que tocar repetido.
  listarPacks: 30,
  // La cartelera de torneos. Se mira, no se toca.
  listarTorneos: 30,
  // La del panel: la misma consulta sin el filtro. Se refresca a mano
  // después de cada paso del torneo, así que sale unas pocas veces.
  listarTorneosAdmin: 60,

  // Panel de administración.
  listarSalasAdmin: 60,
  cancelarSalaAdmin: 30,
  cancelarSalasEnEsperaAdmin: 10,
  editarSalaAdmin: 30,
  eliminarSalaAdmin: 30,
  // La limpieza recorre la colección entera y borra en lote. Se toca una
  // vez cada tanto, como el barrido de salas en espera, y lleva su techo.
  limpiarSalasCerradasAdmin: 10,
  listarReportesAdmin: 60,
  resolverReporteAdmin: 60,

  // Dar y quitar permisos de administrador. Se toca a mano y muy de vez en
  // cuando; un techo bajo acá no molesta a nadie y frena un bucle.
  listarAdministradores: 60,
  agregarAdministrador: 10,
  quitarAdministrador: 10,

  // Ver quién tiene un artículo recorre TODAS las compras que hubo, así que
  // es la consulta más cara del panel. Se mira antes de decidir si borrar
  // algo: de a una y pensándolo.
  listarPoseedoresItemAdmin: 20,
};

/** Las que mueven Leyendas. Se cuentan aparte y en Firestore. */
export const LIMITES_DE_PLATA = {
  acreditarReferido: 5,
  crearOrdenDeCompra: 5,
  // Comprar personalización descuenta Leyendas: mismo techo que las demás
  // que mueven saldo. Equipar y desequipar no mueven nada y van con el techo
  // común.
  comprarItem: 5,
  comprarPack: 5,
  // Inscribirse a un torneo cobra la entrada: mismo techo que todo lo que
  // mueve saldo.
  inscribirseATorneo: 5,

  // Quitarle un artículo a alguien le DEVUELVE lo que pagó, así que mueve
  // saldo y se cuenta acá. El borrado forzado hace una desposesión por
  // poseedor, y por eso tiene su propio techo, más bajo todavía: es la
  // operación más destructiva del panel.
  desposeerItemAdmin: 10,
  forzarBorrarItemAdmin: 3,
};

/** Si una acción no está en ninguna tabla, este es el techo. */
export const LIMITE_POR_OMISION = 60;

const UN_MINUTO = 60_000;

// ───────────────────────────────────────────────── contador en memoria

/**
 * Ventana deslizante por (uid, acción), viva sólo mientras viva la instancia.
 *
 * Se guardan las marcas de tiempo y no un simple número porque un contador
 * que se reinicia cada minuto redondo deja pasar el doble del límite justo en
 * el cambio de minuto: 90 al final de uno y 90 al principio del siguiente.
 */
const marcas = new Map();

/**
 * Cuántas entradas distintas se toleran antes de hacer limpieza.
 *
 * El Map lo llenan uids ajenos, así que sin un techo es una fuga de memoria a
 * la que la escribe cualquiera. Cuando se pasa, se tiran las entradas que ya
 * no tienen ninguna marca viva.
 */
const MAXIMO_DE_CLAVES = 10_000;

function limpiar(ahora) {
  for (const [clave, cuando] of marcas) {
    const vivas = cuando.filter((t) => ahora - t < UN_MINUTO);
    if (vivas.length) marcas.set(clave, vivas);
    else marcas.delete(clave);
  }
}

/**
 * Anota una llamada y dice si se pasó del límite.
 *
 * @returns {{ permitido: boolean, usadas: number, limite: number }}
 */
export function anotarEnMemoria(uid, accion, limite, ahora = Date.now()) {
  if (marcas.size > MAXIMO_DE_CLAVES) limpiar(ahora);

  const clave = `${uid} ${accion}`;
  const previas = marcas.get(clave) ?? [];
  const vivas = previas.filter((t) => ahora - t < UN_MINUTO);

  if (vivas.length >= limite) {
    // No se anota el rechazo: si lo anotáramos, quien insiste se extiende solo
    // el castigo para siempre y nunca vuelve a entrar.
    marcas.set(clave, vivas);
    return { permitido: false, usadas: vivas.length, limite };
  }

  vivas.push(ahora);
  marcas.set(clave, vivas);
  return { permitido: true, usadas: vivas.length, limite };
}

/** Para las pruebas: deja el contador como recién arrancado. */
export const olvidarTodo = () => marcas.clear();

/** Para las pruebas: cuántas claves vivas hay. */
export const cuantasClaves = () => marcas.size;

// ──────────────────────────────────────────────────────── el guardián

/**
 * Arma el guardián con sus dependencias, al modo del resto del proyecto: la
 * lógica se puede probar sin Firebase encima.
 *
 * @param db     Firestore. Sólo se usa para las acciones de plata.
 * @param error  Constructor de errores (`errorHttp` en index.js).
 * @param ahora  Reloj, inyectable para las pruebas.
 * @param ritmos Colección donde viven los contadores de plata.
 */
/**
 * Lo que se cuenta por IP y no por cuenta.
 *
 * Sólo entrar a una sala privada. El código es un secreto de ocho caracteres
 * y quien lo adivine entra a una mesa ajena: contra eso el techo tiene que
 * ser por origen, porque crear cuentas nuevas es gratis.
 *
 * Cinco por minuto. Una persona que recibió un código por mensaje lo copia y
 * lo pega: si se equivoca cinco veces en un minuto, esperar unos segundos no
 * le arruina nada.
 */
export const LIMITES_POR_IP = {
  unirseConCodigo: 5,
};

export function crearLimiteDeRitmo({ db, error, ahora = () => Date.now(), ritmos = "ritmos" }) {
  /**
   * El aviso que ve el jugador.
   *
   * `resource-exhausted` es el código que el SDK de Firebase traduce a 429.
   * El mensaje no dice cuántas llamadas quedan ni cuándo se libera: eso sólo
   * le sirve a quien está midiendo el techo para quedarse justo abajo.
   */
  const demasiado = () =>
    error("resource-exhausted", "Estás yendo muy rápido. Esperá unos segundos.");

  /**
   * Para las acciones del juego. No toca la red: decide y vuelve.
   *
   * Es intencionalmente síncrona. Si devolviera una promesa, cada llamada
   * agregaría un salto del bucle de eventos antes de resolver el intento de
   * descarte, que es justo lo que este archivo trata de no hacer.
   */
  function exigirRitmo(uid, accion) {
    const limite = LIMITES[accion] ?? LIMITE_POR_OMISION;
    const { permitido } = anotarEnMemoria(uid, accion, limite, ahora());
    if (!permitido) throw demasiado();
  }

  /**
   * Para las que mueven Leyendas. Cuenta en Firestore, con transacción.
   *
   * Lee y después escribe, nunca al revés: Firestore prohíbe leer después de
   * escribir dentro de una transacción y el proyecto ya tiene una prueba que
   * audita ese orden en todos los archivos (pruebas/transacciones.mjs).
   */
  async function exigirRitmoDePlata(uid, accion) {
    const limite = LIMITES_DE_PLATA[accion] ?? LIMITE_POR_OMISION;
    const ref = db.collection(ritmos).doc(`${uid}_${accion}`);
    const t = ahora();

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref); // ← leer primero
      const previas = snap.exists ? (snap.data().marcas ?? []) : [];
      const vivas = previas.filter((x) => t - x < UN_MINUTO);

      if (vivas.length >= limite) throw demasiado();

      vivas.push(t);
      tx.set(ref, { marcas: vivas, uid, accion }); // ← escribir después
    });
  }

  /**
   * Por IP, y en Firestore.
   *
   * En memoria no serviría: cada instancia tiene su propio contador y una
   * ráfaga reparte los intentos entre varias, que es justo lo que haría quien
   * está probando códigos. Acá la exactitud vale lo que cuesta, porque entrar
   * a una sala privada pasa una vez por partida y no está en ningún camino
   * sensible al tiempo.
   *
   * Lee y después escribe, como `exigirRitmoDePlata`.
   */
  async function exigirRitmoPorIP(ip, accion) {
    const limite = LIMITES_POR_IP[accion] ?? LIMITE_POR_OMISION;
    const ref = db.collection(ritmos).doc(`ip_${String(ip).replace(/[^\w.:-]/g, "_")}_${accion}`);
    const t = ahora();

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref); // ← leer primero
      const previas = snap.exists ? (snap.data().marcas ?? []) : [];
      const vivas = previas.filter((x) => t - x < UN_MINUTO);

      if (vivas.length >= limite) throw demasiado();

      vivas.push(t);
      tx.set(ref, { marcas: vivas, ip: String(ip), accion }); // ← escribir después
    });
  }

  return { exigirRitmo, exigirRitmoDePlata, exigirRitmoPorIP };
}
