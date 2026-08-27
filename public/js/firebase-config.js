// 🔥 Configuración de Firebase para memorie-legends
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
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Inicializar Firebase
const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);

// Exportar todo
export {
  auth,
  db,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
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
};
