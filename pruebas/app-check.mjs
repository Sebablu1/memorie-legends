/**
 * Dónde arranca App Check y dónde no.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE DEFIENDE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Dos cosas que tiran para lados opuestos:
 *
 *   - Que NO cargue donde no hace falta. reCAPTCHA son 345 KB que además hay
 *     que ejecutar: en la portada eran 770 ms de hilo bloqueado y 18 puntos de
 *     Lighthouse. Es el motivo por el que existe la lista.
 *
 *   - Que SÍ cargue en todo el resto. Éste es el lado peligroso: si una
 *     pantalla se queda sin App Check y algún día se pone el modo obligatorio,
 *     sus llamadas fallan y nadie entiende por qué. Un fallo así no se ve
 *     hasta que rompe, y rompe en producción.
 *
 * Por eso la prueba no comprueba la lista contra sí misma: LEE las páginas del
 * sitio, mira cuáles llaman al servidor, y exige que ninguna de ésas esté
 * excluida. Si mañana alguien agrega una pantalla que lee Firestore y la mete
 * en la lista, esto se pone rojo.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

const RAIZ = new URL("../public/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const leer = (p) => readFileSync(join(RAIZ, p), "utf8");

// ───────────────────────────────────────── la lista, leída del código

const fuente = leer("js/app-check.js");

const listado = fuente.match(/const SIN_APP_CHECK = new Set\(\[([^\]]*)\]\)/);
const excluidas = listado
  ? [...listado[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
  : null;

console.log("\n=== 1. La lista existe y es de EXCLUIDOS ===");
ok(excluidas !== null, "se pudo leer SIN_APP_CHECK del archivo", excluidas);
ok(/if \(SIN_APP_CHECK\.has/.test(fuente),
   "y se consulta antes de inicializar", true);
// Al revés —una lista de páginas que SÍ lo llevan— una pantalla nueva nacería
// sin App Check y el fallo aparecería recién al poner el modo obligatorio.
ok(!/const CON_APP_CHECK/.test(fuente),
   "no hay una lista de incluidos: lo por omisión es llevarlo");

// ─────────────────────────── qué páginas hablan de verdad con el servidor

/** Los módulos que una página carga con <script type="module">. */
const modulosDe = (html) =>
  [...html.matchAll(/<script[^>]*src="js\/([a-z0-9-]+)\.js"/g)].map((m) => m[1]);

/** Lo que sólo se usa para hablar con el servidor. */
const DEL_SERVIDOR = new Set([
  "funciones", "httpsCallable",
  "getDoc", "getDocs", "setDoc", "updateDoc", "deleteDoc", "addDoc",
  "onSnapshot", "runTransaction", "collection",
]);

/**
 * ¿Este módulo, o algo que importe, toca el servidor?
 *
 * Se sigue la cadena de imports en vez de mirar sólo el archivo de entrada:
 * `dashboard.js` no nombra a `httpsCallable`, lo hace `servidor.js`, y una
 * comprobación superficial diría que el panel no llama a nadie.
 *
 * PERO NO se entra en `firebase.js`. Ese archivo REEXPORTA el SDK entero, así
 * que si se lo recorriera, cualquier página que importe cualquier cosa de
 * Firebase parecería estar leyendo Firestore — que fue justo lo que pasó en
 * el primer intento de esta prueba: la portada, que sólo pide `auth` y
 * `onAuthStateChanged`, salía marcada como que llama al servidor.
 *
 * Lo que se mira de `firebase.js` es qué se le pide POR NOMBRE. Importar
 * `getDoc` es querer leer Firestore; importar `auth` no.
 */
function tocaElServidor(modulo, vistos = new Set()) {
  if (vistos.has(modulo)) return false;
  vistos.add(modulo);

  let codigo;
  try { codigo = leer(`js/${modulo}.js`); } catch { return false; }

  // Qué le pide a firebase.js, por nombre.
  for (const [, nombres] of codigo.matchAll(/import\s*\{([^}]*)\}\s*from\s*"\.[./]*\/?firebase\.js"/g)) {
    const pedidos = nombres.split(",").map((n) => n.trim().split(/\s+as\s+/)[0]);
    if (pedidos.some((n) => DEL_SERVIDOR.has(n))) return true;
  }

  // Y si los usa sin pasar por un import con nombre.
  if (/httpsCallable\(|runTransaction\(/.test(codigo)) return true;

  for (const [, ruta] of codigo.matchAll(/from\s+"\.\/([a-z0-9/-]+)\.js"/g)) {
    if (ruta === "firebase") continue;
    if (tocaElServidor(ruta, vistos)) return true;
  }
  return false;
}

console.log("\n=== 2. Ninguna página que llame al servidor queda excluida ===");
{
  const paginas = readdirSync(RAIZ).filter((f) => f.endsWith(".html"));
  const problemas = [];
  let conServidor = 0;

  for (const pagina of paginas) {
    const modulos = modulosDe(leer(pagina));
    const habla = modulos.some((m) => tocaElServidor(m));
    if (!habla) continue;
    conServidor++;

    // Las dos formas en que Firebase Hosting puede servir la misma página.
    const rutas = [`/${pagina}`, pagina === "index.html" ? "/" : null].filter(Boolean);
    if (rutas.some((r) => excluidas.includes(r))) {
      problemas.push({ pagina, modulos });
    }
  }

  ok(conServidor >= 8, `hay ${conServidor} páginas que hablan con el servidor`, conServidor);
  ok(problemas.length === 0,
     "y ninguna está en la lista de excluidas: todas van a mandar su token",
     problemas);
}

console.log("\n=== 3. La portada sí está excluida, que es el punto ===");
{
  const modulos = modulosDe(leer("index.html"));
  ok(modulos.length > 0, "la portada carga JavaScript", modulos);
  ok(!modulos.some((m) => tocaElServidor(m)),
     "y ninguno de sus módulos toca el servidor", modulos);
  ok(excluidas.includes("/") && excluidas.includes("/index.html"),
     "las dos rutas con que se sirve están excluidas", excluidas);
}

// ────────────────────────────────────────────────────────────────────

console.log(fallos ? `\n❌ ${fallos} fallo(s)` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
