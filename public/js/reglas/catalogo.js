/**
 * El catálogo de personalización: avatares, insignias y dorsos.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ VIVE ACÁ Y QUÉ VIVE EN FIRESTORE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Acá vive la FORMA de un artículo: qué tipos hay, qué campos lleva, qué
 * cuenta como válido y en qué campo del perfil se guarda lo equipado. Es un
 * módulo puro —no toca Firestore ni el DOM— y por eso `copiar-reglas.js` lo
 * lleva al servidor: la validación que corre en el navegador y la que decide
 * de verdad son literalmente el mismo código.
 *
 * En Firestore vive el CATÁLOGO en sí, en la colección `catalogo`. Es la única
 * fuente de verdad de precios y de qué está a la venta, y se administra desde
 * el panel sin desplegar nada. `CATALOGO_INICIAL` de abajo es sólo la semilla
 * de demostración con la que se llena la colección la primera vez.
 *
 * La razón de esa división es el precio. Si el catálogo viviera en un archivo,
 * cambiar un precio sería un despliegue; y si viviera SÓLO en Firestore, no
 * habría dónde escribir qué es un artículo bien formado. Así, el servidor lee
 * el precio de Firestore y lo valida contra estas reglas antes de cobrarlo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL PRECIO NUNCA VIENE DEL NAVEGADOR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `comprarItem` recibe un id y nada más. El precio lo lee el servidor del
 * documento del catálogo, dentro de la misma transacción que descuenta el
 * saldo. Si el precio viajara en la llamada, cualquiera compraría el avatar
 * más caro por una Leyenda desde la consola del navegador.
 */

// ------------------------------------------------------------------ tipos

export const TIPOS = {
  AVATAR: "avatar",
  INSIGNIA: "insignia",
  DORSO: "dorso",

  /**
   * El paño de la mesa: la superficie sobre la que se juega.
   *
   * No es el fondo de la PANTALLA —la sala de piedra con las antorchas se
   * queda como está— sino el óvalo donde caen las cartas. Es lo que en una
   * mesa de verdad sería el tapete, y lo que más se mira durante una
   * partida entera.
   */
  FONDO: "fondo",

  /**
   * El dorso del mazo del centro.
   *
   * No es lo mismo que un DORSO: aquél es el reverso de las cartas que uno
   * tiene en la mano, y de él hay dos alternados para que se distinga de
   * quién es cada mano. Éste es la pila del medio, que no es de nadie y se
   * mira la partida entera.
   *
   * Por eso son tipos distintos y no colores de uno solo: se equipan por
   * separado, se compran por separado, y ponerse uno no cambia el otro.
   */
  MAZO: "mazo",
};

export const TIPOS_VALIDOS = Object.values(TIPOS);

export const esTipoValido = (tipo) => TIPOS_VALIDOS.includes(tipo);

/**
 * Qué se puede comprar con Leyendas.
 *
 * Las insignias NO. Son logros: se ganan jugando, y las otorga el servidor al
 * cerrar una partida o un período de ranking (ver `reglas/insignias.js`).
 *
 * Esto es una lista y no un `precio: null` a propósito. El precio se edita
 * desde el panel de administración, así que un precio es una defensa que un
 * error de tipeo desarma; la lista no está en la base de datos y no se puede
 * editar sin pasar por el código y por las pruebas. Y la comprobación vive en
 * el servidor, donde el cliente no llega: esconder el botón de comprar no es
 * impedir la compra.
 */
export const TIPOS_VENDIBLES = Object.freeze([TIPOS.AVATAR, TIPOS.DORSO, TIPOS.FONDO, TIPOS.MAZO]);

export const esVendible = (tipo) => TIPOS_VENDIBLES.includes(tipo);

/**
 * Piso de precio para los avatares.
 *
 * No es una regla de la compra sino del CATÁLOGO: se comprueba al guardar,
 * que es cuando alguien decide un precio. Comprobarlo al comprar dejaría
 * artículos guardados pero imposibles de comprar, y el jugador vería un error
 * por una decisión que no tomó él.
 *
 * El gratuito de arranque queda exento: es el que trae puesto quien recién
 * llega. Y no se aplica a los dorsos, que arrancan más baratos a propósito.
 */
export const PRECIO_MINIMO_AVATAR = 100;
export const AVATAR_INICIAL = "predeterminado";

/**
 * Cuánto se descuenta al llevar varios avatares de una.
 *
 * El descuento va por CANTIDAD DE ARTÍCULOS NUEVOS, no por lo que se gasta:
 * si dos de los tres ya los tenía, paga uno y sin descuento. Si contara los
 * tres, alcanzaría con meter en el pack algo ya comprado para abaratar lo
 * demás.
 */
export const DESCUENTOS_PACK = Object.freeze({ 1: 0, 2: 0.15, 3: 0.25 });

/** El máximo que entra en un pack. Más que esto es una lista de deseos. */
export const MAXIMO_POR_PACK = 3;

export const descuentoPorCantidad = (cantidad) => DESCUENTOS_PACK[cantidad] ?? 0;

/**
 * Lo que cuesta un pack, redondeado hacia abajo.
 *
 * Recibe la SUMA y la CANTIDAD, no la lista de precios. Podría recibir la
 * lista y sumarla acá, pero entonces el servidor tendría que armar esa lista
 * con un `.map` dentro de la transacción que cobra, y `pruebas/transacciones.mjs`
 * marca —bien— cualquier bucle ahí adentro: es donde vivió un error real que
 * pagaba una devolución por vuelta. Que la firma sea ésta le ahorra al llamador
 * tener que elegir entre un bucle y una auditoría.
 *
 * Hacia abajo y no al más cercano: el redondeo lo paga la casa. Medio entero
 * de diferencia no le cambia el negocio a nadie, y que el total mostrado sea
 * siempre el que se cobra vale más que esa Leyenda.
 */
export function precioDePack(suma, cantidad) {
  return Math.floor(Number(suma) * (1 - descuentoPorCantidad(cantidad)));
}

/**
 * En qué campo del perfil se guarda lo que el jugador tiene puesto.
 *
 * Uno por tipo, y por eso equipar es idempotente por naturaleza: el campo
 * guarda un id, no una lista. Ponerse otro avatar pisa el anterior sin que
 * haya que acordarse de desequipar nada.
 *
 * `avatar` ya existía en el documento del perfil —lo permitían las reglas de
 * Firestore— pero no lo escribía nadie: el tablero muestra la foto de Google,
 * que viene de Auth y no de acá. Se reutiliza ese campo en vez de inventar
 * otro, y a cambio se le quita al cliente el permiso de escribirlo: si pudiera
 * seguir haciéndolo, equiparse un avatar sin comprarlo serían dos líneas en la
 * consola.
 */
export const CAMPO_EQUIPADO = {
  [TIPOS.AVATAR]: "avatar",
  [TIPOS.INSIGNIA]: "insignia",
  [TIPOS.DORSO]: "dorso",

  // `fondo` nace cerrado al navegador sin tocar `firestore.rules`: la regla
  // del perfil es una lista blanca —`hasOnly(['username', 'photoURL'])`— así
  // que todo campo que no esté nombrado ahí ya está prohibido. Es la ventaja
  // de haberla escrito como lista de lo permitido y no de lo negado.
  [TIPOS.FONDO]: "fondo",
  [TIPOS.MAZO]: "mazo",
};

/** Subcolección donde se anota qué compró cada jugador. */
export const COLECCION_CATALOGO = "catalogo";
export const SUBCOLECCION_ITEMS = "items";

// ------------------------------------------------------------ validación

export const PRECIO_MAXIMO = 1_000_000;
export const LARGO_MAXIMO_TEXTO = 400;

/**
 * ¿Este objeto es un artículo bien formado?
 *
 * Devuelve la lista de problemas, vacía si está bien. Se devuelve la lista y
 * no un booleano porque el panel de administración tiene que poder decir QUÉ
 * está mal: "falta el nombre" se arregla, "inválido" no.
 *
 * Corre en los dos lados. En el navegador para avisar antes de mandar; en el
 * servidor porque es el único que decide.
 */
export function problemasDelItem(item) {
  const problemas = [];
  const texto = (v) => typeof v === "string" && v.trim().length > 0;

  if (!texto(item?.id)) problemas.push("Falta el id.");
  else if (!/^[a-z0-9_-]{2,64}$/.test(item.id)) {
    problemas.push("El id sólo admite minúsculas, números, guiones y guiones bajos (2 a 64).");
  }

  if (!esTipoValido(item?.tipo)) {
    problemas.push(`El tipo tiene que ser uno de: ${TIPOS_VALIDOS.join(", ")}.`);
  }

  if (!texto(item?.nombre)) problemas.push("Falta el nombre.");
  else if (item.nombre.length > 80) problemas.push("El nombre no puede pasar de 80 caracteres.");

  if (item?.descripcion != null && String(item.descripcion).length > LARGO_MAXIMO_TEXTO) {
    problemas.push(`La descripción no puede pasar de ${LARGO_MAXIMO_TEXTO} caracteres.`);
  }

  // El precio es lo único que mueve dinero, así que es lo más estricto: entero,
  // no negativo y con techo. Un precio negativo REGALARÍA Leyendas — el mismo
  // `moverLeyendas` que cobra sabría sumar.
  const precio = item?.precio;
  if (!Number.isInteger(precio)) problemas.push("El precio tiene que ser un número entero.");
  else if (precio < 0) problemas.push("El precio no puede ser negativo.");
  else if (precio > PRECIO_MAXIMO) problemas.push(`El precio no puede pasar de ${PRECIO_MAXIMO}.`);
  else if (
    item?.tipo === TIPOS.AVATAR &&
    item?.id !== AVATAR_INICIAL &&
    precio > 0 &&
    precio < PRECIO_MINIMO_AVATAR
  ) {
    problemas.push(`Un avatar no puede costar menos de ${PRECIO_MINIMO_AVATAR} Leyendas.`);
  }

  if (!texto(item?.imagen)) problemas.push("Falta la imagen.");

  if (item?.activo != null && typeof item.activo !== "boolean") {
    problemas.push("`activo` tiene que ser verdadero o falso.");
  }

  if (item?.orden != null && !Number.isInteger(item.orden)) {
    problemas.push("El orden tiene que ser un número entero.");
  }

  return problemas;
}

/**
 * Normaliza un artículo antes de guardarlo.
 *
 * Rellena lo que se puede dar por supuesto —activo, orden, metadata— para que
 * el resto del sistema no tenga que preguntarse si el campo existe. No valida:
 * eso es trabajo de `problemasDelItem`, y quien guarda tiene que llamar a las
 * dos.
 */
export function normalizarItem(item) {
  return {
    id: String(item.id).trim(),
    tipo: item.tipo,
    nombre: String(item.nombre).trim(),
    descripcion: item.descripcion ? String(item.descripcion).trim() : "",
    precio: item.precio,
    imagen: String(item.imagen).trim(),
    activo: item.activo !== false,
    orden: Number.isInteger(item.orden) ? item.orden : 0,
    // Bolsa para lo que venga después —una rareza, un color, un requisito—
    // sin tener que migrar la colección ni tocar este archivo.
    metadata: item.metadata && typeof item.metadata === "object" ? item.metadata : {},
  };
}

// -------------------------------------------------------------- consultas

/** Ordena como se muestra: por `orden` y, a igualdad, alfabético. */
export const ordenarItems = (items) =>
  [...items].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.nombre.localeCompare(b.nombre, "es"));

/** Los de un tipo, ya ordenados. Sólo los activos salvo que se pidan todos. */
export function itemsDeTipo(items, tipo, { incluirInactivos = false } = {}) {
  return ordenarItems(
    items.filter((i) => i.tipo === tipo && (incluirInactivos || i.activo !== false)),
  );
}

export const itemPorId = (items, id) => items.find((i) => i.id === id) ?? null;

/**
 * ¿La imagen es un archivo o un glifo?
 *
 * El catálogo de demostración usa emojis para no inventar veinte PNG que
 * después habría que reemplazar. Cuando el panel permita subir imágenes, el
 * campo va a traer una ruta y esto lo distingue sin que haya que migrar nada:
 * lo que empieza con `/` o con `http` es un archivo, el resto se dibuja como
 * texto.
 */
/**
 * ¿La imagen es un archivo DE ESTE SITIO?
 *
 * Más estricta que `imagenEsArchivo`, y por un motivo concreto: hay un
 * lugar donde la ruta de una imagen deja de ser cosa de quien la mira y
 * pasa a mostrársele a OTRA gente —el retrato de cada jugador en la mesa de
 * una partida por Leyendas, que viaja a los otros tres—.
 *
 * `imagenEsArchivo` acepta `http`, y ahí eso deja de ser inocente: un
 * artículo del catálogo con una URL de otro dominio haría que los cuatro
 * navegadores de la mesa le pidan una imagen a ese servidor, contándole
 * cuatro direcciones IP y cuándo se está jugando. No hace falta que nadie
 * sea malicioso para que pase: alcanza con pegar una URL en el panel.
 *
 * Un artículo así se sigue viendo perfectamente en la tienda y en el
 * inventario de su dueño. Lo único que no hace es viajar a la mesa: ahí cae
 * al retrato de la casa.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LAS DOS BARRAS NO SON UNA RUTA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `//ejemplo.com/cara.png` empieza con `/` y no es una ruta de este sitio:
 * es una URL de protocolo relativo, y el navegador la resuelve contra otro
 * dominio exactamente igual que si dijera `https://`. Comprobar sólo la
 * primera barra dejaba pasar justo el caso que esta función viene a cerrar.
 *
 * Se cerró porque lo encontró `pruebas/retratos-en-red.mjs`, que lo probaba
 * a propósito. No es una hipótesis rebuscada: es la forma más corta de
 * escribir un dominio ajeno.
 */
export const esRutaDelSitio = (imagen) =>
  typeof imagen === "string" && imagen.startsWith("/") && !imagen.startsWith("//");

export const imagenEsArchivo = (imagen) =>
  typeof imagen === "string" && (imagen.startsWith("/") || imagen.startsWith("http"));

// ---------------------------------------------------- semilla de ejemplo

/**
 * El catálogo con el que arranca la colección vacía.
 *
 * Es una DEMOSTRACIÓN: nombres, precios e imágenes están puestos para que la
 * tienda tenga algo que mostrar el primer día y para poder probar el circuito
 * de compra de punta a punta. Todo esto se edita después desde el panel, sin
 * desplegar y sin tocar este archivo.
 *
 * Los dos dorsos apuntan a las imágenes que la mesa YA usa. Es a propósito: un
 * dorso comprable que apunte a un PNG inexistente se ve como una carta rota, y
 * hasta que no haya arte nuevo prefiero vender lo que existe.
 */
export const CATALOGO_INICIAL = [
  // ------------------------------------------------------------ avatares
  //
  // Los trece que hay dibujados, con el nombre que lleva su propio estandarte.
  // Las rutas apuntan al WebP recortado —sin fondo— que genera
  // `herramientas/recortar-fondo.mjs`; el PNG original se conserva al lado
  // como fuente sin pérdida.
  //
  // Los precios van escalonados por rareza: 100 el común, 150 los poco
  // comunes, 300 los raros, 450 los épicos y 600 el legendario. No hay que
  // volver acá para cambiarlos —se editan desde el panel, que es la razón de
  // que el catálogo viva en Firestore—; esto es la semilla, no la verdad.
  { id: "predeterminado", tipo: TIPOS.AVATAR, nombre: "Predeterminado", descripcion: "Con el que todos empiezan.", precio: 0, imagen: "/img/avatar/predeterminado.webp", activo: true, orden: 10, metadata: { rareza: "inicial" } },
  { id: "el_as", tipo: TIPOS.AVATAR, nombre: "El As", descripcion: "Empezar de nuevo, siempre.", precio: 100, imagen: "/img/avatar/el_as.webp", activo: true, orden: 20, metadata: { rareza: "comun" } },
  { id: "el_caballo", tipo: TIPOS.AVATAR, nombre: "El Caballo", descripcion: "Vale cero, y por eso vale tanto.", precio: 150, imagen: "/img/avatar/el_caballo.webp", activo: true, orden: 30, metadata: { rareza: "poco_comun" } },
  { id: "mago", tipo: TIPOS.AVATAR, nombre: "El Mago", descripcion: "Sabe lo que hay antes de darlo vuelta.", precio: 300, imagen: "/img/avatar/mago.webp", activo: true, orden: 40, metadata: { rareza: "raro" } },
  { id: "pirata", tipo: TIPOS.AVATAR, nombre: "El Pirata", descripcion: "Toma lo que necesita y corta.", precio: 300, imagen: "/img/avatar/pirata.webp", activo: true, orden: 50, metadata: { rareza: "raro" } },
  { id: "orco", tipo: TIPOS.AVATAR, nombre: "El Orco", descripcion: "No calcula: arrasa.", precio: 150, imagen: "/img/avatar/orco.webp", activo: true, orden: 60, metadata: { rareza: "poco_comun" } },
  { id: "caballera", tipo: TIPOS.AVATAR, nombre: "La Caballera", descripcion: "Aguanta hasta el último punto.", precio: 300, imagen: "/img/avatar/caballera.webp", activo: true, orden: 70, metadata: { rareza: "raro" } },
  { id: "sacerdotisa", tipo: TIPOS.AVATAR, nombre: "La Sacerdotisa", descripcion: "Ve lo que los demás olvidaron.", precio: 300, imagen: "/img/avatar/sacerdotisa.webp", activo: true, orden: 80, metadata: { rareza: "raro" } },
  { id: "el_zorro", tipo: TIPOS.AVATAR, nombre: "El Zorro", descripcion: "Corta justo antes de que lo corten.", precio: 150, imagen: "/img/avatar/el_zorro.webp", activo: true, orden: 90, metadata: { rareza: "poco_comun" } },
  { id: "asesino", tipo: TIPOS.AVATAR, nombre: "El Asesino", descripcion: "Nadie lo ve venir hasta el descarte.", precio: 300, imagen: "/img/avatar/asesino.webp", activo: true, orden: 100, metadata: { rareza: "raro" } },
  { id: "necromante", tipo: TIPOS.AVATAR, nombre: "El Necromante", descripcion: "Se acuerda de las cartas que ya se fueron.", precio: 450, imagen: "/img/avatar/necromante.webp", activo: true, orden: 110, metadata: { rareza: "epico" } },
  { id: "el_rey", tipo: TIPOS.AVATAR, nombre: "El Rey", descripcion: "La figura que corona la baraja.", precio: 450, imagen: "/img/avatar/el_rey.webp", activo: true, orden: 120, metadata: { rareza: "epico" } },
  { id: "el_dragon", tipo: TIPOS.AVATAR, nombre: "El Dragón", descripcion: "Se ve desde la otra punta de la mesa.", precio: 600, imagen: "/img/avatar/el_dragon.webp", activo: true, orden: 130, metadata: { rareza: "legendario" } },

  // ----------------------------------------------------------- insignias
  //
  // Las seis, en el orden en que se ganan. NO SE VENDEN: `TIPOS_VENDIBLES` no
  // las incluye y el servidor rechaza comprarlas. El precio en cero no es lo
  // que las protege —es sólo lo que hace que el campo no mienta—; la condición
  // de cada una está en `reglas/insignias.js`.
  { id: "novato", tipo: TIPOS.INSIGNIA, nombre: "Novato", descripcion: "Por donde empieza todo el mundo.", precio: 0, imagen: "/img/insignias/novato.webp", activo: true, orden: 10, metadata: { rareza: "inicial" } },
  { id: "aventurero", tipo: TIPOS.INSIGNIA, nombre: "Aventurero", descripcion: "Para quien ya se sentó en varias mesas.", precio: 0, imagen: "/img/insignias/aventurero.webp", activo: true, orden: 20, metadata: { rareza: "comun" } },
  { id: "estratega", tipo: TIPOS.INSIGNIA, nombre: "Estratega", descripcion: "Gana pensando, no adivinando.", precio: 0, imagen: "/img/insignias/estratega.webp", activo: true, orden: 30, metadata: { rareza: "raro" } },
  { id: "heroe", tipo: TIPOS.INSIGNIA, nombre: "Héroe", descripcion: "Remontó una que estaba perdida.", precio: 0, imagen: "/img/insignias/heroe.webp", activo: true, orden: 40, metadata: { rareza: "epico" } },
  { id: "campeon", tipo: TIPOS.INSIGNIA, nombre: "Campeón", descripcion: "Ganó un campeonato entero.", precio: 0, imagen: "/img/insignias/campeon.webp", activo: true, orden: 50, metadata: { rareza: "epico" } },
  { id: "leyenda", tipo: TIPOS.INSIGNIA, nombre: "Leyenda", descripcion: "La que le da el nombre al juego.", precio: 0, imagen: "/img/insignias/leyenda.webp", activo: true, orden: 60, metadata: { rareza: "legendario" } },

  // -------------------------------------------------------------- dorsos
  { id: "dorso_azul", tipo: TIPOS.DORSO, nombre: "Dorso Azul", descripcion: "El de siempre.", precio: 0, imagen: "/img/dorsos/dorso-azul.png", activo: true, orden: 10, metadata: { rareza: "inicial" } },
  { id: "dorso_rojo", tipo: TIPOS.DORSO, nombre: "Dorso Rojo", descripcion: "El otro de siempre.", precio: 80, imagen: "/img/dorsos/dorso-rojo.png", activo: true, orden: 20, metadata: { rareza: "inicial" } },

  // ------------------------------------------------------ paños de mesa
  //
  // Los cuatro son SVG generados: un degradado radial y una capa de ruido,
  // mil bytes cada uno. No hacía falta arte nuevo y tampoco convenía —una
  // foto de fieltro que se vea bien pesa cientos de kilobytes y se descarga
  // justo cuando el jugador espera el reparto—.
  //
  // El de piedra va gratis y es el que la mesa ya usa sin comprar nada:
  // equiparlo no cambia nada de lo que se ve. Está en el catálogo para que
  // quien se probó otro pueda volver, que es exactamente lo que faltaba
  // cuando los avatares no se podían desequipar.
  { id: "pano_piedra", tipo: TIPOS.FONDO, nombre: "Salón de Piedra", descripcion: "La mesa de siempre, fría y sobria.", precio: 0, imagen: "/img/mesa/panos/piedra.svg", activo: true, orden: 10, metadata: { rareza: "inicial" } },
  { id: "pano_fieltro", tipo: TIPOS.FONDO, nombre: "Fieltro Verde", descripcion: "El paño de casino de toda la vida.", precio: 200, imagen: "/img/mesa/panos/fieltro.svg", activo: true, orden: 20, metadata: { rareza: "poco_comun" } },
  { id: "pano_madera", tipo: TIPOS.FONDO, nombre: "Roble de Taberna", descripcion: "Una tabla lustrada por mil partidas.", precio: 300, imagen: "/img/mesa/panos/madera.svg", activo: true, orden: 30, metadata: { rareza: "raro" } },
  { id: "pano_carmesi", tipo: TIPOS.FONDO, nombre: "Terciopelo Carmesí", descripcion: "Para las mesas donde se juega en serio.", precio: 400, imagen: "/img/mesa/panos/carmesi.svg", activo: true, orden: 40, metadata: { rareza: "epico" } },

  // -------------------------------------------------- mazos del centro
  //
  // El gratuito es el dorso azul que la pila del medio ya usaba: equiparlo
  // no cambia nada de lo que se ve, y está para que quien se probó otro
  // pueda volver. Los tres pagos son SVG con la misma rosa de los vientos
  // que lleva grabada el paño, para que el mazo se lea como parte del
  // mueble y no como un naipe apoyado encima.
  { id: "mazo_azul", tipo: TIPOS.MAZO, nombre: "Mazo Azul", descripcion: "El del medio de siempre.", precio: 0, imagen: "/img/dorsos/dorso-azul.png", activo: true, orden: 10, metadata: { rareza: "inicial" } },
  { id: "mazo_real", tipo: TIPOS.MAZO, nombre: "Mazo Real", descripcion: "Azul de medianoche, brújula en oro.", precio: 200, imagen: "/img/mazos/real.svg", activo: true, orden: 20, metadata: { rareza: "poco_comun" } },
  { id: "mazo_esmeralda", tipo: TIPOS.MAZO, nombre: "Mazo Esmeralda", descripcion: "Verde profundo y plata verdosa.", precio: 300, imagen: "/img/mazos/esmeralda.svg", activo: true, orden: 30, metadata: { rareza: "raro" } },
  { id: "mazo_carmesi", tipo: TIPOS.MAZO, nombre: "Mazo Carmesí", descripcion: "El de las mesas donde se juega en serio.", precio: 400, imagen: "/img/mazos/carmesi.svg", activo: true, orden: 40, metadata: { rareza: "epico" } },
];

/**
 * Lo que le toca a una cuenta nueva sin haber comprado nada.
 *
 * Son los artículos de precio cero: el avatar del Rey, la insignia de la
 * primera mano y los dos dorsos que la mesa ya usaba. Existe para que la
 * tienda nunca tenga que mostrar a alguien sin absolutamente nada equipado, y
 * para que "equipar" funcione desde el primer minuto.
 */
export const gratuitos = (items = CATALOGO_INICIAL) => items.filter((i) => i.precio === 0);
