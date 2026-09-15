/**
 * Economía de Memorie Legends: Leyendas (la moneda del juego), apuestas y paquetes.
 *
 * Módulo puro y determinista (acepta un rng inyectable). No toca Firestore
 * ni el DOM: las mutaciones de saldo tienen que ejecutarse en el servidor.
 */

// ------------------------------------------------------------- entradas

/**
 * Las Leyendas de bienvenida. Una sola vez, al crear la cuenta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ESTE NÚMERO ESTÁ ATADO A `firestore.rules`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La regla `saldoDeBienvenidaValido()` exige que un perfil nuevo se cree con
 * EXACTAMENTE este saldo. Es lo que impide que alguien se cree la cuenta con
 * un millón: el perfil lo escribe el navegador, así que el único control
 * posible es esa comparación.
 *
 * O sea que cambiar este número sin cambiar la regla no sube el regalo: deja
 * a TODO el mundo sin poder registrarse, porque Firestore rechaza la creación
 * del documento. Y al revés también. Por eso hay una prueba
 * —`pruebas/leyendas-iniciales.mjs`— que compara los dos y falla si difieren.
 *
 * Decía 50 y nadie la usaba: `register.js` y `auth.js` tenían cada uno su
 * propio 100 escrito a mano, y la regla pedía 100. Tres copias, una de ellas
 * mintiendo, y la que mentía era justamente la que decía ser la oficial.
 */
export const LEYENDAS_REGISTRO = 100;
export const LEYENDAS_POR_REFERIDO = 25;

/**
 * Hubo un bono diario de 10 Leyendas cada 24 horas. Ya no.
 *
 * Estaba desplegado y era llamable, pero ningún botón lo llamaba: existía
 * entero en el servidor y no existía en el juego. Se eliminó en vez de
 * terminarlo, porque regalar saldo por entrar premia abrir la aplicación y no
 * jugar, que es lo contrario de lo que mide todo el resto de la economía.
 *
 * `MOTIVOS.BONO_DIARIO` también se fue. Si alguien llegó a cobrarlo llamando a
 * la función a mano, su asiento en el libro mayor conserva la cadena
 * `"bono_diario"` y se sigue leyendo igual: los motivos se guardan como texto
 * y nadie los valida contra esta lista al leer.
 */

// ------------------------------------------------------------- entradas

/*
   Acá vivían `NIVELES_APUESTA` y `nivelDeApuesta`: cuatro niveles con nombre
   —Casual, Estándar, Premium, High Roller— y una función para saber en cuál
   caía un importe.

   No los importaba NADIE. Ni una pantalla, ni una función, ni una prueba: se
   buscó en todo el proyecto. Eran de una versión del juego en que las mesas se
   elegían por nivel en vez de por importe, y quedaron exportados después de
   que eso cambiara.

   Se van y no se reemplazan. Lo que hoy decide qué mesas hay es `ENTRADAS`, y
   dos listas de importes —una viva y otra que nadie mira— son la clase de cosa
   que alguien encuentra dentro de un año, cree vigente, y usa. «High Roller»
   además nombra justo lo que los términos y condiciones dicen que esto no es.
*/

/**
 * Multiplicador de puntos de ranking y experiencia según lo apostado.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ESTÁN LAS NUEVE ENTRADAS, Y ESO NO ES DECORATIVO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `bonoDeApuesta` devuelve multiplicador 1 para lo que no encuentre acá. Antes
 * la tabla tenía cuatro filas —10, 50, 100 y 200— y las otras cinco entradas
 * válidas de sala caían a ese 1 por omisión. Entre ellas la de 500, que es la
 * apuesta MÁS ALTA del juego: arriesgar 500 Leyendas sumaba para el ranking lo
 * mismo que arriesgar 5, y la cuarta parte que arriesgar 100.
 *
 * Nadie lo notaba porque no fallaba nada: el ranking se llenaba igual, con los
 * números al revés. Ahora la tabla cubre `ENTRADAS` entera, y
 * `pruebas/ranking-servidor.mjs` comprueba que las dos listas no vuelvan a
 * separarse.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA `exp` ES EL MONTO APOSTADO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Se acumula en la fila del ranking y hoy no la lee nadie: ni la tabla ni el
 * perfil la muestran. Como había que darle un valor a las cinco entradas
 * nuevas, se usa el criterio más simple de explicar —apostaste 200, ganaste
 * 200 de experiencia— en vez de inventar una escala que nadie va a poder
 * justificar después. Los valores viejos (10/30/60/120) no los defendía nada.
 */
export const BONOS_APUESTA = {
  5: { multiplicador: 1, exp: 5 },
  10: { multiplicador: 1, exp: 10 },
  15: { multiplicador: 1, exp: 15 },
  20: { multiplicador: 1, exp: 20 },
  25: { multiplicador: 1, exp: 25 },
  50: { multiplicador: 1, exp: 50 },
  100: { multiplicador: 2, exp: 100 },
  200: { multiplicador: 3, exp: 200 },
  500: { multiplicador: 4, exp: 500 },
};

export const bonoDeApuesta = (apuesta) =>
  BONOS_APUESTA[apuesta] ?? { multiplicador: 1, exp: 0 };

/**
 * Políticas de reparto del pote.
 *
 * ⚠️ `dobleApuesta` es lo que dice la especificación: el ganador cobra
 * apuesta x2. Sólo queda parejo en mesas de 2. Con 3 jugadores la casa
 * retiene el 33% del pote y con 4 el 50%. Si no era la intención, usar
 * `potePleno`: el ganador se lleva todo y la casa no retiene nada.
 */
export const POLITICAS_PAGO = {
  dobleApuesta: (apuesta) => apuesta * 2,
  potePleno: (apuesta, jugadores) => apuesta * jugadores,
};

export const POLITICA_POR_DEFECTO = "dobleApuesta";

/**
 * Reparto de una partida apostada.
 * Devuelve el movimiento de cada jugador y lo que retiene la casa.
 */
export function calcularReparto({ apuesta, jugadores, ganadorId, politica = POLITICA_POR_DEFECTO }) {
  const calcular = POLITICAS_PAGO[politica];
  if (!calcular) throw new Error(`Política de pago desconocida: ${politica}`);

  const cantidad = jugadores.length;
  const pote = apuesta * cantidad;
  const pago = calcular(apuesta, cantidad);

  const movimientos = jugadores.map((j) => ({
    jugadorId: j.id ?? j,
    // Todos pusieron la apuesta; el ganador además cobra el premio.
    delta: (j.id ?? j) === ganadorId ? pago - apuesta : -apuesta,
  }));

  const repartido = movimientos.reduce((s, m) => s + m.delta, 0);

  return {
    pote,
    pago,
    movimientos,
    // Lo que no vuelve a los jugadores se lo queda la casa.
    comisionCasa: -repartido,
    porcentajeCasa: pote ? -repartido / pote : 0,
  };
}

// --------------------------------------------------- premios de ranking

/**
 * Lo que paga el ranking por puesto.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ESTOS TRAMOS PAGAN LEYENDAS Y NADA MÁS
 * ─────────────────────────────────────────────────────────────────────
 *
 * Cada tramo traía su propia insignia —`dorada`, `plateada`, `bronce`,
 * `top10`— y ninguna de las cuatro existía: no estaban en `CONDICIONES`, no
 * estaban en el catálogo, y el servidor las escribía con `arrayUnion` en un
 * campo del perfil que no lee nadie. Cuatro promesas sin destinatario.
 *
 * El ranking sigue pagando por puesto. La única insignia que reparte es
 * `leyenda`, por entrar al top 10 del mes, y la otorga
 * `registrarPuestoMensual` por el mismo camino que las demás:
 * `users/{uid}/items/`.
 */
export const PREMIOS_RANKING = [
  { hasta: 1, leyendas: 100, etiqueta: "🏆 Campeón del período" },
  { hasta: 2, leyendas: 60, etiqueta: "🥈 Segundo puesto" },
  { hasta: 3, leyendas: 30, etiqueta: "🥉 Tercer puesto" },
  { hasta: 10, leyendas: 10, etiqueta: "Top 10" },
  { hasta: 50, leyendas: 5, etiqueta: "Top 50" },
];

/**
 * Cuánto vale ganar cada ranking, en semanas.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ANTES NO EXISTÍA ESTA DISTINCIÓN, Y ESO ERA EL PROBLEMA
 * ─────────────────────────────────────────────────────────────────────
 *
 * `premioPorPuesto` recibía sólo el puesto, y `cerrarPeriodo` la llamaba
 * igual para los tres períodos. El 1º cobraba 500 en el semanal, 500 en el
 * mensual y 500 en el anual.
 *
 * Suena parejo y es lo contrario. El semanal cierra 52 veces al año y el
 * anual una: ganar todas las semanas pagaba 26.000 Leyendas y ganar el año
 * entero, 500. El ranking más difícil del juego era el que menos pagaba, y
 * el semanal emitía 106.600 Leyendas al año él solo, contra un registro que
 * da 100.
 *
 * Ahora la tabla de arriba son los montos SEMANALES —la unidad— y cada
 * período los multiplica. El mensual paga cinco semanas y el anual quince,
 * así que ganar el año es el premio grande y la emisión anual baja de
 * 133.250 a 58.420.
 *
 * ─────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTÁ ACÁ Y NO EN ranking.js, QUE ES DONDE VIVE `PERIODOS`
 * ─────────────────────────────────────────────────────────────────────
 *
 * Porque `ranking.js` ya importa de este archivo —`bonoDeApuesta`— y meter
 * el import de vuelta sería un ciclo. Que las claves de acá sean exactamente
 * las de `PERIODOS` lo comprueba `pruebas/premios-de-ranking.mjs`: es una
 * prueba y no un import, pero falla igual de fuerte si alguien agrega un
 * período de un lado y se olvida del otro.
 */
export const MULTIPLICADOR_DE_PERIODO = Object.freeze({
  semanal: 1,
  mensual: 5,
  anual: 15,
});

/**
 * El multiplicador de un período, o se rompe.
 *
 * No devuelve 1 por defecto a propósito. Un período que esta tabla no conoce
 * es un error de programación, y el defecto silencioso lo pagaría el jugador:
 * el campeón del año cobraría la quinceava parte de lo que le toca y nadie se
 * enteraría, porque un premio que llega no se reclama.
 */
export function multiplicadorDePeriodo(periodo) {
  const multiplicador = MULTIPLICADOR_DE_PERIODO[periodo];
  if (!multiplicador) {
    throw new Error(
      `Período de ranking desconocido: ${JSON.stringify(periodo)}. ` +
        `Los que pagan son ${Object.keys(MULTIPLICADOR_DE_PERIODO).join(", ")}.`,
    );
  }
  return multiplicador;
}

/**
 * Recompensa por puesto en un período. Se cobra sólo el tramo más alto
 * alcanzado: el #1 se lleva su tramo, no el suyo más el del top 10 y el 50.
 *
 * Devuelve también `base` y `multiplicador` para que quien anote el premio
 * pueda decir de dónde salió el número, en vez de dejar un total sin origen.
 */
export function premioPorPuesto(puesto, periodo) {
  const multiplicador = multiplicadorDePeriodo(periodo);
  const tramo = PREMIOS_RANKING.find((p) => puesto <= p.hasta);
  if (!tramo) return null;
  return {
    leyendas: tramo.leyendas * multiplicador,
    etiqueta: tramo.etiqueta,
    base: tramo.leyendas,
    multiplicador,
  };
}

// ------------------------------------------------------------- paquetes

export const MONEDA = "UYU";

/**
 * Los paquetes de Leyendas, y lo que trae cada uno.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ESTO ES LA SEMILLA, NO LA VERDAD
 * ─────────────────────────────────────────────────────────────────────
 *
 * Los paquetes viven en Firestore, en `tienda/packs/items/{id}`, y se
 * administran desde el panel. Esta lista es de dónde salen la primera vez y a
 * qué se vuelve si la colección queda vacía: una tienda sin paquetes no puede
 * cobrar, y "se borró sin querer la colección" no puede ser el fin del
 * negocio.
 *
 * ─────────────────────────────────────────────────────────────────────
 * LO QUE SE COBRA Y LO QUE SE ACREDITA
 * ─────────────────────────────────────────────────────────────────────
 *
 * `precioUYU` es lo que se cobra y sale SIEMPRE del servidor: si viajara en la
 * llamada, el pack más caro costaría un peso desde la consola.
 *
 * `leyendasTotal` NO se guarda como dato de confianza: se calcula con
 * `leyendasDePaquete`. Guardado, dos campos pueden discrepar —base + regalo
 * por un lado, total por otro— y el que discrepa termina acreditándose. Se
 * deriva siempre, y lo que se le acredita al comprador queda congelado en la
 * orden en el momento de comprar.
 */
export const PAQUETES = [
  {
    id: "basico",
    nombre: "Pack Básico",
    precioUYU: 250,
    leyendasBase: 300,
    leyendasRegalo: 50,
    itemsExclusivos: [
      "avatar_iniciado",
    ],
    orden: 10,
    activo: true,
  },
  {
    id: "popular",
    nombre: "Pack Popular",
    precioUYU: 450,
    leyendasBase: 600,
    leyendasRegalo: 150,
    itemsExclusivos: [
      "dorso_viajero",
      "avatar_erudito",
    ],
    orden: 20,
    activo: true,
  },
  {
    id: "premium",
    nombre: "Pack Premium",
    precioUYU: 1000,
    leyendasBase: 1500,
    leyendasRegalo: 500,
    itemsExclusivos: [
      "avatar_soberano",
      "dorso_soberano",
      "pano_terciopelo",
    ],
    orden: 30,
    activo: true,
  },
  {
    id: "elite",
    nombre: "Pack Élite",
    precioUYU: 2500,
    leyendasBase: 5000,
    leyendasRegalo: 2000,
    itemsExclusivos: [
      "avatar_soberano",
      "dorso_soberano",
      "mazo_soberano",
      "pano_soberano",
      "marco_dorado",
      "titulo_elite",
    ],
    orden: 40,
    activo: true,
  },
  {
    /**
     * El más alto lleva TODO lo del Élite, y por eso repite sus ids.
     *
     * Un artículo tiene un solo `packExclusivo` —de dónde SALIÓ— pero un pack
     * puede entregar artículos de otro. Son dos cosas distintas: la marca del
     * artículo dice que no se compra suelto, y la lista del pack dice qué se
     * otorga al acreditar.
     *
     * Sin esa separación, "el ML incluye todo lo del Élite" obligaba a
     * duplicar los seis artículos con otro id, y quien comprara los dos packs
     * terminaba con dos avatares idénticos y distintos.
     */
    id: "ml",
    nombre: "Pack Memorie Legends",
    precioUYU: 5000,
    leyendasBase: 12000,
    leyendasRegalo: 3000,
    itemsExclusivos: [
      "avatar_soberano",
      "dorso_soberano",
      "mazo_soberano",
      "pano_soberano",
      "marco_dorado",
      "titulo_elite",
      "sello_fundador",
      "avatar_leyenda_viva",
    ],
    orden: 50,
    activo: true,
  },
];

export const paquetePorId = (id) => PAQUETES.find((p) => p.id === id) ?? null;

/**
 * Leyendas totales que entrega un paquete, regalo incluido.
 *
 * Se calcula, nunca se lee de un campo guardado. Un `leyendasTotal` escrito
 * en la base puede discrepar de sus dos sumandos —porque alguien editó uno y
 * no el otro— y el que discrepa es el que se acredita.
 */
export const leyendasDePaquete = (paquete) =>
  Math.max(0, Number(paquete?.leyendasBase) || 0) +
  Math.max(0, Number(paquete?.leyendasRegalo) || 0);

/** Precio por Leyenda, para poder mostrar cuál conviene. */
export const precioPorLeyenda = (paquete) => {
  const total = leyendasDePaquete(paquete);
  return total > 0 ? Number(paquete?.precioUYU) / total : Infinity;
};

/**
 * El rango de precios que se acepta desde el panel.
 *
 * ───────────────────────────────────────────────────────────────────
 * POR QUÉ HAY UN RANGO Y NO SÓLO "mayor que cero"
 * ───────────────────────────────────────────────────────────────────
 *
 * Porque los paquetes pasaron a editarse desde el panel, y el precio es lo
 * único que cobra dinero de verdad. Un cero de más o de menos no es un error
 * raro: es EL error de tipeo. Con "mayor que cero" alcanzaba para vender
 * 15.000 Leyendas a $500 sin que nada se quejara.
 *
 * El rango no adivina el precio correcto —no puede— pero descarta el orden
 * de magnitud imposible, que es donde está el daño.
 */
export const PRECIO_MINIMO_PACK = 50;
export const PRECIO_MAXIMO_PACK = 20000;

/** Techos de Leyendas, por lo mismo: descartan el cero de más. */
export const LEYENDAS_MAXIMAS_PACK = 200000;

/** Cuántos artículos puede traer un pack. */
export const MAXIMO_ITEMS_POR_PACK = 20;

/**
 * Qué tiene de malo este paquete. Lista vacía: nada.
 *
 * Corre en los dos lados —en el panel para avisar antes de guardar, y dentro
 * del guardado para decidir— igual que `problemasDelItem`. El panel manda un
 * objeto a una Cloud Function, así que validar sólo en pantalla es no validar.
 */
export function problemasDelPaquete(paquete) {
  const problemas = [];
  const texto = (v) => typeof v === "string" && v.trim().length > 0;

  if (!/^[a-z0-9_-]{2,64}$/.test(String(paquete?.id ?? ""))) {
    problemas.push("El id sólo admite minúsculas, números, guiones y guiones bajos (2 a 64).");
  }

  if (!texto(paquete?.nombre)) problemas.push("Falta el nombre.");
  else if (paquete.nombre.length > 80) problemas.push("El nombre no puede pasar de 80 caracteres.");

  const precio = paquete?.precioUYU;
  if (!Number.isInteger(precio)) {
    problemas.push("El precio tiene que ser un número entero de pesos.");
  } else if (precio < PRECIO_MINIMO_PACK || precio > PRECIO_MAXIMO_PACK) {
    problemas.push(
      `El precio tiene que estar entre ${PRECIO_MINIMO_PACK} y ${PRECIO_MAXIMO_PACK} pesos.`,
    );
  }

  const base = paquete?.leyendasBase;
  if (!Number.isInteger(base) || base < 1 || base > LEYENDAS_MAXIMAS_PACK) {
    problemas.push(`Las Leyendas base tienen que ser un entero de 1 a ${LEYENDAS_MAXIMAS_PACK}.`);
  }

  const regalo = paquete?.leyendasRegalo;
  if (!Number.isInteger(regalo) || regalo < 0 || regalo > LEYENDAS_MAXIMAS_PACK) {
    problemas.push(`El regalo tiene que ser un entero de 0 a ${LEYENDAS_MAXIMAS_PACK}.`);
  }

  const items = paquete?.itemsExclusivos;
  if (items != null) {
    if (!Array.isArray(items)) {
      problemas.push("Los artículos exclusivos tienen que ser una lista.");
    } else if (items.length > MAXIMO_ITEMS_POR_PACK) {
      problemas.push(`Un pack no puede traer más de ${MAXIMO_ITEMS_POR_PACK} artículos.`);
    } else if (items.some((id) => !/^[a-z0-9_-]{2,64}$/.test(String(id ?? "")))) {
      problemas.push("Algún id de artículo exclusivo no tiene forma de id.");
    } else if (new Set(items.map(String)).size !== items.length) {
      problemas.push("Hay un artículo exclusivo repetido.");
    }
  }

  if (paquete?.orden != null && !Number.isInteger(paquete.orden)) {
    problemas.push("El orden tiene que ser un número entero.");
  }

  if (paquete?.activo != null && typeof paquete.activo !== "boolean") {
    problemas.push("El campo `activo` tiene que ser verdadero o falso.");
  }

  return problemas;
}

/** Deja un paquete con la forma exacta que se guarda, sin campos de más. */
export function normalizarPaquete(paquete) {
  const base = Math.trunc(Number(paquete?.leyendasBase) || 0);
  const regalo = Math.trunc(Number(paquete?.leyendasRegalo) || 0);
  return {
    id: String(paquete?.id ?? "").trim(),
    nombre: String(paquete?.nombre ?? "").trim(),
    precioUYU: Math.trunc(Number(paquete?.precioUYU) || 0),
    leyendasBase: base,
    leyendasRegalo: regalo,
    // Se guarda para poder ordenar y mostrar sin recalcular, pero NADIE lo
    // usa para acreditar: eso siempre pasa por `leyendasDePaquete`.
    leyendasTotal: base + regalo,
    itemsExclusivos: Array.isArray(paquete?.itemsExclusivos)
      ? [...new Set(paquete.itemsExclusivos.map((i) => String(i).trim()).filter(Boolean))]
      : [],
    orden: Number.isInteger(paquete?.orden) ? paquete.orden : 0,
    activo: paquete?.activo !== false,
  };
}

/** Los que se muestran en la tienda, en su orden. */
export const paquetesVisibles = (paquetes) =>
  (paquetes ?? [])
    .filter((p) => p?.activo !== false)
    .slice()
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || String(a.id).localeCompare(String(b.id)));

// ---------------------------------------------------------- movimientos

/** Motivos válidos de un movimiento de Leyendas, para auditar el libro mayor. */
export const MOTIVOS = {
  REGISTRO: "registro",
  REFERIDO: "referido",

  /**
   * Lo que se pone para entrar a una mesa.
   *
   * Se llamaba `APUESTA` y escribía `"apuesta"`. Los términos y condiciones
   * dicen que esto no son apuestas —«No son juegos de azar ni apuestas», en el
   * reglamento— y el libro mayor decía lo contrario en cada mano jugada.
   *
   * Los movimientos ya escritos NO se migraron: un libro mayor se corrige con
   * asientos nuevos, no reescribiendo los viejos. Así que la colección tiene
   * las dos palabras, `"apuesta"` hasta septiembre de 2026 y
   * `"entrada_partida"` de ahí en adelante, y cualquier cosa que agrupe por
   * motivo tiene que contar las dos. Nada en el código compara contra este
   * valor —se verificó—, así que el cambio no rompe lógica: sólo cambia lo que
   * se escribe.
   */
  ENTRADA_PARTIDA: "entrada_partida",
  // Sumidero de la casa: no va al pozo ni a otro jugador.
  PENALIZACION_ABANDONO: "penalizacion_abandono",
  PREMIO_PARTIDA: "premio_partida",
  PREMIO_RANKING: "premio_ranking",

  /**
   * Los tres movimientos de un torneo, separados a propósito.
   *
   * Podrían reusar `ENTRADA_PARTIDA` y `PREMIO_PARTIDA`, y sería un error: el
   * libro mayor existe para poder preguntarle "¿en qué se fue el saldo?" y que
   * la respuesta sirva. Con motivos compartidos, la entrada de un torneo y la
   * de una mesa serían indistinguibles, y una devolución de torneo parecería
   * un premio.
   *
   * La devolución es su propio motivo y no un premio negativo porque va en la
   * dirección contraria —acredita— y por un motivo distinto: al jugador no le
   * fue bien, es que el torneo no se jugó.
   */
  TORNEO_ENTRADA: "torneo_entrada",
  TORNEO_PREMIO: "torneo_premio",
  TORNEO_DEVOLUCION: "torneo_devolucion",
  COMPRA: "compra",

  /**
   * Gastar Leyendas en un avatar, una insignia o un dorso.
   *
   * Ocupa el lugar del viejo `TIENDA: "tienda"`, que estaba declarado y no lo
   * usaba nadie. Agregar un motivo nuevo al lado habría dejado dos nombres
   * para lo mismo, y la gracia del libro mayor es poder preguntarle "¿en qué
   * se fue el saldo?" y que la respuesta signifique algo.
   *
   * Se distingue de `COMPRA`, que es al revés: ésa ACREDITA Leyendas pagadas
   * con dinero. Ésta las gasta.
   */
  COMPRA_PERSONALIZACION: "compra_personalizacion",

  /**
   * Le devuelven las Leyendas de un artículo que le sacaron.
   *
   * Lo usa una sola cosa: el administrador quitándole a alguien un artículo
   * del inventario. Quitarlo sin devolver sería quedarse con lo que esa
   * persona pagó, y el libro mayor tiene que poder explicar por qué le
   * volvió el saldo.
   *
   * Es su propio motivo y no `COMPRA_PERSONALIZACION` en negativo, por lo
   * mismo que la devolución de un torneo no es un premio: va en la
   * dirección contraria y por una razón distinta. A la persona no le fue
   * bien ni mal; le sacaron algo.
   */
  DEVOLUCION_ARTICULO: "devolucion_articulo",

  /**
   * Las Leyendas que paga una insignia al ganarse.
   *
   * Es su propio motivo y no `PREMIO_PARTIDA`: el premio de una partida sale
   * del pozo que pusieron los jugadores —redistribuye— y esto lo emite la
   * casa —crea—. Con un motivo compartido, el libro mayor no podría
   * responder cuántas Leyendas se emitieron, que es justo lo que hay que
   * poder vigilar cuando las Leyendas también se compran con dinero.
   */
  PREMIO_LOGRO: "premio_logro",
};
