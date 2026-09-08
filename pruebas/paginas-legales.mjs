/**
 * Las tres páginas legales dicen la verdad sobre el sistema.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ UNA PRUEBA PARA UN TEXTO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque estos tres textos hacen AFIRMACIONES DE HECHO sobre el código, y el
 * código cambia. «Los pagos se procesan mediante Xsolla y Mercado Pago» era
 * falso el día que se escribió: el botón de comprar está deshabilitado y la
 * integración es un esqueleto sin credenciales. Un texto legal que promete de
 * más no falla, no rompe ninguna prueba y no lo nota nadie — hasta que lo nota
 * alguien a quien le importa mucho.
 *
 * Así que lo que se comprueba acá no es la redacción sino el ACUERDO entre lo
 * que la página dice y lo que el programa hace. Cuando se habiliten los pagos,
 * esta prueba se pone en rojo y obliga a volver a mirar las tres páginas. Ese
 * es todo el punto.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Y EL HUECO DE LA POLÍTICA DE PRIVACIDAD
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La Ley 18.331 exige identificar al responsable del tratamiento. Ese dato
 * todavía no existe, así que la página lleva un marcador. Un marcador que se
 * publica sin querer como si fuera texto normal es peor que no tener la
 * página: la sección 3 comprueba que, mientras esté, esté DENTRO de un aviso
 * visible y no camuflado entre los párrafos.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  TRAMOS_DE_REPARTO,
  PUNTOS_CAMPEONATO,
  PUNTOS_PARTICIPACION,
  puestosQueCobran,
  repartirPozo,
} from "../public/js/reglas/torneos.js";
import {
  ENTRADA_MINIMA,
  ENTRADA_MAXIMA,
  PASO_DE_ENTRADA,
  MINIMO_PARA_TORNEO,
} from "../public/js/reglas/configuracion.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else {
    fallos++;
    console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : "");
  }
};

const RAIZ = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const leer = (relativo) => readFileSync(join(RAIZ, relativo), "utf8");

const PAGINAS = ["terminos", "privacidad", "seguridad", "reglamento-torneos"];
const html = Object.fromEntries(PAGINAS.map((p) => [p, leer(`public/${p}.html`)]));

// =====================================================================
console.log("\n=== 1. Las tres páginas están enteras y se enlazan entre sí ===");
// =====================================================================

for (const p of PAGINAS) {
  const t = html[p];

  // Etiquetas balanceadas. No es un validador de HTML: es la comprobación
  // mínima que atrapa el error real de editar un documento largo a mano.
  const cuenta = (re) => (t.match(re) ?? []).length;
  ok(cuenta(/<div[\s>]/g) === cuenta(/<\/div>/g), `${p}: los <div> cierran`, {
    abren: cuenta(/<div[\s>]/g),
    cierran: cuenta(/<\/div>/g),
  });
  ok(cuenta(/<p[\s>]/g) === cuenta(/<\/p>/g), `${p}: los <p> cierran`);
  ok(cuenta(/<li>/g) === cuenta(/<\/li>/g), `${p}: los <li> cierran`);

  ok(/<div class="legal-container">/.test(t), `${p}: usa el contenedor legal`);
  ok(/<h1>/.test(t), `${p}: tiene título`);
  ok(/class="actualizado"/.test(t), `${p}: dice cuándo se actualizó`);
}

{
  // Las tres se citan entre sí. Un enlace roto en un texto legal es una
  // referencia a algo que el usuario no puede leer.
  ok(/href="\/seguridad\.html"/.test(html.terminos), "términos enlaza a seguridad");
  ok(/href="\/privacidad\.html"/.test(html.terminos), "términos enlaza a privacidad");
  ok(/href="\/seguridad\.html"/.test(html.privacidad), "privacidad enlaza a seguridad");
  ok(/href="\/privacidad\.html"/.test(html.seguridad), "seguridad enlaza a privacidad");
  ok(/href="\/terminos\.html"/.test(html.seguridad), "seguridad enlaza a términos");
}

{
  // Todo enlace interno tiene que resolver a un archivo que existe.
  const rotos = [];
  for (const p of PAGINAS) {
    for (const m of html[p].matchAll(/href="\/([^"#?]+\.html)"/g)) {
      if (!existsSync(join(RAIZ, "public", m[1]))) rotos.push(`${p} -> /${m[1]}`);
    }
  }
  ok(rotos.length === 0, "ningún enlace interno apunta a una página que no existe", rotos);
}

// =====================================================================
console.log("\n=== 2. Lo que dicen sobre los pagos coincide con el código ===");
// =====================================================================

{
  /**
   * El acoplamiento que importa.
   *
   * Hoy el botón de comprar Leyendas está deshabilitado en `tienda.js` y la
   * integración de pago es un esqueleto —`crearOrdenDeCompra` lo dice en su
   * propia cabecera—, así que las tres páginas llevan un aviso diciendo que la
   * compra no está habilitada.
   *
   * El día que se habilite, ese aviso pasa a ser mentira. Esta prueba obliga a
   * que las dos cosas cambien juntas.
   */
  const tienda = leer("public/js/tienda.js");
  const servidor = leer("functions/index.js");

  const compraDeshabilitada = /data-paquete="\$\{p\.id\}"[^>]*\bdisabled\b/.test(tienda);
  const integracionPendiente = /INTEGRACIÓN PENDIENTE/.test(servidor);

  ok(compraDeshabilitada, "el botón de comprar Leyendas sigue deshabilitado en la tienda");
  ok(integracionPendiente, "y la integración de pago sigue marcada como pendiente");

  if (compraDeshabilitada || integracionPendiente) {
    for (const p of PAGINAS) {
      ok(
        /todavía no está habilitada/.test(html[p]),
        `${p}: avisa que la compra de Leyendas no está habilitada`,
      );
    }
  }
}

// =====================================================================
console.log("\n=== 3. Lo que dicen sobre App Check coincide con el código ===");
// =====================================================================

{
  const servidor = leer("functions/index.js");
  const exige = /const EXIGIR_APP_CHECK = true/.test(servidor);

  ok(!exige, "App Check todavía no bloquea solicitudes (EXIGIR_APP_CHECK = false)");

  if (!exige) {
    ok(
      /App Check está integrado pero todavía no bloquea/.test(html.seguridad),
      "y la página de seguridad lo dice con todas las letras",
    );
  }
}

// =====================================================================
console.log("\n=== 4. El dato que falta no se publica camuflado ===");
// =====================================================================

{
  /**
   * El responsable del tratamiento todavía no está identificado.
   *
   * La Ley 18.331 exige su nombre o razón social y su domicilio, y la página
   * está publicada sin ellos. Eso es una decisión tomada, no un descuido — pero
   * tiene que verse: un hueco silencioso en una política de privacidad es
   * indistinguible de una política que dice tener algo que no tiene.
   *
   * El marcador vive en un comentario del HTML y el aviso en la página. Las dos
   * cosas van juntas o no van: si alguien completa los datos y se olvida de
   * sacar el aviso, la página va a decir que la identificación está en trámite
   * cuando ya no lo está, y esto lo canta.
   */
  const marcador = "MARCADOR: RESPONSABLE SIN COMPLETAR";
  const avisoEnTramite = /Identificación en trámite/.test(html.privacidad);
  const pendiente = html.privacidad.includes(marcador);

  ok(
    pendiente === avisoEnTramite,
    pendiente
      ? "el hueco del responsable está marcado Y avisado en la página"
      : "el responsable está completo, y el aviso de trámite ya no está",
    { marcador: pendiente, aviso: avisoEnTramite },
  );

  if (pendiente) {
    // El aviso tiene que estar en un bloque destacado, no suelto entre
    // párrafos: un párrafo más en una página de treinta secciones no lo lee
    // nadie.
    const i = html.privacidad.indexOf('<div class="aviso">');
    const j = html.privacidad.indexOf("</div>", i);
    ok(
      i !== -1 && html.privacidad.slice(i, j).includes("Identificación en trámite"),
      "y el aviso está en un bloque destacado, no perdido en un párrafo",
    );

    // Y le dice al usuario adónde ir mientras tanto. Sin eso, el hueco lo deja
    // sin saber a quién reclamar, que es justo lo que la ley quiere evitar.
    ok(
      /consulta o ejercicio de derechos/.test(html.privacidad),
      "y dice por dónde ejercer derechos mientras tanto",
    );
  }

  // El marcador de desarrollo original no puede quedar en ninguna página.
  for (const p of PAGINAS) {
    ok(
      !html[p].includes("[COMPLETAR ANTES DE PUBLICAR]"),
      `${p}: no quedó ningún marcador de desarrollo a la vista`,
    );
  }
}

// =====================================================================
console.log("\n=== 5. Las promesas que el juego no puede cumplir ===");
// =====================================================================

{
  /**
   * Tres afirmaciones que NO pueden aparecer, porque contradicen decisiones
   * tomadas: las Leyendas no se cambian por dinero, no se transfieren entre
   * jugadores y no hay premios en efectivo.
   *
   * Se buscan las formas AFIRMATIVAS. Los textos hablan mucho de estas cosas
   * para negarlas —«no pueden canjearse por dinero»— y buscar la palabra suelta
   * daría un falso positivo en cada párrafo.
   *
   * Se busca sobre el TEXTO, con las etiquetas quitadas. Buscar sobre el HTML
   * fallaba: en «no promete <strong>premios en dinero</strong> por participar»
   * el cierre de la etiqueta se mete entre la frase y la palabra que la
   * desactiva, así que la negación quedaba invisible para la expresión.
   */
  const soloTexto = (t) =>
    t
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ");

  const prohibidas = [
    [/\b(canjear|cambiar) (tus )?Leyendas por dinero/gi, "canjear Leyendas por dinero"],
    [/premios? (en (dinero|efectivo)|monetarios?)/gi, "premios en dinero"],
    [/transferir(se)? Leyendas? (a|entre) (otro jugador|otros? usuarios?|jugadores)/gi,
     "transferir Leyendas entre jugadores"],
  ];

  /**
   * ¿La frase viene negada?
   *
   * Se miran los 45 caracteres anteriores en vez de usar una anticipación
   * negativa pegada a la frase. Los textos niegan de muchas formas —«no hay
   * premios en dinero», «no promete premios en dinero», «no pueden canjearse»,
   * «prohibido»— y cada forma mete una cantidad distinta de palabras en el
   * medio. Una anticipación pegada acierta con una y falla con las otras tres,
   * que es exactamente lo que pasó con «No hay premios en dinero».
   */
  const NEGACIONES = /\b(no|sin|nunca|prohibid[ao]s?|jamás)\b/i;
  const vieneNegada = (texto, indice) =>
    NEGACIONES.test(texto.slice(Math.max(0, indice - 45), indice));

  for (const p of PAGINAS) {
    const texto = soloTexto(html[p]);
    for (const [re, que] of prohibidas) {
      re.lastIndex = 0;
      const afirmativas = [...texto.matchAll(re)]
        .filter((m) => !vieneNegada(texto, m.index))
        .map((m) => texto.slice(Math.max(0, m.index - 45), m.index + m[0].length));

      ok(afirmativas.length === 0, `${p}: no promete ${que}`, afirmativas.slice(0, 2));
    }
  }

  // Y la negación explícita sí tiene que estar donde corresponde.
  ok(/no pueden canjearse por dinero/i.test(html.terminos), "términos: dice que no se canjean");
  ok(/cash-out/i.test(html.terminos), "términos: nombra el cash-out para descartarlo");
  ok(
    /no promete/i.test(html.terminos) && /premios en dinero/i.test(html.terminos),
    "términos: dice que no promete premios en dinero",
  );
}

// =====================================================================
console.log("\n=== 6. La fecha de actualización es la misma en las tres ===");
// =====================================================================

{
  const fechas = {};
  for (const p of PAGINAS) {
    const m = html[p].match(/Última actualización: ([^<·]+)/);
    fechas[p] = m ? m[1].trim() : null;
  }

  ok(Object.values(fechas).every(Boolean), "las tres declaran una fecha", fechas);

  const distintas = new Set(Object.values(fechas));
  ok(
    distintas.size === 1,
    "y es la misma: se revisaron juntas, así que se fechan juntas",
    fechas,
  );
}

// =====================================================================
console.log("\n=== 7. El reglamento de torneos dice lo que el motor paga ===");
// =====================================================================

{
  /**
   * La comprobación más importante de este archivo.
   *
   * El reglamento publica una tabla de porcentajes y cuatro ejemplos con
   * números exactos. El jugador la lee ANTES de pagar la entrada, así que si
   * la página dice 50% y el servidor paga 60%, la página es una promesa
   * incumplida y no un error de tipeo.
   *
   * Las dos cosas se comparan de verdad: se saca la tabla del HTML y se
   * enfrenta contra `TRAMOS_DE_REPARTO`. Buscar sólo que los números aparezcan
   * en algún lado de la página no alcanzaría — aparecen muchos números.
   */
  const pagina = leer("public/reglamento-torneos.html");

  for (const tramo of TRAMOS_DE_REPARTO) {
    const hasta = tramo.hasta === Infinity ? "o más" : `a ${tramo.hasta}`;
    const fila = new RegExp(
      `<td>${tramo.desde} ${hasta}</td>\s*<td class="num">${tramo.porcentajes.length}</td>`,
    );
    ok(
      fila.test(pagina),
      `la tabla publica el tramo de ${tramo.desde} ${hasta} con ${tramo.porcentajes.length} puestos`,
    );

    // Y cada porcentaje, en orden, en esa misma fila.
    const i = pagina.search(fila);
    const finDeFila = pagina.indexOf("</tr>", i);
    const textoFila = i === -1 ? "" : pagina.slice(i, finDeFila);
    const publicados = [...textoFila.matchAll(/(\d+)%/g)].map((m) => Number(m[1]));
    const esperados = [...new Set(tramo.porcentajes)];

    ok(
      esperados.every((p) => publicados.includes(p)),
      `  y sus porcentajes (${tramo.porcentajes.join("/")})`,
      publicados,
    );
  }
}

{
  // Los cuatro ejemplos, calculados con el motor y buscados en la página.
  const pagina = leer("public/reglamento-torneos.html");
  const CASOS = [
    { jugadores: 12, entrada: 10 },
    { jugadores: 12, entrada: 25 },
    { jugadores: 20, entrada: 10 },
    { jugadores: 50, entrada: 10 },
  ];

  for (const { jugadores, entrada } of CASOS) {
    const fondo = jugadores * entrada;
    const nombres = Array.from({ length: puestosQueCobran(jugadores) }, (_, i) => `j${i}`);
    const { pagos } = repartirPozo(fondo, nombres, jugadores);

    ok(
      pagina.includes(`${jugadores} × ${entrada} = <strong>${fondo} Leyendas</strong>`),
      `el ejemplo de ${jugadores} jugadores x ${entrada} publica un fondo de ${fondo}`,
    );

    const faltan = pagos.filter((p) => !pagina.includes(`${p.monto} Leyendas`));
    ok(faltan.length === 0, `  y los ${pagos.length} premios que calcula el motor`, faltan);
  }
}

{
  // Los puntos de campeonato.
  const pagina = leer("public/reglamento-torneos.html");
  for (const [puesto, puntos] of Object.entries(PUNTOS_CAMPEONATO)) {
    const orden = ["1.º", "2.º", "3.º", "4.º"][Number(puesto) - 1];
    ok(
      new RegExp(`<td>${orden}</td>\s*<td class="num">${puntos}</td>`).test(pagina),
      `el ${orden} suma ${puntos} puntos de campeonato`,
    );
  }
  ok(
    new RegExp(`<td>5.º en adelante</td>\s*<td class="num">${PUNTOS_PARTICIPACION}</td>`).test(pagina),
    `y del quinto para abajo, ${PUNTOS_PARTICIPACION}`,
  );
}

{
  // El rango de la entrada y el mínimo de jugadores, que viven en
  // `configuracion.js`.
  const pagina = leer("public/reglamento-torneos.html");
  ok(
    pagina.includes(`${ENTRADA_MINIMA} a ${ENTRADA_MAXIMA.toLocaleString("es-UY")} Leyendas`),
    `publica el rango de entrada (${ENTRADA_MINIMA} a ${ENTRADA_MAXIMA})`,
  );
  ok(
    pagina.includes(`múltiplos de ${PASO_DE_ENTRADA}`),
    `y el paso de ${PASO_DE_ENTRADA}`,
  );
  ok(
    new RegExp(`al menos <strong>${MINIMO_PARA_TORNEO} jugadores</strong>`).test(pagina),
    `y el mínimo de ${MINIMO_PARA_TORNEO} jugadores`,
  );
}

{
  // La casa no retiene comisión en los torneos, y la página lo dice.
  const pagina = leer("public/reglamento-torneos.html");
  const suman100 = TRAMOS_DE_REPARTO.every(
    (t) => t.porcentajes.reduce((a, b) => a + b, 0) === 100,
  );
  ok(suman100, "todos los tramos suman 100% en el código");
  if (suman100) {
    ok(
      /el fondo se reparte entero/i.test(pagina) && /no retiene ninguna comisión/i.test(pagina),
      "y la página dice que la casa no retiene nada",
    );
  }
}

console.log(fallos ? `\n❌ ${fallos} fallos` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
