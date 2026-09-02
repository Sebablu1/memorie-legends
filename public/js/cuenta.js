/**
 * La pantalla de la cuenta: activar y quitar la verificación en dos pasos.
 *
 * Todo lo que hace de verdad está en `mfa.js`. Acá sólo se decide qué se
 * muestra en cada momento, que son cuatro estados y conviene tenerlos claros:
 *
 *   CORREO SIN VERIFICAR  No se puede activar nada. Firebase no lo permite, y
 *                         tiene razón: si el correo no está verificado, quien
 *                         recupere la contraseña por correo no es
 *                         necesariamente el dueño.
 *   SIN ACTIVAR           Un botón para empezar.
 *   CONFIRMANDO           Se muestra la clave y se pide el código. Hasta que
 *                         no llega un código válido, la cuenta sigue igual.
 *   ACTIVO                La lista de aplicaciones registradas, con la opción
 *                         de quitarlas.
 */

import { auth } from "./firebase.js";
import { exigirSesion, mostrarSaldo, conectarBotonSalir } from "./sesion.js";
import {
  estadoMfa,
  verificarCorreo,
  empezarInscripcion,
  confirmarInscripcion,
  quitarFactor,
} from "./mfa.js";

const $ = (id) => document.getElementById(id);

const avisar = (texto, clase = "info") => {
  $("avisoMfa").textContent = texto;
  $("avisoMfa").className = `mensaje ${texto ? clase : ""}`;
};

/**
 * El secreto en curso, entre "activar" y "confirmar".
 *
 * Vive acá, en memoria, y no se guarda en ningún lado. Ponerlo en
 * `localStorage` para sobrevivir una recarga sería dejar el segundo factor al
 * alcance de cualquiera que abra la consola —justo lo contrario de lo que se
 * está construyendo—. Si alguien recarga a mitad de camino, empieza de nuevo:
 * cuesta diez segundos.
 */
let enCurso = null;

const mostrar = (id, si) => { $(id).hidden = !si; };

// ------------------------------------------------------------ pintar

async function refrescar() {
  const estado = await estadoMfa();

  mostrar("faltaVerificar", !estado.correoVerificado);
  mostrar("pasoActivar", estado.correoVerificado && !estado.activo && !enCurso);
  mostrar("pasoConfirmar", Boolean(enCurso));
  mostrar("estadoMfa", estado.activo && !enCurso);

  if (!estado.activo) return;

  $("listaFactores").replaceChildren(
    ...estado.factores.map((factor) => {
      const fila = document.createElement("div");
      fila.className = "factor-puesto";

      const nombre = document.createElement("b");
      // textContent: el nombre lo escribió el propio jugador al inscribirse.
      nombre.textContent = factor.nombre;

      const desde = document.createElement("small");
      desde.textContent = factor.desde
        ? `activo desde el ${new Date(factor.desde).toLocaleDateString("es-AR")}`
        : "activo";

      const quitar = document.createElement("button");
      quitar.type = "button";
      quitar.className = "accion sobria";
      quitar.textContent = "Quitar";
      quitar.addEventListener("click", () => sacar(factor, quitar));

      fila.append(nombre, desde, quitar);
      return fila;
    }),
  );
}

// ------------------------------------------------------------ acciones

$("btnVerificarCorreo").addEventListener("click", async (evento) => {
  const boton = evento.currentTarget;
  boton.disabled = true;
  try {
    await verificarCorreo();
    avisar("Te mandamos un correo. Abrilo, y después volvé y recargá esta página.", "success");
  } catch (error) {
    boton.disabled = false;
    avisar(error.message, "error");
  }
});

$("btnActivarMfa").addEventListener("click", async (evento) => {
  const boton = evento.currentTarget;
  boton.disabled = true;
  avisar("Preparando…", "info");

  try {
    enCurso = await empezarInscripcion();
    $("claveSecreta").textContent = enCurso.clave;
    $("enlaceOtp").href = enCurso.uri;
    avisar("");
    await refrescar();
    $("codigoConfirmar").focus();
  } catch (error) {
    avisar(error.message, "error");
  } finally {
    boton.disabled = false;
  }
});

$("btnCopiarClave").addEventListener("click", async (evento) => {
  const boton = evento.currentTarget;
  try {
    await navigator.clipboard.writeText(enCurso?.clave ?? "");
    boton.textContent = "Copiada";
    setTimeout(() => { boton.textContent = "Copiar la clave"; }, 1800);
  } catch {
    // El portapapeles se puede negar (permisos, contexto inseguro). No es un
    // error que valga la pena reportar: la clave está a la vista y se puede
    // seleccionar a mano.
    boton.textContent = "Copiala a mano";
  }
});

$("btnCancelarMfa").addEventListener("click", async () => {
  // No hay nada que deshacer: sin código confirmado, la cuenta nunca llegó a
  // cambiar. El secreto se tira y ya.
  enCurso = null;
  $("codigoConfirmar").value = "";
  avisar("");
  await refrescar();
});

$("formConfirmarMfa").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const boton = evento.target.querySelector('button[type="submit"]');
  boton.disabled = true;
  avisar("Comprobando…", "info");

  try {
    await confirmarInscripcion(enCurso.secreto, $("codigoConfirmar").value);
    enCurso = null;
    $("codigoConfirmar").value = "";
    avisar(
      "Listo. La próxima vez que entres te vamos a pedir el código.",
      "success",
    );
    await refrescar();
  } catch (error) {
    // El secreto NO se tira: los códigos duran 30 segundos y lo más probable
    // es que se haya vencido mientras lo escribía.
    $("codigoConfirmar").value = "";
    $("codigoConfirmar").focus();
    avisar(error.message, "error");
  } finally {
    boton.disabled = false;
  }
});

async function sacar(factor, boton) {
  // Sí se pregunta, al revés que en las acciones inocuas: esto baja la
  // protección de una cuenta con dinero, y se hace de un solo clic.
  const seguro = window.confirm(
    `¿Quitar "${factor.nombre}"? Vas a volver a entrar sólo con tu contraseña.`,
  );
  if (!seguro) return;

  boton.disabled = true;
  try {
    await quitarFactor(factor.uid);
    avisar("Quitado. Ahora entrás sólo con tu contraseña.", "info");
    await refrescar();
  } catch (error) {
    boton.disabled = false;
    avisar(error.message, "error");
  }
}

// ------------------------------------------------------------ arranque

const sesion = await exigirSesion();
if (sesion) {
  mostrarSaldo(sesion.perfil.saldo);
  conectarBotonSalir();

  // `currentUser` puede traer datos viejos: si alguien acaba de verificar el
  // correo en otra pestaña, acá seguiría figurando sin verificar. Recargarlo
  // cuesta un viaje y evita mandar a verificar a quien ya lo hizo.
  await auth.currentUser?.reload().catch(() => {});
  await refrescar();
}
