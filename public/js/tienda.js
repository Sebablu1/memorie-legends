import { exigirSesion, mostrarSaldo, conectarBotonSalir } from "./sesion.js";
import { PAQUETES, leyendasDePaquete, precioPorLeyenda, paquetesVisibles, MONEDA } from "./reglas/economia.js";
import { listarPacks } from "./servidor.js";
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

// Primero la semilla, para que la pantalla no nazca vacía.
dibujarPaquetes(PAQUETES);

const sesion = await exigirSesion();
if (sesion) {
  mostrarSaldo(sesion.perfil.saldo);

  // Y después los de verdad. Si falla, quedan los de la semilla: una tienda
  // que muestra precios viejos es mejor que una tienda vacía, y el precio que
  // se cobra lo pone el servidor de todos modos.
  listarPacks()
    .then((r) => dibujarPaquetes(r?.packs ?? []))
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
