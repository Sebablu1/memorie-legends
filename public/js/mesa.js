import {
  crearPartida,
  empezarRonda,
  mirar,
  terminarMirada,
  intentarDescarte,
  // Entregarle una carta a un rival ya estaba resuelto en el motor y lo usaba
  // sólo la mesa en red. Acá se cablea el mismo camino para entrenamiento: no
  // hizo falta tocar una línea de las reglas.
  intentarDescarteRival,
  cerrarVentanaDescarte,
  levantar,
  cambiarCarta,
  tirarCarta,
  usarPoderMirar,
  usarPoderCambio,
  resolverCambioConVista,
  saltarPoder,
  cortar,
  pasarTurno,
  MS_PASO_AUTOMATICO,
  MS_TURNO,
  MS_ENTRE_RONDAS,
  saltarTurno,
  siguienteRonda,
  PODERES,
  MS_ELEGIR_MIRADA,
  MS_MIRAR,
  MS_DESCARTE,
  MS_REAPERTURA,
  MS_CUENTA_REGRESIVA,
  MS_PARA_ENTREGAR,
  cartasMiradasEn,
  cartasExpuestas,
  yaIntentoLoSuyo,
  evaluarAtaque,
  posicionesAtacablesDe,
  ventanaTrasPoder,
} from "./reglas/motor.js";


import { crearTemporizadores, esperar } from "./modulos/temporizadores.js";
import { crearMedidorDeTiempos, encenderPanelDeTiempos } from "./modulos/tiempos.js";
import { crearInterfaz, escapar } from "./modulos/ui.js";
import { mostrarCargando, ocultarCargando } from "./spinner.js";
import {
  claseAsiento,
  clave,
  dibujarCarta,
  geometriaAbanico,
  estiloAbanico,
  asientoVacio,
  asientosParaMesa,
  dorsoDe,
  usarDorsoPropio,
  usarMazoCentral,
  dorsoDelMazo,
} from "./modulos/cartas.js";
import { retratoDe, usarRetratoPropio, RETRATO_INICIAL } from "./modulos/retratos.js";
import { esRutaDelSitio } from "./reglas/catalogo.js";
import { caraDeCarta } from "./reglas/baraja.js";
import { guardarVestuario, vestuarioGuardado } from "./modulos/vestuario.js";
import { LIMITE_ELIMINACION, puntosMano } from "./reglas/puntaje.js";
import * as IA from "./reglas/ia.js";
import { MODOS, ENTRADAS, ESTADOS_SALA, costoDeAbandonar } from "./reglas/salas.js";
import * as Red from "./partida-red.js";
import {
  elegibleParaPoder,
  pasoDelPoder,
  esperaUnaDecision,
  decisionQueVence,
  MS_PARA_DECIDIR,
  MS_GRACIA_ENTREGA,
} from "./reglas/red.js";
import { MS_REVELACION } from "./reglas/vista.js";
import { abandonarPartida, ErrorDeServidor } from "./servidor.js";
import { sonidos, alternarSilencio } from "./sonidos.js";
import { lanzarConfeti } from "./confeti.js";
import { exigirSesionEnMesa } from "./guardia-sesion.js";
// Espacio de nombres, y NO `import { equipadoEnMesa }`. Las cuarenta pruebas de
// la mesa sustituyen este módulo por uno que sólo exporta el guardia, y un
// import con nombre que el módulo no provee no es `undefined`: es un error de
// enlace de ESM que impide cargar la mesa entera. Con el espacio de nombres,
// una exportación que falta es una propiedad que falta, y `?.()` la tolera.
import * as Guardia from "./guardia-sesion.js";

// ------------------------------------------------------------ la puerta

/**
 * Sin sesión no se reparte.
 *
 * Va acá arriba, antes que cualquier otra cosa, y con `await` de módulo: todo
 * lo que sigue —incluido `crearPartida`, que corre suelto más abajo— queda
 * detenido hasta que Firebase diga quién entró. Ponerlo después habría dejado
 * una mesa repartida y visible durante el instante de la redirección.
 *
 * Vale para los dos modos. La mesa por Leyendas ya no funcionaba sin sesión
 * —el servidor rechaza cada llamada—, pero antes eso se descubría con un error
 * en mitad de la partida en vez de con una puerta al entrar.
 */
const miSesion = await exigirSesionEnMesa();

/**
 * El dorso y el retrato comprados, pedidos sin esperarlos.
 *
 * Son tres lecturas de Firestore —el perfil, y el artículo de cada uno— y no
 * hay una sola razón para que el jugador las espere mirando una pantalla en
 * blanco: las dos cosas son decoración. Se piden, la mesa arranca, y cuando
 * llegan se aplican y se redibuja.
 *
 * `Guardia.equipadoEnMesa` puede no existir: las pruebas de la mesa sustituyen
 * este módulo por uno de una sola función. Ahí `?.()` devuelve `undefined`, el
 * `await` lo resuelve y la mesa se dibuja con los dorsos y las caras de
 * siempre, que es justo lo que esas pruebas esperan ver.
 */
/**
 * Sólo rutas de este sitio tocan un `src`.
 *
 * `equipadoEnMesa` valida con `imagenEsArchivo`, que es la regla de la TIENDA
 * y deja pasar una URL de otro dominio: allá está bien, porque la tienda
 * muestra lo que el panel haya cargado. Acá no, y por la misma razón por la
 * que la vista en red filtra los retratos ajenos — una ruta de afuera haría
 * que el navegador le pida la imagen a ese servidor cada vez que alguien se
 * sienta a jugar.
 *
 * Vale también para lo que viene del caché local, que lo escribe cualquiera
 * que abra la consola del navegador.
 *
 * Lo que no pasa el filtro queda en `null`, que es «usá lo de la casa».
 */
const propio = (ruta) => (esRutaDelSitio(ruta) ? ruta : null);

/**
 * Lo que el navegador recuerda de la última vez, aplicado YA.
 *
 * Sin esto la mesa se dibujaba con las caras y los dorsos de la casa y lo
 * comprado aparecía medio segundo después, cuando volvían las tres lecturas
 * de Firestore. El salto se veía.
 *
 * Es una pista y no la verdad: puede estar vieja, y la lectura de abajo la
 * pisa igual. Lo que se gana es que el primer dibujo ya sea el correcto en
 * el caso normal —el jugador que vuelve a jugar con lo mismo puesto—.
 */
const recordado = vestuarioGuardado(miSesion?.uid);
let miDorso = propio(recordado?.dorso);
let miRetrato = propio(recordado?.retrato);
let miPano = propio(recordado?.pano);
let miMazo = propio(recordado?.mazo);

/**
 * Le dice a la capa de dibujo qué asiento lleva el dorso comprado.
 *
 * Se llama dos veces, y la segunda es la que importa: en una partida por
 * Leyendas el jugador local no es siempre el asiento cero —el servidor le dice
 * cuál le tocó cuando llega la primera vista— así que hay que volver a fijarlo
 * ahí. Sin eso, el dorso comprado aparecería en las cartas de otro.
 */
function aplicarDorsoPropio() {
  if (miDorso) usarDorsoPropio({ asiento: YO, ruta: miDorso });
  // El retrato se fija SIEMPRE, tenga o no un avatar comprado: retratoDe
  // necesita saber cuál es el asiento propio para no darle a un rival la
  // misma cara que lleva puesta el jugador local.
  usarRetratoPropio({ asiento: YO, ruta: miRetrato ?? RETRATO_INICIAL });
}

/**
 * Pone en la pantalla lo que dicen `miDorso`, `miRetrato`, `miPano` y
 * `miMazo`.
 *
 * Se llama DOS veces: una con lo que recordaba el navegador, antes de que
 * la mesa se dibuje, y otra cuando el servidor contesta. La segunda casi
 * siempre pone lo mismo que la primera, y por eso no se nota.
 */
function vestirLaMesa() {
  if (miMazo) usarMazoCentral(miMazo);

  /**
   * El paño comprado se pone con una variable, no repintando nada.
   *
   * Es una capa de fondo que ya está declarada en `.mesa` y que hasta acá
   * valía `none`. Escribir la variable la enciende: no hay que redibujar la
   * mesa ni esperar a la próxima jugada.
   *
   * Termina dentro de un `url()` de CSS, que a estos efectos es un `src`:
   * de ahí que la ruta venga filtrada por `propio`.
   */
  if (miPano) {
    document.querySelector(".mesa")?.style.setProperty(
      "--pano",
      `url("${miPano}") center / 100% 100% no-repeat`,
    );
  }

  aplicarDorsoPropio();
}

(async () => {
  const equipo = (await Guardia.equipadoEnMesa?.(miSesion?.uid)) ?? null;

  // La verdad, que puede confirmar lo que ya estaba puesto o corregirlo.
  const antes = `${miDorso}|${miRetrato}|${miPano}|${miMazo}`;
  miDorso = propio(equipo?.dorso);
  miRetrato = propio(equipo?.retrato);
  miPano = propio(equipo?.pano);
  miMazo = propio(equipo?.mazo);

  // Y se recuerda para la próxima. Se guarda lo que dijo el SERVIDOR, no
  // lo que había en el caché: si no, un caché envenenado se perpetuaría.
  guardarVestuario(miSesion?.uid, {
    retrato: miRetrato,
    dorso: miDorso,
    pano: miPano,
    mazo: miMazo,
  });

  if (`${miDorso}|${miRetrato}|${miPano}|${miMazo}` === antes) return;

  vestirLaMesa();
  // Si la mesa ya se dibujó, se repinta para que el cambio aparezca sin que
  // el jugador tenga que esperar a la próxima jugada.
  if (estado) dibujar();
})();

// ------------------------------------------------------------ referencias

const $ = (id) => document.getElementById(id);

const dom = {
  ronda: $("numeroRonda"),
  asientos: {
    abajo: $("asientoAbajo"),
    arriba: $("asientoArriba"),
    izq: $("asientoIzq"),
    der: $("asientoDer"),
  },
  mazoCarta: $("mazoCarta"),
  mazoContador: $("mazoContador"),
  levantadaCarta: $("levantadaCarta"),
  levantadaNota: $("levantadaNota"),
  pilaLevantada: $("pilaLevantada"),
  muestraCarta: $("muestraCarta"),
  descarteContador: $("descarteContador"),
  temporizador: $("temporizador"),
  temporizadorTexto: $("temporizadorTexto"),
  temporizadorRelleno: $("temporizadorRelleno"),
  pista: $("pista"),
  anuncio: $("anuncio"),
  btnLevantar: $("btnLevantar"),
  btnTirar: $("btnTirar"),

  /**
   * El renglón de texto de Tirar, y no el botón entero.
   *
   * El botón cambia de palabra cuando la carta levantada trae poder, y eso
   * se escribía con `btnTirar.textContent = ...`, que reemplaza TODO lo que
   * hay adentro. Desde que el botón lleva un dibujo, el primer redibujado
   * de la mesa se lo llevaba puesto: quedaba el único de los cuatro sin
   * ícono, y sin ningún error de por medio.
   */
  btnTirarTexto: document.querySelector("#btnTirar span"),
  btnCortar: $("btnCortar"),
  btnPasar: $("btnPasar"),
  btnHeVuelto: $("btnHeVuelto"),
  marcador: $("marcador"),
  registro: $("registro"),
  velo: $("velo"),
  modal: $("modal"),
  mesa: $("mesa"),
  reloj: $("relojTurno"),
  relojNumero: $("relojNumero"),
  relojRelleno: $("relojRelleno"),
  rondaLateral: $("rondaLateral"),
  corto: $("quienCorto"),
  confeti: $("confeti"),
  btnSonido: $("btnSonido"),
  btnAbandonar: $("btnAbandonar"),
  btnRegistro: $("btnRegistro"),
  panelRegistro: $("panelRegistro"),
  btnCerrarRegistro: $("btnCerrarRegistro"),
};

dom.btnSonido.addEventListener("click", () => {
  const callado = alternarSilencio();
  dom.btnSonido.textContent = callado ? "🔇" : "🔊";
  dom.btnSonido.title = callado ? "Activar sonidos" : "Silenciar sonidos";
  if (!callado) sonidos.clic();
});

// El registro sigue teniendo todo lo que tenía; sólo dejó de estar abierto
// permanentemente al lado de la mesa. Cerrado no ocupa nada del paño.
const alternarRegistro = (abrir) => {
  dom.panelRegistro.hidden = !abrir;
  dom.btnRegistro.title = abrir
    ? "Cerrar el registro"
    : "Ver el registro de jugadas";
};

dom.btnRegistro.addEventListener("click", () => {
  alternarRegistro(dom.panelRegistro.hidden);
  sonidos.clic();
});

dom.btnCerrarRegistro.addEventListener("click", () => alternarRegistro(false));

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !dom.panelRegistro.hidden) alternarRegistro(false);
});

// -------------------------------------------------------------- montaje

const CONFIG_POR_DEFECTO = {
  humanos: [{ nombre: "Vos" }],
  ias: [
    { nombre: "Nara", dificultad: "medio" },
    { nombre: "Bruno", dificultad: "dificil" },
    { nombre: "Vex", dificultad: "experto" },
  ],
};

/**
 * ¿Se llegó desde una sala? room.html manda ?sala=CODIGO.
 *
 * La mesa en red TODAVÍA no existe: el motor corre entero en el navegador y
 * baraja con el azar de cada máquina, así que cuatro jugadores abriendo esta
 * página obtendrían cuatro mazos distintos. Hasta que el estado de la partida
 * sea compartido, acá se valida el acceso y se explica la situación, en vez
 * de arrancar una partida contra la máquina haciéndola pasar por la partida
 * por la que el jugador pagó su entrada.
 */
const salaPedida = (new URLSearchParams(location.search).get("sala") ?? "")
  .trim()
  .toUpperCase();

function leerConfiguracion() {
  try {
    const guardada = JSON.parse(localStorage.getItem("configMesa"));
    if (guardada?.humanos?.length) return guardada;
  } catch {
    /* configuración inválida: se usa la de por defecto */
  }
  return CONFIG_POR_DEFECTO;
}

const config = leerConfiguracion();
const jugadoresConfig = [
  ...config.humanos.map((h, i) => ({
    id: `h${i}`,
    nombre: h.nombre,
    esIA: false,
  })),
  ...config.ias.map((a, i) => ({
    id: `ia${i}`,
    nombre: a.nombre,
    esIA: true,
    dificultad: a.dificultad,
  })),
];

/**
 * Índice del jugador que maneja este navegador.
 *
 * En entrenamiento siempre es el 0, porque la partida se arma acá. En una
 * partida por Leyendas lo dice la vista que manda el servidor: el orden de
 * los jugadores lo fijó él al repartir, y este navegador no elige su lugar.
 */
let YO = 0;

// El asiento propio se fija ya mismo, sin esperar a Firestore.
//
// Lo comprado puede tardar o no llegar nunca; cuál es la silla del jugador
// local se sabe desde el principio, y `retratoDe` lo necesita para no darle a
// un rival la misma cara. Sin esta llamada, una mesa sin nada comprado —que
// es la de la enorme mayoría— repartía la cara de la casa en el asiento
// propio.
//
// Y va DESPUÉS de `YO`, no junto a la lectura de Firestore que está más
// arriba: allá `YO` todavía está en su zona muerta y leerla es un
// ReferenceError que impide cargar la mesa entera.
//
// Se viste la mesa entera y no sólo el dorso: acá se aplica lo que el
// navegador recordaba de la última vez, ANTES de que se dibuje una sola
// carta. Ésa es la línea que saca el salto — la mesa abre ya vestida y la
// lectura de Firestore, cuando llega, casi siempre confirma lo mismo.
vestirLaMesa();

/**
 * Cómo corre esta mesa.
 *
 *   "entrenamiento"  el motor corre acá, contra la máquina, sin Leyendas.
 *   "leyendas"       el motor corre en el servidor. Acá sólo se dibuja lo
 *                    que llega y se piden acciones.
 *
 * Los dos caminos están separados a propósito. La mesa de entrenamiento
 * funciona hoy y no hay ninguna razón para tocarla; la de red no puede
 * reutilizar su bucle de turnos porque acá no se decide nada.
 */
const MODO = salaPedida ? "leyendas" : "entrenamiento";
const enRed = () => MODO === "leyendas";

/**
 * Datos económicos de esta mesa, tal como los conoce el navegador.
 *
 * Sirven ÚNICAMENTE para redactar el aviso previo. Lo que se cobra lo decide
 * el servidor leyendo la sala de Firestore: acá una cifra retocada sólo
 * conseguiría mentirle al propio jugador sobre lo que va a pagar.
 */
const partidaEconomica = {
  modo: salaPedida ? MODOS.LEYENDAS : MODOS.ENTRENAMIENTO,
  entrada: null,
  codigo: salaPedida || null,
};

/**
 * Semilla fija para el reparto, si la piden por la URL.
 *
 * Existe para que las pruebas de navegador puedan afirmar algo concreto: sin
 * esto, cada carga reparte otra mesa y lo único que se puede comprobar es que
 * "algo pasó". Con `?semilla=7` la partida es siempre la misma y una prueba
 * puede decir "la tercera carta de Nara es un 6".
 *
 * Sólo vale en entrenamiento. En partidas por Leyendas el reparto lo hace el
 * servidor y el navegador ni siquiera lo ve: `crearPartida` no se usa en ese
 * modo, así que esto no puede tocar una mesa donde haya dinero. Aunque
 * alguien lo escriba a mano en la barra de direcciones, lo único que consigue
 * es elegirse su propio mazo contra la máquina.
 */
const semillaPedida = Number(new URLSearchParams(location.search).get("semilla"));
/**
 * Con cuántos puntos se queda afuera en ESTA mesa.
 *
 * Lo elige el tablero (partida corta, normal o extendida) y viaja en
 * `configMesa`. Si no viene —una configuración vieja guardada, o alguien que
 * entró por la URL— el motor usa su valor de siempre, 150.
 *
 * Sólo vale para el entrenamiento. En una partida por Leyendas lo eligió quien
 * abrió la sala y el estado lo arma el servidor: este número no interviene, y
 * el cartel de la cabecera lee el del estado.
 */
const limitePedido = Number(config.limitePuntos);
const limitePuntos =
  !enRed() && Number.isFinite(limitePedido) && limitePedido > 0
    ? limitePedido
    : LIMITE_ELIMINACION;

const opcionesDeReparto = {
  ...(!enRed() && Number.isFinite(semillaPedida) && semillaPedida !== 0
    ? { semilla: semillaPedida }
    : {}),
  limitePuntos,
};

let estado = crearPartida(jugadoresConfig, opcionesDeReparto);

// El lema de la cabecera dice el límite de ESTA partida, no uno escrito a mano.
// Con las partidas cortas, un "límite 150" fijo estaría mintiendo — y es el
// único lugar donde el jugador puede confirmar qué eligió antes de empezar.
function actualizarLema() {
  const lema = $("lemaMesa");
  if (!lema) return;
  const cuantos = estado?.jugadores?.length || jugadoresConfig.length;
  const limite = estado?.limitePuntos ?? limitePuntos;
  lema.textContent = `Mesa de ${cuantos} · límite ${limite}`;
}
actualizarLema();
let memorias = estado.jugadores.map(() => IA.crearMemoria());

/**
 * Ausencia, en los dos modos.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA REGLA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Si alguien se queda ausente, se lo marca y la ronda SIGUE: los demás no
 * pierden tiempo esperando. Cuando vuelve, aprieta «he vuelto» y se reincorpora
 * a la mano en curso. El turno que le saltearon mientras no estaba, perdido.
 *
 * La señal es dejar vencer los veinte segundos de cortar o pasar sin tocar
 * nada. Es la decisión más pensada de la ronda: veinte segundos frente a ella
 * sin moverse dicen que la pestaña está abierta y nadie la mira.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EN RED HAY DOS LISTAS, Y ACÁ SE DIBUJAN LAS DOS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `ausentes` — por silencio. La calcula el servidor desde los latidos y la
 * rescata `saltarAusente`. Es quien se fue de verdad y no puede apretar nada.
 *
 * `ausentesPorTiempo` — por la señal de arriba. Sólo la vacía «he vuelto».
 *
 * Las dos se ven igual en la mesa —el asiento apagado—, porque para los otros
 * tres significan lo mismo: ése no está. Pero el botón sale sólo por la
 * segunda: a uno mismo nunca se lo ve en la primera, porque `latir` excluye a
 * quien llama, y quien puede apretar un botón está latiendo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EN ENTRENAMIENTO, UNA VARIABLE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * No hay servidor ni latidos, y la IA no se va. El único que puede ausentarse
 * es uno mismo. No va en el estado del motor: en red la ausencia tampoco vive
 * ahí, vive en la partida — es algo de la mesa, no del juego.
 */
let ausenteLocal = false;

/** El avance automático de ronda que está esperando, para poder cancelarlo. */
let avanceDeRondaPendiente = null;

/** Si la última vez que se dibujó yo estaba marcado. Ver `actualizarBotones`. */
let estabaMarcado = false;

/** ¿El jugador `i` está ausente, por cualquiera de las dos causas? */
function estaAusente(i) {
  if (!enRed()) return i === YO && ausenteLocal;
  const id = miVista?.jugadores?.[i]?.id;
  if (!id) return false;
  return (
    (miVista.ausentes ?? []).includes(id) ||
    (miVista.ausentesPorTiempo ?? []).includes(id)
  );
}

/** ¿Me toca apretar «he vuelto»? Sólo por la lista de ausentes por tiempo. */
function estoyMarcado() {
  if (!enRed()) return ausenteLocal;
  return (miVista?.ausentesPorTiempo ?? []).includes(miUid);
}

/**
 * «He vuelto».
 *
 * En red lo decide el servidor, que saca el uid de la sesión. En entrenamiento
 * alcanza con apagar la marca: el ciclo de turnos lo lee en cada vuelta, así
 * que el próximo turno propio ya se espera como siempre.
 *
 * No devuelve nada. Si justo le saltearon el turno, ése se perdió — darle otro
 * sería premiar la ausencia con una decisión que los demás no tuvieron.
 */
async function heVuelto() {
  if (enRed()) {
    await pedir("volver", () => Red.volver(salaPedida));
    return;
  }
  ausenteLocal = false;
  // Si la ronda terminó mientras no estaba, «Siguiente ronda» se iba a apretar
  // sola. Ahora que volvió, la aprieta él cuando quiera.
  clearTimeout(avanceDeRondaPendiente);
  avanceDeRondaPendiente = null;
  sonidos.clic();
  dibujar();
}

/**
 * Ritmo de la mesa. Cada acción se deja respirar para que se entienda
 * qué pasó antes de que ocurra la siguiente.
 */
/**
 * Los relojes de la mesa, de un vistazo. Los números viven en `reglas/`.
 *
 *   - `MS_TURNO` (8 s) — levantar del mazo. Si se agota, se pierde la
 *     levantada y el turno pasa al siguiente.
 *   - `MS_PARA_DECIDIR` (10 s) — qué hacer con la carta que ya se tiene en la
 *     mano: tirarla, cambiarla, usar el poder.
 *   - `MS_PASO_AUTOMATICO` (20 s) — cortar o pasar. Es el más largo porque es
 *     la decisión que más se piensa, y perderla por apuro se paga en puntos.
 *
 * Ya no queda ninguna acción sin reloj: una mesa donde alguien puede no hacer
 * nada indefinidamente es una mesa que los otros tres abandonan.
 *
 * `MS_TURNO` se importa del motor —ver la nota que tiene allá— en vez de
 * declararse acá, que es como estaba y como se separan las copias.
 */

/**
 * Los dos relojes de la mesa. Ver modulos/temporizadores.js.
 *
 * Se les dan nombres sueltos a sus métodos porque el archivo los llama por su
 * nombre en una docena de sitios, y renombrarlos todos habría mezclado en un
 * mismo cambio dos cosas: mover código y reescribir a quien lo usa. Lo segundo
 * se ve fácil en el diff; lo primero no.
 */
const relojes = crearTemporizadores({ dom, msTurno: MS_TURNO });

/**
 * Cuánto dura de verdad cada fase.
 *
 * Mide siempre, aunque nadie mire: el panel de `?debug-tiempos=1` se puede
 * abrir a mitad de partida y el historial tiene que estar entero. Cuesta un
 * objeto por fase.
 *
 * Mide la BARRA GRANDE, que es el reloj de la fase: mirada, descarte, entrega
 * y los poderes. El aro del turno es otro reloj, con su propio dibujo, y no
 * pasa por acá.
 */
const tiempos = crearMedidorDeTiempos();

const correrTemporizador = (ms, fase) => {
  tiempos.abrir(fase ?? estadoDeFase(), ms);
  relojes.correr(ms);
};
const cancelarTemporizador = () => {
  tiempos.cerrar("cancelado");
  relojes.cancelar();
};

/**
 * El nombre por defecto de una fase medida: el que usa el motor.
 *
 * Sale de `estado` y no de la vista aunque se juegue en red: allá `estado` es
 * lo que devuelve `comoEstado(vista)`, o sea la misma fase, y así esto no
 * depende de una variable que se declara mil líneas más abajo.
 */
const estadoDeFase = () => estado?.fase ?? "?";
const cancelarRelojTurno = relojes.cancelarRelojTurno;
const pintarReloj = relojes.pintarReloj;
// El remate se queda acá: qué hacer al llegar a cero depende de la partida.
const iniciarRelojTurno = (fase, indice, alVencer, ms) =>
  relojes.iniciarRelojTurno(fase, indice, alVencer, ms);

const RITMO = {
  entreTurnos: 1100,
  trasLevantar: 1400,
  trasDecidir: 1100,
  anunciarPoder: 1300,
  trasPoder: 1200,
  antesDeResolver: 1000,
  trasCorte: 1600,
};

/**
 * Cuánto dura la marca sobre una carta que alguien acaba de mirar.
 *
 * Un segundo: lo justo para que la mesa registre QUE pasó algo. No revela el
 * número —eso sería regalar el poder— sino que esa carta fue vista, que es
 * información legítima y pública: los demás pueden contar con que ese jugador
 * ahora sabe algo.
 */
const MS_MARCA_PODER = 1000;

const TITULOS_PODER = {
  mirarPropia: "Mirar una carta propia",
  mirarRival: "Mirar una carta de un rival",
  cambioCiego: "Cambio a ciegas",
  cambioConVista: "Cambio viendo ambas cartas",
};

/**
 * Carteles, marcas y modales. Ver modulos/ui.js.
 *
 * Va acá arriba, y no donde estaba cada función, porque necesita RITMO,
 * TITULOS_PODER y MS_MARCA_PODER ya declarados: un `const` al que se accede
 * antes de su línea no es undefined, es un error de arranque.
 */
const interfaz = crearInterfaz({
  dom,
  sonidos,
  titulos: TITULOS_PODER,
  esperar,
  msAnuncio: RITMO.anunciarPoder,
  msMarcaPoder: MS_MARCA_PODER,
});
const { pista, abrirModal, cerrarModal, marcarEfecto,
        mostrarCartel, marcarManoMirada, anunciarPoder, efectoCambio } = interfaz;

/**
 * Los carteles cortos, en un solo sitio.
 *
 * Antes cada aviso repetía la frase que había escrito el motor —"Ana miró una
 * carta de Bruno"— y eso ataba la interfaz a la redacción del registro: cambiar
 * el texto de una línea cambiaba lo que se veía flotando sobre la mesa. Acá el
 * cartel se elige por lo que PASÓ, no por cómo se contó.
 *
 * Los iconos son los mismos que usa el cartel de poder para los mismos poderes,
 * a propósito: el 7 se anuncia con 👁 y se confirma con 👁.
 */
const CARTELES = {
  mirarPropia:  ["👁", "Miró"],
  mirarRival:   ["🔍", "Miró"],
  cambio:       ["🔄", "Cambio"],
  sinCambio:    ["🤝", "Sin cambio"],
  tuTurno:      ["🃏", "Tu turno"],
  decidir:      ["✂️", "Decidí"],
};

/** Muestra uno de CARTELES por su nombre. `tuyo` lo pinta en dorado. */
const cartel = (nombre, { tuyo = false } = {}) => {
  const par = CARTELES[nombre];
  if (!par) return;
  mostrarCartel(par[0], par[1], { clase: tuyo ? "tuyo" : "" });
};

/** Cartas reveladas de forma temporal: claves "indiceJugador:posicion". */
/** Posición propia elegida para un poder de cambio, mientras se elige la rival. */
let seleccionPropia = null;

/**
 * Reloj del turno. Un turno tiene hasta tres decisiones (levantar, cambiar o
 * tirar, y cortar o pasar) y cada una tiene su propia cuenta de 8 segundos.
 * `fase` guarda en cuál arrancó, para reiniciarlo cuando el turno avanza.
 */

// --------------------------------------------------------------- dibujo

/**
 * Cartas destapadas en este instante: `posición → carta`, o `null` cuando la
 * carta ya está en la mano y sólo hace falta darla vuelta.
 *
 * No queda ningún registro de lo que se destapó. Pasados los dos segundos la
 * carta se vuelve a tapar y no queda marca: quien no se acordó, la perdió.
 */
const revelaciones = new Map();




/**
 * Fases en las que "el turno" quiere decir algo.
 *
 * En la mirada y en el descarte NO le toca a nadie: puede actuar todo el mundo
 * a la vez. Marcar ahí al jugador de mano —que es lo que hacía— le decía a esa
 * persona que era su turno durante toda la ventana de reflejos, y seguía
 * diciéndoselo después. Se leía como que el turno nunca avanzaba, cuando en
 * realidad todavía no había empezado.
 *
 * En el final de ronda tampoco: ahí se está mirando el marcador.
 */
const FASES_CON_TURNO = new Set(["turno", "levantada", "postLevantada", "poder"]);

/**
 * La cara de un asiento.
 *
 * En una partida por Leyendas el retrato VIAJA EN LA VISTA: es el avatar que
 * cada quien tenía puesto al sentarse, fijado por el servidor al repartir.
 * En entrenamiento no viene ninguno —los rivales son IA y no tienen perfil—
 * y se usa la cara de la casa que le toca a esa silla.
 *
 * El de la vista gana también para uno mismo, aunque `retratoDe` sepa cuál
 * es el avatar comprado. Si no, alguien que se cambia el avatar a mitad de
 * la partida se vería distinto de como lo ven los otros tres, y la mesa
 * dejaría de ser una sola cosa mirada desde cuatro lugares.
 *
 * La ruta se vuelve a mirar acá aunque el servidor ya la haya mirado antes
 * de guardarla. No es desconfianza del servidor: es que este valor termina
 * dentro de un `src`, y lo que entra en un `src` se comprueba donde se
 * escribe, no donde se originó. Una ruta que no sea de este sitio cae a la
 * cara de la casa en vez de pedirle una imagen a un dominio ajeno.
 */
const caraDe = (jugador, i) =>
  esRutaDelSitio(jugador?.retrato) ? jugador.retrato : retratoDe(i);

/**
 * El reverso de las cartas de un jugador.
 *
 * En una partida por Leyendas viaja en la vista, así que los cuatro ven el
 * dorso que cada uno compró. Sin eso, quien se compraba uno lo veía sólo en
 * su propia pantalla y para los demás seguía con el del asiento — que es
 * exactamente lo contrario de comprarse algo para que se vea.
 *
 * En entrenamiento no viene ninguno y manda `dorsoDe`, que ya conoce la
 * excepción del asiento propio.
 */
const reversoDe = (jugador, i) =>
  esRutaDelSitio(jugador?.dorso) ? jugador.dorso : dorsoDe(i);

/**
 * El marco que rodea la cara, si compró uno.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ES UNA CAPA ENCIMA, NO UN BORDE
 * ─────────────────────────────────────────────────────────────────────
 *
 * Un `border` en el retrato empujaría la cara hacia adentro y cambiaría su
 * tamaño, así que los cuatro asientos dejarían de medir lo mismo según quién
 * tenga marco. Va como imagen superpuesta y en posición absoluta: ocupa el
 * mismo lugar que la cara y no mueve nada.
 *
 * `esRutaDelSitio` otra vez, como con el retrato y el dorso: lo que viene en
 * la vista lo escribió el servidor, pero un `src` que apunte afuera del sitio
 * es una filtración de que este jugador está mirando la mesa.
 */
function marcoDe(jugador) {
  if (!esRutaDelSitio(jugador?.marco)) return "";
  return `<img class="marco-avatar" src="${escapar(jugador.marco)}" alt="" aria-hidden="true" />`;
}

/**
 * El título que eligió mostrar, al lado del nombre.
 *
 * A diferencia del resto de lo que se luce, esto es TEXTO escrito por un
 * administrador en el catálogo. Va escapado, y el servidor ya lo recortó a 24
 * caracteres para que no empuje el nombre fuera del asiento.
 */
function tituloDe(jugador) {
  const titulo = String(jugador?.titulo ?? "").trim();
  if (!titulo) return "";
  return `<span class="titulo-jugador">${escapar(titulo)}</span>`;
}

/**
 * La insignia que el jugador eligió mostrar, o la dificultad de la IA.
 *
 * Son dos cosas distintas ocupando el mismo lugar, y está bien: las dos
 * responden «quién es éste». En entrenamiento los rivales son máquinas y lo
 * que hace falta saber de ellas es cuánto aprietan; en una partida por
 * Leyendas son personas y lo que muestran es lo que ganaron.
 *
 * La insignia se dibuja como imagen con su `alt`: es un logro y tiene
 * nombre, a diferencia del retrato, que es decoración y va con `alt` vacío.
 */
function marcaDe(jugador) {
  if (esRutaDelSitio(jugador?.insignia)) {
    return `<img class="insignia-mesa" src="${escapar(jugador.insignia)}" alt="Insignia" />`;
  }
  return jugador.esIA
    ? `<span class="insignia">${IA.DIFICULTADES[jugador.dificultad]?.etiqueta ?? "IA"}</span>`
    : "";
}

function dibujarJugador(jugador, i) {
  const enTurno =
    FASES_CON_TURNO.has(estado.fase) &&
    i === estado.indiceTurno &&
    !jugador.eliminado;
  const propio = i === YO;
  const rondaTerminada =
    estado.fase === "finRonda" || estado.fase === "finPartida";

  /**
   * La mano se dibuja SIN los huecos, pero cada carta conserva su posición.
   *
   * ─────────────────────────────────────────────────────────────────────
   * DE DÓNDE SALÍAN LOS HUECOS
   * ─────────────────────────────────────────────────────────────────────
   *
   * Cuando a alguien le comen, le descartan o le cambian una carta, el motor
   * deja un `null` en ese lugar del arreglo — y tiene que dejarlo, porque las
   * posiciones son la dirección de cada carta. Pero el abanico se dibujaba
   * recorriendo el arreglo entero, así que el `null` ocupába su lugar: una
   * mano de cuatro a la que le sacaron la segunda se veía con un agujero en el
   * medio y repartida como si todavía fueran cuatro.
   *
   * ─────────────────────────────────────────────────────────────────────
   * LA TRAMPA: HAY DOS POSICIONES Y NO SON LA MISMA
   * ─────────────────────────────────────────────────────────────────────
   *
   * `data-posicion` es el PROTOCOLO. El motor y el servidor direccionan las
   * cartas por su lugar original, y toda la mesa —descartar, entregar, los
   * poderes— lee ese atributo para saber de qué carta habla. Si se compactara
   * también eso, tocar la tercera carta jugaría la cuarta.
   *
   * El índice del abanico es DIBUJO. Es el que hay que compactar, y el que se
   * le pasa a `estiloAbanico` junto con la cuenta de las que quedan, para que
   * la mano se reparta entre las que hay y no entre las que hubo.
   *
   * ─────────────────────────────────────────────────────────────────────
   * LA CARTA REVELADA SIGUE OCUPANDO SU LUGAR
   * ─────────────────────────────────────────────────────────────────────
   *
   * La del que llegó tarde ya salió de la mano y se dibuja un momento en su
   * hueco. Mientras dure esa revelación cuenta como carta —por eso el filtro
   * la incluye— y cuando se apaga, la mano se cierra sola en el dibujado
   * siguiente. Sin eso, la carta aparecería y desaparecería corriendo a las
   * demás dos veces.
   */
  const enLaMano = jugador.mano
    .map((carta, pos) => ({ carta, pos }))
    .filter(({ carta, pos }) => carta || revelaciones.has(clave(i, pos)));

  const geometria = geometriaAbanico(enLaMano.length, propio);
  const manoHTML = enLaMano
    .map(({ carta, pos }, enElAbanico) => {
      // La carta destapada se muestra dos segundos y se vuelve a tapar.
      const llave = clave(i, pos);
      const destapada = revelaciones.has(llave);
      /**
       * Lo revelado le gana a lo que hay en la mano.
       *
       * Estaba al revés —`carta ?? revelada`— y en red eso tapaba todo lo que
       * llega por la respuesta y no por la vista: la mirada inicial, el 7, el
       * 8 y el 10. La mano propia llega como el marcador `{ oculta: true }`,
       * que no es `null`, así que ganaba, y un marcador se dibuja de dorso
       * aunque se lo pida boca arriba.
       *
       * En entrenamiento no se notaba, y sigue igual: ahí la mano tiene la
       * carta de verdad y la revelación es un `null` que sólo dice «dala
       * vuelta», así que sigue ganando la de la mano.
       */
      return dibujarCarta(revelaciones.get(llave) ?? carta, {
        visible: rondaTerminada || destapada,
        asiento: i,
        // La de siempre: es como la nombra el motor.
        posicion: pos,
        // La compactada: es dónde se dibuja.
        estilo: estiloAbanico(enElAbanico, enLaMano.length, geometria),
        // La marca de que esta carta se acaba de mirar: el ojo de un poder,
        // o el borde de la mirada del principio de la ronda.
        clases: miradas.get(llave)?.clase ?? "",
        // El dorso que compró ESTE jugador, no el que le tocaría al asiento.
        dorso: reversoDe(jugador, i),
      });
    })
    .join("");

  const insignia = marcaDe(jugador);
  const marco = marcoDe(jugador);

  // Ausente por cualquiera de las dos causas: para los otros tres significan
  // lo mismo. El texto es fijo y no sale de ningún dato del jugador, así que
  // no hay nada que escapar.
  const ausente = !jugador.eliminado && estaAusente(i);
  const marcaDeAusente = ausente ? ' <span class="marca-ausente">ausente</span>' : "";
  const titulo = tituloDe(jugador);

  /**
   * "Ronda" es lo que se anotó en la ronda ANTERIOR, no un marcador en vivo.
   *
   * No es una limitación que convenga arreglar: es el juego. Lo que uno
   * sumaría si la ronda terminara ahora es la cuenta de las cartas que tiene
   * en la mano, y esas cartas están tapadas —para los rivales y también para
   * uno mismo, que es de lo que se trata—. Un número que dijera Ronda 32
   * mientras se juega estaría revelando las cuatro cartas de golpe.
   *
   * Por eso el motor pone puntosRonda recién al resolver el corte, y por eso
   * ese campo sí viaja a todos en la vista: cuando existe, ya es público.
   * Arranca en cero en cada reparto.
   */

  return `
    <div class="jugador ${claseAsiento(i)} ${enTurno ? "en-turno" : ""} ${propio ? "propio" : ""} ${jugador.eliminado ? "eliminado" : ""} ${ausente ? "ausente" : ""}"
         data-jugador="${i}">
      <div class="cabecera-jugador">
        <span class="retrato ${claseAsiento(i)} ${marco ? "con-marco" : ""}" data-asiento="${i}">
          <span class="cara"><img src="${escapar(caraDe(jugador, i))}" alt="" /></span>
          ${marco}
          <b class="cuenta-asiento" aria-hidden="true"></b>
        </span>
        <div class="datos">
          <div class="nombre">${escapar(jugador.nombre)} ${titulo} ${insignia}${marcaDeAusente}</div>
          <div class="puntos">
            <span class="parcial">Ronda <b>${jugador.puntosRonda ?? 0}</b></span>
            <span class="acumulado">Total <b>${jugador.puntos}</b></span>
          </div>
        </div>
      </div>
      <div class="mano" style="--escala:${geometria.escala}">${manoHTML}</div>
    </div>`;
}

/** Puntos de la ronda y nada más: es un dato de consulta al costado del paño. */
function dibujarMarcador() {
  if (dom.rondaLateral) dom.rondaLateral.textContent = estado.ronda || "-";

  dom.marcador.innerHTML = estado.jugadores
    .map(
      (j, i) => `
        <div class="marcador-fila ${j.eliminado ? "fuera" : ""}">
          <img class="retrato-mini ${claseAsiento(i)}" src="${escapar(caraDe(j, i))}" alt="" />
          <span>${escapar(j.nombre)}</span>
          ${i === estado.indiceCortador ? '<i class="tijera" title="Cortó la ronda">✂</i>' : ""}
          <b>${j.puntos}</b>
        </div>`,
    )
    .join("");

  // Quién cortó, escrito con todas las letras debajo de la tabla.
  //
  // La tijera de la fila lo dice, pero sólo si uno sabe qué significa la
  // tijera. Este pie es la primera vez que alguien lo aprende, y desaparece
  // mientras nadie cortó en vez de quedarse ocupando el lugar en blanco.
  if (dom.corto) {
    const quien = estado.jugadores[estado.indiceCortador]?.nombre;
    dom.corto.hidden = !quien;
    dom.corto.innerHTML = quien
      ? `<i aria-hidden="true">✂</i> Cortó <b>${escapar(quien)}</b>`
      : "";
  }
}

function dibujarRegistro() {
  const ultimas = estado.registro.slice(-40).reverse();
  dom.registro.innerHTML = ultimas
    .map(
      (l, idx) =>
        `<div class="${idx === 0 ? "destacado" : ""}">R${l.ronda} · ${escapar(l.texto)}</div>`,
    )
    .join("");
}

function dibujar() {
  // Antes de reconstruir el paño: si el motor anotó una mirada desde la última
  // pasada, que su ojo entre en ESTE dibujado y no en el siguiente. En red no
  // corre — allá las miradas llegan por la vista, en `mostrarMiradas`.
  if (!enRed()) ojosDelRegistroLocal();

  dom.ronda.textContent = estado.ronda || "-";
  // Las fases que vengan se anotan en esta ronda. Va acá porque el dibujado
  // es lo único que corre en los dos modos cada vez que algo cambia.
  tiempos.ronda(estado.ronda);
  // En red el estado llega después de montar la mesa: el límite y cuántos se
  // sentaron no se saben hasta el primer dibujado con datos.
  actualizarLema();

  // El color del cartel sale de la fase, y de acá sale la fase.
  //
  // Va como atributo y no como clase para que el CSS tenga UN lugar donde
  // mirar: `[data-fase="descarte"]` y listo, sin ir agregando y sacando media
  // docena de clases que después hay que acordarse de limpiar.
  if (dom.anuncio) dom.anuncio.dataset.fase = estado.fase ?? "";

  /**
   * Uno siempre se sienta abajo.
   *
   * ─────────────────────────────────────────────────────────────────────
   * POR QUÉ LOS ASIENTOS SE ROTAN
   * ─────────────────────────────────────────────────────────────────────
   *
   * `asientosParaMesa` devuelve los lugares en orden de juego empezando por
   * abajo, y esto los asignaba por índice de jugador. En entrenamiento
   * funcionaba de casualidad: ahí uno es siempre el jugador 0, así que el 0
   * caía abajo.
   *
   * En una partida por Leyendas el asiento lo reparte el servidor, y al
   * tercero en entrar le tocaba `arriba`: jugaba la partida entera mirando
   * sus propias cartas del otro lado de la mesa, con las de un rival
   * adelante. Y como su mano se dibujaba en el asiento chico, sus cartas
   * —las únicas que toca contra reloj— eran las más chicas de la pantalla.
   *
   * Rotando por `YO`, cada uno se ve abajo y ve a los demás en el mismo
   * orden de juego que tienen sentados. En entrenamiento `YO` es 0 y la
   * cuenta da exactamente lo de antes.
   */
  const orden = asientosParaMesa(estado.jugadores.length);
  const lugares = orden.length;
  Object.values(dom.asientos).forEach((el) => (el.innerHTML = ""));
  estado.jugadores.forEach((jugador, i) => {
    const asiento = orden[(i - YO + lugares) % lugares] ?? "arriba";
    dom.asientos[asiento].innerHTML += dibujarJugador(jugador, i);
  });

  // Con dos o tres jugadores sobran lugares en la mesa. Se dibujan vacíos
  // en vez de desaparecer, para que la mesa se lea como una mesa de cuatro.
  Object.entries(dom.asientos).forEach(([nombre, el]) => {
    if (!orden.includes(nombre)) el.innerHTML = asientoVacio();
  });

  /**
   * La muestra, tapada mientras dura la mirada.
   *
   * El motor la pone boca arriba al repartir, y está bien que lo haga: la
   * muestra es pública desde que empieza la ronda. Pero mostrarla YA le da al
   * jugador dos cosas a la vez —elegir qué carta propia mirar, y memorizar la
   * muestra— justo en los dos segundos en que tendría que estar mirando la
   * suya. En el teléfono, donde todo entra en una pantalla, se veía como que
   * la muestra se daba vuelta antes de tiempo.
   *
   * Así que acá se dibuja de dorso hasta que la mirada termina. No cambia el
   * estado ni las reglas: cuando abre la ventana de descarte —que es cuando la
   * muestra importa— ya está dada vuelta para todos.
   *
   * EN LOS DOS MODOS. Estaba puesto sólo en entrenamiento, con el argumento
   * de que en red el ritmo lo marca el servidor y retener la muestra acá
   * desincronizaría lo que se ve de lo que vale. No se sostiene: la fase
   * sale de la vista que manda el servidor, igual que todo lo demás que se
   * dibuja, y esto no toca el estado —lo dice el párrafo de arriba—.
   *
   * Lo que sí hacía era darle al que juega por Leyendas dos segundos de
   * ventaja sobre el que entrena: veía con qué carta iba a tener que
   * comparar mientras todavía estaba memorizando la suya. Dos modos que
   * comparten motor no pueden repartir información distinta.
   */
  const muestra = estado.descarte[0];
  const muestraTapada = estado.fase === "mirar";
  dom.muestraCarta.innerHTML = muestra
    ? dibujarCarta(muestra, { visible: !muestraTapada })
    : `<div class="hueco vacio"></div>`;
  dom.descarteContador.textContent = `${estado.descarte.length} en la pila`;

  const puedeLevantar = estado.fase === "turno" && estado.indiceTurno === YO;
  // El mazo se dibuja como una carta OCULTA, no como una carta vacía.
  //
  // Iba con `{ imagen: "", numero: "", palo: "" }`, y eso hace que
  // `dibujarCarta` pinte las dos caras: el dorso, y una cara con
  // `<img src="">`. Un `src` vacío no es una imagen que falta —el navegador
  // lo resuelve contra la URL de la página y se descarga `mesa.html` como si
  // fuera un PNG, en cada redibujado— y encima queda un nodo de imagen rota
  // detrás del dorso, donde no se ve.
  //
  // `oculta` es exactamente esto y ya existía: la usan las cartas de los
  // rivales en red, cuya cara no viaja. El nombre accesible no cambia
  // —"Carta, boca abajo" en los dos casos— y lo que se ve, tampoco.
  dom.mazoCarta.innerHTML = estado.mazo.length
    ? dibujarCarta(
        { oculta: true },
        {
          visible: false,
          asiento: 0,
          clases: puedeLevantar ? "jugable" : "",
          // La pila del centro no es de ningún asiento: lleva su propio
          // dorso, que se compra aparte del de la mano.
          dorso: dorsoDelMazo(),
        },
      )
    : `<div class="hueco vacio"></div>`;
  dom.mazoContador.textContent = `${estado.mazo.length} cartas`;

  if (estado.levantada) {
    const poder = PODERES[estado.levantada.numero];
    dom.levantadaCarta.innerHTML = dibujarCarta(estado.levantada, {
      visible: estado.indiceTurno === YO,
      asiento: estado.indiceTurno,
    });
    dom.levantadaNota.textContent = poder
      ? `poder ${estado.levantada.numero}`
      : "";
    dom.pilaLevantada.classList.toggle("con-poder", Boolean(poder));
  } else {
    dom.levantadaCarta.innerHTML = `<div class="hueco vacio"></div>`;
    dom.levantadaNota.textContent = "";
    dom.pilaLevantada.classList.remove("con-poder");
  }

  dibujarMarcador();
  dibujarRegistro();
  marcarCartasJugables();
  actualizarBotones();
  sincronizarReloj();
  avisarSiMeToca();
}

/**
 * Lo último que se dibujó cuando me tocaba a mí.
 *
 * `dibujar()` se llama muchas veces por turno —cada carta que se mueve, y en
 * red cada vista que llega, que son varias por segundo—, así que sin recordar
 * qué se avisó, el cartel de "Tu turno" reaparecería sin parar sobre la mesa.
 * Se guarda una clave y no un booleano porque hay DOS avisos por turno, el de
 * levantar y el de decidir, y el segundo tiene que poder salir después del
 * primero dentro del mismo turno.
 */
let ultimoAviso = "";

/**
 * El cartel dorado de "te toca".
 *
 * Sólo en las dos fases en las que la mesa espera una decisión mía: levantar
 * del mazo, y cortar o pasar. En las del medio —elegir qué hacer con la carta
 * levantada, usar el poder— ya hay un modal o una carta iluminada diciendo qué
 * hacer, y un cartel más sería ruido encima de algo que ya se ve.
 *
 * La instrucción larga sigue en la barra de pista, que es donde se lee. Esto
 * sólo hace que uno levante la vista.
 */
function avisarSiMeToca() {
  const mio = estado.indiceTurno === YO;
  const cual =
    !mio ? null
    : estado.fase === "turno" ? "tuTurno"
    : estado.fase === "postLevantada" ? "decidir"
    : null;

  if (!cual) {
    // Fuera de mis fases se olvida lo avisado, para que el turno siguiente
    // vuelva a avisar aunque caiga en la misma fase.
    if (!mio) ultimoAviso = "";
    return;
  }

  // `turnosRonda` entra en la clave porque en una ronda larga me toca varias
  // veces, y sin él el segundo turno se creería el mismo que el primero.
  const clave = `${estado.ronda}:${estado.turnosRonda}:${cual}`;
  if (clave === ultimoAviso) return;
  ultimoAviso = clave;
  cartel(cual, { tuyo: true });
}

/** Marca como pulsables sólo las cartas que la fase actual permite tocar. */
function marcarCartasJugables() {
  // Con un poder en curso lo elegible no es la mano propia sino lo que la
  // regla del poder permita, que puede estar en la mesa de otro.
  if (eligiendoPoder) {
    marcarElegiblesDelPoder();
    return;
  }

  const miMano = document.querySelector(`.jugador[data-jugador="${YO}"] .mano`);
  if (!miMano) return;

  // La carta que ya mandé en esta ventana queda resaltada. Es la única señal
  // que tiene el jugador de que su toque salió: en red el resultado no se
  // sabe hasta que la ventana cierra, hasta siete segundos después.
  if (posicionEnviada != null && estado.fase === "descarte") {
    miMano
      .querySelector(`.carta[data-posicion="${posicionEnviada}"]`)
      ?.classList.add("seleccionada");
  }

  const miTurno = estado.indiceTurno === YO;
  const habilitar =
    (estado.fase === "mirar" &&
      estado.jugadores[YO].posicionMirada == null &&
      !miradaTodaviaCerrada(miVista)) ||
    estado.fase === "descarte" ||
    (estado.fase === "levantada" && miTurno);

  /**
   * Las cartas ajenas que conozco: ésas, y sólo ésas, se pueden atacar.
   *
   * Antes un 8 marcaba la mano ENTERA del rival, porque el motor guardaba el
   * número visto y no la carta. Ahora el conocimiento es de la carta y la
   * sigue si se mueve, así que se marca exactamente dónde está. La lista es
   * la misma en los dos modos: ver `quePosicionesPuedoAtacar`.
   */
  if (estado.fase === "descarte") {
    for (const { objetivo, posicion } of quePosicionesPuedoAtacar()) {
      document
        .querySelector(
          `.jugador[data-jugador="${objetivo}"] .carta[data-posicion="${posicion}"]`,
        )
        ?.classList.add("jugable", "atacable");
    }
  }

  // Ataque a medio armar: ya se apuntó a una carta ajena y falta decir cuál
  // se entrega. Mientras tanto, lo único que importa es la mano propia — el
  // resto se apaga para que no queden dos decisiones abiertas a la vez.
  if (atacando) {
    document
      .querySelectorAll(".carta[data-posicion]")
      .forEach((el) => el.classList.add("apagada"));

    const apuntada = document.querySelector(
      `.jugador[data-jugador="${atacando.indiceJugador}"] .carta[data-posicion="${atacando.posicion}"]`,
    );
    apuntada?.classList.remove("apagada");
    apuntada?.classList.add("apuntada");

    miMano.querySelectorAll(".carta[data-posicion]").forEach((el) => {
      el.classList.remove("apagada");
      el.classList.add("jugable", "entregable");
    });
    return;
  }

  if (!habilitar) return;
  miMano
    .querySelectorAll(".carta")
    .forEach((el) => el.classList.add("jugable"));
}

/**
 * Qué cartas ajenas se pueden atacar, en los dos modos.
 *
 * En red lo decide el servidor y viaja en la vista; en entrenamiento se
 * calcula del estado local con la misma función del motor.
 */
function quePosicionesPuedoAtacar() {
  if (enRed()) return miVista?.puedeAtacarEn ?? [];
  return posicionesAtacablesDe(estado, YO);
}

/** ¿Conozco la carta de `objetivo` en `posicion`? */
function puedoAtacarAhi(objetivo, posicion) {
  return quePosicionesPuedoAtacar().some(
    (p) => p.objetivo === objetivo && p.posicion === posicion,
  );
}

/**
 * Resalta las cartas que el poder en curso permite tocar, y apaga el resto.
 *
 * No revela nada: marca posiciones, no cartas. Quién puede ser objetivo del
 * 8, 9 o 10 ya se sabe con sólo mirar la mesa —son los otros jugadores— y
 * cuántas cartas tiene cada uno también.
 */
function marcarElegiblesDelPoder() {
  const puede = elegibleParaPoder({
    numero: eligiendoPoder.numero,
    yo: YO,
    jugadores: estado.jugadores,
    propiaElegida: eligiendoPoder.propia,
  });

  document.querySelectorAll(".jugador[data-jugador]").forEach((jugadorEl) => {
    const i = Number(jugadorEl.dataset.jugador);
    jugadorEl.querySelectorAll(".carta[data-posicion]").forEach((cartaEl) => {
      const pos = Number(cartaEl.dataset.posicion);
      const elegible = puede(i, pos);
      cartaEl.classList.toggle("elegible-poder", elegible);
      // Lo no elegible se apaga: se ve que existe, pero que no es para ahora.
      cartaEl.classList.toggle("apagada", !elegible);
    });
  });

  // La que ya se eligió queda marcada, para no perderla de vista.
  if (eligiendoPoder.propia !== null) {
    const propia = document.querySelector(
      `.jugador[data-jugador="${YO}"] .carta[data-posicion="${eligiendoPoder.propia}"]`,
    );
    propia?.classList.add("elegida-poder");
    propia?.classList.remove("apagada");
  }
}

function actualizarBotones() {
  const miTurno = estado.indiceTurno === YO && !estado.jugadores[YO].eliminado;
  dom.btnLevantar.disabled = !(estado.fase === "turno" && miTurno);
  dom.btnTirar.disabled = !(estado.fase === "levantada" && miTurno);

  // Con un 7/8/9/10 en la mano el botón se convierte en el acceso al poder.
  const poderDisponible =
    estado.fase === "levantada" &&
    miTurno &&
    Boolean(PODERES[estado.levantada?.numero]);
  dom.btnTirar.classList.toggle("con-poder", poderDisponible);
  // Sólo la palabra: el dibujo se queda. Y sin el 🔮 que llevaba antes,
  // que era el ícono de este botón cuando no tenía uno. Dos símbolos para
  // lo mismo, uno encima del otro, es ruido; que hay poder ya lo dicen el
  // ámbar y el latido de `.con-poder`.
  if (dom.btnTirarTexto) dom.btnTirarTexto.textContent = poderDisponible ? "Poder" : "Tirar";
  dom.btnCortar.disabled = !(estado.fase === "postLevantada" && miTurno);
  dom.btnPasar.disabled = !(estado.fase === "postLevantada" && miTurno);

  /**
   * Marcado como ausente: «he vuelto» en lugar de los cuatro.
   *
   * Con la marca puesta los turnos propios se saltean solos, así que los
   * cuatro botones de jugada no sirven para nada — y dejarlos a la vista,
   * apagados, se lee como «esperá tu turno», que es justo lo que no va a
   * pasar. El único que hay para apretar es éste, y va donde la mirada vuelve
   * primero.
   *
   * Vale para los dos modos porque `estoyMarcado` ya sabe de dónde leer.
   */
  const marcado = estoyMarcado() && !estado.jugadores[YO]?.eliminado;
  for (const boton of [dom.btnLevantar, dom.btnTirar, dom.btnCortar, dom.btnPasar]) {
    boton.hidden = marcado;
  }
  if (dom.btnHeVuelto) dom.btnHeVuelto.hidden = !marcado;

  /**
   * Y se dice por qué, una vez.
   *
   * En entrenamiento lo dice `pasarPorTiempo` en el momento. En red la marca
   * llega en una vista, sin que nada de este navegador la haya pedido: sin
   * este aviso, los botones cambian y nadie explica el motivo. Sólo en el
   * flanco —al pasar de no marcado a marcado—, porque esta función corre en
   * cada dibujado y pisaría cualquier otra pista mientras dure.
   */
  if (marcado && !estabaMarcado && enRed()) {
    pista("Se acabó tu tiempo y quedaste <b>ausente</b>. Tocá <b>He vuelto</b> para seguir.");
  }
  estabaMarcado = marcado;
}


// -------------------------------------------------------- temporizadores




async function revelarUnMomento(i, pos, ms = MS_MIRAR) {
  sonidos.voltear();
  revelaciones.set(clave(i, pos), null);
  dibujar();
  marcarEfecto(i, pos, "efecto-mirar", ms);
  await esperar(ms);
  revelaciones.delete(clave(i, pos));
  dibujar();
}

// ----------------------------------------------------- reloj del turno




/**
 * Se acabó el tiempo: se resuelve la decisión pendiente con la salida más
 * conservadora. No se puede "pasar" sin haber levantado, así que cada fase
 * tiene su propio automático.
 */
/**
 * Se acabó el tiempo de levantar: se saltea la levantada y juega el siguiente.
 * No se toca ninguna otra fase.
 */
function resolverPorTiempo(indice) {
  // Sólo entrenamiento. En red el turno lo saltea el servidor, y correr el
  // motor sobre la copia local sólo pinta un estado que el servidor no dio.
  // `relojDeLaFase` ya no la pasa en red; esto es el cinturón.
  if (enRed()) return;
  if (estado.fase !== "turno" || estado.indiceTurno !== indice) return;

  sonidos.error();
  estado = saltarTurno(estado);
  if (indice === YO) pista("Se te acabó el tiempo: perdiste la levantada.");
  dibujar();
  cicloTurnos();
}

/**
 * El paso automático de `postLevantada`, en entrenamiento.
 *
 * En red esto NO corre: el plazo lo lleva el servidor con su propio reloj, y
 * dos relojes contando lo mismo son dos resultados distintos en cuanto uno de
 * los dos se atrasa. Acá no hay servidor, así que el reloj es éste.
 *
 * Se guarda a QUÉ turno pertenece la cuenta. Si sólo se guardara el timeout,
 * una ventana de descarte que interrumpe y devuelve la mesa a `postLevantada`
 * dejaría el turno sin cuenta, porque al salir de la fase se canceló.
 */
/**
 * Se acabó el tiempo para decidir: se pasa el turno.
 *
 * Lo dispara el MISMO reloj que el jugador ve contar. Antes había dos cuentas
 * del mismo plazo —un `setTimeout` invisible y, ahora, la barra— y dos
 * relojes para lo mismo terminan discrepando: uno se cancela y el otro no, y
 * el turno se pasa solo mientras el número en pantalla sigue corriendo.
 */
function pasarPorTiempo() {
  // Se vuelve a comprobar: entre que arrancó la cuenta y ahora pudo pasar
  // cualquier cosa, y `pasarTurno` fuera de `postLevantada` no hace nada pero
  // tampoco avisa.
  if (estado.fase !== "postLevantada" || estado.indiceTurno !== YO) return;
  sonidos.clic();
  estado = pasarTurno(estado);
  // Y queda ausente. Es la misma señal que usa el servidor en `transicion`:
  // veinte segundos frente a la decisión de cortar sin tocar nada. Los plazos
  // de diez —tirar, soltar el poder— no marcan: vencerlos es jugar apurado.
  ausenteLocal = true;
  pista("Se acabó el tiempo: <b>pasaste</b> el turno y quedaste <b>ausente</b>.");
  dibujar();
  cicloTurnos();
}

/**
 * Se venció el plazo para decidir: se hace lo mismo que haría el servidor.
 *
 * Las tres transiciones son las de `AL_VENCER_LA_DECISION`, y las funciones
 * son las mismas que usa `partida-red.js` —que las dos mitades del juego
 * resuelvan igual no es una casualidad que haya que cuidar: es el motor—.
 *
 * `saltarTurno` no sirve para el poder: exige fase `turno` y sin carta
 * levantada, así que desde `poder` devolvería el estado intacto y el reloj
 * vencería una y otra vez sobre la misma pantalla. Lo que corresponde es
 * soltar el poder —queda en `postLevantada`— y de ahí pasar el turno.
 *
 * El 10 a medio resolver es su propio caso: ya vio las dos cartas, así que lo
 * que se declina no es el poder sino el cambio.
 */
async function resolverDecisionPorTiempo() {
  // Se vuelve a comprobar: entre que arrancó la cuenta y ahora pudo pasar
  // cualquier cosa. Es la misma precaución que toma `pasarPorTiempo`.
  const que = decisionQueVence(estado.fase);
  if (!que || estado.indiceTurno !== YO) return;

  if (que === "descartarPorTiempo") {
    sonidos.whoosh();
    estado = tirarCarta(estado, { porTiempo: true });
    pista("Se acabó el tiempo: se tiró la carta.");
    dibujar();
    // La carta tirada queda de muestra, así que abre reflejos igual que
    // cuando se tira a mano. Sin esto, la mesa se saltearía la ventana.
    if (await trasPonerMuestra()) {
      abrirModalPoder();
      return;
    }
    if (estado.fase === "postLevantada") pista("CORTAR O PASAR");
    return;
  }

  sonidos.clic();
  const sinPendiente =
    estado.fase === "cambioConVista"
      ? resolverCambioConVista(estado, false)
      : saltarPoder(estado);
  estado = pasarTurno(sinPendiente);
  pista("Se acabó el tiempo para decidir: <b>pasaste</b> el turno.");
  dibujar();
  cicloTurnos();
}

/**
 * Arranca, reinicia o apaga el reloj según la fase. Se llama en cada dibujado,
 * así que basta con cambiar de fase para que el reloj se reinicie solo.
 */
/**
 * Qué reloj corresponde a la fase actual, o ninguno.
 *
 * Son tres y miden cosas distintas: ocho segundos para levantar del mazo, diez
 * para decidir qué hacer con la carta levantada, y veinte para elegir entre
 * cortar y pasar. El último es el más largo porque es la decisión que más se
 * piensa — y porque perderla por apuro se paga con diez puntos.
 *
 * Toda fase en la que la mesa espera a alguien tiene el suyo. La única que
 * queda sin reloj es el turno de una IA, que se maneja sola.
 */
/**
 * En red, el reloj de una fase es un ESPEJO del plazo del servidor.
 *
 * Se dibuja cuánto le falta a `plazo.hasta`, medido contra el reloj del
 * servidor, y al llegar a cero no se hace nada: quien actúa es el servidor,
 * con su propio reloj. Un espejo no decide.
 *
 * Estaba escrito dos veces igual —para cortar o pasar, y para las decisiones
 * de diez segundos— y faltaba en el tercer lugar que lo necesitaba, el turno.
 * Ahora es uno.
 *
 * Sin plazo para ESTA fase no se dibuja nada. Un plazo de otra fase es una
 * vista a medio actualizar, y uno ya vencido no tiene nada que contar: el
 * servidor está por moverse.
 */
function espejoDelPlazo(fase) {
  const plazo = miVista?.plazo?.fase === fase ? miVista.plazo : null;
  if (!plazo) return null;

  const restante = plazo.hasta - Red.ahoraDelServidor();
  if (restante <= 0) return null;
  return { ms: restante, alVencer: () => {} };
}

function relojDeLaFase() {
  if (estado.jugadores[estado.indiceTurno]?.eliminado) return null;

  /**
   * Los ocho segundos para levantar.
   *
   * ─────────────────────────────────────────────────────────────────────
   * EN RED ERA UN RELOJ LOCAL QUE ACTUABA
   * ─────────────────────────────────────────────────────────────────────
   *
   * Contaba sus propios ocho segundos y al vencer llamaba a
   * `resolverPorTiempo`, que corre el MOTOR sobre la copia local del estado y
   * después `cicloTurnos`, que es el bucle del entrenamiento. En red eso no
   * tiene nada que hacer: el turno lo saltea el servidor.
   *
   * Se vio en una prueba sin vistas nuevas: el turno avanzaba solo de un
   * jugador al siguiente, cada ocho segundos, y la pista pasaba a decir
   * «LEVANTAR», el texto del entrenamiento. En producción la vista del
   * servidor lo pisaba enseguida, pero era un parpadeo de estado falso — y
   * la mitad del «reloj que llega a cero y se reinicia» sobre el cartel de
   * fin de ronda que no se cerraba.
   *
   * Ahora es un espejo, igual que los otros dos relojes de red. De paso, un
   * jugador marcado como ausente —al que el servidor saltea sin esperar—
   * deja de mostrar ocho segundos que nunca iban a correr: su plazo vence
   * ya, y un plazo vencido no se dibuja.
   */
  if (estado.fase === "turno") {
    if (!enRed()) return { ms: MS_TURNO, alVencer: resolverPorTiempo };
    return espejoDelPlazo("turno");
  }

  // Decidir el corte, y sólo si el turno es mío.
  //
  // ─────────────────────────────────────────────────────────────────────
  // EN RED SE MUESTRA EL RELOJ DEL SERVIDOR, NO UNO PROPIO
  // ─────────────────────────────────────────────────────────────────────
  //
  // Acá no había reloj en red, y el argumento era bueno: un reloj de este
  // navegador compitiendo con el del servidor pasaría turnos que el
  // servidor no dio por vencidos.
  //
  // Pero la conclusión estaba de más. El servidor SÍ cuenta ese plazo
  // —`plazoDe`, caso `postLevantada`, acción `pasarPorTiempo`— y
  // pasa el turno cuando vencen. Lo que faltaba no era el reloj: era
  // mostrarlo. El que jugaba por Leyendas se quedaba pensando y lo pasaban
  // sin un solo aviso, mientras el que entrenaba veía la barra bajar.
  //
  // Así que en red se dibuja el vencimiento que manda el servidor, medido
  // contra SU reloj —`ahoraDelServidor`, que ya está sincronizado para la
  // ventana de reflejos— y al llegar a cero no se hace nada: quien pasa el
  // turno es el servidor. La autoridad del tiempo no se movió de lugar.
  if (estado.fase === "postLevantada" && estado.indiceTurno === YO) {
    if (!enRed()) return { ms: MS_PASO_AUTOMATICO, alVencer: pasarPorTiempo };
    return espejoDelPlazo("postLevantada");
  }

  /**
   * Los diez segundos para decidir qué hacer con lo que ya se tiene en la mano.
   *
   * ─────────────────────────────────────────────────────────────────────
   * EN LOS DOS MODOS, PERO CON DUEÑOS DISTINTOS
   * ─────────────────────────────────────────────────────────────────────
   *
   * En red el número es un ESPEJO: cuenta el servidor y acá sólo se dibuja su
   * `plazo.hasta`. En entrenamiento no hay a quién espejar, así que el plazo
   * es de esta pestaña y ella misma lo resuelve, con `resolverDecisionPorTiempo`.
   *
   * Acá decía `if (!enRed()) return null`, y el argumento era que dibujar una
   * cuenta que al llegar a cero no hace nada es peor que no dibujarla. Cierto,
   * y por eso la respuesta no fue dibujarla igual: fue que también venza. Sin
   * reloj, entrenar enseñaba a decidir sin apuro, y en una mesa de verdad la
   * acción se toma sola a los diez segundos — la práctica dejaba puesta una
   * costumbre que cuesta cartas.
   *
   * ─────────────────────────────────────────────────────────────────────
   * Y SIN EL `=== YO` DE ARRIBA, EN RED
   * ─────────────────────────────────────────────────────────────────────
   *
   * El reloj de `postLevantada` sólo lo ve quien decide, y para eso está bien:
   * es una decisión privada entre cortar y pasar.
   *
   * Éste lo ven los cuatro. `iniciarRelojTurno` pinta el aro sobre el asiento
   * de `indice`, así que cada navegador lo dibuja sobre el jugador que está
   * decidiendo — no sobre el suyo. Que los rivales vean el reloj correr es
   * justamente lo que evita la mesa muda: se sabe que alguien está por actuar
   * y cuánto le queda, en vez de esperar sin saber si se fue.
   *
   * ─────────────────────────────────────────────────────────────────────
   * AL LLEGAR A CERO NO HACE NADA, EN RED
   * ─────────────────────────────────────────────────────────────────────
   *
   * `alVencer` vacío, igual que en `postLevantada`. Quien tira la carta o salta
   * el turno es el SERVIDOR, con su propio reloj. Este número es un espejo de
   * `plazo.hasta`, y un espejo no decide.
   */
  if (esperaUnaDecision(estado.fase)) {
    /**
     * En entrenamiento, sólo cuando el que decide es el humano.
     *
     * La IA tiene su propio ritmo y sus propias pausas. Un reloj corriendo
     * sobre su turno le dispararía la acción por encima, en el medio de su
     * jugada — y no hay nadie a quien apurar: la que está pensando es ella.
     */
    if (!enRed()) {
      if (estado.indiceTurno !== YO) return null;
      return { ms: MS_PARA_DECIDIR, alVencer: resolverDecisionPorTiempo };
    }
    return espejoDelPlazo(estado.fase);
  }

  return null;
}

function sincronizarReloj() {
  const cual = relojDeLaFase();
  const enCurso = relojes.turnoEnCurso();

  if (!cual) {
    if (enCurso) cancelarRelojTurno();
    return;
  }

  const mismaDecision =
    enCurso &&
    enCurso.fase === estado.fase &&
    enCurso.indice === estado.indiceTurno;

  if (!mismaDecision) {
    iniciarRelojTurno(estado.fase, estado.indiceTurno, cual.alVencer, cual.ms);
  } else {
    pintarReloj();
  }
}

// ------------------------------------------------- efectos de los poderes







// ------------------------------------------------------------ modal



// ---------------------------------------------------------- abandono

/**
 * Aviso previo a abandonar.
 *
 * Las cifras que se muestran son informativas: sirven para que nadie pierda
 * Leyendas sin haberlo leído antes. El cobro lo hace el servidor con la
 * entrada real de la partida, así que si estas cifras estuvieran mal, el
 * jugador se llevaría una sorpresa, pero no un cobro distinto del que manda
 * el reglamento.
 */
function abrirModalAbandono() {
  const costo = costoDeAbandonar(partidaEconomica);

  const cuerpo = costo.esEntrenamiento
    ? `<p class="aviso-suave">Partida de entrenamiento. No perderás Leyendas.</p>`
    : `
      <ul class="detalle-abandono">
        <li><span>Tu entrada</span><b>${costo.entradaPerdida} Leyendas</b></li>
        <li><span>Penalización por abandono</span><b>${costo.penalizacion} Leyendas</b></li>
        <li class="destacada">
          <span>Total adicional que perderás</span><b>${costo.adicional} Leyendas</b>
        </li>
      </ul>
      <p class="aviso-suave">
        Tu entrada ya está en el pozo y se queda ahí. La penalización se
        descuenta aparte y no va al pozo ni a ningún otro jugador.
      </p>`;

  abrirModal(`
    <h2>¿Seguro que querés abandonar?</h2>
    ${cuerpo}
    <p class="error-modal" id="errorAbandono" hidden></p>
    <div class="botonera-modal">
      <button class="accion sobria" data-accion="abandonar-no" type="button">Seguir jugando</button>
      <button class="accion peligro" data-accion="abandonar-si" type="button">Abandonar</button>
    </div>
  `);
}

async function confirmarAbandono(boton) {
  const costo = costoDeAbandonar(partidaEconomica);

  // Entrenamiento: no hay nada que cobrar ni a quién avisarle. Se sale.
  if (costo.esEntrenamiento) {
    cerrarModal();
    window.location.href = "dashboard.html";
    return;
  }

  boton.disabled = true;
  boton.textContent = "Abandonando…";
  try {
    // Se manda sólo el código: el monto lo calcula el servidor.
    const { penalizacion } = await abandonarPartida(partidaEconomica.codigo);
    cerrarModal();
    volverAlLobby(
      `Abandonaste la partida. Se te descontaron ${penalizacion} Leyendas.`,
    );
  } catch (e) {
    boton.disabled = false;
    boton.textContent = "Abandonar";
    const aviso = document.getElementById("errorAbandono");
    if (aviso) {
      aviso.textContent =
        e instanceof ErrorDeServidor
          ? e.message
          : "No pudimos procesar el abandono.";
      aviso.hidden = false;
    }
  }
}

// ------------------------------------------------------- flujo de ronda

// ------------------------------------------ la puesta en escena del reparto
//
// Todo lo de este bloque es SÓLO para la mesa de entrenamiento. La mesa por
// Leyendas no reparte acá —lo hace el servidor— y su ritmo lo marcan los
// plazos que él manda; meterle esperas del navegador la desincronizaría.

/**
 * ¿El sistema pidió menos movimiento?
 *
 * Se respeta de verdad: sin animación de reparto y sin cuenta regresiva. No es
 * sólo cosmética — para alguien con sensibilidad al movimiento, veinte cartas
 * volando y un número latiendo en pantalla completa son justo lo que hace
 * inusable un juego.
 *
 * De paso es lo que mantiene rápidas las pruebas de Playwright, que corren con
 * esta preferencia puesta: sin ella cada prueba de mesa esperaría los cuatro
 * segundos de la cuenta regresiva antes de poder mirar nada.
 */
const sinMovimiento = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Retraso entre carta y carta, y cuánto dura el vuelo de cada una. */
const MS_ENTRE_CARTAS = 90;
const MS_VUELO = 260;

/** Quita la pantalla de carga con una transición suave. */
function quitarVeloCarga() {
  const velo = $("veloCarga");
  if (!velo) return;
  velo.classList.add("se-va");
  // Se saca del DOM al terminar de desvanecerse: dejarlo con `opacity: 0`
  // encima de la mesa deja una capa invisible que igual se come los toques.
  setTimeout(() => velo.remove(), 500);
}

/**
 * Reparte a la vista: las cartas salen del mazo y van a su asiento.
 *
 * El orden es el de una mesa de verdad — a la izquierda primero y uno mismo al
 * final— y por eso se recorre por ASIENTO y no por índice de jugador. Los dos
 * órdenes no coinciden: el jugador 0 es siempre el de abajo, así que repartir
 * por índice empezaría por uno mismo.
 *
 * Los asientos son los contenedores fijos de `mesa.html`, no las clases de las
 * cartas: `claseAsiento()` devuelve un color (`asiento-color-2`), no una
 * posición, y usarlo acá mandaría las cartas a cualquier lado.
 */
async function animarReparto() {
  if (enRed() || sinMovimiento()) return;

  const mazo = $("pilaMazo");
  const asientos = [
    dom.asientos.izq,
    dom.asientos.arriba,
    dom.asientos.der,
    dom.asientos.abajo,
  ].filter(Boolean);
  if (!mazo || !asientos.length) return;

  const centro = mazo.getBoundingClientRect();
  const cartasDe = (asiento) => asiento.querySelectorAll(".carta[data-posicion]");
  const maxCartas = Math.max(...asientos.map((a) => cartasDe(a).length));
  if (!maxCartas) return;

  let repartidas = 0;
  for (let vuelta = 0; vuelta < maxCartas; vuelta++) {
    for (const asiento of asientos) {
      const carta = cartasDe(asiento)[vuelta];
      if (!carta) continue;

      // De dónde "viene" la carta: la distancia desde su lugar final hasta el
      // mazo, medida ahora. Se mide en vez de escribir una dirección por
      // asiento porque la mesa se acomoda distinto en un teléfono que en una
      // pantalla ancha.
      const caja = carta.getBoundingClientRect();
      const dx = centro.left + centro.width / 2 - (caja.left + caja.width / 2);
      const dy = centro.top + centro.height / 2 - (caja.top + caja.height / 2);

      carta.style.setProperty("--dx", `${Math.round(dx)}px`);
      carta.style.setProperty("--dy", `${Math.round(dy)}px`);
      carta.style.setProperty("--retraso-reparto", `${repartidas * MS_ENTRE_CARTAS}ms`);
      carta.classList.add("repartiendo");
      repartidas++;
    }
  }

  await esperar(repartidas * MS_ENTRE_CARTAS + MS_VUELO);

  // Se limpia todo: si la clase quedara puesta, el próximo `dibujar()` que
  // reutilice el nodo volvería a animarlo sin motivo.
  for (const el of document.querySelectorAll(".carta.repartiendo")) {
    el.classList.remove("repartiendo");
    el.style.removeProperty("--dx");
    el.style.removeProperty("--dy");
    el.style.removeProperty("--retraso-reparto");
  }
}

/**
 * Los pasos de la cuenta regresiva, y cuánto dura cada uno.
 *
 * Los usan las dos cuentas —la de entrenamiento y la de red— para que sean la
 * misma. La duración total sale del motor, que es donde el servidor la lee
 * para programar la apertura de la primera ronda.
 */
const PASOS_DE_LA_CUENTA = ["3", "2", "1", "Preparate…"];
const MS_POR_PASO = MS_CUENTA_REGRESIVA / PASOS_DE_LA_CUENTA.length;

function pintarPasoDeLaCuenta(numero, paso) {
  numero.textContent = paso;
  numero.classList.toggle("palabra", paso.length > 2);
  // Reinicia la animación en cada paso: sin esto sólo late el primero,
  // porque para el navegador es el mismo elemento con la misma clase.
  numero.style.animation = "none";
  void numero.offsetWidth;
  numero.style.animation = "";
}

/**
 * "3, 2, 1, Preparate…" antes de la mirada.
 *
 * Sólo en la primera ronda de la partida. Repetirla en cada una sumaría cuatro
 * segundos de espera obligatoria a cada ronda, y lo que se gana —avisar que
 * arranca— ya no hace falta cuando se lleva media partida jugada.
 *
 * En red no corre ésta sino `cuentaRegresivaEnRed`, que cuenta contra el
 * reloj del servidor.
 */
/** Mientras corre, tocar una carta no hace nada Y NO DICE NADA. */
let enCuentaRegresiva = false;

async function cuentaRegresiva() {
  if (enRed() || sinMovimiento()) return;

  const caja = $("cuentaAtras");
  const numero = $("cuentaAtrasNumero");
  if (!caja || !numero) return;

  enCuentaRegresiva = true;
  caja.hidden = false;
  try {
    for (const paso of PASOS_DE_LA_CUENTA) {
      pintarPasoDeLaCuenta(numero, paso);
      await esperar(MS_POR_PASO);
    }
  } finally {
    caja.hidden = true;
    enCuentaRegresiva = false;
  }
}

/**
 * `?debug-cartas=1`: un cartel con lo que mide cada carta.
 *
 * Para no tener que adivinar al ajustar tamaños. Dice el tamaño de la
 * ventana, qué mide una carta de cada grupo y qué valor tienen las variables
 * en ese escalón de pantalla. No cambia nada: lee y muestra.
 *
 * Apagado salvo que se pida, y sin temporizador propio: se repinta cuando la
 * ventana cambia de tamaño, que es cuando pueden cambiar las medidas.
 */
function encenderDebugDeCartas() {
  if (new URLSearchParams(location.search).get("debug-cartas") !== "1") return;

  /**
   * La marca que destapa el número de posición de cada carta.
   *
   * Va en la raíz y no en cada carta: las cartas se vuelven a dibujar enteras
   * en cada jugada y habría que acordarse de ponérsela cada vez. Ver
   * `.posicion` en mesa.css.
   */
  document.documentElement.classList.add("con-debug-cartas");

  const caja = document.createElement("div");
  caja.className = "debug-cartas";
  caja.setAttribute("aria-hidden", "true");
  document.body.appendChild(caja);

  const medir = () => {
    const tam = (sel) => {
      const el = document.querySelector(sel);
      return el ? `${el.offsetWidth}×${el.offsetHeight}` : "—";
    };
    const raiz = getComputedStyle(document.documentElement);
    const propia = document.querySelector(".jugador.propio .mano > .carta");
    const centro = document.querySelector("#muestraCarta .carta");
    const proporcion =
      propia && centro ? (centro.offsetWidth / propia.offsetWidth).toFixed(2) : "—";

    caja.innerHTML = `
      <b>${innerWidth}×${innerHeight}</b> · ${devicePixelRatio}x
      <br>mano: ${tam(".jugador.propio .mano > .carta")}
      <br>rival: ${tam(".jugador:not(.propio) .mano > .carta")}
      <br>centro: ${tam("#muestraCarta .carta")} (×${proporcion})
      <br>alto: ${raiz.getPropertyValue("--carta-alto").trim()}
      <br>centro: ${raiz.getPropertyValue("--carta-alto-centro").trim()}`;
  };

  medir();
  window.addEventListener("resize", medir);
  // Y con cada repintado de la mesa, que es cuando cambian las manos.
  document.addEventListener("click", () => setTimeout(medir, 50));
}

encenderDebugDeCartas();

/**
 * `?debug-tiempos=1`: el panel con lo que dura cada fase de verdad.
 *
 * Igual que el de las cartas: fuera del juego, sin toques, y sólo si se lo
 * pide. `window.__tiempos` es la misma medición, para poder preguntarla desde
 * una prueba sin leer la tabla del panel — y también sólo con la bandera
 * puesta, porque una mesa normal no tiene por qué exponer nada.
 */
if (new URLSearchParams(location.search).get("debug-tiempos") === "1") {
  window.__tiempos = tiempos;
  encenderPanelDeTiempos(tiempos);
}

/** La primera ronda es la única que lleva cuenta regresiva. */
let primeraRonda = true;

async function arrancarRonda() {
  estado = empezarRonda(estado);
  memorias = estado.jugadores.map(() => IA.crearMemoria());
  revelaciones.clear();
  cerrarModal();
  dibujar();

  if (!enRed()) {
    // El velo se va ANTES de repartir: si no, el reparto ocurriría detrás de
    // él y no se vería, que es justo lo contrario de lo que se busca.
    quitarVeloCarga();
    if (!sinMovimiento()) await esperar(220);
  }

  sonidos.repartir();
  await animarReparto();

  if (primeraRonda) {
    await cuentaRegresiva();
    primeraRonda = false;
  }

  await faseMirada();
}

/** Cada jugador elige una carta —5 s— y la ve durante 2. */
function faseMirada() {
  return new Promise((listo) => {
    // Las IAs eligen al instante y memorizan según su nivel.
    estado.jugadores.forEach((jugador, i) => {
      if (jugador.eliminado || !jugador.esIA) return;
      const pos = Math.floor(Math.random() * jugador.mano.length);
      estado = mirar(estado, i, pos);
      memorias[i] = IA.recordar(
        memorias[i],
        jugador.dificultad,
        i,
        pos,
        jugador.mano[pos],
      );
    });

    if (estado.jugadores[YO].eliminado) {
      estado = terminarMirada(estado);
      dibujar();
      faseDescarte().then(listo);
      return;
    }

    pista("MIRÁ TU CARTA");
    correrTemporizador(MS_ELEGIR_MIRADA, "elegir mirada");
    dibujar();

    let resuelto = false;
    const elegir = async (pos) => {
      if (resuelto) return;
      resuelto = true;
      clearTimeout(automatico);
      cancelarTemporizador();
      manejadorMirada = null;

      estado = mirar(estado, YO, pos);
      pista("Memorizá esta carta…");
      correrTemporizador(MS_MIRAR, "mirar");
      await revelarUnMomento(YO, pos);
      cancelarTemporizador();

      estado = terminarMirada(estado);
      dibujar();
      await faseDescarte(cicloTurnos);
      listo();
    };

    // Reglamento: si no elige, se toma automáticamente la primera carta.
    const automatico = setTimeout(() => elegir(0), MS_ELEGIR_MIRADA);
    manejadorMirada = elegir;
  });
}

/** Cuánto se muestra a la mesa una carta que no llegó a descartarse. */
const MS_CARTA_EXPUESTA = 2000;

/**
 * Reacciona al último intento de descarte: suena, y si fue error muestra la
 * carta a toda la mesa un momento antes de que vuelva a taparse.
 */
function resolverUltimoDescarte() {
  const intentos = estado.ventanaDescarte?.intentos ?? [];
  const ultimo = intentos[intentos.length - 1];
  if (!ultimo) return;

  // Acertarle a un rival suena como ser primero: las dos son aciertos. Antes
  // caía en el sonido de error, y el que acertaba creía que había fallado.
  const acerto = ultimo.resultado === "primero" || ultimo.resultado === "rivalAcierto";
  if (acerto) sonidos.acierto();
  else if (ultimo.resultado === "tarde") sonidos.aviso();
  else sonidos.error();

  // Lo que quedó a la vista de la mesa, dos segundos: la carta tocada si no se
  // fue, y la de castigo si fue un error. La misma lista que manda el
  // servidor en red.
  for (const { indiceJugador, posicion, carta } of cartasExpuestas([ultimo])) {
    const llave = clave(indiceJugador, posicion);
    revelaciones.set(llave, carta);
    setTimeout(() => {
      revelaciones.delete(llave);
      dibujar();
    }, MS_CARTA_EXPUESTA);
  }
}

/**
 * Un acierto sobre un rival, en entrenamiento: ahora se elige la carta.
 *
 * Con su propio reloj de `MS_PARA_ENTREGAR`, que reemplaza en pantalla al de la
 * ventana mientras dure. Al vencer, la carta sale al azar —lo decide el motor,
 * con la semilla de la partida, igual que el servidor en red—.
 */
function empezarEntregaLocal(objetivo) {
  let avisar;
  const terminada = new Promise((listo) => { avisar = listo; });
  atacando = {
    ...objetivo,
    terminada,
    avisar,
    vence: setTimeout(() => completarEntregaLocal(null), MS_PARA_ENTREGAR),
  };
  sonidos.aviso();
  correrTemporizador(MS_PARA_ENTREGAR, "entrega");
  pista("¡Le acertaste! Elegí una carta tuya para entregarle.");
  dibujar();
}

/**
 * Aplica el acierto con la carta elegida, o al azar si `posicion` es null.
 *
 * Después, lo que esperaba detrás: las jugadas de la IA que llegaron mientras
 * se elegía, y el cierre de la ventana, si ya le tocaba.
 */
function completarEntregaLocal(posicion) {
  const pendiente = atacando;
  if (!pendiente) return;
  clearTimeout(pendiente.vence);
  atacando = null;

  estado = intentarDescarteRival(
    estado,
    YO,
    pendiente.indiceJugador,
    pendiente.posicion,
    posicion,
  );
  resolverUltimoDescarte();
  if (posicion == null) pista("Se acabó el tiempo: la carta salió al azar.");

  // Si la ventana sigue abierta, vuelve su reloj; si no, no queda ninguno.
  const resta = finDeLaVentana - Date.now();
  if (manejadorDescarte && resta > 0) correrTemporizador(resta, "descarte (resto)");
  else cancelarTemporizador();

  dibujar();
  for (const jugar of jugadasEnEspera.splice(0)) jugar();
  pendiente.avisar();
}

/**
 * Corre la ventana de reflejos si la jugada acaba de abrir una.
 *
 * La abren tirar y cambiar por igual: las dos dejan una carta nueva arriba del
 * descarte, y la mesa tiene que poder reaccionar antes de que el turno siga.
 */
async function reflejosTrasTirar() {
  if (estado.fase !== "descarte") return;
  // Dos segundos, no cinco: ésta es una reapertura. La de la ronda dura más
  // porque ahí se viene de memorizar y hay que buscar en cuatro manos.
  await faseDescarte(null, MS_REAPERTURA);
}

/**
 * Lo que va después de resolver un poder, en entrenamiento.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un jugador tiró un 8, usó el poder, vio que el rival tenía un 8 — y no pudo
 * descartárselo. El orden lo explica: la ventana de reflejos corre ANTES del
 * poder, así que cuando podía atacar ya no había ventana, y para la siguiente
 * la muestra sería otra carta.
 *
 * `ventanaTrasPoder` decide si corresponde abrirla —la respuesta sale de
 * `objetivosDe`, que es quien ya decidía a quién se puede atacar— y devuelve
 * el estado intacto cuando no. Por eso esto se puede llamar desde los tres
 * finales de poder sin preguntar cuál fue: el 7 sobre una carta propia y el 9
 * no abren nada, salvo que quien lo usó ya supiera algo de antes.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Y POR QUÉ UNA SOLA FUNCIÓN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque los finales de poder son tres y están lejos entre sí —el 7 y el 8 en
 * un sitio, el 9 en otro, el 10 en `preguntarSiCambia`—. Repetir el bloque en
 * cada uno es la misma trampa que ya nos costó el ojo: el día que se agregue
 * un poder, olvidarse no rompe nada y simplemente no pasa.
 *
 * En red no corre ninguna de estas líneas: allá el servidor aplica el poder y
 * `reabreDescarte` abre la ventana sola, con la misma marca del motor.
 *
 * @param pistaFinal qué decir si NO corresponde ventana.
 */
async function trasResolverElPoder(pistaFinal = "CORTAR O PASAR") {
  const conVentana = ventanaTrasPoder(estado, YO);

  if (conVentana === estado) {
    pista(pistaFinal);
    dibujar();
    return;
  }

  estado = conVentana;
  dibujar();
  // Tres segundos, los mismos que una reapertura: ya se sabe qué se busca y
  // en qué mano. El servidor llega al mismo número por su cuenta, leyendo
  // `volverA` en `duracionDeVentana`.
  await faseDescarte(null, MS_REAPERTURA, "BUSCÁ LA CARTA DEL RIVAL");
  if (estado.fase === "postLevantada") pista("CORTAR O PASAR");
}

/**
 * Lo que va después de poner una carta nueva de muestra.
 *
 * Primero los reflejos de todos, después el poder del que tiró. Ese orden es
 * la regla nueva: antes las cartas de poder salteaban la ventana, y tirar un 7
 * no le servía a nadie más que a quien lo tiraba.
 *
 * @returns true si quedó un poder para decidir.
 */
async function trasPonerMuestra() {
  await reflejosTrasTirar();
  if (estado.fase !== "poder") return false;
  const poder = estado.poderPendiente;
  await anunciarPoder(poder, estado.jugadores[poder.indiceJugador].nombre);
  return true;
}

/**
 * Ventana de 5 segundos en la que todos pueden descartar a la vez.
 *
 * @param alCerrar  qué hacer al cerrarse. La ventana de la ronda encadena el
 *                  ciclo de turnos; la que abre tirar una carta no, porque
 *                  vuelve a `postLevantada` y el turno sigue siendo del mismo.
 * @param rotulo    qué dice la pista mientras dura. La que sigue a un poder no
 *                  es de todos ni es para descartar, así que anunciarla como
 *                  "DESCARTE" mandaría a los otros tres a tocar sus cartas en
 *                  una ventana en la que el motor les va a rechazar todo.
 */
function faseDescarte(alCerrar, duracion = MS_DESCARTE, rotulo = "DESCARTE") {
  return new Promise((listo) => {
    // Ventana nueva, nada mandado todavía. Sin esto, la carta que se tocó en
    // la ventana anterior aparece resaltada en ésta.
    posicionEnviada = null;
    jugadasEnEspera = [];
    finDeLaVentana = Date.now() + duracion;
    // "DESCARTE" y nada más. Antes explicaba la regla entera —sólo el primero
    // se salva, equivocarse suma una carta— y son cinco segundos en los que
    // nadie lee tres renglones: se mira la muestra y se toca. La regla se
    // aprende en "Cómo se juega", no en la ventana en la que hay que usarla.
    pista(rotulo);
    correrTemporizador(duracion, rotulo.toLowerCase());
    sonidos.aviso();
    dibujar();

    const pendientes = [];
    estado.jugadores.forEach((jugador, i) => {
      if (jugador.eliminado || !jugador.esIA) return;
      const retraso = IA.retrasoReaccion(jugador.dificultad);
      if (retraso >= duracion) return;
      pendientes.push(
        setTimeout(() => {
          const jugar = () => {
            const pos = IA.decidirDescarte(estado, i, memorias[i]);
            if (pos == null) return;
            estado = intentarDescarte(estado, i, pos);
            memorias[i] = IA.olvidar(memorias[i], i, pos);
            resolverUltimoDescarte();
            dibujar();
          };
          // Con un acierto eligiendo su carta, la IA espera detrás.
          if (atacando) jugadasEnEspera.push(jugar);
          else jugar();
        }, retraso),
      );
    });

    manejadorDescarte = (pos) => {
      estado = intentarDescarte(estado, YO, pos);
      resolverUltimoDescarte();
      dibujar();
    };

    pendientes.push(
      setTimeout(async () => {
        pendientes.forEach(clearTimeout);
        // Nadie más intenta: el tiempo de la ventana se terminó.
        manejadorDescarte = null;
        // Pero un acierto que todavía elige su carta se espera. Resolver sin
        // ella dejaría un hueco en la mano del rival, y un hueco puede leerse
        // como «se quedó sin cartas» y cortar la ronda.
        if (atacando?.terminada) await atacando.terminada;
        // Y nada apuntado sobrevive a la ventana. Si quedaba vivo, la mesa
        // seguía apagada y el primer toque propio de la ventana siguiente se
        // tomaba como entrega.
        atacando = null;
        cancelarTemporizador();
        // Lo que se destapó lo vio toda la mesa, la IA incluida.
        memorias = memorias.map((m) =>
          IA.absorberRevelaciones(m, cartasExpuestas(estado.ventanaDescarte?.intentos ?? [])),
        );
        estado = cerrarVentanaDescarte(estado);
        dibujar();
        listo();
        // Quién sigue lo decide quien abrió la ventana: la de la ronda
        // encadena el ciclo de turnos, la que abre `tirarCarta` devuelve a la
        // decisión de cortar y no tiene que encadenar nada.
        if (alCerrar) alCerrar();
      }, duracion),
    );
  });
}

/** Avanza turnos hasta que le toque al humano o termine la ronda. */
async function cicloTurnos() {
  while (true) {
    if (estado.fase === "finRonda" || estado.fase === "finPartida") {
      await mostrarFinRonda();
      return;
    }

    const jugador = estado.jugadores[estado.indiceTurno];

    /**
     * Un ausente no se espera: se le saltea el turno y el ciclo sigue.
     *
     * Es `saltarTurno` y no otra cosa, que es también lo que hace el servidor
     * con el suyo. Alcanza con la fase `turno`: una vez marcado, cada turno
     * propio se saltea antes de levantar, así que nunca llega a `levantada`,
     * `poder` ni `postLevantada` mientras no vuelva.
     *
     * Con la pausa de siempre entre turnos: sin ella, un ausente haría que la
     * mesa se saltara su lugar tan rápido que parecería que no existe.
     */
    if (!jugador.esIA && ausenteLocal) {
      const salteado = saltarTurno(estado);
      // `saltarTurno` exige fase `turno` y devuelve el estado intacto si no la
      // encuentra. Con un `continue` sin esta comprobación, esa fase inesperada
      // haría girar el ciclo para siempre sobre el mismo estado, colgando la
      // pestaña. Si no se pudo saltar, se sigue como si estuviera: esperar su
      // turno es peor que saltarlo, pero infinitamente mejor que un cuelgue.
      if (salteado !== estado) {
        estado = salteado;
        dibujar();
        await esperar(RITMO.entreTurnos);
        continue;
      }
    }

    if (!jugador.esIA) {
      pista("LEVANTAR");
      dibujar();
      return;
    }

    await esperar(RITMO.entreTurnos);
    await turnoDeIA(estado.indiceTurno);
  }
}

async function turnoDeIA(i) {
  const jugador = estado.jugadores[i];
  const memoria = memorias[i];

  estado = levantar(estado);
  sonidos.voltear();
  dibujar();
  if (estado.fase !== "levantada") {
    // Sin cartas disponibles no se puede seguir: se fuerza el cierre de ronda.
    estado = cortar({ ...estado, fase: "postLevantada" });
    dibujar();
    return;
  }
  await esperar(RITMO.trasLevantar);

  const decision = IA.decidirLevantada(estado, i, memoria);
  if (decision.accion === "cambiar") {
    memorias[i] = IA.recordar(
      memoria,
      jugador.dificultad,
      i,
      decision.posicion,
      estado.levantada,
      () => 0,
    );
    estado = cambiarCarta(estado, decision.posicion);
    sonidos.voltear();
  } else {
    estado = tirarCarta(estado);
    sonidos.whoosh();
  }
  dibujar();
  // Los reflejos de la mesa van primero; recién después la IA decide su poder.
  // Renunciar ya no reabre nada: la ventana ocurrió antes de la decisión.
  const hayPoder = await trasPonerMuestra();
  await esperar(RITMO.trasDecidir);

  if (hayPoder) {
    await poderDeIA(i);
    await esperar(RITMO.trasPoder);
  }

  await esperar(RITMO.antesDeResolver);
  if (IA.decidirCorte(estado, i, memorias[i])) {
    sonidos.corte();
    estado = cortar(estado);
  } else {
    sonidos.clic();
    estado = pasarTurno(estado);
  }
  dibujar();
}

async function poderDeIA(i) {
  const { tipo } = estado.poderPendiente;
  const memoria = memorias[i];

  if (tipo === "mirarPropia" || tipo === "mirarRival") {
    const objetivo = IA.decidirObjetivoMirada(
      estado,
      i,
      memoria,
      tipo === "mirarPropia",
    );
    if (!objetivo) {
      estado = saltarPoder(estado);
      return;
    }
    const r = usarPoderMirar(estado, objetivo.indiceJugador, objetivo.posicion);
    if (!r.revelada) {
      estado = saltarPoder(estado);
      return;
    }
    estado = r.estado;
    memorias[i] = IA.recordar(
      memoria,
      estado.jugadores[i].dificultad,
      objetivo.indiceJugador,
      objetivo.posicion,
      r.revelada.carta,
      () => 0,
    );
    // Se ve QUÉ posición miró, pero no la carta.
    //
    // El ojo lo pone `ojosDelRegistroLocal` desde el registro, igual que en
    // red. Acá había además un destello de un segundo puesto a mano: dos
    // marcas para el mismo hecho, una de ellas sólo para este poder y ninguna
    // para la mirada inicial ni para el 10.
    dibujar();
    sonidos.voltear();
    cartel(tipo);
    await esperar(MS_MARCA_PODER);
    return;
  }

  const objetivo = IA.decidirObjetivoCambio(
    estado,
    i,
    memoria,
    tipo === "cambioCiego",
  );
  if (!objetivo) {
    estado = saltarPoder(estado);
    return;
  }
  const r = usarPoderCambio(
    estado,
    objetivo.posicionPropia,
    objetivo.indiceRival,
    objetivo.posicionRival,
  );
  estado = r.estado;

  // Con el 10 el motor se detiene a esperar la decisión, así que la IA también
  // decide: cambia sólo si la del rival es más baja que la suya. Es la misma
  // información que ve un humano en el modal, sin ventaja ni desventaja.
  if (r.revelada) {
    const conviene =
      (r.revelada.rival?.numero ?? 99) < (r.revelada.propia?.numero ?? 99);
    estado = resolverCambioConVista(estado, conviene);
    // La mesa se entera de lo que decidió la IA, igual que de lo que decide
    // un humano. Si no, el 10 de las IA sería invisible.
    cartel(conviene ? "cambio" : "sinCambio");
    if (!conviene) {
      // No cambió: sigue sabiendo qué tiene el rival ahí.
      memorias[i] = IA.recordar(
        memorias[i], estado.jugadores[i].dificultad,
        objetivo.indiceRival, objetivo.posicionRival, r.revelada.rival, () => 0,
      );
      dibujar();
      sonidos.clic();
      await esperar(1100);
      return;
    }
  }

  memorias = memorias.map((m) =>
    IA.olvidar(
      IA.olvidar(m, i, objetivo.posicionPropia),
      objetivo.indiceRival,
      objetivo.posicionRival,
    ),
  );
  dibujar();
  sonidos.whoosh();
  efectoCambio(
    tipo,
    i,
    objetivo.posicionPropia,
    objetivo.indiceRival,
    objetivo.posicionRival,
  );
  await esperar(1100);
}

// ------------------------------------------------- acciones del humano

dom.btnLevantar.addEventListener("click", () => {
  if (enRed()) {
    pedir("levantar", () => Red.levantar(salaPedida));
    return;
  }
  if (estado.fase !== "turno" || estado.indiceTurno !== YO) return;
  sonidos.voltear();
  estado = levantar(estado);
  const poder = PODERES[estado.levantada?.numero];
  pista(
    poder
      ? `Levantaste un <b>${estado.levantada.numero}</b>: tenés un poder disponible.`
      : "Tocá una de tus cartas para <b>cambiarla</b>, o <b>tirá</b> la carta.",
  );
  dibujar();
  // El poder nunca se activa solo: se pregunta apenas aparece la carta.
  if (poder) {
    sonidos.poder();
    abrirModalDecisionPoder();
  }
});

dom.btnTirar.addEventListener("click", async () => {
  if (enRed()) {
    await pedir("tirar", () => Red.tirarCarta(salaPedida));
    return;
  }
  if (estado.fase !== "levantada" || estado.indiceTurno !== YO) return;
  // Ya no se pregunta acá si querés usar el poder. La carta se tira igual que
  // cualquier otra, la mesa tiene sus reflejos, y recién entonces se abre la
  // elección del poder. Preguntar antes le habría dado a las cartas de poder
  // un atajo que salteaba la ventana de todos.
  sonidos.whoosh();
  estado = tirarCarta(estado);
  dibujar();
  if (await trasPonerMuestra()) {
    abrirModalPoder();
    return;
  }
  if (estado.fase === "postLevantada") {
    pista("CORTAR O PASAR");
  }
});

dom.btnCortar.addEventListener("click", async () => {
  if (enRed()) {
    await pedir("cortar", () => Red.cortar(salaPedida));
    return;
  }
  if (estado.fase !== "postLevantada" || estado.indiceTurno !== YO) return;
  sonidos.corte();
  estado = cortar(estado);
  pista("Corte. Se revelan todas las manos…");
  dibujar();
  await mostrarFinRonda();
});

dom.btnPasar.addEventListener("click", () => {
  if (enRed()) {
    pedir("pasar", () => Red.pasarTurno(salaPedida));
    return;
  }
  if (estado.fase !== "postLevantada" || estado.indiceTurno !== YO) return;
  sonidos.clic();
  estado = pasarTurno(estado);
  dibujar();
  cicloTurnos();
});

// «He vuelto». Sólo es visible mientras uno está marcado; ver `heVuelto`.
dom.btnHeVuelto?.addEventListener("click", heVuelto);

// Clic en el mazo equivale a levantar.
dom.mazoCarta.addEventListener("click", () => {
  if (enRed()) {
    pedir("levantar", () => Red.levantar(salaPedida));
    return;
  }
  if (!dom.btnLevantar.disabled) dom.btnLevantar.click();
});

// Clic en la carta levantada: reabre la pregunta del poder.
dom.levantadaCarta.addEventListener("click", () => {
  if (estado.fase !== "levantada" || estado.indiceTurno !== YO) return;
  if (!PODERES[estado.levantada?.numero]) return;
  sonidos.clic();
  abrirModalDecisionPoder();
});

// Manejadores que las fases instalan y desinstalan.
let manejadorMirada = null;
let manejadorDescarte = null;

/**
 * Última carta que mandé, para mostrarla resaltada mientras se resuelve.
 *
 * NO es un candado: un jugador puede intentar varias veces en la misma
 * ventana, y debe poder. Sobre una carta conocida de un rival se puede volver
 * a intentar mientras dure la ventana, pagando un castigo por cada error: es
 * la regla del descarte al rival.
 *
 * ─────────────────────────────────────────────────────────────────────
 * VIVE UNA VENTANA, Y HAY QUE APAGARLA AL FINAL
 * ─────────────────────────────────────────────────────────────────────
 *
 * Se ponía y no se apagaba nunca: no había una sola vuelta a `null` en todo
 * el archivo. Como el resaltado sólo se dibuja en fase `descarte`, el error no
 * se veía en la ventana en la que se tocó — se veía en la SIGUIENTE, y en
 * todas las de la ronda, con una carta marcada que nadie había mandado esta
 * vez.
 *
 * Se apaga en las dos transiciones que cierran una ventana, una por modo: al
 * abrir la de entrenamiento, y al salir de `descarte` en red. No alcanza con
 * borrar la clase del DOM: `dibujar()` reconstruye los asientos enteros en
 * cada pasada y `marcarCartasJugables` la vuelve a poner, porque el dato
 * seguía ahí.
 */
let posicionEnviada = null;

/**
 * Un acierto sobre la carta de un rival que espera la carta propia a entregar.
 *
 * La regla dice que esa carta se elige DESPUÉS de acertar, y nunca al errar.
 * Así que esto sólo existe tras un acierto: en entrenamiento lo dice el motor
 * en el momento; en red, la respuesta del servidor al ataque.
 *
 *   { indiceJugador, posicion }   la carta del rival que se acertó
 *   vence                         el temporizador que la elige al azar
 *   terminada                     (entrenamiento) promesa que la ventana
 *                                 espera antes de cerrarse
 *   clientActionId, ventana       (red) a qué ataque va la entrega
 */
let atacando = null;

/**
 * Jugadas de la IA que llegaron mientras se elegía la carta de un acierto.
 *
 * Esperan detrás de ese acierto: el toque del jugador fue antes, y en red el
 * servidor los ordena igual —por el momento del toque, no por cuándo llega la
 * carta—. Aplicarlas en el medio podía llevarse la carta ya acertada.
 */
let jugadasEnEspera = [];

/** Cuándo termina la ventana de entrenamiento en curso, para volver a su reloj. */
let finDeLaVentana = 0;

/**
 * Suelta el acierto que esperaba su carta, sin aplicar nada.
 *
 * En red, cuando la ventana se resuelve o la fase cambia: el servidor ya
 * eligió al azar. Deja la mesa como si no hubiera nada apuntado.
 */
function olvidarAtaque() {
  if (!atacando) return;
  clearTimeout(atacando.vence);
  atacando = null;
  cancelarTemporizador();
}

/** Deja marcada la carta que salió hacia el servidor. */
function marcarEnviada(posicion) {
  posicionEnviada = posicion;
  dibujar();
}

/** Cuánto dura el destello del primer toque. */
const MS_PRIMER_TOQUE = 150;

/**
 * Acusa recibo del PRIMER toque de un descarte.
 *
 * El problema que resuelve: descartar pide dos toques, y hasta que llega el
 * segundo la mesa no hacía nada visible. Con cinco segundos de ventana y la
 * carta quieta, el primer toque se lee como "no me registró" y la reacción
 * natural es tocar más fuerte o más veces —justo lo que cuesta cartas—. Un
 * destello de 150 ms alcanza para que se entienda "te oí, falta uno".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO NO PUEDE ESTORBAR AL DOBLE TOQUE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque no toca nada de lo que el doble toque depende:
 *
 *   - NO llama a `dibujar()`. Si redibujara, el nodo de la carta sería otro
 *     objeto para cuando llegue el segundo toque. El `click` igual llegaría
 *     —el manejador está en `document`— pero es exactamente la clase de
 *     cambio que rompe cosas en iOS, donde el segundo toque ya viaja al
 *     límite. Se toca una clase del elemento que ya está y nada más.
 *   - NO cambia `pointer-events` ni la geometría: la animación es un
 *     `transform` de dos píxeles, que no mueve la caja de impactos.
 *   - NO interviene en la cuenta de toques. `esSegundoToque` corre antes y en
 *     su propia línea; esto pasa después y sólo pinta.
 *
 * El `void offsetWidth` es para poder destellar dos veces seguidas sobre la
 * misma carta: sin forzar el reflujo, volver a poner una clase que el
 * navegador todavía no sacó no reinicia la animación.
 */
function destelloPrimerToque(cartaEl) {
  if (!cartaEl) return;
  cartaEl.classList.remove("carta-primer-toque");
  void cartaEl.offsetWidth;
  cartaEl.classList.add("carta-primer-toque");
  setTimeout(
    () => cartaEl.classList.remove("carta-primer-toque"),
    MS_PRIMER_TOQUE,
  );
}

/**
 * Cuánto puede pasar entre los dos toques de un descarte.
 *
 * Cuatrocientos milisegundos, que es más o menos lo que usan los sistemas
 * operativos para su propio doble clic. Sólo se usa cuando el navegador no
 * cuenta los toques por su cuenta —o sea, en iOS—; donde `detail` funciona,
 * manda el navegador y este número no interviene.
 */
const MS_ENTRE_TOQUES = 400;

/**
 * La ráfaga de toques en curso: sobre qué carta y desde cuándo.
 *
 * `yaConto` es lo que hace que una ráfaga dispare UN solo descarte. Sin él,
 * tres toques seguidos serían dos intentos y el jugador se comería dos cartas
 * de castigo por apurarse.
 */
let rafaga = { clave: null, cuando: 0, yaConto: false };

/**
 * ¿Este toque es el SEGUNDO de una ráfaga sobre la misma carta?
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO ALCANZA CON `evento.detail`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque en iPhone no funciona. `detail` lo cuenta el navegador, y Safari en
 * iOS sintetiza cada toque como un clic con `detail: 1`: nunca llega el 2, así
 * que el descarte no se disparaba jamás. En PC y en Android sí cuenta, y ahí
 * `detail === 2` sigue siendo la respuesta —la da el sistema operativo, con la
 * noción de doble clic que el jugador ya tiene configurada—.
 *
 * Así que se usan los dos: el del navegador cuando existe, y éste cuando no.
 * No se sustituyó el primero por el segundo porque el del sistema es el que
 * respeta la preferencia de cada persona.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ESTO NO AGREGA NI UN MILISEGUNDO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Importa, porque este toque es una jugada de reflejos y el servidor ordena
 * los intentos con 60 ms de tolerancia. La comprobación es una resta y dos
 * comparaciones dentro del mismo manejador del clic: el descarte sale en el
 * mismo instante que salía antes. NO hay temporizador esperando un tercer
 * toque, que es la forma habitual —y lenta— de detectar un doble toque.
 */
function esSegundoToque(clave, cuando) {
  const sigueLaRafaga =
    rafaga.clave === clave && cuando - rafaga.cuando <= MS_ENTRE_TOQUES;

  if (!sigueLaRafaga) {
    // Otra carta, o pasó demasiado: empieza una ráfaga nueva y éste es el
    // primer toque, que nunca descarta.
    rafaga = { clave, cuando, yaConto: false };
    return false;
  }

  rafaga.cuando = cuando;
  if (rafaga.yaConto) return false; // del tercero en adelante, ya se disparó
  rafaga.yaConto = true;
  return true;
}

document.addEventListener("click", async (evento) => {
  const cartaEl = evento.target.closest(".carta[data-posicion]");
  if (!cartaEl) return;
  const jugadorEl = cartaEl.closest(".jugador");
  if (!jugadorEl) return;

  const indiceJugador = Number(jugadorEl.dataset.jugador);
  const posicion = Number(cartaEl.dataset.posicion);

  // Descartar exige DOS toques. El primero no descarta: un roce accidental
  // dejó de costar una carta de castigo.
  //
  // Las dos formas de contarlos, y hace falta tener las dos:
  //
  //   `detail === 2`   lo cuenta el navegador con la noción de doble clic del
  //                    sistema operativo. Es la buena donde funciona: respeta
  //                    la preferencia de cada persona. Es `=== 2` y no `>= 2`
  //                    porque una ráfaga de tres llega como 1, 2 y 3, y con
  //                    `>= 2` se dispararían DOS intentos.
  //
  //   `esSegundoToque` la nuestra, para iOS, donde Safari manda cada toque con
  //                    `detail: 1` y el 2 no llega nunca. Ver la nota larga
  //                    arriba: no agrega latencia.
  //
  // En PC las dos dicen que sí en el mismo evento, y como es un solo evento
  // hay una sola llamada. En iPhone sólo dice que sí la segunda.
  // No se llama `clave` a propósito: ése es el nombre de una función que este
  // archivo importa de `modulos/cartas.js`, y una constante con el mismo
  // nombre la taparía dentro de este manejador. Hoy acá no se la llama, así
  // que no rompería nada — y por eso mismo el día que alguien la use sería un
  // "clave is not a function" que no se entiende.
  const cartaTocada = `${indiceJugador}:${posicion}`;

  // `esSegundoToque` se llama SIEMPRE y en su propia línea, no dentro del `||`.
  //
  // Escrito como `evento.detail === 2 || esSegundoToque(...)`, el `||` corta la
  // evaluación: en el segundo clic `detail === 2` ya es verdadero y la función
  // NO corre, así que su cuenta se queda sin ver ese toque. Entonces cree que
  // el TERCERO es el segundo y dispara un intento más — dos cartas de castigo
  // por un triple clic.
  //
  // Lo atajó la prueba "tres clics seguidos son UN intento, no tres", que
  // existía desde antes justamente para esto.
  const segundoToquePropio = esSegundoToque(cartaTocada, evento.timeStamp);
  const dobleClic = evento.detail === 2 || segundoToquePropio;

  // En red no se decide nada acá: se pide y se espera la vista nueva.
  if (enRed()) {
    await clicEnCartaDeRed(indiceJugador, posicion, dobleClic);
    return;
  }

  if (estado.fase === "mirar" && indiceJugador === YO) {
    if (manejadorMirada) {
      manejadorMirada(posicion);
    } else {
      /**
       * Durante la cuenta regresiva no se dice nada.
       *
       * La fase ya es `mirar` pero `faseMirada` todavía no puso su manejador,
       * así que un toque caía acá y la mesa contestaba «una sola carta por
       * ronda» a alguien que no había mirado ninguna. En red no pasaba:
       * `miradaTodaviaCerrada` apaga las cartas hasta que la cuenta termina.
       */
      if (enCuentaRegresiva) return;

      // Ya eligió: se explica por qué no pasa nada, en vez de ignorar el clic.
      sonidos.error();
      pista("⚠️ Ya miraste: una carta por ronda");
      const carta = cartaEl;
      carta.classList.add("rechazada");
      setTimeout(() => carta.classList.remove("rechazada"), 600);
    }
    return;
  }

  // Tocar la mano de otro jugador nunca hace nada, pero conviene decirlo.
  if (estado.fase === "mirar" && indiceJugador !== YO) {
    sonidos.error();
    pista("⚠️ Sólo una carta <b>tuya</b>");
    return;
  }

  // Entregar la carta propia, tras un acierto.
  //
  // Un solo toque, a diferencia de todo lo demás en esta fase. La decisión ya
  // se tomó —y se confirmó con dos toques— al apuntar la carta del rival.
  //
  // No pide `manejadorDescarte`: la ventana puede haber terminado mientras se
  // elegía, y esta elección tiene su propio reloj.
  if (estado.fase === "descarte" && atacando && indiceJugador === YO) {
    completarEntregaLocal(posicion);
    return;
  }
  // Con un acierto esperando su carta, lo demás de la ventana espera.
  if (estado.fase === "descarte" && atacando) return;

  // Descartarle a un rival una carta que conozco.
  //
  // Sólo esa carta: `puedoAtacarAhi` lo resuelve con la misma regla del motor
  // que usa el servidor en red. Antes preguntaba por la mano entera, y las
  // cartas que marcaba un fallo ajeno se veían atacables pero el toque no
  // hacía nada.
  if (
    estado.fase === "descarte" &&
    manejadorDescarte &&
    indiceJugador !== YO &&
    puedoAtacarAhi(indiceJugador, posicion)
  ) {
    if (!dobleClic) {
      destelloPrimerToque(cartaEl);
      pista("¡Doble toque en la del rival!");
      return;
    }

    // Primero el resultado: la carta a entregar se elige sólo si acertó.
    const resultado = evaluarAtaque(estado, YO, indiceJugador, posicion);
    if (resultado === "error") {
      estado = intentarDescarteRival(estado, YO, indiceJugador, posicion, null);
      resolverUltimoDescarte();
      dibujar();
      pista("No era esa: te comés una carta.");
      return;
    }
    if (resultado === "acierto") empezarEntregaLocal({ indiceJugador, posicion });
    return;
  }

  // Una carta ajena que no conozco: no hay intento, y se dice por qué.
  if (estado.fase === "descarte" && manejadorDescarte && indiceJugador !== YO) {
    if (dobleClic) pista("⚠️ Esa carta no la conocés");
    return;
  }

  if (estado.fase === "descarte" && manejadorDescarte && indiceJugador === YO) {
    // Ya tiró en esta ventana: el motor no haría nada con el toque, así que
    // se dice por qué en vez de dejarlo en un clic que no pasa nada.
    if (yaIntentoLoSuyo(estado, YO)) {
      sonidos.error();
      pista("⚠️ Un tiro por ventana: ya jugaste el tuyo");
      cartaEl.classList.add("rechazada");
      setTimeout(() => cartaEl.classList.remove("rechazada"), 600);
      return;
    }
    if (!dobleClic) {
      destelloPrimerToque(cartaEl);
      pista("¡Doble toque si estás seguro!");
      return;
    }
    manejadorDescarte(posicion);
    return;
  }

  if (
    estado.fase === "levantada" &&
    estado.indiceTurno === YO &&
    indiceJugador === YO
  ) {
    sonidos.voltear();
    estado = cambiarCarta(estado, posicion);
    dibujar();
    // La carta que sale de la mano queda de muestra, así que esto también
    // abre reflejos. Y si esa carta era un poder, el poder es de quien la
    // entregó: en un juego de memoria, eso significa que uno puede activar
    // un poder sin haber sabido que lo tenía.
    if (await trasPonerMuestra()) {
      abrirModalPoder();
      return;
    }
    pista("CORTAR O PASAR");
  }
});

// --------------------------------------------------------- modal poderes

function manoParaElegir(i, { soloVacias = false } = {}) {
  return estado.jugadores[i].mano
    .map((carta, pos) => {
      if (!carta) return `<div class="hueco vacio"></div>`;
      if (soloVacias) return "";
      return `
        <button class="carta jugable ${claseAsiento(i)}" data-objetivo="${i}" data-pos="${pos}" type="button">
          <span class="posicion">${pos}</span>
          <span class="lados">
            <span class="dorso"><img src="${dorsoDe(i)}" alt="" /></span>
            <span class="cara"></span>
          </span>
          <span class="zona-carta" aria-hidden="true"></span>
        </button>`;
    })
    .join("");
}

/** Qué hace el poder: se muestra antes de decidir si conviene usarlo. */
const EFECTOS_PODER = {
  mirarPropia: "Mirás una carta tuya, la hayas visto antes o no.",
  mirarRival: "Mirás una carta de cualquier otro jugador.",
  cambioCiego:
    "Intercambiás una carta tuya por una de un rival, sin ver ninguna de las dos.",
  cambioConVista:
    "Intercambiás una carta tuya por una de un rival, viendo ambas antes.",
};

const INSTRUCCIONES_PODER = {
  mirarPropia: "Elegí una de tus posiciones. La verás 2 segundos.",
  mirarRival: "Elegí una carta de otro jugador. La verás 2 segundos.",
  cambioCiego:
    "Elegí una carta tuya y una de un rival. No verás ninguna de las dos.",
  cambioConVista:
    "Elegí una carta tuya y una de un rival. Verás ambas antes del cambio.",
};

/**
 * Primer paso: el poder NO se activa solo. Se pregunta si se usa.
 * Si no se usa, la carta queda descartada como cualquier otra.
 */
function abrirModalDecisionPoder() {
  const carta = estado.levantada;
  if (!carta) return;
  const tipo = PODERES[carta.numero];

  abrirModal(`
    <div class="carta-poder">
      <img src="${caraDeCarta(carta)}" alt="${carta.numero} de ${carta.palo}" />
    </div>
    <h2>¡Levantaste un PODER ${carta.numero}!</h2>
    <p class="nombre-poder">${TITULOS_PODER[tipo]}</p>
    <p>${EFECTOS_PODER[tipo]}</p>
    <div class="botonera-poder">
      <button class="accion" data-accion="usar-poder" type="button">🔮 Usar poder</button>
      <button class="accion sobria" data-accion="tirar-sin-poder" type="button">💨 Tirar carta</button>
    </div>
    <button class="enlace-modal" data-accion="cambiar-poder" type="button">
      o cambiala por una carta tuya (perdés el poder)
    </button>
  `);
}

/** Segundo paso: sólo si eligió usarlo, se elige el objetivo. */
function abrirModalPoder() {
  const { tipo, numero } = estado.poderPendiente;
  seleccionPropia = null;

  const titulos = TITULOS_PODER;
  const descripciones = INSTRUCCIONES_PODER;

  const soloPropias = tipo === "mirarPropia";
  const grupos = estado.jugadores
    .map((jugador, i) => {
      if (jugador.eliminado) return "";
      if (soloPropias && i !== YO) return "";
      if (tipo === "mirarRival" && i === YO) return "";
      const titulo = i === YO ? "Tus cartas" : jugador.nombre;
      return `
        <div class="grupo-objetivo">
          <div class="titulo">${titulo}</div>
          <div class="mano">${manoParaElegir(i)}</div>
        </div>`;
    })
    .join("");

  abrirModal(`
    <h2>⚡ Poder ${numero} — ${titulos[tipo]}</h2>
    <p>${descripciones[tipo]}</p>
    <div class="objetivos">${grupos}</div>
    <button class="accion sobria" data-accion="saltar" type="button">Cancelar y descartar</button>
  `);
}

dom.btnAbandonar.addEventListener("click", () => {
  sonidos.clic();
  abrirModalAbandono();
});

dom.modal.addEventListener("click", async (evento) => {
  if (evento.target.closest('[data-accion="red-saltar-poder"]')) {
    cerrarModal();
    await pedir("saltarPoder", () => Red.saltarPoder(salaPedida));
    return;
  }
  if (evento.target.closest('[data-accion="red-elegir-objetivo"]')) {
    cerrarModal();
    // Elegir el objetivo es un clic sobre la mesa, no otro modal: se marca
    // qué se puede tocar y el clic siguiente manda la jugada.
    const numero = miVista?.poderPendiente?.numero;
    eligiendoPoder = { numero, propia: null };
    dibujar();
    pista(pasoDelPoder({ numero, propiaElegida: null }));
    return;
  }

  // La segunda mitad del 10. Sirve igual en entrenamiento y en red: lo que
  // cambia es quién aplica la decisión, y de eso se ocupa `resolverElDiez`.
  const diez = evento.target.closest('[data-accion="diez-cambiar"], [data-accion="diez-dejar"]');
  if (diez) {
    await resolverElDiez(diez.dataset.accion === "diez-cambiar");
    return;
  }

  if (evento.target.closest('[data-accion="abandonar-no"]')) {
    cerrarModal();
    return;
  }

  // ---- la revancha, al final de una partida por Leyendas ----
  if (evento.target.closest('[data-accion="revancha-igual"]')) {
    sonidos.clic();
    await irALaRevancha(apuestaDeLaMesa());
    return;
  }
  if (evento.target.closest('[data-accion="revancha-cambiar"]')) {
    sonidos.clic();
    pintarRevancha(panelDeApuesta());
    return;
  }
  if (evento.target.closest('[data-accion="revancha-crear"]')) {
    sonidos.clic();
    const elegida = Number(document.getElementById("apuestaRevancha")?.value);
    await irALaRevancha(ENTRADAS.includes(elegida) ? elegida : apuestaDeLaMesa());
    return;
  }
  if (evento.target.closest('[data-accion="revancha-unirme"]')) {
    sonidos.clic();
    // La misma llamada que para abrirla: encuentra la que ya existe y
    // devuelve su código. La apuesta la fijó quien la abrió.
    await irALaRevancha(revanchaAbierta?.entrada ?? apuestaDeLaMesa());
    return;
  }
  if (evento.target.closest('[data-accion="revancha-salir"]')) {
    if (dejarDeMirarLaSala) dejarDeMirarLaSala();
    window.location.href = "dashboard.html";
    return;
  }
  const confirmar = evento.target.closest('[data-accion="abandonar-si"]');
  if (confirmar) {
    await confirmarAbandono(confirmar);
    return;
  }

  // 🔮 Usar poder / 💨 Tirar carta: los dos tiran la carta y esperan a que la
  // mesa tenga sus reflejos. La diferencia aparece DESPUÉS: uno abre la
  // elección del poder y el otro renuncia. Antes esta rama salteaba la
  // ventana, que es justamente lo que se vino a corregir.
  const usar = evento.target.closest('[data-accion="usar-poder"]');
  const tirarSinPoder = evento.target.closest(
    '[data-accion="tirar-sin-poder"]',
  );
  if (usar || tirarSinPoder) {
    sonidos[usar ? "whoosh" : "clic"]();
    estado = tirarCarta(estado);
    cerrarModal();
    dibujar();
    const hayPoder = await trasPonerMuestra();
    if (hayPoder && usar) {
      abrirModalPoder();
      return;
    }
    if (hayPoder) estado = saltarPoder(estado);
    dibujar();
    pista(
      usar
        ? "CORTAR O PASAR"
        : "Tiraste la carta sin usar el poder. Podés <b>cortar</b> o <b>pasar</b> el turno.",
    );
    return;
  }

  // Salida al reglamento: cambiarla por una propia sacrificando el poder.
  const cambiarPoder = evento.target.closest('[data-accion="cambiar-poder"]');
  if (cambiarPoder) {
    sonidos.clic();
    cerrarModal();
    pista("Tocá una de tus cartas para <b>cambiarla</b> por la levantada.");
    dibujar();
    return;
  }

  const saltar = evento.target.closest('[data-accion="saltar"]');
  if (saltar) {
    sonidos.clic();
    estado = saltarPoder(estado);
    cerrarModal();
    seleccionPropia = null;
    // Sin reflejos acá: la mesa ya los tuvo cuando la carta se tiró, antes de
    // que apareciera esta elección. Abrir otra ventana al renunciar le daría
    // dos oportunidades por la misma carta.
    pista(
      "Descartaste sin usar el poder. Podés <b>cortar</b> o <b>pasar</b> el turno.",
    );
    dibujar();
    return;
  }

  const siguiente = evento.target.closest('[data-accion="siguiente"]');
  if (siguiente) {
    // Sea quien sea el que la apretó —el jugador o el avance automático de un
    // ausente—, ya no hay nada que avanzar solo. Sin esto, un clic a mano
    // dejaría el temporizador vivo, esperando un modal que ya no existe.
    clearTimeout(avanceDeRondaPendiente);
    avanceDeRondaPendiente = null;
    cerrarModal();
    if (estado.fase === "finPartida") return;
    estado = siguienteRonda(estado);
    memorias = estado.jugadores.map(() => IA.crearMemoria());
    revelaciones.clear();
    dibujar();

    // El reparto también se ve en las rondas siguientes, no sólo en la
    // primera.
    //
    // `empezarRonda` baraja una baraja NUEVA en cada ronda —está comprobado en
    // `pruebas/limite-puntos.mjs`: cinco rondas dan cinco repartos distintos—
    // pero eso ocurría sin que se notara: las cartas aparecían ya puestas. Ver
    // volar las cartas es lo que hace evidente que se repartió de nuevo, y
    // evita la sospecha razonable de que la ronda dos juega con el mazo de la
    // uno.
    //
    // La cuenta regresiva NO se repite: es para avisar que arranca la partida,
    // y a esta altura ya se está jugando.
    sonidos.repartir();
    await animarReparto();

    await faseMirada();
    return;
  }

  const objetivo = evento.target.closest("[data-objetivo]");
  if (!objetivo || !estado.poderPendiente) return;

  const i = Number(objetivo.dataset.objetivo);
  const pos = Number(objetivo.dataset.pos);
  const { tipo } = estado.poderPendiente;

  if (tipo === "mirarPropia" || tipo === "mirarRival") {
    const r = usarPoderMirar(estado, i, pos);
    if (!r.revelada) return;
    estado = r.estado;
    cerrarModal();
    pista("Memorizá…");
    correrTemporizador(MS_MIRAR, "poder: mirar");
    // El que mira ve la carta; el resto de la mesa, sólo el aviso de que la
    // miró. Son dos cosas distintas y por eso van por caminos distintos.
    cartel(tipo);
    await revelarUnMomento(i, pos);
    cancelarTemporizador();
    // El 8 deja saber una carta ajena, así que acá puede abrirse la ventana
    // para ir a buscarla. El 7 mira una propia y no abre nada.
    await trasResolverElPoder();
    return;
  }

  // Poderes de cambio: primero la carta propia, después la del rival.
  if (i === YO) {
    seleccionPropia = pos;
    dom.modal
      .querySelectorAll('[data-objetivo="' + YO + '"]')
      .forEach((el) =>
        el.classList.toggle("seleccionada", Number(el.dataset.pos) === pos),
      );
    return;
  }

  if (seleccionPropia == null) {
    dom.modal.querySelector("p").textContent = "Primero elegí una carta tuya.";
    return;
  }

  const r = usarPoderCambio(estado, seleccionPropia, i, pos);
  const revelada = r.revelada;
  estado = r.estado;
  cerrarModal();

  const propiaUsada = seleccionPropia;
  sonidos.whoosh();

  if (revelada) {
    // El 10 muestra las dos cartas y ESPERA. Antes revelaba y cambiaba de una,
    // que es lo mismo que no mostrar nada: ver algo que ya no podés usar para
    // decidir no es información, es el acta de lo que te pasó.
    revelaciones.set(clave(i, pos), revelada.rival);
    revelaciones.set(clave(YO, propiaUsada), revelada.propia);
    dibujar();
    efectoCambio("cambioConVista", YO, propiaUsada, i, pos);
    preguntarSiCambia(revelada, propiaUsada, i, pos);
    return;
  }

  dibujar();
  efectoCambio("cambioCiego", YO, propiaUsada, i, pos);
  await esperar(1100);

  seleccionPropia = null;
  // El 9 no mira nada, así que por sí solo no abre ventana. Se llama igual
  // porque quien lo usó puede venir sabiendo algo de un poder anterior, y
  // entonces sí corresponde — la decisión no es de acá, es de `objetivosDe`.
  await trasResolverElPoder();
});

/**
 * La segunda mitad del 10: con las dos cartas a la vista, cambiar o dejar.
 *
 * Las cartas se quedan destapadas mientras dure la decisión y no un par de
 * segundos: se está decidiendo CON ellas, no mirándolas de recuerdo. Se tapan
 * al resolver.
 */
function preguntarSiCambia(revelada, posicionPropia, indiceRival, posicionRival) {
  const nombreRival = estado.jugadores[indiceRival].nombre;
  abrirModal(`
    <h2>Cambio viendo ambas cartas</h2>
    <div class="cartas-del-diez">
      <figure>
        <img src="${caraDeCarta(revelada.propia)}"
             alt="Tu carta: ${revelada.propia?.numero} de ${revelada.propia?.palo}" />
        <figcaption>La tuya · <b>${revelada.propia?.numero ?? "?"}</b></figcaption>
      </figure>
      <span class="flecha" aria-hidden="true">⇄</span>
      <figure>
        <img src="${caraDeCarta(revelada.rival)}"
             alt="Carta de ${escapar(nombreRival)}: ${revelada.rival?.numero} de ${revelada.rival?.palo}" />
        <figcaption>${escapar(nombreRival)} · <b>${revelada.rival?.numero ?? "?"}</b></figcaption>
      </figure>
    </div>
    <p>Cambiás sólo si te conviene. Gana quien menos suma.</p>
    <div class="botonera-poder">
      <button class="accion" data-accion="diez-cambiar" type="button">⇄ Cambiar</button>
      <button class="accion sobria" data-accion="diez-dejar" type="button">✋ Dejar como está</button>
    </div>
  `);
}

/** Cierra el 10 con la decisión tomada, en cualquiera de los dos modos. */
async function resolverElDiez(cambiar) {
  cerrarModal();
  revelaciones.clear();
  seleccionPropia = null;

  if (enRed()) {
    await pedir("resolverCambio", () => Red.resolverCambio(salaPedida, cambiar));
    return;
  }

  estado = resolverCambioConVista(estado, cambiar);
  sonidos[cambiar ? "whoosh" : "clic"]();
  // En entrenamiento no hay vistas del servidor, así que el aviso se dispara
  // acá. En red lo hace `mostrarMiradas` al recibir el registro.
  cartel(cambiar ? "cambio" : "sinCambio");
  // El 10 miró una carta del rival, así que acá suele haber ventana. Si no la
  // hay —porque el cambio se llevó justo lo que sabía— se dice cómo terminó,
  // que es lo que se decía antes siempre.
  await trasResolverElPoder(
    cambiar
      ? "Cambiaste la carta. Podés <b>cortar</b> o <b>pasar</b> el turno."
      : "Dejaste las cartas donde estaban. Podés <b>cortar</b> o <b>pasar</b> el turno.",
  );
}

// -------------------------------------------------------- fin de ronda

async function mostrarFinRonda() {
  cancelarTemporizador();
  cancelarRelojTurno();
  dibujar();
  // Las manos quedan a la vista un momento antes de tapar con el resumen.
  await esperar(RITMO.trasCorte);

  const cortador = estado.jugadores[estado.indiceCortador];
  const filas = estado.jugadores
    .map((j, i) => {
      const mano = puntosMano(j.mano);
      const enRonda = j.puntosRonda ?? 0;
      // Lo que el corte sumó o restó sobre la mano: -10 por quedarse sin
      // cartas, +10 por cortar sin tener el puntaje más bajo, 0 en el resto.
      const cambio = enRonda - mano;
      return `
        <tr class="${i === estado.indiceCortador ? "cortador" : ""} ${j.eliminado ? "fuera" : ""}">
          <td>${escapar(j.nombre)}${i === estado.indiceCortador ? " ✂️" : ""}</td>
          <td class="num">${mano}</td>
          <td class="num ${cambio < 0 ? "bueno" : cambio > 0 ? "malo" : ""}">${cambio > 0 ? "+" : ""}${cambio || 0}</td>
          <td class="num">${enRonda > 0 ? "+" : ""}${enRonda}</td>
          <td class="num"><b>${j.puntos}</b></td>
          <td>${j.eliminado ? "eliminado" : ""}</td>
        </tr>`;
    })
    .join("");

  const tabla = `
    <table class="tabla-final">
      <thead>
        <tr><th>Jugador</th><th class="num">Mano</th><th class="num">Cambio</th><th class="num">Ronda</th><th class="num">Total</th><th></th></tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>`;

  if (estado.fase === "finPartida") {
    const ganaste = estado.ganador?.id === estado.jugadores[YO].id;
    abrirModal(`
      <div class="corona">${ganaste ? "🏆" : "🃏"}</div>
      <h2>${ganaste ? "¡Ganaste!" : `${estado.ganador?.nombre ?? "Nadie"} gana la partida`}</h2>
      <p>Último jugador por debajo de ${estado.limitePuntos ?? LIMITE_ELIMINACION} puntos.</p>
      ${tabla}
      <button class="accion" onclick="location.reload()" type="button">Jugar otra</button>
    `);
    pista(
      `Partida terminada. Ganó <b>${escapar(estado.ganador?.nombre ?? "nadie")}</b>.`,
    );
    if (ganaste) {
      sonidos.victoria();
      lanzarConfeti(dom.confeti);
    } else {
      sonidos.derrota();
    }
    return;
  }

  pista(
    `Cortó <b>${escapar(cortador?.nombre ?? "alguien")}</b>. Ronda ${estado.ronda} terminada.`,
  );
  abrirModal(`
    <h2>✂️ Cortó ${escapar(cortador?.nombre ?? "alguien")}</h2>
    <p>Ronda ${estado.ronda} terminada.</p>
    ${tabla}
    <button class="accion" data-accion="siguiente" type="button">Siguiente ronda</button>
  `);

  /**
   * Un ausente tampoco se espera entre rondas.
   *
   * En red el servidor reparte solo a los `MS_ENTRE_RONDAS`; acá, sin esto, la
   * partida quedaría parada en este modal hasta que volviera. Mismo número que
   * allá, importado del motor y no escrito de nuevo.
   *
   * Se aprieta el MISMO botón y no se copia lo que hace: así el reparto, la
   * animación y la mirada siguen saliendo de un solo lugar.
   *
   * La partida terminada no llega acá —ya retornó arriba—: después de la
   * última ronda no hay nada que avanzar.
   */
  if (ausenteLocal) {
    clearTimeout(avanceDeRondaPendiente);
    avanceDeRondaPendiente = setTimeout(() => {
      avanceDeRondaPendiente = null;
      dom.modal.querySelector('[data-accion="siguiente"]')?.click();
    }, MS_ENTRE_RONDAS);
  }
}

// ==================================================================
// MODO LEYENDAS — el motor corre en el servidor
// ==================================================================
//
// Acá NO se juega: se dibuja lo que llega y se piden acciones. Este bloque
// no importa el motor, no calcula puntajes, no decide turnos y no toca
// Firestore para escribir. Si alguna de esas cosas apareciera acá, sería la
// señal de que el cliente volvió a ser autoridad de algo.

let dejarDeEscuchar = null;
let dejarDeLatir = null;
let dejarDeAvanzar = null;
let dejarDeRescatar = null;

/** Freno propio del descarte: no comparte el de `pedir`, porque durante la
 *  mirada convive con la petición de `mirar` y no puede esperarla. */
let descartando = false;

/** Poder en curso: qué se está eligiendo. */
let eligiendoPoder = null;

/**
 * Las tres fases que no tienen reloj.
 *
 * Levantar, usar un poder y decidir si cortar se piensan sin apuro: no hay
 * plazo que las venza, y eso es deliberado. Pero si el jugador que tiene que
 * decidir desapareció, la mesa se queda esperando a alguien que no va a
 * volver, y la partida no termina nunca. Pasó en producción el 29/08: la
 * última acción de turno fue a las 16:28:59 y nadie jugó más.
 *
 * El servidor ya tiene la red de seguridad —`saltarAusente`— y ya sabe quién
 * está ausente: `latir` lo calcula y lo publica en la vista. Lo único que
 * faltaba era que alguien tocara el timbre.
 */
const FASES_SIN_RELOJ = new Set(["levantada", "poder", "postLevantada"]);

/** Cada cuánto, como mucho, se pide un rescate. */
const MS_ENTRE_RESCATES = 5000;
let ultimoRescate = 0;

/**
 * Pide que salteen al jugador ausente, si de verdad lo está.
 *
 * NO decide nada: la condición que se mira acá —`ausentes`, calculado por el
 * servidor— es la misma que el servidor vuelve a comprobar antes de actuar,
 * y si no se cumple rechaza el pedido. Duplicar la validación sería inventar
 * una segunda autoridad sobre quién está conectado.
 */
async function rescatarSiHayAusente() {
  const vista = miVista;
  if (!vista || !FASES_SIN_RELOJ.has(vista.fase)) return;

  const enTurno = vista.jugadores[vista.indiceTurno]?.id;
  // Si el que "falta" soy yo, evidentemente estoy: este código se está
  // ejecutando. Pedir que me salteen a mí mismo no tendría sentido.
  if (!enTurno || enTurno === miUid) return;
  if (!(vista.ausentes ?? []).includes(enTurno)) return;

  // Con cuatro clientes mirando lo mismo, sin freno serían cuatro pedidos por
  // segundo. Uno cada cinco alcanza: el servidor resuelve el primero que
  // llegue y a los demás les contesta que ya no hay nada que saltar.
  const ahora = Date.now();
  if (ahora - ultimoRescate < MS_ENTRE_RESCATES) return;
  ultimoRescate = ahora;

  try {
    await Red.saltarAusente(salaPedida);
  } catch {
    // El servidor decide. Si dice que el jugador sigue conectado, o que en
    // esta fase no hay nada que saltar, es la respuesta correcta.
  }
}
/** Última vista recibida del servidor. La única fuente de verdad. */
let miVista = null;

/**
 * Traduce una vista del servidor a la forma que ya dibuja `dibujar()`.
 *
 * La vista y el estado del motor tienen casi la misma forma —`vistaDe` es un
 * recorte, no una traducción— así que el adaptador es corto. Lo que cambia
 * son tres cosas que en la vista viajan resumidas:
 *
 *   mazo      del mazo sólo se sabe CUÁNTAS cartas quedan
 *   descarte  sólo viaja la cima, que es la muestra, y el tamaño
 *   levantada sólo viene si es tu turno
 *
 * Se rellenan con marcadores tapados para que el contador y la pila se vean
 * igual que en la mesa local. Son marcadores, no cartas: no hay nada que
 * destapar en ellos.
 */
function comoEstado(vista) {
  const tapada = { oculta: true };
  const restoDelDescarte = Math.max(0, (vista.cartasEnDescarte ?? 1) - 1);

  return {
    fase: vista.fase,
    ronda: vista.ronda,
    // Con cuántos puntos se queda afuera esta mesa: lo eligió quien abrió la
    // sala. Sin esto, la cabecera y el cartel de fin de partida dirían 150 en
    // una mesa de 60.
    limitePuntos: vista.limitePuntos ?? null,
    indiceMano: vista.indiceMano,
    indiceTurno: vista.indiceTurno,
    turnosRonda: vista.turnosRonda,
    indiceCortador: vista.indiceCortador,
    desempate: vista.desempate,
    registro: vista.registro ?? [],
    jugadores: vista.jugadores,
    descarte: vista.muestra
      ? [
          vista.muestra,
          ...Array.from({ length: restoDelDescarte }, () => tapada),
        ]
      : [],
    mazo: Array.from({ length: vista.cartasEnMazo ?? 0 }, () => tapada),
    levantada: vista.levantada ?? null,
    poderPendiente: vista.poderPendiente ?? null,
    ganador: null,
    eventos: [],
  };
}

/**
 * Si la mirada de la ronda todavía no empezó, en red.
 *
 * La primera ronda nace esperando a que lleguen todos, y después corre una
 * cuenta regresiva: la ventana llega con `abiertaEn` en el futuro. En ese
 * lapso la fase ya es `mirar`, pero el servidor rechaza cualquier mirada —si
 * no, quien carga primero memorizaría con ventaja—, así que la mesa no ofrece
 * las cartas.
 *
 * Sin ventana y sin espera es una partida repartida antes de este cambio: ahí
 * la mirada ya estaba abierta, y bloquearla dejaría a esa mesa sin mirar.
 *
 * En entrenamiento no hay vista y siempre contesta que no.
 */
function miradaTodaviaCerrada(vista) {
  if (!enRed() || !vista || vista.fase !== "mirar") return false;
  if (vista.esperando) return true;
  const abre = vista.ventana?.abiertaEn;
  return abre != null && abre > Red.ahoraDelServidor();
}

/**
 * La cuenta regresiva de la primera ronda, en red.
 *
 * Es la de entrenamiento —mismos pasos, misma duración— pero no la cuenta
 * esta pestaña: cada paso se calcula contra el reloj del servidor y el
 * `abiertaEn` de la ventana. Así los cuatro ven el mismo número a la vez, y
 * quien llega con la cuenta empezada entra en el paso que corresponde en vez
 * de arrancar de «3».
 *
 * Es un espejo. Al llegar a cero no abre nada —la apertura ya la dejó
 * programada el servidor—: sólo repinta, porque no llega ninguna vista nueva
 * que avise que las cartas ya se pueden tocar.
 *
 * Con movimiento reducido se muestra igual. La espera es real, no un adorno:
 * lo que se apaga es el latido del número, desde el CSS.
 */
let cuentaEnRed = null;

function cuentaRegresivaEnRed(vista) {
  const abre =
    vista.fase === "mirar" && !vista.esperando ? vista.ventana?.abiertaEn : null;
  if (abre == null || abre <= Red.ahoraDelServidor()) {
    apagarCuentaEnRed();
    return;
  }
  // La misma cuenta que ya corre: cada vista nueva no la reinicia.
  if (cuentaEnRed?.abiertaEn === abre) return;

  apagarCuentaEnRed();
  cuentaEnRed = { abiertaEn: abre, paso: null, temporizador: null };
  avanzarCuentaEnRed();
}

function avanzarCuentaEnRed() {
  const cuenta = cuentaEnRed;
  if (!cuenta) return;

  const caja = $("cuentaAtras");
  const numero = $("cuentaAtrasNumero");
  const falta = cuenta.abiertaEn - Red.ahoraDelServidor();

  if (falta <= 0 || !caja || !numero) {
    apagarCuentaEnRed();
    if (miVista) {
      dibujar();
      pista(pistaDeRed(miVista));
    }
    return;
  }

  // Contados desde el final: con 3,4 s por delante quedan cuatro pasos y va
  // el primero, el «3». Con más de la cuenta entera —relojes que no terminan
  // de coincidir— se queda en el primero.
  const quedan = Math.ceil(falta / MS_POR_PASO);
  const paso = PASOS_DE_LA_CUENTA[Math.max(0, PASOS_DE_LA_CUENTA.length - quedan)];
  if (paso !== cuenta.paso) {
    cuenta.paso = paso;
    caja.hidden = false;
    pintarPasoDeLaCuenta(numero, paso);
  }

  // Hasta el próximo cambio de paso, no un intervalo fijo: un intervalo se
  // corre, y la cuenta tiene que caer en cero cuando el servidor abre.
  const hastaElProximo = falta - (quedan - 1) * MS_POR_PASO;
  cuenta.temporizador = setTimeout(avanzarCuentaEnRed, Math.max(16, hastaElProximo));
}

function apagarCuentaEnRed() {
  if (!cuentaEnRed) return;
  clearTimeout(cuentaEnRed.temporizador);
  cuentaEnRed = null;
  const caja = $("cuentaAtras");
  if (caja) caja.hidden = true;
}

/** Texto de la situación, para el modo red. */
function pistaDeRed(vista) {
  if (vista.abandonaron?.includes(miUid)) return "Abandonaste esta partida.";
  const miTurno = vista.indiceTurno === vista.yo;
  const quien = vista.jugadores[vista.indiceTurno]?.nombre ?? "alguien";

  switch (vista.fase) {
    case "mirar":
      // Sólo números: los nombres no hacen falta para saber que falta alguien.
      if (vista.esperando) {
        const { llegaron, total } = vista.esperando;
        return `Esperando a los jugadores (${Number(llegaron)}/${Number(total)})…`;
      }
      if (miradaTodaviaCerrada(vista)) {
        return "Preparate: vas a tocar <b>una</b> carta tuya para memorizarla.";
      }
      return "Tocá <b>una</b> carta tuya para memorizarla.";
    case "descarte":
      return "<b>¡Reflejos!</b> Tocá una carta que creas igual a la muestra.";
    case "turno":
      return miTurno
        ? "Es tu turno. <b>Levantá</b> del mazo."
        : `Juega <b>${quien}</b>.`;
    case "levantada":
      return miTurno
        ? "Cambiala por una tuya, o tirala."
        : `<b>${quien}</b> está decidiendo.`;
    case "poder":
      return miTurno
        ? "Levantaste un poder."
        : `<b>${quien}</b> tiene un poder.`;
    case "postLevantada":
      return miTurno
        ? "Podés <b>cortar</b> o <b>pasar</b>."
        : `<b>${quien}</b> decide si corta.`;
    case "finRonda":
      return `Ronda ${vista.ronda} terminada.`;
    case "finPartida":
      return "Partida terminada.";
    default:
      return "";
  }
}

/** Pinta la vista que acaba de llegar. */
/**
 * Revelaciones ya mostradas, para no volver a destaparlas.
 *
 * El servidor mantiene la fase en `descarte` durante los dos segundos, así
 * que en ese lapso pueden llegar varias vistas con la misma revelación. Sin
 * esta marca, cada una rearmaría el temporizador y la carta se quedaría
 * destapada mientras siguieran llegando.
 */
const yaRevelado = new Set();

/**
 * Destapa lo que el servidor expuso, y lo tapa a los dos segundos.
 *
 * El servidor no puede tapar por reloj —el motor es determinista y no lo
 * mira—, así que expone las cartas mientras dura la revelación y es cada
 * mesa la que las tapa. Que después el servidor cierre la fase es la segunda
 * red: aunque este temporizador no llegara a correr, la vista siguiente ya
 * viene tapada.
 */
function mostrarRevelaciones(vista) {
  if (vista.fase !== "descarte") {
    // Fuera de la fase no hay nada expuesto, y las marcas de la ventana
    // anterior ya no sirven para nada.
    yaRevelado.clear();
    return;
  }

  const idVentana = vista.ventana?.id ?? `r${vista.ronda}`;

  for (const r of vista.revelaciones ?? []) {
    const llave = clave(r.indiceJugador, r.posicion);
    const marca = `${idVentana}:${llave}`;
    if (yaRevelado.has(marca)) continue;
    yaRevelado.add(marca);

    // Se guarda la carta, no `null`: al cerrarse la ventana el servidor deja
    // un hueco donde estaba la del que llegó tarde, y sin la carta guardada
    // no quedaría nada que dibujar.
    revelaciones.set(llave, r.carta);
    setTimeout(() => {
      revelaciones.delete(llave);
      dibujar();
    }, MS_REVELACION);
  }
}

/**
 * Cuántas líneas del registro ya se anunciaron.
 *
 * En red el registro llega entero en cada vista, así que sin recordar hasta
 * dónde se llegó, cada repintado volvería a anunciar todas las miradas de la
 * partida. Se guarda el largo y no el contenido: el registro sólo crece.
 */
let registroAnunciado = 0;

/**
 * Muestra en red las miradas de los poderes 7 y 8.
 *
 * El motor marca esas líneas con `tipo: "miroCarta"` y la interfaz las
 * reconoce por ese campo, no por el texto: buscar "miró una carta" se rompería
 * con sólo reescribir el mensaje.
 *
 * Se pinta la marca sobre la mano del mirado, no sobre una carta suya: el
 * servidor no manda la posición —y hace bien, porque decirla convertiría el
 * poder en un anuncio público de dónde está lo que se vio.
 */
/**
 * Las cartas con un ojo encima, y cuándo se apaga cada uno.
 *
 * ─────────────────────────────────────────────────────────────────────
 * POR QUÉ UN MAPA Y NO UNA CLASE EN EL DOM
 * ─────────────────────────────────────────────────────────────────────
 *
 * Porque `dibujar()` reconstruye los cuatro asientos enteros en cada pasada:
 * una clase puesta a mano desaparece con el primer redibujado, que en una
 * ventana de descarte son varios por segundo. El dato tiene que vivir acá y
 * que el dibujado lo lea, igual que `revelaciones`.
 *
 * El valor es el `setTimeout` que lo apaga, para poder cancelarlo si la misma
 * carta vuelve a mirarse antes de que se cumpla.
 */
const miradas = new Map();

/**
 * Cuánto dura una marca de mirada, sea ojo o borde.
 *
 * Dos segundos, y no el segundo y medio de antes. No es un adorno: es el dato
 * con el que se decide si conviene cortar, y hay que poder mirarlo, ubicar de
 * quién es la mano y volver a lo propio. Medio segundo de más no estorba a
 * nadie; medio de menos lo convierte en algo que se sospecha haber visto.
 *
 * Y no dura más que eso A PROPÓSITO. Una marca que se quedara toda la ronda
 * dejaría escrito en la mesa lo que el juego pide recordar — que es el juego.
 */
const MS_MARCA_DE_MIRADA = 2000;

/**
 * Las DOS marcas, que no dicen lo mismo.
 *
 * ───────────────────────────────────────────────────────────────────
 * OJO: ALGUIEN USÓ UN PODER PARA MIRAR
 * ───────────────────────────────────────────────────────────────────
 *
 * El 7, el 8 y el 10. Es una jugada: costó una carta, va con su cartel y su
 * sonido, y lo que anuncia es que alguien AHORA sabe algo que antes no sabía.
 *
 * ───────────────────────────────────────────────────────────────────
 * BORDE: LA MIRADA DEL PRINCIPIO DE LA RONDA
 * ───────────────────────────────────────────────────────────────────
 *
 * Los cuatro miran UNA carta propia al repartir. No es una jugada, no cuesta
 * nada y no la elige nadie: pasa siempre y pasa a la vez. Un ojo ahí decía lo
 * mismo que el de un poder, y no es lo mismo — cuatro ojos idénticos al
 * empezar cada ronda le sacan significado al ojo justo antes de que aparezca
 * el que sí importa.
 *
 * Lo que hay que poder leer es más chico: «el rival miró SU posición 2». Un
 * borde dice exactamente eso y nada más. Sin cartel y sin sonido, que es como
 * ya venía: cuatro carteles pisándose no informan de nada.
 *
 * ───────────────────────────────────────────────────────────────────
 * EL 9 NO LLEVA NINGUNA
 * ───────────────────────────────────────────────────────────────────
 *
 * `cambioCiego` no mira nada, así que el motor no anota ninguna línea de
 * mirada y acá no llega. Es correcto y conviene dejarlo escrito: una marca de
 * mirada sobre una carta que nadie vio diría algo falso. El 9 ya tiene lo
 * suyo — el 🌀 del cartel y el giro de las dos cartas.
 */
const MARCA_OJO = "mirada";
const MARCA_INICIAL = "mirada-inicial";

/**
 * Cuál de las dos corresponde a esta línea del registro.
 *
 * No se llama `marcaDe`: ese nombre ya lo tiene la insignia del jugador, unas
 * seiscientas líneas más arriba, y declararlo dos veces en el mismo módulo no
 * es una advertencia sino un error que carga la mesa en blanco.
 */
const claseDeMarca = (linea) =>
  linea?.tipo === "miradaInicial" ? MARCA_INICIAL : MARCA_OJO;

/**
 * Pone una marca sobre una carta y la saca sola.
 *
 * ───────────────────────────────────────────────────────────────────
 * ESTO LO VEN LOS CUATRO, Y ES EL PUNTO
 * ───────────────────────────────────────────────────────────────────
 *
 * Antes, cuando alguien usaba un poder para mirar, el único que veía algo era
 * quien lo usaba: los otros tres no se enteraban de nada. Ahora la posición
 * viaja en el registro —una decisión de diseño: qué carta conoce un rival es
 * información pública y parte de la estrategia— y esto corre en cada
 * navegador con la misma línea del registro.
 *
 * Las dos van sobre el DORSO. Marcan que esa carta se miró, no qué decía: el
 * número sigue sin viajar. Y en el dorso y no en la carta entera para que se
 * vayan solas cuando las cartas se dan vuelta al final de la ronda.
 */
function anotarMirada(indiceJugador, posicion, clase) {
  if (!Number.isInteger(posicion)) return;
  const llave = clave(indiceJugador, posicion);

  // Si la misma carta vuelve a mirarse antes de que se cumpla, la marca nueva
  // manda: un poder sobre una carta que ya tenía el borde de la inicial deja
  // el ojo, que es la novedad.
  clearTimeout(miradas.get(llave)?.apagador);
  miradas.set(llave, {
    clase,
    apagador: setTimeout(() => {
      miradas.delete(llave);
      dibujar();
    }, MS_MARCA_DE_MIRADA),
  });
}

/**
 * Anotar y pintar. Es lo que usa el camino de red, que llega con la vista ya
 * aplicada y necesita que la marca aparezca ahora.
 *
 * El entrenamiento usa `anotarMirada` pelado: allá esto se llama DESDE el
 * dibujado, y pedir otro dibujado en el medio sería llamarse a sí mismo.
 */
function marcarMirada(indiceJugador, posicion, clase) {
  anotarMirada(indiceJugador, posicion, clase);
  dibujar();
}

/**
 * El ojo en entrenamiento, del MISMO registro que en red.
 *
 * ───────────────────────────────────────────────────────────────────
 * POR QUÉ NO SE LLAMA DESDE CADA PODER
 * ───────────────────────────────────────────────────────────────────
 *
 * Porque ya se probó y era la versión que faltaba. En entrenamiento el ojo no
 * aparecía nunca: `mostrarMiradas` corre sólo con una vista del servidor, y
 * acá no hay servidor. Lo que había en su lugar era un destello de un segundo
 * puesto a mano en el camino de la IA que usa el 7 o el 8 —una rama, un poder,
 * y ninguna para la mirada inicial ni para el 10—.
 *
 * El motor es el mismo en los dos modos y anota las mismas líneas, así que
 * `cartasMiradasEn` contesta igual de este lado. Una sola función, los cuatro
 * momentos, y un poder nuevo trae su ojo sin que haya que acordarse.
 *
 * ───────────────────────────────────────────────────────────────────
 * Y POR QUÉ DESDE EL DIBUJADO
 * ───────────────────────────────────────────────────────────────────
 *
 * El estado local cambia en una docena de sitios —cada poder, cada turno de
 * IA, cada ventana— y colgar esto de cada uno es la misma trampa que la rama
 * por poder. `dibujar()` es el único lugar por el que pasan todos.
 *
 * No se repite: `registroAnunciado` avanza ANTES de anotar, así que el
 * dibujado que provoque el ojo ya no encuentra líneas nuevas.
 */
function ojosDelRegistroLocal() {
  const registro = estado.registro ?? [];
  // Ronda nueva: el registro se vació y lo anunciado no significa nada.
  if (registro.length < registroAnunciado) registroAnunciado = 0;
  if (registro.length === registroAnunciado) return;

  const nuevas = registro.slice(registroAnunciado);
  registroAnunciado = registro.length;

  for (const linea of nuevas) {
    const clase = claseDeMarca(linea);
    for (const { jugador, posicion } of cartasMiradasEn(linea)) {
      anotarMirada(jugador, posicion, clase);
    }
  }
}

function mostrarMiradas(vista) {
  const registro = vista.registro ?? [];
  if (registro.length < registroAnunciado) registroAnunciado = 0; // ronda nueva
  const nuevas = registro.slice(registroAnunciado);
  registroAnunciado = registro.length;

  for (const linea of nuevas) {
    /**
     * EL OJO, PARA TODAS LAS MIRADAS Y EN UN SOLO LUGAR.
     *
     * ─────────────────────────────────────────────────────────────────────
     * POR QUÉ NO UNA RAMA POR PODER
     * ─────────────────────────────────────────────────────────────────────
     *
     * Mirar una carta pasa en cuatro momentos —la mirada inicial, el 7, el 8
     * y el 10— y cada uno guarda las posiciones a su manera, porque cada uno
     * mira cosas distintas. Con una rama por caso, agregar un poder nuevo
     * obliga a acordarse de agregarle también su ojo, y olvidarse no rompe
     * nada: simplemente no aparece.
     *
     * `cartasMiradasEn` contesta «¿qué cartas se miraron en esta línea?» y acá
     * se pinta un ojo en cada una, sea cual sea el evento. Lo que sigue abajo
     * es sólo el cartel y el sonido, que sí son distintos en cada caso.
     */
    for (const { jugador, posicion } of cartasMiradasEn(linea)) {
      marcarMirada(jugador, posicion, claseDeMarca(linea));
    }

    /**
     * La mirada inicial no lleva cartel ni sonido.
     *
     * Los cuatro miran a la vez durante los dos segundos de apertura: cuatro
     * carteles pisándose y cuatro sonidos encimados no informan de nada. El
     * ojo, que ya se pintó arriba, dice todo lo que hay que decir.
     */
    if (linea?.tipo === "miradaInicial") continue;

    // Las miradas de los poderes 7 y 8.
    if (linea?.tipo === "miroCarta") {
      // Quién miró a quién ya viene en la línea, así que el 7 (mirarse una
      // propia) y el 8 (mirar la de otro) se distinguen sin leer el texto.
      cartel(linea.actor === linea.objetivo ? "mirarPropia" : "mirarRival");
      sonidos.voltear();
      marcarManoMirada(linea.objetivo);
      continue;
    }

    // El 10, primera mitad: miró su carta y una del rival, y todavía no
    // decidió. Dos ojos, uno en cada mano.
    if (linea?.tipo === "miroParaCambiar") {
      // Sin cartel: `CARTELES` no tiene una entrada para esto y `cartel()`
      // devuelve sin hacer nada ante un nombre que no conoce — habría quedado
      // una llamada muerta que se lee como si mostrara algo.
      //
      // Tampoco hace falta. Al que usó el poder ya le abre el modal de
      // decidir, y a los otros tres los ojos les dicen exactamente lo que
      // pasó; el desenlace lo anuncia `resolvioElDiez` un momento después.
      sonidos.voltear();
      marcarManoMirada(linea.objetivo);
      continue;
    }
    // Y cómo terminó el 10. Que la mesa se entere de si el cambio se hizo o no
    // es parte de la regla: si el rival cambió, alguien tiene una carta suya y
    // conviene saberlo; si NO cambió, eso también dice algo.
    if (linea?.tipo === "resolvioElDiez") {
      cartel(linea.cambio ? "cambio" : "sinCambio");
      sonidos[linea.cambio ? "whoosh" : "clic"]();
      if (linea.cambio) {
        marcarManoMirada(linea.objetivo);
        // La MISMA transición que ya usábamos para el que hizo el cambio, pero
        // corrida en los cuatro navegadores: las posiciones ahora viajan, así
        // que cada uno puede dibujar el intercambio en vez de ver las cartas
        // aparecer cambiadas de golpe.
        efectoCambio(
          "cambioConVista",
          linea.actor,
          linea.posicionPropia,
          linea.objetivo,
          linea.posicionRival,
        );
      }
      continue;
    }
  }
}

/**
 * Pinta lo que publicó el servidor. Nada más.
 *
 * Acá NO se cierra ninguna ventana por reloj propio. El servidor guarda el
 * plazo de cada una y la cierra cuando vence; `mantenerEnMarcha` sólo le
 * golpea la puerta cada 900 ms para preguntarle. Un temporizador del navegador
 * con un número fijo no puede saber cuánto dura la ventana que está mirando:
 * la de la ronda vence a los 9 s y la que reabre tirar a los 5, y cerrar antes
 * de tiempo se come la gracia y pierde jugadas legítimas que venían en camino.
 */
function pintarVista(vista) {
  miVista = vista;
  YO = vista.yo;
  // El asiento propio recién se sabe acá: hay que volver a fijar el dorso
  // comprado o aparecería en las cartas de otro jugador.
  aplicarDorsoPropio();

  // Si la fase dejó de ser la del poder —porque se resolvió, o porque a un
  // ausente se lo saltearon— la elección en curso ya no tiene sentido.
  if (vista.fase !== "poder" && eligiendoPoder) eligiendoPoder = null;

  // Y lo mismo con la carta que se mandó a descartar: vale mientras dure SU
  // ventana. Entre una ventana y la siguiente la fase pasa por turno o por
  // postLevantada, así que salir de `descarte` es el momento exacto.
  if (vista.fase !== "descarte" && posicionEnviada != null) posicionEnviada = null;
  // Y el acierto que esperaba su carta, igual: resuelta la ventana, el
  // servidor ya eligió al azar. Sin esto la mesa quedaba apagada para siempre.
  if (atacando && (vista.fase !== "descarte" || vista.ventana?.cerrada)) olvidarAtaque();
  estado = comoEstado(vista);
  // Antes de dibujar: si algo se expuso, tiene que verse en este mismo pintado.
  mostrarRevelaciones(vista);
  dibujar();
  // Después de dibujar: la marca busca la mano en el DOM ya pintado.
  mostrarMiradas(vista);
  pista(pistaDeRed(vista));
  cuentaRegresivaEnRed(vista);
  modalesDeRed(vista);
  rescatarSiHayAusente();
  calentarSiHaceFalta(vista);
}

/**
 * Precalentar el descarte, justo antes de que haga falta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un descarte que cae en una instancia recién arrancada llega tres o cuatro
 * segundos tarde, y en una ventana de reapertura de tres segundos eso es un
 * descarte perdido. Si el arranque lo paga un pedido de calentamiento, el
 * toque de verdad encuentra la instancia lista. Ver `calentarDescarte`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CUÁNDO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Con la primera vista de la partida: es el tramo con más margen antes de la
 * primera ventana —reparto, cuenta regresiva, mirada—.
 *
 * Y al ENTRAR en `levantada` o en `mirar`, que son las fases que desembocan
 * en una ventana: alguien levantó y está por tirar, o la ronda está por abrir
 * sus reflejos. Al entrar y no mientras dure, porque cada vista nueva de la
 * misma fase dispararía otra.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Y POR QUÉ ESTO DEJA VARIAS INSTANCIAS, NO UNA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Las cuatro mesas reciben la misma vista casi al mismo tiempo, así que las
 * cuatro calientan juntas. Una instancia de primera generación atiende un
 * pedido por vez: cuatro pedidos simultáneos obligan a tener cuatro, que es
 * una por cada descarte que puede llegar a la vez. No hace falta coordinar
 * nada para eso.
 *
 * Con freno: como mucho una vez cada veinte segundos por mesa. Una instancia
 * que se usa no se enfría, y en una partida los descartes son frecuentes.
 */
const MS_ENTRE_CALENTADAS = 20_000;
const FASES_ANTES_DE_UNA_VENTANA = new Set(["levantada", "mirar"]);
let faseAntesDeCalentar = null;
let ultimaCalentada = -Infinity;

function calentarSiHaceFalta(vista) {
  const primera = faseAntesDeCalentar === null;
  const entra =
    vista.fase !== faseAntesDeCalentar && FASES_ANTES_DE_UNA_VENTANA.has(vista.fase);
  faseAntesDeCalentar = vista.fase;

  if (!primera && !entra) return;
  // Con la pestaña oculta no hay quien toque: calentar sería gastar por nada.
  // La próxima entrada en `levantada` con la pestaña a la vista lo hace.
  if (document.hidden) return;

  const t = Date.now();
  if (t - ultimaCalentada < MS_ENTRE_CALENTADAS) return;
  ultimaCalentada = t;

  // Sin esperar la respuesta: no bloquea nada ni avisa si falla.
  Red.calentarDescarte(salaPedida);
}
// ----------------------------------------------------------------------

/**
 * Los modales que dependen de la fase.
 *
 * Se abren y se cierran mirando la vista, no guardando estado propio: si el
 * modal recordara por su cuenta que está abierto, una reconexión que trae
 * otra fase lo dejaría abierto sobre una partida que ya siguió.
 */
let faseMostrada = null;

/**
 * Fases que abren un modal propio y que, al TERMINAR, tienen que cerrarlo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL BUG QUE DEJÓ LA RONDA 2 INJUGABLE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Lo de arriba decía cómo tenía que ser, pero sólo se cumplía para el poder:
 * la única regla de cierre era `if (eraPoder) cerrarModal()`. El resultado de
 * una ronda se abría al cortar y nadie lo cerraba al llegar la siguiente —en
 * entrenamiento lo cierra `arrancarRonda`, que en red no corre—.
 *
 * El cartel «Ronda 1 terminada» tapaba la ronda 2 entera. Nadie podía tocar
 * nada, el servidor salteaba turno tras turno, y el reloj de cada turno —que
 * también se pinta dentro de los modales— llegaba a cero y volvía a empezar
 * encima de ese cartel. Al recargar, la ronda 2 aparecía: el cartel ya no se
 * abría. Existía desde el 28 de agosto; el reloj en el modal lo hizo visible.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ `cambioConVista` TAMBIÉN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Es la misma trampa, recién abierta: desde que las decisiones vencen solas,
 * el servidor puede resolver el 10 por tiempo mientras el modal con las dos
 * cartas sigue abierto en la pantalla de quien lo usó. Al salir de la fase,
 * ese modal ya no tiene nada que decidir.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE COMPARA LA FASE Y NO LA CLAVE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Dentro del mismo `finRonda` pueden llegar vistas nuevas —cambia la versión
 * por cualquier motivo—. Cerrar en cada una haría parpadear el cartel: se
 * cierra y el bloque de abajo lo vuelve a abrir, con su animación de entrada.
 *
 * `finPartida` NO está, y a propósito: es el final, ahí vive la revancha, y
 * no hay fase siguiente que lo tenga que desalojar.
 *
 * El poder no está en la lista porque tiene su propia regla, un poco más
 * amplia, que queda como estaba.
 */
const FASES_QUE_CIERRAN_SU_MODAL = new Set(["finRonda", "cambioConVista"]);

function modalesDeRed(vista) {
  const clave = `${vista.fase}:${vista.ronda}:${vista.version}`;
  if (clave === faseMostrada) return;

  const eraPoder = faseMostrada?.startsWith("poder:");
  const faseAnterior = faseMostrada?.split(":")[0] ?? null;
  faseMostrada = clave;

  if (vista.fase === "poder" && vista.indiceTurno === YO) {
    abrirModalPoderDeRed(vista);
    return;
  }
  if (eraPoder) cerrarModal();

  if (faseAnterior !== vista.fase && FASES_QUE_CIERRAN_SU_MODAL.has(faseAnterior)) {
    cerrarModal();
  }

  // El 10, esperando la decisión de su dueño.
  //
  // El modal con las cartas lo abre quien hizo la jugada, con lo que le
  // devolvió el servidor. Esto es la red de seguridad para el caso en que ese
  // navegador se recargue en mitad de la decisión: las cartas ya no están
  // —viajaron una sola vez y no se guardan—, así que se ofrece salir sin
  // verlas en vez de dejar la partida trabada esperando a alguien que ya no
  // sabe qué estaba mirando.
  if (
    vista.fase === "cambioConVista" &&
    vista.cambioPendiente?.indiceJugador === YO &&
    !dom.velo.classList.contains("abierto")
  ) {
    abrirModal(`
      <h2>Cambio a medias</h2>
      <p>Habías mirado las dos cartas, pero se perdieron al recargar la página.
         Podés dejar todo como está y seguir tu turno.</p>
      <div class="botonera-poder">
        <button class="accion sobria" data-accion="diez-dejar" type="button">Dejar como está</button>
      </div>
    `);
  }

  if (vista.fase === "finRonda" || vista.fase === "finPartida") {
    abrirModalFinDeRed(vista);
  }
}

/**
 * El poder recién levantado. Se ofrece usarlo o no; la decisión se manda al
 * servidor y lo que se ve después es lo que él publique.
 */
function abrirModalPoderDeRed(vista) {
  const numero = vista.poderPendiente?.numero;
  const explicacion =
    {
      7: "Mirá una carta <b>tuya</b>.",
      8: "Mirá una carta de <b>otro jugador</b>.",
      9: "Cambiá una carta tuya por una de otro, <b>a ciegas</b>.",
      10: "Cambiá una carta tuya por una de otro, <b>viendo las dos</b>.",
    }[numero] ?? "";

  abrirModal(`
    <h2>🔮 Levantaste un ${numero}</h2>
    <p class="aviso-poder">${explicacion}</p>
    <p class="aviso-suave">Usar el poder es opcional.</p>
    <div class="botonera-modal">
      <button class="accion sobria" data-accion="red-saltar-poder" type="button">No usarlo</button>
      <button class="accion" data-accion="red-elegir-objetivo" type="button">🔮 Usar poder</button>
    </div>
  `);
}

// ---------------------------------------------------------- la revancha

/**
 * Volver a jugar con la misma gente, o cambiar la apuesta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO SE REUSA ESTA SALA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque la partida vive en `partidas/{codigo}`, con el mismo código que la
 * sala, y ahí está escrito qué pasó: el reparto, el registro y el cierre con
 * lo que cobró cada uno. La revancha abre una sala NUEVA y deja la vieja como
 * quedó. Lo explica entero `revanchaDeSala`, en el servidor.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CÓMO SE ENTERAN LOS OTROS TRES
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Escuchando la sala. Cuando alguien pide revancha, el servidor le escribe un
 * puntero a la sala vieja, y los cuatro navegadores están mirando ese
 * documento: el panel se repinta solo y aparece «unirme».
 *
 * La escucha arranca recién cuando termina la partida, no antes. Durante el
 * juego no hay nada que mirar ahí —la mesa se dibuja con la vista que publica
 * el servidor— y tener la suscripción abierta toda la partida es una lectura
 * cada vez que la sala se toque.
 */
let revanchaAbierta = null;
let estadoDeLaSala = null;
let dejarDeMirarLaSala = null;

/** La apuesta de esta mesa, para proponer la misma. */
const apuestaDeLaMesa = () => partidaEconomica.entrada ?? ENTRADAS[0];

function escucharLaSala() {
  if (dejarDeMirarLaSala || !enRed()) return;
  import("./firebase.js")
    .then(({ db, doc, onSnapshot }) => {
      dejarDeMirarLaSala = onSnapshot(
        doc(db, "rooms", salaPedida),
        (snap) => {
          const sala = snap.exists() ? snap.data() : null;
          const antes = `${estadoDeLaSala}|${revanchaAbierta?.codigo ?? ""}`;
          estadoDeLaSala = sala?.estado ?? null;
          revanchaAbierta = sala?.revancha ?? null;
          // Se repinta sólo si cambió algo de lo que el panel muestra: la
          // sala recibe escrituras por otros motivos y repintar en cada una
          // le borraría al jugador el selector de apuesta a medio elegir.
          if (`${estadoDeLaSala}|${revanchaAbierta?.codigo ?? ""}` !== antes) pintarRevancha();
        },
        // Un fallo acá no puede romper el final de la partida: el jugador ve
        // su resultado igual, sólo que sin el aviso de la revancha ajena.
        (error) => console.warn("No se pudo escuchar la sala:", error),
      );
    })
    .catch((error) => console.warn("No se pudo escuchar la sala:", error));
}

/**
 * El contenido del panel según lo que se sepa de la sala.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PRIMERO SE REPARTE EL POZO, DESPUÉS SE OFRECE OTRA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La vista dice `finPartida` unos segundos ANTES de que la sala quede
 * terminada: en el medio corre el cierre, que es el que reparte el pozo.
 * Y `revanchaDeSala` exige la sala terminada —abrir la siguiente mientras
 * la anterior todavía está pagando es justo lo que no puede pasar—.
 *
 * Ofrecer el botón en ese hueco daba un «esta partida todavía no terminó»
 * en la cara de quien acababa de ver el resultado. Así que mientras tanto
 * el panel dice qué está pasando, que además es lo que el jugador quiere
 * saber en ese momento: dónde está su plata.
 */
function panelDeRevancha() {
  if (revanchaAbierta?.codigo) {
    // La cifra pasa por `Number` antes de entrar al HTML. Viene de
    // Firestore y es un importe: si algún día llegara otra cosa, acá se
    // convierte en `NaN` y no en etiquetas.
    // El precio va EN EL BOTÓN, igual que en «jugar otra».
    //
    // La apuesta la fijó el primero que tocó, y los otros tres la aceptan o
    // no entran. Para eso tienen que verla sin buscarla: el renglón de
    // arriba se lee salteado, el botón que se va a tocar no.
    return `
      <p class="aviso-suave">Ya hay revancha en marcha.</p>
      <div class="botonera-poder">
        <button class="accion" data-accion="revancha-unirme" type="button">
          Unirme · ${Number(revanchaAbierta.entrada)} Leyendas
        </button>
      </div>
      <button class="enlace-modal" data-accion="revancha-salir" type="button">Salir al tablero</button>`;
  }

  if (estadoDeLaSala !== ESTADOS_SALA.TERMINADA) {
    return `<p class="aviso-suave">Repartiendo el pozo…</p>`;
  }

  return `
    <p class="aviso-suave">¿Juegan otra?</p>
    <div class="botonera-poder">
      <button class="accion" data-accion="revancha-igual" type="button">
        Jugar otra · ${apuestaDeLaMesa()} Leyendas
      </button>
      <button class="accion sobria" data-accion="revancha-cambiar" type="button">
        Cambiar entrada
      </button>
    </div>
    <button class="enlace-modal" data-accion="revancha-salir" type="button">Salir al tablero</button>`;
}

/** El mismo panel, con el selector de apuesta abierto. */
function panelDeApuesta() {
  const opciones = ENTRADAS.map(
    (n) =>
      `<option value="${n}"${n === apuestaDeLaMesa() ? " selected" : ""}>${n} Leyendas</option>`,
  ).join("");

  return `
    <p class="aviso-suave">¿Con cuánto?</p>
    <div class="botonera-poder">
      <select class="apuesta-revancha" id="apuestaRevancha" aria-label="Entrada de la revancha">
        ${opciones}
      </select>
      <button class="accion" data-accion="revancha-crear" type="button">Abrir sala</button>
    </div>
    <button class="enlace-modal" data-accion="revancha-salir" type="button">Salir al tablero</button>`;
}

function pintarRevancha(html = panelDeRevancha()) {
  const panel = document.getElementById("panelRevancha");
  if (panel) panel.innerHTML = html;
}

/** Un aviso DENTRO del panel: cerrar el modal le taparía el resultado. */
function avisarEnRevancha(texto) {
  const panel = document.getElementById("panelRevancha");
  if (!panel) return;
  const p = document.createElement("p");
  p.className = "error-modal";
  p.textContent = texto;
  panel.append(p);
}

/**
 * Abre —o encuentra— la revancha y lleva al jugador a esa sala.
 *
 * Son dos llamadas y no una a propósito. La primera decide cuál es la sala; la
 * segunda es `unirseASala`, la puerta de siempre, que es la que sabe de cupo,
 * de estado y de saldo. Duplicar esas comprobaciones en la revancha sería
 * tener dos puertas con dos criterios, y una de las dos se olvidaría de algo.
 */
async function irALaRevancha(entrada) {
  pintarRevancha('<p class="aviso-suave">Abriendo la sala…</p>');
  try {
    const { revanchaDeSala, unirseASala } = await import("./servidor.js");
    const r = await revanchaDeSala(salaPedida, entrada);
    // El que la abre ya está adentro; el resto entra por la puerta.
    if (!r.dentro) await unirseASala(r.codigo);
    if (dejarDeMirarLaSala) dejarDeMirarLaSala();
    window.location.href = `room.html?code=${r.codigo}`;
  } catch (error) {
    pintarRevancha();
    avisarEnRevancha(error?.message ?? "No pudimos abrir la revancha.");
  }
}

/**
 * Lo que uno ganó al cerrarse esta partida, si es que ganó algo.
 *
 * Se guarda en el módulo y no en el modal porque las dos cosas pasan en
 * cualquier orden: el modal lo abre la transacción que cierra, y las
 * insignias se otorgan después de ella. Con esto, el que llegue segundo
 * encuentra al primero esperando.
 */
let logrosGanados = [];
let dejarDeEscucharLogros = null;

/**
 * Anuncia las insignias recién ganadas dentro del modal del final.
 *
 * No hace nada si el modal no está abierto o si no se ganó nada: es un
 * añadido, y una partida normal no gana ninguna. La vitrina del panel sigue
 * siendo el lugar donde están todas; esto es el aviso de que hay una nueva,
 * en el único momento en que el jugador la está esperando.
 */
function pintarLogros() {
  const caja = document.getElementById("panelLogros");
  if (!caja || !logrosGanados.length) return;

  caja.innerHTML = logrosGanados
    .map((l) => {
      // Las Leyendas sólo se anuncian si de verdad se acreditaron. El
      // servidor manda cero cuando la clave de idempotencia frenó el pago
      // —un reintento, una posesión borrada a mano— y prometer un saldo que
      // no llegó es peor que no decir nada.
      const paga = Number(l.leyendas) > 0
        ? `<span class="logro-paga">+${Number(l.leyendas)} Leyendas</span>`
        : "";
      return `<p class="logro-nuevo">🏆 ¡Ganaste la insignia ${escapar(l.nombre ?? l.id)}! ${paga}</p>`;
    })
    .join("");
  caja.hidden = false;
}

/** Resultado de la ronda o de la partida, con lo que publicó el servidor. */
function abrirModalFinDeRed(vista) {
  const filas = vista.jugadores
    .map((j, i) => {
      const enMano = vista.puntosDeMano?.[i];
      return `<tr${i === YO ? ' class="propio"' : ""}>
        <td>${escapar(j.nombre)}</td>
        <td>${enMano ?? "—"}</td>
        <td>${j.puntos}</td>
        <td>${j.eliminado ? "eliminado" : ""}</td>
      </tr>`;
    })
    .join("");

  const tabla = `<table class="tabla-resultado">
    <thead><tr><th>Jugador</th><th>En mano</th><th>Total</th><th></th></tr></thead>
    <tbody>${filas}</tbody></table>`;

  if (vista.fase === "finPartida") {
    const gane = vista.jugadores[YO] && !vista.jugadores[YO].eliminado;
    abrirModal(`<h2>${gane ? "🏆 ¡Ganaste!" : "Partida terminada"}</h2>${tabla}
      <div class="logros-ganados" id="panelLogros" hidden></div>
      <div class="revancha" id="panelRevancha">${panelDeRevancha()}</div>`);

    // Si el aviso de insignias llegó antes que el modal, acá lo encuentra
    // esperando; si llega después, lo pinta el escuchador.
    pintarLogros();

    // Y desde acá se mira la sala, por si la revancha la abre otro.
    escucharLaSala();

    if (gane) {
      sonidos.victoria();
      lanzarConfeti(dom.confeti);
    } else sonidos.derrota();
    return;
  }

  // El aviso de que la ronda siguiente arranca sola va DEBAJO de la tabla y en
  // voz baja: lo que el jugador vino a mirar son los puntajes. Pero no se
  // quita del todo, porque en entrenamiento sí hay un botón "Siguiente ronda"
  // y sin este renglón uno se queda esperando a que aparezca.
  const cortador = vista.jugadores[vista.indiceCortador]?.nombre ?? "alguien";
  abrirModal(`<h2>✂️ Cortó ${cortador}</h2>
    <p>Ronda ${vista.ronda} terminada.</p>${tabla}
    <p class="aviso-suave">La ronda ${vista.ronda + 1} empieza sola.</p>`);
}

/**
 * Manda una acción y deja que la vista nueva llegue sola por el listener.
 *
 * No se toca `estado` acá: el resultado lo publica el servidor. Pintar un
 * resultado optimista sería adivinar, y en la ventana de reflejos adivinar
 * mal es lo más probable — el resultado depende de lo que hagan los otros.
 */
/** Lo que se espera por una respuesta antes de devolverle la mesa al jugador. */
const MS_ESPERA_MAXIMA = 15000;

/** Marca de que se venció la espera. No dice nada sobre lo que hizo el servidor. */
class EsperaVencida extends Error {}

/**
 * Manda una jugada y devuelve el control pase lo que pase.
 *
 * El plazo de 15 segundos es SÓLO de interfaz. Que venza no significa que la
 * jugada no se haya aplicado: el pedido puede seguir vivo y llegar al
 * servidor igual. Por eso al vencer no se reintenta, no se revierte nada y no
 * se toca ni una carta. La autoridad sigue siendo la vista que publica el
 * servidor; lo único que se recupera acá es la posibilidad de volver a tocar.
 */
async function pedir(accion, ejecutar) {
  if (pidiendo) {
    pista("⏳ Esperá a que termine la acción anterior.");
    return;
  }
  pidiendo = true;
  pista("Procesando…");
  // Con retraso: la mayoría de las jugadas vuelven en menos de lo que tarda
  // en aparecer, y para ésas es mejor no mostrar nada. Ver spinner.js.
  mostrarCargando("Enviando la jugada…");

  let reloj = null;
  try {
    const respuesta = ejecutar();
    // Si la espera vence primero, este pedido queda huérfano. Se le engancha
    // un catch para que su rechazo tardío no salga por consola como un error
    // sin dueño.
    respuesta.catch(() => {});

    const vencimiento = new Promise((_, rechazar) => {
      reloj = setTimeout(() => rechazar(new EsperaVencida()), MS_ESPERA_MAXIMA);
    });

    return await Promise.race([respuesta, vencimiento]);
  } catch (error) {
    if (error instanceof EsperaVencida) {
      console.warn(
        `Sin respuesta de "${accion}" tras ${MS_ESPERA_MAXIMA} ms. ` +
          "La jugada PUEDE haberse aplicado igual: no se reintenta.",
      );
      pista("⌛ No pudimos confirmar la acción. Esperá un momento.");
    } else if (esDesincronizacion(error)) {
      // La mesa siguió mientras el dedo iba en camino: el reloj de turno saltó
      // al jugador, o la ventana venció. No es un error del jugador ni algo
      // que deba arreglar, y la vista nueva ya viene en camino a corregir la
      // pantalla. Se dice en voz baja y sin el sonido de error.
      console.info(`"${accion}" llegó tarde: ${error?.message}`);
      pista(esoYaPaso(error));
    } else {
      console.error(`Falló "${accion}":`, error);
      pista(`⚠️ ${error?.message ?? "No pudimos enviar la jugada."}`);
      sonidos.error();
    }
  } finally {
    clearTimeout(reloj);
    pidiendo = false;
    // En el finally, no en el camino feliz: una jugada que falla no puede
    // dejar girando un aro que ya no espera nada.
    ocultarCargando();
  }
}

/**
 * ¿El rechazo es porque la mesa avanzó, y no porque la jugada esté mal?
 *
 * Se mira el código del servidor y no sólo el texto: `failed-precondition` es
 * lo que devuelve cuando la acción era válida pero ya no corresponde. Se
 * acota con los mensajes concretos para no tragarse otros rechazos de la
 * misma familia que sí conviene que el jugador vea.
 */
const esDesincronizacion = (error) =>
  error?.codigo === "failed-precondition" &&
  /No es tu turno|ventana .*(cerr|termin)|no está en fase|no se puede hacer ahora/i
    .test(error?.message ?? "");

const esoYaPaso = (error) =>
  /No es tu turno/i.test(error?.message ?? "")
    ? "Se te pasó el turno."
    : "Esa jugada llegó tarde.";
let pidiendo = false;

/** Freno propio del descarte: no comparte el de `pedir`, porque durante la
 *  mirada conviven con la petición de `mirar` y el descarte no puede esperarla. */
// descartando ya está declarado arriba

/** Clic sobre una carta, en modo red. */
/** Poder en curso: qué se está eligiendo. */
// eligiendoPoder ya está declarado arriba

// ---------- FUNCIÓN clicEnCartaDeRed CON LA VISUALIZACIÓN EN DESCARTE ----------
async function clicEnCartaDeRed(indiceJugador, posicion, dobleClic) {
  if (!miVista) return;

  /**
   * Tras un acierto, tocar una carta propia es ENTREGARLA.
   *
   * Tiene que ir antes que el bloque de abajo, que se queda con todos los
   * toques propios de la fase: uno "mira", dos descartan. Estando después,
   * la entrega no llegaba nunca —el ataque al rival no salía jamás— y un
   * doble toque terminaba en un descarte propio que casi siempre fallaba.
   */
  if (miVista.fase === "descarte" && atacando && indiceJugador === YO) {
    const pendiente = atacando;
    olvidarAtaque();
    dibujar();
    const r = await pedir("entregar", () =>
      Red.entregarCarta(salaPedida, pendiente.ventana, pendiente.clientActionId, posicion),
    );
    if (r?.entregada) {
      sonidos.aviso();
      pista("Carta elegida. Se resuelve al cerrar la ventana.");
    }
    return;
  }
  // Con un acierto esperando su carta, lo demás de la ventana espera.
  if (miVista.fase === "descarte" && atacando) return;

  // ---- NUEVO: Permitir mirar (clic simple) en fase descarte ----
  if (miVista.fase === "descarte" && indiceJugador === YO) {
    // Clic simple: mostrar la carta (mirar)
    if (!dobleClic) {
      const jugador = estado.jugadores[YO];
      if (jugador && jugador.mano && jugador.mano[posicion]) {
        const carta = jugador.mano[posicion];
        const llave = clave(YO, posicion);
        // Si ya está revelada, no hacer nada
        if (revelaciones.has(llave)) return;
        revelaciones.set(llave, carta);
        dibujar();
        setTimeout(() => {
          revelaciones.delete(llave);
          dibujar();
        }, MS_REVELACION || 2000);
        pista("Mirando tu carta...");
      } else {
        pista("No hay carta en esa posición.");
      }
      return;
    }

    // Doble clic: descarte (lógica original)
    const ventana = miVista.ventana;
    if (!ventana || ventana.cerrada || descartando) return;
    descartando = true;
    const tocadoEn = Date.now();
    try {
      const r = await Red.intentarDescarte(
        salaPedida,
        ventana,
        posicion,
        tocadoEn,
      );
      if (r?.anotado) {
        sonidos.aviso();
        marcarEnviada(posicion);
        pista("Carta registrada. Se resolverá al cerrar la ventana.");
      }
    } catch (error) {
      console.error("Falló el descarte:", error);
      pista(`⚠️ ${error?.message ?? "No pudimos registrar la jugada."}`);
      sonidos.error();
    } finally {
      descartando = false;
    }
    return;
  }

  // ---- Resto del código original (poderes, mirar, etc.) ----
  if (eligiendoPoder && miVista.fase === "poder") {
    const numero = eligiendoPoder.numero;

    // La misma regla que pinta las cartas decide si el clic vale. Si fueran
    // dos reglas distintas, tarde o temprano una carta se vería elegible y
    // al tocarla no pasaría nada.
    const puede = elegibleParaPoder({
      numero,
      yo: YO,
      jugadores: estado.jugadores,
      propiaElegida: eligiendoPoder.propia,
    });
    if (!puede(indiceJugador, posicion)) {
      sonidos.error();
      pista(
        `⚠️ Esa carta no. ${pasoDelPoder({ numero, propiaElegida: eligiendoPoder.propia })}`,
      );
      return;
    }

    // 7 y 8: un solo clic, sobre la carta a mirar.
    if (numero === 7 || numero === 8) {
      const objetivo = { indice: indiceJugador };
      eligiendoPoder = null;
      dibujar();
      const r = await pedir("poder", () =>
        Red.accion(salaPedida, "poderMirar", { posicion, objetivo }),
      );
      if (r?.carta) mostrarUnMomento(indiceJugador, posicion, r.carta);
      return;
    }

    // 9 y 10: primero una carta propia, después una ajena.
    if (eligiendoPoder.propia === null) {
      eligiendoPoder.propia = posicion;
      dibujar();
      pista(pasoDelPoder({ numero, propiaElegida: posicion }));
      return;
    }

    const propia = eligiendoPoder.propia;
    eligiendoPoder = null;
    dibujar();
    const r = await pedir("poder", () =>
      Red.accion(salaPedida, "poderCambio", {
        posicion: propia,
        objetivo: { indice: indiceJugador, posicion },
      }),
    );
    // El 10 muestra las dos cartas y pregunta; el 9 cambia a ciegas y ya está.
    //
    // Las cartas llegan en la RESPUESTA a este pedido, no en la vista, y ésa
    // es toda la protección: si viajaran en la vista las tendrían los cuatro.
    // Por eso el modal se abre acá, con lo que devolvió el servidor, y no
    // desde `modalesDeRed`, que sólo ve lo que es público.
    if (r?.revelada?.propia || r?.revelada?.rival) {
      revelaciones.set(clave(YO, propia), r.revelada.propia);
      revelaciones.set(clave(indiceJugador, posicion), r.revelada.rival);
      dibujar();
      efectoCambio("cambioConVista", YO, propia, indiceJugador, posicion);
      preguntarSiCambia(r.revelada, propia, indiceJugador, posicion);
    }
    return;
  }

  if (miVista.fase === "mirar" && indiceJugador === YO) {
    // Antes de que abra, ni mirar ni descartar: el servidor rechazaría las
    // dos, y la pista ya dice qué se está esperando.
    if (miradaTodaviaCerrada(miVista)) return;

    // D2: la muestra puede ser justo la carta que acabás de memorizar, y la
    // ventana de descarte ya está abierta. El segundo toque la descarta.
    //
    // No pasa por `pedir` a propósito: el PRIMER toque acaba de disparar
    // `mirar`, que puede seguir en vuelo, y el guardia de reentrada se tragaría
    // el descarte justo cuando el tiempo es lo que se está midiendo. Tiene su
    // propio freno, y el servidor lo valida igual.
    if (dobleClic) {
      const ventana = miVista.ventana;
      if (!ventana || ventana.cerrada || descartando) return;
      descartando = true;
      const tocadoEn = Date.now();
      try {
        const r = await Red.intentarDescarte(
          salaPedida,
          ventana,
          posicion,
          tocadoEn,
        );
        if (r?.anotado) {
          sonidos.aviso();
          marcarEnviada(posicion);
          pista("Carta registrada. Se resolverá al cerrar la ventana.");
        }
      } catch (error) {
        console.error("Falló el descarte durante la mirada:", error);
        pista(`⚠️ ${error?.message ?? "No pudimos registrar la jugada."}`);
        sonidos.error();
      } finally {
        descartando = false;
      }
      return;
    }

    const r = await pedir("mirar", () => Red.mirar(salaPedida, posicion));
    // El servidor devuelve la carta SÓLO a quien la miró. No queda en la
    // partida: se muestra dos segundos y se olvida, como en la mesa local.
    if (r?.carta) {
      const llave = clave(YO, posicion);
      revelaciones.set(llave, r.carta);
      dibujar();
      setTimeout(() => {
        revelaciones.delete(llave);
        dibujar();
      }, MS_MIRAR);
    }
    return;
  }

  // Una carta de un rival que conozco. Sólo ésa: la lista viene del servidor.
  if (
    miVista.fase === "descarte" &&
    indiceJugador !== YO &&
    puedoAtacarAhi(indiceJugador, posicion)
  ) {
    const ventana = miVista.ventana;
    if (!ventana || ventana.cerrada) return;

    if (!dobleClic) {
      pista("Tocá <b>dos veces</b> la carta del rival que conocés.");
      return;
    }

    // El ataque sale ya, con la hora del toque. La respuesta dice si acertó:
    // la carta a entregar se elige sólo en ese caso, y nunca al errar.
    const tocadoEn = Date.now();
    const r = await pedir("descartar", () =>
      Red.intentarDescarte(salaPedida, ventana, posicion, tocadoEn, {
        objetivo: miVista.jugadores[indiceJugador]?.id,
      }),
    );
    if (!r?.anotado) return;

    if (!r.acierta) {
      sonidos.error();
      pista("No era esa: te comés una carta al cerrar la ventana.");
      return;
    }

    // El reloj que se ve es el de elegir; el servidor espera además el viaje
    // de vuelta. Al vencer, la carta la elige el servidor al azar.
    const hasta = r.entregaHasta - MS_GRACIA_ENTREGA;
    const resta = Math.max(0, hasta - Red.ahoraDelServidor());
    atacando = {
      indiceJugador,
      posicion,
      ventana,
      clientActionId: r.clientActionId,
      vence: setTimeout(() => {
        olvidarAtaque();
        dibujar();
        pista("Se acabó el tiempo: la carta sale al azar.");
      }, resta),
    };
    sonidos.aviso();
    correrTemporizador(resta, "entrega");
    pista("¡Le acertaste! Elegí <b>una carta tuya</b> para entregarle.");
    dibujar();
    return;
  }

  // Una carta ajena que no conozco: no hay intento, y se dice por qué.
  if (miVista.fase === "descarte" && indiceJugador !== YO) {
    if (dobleClic) pista("⚠️ Esa carta no la conocés");
    return;
  }

  if (miVista.fase === "descarte" && indiceJugador === YO) {
    const ventana = miVista.ventana;
    if (!ventana || ventana.cerrada) return;

    if (!dobleClic) {
      pista("Tocá <b>dos veces</b> para descartar.");
      return;
    }

    // Se manda el instante del CLIC, no el del envío.
    const tocadoEn = Date.now();
    const r = await pedir("descartar", () =>
      Red.intentarDescarte(salaPedida, ventana, posicion, tocadoEn),
    );

    if (r?.anotado) {
      // Anotada, no descartada. En red los intentos se resuelven todos juntos
      // al cerrar la ventana, así que hasta entonces no se sabe quién llegó
      // primero. Decir "descartada" acá sería inventar un resultado que
      // todavía no existe.
      sonidos.aviso();
      marcarEnviada(posicion);
      pista("Carta registrada. Se resolverá al cerrar la ventana.");
    }
    return;
  }

  if (
    miVista.fase === "levantada" &&
    miVista.indiceTurno === YO &&
    indiceJugador === YO
  ) {
    await pedir("cambiar", () => Red.cambiarCarta(salaPedida, posicion));
  }
}
// ----------------------------------------------------------------------

/**
 * Muestra una carta unos segundos y la vuelve a tapar.
 *
 * Lo revelado vino en la RESPUESTA del servidor, no en el estado. Se muestra
 * y se olvida: acá tampoco queda registro.
 */
function mostrarUnMomento(indiceJugador, posicion, carta, ms = MS_MIRAR) {
  const llave = clave(indiceJugador, posicion);
  revelaciones.set(llave, carta);
  dibujar();
  setTimeout(() => {
    revelaciones.delete(llave);
    dibujar();
  }, ms);
}

/**
 * Arranca la mesa en modo Leyendas.
 *
 * Un refresco del navegador entra por acá igual que la primera vez. No crea
 * ninguna partida ni cobra ninguna entrada: la partida ya existe, y lo único
 * que se hace es volver a escuchar la vista propia. Crear la partida es
 * trabajo de `iniciarPartida`, que se llama desde la sala y una sola vez.
 */
async function arrancarModoLeyendas(sala, uid) {
  miUid = uid;

  /**
   * La entrada de ESTA sala, que hasta acá era `null`.
   *
   * Sin esto, `costoDeAbandonar` no reconocía la partida como de Leyendas
   * —`usaLeyendas` exige una entrada válida— y devolvía `esEntrenamiento`.
   * Con eso, el cartel de abandono decía «no perderás Leyendas» en una
   * partida apostada, y `confirmarAbandono` tomaba la rama de
   * entrenamiento: se iba al tablero SIN avisarle al servidor. Ni se
   * cobraba la penalización ni la mesa se enteraba de que el jugador se
   * había ido.
   *
   * La cifra es sólo para redactar el aviso. Lo que se cobra lo decide el
   * servidor leyendo la sala, así que retocarla acá no cambia un cobro:
   * sólo le mentiría al propio jugador sobre lo que va a pagar.
   */
  partidaEconomica.entrada = Number(sala?.entrada) || null;

  // El reloj se sincroniza antes de la primera ventana de reflejos: sin esto
  // el servidor asume la peor incertidumbre posible y todo empate se resuelve
  // por sorteo en vez de por reacción.
  Red.sincronizarReloj().catch(() => {});

  dejarDeEscuchar = Red.escucharMiVista(
    salaPedida,
    uid,
    (vista) => pintarVista(vista),
    () => pista("⚠️ Se cortó la conexión con la partida. Reintentando…"),
  );
  // El aviso de insignias se escucha desde el arranque y no al abrir el
  // modal: el documento puede aparecer en cualquier momento después del
  // cierre, y suscribirse tarde es cómo se pierde el que ya estaba.
  dejarDeEscucharLogros = Red.escucharMisLogros(salaPedida, uid, (ganadas) => {
    logrosGanados = ganadas;
    pintarLogros();
  });
  dejarDeLatir = Red.mantenerVivo(salaPedida);
  // Todos los jugadores golpean la puerta. Si dependiera de uno solo, su
  // desconexión congelaría la mesa para los demás.
  // El plazo sale de la vista que publica el servidor: con él, el golpe a
  // `avanzarPartida` se manda sólo cuando de verdad venció algo, en vez de
  // cada 900 ms toda la partida.
  dejarDeAvanzar = Red.mantenerEnMarcha(salaPedida, () => miVista?.plazo?.hasta ?? null);

  // Además de con cada vista nueva, por reloj: si el ausente ya estaba
  // marcado antes de entrar en la fase sin reloj, `latir` no republica
  // —`ausentes` no cambió— y sin este intervalo nadie tocaría el timbre.
  const rescate = setInterval(rescatarSiHayAusente, MS_ENTRE_RESCATES);
  dejarDeRescatar = () => clearInterval(rescate);

  window.addEventListener("pagehide", () => {
    dejarDeEscuchar?.();
    dejarDeEscucharLogros?.();
    dejarDeLatir?.();
    dejarDeAvanzar?.();
    dejarDeRescatar?.();
  });

  pista("Conectando con la partida…");
}

let miUid = null;

// ------------------------------------------------------------- arranque

/**
 * Manda al tablero con un motivo, que el tablero muestra al cargar.
 *
 * La clave sigue llamándose `avisoLobby` a propósito: renombrarla dejaría sin
 * mensaje a quien tuviera la pestaña vieja abierta durante el despliegue.
 */
function volverAlLobby(motivo) {
  sessionStorage.setItem("avisoLobby", motivo);
  window.location.href = "dashboard.html";
}

/**
 * Valida el acceso a una partida de sala antes de mostrar nada.
 * Cubre: código inválido, sala inexistente, jugador ajeno, sala cancelada,
 * sala todavía en espera y partida ya terminada.
 */
async function entrarDesdeSala() {
  const { db, doc, getDoc } = await import("./firebase.js");
  const { exigirSesion } = await import("./sesion.js");
  const { ESTADOS_SALA, MIN_JUGADORES, esCodigoValido } =
    await import("./reglas/salas.js");

  if (!esCodigoValido(salaPedida)) {
    volverAlLobby("Ese código de sala no es válido.");
    return;
  }

  const sesion = await exigirSesion();
  if (!sesion) return; // exigirSesion ya redirigió al login

  const snap = await getDoc(doc(db, "rooms", salaPedida));
  if (!snap.exists()) {
    volverAlLobby(`No encontramos la sala ${salaPedida}.`);
    return;
  }

  const sala = snap.data();

  if (!(sala.jugadores ?? []).includes(sesion.usuario.uid)) {
    volverAlLobby("No estás en esa sala.");
    return;
  }

  if (sala.estado === ESTADOS_SALA.CANCELADA) {
    volverAlLobby(
      "Esa sala fue cancelada. Si pagaste la entrada, ya te la devolvimos.",
    );
    return;
  }

  if (sala.estado === ESTADOS_SALA.TERMINADA) {
    volverAlLobby("Esa partida ya terminó.");
    return;
  }

  if (sala.estado === ESTADOS_SALA.ESPERANDO) {
    const faltan = MIN_JUGADORES - (sala.jugadores ?? []).length;
    sessionStorage.setItem(
      "avisoSala",
      faltan > 0
        ? `Todavía falta ${faltan} jugador${faltan === 1 ? "" : "es"} para empezar.`
        : "La partida todavía no arrancó.",
    );
    window.location.href = `room.html?code=${salaPedida}`;
    return;
  }

  // Estado "jugando": la partida existe en el servidor. Se escucha la vista
  // propia y se dibuja lo que llegue.
  await arrancarModoLeyendas(sala, sesion.usuario.uid);
}

/** Pantalla honesta mientras la partida en red no esté implementada. */
function mostrarMesaEnRedPendiente(sala) {
  document.body.innerHTML = `
    <div class="mesa-pendiente">
      <img src="img/moneda-120.webp" alt="" class="logo-img grande" width="84" height="84" />
      <h1>La mesa en red todavía no está lista</h1>
      <p>
        Estás en la sala <b>${salaPedida}</b> con
        <b>${(sala.jugadores ?? []).length} jugadores</b> y un pozo de
        <b>${sala.pozo ?? sala.entrada * (sala.jugadores ?? []).length} Leyendas</b>.
      </p>
      <p class="detalle">
        El motor del juego todavía corre en cada navegador por separado, así que
        no podemos repartir el mismo mazo a todos. Tu entrada sigue en el pozo y
        la sala sigue abierta: nadie perdió nada.
      </p>
      <div class="botonera-pendiente">
        <a class="btn-oro" href="room.html?code=${salaPedida}">Volver a la sala</a>
        <a class="btn-plata" href="dashboard.html">Ir al inicio</a>
      </div>
    </div>`;
}

if (salaPedida) {
  // El velo dice "Cargando entrenamiento…", que acá no corresponde. Se quita
  // enseguida: la mesa por Leyendas tiene su propio camino y no pasa por
  // `arrancarRonda`, que es donde se saca en entrenamiento.
  quitarVeloCarga();
  entrarDesdeSala();
} else {
  // Entrenamiento contra la máquina: todo local, sin Leyendas.
  arrancarRonda();
}
