/**
 * Quién puede administrar, y cómo se agrega o se quita.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LO QUE HAY QUE DEFENDER, EN ORDEN DE GRAVEDAD
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   1. QUE NADIE SE DÉ PERMISOS A SÍ MISMO. Es lo único que convierte esto en
 *      un agujero: si un jugador cualquiera pudiera agregarse, todo el panel
 *      —cancelar salas, dar de baja cuentas, ver el pozo— queda abierto.
 *
 *   2. QUE NO SE PUEDA QUEDAR SIN NADIE ADENTRO. Un panel sin administradores
 *      no se arregla desde el panel. De ahí las dos reglas: el raíz no se
 *      quita, y nadie se quita a sí mismo.
 *
 *   3. QUE QUEDE ESCRITO QUIÉN DIO CADA PERMISO. Un permiso que apareció sin
 *      saber quién lo dio es un permiso que nadie se anima a quitar.
 */

import { crearAdministradores, pareceCorreo, normalizarCorreo }
  from "../functions/administradores.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

class E extends Error { constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; } }
const error = (codigo, mensaje) => new E(codigo, mensaje);
const capturar = async (fn) => {
  try { return { valor: await fn() }; } catch (e) { return { error: e }; }
};

/** Firestore de mentira: documentos por id y transacciones con lectura previa. */
function crearFirestore() {
  const docs = new Map();
  return {
    collection: (col) => ({
      doc: (id) => ({
        ruta: `${col}/${id}`, id,
        async get() {
          const d = docs.get(`${col}/${id}`);
          return { exists: Boolean(d), id, data: () => (d ? { ...d } : undefined) };
        },
      }),
      async get() {
        const filas = [...docs.entries()]
          .filter(([r]) => r.startsWith(`${col}/`))
          .map(([r, d]) => ({ id: r.slice(col.length + 1), data: () => ({ ...d }) }));
        return { size: filas.length, forEach: (fn) => filas.forEach(fn) };
      },
    }),
    async runTransaction(cuerpo) {
      let escribio = false;
      const pendientes = [];
      const r = await cuerpo({
        async get(ref) {
          if (escribio) throw error("invalid-argument", "Lectura tras escritura");
          const d = docs.get(ref.ruta);
          return { exists: Boolean(d), data: () => (d ? { ...d } : undefined) };
        },
        set(ref, datos) { escribio = true; pendientes.push([ref.ruta, datos]); },
      });
      for (const [ruta, datos] of pendientes) docs.set(ruta, datos);
      return r;
    },
    _leer: (r) => docs.get(r),
    _todos: () => [...docs.entries()],
  };
}

const RAIZ = "soporte@memorie.test";
let reloj = 1_700_000_000_000;

const montar = () => {
  const db = crearFirestore();
  return {
    db,
    admins: crearAdministradores({
      db, error, marcaDeTiempo: () => "T", ahora: () => reloj, correoRaiz: RAIZ,
    }),
  };
};

const como = (correo, verificado = true) => ({
  auth: { uid: `uid-${correo}`, token: { email: correo, email_verified: verificado } },
});

// ==================================================================== 1

console.log("\n=== 1. El raíz manda sin estar en ninguna lista ===");
{
  reloj = 1_700_000_000_000;
  const { admins, db } = montar();

  ok(await admins.puedeAdministrar(RAIZ), "el raíz puede administrar");
  ok(db._todos().length === 0, "sin que exista ni un documento", db._todos().length);

  // Las mayúsculas no lo dejan afuera: los correos no distinguen, y Firebase
  // los guarda en minúsculas.
  ok(await admins.puedeAdministrar("Soporte@Memorie.TEST"),
     "y escribirlo con mayúsculas tampoco lo bloquea");

  ok(!(await admins.puedeAdministrar("otro@x.com")), "un correo cualquiera no");
  ok(!(await admins.puedeAdministrar("")), "ni uno vacío");
  ok(!(await admins.puedeAdministrar(null)), "ni null");
}

// ==================================================================== 2

console.log("\n=== 2. Nadie se da permisos a sí mismo ===");
{
  reloj = 1_700_000_000_000;
  const { admins, db } = montar();

  // Éste es EL caso. Si pasa, todo el panel queda abierto.
  const r = await capturar(() => admins.agregar(como("cualquiera@x.com"), { correo: "cualquiera@x.com" }));
  ok(r.error?.codigo === "permission-denied",
     "un jugador cualquiera no puede agregarse", r.error?.message);
  ok(db._todos().length === 0, "y no escribió nada", db._todos());

  // Ni leer la lista, que ya dice quiénes son.
  const l = await capturar(() => admins.listar(como("cualquiera@x.com")));
  ok(l.error?.codigo === "permission-denied", "ni ver quiénes son", l.error?.codigo);

  // Ni con el correo del raíz SIN verificar: si no, registrar una cuenta con
  // esa dirección y no confirmarla alcanzaría para entrar.
  const sinVerificar = await capturar(() => admins.listar(como(RAIZ, false)));
  ok(sinVerificar.error?.codigo === "permission-denied",
     "ni con el correo del raíz pero sin verificar", sinVerificar.error?.codigo);

  const sinSesion = await capturar(() => admins.listar({}));
  ok(sinSesion.error?.codigo === "unauthenticated", "ni sin sesión", sinSesion.error?.codigo);
}

// ==================================================================== 3

console.log("\n=== 3. El raíz agrega, y queda escrito quién fue ===");
{
  reloj = 1_700_000_000_000;
  const { admins, db } = montar();

  const r = await admins.agregar(como(RAIZ), { correo: "  Ana@Ejemplo.COM  " });
  ok(r.hizo === "agregado", "lo agrega", r);
  ok(r.correo === "ana@ejemplo.com", "normalizado a minúsculas y sin espacios", r.correo);

  const d = db._leer("administradores/ana@ejemplo.com");
  ok(d?.activo === true, "queda activo", d);
  ok(d?.agregadoPor === RAIZ, "con quién lo agregó", d?.agregadoPor);
  ok(d?.creado === reloj, "y cuándo", d?.creado);

  ok(await admins.puedeAdministrar("ana@ejemplo.com"), "y ya puede administrar");
  // La normalización importa: sin ella habría dos documentos y quitar uno
  // dejaría al otro con acceso.
  ok(await admins.puedeAdministrar("ANA@ejemplo.com"), "escrito como sea");

  // Y el nuevo administrador puede agregar a otro.
  const otro = await admins.agregar(como("ana@ejemplo.com"), { correo: "beto@x.com" });
  ok(otro.hizo === "agregado", "un administrador agregado puede agregar a otro", otro);
  ok(db._leer("administradores/beto@x.com")?.agregadoPor === "ana@ejemplo.com",
     "y queda escrito que fue él");
}

// ==================================================================== 4

console.log("\n=== 4. Lo que no se acepta al agregar ===");
{
  reloj = 1_700_000_000_000;
  const { admins } = montar();

  for (const malo of ["", "   ", "no-es-un-correo", "sin@punto", "con/barra@x.com", "a b@x.com"]) {
    const r = await capturar(() => admins.agregar(como(RAIZ), { correo: malo }));
    ok(r.error?.codigo === "invalid-argument", `rechaza ${JSON.stringify(malo)}`, r.error?.message);
  }

  // La barra importa de verdad: es lo único que rompe un id de documento en
  // Firestore, y ahí el id ES el correo.
  ok(!pareceCorreo("con/barra@x.com"), "y la barra se ataja antes de llegar a Firestore");

  await admins.agregar(como(RAIZ), { correo: "ana@x.com" });
  const repe = await capturar(() => admins.agregar(como(RAIZ), { correo: "ana@x.com" }));
  ok(repe.error?.codigo === "failed-precondition", "no se agrega dos veces", repe.error?.message);

  const alRaiz = await capturar(() => admins.agregar(como(RAIZ), { correo: RAIZ }));
  ok(alRaiz.error?.codigo === "failed-precondition",
     "y agregar al raíz no tiene sentido: ya lo es", alRaiz.error?.message);
}

// ==================================================================== 5

console.log("\n=== 5. Las dos reglas que evitan quedarse sin nadie ===");
{
  reloj = 1_700_000_000_000;
  const { admins, db } = montar();
  await admins.agregar(como(RAIZ), { correo: "ana@x.com" });

  // Quitar al raíz: nunca. Es el seguro contra el peor día.
  const alRaiz = await capturar(() => admins.quitar(como("ana@x.com"), { correo: RAIZ }));
  ok(alRaiz.error?.codigo === "failed-precondition",
     "el raíz no se puede quitar", alRaiz.error?.message);
  ok(await admins.puedeAdministrar(RAIZ), "y sigue pudiendo administrar");

  // Quitarse a uno mismo: tampoco. Es un clic, y deshacerlo puede ser
  // imposible si era el último que quedaba.
  const aSiMismo = await capturar(() => admins.quitar(como("ana@x.com"), { correo: "ana@x.com" }));
  ok(aSiMismo.error?.codigo === "failed-precondition",
     "nadie se quita a sí mismo", aSiMismo.error?.message);
  ok(await admins.puedeAdministrar("ana@x.com"), "y sigue adentro");

  // Ni escribiéndolo con otras mayúsculas, que sería la forma de esquivarlo.
  const disfrazado = await capturar(() => admins.quitar(como("ana@x.com"), { correo: "ANA@X.com" }));
  ok(disfrazado.error?.codigo === "failed-precondition",
     "ni cambiando las mayúsculas", disfrazado.error?.message);

  ok(db._leer("administradores/ana@x.com")?.activo === true, "nada de eso lo tocó");
}

// ==================================================================== 6

console.log("\n=== 6. Quitar a otro sí, y queda el asiento ===");
{
  reloj = 1_700_000_000_000;
  const { admins, db } = montar();
  await admins.agregar(como(RAIZ), { correo: "ana@x.com" });
  await admins.agregar(como(RAIZ), { correo: "beto@x.com" });

  reloj += 5000;
  const r = await admins.quitar(como("ana@x.com"), { correo: "beto@x.com" });
  ok(r.hizo === "quitado", "un administrador puede quitar a otro", r);
  ok(!(await admins.puedeAdministrar("beto@x.com")), "y deja de poder administrar");

  // El documento NO se borra: es el asiento de que esa cuenta tuvo acceso,
  // quién se lo dio y quién se lo sacó. Borrarlo deja sin respuesta la pregunta
  // que uno se hace justo después de un problema.
  const d = db._leer("administradores/beto@x.com");
  ok(Boolean(d), "el documento sigue ahí");
  ok(d.activo === false, "marcado como inactivo", d.activo);
  ok(d.agregadoPor === RAIZ, "con quién lo había agregado", d.agregadoPor);
  ok(d.quitadoPor === "ana@x.com", "y quién lo quitó", d.quitadoPor);
  ok(d.quitado === reloj, "y cuándo", d.quitado);

  const otraVez = await capturar(() => admins.quitar(como(RAIZ), { correo: "beto@x.com" }));
  ok(otraVez.error?.codigo === "not-found", "quitarlo dos veces avisa", otraVez.error?.codigo);

  // Y se lo puede volver a agregar.
  const vuelve = await admins.agregar(como(RAIZ), { correo: "beto@x.com" });
  ok(vuelve.hizo === "agregado", "se lo puede volver a agregar", vuelve);
  ok(await admins.puedeAdministrar("beto@x.com"), "y vuelve a poder");
}

// ==================================================================== 7

console.log("\n=== 7. El listado ===");
{
  reloj = 1_700_000_000_000;
  const { admins } = montar();
  await admins.agregar(como(RAIZ), { correo: "ana@x.com" });
  await admins.agregar(como(RAIZ), { correo: "beto@x.com" });
  await admins.quitar(como(RAIZ), { correo: "beto@x.com" });

  const { administradores, yo } = await admins.listar(como("ana@x.com"));

  ok(administradores.length === 2, "sólo los activos, más el raíz", administradores.map((a) => a.correo));
  ok(administradores[0].correo === RAIZ && administradores[0].raiz === true,
     "el raíz encabeza y va marcado", administradores[0]);
  // Sin esto, el panel mostraría una lista donde falta justamente quien no se
  // puede sacar, y daría la impresión de que sí se puede.
  ok(administradores.some((a) => a.correo === "ana@x.com"), "está el agregado");
  ok(!administradores.some((a) => a.correo === "beto@x.com"), "y no el quitado");

  ok(yo === "ana@x.com", "dice quién está mirando", yo);
  ok(administradores.find((a) => a.correo === "ana@x.com")?.soyYo === true,
     "y marca cuál es, para que el panel apague su propio botón de quitar");
}

// ==================================================================== 8

console.log("\n=== 8. Un desactivado no puede nada ===");
{
  reloj = 1_700_000_000_000;
  const { admins } = montar();
  await admins.agregar(como(RAIZ), { correo: "ana@x.com" });
  await admins.quitar(como(RAIZ), { correo: "ana@x.com" });

  // El documento sigue existiendo con `activo: false`. Si la comprobación
  // mirara sólo si existe, seguiría entrando.
  ok(!(await admins.puedeAdministrar("ana@x.com")), "no puede administrar");

  const l = await capturar(() => admins.listar(como("ana@x.com")));
  ok(l.error?.codigo === "permission-denied", "ni ver la lista", l.error?.codigo);

  const a = await capturar(() => admins.agregar(como("ana@x.com"), { correo: "otro@x.com" }));
  ok(a.error?.codigo === "permission-denied", "ni agregar a nadie", a.error?.codigo);
}

// ====================================================================

console.log(fallos ? `\n❌ ${fallos} fallo(s)` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
