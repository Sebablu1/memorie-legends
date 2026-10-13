/**
 * El diseño de la mesa que decide la casa: leerlo y guardarlo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ PASA POR ACÁ Y NO LO ESCRIBE EL NAVEGADOR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `config/{clave}` se lee sin sesión y NO se escribe desde el cliente: lo
 * dicen las reglas, y está bien que lo digan. Un navegador que pudiera
 * escribir ahí le cambiaría la mesa a todo el mundo a la vez.
 *
 * Así que la única forma de guardarlo es ésta, con la puerta de siempre:
 * `administradores.exigir`, la misma de las otras operaciones del panel.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * UN CAMPO EN `null` BORRA; UN CAMPO AUSENTE NO TOCA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Es lo que hace posible volver atrás. Sin eso, una vez cargada una brújula
 * propia no habría forma de recuperar la de siempre sin tocar la base a mano.
 *
 * Se usa `FieldValue.delete()` en vez de escribir `null` en el documento: un
 * `null` guardado llegaría al navegador como un valor, y `capaDeBrujula`
 * tendría que saber que `null` significa «la de siempre» — que es lo mismo
 * que significa que el campo no esté. Dos formas de decir lo mismo son una
 * de más.
 */

export function crearDisenoDeMesa({ db, administradores, campoBorrado }) {
  const ref = () => db.collection("config").doc("mesa");

  /**
   * Guarda lo que venga, y sólo lo que venga.
   *
   * `merge: true` porque el panel puede estar editando una sola de las dos
   * cosas: mandar el documento entero obligaría a que el formulario supiera
   * el valor de la otra, y un formulario a medio cargar la borraría.
   */
  async function guardar(context, datos) {
    await administradores.exigir(context);

    const cambios = {};
    for (const campo of ["brujula", "sala"]) {
      if (!(campo in datos)) continue;
      cambios[campo] = datos[campo] === null ? campoBorrado() : datos[campo];
    }

    // Sin campos no se escribe: un `set({}, {merge:true})` crearía el
    // documento vacío y después «existe pero no dice nada», que es un estado
    // más para que alguien lo interprete.
    if (!Object.keys(cambios).length) return { guardado: false, campos: [] };

    await ref().set(cambios, { merge: true });
    return { guardado: true, campos: Object.keys(cambios) };
  }

  /** Lo que hay guardado, para que el panel muestre lo que ya está puesto. */
  async function leer(context) {
    await administradores.exigir(context);
    const snap = await ref().get();
    return { diseno: snap.exists ? snap.data() : {} };
  }

  return { guardar, leer };
}
