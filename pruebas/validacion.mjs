/**
 * La puerta de entrada: qué forma tiene que tener lo que manda el cliente.
 *
 * Lo que se prueba acá NO son las reglas del juego —de eso se ocupan las otras
 * suites— sino que basura evidente se frene antes de tocar Firestore.
 *
 * El caso que le da sentido a todo esto: `codigo` se leía con
 * `String(data?.codigo ?? "").trim().toUpperCase()` en ONCE sitios y se
 * comprobaba de verdad en UNO. Los otros diez hacían una lectura de Firestore
 * con lo que llegara.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  validar,
  Codigo,
  Posicion,
  EsquemaDeSala,
  EsquemaDescarte,
  EsquemaAccion,
  EsquemaCompra,
  EsquemaReferido,
} from "../functions/esquemas.js";
import { LARGO_CODIGO } from "../public/js/reglas/salas.js";
import { TAM_MANO } from "../public/js/reglas/baraja.js";
import { ACCIONES } from "../functions/partida-red.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

const error = (codigo, mensaje) => Object.assign(new Error(mensaje), { codigo });
const pasa = (esquema, datos) => {
  try { return { ok: true, valor: validar(esquema, datos, error) }; }
  catch (e) { return { ok: false, mensaje: e.message, codigo: e.codigo }; }
};

// ═══════════════════════════════════════════════════ el código de sala

console.log("\n=== El código de sala ===");
{
  ok(pasa(EsquemaDeSala, { codigo: "ABC234" }).ok, "un código bien formado pasa");

  const enMinusculas = pasa(EsquemaDeSala, { codigo: "  abc234  " });
  ok(enMinusculas.ok && enMinusculas.valor.codigo === "ABC234",
     "se recorta y se pasa a mayúsculas, como venía haciendo el cliente",
     enMinusculas.valor?.codigo);

  for (const [malo, motivo] of [
    ["ABCD", "por tener cuatro caracteres"],
    ["ABCDEFG", "por tener siete"],
    ["", "por estar vacío"],
    ["ABCDE0", "por el cero, que el alfabeto excluye para no confundirlo con la O"],
    ["ABCDEI", "por la I, excluida por lo mismo"],
    ["A".repeat(5000), "por tener cinco mil caracteres"],
    ["ABC/23", "por la barra, que en Firestore parte la ruta del documento"],
  ]) {
    ok(!pasa(EsquemaDeSala, { codigo: malo }).ok, `se rechaza ${motivo}`);
  }

  ok(!pasa(EsquemaDeSala, {}).ok, "sin código, se rechaza");
  ok(!pasa(EsquemaDeSala, { codigo: null }).ok, "con código nulo, también");
  ok(!pasa(EsquemaDeSala, { codigo: 123456 }).ok, "y con un número en vez de una cadena");
}

console.log("\n=== El esquema no afloja lo que ya había ===");
{
  // El esquema que venía propuesto era `z.string().min(4).max(10)`. Eso ACEPTA
  // cosas que `esCodigoValido` rechaza, así que habría aflojado la validación
  // creyendo que la apretaba. Esta prueba existe para que no vuelva a pasar.
  const losQueElPropuestoAceptaba = ["ABCD", "ABCDE", "ABCDEFG", "abcdefghij", "ABCDE0"];
  const colados = losQueElPropuestoAceptaba.filter((c) => pasa(EsquemaDeSala, { codigo: c }).ok);
  ok(colados.length === 0,
     "ninguno de los que aceptaba el esquema propuesto (min 4, max 10) se cuela",
     colados);

  // Ojo con el ejemplo: "AAAAAA" es VÁLIDO, porque la A está en el alfabeto.
  // Lo que hay que probar es el largo justo con letras excluidas.
  ok(Codigo.safeParse("IIIIII").success === false,
     `${LARGO_CODIGO} caracteres del alfabeto equivocado tampoco alcanzan`);
  ok(Codigo.safeParse("AAAAAA").success === true,
     `y ${LARGO_CODIGO} del alfabeto bueno sí, aunque se repitan`);
}

// ═══════════════════════════════════════════════════════ las posiciones

console.log("\n=== Las posiciones ===");
{
  ok(Posicion.safeParse(0).success, "la 0 vale");
  ok(Posicion.safeParse(TAM_MANO - 1).success, `la ${TAM_MANO - 1} vale`);
  ok(!Posicion.safeParse(-1).success, "la -1 no");
  ok(!Posicion.safeParse(1.5).success, "una fraccionaria tampoco");
  ok(!Posicion.safeParse(999).success, "ni una disparatada");
  ok(!Posicion.safeParse("hola").success, "ni una que no sea número");

  // Una mano CRECE con los castigos, así que el tope no puede ser TAM_MANO.
  // Que la posición exista de verdad lo comprueba el motor.
  ok(Posicion.safeParse(TAM_MANO + 3).success,
     "una posición más allá de la mano inicial vale: los castigos suman cartas");
}

// ═══════════════════════════════════════════════════ la lista de acciones

console.log("\n=== Las acciones son lista blanca ===");
{
  const base = { codigo: "ABC234", clientActionId: "c1" };

  for (const accion of Object.values(ACCIONES)) {
    ok(pasa(EsquemaAccion, { ...base, accion }).ok, `"${accion}" se acepta`);
  }

  for (const inventada of ["robarTodo", "", "TIRAR", "__proto__", "cortar; DROP"]) {
    ok(!pasa(EsquemaAccion, { ...base, accion: inventada }).ok,
       `"${inventada}" se rechaza`);
  }

  // La lista sale de la misma constante que usa el motor: una acción nueva no
  // puede quedarse fuera por olvido ni una vieja seguir viva tras borrarla.
  const fuente = readFileSync(join(raiz, "functions", "esquemas.js"), "utf8");
  ok(fuente.includes("Object.values(ACCIONES)"),
     "la lista blanca se deriva de ACCIONES, no está copiada a mano");
}

// ═══════════════════════════════════════════════════ el intento de descarte

console.log("\n=== El intento de descarte ===");
{
  const bueno = {
    codigo: "ABC234", windowId: "v_abc", posicion: 1, clientActionId: "c1",
    declarado: 800, latencia: 40, incertidumbre: 20,
  };
  ok(pasa(EsquemaDescarte, bueno).ok, "un intento normal pasa");

  ok(!pasa(EsquemaDescarte, { ...bueno, windowId: "" }).ok, "sin ventana, se rechaza");
  ok(!pasa(EsquemaDescarte, { ...bueno, clientActionId: "" }).ok, "sin identificador, también");
  ok(!pasa(EsquemaDescarte, { ...bueno, declarado: -5 }).ok, "un tiempo negativo, también");
  ok(!pasa(EsquemaDescarte, { ...bueno, declarado: Infinity }).ok, "e infinito");
  ok(!pasa(EsquemaDescarte, { ...bueno, latencia: 10 ** 9 }).ok,
     "y una latencia de once días");

  // Que el tiempo declarado sea CREÍBLE no lo decide el esquema: lo acota
  // `tiempoEfectivo` contra la llegada del pedido. El esquema sólo frena lo
  // que ni siquiera es un número razonable.
  ok(pasa(EsquemaDescarte, { ...bueno, declarado: 599_000 }).ok,
     "un declarado grande pero finito pasa el esquema; mentir se corrige después");

  const conRival = pasa(EsquemaDescarte, { ...bueno, objetivo: "uid-rival", posicionEntrega: 2 });
  ok(conRival.ok, "el intento contra un rival pasa", conRival.mensaje);
  ok(pasa(EsquemaDescarte, { ...bueno, objetivo: null, posicionEntrega: null }).ok,
     "y con los dos en nulo, que es como viaja cuando no hay rival");
}

// ═══════════════════════════════════════════════════ los mensajes que salen

console.log("\n=== Los mensajes no le regalan el mapa a nadie ===");
{
  const r = pasa(EsquemaDescarte, { codigo: "ABC234", windowId: "v", posicion: -1,
                                    clientActionId: "c", declarado: 0, latencia: 0, incertidumbre: 0 });
  ok(!r.ok, "una posición negativa se rechaza");
  ok(r.codigo === "invalid-argument", "con el código que el SDK traduce a 400", r.codigo);
  ok(!/expected|received|Too small|number/i.test(r.mensaje),
     "y sin filtrar el mensaje de zod, que viene en inglés y habla de tipos",
     r.mensaje);

  // Los mensajes propios sí salen: al jugador le sirven.
  const c = pasa(EsquemaDeSala, { codigo: "ABCD" });
  ok(/código de sala/i.test(c.mensaje), "el mensaje del código sí se muestra", c.mensaje);
}

// ═══════════════════════════════════════════════ compras y referidos

console.log("\n=== Compras y referidos ===");
{
  ok(pasa(EsquemaCompra, { paqueteId: "chico" }).ok, "un paquete con id pasa");
  ok(!pasa(EsquemaCompra, {}).ok, "sin id, no");
  ok(!pasa(EsquemaCompra, { paqueteId: "x".repeat(500) }).ok, "un id de 500 caracteres, tampoco");

  ok(pasa(EsquemaReferido, { referidoUid: "uid-de-alguien" }).ok, "un referido con uid pasa");
  ok(!pasa(EsquemaReferido, { referidoUid: "" }).ok, "vacío, no");
  ok(!pasa(EsquemaReferido, { referidoUid: "x".repeat(5000) }).ok, "y uno de cinco mil, tampoco");
}

// ═══════════════════════════════ auditoría: que no quede ninguna puerta suelta

console.log("\n=== Ninguna callable lee el código sin validarlo ===");
{
  const fuente = readFileSync(join(raiz, "functions", "index.js"), "utf8");

  const crudas = [...fuente.matchAll(/String\(data\?\.codigo/g)];
  ok(crudas.length === 0,
     `ninguna lee data.codigo a mano (${crudas.length} encontradas)`);

  const validadas = [...fuente.matchAll(/validar\(EsquemaDeSala, data, errorHttp\)\.codigo/g)];
  // Nueve y no once: `intentarDescarte` y `accionDePartida` llevan más datos
  // que el código, así que usan su propio esquema. Se comprueban abajo.
  ok(validadas.length === 9,
     `y ${validadas.length} pasan por el esquema de sala`, validadas.length);

  // Las dos que llevan más datos usan el suyo, no el de sala a secas.
  ok(fuente.includes("validar(EsquemaDescarte, data, errorHttp)"),
     "intentarDescarte usa su propio esquema");
  ok(fuente.includes("validar(EsquemaAccion, data, errorHttp)"),
     "accionDePartida usa el suyo");
}

console.log(fallos ? `\n❌ ${fallos} fallos\n` : "\n✅ TODO OK\n");
process.exit(fallos ? 1 : 0);
