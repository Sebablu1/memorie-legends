/**
 * Sesión compartida por las pantallas de la aplicación.
 *
 * Lee el perfil del jugador de la colección `users`, que es la que ya usa el
 * login en producción. El campo `credits` es el saldo de Leyendas.
 *
 * NOTA DE MIGRACIÓN: las Cloud Functions nuevas trabajan con `jugadores/{uid}`
 * y el campo `leyendas`. Mientras no se desplieguen, esta capa mantiene el
 * modelo viejo para que todo funcione. Cuando se migre, alcanza con cambiar
 * COLECCION y CAMPO_SALDO acá.
 */

import { auth, db, doc, getDoc, updateDoc, onAuthStateChanged, signOut } from "./firebase.js";

export const COLECCION = "users";
export const CAMPO_SALDO = "credits";

/** Espera a que Firebase resuelva la sesión y devuelve el usuario, o null. */
export function esperarSesion() {
  return new Promise((resolve) => {
    const cortar = onAuthStateChanged(auth, (usuario) => {
      cortar();
      resolve(usuario);
    });
  });
}

/**
 * Exige sesión iniciada: si no hay, manda al login.
 * Devuelve { usuario, perfil } cuando la hay.
 */
export async function exigirSesion() {
  const usuario = await esperarSesion();
  if (!usuario) {
    window.location.href = "login.html";
    return null;
  }
  const perfil = await leerPerfil(usuario.uid);
  return { usuario, perfil };
}

export async function leerPerfil(uid) {
  const snap = await getDoc(doc(db, COLECCION, uid));
  const datos = snap.exists() ? snap.data() : {};
  return {
    uid,
    nombre: datos.username ?? "Jugador",
    saldo: Number(datos[CAMPO_SALDO] ?? 0),
    partidas: Number(datos.gamesPlayed ?? 0),
    victorias: Number(datos.wins ?? 0),
    ultimoGiro: datos.lastSpin ?? 0,
    ultimoBono: datos.lastDailyBonus ?? 0,
  };
}

/**
 * Guarda campos del perfil.
 *
 * ⚠️ NO sirve para el saldo. `credits` es de sólo lectura para el cliente:
 * lo escribe únicamente el servidor. Esta función existe para datos como el
 * nombre o el avatar, y las reglas de Firestore rechazan cualquier intento
 * de tocar el saldo desde acá.
 */
export async function guardarEnPerfil(uid, campos) {
  if (CAMPO_SALDO in campos) {
    throw new Error("El saldo no se escribe desde el navegador.");
  }
  await updateDoc(doc(db, COLECCION, uid), campos);
}

/** Pinta el saldo en la barra superior, con destello si subió. */
export function mostrarSaldo(saldo, { animar = false } = {}) {
  const caja = document.getElementById("saldo");
  const valor = document.getElementById("saldoValor");
  if (!valor) return;

  valor.textContent = saldo.toLocaleString("es-UY");
  if (animar && caja) {
    caja.classList.remove("subiendo");
    void caja.offsetWidth; // reinicia la animación
    caja.classList.add("subiendo");
  }
}

export function conectarBotonSalir() {
  const boton = document.getElementById("btnSalir");
  if (!boton) return;
  boton.addEventListener("click", async () => {
    await signOut(auth);
    localStorage.removeItem("user");
    localStorage.removeItem("roomCode");
    window.location.href = "login.html";
  });
}

/** "2 h 15 min" a partir de milisegundos. */
export function formatearEspera(ms) {
  if (ms <= 0) return "disponible";
  const horas = Math.floor(ms / 3600000);
  const minutos = Math.ceil((ms % 3600000) / 60000);
  if (horas === 0) return `${minutos} min`;
  return `${horas} h ${String(minutos).padStart(2, "0")} min`;
}
