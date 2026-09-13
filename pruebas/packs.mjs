/**
 * Los paquetes de Leyendas: lo que se cobra y lo que se entrega.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTA SUITE ES MÁS DESCONFIADA QUE LAS OTRAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque acá se mueven PESOS y no Leyendas. Las Leyendas las emite la casa y
 * un error se corrige emitiendo más; un cobro mal hecho es plata de una
 * persona.
 *
 * Y porque los paquetes acaban de salir del código. Eran una constante que
 * sólo cambiaba con un despliegue y una revisión; ahora los edita alguien
 * desde un formulario, en vivo, sobre la tienda abierta.
 */

import { crearPacks } from "../functions/packs.js";
import {
  PAQUETES,
  problemasDelPaquete,
  normalizarPaquete,
  leyendasDePaquete,
  PRECIO_MINIMO_PACK,
  PRECIO_MAXIMO_PACK,
} from "../public/js/reglas/economia.js";
import { CATALOGO_INICIAL } from "../public/js/reglas/catalogo.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else {
    fallos++;
    console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : "");
  }
};

const error = (codigo, mensaje) => Object.assign(new Error(mensaje), { codigo });
const capturar = async (fn) => {
  try {
    return { valor: await fn() };
  } catch (e) {
    return { error: e };
  }
};

/** Firestore de mentira, con `doc()` por ruta completa para `tienda/packs/items`. */
function crearFirestore(inicial = {}) {
  const docs = new Map(Object.entries(inicial));

  const documento = (ruta) => ({
    ruta,
    id: ruta.split("/").pop(),
    async get() {
      const d = docs.get(ruta);
      return { exists: Boolean(d), id: ruta.split("/").pop(), data: () => (d ? { ...d } : undefined) };
    },
    async set(datos, opciones) {
      docs.set(ruta, opciones?.merge ? { ...(docs.get(ruta) ?? {}), ...datos } : datos);
    },
    async delete() {
      docs.delete(ruta);
    },
  });

  const coleccion = (prefijo) => ({
    doc: (id) => documento(`${prefijo}/${id}`),
    async get() {
      const filas = [...docs.entries()]
        .filter(([r]) => r.startsWith(`${prefijo}/`) && !r.slice(prefijo.length + 1).includes("/"))
        .map(([r, d]) => ({ id: r.slice(prefijo.length + 1), data: () => ({ ...d }) }));
      return { size: filas.length, forEach: (fn) => filas.forEach(fn) };
    },
  });

  return {
    collection: coleccion,
    doc: documento,
    _leer: (r) => docs.get(r),
    _rutas: () => [...docs.keys()],
  };
}

/** El catálogo entero, para que los artículos exclusivos existan de verdad. */
const conCatalogo = () => {
  const inicial = {};
  for (const item of CATALOGO_INICIAL) inicial[`catalogo/${item.id}`] = { ...item };
  return inicial;
};

function montar({ conPacks = [], catalogo = true } = {}) {
  const inicial = catalogo ? conCatalogo() : {};
  for (const p of conPacks) inicial[`tienda/packs/items/${p.id}`] = normalizarPaquete(p);

  const db = crearFirestore(inicial);
  const packs = crearPacks({
    db,
    error,
    marcaDeTiempo: () => "T",
    administradores: { exigir: async () => ({ uid: "admin" }) },
  });
  return { db, packs };
}

const COMO = { auth: { uid: "admin" } };

// =====================================================================
console.log("\n=== 1. Sin nada guardado, la tienda igual puede cobrar ===");
// =====================================================================

{
  /**
   * La colección vacía no puede dejar la tienda muda.
   *
   * Una tienda sin paquetes no cobra, y "se borró sin querer la colección" no
   * puede ser el fin del negocio. Se cae a la semilla del código: no escribe
   * nada, sólo evita el silencio mientras alguien arregla el desastre.
   */
  const { packs } = montar();

  const enLaTienda = await packs.listarParaLaTienda();
  ok(enLaTienda.length === PAQUETES.length, "la tienda ve los cinco de la semilla", enLaTienda.length);

  const paraCobrar = await packs.paraCobrar("premium");
  ok(paraCobrar?.precioUYU === 1000, "y se puede cobrar uno", paraCobrar?.precioUYU);

  // Pero el panel SÍ tiene que saber que no hay nada guardado: un
  // administrador que ve cinco packs y edita uno no va a entender por qué los
  // otros cuatro siguen igual.
  const { packs: delPanel, desdeLaSemilla } = await packs.listarParaAdmin(COMO);
  ok(desdeLaSemilla === true, "el panel avisa que son los del código");
  ok(delPanel.length === PAQUETES.length, "y los muestra igual", delPanel.length);
}

// =====================================================================
console.log("\n=== 2. Sembrar no pisa lo que ya está ===");
// =====================================================================

{
  const { db, packs } = montar({
    conPacks: [{ ...PAQUETES[0], precioUYU: 999 }],
  });

  const r = await packs.sembrar(COMO);

  ok(!r.creados.includes("basico"), "no vuelve a crear el que ya estaba", r.creados);
  ok(r.creados.length === PAQUETES.length - 1, "crea los que faltaban", r.creados.length);
  ok(
    db._leer("tienda/packs/items/basico")?.precioUYU === 999,
    "y respeta el precio que había puesto el administrador",
    db._leer("tienda/packs/items/basico")?.precioUYU,
  );
}

// =====================================================================
console.log("\n=== 3. Un pack apagado no se puede comprar por la puerta de atrás ===");
// =====================================================================

{
  /**
   * Retirar un pack y que igual se pueda comprar mandando el id a mano no
   * sería retirarlo. `paraCobrar` devuelve `null` tanto si no existe como si
   * está apagado, que para el cobro es lo mismo.
   */
  const { packs } = montar({ conPacks: [{ ...PAQUETES[2], activo: false }] });

  const enLaTienda = await packs.listarParaLaTienda();
  ok(!enLaTienda.some((p) => p.id === "premium"), "no aparece en la tienda", enLaTienda.map((p) => p.id));

  const cobrable = await packs.paraCobrar("premium");
  ok(cobrable === null, "y no se puede cobrar", cobrable);

  const inexistente = await packs.paraCobrar("no-existe");
  ok(inexistente === null, "igual que uno que no existe");
}

// =====================================================================
console.log("\n=== 4. No se puede prometer lo que no está en el catálogo ===");
// =====================================================================

{
  /**
   * ES LA REGLA QUE YA SE ROMPIÓ.
   *
   * El Pack Élite prometía la insignia `comprador-elite`, que no existía en
   * ningún catálogo. `tienda.otorgar` tira `not-found` sobre un id que no
   * existe, y eso pasaría DESPUÉS del pago: el comprador ya puso la plata.
   *
   * Se comprueba al guardar el pack, que es cuando hay alguien mirando la
   * pantalla y todavía no hay dinero de por medio.
   */
  const { db, packs } = montar();

  const r = await capturar(() =>
    packs.guardar(COMO, {
      id: "fantasma",
      nombre: "Pack Fantasma",
      precioUYU: 500,
      leyendasBase: 100,
      leyendasRegalo: 0,
      itemsExclusivos: ["no_existe_este", "avatar_soberano"],
    }));

  ok(r.error?.codigo === "failed-precondition", "guardar se rechaza", r.error?.codigo);
  ok(/no_existe_este/.test(r.error?.message ?? ""), "y dice cuál falta", r.error?.message);
  ok(!/avatar_soberano/.test(r.error?.message ?? ""), "sin nombrar los que sí están");
  ok(!db._leer("tienda/packs/items/fantasma"), "no queda nada escrito");

  // Con artículos que existen, entra.
  const bien = await capturar(() =>
    packs.guardar(COMO, {
      id: "fantasma",
      nombre: "Pack Fantasma",
      precioUYU: 500,
      leyendasBase: 100,
      leyendasRegalo: 0,
      itemsExclusivos: ["avatar_soberano"],
    }));
  ok(!bien.error, "con artículos que existen se guarda", bien.error?.message);
  ok(db._leer("tienda/packs/items/fantasma")?.leyendasTotal === 100, "y guarda el total calculado");
}

// =====================================================================
console.log("\n=== 5. El precio pasa por el rango, siempre ===");
// =====================================================================

{
  /**
   * El cero de más es EL error de tipeo, y ahora se escribe desde un
   * formulario. El rango no adivina el precio correcto —no puede— pero
   * descarta el orden de magnitud imposible, que es donde está el daño.
   */
  const { db, packs } = montar();

  const base = {
    id: "raro",
    nombre: "Pack Raro",
    leyendasBase: 1000,
    leyendasRegalo: 0,
    itemsExclusivos: [],
  };

  const barato = await capturar(() => packs.guardar(COMO, { ...base, precioUYU: 1 }));
  ok(barato.error?.codigo === "invalid-argument", "un peso se rechaza", barato.error?.codigo);

  const carisimo = await capturar(() => packs.guardar(COMO, { ...base, precioUYU: 999999 }));
  ok(carisimo.error?.codigo === "invalid-argument", "y un millón también", carisimo.error?.codigo);

  ok(!db._leer("tienda/packs/items/raro"), "ninguno de los dos queda escrito");

  // Los bordes entran.
  const minimo = await capturar(() => packs.guardar(COMO, { ...base, precioUYU: PRECIO_MINIMO_PACK }));
  ok(!minimo.error, `el mínimo (${PRECIO_MINIMO_PACK}) entra`, minimo.error?.message);

  const maximo = await capturar(() => packs.guardar(COMO, { ...base, precioUYU: PRECIO_MAXIMO_PACK }));
  ok(!maximo.error, `y el máximo (${PRECIO_MAXIMO_PACK}) también`, maximo.error?.message);

  // Y un precio con decimales no es un precio.
  const roto = await capturar(() => packs.guardar(COMO, { ...base, precioUYU: 250.5 }));
  ok(roto.error?.codigo === "invalid-argument", "un precio con decimales se rechaza", roto.error?.codigo);
}

// =====================================================================
console.log("\n=== 6. El total se calcula; no se acepta de afuera ===");
// =====================================================================

{
  /**
   * `leyendasTotal` se guarda para poder mostrar y ordenar sin recalcular,
   * pero NUNCA se toma del objeto que llega. Dos campos que dicen lo mismo
   * terminan discrepando, y el que discrepa es el que se acredita.
   */
  const { db, packs } = montar();

  await packs.guardar(COMO, {
    id: "mentiroso",
    nombre: "Pack Mentiroso",
    precioUYU: 500,
    leyendasBase: 100,
    leyendasRegalo: 50,
    // Un total inflado, como lo mandaría alguien desde la consola.
    leyendasTotal: 999999,
    itemsExclusivos: [],
  });

  const guardado = db._leer("tienda/packs/items/mentiroso");
  ok(guardado.leyendasTotal === 150, "el total guardado es la suma, no lo que vino", guardado.leyendasTotal);
  ok(leyendasDePaquete(guardado) === 150, "y `leyendasDePaquete` dice lo mismo");
}

// =====================================================================
console.log("\n=== 7. Editar un pack no toca las compras hechas ===");
// =====================================================================

{
  /**
   * Es la propiedad que hace que mover los packs a Firestore sea seguro.
   *
   * El webhook acredita `orden.leyendas`, congelado cuando se creó la orden, y
   * entrega `orden.itemsExclusivos`, congelado igual. Un pack editado a mitad
   * de camino no cambia lo que ya se vendió.
   *
   * Acá se comprueba la mitad que le toca a este módulo: que guardar de nuevo
   * escriba el pack y NADA más. Que la orden se congele lo comprueba
   * `pruebas/pagos.mjs` sobre `index.js`.
   */
  const { db, packs } = montar({ conPacks: [PAQUETES[2]] });

  const antes = db._rutas().filter((r) => r.startsWith("ordenes/"));
  ok(antes.length === 0, "no hay órdenes en este montaje");

  await packs.guardar(COMO, {
    ...normalizarPaquete(PAQUETES[2]),
    precioUYU: 1200,
    leyendasBase: 1600,
  });

  const guardado = db._leer("tienda/packs/items/premium");
  ok(guardado.precioUYU === 1200, "el pack quedó editado", guardado.precioUYU);

  const tocadas = db._rutas().filter((r) => !r.startsWith("catalogo/") && !r.startsWith("tienda/"));
  ok(tocadas.length === 0, "y no se tocó nada fuera del pack", tocadas);
}

// =====================================================================
console.log("\n=== 8. Borrar saca el pack y nada más ===");
// =====================================================================

{
  const { db, packs } = montar({ conPacks: [PAQUETES[0], PAQUETES[1]] });

  const r = await packs.borrar(COMO, "basico");
  ok(r.borrado === "basico", "avisa cuál borró", r.borrado);
  ok(!db._leer("tienda/packs/items/basico"), "y ya no está");
  ok(Boolean(db._leer("tienda/packs/items/popular")), "el otro sigue ahí");

  const otraVez = await capturar(() => packs.borrar(COMO, "basico"));
  ok(otraVez.error?.codigo === "not-found", "borrar dos veces avisa, no rompe", otraVez.error?.codigo);

  const sinId = await capturar(() => packs.borrar(COMO, ""));
  ok(sinId.error?.codigo === "invalid-argument", "y sin id tampoco");
}

// =====================================================================
console.log("\n=== 9. Todo pasa por el administrador ===");
// =====================================================================

{
  /**
   * Todas las escrituras exigen ser administrador. La lectura de la tienda no,
   * porque la hace cualquier jugador para ver qué comprar.
   */
  const db = crearFirestore(conCatalogo());
  const packs = crearPacks({
    db,
    error,
    marcaDeTiempo: () => "T",
    administradores: {
      exigir: async () => {
        throw error("permission-denied", "No sos administrador.");
      },
    },
  });

  for (const [nombre, fn] of [
    ["guardar", () => packs.guardar(COMO, { id: "xx", nombre: "X", precioUYU: 250, leyendasBase: 1, leyendasRegalo: 0 })],
    ["borrar", () => packs.borrar(COMO, "basico")],
    ["activar", () => packs.activar(COMO, "basico", false)],
    ["sembrar", () => packs.sembrar(COMO)],
    ["listarParaAdmin", () => packs.listarParaAdmin(COMO)],
  ]) {
    const r = await capturar(fn);
    ok(r.error?.codigo === "permission-denied", `${nombre} exige ser administrador`, r.error?.codigo);
  }

  // Y la tienda sigue pudiendo leer.
  const enLaTienda = await packs.listarParaLaTienda();
  ok(enLaTienda.length > 0, "pero la tienda lee sin ser administradora", enLaTienda.length);
}

// =====================================================================
console.log("\n=== 10. La validación pura no depende del servidor ===");
// =====================================================================

{
  // `problemasDelPaquete` corre en el panel para avisar y adentro de `guardar`
  // para decidir. Las dos veces tiene que decir lo mismo.
  ok(problemasDelPaquete(normalizarPaquete(PAQUETES[0])).length === 0, "la semilla es válida");

  ok(problemasDelPaquete({}).length > 0, "un objeto vacío no");
  ok(
    problemasDelPaquete({ id: "MAYUS", nombre: "X", precioUYU: 250, leyendasBase: 1, leyendasRegalo: 0 })
      .some((p) => /id/i.test(p)),
    "un id con mayúsculas se rechaza",
  );

  const repetidos = problemasDelPaquete({
    id: "xx", nombre: "X", precioUYU: 250, leyendasBase: 1, leyendasRegalo: 0,
    itemsExclusivos: ["a1", "a1"],
  });
  ok(repetidos.some((p) => /repetido/i.test(p)), "un artículo repetido se rechaza", repetidos);

  // Un regalo de cero es legítimo: el Básico no siempre tuvo uno.
  ok(
    problemasDelPaquete({ id: "xx", nombre: "X", precioUYU: 250, leyendasBase: 100, leyendasRegalo: 0 }).length === 0,
    "pero un regalo de cero está bien",
  );
}

console.log(fallos ? `\n❌ ${fallos} fallos` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
