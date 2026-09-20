/**
 * Salas privadas: se entra con un código que el servidor no guarda.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE SE DEFIENDE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. Que el código NO esté en la base. Lo que se guarda es un hash, así que
 *    una copia de Firestore no es una copia de las llaves. La prueba recorre
 *    todos los documentos escritos y busca el código en claro.
 * 2. Que el identificador de la sala no sirva para entrar. Está en la URL de
 *    quien ya entró: si alcanzara, compartir una captura sería compartir la
 *    llave.
 * 3. Que el código caduque, y que caducar se note igual que no existir: el
 *    mensaje es el mismo para los dos, porque decir cuál de las dos cosas
 *    pasó le sirve sobre todo a quien está probando códigos.
 * 4. Que haya un techo de cinco intentos por minuto y por IP. Por cuenta no
 *    frenaría nada: crear cuentas es gratis.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL COBRO NO SE PRUEBA ACÁ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `abrirSalaEn` y `sumarse` vienen de afuera y son los mismos que usan las
 * salas normales, con su `moverLeyendas`: eso se prueba en `salas.mjs` y en
 * `transacciones.mjs`. Acá se les pasa una versión que escribe la sala sin
 * mover saldo, para que lo que se mida sea el código y no el dinero.
 */

import {
  crearSalasPrivadas,
  generarCodigoSecreto,
  hashDeCodigo,
  normalizarCodigo,
  LARGO_CODIGO,
  MINUTOS_VIGENCIA_MINIMA,
  MINUTOS_VIGENCIA_MAXIMA,
} from "../functions/salas-privadas.js";
import { crearLimiteDeRitmo, LIMITES_POR_IP } from "../functions/limite-de-ritmo.js";
import { puedeUnirse, RECHAZO } from "../public/js/reglas/salas.js";
import { readFileSync } from "node:fs";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

class E extends Error {
  constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; }
}
const error = (codigo, mensaje) => new E(codigo, mensaje);

/** Firestore de mentira: lo justo para transacciones, consultas y lotes. */
function crearFirestore() {
  const docs = new Map();

  const coleccion = (nombre) => ({
    doc: (id = `auto${docs.size}`) => ({ ruta: `${nombre}/${id}`, id }),
    where(campo, op, valor) {
      const filtrar = () =>
        [...docs.entries()]
          .filter(([ruta]) => ruta.startsWith(`${nombre}/`))
          .filter(([, d]) => (op === "<=" ? d[campo] <= valor : d[campo] === valor))
          .map(([ruta, d]) => ({ ref: { ruta }, data: () => d }));
      const consulta = {
        limit: () => consulta,
        get: async () => ({ docs: filtrar() }),
      };
      return consulta;
    },
  });

  return {
    docs,
    collection: coleccion,
    batch() {
      const ops = [];
      return {
        delete: (ref) => ops.push(ref.ruta),
        commit: async () => ops.forEach((r) => docs.delete(r)),
      };
    },
    async runTransaction(cuerpo) {
      const escrituras = [];
      let yaEscribio = false;
      const tx = {
        async get(ref) {
          if (yaEscribio) throw error("internal", "Lectura después de escritura");
          const d = docs.get(ref.ruta);
          return { exists: Boolean(d), data: () => structuredClone(d) };
        },
        set(ref, datos) { yaEscribio = true; escrituras.push([ref.ruta, datos]); },
        update(ref, datos) {
          yaEscribio = true;
          escrituras.push([ref.ruta, { ...(docs.get(ref.ruta) ?? {}), ...datos }]);
        },
      };
      const salida = await cuerpo(tx);
      escrituras.forEach(([ruta, datos]) => docs.set(ruta, datos));
      return salida;
    },
    /** Todo lo escrito, en una sola cadena. Para buscar un secreto adentro. */
    volcado: () => JSON.stringify([...docs.entries()]),
  };
}

let reloj = 1_700_000_000_000;

/** Una sala escrita de verdad, pero sin mover un solo Leyenda. */
function montar({ pimienta = "pimienta-de-prueba" } = {}) {
  const db = crearFirestore();
  let siguiente = 0;

  const privadas = crearSalasPrivadas({
    db,
    salas: "rooms",
    codigos: "codigos",
    error,
    ahora: () => reloj,
    marcaDeTiempo: () => "AHORA",
    pimienta,
    abrirSalaEn: async (tx, { codigo, uid, entrada, nombre, nombreJugador, luce, extra }) => {
      if ((await tx.get(db.collection("rooms").doc(codigo))).exists) {
        throw new Error("codigo-ocupado");
      }
      tx.set(db.collection("rooms").doc(codigo), {
        codigo, nombre, entrada, creador: uid,
        jugadores: [uid], jugadoresNombres: [nombreJugador], jugadoresLuce: [luce],
        estado: "esperando", listos: [], pozo: entrada, maxJugadores: 4,
        ...(extra ?? {}),
      });
    },
    sumarse: async (tx, { refSala, sala, codigo, uid, nombreJugador }) => {
      const veredicto = puedeUnirse(sala, uid, 9999, { conCodigo: true });
      if (!veredicto.puede) throw error("failed-precondition", veredicto.mensaje);
      tx.update(refSala, {
        jugadores: [...(sala.jugadores ?? []), uid],
        jugadoresNombres: [...(sala.jugadoresNombres ?? []), nombreJugador],
      });
      return { codigo, entrada: sala.entrada };
    },
    identidadEnSala: async (uid) => ({ nombre: `Nombre de ${uid}`, luce: {} }),
    generarIdDeSala: () => `SAL${String(++siguiente).padStart(3, "0")}`,
  });

  return { db, privadas };
}

const capturar = async (f) => {
  try { return { valor: await f() }; } catch (e) { return { error: e }; }
};

// =====================================================================
console.log("\n=== 1. El código sale una vez y no queda en la base ===");
// =====================================================================
{
  const { db, privadas } = montar();
  const r = await privadas.crearSalaPrivada({ uid: "ana", entrada: 10, limitePuntos: 100 });

  ok(r.codigo.length === LARGO_CODIGO, `el código tiene ${LARGO_CODIGO} caracteres`, r.codigo.length);
  ok(/^[A-Z2-9]+$/.test(r.codigo), "sin letras que se confundan al dictarlo", r.codigo);
  ok(r.sala === "SAL001", "y devuelve el identificador de la sala, que es otra cosa", r.sala);
  ok(r.vence > reloj, "con una fecha de vencimiento por delante", r.vence - reloj);

  const volcado = db.volcado();
  ok(!volcado.includes(r.codigo),
     "EL CÓDIGO NO ESTÁ EN NINGÚN DOCUMENTO",
     volcado.slice(0, 200));

  const hash = hashDeCodigo(r.codigo, "pimienta-de-prueba");
  ok(db.docs.has(`codigos/${hash}`), "lo que se guarda es su hash");
  ok(db.docs.get(`codigos/${hash}`).sala === r.sala, "y apunta a la sala");
}

// =====================================================================
console.log("\n=== 2. La sala nace privada y fuera de las listas ===");
// =====================================================================
{
  const { db, privadas } = montar();
  const r = await privadas.crearSalaPrivada({ uid: "ana", entrada: 10, limitePuntos: 60 });
  const sala = db.docs.get(`rooms/${r.sala}`);

  ok(sala.privada === true, "queda marcada como privada", sala.privada);
  ok(sala.listada === false, "y fuera de la lista pública", sala.listada);
  ok(sala.limitePuntos === 60, "con la duración que se pidió", sala.limitePuntos);
  ok(sala.codigoVence === r.vence, "y con la fecha en que caduca la invitación");
}

// =====================================================================
console.log("\n=== 3. Con el código se entra; con el identificador, no ===");
// =====================================================================
{
  const { db, privadas } = montar();
  const r = await privadas.crearSalaPrivada({ uid: "ana", entrada: 10 });

  const entro = await privadas.unirseConCodigo({ uid: "beto", codigo: r.codigo });
  ok(entro.sala === r.sala, "con el código se entra", entro.sala);
  ok(db.docs.get(`rooms/${r.sala}`).jugadores.includes("beto"), "y queda sentado");

  // La misma puerta de siempre, con el identificador de la sala: NO.
  const veredicto = puedeUnirse(db.docs.get(`rooms/${r.sala}`), "caro", 9999);
  ok(!veredicto.puede && veredicto.motivo === RECHAZO.PRIVADA,
     "el identificador no sirve para sumarse", veredicto);
}

// =====================================================================
console.log("\n=== 4. Se acepta como lo dicta una persona ===");
// =====================================================================
{
  const { privadas } = montar();
  const r = await privadas.crearSalaPrivada({ uid: "ana", entrada: 10 });

  const conRuido = `${r.codigo.slice(0, 4).toLowerCase()}-${r.codigo.slice(4)} `;
  const entro = await privadas.unirseConCodigo({ uid: "beto", codigo: conRuido });
  ok(entro.sala === r.sala, "minúsculas, guiones y espacios entran igual", conRuido);

  ok(normalizarCodigo("ab-cd ef1") === "ABCDEF", "la normalización tira lo que no es del alfabeto");
}

// =====================================================================
console.log("\n=== 5. Un código que no existe y uno vencido dicen lo mismo ===");
// =====================================================================
{
  const { privadas } = montar();
  const r = await privadas.crearSalaPrivada({ uid: "ana", entrada: 10, vigenciaMinutos: 10 });

  const inventado = await capturar(() =>
    privadas.unirseConCodigo({ uid: "beto", codigo: "ZZZZZZZZ" }));
  ok(Boolean(inventado.error), "un código inventado se rechaza");

  const corto = await capturar(() =>
    privadas.unirseConCodigo({ uid: "beto", codigo: "ABC" }));
  ok(Boolean(corto.error), "y uno de largo equivocado, también");

  reloj += 10 * 60_000 + 1;
  const vencido = await capturar(() =>
    privadas.unirseConCodigo({ uid: "beto", codigo: r.codigo }));
  ok(Boolean(vencido.error), "el código vencido ya no sirve");

  ok(vencido.error.message === inventado.error.message,
     "y el mensaje es el MISMO que el de uno inventado",
     [vencido.error.message, inventado.error.message]);

  reloj -= 10 * 60_000 + 1;
}

// =====================================================================
console.log("\n=== 6. La vigencia se puede elegir, dentro de lo razonable ===");
// =====================================================================
{
  const { privadas } = montar();
  const min = MINUTOS_VIGENCIA_MINIMA * 60_000;
  const max = MINUTOS_VIGENCIA_MAXIMA * 60_000;

  ok(privadas.vigenciaEnMs(undefined) === 30 * 60_000, "sin pedir nada, media hora");
  ok(privadas.vigenciaEnMs(90) === 90 * 60_000, "lo pedido, si es razonable");
  ok(privadas.vigenciaEnMs(1) === min, "un minuto se sube al mínimo", privadas.vigenciaEnMs(1));
  ok(privadas.vigenciaEnMs(99999) === max, "y un año se baja al máximo");
  ok(privadas.vigenciaEnMs("mucho") === 30 * 60_000, "un texto cae en el valor de siempre");
}

// =====================================================================
console.log("\n=== 7. La pimienta cambia el hash ===");
// =====================================================================
{
  const codigo = "ABCDEFGH";
  ok(hashDeCodigo(codigo, "una") !== hashDeCodigo(codigo, "otra"),
     "el mismo código con otra pimienta da otro hash");
  ok(hashDeCodigo(codigo, "una") === hashDeCodigo("abcdefgh", "una"),
     "y la normalización pasa antes del hash");

  // Y con la pimienta equivocada, el código bueno no abre nada.
  const { privadas } = montar({ pimienta: "la-de-produccion" });
  const r = await privadas.crearSalaPrivada({ uid: "ana", entrada: 10 });
  const otra = montar({ pimienta: "otra-distinta" });
  const intento = await capturar(() =>
    otra.privadas.unirseConCodigo({ uid: "beto", codigo: r.codigo }));
  ok(Boolean(intento.error), "un servidor con otra pimienta no reconoce el código");
}

// =====================================================================
console.log("\n=== 8. Dos salas, dos códigos ===");
// =====================================================================
{
  const { privadas } = montar();
  const vistos = new Set();
  for (let i = 0; i < 20; i++) {
    vistos.add((await privadas.crearSalaPrivada({ uid: `u${i}`, entrada: 10 })).codigo);
  }
  ok(vistos.size === 20, "veinte salas dan veinte códigos distintos", vistos.size);
  ok(generarCodigoSecreto() !== generarCodigoSecreto(), "y el generador no se repite");
}

// =====================================================================
console.log("\n=== 9. Los códigos vencidos se limpian; las salas no ===");
// =====================================================================
{
  const { db, privadas } = montar();
  const viejo = await privadas.crearSalaPrivada({ uid: "ana", entrada: 10, vigenciaMinutos: 5 });
  reloj += 6 * 60_000;
  const nuevo = await privadas.crearSalaPrivada({ uid: "beto", entrada: 10, vigenciaMinutos: 60 });

  const { borrados } = await privadas.limpiarCodigosVencidos();
  ok(borrados === 1, "se borra el vencido y nada más", borrados);
  ok(!db.docs.has(`codigos/${hashDeCodigo(viejo.codigo, "pimienta-de-prueba")}`),
     "el código viejo ya no está");
  ok(db.docs.has(`codigos/${hashDeCodigo(nuevo.codigo, "pimienta-de-prueba")}`),
     "el vivo sigue");
  ok(db.docs.has(`rooms/${viejo.sala}`), "y la sala vieja sigue en pie: lo que venció es la invitación");
}

// =====================================================================
console.log("\n=== 10. Cinco intentos por minuto y por IP ===");
// =====================================================================
{
  const db = crearFirestore();
  const limite = crearLimiteDeRitmo({ db, error, ahora: () => reloj });
  const tope = LIMITES_POR_IP.unirseConCodigo;
  ok(tope === 5, "el techo es de cinco", tope);

  for (let i = 0; i < tope; i++) {
    const r = await capturar(() => limite.exigirRitmoPorIP("1.2.3.4", "unirseConCodigo"));
    ok(!r.error, `intento ${i + 1} de ${tope}: pasa`);
  }

  const sexto = await capturar(() => limite.exigirRitmoPorIP("1.2.3.4", "unirseConCodigo"));
  ok(Boolean(sexto.error), "el sexto se rechaza");
  ok(sexto.error.codigo === "resource-exhausted", "con el código que el SDK traduce a 429",
     sexto.error.codigo);

  const otraIP = await capturar(() => limite.exigirRitmoPorIP("9.9.9.9", "unirseConCodigo"));
  ok(!otraIP.error, "otra IP tiene su propia cuenta");

  reloj += 61_000;
  const despues = await capturar(() => limite.exigirRitmoPorIP("1.2.3.4", "unirseConCodigo"));
  ok(!despues.error, "pasado el minuto, se puede de nuevo");
}

// =====================================================================
console.log("\n=== 11. Sin pimienta no se abre ni se entra a ninguna sala ===");
// =====================================================================
{
  /**
   * El agujero que esto tapa.
   *
   * La pimienta se leía con `process.env.PIMIENTA_CODIGOS ?? ""`. Las dos
   * callables se desplegaron SIN declarar el secreto —en Functions v1 hay que
   * pedirlo con `runWith({ secrets: [...] })`— así que el entorno no lo tenía,
   * el `??` lo tapaba, y el servidor hasheaba con cadena vacía contestando
   * 200. Estuvo así en producción.
   *
   * Un servicio caído se arregla en un despliegue. Un servicio que parece
   * andar y guarda hashes sin pimienta hay que rehacerlo entero.
   *
   * Acá se monta SIN inyectar pimienta y con el entorno vacío, que es
   * exactamente lo que había desplegado.
   */
  const antes = process.env.PIMIENTA_CODIGOS;
  delete process.env.PIMIENTA_CODIGOS;

  try {
    const { db, privadas } = montar({ pimienta: null });

    const alCrear = await capturar(() =>
      privadas.crearSalaPrivada({ uid: "ana", entrada: 10 }));
    ok(Boolean(alCrear.error), "sin pimienta, crear una sala privada FALLA", alCrear.valor);
    ok(alCrear.error?.codigo === "failed-precondition",
       "y falla diciendo que el servicio no está disponible", alCrear.error?.codigo);

    const alEntrar = await capturar(() =>
      privadas.unirseConCodigo({ uid: "beto", codigo: "ABCDEFGH" }));
    ok(Boolean(alEntrar.error), "y entrar con un código, también");
    ok(alEntrar.error?.codigo === "failed-precondition",
       "por la misma razón, y no por «código inválido»: la diferencia importa",
       alEntrar.error?.codigo);

    ok(db.volcado() === "[]", "y no quedó nada escrito", db.volcado().slice(0, 120));

    // Con el entorno puesto, lo mismo funciona y usa ESA pimienta.
    process.env.PIMIENTA_CODIGOS = "la-del-entorno";
    const conEntorno = montar({ pimienta: null });
    const r = await conEntorno.privadas.crearSalaPrivada({ uid: "ana", entrada: 10 });
    ok(conEntorno.db.docs.has(`codigos/${hashDeCodigo(r.codigo, "la-del-entorno")}`),
       "con la pimienta en el entorno, el hash sale con ella");
    ok(!conEntorno.db.docs.has(`codigos/${hashDeCodigo(r.codigo, "")}`),
       "y NO con la cadena vacía, que es lo que pasaba antes");
  } finally {
    if (antes === undefined) delete process.env.PIMIENTA_CODIGOS;
    else process.env.PIMIENTA_CODIGOS = antes;
  }
}

// =====================================================================
console.log("\n=== 12. Las dos callables DECLARAN el secreto ===");
// =====================================================================
{
  /**
   * Esto es una prueba de texto, y tiene que serlo.
   *
   * El bug no estuvo en la lógica: estuvo en cómo se declaró la función. En
   * Functions v1, un secreto de Secret Manager llega al entorno sólo si la
   * función lo pide con `runWith({ secrets: [...] })`. Las dos callables se
   * desplegaron sin eso, así que `process.env.PIMIENTA_CODIGOS` no existía —y
   * ninguna prueba de lógica podía verlo, porque la lógica estaba bien—.
   *
   * Así que se lee el archivo y se comprueba la declaración.
   */
  const indice = readFileSync(
    new URL("../functions/index.js", import.meta.url), "utf8",
  );

  ok(/const conPimienta = functions\.runWith\(\{\s*secrets:\s*\[SECRETO_PIMIENTA\]\s*\}\)/
     .test(indice),
     "existe una envoltura que declara el secreto");
  ok(/const SECRETO_PIMIENTA = "PIMIENTA_CODIGOS"/.test(indice),
     "y el secreto es PIMIENTA_CODIGOS");

  for (const nombre of ["crearSalaPrivada", "unirseConCodigo"]) {
    const declara = new RegExp(
      `export const ${nombre} = conPimienta\\.https\\.onCall`,
    ).test(indice);
    ok(declara, `${nombre} se declara con el secreto puesto`);

    const suelta = new RegExp(
      `export const ${nombre} = functions\\.https\\.onCall`,
    ).test(indice);
    ok(!suelta, `${nombre} NO se declara sin él`);
  }

  /**
   * Y la de al lado: cualquier callable que use `salasPrivadas` tiene que ir
   * por la misma puerta. Hoy son dos; el día que haya una tercera —una
   * limpieza de códigos vencidos, una migración— esto la agarra.
   */
  const callables = [...indice.matchAll(
    /export const (\w+) = (\w+)\.(?:runWith\([^)]*\)\.)?https\.onCall\(([\s\S]*?)\n\}\);/g,
  )];
  const sinSecreto = callables
    .filter(([, , puerta, cuerpo]) => /salasPrivadas\./.test(cuerpo) && puerta !== "conPimienta")
    .map(([, nombre]) => nombre);

  ok(sinSecreto.length === 0,
     "ninguna función que toque las salas privadas se declara sin el secreto",
     sinSecreto);
}

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
