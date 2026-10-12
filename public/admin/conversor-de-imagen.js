/**
 * Convierte una imagen a lo que dice la tabla, y te la descarga.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NO SUBE NADA, Y ES LA DECISIÓN QUE DEFINE ESTA ETAPA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * El archivo convertido se descarga a la máquina del administrador, que lo
 * pone en `public/img/…` y despliega. Nada viaja a ningún servidor.
 *
 * Suena a medias tintas y no lo es. Hosting sirve archivos inmutables
 * desplegados: subir en caliente obliga a meter Firebase Storage, con sus
 * reglas, su CORS, su costo y un catálogo partido en dos —unas imágenes desde
 * `/img/…` y otras desde una URL de Storage—. El catálogo cambia unas pocas
 * veces al año. Esto da la parte que de verdad cuesta —acertarle al formato,
 * al tamaño y al recorte— sin ninguna de esas consecuencias.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA MEDIDA NO SE ELIGE ACÁ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Sale de `reglas/imagenes-de-catalogo.js`, la tabla que dice qué le
 * corresponde a cada tipo. Esta pantalla sólo la lee. Si mañana se agrega un
 * tipo, se agrega un renglón allá y acá no se toca nada.
 *
 * Y el recorte del fondo sale de `modulos/recorte-de-fondo.js`, que es el
 * mismo algoritmo con el que se recortaron los trece avatares que ya están en
 * producción.
 */

import { recetaDe, seConvierte, PROPORCIONES } from "../js/reglas/imagenes-de-catalogo.js";
import { quitarFondoBlanco } from "../js/modulos/recorte-de-fondo.js";

// =====================================================================
// La aritmética, sin DOM: se prueba en Node
// =====================================================================

/**
 * Qué medidas tiene que tener la salida.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NUNCA AGRANDA
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Si el original es más chico que lo que pide la receta, se deja como está.
 * Llevar un dibujo de 300 px a 512 no agrega detalle: inventa píxeles y
 * además engorda el archivo, o sea que paga de las dos formas. Que entre
 * chico es un problema del arte, y lo correcto es decirlo —la pantalla lo
 * avisa— en vez de taparlo con una interpolación.
 *
 * @param {{ancho: number, alto: number}} origen
 * @param {object} receta  una entrada de RECETAS, de clase `raster`
 */
export function medidasDeSalida(origen, receta) {
  const { ancho, alto } = origen;
  if (!(ancho > 0) || !(alto > 0)) return null;

  const tope = receta.ladoMayor;

  if (receta.proporcion === PROPORCIONES.CUADRADA) {
    // Cuadrado: manda el lado MENOR, porque el dibujo se recorta al centro
    // para llenar el cuadro. Usar el mayor dejaría franjas vacías.
    const lado = Math.min(tope, Math.min(ancho, alto));
    return { ancho: lado, alto: lado, recorta: ancho !== alto };
  }

  const mayor = Math.max(ancho, alto);
  if (mayor <= tope) return { ancho, alto, recorta: false };

  const escala = tope / mayor;
  return {
    ancho: Math.max(1, Math.round(ancho * escala)),
    alto: Math.max(1, Math.round(alto * escala)),
    recorta: false,
  };
}

/**
 * El nombre del archivo que se descarga.
 *
 * El id del artículo y la extensión de su receta, sin excepciones. Es lo que
 * hace que el archivo descargado se pueda arrastrar a `public/img/…` y que la
 * ruta del catálogo le acierte sin tener que renombrar nada a mano — que es
 * exactamente donde se cuelan los errores que después hay que buscar en
 * Firestore.
 */
export function nombreDeSalida(id, receta) {
  const limpio = String(id ?? "").trim();
  if (!limpio || !receta?.formato) return null;
  return `${limpio}.${receta.formato}`;
}

/** Los tipos de archivo que se aceptan de entrada. */
export const ENTRADAS_VALIDAS = Object.freeze(["image/png", "image/jpeg", "image/webp"]);

/**
 * ¿Este archivo se puede convertir? Devuelve el motivo si no.
 *
 * Se mira el `type` y el peso, que es todo lo que se puede saber antes de
 * decodificar. Lo que no se puede saber acá —si el PNG está roto— lo dice el
 * `onerror` de la imagen, más abajo.
 */
export function problemaDelArchivo(archivo, receta) {
  if (!archivo) return "No elegiste ningún archivo.";
  if (!ENTRADAS_VALIDAS.includes(archivo.type)) {
    return `Sólo PNG, JPG o WebP. Ése es ${archivo.type || "de tipo desconocido"}.`;
  }
  const maxBytes = receta.maxEntradaMb * 1024 * 1024;
  if (archivo.size > maxBytes) {
    const mb = (archivo.size / 1048576).toFixed(1);
    return `Pesa ${mb} MB y el tope es ${receta.maxEntradaMb}.`;
  }
  return null;
}

// =====================================================================
// La conversión, con lienzo
// =====================================================================

/**
 * Baja de tamaño en pasos de mitad.
 *
 * De 1600 a 512 de un saque, el remuestreo del navegador aliasea los bordes
 * finos: los mechones de pelo, el filo de una espada. Bajando de a mitades y
 * recién al final al tamaño exacto, cada paso promedia poco y el resultado
 * queda limpio. Es lo mismo que hace `herramientas/imagenes.mjs`.
 */
function dibujarEnPasos(origen, anchoFinal, altoFinal) {
  let actual = origen;
  let an = origen.width ?? origen.naturalWidth;
  let al = origen.height ?? origen.naturalHeight;

  while (an / 2 > anchoFinal && al / 2 > altoFinal) {
    an = Math.max(1, Math.round(an / 2));
    al = Math.max(1, Math.round(al / 2));
    const paso = document.createElement("canvas");
    paso.width = an;
    paso.height = al;
    const cx = paso.getContext("2d");
    cx.imageSmoothingQuality = "high";
    cx.drawImage(actual, 0, 0, an, al);
    actual = paso;
  }
  return actual;
}

/**
 * Convierte una imagen ya cargada y devuelve el Blob listo.
 *
 * @param {HTMLImageElement} imagen
 * @param {object} receta
 * @param {object} [opciones]
 * @param {boolean} [opciones.quitarFondo]
 * @returns {Promise<{blob: Blob, ancho: number, alto: number, recorte: object|null}>}
 */
export async function convertir(imagen, receta, { quitarFondo = false } = {}) {
  const origen = { ancho: imagen.naturalWidth, alto: imagen.naturalHeight };
  const destino = medidasDeSalida(origen, receta);
  if (!destino) throw new Error("La imagen no tiene medidas válidas.");

  const lienzo = document.createElement("canvas");
  lienzo.width = destino.ancho;
  lienzo.height = destino.alto;
  // `willReadFrequently` porque el recorte lee el cuadro entero: sin esto el
  // navegador deja el lienzo en la placa y cada lectura lo baja a memoria.
  const ctx = lienzo.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";

  if (destino.recorta) {
    // Cuadrado desde un original que no lo es: se toma el cuadrado del CENTRO.
    // Encajarlo con franjas transparentes sería lo otro, y para un avatar es
    // peor: los contenedores circulares del sitio recortan igual, así que las
    // franjas sólo achicarían la cara.
    const lado = Math.min(origen.ancho, origen.alto);
    const x = Math.round((origen.ancho - lado) / 2);
    const y = Math.round((origen.alto - lado) / 2);
    ctx.drawImage(imagen, x, y, lado, lado, 0, 0, destino.ancho, destino.alto);
  } else {
    const reducida = dibujarEnPasos(imagen, destino.ancho, destino.alto);
    ctx.drawImage(reducida, 0, 0, destino.ancho, destino.alto);
  }

  let recorte = null;
  if (quitarFondo) {
    const cuadro = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
    recorte = quitarFondoBlanco(cuadro);
    ctx.putImageData(cuadro, 0, 0);
  }

  const blob = await new Promise((listo) =>
    lienzo.toBlob(listo, `image/${receta.formato}`, receta.calidad / 100),
  );
  if (!blob) throw new Error("El navegador no pudo codificar la imagen.");

  return { blob, ancho: lienzo.width, alto: lienzo.height, recorte };
}

// =====================================================================
// La pantalla
// =====================================================================

const $ = (id) => document.getElementById(id);

/**
 * Enciende el conversor dentro del formulario del catálogo.
 *
 * @param {object} api
 * @param {() => string} api.tipoActual  qué tipo está elegido en el formulario
 * @param {() => string} api.idActual    el id del artículo que se está editando
 * @returns {{alCambiarDeTipo: Function}} para que el formulario avise
 */
export function montarConversor({ tipoActual, idActual }) {
  const caja = $("conversorImagen");
  if (!caja) return { alCambiarDeTipo: () => {} };

  const entrada = $("conversorArchivo");
  const zona = $("conversorZona");
  const casilla = $("conversorQuitarFondo");
  const campoFondo = $("conversorCampoFondo");
  const aviso = $("conversorAviso");
  const vista = $("conversorVista");
  const boton = $("conversorDescargar");

  /** Lo último convertido, para que el botón tenga qué bajar. */
  let listo = null;

  const decir = (texto, clase = "") => {
    aviso.textContent = texto;
    aviso.className = `nota-campo ${clase}`.trim();
  };

  const limpiar = () => {
    listo = null;
    boton.disabled = true;
    vista.removeAttribute("src");
    vista.hidden = true;
  };

  /**
   * La receta manda sobre toda la pantalla.
   *
   * Un tipo que no se convierte —un paño, que es SVG; un título, que es
   * texto— no esconde el bloque: lo apaga y dice por qué. Esconderlo haría
   * que el administrador creyera que la función no existe.
   */
  const alCambiarDeTipo = () => {
    const tipo = tipoActual();
    const receta = recetaDe(tipo);
    limpiar();

    if (!seConvierte(tipo)) {
      caja.classList.add("apagado");
      entrada.disabled = true;
      const porque =
        receta?.clase === "vector" ? "es un SVG y no se rasteriza"
        : receta?.clase === "texto" ? "no es una imagen"
        : "todavía no tiene medidas definidas";
      decir(`Los artículos de tipo «${tipo}» no se convierten acá: ${porque}.`);
      return;
    }

    caja.classList.remove("apagado");
    entrada.disabled = false;

    // El recorte de fondo se ofrece sólo donde tiene sentido. Un dorso de
    // carta es un rectángulo lleno: inundarlo desde los bordes le comería la
    // cara si el dibujo fuera claro.
    const ofreceFondo = tipo === "avatar" || tipo === "insignia";
    campoFondo.hidden = !ofreceFondo;
    if (!ofreceFondo) casilla.checked = false;

    const forma =
      receta.proporcion === PROPORCIONES.CUADRADA
        ? `${receta.ladoMayor}×${receta.ladoMayor}, recortado al centro`
        : `lado mayor ${receta.ladoMayor}, con la proporción del dibujo`;
    decir(`Va a quedar en ${receta.formato.toUpperCase()}, ${forma}. Máximo ${receta.maxEntradaMb} MB de entrada.`);
  };

  async function tomar(archivo) {
    const tipo = tipoActual();
    const receta = recetaDe(tipo);
    if (!receta || !seConvierte(tipo)) return;

    limpiar();

    const problema = problemaDelArchivo(archivo, receta);
    if (problema) {
      decir(problema, "mal");
      return;
    }

    const id = idActual();
    const nombre = nombreDeSalida(id, receta);
    if (!nombre) {
      decir("Poné primero el id del artículo: es el nombre con el que se descarga.", "mal");
      return;
    }

    decir("Convirtiendo…");

    const url = URL.createObjectURL(archivo);
    try {
      const imagen = new Image();
      await new Promise((ok, mal) => {
        // `onload` y no `decode()`: con PNG grandes, `decode` rechaza en
        // algunos navegadores con «the source image cannot be decoded»
        // mientras que `onload` los carga sin problema.
        imagen.onload = ok;
        imagen.onerror = () => mal(new Error("No se pudo leer la imagen."));
        imagen.src = url;
      });

      const origen = { ancho: imagen.naturalWidth, alto: imagen.naturalHeight };
      const salida = await convertir(imagen, receta, { quitarFondo: casilla.checked });

      listo = { blob: salida.blob, nombre };
      boton.disabled = false;
      boton.textContent = `Descargar ${nombre}`;
      vista.src = URL.createObjectURL(salida.blob);
      vista.hidden = false;

      const partes = [
        `${origen.ancho}×${origen.alto} → ${salida.ancho}×${salida.alto}`,
        `${(salida.blob.size / 1024).toFixed(1)} KB`,
      ];
      if (salida.recorte) {
        const porcentaje = Math.round((salida.recorte.borrados / salida.recorte.total) * 100);
        // Un 0 % casi siempre significa que la imagen no tenía fondo blanco, y
        // decirlo evita que alguien descargue y despliegue un recorte que no
        // recortó nada.
        partes.push(porcentaje === 0 ? "sin fondo blanco que sacar" : `fondo ${porcentaje}%`);
      }
      if (salida.ancho < receta.ladoMayor) {
        partes.push(`el original entró chico: NO se agrandó a ${receta.ladoMayor}`);
      }
      decir(partes.join(" · "), "bien");
    } catch (error) {
      console.error("No se pudo convertir la imagen:", error);
      decir(error?.message ?? "No se pudo convertir la imagen.", "mal");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  entrada.addEventListener("change", () => tomar(entrada.files?.[0]));

  // Arrastrar y soltar. `dragover` necesita su `preventDefault` o el navegador
  // abre el archivo en una pestaña, que es la forma más rápida de perder el
  // formulario a medio llenar.
  zona.addEventListener("dragover", (e) => {
    e.preventDefault();
    zona.classList.add("encima");
  });
  zona.addEventListener("dragleave", () => zona.classList.remove("encima"));
  zona.addEventListener("drop", (e) => {
    e.preventDefault();
    zona.classList.remove("encima");
    tomar(e.dataTransfer?.files?.[0]);
  });

  // Marcar o desmarcar el recorte vuelve a convertir el MISMO archivo: así se
  // compara con y sin fondo sin tener que volver a elegirlo.
  casilla.addEventListener("change", () => {
    if (entrada.files?.[0]) tomar(entrada.files[0]);
  });

  boton.addEventListener("click", () => {
    if (!listo) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(listo.blob);
    a.download = listo.nombre;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  alCambiarDeTipo();
  return { alCambiarDeTipo };
}
