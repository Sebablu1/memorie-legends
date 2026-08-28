import { exigirSesion, mostrarSaldo, conectarBotonSalir } from "./sesion.js";
import { PAQUETES, leyendasDePaquete, precioPorLeyenda, MONEDA } from "./reglas/economia.js";

const $ = (id) => document.getElementById(id);

conectarBotonSalir();

const precio = (n) => `$U ${n.toLocaleString("es-UY")}`;

// El paquete con mejor precio por Leyenda se marca como el que más conviene.
const mejor = PAQUETES.reduce((a, b) => (precioPorLeyenda(b) < precioPorLeyenda(a) ? b : a));

$("paquetes").innerHTML = PAQUETES.map((p) => {
  const total = leyendasDePaquete(p);
  return `
    <article class="paquete ${p.id === mejor.id ? "destacado" : ""}">
      ${p.id === mejor.id ? '<span class="cinta">Mejor valor</span>' : ""}
      <h2>${p.nombre}</h2>
      <div class="cantidad">${total.toLocaleString("es-UY")}<small>Leyendas</small></div>
      ${p.bonificacion ? `<div class="bonus">${p.leyendas.toLocaleString("es-UY")} + ${p.bonificacion} de regalo</div>` : "<div class=\"bonus\">&nbsp;</div>"}
      ${p.insignia ? '<div class="bonus">🏆 Incluye insignia</div>' : ""}
      <div class="precio">${precio(p.precio)} <small style="font-size:.7rem;color:var(--texto-tenue)">${MONEDA}</small></div>
      <div class="unitario">${precioPorLeyenda(p).toFixed(2)} $U por Leyenda</div>
      <button class="accion" data-paquete="${p.id}" type="button" disabled>Comprar</button>
    </article>`;
}).join("");

const sesion = await exigirSesion();
if (sesion) mostrarSaldo(sesion.perfil.saldo);
