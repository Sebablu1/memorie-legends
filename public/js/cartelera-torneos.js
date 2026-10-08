/**
 * La cartelera de torneos del panel: cuáles hay abiertos y cómo anotarse.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ SÓLO SE VE SI HAY ALGO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Los torneos los crea el administrador a mano y no hay automáticos, así que
 * la mayoría de los días no hay ninguno. Una sección permanente que dice "no
 * hay torneos" ocupa el mismo lugar que una con torneos de verdad y enseña a
 * no mirarla; cuando por fin haya uno, nadie lo va a ver.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ANOTARSE COBRA, ASÍ QUE SE PREGUNTA PRIMERO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Es el único botón del panel que descuenta Leyendas de una, y el monto lo
 * decide el torneo y no el jugador. Un clic distraído sobre "Anotarme" no
 * puede costar 20.000 Leyendas sin una pregunta en el medio.
 *
 * La confirmación es de este lado y es una cortesía, no una defensa: quien se
 * saltee el diálogo desde la consola igual paga la entrada, porque el cobro
 * está en el servidor. Lo que la pregunta evita es el arrepentimiento, no el
 * fraude.
 */

import { listarTorneos, inscribirseATorneo, ErrorDeServidor } from "./servidor.js";
import { mostrarSaldo } from "./sesion.js";

const $ = (id) => document.getElementById(id);

const escapar = (t) =>
  String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const numero = (n) => Number(n ?? 0).toLocaleString("es-UY");

let abiertos = [];

function avisar(texto, esError = false) {
  const caja = $("avisoTorneosJugador");
  if (!caja) return;
  caja.textContent = texto ?? "";
  caja.classList.toggle("error", Boolean(esError));
}

/**
 * Cuándo empieza, escrito para leer.
 *
 * Es lo primero que quiere saber quien está por pagar una entrada, y hasta
 * hace poco no estaba en ningún lado: el aviso decía «te avisamos cuando
 * arranque» y no hay nada que avise —`iniciar` agrupa los uid en mesas
 * dentro del documento del torneo y no notifica a nadie—. Con la fecha
 * puesta, el jugador puede anotarse la hora.
 *
 * Sin fecha se dice que no hay, y no se inventa una: un torneo puede
 * publicarse antes de saber cuándo se juega.
 */
export function cuandoEmpieza(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toLocaleString("es-UY", {
    weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  });
}

function dibujarTorneo(t) {
  const faltan = Math.max(0, 4 - Number(t.inscriptos ?? 0));
  const empieza = cuandoEmpieza(t.comienzaEn);
  const dice = String(t.descripcion ?? "").trim();

  return `
    <div class="fila-torneo">
      <div class="datos-torneo">
        <b>${escapar(t.nombre ?? "Torneo")}</b>
        <span>Entrada ${numero(t.entrada)} Leyendas · ${numero(t.inscriptos ?? 0)} anotado${
          Number(t.inscriptos ?? 0) === 1 ? "" : "s"
        }${faltan ? ` · faltan ${faltan} para que se juegue` : ""}</span>
        ${empieza ? `<span class="cuando-torneo">🗓 Empieza el ${escapar(empieza)}</span>` : ""}
        ${dice ? `<span class="dice-torneo">${escapar(dice)}</span>` : ""}
      </div>
      <button class="accion" type="button"
              data-torneo="${escapar(t.id)}"
              data-entrada="${Number(t.entrada ?? 0)}"
              data-nombre="${escapar(t.nombre ?? "Torneo")}"
              data-comienza="${Number(t.comienzaEn ?? 0)}">Anotarme</button>
    </div>`;
}

function dibujar() {
  const seccion = $("carteleraTorneos");
  const caja = $("listaTorneosJugador");
  if (!seccion || !caja) return;

  // Sin torneos, la sección se esconde: una que dice «no hay» ocupa el mismo
  // lugar que uno de verdad y enseña a no mirarla. Salvo que la página tenga
  // su propio texto de vacío —el lobby, donde los torneos son una de sus tres
  // secciones—: ahí se queda y lo dice.
  const vacio = $("torneosVacios");
  if (!abiertos.length) {
    caja.innerHTML = "";
    if (vacio) {
      vacio.hidden = false;
      seccion.hidden = false;
    } else {
      seccion.hidden = true;
    }
    return;
  }

  if (vacio) vacio.hidden = true;
  caja.innerHTML = abiertos.map(dibujarTorneo).join("");
  seccion.hidden = false;
}

/**
 * El cuadro de inscripción, armado una sola vez y guardado acá.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ DEJÓ DE SER UN `window.confirm`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque ahora hay que aceptar dos textos, y un `confirm` nativo no puede
 * tener un enlace adentro. Pedirle a alguien que acepte el Reglamento de
 * Torneos sin poder abrirlo sería pedirle que acepte a ciegas.
 *
 * Reemplaza al `confirm` y no se suma a él: dos puertas seguidas para un solo
 * botón enseñan a atravesarlas sin leer, que es lo contrario de lo que esto
 * busca. Dice lo mismo que decía el `confirm` —cuánto cuesta, cuándo empieza,
 * qué pasa si no se llena— más la casilla.
 *
 * Se arma en JavaScript y no en `lobby.html` para que el cuadro y la lógica
 * que lo abre vivan juntos; es el único lugar que lo usa.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA CASILLA ES UNA CORTESÍA, COMO LO ERA LA PREGUNTA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Igual que el `confirm` que reemplaza (ver la nota de arriba del archivo):
 * quien se la saltee desde la consola igual paga la entrada, porque el cobro
 * está en el servidor. Y la aceptación que queda asentada tampoco sale de
 * acá: la escribe `inscribir`, con las versiones que el servidor tiene
 * publicadas y su propio reloj. Esto es la pantalla, no la prueba.
 */
let cuadro = null;

function armarCuadro() {
  const d = document.createElement("dialog");
  d.className = "cuadro-torneo";
  d.innerHTML = `
    <form method="dialog">
      <h3 id="ctNombre"></h3>
      <p id="ctCosto"></p>
      <p id="ctFecha" hidden></p>
      <p class="ct-nota">Si el torneo no llega a cuatro jugadores, se cancela y se te devuelve todo.</p>
      <label class="ct-acepto">
        <input type="checkbox" id="ctAcepto" aria-required="true" />
        <span>Acepto los <a href="/terminos.html" target="_blank" rel="noopener">Términos y Condiciones</a> y el <a href="/reglamento-torneos.html" target="_blank" rel="noopener">Reglamento de Torneos</a>.</span>
      </label>
      <div class="ct-botones">
        <button type="submit" value="no" class="accion sobria">Cancelar</button>
        <button type="submit" value="si" id="ctSi" class="accion" disabled>Inscribirme</button>
      </div>
    </form>
  `;

  // Mientras la casilla no esté marcada, el botón no sirve. Es más claro que
  // dejarlo activo y contestar con un error después de apretarlo.
  const casilla = d.querySelector("#ctAcepto");
  const si = d.querySelector("#ctSi");
  casilla.addEventListener("change", () => {
    si.disabled = !casilla.checked;
  });

  // Un `<dialog>` no se cierra al tocar afuera; hay que pedirlo. El click cae
  // en el propio `dialog` sólo cuando fue sobre el fondo: lo de adentro está
  // en el `<form>`. Cierra sin inscribir, igual que Escape, que ya lo hace
  // solo y deja `returnValue` vacío.
  d.addEventListener("click", (e) => {
    if (e.target === d) d.close("no");
  });

  document.body.appendChild(d);
  return d;
}

/** Abre el cuadro y resuelve `true` sólo si se aceptó y se apretó Inscribirme. */
function preguntar({ nombre, entrada, empieza }) {
  const d = (cuadro ??= armarCuadro());

  d.querySelector("#ctNombre").textContent = nombre;
  d.querySelector("#ctCosto").textContent =
    `Anotarte cuesta ${numero(entrada)} Leyendas y se cobra ahora.`;

  const fecha = d.querySelector("#ctFecha");
  fecha.textContent = empieza ? `Empieza el ${empieza}.` : "";
  fecha.hidden = !empieza;

  // Se pide SIEMPRE y sin marcar de antemano. No se mira si esta persona ya
  // aceptó la versión vigente: acá se acepta por torneo y no por usuario, y
  // el torneo al que se anota hoy no existía cuando se registró.
  const casilla = d.querySelector("#ctAcepto");
  casilla.checked = false;
  d.querySelector("#ctSi").disabled = true;

  return new Promise((resolver) => {
    const alCerrar = () => {
      d.removeEventListener("close", alCerrar);
      resolver(d.returnValue === "si" && casilla.checked);
    };
    d.addEventListener("close", alCerrar);
    d.returnValue = "";
    d.showModal();
  });
}

async function anotarse(boton) {
  const entrada = Number(boton.dataset.entrada);
  const nombre = boton.dataset.nombre;
  const empieza = cuandoEmpieza(Number(boton.dataset.comienza));

  // La fecha va ANTES de cobrar, no después. Es la mitad de lo que la
  // persona está comprando: de nada le sirve el torneo si no puede estar.
  const seguro = await preguntar({ nombre, entrada, empieza });
  if (!seguro) return;

  const textoPrevio = boton.textContent;
  boton.disabled = true;
  boton.textContent = "…";
  avisar("");

  try {
    const r = await inscribirseATorneo(boton.dataset.torneo);
    if (typeof r.saldo === "number") mostrarSaldo(r.saldo);
    /**
     * No se promete avisar, porque no hay nada que avise.
     *
     * `iniciar` agrupa los uid en mesas dentro del documento del torneo y no
     * manda un correo, ni una notificación, ni crea una sala. Decir «te
     * avisamos» era comprometer algo que el sistema no hace; ahora se le da
     * al jugador lo único cierto que hay: la hora, si la hay.
     */
    avisar(
      empieza
        ? `Anotado a «${nombre}». Empieza el ${empieza}.`
        : `Anotado a «${nombre}». Mirá la cartelera para saber cuándo arranca.`,
    );
    boton.textContent = "✓ Anotado";
    await cargar();
  } catch (e) {
    boton.disabled = false;
    boton.textContent = textoPrevio;
    avisar(
      e instanceof ErrorDeServidor ? e.message : "No se pudo. Probá de nuevo en un momento.",
      true,
    );
  }
}

async function cargar() {
  const r = await listarTorneos();
  abiertos = r.torneos ?? [];
  dibujar();
}

/**
 * Arranca la cartelera. La llama el lobby cuando ya hay sesión.
 *
 * Si algo falla, la página sigue funcionando: una cartelera rota no es motivo
 * para que alguien no pueda entrar a jugar. Donde la sección no se esconde
 * —el lobby— dice que no se pudo, en vez de quedar vacía sin explicación.
 */
export async function montarCarteleraTorneos() {
  if (!$("carteleraTorneos")) return;

  try {
    await cargar();
  } catch {
    const vacio = $("torneosVacios");
    if (vacio) {
      vacio.textContent = "No pudimos cargar los torneos. Probá recargar la página.";
      vacio.hidden = false;
    }
    return;
  }

  // Un solo escuchador en el contenedor: la lista se repinta entera en cada
  // cambio, y volver a colgar escuchadores cada vez es cómo se duplican los
  // clics — que acá costarían dos entradas.
  $("listaTorneosJugador")?.addEventListener("click", (e) => {
    const boton = e.target.closest("[data-torneo]");
    if (boton && !boton.disabled) anotarse(boton);
  });
}
