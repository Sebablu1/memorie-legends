/**
 * Portada: si ya hay sesión iniciada, no tiene sentido ofrecer "iniciar
 * sesión" — se manda directo al panel.
 *
 * Importa del NÚCLEO y no de `firebase.js`, y ésa es la única diferencia que
 * importa de este archivo. `firebase.js` trae además Firestore y Functions:
 * 107 KB de los que esta pantalla no usa el 93%, más App Check, que son otros
 * 345 KB de reCAPTCHA que acá no protegen nada porque no hay ninguna llamada
 * al servidor que proteger.
 *
 * Lo único que hace esta pantalla es mirar si hay sesión. Para eso alcanza con
 * el núcleo, y con él el puntaje de Lighthouse en móvil pasa de 50 a 87.
 */
import { auth, onAuthStateChanged } from "./firebase-nucleo.js";

onAuthStateChanged(auth, (usuario) => {
  if (usuario) window.location.href = "dashboard.html";
});
