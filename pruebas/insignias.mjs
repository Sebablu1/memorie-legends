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
  leyendasDeInsignia,
  PUESTO_MENSUAL_CON_INSIGNIA,
  ESTADISTICAS_VACIAS,
} from "../public/js/reglas/insignias.js";
import { crearInsignias } from "../functions/insignias.js";
import { crearTienda } from "../functions/tienda.js";
import { crearMoverLeyendas } from "../functions/leyendas.js";
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
    novato: { campo: "partidasJugadas", minimo: 1, leyendas: 20 },
    aventurero: { campo: "partidasGanadas", minimo: 5, leyendas: 30 },
    estratega: { campo: "partidasGanadas", minimo: 10, leyendas: 40 },
    heroe: { campo: "partidasGanadas", minimo: 25, leyendas: 60 },
    campeon: { campo: "torneosGanados", minimo: 1, leyendas: 50 },
    leyenda: { campo: "mejorPuestoMensual", maximo: 10, leyendas: 100 },
  };

  ok(IDS_INSIGNIAS.length === 6, "son seis", IDS_INSIGNIAS.length);

  for (const [id, esperado] of Object.entries(ACORDADO)) {
    const c = condicionDe(id);
    ok(Boolean(c), `existe la condición de ${id}`);
    if (!c) continue;
    ok(c.campo === esperado.campo, `  ${id} mira ${esperado.campo}`, c.campo);
    ok(c.leyendas === esperado.leyendas, `  ${id} paga ${esperado.leyendas}`, c.leyendas);
    ok(leyendasDeInsignia(id) === esperado.leyendas, `  y \`leyendasDeInsignia\` coincide`);
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
  // "puesto menor o igual a 10" sería cierto y quien nunca jugó sería Leyenda.
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
  ok(cumple(leyenda, { mejorPuestoMensual: 10 }), "leyenda: el puesto 10 entra");
  ok(cumple(leyenda, { mejorPuestoMensual: 1 }), "leyenda: y el 1 también");
  ok(!cumple(leyenda, { mejorPuestoMensual: 11 }), "leyenda: el 11 no");

  // El corte que mira el servidor sale de esta misma condición. Con dos
  // copias, mover una dejaba a los puestos 6 a 10 mereciendo la insignia sin
  // que nadie les anotara el puesto que la justifica.
  ok(PUESTO_MENSUAL_CON_INSIGNIA === leyenda.maximo,
     "y el corte que exporta el módulo es el mismo", PUESTO_MENSUAL_CON_INSIGNIA);
}

// =====================================================================
console.log("\n=== 4. Las de victorias se acumulan: ganar 250 gana las tres ===");
// =====================================================================

{
  // No son excluyentes. Quien llega a 250 victorias pasó por 50 y por 100, y
  // tiene que quedarse con las tres: son hitos, no niveles que se reemplazan.
  const veterano = { ...ESTADISTICAS_VACIAS, partidasJugadas: 400, partidasGanadas: 250 };
  // 250 victorias pasa los cuatro umbrales de partidas con holgura.
  const ganadas = insigniasMerecidas(veterano);

  ok(ganadas.includes("novato"), "novato");
  ok(ganadas.includes("aventurero"), "aventurero");
  ok(ganadas.includes("estratega"), "estratega");
  ok(ganadas.includes("heroe"), "heroe");
  ok(!ganadas.includes("campeon"), "pero no campeón: no ganó torneos");
  ok(!ganadas.includes("leyenda"), "ni leyenda: nunca entró al top 10");

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
  ok(insigniasMerecidas(e).includes("novato"), "el novato ya está");
  // Y llega en la primera, no en la décima: es el umbral nuevo.
  ok(insigniasMerecidas(conPartida(ESTADISTICAS_VACIAS, false)).includes("novato"),
     "con UNA partida jugada, aunque se pierda");
  ok(!insigniasMerecidas(ESTADISTICAS_VACIAS).includes("novato"),
     "pero no antes de jugar ninguna");

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
  const c = condicionDe("estratega"); // ganar 10
  ok(progreso(c, { partidasGanadas: 0 }) === 0, "en cero, cero");
  ok(progreso(c, { partidasGanadas: 5 }) === 0.5, "a la mitad, la mitad");
  ok(progreso(c, { partidasGanadas: 10 }) === 1, "cumplida, entera");
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
    _borrar: (r) => docs.delete(r),
    _rutas: () => [...docs.keys()],
  };
}

/**
 * El `moverLeyendas` de VERDAD, no uno de mentira.
 *
 * ─────────────────────────────────────────────────────────────────────
 * POR QUÉ IMPORTA QUE SEA EL DE VERDAD
 * ─────────────────────────────────────────────────────────────────────
 *
 * Porque otorgar dejó de ser gratis. Antes esto era una escritura sin saldo y
 * un doble se podía usar sin perder nada; ahora cada insignia acredita
 * Leyendas, y lo que hay que probar es justamente lo que un doble se saltea:
 * que el asiento quede en el libro mayor, que la clave de idempotencia frene
 * el segundo pago, y que el saldo termine donde tiene que terminar.
 *
 * Un `async () => ({ aplicado: true })` habría dicho que sí a todo.
 */
function montar(perfil = {}) {
  const inicial = { "users/ana": { credits: 0, username: "Ana", ...perfil } };
  for (const item of CATALOGO_INICIAL) inicial[`catalogo/${item.id}`] = { ...item };

  const db = crearFirestore(inicial);
  const moverLeyendas = crearMoverLeyendas({
    db,
    usuarios: "users",
    campoSaldo: "credits",
    movimientos: "movimientos",
    marcaDeTiempo: () => "T",
    error,
  });
  const tienda = crearTienda({
    db,
    moverLeyendas,
    marcaDeTiempo: () => "T",
    error,
    motivoCompra: "compra_personalizacion",
    motivoLogro: "premio_logro",
    administradores: { exigir: async () => ({ uid: "admin" }) },
  });
  const insignias = crearInsignias({ db, tienda });
  return { db, tienda, insignias };
}

/** El saldo de Ana, para no repetir la ruta en cada aserción. */
const saldoDe = (db) => db._leer("users/ana")?.credits ?? 0;

/** Los asientos del libro mayor, que ahora sí tiene que haber. */
const asientosDe = (db) => db._rutas().filter((r) => r.startsWith("movimientos/"));

{
  const { db, insignias } = montar({ gamesPlayed: 0, wins: 0 });
  const otorgadas = await insignias.otorgarInsignias("ana");
  ok(otorgadas.length === 0, "sin haber jugado, no otorga nada", otorgadas);
  ok(!db._leer("users/ana/items/novato"), "y no anota nada");
  ok(asientosDe(db).length === 0, "ni asienta un pago que no ocurrió");
}

{
  const { db, insignias } = montar({ gamesPlayed: 1, wins: 0 });
  const otorgadas = await insignias.otorgarInsignias("ana");

  ok(otorgadas.length === 1 && otorgadas[0].id === "novato",
     "con la primera partida jugada, otorga novato", otorgadas);
  ok(otorgadas[0].nombre === "Novato", "y viaja el nombre visible", otorgadas[0].nombre);
  ok(db._leer("users/ana/items/novato").origen === "logro", "marcada como logro");
  ok(db._leer("users/ana/items/novato").precioPagado === 0, "y sin precio pagado");

  /**
   * Y PAGA.
   *
   * Esto antes se probaba al revés —"sin tocar el libro mayor"— porque
   * otorgar no movía saldo. Ahora sí lo mueve, así que la afirmación se dio
   * vuelta entera: tiene que haber asiento, con su clave, y el saldo tiene
   * que haber subido lo que dice la regla.
   */
  ok(otorgadas[0].leyendas === 20, "informa lo que acreditó", otorgadas[0].leyendas);
  ok(saldoDe(db) === 20, "y el saldo sube", saldoDe(db));
  ok(db._leer("users/ana/items/novato").leyendasPagadas === 20,
     "la posesión anota lo que pagó el logro");

  const asiento = db._leer("movimientos/logro_ana_novato");
  ok(Boolean(asiento), "queda el asiento en el libro mayor");
  ok(asiento?.motivo === "premio_logro", "con su propio motivo", asiento?.motivo);
  ok(asiento?.delta === 20, "y el delta correcto", asiento?.delta);
  ok(asientosDe(db).length === 1, "uno solo", asientosDe(db));

  // La segunda pasada no otorga de nuevo: es lo que hace barato revisar
  // después de cada partida. Y sobre todo, no vuelve a pagar.
  const otraVez = await insignias.otorgarInsignias("ana");
  ok(otraVez.length === 0, "revisar de nuevo no otorga nada", otraVez);
  ok(saldoDe(db) === 20, "y NO vuelve a pagar", saldoDe(db));
  ok(asientosDe(db).length === 1, "sin un segundo asiento", asientosDe(db));
}

{
  /**
   * Sin motivo contable, no se paga.
   *
   * `moverLeyendas` no comprueba el motivo. Una fábrica montada sin
   * `motivoLogro` —un módulo nuevo que arme su propia tienda, una prueba que
   * copie el montaje viejo— escribiría el asiento con `motivo: undefined`: el
   * saldo quedaría bien y el libro mayor inservible, porque la gracia de
   * tener motivos es poder preguntarle de dónde salió cada Leyenda.
   *
   * Es un error de programación, no del jugador, así que revienta fuerte en
   * vez de pagar callado.
   */
  const inicial = { "users/ana": { credits: 0, gamesPlayed: 1 } };
  for (const item of CATALOGO_INICIAL) inicial[`catalogo/${item.id}`] = { ...item };
  const db = crearFirestore(inicial);

  const tienda = crearTienda({
    db,
    moverLeyendas: crearMoverLeyendas({
      db, usuarios: "users", campoSaldo: "credits", movimientos: "movimientos",
      marcaDeTiempo: () => "T", error,
    }),
    marcaDeTiempo: () => "T",
    error,
    motivoCompra: "compra_personalizacion",
    // motivoLogro, justamente, no se pasa.
    administradores: { exigir: async () => ({ uid: "admin" }) },
  });

  let mensaje = null;
  try {
    await tienda.otorgar("ana", "novato", { premio: 20 });
  } catch (e) {
    mensaje = e.message;
  }

  ok(/motivo contable/i.test(mensaje ?? ""), "pagar sin motivo contable se rechaza", mensaje);
  ok(!db._leer("users/ana/items/novato"), "y no queda la posesión a medias");
  ok((db._leer("users/ana")?.credits ?? 0) === 0, "ni el saldo movido");

  // Sin premio sí se puede: no hay asiento que clasificar.
  const gratis = await tienda.otorgar("ana", "novato");
  ok(gratis.nuevo === true, "otorgar sin premio no necesita motivo");
  ok(gratis.leyendas === 0, "y no acredita nada", gratis.leyendas);
}

{
  /**
   * El segundo candado: la posesión borrada a mano.
   *
   * El primero es el documento de posesión —si ya lo tiene, no entra— pero un
   * administrador puede quitársela desde el panel. Sin la clave de
   * idempotencia, la próxima revisión le pagaría las 20 Leyendas otra vez, y
   * quitar y devolver sería una canilla abierta.
   */
  const { db, insignias } = montar({ gamesPlayed: 1, wins: 0 });
  await insignias.otorgarInsignias("ana");
  ok(saldoDe(db) === 20, "cobró la primera vez");

  db._borrar("users/ana/items/novato");
  const otraVez = await insignias.otorgarInsignias("ana");

  ok(otraVez.length === 1, "se le vuelve a otorgar la insignia", otraVez);
  ok(otraVez[0].leyendas === 0, "pero informa que no se pagó nada", otraVez[0].leyendas);
  ok(saldoDe(db) === 20, "y el saldo no se mueve", saldoDe(db));
  ok(asientosDe(db).length === 1, "el libro mayor sigue con un asiento", asientosDe(db));
}

{
  const { db, insignias } = montar({ gamesPlayed: 400, wins: 250 });
  const otorgadas = await insignias.otorgarInsignias("ana");

  ok(otorgadas.length === 4, "un veterano recibe las cuatro de una", otorgadas);
  for (const id of ["novato", "aventurero", "estratega", "heroe"]) {
    ok(Boolean(db._leer(`users/ana/items/${id}`)), `  ${id}`);
  }
  ok(!db._leer("users/ana/items/campeon"), "y ninguna que no se ganó");
}

{
  const { db, insignias } = montar({ gamesPlayed: 50, wins: 20 });

  await insignias.registrarPuestoMensual("ana", 3);
  ok(db._leer("users/ana").mejorPuestoMensual === 3, "anota el puesto del mes");
  ok(Boolean(db._leer("users/ana/items/leyenda")), "y otorga la insignia de leyenda");

  await insignias.registrarPuestoMensual("ana", 30);
  ok(db._leer("users/ana").mejorPuestoMensual === 3, "un mes peor no empeora la marca");
  ok(Boolean(db._leer("users/ana/items/leyenda")), "ni le saca la insignia");
}

{
  // Un catálogo vacío no puede tumbar el cierre de una partida que ya pagó.
  const db = crearFirestore({ "users/ana": { gamesPlayed: 10 } });
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

// =====================================================================
console.log("\n=== 8. El perfil habla en inglés y las reglas en castellano ===");
// =====================================================================

{
  /**
   * El perfil guarda `gamesPlayed` y `wins`; las condiciones se escriben con
   * `partidasJugadas` y `partidasGanadas`. `estadisticasDe` traduce.
   *
   * Esta prueba existe porque la traducción se puede romper en silencio: si
   * alguien cambia el nombre de un lado, `estadisticasDe` devuelve ceros, las
   * condiciones no se cumplen nunca y NADIE recibe una insignia. No falla
   * nada, no hay excepción, no hay registro. Sólo dejan de otorgarse.
   *
   * Ya pasó una versión de esto: el cierre de partida escribía dos contadores
   * nuevos en castellano mientras el panel del jugador seguía mostrando los de
   * inglés, en cero.
   */
  const { insignias } = montar({ gamesPlayed: 42, wins: 17, torneosGanados: 3 });
  const e = await insignias.estadisticasDe("ana");

  ok(e.partidasJugadas === 42, "`gamesPlayed` llega como partidasJugadas", e.partidasJugadas);
  ok(e.partidasGanadas === 17, "`wins` llega como partidasGanadas", e.partidasGanadas);
  ok(e.torneosGanados === 3, "y los torneos, que ya estaban en castellano", e.torneosGanados);
  ok(e.mejorPuestoMensual === null, "sin puesto, null y no cero");

  // Un perfil recién creado tiene los dos campos en cero, no ausentes.
  const nuevo = montar({ gamesPlayed: 0, wins: 0 });
  const cero = await nuevo.insignias.estadisticasDe("ana");
  ok(cero.partidasJugadas === 0 && cero.partidasGanadas === 0, "un perfil nuevo da ceros");
}

console.log(fallos ? `\n❌ ${fallos} fallos` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
