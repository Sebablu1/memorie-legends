import { exigirSesion, mostrarSaldo, conectarBotonSalir } from "./sesion.js";
// Los nombres del ranking los eligen los jugadores y esta tabla la ve todo el
// mundo: es la pantalla de mayor alcance del sitio.
import { escapar } from "./modulos/texto.js";
import { db, collection, getDocs, query, orderBy, limit } from "./firebase.js";
import { clavesDePeriodos } from "./reglas/ranking.js";
import { esRutaDelSitio } from "./reglas/catalogo.js";

const $ = (id) => document.getElementById(id);

conectarBotonSalir();

const NOMBRES = { semanal: "esta semana", mensual: "este mes", anual: "este año" };

/**
 * El nombre, la cara, el marco y el título de una fila del ranking.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TODO SALE DE LA FILA, Y NO DEL PERFIL
 * ─────────────────────────────────────────────────────────────────────────
 *
 * No es una preferencia: el navegador NO PUEDE leer el perfil de otro
 * jugador. `users/{uid}` es de lectura sólo para su dueño —se cerró para que
 * nadie viera el saldo ajeno— y esta tabla se lee directo de Firestore.
 *
 * Así que lo que se ve acá es lo que el servidor congeló en la fila al
 * puntuar. Una fila del ranking es un registro histórico, y muestra al
 * jugador como era cuando ganó ese puesto.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Y LAS FILAS VIEJAS NO TRAEN NADA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ninguna fila anterior a este cambio tiene nombre. Durante meses la tabla
 * pintó `f.nombre ?? f.uid` sin que nadie escribiera `nombre`, así que lo que
 * se veía era el uid crudo de cada jugador — en la pantalla de mayor alcance
 * del sitio.
 *
 * Por eso el respaldo no es el uid. Un uid no le dice nada a nadie y es de
 * quien lo tiene; «Jugador» al menos no expone a la persona. Las filas viejas
 * se arreglan solas la primera vez que ese jugador vuelva a puntuar.
 */
const nombreDe = (f) => {
  const nombre = String(f?.nombre ?? "").trim();
  return nombre || "Jugador";
};

/**
 * La cara: la que tenía puesta, o la inicial.
 *
 * `esRutaDelSitio` otra vez, igual que en la mesa y en la sala. Lo que hay en
 * la fila lo escribió el servidor, pero un `src` que apunte afuera del sitio
 * le avisaría a ese dominio quién está mirando el ranking y desde dónde.
 */
function caraEnLaTabla(f) {
  const inicial = nombreDe(f).charAt(0).toUpperCase() || "?";
  if (!esRutaDelSitio(f?.retrato)) {
    return `<span class="avatar-inicial" aria-hidden="true">${escapar(inicial)}</span>`;
  }
  return `<span class="avatar-inicial con-cara" aria-hidden="true">
      <img src="${escapar(f.retrato)}" alt="" loading="lazy" />
    </span>`;
}

/** El marco, superpuesto: un `border` cambiaría el alto de la fila. */
function marcoEnLaTabla(f) {
  if (!esRutaDelSitio(f?.marco)) return "";
  return `<img class="marco-ranking" src="${escapar(f.marco)}" alt="" aria-hidden="true" />`;
}

/** El título, al lado del nombre. Es texto de un administrador: va escapado. */
function tituloEnLaTabla(f) {
  const titulo = String(f?.titulo ?? "").trim();
  if (!titulo) return "";
  return `<span class="titulo-jugador">${escapar(titulo)}</span>`;
}

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
              <td class="jugador-ranking">
                <span class="ficha-ranking">
                  ${caraEnLaTabla(f)}
                  ${marcoEnLaTabla(f)}
                </span>
                <span class="nombre-ranking">${escapar(nombreDe(f))}</span>
                ${tituloEnLaTabla(f)}
              </td>
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
