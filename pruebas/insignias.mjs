/**
 * Las insignias se ganan jugando, y nadie puede comprarlas ni regalárselas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE DEFIENDE ACÁ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Tres cosas:
 *
 *   1. Que la condición se evalúe igual siempre. Es un módulo puro justamente
 *      para que el perfil pueda dibujar "te faltan 12 victorias" con el mismo
 *      código con el que el servidor decide otorgar. Si divergieran, la barra
 *      llegaría al final sin que llegara la insignia.
 *   2. Que otorgar sea idempotente. El servidor revisa después de CADA
 *      partida; si cada revisión reescribiera, un jugador con seis insignias
 *      pagaría seis escrituras por partida para siempre.
 *   3. Que las condiciones sean las acordadas. Ésta es la que parece
 *      redundante y no lo es: las otras comprueban que el mecanismo funcione,
 *      y un mecanismo perfecto puede otorgar la insignia equivocada.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE ESTA PRUEBA DESCUBRIÓ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Que nadie contaba las partidas. `gamesPlayed` y `wins` se creaban en cero al
 * registrarse y no los incrementaba NADIE: ni el cliente ni el servidor. Las
 * condiciones "ganar 50 partidas" eran, literalmente, inalcanzables.
 *
 * Por eso el cierre de partida ahora cuenta —ver `functions/cierre.js`— y por
 * eso la sección 5 comprueba el circuito entero y no sólo la aritmética.
 */

import {
  CONDICIONES,
  IDS_INSIGNIAS,
  cumple,
  progreso,
  insigniasMerecidas,
  insigniasNuevas,
  conPartida,
  conPuestoMensual,
  condicionDe,
  ESTADISTICAS_VACIAS,
} from "../public/js/reglas/insignias.js";
import { crearInsignias } from "../functions/insignias.js";
import { crearTienda } from "../functions/tienda.js";
import { CATALOGO_INICIAL, TIPOS } from "../public/js/reglas/catalogo.js";

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

// =====================================================================
console.log("\n=== 1. Las condiciones son las que se acordaron ===");
// =====================================================================

{
  // Escritas a mano y no derivadas del módulo: si se derivaran, esta prueba
  // diría "las condiciones son las que dice el archivo", que es una tautología.
  const ACORDADO = {
    novato: { campo: "partidasJugadas", minimo: 10 },
    aventurero: { campo: "partidasGanadas", minimo: 50 },
    estratega: { campo: "partidasGanadas", minimo: 100 },
    heroe: { campo: "partidasGanadas", minimo: 250 },
    campeon: { campo: "torneosGanados", minimo: 5 },
    leyenda: { campo: "mejorPuestoMensual", maximo: 5 },
  };

  ok(IDS_INSIGNIAS.length === 6, "son seis", IDS_INSIGNIAS.length);

  for (const [id, esperado] of Object.entries(ACORDADO)) {
    const c = condicionDe(id);
    ok(Boolean(c), `existe la condición de ${id}`);
    if (!c) continue;
    ok(c.campo === esperado.campo, `  ${id} mira ${esperado.campo}`, c.campo);
    if (esperado.minimo !== undefined) {
      ok(c.minimo === esperado.minimo, `  ${id} pide ${esperado.minimo}`, c.minimo);
    } else {
      ok(c.maximo === esperado.maximo, `  ${id} pide no pasar de ${esperado.maximo}`, c.maximo);
    }
  }

  // Todas tienen que existir en el catálogo, o se otorgarían al vacío.
  for (const id of IDS_INSIGNIAS) {
    const enCatalogo = CATALOGO_INICIAL.find((i) => i.id === id);
    ok(Boolean(enCatalogo), `${id} está en el catálogo`);
    ok(enCatalogo?.tipo === TIPOS.INSIGNIA, `  y es de tipo insignia`);
  }
}

// =====================================================================
console.log("\n=== 2. Un perfil vacío no gana nada ===");
// =====================================================================

{
  ok(insigniasMerecidas(ESTADISTICAS_VACIAS).length === 0, "recién registrado, ninguna");
  ok(insigniasMerecidas({}).length === 0, "un perfil sin los campos tampoco rompe");
  ok(insigniasMerecidas(null).length === 0, "ni un perfil que no existe");

  // La trampa del cero: si `mejorPuestoMensual` arrancara en 0 en vez de null,
  // "puesto menor o igual a 5" sería cierto y quien nunca jugó sería Leyenda.
  ok(
    !cumple(condicionDe("leyenda"), ESTADISTICAS_VACIAS),
    "y NO se regala la más difícil por no tener puesto",
  );
  ok(
    !cumple(condicionDe("leyenda"), { mejorPuestoMensual: 0 }),
    "ni siquiera si alguien escribe un cero en el puesto",
  );
}

// =====================================================================
console.log("\n=== 3. Cada umbral se cruza donde dice, ni antes ni después ===");
// =====================================================================

{
  for (const c of CONDICIONES) {
    if (typeof c.minimo !== "number") continue;

    const justoAbajo = { ...ESTADISTICAS_VACIAS, [c.campo]: c.minimo - 1 };
    const justo = { ...ESTADISTICAS_VACIAS, [c.campo]: c.minimo };

    ok(!cumple(c, justoAbajo), `${c.id}: con ${c.minimo - 1} todavía no`);
    ok(cumple(c, justo), `${c.id}: con ${c.minimo} sí`);
  }

  const leyenda = condicionDe("leyenda");
  ok(cumple(leyenda, { mejorPuestoMensual: 5 }), "leyenda: el puesto 5 entra");
  ok(cumple(leyenda, { mejorPuestoMensual: 1 }), "leyenda: y el 1 también");
  ok(!cumple(leyenda, { mejorPuestoMensual: 6 }), "leyenda: el 6 no");
}

// =====================================================================
console.log("\n=== 4. Las de victorias se acumulan: ganar 250 gana las tres ===");
// =====================================================================

{
  // No son excluyentes. Quien llega a 250 victorias pasó por 50 y por 100, y
  // tiene que quedarse con las tres: son hitos, no niveles que se reemplazan.
  const veterano = { ...ESTADISTICAS_VACIAS, partidasJugadas: 400, partidasGanadas: 250 };
  const ganadas = insigniasMerecidas(veterano);

  ok(ganadas.includes("novato"), "novato");
  ok(ganadas.includes("aventurero"), "aventurero");
  ok(ganadas.includes("estratega"), "estratega");
  ok(ganadas.includes("heroe"), "heroe");
  ok(!ganadas.includes("campeon"), "pero no campeón: no ganó torneos");
  ok(!ganadas.includes("leyenda"), "ni leyenda: nunca entró al top 5");

  // Y sólo las que faltan, que es lo que hace barato revisar cada partida.
  const faltan = insigniasNuevas(veterano, ["novato", "aventurero"]);
  ok(faltan.length === 2 && faltan.includes("estratega") && faltan.includes("heroe"),
     "sólo devuelve las que todavía no tiene", faltan);
  ok(insigniasNuevas(veterano, ganadas).length === 0, "y nada cuando ya las tiene todas");
}

// =====================================================================
console.log("\n=== 5. Contar partidas y mejores puestos ===");
// =====================================================================

{
  // Diez partidas, ganando una de cada tres.
  let e = ESTADISTICAS_VACIAS;
  for (let i = 1; i <= 10; i++) e = conPartida(e, i % 3 === 0);

  ok(e.partidasJugadas === 10, "cuenta las jugadas", e.partidasJugadas);
  ok(e.partidasGanadas === 3, "y las ganadas aparte", e.partidasGanadas);
  ok(insigniasMerecidas(e).includes("novato"), "a las 10 llega el novato");

  // El mejor puesto no empeora nunca.
  let r = conPuestoMensual(ESTADISTICAS_VACIAS, 12);
  ok(r.mejorPuestoMensual === 12, "guarda el primer puesto que saca");
  r = conPuestoMensual(r, 3);
  ok(r.mejorPuestoMensual === 3, "y lo mejora cuando mejora");
  r = conPuestoMensual(r, 40);
  ok(r.mejorPuestoMensual === 3, "pero NO lo empeora al mes siguiente");
  ok(insigniasMerecidas(r).includes("leyenda"), "así que la insignia no se pierde");
}

// =====================================================================
console.log("\n=== 6. El progreso sirve para dibujar una barra honesta ===");
// =====================================================================

{
  const c = condicionDe("aventurero"); // ganar 50
  ok(progreso(c, { partidasGanadas: 0 }) === 0, "en cero, cero");
  ok(progreso(c, { partidasGanadas: 25 }) === 0.5, "a la mitad, la mitad");
  ok(progreso(c, { partidasGanadas: 50 }) === 1, "cumplida, entera");
  ok(progreso(c, { partidasGanadas: 900 }) === 1, "y nunca pasa de 1");

  // Las de techo no tienen barra: entre "puesto 40" y "puesto 6" no hay una
  // fracción que signifique algo, porque el puesto depende de los demás.
  const l = condicionDe("leyenda");
  ok(progreso(l, { mejorPuestoMensual: 40 }) === 0, "la de puesto no inventa progreso");
  ok(progreso(l, { mejorPuestoMensual: 2 }) === 1, "y salta a 1 cuando se cumple");
}

// =====================================================================
console.log("\n=== 7. El servidor otorga, y sólo lo que corresponde ===");
// =====================================================================

/** El mismo Firestore de mentira que usa `pruebas/tienda.mjs`, en chico. */
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
  });
  return {
    collection: coleccion,
    async runTransaction(cuerpo) {
      const pendientes = [];
      const r = await cuerpo({
        async get(ref) {
          const d = docs.get(ref.ruta);
          return { exists: Boolean(d), data: () => (d ? { ...d } : undefined) };
        },
        set: (ref, datos, o) => pendientes.push([ref.ruta, datos, o?.merge]),
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

function montar(perfil = {}) {
  const inicial = { "users/ana": { credits: 0, username: "Ana", ...perfil } };
  for (const item of CATALOGO_INICIAL) inicial[`catalogo/${item.id}`] = { ...item };

  const db = crearFirestore(inicial);
  const tienda = crearTienda({
    db,
    moverLeyendas: async () => ({ aplicado: true, saldo: 0 }),
    marcaDeTiempo: () => "T",
    error,
    motivoCompra: "compra_personalizacion",
    administradores: { exigir: async () => ({ uid: "admin" }) },
  });
  const insignias = crearInsignias({ db, tienda });
  return { db, tienda, insignias };
}

{
  const { db, insignias } = montar({ partidasJugadas: 9, partidasGanadas: 4 });
  const otorgadas = await insignias.otorgarInsignias("ana");
  ok(otorgadas.length === 0, "con 9 partidas todavía no otorga nada", otorgadas);
  ok(!db._leer("users/ana/items/novato"), "y no anota nada");
}

{
  const { db, insignias } = montar({ partidasJugadas: 10, partidasGanadas: 4 });
  const otorgadas = await insignias.otorgarInsignias("ana");

  ok(otorgadas.length === 1 && otorgadas[0] === "novato", "con 10 otorga novato", otorgadas);
  ok(db._leer("users/ana/items/novato").origen === "logro", "marcada como logro");
  ok(db._leer("users/ana/items/novato").precioPagado === 0, "y sin precio pagado");
  ok(!db._rutas().some((r) => r.startsWith("movimientos/")), "sin tocar el libro mayor");

  // La segunda pasada no otorga de nuevo: es lo que hace barato revisar
  // después de cada partida.
  const otraVez = await insignias.otorgarInsignias("ana");
  ok(otraVez.length === 0, "revisar de nuevo no otorga nada", otraVez);
}

{
  const { db, insignias } = montar({ partidasJugadas: 400, partidasGanadas: 250 });
  const otorgadas = await insignias.otorgarInsignias("ana");

  ok(otorgadas.length === 4, "un veterano recibe las cuatro de una", otorgadas);
  for (const id of ["novato", "aventurero", "estratega", "heroe"]) {
    ok(Boolean(db._leer(`users/ana/items/${id}`)), `  ${id}`);
  }
  ok(!db._leer("users/ana/items/campeon"), "y ninguna que no se ganó");
}

{
  const { db, insignias } = montar({ partidasJugadas: 50, partidasGanadas: 20 });

  await insignias.registrarPuestoMensual("ana", 3);
  ok(db._leer("users/ana").mejorPuestoMensual === 3, "anota el puesto del mes");
  ok(Boolean(db._leer("users/ana/items/leyenda")), "y otorga la insignia de leyenda");

  await insignias.registrarPuestoMensual("ana", 30);
  ok(db._leer("users/ana").mejorPuestoMensual === 3, "un mes peor no empeora la marca");
  ok(Boolean(db._leer("users/ana/items/leyenda")), "ni le saca la insignia");
}

{
  // Un catálogo vacío no puede tumbar el cierre de una partida que ya pagó.
  const db = crearFirestore({ "users/ana": { partidasJugadas: 10 } });
  const tienda = crearTienda({
    db,
    moverLeyendas: async () => ({ aplicado: true, saldo: 0 }),
    marcaDeTiempo: () => "T",
    error,
    motivoCompra: "compra_personalizacion",
    administradores: { exigir: async () => ({ uid: "admin" }) },
  });
  const insignias = crearInsignias({ db, tienda });

  let reventó = false;
  let otorgadas = null;
  try {
    otorgadas = await insignias.otorgarInsignias("ana");
  } catch {
    reventó = true;
  }
  ok(!reventó, "sin catálogo sembrado NO lanza");
  ok(otorgadas?.length === 0, "simplemente no otorga nada", otorgadas);
}

console.log(fallos ? `\n❌ ${fallos} fallos` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
