import {
  crearPartida,
  empezarRonda,
  mirar,
  terminarMirada,
  intentarDescarte,
  cerrarVentanaDescarte,
  levantar,
  cambiarCarta,
  tirarCarta,
  usarPoderMirar,
  usarPoderCambio,
  saltarPoder,
  cortar,
  pasarTurno,
  saltarTurno,
  siguienteRonda,
  PODERES,
  MS_MIRAR,
  MS_DESCARTE,
} from "./reglas/motor.js";

import { dorsoDeAsiento } from "./reglas/baraja.js";
import { LIMITE_ELIMINACION, puntosMano } from "./reglas/puntaje.js";
import * as IA from "./reglas/ia.js";
import { MODOS, costoDeAbandonar } from "./reglas/salas.js";
import * as Red from "./partida-red.js";
import { abandonarPartida, ErrorDeServidor } from "./servidor.js";
import { sonidos, alternarSilencio } from "./sonidos.js";
import { lanzarConfeti } from "./confeti.js";

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
  btnLevantar: $("btnLevantar"),
  btnTirar: $("btnTirar"),
  btnCortar: $("btnCortar"),
  btnPasar: $("btnPasar"),
  marcador: $("marcador"),
  registro: $("registro"),
  velo: $("velo"),
  modal: $("modal"),
  mesa: $("mesa"),
  reloj: $("relojTurno"),
  relojNumero: $("relojNumero"),
  relojRelleno: $("relojRelleno"),
  confeti: $("confeti"),
  btnSonido: $("btnSonido"),
  btnAbandonar: $("btnAbandonar"),
};

dom.btnSonido.addEventListener("click", () => {
  const callado = alternarSilencio();
  dom.btnSonido.textContent = callado ? "🔇" : "🔊";
  dom.btnSonido.title = callado ? "Activar sonidos" : "Silenciar sonidos";
  if (!callado) sonidos.clic();
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
  ...config.humanos.map((h, i) => ({ id: `h${i}`, nombre: h.nombre, esIA: false })),
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

let estado = crearPartida(jugadoresConfig);
let memorias = estado.jugadores.map(() => IA.crearMemoria());

/**
 * Ritmo de la mesa. Cada acción se deja respirar para que se entienda
 * qué pasó antes de que ocurra la siguiente.
 */
/**
 * Tiempo para levantar del mazo. Si se agota, el jugador pierde la levantada
 * y el turno pasa al siguiente. El resto del turno (cambiar o tirar, el poder,
 * cortar o pasar) no tiene reloj: se decide sin apuro.
 */
const MS_TURNO = 8000;

const RITMO = {
  entreTurnos: 1100,
  trasLevantar: 1400,
  trasDecidir: 1100,
  anunciarPoder: 1300,
  trasPoder: 1200,
  antesDeResolver: 1000,
  trasCorte: 1600,
};

/** Cartas reveladas de forma temporal: claves "indiceJugador:posicion". */
/** Posición propia elegida para un poder de cambio, mientras se elige la rival. */
let seleccionPropia = null;
let temporizadorActual = null;

/**
 * Reloj del turno. Un turno tiene hasta tres decisiones (levantar, cambiar o
 * tirar, y cortar o pasar) y cada una tiene su propia cuenta de 8 segundos.
 * `fase` guarda en cuál arrancó, para reiniciarlo cuando el turno avanza.
 */
let relojTurno = null;

// --------------------------------------------------------------- asientos

/**
 * Con sólo dos dorsos, el 3º y el 4º jugador repiten imagen. Lo que los
 * distingue es el color del aro que rodea sus cartas y su ficha.
 */
const claseAsiento = (indice) => `asiento-color-${indice % 4}`;

// --------------------------------------------------------------- dibujo

const clave = (i, pos) => `${i}:${pos}`;

/**
 * Cartas destapadas en este instante: `posición → carta`, o `null` cuando la
 * carta ya está en la mano y sólo hace falta darla vuelta.
 *
 * No queda ningún registro de lo que se destapó. Pasados los dos segundos la
 * carta se vuelve a tapar y no queda marca: quien no se acordó, la perdió.
 */
const revelaciones = new Map();

function dibujarCarta(
  carta,
  { visible, asiento = 0, posicion = null, clases = "", estilo = "" },
) {
  if (!carta) {
    return `<div class="hueco vacio" style="${estilo}"></div>`;
  }
  const dorso = dorsoDeAsiento(asiento);

  // El servidor manda las cartas ajenas como un marcador sin palo, número ni
  // imagen. No es que no se dibuje la cara: es que la cara NO VIAJÓ. Dibujar
  // un `<img>` con src vacío dejaría un hueco roto, y peor, sugeriría que el
  // dato está y sólo falta mostrarlo.
  if (carta.oculta) {
    return `
      <button class="carta ${claseAsiento(asiento)} ${clases}"
              ${posicion != null ? `data-posicion="${posicion}"` : ""}
              style="${estilo}"
              type="button">
        ${posicion != null ? `<span class="posicion">${posicion}</span>` : ""}
        <span class="lados">
          <span class="dorso"><img src="${dorso}" alt="Carta boca abajo" /></span>
        </span>
      </button>`;
  }
  return `
    <button class="carta ${visible ? "visible" : ""} ${claseAsiento(asiento)} ${clases}"
            ${posicion != null ? `data-posicion="${posicion}"` : ""}
            style="${estilo}"
            type="button">
      ${posicion != null ? `<span class="posicion">${posicion}</span>` : ""}
      <span class="lados">
        <span class="dorso"><img src="${dorso}" alt="Carta boca abajo" /></span>
        <span class="cara"><img src="${carta.imagen}" alt="${carta.numero} de ${carta.palo}" /></span>
      </span>
    </button>`;
}

/**
 * Reparte las cartas en abanico. Cuanto más cartas hay (los castigos
 * las suman) más se cierra el ángulo y más se solapan, para que la mano
 * siga entrando en el asiento sin achicar las cartas.
 */
function geometriaAbanico(cantidad, propio) {
  if (cantidad <= 1) return { anguloTotal: 0, arco: 0, solape: 0 };

  const anguloTotal = Math.min(propio ? 26 : 18, cantidad * (propio ? 5.5 : 4));
  const arco = propio ? 3.2 : 2.2;
  // A partir de 5 cartas se montan unas sobre otras, cada vez más, para que
  // el asiento no siga ensanchándose cuando los castigos suman cartas.
  // Los asientos laterales tienen menos lugar antes de tocar el centro de la
  // mesa, así que sus cartas se montan más rápido que las propias.
  const solape =
    cantidad <= 4 ? 0 : Math.min(propio ? 46 : 40, (cantidad - 4) * (propio ? 11 : 14));

  return { anguloTotal, arco, solape };
}

function estiloAbanico(indice, cantidad, { anguloTotal, arco, solape }) {
  if (cantidad <= 1) return "";
  const t = indice / (cantidad - 1) - 0.5;
  const giro = anguloTotal * t;
  // Las de los extremos caen un poco, como una mano sostenida.
  const desvio = arco * Math.pow(t * 2, 2) * (cantidad - 1);
  return `--giro:${giro.toFixed(2)}deg;--desvio:${desvio.toFixed(1)}px;--solape:${solape.toFixed(0)}px;`;
}

/** Lugar libre en la mesa: se ve, pero no juega nadie. */
function asientoVacio() {
  return `
    <div class="jugador vacante" aria-hidden="true">
      <div class="cabecera-jugador">
        <span class="ficha-vacante"></span>
        <div class="datos">
          <div class="nombre">Lugar libre</div>
          <div class="puntos">sin jugador</div>
        </div>
      </div>
      <div class="mano">${Array(4).fill('<div class="hueco vacio"></div>').join("")}</div>
    </div>`;
}

function asientosParaMesa(total) {
  if (total <= 2) return ["abajo", "arriba"];
  if (total === 3) return ["abajo", "izq", "der"];
  return ["abajo", "izq", "arriba", "der"];
}

function dibujarJugador(jugador, i) {
  const enTurno = i === estado.indiceTurno && !jugador.eliminado;
  const propio = i === YO;
  const rondaTerminada = estado.fase === "finRonda" || estado.fase === "finPartida";

  const geometria = geometriaAbanico(jugador.mano.length, propio);
  const manoHTML = jugador.mano
    .map((carta, pos) => {
      // La carta destapada se muestra dos segundos y se vuelve a tapar. La
      // del que llegó tarde ya salió de la mano, así que se dibuja en su
      // hueco: se la ve un momento y después desaparece.
      const llave = clave(i, pos);
      const destapada = revelaciones.has(llave);
      return dibujarCarta(carta ?? revelaciones.get(llave), {
        visible: rondaTerminada || destapada,
        asiento: i,
        posicion: pos,
        estilo: estiloAbanico(pos, jugador.mano.length, geometria),
      });
    })
    .join("");

  const insignia = jugador.esIA
    ? `<span class="insignia">${IA.DIFICULTADES[jugador.dificultad]?.etiqueta ?? "IA"}</span>`
    : "";


  return `
    <div class="jugador ${claseAsiento(i)} ${enTurno ? "en-turno" : ""} ${propio ? "propio" : ""} ${jugador.eliminado ? "eliminado" : ""}"
         data-jugador="${i}">
      <div class="cabecera-jugador">
        <img class="ficha ${claseAsiento(i)}" src="${dorsoDeAsiento(i)}"
             alt="Dorso de ${jugador.nombre}" />
        <div class="datos">
          <div class="nombre">${jugador.nombre} ${insignia}</div>
          <div class="puntos"><b>${jugador.puntos}</b> pts · ${jugador.mano.filter(Boolean).length} cartas</div>
        </div>
      </div>
      <div class="mano">${manoHTML}</div>
    </div>`;
}

function dibujarMarcador() {
  const menor = Math.min(
    ...estado.jugadores.filter((j) => !j.eliminado).map((j) => j.puntos),
  );
  dom.marcador.innerHTML = estado.jugadores
    .map((j) => {
      const ancho = Math.min(100, (j.puntos / LIMITE_ELIMINACION) * 100);
      const lider = !j.eliminado && j.puntos === menor;
      return `
        <div class="marcador-fila ${j.eliminado ? "fuera" : ""} ${lider ? "lider" : ""}">
          <div class="linea"><span>${j.nombre}</span><b>${j.puntos}</b></div>
          <div class="barra-puntos"><i style="width:${Math.max(0, ancho)}%"></i></div>
        </div>`;
    })
    .join("");
}

function dibujarRegistro() {
  const ultimas = estado.registro.slice(-40).reverse();
  dom.registro.innerHTML = ultimas
    .map(
      (l, idx) =>
        `<div class="${idx === 0 ? "destacado" : ""}">R${l.ronda} · ${l.texto}</div>`,
    )
    .join("");
}

function dibujar() {
  dom.ronda.textContent = estado.ronda || "-";

  const orden = asientosParaMesa(estado.jugadores.length);
  Object.values(dom.asientos).forEach((el) => (el.innerHTML = ""));
  estado.jugadores.forEach((jugador, i) => {
    const asiento = orden[i] ?? "arriba";
    dom.asientos[asiento].innerHTML += dibujarJugador(jugador, i);
  });

  // Con dos o tres jugadores sobran lugares en la mesa. Se dibujan vacíos
  // en vez de desaparecer, para que la mesa se lea como una mesa de cuatro.
  Object.entries(dom.asientos).forEach(([nombre, el]) => {
    if (!orden.includes(nombre)) el.innerHTML = asientoVacio();
  });

  const muestra = estado.descarte[0];
  dom.muestraCarta.innerHTML = muestra
    ? dibujarCarta(muestra, { visible: true })
    : `<div class="hueco vacio"></div>`;
  dom.descarteContador.textContent = `${estado.descarte.length} en la pila`;

  const puedeLevantar = estado.fase === "turno" && estado.indiceTurno === YO;
  dom.mazoCarta.innerHTML = estado.mazo.length
    ? dibujarCarta({ imagen: "", numero: "", palo: "" }, {
        visible: false,
        asiento: 0,
        clases: puedeLevantar ? "jugable" : "",
      })
    : `<div class="hueco vacio"></div>`;
  dom.mazoContador.textContent = `${estado.mazo.length} cartas`;

  if (estado.levantada) {
    const poder = PODERES[estado.levantada.numero];
    dom.levantadaCarta.innerHTML = dibujarCarta(estado.levantada, {
      visible: estado.indiceTurno === YO,
      asiento: estado.indiceTurno,
    });
    dom.levantadaNota.textContent = poder ? `poder ${estado.levantada.numero}` : "";
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
}

/** Marca como pulsables sólo las cartas que la fase actual permite tocar. */
function marcarCartasJugables() {
  const miMano = document.querySelector(`.jugador[data-jugador="${YO}"] .mano`);
  if (!miMano) return;

  const miTurno = estado.indiceTurno === YO;
  const habilitar =
    (estado.fase === "mirar" && estado.jugadores[YO].posicionMirada == null) ||
    estado.fase === "descarte" ||
    (estado.fase === "levantada" && miTurno);

  if (!habilitar) return;
  miMano.querySelectorAll(".carta").forEach((el) => el.classList.add("jugable"));
}

function actualizarBotones() {
  const miTurno = estado.indiceTurno === YO && !estado.jugadores[YO].eliminado;
  dom.btnLevantar.disabled = !(estado.fase === "turno" && miTurno);
  dom.btnTirar.disabled = !(estado.fase === "levantada" && miTurno);

  // Con un 7/8/9/10 en la mano el botón se convierte en el acceso al poder.
  const poderDisponible =
    estado.fase === "levantada" && miTurno && Boolean(PODERES[estado.levantada?.numero]);
  dom.btnTirar.classList.toggle("con-poder", poderDisponible);
  dom.btnTirar.textContent = poderDisponible ? "🔮 Poder" : "Tirar";
  dom.btnCortar.disabled = !(estado.fase === "postLevantada" && miTurno);
  dom.btnPasar.disabled = !(estado.fase === "postLevantada" && miTurno);
}

const pista = (texto) => {
  dom.pista.innerHTML = texto;
};

// -------------------------------------------------------- temporizadores

function correrTemporizador(ms, etiqueta, { reflejos = false } = {}) {
  cancelarTemporizador();
  dom.temporizador.classList.add("activo");
  dom.temporizador.classList.toggle("reflejos", reflejos);

  const relleno = dom.temporizadorRelleno;
  relleno.style.transition = "none";
  relleno.style.transform = "scaleX(1)";
  // Fuerza un reflow para que la transición arranque desde el estado inicial.
  void relleno.offsetWidth;
  relleno.style.transition = `transform ${ms}ms linear`;
  relleno.style.transform = "scaleX(0)";

  const fin = Date.now() + ms;
  const pintar = () => {
    const restante = Math.max(0, fin - Date.now());
    dom.temporizadorTexto.textContent = `${etiqueta} ${(restante / 1000).toFixed(1)}s`;
  };
  pintar();
  temporizadorActual = setInterval(pintar, 80);
}

function cancelarTemporizador() {
  if (temporizadorActual) clearInterval(temporizadorActual);
  temporizadorActual = null;
  dom.temporizador.classList.remove("activo", "reflejos");
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

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

function pintarReloj() {
  const caja = dom.reloj;
  if (!caja) return;

  if (!relojTurno) {
    caja.hidden = true;
    return;
  }

  const restante = Math.max(0, relojTurno.fin - Date.now());
  const segundos = Math.ceil(restante / 1000);

  caja.hidden = false;
  dom.relojNumero.textContent = segundos;
  dom.relojRelleno.style.width = `${(restante / MS_TURNO) * 100}%`;
  // Dorado hasta los 2 segundos; de ahí en más, rojo.
  caja.classList.toggle("apurado", segundos <= 2);
}

function cancelarRelojTurno() {
  if (relojTurno?.intervalo) clearInterval(relojTurno.intervalo);
  relojTurno = null;
  if (dom.reloj) dom.reloj.hidden = true;
}

function iniciarRelojTurno(fase, indice) {
  cancelarRelojTurno();
  relojTurno = {
    fase,
    indice,
    fin: Date.now() + MS_TURNO,
    intervalo: setInterval(() => {
      pintarReloj();
      if (relojTurno && Date.now() >= relojTurno.fin) {
        const quien = relojTurno.indice;
        cancelarRelojTurno();
        resolverPorTiempo(quien);
      }
    }, 120),
  };
  pintarReloj();
}

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
  if (estado.fase !== "turno" || estado.indiceTurno !== indice) return;

  sonidos.error();
  estado = saltarTurno(estado);
  if (indice === YO) pista("Se te acabó el tiempo: perdiste la levantada.");
  dibujar();
  cicloTurnos();
}

/**
 * Arranca, reinicia o apaga el reloj según la fase. Se llama en cada dibujado,
 * así que basta con cambiar de fase para que el reloj se reinicie solo.
 */
function sincronizarReloj() {
  // Sólo la levantada tiene reloj.
  const activo = estado.fase === "turno" && !estado.jugadores[estado.indiceTurno]?.eliminado;

  if (!activo) {
    if (relojTurno) cancelarRelojTurno();
    return;
  }

  const mismaDecision =
    relojTurno && relojTurno.fase === estado.fase && relojTurno.indice === estado.indiceTurno;

  if (!mismaDecision) iniciarRelojTurno(estado.fase, estado.indiceTurno);
  else pintarReloj();
}

// ------------------------------------------------- efectos de los poderes

const ESTILO_PODER = {
  mirarPropia: { icono: "👁", clase: "poder-7" },
  mirarRival: { icono: "🔍", clase: "poder-8" },
  cambioCiego: { icono: "🌀", clase: "poder-9" },
  cambioConVista: { icono: "🔄", clase: "poder-10" },
};

/** Pinta un efecto sobre una carta concreta y lo limpia solo. */
function marcarEfecto(i, pos, clase, ms = 900) {
  const el = document.querySelector(
    `.jugador[data-jugador="${i}"] .carta[data-posicion="${pos}"]`,
  );
  if (!el) return;
  el.classList.add(clase);
  setTimeout(() => el.classList.remove(clase), ms);
}

/** Cartel sobre la mesa anunciando qué poder se activó y quién lo usa. */
async function anunciarPoder(poder, nombre) {
  if (!poder) return;
  sonidos.poder();
  const { icono, clase } = ESTILO_PODER[poder.tipo] ?? { icono: "✨", clase: "" };

  const cartel = document.createElement("div");
  cartel.className = `anuncio-poder ${clase}`;
  cartel.innerHTML = `
    <span class="icono">${icono}</span>
    <span class="detalle">
      <b>Poder ${poder.numero}</b>
      <i>${TITULOS_PODER[poder.tipo]}</i>
      <em>${nombre}</em>
    </span>`;
  dom.mesa.appendChild(cartel);

  await esperar(RITMO.anunciarPoder);
  cartel.classList.add("saliendo");
  setTimeout(() => cartel.remove(), 320);
}

/** Resalta las dos posiciones que participan de un intercambio. */
function efectoCambio(tipo, yo, posPropia, indiceRival, posRival) {
  const clase = tipo === "cambioCiego" ? "efecto-ciego" : "efecto-vista";
  marcarEfecto(yo, posPropia, clase, 1100);
  marcarEfecto(indiceRival, posRival, clase, 1100);
}

// ------------------------------------------------------------ modal

function abrirModal(html) {
  dom.modal.innerHTML = html;
  dom.velo.classList.add("abierto");
}

function cerrarModal() {
  dom.velo.classList.remove("abierto");
  dom.modal.innerHTML = "";
}

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
    window.location.href = "lobby.html";
    return;
  }

  boton.disabled = true;
  boton.textContent = "Abandonando…";
  try {
    // Se manda sólo el código: el monto lo calcula el servidor.
    const { penalizacion } = await abandonarPartida(partidaEconomica.codigo);
    cerrarModal();
    volverAlLobby(`Abandonaste la partida. Se te descontaron ${penalizacion} Leyendas.`);
  } catch (e) {
    boton.disabled = false;
    boton.textContent = "Abandonar";
    const aviso = document.getElementById("errorAbandono");
    if (aviso) {
      aviso.textContent = e instanceof ErrorDeServidor ? e.message : "No pudimos procesar el abandono.";
      aviso.hidden = false;
    }
  }
}

// ------------------------------------------------------- flujo de ronda

async function arrancarRonda() {
  estado = empezarRonda(estado);
  memorias = estado.jugadores.map(() => IA.crearMemoria());
  revelaciones.clear();
  cerrarModal();
  dibujar();
  sonidos.repartir();
  await faseMirada();
}

/** Cada jugador elige una carta y la ve durante 2 segundos. */
function faseMirada() {
  return new Promise((listo) => {
    // Las IAs eligen al instante y memorizan según su nivel.
    estado.jugadores.forEach((jugador, i) => {
      if (jugador.eliminado || !jugador.esIA) return;
      const pos = Math.floor(Math.random() * jugador.mano.length);
      estado = mirar(estado, i, pos);
      memorias[i] = IA.recordar(memorias[i], jugador.dificultad, i, pos, jugador.mano[pos]);
    });

    if (estado.jugadores[YO].eliminado) {
      estado = terminarMirada(estado);
      dibujar();
      faseDescarte().then(listo);
      return;
    }

    pista("Elegí <b>una carta</b> para mirar durante 2 segundos.");
    correrTemporizador(5000, "Elegí una carta");
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
      correrTemporizador(MS_MIRAR, "Mirando");
      await revelarUnMomento(YO, pos);
      cancelarTemporizador();

      estado = terminarMirada(estado);
      dibujar();
      await faseDescarte();
      listo();
    };

    // Reglamento: si no elige, se toma automáticamente la primera carta.
    const automatico = setTimeout(() => elegir(0), 5000);
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

  // El primero se lleva su carta al descarte sin más trámite. A los otros dos
  // se les destapa la carta para toda la mesa, y a los dos segundos se tapa.
  if (ultimo.resultado === "primero") {
    sonidos.acierto();
    return;
  }

  if (ultimo.resultado === "tarde") sonidos.aviso();
  else sonidos.error();

  const llave = clave(ultimo.indiceJugador, ultimo.posicion);
  revelaciones.set(llave, ultimo.carta);
  setTimeout(() => {
    revelaciones.delete(llave);
    dibujar();
  }, MS_CARTA_EXPUESTA);
}

/** Ventana de 5 segundos en la que todos pueden descartar a la vez. */
function faseDescarte() {
  return new Promise((listo) => {
    pista(
      "<b>¡Reflejos!</b> Tocá una carta que creas igual a la muestra. Sólo el primero se salva; " +
        "equivocarse suma una carta. Podés no hacer nada.",
    );
    correrTemporizador(MS_DESCARTE, "Descarte", { reflejos: true });
    sonidos.aviso();
    dibujar();

    const pendientes = [];
    estado.jugadores.forEach((jugador, i) => {
      if (jugador.eliminado || !jugador.esIA) return;
      const retraso = IA.retrasoReaccion(jugador.dificultad);
      if (retraso >= MS_DESCARTE) return;
      pendientes.push(
        setTimeout(() => {
          const pos = IA.decidirDescarte(estado, i, memorias[i]);
          if (pos == null) return;
          estado = intentarDescarte(estado, i, pos);
          memorias[i] = IA.olvidar(memorias[i], i, pos);
          resolverUltimoDescarte();
          dibujar();
        }, retraso),
      );
    });

    manejadorDescarte = (pos) => {
      estado = intentarDescarte(estado, YO, pos);
      resolverUltimoDescarte();
      dibujar();
    };

    pendientes.push(
      setTimeout(() => {
        pendientes.forEach(clearTimeout);
        manejadorDescarte = null;
        cancelarTemporizador();
        // Lo que se destapó lo vio toda la mesa, la IA incluida.
        memorias = memorias.map((m) =>
          IA.absorberRevelaciones(m, estado.ventanaDescarte?.intentos ?? []),
        );
        estado = cerrarVentanaDescarte(estado);
        dibujar();
        listo();
        cicloTurnos();
      }, MS_DESCARTE),
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

    if (!jugador.esIA) {
      pista(`Es tu turno. Levantá una carta del mazo.`);
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
  await esperar(RITMO.trasDecidir);

  if (estado.fase === "poder") {
    await anunciarPoder(estado.poderPendiente, jugador.nombre);
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
    const objetivo = IA.decidirObjetivoMirada(estado, i, memoria, tipo === "mirarPropia");
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
    dibujar();
    sonidos.voltear();
    marcarEfecto(objetivo.indiceJugador, objetivo.posicion, "efecto-mirar", 1100);
    await esperar(1100);
    return;
  }

  const objetivo = IA.decidirObjetivoCambio(estado, i, memoria, tipo === "cambioCiego");
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
  memorias = memorias.map((m) =>
    IA.olvidar(IA.olvidar(m, i, objetivo.posicionPropia), objetivo.indiceRival, objetivo.posicionRival),
  );
  dibujar();
  sonidos.whoosh();
  efectoCambio(tipo, i, objetivo.posicionPropia, objetivo.indiceRival, objetivo.posicionRival);
  await esperar(1100);
}

// ------------------------------------------------- acciones del humano

dom.btnLevantar.addEventListener("click", () => {
  if (enRed()) { pedir("levantar", () => Red.levantar(salaPedida)); return; }
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
  if (enRed()) { await pedir("tirar", () => Red.tirarCarta(salaPedida)); return; }
  if (estado.fase !== "levantada" || estado.indiceTurno !== YO) return;
  if (PODERES[estado.levantada?.numero]) {
    sonidos.poder();
    abrirModalDecisionPoder();
    return;
  }
  sonidos.whoosh();
  estado = tirarCarta(estado);
  dibujar();
  pista("Podés <b>cortar</b> o <b>pasar</b> el turno.");
});

dom.btnCortar.addEventListener("click", async () => {
  if (enRed()) { await pedir("cortar", () => Red.cortar(salaPedida)); return; }
  if (estado.fase !== "postLevantada" || estado.indiceTurno !== YO) return;
  sonidos.corte();
  estado = cortar(estado);
  pista("Corte. Se revelan todas las manos…");
  dibujar();
  await mostrarFinRonda();
});

dom.btnPasar.addEventListener("click", () => {
  if (enRed()) { pedir("pasar", () => Red.pasarTurno(salaPedida)); return; }
  if (estado.fase !== "postLevantada" || estado.indiceTurno !== YO) return;
  sonidos.clic();
  estado = pasarTurno(estado);
  dibujar();
  cicloTurnos();
});

// Clic en el mazo equivale a levantar.
dom.mazoCarta.addEventListener("click", () => {
  if (enRed()) { pedir("levantar", () => Red.levantar(salaPedida)); return; }
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

document.addEventListener("click", async (evento) => {
  const cartaEl = evento.target.closest(".carta[data-posicion]");
  if (!cartaEl) return;
  const jugadorEl = cartaEl.closest(".jugador");
  if (!jugadorEl) return;

  const indiceJugador = Number(jugadorEl.dataset.jugador);
  const posicion = Number(cartaEl.dataset.posicion);

  // En red no se decide nada acá: se pide y se espera la vista nueva.
  if (enRed()) {
    await clicEnCartaDeRed(indiceJugador, posicion);
    return;
  }

  if (estado.fase === "mirar" && indiceJugador === YO) {
    if (manejadorMirada) {
      manejadorMirada(posicion);
    } else {
      // Ya eligió: se explica por qué no pasa nada, en vez de ignorar el clic.
      sonidos.error();
      pista("⚠️ Sólo podés ver <b>una</b> carta al inicio de la ronda.");
      const carta = cartaEl;
      carta.classList.add("rechazada");
      setTimeout(() => carta.classList.remove("rechazada"), 600);
    }
    return;
  }

  // Tocar la mano de otro jugador nunca hace nada, pero conviene decirlo.
  if (estado.fase === "mirar" && indiceJugador !== YO) {
    sonidos.error();
    pista("⚠️ Sólo podés mirar una carta <b>tuya</b>.");
    return;
  }

  if (estado.fase === "descarte" && manejadorDescarte && indiceJugador === YO) {
    manejadorDescarte(posicion);
    return;
  }

  if (estado.fase === "levantada" && estado.indiceTurno === YO && indiceJugador === YO) {
    sonidos.voltear();
    estado = cambiarCarta(estado, posicion);
    pista("Podés <b>cortar</b> o <b>pasar</b> el turno.");
    dibujar();
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
            <span class="dorso"><img src="${dorsoDeAsiento(i)}" alt="" /></span>
            <span class="cara"></span>
          </span>
        </button>`;
    })
    .join("");
}

const TITULOS_PODER = {
  mirarPropia: "Mirar una carta propia",
  mirarRival: "Mirar una carta de un rival",
  cambioCiego: "Cambio a ciegas",
  cambioConVista: "Cambio viendo ambas cartas",
};

/** Qué hace el poder: se muestra antes de decidir si conviene usarlo. */
const EFECTOS_PODER = {
  mirarPropia: "Mirás una carta tuya, la hayas visto antes o no.",
  mirarRival: "Mirás una carta de cualquier otro jugador.",
  cambioCiego: "Intercambiás una carta tuya por una de un rival, sin ver ninguna de las dos.",
  cambioConVista: "Intercambiás una carta tuya por una de un rival, viendo ambas antes.",
};

const INSTRUCCIONES_PODER = {
  mirarPropia: "Elegí una de tus posiciones. La verás 2 segundos.",
  mirarRival: "Elegí una carta de otro jugador. La verás 2 segundos.",
  cambioCiego: "Elegí una carta tuya y una de un rival. No verás ninguna de las dos.",
  cambioConVista: "Elegí una carta tuya y una de un rival. Verás ambas antes del cambio.",
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
      <img src="${carta.imagen}" alt="${carta.numero} de ${carta.palo}" />
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
    eligiendoPoder = { numero: miVista?.poderPendiente?.numero, propia: null };
    pista("Tocá la carta sobre la que querés usar el poder.");
    return;
  }

  if (evento.target.closest('[data-accion="abandonar-no"]')) {
    cerrarModal();
    return;
  }
  const confirmar = evento.target.closest('[data-accion="abandonar-si"]');
  if (confirmar) {
    await confirmarAbandono(confirmar);
    return;
  }

  // 🔮 Usar poder: recién acá se tira la carta y se activa el efecto.
  const usar = evento.target.closest('[data-accion="usar-poder"]');
  if (usar) {
    sonidos.whoosh();
    estado = tirarCarta(estado);
    cerrarModal();
    dibujar();
    if (estado.fase !== "poder") return;
    await anunciarPoder(estado.poderPendiente, estado.jugadores[YO].nombre);
    abrirModalPoder();
    return;
  }

  // 💨 Tirar carta: se descarta como cualquier otra y el poder se pierde.
  const tirarSinPoder = evento.target.closest('[data-accion="tirar-sin-poder"]');
  if (tirarSinPoder) {
    sonidos.clic();
    estado = tirarCarta(estado);
    if (estado.fase === "poder") estado = saltarPoder(estado);
    cerrarModal();
    pista("Tiraste la carta sin usar el poder. Podés <b>cortar</b> o <b>pasar</b> el turno.");
    dibujar();
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
    pista("Descartaste sin usar el poder. Podés <b>cortar</b> o <b>pasar</b> el turno.");
    dibujar();
    return;
  }

  const siguiente = evento.target.closest('[data-accion="siguiente"]');
  if (siguiente) {
    cerrarModal();
    if (estado.fase === "finPartida") return;
    estado = siguienteRonda(estado);
    memorias = estado.jugadores.map(() => IA.crearMemoria());
    revelaciones.clear();
    dibujar();
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
    correrTemporizador(MS_MIRAR, "Mirando");
    await revelarUnMomento(i, pos);
    cancelarTemporizador();
    pista("Podés <b>cortar</b> o <b>pasar</b> el turno.");
    dibujar();
    return;
  }

  // Poderes de cambio: primero la carta propia, después la del rival.
  if (i === YO) {
    seleccionPropia = pos;
    dom.modal
      .querySelectorAll('[data-objetivo="' + YO + '"]')
      .forEach((el) => el.classList.toggle("seleccionada", Number(el.dataset.pos) === pos));
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
    // El cambio con vista muestra ambas cartas ya intercambiadas de posición.
    revelaciones.set(clave(i, pos), null);
    revelaciones.set(clave(YO, propiaUsada), null);
    dibujar();
    efectoCambio("cambioConVista", YO, propiaUsada, i, pos);
    await esperar(MS_MIRAR);
    revelaciones.clear();
  } else {
    dibujar();
    efectoCambio("cambioCiego", YO, propiaUsada, i, pos);
    await esperar(1100);
  }

  seleccionPropia = null;
  pista("Podés <b>cortar</b> o <b>pasar</b> el turno.");
  dibujar();
});

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
          <td>${j.nombre}${i === estado.indiceCortador ? " ✂️" : ""}</td>
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
      <p>Último jugador por debajo de ${LIMITE_ELIMINACION} puntos.</p>
      ${tabla}
      <button class="accion" onclick="location.reload()" type="button">Jugar otra</button>
    `);
    pista(`Partida terminada. Ganó <b>${estado.ganador?.nombre ?? "nadie"}</b>.`);
    if (ganaste) {
      sonidos.victoria();
      lanzarConfeti(dom.confeti);
    } else {
      sonidos.derrota();
    }
    return;
  }

  pista(`Cortó <b>${cortador?.nombre ?? "alguien"}</b>. Ronda ${estado.ronda} terminada.`);
  abrirModal(`
    <h2>✂️ Cortó ${cortador?.nombre ?? "alguien"}</h2>
    <p>Ronda ${estado.ronda} terminada.</p>
    ${tabla}
    <button class="accion" data-accion="siguiente" type="button">Siguiente ronda</button>
  `);
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
    indiceMano: vista.indiceMano,
    indiceTurno: vista.indiceTurno,
    turnosRonda: vista.turnosRonda,
    indiceCortador: vista.indiceCortador,
    desempate: vista.desempate,
    registro: vista.registro ?? [],
    jugadores: vista.jugadores,
    descarte: vista.muestra
      ? [vista.muestra, ...Array.from({ length: restoDelDescarte }, () => tapada)]
      : [],
    mazo: Array.from({ length: vista.cartasEnMazo ?? 0 }, () => tapada),
    levantada: vista.levantada ?? null,
    poderPendiente: vista.poderPendiente ?? null,
    ganador: null,
    eventos: [],
  };
}

/** Texto de la situación, para el modo red. */
function pistaDeRed(vista) {
  if (vista.abandonaron?.includes(miUid)) return "Abandonaste esta partida.";
  const miTurno = vista.indiceTurno === vista.yo;
  const quien = vista.jugadores[vista.indiceTurno]?.nombre ?? "alguien";

  switch (vista.fase) {
    case "mirar":
      return "Tocá <b>una</b> carta tuya para memorizarla.";
    case "descarte":
      return "<b>¡Reflejos!</b> Tocá una carta que creas igual a la muestra.";
    case "turno":
      return miTurno ? "Es tu turno. <b>Levantá</b> del mazo." : `Juega <b>${quien}</b>.`;
    case "levantada":
      return miTurno ? "Cambiala por una tuya, o tirala." : `<b>${quien}</b> está decidiendo.`;
    case "poder":
      return miTurno ? "Levantaste un poder." : `<b>${quien}</b> tiene un poder.`;
    case "postLevantada":
      return miTurno ? "Podés <b>cortar</b> o <b>pasar</b>." : `<b>${quien}</b> decide si corta.`;
    case "finRonda":
      return `Ronda ${vista.ronda} terminada.`;
    case "finPartida":
      return "Partida terminada.";
    default:
      return "";
  }
}

/** Pinta la vista que acaba de llegar. */
function pintarVista(vista) {
  miVista = vista;
  YO = vista.yo;
  estado = comoEstado(vista);
  dibujar();
  pista(pistaDeRed(vista));
  modalesDeRed(vista);
}

/**
 * Los modales que dependen de la fase.
 *
 * Se abren y se cierran mirando la vista, no guardando estado propio: si el
 * modal recordara por su cuenta que está abierto, una reconexión que trae
 * otra fase lo dejaría abierto sobre una partida que ya siguió.
 */
let faseMostrada = null;
function modalesDeRed(vista) {
  const clave = `${vista.fase}:${vista.ronda}:${vista.version}`;
  if (clave === faseMostrada) return;

  const eraPoder = faseMostrada?.startsWith("poder:");
  faseMostrada = clave;

  if (vista.fase === "poder" && vista.indiceTurno === YO) {
    abrirModalPoderDeRed(vista);
    return;
  }
  if (eraPoder) cerrarModal();

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
  const explicacion = {
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

/** Resultado de la ronda o de la partida, con lo que publicó el servidor. */
function abrirModalFinDeRed(vista) {
  const filas = vista.jugadores
    .map((j, i) => {
      const enMano = vista.puntosDeMano?.[i];
      return `<tr${i === YO ? ' class="propio"' : ""}>
        <td>${j.nombre}</td>
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
      <p class="aviso-suave">Volvé al lobby para jugar otra.</p>`);
    if (gane) { sonidos.victoria(); lanzarConfeti(dom.confeti); } else sonidos.derrota();
    return;
  }

  const cortador = vista.jugadores[vista.indiceCortador]?.nombre ?? "alguien";
  abrirModal(`<h2>✂️ Cortó ${cortador}</h2>
    <p>Ronda ${vista.ronda} terminada. La siguiente arranca sola.</p>${tabla}`);
}

/**
 * Manda una acción y deja que la vista nueva llegue sola por el listener.
 *
 * No se toca `estado` acá: el resultado lo publica el servidor. Pintar un
 * resultado optimista sería adivinar, y en la ventana de reflejos adivinar
 * mal es lo más probable — el resultado depende de lo que hagan los otros.
 */
async function pedir(accion, ejecutar) {
  if (pidiendo) return;
  pidiendo = true;
  try {
    return await ejecutar();
  } catch (error) {
    pista(`⚠️ ${error?.message ?? "No pudimos enviar la jugada."}`);
    sonidos.error();
  } finally {
    pidiendo = false;
  }
}
let pidiendo = false;

/** Clic sobre una carta, en modo red. */
/** Poder en curso: qué se está eligiendo. */
let eligiendoPoder = null;

async function clicEnCartaDeRed(indiceJugador, posicion) {
  if (!miVista) return;

  if (eligiendoPoder && miVista.fase === "poder") {
    const numero = eligiendoPoder.numero;

    // 7 y 8: un solo clic, sobre la carta a mirar.
    if (numero === 7 || numero === 8) {
      const objetivo = { indice: indiceJugador };
      eligiendoPoder = null;
      const r = await pedir("poder", () => Red.accion(salaPedida, "poderMirar", { posicion, objetivo }));
      if (r?.carta) mostrarUnMomento(indiceJugador, posicion, r.carta);
      return;
    }

    // 9 y 10: primero una carta propia, después una ajena.
    if (eligiendoPoder.propia === null) {
      if (indiceJugador !== YO) { pista("Primero elegí una carta <b>tuya</b>."); return; }
      eligiendoPoder.propia = posicion;
      pista("Ahora tocá la carta del <b>rival</b> con la que querés cambiarla.");
      return;
    }
    if (indiceJugador === YO) { pista("Tiene que ser la carta de <b>otro</b> jugador."); return; }

    const propia = eligiendoPoder.propia;
    eligiendoPoder = null;
    const r = await pedir("poder", () => Red.accion(salaPedida, "poderCambio", {
      posicion: propia, objetivo: { indice: indiceJugador, posicion },
    }));
    // El 10 muestra las dos cartas; el 9 no muestra ninguna.
    if (r?.revelada?.propia) mostrarUnMomento(YO, propia, r.revelada.propia);
    if (r?.revelada?.rival) mostrarUnMomento(indiceJugador, posicion, r.revelada.rival);
    return;
  }

  if (miVista.fase === "mirar" && indiceJugador === YO) {
    const r = await pedir("mirar", () => Red.mirar(salaPedida, posicion));
    // El servidor devuelve la carta SÓLO a quien la miró. No queda en la
    // partida: se muestra dos segundos y se olvida, como en la mesa local.
    if (r?.carta) {
      const llave = clave(YO, posicion);
      revelaciones.set(llave, r.carta);
      dibujar();
      setTimeout(() => { revelaciones.delete(llave); dibujar(); }, MS_MIRAR);
    }
    return;
  }

  if (miVista.fase === "descarte" && indiceJugador === YO) {
    const ventana = miVista.ventana;
    if (!ventana || ventana.cerrada) return;
    // Se manda el instante del CLIC, no el del envío.
    const tocadoEn = Date.now();
    await pedir("descartar", () => Red.intentarDescarte(salaPedida, ventana, posicion, tocadoEn));
    return;
  }

  if (miVista.fase === "levantada" && miVista.indiceTurno === YO && indiceJugador === YO) {
    await pedir("cambiar", () => Red.cambiarCarta(salaPedida, posicion));
  }
}

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
  setTimeout(() => { revelaciones.delete(llave); dibujar(); }, ms);
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
  dejarDeLatir = Red.mantenerVivo(salaPedida);
  // Todos los jugadores golpean la puerta. Si dependiera de uno solo, su
  // desconexión congelaría la mesa para los demás.
  dejarDeAvanzar = Red.mantenerEnMarcha(salaPedida);

  window.addEventListener("pagehide", () => {
    dejarDeEscuchar?.();
    dejarDeLatir?.();
    dejarDeAvanzar?.();
  });

  pista("Conectando con la partida…");
}

let miUid = null;

// ------------------------------------------------------------- arranque

/** Manda al lobby con un motivo que el lobby muestra al cargar. */
function volverAlLobby(motivo) {
  sessionStorage.setItem("avisoLobby", motivo);
  window.location.href = "lobby.html";
}

/**
 * Valida el acceso a una partida de sala antes de mostrar nada.
 * Cubre: código inválido, sala inexistente, jugador ajeno, sala cancelada,
 * sala todavía en espera y partida ya terminada.
 */
async function entrarDesdeSala() {
  const { db, doc, getDoc } = await import("./firebase.js");
  const { exigirSesion } = await import("./sesion.js");
  const { ESTADOS_SALA, MIN_JUGADORES, esCodigoValido } = await import("./reglas/salas.js");

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
    volverAlLobby("Esa sala fue cancelada. Si pagaste la entrada, ya te la devolvimos.");
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
      <img src="img/claude-inspiration/logo.png" alt="" class="logo-img grande" />
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
        <a class="btn-plata" href="lobby.html">Ir al lobby</a>
      </div>
    </div>`;
}

if (salaPedida) {
  entrarDesdeSala();
} else {
  // Entrenamiento contra la máquina: todo local, sin Leyendas.
  arrancarRonda();
}
