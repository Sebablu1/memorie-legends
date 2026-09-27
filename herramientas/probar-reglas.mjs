/**
 * Prueba `firestore.rules` contra el motor de reglas de Google, sin desplegar.
 *
 *   node herramientas/probar-reglas.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ CONTRA GOOGLE Y NO EN UNA PRUEBA LOCAL
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Una prueba que lee el texto de la regla dice que la regla DICE lo que
 * tiene que decir; no dice que HAGA lo que tiene que hacer. Hay detalles que
 * sólo el motor decide: qué pasa al leer un campo que no existe, cómo se
 * combina ese error con un `||`. Esta herramienta le manda las reglas del
 * repositorio al servicio de pruebas de Firebase Rules —el mismo motor que
 * corre en producción— junto con cada caso, y compara lo que contesta con lo
 * que se espera. No despliega nada y no toca la base.
 *
 * No va en `npm test`: necesita red y las credenciales de gcloud. Se corre al
 * cambiar las reglas y ANTES de desplegarlas. `pruebas/reglas-de-salas.mjs`
 * comprueba, en cada `npm test`, que la lista de casos esté completa.
 *
 * El token se pide a gcloud y se usa; no se imprime ni se guarda.
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PROYECTO = "memorie-legends";

const BETO = { uid: "beto" };
const ANA = { uid: "ana" };
const SIN_SESION = null;

const sala = (extra) => ({ codigo: "ABC234", estado: "esperando", entrada: 10, ...extra });

/** Las salas de la matriz: cada tipo, con Beto sentado. */
export const SALAS = {
  "pública": sala({ publica: true, soloGanadas: true, creador: null, jugadores: ["beto"] }),
  "privada": sala({ publica: false, creador: "beto", jugadores: ["beto"] }),
  "revancha": sala({ publica: false, creador: "beto", listada: false, jugadores: ["beto", "caro"] }),
  // Anterior al campo `publica`: no lo tiene.
  "vieja": sala({ creador: "beto", listada: true, jugadores: ["beto"] }),
};

/** Quién pregunta. */
export const QUIENES = {
  "sentado": BETO,
  "ajeno": ANA,
  "sin sesión": SIN_SESION,
};

/** Lo que cada uno tiene que poder hacer con cada sala. */
const ESPERADO = {
  "pública": { "sentado": "ALLOW", "ajeno": "ALLOW", "sin sesión": "DENY" },
  "privada": { "sentado": "ALLOW", "ajeno": "DENY", "sin sesión": "DENY" },
  "revancha": { "sentado": "ALLOW", "ajeno": "DENY", "sin sesión": "DENY" },
  "vieja": { "sentado": "ALLOW", "ajeno": "DENY", "sin sesión": "DENY" },
};

const leer = (auth, ruta, datos) => ({
  auth,
  ruta,
  metodo: "get",
  recurso: datos === undefined ? undefined : { data: datos },
});

export const CASOS = [
  // La matriz de salas: cada tipo × cada quién.
  ...Object.entries(SALAS).flatMap(([tipo, datos]) =>
    Object.entries(QUIENES).map(([quien, auth]) => ({
      nombre: `sala ${tipo}, leída por alguien ${quien}`,
      esperado: ESPERADO[tipo][quien],
      ...leer(auth, "rooms/ABC234", datos),
    })),
  ),
  // Una pública recién abierta, todavía sin nadie: tiene que verse en el lobby.
  {
    nombre: "sala pública vacía, leída por alguien ajeno",
    esperado: "ALLOW",
    ...leer(ANA, "rooms/PUB234", sala({ codigo: "PUB234", publica: true, creador: null, jugadores: [] })),
  },
  // Una sala que no existe: se niega, sin decir que no existe.
  {
    nombre: "sala que no existe, leída por alguien con sesión",
    esperado: "DENY",
    ...leer(BETO, "rooms/NOEXISTE"),
  },

  // Lo que ya estaba cerrado, y tiene que seguir cerrado.
  { nombre: "perfil propio", esperado: "ALLOW", ...leer(BETO, "users/beto", { credits: 10 }) },
  { nombre: "perfil ajeno", esperado: "DENY", ...leer(ANA, "users/beto", { credits: 10 }) },
  { nombre: "código de sala privada", esperado: "DENY", ...leer(BETO, "codigos/abc", { sala: "ABC234" }) },
  { nombre: "movimiento propio", esperado: "ALLOW", ...leer(BETO, "movimientos/m1", { uid: "beto", delta: 10 }) },
  { nombre: "movimiento ajeno", esperado: "DENY", ...leer(ANA, "movimientos/m1", { uid: "beto", delta: 10 }) },
  { nombre: "partida, aunque la juegue", esperado: "DENY", ...leer(BETO, "partidas/p1", { jugadores: ["beto"] }) },

  // Los juegos: se leen sin sesión —el lobby los necesita para saber qué
  // mostrar— y el navegador no los escribe, ni con sesión.
  { nombre: "juego, leído sin sesión", esperado: "ALLOW", ...leer(SIN_SESION, "juegos/memorie", { nombre: "Memorie Legends", activo: true }) },
  { nombre: "juego, escrito por alguien con sesión", esperado: "DENY",
    auth: BETO, ruta: "juegos/memorie", metodo: "create", recurso: undefined, datosNuevos: { nombre: "Otro", activo: true } },
];

/** El cuerpo que espera el servicio de pruebas. */
export function cuerpoDePrueba(reglas, casos = CASOS) {
  return {
    source: { files: [{ name: "firestore.rules", content: reglas }] },
    testSuite: {
      testCases: casos.map((c) => ({
        expectation: c.esperado,
        request: {
          auth: c.auth,
          path: `/databases/(default)/documents/${c.ruta}`,
          method: c.metodo,
          ...(c.datosNuevos ? { resource: { data: c.datosNuevos } } : {}),
        },
        ...(c.recurso ? { resource: c.recurso } : {}),
      })),
    },
  };
}

async function principal() {
  const reglas = readFileSync(path.resolve("firestore.rules"), "utf8");
  const token = execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();

  const respuesta = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROYECTO}:test`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      // Sin esto Google no sabe a qué proyecto cargarle la consulta y
      // contesta 403, aunque las credenciales sean las correctas.
      "x-goog-user-project": PROYECTO,
    },
    body: JSON.stringify(cuerpoDePrueba(reglas)),
  });
  const texto = await respuesta.text();
  if (!respuesta.ok) {
    console.error(`El servicio contestó ${respuesta.status}:\n${texto.slice(0, 800)}`);
    process.exit(2);
  }
  const resultados = JSON.parse(texto).testResults ?? [];

  let fallos = 0;
  CASOS.forEach((caso, i) => {
    const r = resultados[i];
    const bien = r?.state === "SUCCESS";
    if (!bien) fallos++;
    const verbo = caso.metodo === "get" ? "lee" : "escribe";
    console.log(`  ${bien ? "✓" : "✗"} ${caso.nombre}: ${caso.esperado === "ALLOW" ? "se" : "no se"} ${verbo}`);
    if (!bien) console.log(`      ${JSON.stringify(r?.debugMessages ?? r).slice(0, 300)}`);
  });
  console.log(fallos ? `\n❌ ${fallos} caso(s) no dieron lo esperado` : `\n✅ los ${CASOS.length} casos dan lo esperado`);
  process.exit(fallos ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await principal();
}
