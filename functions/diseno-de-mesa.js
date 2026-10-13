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

import { documentoDeMesa } from "./reglas/salas.js";

export function crearDisenoDeMesa({ db, administradores, campoBorrado }) {
  /*
   * El documento del contexto, o el global.
   *
   * `documentoDeMesa` vive en las reglas y lo usan los tres: la mesa que
   * lee, el panel que escribe y esto. Un contexto desconocido —o ninguno—
   * cae al global, que es el que escribía el panel antes de que hubiera
   * contextos. Así lo ya guardado sigue valiendo sin migrar nada.
   */
  const ref = (contexto) => db.collection("config").doc(documentoDeMesa(contexto));

  /**
   * Guarda lo que venga, y sólo lo que venga.
   *
   * `merge: true` porque el panel puede estar editando una sola de las dos
   * cosas: mandar el documento entero obligaría a que el formulario supiera
   * el valor de la otra, y un formulario a medio cargar la borraría.
   */
  async function guardar(context, { contexto, ...datos }) {
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

    await ref(contexto).set(cambios, { merge: true });
    return { guardado: true, campos: Object.keys(cambios), documento: documentoDeMesa(contexto) };
  }

  /**
   * Lo que hay guardado, para que el panel muestre lo que ya está puesto.
   *
   * Son TRES estados, no dos, y se informan con dos banderas porque por el
   * diseño no se distinguen:
   *
   *   propio: true                 tiene su documento. Lo que se ve es de
   *                                esta mesa y no hereda nada.
   *   propio: false, heredado      no tiene el suyo: lo que se ve es la
   *                                configuración general, prestada.
   *   los dos en false             no hay nada guardado en ningún lado.
   *
   * El tercero es el estado de producción de hoy, y es el que obliga a
   * mandar `propio` además del diseño: un documento propio VACÍO —la forma
   * de decir «esta mesa usa la de siempre y no hereda la general»— llega con
   * el mismo `{}` que no tener nada. Sin la bandera, el panel tiene que
   * adivinar, y adivina mal: diría «tiene su propia configuración» sobre una
   * base vacía.
   */
  async function leer(context, { contexto } = {}) {
    await administradores.exigir(context);

    const suyo = await ref(contexto).get();
    if (suyo.exists) return { diseno: suyo.data(), propio: true, heredado: false };

    const general = await ref(undefined).get();
    return {
      diseno: general.exists ? general.data() : {},
      propio: false,
      heredado: general.exists,
    };
  }

  return { guardar, leer };
}
