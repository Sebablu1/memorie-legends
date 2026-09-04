/**
 * Panel de administración.
 *
 * Acá NO se decide nada. Este archivo muestra lo que el servidor manda y pide
 * lo que el administrador toca; quién puede hacer qué se comprueba en las
 * Cloud Functions, contra el correo verificado del token.
 *
 * Que el correo se mire también acá es sólo para no dibujar una pantalla que
 * no va a funcionar. Cambiarlo en el navegador no habilita nada: las tres
 * funciones lo vuelven a comprobar y rechazan.
 *
 * Y no lee `partidas`: ese documento tiene las manos de los cuatro y el orden
 * del mazo, y las reglas lo niegan a todo el mundo. Lo que llega es un resumen
 * que arma el servidor y no lleva ni una carta.
 */

import {
  auth,
  funciones,
  httpsCallable,
  SUPPORT_EMAIL,
  signInWithEmailAndPassword,
  signInWithPopup,
  googleProvider,
  onAuthStateChanged,
  signOut,
} from "../js/firebase.js";

import {
  necesitaSegundoPaso,
  opcionesDeSegundoPaso,
  terminarConCodigo,
} from "../js/mfa.js";

const $ = (id) => document.getElementById(id);

const dom = {
  quien: $("quien"),
  btnSalir: $("btnSalir"),
  entrar: $("entrar"),
  formEntrar: $("formEntrar"),
  btnGoogle: $("btnGoogle"),
  segundoPaso: $("segundoPaso"),
  formSegundoPaso: $("formSegundoPaso"),
  codigoMfa: $("codigoMfa"),
  avisoSegundoPaso: $("avisoSegundoPaso"),
  pistaSegundoPaso: $("pistaSegundoPaso"),
  btnVolverAdmin: $("btnVolverAdmin"),
  correo: $("correo"),
  clave: $("clave"),
  avisoEntrar: $("avisoEntrar"),
  panel: $("panel"),
  totalSalas: $("totalSalas"),
  totalPartidas: $("totalPartidas"),
  totalRetenido: $("totalRetenido"),
  btnRefrescar: $("btnRefrescar"),
  btnCancelarTodas: $("btnCancelarTodas"),
  aviso: $("aviso"),
  salas: $("salas"),
  btnRevisarNombres: $("btnRevisarNombres"),
  avisoNombres: $("avisoNombres"),
  listaNombres: $("listaNombres"),
  btnListarUsuarios: $("btnListarUsuarios"),
  avisoUsuarios: $("avisoUsuarios"),
  listaUsuarios: $("listaUsuarios"),
  partidas: $("partidas"),
  btnVerReportes: $("btnVerReportes"),
  filtroReportes: $("filtroReportes"),
  avisoReportes: $("avisoReportes"),
  listaReportes: $("listaReportes"),
  correoAdmin: $("correoAdmin"),
  btnAgregarAdmin: $("btnAgregarAdmin"),
  btnVerAdmins: $("btnVerAdmins"),
  avisoAdmins: $("avisoAdmins"),
  listaAdmins: $("listaAdmins"),
};

const listar = httpsCallable(funciones, "listarSalasAdmin");
const cancelar = httpsCallable(funciones, "cancelarSalaAdmin");
const cancelarTodas = httpsCallable(funciones, "cancelarSalasEnEsperaAdmin");
const revisarNombres = httpsCallable(funciones, "revisarNombresAdmin");
const listarUsuarios = httpsCallable(funciones, "listarUsuariosAdmin");
const eliminarUsuario = httpsCallable(funciones, "eliminarUsuarioAdmin");
const listarReportes = httpsCallable(funciones, "listarReportesAdmin");
const resolverReporte = httpsCallable(funciones, "resolverReporteAdmin");
const listarAdmins = httpsCallable(funciones, "listarAdministradores");
const agregarAdmin = httpsCallable(funciones, "agregarAdministrador");
const quitarAdmin = httpsCallable(funciones, "quitarAdministrador");

const decir = (donde, texto, clase = "") => {
  donde.textContent = texto;
  donde.className = `aviso ${clase}`;
};

/** Escapa lo que venga de la base: los nombres los eligen los jugadores. */
const limpio = (t) =>
  String(t ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const fecha = (ms) =>
  ms ? new Date(ms).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "—";

// ------------------------------------------------------------- sesión

/**
 * Entrar con Google.
 *
 * Es el camino que corresponde: la cuenta de soporte tiene `google.com` como
 * único proveedor, comprobado contra Firebase Auth. Con el formulario de
 * correo y contraseña esa cuenta no puede entrar, y el error que devuelve
 * Firebase —"credenciales inválidas"— hace pensar que está mal la contraseña
 * cuando lo que está mal es el método.
 *
 * Entrar no da acceso a nada por sí solo: quién puede ver el panel lo decide
 * `onAuthStateChanged` más abajo, y qué datos se entregan lo deciden las Cloud
 * Functions contra el correo del token. Esto sólo abre la sesión.
 */
dom.btnGoogle.addEventListener("click", async () => {
  dom.btnGoogle.disabled = true;
  decir(dom.avisoEntrar, "Abriendo Google…");
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    dom.btnGoogle.disabled = false;
    if (await manejarSegundoPaso(error)) return;
    const cerrada = /popup-closed|cancelled-popup/.test(error?.code ?? "");
    decir(dom.avisoEntrar,
      cerrada ? "Cerraste la ventana de Google." : "No pudimos entrar con Google.",
      "mal");
    console.error(error);
  }
});

dom.formEntrar.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  decir(dom.avisoEntrar, "Entrando…");
  try {
    await signInWithEmailAndPassword(auth, dom.correo.value.trim(), dom.clave.value);
    dom.clave.value = "";
  } catch (error) {
    if (await manejarSegundoPaso(error)) return;
    // Sin detallar si falló el correo o la contraseña.
    decir(dom.avisoEntrar, "No pudimos entrar con esos datos.", "mal");
    console.error(error);
  }
});

dom.btnSalir.addEventListener("click", () => signOut(auth));

// --------------------------------------------- segundo paso

/**
 * La resolución pendiente del segundo factor.
 *
 * Es el objeto que trae el error del login, y es lo ÚNICO que permite terminar
 * de entrar. Si se pierde, hay que rehacer el login desde el principio. Por
 * eso no se tira cuando el código está mal: se avisa y se reintenta con la
 * misma resolución.
 */
let resolucionPendiente = null;

function pedirSegundoPaso({ resolucion, metodos }) {
  resolucionPendiente = resolucion;
  dom.entrar.hidden = true;
  dom.segundoPaso.hidden = false;
  if (metodos[0]) {
    dom.pistaSegundoPaso.textContent = `Escribí el código que muestra ${metodos[0].nombre}.`;
  }
  decir(dom.avisoSegundoPaso, "");
  dom.codigoMfa.focus();
}

function volverAEntrar() {
  resolucionPendiente = null;
  dom.segundoPaso.hidden = true;
  dom.entrar.hidden = false;
  dom.codigoMfa.value = "";
  dom.btnGoogle.disabled = false;
  decir(dom.avisoEntrar, "");
}

/**
 * Si el error era "falta el segundo paso", abre esa pantalla.
 *
 * `auth/multi-factor-auth-required` NO es un fallo: la contraseña —o la cuenta
 * de Google— ya se aceptó y falta el código. Tratarlo como error, que es lo
 * que hacía antes esta pantalla, deja al administrador leyendo "no pudimos
 * entrar" sin ninguna pista de qué le falta.
 */
async function manejarSegundoPaso(error) {
  if (!necesitaSegundoPaso(error)) return false;
  try {
    pedirSegundoPaso(await opcionesDeSegundoPaso(error));
  } catch (fallo) {
    decir(dom.avisoEntrar, fallo?.message ?? "No pudimos pedirte el código.", "mal");
  }
  return true;
}

dom.btnVolverAdmin.addEventListener("click", volverAEntrar);

dom.formSegundoPaso.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!resolucionPendiente) return volverAEntrar();

  const boton = dom.formSegundoPaso.querySelector('button[type="submit"]');
  boton.disabled = true;
  decir(dom.avisoSegundoPaso, "Comprobando…");

  try {
    await terminarConCodigo(resolucionPendiente, dom.codigoMfa.value);
    // Entró. `onAuthStateChanged` se ocupa del resto.
  } catch (error) {
    boton.disabled = false;
    // La resolución NO se tira: los códigos duran 30 segundos y lo más
    // probable es que se haya vencido mientras lo escribía.
    dom.codigoMfa.value = "";
    dom.codigoMfa.focus();
    decir(dom.avisoSegundoPaso, error?.message ?? "Ese código no sirvió.", "mal");
  }
});

// ------------------------------------------------------------- sesión

onAuthStateChanged(auth, (usuario) => {
  const correo = (usuario?.email ?? "").toLowerCase();
  const esAdmin = correo === SUPPORT_EMAIL.toLowerCase();

  dom.quien.textContent = usuario ? usuario.email : "Sin sesión";
  dom.btnSalir.hidden = !usuario;
  dom.entrar.hidden = Boolean(esAdmin);
  dom.panel.hidden = !esAdmin;

  // Con sesión resuelta, la pantalla del código ya no va: o entró, o hay que
  // volver a empezar. Dejarla puesta muestra dos formularios a la vez.
  if (usuario) {
    dom.segundoPaso.hidden = true;
    resolucionPendiente = null;
  }

  // El botón se rehabilita siempre que la pantalla de entrada esté a la vista:
  // si entró alguien que no era, tiene que poder salir y probar con la cuenta
  // correcta sin recargar.
  dom.btnGoogle.disabled = Boolean(esAdmin);

  if (usuario && !esAdmin) {
    decir(dom.avisoEntrar, "Esta sección no es para esta cuenta.", "mal");
    return;
  }
  if (esAdmin) refrescar();
});

// ------------------------------------------------------------- pintar

function filaDeSala(s) {
  const div = document.createElement("div");
  div.className = "fila";
  div.innerHTML = `
    <span class="codigo">${limpio(s.codigo)}</span>
    <span class="etiqueta ${limpio(s.estado)}">${limpio(s.estado)}</span>
    <span class="campo"><b>${s.cuantos}</b>/${s.maxJugadores} · ${
      s.jugadores.length ? s.jugadores.map(limpio).join(", ") : "sin nadie"
    }</span>
    <span class="campo">entrada <b>${s.entrada}</b></span>
    <span class="campo">retiene <b>${s.leyendasRetenidas}</b></span>
    <span class="campo">${limpio(fecha(s.creada))}</span>`;

  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "btn peligro chico";
  if (s.cancelable) {
    boton.textContent = "Cancelar y devolver";
    boton.addEventListener("click", () => cancelarUna(s, boton));
  } else {
    boton.textContent = "En juego";
    boton.disabled = true;
    boton.title = "Sus Leyendas están en juego. Para salir, cada jugador abandona.";
  }
  div.appendChild(boton);
  return div;
}

function filaDePartida(p) {
  const div = document.createElement("div");
  div.className = "fila";
  div.innerHTML = `
    <span class="codigo">${limpio(p.codigo)}</span>
    <span class="campo">fase <b>${limpio(p.fase)}</b></span>
    <span class="campo">ronda <b>${p.ronda ?? "—"}</b></span>
    <span class="campo"><b>${p.jugadores}</b> jugando${
      p.abandonaron ? ` · ${p.abandonaron} abandonaron` : ""
    }</span>
    <span class="campo">${limpio(fecha(p.actualizada))}</span>`;
  return div;
}

function pintar(datos) {
  dom.totalSalas.textContent = datos.totales.salas;
  dom.totalPartidas.textContent = datos.totales.partidas;
  dom.totalRetenido.textContent = datos.totales.leyendasRetenidas;

  dom.salas.replaceChildren();
  if (!datos.salas.length) {
    dom.salas.innerHTML = '<p class="vacio">No hay salas vivas.</p>';
  } else {
    datos.salas.forEach((s) => dom.salas.appendChild(filaDeSala(s)));
  }

  dom.partidas.replaceChildren();
  if (!datos.partidas.length) {
    dom.partidas.innerHTML = '<p class="vacio">Ninguna partida en curso.</p>';
  } else {
    datos.partidas.forEach((p) => dom.partidas.appendChild(filaDePartida(p)));
  }

  const enEspera = datos.salas.filter((s) => s.cancelable).length;
  dom.btnCancelarTodas.disabled = enEspera === 0;
  dom.btnCancelarTodas.textContent = enEspera
    ? `Cancelar las ${enEspera} que esperan`
    : "Ninguna esperando";
}

// ------------------------------------------------------------ acciones

async function refrescar() {
  dom.btnRefrescar.disabled = true;
  decir(dom.aviso, "Cargando…");
  try {
    const { data } = await listar();
    pintar(data);
    decir(dom.aviso, "");
  } catch (error) {
    decir(dom.aviso, error?.message ?? "No pudimos cargar las salas.", "mal");
    console.error(error);
  } finally {
    dom.btnRefrescar.disabled = false;
  }
}

async function cancelarUna(sala, boton) {
  const cuantos = sala.cuantos;
  const aviso = cuantos
    ? `Cancelar ${sala.codigo} y devolver ${sala.leyendasRetenidas} Leyendas a ${cuantos} jugador(es)?`
    : `Cancelar ${sala.codigo}? No hay nadie adentro.`;
  if (!confirm(aviso)) return;

  boton.disabled = true;
  decir(dom.aviso, `Cancelando ${sala.codigo}…`);
  try {
    const { data } = await cancelar({ codigo: sala.codigo });
    decir(
      dom.aviso,
      data.yaEstaba
        ? `${data.codigo} ya estaba cancelada.`
        : `${data.codigo} cancelada. Devueltas ${data.devueltas} Leyendas a ${data.jugadores.length} jugador(es).`,
      "bien",
    );
    await refrescar();
  } catch (error) {
    decir(dom.aviso, error?.message ?? "No se pudo cancelar.", "mal");
    console.error(error);
    boton.disabled = false;
  }
}

dom.btnRefrescar.addEventListener("click", refrescar);

dom.btnCancelarTodas.addEventListener("click", async () => {
  // Dos confirmaciones: la primera dice cuánto se mueve, la segunda pide
  // escribirlo. Es dinero de jugadores y no se toca por un clic de más.
  const { data: antes } = await listar();
  const enEspera = antes.salas.filter((s) => s.cancelable);
  if (!enEspera.length) return;

  const total = enEspera.reduce((s, x) => s + x.leyendasRetenidas, 0);
  if (!confirm(`Cancelar ${enEspera.length} salas y devolver ${total} Leyendas?`)) return;
  if (prompt('Escribí CANCELAR para confirmar') !== "CANCELAR") {
    decir(dom.aviso, "Cancelado. No se tocó nada.");
    return;
  }

  dom.btnCancelarTodas.disabled = true;
  decir(dom.aviso, "Cancelando…");
  try {
    const { data } = await cancelarTodas();
    const fallos = data.fallidas.length
      ? ` ${data.fallidas.length} fallaron: ${data.fallidas.map((f) => f.codigo).join(", ")}.`
      : "";
    decir(
      dom.aviso,
      `${data.canceladas} canceladas, ${data.devueltasEnTotal} Leyendas devueltas.${fallos}`,
      data.fallidas.length ? "mal" : "bien",
    );
    if (data.fallidas.length) console.warn("Fallaron:", data.fallidas);
    await refrescar();
  } catch (error) {
    decir(dom.aviso, error?.message ?? "No se pudo cancelar.", "mal");
    console.error(error);
    dom.btnCancelarTodas.disabled = false;
  }
});

// ------------------------------------------------ nombres guardados

/**
 * Lista los nombres que podrían hacer daño si se dibujaran sin escapar.
 *
 * El servidor devuelve el nombre TAL CUAL está guardado, a propósito: quien
 * revisa esto necesita ver exactamente qué se guardó, no una versión limpia.
 * Acá se escapa al pintarlo, que es donde corresponde —y es justamente el
 * arreglo que hizo falta en el juego—.
 */
dom.btnRevisarNombres.addEventListener("click", async () => {
  dom.btnRevisarNombres.disabled = true;
  decir(dom.avisoNombres, "Revisando…");
  dom.listaNombres.replaceChildren();

  try {
    const { data } = await revisarNombres();

    if (!data.sospechosos.length) {
      decir(dom.avisoNombres, `${data.revisados} perfiles revisados: ninguno con caracteres peligrosos.`, "bien");
      return;
    }

    decir(
      dom.avisoNombres,
      `${data.revisados} revisados · ${data.sospechosos.length} con caracteres raros, ` +
        `de los cuales ${data.ataques} parecen un intento deliberado.`,
      data.ataques ? "mal" : "",
    );

    for (const s of data.sospechosos) {
      const fila = document.createElement("div");
      fila.className = "fila";
      fila.innerHTML = `
        <span class="etiqueta ${s.pareceAtaque ? "jugando" : "esperando"}">${s.pareceAtaque ? "ataque" : "raro"}</span>
        <span class="campo"><code>${limpio(s.nombre)}</code></span>
        <span class="campo">uid <b>${limpio(s.uid)}</b></span>`;
      dom.listaNombres.appendChild(fila);
    }
  } catch (error) {
    decir(dom.avisoNombres, error?.message ?? "No pudimos revisar los nombres.", "mal");
    console.error(error);
  } finally {
    dom.btnRevisarNombres.disabled = false;
  }
});

// ------------------------------------------------------ cuentas

/**
 * Una fila de cuenta, con lo que hace falta para decidir sobre ella.
 *
 * Construida con DOM y no con innerHTML: el nombre lo eligió el jugador. Es la
 * misma vía por la que un nombre podía ejecutar código en la mesa de los demás.
 */
function filaDeUsuario(cuenta) {
  const fila = document.createElement("div");
  fila.className = "fila";

  const etiqueta = document.createElement("span");
  etiqueta.className = `etiqueta ${cuenta.desactivado ? "alerta" : cuenta.vacia ? "esperando" : "jugando"}`;
  etiqueta.textContent = cuenta.desactivado ? "desactivada" : cuenta.vacia ? "vacía" : "con datos";

  const campo = (texto, clase = "campo") => {
    const el = document.createElement("span");
    el.className = clase;
    el.textContent = texto;
    return el;
  };

  fila.append(
    etiqueta,
    campo(cuenta.nombre || "(sin nombre)", "campo"),
    campo(`${cuenta.saldo} Leyendas`),
    campo(`${cuenta.partidas} partidas · ${cuenta.victorias} victorias`),
    campo(cuenta.uid),
  );

  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "btn peligro chico";

  if (cuenta.desactivado) {
    boton.textContent = "Ya desactivada";
    boton.disabled = true;
  } else {
    // El texto dice lo que VA A PASAR, no "eliminar" para las dos cosas: con
    // saldo o partidas no se borra nada, se desactiva.
    boton.textContent = cuenta.vacia ? "🗑️ Borrar" : "Desactivar";
    boton.addEventListener("click", () => darDeBaja(cuenta, boton));
  }

  fila.appendChild(boton);
  return fila;
}

async function verCuentas() {
  dom.btnListarUsuarios.disabled = true;
  decir(dom.avisoUsuarios, "Cargando…");
  try {
    const { data } = await listarUsuarios();
    dom.listaUsuarios.replaceChildren(...data.cuentas.map(filaDeUsuario));
    decir(
      dom.avisoUsuarios,
      `${data.total} cuenta(s) · ${data.vacias} sin saldo ni partidas.`,
      "bien",
    );
  } catch (error) {
    decir(dom.avisoUsuarios, error?.message ?? "No pudimos cargar las cuentas.", "mal");
    console.error(error);
  } finally {
    dom.btnListarUsuarios.disabled = false;
  }
}

/**
 * Da de baja una cuenta, avisando ANTES qué va a pasar exactamente.
 *
 * El texto de la confirmación cambia según el caso. Un "¿seguro?" genérico
 * enseña a apretar Aceptar sin leer, y esto borra la cuenta de una persona.
 */
async function darDeBaja(cuenta, boton) {
  const nombre = cuenta.nombre || cuenta.uid;
  const aviso = cuenta.vacia
    ? `Borrar la cuenta de "${nombre}"?

No tiene saldo ni partidas, así que se borra del todo. No se puede deshacer.`
    : `"${nombre}" tiene ${cuenta.saldo} Leyendas y ${cuenta.partidas} partidas.

` +
      `NO se va a borrar: se desactiva y queda fuera del juego, conservando el historial. ¿Seguir?`;

  if (!confirm(aviso)) return;

  boton.disabled = true;
  decir(dom.avisoUsuarios, "Aplicando…");
  try {
    const { data } = await eliminarUsuario({ uid: cuenta.uid });
    const que = {
      eliminado: "borrada",
      desactivado: "desactivada",
      no_existia: "ya no estaba",
    }[data.hizo] ?? data.hizo;
    decir(dom.avisoUsuarios, `Cuenta ${que}.`, "bien");
    // La lista se rehace sola: recargar la página a mano es la clase de paso
    // que se olvida y deja mirando datos viejos.
    await verCuentas();
  } catch (error) {
    decir(dom.avisoUsuarios, error?.message ?? "No se pudo dar de baja.", "mal");
    console.error(error);
    boton.disabled = false;
  }
}

dom.btnListarUsuarios.addEventListener("click", verCuentas);

// ------------------------------------------------------------ reportes

/**
 * Lo que denuncian los jugadores.
 *
 * Todo se dibuja con `createElement` y `textContent`, nunca con `innerHTML`.
 * Acá entra texto escrito por dos desconocidos —el nombre de quien reporta y
 * el comentario que escribió— y el comentario es texto libre de hasta 500
 * caracteres. Es el sitio del panel donde más fácil sería colar HTML.
 */

const MOTIVOS_VISIBLES = {
  trampa: "Hizo trampa",
  insultos: "Insultos o malos tratos",
  abandono: "Abandonó o demoró",
  nombre: "Nombre ofensivo",
  otro: "Otra cosa",
};

function filaDeReporte(reporte) {
  const fila = document.createElement("div");
  fila.className = "fila";

  const campo = (texto, clase = "campo") => {
    const el = document.createElement("span");
    el.className = clase;
    el.textContent = texto;
    return el;
  };

  const etiqueta = document.createElement("span");
  const clases = { pendiente: "alerta", resuelto: "jugando", ignorado: "esperando" };
  etiqueta.className = `etiqueta ${clases[reporte.estado] ?? "esperando"}`;
  etiqueta.textContent = reporte.estado;

  // "(cuenta dada de baja)" y "(sin nombre)" son cosas distintas: la primera
  // significa que el uid ya no existe en `users`, y eso cambia qué se puede
  // hacer con el reporte.
  const quien = (persona) =>
    persona.nombre === null
      ? "(cuenta dada de baja)"
      : persona.nombre || "(sin nombre)";

  fila.append(
    etiqueta,
    campo(`${quien(reporte.denunciado)} ← ${quien(reporte.denunciante)}`, "campo"),
    campo(MOTIVOS_VISIBLES[reporte.motivo] ?? reporte.motivo),
    campo(fecha(reporte.creado)),
  );

  if (reporte.sala) fila.append(campo(`sala ${reporte.sala}`));
  if (reporte.comentario) fila.append(campo(`"${reporte.comentario}"`, "campo comentario"));

  // El uid del denunciado, para poder buscarlo en la sección de cuentas. El
  // del denunciante NO se muestra: quien reporta tiene que poder hacerlo sin
  // quedar expuesto, incluso acá adentro, salvo que haga falta.
  fila.append(campo(reporte.denunciado.uid, "campo tenue"));

  if (reporte.estado === "pendiente") {
    for (const [estado, texto, clase] of [
      ["resuelto", "Resuelto", "btn chico"],
      ["ignorado", "Ignorar", "btn sobrio chico"],
    ]) {
      const boton = document.createElement("button");
      boton.type = "button";
      boton.className = clase;
      boton.textContent = texto;
      boton.addEventListener("click", () => marcar(reporte, estado, fila));
      fila.append(boton);
    }
  }

  return fila;
}

async function verReportes() {
  dom.btnVerReportes.disabled = true;
  decir(dom.avisoReportes, "Cargando…");
  try {
    const { data } = await listarReportes({ estado: dom.filtroReportes.value || undefined });
    dom.listaReportes.replaceChildren(...data.reportes.map(filaDeReporte));
    decir(
      dom.avisoReportes,
      data.total === 0
        ? "No hay reportes con ese filtro."
        : `${data.total} reporte(s) · ${data.pendientes} sin revisar`,
      data.pendientes > 0 ? "alerta" : "bien",
    );
  } catch (error) {
    decir(dom.avisoReportes, error?.message ?? "No pudimos leer los reportes.", "mal");
    console.error(error);
  } finally {
    dom.btnVerReportes.disabled = false;
  }
}

/**
 * Marca un reporte como visto.
 *
 * No pide confirmación a propósito, al revés que dar de baja una cuenta: esto
 * no le hace nada a nadie y es reversible desde el filtro "Todos". Pedir
 * confirmación para lo inocuo entrena a confirmar sin leer, y entonces la
 * confirmación que sí importa tampoco se lee.
 */
async function marcar(reporte, estado, fila) {
  fila.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    await resolverReporte({ id: reporte.id, estado });
    await verReportes();
  } catch (error) {
    fila.querySelectorAll("button").forEach((b) => (b.disabled = false));
    decir(dom.avisoReportes, error?.message ?? "No pudimos guardarlo.", "mal");
  }
}

dom.btnVerReportes.addEventListener("click", verReportes);
dom.filtroReportes.addEventListener("change", verReportes);


// ------------------------------------------------------ administradores

/**
 * Quiénes pueden entrar acá.
 *
 * Todo se dibuja con `createElement` y `textContent`. Acá entran correos que
 * escribió una persona a mano en un campo de texto: es exactamente el tipo de
 * dato que no se pega con `innerHTML`.
 *
 * Las tres reglas —no quitar al raíz, no quitarse a uno mismo, dejar constancia
 * de quién hizo qué— las aplica el SERVIDOR, en `administradores.js`. Lo de acá
 * es sólo no ofrecer botones que van a fallar: apagarlos en la pantalla no
 * protege nada, pero un botón que siempre da error es peor que no tenerlo.
 */
function filaDeAdmin(admin) {
  const fila = document.createElement("div");
  fila.className = "fila";

  const campo = (texto, clase = "campo") => {
    const el = document.createElement("span");
    el.className = clase;
    el.textContent = texto;
    return el;
  };

  const etiqueta = document.createElement("span");
  etiqueta.className = `etiqueta ${admin.raiz ? "jugando" : "esperando"}`;
  etiqueta.textContent = admin.raiz ? "principal" : "administrador";

  fila.append(etiqueta, campo(admin.correo, "campo"));

  if (admin.soyYo) fila.append(campo("(vos)", "campo tenue"));
  if (admin.desde) fila.append(campo(`desde ${fecha(admin.desde)}`, "campo tenue"));
  if (admin.agregadoPor) fila.append(campo(`lo agregó ${admin.agregadoPor}`, "campo tenue"));

  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "btn peligro chico";
  boton.textContent = "Quitar";

  // Los dos casos que el servidor rechaza. Se apagan con el motivo puesto en
  // el `title`, para que no parezca que el botón está roto.
  if (admin.raiz) {
    boton.disabled = true;
    boton.title = "La cuenta principal no se puede quitar.";
  } else if (admin.soyYo) {
    boton.disabled = true;
    boton.title = "No podés quitarte a vos mismo. Pedíselo a otro administrador.";
  } else {
    boton.addEventListener("click", () => sacarAdmin(admin, boton));
  }

  fila.append(boton);
  return fila;
}

async function verAdmins() {
  dom.btnVerAdmins.disabled = true;
  decir(dom.avisoAdmins, "Cargando…");
  try {
    const { data } = await listarAdmins();
    dom.listaAdmins.replaceChildren(...data.administradores.map(filaDeAdmin));
    decir(dom.avisoAdmins, `${data.administradores.length} con acceso al panel.`, "bien");
  } catch (error) {
    decir(dom.avisoAdmins, error?.message ?? "No pudimos leer la lista.", "mal");
    console.error(error);
  } finally {
    dom.btnVerAdmins.disabled = false;
  }
}

dom.btnAgregarAdmin.addEventListener("click", async () => {
  const correo = dom.correoAdmin.value.trim();
  if (!correo) {
    decir(dom.avisoAdmins, "Escribí el correo de quien va a administrar.", "mal");
    dom.correoAdmin.focus();
    return;
  }

  // Sí se pregunta: esto le da a otra persona acceso a cancelar salas, dar de
  // baja cuentas y ver el pozo retenido. Y un correo mal escrito autoriza a
  // quien no era.
  if (!window.confirm(`¿Darle acceso al panel a ${correo}?`)) return;

  dom.btnAgregarAdmin.disabled = true;
  decir(dom.avisoAdmins, "Agregando…");
  try {
    await agregarAdmin({ correo });
    dom.correoAdmin.value = "";
    await verAdmins();
    decir(dom.avisoAdmins, `${correo} ya puede administrar.`, "bien");
  } catch (error) {
    decir(dom.avisoAdmins, error?.message ?? "No pudimos agregarlo.", "mal");
  } finally {
    dom.btnAgregarAdmin.disabled = false;
  }
});

async function sacarAdmin(admin, boton) {
  if (!window.confirm(`¿Quitarle el acceso al panel a ${admin.correo}?`)) return;
  boton.disabled = true;
  try {
    await quitarAdmin({ correo: admin.correo });
    await verAdmins();
  } catch (error) {
    boton.disabled = false;
    decir(dom.avisoAdmins, error?.message ?? "No pudimos quitarlo.", "mal");
  }
}

dom.btnVerAdmins.addEventListener("click", verAdmins);
