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

function dibujarTorneo(t) {
  const faltan = Math.max(0, 4 - Number(t.inscriptos ?? 0));

  return `
    <div class="fila-torneo">
      <div class="datos-torneo">
        <b>${escapar(t.nombre ?? "Torneo")}</b>
        <span>Entrada ${numero(t.entrada)} Leyendas · ${numero(t.inscriptos ?? 0)} anotado${
          Number(t.inscriptos ?? 0) === 1 ? "" : "s"
        }${faltan ? ` · faltan ${faltan} para que se juegue` : ""}</span>
      </div>
      <button class="accion" type="button"
              data-torneo="${escapar(t.id)}"
              data-entrada="${Number(t.entrada ?? 0)}"
              data-nombre="${escapar(t.nombre ?? "Torneo")}">Anotarme</button>
    </div>`;
}

function dibujar() {
  const seccion = $("carteleraTorneos");
  const caja = $("listaTorneosJugador");
  if (!seccion || !caja) return;

  if (!abiertos.length) {
    seccion.hidden = true;
    return;
  }

  caja.innerHTML = abiertos.map(dibujarTorneo).join("");
  seccion.hidden = false;
}

async function anotarse(boton) {
  const entrada = Number(boton.dataset.entrada);
  const nombre = boton.dataset.nombre;

  const seguro = window.confirm(
    `Anotarte a «${nombre}» cuesta ${numero(entrada)} Leyendas y se cobra ahora.\n\n` +
      `Si el torneo no llega a cuatro jugadores, se cancela y se te devuelve todo.`,
  );
  if (!seguro) return;

  const textoPrevio = boton.textContent;
  boton.disabled = true;
  boton.textContent = "…";
  avisar("");

  try {
    const r = await inscribirseATorneo(boton.dataset.torneo);
    if (typeof r.saldo === "number") mostrarSaldo(r.saldo);
    avisar(`Anotado a «${nombre}». Te avisamos cuando arranque.`);
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
 * Arranca la cartelera. La llama `dashboard.js` cuando ya hay sesión.
 *
 * Si algo falla, la sección se queda oculta y el panel sigue funcionando. Una
 * cartelera rota no es motivo para que alguien no pueda entrar a jugar.
 */
export async function montarCarteleraTorneos() {
  if (!$("carteleraTorneos")) return;

  try {
    await cargar();
  } catch {
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
