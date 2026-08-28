import {
  exigirSesion,
  mostrarSaldo,
  conectarBotonSalir,
  formatearEspera,
} from "./sesion.js";

import {
  PREMIOS_RULETA,
  probabilidadesRuleta,
  girarRuleta,
  esperaRuleta,
  HORAS_RULETA,
} from "./reglas/economia.js";

import { lanzarConfeti } from "./confeti.js";
import { sonidos } from "./sonidos.js";

const $ = (id) => document.getElementById(id);
const SECTORES = PREMIOS_RULETA.length;
const GRADOS = 360 / SECTORES;

conectarBotonSalir();

// ------------------------------------------------------------ dibujo

/** Los sectores se ven todos iguales; las probabilidades van en la tabla. */
function dibujarRueda() {
  const cara = $("ruedaCara");
  cara.innerHTML = PREMIOS_RULETA.map((p, i) => {
    const giro = i * GRADOS;
    return `
      <div class="sector rareza-${p.rareza}"
           style="transform: rotate(${giro}deg);
                  background: color-mix(in srgb, var(--tinte) ${i % 2 ? 55 : 78}%, #0b1020);"></div>`;
  }).join("");

  // Las etiquetas van aparte para que no las recorte el clip-path del sector.
  cara.innerHTML += PREMIOS_RULETA.map((p, i) => {
    const giro = i * GRADOS + GRADOS / 2;
    return `
      <div class="valor" style="transform: translateX(-50%) rotate(${giro}deg);
                                transform-origin: 50% 620%;">${p.premio}</div>`;
  }).join("");
}

function dibujarTabla() {
  $("tablaPremios").innerHTML = probabilidadesRuleta()
    .map(
      (p) => `
      <div class="premio-fila rareza-${p.rareza}">
        <b>${p.premio.toLocaleString("es-UY")}</b>
        <span>${(p.probabilidad * 100).toFixed(p.probabilidad < 0.001 ? 4 : 2)}% · 1 en ${Math.round(p.unoEn).toLocaleString("es-UY")}</span>
      </div>`,
    )
    .join("");
}

// ------------------------------------------------------------- giro

let girando = false;
let vueltaAcumulada = 0;

/** Lleva el sector ganador bajo la aguja, con varias vueltas de más. */
function animarHasta(indice) {
  const centroSector = indice * GRADOS + GRADOS / 2;
  const vueltas = 6 * 360;
  // La aguja está arriba (0°): hay que llevar el sector hasta ahí.
  vueltaAcumulada += vueltas + ((360 - (vueltaAcumulada % 360) - centroSector) % 360);
  $("ruedaCara").style.transform = `rotate(${vueltaAcumulada}deg)`;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------- arranque

dibujarRueda();
dibujarTabla();

const sesion = await exigirSesion();
if (sesion) {
  const { usuario, perfil } = sesion;
  let saldo = perfil.saldo;
  let ultimoGiro = perfil.ultimoGiro || null;

  mostrarSaldo(saldo);
  $("saldoPanel").textContent = saldo.toLocaleString("es-UY");

  const refrescarEstado = () => {
    const restante = esperaRuleta(ultimoGiro);
    const listo = restante <= 0;
    $("estadoGiro").textContent = listo ? "disponible" : `en ${formatearEspera(restante)}`;
    $("btnGirar").disabled = !listo || girando;
    return listo;
  };

  refrescarEstado();
  // Mientras haya que esperar, el contador se actualiza solo.
  setInterval(refrescarEstado, 30000);

  if (esperaRuleta(ultimoGiro) > 0) {
    $("resultado").textContent = `Ya giraste. La ruleta se recarga cada ${HORAS_RULETA} horas.`;
  } else {
    $("resultado").textContent = "Tenés un giro disponible.";
  }

  $("btnGirar").addEventListener("click", async () => {
    if (girando || !refrescarEstado()) return;

    girando = true;
    $("btnGirar").disabled = true;
    $("rueda").classList.add("girando");
    $("resultado").className = "resultado";
    $("resultado").textContent = "Girando…";
    sonidos.whoosh();

    const { premio, rareza } = girarRuleta();
    const indice = PREMIOS_RULETA.findIndex((p) => p.premio === premio);
    animarHasta(indice);

    // Dura lo mismo que la transición de la rueda.
    await esperar(5100);
    $("rueda").classList.remove("girando");

    // NO se acredita desde el navegador: el saldo sólo puede escribirlo el
    // servidor. Hasta entonces la ruleta muestra el premio pero no lo paga,
    // y tampoco consume el giro: sería cobrarle al jugador sin darle nada.
    const caja = $("resultado");
    caja.className = `resultado premiado rareza-${rareza}`;
    caja.innerHTML =
      `<span class="cantidad">+${premio.toLocaleString("es-UY")}</span> Leyendas` +
      `<br><small>Se acreditarán cuando el servidor esté activo.</small>`;

    // Los premios grandes merecen festejo.
    if (premio >= 50) {
      sonidos.victoria();
      lanzarConfeti($("confeti"), { cantidad: premio >= 500 ? 240 : 120 });
    } else {
      sonidos.acierto();
    }

    girando = false;
    refrescarEstado();
  });
}
