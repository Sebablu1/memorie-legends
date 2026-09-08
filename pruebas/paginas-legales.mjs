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

const PAGINAS = ["terminos", "privacidad", "seguridad"];
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
   * `[COMPLETAR ANTES DE PUBLICAR]` en el responsable del tratamiento.
   *
   * Mientras esté, tiene que estar dentro de un `.aviso`: un bloque con borde
   * y fondo propio que nadie puede confundir con el texto de la política. Un
   * marcador suelto entre párrafos se publica sin que nadie lo vea, y la Ley
   * 18.331 exige justamente ese dato.
   */
  const marcador = "[COMPLETAR ANTES DE PUBLICAR]";
  const presente = html.privacidad.includes(marcador);

  if (!presente) {
    ok(true, "el responsable del tratamiento ya está completo");
  } else {
    // Se recorta el bloque del aviso y se comprueba que el marcador esté
    // adentro. Buscar sólo que las dos cosas aparezcan en la página no
    // alcanzaría: podrían estar en secciones distintas.
    const i = html.privacidad.indexOf('<div class="aviso">');
    const j = html.privacidad.indexOf("</div>", i);
    const dentroDelAviso = i !== -1 && html.privacidad.slice(i, j).includes(marcador);

    ok(dentroDelAviso, "el marcador pendiente está dentro de un aviso visible, no suelto");
    ok(
      /Pendiente de completar antes de publicar/.test(html.privacidad),
      "y el aviso explica que falta completarlo",
    );

    // Y en ningún otro lado.
    const cuantos = html.privacidad.split(marcador).length - 1;
    ok(cuantos === 2, "aparece sólo en ese bloque (nombre y domicilio)", cuantos);

    for (const p of ["terminos", "seguridad"]) {
      ok(!html[p].includes(marcador), `${p}: no arrastra ningún marcador pendiente`);
    }
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
    [/\bpodés? (canjear|cambiar) (tus )?Leyendas por dinero/i, "canjear Leyendas por dinero"],
    [/(?<!no )(?<!no promete )premios? en (dinero|efectivo)(?! por participar)/i, "premios en dinero"],
    [/(?<!no )(?<!no pueden )transferirse? Leyendas? (a|entre) (otro jugador|usuarios)/i,
     "transferir Leyendas entre jugadores"],
  ];

  for (const p of PAGINAS) {
    const texto = soloTexto(html[p]);
    for (const [re, que] of prohibidas) {
      const m = texto.match(re);
      ok(!m, `${p}: no promete ${que}`, m?.[0]);
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

console.log(fallos ? `\n❌ ${fallos} fallos` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
