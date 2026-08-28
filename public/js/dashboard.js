import { exigirSesion, mostrarSaldo, conectarBotonSalir, formatearEspera } from "./sesion.js";
import { esperaRuleta } from "./reglas/economia.js";

const $ = (id) => document.getElementById(id);

conectarBotonSalir();

const sesion = await exigirSesion();
if (sesion) {
  const { usuario, perfil } = sesion;

  $("saludo").textContent = `Hola, ${perfil.nombre}`;
  $("subtitulo").textContent =
    perfil.partidas > 0
      ? `Llevás ${perfil.partidas} partida${perfil.partidas === 1 ? "" : "s"} y ${perfil.victorias} victoria${perfil.victorias === 1 ? "" : "s"}.`
      : "Todavía no jugaste ninguna partida. Empezá por la mesa.";

  if (usuario.photoURL) $("avatar").src = usuario.photoURL;

  mostrarSaldo(perfil.saldo);
  $("statSaldo").textContent = perfil.saldo.toLocaleString("es-UY");
  $("statPartidas").textContent = perfil.partidas;
  $("statVictorias").textContent = perfil.victorias;

  // Estado de la ruleta: mismo cálculo que usa la propia página.
  const restante = esperaRuleta(perfil.ultimoGiro || null);
  $("statRuleta").textContent = formatearEspera(restante);

  const etiqueta = $("etiquetaRuleta");
  const pie = $("pieRuleta");
  if (restante > 0) {
    etiqueta.textContent = formatearEspera(restante);
    etiqueta.className = "etiqueta espera";
    pie.textContent = "Todavía no →";
  } else {
    etiqueta.textContent = "Giro listo";
    etiqueta.className = "etiqueta lista";
    pie.textContent = "Girar ahora →";
  }
}
