/**
 * El link corto de una sala privada: `memorielegends.com/s/ABCD1234`.
 *
 * Cubre las dos mitades que no necesitan navegador: el código que viaja en el
 * almacenamiento de la pestaña, y la forma del mensaje y del link.
 *
 * Lo que SÍ necesita navegador —que el lobby lo ponga en el campo y no una
 * solo— vive en `pruebas/e2e/tablero.spec.js` y `lobby.spec.js`.
 */

import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (r) => readFileSync(join(REPO, r), "utf8");

/**
 * Un `sessionStorage` de mentira, porque en Node no hay ventana.
 *
 * El módulo lee `window.sessionStorage` DENTRO de cada llamada y no al
 * importarse, así que alcanza con dejarlo puesto antes de usarlo. `romper`
 * simula lo que pasa en una ventana privada o con ciertas extensiones: el
 * acceso tira, y el módulo tiene que seguir andando.
 */
function ventanaDeMentira({ romper = false } = {}) {
  const datos = new Map();
  const almacen = {
    getItem: (k) => (romper ? (() => { throw new Error("bloqueado"); })() : datos.get(k) ?? null),
    setItem: (k, v) => { if (romper) throw new Error("bloqueado"); datos.set(k, String(v)); },
    removeItem: (k) => { if (romper) throw new Error("bloqueado"); datos.delete(k); },
  };
  globalThis.window = romper
    ? { get sessionStorage() { throw new Error("bloqueado"); } }
    : { sessionStorage: almacen };
  return datos;
}

ventanaDeMentira();
const pendiente = await import("../public/js/codigo-pendiente.js");

// `sala-privada.js` NO se importa: arrastra `firebase.js` y el DOM, que no
// existen acá. Lo suyo se comprueba leyendo el archivo, igual que hace
// `pruebas/sitio.mjs` con el resto del sitio.

// ---------------------------------------------------------------------------
console.log("\n=== 1. Qué código se acepta ===");
{
  ok(pendiente.tieneForma("ABCD1234"), "ocho caracteres, letras y dígitos");
  ok(pendiente.tieneForma("abcd1234"), "en minúsculas también: se normaliza");
  ok(!pendiente.tieneForma("ABCD123"), "siete, no");
  ok(!pendiente.tieneForma("ABCD12345"), "nueve, tampoco");
  ok(!pendiente.tieneForma("ABCD-123"), "con un guión, no");
  ok(!pendiente.tieneForma(""), "vacío, no");
  ok(!pendiente.tieneForma(null), "nulo, no");
  ok(pendiente.normalizar("  abcd 1234 ") === "ABCD1234", "se limpian espacios y va a mayúsculas");
}

// ---------------------------------------------------------------------------
console.log("\n=== 2. Se guarda y se consume UNA sola vez ===");
{
  ventanaDeMentira();
  ok(pendiente.guardar("abcd1234") === true, "guarda uno válido");
  ok(pendiente.hay() === true, "y dice que hay");
  ok(pendiente.hay() === true, "preguntar dos veces no lo consume");
  ok(pendiente.consumir() === "ABCD1234", "lo devuelve normalizado");
  ok(pendiente.consumir() === null, "la segunda vez ya no está: se consumió");
  ok(pendiente.hay() === false, "y no queda nada");
}

// ---------------------------------------------------------------------------
console.log("\n=== 3. Lo inválido no se guarda ===");
{
  ventanaDeMentira();
  ok(pendiente.guardar("ABCD-123") === false, "un código con forma rara no se guarda");
  ok(pendiente.consumir() === null, "y no queda nada que consumir");
  // Mejor el campo vacío que lleno de algo que el servidor va a rechazar.
}

// ---------------------------------------------------------------------------
console.log("\n=== 4. Vence a la media hora, como el código ===");
{
  const datos = ventanaDeMentira();
  pendiente.guardar("ABCD1234");
  // Se envejece a mano el sello guardado: 31 minutos.
  const guardado = JSON.parse(datos.get("codigoPendiente"));
  guardado.cuando = Date.now() - 31 * 60 * 1000;
  datos.set("codigoPendiente", JSON.stringify(guardado));

  ok(pendiente.hay() === false, "a los 31 minutos ya no cuenta");
  ok(pendiente.consumir() === null, "y consumirlo no devuelve nada");
}

// ---------------------------------------------------------------------------
console.log("\n=== 5. Con el almacenamiento bloqueado, no rompe ===");
{
  ventanaDeMentira({ romper: true });
  ok(pendiente.guardar("ABCD1234") === false, "guardar contesta que no pudo");
  ok(pendiente.consumir() === null, "consumir devuelve nada");
  ok(pendiente.hay() === false, "y preguntar contesta que no");
  // En ventana privada el link simplemente no pre-llena: se pega a mano.
}

// ---------------------------------------------------------------------------
console.log("\n=== 6. El mensaje que se comparte ===");
{
  const js = leer("public/js/sala-privada.js");

  ok(/memorielegends\.com\/s\/\$\{codigo\}/.test(js),
     "el link es memorielegends.com/s/{codigo}");

  // El link SOLO, en su propia línea y al final: es lo que hace que WhatsApp
  // muestre la vista previa grande en vez de la compacta, que recorta la
  // tarjeta a un cuadrado.
  ok(/conmigo:\\n\\n\$\{linkDeInvitacion\(codigo\)\}`/.test(js),
     "el mensaje termina en el link, separado por una línea en blanco");

  ok(!/usá el código \$\{codigo\}/.test(js),
     "ya no manda el código suelto dentro de la frase");

  // Y el cartel sigue mostrando el código, que es la forma que se dicta.
  ok(/id="codigoPrivadoTexto"/.test(js), "el cartel sigue mostrando el código");
  ok(/id="linkInvitacion"/.test(js), "y ahora también el link");
  ok(/id="btnCopiarLink"/.test(js), "con su propio botón de copiar");
}

// ---------------------------------------------------------------------------
console.log("\n=== 7. La página que atiende /s/ ===");
{
  const html = leer("public/s.html");

  ok(/name="robots"[^>]*noindex/.test(html),
     "no se indexa: cada dirección lleva un código de sala adentro");

  // Servida bajo /s/ABCD1234, una ruta relativa resolvería a /s/css/... y no
  // existiría. Es el mismo motivo por el que esto no es `lobby.html`.
  const rutas = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((m) => m[1]);
  const relativas = rutas.filter((r) => !r.startsWith("/") && !/^https?:/.test(r));
  ok(relativas.length === 0, "todas las rutas son absolutas", relativas);

  ok(/location\.replace\("\/lobby\.html"\)/.test(html),
     "manda al lobby con replace, para que el botón de atrás no traiga acá");
  ok(/guardar\(/.test(html), "guarda el código antes de irse");
  ok(!/unirseConCodigo|unirseASala/.test(html),
     "NO une a nadie: eso lo decide quien recibió la invitación");
}

// ---------------------------------------------------------------------------
console.log("\n=== 8. El rewrite del hosting ===");
{
  const fb = JSON.parse(leer("firebase.json"));
  const rw = fb.hosting?.rewrites ?? [];
  ok(rw.length === 1, "un solo rewrite", rw);
  ok(rw[0]?.source === "/s/**" && rw[0]?.destination === "/s.html",
     "/s/** lo sirve s.html", rw[0]);
}

// ---------------------------------------------------------------------------
console.log("\n=== 9. Quien llega por un link cae en el LOBBY ===");
{
  for (const archivo of ["public/js/auth.js", "public/js/register.js"]) {
    const js = leer(archivo);
    ok(/hayCodigoPendiente\(\)\s*\?\s*"lobby\.html"\s*:\s*"dashboard\.html"/.test(js),
       `${archivo}: al lobby si vino invitado, al tablero si no`);
  }
  // Y el lobby lo consume, no lo lee: si no, reaparecería en cada visita.
  const lobby = leer("public/js/lobby.js");
  ok(/consumirCodigoPendiente\(\)/.test(lobby), "el lobby lo consume");
  ok(!/unirseConCodigo\(pendiente\)|entrarConCodigo\(pendiente\)/.test(lobby),
     "y NO une solo: el último paso lo da la persona");
}

console.log(fallos ? `\n❌ ${fallos} fallo(s)` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
