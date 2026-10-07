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

/**
 * La base `southamerica` y las funciones en São Paulo. Las dos a mano.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NINGUNA DE LAS DOS SE HEREDA DEL `firebaseConfig`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El proyecto no cambió: es el mismo `projectId` y la misma clave. Lo que
 * cambió es a qué base y a qué región se habla adentro de ese proyecto, y eso
 * no viaja en la configuración — se pide en cada `get*`.
 *
 * Por omisión, `getFirestore(app)` pide la base `(default)` y
 * `getFunctions(app)` pide `us-central1`. Las dos siguen existiendo: la base
 * vieja quedó con todos sus datos y las funciones de Iowa se borran al
 * desplegar. O sea que olvidarse de uno de estos dos argumentos no da error:
 * da una pantalla que lee datos que ya nadie juega, o llamadas a funciones que
 * no están. Están escritos a propósito, los dos.
 *
 * Verificado contra el build 10.7.1 que carga este archivo, no contra la
 * documentación: `getFirestore(e, t)` toma el nombre de la base como segundo
 * argumento y cae en `"(default)"` si falta, y `getFunctions(e, t)` toma la
 * región con `"us-central1"` por defecto.
 */
const db = getFirestore(app, "southamerica");
const funciones = getFunctions(app, "southamerica-east1");

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
 * Va sin `await`: no tiene que retrasar la carga de nada. Pero ojo con lo que
 * hace el SDK DESPUÉS de inicializarlo: espera el token antes de cada llamada,
 * y en un navegador donde reCAPTCHA no anda esa espera se come la partida.
 *
 * Hoy es una función que devuelve `false` y ya, porque el servidor no exige
 * el token y pedirlo era todo costo. También devuelve `false` sin clave, o en
 * un dominio que no sea el de producción. Ver `MANDAR_TOKEN` en
 * `app-check.js`.
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

/**
 * Despierta las funciones críticas apenas hay sesión.
 *
 * El cold start de Cloud Functions v2 es de ~1.9 s, y lo paga el primero
 * que toca una función dormida. Sin esto, ese primero es el que aprieta
 * "jugar", y la espera se siente como que la app se colgó.
 *
 * Con esto, el ping sale cuando el usuario ya está identificado, mientras
 * la app lee el perfil y arma el lobby. Cuando llega a la mesa, las tres
 * funciones están calientes.
 *
 * No bloquea, no rompe: los pings van sin `await` y con el error ignorado.
 * Si fallan, las funciones se despertarán en el primer uso real, como antes.
 * Esto es una optimización, no una dependencia.
 */
const FUNCIONES_CALIENTES = Object.freeze([
  "accionDePartida",
  "intentarDescarte",
  "latir",
]);

export function precalentarFunciones() {
  for (const nombre of FUNCIONES_CALIENTES) {
    httpsCallable(funciones, nombre)({}).catch(() => {});
  }
}
