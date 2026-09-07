/**
 * La tienda de personalización: comprar y equipar.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE DEFIENDE ACÁ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Cuatro cosas, y las cuatro son formas de conseguir gratis lo que se vende:
 *
 *   1. Que el precio salga del CATÁLOGO y no de la llamada. Si el cliente
 *      pudiera mandarlo, el dragón costaría una Leyenda.
 *   2. Que sin saldo no se compre. Y que al fallar no quede ni el cobro ni la
 *      posesión: media compra es peor que ninguna.
 *   3. Que comprar dos veces cobre una. Tanto si el jugador toca dos veces
 *      como si la red reintenta sola, que son dos problemas distintos.
 *   4. Que no se pueda equipar lo que no se compró. Sin esta, la tienda es
 *      decorativa.
 *
 * Se prueba contra un Firestore de mentira porque lo que hay que verificar es
 * el ORDEN de las operaciones dentro de la transacción, y eso no se ve leyendo
 * el código: se ve cuando el falso Firestore se queja de que alguien leyó
 * después de escribir, que es lo que Firestore de verdad rechaza en producción.
 */

import { crearTienda } from "../functions/tienda.js";
import { crearMoverLeyendas } from "../functions/leyendas.js";
import { MOTIVOS } from "../public/js/reglas/economia.js";
import {
  CATALOGO_INICIAL,
  CAMPO_EQUIPADO,
  TIPOS,
  problemasDelItem,
} from "../public/js/reglas/catalogo.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else {
    fallos++;
    console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : "");
  }
};

class E extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo;
  }
}
const error = (codigo, mensaje) => new E(codigo, mensaje);
const capturar = async (fn) => {
  try {
    return { valor: await fn() };
  } catch (e) {
    return { error: e };
  }
};

/**
 * Firestore de mentira, con subcolecciones.
 *
 * La ruta de un documento es su clave: `users/ana/items/el_dragon`. Eso
 * alcanza para lo único que hace falta —leer y escribir por id— y de paso hace
 * que las subcolecciones no necesiten una sola línea de código extra.
 *
 * Lo que sí replica en serio es la regla que Firestore hace cumplir de verdad:
 * dentro de una transacción, TODAS las lecturas van antes que las escrituras.
 * Sin eso, una prueba en verde acá podría fallar en producción.
 */
function crearFirestore(inicial = {}) {
  const docs = new Map(Object.entries(inicial));

  const coleccion = (prefijo) => ({
    doc: (id) => documento(`${prefijo}/${id}`),
    async get() {
      const filas = [...docs.entries()]
        .filter(([r]) => r.startsWith(`${prefijo}/`) && !r.slice(prefijo.length + 1).includes("/"))
        .map(([r, d]) => ({ id: r.slice(prefijo.length + 1), data: () => ({ ...d }) }));
      return { size: filas.length, forEach: (fn) => filas.forEach(fn) };
    },
  });

  const documento = (ruta) => ({
    ruta,
    id: ruta.split("/").pop(),
    collection: (sub) => coleccion(`${ruta}/${sub}`),
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

  return {
    collection: coleccion,

    /**
     * Todas las subcolecciones con un mismo nombre, en cualquier perfil.
     *
     * Es lo que usa `borrarItem` para preguntar "¿alguien compró esto?". Acá
     * se resuelve mirando las rutas: cualquiera que TERMINE en `/items/algo`
     * es una posesión, sin importar de quién.
     */
    collectionGroup: (nombre) => ({
      async get() {
        const filas = [...docs.entries()]
          .filter(([r]) => r.includes(`/${nombre}/`))
          .map(([r, d]) => ({ id: r.split("/").pop(), ref: { path: r }, data: () => ({ ...d }) }));
        return { size: filas.length, forEach: (fn) => filas.forEach(fn) };
      },
    }),

    async runTransaction(cuerpo) {
      let escribio = false;
      const pendientes = [];
      const r = await cuerpo({
        async get(ref) {
          if (escribio) throw error("failed-precondition", "Lectura después de escritura");
          const d = docs.get(ref.ruta);
          return { exists: Boolean(d), data: () => (d ? { ...d } : undefined) };
        },
        set(ref, datos, opciones) {
          escribio = true;
          pendientes.push([ref.ruta, datos, opciones?.merge]);
        },
        update(ref, datos) {
          escribio = true;
          pendientes.push([ref.ruta, datos, true]);
        },
      });
      for (const [ruta, datos, fusionar] of pendientes) {
        docs.set(ruta, fusionar ? { ...(docs.get(ruta) ?? {}), ...datos } : datos);
      }
      return r;
    },
    _leer: (r) => docs.get(r),
    _rutas: () => [...docs.keys()],
  };
}

/** Monta la tienda sobre un catálogo y un saldo dados. */
function montar({ saldo = 5000, catalogo = CATALOGO_INICIAL } = {}) {
  const inicial = { "users/ana": { credits: saldo, username: "Ana" } };
  for (const item of catalogo) inicial[`catalogo/${item.id}`] = { ...item };

  const db = crearFirestore(inicial);
  const moverLeyendas = crearMoverLeyendas({
    db,
    usuarios: "users",
    campoSaldo: "credits",
    marcaDeTiempo: () => "T",
    error,
  });

  const tienda = crearTienda({
    db,
    moverLeyendas,
    marcaDeTiempo: () => "T",
    error,
    motivoCompra: MOTIVOS.COMPRA_PERSONALIZACION,
    administradores: { exigir: async () => ({ uid: "admin" }) },
  });

  return { db, tienda };
}

// Tres artículos del catálogo real, elegidos por su PRECIO y no por su nombre:
// uno caro, uno intermedio y uno gratis. Si mañana cambian de precio desde el
// panel, la semilla del código —que es la que monta estas pruebas— no cambia.
const DRAGON = "el_dragon"; // el más caro
const ZORRO = "el_zorro"; // uno intermedio
const REY = "predeterminado"; // 0

/**
 * El precio que dice la semilla.
 *
 * Se lee en vez de escribirse a mano. La semilla es lo que monta el catálogo
 * de estas pruebas, así que comparar contra ella es exactamente lo que hay que
 * comprobar —que se cobra lo del catálogo y no lo que mande el cliente— y de
 * paso sobrevive a que mañana el dragón cueste otra cosa.
 */
const precioDe = (id) => CATALOGO_INICIAL.find((i) => i.id === id).precio;
// Y una insignia barata: la sección 8 compra dos cosas con un solo saldo, así
// que si acá entrara la insignia cara la prueba fallaría por falta de fondos y
// diría "no se puede equipar" cuando el problema sería otro.
const INSIGNIA = "estratega";

// =====================================================================
console.log("\n=== 1. Comprar cobra el precio del catálogo, no el que le manden ===");
// =====================================================================

{
  const { db, tienda } = montar({ saldo: 5000 });
  const r = await tienda.comprar("ana", DRAGON);

  ok(r.precio === precioDe(DRAGON), "cobra el precio que dice el catálogo", r.precio);
  ok(
    db._leer("users/ana").credits === 5000 - precioDe(DRAGON),
    "y el saldo baja exactamente en eso",
    db._leer("users/ana").credits,
  );
  ok(Boolean(db._leer(`users/ana/items/${DRAGON}`)), "queda anotado que lo tiene");
  ok(db._leer(`users/ana/items/${DRAGON}`).tipo === TIPOS.AVATAR, "con su tipo");
  ok(
    db._leer(`users/ana/items/${DRAGON}`).precioPagado === precioDe(DRAGON),
    "y con lo que pagó, para poder auditarlo después",
  );

  // El asiento del libro mayor: sin él el saldo bajaría sin explicación.
  const asiento = db._rutas().find((r) => r.startsWith("movimientos/"));
  ok(Boolean(asiento), "deja asiento en el libro mayor", db._rutas());
  ok(
    db._leer(asiento)?.motivo === MOTIVOS.COMPRA_PERSONALIZACION,
    "con el motivo de personalización",
    db._leer(asiento)?.motivo,
  );
}

// =====================================================================
console.log("\n=== 2. Sin saldo no se compra, y no queda media compra ===");
// =====================================================================

{
  const { db, tienda } = montar({ saldo: 100 });
  const { error: e } = await capturar(() => tienda.comprar("ana", DRAGON));

  ok(Boolean(e), "falla la compra", e?.mensaje);
  ok(db._leer("users/ana").credits === 100, "el saldo queda intacto", db._leer("users/ana").credits);
  ok(
    !db._leer(`users/ana/items/${DRAGON}`),
    "y NO queda anotado como comprado: media compra sería peor que ninguna",
  );
}

// =====================================================================
console.log("\n=== 3. Comprar dos veces cobra una ===");
// =====================================================================

{
  const { db, tienda } = montar({ saldo: 5000 });
  await tienda.comprar("ana", ZORRO);
  const saldoTrasLaPrimera = db._leer("users/ana").credits;

  const { error: e } = await capturar(() => tienda.comprar("ana", ZORRO));

  ok(e?.codigo === "already-exists", "la segunda avisa que ya lo tiene", e?.codigo);
  ok(
    db._leer("users/ana").credits === saldoTrasLaPrimera,
    "y no vuelve a cobrar",
    db._leer("users/ana").credits,
  );
}

// =====================================================================
console.log("\n=== 4. Lo que no está a la venta no se compra ===");
// =====================================================================

{
  const apagado = CATALOGO_INICIAL.map((i) =>
    i.id === ZORRO ? { ...i, activo: false } : i,
  );
  const { db, tienda } = montar({ saldo: 5000, catalogo: apagado });
  const { error: e } = await capturar(() => tienda.comprar("ana", ZORRO));

  ok(e?.codigo === "failed-precondition", "un artículo desactivado se rechaza", e?.codigo);
  ok(db._leer("users/ana").credits === 5000, "sin tocar el saldo");
}

{
  const { tienda } = montar();
  const { error: e } = await capturar(() => tienda.comprar("ana", "no-existe"));
  ok(e?.codigo === "not-found", "un id inventado se rechaza", e?.codigo);
}

// =====================================================================
console.log("\n=== 5. Los gratuitos no ensucian el libro mayor ===");
// =====================================================================

{
  const { db, tienda } = montar({ saldo: 5000 });
  await tienda.comprar("ana", REY);

  ok(Boolean(db._leer(`users/ana/items/${REY}`)), "el artículo de precio cero se entrega igual");
  ok(db._leer("users/ana").credits === 5000, "sin mover el saldo");
  ok(
    !db._rutas().some((r) => r.startsWith("movimientos/")),
    "y sin asiento: un movimiento de cero Leyendas es ruido",
    db._rutas().filter((r) => r.startsWith("movimientos/")),
  );
}

// =====================================================================
console.log("\n=== 6. Equipar exige haberlo comprado ===");
// =====================================================================

{
  const { db, tienda } = montar({ saldo: 5000 });

  const { error: e } = await capturar(() => tienda.equipar("ana", DRAGON));
  ok(e?.codigo === "permission-denied", "sin comprarlo, no se equipa", e?.codigo);
  ok(!db._leer("users/ana").avatar, "y el perfil no se toca");

  await tienda.comprar("ana", DRAGON);
  const r = await tienda.equipar("ana", DRAGON);

  ok(r.campo === CAMPO_EQUIPADO[TIPOS.AVATAR], "comprado, se equipa en el campo del tipo", r.campo);
  ok(db._leer("users/ana").avatar === DRAGON, "y queda puesto en el perfil");
  ok(db._leer("users/ana").username === "Ana", "sin pisar el resto del perfil");
}

// =====================================================================
console.log("\n=== 7. Cambiar de avatar pisa el anterior, no acumula ===");
// =====================================================================

{
  const { db, tienda } = montar({ saldo: 5000 });
  await tienda.comprar("ana", ZORRO);
  await tienda.comprar("ana", DRAGON);

  await tienda.equipar("ana", ZORRO);
  await tienda.equipar("ana", DRAGON);

  ok(db._leer("users/ana").avatar === DRAGON, "queda el último", db._leer("users/ana").avatar);

  // El perfil guarda UN id por tipo: por eso no hace falta desequipar nada, y
  // por eso no puede haber dos avatares puestos a la vez.
  const puestos = Object.values(TIPOS).map((t) => db._leer("users/ana")[CAMPO_EQUIPADO[t]]);
  ok(puestos.filter(Boolean).length === 1, "y sólo hay una cosa puesta", puestos);
}

// =====================================================================
console.log("\n=== 8. Equipar de un tipo no toca los otros ===");
// =====================================================================

{
  const { db, tienda } = montar({ saldo: 5000 });
  await tienda.comprar("ana", DRAGON);
  // La insignia no se compra: se otorga. Ver la sección 17.
  await tienda.otorgar("ana", INSIGNIA);
  await tienda.equipar("ana", DRAGON);
  await tienda.equipar("ana", INSIGNIA);

  const perfil = db._leer("users/ana");
  ok(perfil.avatar === DRAGON, "el avatar sigue puesto");
  ok(perfil.insignia === INSIGNIA, "y la insignia también");
}

// =====================================================================
console.log("\n=== 9. `misItems` cuenta lo que tiene y lo que lleva puesto ===");
// =====================================================================

{
  const { tienda } = montar({ saldo: 5000 });
  await tienda.comprar("ana", ZORRO);
  await tienda.equipar("ana", ZORRO);

  const r = await tienda.misItems("ana");
  ok(r.tengo.length === 1 && r.tengo[0].id === ZORRO, "devuelve lo comprado", r.tengo);
  ok(r.equipado.avatar === ZORRO, "y lo equipado por tipo", r.equipado);
  ok(r.equipado.insignia === null, "con null en los tipos sin nada puesto", r.equipado);
}

// =====================================================================
console.log("\n=== 10. La semilla del catálogo no pisa lo que ya está ===");
// =====================================================================

{
  // Un catálogo con un precio ya cambiado por el administrador.
  const tocado = [{ ...CATALOGO_INICIAL.find((i) => i.id === ZORRO), precio: 1 }];
  const { db, tienda } = montar({ catalogo: tocado });

  const r = await tienda.sembrarCatalogo({ auth: { uid: "admin" } });

  ok(r.creados === CATALOGO_INICIAL.length - 1, "crea los que faltaban", r);
  ok(
    db._leer(`catalogo/${ZORRO}`).precio === 1,
    "y respeta el precio que el administrador había cambiado",
    db._leer(`catalogo/${ZORRO}`).precio,
  );
}

{
  // Sin sesión de administrador no se siembra.
  const db = crearFirestore();
  const tienda = crearTienda({
    db,
    moverLeyendas: async () => ({ aplicado: true, saldo: 0 }),
    marcaDeTiempo: () => "T",
    error,
    motivoCompra: MOTIVOS.COMPRA_PERSONALIZACION,
    administradores: {
      exigir: async () => {
        throw error("permission-denied", "No sos administrador.");
      },
    },
  });

  const { error: e } = await capturar(() => tienda.sembrarCatalogo({}));
  ok(e?.codigo === "permission-denied", "sembrar exige ser administrador", e?.codigo);
  ok(db._rutas().length === 0, "y no escribe nada al rechazar");
}

// =====================================================================
console.log("\n=== 11. El panel ve TODO el catálogo, apagados incluidos ===");
// =====================================================================

{
  const conApagado = CATALOGO_INICIAL.map((i) =>
    i.id === ZORRO ? { ...i, activo: false } : i,
  );
  const { tienda } = montar({ catalogo: conApagado });

  const r = await tienda.listarCatalogo({ auth: { uid: "admin" } });

  ok(r.items.length === CATALOGO_INICIAL.length, "devuelve todos", r.items.length);
  ok(
    r.items.some((i) => i.id === ZORRO && i.activo === false),
    "incluye el desactivado: es justo el que se va a querer volver a encender",
  );
}

// =====================================================================
console.log("\n=== 12. Crear y editar son la misma operación ===");
// =====================================================================

const NUEVO = {
  id: "avatar-lobo",
  tipo: "avatar",
  nombre: "El Lobo",
  descripcion: "Caza solo.",
  precio: 900,
  imagen: "🐺",
  activo: true,
  orden: 45,
};

{
  const { db, tienda } = montar();
  const como = { auth: { uid: "admin" } };

  const creado = await tienda.guardarItem(como, NUEVO);
  ok(creado.creado === true, "la primera vez avisa que lo creó");
  ok(db._leer("catalogo/avatar-lobo").precio === 900, "con su precio");

  const editado = await tienda.guardarItem(como, { ...NUEVO, precio: 1200 });
  ok(editado.creado === false, "la segunda avisa que lo pisó", editado);
  ok(db._leer("catalogo/avatar-lobo").precio === 1200, "y el precio cambió");
  ok(db._leer("catalogo/avatar-lobo").nombre === "El Lobo", "sin perder el resto");
}

{
  // El precio es lo único que mueve dinero, así que es lo más estricto: uno
  // negativo REGALARÍA Leyendas, porque el mismo `moverLeyendas` que cobra
  // sabe sumar.
  const { db, tienda } = montar();
  const { error: e } = await capturar(() =>
    tienda.guardarItem({ auth: { uid: "admin" } }, { ...NUEVO, precio: -500 }));

  ok(e?.codigo === "invalid-argument", "un precio negativo se rechaza", e?.codigo);
  ok(!db._leer("catalogo/avatar-lobo"), "y no se guarda nada");
}

{
  const { tienda } = montar();
  const { error: e } = await capturar(() =>
    tienda.guardarItem({ auth: { uid: "admin" } }, { ...NUEVO, tipo: "sombrero" }));
  ok(e?.codigo === "invalid-argument", "un tipo inventado se rechaza", e?.mensaje);
}

// =====================================================================
console.log("\n=== 13. Apagar no le quita nada a quien ya compró ===");
// =====================================================================

{
  const { db, tienda } = montar({ saldo: 5000 });
  const como = { auth: { uid: "admin" } };

  await tienda.comprar("ana", ZORRO);
  await tienda.equipar("ana", ZORRO);
  await tienda.activarItem(como, ZORRO, false);

  ok(db._leer(`catalogo/${ZORRO}`).activo === false, "queda fuera de la venta");
  ok(Boolean(db._leer(`users/ana/items/${ZORRO}`)), "pero Ana lo sigue teniendo");
  ok(db._leer("users/ana").avatar === ZORRO, "y lo sigue llevando puesto");

  // Y no se puede volver a comprar mientras esté apagado.
  const { error: e } = await capturar(() => tienda.comprar("beto", ZORRO));
  ok(e?.codigo === "failed-precondition", "nadie más puede comprarlo", e?.codigo);
}

// =====================================================================
console.log("\n=== 14. Borrar sólo lo que nadie compró ===");
// =====================================================================

{
  const { db, tienda } = montar({ saldo: 5000 });
  const como = { auth: { uid: "admin" } };

  await tienda.comprar("ana", ZORRO);
  const { error: e } = await capturar(() => tienda.borrarItem(como, ZORRO));

  ok(e?.codigo === "failed-precondition", "se niega si alguien lo tiene", e?.codigo);
  ok(/desactivalo/i.test(e?.message ?? ""), "y dice qué hacer en su lugar", e?.message);
  ok(Boolean(db._leer(`catalogo/${ZORRO}`)), "el artículo sigue ahí");
}

{
  const { db, tienda } = montar();
  const r = await tienda.borrarItem({ auth: { uid: "admin" } }, DRAGON);

  ok(r.borrado === true, "lo que nadie compró sí se borra");
  ok(!db._leer(`catalogo/${DRAGON}`), "y desaparece del catálogo");
}

// =====================================================================
console.log("\n=== 15. Todo el CRUD exige ser administrador ===");
// =====================================================================

{
  const db = crearFirestore({ "catalogo/x": { tipo: "avatar", nombre: "X", precio: 0, imagen: "x", activo: true } });
  const tienda = crearTienda({
    db,
    moverLeyendas: async () => ({ aplicado: true, saldo: 0 }),
    marcaDeTiempo: () => "T",
    error,
    motivoCompra: MOTIVOS.COMPRA_PERSONALIZACION,
    administradores: {
      exigir: async () => {
        throw error("permission-denied", "No sos administrador.");
      },
    },
  });

  // Se prueban TODAS. Una sola dejaría abierta la posibilidad de que a alguna
  // se le haya olvidado la comprobación, que es exactamente el error que nadie
  // nota hasta que lo usan.
  const operaciones = [
    ["listarCatalogo", () => tienda.listarCatalogo({})],
    ["guardarItem", () => tienda.guardarItem({}, NUEVO)],
    ["activarItem", () => tienda.activarItem({}, "x", false)],
    ["borrarItem", () => tienda.borrarItem({}, "x")],
    ["apagarCatalogoViejo", () => tienda.apagarCatalogoViejo({})],
  ];

  for (const [nombre, fn] of operaciones) {
    const { error: e } = await capturar(fn);
    ok(e?.codigo === "permission-denied", `${nombre} exige administrador`, e?.codigo);
  }

  ok(db._leer("catalogo/x").nombre === "X", "y el catálogo quedó intacto");
}

// =====================================================================
console.log("\n=== 16. La semilla es válida y sus imágenes existen ===");
// =====================================================================

/**
 * Lo que se defiende: que el catálogo de arranque no apunte a archivos que no
 * están.
 *
 * Es el error que no falla en ningún lado. La siembra escribe el documento sin
 * chistar, el servidor cobra sin chistar, y lo único que pasa es que en la
 * tienda hay un hueco donde iba una figura — y en la barra, un avatar que el
 * jugador pagó y no se ve. Se descubre mirando, o no se descubre.
 */
{
  const { readFileSync, existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const raiz = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

  const { imagenEsArchivo } = await import("../public/js/reglas/catalogo.js");

  let invalidos = 0;
  let faltantes = [];
  const ids = new Set();
  let repetidos = [];

  for (const item of CATALOGO_INICIAL) {
    if (problemasDelItem(item).length) invalidos++;
    if (ids.has(item.id)) repetidos.push(item.id);
    ids.add(item.id);
    if (imagenEsArchivo(item.imagen) && !existsSync(join(raiz, "public", item.imagen))) {
      faltantes.push(`${item.id} → ${item.imagen}`);
    }
  }

  ok(invalidos === 0, "todos los artículos de la semilla son válidos", invalidos);
  ok(repetidos.length === 0, "ningún id repetido", repetidos);
  ok(faltantes.length === 0, "todas las imágenes existen en el disco", faltantes);

  // Los ids viajan en URLs y en rutas de Firestore. Un acento ahí se convierte
  // en `%C3%B3n` y se arrastra a cada comparación.
  const conAcento = CATALOGO_INICIAL.filter((i) => !/^[a-z0-9_-]+$/.test(i.id)).map((i) => i.id);
  ok(conAcento.length === 0, "ningún id tiene acentos ni mayúsculas", conAcento);

  // Y algo tiene que haber de cada tipo: una tienda con una pestaña vacía es
  // una pestaña que no debería existir.
  for (const tipo of Object.values(TIPOS)) {
    const cuantos = CATALOGO_INICIAL.filter((i) => i.tipo === tipo).length;
    ok(cuantos > 0, `hay artículos de tipo ${tipo}`, cuantos);
  }
}
// =====================================================================
console.log("\n=== 17. Las insignias NO se venden: se otorgan ===");
// =====================================================================

{
  // Ésta es la comprobación que convierte la decisión en una regla. Sin ella,
  // "las insignias son logros" es una opinión que vive en el frontend, y el
  // frontend se saltea escribiendo una línea en la consola del navegador.
  const { db, tienda } = montar({ saldo: 100000 });

  const { error: e } = await capturar(() => tienda.comprar("ana", INSIGNIA));
  ok(e?.codigo === "failed-precondition", "comprarla se rechaza aunque sobre el saldo", e?.codigo);
  ok(/gana jugando/.test(e?.message ?? ""), "y el mensaje dice por qué", e?.message);
  ok(!db._leer(`users/ana/items/${INSIGNIA}`), "no queda anotada");
  ok(db._leer("users/ana").credits === 100000, "y no se cobró nada");

  // Meterla dentro de un pack tampoco: la comprobación es por artículo, no
  // por llamada.
  const { error: e2 } = await capturar(() => tienda.comprarVarios("ana", [ZORRO, INSIGNIA]));
  ok(e2?.codigo === "failed-precondition", "colarla en un pack tampoco funciona", e2?.codigo);
  ok(!db._leer(`users/ana/items/${ZORRO}`), "y el pack entero no se aplica: o todo o nada");
}

{
  const { db, tienda } = montar({ saldo: 0 });
  const r = await tienda.otorgar("ana", INSIGNIA);

  ok(r.nuevo === true, "otorgarla funciona sin una sola Leyenda");
  ok(db._leer(`users/ana/items/${INSIGNIA}`).origen === "logro", "queda marcada como logro");
  ok(db._leer(`users/ana/items/${INSIGNIA}`).precioPagado === 0, "y con precio pagado cero");

  // Sin asiento en el libro mayor: no se movió saldo, así que no hay nada que
  // asentar. Un asiento de cero sería una mentira auditable.
  ok(!db._rutas().some((x) => x.startsWith("movimientos/")), "no toca el libro mayor");

  const otra = await tienda.otorgar("ana", INSIGNIA);
  ok(otra.nuevo === false, "otorgarla dos veces no la duplica");

  await tienda.equipar("ana", INSIGNIA);
  ok(db._leer("users/ana").insignia === INSIGNIA, "y una vez otorgada se puede equipar");
}

// =====================================================================
console.log("\n=== 18. El pack descuenta por cantidad de artículos NUEVOS ===");
// =====================================================================

{
  const { db, tienda } = montar({ saldo: 5000 });
  const tres = [DRAGON, ZORRO, "mago"];
  const suma = tres.reduce((s, id) => s + precioDe(id), 0);

  const r = await tienda.comprarVarios("ana", tres);

  ok(r.descuento === 0.25, "tres artículos descuentan 25%", r.descuento);
  ok(r.sinDescuento === suma, "informa lo que costaban sueltos", r.sinDescuento);
  ok(r.total === Math.floor(suma * 0.75), "y cobra el total con descuento", r.total);
  ok(db._leer("users/ana").credits === 5000 - r.total, "el saldo baja en el total, no en la suma");
  ok(r.comprados.length === 3, "los tres quedan anotados");
  for (const id of tres) ok(Boolean(db._leer(`users/ana/items/${id}`)), `  ${id} es suyo`);

  // Un solo asiento, no tres: el pack es UNA compra.
  const asientos = db._rutas().filter((x) => x.startsWith("movimientos/"));
  ok(asientos.length === 1, "deja un solo asiento en el libro mayor", asientos.length);
}

{
  const { tienda } = montar({ saldo: 5000 });
  const r = await tienda.comprarVarios("ana", [DRAGON, ZORRO]);
  const suma = precioDe(DRAGON) + precioDe(ZORRO);
  ok(r.descuento === 0.15, "dos descuentan 15%", r.descuento);
  ok(r.total === Math.floor(suma * 0.85), "con su total", r.total);
}

{
  const { tienda } = montar({ saldo: 5000 });
  const r = await tienda.comprarVarios("ana", [DRAGON]);
  ok(r.descuento === 0, "uno solo no descuenta nada", r.descuento);
  ok(r.total === precioDe(DRAGON), "y paga el precio de lista", r.total);
}

{
  // Lo que impide abaratar el pack metiendo algo ya comprado.
  const { tienda } = montar({ saldo: 5000 });
  await tienda.comprar("ana", ZORRO);

  const r = await tienda.comprarVarios("ana", [ZORRO, DRAGON]);
  ok(r.descuento === 0, "un repetido no cuenta para el descuento", r.descuento);
  ok(r.total === precioDe(DRAGON), "se paga sólo lo nuevo, sin rebaja", r.total);
  ok(r.yaTenia.length === 1 && r.yaTenia[0] === ZORRO, "y se avisa cuál ya tenía", r.yaTenia);
}

{
  const { tienda } = montar({ saldo: 5000 });
  const { error: e } = await capturar(() =>
    tienda.comprarVarios("ana", [DRAGON, ZORRO, "mago", "orco"]));
  ok(e?.codigo === "invalid-argument", "más de tres se rechaza", e?.codigo);

  const { error: e2 } = await capturar(() => tienda.comprarVarios("ana", []));
  ok(e2?.codigo === "invalid-argument", "y un pack vacío también", e2?.codigo);
}

{
  // Sin saldo para el total, no se compra NADA. Media compra dejaría al
  // jugador con un avatar cobrado y dos no, y ninguna forma de saber cuál.
  const { db, tienda } = montar({ saldo: 200 });
  const { error: e } = await capturar(() => tienda.comprarVarios("ana", [DRAGON, ZORRO]));

  ok(e?.codigo === "failed-precondition", "sin saldo para el total se rechaza", e?.codigo);
  ok(db._leer("users/ana").credits === 200, "el saldo queda intacto");
  ok(!db._leer(`users/ana/items/${DRAGON}`), "y no queda ni uno de los dos");
  ok(!db._leer(`users/ana/items/${ZORRO}`), "  (ni el otro)");
}

// =====================================================================
console.log("\n=== 19. El primero de cada tipo se pone solo ===");
// =====================================================================

{
  const { db, tienda } = montar({ saldo: 5000 });

  await tienda.comprar("ana", ZORRO);
  ok(db._leer("users/ana").avatar === ZORRO, "el primer avatar queda puesto sin pedirlo");

  await tienda.comprar("ana", DRAGON);
  ok(db._leer("users/ana").avatar === ZORRO, "el segundo NO pisa al que ya estaba");
}

{
  // Un pack de dos tipos pone uno de cada uno, no dos del mismo.
  const { db, tienda } = montar({ saldo: 5000 });
  const r = await tienda.comprarVarios("ana", [ZORRO, DRAGON, "dorso_rojo"]);

  ok(db._leer("users/ana").avatar === ZORRO, "se pone el primer avatar del pack");
  ok(db._leer("users/ana").dorso === "dorso_rojo", "y el primer dorso");
  ok(Object.keys(r.equipado).length === 2, "y nada más", r.equipado);
}

// =====================================================================
console.log("\n=== 20. Desequipar deja el campo en null ===");
// =====================================================================

{
  const { db, tienda } = montar({ saldo: 5000 });
  await tienda.otorgar("ana", INSIGNIA);
  await tienda.equipar("ana", INSIGNIA);
  await tienda.comprar("ana", ZORRO);

  const r = await tienda.desequipar("ana", "insignia");

  ok(r.equipado === null, "avisa que quedó sin nada puesto");
  ok(db._leer("users/ana").insignia === null, "y el perfil lo refleja");
  ok(db._leer("users/ana").avatar === ZORRO, "sin tocar los otros tipos");
  ok(Boolean(db._leer(`users/ana/items/${INSIGNIA}`)), "y sin quitarle lo que tiene");

  const { error: e } = await capturar(() => tienda.desequipar("ana", "sombrero"));
  ok(e?.codigo === "invalid-argument", "un tipo inventado se rechaza", e?.codigo);
}

// =====================================================================
console.log("\n=== 21. Apagar el catálogo de demostración ===");
// =====================================================================

{
  // El catálogo real MÁS los restos del de mentira, que es lo que hay en
  // producción: sembrar no pisa lo que ya está, así que los viejos siguen ahí.
  const viejos = [
    { id: "avatar-dragon", tipo: "avatar", nombre: "Dragón viejo", precio: 100, imagen: "🐉", activo: true, orden: 1 },
    { id: "insignia-corona", tipo: "insignia", nombre: "Corona vieja", precio: 100, imagen: "🏆", activo: true, orden: 2 },
  ];
  const { db, tienda } = montar({ catalogo: [...CATALOGO_INICIAL, ...viejos] });
  const como = { auth: { uid: "admin" } };

  // Primero mirar, sin tocar. Apagar diez artículos sin ver cuáles es la clase
  // de botón que nadie se anima a tocar.
  const ensayo = await tienda.apagarCatalogoViejo(como, { simular: true });
  ok(ensayo.simulado === true, "simular avisa que no tocó nada");
  ok(ensayo.candidatos.length === 2, "encuentra los dos de demostración", ensayo.candidatos.length);
  ok(db._leer("catalogo/avatar-dragon").activo === true, "y efectivamente no los tocó");

  const r = await tienda.apagarCatalogoViejo(como);
  ok(r.apagados === 2, "apaga los dos", r.apagados);
  ok(db._leer("catalogo/avatar-dragon").activo === false, "el avatar viejo queda apagado");
  ok(db._leer("catalogo/insignia-corona").activo === false, "la insignia vieja también");

  // Lo importante: NO se lleva puesto nada de lo bueno. Un criterio parecido y
  // tentador —"todo lo que no termine en .webp"— apagaría los dorsos, que son
  // PNG legítimos y están en uso.
  ok(db._leer(`catalogo/${DRAGON}`).activo === true, "el dragón de verdad sigue encendido");
  ok(db._leer("catalogo/dorso_azul").activo === true, "y los dorsos PNG también");
  ok(db._leer("catalogo/dorso_rojo").activo === true, "  (los dos)");
  ok(db._leer(`catalogo/${INSIGNIA}`).activo === true, "y las insignias de verdad");

  // Apaga, no borra: si alguien alcanzó a comprar uno, el documento del
  // catálogo es lo que le da nombre e imagen a lo que tiene.
  ok(Boolean(db._leer("catalogo/avatar-dragon")), "no borra: el documento sigue ahí");

  const otraVez = await tienda.apagarCatalogoViejo(como);
  ok(otraVez.apagados === 0, "correrlo dos veces no hace nada la segunda", otraVez.apagados);
}


console.log(fallos ? `\n❌ ${fallos} fallos` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
