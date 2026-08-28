/**
 * Portada: si ya hay sesión iniciada, no tiene sentido ofrecer "iniciar
 * sesión" — se manda directo al panel.
 */
import { auth, onAuthStateChanged } from "./firebase.js";

onAuthStateChanged(auth, (usuario) => {
  if (usuario) window.location.href = "dashboard.html";
});
