/**
 * Firebase completo: la sesión, Firestore y las Cloud Functions.
 *
 * Lo importan las diez pantallas que hablan con el servidor. La superficie que
 * exporta es EXACTAMENTE la de antes de partir el archivo, así que ninguna de
 * ellas cambió: lo que se movió está en `firebase-nucleo.js`, y acá se
 * reexporta.
 *
 * Quien sólo necesite saber si hay sesión —hoy, la portada— importa el núcleo
 * directamente y se ahorra 107 KB de Firestore que no iba a usar.
 */

// La app y la sesión salen del núcleo. Se reexportan tal cual para que quien
// importe de acá siga encontrando todo donde estaba.
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
} from "./firebase-nucleo.js";

// Y `app` también hace falta acá adentro, para construir Firestore y Functions.
import { app } from "./firebase-nucleo.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  deleteDoc,
  serverTimestamp,
  increment,
  addDoc,
  runTransaction,
  orderBy,
  limit,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

const db = getFirestore(app);
// Las funciones viven en us-central1, que es la región por defecto.
const funciones = getFunctions(app);

/**
 * App Check, si está configurado.
 *
 * Vive en ESTE archivo y no en el núcleo, y eso es deliberado: App Check
 * protege las llamadas al servidor, y las llamadas al servidor son justamente
 * lo que este archivo agrega. Queda atado por construcción — no se puede
 * importar `getDoc` ni `httpsCallable` sin arrastrar también App Check.
 *
 * Es mejor que acordarse pantalla por pantalla: acá olvidarse es imposible.
 *
 * Va sin `await`: no tiene que retrasar la carga de nada, y el SDK sabe
 * esperar el token cuando le hace falta. Mientras no haya clave, o en un
 * dominio que no sea el de producción, es una función que devuelve `false` y
 * ya. Ver `app-check.js`.
 */
import("./app-check.js")
  .then((m) => m.encenderAppCheck())
  .catch((e) => console.error("No se pudo cargar app-check.js:", e));

export {
  db,
  funciones,
  httpsCallable,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  deleteDoc,
  serverTimestamp,
  increment,
  addDoc,
  runTransaction,
  orderBy,
  limit,
};
