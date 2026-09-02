import {
  auth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  googleProvider,
  signInWithPopup,
  db,
  doc,
  getDoc,
  setDoc,
  SUPPORT_EMAIL,
} from "./firebase.js";

import {
  necesitaSegundoPaso,
  opcionesDeSegundoPaso,
  terminarConCodigo,
} from "./mfa.js";

// ==========================================================
// EL VELO DE CARGA
// ==========================================================
//
// La página arranca TAPADA. Ver la nota larga en el <style> de login.html:
// el resumen es que Firebase tarda en decir si hay sesión, y hasta entonces
// quien ya estaba adentro veía el formulario de login un instante.
//
// Acá sólo se decide cuándo destaparla. Hay exactamente tres motivos:
//
//   1. No hay sesión. Es el caso normal: el formulario es justo lo que hace
//      falta.
//   2. Firebase tardó demasiado. Un velo que no se va nunca es peor que un
//      flash: el flash molesta, esto deja a la persona afuera.
//   3. Algo falló al leer el perfil. Mismo motivo.
//
// Si hay sesión NO se destapa: se cambia el texto y se va al panel, así que
// el formulario no llega a verse nunca.

const velo = document.getElementById("veloCarga");
const veloTexto = document.getElementById("veloTexto");

/**
 * Cuánto se espera a que Firebase conteste antes de rendirse.
 *
 * Cinco segundos. Es mucho para una conexión sana —la respuesta suele venir de
 * IndexedDB, sin red— y poco para quedarse mirando una pantalla que no avanza.
 * El número importa poco; que EXISTA importa mucho.
 */
const MS_ESPERA_MAXIMA = 5000;

const mostrarVelo = (texto) => {
  if (!velo) return;
  if (veloTexto && texto) veloTexto.textContent = texto;
  velo.hidden = false;
};

const quitarVelo = () => {
  if (velo) velo.hidden = true;
};

/** El velo se cae solo si Firebase no contesta. Se cancela en cuanto contesta. */
const rendicion = setTimeout(() => {
  quitarVelo();
  avisar(
    "No pudimos comprobar tu sesión. Podés iniciarla abajo.",
    "warning",
  );
}, MS_ESPERA_MAXIMA);

// ==========================================================
// MENSAJES
// ==========================================================

const mensaje = document.getElementById("mensaje");

const avisar = (texto, clase = "info") => {
  if (!mensaje) return;
  // textContent y no innerHTML: acá entran mensajes de error de Firebase, que
  // llevan datos que no escribimos nosotros.
  mensaje.textContent = texto;
  mensaje.className = `mensaje ${clase}`;
};

/**
 * Qué decirle a la persona según lo que falló.
 *
 * El `error.message` de Firebase se deja como último recurso, no como primera
 * opción: dice cosas como "Firebase: Error (auth/invalid-credential)", que no
 * le sirve a nadie que no sea programador.
 */
function explicar(error) {
  const textos = {
    "auth/popup-closed-by-user": "Cerraste la ventana de Google. Probá de nuevo.",
    "auth/cancelled-popup-request": "Cerraste la ventana de Google. Probá de nuevo.",
    "auth/popup-blocked": "El navegador bloqueó la ventana. Permitile abrir ventanas a este sitio.",
    "auth/unauthorized-domain": `Dominio no autorizado. Escribinos a ${SUPPORT_EMAIL}`,
    "auth/network-request-failed": "No hay conexión. Revisá tu red y probá de nuevo.",
    "auth/too-many-requests": "Demasiados intentos. Esperá unos minutos.",
    "auth/invalid-email": "Ese correo no tiene un formato válido.",
    // Los tres de credenciales dicen LO MISMO a propósito. Distinguir "no
    // existe esa cuenta" de "la contraseña está mal" le confirma a cualquiera
    // qué correos están registrados, que es el primer paso para atacarlos.
    "auth/user-not-found": "Correo o contraseña incorrectos.",
    "auth/wrong-password": "Correo o contraseña incorrectos.",
    "auth/invalid-credential": "Correo o contraseña incorrectos.",
  };
  return textos[error?.code] ?? error?.message ?? "Algo salió mal. Probá de nuevo.";
}

// ==========================================================
// ESTADO DE LA SESIÓN
// ==========================================================

onAuthStateChanged(auth, async (usuario) => {
  clearTimeout(rendicion);

  if (!usuario) {
    localStorage.removeItem("user");
    quitarVelo();
    return;
  }

  try {
    const perfil = await getDoc(doc(db, "users", usuario.uid));
    let datos = perfil.data();

    if (!datos) {
      // Primera vez: la cuenta existe en Auth pero no tiene perfil. Pasa
      // siempre con Google, que no pasa por el formulario de registro.
      const correo = usuario.email || "usuario@email.com";
      const nombre = usuario.displayName || correo.split("@")[0] || "Usuario";

      await setDoc(doc(db, "users", usuario.uid), {
        username: nombre,
        email: correo,
        credits: 100,
        gamesPlayed: 0,
        wins: 0,
        createdAt: new Date().toISOString(),
        lastSpin: 0,
        provider: usuario.providerData?.[0]?.providerId ?? "password",
      });
      datos = { username: nombre };
    }

    // El saldo NO se guarda acá. localStorage lo edita cualquiera desde la
    // consola, así que guardarlo invita a tratarlo como cierto en algún
    // punto. Las Leyendas se leen siempre de Firestore, con sesion.js.
    localStorage.setItem(
      "user",
      JSON.stringify({
        id: usuario.uid,
        username: datos.username || usuario.displayName || "Usuario",
      }),
    );

    // Hoy sólo el login carga este archivo, así que la comprobación siempre
    // da true. Se deja igual: si mañana alguien lo suma a otra pantalla, sin
    // esto lo estaría sacando de ahí a la fuerza.
    const pagina = window.location.pathname;
    const esPuerta =
      /(^|\/)login\.html$/.test(pagina) ||
      pagina === "/" ||
      /(^|\/)index\.html$/.test(pagina);

    if (esPuerta) {
      // El velo se queda puesto hasta que el navegador cambie de página. Sin
      // esto se ve el formulario de login durante el viaje al panel, que es
      // exactamente el parpadeo que vinimos a sacar.
      mostrarVelo("Iniciando sesión…");
      window.location.replace("dashboard.html");
      return;
    }

    quitarVelo();
  } catch (error) {
    // Hay sesión pero no pudimos leer el perfil. Se destapa igual: dejar el
    // velo puesto sería encerrar a alguien que sí puede entrar.
    console.error("No se pudo leer el perfil:", error);
    quitarVelo();
    avisar("No pudimos cargar tu perfil. Probá recargar la página.", "error");
  }
});

// ==========================================================
// SEGUNDO PASO (verificación en dos pasos)
// ==========================================================
//
// Esto es lo más delicado del archivo. Quien tiene los dos pasos puestos y no
// puede terminar de entrar acá, se queda afuera de su cuenta CON SU SALDO
// ADENTRO. Así que:
//
//   - La resolución pendiente se guarda y NO se tira. Es un objeto que trae el
//     error del login y es lo único que permite terminar de entrar; perderlo
//     obliga a rehacer el login desde la contraseña.
//   - Un código mal escrito NO cancela nada: se avisa y se puede reintentar
//     con la misma resolución.
//   - Hay una salida ("Volver") que devuelve al formulario a propósito, para
//     quien no tenga el teléfono a mano y prefiera empezar de nuevo.

let resolucionPendiente = null;

const primerPaso = document.getElementById("primerPaso");
const segundoPaso = document.getElementById("segundoPaso");

function pedirSegundoPaso({ resolucion, metodos }) {
  resolucionPendiente = resolucion;
  if (primerPaso) primerPaso.hidden = true;
  if (segundoPaso) segundoPaso.hidden = false;

  const pista = document.getElementById("pistaSegundoPaso");
  if (pista && metodos[0]) {
    pista.textContent = `Escribí el código que muestra ${metodos[0].nombre}.`;
  }
  document.getElementById("codigoMfa")?.focus();
  avisar("Falta un paso: tu código de verificación.", "info");
}

function volverAlPrimerPaso() {
  resolucionPendiente = null;
  if (segundoPaso) segundoPaso.hidden = true;
  if (primerPaso) primerPaso.hidden = false;
  const campo = document.getElementById("codigoMfa");
  if (campo) campo.value = "";
  avisar("");
}

/**
 * Recibe el error del login y, si era "falta el segundo paso", abre esa
 * pantalla. Devuelve true si se ocupó del error.
 */
async function manejarSegundoPaso(error) {
  if (!necesitaSegundoPaso(error)) return false;
  try {
    pedirSegundoPaso(await opcionesDeSegundoPaso(error));
  } catch (fallo) {
    // Ni siquiera se pudo abrir el segundo paso. Se dice, en vez de dejar la
    // pantalla como si la contraseña hubiera estado mal.
    avisar(fallo?.message ?? "No pudimos pedirte el código. Probá de nuevo.", "error");
  }
  return true;
}

document.getElementById("btnVolverAlLogin")?.addEventListener("click", volverAlPrimerPaso);

document.getElementById("formSegundoPaso")?.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!resolucionPendiente) {
    volverAlPrimerPaso();
    return;
  }

  const campo = document.getElementById("codigoMfa");
  const boton = evento.target.querySelector('button[type="submit"]');
  if (boton) boton.disabled = true;
  avisar("Comprobando el código…", "info");

  try {
    await terminarConCodigo(resolucionPendiente, campo.value);
    // Entró. `onAuthStateChanged` se encarga del resto.
    mostrarVelo("Iniciando sesión…");
  } catch (error) {
    if (boton) boton.disabled = false;
    // La resolución NO se tira: el código pudo haber vencido —duran 30
    // segundos— y lo único que hace falta es escribir el siguiente.
    campo.value = "";
    campo.focus();
    avisar(error?.message ?? "Ese código no sirvió. Probá con el siguiente.", "error");
  }
});

// ==========================================================
// ENTRAR CON GOOGLE
// ==========================================================

const googleBtn = document.getElementById("googleBtn");

googleBtn?.addEventListener("click", async () => {
  avisar("Conectando con Google…", "info");
  googleBtn.disabled = true;

  try {
    await signInWithPopup(auth, googleProvider);
    // No se redirige acá: lo hace `onAuthStateChanged`, que es el único que
    // sabe si el perfil quedó creado. Redirigir en los dos lados llevaba al
    // panel antes de que existiera el documento del jugador.
    mostrarVelo("Iniciando sesión…");
  } catch (error) {
    googleBtn.disabled = false;
    if (await manejarSegundoPaso(error)) return;
    avisar(explicar(error), "error");
  }
});

// ==========================================================
// ENTRAR CON CORREO
// ==========================================================

const formulario = document.getElementById("loginForm");

formulario?.addEventListener("submit", async (evento) => {
  evento.preventDefault();

  const correo = document.getElementById("email").value.trim();
  const clave = document.getElementById("password").value;
  const boton = formulario.querySelector('button[type="submit"]');

  avisar("Iniciando sesión…", "info");
  if (boton) boton.disabled = true;

  try {
    await signInWithEmailAndPassword(auth, correo, clave);
    mostrarVelo("Iniciando sesión…");
  } catch (error) {
    if (boton) boton.disabled = false;
    if (await manejarSegundoPaso(error)) return;
    avisar(explicar(error), "error");
  }
});

// ==========================================================
// RESTABLECER LA CONTRASEÑA
// ==========================================================

document.getElementById("resetPasswordBtn")?.addEventListener("click", async () => {
  const correo = document.getElementById("email").value.trim();

  if (!correo) {
    avisar("Escribí tu correo arriba y volvé a tocar acá.", "warning");
    document.getElementById("email").focus();
    return;
  }

  avisar("Enviando el correo…", "info");

  try {
    await sendPasswordResetEmail(auth, correo);
    // Se dice lo mismo exista o no la cuenta. Contestar "no existe" convierte
    // este botón en una forma de averiguar qué correos están registrados.
    avisar(`Si hay una cuenta con ${correo}, te llega un correo en un minuto.`, "success");
  } catch (error) {
    if (error?.code === "auth/user-not-found") {
      avisar(`Si hay una cuenta con ${correo}, te llega un correo en un minuto.`, "success");
      return;
    }
    avisar(explicar(error), "error");
  }
});
