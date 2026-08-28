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

// Inicializar
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// 🔑 Crear el proveedor de Google
const googleProvider = new GoogleAuthProvider();

// ✅ Correo de soporte
const SUPPORT_EMAIL = "soporte.memorie.legends@gmail.com";

// ✅ EXPORTAR TODO (sin duplicar SUPPORT_EMAIL)
export {
  auth,
  db,
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
