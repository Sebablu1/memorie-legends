/**
 * El techo de llamadas por jugador.
 *
 * Dos cosas se prueban acá y la segunda es la que más vale: que el contador
 * cuente bien, y que NINGÚN límite quede por debajo de lo que el propio juego
 * necesita. Lo primero que se propuso fue 30 por minuto para las acciones de
 * juego; el navegador golpea `avanzarPartida` cada 900 ms, o sea unas 67 por
 * minuto, así que ese número habría congelado toda partida en curso a los
 * veintisiete segundos. La prueba de abajo hace esa cuenta sola.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  LIMITES,
  LIMITES_DE_PLATA,
  LIMITE_POR_OMISION,
  anotarEnMemoria,
  olvidarTodo,
  cuantasClaves,
  crearLimiteDeRitmo,
} from "../functions/limite-de-ritmo.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Cada cuánto golpea el navegador.
 *
 * Se lee del archivo en vez de importarlo porque `partida-red.js` importa el
 * SDK de Firebase desde una URL https y Node no lo puede cargar fuera del
 * navegador. Leer la fuente tiene la misma virtud que importarla: si alguien
 * cambia el número, esta prueba lo ve.
 */
const MS_ENTRE_GOLPES = (() => {
  const fuente = readFileSync(join(raiz, "public", "js", "partida-red.js"), "utf8");
  const m = fuente.match(/MS_ENTRE_GOLPES\s*=\s*(\d+)/);
  if (!m) throw new Error("No se encontró MS_ENTRE_GOLPES en partida-red.js");
  return Number(m[1]);
})();

let fallos = 0;
const ok = (cond, que) => {
  console.log(`  ${cond ? "✓" : "✗"} ${que}`);
  if (!cond) fallos++;
};

const error = (codigo, mensaje) => Object.assign(new Error(mensaje), { codigo });

// ═══════════════════════════════════════════ el contador en memoria

console.log("\n=== El contador cuenta ===");
olvidarTodo();

{
  const t = 1_000_000;
  for (let i = 0; i < 5; i++) anotarEnMemoria("ana", "tirar", 5, t);
  const sexto = anotarEnMemoria("ana", "tirar", 5, t);
  ok(sexto.permitido === false, "la sexta llamada de cinco permitidas se rechaza");
  ok(sexto.usadas === 5, "y dice cuántas se usaron");

  const otro = anotarEnMemoria("bruno", "tirar", 5, t);
  ok(otro.permitido === true, "el techo es por jugador, no global");

  const otraAccion = anotarEnMemoria("ana", "levantar", 5, t);
  ok(otraAccion.permitido === true, "y por acción: llenar una no cierra las demás");
}

console.log("\n=== La ventana se desliza, no se reinicia ===");
olvidarTodo();
{
  // Un contador que se pone en cero cada minuto redondo deja pasar el doble
  // justo en el cambio: cinco al final de un minuto y cinco al principio del
  // siguiente, diez seguidas. Con ventana deslizante eso no pasa.
  const t = 2_000_000;
  for (let i = 0; i < 5; i++) anotarEnMemoria("ana", "tirar", 5, t + i);
  ok(anotarEnMemoria("ana", "tirar", 5, t + 59_000).permitido === false,
     "a los 59 s las cinco viejas siguen contando");
  ok(anotarEnMemoria("ana", "tirar", 5, t + 61_000).permitido === true,
     "pasado el minuto, la más vieja deja de contar");
}

console.log("\n=== Insistir no alarga el castigo ===");
olvidarTodo();
{
  const t = 3_000_000;
  for (let i = 0; i < 3; i++) anotarEnMemoria("ana", "tirar", 3, t);
  // Golpea mil veces mientras está bloqueada.
  for (let i = 0; i < 1000; i++) anotarEnMemoria("ana", "tirar", 3, t + 100 + i);
  ok(anotarEnMemoria("ana", "tirar", 3, t + 61_000).permitido === true,
     "los rechazos no se anotan: quien insiste vuelve a entrar igual");
}

console.log("\n=== La memoria no se llena sin techo ===");
olvidarTodo();
{
  // El Map lo llenan uids ajenos. Sin limpieza es una fuga que escribe
  // cualquiera que sepa la URL.
  const t = 4_000_000;
  for (let i = 0; i < 10_050; i++) anotarEnMemoria(`uid${i}`, "tirar", 5, t);
  const antes = cuantasClaves();
  // Un minuto después, todas las marcas vencieron: la próxima limpia.
  anotarEnMemoria("uno-mas", "tirar", 5, t + 61_000);
  ok(cuantasClaves() < antes, `se limpian las claves vencidas (${antes} → ${cuantasClaves()})`);
}

// ═════════════════════════════ los límites contra lo que el juego necesita

console.log("\n=== Ningún límite ahoga al propio juego ===");
{
  // Esta es la prueba que importa. `mantenerEnMarcha` golpea cada
  // MS_ENTRE_GOLPES; si el techo queda por debajo de esa frecuencia, la mesa
  // se congela sola sin que nadie haga nada raro.
  const porMinuto = Math.ceil(60_000 / MS_ENTRE_GOLPES);
  ok(porMinuto === 67, `el navegador llama ${porMinuto} veces por minuto (cada ${MS_ENTRE_GOLPES} ms)`);

  for (const accion of ["avanzarPartida", "latir"]) {
    ok(LIMITES[accion] > porMinuto,
       `${accion}: el techo (${LIMITES[accion]}) supera lo que el cliente pide (${porMinuto})`);
  }

  // Y con holgura: al volver a la pestaña se dispara un golpe extra, y tras
  // un corte de red se reintenta. Un techo pegado al mínimo se rompe solo.
  for (const accion of ["avanzarPartida", "latir"]) {
    ok(LIMITES[accion] >= porMinuto * 2,
       `${accion}: y con el doble de aire para reintentos y visibilitychange`);
  }
}

console.log("\n=== Las de plata están apretadas ===");
{
  // Contra las de la mesa, no contra todas. `cancelarSalasEnEsperaAdmin` es
  // la más apretada del sistema entero —devuelve Leyendas de muchas salas de
  // un saque— y compararse contra ella no probaría nada.
  const DE_LA_MESA = [
    "intentarDescarte", "accionDePartida", "abrirVentanaDescarte",
    "cerrarVentanaDescarte", "cerrarMirada", "avanzarPartida", "latir",
  ];
  const minMesa = Math.min(...DE_LA_MESA.map((a) => LIMITES[a]));
  const maxPlata = Math.max(...Object.values(LIMITES_DE_PLATA));

  ok(maxPlata < minMesa,
     `la más suelta de plata (${maxPlata}) es más apretada que la mesa (${minMesa})`);
  ok(Object.keys(LIMITES_DE_PLATA).length === 4,
     "las cuatro que mueven Leyendas tienen su propio techo");
  ok(Object.values(LIMITES_DE_PLATA).every((n) => n <= 20),
     "ninguna de plata pasa de 20 por minuto");
}

// ═══════════════════════════════════════════════ el guardián completo

console.log("\n=== El guardián rechaza con el código que el cliente entiende ===");
olvidarTodo();
{
  const g = crearLimiteDeRitmo({ db: null, error, ahora: () => 5_000_000 });
  for (let i = 0; i < LIMITES.crearSala; i++) g.exigirRitmo("ana", "crearSala");
  let salto = null;
  try { g.exigirRitmo("ana", "crearSala"); } catch (e) { salto = e; }
  ok(salto !== null, "pasado el techo, tira");
  ok(salto?.codigo === "resource-exhausted",
     "con 'resource-exhausted', que el SDK traduce a 429");
  ok(!/\d/.test(salto?.message ?? ""),
     "y sin decir números: el mensaje no le sirve a quien mide el techo");
}

console.log("\n=== Una acción desconocida cae en el techo por omisión ===");
olvidarTodo();
{
  const g = crearLimiteDeRitmo({ db: null, error, ahora: () => 6_000_000 });
  for (let i = 0; i < LIMITE_POR_OMISION; i++) g.exigirRitmo("ana", "inventada");
  let salto = false;
  try { g.exigirRitmo("ana", "inventada"); } catch { salto = true; }
  ok(salto, `una función nueva sin límite propio queda en ${LIMITE_POR_OMISION}, no suelta`);
}

console.log("\n=== El contador de plata lee antes de escribir ===");
{
  // Firestore prohíbe leer después de escribir dentro de una transacción.
  // La suite de transacciones ya audita eso archivo por archivo; acá se
  // comprueba en ejecución, con un doble que se queja si se hace al revés.
  let leyoDespuesDeEscribir = false;
  const guardado = {};
  const falsoDb = {
    collection: () => ({ doc: (id) => ({ id }) }),
    runTransaction: async (fn) => {
      let escribio = false;
      return fn({
        get: async (ref) => {
          if (escribio) leyoDespuesDeEscribir = true;
          return { exists: Boolean(guardado[ref.id]), data: () => guardado[ref.id] };
        },
        set: (ref, datos) => { escribio = true; guardado[ref.id] = datos; },
      });
    },
  };

  let t = 7_000_000;
  const g = crearLimiteDeRitmo({ db: falsoDb, error, ahora: () => t });

  for (let i = 0; i < LIMITES_DE_PLATA.girarLaRuleta; i++) {
    await g.exigirRitmoDePlata("ana", "girarLaRuleta");
  }
  ok(!leyoDespuesDeEscribir, "nunca lee después de escribir");

  let salto = null;
  try { await g.exigirRitmoDePlata("ana", "girarLaRuleta"); } catch (e) { salto = e; }
  ok(salto?.codigo === "resource-exhausted", "y frena al pasarse del techo");

  t += 61_000;
  let paso = true;
  try { await g.exigirRitmoDePlata("ana", "girarLaRuleta"); } catch { paso = false; }
  ok(paso, "pasado el minuto vuelve a dejar pasar");
}

// ═════════════════════ auditoría del código: que nadie se olvide del techo

console.log("\n=== Toda callable pasa su nombre al guardián ===");
{
  // El techo viaja pegado a `exigirSesion`, pero sólo se aplica si le pasan
  // el nombre de la acción. Una función nueva escrita con
  // `exigirSesion(context)` a secas quedaría sin techo y nadie lo notaría,
  // porque funcionaría perfecto. Por eso se audita el archivo.
  const fuente = readFileSync(join(raiz, "functions", "index.js"), "utf8");

  const sinNombre = [...fuente.matchAll(/exigirSesion\(context\)/g)];
  ok(sinNombre.length === 0,
     `ninguna llama a exigirSesion sin nombre de acción (${sinNombre.length} encontradas)`);

  // Y que cada nombre pasado exista de verdad en alguna de las dos tablas:
  // un typo dejaría la función en el techo por omisión sin avisar.
  const nombres = [...fuente.matchAll(/exigirSesion\(context,\s*"([^"]+)"\)/g)].map((m) => m[1]);
  ok(nombres.length >= 20, `${nombres.length} callables declaran su acción`);

  const huerfanos = nombres.filter((n) => !(n in LIMITES) && !(n in LIMITES_DE_PLATA));
  ok(huerfanos.length === 0,
     huerfanos.length ? `nombres sin techo declarado: ${huerfanos.join(", ")}` : "todos tienen techo declarado");

  // Y al revés: que el nombre pasado sea el de la función que lo pasa, no el
  // de otra. Copiar y pegar un export entero es fácil; corregir la cadena de
  // adentro, menos.
  const mal = [];
  let actual = null;
  for (const linea of fuente.split("\n")) {
    // `= functions` a secas, sin exigir `.https.on` en la MISMA línea: cuando
    // una función declara sus secretos, `runWith` parte la expresión en varias
    // líneas y esta auditoría dejaba de ver dónde empezaba. Daba un rojo que
    // decía "acreditarReferido declara crearOrdenDeCompra", que es exactamente
    // el error que busca, pero era suyo.
    const m = linea.match(/^export const ([a-zA-Z]+) = functions/);
    if (m) actual = m[1];
    const s = linea.match(/exigirSesion\(context,\s*"([^"]+)"\)/);
    if (s && actual && s[1] !== actual) mal.push(`${actual} declara "${s[1]}"`);
  }
  ok(mal.length === 0, mal.length ? `nombre cruzado: ${mal.join("; ")}` : "cada una declara su propio nombre");

  // Las de plata, además del techo en memoria, tienen el de Firestore.
  for (const accion of Object.keys(LIMITES_DE_PLATA)) {
    ok(fuente.includes(`exigirRitmoDePlata(uid, "${accion}")`),
       `${accion} además cuenta en Firestore`);
  }
}

console.log(fallos ? `\n❌ ${fallos} fallos\n` : "\n✅ TODO OK\n");
process.exit(fallos ? 1 : 0);
