import { exigirSesion, mostrarSaldo, conectarBotonSalir } from "./sesion.js";
import { PAQUETES, leyendasDePaquete, precioPorLeyenda, paquetesVisibles, MONEDA } from "./reglas/economia.js";
import { listarPacks, crearOrdenDeCompra, ErrorDeServidor } from "./servidor.js";
import { montarPersonalizacion } from "./personalizacion.js";

const $ = (id) => document.getElementById(id);

conectarBotonSalir();

const precio = (n) => `$U ${Number(n).toLocaleString("es-UY")}`;

/**
 * Todo lo que sale de Firestore se escapa antes de entrar al HTML.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ESTO NO ERA NECESARIO Y AHORA SÍ
 * ─────────────────────────────────────────────────────────────────────
 *
 * Los paquetes eran una constante del código, así que su nombre no podía
 * traer sorpresas y `pruebas/escapado.mjs` eximía explícitamente a este
 * archivo. Desde que se administran desde el panel, el nombre lo teclea una
 * persona y viaja por la base de datos: es texto de afuera como el de una
 * sala, y va escapado por la misma razón.
 *
 * La excepción de `escapado.mjs` se sacó junto con este cambio.
 */
const escapar = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Dibuja los paquetes.
 *
 * Se llama dos veces: una con la semilla, apenas carga la página, y otra con
 * lo que conteste el servidor. Así la tienda nunca está en blanco esperando
 * una llamada, y si el servidor no contesta se ve algo razonable en vez de
 * nada. Los botones nacen apagados igual, y lo que se cobra lo decide
 * `crearOrdenDeCompra` leyendo el pack del servidor: lo que se dibuje acá no
 * cambia un precio.
 */
function dibujarPaquetes(lista) {
  const packs = paquetesVisibles(lista);
  if (!packs.length) return;

  // El de mejor precio por Leyenda se marca como el que más conviene.
  const mejor = packs.reduce((a, b) => (precioPorLeyenda(b) < precioPorLeyenda(a) ? b : a));

  $("paquetes").innerHTML = packs
    .map((p) => {
      const total = leyendasDePaquete(p);
      const regalo = Number(p.leyendasRegalo) || 0;
      const base = Number(p.leyendasBase) || 0;
      const cuantos = Array.isArray(p.itemsExclusivos) ? p.itemsExclusivos.length : 0;

      return `
    <article class="paquete ${p.id === mejor.id ? "destacado" : ""}">
      ${p.id === mejor.id ? '<span class="cinta">Mejor valor</span>' : ""}
      <h2>${escapar(p.nombre)}</h2>
      <div class="cantidad">${total.toLocaleString("es-UY")}<small>Leyendas</small></div>
      ${regalo
        ? `<div class="bonus">${base.toLocaleString("es-UY")} + ${regalo.toLocaleString("es-UY")} de regalo</div>`
        : '<div class="bonus">&nbsp;</div>'}
      ${cuantos
        ? `<div class="bonus exclusivos">✨ ${cuantos} ${cuantos === 1 ? "artículo exclusivo" : "artículos exclusivos"}</div>`
        : ""}
      <div class="precio">${precio(p.precioUYU)} <small style="font-size:.7rem;color:var(--texto-tenue)">${MONEDA}</small></div>
      <div class="unitario">${precioPorLeyenda(p).toFixed(2)} $U por Leyenda</div>
      <button class="accion" data-paquete="${escapar(p.id)}" type="button" disabled>Comprar</button>
    </article>`;
    })
    .join("");
}

/**
 * La compra con dinero, del lado del navegador.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ESTE ARCHIVO NO DECIDE NADA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ni el precio, ni quién puede comprar, ni a dónde se manda al comprador. Las
 * tres cosas las contesta el servidor: el importe sale del catálogo, el
 * permiso viene resuelto en `compra.habilitada`, y la URL del checkout la
 * devuelve `crearOrdenDeCompra`.
 *
 * Lo único que hace acá es no dejar clavar el botón dos veces y contar qué
 * pasó. Apagar el botón no es la defensa —esa es el límite de ritmo del
 * servidor— pero es lo que hace que el caso normal no llegue a necesitarla.
 */

/** Lo que contestó el servidor sobre la compra. Sin sesión, nada. */
let compra = { habilitada: false, esSandbox: false };

function avisarPaquetes(texto, tipo = "info") {
  const caja = $("avisoPaquetes");
  if (!caja) return;
  caja.textContent = texto;
  caja.className = `aviso-tienda visible ${tipo}`;
}

/**
 * Enciende los botones, o explica por qué no.
 *
 * Nacen apagados en el marcado y sólo se encienden acá. Es a propósito: la
 * primera pintada ocurre ANTES de pedir la sesión —para que la tienda no
 * nazca en blanco— y en ese momento todavía no se sabe nada. Si el encendido
 * fuera lo que hay que recordar hacer, olvidarlo dejaría la tienda comprable
 * por cualquiera.
 */
function reflejarEstadoDeCompra() {
  const cartel = $("cartelSandbox");
  if (cartel) cartel.hidden = !compra.esSandbox;

  for (const boton of document.querySelectorAll("#paquetes [data-paquete]")) {
    boton.disabled = !compra.habilitada;
  }

  if (!compra.habilitada) {
    avisarPaquetes(
      "La compra de Leyendas está en pruebas: por ahora sólo puede comprar el equipo.",
    );
  }
}

/**
 * Compra un paquete: pide la orden y manda al checkout.
 *
 * `window.location.href` y no `window.open`: el checkout de Mercado Pago se
 * abre como navegación y no como ventana nueva, que los bloqueadores de
 * pop-ups matan sin avisarle a nadie.
 *
 * La URL es la que devolvió el servidor, y ninguna otra. No sale del DOM ni de
 * un atributo: un `data-` con la URL de destino sería un lugar donde escribir
 * a dónde mandamos a alguien que está por pagar.
 */
async function comprarPaquete(paqueteId, boton) {
  const textoPrevio = boton.textContent;
  boton.disabled = true;
  boton.textContent = "…";

  try {
    const r = await crearOrdenDeCompra(paqueteId);
    if (!r?.urlCheckout) throw new Error("El servidor no devolvió un checkout.");

    avisarPaquetes("Te llevamos al pago…", "bien");
    window.location.href = r.urlCheckout;
  } catch (error) {
    // En pantalla y no en un `alert`: un alert bloquea, no se puede copiar, y
    // en el teléfono tapa la página entera.
    const mensaje =
      error instanceof ErrorDeServidor ? error.message : "No pudimos abrir el pago.";
    avisarPaquetes(mensaje, "error");
    boton.disabled = false;
    boton.textContent = textoPrevio;
  }
}

// Delegado en la rejilla y no en cada botón: las tarjetas se vuelven a dibujar
// cuando llegan los paquetes del servidor, y los escuchadores se irían con las
// que se reemplazan.
$("paquetes")?.addEventListener("click", (evento) => {
  const boton = evento.target.closest("[data-paquete]");
  if (!boton || boton.disabled) return;
  comprarPaquete(boton.dataset.paquete, boton);
});

// Primero la semilla, para que la pantalla no nazca vacía.
dibujarPaquetes(PAQUETES);

const sesion = await exigirSesion();
if (sesion) {
  mostrarSaldo(sesion.perfil.saldo);

  // Y después los de verdad. Si falla, quedan los de la semilla: una tienda
  // que muestra precios viejos es mejor que una tienda vacía, y el precio que
  // se cobra lo pone el servidor de todos modos.
  listarPacks()
    .then((r) => {
      dibujarPaquetes(r?.packs ?? []);
      // El estado de la compra viene en el MISMO viaje que los paquetes, así
      // que se refleja recién cuando las tarjetas ya están dibujadas: al revés
      // encendería botones que todavía no existen.
      compra = r?.compra ?? compra;
      reflejarEstadoDeCompra();
    })
    .catch((e) => console.warn("No se pudieron leer los paquetes:", e));

  // La otra mitad de la tienda: lo que se compra CON Leyendas.
  //
  // Se monta desde acá y no con un `<script>` propio para pedir la sesión UNA
  // vez. Dos módulos llamando a `exigirSesion` en la misma carga son dos
  // lecturas del perfil y, peor, dos saldos que pueden diferir por un instante.
  // El uid viaja para poder recordar en ESTE navegador lo que el jugador se
  // pone, y que la mesa abra ya vestida en vez de corregirse a los medio
  // segundo. Ver `modulos/vestuario.js`.
  montarPersonalizacion({ saldoInicial: sesion.perfil.saldo, uid: sesion.usuario.uid });
}
