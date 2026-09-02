/**
 * El saldo de cada uno es asunto suyo.
 *
 * EL AGUJERO QUE SE CERRÓ
 *
 * `firestore.rules` decía `allow read: if autenticado()` sobre `users/{uid}`,
 * con el comentario "No hay datos sensibles acá". En ese documento vive
 * `credits`, o sea el saldo: cualquier jugador logueado podía leer cuánto
 * tiene cada uno de los demás, más sus partidas y sus victorias.
 *
 * QUÉ PRUEBA ESTO Y QUÉ NO
 *
 * NO ejecuta las reglas. Eso necesita el emulador de Firestore, que necesita
 * Java, que no está instalado en esta máquina. Decirlo importa: lo de abajo es
 * una lectura del archivo, no una comprobación de que Firestore se comporte
 * como el archivo dice.
 *
 * Lo que sí prueba, y no es poco, es la mitad que se rompe sola con el tiempo:
 * que ninguna pantalla del cliente lea el perfil de OTRO jugador. Ésa fue la
 * comprobación que permitió arreglarlo restringiendo la regla en vez de migrar
 * `credits` a una subcolección, y si mañana alguien agrega una lectura ajena,
 * la app se va a romper contra las reglas. Mejor enterarse acá.
 *
 * Para pruebas de verdad de las reglas: instalar Java, `firebase
 * setup:emulators:firestore` y `@firebase/rules-unit-testing`.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const reglasCrudas = readFileSync(join(raiz, "firestore.rules"), "utf8");

/**
 * Las reglas SIN comentarios.
 *
 * Hace falta: el comentario que explica el arreglo cita la regla vieja
 * —`allow read: if autenticado()`— y la primera versión de esta prueba la
 * encontraba ahí y daba por reabierto un agujero que estaba cerrado. Un
 * comentario no autoriza a nadie.
 */
const reglas = reglasCrudas
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

// ═════════════════════════════════════════════ lo que dicen las reglas

console.log("\n=== El perfil lo lee su dueño y nadie más ===");
{
  // Se recorta el bloque de `users` para no confundirlo con otro `match`.
  const i = reglas.indexOf("match /users/{uid}");
  ok(i !== -1, "existe el bloque de users en las reglas");
  const bloque = reglas.slice(i, reglas.indexOf("match /", i + 10));

  ok(/allow read:\s*if\s+esDuenio\(uid\)/.test(bloque),
     "la lectura exige ser el dueño");
  ok(!/allow read:\s*if\s+autenticado\(\)/.test(bloque),
     "y NO alcanza con estar logueado, que era el agujero");

  // Lo que no cambió, y no debe cambiar por accidente al tocar lo de arriba.
  ok(/allow update:\s*if\s+esDuenio\(uid\)\s*&&\s*soloCamposPropios\(\)/.test(bloque),
     "el jugador sigue pudiendo cambiar sólo su nombre y su avatar");
  ok(/allow delete:\s*if\s+false/.test(bloque), "y sigue sin poder borrarse");

  // El saldo sigue fuera del alcance del navegador: es la otra mitad, y la que
  // de verdad impide que alguien se regale Leyendas.
  ok(/hasOnly\(\['username',\s*'avatar',\s*'photoURL'\]\)/.test(reglas),
     "los campos que puede tocar siguen siendo tres, sin credits");
}

// ══════════════════════ nadie lee el perfil ajeno (la parte que se degrada)

console.log("\n=== Ninguna pantalla lee el perfil de otro jugador ===");
{
  /**
   * Expresiones que, usadas como uid en una lectura de `users`, son propias.
   * Cualquier otra cosa hay que mirarla a ojo.
   */
  const ES_PROPIO = /\b(user|usuario|sesion\.usuario|auth\.currentUser)\.uid\b|^uid$|\bmiUid\b/;

  const archivos = [];
  (function recorrer(dir) {
    for (const e of readdirSync(dir)) {
      const ruta = join(dir, e);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (e.endsWith(".js")) archivos.push(ruta);
    }
  })(join(raiz, "public", "js"));

  const sospechosas = [];
  for (const ruta of archivos) {
    const fuente = readFileSync(ruta, "utf8");
    const corta = relative(raiz, ruta).replace(/\\/g, "/");

    // `doc(db, "users", X)` y `doc(db, COLECCION, X)`.
    for (const uso of fuente.matchAll(/doc\(\s*db\s*,\s*(?:"users"|COLECCION)\s*,\s*([^),]+)\)/g)) {
      const quien = uso[1].trim();
      if (ES_PROPIO.test(quien)) continue;
      const linea = fuente.slice(0, uso.index).split("\n").length;
      sospechosas.push(`${corta}:${linea} -> ${quien}`);
    }

    // Y que nadie liste la colección entera desde el navegador.
    for (const uso of fuente.matchAll(/collection\(\s*db\s*,\s*(?:"users"|COLECCION)\s*\)/g)) {
      const linea = fuente.slice(0, uso.index).split("\n").length;
      sospechosas.push(`${corta}:${linea} -> lista TODA la colección users`);
    }
  }

  ok(sospechosas.length === 0,
     `${archivos.length} archivos revisados: ninguna lectura de un perfil ajeno`,
     sospechosas);
}

// ═══════════════ los nombres que se muestran NO salen del perfil ajeno

console.log("\n=== Los nombres públicos viajan por su cuenta ===");
{
  // Ésta es la razón por la que restringir la regla no rompió nada, y hay que
  // dejarla probada: si alguien "simplifica" esto leyendo `users`, la pantalla
  // se va a quedar sin nombres contra las reglas nuevas.
  const room = readFileSync(join(raiz, "public", "js", "room.js"), "utf8");
  ok(room.includes("sala.jugadoresNombres"),
     "la sala de espera toma los nombres del documento de la sala");

  const rankingUi = readFileSync(join(raiz, "public", "js", "ranking-ui.js"), "utf8");
  ok(/f\.nombre\s*\?\?/.test(rankingUi),
     "la tabla del ranking toma el nombre de su propia fila");

  const servidor = readFileSync(join(raiz, "functions", "index.js"), "utf8");
  ok(servidor.includes("jugadoresNombres"),
     "y es el servidor el que copia el nombre a la sala, con credenciales de admin");
}

console.log(fallos ? `\n❌ ${fallos} fallos\n` : "\n✅ TODO OK\n");
process.exit(fallos ? 1 : 0);
