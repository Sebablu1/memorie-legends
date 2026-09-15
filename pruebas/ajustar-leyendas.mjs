/**
 * La herramienta que crea Leyendas de la nada sólo toca cuentas admin.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ÉSTA SE PRUEBA MÁS QUE NINGUNA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque es la única forma de mover saldo que no responde a nada que haya
 * pasado en el juego. Todo lo demás —premios, entradas, compras, devoluciones—
 * tiene un hecho detrás que lo justifica y que se puede auditar. Un ajuste no:
 * crea moneda porque alguien lo pidió.
 *
 * Lo que se defiende acá es el cerrojo y la aritmética. Si el cerrojo falla,
 * un jugador cualquiera termina con Leyendas que nadie ganó ni pagó, y el
 * libro mayor no tendría forma de distinguirlo de un premio legítimo.
 */

import { planDeAjuste, esAdministrador } from "../herramientas/ajustar-leyendas.mjs";
import { MOTIVOS } from "../public/js/reglas/economia.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else {
    fallos++;
    console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : "");
  }
};

/** Firestore de mentira con la colección de administradores. */
const dbCon = (admins = {}) => ({
  collection: () => ({
    doc: (correo) => ({
      async get() {
        const d = admins[correo];
        return { exists: Boolean(d), data: () => d };
      },
    }),
  }),
});

// =====================================================================
console.log("\n=== 1. El cerrojo: quién puede ser ajustado ===");
// =====================================================================

{
  const db = dbCon({
    "otro.admin@ejemplo.com": { activo: true },
    "ex.admin@ejemplo.com": { activo: false },
  });

  /**
   * La raíz pasa aunque NO esté en la colección.
   *
   * Es el caso que un cerrojo ingenuo rompería. `soporte.memorie.legends` está
   * cableada en `functions/index.js` y no figura en `administradores`: mirar
   * sólo la colección rechazaría al único administrador que siempre existe, y
   * es justo la cuenta que uno quiere ajustar para probar.
   */
  ok(await esAdministrador(db, "soporte.memorie.legends@gmail.com"),
     "la cuenta raíz pasa, aunque no esté en la colección");

  ok(await esAdministrador(db, "SOPORTE.Memorie.Legends@Gmail.com"),
     "y pasa con otras mayúsculas: el correo se normaliza");

  ok(await esAdministrador(db, "otro.admin@ejemplo.com"),
     "un administrador de la colección pasa");

  ok(!(await esAdministrador(db, "ex.admin@ejemplo.com")),
     "uno dado de baja (`activo: false`) NO pasa");

  ok(!(await esAdministrador(db, "jugador@ejemplo.com")),
     "un jugador cualquiera NO pasa");

  ok(!(await esAdministrador(db, "")), "y un correo vacío tampoco");
  ok(!(await esAdministrador(db, null)), "ni uno ausente");
}

// =====================================================================
console.log("\n=== 2. El plan calcula los deltas por bolsillo ===");
// =====================================================================

{
  const plan = planDeAjuste({ comprado: 0, ganado: 455 }, { comprado: 500, ganado: 100 });

  ok(plan.problemas.length === 0, "un ajuste normal no tiene problemas", plan.problemas);
  ok(plan.cambia, "y cambia algo");
  ok(plan.despues.comprado === 500 && plan.despues.ganado === 100,
     "los valores son ABSOLUTOS, no deltas", plan.despues);
  ok(plan.total === 600, "el total es la suma de los dos bolsillos", plan.total);

  const comprado = plan.movimientos.find((m) => m.motivo === MOTIVOS.AJUSTE_ADMIN_COMPRADO);
  const ganado = plan.movimientos.find((m) => m.motivo === MOTIVOS.AJUSTE_ADMIN_GANADO);

  ok(comprado.delta === 500, "de 0 a 500 compradas es +500", comprado);
  ok(ganado.delta === -355, "y de 455 a 100 ganadas es -355", ganado);

  // Cada movimiento nombra su bolsillo. Con un motivo solo, el segundo no
  // tendría forma de decir cuál de los dos toca.
  ok(plan.movimientos.length === 2, "son dos movimientos, uno por bolsillo");
}

{
  // Lo que no cambia, no se mueve: sin esto, cada corrida dejaría dos asientos
  // de cero en el libro mayor y ensuciaría la auditoría.
  const plan = planDeAjuste({ comprado: 10, ganado: 20 }, { comprado: 10, ganado: 99 });
  ok(plan.movimientos.length === 1, "sólo se mueve el bolsillo que cambia", plan.movimientos);
  ok(plan.movimientos[0].motivo === MOTIVOS.AJUSTE_ADMIN_GANADO, "y es el que corresponde");

  const igual = planDeAjuste({ comprado: 10, ganado: 20 }, { comprado: 10, ganado: 20 });
  ok(!igual.cambia, "pedir los valores que ya tiene no mueve nada");
  ok(igual.movimientos.length === 0, "y no deja asientos");
}

{
  // Omitir un bolsillo lo deja como está, en vez de ponerlo en cero. Es la
  // diferencia entre "subime las ganadas" y "borrame lo comprado".
  const plan = planDeAjuste({ comprado: 700, ganado: 20 }, { comprado: null, ganado: 50 });
  ok(plan.despues.comprado === 700, "el bolsillo que no se nombra queda intacto", plan.despues);
  ok(plan.movimientos.length === 1, "y no genera un movimiento de cero");
}

// =====================================================================
console.log("\n=== 3. Se niega a dejar un saldo imposible ===");
// =====================================================================

{
  const negativo = planDeAjuste({ comprado: 0, ganado: 100 }, { comprado: -5, ganado: 10 });
  ok(negativo.problemas.length > 0, "un valor negativo se rechaza", negativo.problemas);
  ok(!negativo.cambia, "y no propone ningún movimiento");

  const decimal = planDeAjuste({ comprado: 0, ganado: 100 }, { comprado: 1.5, ganado: 10 });
  ok(decimal.problemas.length > 0, "un decimal también", decimal.problemas);

  const noEsNumero = planDeAjuste({ comprado: 0, ganado: 100 }, { comprado: NaN, ganado: 10 });
  ok(noEsNumero.problemas.length > 0, "y algo que no es número", noEsNumero.problemas);

  // Los dos a la vez se informan juntos: quien corrió el comando se entera de
  // todo lo que está mal de una vez, en vez de arreglar uno y volver a chocar.
  const dos = planDeAjuste({ comprado: 0, ganado: 0 }, { comprado: -1, ganado: -2 });
  ok(dos.problemas.length === 2, "y los problemas se informan todos juntos", dos.problemas);
}

// =====================================================================
console.log("\n=== 4. Los motivos del ajuste están en la tabla de bolsillos ===");
// =====================================================================

{
  /**
   * Sin fila en `REPARTO_POR_MOTIVO`, `moverLeyendas` se rompe al aplicarlo.
   *
   * Y se rompería EN PRODUCCIÓN, con el comando ya escrito y la transacción
   * abierta, en vez de acá.
   */
  const { REPARTO_POR_MOTIVO, REPARTOS } = await import("../public/js/reglas/economia.js");

  ok(REPARTO_POR_MOTIVO[MOTIVOS.AJUSTE_ADMIN_GANADO] === REPARTOS.A_GANADO,
     "el ajuste de ganadas toca el bolsillo ganado");
  ok(REPARTO_POR_MOTIVO[MOTIVOS.AJUSTE_ADMIN_COMPRADO] === REPARTOS.A_COMPRADO,
     "y el de compradas, el comprado");
}

console.log(fallos ? `\n❌ ${fallos} fallos\n` : "\n✅ TODO OK\n");
process.exit(fallos ? 1 : 0);
