/**
 * Nadie promete una insignia que no existe.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE HABÍA ROTO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Había DOS sistemas de insignias que no se hablaban.
 *
 * El que anda: los seis ids de `CONDICIONES`, que están en el catálogo, que
 * se otorgan con `tienda.otorgar` a `users/{uid}/items/{id}`, y que lee
 * `misInsignias` para dibujar la vitrina.
 *
 * El que no andaba: cinco ids más —`dorada`, `plateada`, `bronce`, `top10` y
 * `comprador-elite`— que el servidor escribía con `arrayUnion` en
 * `users/{uid}.insignias`, un campo del perfil que no lee ninguna función ni
 * ninguna pantalla, y que no existían en ningún catálogo.
 *
 * El peor de los cinco costaba dinero de verdad: el Pack Élite vale $1000, la
 * tienda decía «🏆 Incluye insignia», y lo que el comprador recibía era una
 * escritura en un campo muerto.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTA SUITE MIRA EL CÓDIGO FUENTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Porque lo que hay que impedir es que ALGUIEN VUELVA A ESCRIBIR eso, y el
 * error no se manifiesta como una excepción: `arrayUnion` sobre un campo que
 * nadie lee funciona perfectamente. No falla nada. No hay registro. Sólo que
 * el jugador no recibe lo que pagó.
 *
 * Una prueba de comportamiento no lo agarra —no hay comportamiento— así que
 * lo que se vigila es la forma: que no quede ninguna escritura a ese campo, y
 * que ninguna promesa de insignia apunte fuera del catálogo.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PAQUETES,
  PREMIOS_RANKING,
  premioPorPuesto,
  leyendasDePaquete,
  precioPorLeyenda,
  MOTIVOS,
} from "../public/js/reglas/economia.js";
import { CONDICIONES, IDS_INSIGNIAS, leyendasDeInsignia } from "../public/js/reglas/insignias.js";
import {
  CATALOGO_INICIAL,
  TIPOS,
  seCompraConLeyendas,
  normalizarItem,
} from "../public/js/reglas/catalogo.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (...partes) => readFileSync(join(raiz, ...partes), "utf8");

let fallos = 0;
const ok = (condicion, mensaje, extra) => {
  if (condicion) {
    console.log(`  ✓ ${mensaje}`);
  } else {
    fallos++;
    console.log(`  ✗ ${mensaje}${extra === undefined ? "" : ` ${JSON.stringify(extra)}`}`);
  }
};

// =====================================================================
console.log("\n=== 1. Los paquetes dan Leyendas, y nada más ===");
// =====================================================================

{
  const conInsignia = PAQUETES.filter((p) => p.insignia);
  ok(conInsignia.length === 0,
     "ningún paquete promete una insignia",
     conInsignia.map((p) => `${p.id}→${p.insignia}`));

  // Y siguen siendo paquetes: esto no los vació de contenido.
  ok(PAQUETES.length === 5, "los cinco paquetes están", PAQUETES.length);
  ok(PAQUETES.every((p) => p.leyendasBase > 0 && p.precioUYU > 0),
     "todos con sus Leyendas y su precio");
}

{
  /**
   * La tabla acordada, escrita a mano.
   *
   * A mano y no derivada del módulo: derivada diría "los paquetes son los que
   * dice el archivo", que es una tautología. Esto es un precio de venta al
   * público y un cero de más se cobra de verdad.
   */
  const ACORDADO = {
    basico:  { precioUYU: 250,  leyendasBase: 300,   leyendasRegalo: 50,   items: 1 },
    popular: { precioUYU: 450,  leyendasBase: 600,   leyendasRegalo: 150,  items: 2 },
    premium: { precioUYU: 1000, leyendasBase: 1500,  leyendasRegalo: 500,  items: 3 },
    elite:   { precioUYU: 2500, leyendasBase: 5000,  leyendasRegalo: 2000, items: 6 },
    ml:      { precioUYU: 5000, leyendasBase: 12000, leyendasRegalo: 3000, items: 8 },
  };

  for (const [id, esperado] of Object.entries(ACORDADO)) {
    const p = PAQUETES.find((x) => x.id === id);
    ok(Boolean(p), `existe el pack ${id}`);
    if (!p) continue;
    ok(p.precioUYU === esperado.precioUYU, `  ${id} cuesta ${esperado.precioUYU}`, p.precioUYU);
    ok(p.leyendasBase === esperado.leyendasBase, `  y da ${esperado.leyendasBase} de base`, p.leyendasBase);
    ok(p.leyendasRegalo === esperado.leyendasRegalo, `  más ${esperado.leyendasRegalo} de regalo`, p.leyendasRegalo);
    ok(p.itemsExclusivos.length === esperado.items, `  y trae ${esperado.items} artículos`, p.itemsExclusivos.length);
  }

  ok(!PAQUETES.some((p) => p.precioUYU === 100), "el Básico viejo de $100 ya no está");

  // El total se calcula, nunca se lee de un campo guardado: dos campos que
  // dicen lo mismo terminan discrepando, y el que discrepa se acredita.
  for (const p of PAQUETES) {
    ok(leyendasDePaquete(p) === p.leyendasBase + p.leyendasRegalo,
       `  el total de ${p.id} sale de la suma`, leyendasDePaquete(p));
  }

  /**
   * Y cada escalón rinde mejor que el anterior.
   *
   * Si un pack más caro diera peor precio por Leyenda, el cartel de "mejor
   * valor" caería en uno del medio y el más caro no tendría razón de existir.
   * Es la clase de error que se cuela al retocar un precio suelto.
   */
  const porPrecio = PAQUETES.slice().sort((a, b) => a.precioUYU - b.precioUYU);
  const torcidos = [];
  for (let i = 1; i < porPrecio.length; i++) {
    if (precioPorLeyenda(porPrecio[i]) >= precioPorLeyenda(porPrecio[i - 1])) {
      torcidos.push(`${porPrecio[i].id} no mejora a ${porPrecio[i - 1].id}`);
    }
  }
  ok(torcidos.length === 0, "cada pack más caro rinde mejor por Leyenda", torcidos);
}

{
  /**
   * Lo que promete un pack tiene que existir en el catálogo.
   *
   * Es LA regla que se rompió con `comprador-elite`: el pack prometía un id
   * que no estaba en ningún catálogo, así que nadie lo recibía nunca y nada
   * fallaba. `tienda.otorgar` tira `not-found` sobre un id que no existe, y eso
   * pasaría DESPUÉS del pago.
   */
  const enCatalogo = new Set(CATALOGO_INICIAL.map((i) => i.id));

  for (const p of PAQUETES) {
    const faltan = p.itemsExclusivos.filter((id) => !enCatalogo.has(id));
    ok(faltan.length === 0, `todo lo que promete ${p.id} está en el catálogo`, faltan);
  }

  // Y nada de lo que trae un pack se puede comprar suelto con Leyendas.
  const prometidos = new Set(PAQUETES.flatMap((p) => p.itemsExclusivos));
  const comprables = CATALOGO_INICIAL.filter((i) => prometidos.has(i.id) && seCompraConLeyendas(i));
  ok(comprables.length === 0,
     "y nada de eso se vende suelto en la tienda",
     comprables.map((i) => i.id));

  // Ninguna insignia entre lo que trae un pack: los logros se ganan jugando.
  const insignias = CATALOGO_INICIAL.filter((i) => prometidos.has(i.id) && i.tipo === TIPOS.INSIGNIA);
  ok(insignias.length === 0, "y ningún pack reparte insignias", insignias.map((i) => i.id));
}

{
  // Y la tienda no lo anuncia. El cartel era la parte cara del error: sin él,
  // el campo muerto no le prometía nada a nadie.
  const tienda = leer("public", "js", "tienda.js");
  ok(!/Incluye insignia/.test(tienda), "la tienda no dice «Incluye insignia»");
  ok(!/p\.insignia/.test(tienda), "ni lee el campo para decidir qué mostrar");
}

// =====================================================================
console.log("\n=== 2. El ranking paga Leyendas; la insignia es una sola ===");
// =====================================================================

{
  const conInsignia = PREMIOS_RANKING.filter((p) => p.insignia);
  ok(conInsignia.length === 0,
     "ningún tramo del ranking reparte insignias",
     conInsignia.map((p) => `hasta ${p.hasta}→${p.insignia}`));

  // Los premios en Leyendas no se tocaron: era lo único que funcionaba.
  ok(premioPorPuesto(1)?.leyendas === 500, "el primero sigue cobrando 500");
  ok(premioPorPuesto(10)?.leyendas === 50, "el décimo, 50");
  ok(premioPorPuesto(50)?.leyendas === 20, "y el quincuagésimo, 20");
  ok(premioPorPuesto(51) === null, "del 51 para abajo no hay premio");

  ok(!("insignia" in (premioPorPuesto(1) ?? {})),
     "y el premio ya no devuelve un campo `insignia` que nadie puede honrar");
}

{
  /**
   * La única insignia del ranking es `leyenda`, y la otorga el camino normal.
   */
  const delRanking = CONDICIONES.filter((c) => c.campo === "mejorPuestoMensual");
  ok(delRanking.length === 1, "hay una sola insignia atada al ranking", delRanking.length);
  ok(delRanking[0]?.id === "leyenda", "y es «leyenda»", delRanking[0]?.id);
}

// =====================================================================
console.log("\n=== 3. Ninguna promesa apunta fuera del catálogo ===");
// =====================================================================

{
  /**
   * La regla que se había violado, escrita como prueba.
   *
   * Todo id de insignia que aparezca en las reglas tiene que existir en el
   * catálogo, porque `tienda.otorgar` lo busca ahí y, si no está, tira
   * `not-found`. Los cinco ids muertos no estaban, y por eso nadie los podía
   * recibir aunque el sistema hubiera estado bien conectado.
   */
  const enCatalogo = new Set(
    CATALOGO_INICIAL.filter((i) => i.tipo === TIPOS.INSIGNIA).map((i) => i.id),
  );

  for (const id of IDS_INSIGNIAS) {
    ok(enCatalogo.has(id), `${id} existe en el catálogo`);
  }

  ok(enCatalogo.size === IDS_INSIGNIAS.length,
     "y el catálogo no tiene insignias de más, que no las otorgaría nadie",
     [...enCatalogo].filter((id) => !IDS_INSIGNIAS.includes(id)));

  // Los cinco muertos, por nombre, para que se note si vuelven.
  for (const muerta of ["dorada", "plateada", "bronce", "top10", "comprador-elite"]) {
    ok(!enCatalogo.has(muerta), `«${muerta}» no volvió al catálogo`);
    ok(!IDS_INSIGNIAS.includes(muerta), `  ni a las condiciones`);
  }
}

// =====================================================================
console.log("\n=== 4. El campo muerto del perfil no se escribe más ===");
// =====================================================================

{
  /**
   * `users/{uid}.insignias` era un array que se escribía en dos lugares y se
   * leía en ninguno. Lo que un jugador tiene vive en `users/{uid}/items/`, que
   * es donde mira `misItems`, y un segundo lugar para lo mismo es un segundo
   * lugar donde puede desincronizarse.
   */
  const index = leer("functions", "index.js");

  const escrituras = [...index.matchAll(/insignias:\s*admin\.firestore\.FieldValue\.arrayUnion/g)];
  ok(escrituras.length === 0,
     "nadie escribe `insignias` con arrayUnion en el perfil",
     escrituras.length);

  // Y la lectura de verdad sigue en pie: la vitrina sale de los items.
  ok(/tengo\.filter\(\(i\) => i\.tipo === "insignia"\)/.test(index),
     "`misInsignias` sigue leyendo la posesión, que es la fuente");
}

// =====================================================================
console.log("\n=== 5. Ganar una insignia paga, y deja rastro contable ===");
// =====================================================================

{
  /**
   * Las seis pagan, y el motivo es suyo.
   *
   * Tiene motivo propio porque el premio de una partida sale del pozo que
   * pusieron los jugadores —redistribuye— y esto lo emite la casa —crea—. Con
   * un motivo compartido, el libro mayor no podría responder cuántas Leyendas
   * se emitieron, que es justo lo que hay que poder vigilar cuando las
   * Leyendas también se compran con dinero.
   */
  const ACORDADO = { novato: 20, aventurero: 30, estratega: 40, heroe: 60, campeon: 50, leyenda: 100 };

  for (const [id, leyendas] of Object.entries(ACORDADO)) {
    ok(leyendasDeInsignia(id) === leyendas, `${id} paga ${leyendas}`, leyendasDeInsignia(id));
  }

  ok(Object.keys(ACORDADO).length === IDS_INSIGNIAS.length,
     "y no hay ninguna insignia sin premio declarado");

  ok(MOTIVOS.PREMIO_LOGRO === "premio_logro", "el motivo existe", MOTIVOS.PREMIO_LOGRO);
  ok(MOTIVOS.PREMIO_LOGRO !== MOTIVOS.PREMIO_PARTIDA,
     "y no se confunde con el premio de una partida");

  // Un id que no existe no puede acreditar un `NaN` contra el saldo de nadie.
  ok(leyendasDeInsignia("no-existe") === 0, "un id desconocido paga cero, no NaN");
  ok(leyendasDeInsignia(null) === 0, "y un id vacío tampoco rompe");
}

{
  /**
   * El pago pasa por la única puerta.
   *
   * `moverLeyendas` es lo único que escribe `credits`. Otorgar dejó de ser
   * gratis, así que tenía dos formas de salir mal: escribir el saldo por su
   * cuenta, o pagar fuera de la transacción que anota la posesión.
   */
  const tienda = leer("functions", "tienda.js");
  const otorgar = tienda.slice(tienda.indexOf("async function otorgar("));
  const cuerpo = otorgar.slice(0, otorgar.indexOf("\n  }"));

  ok(/db\.runTransaction/.test(cuerpo), "otorgar corre dentro de una transacción");
  ok(/moverLeyendas\(tx, \{/.test(cuerpo), "y paga con `moverLeyendas`, no a mano");
  ok(/idempotencia: `logro_\$\{uid\}_\$\{itemId\}`/.test(cuerpo),
     "con una clave de idempotencia por jugador y artículo");
  ok(!/credits/.test(cuerpo), "sin tocar `credits` por su cuenta");

  // El orden de Firestore: todas las lecturas antes de cualquier escritura.
  const primeraEscritura = cuerpo.indexOf("tx.set(");
  const ultimaLectura = cuerpo.lastIndexOf("await tx.get(");
  ok(ultimaLectura < primeraEscritura,
     "y lee todo lo suyo antes de escribir nada");
}

// =====================================================================
console.log("\n=== 6. Lo ganado llega a la mesa, y sólo a su dueño ===");
// =====================================================================

{
  /**
   * El aviso viaja en `partidas/{codigo}/logros/{uid}`.
   *
   * No en la vista: la vista la escribe el motor DENTRO de la transacción que
   * cierra, y el cliente la filtra por `version`. Las insignias se otorgan
   * DESPUÉS de esa transacción —hay que leer contadores que ella acaba de
   * escribir— así que meterlas ahí obligaba a inventar una versión más.
   */
  const index = leer("functions", "index.js");

  ok(/partidas\/\$\{codigo\}\/logros\/\$\{uid\}/.test(index),
     "el servidor publica un documento por jugador");
  ok(/despuesDelCierre\(r, codigo\)/.test(index),
     "y el cierre le pasa el código de la partida");

  const despues = index.slice(index.indexOf("async function despuesDelCierre("));
  ok(/await publicarLogros\(codigo, ganadas\)/.test(despues.slice(0, 400)),
     "el aviso sale del mismo lugar que otorga");

  // No puede tumbar el cierre: los premios ya se pagaron.
  const publicar = index.slice(index.indexOf("async function publicarLogros("));
  ok(/catch/.test(publicar.slice(0, 1200)), "y si falla, no rompe el cierre");
}

{
  // Las reglas: cada uno lee el suyo. Un solo documento con los cuatro
  // adentro le contaría a cada jugador lo que ganaron los otros.
  const reglas = leer("firestore.rules");
  const bloque = reglas.slice(reglas.indexOf("match /logros/{uid}"));
  ok(/allow read: if esDuenio\(uid\);/.test(bloque.slice(0, 200)),
     "sólo el dueño lee sus logros");
  ok(/allow write: if false;/.test(bloque.slice(0, 200)),
     "y nadie los escribe desde el navegador");
}

{
  // Y la mesa lo muestra.
  const mesa = leer("public", "js", "mesa.js");
  ok(/Red\.escucharMisLogros\(/.test(mesa), "la mesa escucha el aviso");
  ok(/¡Ganaste la insignia \$\{escapar\(/.test(mesa),
     "lo anuncia con el nombre de la insignia, escapado");
  ok(/id="panelLogros"/.test(mesa), "en su hueco del modal del final");

  const red = leer("public", "js", "partida-red.js");
  ok(/onSnapshot\(\s*doc\(db, "partidas", codigo, "logros", miUid\)/.test(red),
     "por un escuchador y no preguntando, que sería una carrera");
}

// =====================================================================
console.log("\n=== 7. La marca sobrevive al normalizador ===");
// =====================================================================

{
  /**
   * LA PRUEBA DEL BUG.
   *
   * `normalizarItem` es una lista blanca: arma un objeto nuevo con los campos
   * que nombra y descarta el resto. No incluía `packExclusivo`, así que el
   * campo se perdía en silencio en los DOS caminos de escritura — sembrar el
   * catálogo y guardar desde el panel.
   *
   * Lo grave no fue que faltara el campo. Fue que las defensas que sí lo miran
   * —`seCompraConLeyendas`, el bloqueo de la compra, el filtro de la tienda—
   * quedaron inertes: nueve artículos de tipo vendible y precio 0, gratis para
   * cualquiera. El servidor los defendía de un campo que él mismo había
   * tirado.
   *
   * No se prueba mirando la semilla: hay que pasarla POR el normalizador, que
   * es lo que hace el servidor antes de escribir.
   */
  const conMarca = normalizarItem({
    id: "avatar_soberano", tipo: "avatar", nombre: "X", precio: 0, imagen: "x",
    packExclusivo: "premium",
  });
  ok(conMarca.packExclusivo === "premium", "el normalizador conserva la marca", conMarca.packExclusivo);

  const sinMarca = normalizarItem({ id: "aa", tipo: "avatar", nombre: "X", precio: 0, imagen: "x" });
  ok(sinMarca.packExclusivo === null, "sin marca queda en null, no en undefined", sinMarca.packExclusivo);
  ok("packExclusivo" in sinMarca, "y el campo existe: Firestore rechaza undefined");

  const vacia = normalizarItem({
    id: "aa", tipo: "avatar", nombre: "X", precio: 0, imagen: "x", packExclusivo: "   ",
  });
  ok(vacia.packExclusivo === null, "el «ninguno» del formulario llega como null", vacia.packExclusivo);

  /**
   * Y la semilla entera sobrevive al viaje.
   *
   * Sembrar pasa cada artículo por el normalizador, así que lo que importa no
   * es lo que dice `CATALOGO_INICIAL` sino lo que queda DESPUÉS de
   * normalizarlo. Ahí se perdieron los doce.
   */
  const normalizada = CATALOGO_INICIAL.map(normalizarItem);
  const marcados = normalizada.filter((i) => i.packExclusivo);
  ok(marcados.length === 12, "los doce artículos de pack sobreviven a sembrar", marcados.length);

  // Y ninguno de ellos queda comprable, que es la consecuencia que se había
  // perdido cuando el campo se caía.
  const comprables = normalizada.filter(seCompraConLeyendas).filter((i) => i.packExclusivo);
  ok(comprables.length === 0, "y ninguno queda comprable", comprables.map((i) => i.id));
}

console.log(fallos ? `\n❌ ${fallos} fallos` : "\n✅ TODO OK");
process.exit(fallos ? 1 : 0);
