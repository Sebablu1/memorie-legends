/**
 * La receta de conversión de cada tipo del catálogo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ ES ESTO Y QUÉ NO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Una tabla. Dice a qué formato, a qué tamaño y con qué calidad tiene que
 * quedar la imagen de cada tipo. No convierte nada, no lee archivos y no sabe
 * de Storage ni del panel: sólo deja escrito el objetivo, para que el día que
 * haya un conversor no tenga que decidirlo él.
 *
 * Vive en `reglas/` y no en el panel a propósito. El panel es una pantalla;
 * esto es una decisión del juego, y tiene que poder probarse en Node sin
 * navegador —como todo lo de esta carpeta— y leerse igual desde el servidor,
 * que es adonde `copiar-reglas.js` la lleva.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ UNA ENTRADA POR CADA TIPO, INCLUSO LOS QUE NO SON IMÁGENES
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque «no hay receta» es una respuesta, y es distinta de «me olvidé». Un
 * tipo sin entrada se lee igual que uno nuevo que nadie clasificó todavía, y
 * `imagenes-de-catalogo.mjs` no podría distinguirlos.
 *
 * Así que los nueve tipos están, y la `clase` dice qué son:
 *
 *   · `raster`      — se convierte: formato, lado y calidad.
 *   · `vector`      — es SVG, y NO se rasteriza. Rasterizar un vector es
 *                     perder justo lo que lo hace un vector.
 *   · `texto`       — no es una imagen. El título es el texto que va al lado
 *                     del nombre, no una ruta.
 *   · `sin-definir` — el tipo existe en `TIPOS` pero no hay una sola pieza de
 *                     arte dibujada. La receta se decide cuando la haya, no
 *                     antes: inventar medidas para algo que nadie vio es
 *                     escribir un número que después hay que cambiar.
 *
 * Agregar un tipo mañana es agregar un renglón acá. Si alguien se olvida, la
 * suite se pone roja, que es el único motivo por el que la tabla sirve.
 */

import { TIPOS, TIPOS_VALIDOS } from "./catalogo.js";

/** Las cuatro clases. Una entrada es exactamente una de éstas. */
export const CLASES = Object.freeze({
  RASTER: "raster",
  VECTOR: "vector",
  TEXTO: "texto",
  SIN_DEFINIR: "sin-definir",
});

/**
 * Lo más pesado que se acepta de ENTRADA, en megabytes.
 *
 * Ocho entra cómodo para un maestro de 1600×1600 sin pérdida —el más grande
 * que hay hoy pesa 3,8 MB— y corta antes de que alguien arrastre un TIFF de
 * cámara por error. Lo que SALE no lo acota este número sino la receta: un
 * maestro de 8 MB y uno de 2 terminan pesando lo mismo.
 */
export const MAX_ENTRADA_MB = 8;

/**
 * `proporcion`: qué hacer con la forma del dibujo.
 *
 *   · `cuadrada` — el resultado es un cuadrado de `ladoMayor`. Se usa cuando
 *                  el arte YA está pensado para un cuadro cuadrado.
 *   · `nativa`   — se acota el lado mayor a `ladoMayor` y el otro sale solo.
 *                  El dibujo conserva su forma.
 */
export const PROPORCIONES = Object.freeze({ CUADRADA: "cuadrada", NATIVA: "nativa" });

/**
 * La tabla.
 *
 * Los números NO son preferencias: cada uno sale de medir dónde se dibuja esa
 * imagen y multiplicarlo por 3, que es la densidad de un teléfono moderno.
 */
export const RECETAS = Object.freeze({
  /**
   * 512 cuadrados.
   *
   * El lugar más grande donde se ve un avatar es el modal de la tienda, a
   * 320 CSS; en un teléfono de 3× eso son 960 píxeles de verdad. 512 no los
   * cubre —agranda ×1,88— y es a propósito: 768 los cubriría casi enteros y
   * costaría el doble sobre una imagen que ya pesa 80 KB. Se comparó a 3×
   * lado a lado antes de elegirlo.
   *
   * Cuadrado porque los trece bustos están dibujados para llenar un cuadro, y
   * porque los cuatro contenedores circulares del sitio recortan en círculo:
   * un dibujo más ancho que alto perdería las orejas.
   */
  [TIPOS.AVATAR]: {
    clase: CLASES.RASTER,
    formato: "webp",
    ladoMayor: 512,
    proporcion: PROPORCIONES.CUADRADA,
    calidad: 85,
    maxEntradaMb: MAX_ENTRADA_MB,
  },

  /**
   * 256, con la forma que tenga.
   *
   * El render más grande de una insignia en todo el sitio es `.figura-logro`,
   * la vitrina del perfil, a 76 CSS px —60 en móvil—. Los otros tres son
   * 24 px, 1,5em y 1,6em. A 3× el peor caso son 228 píxeles, así que 256 ya
   * sobra. Las seis que hay hoy miden unos 530: las insignias están al revés
   * que los avatares, les sobra tamaño en vez de faltarles.
   *
   * Y NO se cuadran. Sus proporciones van de 0,980 a 1,125, y las tres
   * superficies que las dibujan ya lo contemplan: `.figura-logro` y
   * `.insignia-equipada` usan `object-fit: contain` dentro de cajas
   * cuadradas, y `.insignia-mesa` usa `width: auto` justamente para dejar que
   * la forma sea asunto del dibujo. Forzarlas a cuadrado con relleno
   * transparente achicaría el dibujo en la mesa hasta un 11 % a cambio de un
   * par de números más prolijo.
   */
  [TIPOS.INSIGNIA]: {
    clase: CLASES.RASTER,
    formato: "webp",
    ladoMayor: 256,
    proporcion: PROPORCIONES.NATIVA,
    calidad: 85,
    maxEntradaMb: MAX_ENTRADA_MB,
  },

  /**
   * 894 de alto, que es lo que miden los dos que hay.
   *
   * Ojo con la forma: la carta es una caja `aspect-ratio: 2 / 3` —0,667— y el
   * dorso se dibuja con `object-fit: cover`, así que un dibujo de 0,716 como
   * los actuales PIERDE un poco de los costados. No es un defecto: `cover`
   * evita la franja vacía que dejaría `contain`. Pero significa que un dorso
   * subido con otra proporción pierde más o menos, y que lo importante del
   * dibujo tiene que estar al medio.
   */
  [TIPOS.DORSO]: {
    clase: CLASES.RASTER,
    formato: "webp",
    ladoMayor: 894,
    proporcion: PROPORCIONES.NATIVA,
    calidad: 85,
    maxEntradaMb: MAX_ENTRADA_MB,
  },

  /**
   * Los paños son SVG generados por código: un degradado radial y una capa de
   * ruido, mil bytes cada uno. No se suben y no se rasterizan.
   *
   * Rasterizar uno sería cambiar 1 KB que escala a cualquier pantalla por
   * cientos de kilobytes que se ven bien en una sola. Y el paño es lo que más
   * se mira durante una partida entera.
   */
  [TIPOS.FONDO]: { clase: CLASES.VECTOR, formato: "svg" },

  /** El mazo del centro, por lo mismo: SVG de viewBox 200×300. */
  [TIPOS.MAZO]: { clase: CLASES.VECTOR, formato: "svg" },

  /**
   * El marco del avatar: el tipo existe en `TIPOS` y en la vista del jugador,
   * y no hay UN solo archivo dibujado. Sin arte no hay medida que elegir.
   */
  [TIPOS.MARCO]: { clase: CLASES.SIN_DEFINIR },

  /** El sello: igual que el marco, el tipo está y el arte no. */
  [TIPOS.SELLO]: { clase: CLASES.SIN_DEFINIR },

  /**
   * El título NO es una imagen: es el texto que va al lado del nombre. Está
   * en la tabla para que se lea que fue mirado y descartado, no salteado.
   */
  [TIPOS.TITULO]: { clase: CLASES.TEXTO },
});

/**
 * Las imágenes que decide la CASA, que no son artículos.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ NO ENTRAN EN `TIPOS`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque `TIPOS` es el catálogo, y el catálogo es lo que un jugador compra y
 * posee. Estas dos no se compran, no se equipan y no las ve nadie en la
 * tienda: las pone el administrador y el jugador las encuentra puestas.
 *
 * Y la diferencia no es filosófica, es operativa. `TIPOS_VALIDOS` alimenta el
 * desplegable de artículos del panel y el `z.enum` del servidor: meter la
 * brújula ahí dejaría crear un ARTÍCULO del catálogo de tipo «brujula-mesa»,
 * que es exactamente lo que no tiene que poder pasar.
 *
 * Lo único que comparten con los artículos es cómo se CONVIERTE su imagen, y
 * eso es lo que vive acá. Por eso la receta está en esta tabla y el tipo no
 * está en aquélla.
 */
export const TIPOS_DE_CONFIGURACION = Object.freeze({
  BRUJULA: "brujula-mesa",
  SALA: "fondo-sala",
});

export const RECETAS_DE_CONFIGURACION = Object.freeze({
  /**
   * La brújula del paño: 1024 cuadrados.
   *
   * Medido en la mesa real: con `contain` sobre una caja de 1210×683 en
   * escritorio, la brújula se dibuja a 683×683. 1024 cubre eso con aire para
   * pantallas densas, y es lo mismo que ya declara el SVG de siempre en su
   * `viewBox` de 1000.
   *
   * Cuadrada porque la máscara se ajusta al lado MENOR de la mesa, que en un
   * teléfono es el ancho y en un monitor el alto.
   *
   * Y va como GRABADO: lo que el archivo aporta es la SILUETA, no el color.
   * El color lo pone `.mesa::before` para que se lea sobre cualquier paño —
   * un dorado fijo desaparecía sobre el roble de taberna, que es lo que el
   * diseño actual vino a resolver. En la práctica: lo que importa del WebP es
   * su canal alfa, y un dibujo con relleno opaco de lado a lado se vería como
   * un bloque.
   */
  [TIPOS_DE_CONFIGURACION.BRUJULA]: {
    clase: CLASES.RASTER,
    formato: "webp",
    ladoMayor: 1024,
    proporcion: PROPORCIONES.CUADRADA,
    calidad: 85,
    maxEntradaMb: MAX_ENTRADA_MB,
  },
});

/**
 * La receta de un tipo, sea del catálogo o de la casa.
 *
 * Las dos tablas se consultan por el mismo nombre a propósito: el conversor
 * del panel no tiene por qué saber de cuál de las dos salió lo que le toca
 * convertir.
 */
export const recetaDe = (tipo) =>
  RECETAS[tipo] ?? RECETAS_DE_CONFIGURACION[tipo] ?? null;

/** ¿Una imagen de este tipo se convierte? Sólo las ráster. */
export const seConvierte = (tipo) => recetaDe(tipo)?.clase === CLASES.RASTER;

/** Los tipos que un conversor tiene que saber tratar. */
export const TIPOS_CONVERTIBLES = Object.freeze(TIPOS_VALIDOS.filter(seConvierte));
