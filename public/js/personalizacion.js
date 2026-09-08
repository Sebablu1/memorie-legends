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
const CATEGORIAS = [
  { tipo: TIPOS.AVATAR, titulo: "Avatares", vacio: "Todavía no hay avatares a la venta." },
  { tipo: TIPOS.DORSO, titulo: "Dorsos", vacio: "Todavía no hay dorsos a la venta." },
];

/** Estado de la pantalla. Se guarda para no volver a pedir todo en cada clic. */
let catalogo = [];
let tengo = new Set();
let equipado = {};
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

  for (const boton of document.querySelectorAll("#pestanasPersonalizacion [data-categoria]")) {
    const activa = boton.dataset.categoria === categoriaActual;
    boton.classList.toggle("activa", activa);
    boton.setAttribute("aria-selected", String(activa));
  }
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
    avisar("Listo, te lo pusiste.", "bien");
    dibujar();
  });
}

async function desequipar(tipo, boton) {
  await conBotonApagado(boton, async () => {
    await desequiparItem(tipo);
    equipado[tipo] = null;
    avisar("Listo, te lo sacaste.", "bien");
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
export async function montarPersonalizacion({ saldoInicial = 0 } = {}) {
  const caja = $("rejillaPersonalizacion");
  if (!caja) return;

  saldo = saldoInicial;

  // Las pestañas se dibujan desde la lista: agregar una categoría es agregar
  // una línea en CATEGORIAS, no tocar el HTML.
  const pestanas = $("pestanasPersonalizacion");
  if (pestanas) {
    pestanas.innerHTML = CATEGORIAS.map(
      (c) => `<button type="button" role="tab" data-categoria="${c.tipo}"
                aria-selected="${c.tipo === categoriaActual}">${escapar(c.titulo)}</button>`,
    ).join("");
    pestanas.addEventListener("click", (evento) => {
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
