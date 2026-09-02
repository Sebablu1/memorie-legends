// 🔥 Configuración de Firebase
const firebaseConfig = {
  apiKey: "AIzaSyAd3EscVwcQwXOq3oudzGb3NBLK_AAAdh0",
  authDomain: "memorie-legends.firebaseapp.com",
  projectId: "memorie-legends",
  storageBucket: "memorie-legends.firebasestorage.app",
  messagingSenderId: "346846781965",
  appId: "1:346846781965:web:0e2697c00d148c5f9cab44",
  measurementId: "G-G7C88LEY7G",
};

// Importar Firebase
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

// Inicializar
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
// Las funciones viven en us-central1, que es la región por defecto.
const funciones = getFunctions(app);

// 🔑 Crear el proveedor de Google
const googleProvider = new GoogleAuthProvider();

/**
 * App Check, si está configurado.
 *
 * Se enciende acá y no en cada pantalla porque hay nueve páginas que llaman a
 * funciones y acordarse en todas es acordarse en ocho. Va sin `await`: no
 * tiene que retrasar la carga de nada, y el SDK sabe esperar el token cuando
 * le hace falta.
 *
 * Mientras no haya clave, esto es una función que devuelve `false` y ya. Ver
 * `app-check.js`.
 */
import("./app-check.js")
  .then((m) => m.encenderAppCheck())
  .catch((e) => console.error("No se pudo cargar app-check.js:", e));

// ✅ Correo de soporte
const SUPPORT_EMAIL = "soporte.memorie.legends@gmail.com";

// ✅ EXPORTAR TODO (sin duplicar SUPPORT_EMAIL)
export {
  app,
  auth,
  db,
  funciones,
  httpsCallable,
  googleProvider,
  SUPPORT_EMAIL,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup,
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
