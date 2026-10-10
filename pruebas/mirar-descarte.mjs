/**
 * D2: descartar durante la mirada.
 *
 * EL PROBLEMA
 *
 * La muestra puede ser justo la carta que acabás de memorizar. Hasta ahora ese
 * descarte era imposible: la fase todavía era `mirar`, no existía ninguna
 * ventana a la que pertenecer, y el servidor rechazaba el intento. El jugador
 * veía la coincidencia y no podía hacer nada con ella.
 *
 * LA SOLUCIÓN
 *
 * Una sola ventana, que abre con la mirada:
 *
 *   0 s ───────────── 5 s ─── 7 s ───────────── 12 s ──── 14 s
 *      elegir qué mirar      verla     DESCARTE      gracia
 *      └──────────────── una sola ventana ─────────────┘
 *
 * Lo que vive el jugador no cambia —5 s para elegir la carta, 2 para verla, 5
 * de descarte, 2 de gracia para los paquetes lentos—: cambia dónde empieza a
 * contar la ventana.
 *
 * Lo que hay que demostrar:
 *
 *   1. que se pueda descartar durante `mirar`, al principio y al final;
 *   2. que sea UNA ventana y no dos, con el mismo id de punta a punta;
 *   3. que un intento de la mirada sobreviva al cambio de fase y se resuelva
 *      al cerrar, con su castigo y su revelación si correspondiera;
 *   4. que el tiempo efectivo siga midiendo reacción y no conexión;
 *   5. que fuera de la ventana se siga rechazando.
 */

import { crearMotorEnRed, MS_MIRADA_TOTAL } from "../functions/partida-red.js";
import { MS_VENTANA, MS_GRACIA } from "../public/js/reglas/red.js";
import { MS_REVELACION } from "../public/js/reglas/vista.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

class E extends Error { constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; } }
const error = (codigo, mensaje) => new E(codigo, mensaje);

function crearFirestore() {
  const docs = new Map();
  let version = 0;
  const db = {
    collection: (n) => ({ doc: (id = `a${Math.random()}`) => ({ ruta: `${n}/${id}` }) }),
    async runTransaction(cuerpo) {
      for (let i = 0; i < 10; i++) {
        const leidas = new Map(); const esc = []; let yaEscribio = false;
        const tx = {
          async get(ref) {
            if (yaEscribio) throw error("invalid-argument", "Lectura tras escritura");
            const d = docs.get(ref.ruta);
            leidas.set(ref.ruta, d ? d.version : 0);
            return { exists: Boolean(d), data: () => (d ? structuredClone(d.datos) : undefined) };
          },
          set(ref, datos, op) { yaEscribio = true; esc.push({ ruta: ref.ruta, datos, m: Boolean(op?.merge) }); },
          update(ref, datos) { yaEscribio = true; esc.push({ ruta: ref.ruta, datos, m: true }); },
        };
        const res = await cuerpo(tx);
        if ([...leidas].some(([r, v]) => (docs.get(r)?.version ?? 0) !== v)) continue;
        for (const e of esc) {
          const p = docs.get(e.ruta);
          docs.set(e.ruta, {
            datos: e.m ? { ...(p?.datos ?? {}), ...structuredClone(e.datos) } : structuredClone(e.datos),
            version: ++version,
          });
        }
        return res;
      }
      throw error("aborted", "Demasiados reintentos.");
    },
  };
  db.leer = (r) => docs.get(r)?.datos;
  return db;
}

const CUATRO = ["ana", "beto", "caro", "dani"];
const CODIGO = "D2TEST";
let reloj = 400000;

function montar() {
  const db = crearFirestore();
  const red = crearMotorEnRed({
    db, partidas: "partidas", ahora: () => reloj, idAleatorio: () => `v${reloj}_${version()}`,
    marcaDeTiempo: () => "T", error, semillaDe: () => 31337,
  });
  return { db, red };
}
let n = 0;
const version = () => ++n;

const capturar = async (fn) => {
  try { return { valor: await fn() }; } catch (e) { return { error: e }; }
};

async function nueva() {
  reloj = 400000;
  const { db, red } = montar();
  await red.repartir({ yaSentados: true, codigo: CODIGO, jugadores: CUATRO, nombres: CUATRO });
  return { db, red };
}

const partida = (db) => db.leer(`partidas/${CODIGO}`);
const vista = (db, uid) => db.leer(`partidas/${CODIGO}/vistas/${uid}`);

/** Descarta la posición `pos`, declarando que reaccionó en `enMs`. */
const tocar = (red, uid, v, pos, enMs, id) =>
  capturar(() => red.intentarDescarte({
    uid, codigo: CODIGO, windowId: v.id, posicion: pos,
    clientActionId: id, declarado: enMs, latencia: 40, incertidumbre: 20,
  }));

// =================================================== 1. la ventana existe

console.log("\n=== 1. La ventana nace con la mirada ===");
{
  const { db } = await nueva();
  const p = partida(db);

  ok(p.estado.fase === "mirar", "la partida arranca mirando", p.estado.fase);
  ok(Boolean(p.ventana), "y YA tiene ventana de descarte");
  ok(p.ventana.abiertaEn === 400000, "abierta en el instante del reparto", p.ventana.abiertaEn);
  ok(p.ventana.duracionMs === MS_MIRADA_TOTAL + MS_VENTANA,
     "que dura 7 s de mirada + 5 s de descarte = 12 s", p.ventana.duracionMs);
  ok(p.ventana.graciaMs === MS_GRACIA, "la gracia no cambia", p.ventana.graciaMs);
  ok(Object.keys(p.ventana.intentos).length === 0, "y sin intentos todavía");

  ok(p.plazo.que === "cerrarMirada", "el plazo es cerrar la mirada", p.plazo.que);
  ok(p.plazo.hasta === p.ventana.abiertaEn + MS_MIRADA_TOTAL,
     "a los 7 s de ABRIRSE LA VENTANA, no de este golpe",
     p.plazo.hasta - p.ventana.abiertaEn);
}

// ============================================ 2. descartar durante mirar

console.log("\n=== 2. Se puede descartar durante la mirada ===");
{
  const { db, red } = await nueva();
  const v = partida(db).ventana;

  // Apenas empieza: 100 ms después de abrirse.
  reloj = v.abiertaEn + 140;
  const alPrincipio = await tocar(red, "ana", v, 0, 100, "temprano");
  ok(alPrincipio.valor?.anotado === true,
     "al principio de la mirada se anota", alPrincipio.error?.message);
  ok(partida(db).estado.fase === "mirar", "y la fase sigue siendo mirar", partida(db).estado.fase);

  // Al filo de que termine la mirada.
  reloj = v.abiertaEn + MS_MIRADA_TOTAL - 60;
  const alFinal = await tocar(red, "beto", v, 1, MS_MIRADA_TOTAL - 100, "al-filo");
  ok(alFinal.valor?.anotado === true, "al final de la mirada también", alFinal.error?.message);

  ok(Object.keys(partida(db).ventana.intentos).length === 2,
     "los dos quedan anotados en la MISMA ventana",
     Object.keys(partida(db).ventana.intentos).length);
}

// ============================ 2b. la mirada dura cinco más dos

console.log("\n=== 2b. Cinco segundos para elegir, dos para ver ===");
{
  /**
   * La fase `mirar` duraba MS_MIRAR —dos segundos— y había que elegir Y llegar
   * al servidor dentro de ellos. En entrenamiento, en cambio, siempre hubo
   * cinco para elegir y dos para ver.
   *
   * No era una diferencia teórica: el 17 de septiembre de 2026 una mirada de
   * producción llegó a una instancia recién arrancada, tardó 1679 ms adentro
   * de la función y se rechazó con un 400 porque la mirada ya estaba cerrada.
   *
   * Lo que se comprueba: que al cuarto segundo la mirada siga abierta y se
   * acepte, que a los siete se cierre, y que la ventana de la ronda se haya
   * estirado con ella en vez de comerse el descarte.
   */
  const { db, red } = await nueva();
  const v = partida(db).ventana;

  reloj = v.abiertaEn + 4000;
  await red.avanzarPartida({ codigo: CODIGO });
  ok(partida(db).estado.fase === "mirar",
     "al cuarto segundo la mirada sigue abierta", partida(db).estado.fase);

  const r = await red.accionDeTurno({
    uid: "ana", codigo: CODIGO, accion: "mirar", clientActionId: "tarde-pero-a-tiempo", posicion: 2,
  });
  ok(Boolean(r.carta?.id), "y una mirada al cuarto segundo se acepta", r.carta?.id);

  reloj = v.abiertaEn + MS_MIRADA_TOTAL;
  const cierre = await red.avanzarPartida({ codigo: CODIGO });
  ok(cierre.hizo === "cerrarMirada", "a los siete se cierra", cierre.hizo);

  // Y el descarte conserva sus cinco segundos enteros: la ventana se estiró,
  // no se repartió. Si `MS_VENTANA_TOTAL` volviera a ser MS_MIRAR + MS_VENTANA,
  // la mirada se comería los tres últimos segundos de reflejos.
  ok(v.duracionMs - MS_MIRADA_TOTAL === MS_VENTANA,
     "y quedan los 5 s de descarte enteros después de la mirada",
     v.duracionMs - MS_MIRADA_TOTAL);
}

// ================================ 3. una sola ventana de punta a punta

console.log("\n=== 3. Una sola ventana, de la mirada al cierre ===");
{
  const { db, red } = await nueva();
  const inicial = partida(db).ventana;

  reloj = inicial.abiertaEn + 300;
  await tocar(red, "ana", inicial, 0, 260, "durante-mirar");

  // Se cierra la mirada.
  reloj = inicial.abiertaEn + MS_MIRADA_TOTAL;
  const cierreMirada = await red.avanzarPartida({ codigo: CODIGO });
  ok(cierreMirada.hizo === "cerrarMirada", "la mirada se cierra a los 7 s", cierreMirada.hizo);
  ok(partida(db).estado.fase === "descarte", "y empieza el descarte", partida(db).estado.fase);

  const trasMirada = partida(db).ventana;
  ok(trasMirada.id === inicial.id, "la ventana es la MISMA", [trasMirada.id, inicial.id]);
  ok(trasMirada.abiertaEn === inicial.abiertaEn, "con su hora original");
  ok(Object.keys(trasMirada.intentos).length === 1,
     "y el intento de la mirada sigue vivo", Object.keys(trasMirada.intentos).length);

  // Golpear mil veces no abre otra.
  for (let i = 0; i < 20; i++) await red.avanzarPartida({ codigo: CODIGO });
  ok(partida(db).ventana.id === inicial.id, "veinte golpes no abren una segunda");

  // Y todavía se puede descartar, ahora en fase `descarte`.
  reloj = inicial.abiertaEn + MS_MIRADA_TOTAL + 500;
  const enDescarte = await tocar(red, "beto", inicial, 1, MS_MIRADA_TOTAL + 460, "durante-descarte");
  ok(enDescarte.valor?.anotado === true, "se sigue descartando en la fase descarte",
     enDescarte.error?.message);
}

// ============================== 4. el intento de la mirada se resuelve

console.log("\n=== 4. Lo tocado durante la mirada se aplica al terminar la mirada ===");
{
  const { db, red } = await nueva();
  const v = partida(db).ventana;
  const muestra = partida(db).estado.descarte[0];
  const manoAna = partida(db).estado.jugadores[0].mano;

  // Ana toca, DURANTE LA MIRADA, una carta que no coincide: error seguro.
  const posMala = manoAna.findIndex((c) => c && c.numero !== muestra.numero);
  const equivocada = manoAna[posMala];
  reloj = v.abiertaEn + 200;
  await tocar(red, "ana", v, posMala, 160, "error-en-mirar");

  const cartasAntes = manoAna.filter(Boolean).length;

  /*
   * Y SE APLICA AL TERMINAR LA MIRADA, SIN QUE NADIE CIERRE NADA. (§51, ítem 2)
   *
   * Esta sección pasó por tres formas, y conviene saberlo porque el nombre
   * «al cerrar» quedó dando vueltas:
   *
   *   1. la ventana vencía sola por reloj y ahí se resolvía;
   *   2. la etapa 3b le sacó el cronómetro, así que había que cerrarla a mano
   *      con el callable para poder observar lo mismo;
   *   3. y ahora no hace falta cerrar nada: el pendiente se aplica cuando la
   *      mirada termina, que es el primer instante en que el motor lo acepta.
   *
   * Un solo golpe basta —el que cumple el plazo `cerrarMirada`— y la ventana
   * queda ABIERTA después, que es lo que se comprueba acá abajo.
   */
  reloj = v.abiertaEn + MS_MIRADA_TOTAL;
  await red.avanzarPartida({ codigo: CODIGO });

  const deAna = partida(db).ventana.intentos["error-en-mirar"];
  ok(deAna?.aplicadoAlLlegar === true,
     "el intento hecho en la MIRADA ya está aplicado", deAna?.aplicadoAlLlegar);
  ok(deAna?.resultado === "error", "y se aplicó como error", deAna?.resultado);
  ok(partida(db).ventana.cerrada === false,
     "y la ventana sigue abierta: nadie la cerró", partida(db).ventana.cerrada);

  const despues = partida(db).estado.jugadores[0].mano;
  ok(despues.filter(Boolean).length === cartasAntes + 1,
     "y costó una carta de castigo", [cartasAntes, despues.filter(Boolean).length]);
  ok(despues[posMala]?.id === equivocada.id, "la carta equivocada no se movió");

  // Y la mesa la ve, dos segundos.
  ok(vista(db, "beto").jugadores[0].mano[posMala]?.id === equivocada.id,
     "beto la ve destapada durante la revelación");

  reloj += MS_REVELACION;
  await red.avanzarPartida({ codigo: CODIGO });
  ok(!JSON.stringify(vista(db, "beto")).includes(`"${equivocada.id}"`),
     "y pasados los 2 s desaparece: no queda marca");
}

// ================================== 5. el orden es el de llegada

console.log("\n=== 5. Gana el que llegó antes, y el tiempo de reacción queda anotado ===");
{
  const { db, red } = await nueva();
  const p0 = partida(db);
  const muestra = p0.estado.descarte[0];

  // Se plantan dos coincidencias reales para que el careo ocurra siempre y no
  // dependa de la semilla: ana y beto tienen, cada uno, una carta del mismo
  // número que la muestra, en la posición 0.
  const gemela = (palo) => ({ id: `${palo}-${muestra.numero}`, palo, numero: muestra.numero, puntos: muestra.numero });
  const usadas = new Set([`Oro-${muestra.numero}`, `Copa-${muestra.numero}`]);
  await db.runTransaction(async (tx) => {
    tx.set({ ruta: `partidas/${CODIGO}` }, {
      ...p0,
      estado: {
        ...p0.estado,
        mazo: p0.estado.mazo.filter((c) => !usadas.has(c.id)),
        jugadores: p0.estado.jugadores.map((j, i) =>
          i === 0 ? { ...j, mano: [gemela("Oro"), ...j.mano.slice(1)] }
          : i === 1 ? { ...j, mano: [gemela("Copa"), ...j.mano.slice(1)] }
          : j),
      },
      version: p0.version + 1,
    });
  });
  const v = partida(db).ventana;

  /*
   * ESTA SECCIÓN SE DIO VUELTA DOS VECES, Y VOLVIÓ A DONDE EMPEZÓ.
   *
   * ─────────────────────────────────────────────────────────────────────────
   *
   * Ana reacciona DURANTE LA MIRADA (ms 300) con una conexión mala: su pedido
   * llega en el 1400. Beto reacciona mucho después, ya en el descarte, pero
   * con fibra. Gana ana, y conviene saber por qué gana hoy, porque no es por
   * lo que ganaba antes.
   *
   *   1. Al principio ganaba por el TIEMPO EFECTIVO: al cerrar la ventana se
   *      ordenaba todo por reacción corregida y la suya era menor.
   *   2. La etapa 2 se llevó ese orden —y el empate técnico— porque cada
   *      descarte pasó a aplicarse al llegar. El toque de ana, que es de la
   *      mirada, quedaba pendiente hasta el tiro siguiente, así que empezó a
   *      PERDER contra beto. Quedó escrito acá, dado vuelta, como el costo
   *      asumido de la decisión.
   *   3. Y resultó un costo que no hacía falta pagar (§51, ítem 2). Los
   *      pendientes de la mirada se aplican al TERMINAR LA MIRADA, que es el
   *      primer instante en que el motor puede aceptarlos. Ana vuelve a
   *      ganar, y ahora por el motivo más simple de los tres: tocó antes y
   *      llegó antes, así que el orden de llegada la pone primera.
   *
   * O sea que la aserción volvió a su forma original por un camino distinto.
   * Se deja la historia escrita porque la próxima vez que alguien lea «gana
   * ana» va a querer saber si es por reacción o por llegada, y la respuesta
   * cambió dos veces.
   *
   * Lo que NO decide nada pero sigue anotado es `efectivo`: se comprueba al
   * final, porque es el único registro de cuándo reaccionó cada uno.
   */
  reloj = v.abiertaEn + 1400;
  const lenta = await capturar(() => red.intentarDescarte({
    uid: "ana", codigo: CODIGO, windowId: v.id, posicion: 0,
    clientActionId: "ana-lenta", declarado: 300, latencia: 550, incertidumbre: 275,
  }));
  ok(lenta.valor?.anotado === true, "ana descarta durante la mirada", lenta.error?.message);

  /*
   * Y la mirada termina: de acá en adelante el motor SÍ acepta descartes.
   *
   * Hacía falta ponerlo. Beto tocaba en el ms 3000 con el comentario «ya en
   * el descarte», y no era cierto: la ventana de la ronda abarca los 7 s de
   * mirada más los 2 de descarte, así que el 3000 cae en plena mirada. Daba
   * igual mientras los dos se resolvieran al cerrar; ahora es justamente la
   * diferencia que se prueba.
   */
  reloj = v.abiertaEn + MS_MIRADA_TOTAL;
  await red.cerrarMirada({ codigo: CODIGO });

  reloj = v.abiertaEn + MS_MIRADA_TOTAL + 530;
  const rapida = await capturar(() => red.intentarDescarte({
    uid: "beto", codigo: CODIGO, windowId: v.id, posicion: 0,
    clientActionId: "beto-rapido", declarado: MS_MIRADA_TOTAL + 500,
    latencia: 30, incertidumbre: 15,
  }));
  ok(rapida.valor?.anotado === true, "beto descarta ya en el descarte", rapida.error?.message);

  // El de ana ya está aplicado: se resolvió al terminar la mirada, antes de
  // que beto tocara. Y se llevó el «primero», que es el premio por llegar.
  const deAna = partida(db).ventana.intentos["ana-lenta"];
  ok(deAna?.aplicadoAlLlegar === true,
     "el de ana se aplicó al terminar la mirada", deAna?.aplicadoAlLlegar);
  ok(deAna?.resultado === "primero",
     "y se lleva el 'primero': tocó antes y llegó antes", deAna?.resultado);

  // Y el de beto, que llegó después sobre la misma muestra, se come su castigo.
  const deBeto = partida(db).ventana.intentos["beto-rapido"];
  ok(deBeto?.aplicadoAlLlegar === true, "el de beto se aplicó al llegar", deBeto?.aplicadoAlLlegar);
  ok(deBeto?.resultado === "tarde",
     "pero llega tarde: ana ya se había llevado la muestra", deBeto?.resultado);

  // Lo que el cambio NO se llevó: `efectivo` sigue midiendo REACCIÓN y no
  // conexión, y el de ana sigue siendo el menor de los dos. Ya no decide
  // quién gana; es el registro de cuándo reaccionó cada uno.
  const efectivos = Object.values(partida(db).ventana.intentos)
    .sort((a, b) => a.efectivo - b.efectivo).map((x) => [x.uid, x.efectivo]);
  ok(efectivos[0][0] === "ana" && efectivos[0][1] < efectivos[1][1],
     "el tiempo efectivo de ana es menor", efectivos);
}

// ========================================= 6. fuera de la ventana, no

console.log("\n=== 6. Lo que cierra la puerta es la ventana, no el reloj ===");
{
  const { db, red } = await nueva();
  const v = partida(db).ventana;

  /*
   * UNA REACCIÓN TARDÍA YA NO SE RECHAZA. (Etapa 3b/3)
   *
   * Acá se pedía «fuera de tiempo» para una reacción posterior al final de la
   * ventana: lo tardío que se admitía era la LLEGADA, nunca la reacción. Era
   * la regla mientras la ventana venciera a los 2 s.
   *
   * En red no vence: vive mientras viva la muestra. Una reacción en el
   * segundo 11, con el del turno todavía pensando, es tan válida como la del
   * primero. La aserción se da vuelta.
   */
  reloj = v.abiertaEn + v.duracionMs + 500;
  const tardio = await tocar(red, "ana", v, 0, v.duracionMs + 400, "tarde");
  ok(tardio.valor?.anotado === true,
     "reaccionar después del final nominal de la ventana vale", tardio.error?.message);

  // Lo que SÍ cierra la puerta sigue siendo la ventana: cerrada, no entra
  // nada. Es la única guarda que queda, y es la que importa.
  reloj = v.abiertaEn + MS_MIRADA_TOTAL;
  await red.cerrarMirada({ codigo: CODIGO });
  await red.cerrarVentana({ codigo: CODIGO, forzar: true });
  const cerrada = await tocar(red, "beto", v, 0, 500, "post-cierre");
  ok(Boolean(cerrada.error), "con la ventana cerrada, no", cerrada.error?.message);
}

// =========================== 7. un windowId viejo no cuela en otra ronda

console.log("\n=== 7. Cada ronda estrena su ventana ===");
{
  const { db, red } = await nueva();
  const primera = partida(db).ventana;

  // Se fuerza el fin de ronda para llegar a la siguiente.
  const p = partida(db);
  await db.runTransaction(async (tx) => {
    tx.set({ ruta: `partidas/${CODIGO}` }, {
      ...p, estado: { ...p.estado, fase: "finRonda" }, plazo: null, version: p.version + 1,
    });
  });
  await red.avanzarPartida({ codigo: CODIGO });   // repone el plazo
  reloj += 60000;
  await red.avanzarPartida({ codigo: CODIGO });   // siguienteRonda

  const segunda = partida(db).ventana;
  ok(partida(db).estado.fase === "mirar", "la ronda nueva arranca mirando", partida(db).estado.fase);
  ok(Boolean(segunda) && segunda.id !== primera.id, "con una ventana nueva",
     [segunda?.id, primera.id]);
  ok(Object.keys(segunda.intentos).length === 0, "sin intentos heredados");

  // El identificador de la ventana anterior ya no sirve.
  const conVieja = await tocar(red, "ana", primera, 0, 200, "ventana-vieja");
  ok(/otra ronda/i.test(conVieja.error?.message ?? ""),
     "un intento con el windowId viejo se rechaza", conVieja.error?.message);
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
