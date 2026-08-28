import { exigirSesion, mostrarSaldo, conectarBotonSalir } from "./sesion.js";
import { db, collection, getDocs, query, orderBy, limit } from "./firebase.js";
import { clavesDePeriodos } from "./reglas/ranking.js";

const $ = (id) => document.getElementById(id);

conectarBotonSalir();

const NOMBRES = { semanal: "esta semana", mensual: "este mes", anual: "este año" };

const sesion = await exigirSesion();
if (sesion) {
  mostrarSaldo(sesion.perfil.saldo);
  const miUid = sesion.usuario.uid;

  async function cargar(periodo) {
    const clave = clavesDePeriodos()[periodo];
    $("periodoActual").textContent = `Clasificación de ${NOMBRES[periodo]} · ${clave}`;
    $("tabla").innerHTML = '<div class="vacio">Cargando…</div>';

    let filas = [];
    try {
      const snap = await getDocs(
        query(collection(db, "rankings", clave, "jugadores"), orderBy("puntos", "desc"), limit(50)),
      );
      filas = snap.docs.map((d, i) => ({ puesto: i + 1, ...d.data() }));
    } catch (error) {
      console.error("No se pudo leer el ranking:", error);
      $("tabla").innerHTML =
        '<div class="vacio"><span class="icono">⚠️</span>No se pudo leer la tabla. Puede que las reglas de Firestore todavía no permitan esta colección.</div>';
      return;
    }

    if (!filas.length) {
      $("tabla").innerHTML =
        '<div class="vacio"><span class="icono">🏆</span>Todavía nadie puntuó en este período.<br>Las partidas con Leyendas suman puntos acá.</div>';
      $("tuPuesto").style.display = "none";
      return;
    }

    $("tabla").innerHTML = `
      <table class="tabla-ranking">
        <thead>
          <tr><th>#</th><th>Jugador</th><th class="num">Puntos</th><th class="num">Ganadas</th><th class="num">Jugadas</th></tr>
        </thead>
        <tbody>
          ${filas
            .map(
              (f) => `
            <tr class="${f.uid === miUid ? "yo" : ""} podio-${f.puesto <= 3 ? f.puesto : ""}">
              <td class="puesto">${f.puesto <= 3 ? ["🥇", "🥈", "🥉"][f.puesto - 1] : f.puesto}</td>
              <td>${f.nombre ?? f.uid ?? "Jugador"}</td>
              <td class="num puntos">${(f.puntos ?? 0).toLocaleString("es-UY")}</td>
              <td class="num">${f.partidasGanadas ?? 0}</td>
              <td class="num">${f.partidasJugadas ?? 0}</td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>`;

    const mio = filas.find((f) => f.uid === miUid);
    if (mio) {
      $("tuPuesto").style.display = "";
      $("tuFila").innerHTML = `
        <div class="fila-dato"><span>Puesto</span><b>#${mio.puesto}</b></div>
        <div class="fila-dato"><span>Puntos</span><b>${(mio.puntos ?? 0).toLocaleString("es-UY")}</b></div>
        <div class="fila-dato"><span>Racha actual</span><b>${mio.rachaActual ?? 0}</b></div>`;
    } else {
      $("tuPuesto").style.display = "none";
    }
  }

  $("pestanas").addEventListener("click", (evento) => {
    const boton = evento.target.closest(".pestana");
    if (!boton) return;
    $("pestanas").querySelectorAll(".pestana").forEach((b) => b.classList.remove("activa"));
    boton.classList.add("activa");
    cargar(boton.dataset.periodo);
  });

  cargar("semanal");
}
