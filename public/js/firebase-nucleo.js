/**
 * Lo mínimo de Firebase: la aplicación y la autenticación.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Antes había uno solo, `firebase.js`, que traía Auth, Firestore y Functions
 * juntos. Cualquier pantalla que quisiera saber si hay sesión se bajaba los
 * tres, y eso incluía la portada — que sólo mira si estás dentro para mandarte
 * al panel y no lee ni escribe nada.
 *
 * Medido: Firestore son 107 KB de los que la portada no usaba el 93%, y con
 * ellos y App Check afuera el puntaje de Lighthouse en móvil pasa de 81 a 87.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CÓMO SE REPARTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   firebase-nucleo.js  la app y la sesión. Nada que hable con el servidor.
 *   firebase.js         reexporta todo esto, y AGREGA Firestore y Functions.
 *
 * La superficie de `firebase.js` quedó idéntica a como estaba, a propósito:
 * las diez pantallas que lo importan no cambiaron ni una línea. El corte se
 * nota sólo desde acá.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DÓNDE QUEDÓ APP CHECK, Y POR QUÉ IMPORTA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * En `firebase.js`, no acá. App Check protege las llamadas al servidor, y las
 * llamadas al servidor viven allá. Así queda atado por construcción: no se
 * puede importar `getDoc` ni `httpsCallable` sin arrastrar también App Check.
 *
 * Es mejor que una lista de páginas, que hay que acordarse de actualizar.
 * Acá olvidarse es imposible: son el mismo archivo.
 */

const firebaseConfig = {
  apiKey: "AIzaSyAd3EscVwcQwXOq3oudzGb3NBLK_AAAdh0",
  authDomain: "memorie-legends.firebaseapp.com",
  projectId: "memorie-legends",
  storageBucket: "memorie-legends.firebasestorage.app",
  messagingSenderId: "346846781965",
  appId: "1:346846781965:web:0e2697c00d148c5f9cab44",
  measurementId: "G-G7C88LEY7G",
};

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const googleProvider = new GoogleAuthProvider();

const SUPPORT_EMAIL = "soporte.memorie.legends@gmail.com";

export {
  app,
  auth,
  googleProvider,
  SUPPORT_EMAIL,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup,
};
