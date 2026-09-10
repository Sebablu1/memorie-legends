/**
 * La sección de personalización de la tienda.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL CATÁLOGO SE LEE DE FIRESTORE, NO DEL ARCHIVO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `reglas/catalogo.js` tiene una constante `CATALOGO_INICIAL`, y sería cómodo
 * pintar la tienda con ella. Sería un error: esa constante es la SEMILLA con
 * la que se llena la colección la primera vez. Los precios de verdad —los que
 * el administrador cambia desde el panel, sin desplegar— viven en la colección
 * `catalogo`, y son los que el servidor cobra.
 *
 * Pintar la tienda con el archivo mostraría un precio y cobraría otro. De
 * `catalogo.js` se usan las FUNCIONES: qué tipos hay, cómo se ordenan, dónde
 * se guarda lo equipado.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE SE MUESTRA NO ES LO QUE DECIDE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El botón "Comprar" se apaga cuando no alcanza el saldo, y eso es una
 * cortesía: avisa antes de pedir. Quien lo encienda desde la consola va a
 * recibir el mismo "no te alcanza" del servidor, que es el que cuenta. Lo
 * mismo con "Equipar": la comprobación de que el artículo es tuyo la hace
 * `equiparItem`, acá sólo se dibuja.
 */

import { db, collection, getDocs, query, orderBy } from "./firebase.js";
import { escapar } from "./modulos/texto.js";
import { guardarVestuario, rutasDeLoEquipado } from "./modulos/vestuario.js";
import { mostrarSaldo } from "./sesion.js";
import {
  comprarItem,
  comprarPack,
  equiparItem,
  desequiparItem,
  misItems,
  ErrorDeServidor,
} from "./servidor.js";
import {
  TIPOS,
  CAMPO_EQUIPADO,
  itemsDeTipo,
  imagenEsArchivo,
  precioDePack,
  MAXIMO_POR_PACK,
  COLECCION_CATALOGO,
  enLaTienda,
} from "./reglas/catalogo.js";

const $ = (id) => document.getElementById(id);

/**
 * Cómo se llama cada tipo en pantalla, y en qué orden aparecen.
 *
 * La lista es la que decide qué pestañas existen: agregar una categoría nueva
 * es agregar una línea acá, no una página. Las tres viven en la misma tienda a
 * propósito — son lo mismo con distinta forma, y separarlas en tres pantallas
 * obligaría a mantener tres copias del mismo circuito de compra.
 */
/**
 * Las pestañas de la tienda: lo que se VENDE.
 *
 * Las insignias no están, y no es un olvido. Son logros: se ganan jugando y
 * las otorga el servidor. Viven en la vitrina del perfil, con la condición de
 * cada una a la vista.
 *
 * Sacarlas de acá esconde el botón. Lo que impide comprarlas es
 * `TIPOS_VENDIBLES` en `reglas/catalogo.js`, que el servidor comprueba dentro
 * de la transacción: esta lista es la cara visible de aquella decisión, no la
 * decisión.
 */
/**
 * Cada categoría dice a qué GRUPO pertenece.
 *
 * Los dos dorsos se venden por separado —son dos artículos y dos campos del
 * perfil— pero el jugador que viene a buscar «un dorso» no sabe de antemano
 * cuál de los dos quiere. Ponerlos como dos pestañas hermanas de Avatares
 * obligaba a saberlo antes de mirar.
 *
 * Así que las pestañas son dos filas: arriba el grupo, y abajo —sólo cuando
 * el grupo tiene más de una— cuál de las dos. Un grupo de una sola categoría
 * no dibuja la segunda fila y se ve exactamente como antes.
 *
 * Los títulos salen de `ETIQUETA_TIPO`, que es de donde los saca también Mi
 * colección: son dos vistas de lo mismo y no pueden llamarlo distinto.
 */
const CATEGORIAS = [
  { tipo: TIPOS.AVATAR, grupo: "Avatares", vacio: "Todavía no hay avatares a la venta." },
  { tipo: TIPOS.DORSO, grupo: "Dorsos", vacio: "Todavía no hay dorsos de cartas a la venta." },
  { tipo: TIPOS.MAZO, grupo: "Dorsos", vacio: "Todavía no hay dorsos de mazo central a la venta." },
  { tipo: TIPOS.FONDO, grupo: "Paños de mesa", vacio: "Todavía no hay paños a la venta." },
].map((c) => ({ ...c, titulo: enLaTienda(c.tipo) }));

/** Los grupos, en el orden en que aparecen sus categorías. */
const GRUPOS = [...new Set(CATEGORIAS.map((c) => c.grupo))];

/** Las categorías de un grupo. Una sola significa que no hay segunda fila. */
const categoriasDe = (grupo) => CATEGORIAS.filter((c) => c.grupo === grupo);

/** A qué grupo pertenece lo que está mirando ahora. */
const grupoDe = (tipo) => CATEGORIAS.find((c) => c.tipo === tipo)?.grupo ?? GRUPOS[0];

/** Estado de la pantalla. Se guarda para no volver a pedir todo en cada clic. */
let catalogo = [];
let tengo = new Set();
let equipado = {};
/** De quién es la sesión. Sólo para recordarle su vestuario a él. */
let miUid = null;
let saldo = 0;
let categoriaActual = CATEGORIAS[0].tipo;

/**
 * Lo que el jugador está juntando para llevar de una.
 *
 * Vacío significa "modo normal": cada botón compra lo suyo. Con algo adentro,
 * la tienda pasa a modo pack y los botones seleccionan en vez de comprar. Se
 * modela con el propio conjunto y no con una bandera aparte porque una bandera
 * y un conjunto pueden desincronizarse —"modo pack con nada seleccionado" es
 * un estado que no significa nada y hay que dibujar igual.
 */
let enElPack = new Set();

// ------------------------------------------------------------------ datos

/** El catálogo tal como está en el servidor, ordenado como se muestra. */
async function leerCatalogo() {
  // `orderBy("orden")` de entrada, y `ordenarItems` después para el desempate
  // alfabético: Firestore no sabe ordenar por dos criterios sin un índice, y
  // no vale la pena crear uno para una colección de veinte documentos.
  const snap = await getDocs(query(collection(db, COLECCION_CATALOGO), orderBy("orden")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Qué compré y qué llevo puesto. Una sola llamada al servidor. */
async function leerLoMio() {
  const r = await misItems();
  tengo = new Set((r.tengo ?? []).map((i) => i.id));
  equipado = r.equipado ?? {};
}

// ----------------------------------------------------------------- pintar

const precioTexto = (n) => (n === 0 ? "Gratis" : `${n.toLocaleString("es-UY")} Leyendas`);

/**
 * La imagen de un artículo.
 *
 * Todos los artículos del catálogo apuntan hoy a un archivo. Pero el panel de
 * administración deja escribir el campo a mano, y ahí lo más rápido para
 * probar un artículo nuevo es pegar un emoji: `imagenEsArchivo` distingue las
 * dos formas, porque un emoji dentro de un `src` no es una imagen rota, es una
 * petición a una URL que no existe.
 */
function dibujarImagen(item) {
  if (imagenEsArchivo(item.imagen)) {
    return `<img class="figura-item" src="${escapar(item.imagen)}" alt="" loading="lazy" />`;
  }
  return `<span class="figura-item glifo" aria-hidden="true">${escapar(item.imagen ?? "")}</span>`;
}

/**
 * El botón de cada artículo, que es donde vive todo el estado.
 *
 * Cuatro situaciones y ni una más: no lo tenés y te alcanza, no lo tenés y no
 * te alcanza, lo tenés, lo tenés puesto. Se decide acá y no en el CSS para que
 * el `disabled` y el texto no puedan decir cosas distintas.
 */
function dibujarBoton(item) {
  const puesto = equipado[item.tipo] === item.id;

  // En modo pack, lo que no se tiene se agrega o se saca. Lo que ya es suyo
  // sigue mostrando su estado: sacarle el botón de equipar mientras arma un
  // pack sería castigarlo por estar comprando.
  if (enElPack.size && !tengo.has(item.id) && !puesto) {
    const adentro = enElPack.has(item.id);
    return `<button class="accion ${adentro ? "" : "sobria"}" type="button"
              data-pack="${escapar(item.id)}">${adentro ? "✓ En el pack" : "Agregar"}</button>`;
  }
  // Lo que se lleva puesto ofrece sacárselo. Antes era un botón apagado que
  // decía «✓ Equipado» y no hacía nada: el jugador podía cambiar de avatar
  // pero no quedarse sin ninguno, porque «ninguno» no es un artículo que se
  // pueda elegir de la rejilla.
  if (puesto) {
    return `<button class="accion sobria" type="button"
              data-sacar="${escapar(item.tipo)}">Desequipar</button>`;
  }
  if (tengo.has(item.id)) {
    return `<button class="accion" type="button" data-equipar="${escapar(item.id)}">Equipar</button>`;
  }
  const alcanza = saldo >= Number(item.precio ?? 0);
  return `<button class="accion" type="button" data-comprar="${escapar(item.id)}"
            ${alcanza ? "" : "disabled"}>${alcanza ? "Comprar" : "No alcanza"}</button>`;
}

function dibujarItem(item) {
  const puesto = equipado[item.tipo] === item.id;
  return `
    <article class="item-tienda ${puesto ? "puesto" : ""} ${tengo.has(item.id) ? "mio" : ""}">
      ${puesto ? '<span class="cinta-item">En uso</span>' : ""}
      ${dibujarImagen(item)}
      <h3>${escapar(item.nombre ?? item.id)}</h3>
      <p class="descripcion-item">${escapar(item.descripcion ?? "")}</p>
      <div class="precio-item">${tengo.has(item.id) ? "Tuyo" : precioTexto(Number(item.precio ?? 0))}</div>
      ${dibujarBoton(item)}
    </article>`;
}

function dibujar() {
  const categoria = CATEGORIAS.find((c) => c.tipo === categoriaActual) ?? CATEGORIAS[0];
  const items = itemsDeTipo(catalogo, categoria.tipo);
  const caja = $("rejillaPersonalizacion");
  if (!caja) return;

  caja.innerHTML = items.length
    ? items.map(dibujarItem).join("")
    : `<div class="vacio"><span class="icono">🎭</span>${escapar(categoria.vacio)}</div>`;

  dibujarPack();

  // La fila de arriba se marca por GRUPO: estando en «Dorso de mazo
  // central», la pestaña encendida arriba es «Dorsos».
  const grupoActual = grupoDe(categoriaActual);
  for (const boton of document.querySelectorAll("#pestanasPersonalizacion [data-grupo]")) {
    const activa = boton.dataset.grupo === grupoActual;
    boton.classList.toggle("activa", activa);
    boton.setAttribute("aria-selected", String(activa));
  }

  dibujarSubpestanas(grupoActual);
}

/**
 * La segunda fila: cuál de las cosas del grupo se está mirando.
 *
 * Con una sola categoría adentro no se dibuja NADA y el contenedor queda
 * escondido: en Avatares y en Paños la tienda se ve exactamente como antes.
 * Una fila de una sola pestaña no informa de nada y ocupa lo mismo.
 */
function dibujarSubpestanas(grupo) {
  const caja = $("subpestanasPersonalizacion");
  if (!caja) return;

  const hermanas = categoriasDe(grupo);
  caja.hidden = hermanas.length < 2;
  if (caja.hidden) {
    caja.innerHTML = "";
    return;
  }

  caja.innerHTML = hermanas
    .map(
      (c) => `<button type="button" role="tab" data-categoria="${c.tipo}"
                aria-selected="${c.tipo === categoriaActual}"
                class="${c.tipo === categoriaActual ? "activa" : ""}">${escapar(c.titulo)}</button>`,
    )
    .join("");
}

/**
 * La barra que dice cuánto sale el pack.
 *
 * El total se calcula con `precioDePack`, el MISMO módulo que usa el servidor
 * para cobrar. Si se calculara acá aparte, el precio mostrado y el cobrado
 * podrían diferir, y el que se equivoca siempre es el que se ve.
 */
function dibujarPack() {
  const caja = $("resumenPack");
  if (!caja) return;

  if (!enElPack.size) {
    caja.hidden = true;
    return;
  }

  const elegidos = [...enElPack]
    .map((id) => catalogo.find((i) => i.id === id))
    .filter(Boolean);

  const suma = elegidos.reduce((s, i) => s + Number(i.precio ?? 0), 0);
  const total = precioDePack(suma, elegidos.length);
  const ahorro = suma - total;
  const alcanza = saldo >= total;

  caja.hidden = false;
  caja.innerHTML = `
    <div class="cuenta-pack">
      <b>${elegidos.length} de ${MAXIMO_POR_PACK}</b>
      <span>${elegidos.map((i) => escapar(i.nombre)).join(", ")}</span>
    </div>
    <div class="total-pack">
      ${ahorro ? `<s>${suma.toLocaleString("es-UY")}</s> ` : ""}
      <b>${total.toLocaleString("es-UY")} Leyendas</b>
      ${ahorro ? `<em>ahorrás ${ahorro.toLocaleString("es-UY")}</em>` : ""}
    </div>
    <button class="accion" type="button" id="btnLlevarPack" ${alcanza ? "" : "disabled"}>
      ${alcanza ? "Llevar el pack" : "No alcanza"}
    </button>
    <button class="accion sobria" type="button" id="btnVaciarPack">Vaciar</button>`;
}

function avisar(texto, tipo = "info") {
  const caja = $("avisoPersonalizacion");
  if (!caja) return;
  caja.textContent = texto;
  caja.className = `aviso-tienda visible ${tipo}`;
}

// ---------------------------------------------------------------- acciones

/**
 * Comprar y equipar comparten forma: apagar el botón, pedir, repintar.
 *
 * Apagarlo antes de pedir es lo que evita la compra doble desde la interfaz.
 * No es la defensa de verdad —ésa está en el servidor, que rechaza la segunda
 * con "ya lo tenés"— pero es la que hace que el caso normal no llegue nunca a
 * necesitarla.
 */
async function conBotonApagado(boton, trabajo) {
  const textoPrevio = boton.textContent;
  boton.disabled = true;
  boton.textContent = "…";
  try {
    await trabajo();
  } catch (error) {
    const mensaje =
      error instanceof ErrorDeServidor ? error.message : "No pudimos completar la operación.";
    avisar(mensaje, "error");
    boton.disabled = false;
    boton.textContent = textoPrevio;
  }
}

async function comprar(itemId, boton) {
  await conBotonApagado(boton, async () => {
    const r = await comprarItem(itemId);

    // El saldo que se muestra es el que devolvió el servidor, no una resta
    // hecha acá. Si fueran dos cuentas distintas, tarde o temprano diferirían.
    if (typeof r.saldo === "number") {
      saldo = r.saldo;
      mostrarSaldo(saldo);
    }
    tengo.add(itemId);
    avisar("¡Comprado! Ya podés equiparlo.", "bien");
    dibujar();
  });
}

/** Agrega o saca del pack. Sin red: hasta que no se lleve, no pasa nada. */
function alternarEnPack(itemId) {
  if (enElPack.has(itemId)) enElPack.delete(itemId);
  else if (enElPack.size >= MAXIMO_POR_PACK) {
    avisar(`En un pack entran hasta ${MAXIMO_POR_PACK}. Sacá uno para agregar otro.`, "error");
    return;
  } else enElPack.add(itemId);
  dibujar();
}

async function llevarPack(boton) {
  const ids = [...enElPack];
  await conBotonApagado(boton, async () => {
    const r = await comprarPack(ids);

    if (typeof r.saldo === "number") {
      saldo = r.saldo;
      mostrarSaldo(saldo);
    }
    // El servidor equipa el primero de cada tipo y devuelve qué CAMPO del
    // perfil tocó. Se traduce campo → tipo con `CAMPO_EQUIPADO` en vez de
    // asumir que se llaman igual: hoy coinciden, y el día que dejen de
    // coincidir esto fallaría en silencio, mostrando "Equipar" sobre algo que
    // el jugador ya tiene puesto.
    for (const c of r.comprados) {
      tengo.add(c.id);
      if ((r.equipado ?? {})[CAMPO_EQUIPADO[c.tipo]] === c.id) equipado[c.tipo] = c.id;
    }
    enElPack = new Set();

    avisar(
      r.ahorro
        ? `¡Listo! ${r.comprados.length} artículos por ${r.total.toLocaleString("es-UY")} Leyendas: ahorraste ${r.ahorro.toLocaleString("es-UY")}.`
        : `¡Comprado! Ya podés equiparlo.`,
      "bien",
    );
    dibujar();
  });
}

async function equipar(itemId, boton) {
  await conBotonApagado(boton, async () => {
    const r = await equiparItem(itemId);
    equipado[r.tipo] = itemId;
    recordarVestuario();
    // «Equipado» y «Desequipado»: el par, con la misma palabra que dicen los
    // dos botones. Antes eran «te lo pusiste» y «te lo sacaste», que son otras
    // dos palabras para las mismas dos acciones, a un centímetro del botón.
    avisar("Listo, equipado.", "bien");
    dibujar();
  });
}

/**
 * Deja anotado en el navegador lo que quedó puesto.
 *
 * Para que la mesa abra ya vestida en vez de arrancar con lo de la casa y
 * corregirse medio segundo después. Es una pista: la mesa la pisa con lo
 * que diga el servidor.
 */
function recordarVestuario() {
  guardarVestuario(
    miUid,
    rutasDeLoEquipado(equipado, (id) => catalogo.find((i) => i.id === id)?.imagen ?? null),
  );
}

async function desequipar(tipo, boton) {
  await conBotonApagado(boton, async () => {
    await desequiparItem(tipo);
    equipado[tipo] = null;
    recordarVestuario();
    // «Desequipado», la misma palabra que dice el botón que se acaba de tocar.
    // Antes decía «te lo sacaste», y el botón «Desequipar»: dos palabras para
    // la misma acción, a un centímetro de distancia.
    avisar("Listo, desequipado.", "bien");
    dibujar();
  });
}

// ------------------------------------------------------------------ arranque

/**
 * Arranca la sección.
 *
 * Recibe el saldo de quien ya pidió la sesión —`tienda.js` lo hace para pintar
 * los paquetes— para no pedir el perfil dos veces en la misma carga.
 */
export async function montarPersonalizacion({ saldoInicial = 0, uid = null } = {}) {
  const caja = $("rejillaPersonalizacion");
  if (!caja) return;

  saldo = saldoInicial;
  miUid = uid;

  // Las pestañas se dibujan desde la lista: agregar una categoría es agregar
  // una línea en CATEGORIAS, no tocar el HTML.
  //
  // Arriba van los GRUPOS. Tocar uno lleva a su primera categoría, que en un
  // grupo de una sola es la única y en «Dorsos» es el de las cartas.
  const pestanas = $("pestanasPersonalizacion");
  if (pestanas) {
    pestanas.innerHTML = GRUPOS.map(
      (g) => `<button type="button" role="tab" data-grupo="${escapar(g)}"
                aria-selected="${g === grupoDe(categoriaActual)}">${escapar(g)}</button>`,
    ).join("");
    pestanas.addEventListener("click", (evento) => {
      const boton = evento.target.closest("[data-grupo]");
      if (!boton) return;
      categoriaActual = categoriasDe(boton.dataset.grupo)[0]?.tipo ?? categoriaActual;
      dibujar();
    });
  }

  // Y la de abajo, cuál de las del grupo.
  const subpestanas = $("subpestanasPersonalizacion");
  if (subpestanas) {
    subpestanas.addEventListener("click", (evento) => {
      const boton = evento.target.closest("[data-categoria]");
      if (!boton) return;
      categoriaActual = boton.dataset.categoria;
      dibujar();
    });
  }

  caja.innerHTML = '<div class="vacio">Cargando…</div>';

  try {
    const [items] = await Promise.all([leerCatalogo(), leerLoMio()]);
    catalogo = items;
  } catch (error) {
    console.error("No se pudo leer la tienda:", error);
    caja.innerHTML =
      '<div class="vacio"><span class="icono">⚠️</span>No pudimos cargar la tienda. Probá de nuevo en un momento.</div>';
    return;
  }

  dibujar();

  // Delegación: la rejilla se repinta entera en cada compra, así que enganchar
  // botón por botón dejaría escuchadores muertos en cada vuelta.
  caja.addEventListener("click", (evento) => {
    const boton = evento.target.closest("button");
    if (!boton) return;
    if (boton.dataset.comprar) comprar(boton.dataset.comprar, boton);
    else if (boton.dataset.equipar) equipar(boton.dataset.equipar, boton);
    else if (boton.dataset.sacar) desequipar(boton.dataset.sacar, boton);
    else if (boton.dataset.pack) alternarEnPack(boton.dataset.pack);
  });

  // El resumen del pack vive fuera de la rejilla —no se repinta con ella— así
  // que lleva su propio escuchador delegado.
  $("resumenPack")?.addEventListener("click", (evento) => {
    if (evento.target.closest("#btnLlevarPack")) {
      llevarPack(evento.target.closest("#btnLlevarPack"));
    } else if (evento.target.closest("#btnVaciarPack")) {
      enElPack = new Set();
      dibujar();
    }
  });

  $("btnArmarPack")?.addEventListener("click", () => {
    if (enElPack.size) enElPack = new Set();
    else {
      // Se arranca con el primero que pueda comprar: un modo pack vacío no se
      // distingue del modo normal y el botón parecería no hacer nada.
      const primero = itemsDeTipo(catalogo, categoriaActual).find(
        (i) => !tengo.has(i.id) && Number(i.precio ?? 0) > 0,
      );
      if (!primero) {
        avisar("No queda nada para llevar en un pack en esta pestaña.", "error");
        return;
      }
      enElPack.add(primero.id);
    }
    dibujar();
  });
}
