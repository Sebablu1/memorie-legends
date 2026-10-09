/**
 * Las Leyendas de bienvenida: un número, en un solo lugar.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO NECESITA UNA PRUEBA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque el perfil lo crea EL NAVEGADOR. No hay un servidor que decida cuánto
 * regalar: hay un `setDoc` desde el cliente y una regla de Firestore que
 * comprueba que el saldo sea exactamente el de bienvenida. Esa comparación es
 * lo único que impide que alguien se cree la cuenta con un millón.
 *
 * Y eso convierte al número en algo raro: vive en dos idiomas —JavaScript y el
 * lenguaje de reglas— que ningún compilador puede comparar entre sí. Si se
 * cambia uno solo, no falla nada al desplegar. Falla el día siguiente, cuando
 * NADIE PUEDE REGISTRARSE, porque Firestore rechaza la creación del documento
 * y el navegador sólo dice "permission-denied".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE HABÍA CUANDO SE ESCRIBIÓ ESTO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Cinco definiciones del mismo número: `LEYENDAS_REGISTRO = 50` en el módulo
 * de economía —importado por el servidor y nunca usado—, un `100` escrito a
 * mano en `auth.js`, otro `100` a mano en `register.js`, una constante propia
 * `LEYENDAS_DE_REGALO = 100` en ese mismo archivo, y el `== 100` de la regla.
 *
 * O sea: la única que se declaraba oficial era la que mentía. Nunca llegó a
 * producción por casualidad —el import del servidor estaba muerto— y ésa es
 * exactamente la clase de suerte de la que no conviene depender.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { LEYENDAS_REGISTRO, saldoDeRegistro } from "../public/js/reglas/economia.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else {
    fallos++;
    console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : "");
  }
};

const RAIZ = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const leer = (relativo) => readFileSync(join(RAIZ, relativo), "utf8");

// =====================================================================
console.log("\n=== 1. El código y la regla de Firestore dicen lo mismo ===");
// =====================================================================

{
  const reglas = leer("firestore.rules");
  const m = reglas.match(/request\.resource\.data\.credits\s*==\s*(\d+)/);

  ok(Boolean(m), "la regla sigue fijando un saldo exacto de bienvenida");

  if (m) {
    const enLaRegla = Number(m[1]);
    ok(
      enLaRegla === LEYENDAS_REGISTRO,
      `la regla pide ${enLaRegla} y el código regala ${LEYENDAS_REGISTRO}`,
      { enLaRegla, LEYENDAS_REGISTRO },
    );
  }
}

// =====================================================================
console.log("\n=== 2. Nadie escribe el número a mano ===");
// =====================================================================

/**
 * Los archivos que crean el perfil, BUSCADOS y no escritos a mano.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ SE BUSCAN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Acá había una lista fija: `register.js` y `auth.js`. Era correcta y aun así
 * dejó pasar el bug que importaba. Cuando se agregó `terminos` a la regla de
 * Firestore, los dos archivos siguieron en la lista y las dos aserciones
 * siguieron en verde —porque miraban el saldo, no el campo nuevo—, mientras
 * `auth.js` creaba perfiles sin `terminos` y Firestore los rechazaba. Quien
 * entraba con Google por primera vez quedaba encerrado sin cuenta.
 *
 * Una lista fija sólo defiende de lo que ya se pensó. Ahora se recorre
 * `public/js` y el conjunto sale del código: cualquier archivo que llame a
 * `saldoDeRegistro()` queda sujeto a estas comprobaciones el día que aparezca,
 * sin que nadie tenga que acordarse de venir a anotarlo acá.
 */
const CREADORES = readdirSync(join(RAIZ, "public/js"))
  .filter((n) => n.endsWith(".js"))
  .map((n) => `public/js/${n}`)
  .filter((rel) => /\.\.\.saldoDeRegistro\(\)/.test(leer(rel)));

ok(CREADORES.length > 0, "se encontró al menos un creador de perfiles", CREADORES);

// Hoy tiene que ser `register.js` y nada más. Si mañana aparece otro, esto
// avisa: no para prohibirlo, sino para que la decisión sea explícita y pase
// por la casilla de los Términos como los demás.
ok(
  CREADORES.length === 1 && CREADORES[0] === "public/js/register.js",
  "el único que crea perfiles es register.js",
  CREADORES,
);

for (const archivo of CREADORES) {
  const texto = leer(archivo);

  const literales = [...texto.matchAll(/credits:\s*(\d+)/g)].map((m) => m[1]);
  ok(
    literales.length === 0,
    `${archivo} no escribe el saldo a mano`,
    literales,
  );

  // Ahora son TRES campos que tienen que cuadrar entre si y contra la regla,
  // asi que los tres caminos escriben el MISMO objeto en vez de armarlo cada
  // uno. Un literal suelto volveria a poder divergir, y esta vez no seria un
  // numero mal: seria un perfil que Firestore rechaza al crearse.
  const usos = [...texto.matchAll(/\.\.\.saldoDeRegistro\(\)/g)].length;
  ok(usos > 0, `${archivo} usa el ayudante compartido`, usos);

  for (const campo of ["creditosComprados", "creditosGanados"]) {
    const sueltos = [...texto.matchAll(new RegExp(`${campo}:\\s*\\d+`, "g"))].map((m) => m[0]);
    ok(sueltos.length === 0, `${archivo} no escribe ${campo} a mano`, sueltos);
  }

  ok(
    /import \{[^}]*saldoDeRegistro[^}]*\}/.test(texto),
    `${archivo} lo importa en vez de redeclararlo`,
  );

  /*
   * Y la aceptación de los Términos, por el mismo ayudante.
   *
   * Esto es lo que faltaba. `firestore.rules` exige `terminos` con sus dos
   * campos exactos para dejar crear un perfil, así que un creador que no lo
   * escriba no es un creador con un campo de menos: es un camino de registro
   * ROTO, que falla recién en producción y con un «permission-denied» que no
   * explica nada.
   *
   * Se exige el ayudante y no un objeto armado a mano por la misma razón que
   * el saldo: son dos campos que la regla compara uno por uno, y la versión
   * tiene que ser la de `economia.js` y no una copia que se quedó atrás.
   */
  ok(
    /terminos:\s*aceptacionTerminos\(\)/.test(texto),
    `${archivo} escribe la aceptación de los Términos`,
  );
  ok(
    /import \{[^}]*aceptacionTerminos[^}]*\}/.test(texto),
    `${archivo} importa aceptacionTerminos`,
  );

  const terminosAMano = [...texto.matchAll(/terminos:\s*\{/g)].map((m) => m[0]);
  ok(
    terminosAMano.length === 0,
    `${archivo} no arma el objeto de Términos a mano`,
    terminosAMano,
  );
}

// =====================================================================
console.log("\n=== 2a. auth.js no crea perfiles ===");
// =====================================================================

/*
 * La otra mitad del cerrojo, y la que de verdad defiende del bug que pasó.
 *
 * Arriba se comprueba que todo el que cree un perfil lo haga bien. Acá se
 * comprueba que `auth.js` NO lo haga, que es una afirmación distinta: aunque
 * algún día alguien le agregue `terminos` y pase las de arriba, seguiría
 * creando una cuenta sin que nadie haya marcado ninguna casilla, porque en el
 * login no hay casilla que marcar. Una aceptación asentada sin que ocurra es
 * peor que no asentar nada: dice que pasó algo que no pasó, y es justamente el
 * dato con el que se defiende la bonificación de bienvenida.
 *
 * Un solo camino de nacimiento, y es el que muestra el texto.
 */
{
  const texto = leer("public/js/auth.js");

  ok(
    !/setDoc\s*\(/.test(texto),
    "auth.js no escribe documentos: manda al registro",
    [...texto.matchAll(/setDoc\s*\([^)]*/g)].map((m) => m[0]),
  );
  ok(
    !/saldoDeRegistro/.test(texto),
    "auth.js no toca el saldo de bienvenida",
  );
  ok(
    /location\.replace\(\s*["']register\.html["']\s*\)/.test(texto),
    "y a quien no tiene perfil lo manda a register.html",
  );
}

// =====================================================================
console.log("\n=== 2b. La regla valida los TRES campos ===");
// =====================================================================

{
  /**
   * Sin esto, un jugador se crea el perfil con `creditosGanados: 999999`.
   *
   * El perfil lo escribe el NAVEGADOR: `firestore.rules` es el unico control
   * que hay sobre lo que llega. Mientras la regla miraba solo `credits`, los
   * dos bolsillos entraban sin que nadie los mirara — y el que importa es
   * `creditosGanados`, que es el que habilita torneos.
   */
  const reglas = leer("firestore.rules");
  const esperado = saldoDeRegistro();

  for (const [campo, valor] of Object.entries(esperado)) {
    const m = reglas.match(
      new RegExp(`request\\.resource\\.data\\.${campo}\\s*==\\s*(\\d+)`),
    );
    ok(Boolean(m), `la regla fija ${campo}`);
    if (m) {
      ok(Number(m[1]) === valor,
         `y lo fija en ${valor}, igual que el codigo`,
         { enLaRegla: Number(m[1]), enElCodigo: valor });
    }
  }

  // Y que el espejo cierre en el perfil que nace: si la regla pidiera
  // credits 100 con ganados 50, todo perfil nuevo naceria descuadrado.
  ok(esperado.credits === esperado.creditosComprados + esperado.creditosGanados,
     "el perfil nuevo nace con el espejo cuadrado", esperado);
}

// =====================================================================
console.log("\n=== 2c. Y después de crearlo, el cliente no los toca ===");
// =====================================================================

{
  /**
   * La otra mitad de la puerta.
   *
   * `saldoDeBienvenidaValido` cuida el momento de CREAR. Lo que cuida el resto
   * de la vida del perfil es `soloCamposPropios`, que enumera lo unico que su
   * dueno puede cambiar. Si alguien agregara los bolsillos a esa lista
   * —"total, es el saldo del propio usuario"— el saldo entero pasaria a ser
   * editable desde la consola del navegador.
   */
  const reglas = leer("firestore.rules");
  const m = reglas.match(/hasOnly\(\[([^\]]*)\]\)/);
  ok(Boolean(m), "la regla de update enumera los campos propios");

  const permitidos = (m?.[1] ?? "").split(",").map((s) => s.trim().replace(/['"]/g, ""));
  for (const campo of Object.keys(saldoDeRegistro())) {
    ok(!permitidos.includes(campo), `${campo} NO esta entre los campos que el cliente puede editar`);
  }

  // Y ningun archivo del navegador escribe los bolsillos por su cuenta: la
  // regla los rechazaria, pero el intento seria un error silencioso en
  // produccion y un bug que nadie relaciona con el saldo.
  for (const archivo of ["public/js/register.js", "public/js/auth.js", "public/js/sesion.js"]) {
    const texto = leer(archivo);
    const escrituras = [...texto.matchAll(/creditos(Comprados|Ganados)\s*:/g)].map((x) => x[0]);
    ok(escrituras.length === 0, `${archivo} no escribe los bolsillos`, escrituras);
  }
}

// =====================================================================
console.log("\n=== 3. Una sola definición en todo el proyecto ===");
// =====================================================================

{
  // Se cuenta sobre `public/js/reglas/economia.js`, que es la fuente. La copia
  // de `functions/reglas` la genera `copiar-reglas.js` y no cuenta como
  // definición aparte: si difiriera, el problema sería la copia.
  const economia = leer("public/js/reglas/economia.js");
  const definiciones = [...economia.matchAll(/export const LEYENDAS_REGISTRO/g)].length;
  ok(definiciones === 1, "hay exactamente una definición", definiciones);

  // Y ninguna constante paralela que diga lo mismo con otro nombre, que es
  // como empezó este problema.
  for (const archivo of ["public/js/register.js", "public/js/auth.js"]) {
    ok(
      !/const LEYENDAS_DE_REGALO/.test(leer(archivo)),
      `${archivo} no tiene su propia copia con otro nombre`,
    );
  }
}

// =====================================================================
console.log("\n=== 4. El valor es el que se acordó ===");
// =====================================================================

{
  // Este número se fija acá a propósito. No es redundante con lo de arriba:
  // aquéllas comprueban que todo COINCIDA, y dos cosas pueden coincidir en el
  // valor equivocado. Ésta dice cuál es el valor correcto.
  ok(LEYENDAS_REGISTRO === 100, "la bienvenida son 100 Leyendas", LEYENDAS_REGISTRO);
}

// =====================================================================
console.log("\n=== 5. Y la portada no promete otro número ===");
// =====================================================================

{
  /**
   * La cuarta copia del número, y la única que lee alguien que todavía no
   * entró.
   *
   * `index.html` dice «viene con 100 Leyendas de bienvenida» en el párrafo que
   * invita a crearse la cuenta. Es un literal suelto: las comprobaciones de
   * arriba miran el código y `firestore.rules`, y ninguna mira el HTML. Si
   * mañana `LEYENDAS_REGISTRO` cambia, la portada sigue prometiendo el número
   * viejo y no falla nada — sólo que a quien se registre le aparece otro saldo
   * del que fue a buscar, que es la clase de diferencia que termina en un
   * reclamo.
   *
   * Se busca la frase entera y no un «100» suelto: la portada tiene otros
   * números —el límite de puntos, los precios— y cazar el primero que aparezca
   * daría una prueba que falla cuando se agrega un párrafo.
   */
  const portada = leer("public/index.html");
  const m = portada.match(/(\d+)\s+Leyendas de bienvenida/);

  ok(Boolean(m), "la portada sigue prometiendo Leyendas de bienvenida",
     m ? m[0] : "no se encontró la frase");

  if (m) {
    ok(Number(m[1]) === LEYENDAS_REGISTRO,
       "y promete exactamente las que se acreditan",
       { portada: Number(m[1]), constante: LEYENDAS_REGISTRO });
  }
}

console.log(fallos ? `\n❌ ${fallos} fallos` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
