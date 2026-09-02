/**
 * Reportes entre jugadores.
 *
 * QUÉ SE DEFIENDE ACÁ
 *
 * Un reporte no le saca nada a nadie: es una nota para que una persona la lea.
 * Pero se puede usar para hacer daño de dos formas, y las dos se prueban:
 *
 *   - FIRMAR CON EL NOMBRE DE OTRO. Si el denunciante viniera del cuerpo del
 *     pedido, cualquiera podría llenar la bandeja de denuncias falsas atribuidas
 *     a un tercero. Sale del token, y acá se comprueba que el cuerpo no puede
 *     pisarlo.
 *
 *   - ENSAÑARSE CON UNO. El límite de ritmo frena el bucle de una pestaña,
 *     pero no a quien denuncia al mismo rival una vez por minuto toda una
 *     tarde. De ahí las 24 horas entre reportes a la MISMA persona — y que se
 *     pueda seguir reportando a otros mientras tanto, que es lo que hace la
 *     diferencia entre un freno y un castigo.
 *
 * Y una tercera, del lado del panel: que un jugador cualquiera no pueda leer
 * la bandeja. Saber quién te reportó es exactamente lo que hace que la gente
 * no reporte.
 */

import { crearReportes, MOTIVOS, MS_ENTRE_REPORTES_AL_MISMO, LARGO_COMENTARIO }
  from "../functions/reportes.js";

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

/**
 * Un Firestore de mentira con lo justo: documentos, consultas encadenadas y
 * transacciones que se quejan si se lee después de escribir.
 *
 * Esa última parte no es decoración: Firestore rechaza de verdad una
 * transacción que lea tras escribir, y una función que lo haga funciona en las
 * pruebas y falla en producción. Acá revienta igual que allá.
 */
function crearFirestore() {
  const docs = new Map(); // ruta -> datos

  const consulta = (col, filtros = [], orden = null, tope = Infinity) => ({
    where: (campo, _op, valor) => consulta(col, [...filtros, [campo, valor]], orden, tope),
    orderBy: (campo, dir) => consulta(col, filtros, [campo, dir], tope),
    limit: (n) => consulta(col, filtros, orden, n),
    async get() { return resolver(col, filtros, orden, tope); },
    _es: "consulta", col, filtros, orden, tope,
  });

  function resolver(col, filtros, orden, tope) {
    let filas = [...docs.entries()]
      .filter(([ruta]) => ruta.startsWith(`${col}/`))
      .map(([ruta, datos]) => ({ id: ruta.slice(col.length + 1), data: () => ({ ...datos }), exists: true }));

    for (const [campo, valor] of filtros) {
      filas = filas.filter((f) => f.data()[campo] === valor);
    }
    if (orden) {
      const [campo, dir] = orden;
      filas.sort((a, b) => (dir === "desc" ? 1 : -1) * ((a.data()[campo] ?? 0) < (b.data()[campo] ?? 0) ? 1 : -1));
    }
    filas = filas.slice(0, tope);
    return { docs: filas, size: filas.length, forEach: (fn) => filas.forEach(fn) };
  }

  const db = {
    collection: (nombre) => ({
      doc: (id) => ({
        ruta: `${nombre}/${id}`,
        async get() {
          const d = docs.get(`${nombre}/${id}`);
          return { exists: Boolean(d), id, data: () => (d ? { ...d } : undefined) };
        },
      }),
      where: (c, o, v) => consulta(nombre).where(c, o, v),
      orderBy: (c, d) => consulta(nombre).orderBy(c, d),
      limit: (n) => consulta(nombre).limit(n),
      async get() { return resolver(nombre, [], null, Infinity); },
    }),

    async runTransaction(cuerpo) {
      let yaEscribio = false;
      const pendientes = [];
      const tx = {
        async get(refOConsulta) {
          if (yaEscribio) throw error("invalid-argument", "Lectura tras escritura");
          if (refOConsulta?._es === "consulta") return refOConsulta.get();
          const d = docs.get(refOConsulta.ruta);
          return { exists: Boolean(d), data: () => (d ? { ...d } : undefined) };
        },
        set(ref, datos) { yaEscribio = true; pendientes.push([ref.ruta, datos]); },
      };
      const r = await cuerpo(tx);
      for (const [ruta, datos] of pendientes) docs.set(ruta, datos);
      return r;
    },

    // Ayudas de la prueba, no de Firestore.
    _poner: (ruta, datos) => docs.set(ruta, datos),
    _leer: (ruta) => docs.get(ruta),
    _todos: (col) => [...docs.entries()].filter(([r]) => r.startsWith(`${col}/`)),
  };
  return db;
}

const ADMIN = "admin@memorie.test";
let reloj = 1_700_000_000_000;

function montar() {
  const db = crearFirestore();
  db._poner("users/ana", { username: "Ana", credits: 100 });
  db._poner("users/beto", { username: "Beto", credits: 50 });
  db._poner("users/caro", { username: "Caro", credits: 0 });

  const mod = crearReportes({
    db, error, ahora: () => reloj, marcaDeTiempo: () => "T", emailAdmin: ADMIN,
  });
  return { db, mod };
}

const comoAdmin = { auth: { uid: "root", token: { email: ADMIN, email_verified: true } } };

// ==================================================================== 1

console.log("\n=== 1. Un reporte normal queda guardado ===");
{
  reloj = 1_700_000_000_000;
  const { db, mod } = montar();

  const r = await mod.reportar("ana", {
    denunciado: "beto", motivo: "trampa", comentario: "  Tardaba a propósito.  ", codigo: "abc234",
  });
  ok(r.hecho === true, "contesta que quedó hecho", r);

  const guardados = db._todos("reportes");
  ok(guardados.length === 1, "hay un reporte", guardados.length);

  const d = guardados[0][1];
  ok(d.denunciante === "ana" && d.denunciado === "beto", "quién a quién", d);
  ok(d.motivo === "trampa", "el motivo", d.motivo);
  ok(d.comentario === "Tardaba a propósito.", "el comentario, recortado de espacios", d.comentario);
  ok(d.sala === "ABC234", "la sala, en mayúsculas", d.sala);
  ok(d.estado === "pendiente", "y arranca pendiente", d.estado);
}

// ==================================================================== 2

console.log("\n=== 2. Lo que no se acepta ===");
{
  reloj = 1_700_000_000_000;
  const { mod } = montar();

  const solo = await capturar(() => mod.reportar("ana", { denunciado: "ana", motivo: "trampa" }));
  ok(/vos mismo/i.test(solo.error?.message ?? ""), "nadie se reporta a sí mismo", solo.error?.message);

  const raro = await capturar(() => mod.reportar("ana", { denunciado: "beto", motivo: "porque si" }));
  ok(/motivo/i.test(raro.error?.message ?? ""), "un motivo inventado se rechaza", raro.error?.message);

  const fantasma = await capturar(() => mod.reportar("ana", { denunciado: "nadie", motivo: "trampa" }));
  ok(fantasma.error?.codigo === "not-found",
     "no se puede reportar a una cuenta que no existe", fantasma.error?.message);

  const sinSesion = await capturar(() => mod.reportar(null, { denunciado: "beto", motivo: "trampa" }));
  ok(sinSesion.error?.codigo === "unauthenticated", "ni sin sesión", sinSesion.error?.codigo);

  ok(MOTIVOS.length >= 3 && MOTIVOS.includes("otro"),
     "la lista de motivos es cerrada y tiene una salida", MOTIVOS);
}

// ==================================================================== 3

console.log("\n=== 3. No se puede ensañar con una persona ===");
{
  reloj = 1_700_000_000_000;
  const { db, mod } = montar();

  await mod.reportar("ana", { denunciado: "beto", motivo: "insultos" });

  reloj += 60_000; // un minuto después
  const otra = await capturar(() => mod.reportar("ana", { denunciado: "beto", motivo: "trampa" }));
  ok(otra.error?.codigo === "failed-precondition",
     "un minuto después, no la deja repetir contra el mismo", otra.error?.message);

  // Pero SÍ contra otro. Esta es la parte que distingue un freno de un castigo:
  // a quien le están arruinando la partida dos personas distintas tiene que
  // poder decir las dos cosas.
  const aOtro = await capturar(() => mod.reportar("ana", { denunciado: "caro", motivo: "trampa" }));
  ok(aOtro.valor?.hecho === true, "pero sí puede reportar a otra persona", aOtro.error?.message);

  // Y pasadas las 24 horas, se puede volver.
  reloj += MS_ENTRE_REPORTES_AL_MISMO;
  const alDiaSiguiente = await capturar(() => mod.reportar("ana", { denunciado: "beto", motivo: "trampa" }));
  ok(alDiaSiguiente.valor?.hecho === true, "y al día siguiente sí", alDiaSiguiente.error?.message);

  ok(db._todos("reportes").length === 3, "quedaron los tres que correspondían", db._todos("reportes").length);
}

// ==================================================================== 4

console.log("\n=== 4. El denunciante no se puede falsificar ===");
{
  reloj = 1_700_000_000_000;
  const { db, mod } = montar();

  // Se manda `denunciante` en el cuerpo, como haría alguien desde la consola.
  await mod.reportar("ana", {
    denunciado: "beto", motivo: "trampa", denunciante: "caro", uid: "caro",
  });

  const d = db._todos("reportes")[0][1];
  ok(d.denunciante === "ana",
     "el del token gana: el cuerpo del pedido no puede firmar por otro", d.denunciante);
}

// ==================================================================== 5

console.log("\n=== 5. El comentario se recorta, no revienta ===");
{
  reloj = 1_700_000_000_000;
  const { db, mod } = montar();

  await mod.reportar("ana", {
    denunciado: "beto", motivo: "otro", comentario: "x".repeat(LARGO_COMENTARIO + 500),
  });

  const d = db._todos("reportes")[0][1];
  ok(d.comentario.length === LARGO_COMENTARIO,
     "se guarda recortado en vez de rechazar la denuncia entera", d.comentario.length);
}

// ==================================================================== 6

console.log("\n=== 6. La bandeja es sólo del administrador ===");
{
  reloj = 1_700_000_000_000;
  const { mod } = montar();
  await mod.reportar("ana", { denunciado: "beto", motivo: "trampa", comentario: "Uno" });

  const ajeno = { auth: { uid: "ana", token: { email: "ana@x.com", email_verified: true } } };
  const r1 = await capturar(() => mod.listar(ajeno));
  ok(r1.error?.codigo === "permission-denied", "un jugador cualquiera no la ve", r1.error?.codigo);

  // Con el correo correcto pero SIN verificar tampoco. Si no, alcanza con
  // registrar una cuenta con esa dirección y no confirmar el correo.
  const sinVerificar = { auth: { uid: "x", token: { email: ADMIN, email_verified: false } } };
  const r2 = await capturar(() => mod.listar(sinVerificar));
  ok(r2.error?.codigo === "permission-denied",
     "ni con el correo del admin sin verificar", r2.error?.codigo);

  const r3 = await capturar(() => mod.listar(comoAdmin));
  ok(r3.valor?.total === 1, "y el administrador sí", r3.error?.message ?? r3.valor);
}

// ==================================================================== 7

console.log("\n=== 7. La bandeja trae los nombres resueltos ===");
{
  reloj = 1_700_000_000_000;
  const { db, mod } = montar();
  await mod.reportar("ana", { denunciado: "beto", motivo: "trampa", comentario: "Uno" });
  reloj += 1000;
  await mod.reportar("beto", { denunciado: "caro", motivo: "nombre", comentario: "Dos" });

  const r = await mod.listar(comoAdmin);
  ok(r.total === 2 && r.pendientes === 2, "los dos, los dos pendientes", r);

  // Los nombres los resuelve el servidor porque `users` se lee sólo por su
  // dueño: el navegador del panel no puede pedirle el nombre de nadie.
  const ultimo = r.reportes[0];
  ok(ultimo.denunciante.nombre === "Beto" && ultimo.denunciado.nombre === "Caro",
     "con nombre y no sólo uid", ultimo);
  ok(ultimo.comentario === "Dos", "el más nuevo primero", ultimo.comentario);

  // Una cuenta borrada no rompe el listado.
  const conFantasma = crearReportes({
    db, error, ahora: () => reloj, marcaDeTiempo: () => "T", emailAdmin: ADMIN,
  });
  db._poner("reportes/r_viejo", {
    denunciante: "ana", denunciado: "borrado", motivo: "otro", comentario: "", estado: "pendiente", creado: 1,
  });
  const conBaja = await conFantasma.listar(comoAdmin);
  const fila = conBaja.reportes.find((x) => x.id === "r_viejo");
  ok(fila?.denunciado.nombre === null,
     "y una cuenta que ya no está sale con nombre null, no rompe", fila);
}

// ==================================================================== 8

console.log("\n=== 8. Resolver no le toca nada a la cuenta denunciada ===");
{
  reloj = 1_700_000_000_000;
  const { db, mod } = montar();
  await mod.reportar("ana", { denunciado: "beto", motivo: "trampa" });
  const id = db._todos("reportes")[0][0].replace("reportes/", "");

  const antes = { ...db._leer("users/beto") };

  const ajeno = { auth: { uid: "ana", token: { email: "ana@x.com", email_verified: true } } };
  const noPuede = await capturar(() => mod.resolver(ajeno, { id, estado: "ignorado" }));
  ok(noPuede.error?.codigo === "permission-denied", "un jugador no puede resolver", noPuede.error?.codigo);

  const r = await mod.resolver(comoAdmin, { id, estado: "resuelto", nota: "Hablado" });
  ok(r.estado === "resuelto", "el administrador sí", r);
  ok(db._leer(`reportes/${id}`).estado === "resuelto", "queda guardado");
  ok(db._leer(`reportes/${id}`).nota === "Hablado", "con la nota");
  ok(db._leer(`reportes/${id}`).resueltoPor === "root", "y quién lo resolvió");

  ok(JSON.stringify(db._leer("users/beto")) === JSON.stringify(antes),
     "la cuenta denunciada quedó intacta: esto no suspende a nadie",
     db._leer("users/beto"));

  const inventado = await capturar(() => mod.resolver(comoAdmin, { id, estado: "quemado" }));
  ok(inventado.error?.codigo === "invalid-argument", "un estado inventado se rechaza", inventado.error?.codigo);
}

// ==================================================================== 9

console.log("\n=== 9. Se puede filtrar por estado ===");
{
  reloj = 1_700_000_000_000;
  const { db, mod } = montar();
  await mod.reportar("ana", { denunciado: "beto", motivo: "trampa" });
  reloj += 1000;
  await mod.reportar("ana", { denunciado: "caro", motivo: "insultos" });

  const id = db._todos("reportes")[0][0].replace("reportes/", "");
  await mod.resolver(comoAdmin, { id, estado: "ignorado" });

  const pendientes = await mod.listar(comoAdmin, { estado: "pendiente" });
  ok(pendientes.total === 1, "sólo el que sigue pendiente", pendientes.total);

  const todos = await mod.listar(comoAdmin);
  ok(todos.total === 2, "y sin filtro, los dos", todos.total);
}

// ====================================================================

console.log(fallos ? `\n❌ ${fallos} fallo(s)` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
