/**
 * La limpieza de perfiles borra lo que tiene que borrar, y frena si no entiende.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE SE DEFIENDE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Borrar un campo de todos los perfiles es irreversible y silencioso: no deja
 * asiento, no se puede deshacer, y si el campo significaba algo, la pérdida se
 * descubre cuando alguien lo busca y no está.
 *
 * Toda la premisa es «nadie escribe este campo desde hace meses, y lo que
 * tiene es una lista cerrada de ids que nunca existieron». Si esa premisa es
 * falsa, borrar tapa la única evidencia. Por eso lo que más se prueba acá no
 * es que borre: es que SE NIEGUE cuando encuentra algo que no esperaba.
 */

import { planDeLimpieza } from "../herramientas/limpiar-perfiles.mjs";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else {
    fallos++;
    console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : "");
  }
};

const perfil = (uid, datos) => ({ uid, datos });

// =====================================================================
console.log("\n=== 1. Encuentra los perfiles con el campo ===");
// =====================================================================

{
  const { conCampo } = planDeLimpieza([
    perfil("ana", { username: "Ana", insignias: ["dorada", "top10"] }),
    perfil("beto", { username: "Beto" }),
    perfil("caro", { username: "Caro", insignias: [] }),
  ]);

  ok(conCampo.length === 2, "dos de los tres lo tienen", conCampo.map((p) => p.uid));
  ok(conCampo.some((p) => p.uid === "ana"), "el que tiene ids");

  /**
   * Y el que lo tiene VACÍO también se limpia.
   *
   * Un array vacío es una respuesta: dice «este jugador no tiene ninguna». El
   * campo ausente dice lo que corresponde, que es «acá no se guarda eso».
   * Dejarlo sería dejar la mitad del trabajo, y la mitad que además confunde.
   */
  ok(conCampo.some((p) => p.uid === "caro"), "y el que lo tiene vacío");
  ok(!conCampo.some((p) => p.uid === "beto"), "el que no lo tiene queda afuera");
}

// =====================================================================
console.log("\n=== 2. Cuenta qué había, para poder mirarlo antes ===");
// =====================================================================

{
  const { cuentaPorId } = planDeLimpieza([
    perfil("a", { insignias: ["dorada", "top10"] }),
    perfil("b", { insignias: ["dorada"] }),
    perfil("c", { insignias: ["dorada", "bronce"] }),
  ]);

  const mapa = Object.fromEntries(cuentaPorId);
  ok(mapa.dorada === 3, "cuenta cuántos perfiles tienen cada id", mapa);
  ok(mapa.top10 === 1 && mapa.bronce === 1, "incluidos los que aparecen una vez", mapa);

  // Ordenado de mayor a menor: lo que más aparece es lo primero que uno quiere
  // ver en un informe de algo que está por borrar.
  ok(cuentaPorId[0][0] === "dorada", "y el más frecuente va primero", cuentaPorId);
}

// =====================================================================
console.log("\n=== 3. Un id inesperado frena la limpieza ===");
// =====================================================================

{
  /**
   * La prueba que más importa de este archivo.
   *
   * Todo lo que este campo llegó a tener está enumerado en `CONOCIDOS`. Un id
   * fuera de esa lista significa que alguien lo escribió DESPUÉS de que
   * dimos el campo por muerto — y entonces la premisa de la limpieza es falsa.
   *
   * Borrar en ese caso no sería sólo inútil: tapa la única evidencia de que
   * algo sigue escribiendo ahí.
   */
  const { desconocidos } = planDeLimpieza([
    perfil("a", { insignias: ["dorada"] }),
    perfil("b", { insignias: ["insignia-nueva-de-algo"] }),
  ]);

  ok(desconocidos.length === 1, "detecta el id que no estaba en la lista", desconocidos);
  ok(desconocidos[0] === "insignia-nueva-de-algo", "y dice cuál es", desconocidos);
}

{
  const { desconocidos } = planDeLimpieza([
    perfil("a", { insignias: ["dorada", "plateada", "bronce", "top10", "comprador-elite"] }),
  ]);
  ok(desconocidos.length === 0, "los cinco conocidos no frenan nada", desconocidos);
}

// =====================================================================
console.log("\n=== 4. Un campo que no es un array se informa ===");
// =====================================================================

{
  /**
   * Más raro todavía que un id inventado.
   *
   * El campo se borra igual —se borra entero, tenga lo que tenga— pero tiene
   * que verse en el informe: un `insignias` que es un objeto o un texto no lo
   * escribió ninguno de los dos sistemas que conocemos.
   */
  const { conCampo } = planDeLimpieza([
    perfil("a", { insignias: ["dorada"] }),
    perfil("b", { insignias: "dorada" }),
    perfil("c", { insignias: { dorada: true } }),
  ]);

  const raros = conCampo.filter((p) => p.raro).map((p) => p.uid);
  ok(raros.length === 2, "los dos que no son arrays se marcan", raros);
  ok(!conCampo.find((p) => p.uid === "a").raro, "y el array de verdad no");

  // Y aun así entran en la limpieza: el objetivo es que el campo no exista.
  ok(conCampo.length === 3, "los tres se van a limpiar igual", conCampo.length);
}

// =====================================================================
console.log("\n=== 5. Sobre perfiles ya limpios no propone nada ===");
// =====================================================================

{
  const { conCampo, desconocidos } = planDeLimpieza([
    perfil("a", { username: "Ana", credits: 100 }),
    perfil("b", { username: "Beto", credits: 0 }),
  ]);

  ok(conCampo.length === 0, "correrla de nuevo no encuentra nada", conCampo);
  ok(desconocidos.length === 0, "ni ids que mirar");
}

console.log(fallos ? `\n❌ ${fallos} fallos\n` : "\n✅ TODO OK\n");
process.exit(fallos ? 1 : 0);
