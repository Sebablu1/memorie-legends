/**
 * §80 — Qué hay en el catálogo, y qué está torcido.
 *
 * SÓLO LEE. No cambia un precio, no borra un artículo, no toca una posesión.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DOS FUENTES, Y CONVIENE NO CONFUNDIRLAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La SEMILLA es `CATALOGO_INICIAL`, en el código: lo que `sembrarCatalogo`
 * escribe la primera vez. La COLECCIÓN es lo que hay en Firestore, que es lo
 * que la tienda muestra y lo que el servidor cobra — y puede diferir, porque
 * el panel deja cambiar precios sin desplegar.
 *
 * Sin credenciales se audita la semilla, que ya dice bastante. Con
 * credenciales se audita lo que hay de verdad, y además se pueden buscar los
 * HUÉRFANOS: artículos que algún jugador tiene comprados y que ya no están en
 * el catálogo. Ésos no se ven de ninguna otra forma.
 *
 * USO
 *
 *   node herramientas/auditar-catalogo.mjs            (la semilla)
 *   node herramientas/auditar-catalogo.mjs --firestore
 *
 * Para lo segundo hace falta autenticarse una vez:
 *
 *   gcloud auth application-default login
 */

import { createRequire } from "node:module";
import {
  CATALOGO_INICIAL,
  TIPOS,
  COLECCION_CATALOGO,
  ETIQUETA_TIPO,
  imagenEsArchivo,
  RAREZA_DE_PRECIO,
  escalaDe,
} from "../public/js/reglas/catalogo.js";

const require = createRequire(import.meta.url);
const PROYECTO = "memorie-legends";
const conFirestore = process.argv.includes("--firestore");

// La escala y la tabla de rarezas viven en `reglas/catalogo.js`, que es de
// donde también las va a leer el panel. Tenerlas acá era tener una segunda
// copia, y la primera versión de este archivo ya demostró lo que pasa
// cuando esa copia se aparta: marcó como errados tres avatares que estaban
// perfectos.

const tramoDe = (item) => {
  const escala = escalaDe(item.tipo);
  if (!escala) return "sin escala";
  return escala.includes(Number(item.precio)) ? "en escala" : "FUERA";
};

const rareza = (item) => item?.metadata?.rareza ?? null;

/** Todo lo que está mal en un artículo, en una lista. */
function problemas(item) {
  const malo = [];
  const precio = Number(item.precio);

  const escala = escalaDe(item.tipo);

  if (item.precio === undefined || item.precio === null) malo.push("SIN PRECIO");
  else if (!Number.isFinite(precio) || precio < 0) malo.push(`PRECIO INVÁLIDO (${item.precio})`);
  // Sin escala no se juzga el precio: es el caso de las insignias.
  else if (escala && !escala.includes(precio) && !item.fueraDeEscala) {
    malo.push(`FUERA DE ESCALA (${precio}; permitidos ${escala.join(", ")})`);
  }

  if (!rareza(item)) malo.push("SIN RAREZA");

  if (!item.imagen) malo.push("SIN IMAGEN");
  else if (!imagenEsArchivo(item.imagen)) malo.push(`IMAGEN NO ES ARCHIVO (${item.imagen})`);

  if (!item.nombre) malo.push("SIN NOMBRE");
  if (item.activo === false) malo.push("apagado");

  return malo;
}

/**
 * ¿La rareza declarada coincide con lo que dice el precio?
 *
 * Es una PISTA y no un error: un artículo barato puede ser raro a propósito,
 * y las insignias no se venden —su precio es cero y su rareza dice cuánto
 * cuesta ganarlas, que no es lo mismo—.
 */
function desajuste(item) {
  // Sin escala no hay nada que comparar. Ver la nota de `ESCALA_DEL_TIPO`.
  if (!escalaDe(item.tipo)) return null;
  // Un artículo marcado como especial se sale de la escala a propósito.
  if (item.fueraDeEscala) return null;

  const esperada = RAREZA_DE_PRECIO[Number(item.precio)];
  const declarada = rareza(item);
  if (!esperada || !declarada || esperada === declarada) return null;
  return `${declarada} con precio de ${esperada}`;
}

// ═══════════════════════════════════════════════════ de dónde salen los datos

async function desdeFirestore() {
  const admin = require("../functions/node_modules/firebase-admin");
  try {
    admin.initializeApp({ projectId: PROYECTO });
  } catch {
    /* ya estaba */
  }
  const db = admin.firestore();

  const snap = await db.collection(COLECCION_CATALOGO).get();
  const items = [];
  snap.forEach((d) => items.push({ id: d.id, ...d.data() }));

  /**
   * Los huérfanos: comprados por alguien y ya no en el catálogo.
   *
   * `collectionGroup` recorre TODAS las subcolecciones `items` de todos los
   * perfiles. Es la consulta más cara de este archivo y por eso va última.
   */
  const conocidos = new Set(items.map((i) => i.id));
  const huerfanos = new Map();
  const compras = await db.collectionGroup("items").get();
  compras.forEach((d) => {
    if (conocidos.has(d.id)) return;
    const fila = huerfanos.get(d.id) ?? { id: d.id, dueños: 0, nombre: d.data()?.nombre };
    fila.dueños += 1;
    huerfanos.set(d.id, fila);
  });

  return { items, huerfanos: [...huerfanos.values()], compras: compras.size };
}

// ═══════════════════════════════════════════════════════════════ el informe

const items = conFirestore ? null : CATALOGO_INICIAL;
let datos = { items, huerfanos: null, compras: null };

if (conFirestore) {
  try {
    datos = await desdeFirestore();
  } catch (e) {
    console.error("No se pudo leer Firestore:", e.message);
    console.error("\nProbablemente falten credenciales. Ejecutá:");
    console.error("  gcloud auth application-default login\n");
    process.exit(1);
  }
}

const lista = datos.items;
console.log(`\n${conFirestore ? "COLECCIÓN `catalogo` de Firestore" : "SEMILLA `CATALOGO_INICIAL`"}`);
console.log(`${lista.length} artículos\n`);

const anchos = { id: 18, nombre: 22, precio: 8, rareza: 13 };
const col = (t, n) => String(t ?? "—").padEnd(n).slice(0, n);

let sinPrecio = 0;
let sinRareza = 0;
let fueraDeEscala = 0;
const desajustados = [];

for (const tipo of Object.values(TIPOS)) {
  const delTipo = lista.filter((i) => i.tipo === tipo);
  if (!delTipo.length) continue;

  console.log(`── ${ETIQUETA_TIPO[tipo]?.tienda ?? tipo} (${tipo}) — ${delTipo.length}`);
  console.log(
    `   ${col("id", anchos.id)} ${col("nombre", anchos.nombre)} ` +
      `${col("precio", anchos.precio)} ${col("rareza", anchos.rareza)} tramo`,
  );

  for (const item of delTipo.sort((a, b) => (a.precio ?? 0) - (b.precio ?? 0))) {
    const malo = problemas(item);
    const raro = desajuste(item);
    if (malo.some((m) => m.includes("SIN PRECIO") || m.includes("PRECIO INVÁLIDO"))) sinPrecio++;
    if (malo.includes("SIN RAREZA")) sinRareza++;
    if (malo.some((m) => m.startsWith("FUERA DE ESCALA"))) fueraDeEscala++;
    if (raro) desajustados.push({ id: item.id, raro });

    const marca = malo.length ? "  ⚠ " + malo.join(", ") : "";
    console.log(
      `   ${col(item.id, anchos.id)} ${col(item.nombre, anchos.nombre)} ` +
        `${col(item.precio, anchos.precio)} ${col(rareza(item), anchos.rareza)} ` +
        `${tramoDe(item)}${marca}`,
    );
  }
  console.log("");
}

// ── duplicados
const vistos = new Map();
for (const i of lista) vistos.set(i.id, (vistos.get(i.id) ?? 0) + 1);
const repetidos = [...vistos].filter(([, n]) => n > 1);

// ── los tramos, para ver si la curva tiene agujeros
console.log("── la curva, por escala");
for (const [nombre, tipos] of [
  ["avatares y dorsos de cartas", [TIPOS.AVATAR, TIPOS.DORSO]],
  ["paños y dorsos de mazo", [TIPOS.FONDO, TIPOS.MAZO]],
]) {
  const delGrupo = lista.filter((i) => tipos.includes(i.tipo));
  console.log(`   ${nombre}`);
  for (const p of escalaDe(tipos[0])) {
    const cuantos = delGrupo.filter((i) => Number(i.precio) === p).length;
    const barra = "█".repeat(cuantos);
    const vacio = cuantos === 0 ? "  ⚠ escalón vacío" : "";
    console.log(`     ${String(p).padStart(4)}  ${String(cuantos).padStart(2)} ${barra}${vacio}`);
  }
}

const otros = lista.filter((i) => {
  const e = escalaDe(i.tipo);
  return e && !e.includes(Number(i.precio)) && !i.fueraDeEscala;
});
if (otros.length) {
  console.log(`\n   fuera de su escala: ${otros.map((i) => `${i.id}=${i.precio}`).join(", ")}`);
}

const especiales = lista.filter((i) => i.fueraDeEscala);
if (especiales.length) {
  console.log(`   marcados como especiales: ${especiales.map((i) => i.id).join(", ")}`);
}

console.log("\n── resumen");
console.log(`   sin precio válido : ${sinPrecio}`);
console.log(`   sin rareza        : ${sinRareza}`);
console.log(`   fuera de escala   : ${fueraDeEscala}`);
console.log(`   ids repetidos     : ${repetidos.length}${repetidos.length ? " → " + repetidos.map(([id]) => id).join(", ") : ""}`);

if (desajustados.length) {
  console.log(`   rareza vs precio  : ${desajustados.length}`);
  for (const d of desajustados) console.log(`     · ${d.id}: ${d.raro}`);
} else {
  console.log("   rareza vs precio  : 0");
}

if (datos.huerfanos) {
  console.log(`\n── huérfanos (comprados y ya no en el catálogo), sobre ${datos.compras} compras`);
  if (!datos.huerfanos.length) console.log("   ninguno");
  for (const h of datos.huerfanos) {
    console.log(`   ${col(h.id, anchos.id)} ${col(h.nombre, anchos.nombre)} ${h.dueños} dueño(s)`);
  }
} else {
  console.log("\n── huérfanos: hace falta --firestore para saberlo");
}

console.log("");
