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
};

export const TIPOS_VALIDOS = Object.values(TIPOS);

export const esTipoValido = (tipo) => TIPOS_VALIDOS.includes(tipo);

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
  { id: "avatar-rey", tipo: TIPOS.AVATAR, nombre: "El Rey", descripcion: "La figura que corona la baraja.", precio: 0, imagen: "👑", activo: true, orden: 10, metadata: { rareza: "inicial" } },
  { id: "avatar-caballo", tipo: TIPOS.AVATAR, nombre: "El Caballo", descripcion: "Vale cero, y por eso vale tanto.", precio: 150, imagen: "🐴", activo: true, orden: 20, metadata: { rareza: "comun" } },
  { id: "avatar-as", tipo: TIPOS.AVATAR, nombre: "El As", descripcion: "Empezar de nuevo, siempre.", precio: 300, imagen: "🃏", activo: true, orden: 30, metadata: { rareza: "comun" } },
  { id: "avatar-zorro", tipo: TIPOS.AVATAR, nombre: "El Zorro", descripcion: "Para quien corta justo antes de que lo corten.", precio: 800, imagen: "🦊", activo: true, orden: 40, metadata: { rareza: "raro" } },
  { id: "avatar-dragon", tipo: TIPOS.AVATAR, nombre: "El Dragón", descripcion: "Se ve desde la otra punta de la mesa.", precio: 2500, imagen: "🐉", activo: true, orden: 50, metadata: { rareza: "legendario" } },

  // ----------------------------------------------------------- insignias
  { id: "insignia-novato", tipo: TIPOS.INSIGNIA, nombre: "Primera Mano", descripcion: "Jugaste tu primera partida.", precio: 0, imagen: "🌱", activo: true, orden: 10, metadata: { rareza: "inicial" } },
  { id: "insignia-memoria", tipo: TIPOS.INSIGNIA, nombre: "Memoria de Hierro", descripcion: "Para los que no olvidan una carta.", precio: 400, imagen: "🧠", activo: true, orden: 20, metadata: { rareza: "comun" } },
  { id: "insignia-reflejos", tipo: TIPOS.INSIGNIA, nombre: "Reflejos", descripcion: "El primero en tocar, siempre.", precio: 600, imagen: "⚡", activo: true, orden: 30, metadata: { rareza: "raro" } },
  { id: "insignia-corona", tipo: TIPOS.INSIGNIA, nombre: "Corona de Laurel", descripcion: "La que se lleva quien manda en la mesa.", precio: 1800, imagen: "🏆", activo: true, orden: 40, metadata: { rareza: "epico" } },

  // -------------------------------------------------------------- dorsos
  { id: "dorso-azul", tipo: TIPOS.DORSO, nombre: "Dorso Azul", descripcion: "El de siempre.", precio: 0, imagen: "/img/dorsos/dorso-azul.png", activo: true, orden: 10, metadata: { rareza: "inicial" } },
  { id: "dorso-rojo", tipo: TIPOS.DORSO, nombre: "Dorso Rojo", descripcion: "El otro de siempre.", precio: 0, imagen: "/img/dorsos/dorso-rojo.png", activo: true, orden: 20, metadata: { rareza: "inicial" } },
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
