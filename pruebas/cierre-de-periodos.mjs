/**
 * El cierre de los rankings: cada juego cierra lo suyo, y nada más.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE SE DEFIENDE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El cierre paga Leyendas, así que sus errores son de plata:
 *
 *   · cerrar un juego con las filas de otro, o pagarle a alguien dos veces
 *     por la misma semana;
 *   · tomar por juego lo que no lo es. En `rankings/` viven, además de las
 *     marcas de los juegos, los períodos de la estructura vieja
 *     —`rankings/semanal_2026-09-07`—, que quedaron como respaldo. Cerrar uno
 *     de ésos como si fuera un juego escribiría documentos sin sentido debajo
 *     de él. La sección 2 lo prueba con nombre propio;
 *   · volver a pagar una fila que ya cobró, ahora que la clave del premio
 *     cambió —lleva el juego— y un cierre que hubiera quedado a medias con la
 *     clave vieja no la reconocería;
 *   · que un juego que falla deje sin cerrar a los demás.
 *
 * Con `cierre-de-periodos.js` de verdad y el libro mayor de verdad
 * (`leyendas.js`), sobre un Firestore de mentira que aplica la regla de
 * Firestore: ninguna lectura después de una escritura.
 */

import { crearCierreDePeriodos } from "../functions/cierre-de-periodos.js";
import { crearMoverLeyendas } from "../functions/leyendas.js";
import { clavePeriodo, ZONA_POR_DEFECTO } from "../public/js/reglas/ranking.js";
import { MOTIVOS, premioPorPuesto } from "../public/js/reglas/economia.js";

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

// ============================== Firestore con la regla lectura/escritura

function crearFirestore(inicial = {}) {
  const docs = new Map(Object.entries(inicial).map(([r, d]) => [r, structuredClone(d)]));
  // Una ruta que, al leerse como consulta, falla: para probar que un juego
  // roto no frena a los demás.
  const perillas = { fallarEn: null };

  const hijos = (prefijo) =>
    [...docs.keys()].filter((r) => r.startsWith(`${prefijo}/`) && !r.slice(prefijo.length + 1).includes("/"));

  const documento = (ruta) => ({
    ruta,
    id: ruta.split("/").pop(),
    async get() {
      const d = docs.get(ruta);
      return { exists: Boolean(d), id: ruta.split("/").pop(), data: () => (d ? structuredClone(d) : undefined) };
    },
    async set(datos, opciones) {
      docs.set(ruta, opciones?.merge ? { ...(docs.get(ruta) ?? {}), ...structuredClone(datos) } : structuredClone(datos));
    },
  });

  const coleccion = (prefijo) => ({
    doc: (id) => documento(`${prefijo}/${id}`),

    /**
     * Como el de verdad: también devuelve los documentos que NO existen pero
     * tienen subcolecciones debajo. Un período abierto de la estructura vieja
     * es exactamente eso.
     */
    async listDocuments() {
      const ids = new Set();
      for (const r of docs.keys()) {
        if (r.startsWith(`${prefijo}/`)) ids.add(r.slice(prefijo.length + 1).split("/")[0]);
      }
      return [...ids].map((id) => documento(`${prefijo}/${id}`));
    },

    orderBy(campo, sentido) {
      return {
        limit(n) {
          return {
            async get() {
              if (perillas.fallarEn && prefijo.startsWith(perillas.fallarEn)) {
                throw new Error(`No se pudo leer ${prefijo}`);
              }
              const filas = hijos(prefijo)
                .map((r) => ({ id: r.split("/").pop(), ref: documento(r), datos: docs.get(r) }))
                .sort((a, b) =>
                  sentido === "desc"
                    ? Number(b.datos[campo] ?? 0) - Number(a.datos[campo] ?? 0)
                    : Number(a.datos[campo] ?? 0) - Number(b.datos[campo] ?? 0))
                .slice(0, n);
              return { docs: filas.map((f) => ({ id: f.id, ref: f.ref, data: () => structuredClone(f.datos) })) };
            },
          };
        },
      };
    },
  });

  return {
    perillas,
    collection: coleccion,
    async runTransaction(cuerpo) {
      let escribio = false;
      const pendientes = [];
      const r = await cuerpo({
        async get(ref) {
          if (escribio) throw error("failed-precondition", `Lectura de ${ref.ruta} después de escribir`);
          const d = docs.get(ref.ruta);
          return { exists: Boolean(d), data: () => (d ? structuredClone(d) : undefined) };
        },
        set(ref, datos, opciones) {
          escribio = true;
          pendientes.push([ref.ruta, datos, Boolean(opciones?.merge)]);
        },
      });
      for (const [ruta, datos, fusionar] of pendientes) {
        docs.set(ruta, fusionar ? { ...(docs.get(ruta) ?? {}), ...structuredClone(datos) } : structuredClone(datos));
      }
      return r;
    },
    leer: (r) => docs.get(r),
    rutas: () => [...docs.keys()],
  };
}

// ================================================================ montaje

const FECHA = new Date("2026-09-16T15:00:00Z"); // un miércoles
const SEMANA = clavePeriodo("semanal", FECHA, ZONA_POR_DEFECTO);
const MES = clavePeriodo("mensual", FECHA, ZONA_POR_DEFECTO);

const vacio = () => ({ credits: 0, creditosComprados: 0, creditosGanados: 0 });

function montar(inicial) {
  const db = crearFirestore(inicial);
  const moverLeyendas = crearMoverLeyendas({
    db, usuarios: "users", campoSaldo: "credits", marcaDeTiempo: () => "T", error,
  });
  const puestosMensuales = [];
  const cierre = crearCierreDePeriodos({
    db,
    moverLeyendas,
    motivo: MOTIVOS.PREMIO_RANKING,
    insignias: { registrarPuestoMensual: async (uid, puesto) => puestosMensuales.push([uid, puesto]) },
    marcaDeTiempo: () => "T",
    agregarAArray: (valor) => ({ __union: valor }),
    logger: null,
  });
  return { db, cierre, puestosMensuales };
}

/** Una fila del ranking de un juego. */
const fila = (juego, clave, uid, puntos, extra = {}) => ({
  [`rankings/${juego}/periodos/${clave}/jugadores/${uid}`]: { uid, jugadorId: uid, puntos, ...extra },
});

const saldo = (db, uid) => db.leer(`users/${uid}`)?.credits ?? 0;
const premio1 = premioPorPuesto(1, "semanal").leyendas;
const premio2 = premioPorPuesto(2, "semanal").leyendas;

// ==================================================================== 1

console.log("\n=== 1. Cada juego cierra lo suyo ===");
{
  const { db, cierre } = montar({
    "rankings/memorie": { juego: "memorie" },
    "rankings/otro-juego": { juego: "otro-juego" },
    ...fila("memorie", SEMANA, "ana", 300),
    ...fila("memorie", SEMANA, "beto", 200),
    ...fila("otro-juego", SEMANA, "ana", 150),
    ...fila("otro-juego", SEMANA, "caro", 900),
    "users/ana": vacio(),
    "users/beto": vacio(),
    "users/caro": vacio(),
  });

  const r = await capturar(() => cierre.cerrarPeriodos("semanal", FECHA));
  ok(!r.error, "cierra la semana en los dos juegos", r.error?.message);

  ok(db.leer(`rankings/memorie/periodos/${SEMANA}`)?.cerrado === true &&
     db.leer(`rankings/otro-juego/periodos/${SEMANA}`)?.cerrado === true,
     "cada juego queda con su período cerrado");
  ok(db.leer(`rankings/otro-juego/periodos/${SEMANA}`)?.juego === "otro-juego",
     "y el período dice de qué juego es");

  // Ana salió primera en uno y segunda en el otro: cobra las dos cosas.
  ok(saldo(db, "ana") === premio1 + premio2,
     "Ana cobra el 1º de un juego y el 2º del otro, por separado", saldo(db, "ana"));
  ok(saldo(db, "caro") === premio1, "Caro, el 1º del otro juego", saldo(db, "caro"));
  ok(saldo(db, "beto") === premio2, "Beto, el 2º del juego de siempre", saldo(db, "beto"));

  // La clave del premio lleva el juego: dos juegos cierran la misma semana.
  ok(Boolean(db.leer(`movimientos/premio_memorie_${SEMANA}_ana`)) &&
     Boolean(db.leer(`movimientos/premio_otro-juego_${SEMANA}_ana`)),
     "la clave del premio lleva el juego: dos asientos distintos para Ana");
}

// ==================================================================== 2

console.log("\n=== 2. Un período viejo (semanal_2026-09-07, sin campo juego) no se confunde con un juego ===");
{
  /**
   * La marca de un juego y un período de la estructura vieja viven en la
   * MISMA colección, `rankings/`. Lo que los distingue es el campo `juego`:
   * la marca lo tiene, igual a su propio id; el período viejo no.
   *
   * Tres cosas en `rankings/` que no son juegos:
   *
   *   · `semanal_2026-09-07`: un período viejo CERRADO. Tiene documento, con
   *     `tipo`, `clave` y `cerrado`, y sus filas debajo. No tiene `juego`.
   *   · `mensual_2026-09`: un período viejo ABIERTO. No tiene documento, sólo
   *     filas: `listDocuments()` lo devuelve igual.
   *   · `raro`: un documento con `juego`, pero de otro id. Tampoco.
   */
  const legado = {
    "rankings/semanal_2026-09-07": { tipo: "semanal", clave: "semanal_2026-09-07", cerrado: true, premiados: 2 },
    "rankings/semanal_2026-09-07/jugadores/ana": { uid: "ana", puntos: 90, premiado: true, puesto: 1 },
    "rankings/mensual_2026-09/jugadores/beto": { uid: "beto", puntos: 50 },
    "rankings/raro": { juego: "otro-id" },
  };
  const { db, cierre } = montar({
    ...legado,
    "rankings/memorie": { juego: "memorie" },
    ...fila("memorie", SEMANA, "caro", 100),
    "users/ana": vacio(),
    "users/beto": vacio(),
    "users/caro": vacio(),
  });

  const juegos = await cierre.juegosConTabla();
  ok(JSON.stringify(juegos) === '["memorie"]',
     "el único juego es el que tiene la marca con su propio id", juegos);

  await cierre.cerrarPeriodos("semanal", FECHA);
  ok(db.leer(`rankings/memorie/periodos/${SEMANA}`)?.cerrado === true, "el juego sí se cierra");

  const basura = db.rutas().filter((r) =>
    r.startsWith("rankings/semanal_2026-09-07/periodos") ||
    r.startsWith("rankings/mensual_2026-09/periodos") ||
    r.startsWith("rankings/raro/periodos"));
  ok(basura.length === 0, "no escribe nada debajo de los períodos viejos ni del documento raro", basura);

  const intactos = Object.entries(legado).every(([r, d]) => JSON.stringify(db.leer(r)) === JSON.stringify(d));
  ok(intactos, "y lo viejo queda exactamente como estaba");
  ok(saldo(db, "ana") === 0 && saldo(db, "beto") === 0,
     "a las filas viejas no se les paga nada", [saldo(db, "ana"), saldo(db, "beto")]);
}

// ==================================================================== 3

console.log("\n=== 3. Una fila que ya cobró no se paga de nuevo ===");
{
  /**
   * Un cierre que se cortó a medias con la clave vieja dejó a Ana con
   * `premiado: true` y su premio cobrado bajo `premio_{clave}_ana`. La clave
   * nueva lleva el juego, así que no lo reconocería: lo que la frena es la
   * marca de la fila.
   */
  const { db, cierre } = montar({
    "rankings/memorie": { juego: "memorie" },
    ...fila("memorie", SEMANA, "ana", 300, { premiado: true, puesto: 1 }),
    ...fila("memorie", SEMANA, "beto", 200),
    "users/ana": vacio(),
    "users/beto": vacio(),
  });

  await cierre.cerrarPeriodo("memorie", "semanal", FECHA);
  ok(saldo(db, "ana") === 0, "a Ana, que ya había cobrado, no se le vuelve a pagar", saldo(db, "ana"));
  ok(!db.leer(`movimientos/premio_memorie_${SEMANA}_ana`), "ni queda un asiento nuevo a su nombre");
  ok(saldo(db, "beto") === premio2, "Beto, que no había cobrado, sí cobra", saldo(db, "beto"));
}

// ==================================================================== 4

console.log("\n=== 4. Lo cerrado no se vuelve a cerrar ===");
{
  const { db, cierre } = montar({
    "rankings/memorie": { juego: "memorie" },
    [`rankings/memorie/periodos/${SEMANA}`]: { juego: "memorie", clave: SEMANA, cerrado: true },
    ...fila("memorie", SEMANA, "ana", 300),
    "users/ana": vacio(),
  });

  const r = await cierre.cerrarPeriodo("memorie", "semanal", FECHA);
  ok(r.premiados === 0, "un período cerrado devuelve cero premiados", r);
  ok(saldo(db, "ana") === 0, "y no paga nada", saldo(db, "ana"));
}

// ==================================================================== 5

console.log("\n=== 5. El mes: la insignia y el premio físico, con su juego ===");
{
  const { db, cierre, puestosMensuales } = montar({
    "rankings/memorie": { juego: "memorie" },
    ...fila("memorie", MES, "ana", 25000),
    ...fila("memorie", MES, "beto", 500),
    "users/ana": vacio(),
    "users/beto": vacio(),
  });

  await cierre.cerrarPeriodo("memorie", "mensual", FECHA);
  ok(puestosMensuales.some(([u, p]) => u === "ana" && p === 1),
     "el primero del mes queda anotado para la insignia Leyenda", puestosMensuales);

  const constancia = db.leer("users/ana")?.premios?.__union;
  ok(constancia?.premio === "remera" && constancia?.juego === "memorie" && constancia?.periodo === MES,
     "la constancia del premio físico dice de qué juego y de qué mes", constancia);
  ok(db.leer(`rankings/memorie/periodos/${MES}/jugadores/ana`)?.premioFisico === "remera",
     "y la fila también");
}

// ==================================================================== 6

console.log("\n=== 6. Un juego que falla no deja sin cerrar a los demás ===");
{
  const { db, cierre } = montar({
    "rankings/memorie": { juego: "memorie" },
    "rankings/roto": { juego: "roto" },
    ...fila("memorie", SEMANA, "ana", 300),
    ...fila("roto", SEMANA, "beto", 300),
    "users/ana": vacio(),
    "users/beto": vacio(),
  });
  db.perillas.fallarEn = "rankings/roto/";

  const r = await capturar(() => cierre.cerrarPeriodos("semanal", FECHA));
  ok(db.leer(`rankings/memorie/periodos/${SEMANA}`)?.cerrado === true && saldo(db, "ana") === premio1,
     "el juego sano se cierra y paga");
  ok(r.error && /roto/.test(r.error.message),
     "y al final avisa cuál falló, para que se vea en los registros", r.error?.message);
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
