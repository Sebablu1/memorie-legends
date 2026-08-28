/**
 * Pruebas de la redacción del estado.
 *
 * Lo que se comprueba acá es que NINGUNA carta que deba estar tapada llegue
 * al navegador. Se juegan partidas completas y en cada paso se revisa la
 * vista de los cuatro jugadores.
 */
import * as M from "../public/js/reglas/motor.js";
import * as IA from "../public/js/reglas/ia.js";
import { vistaDe, filtracionesEn, CARTA_OCULTA } from "../public/js/reglas/vista.js";

let fallos = 0;
const ok = (c, m, x) => { if (c) console.log("  ✓", m); else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); } };

function mulberry32(a){return function(){a|=0;a=(a+0x6d2b79f5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296}}

const CONFIG = [
  { id: "ana", nombre: "Ana" }, { id: "beto", nombre: "Beto" },
  { id: "cora", nombre: "Cora" }, { id: "dario", nombre: "Dario" },
];

console.log("\n=== Una vista recién repartida ===");
let s = M.empezarRonda(M.crearPartida(CONFIG, { rng: mulberry32(7) }));
const v0 = vistaDe(s, 0);

ok(v0.jugadores.every((j) => j.mano.every((c) => c === null || c.oculta)),
   "ninguna carta viaja destapada, ni siquiera las propias");
ok(!("mazo" in v0), "el mazo no viaja");
ok(!("descarte" in v0), "la pila de descarte no viaja");
ok(typeof v0.cartasEnMazo === "number", "sí viaja cuántas cartas quedan", v0.cartasEnMazo);
ok(v0.muestra && v0.muestra.numero, "la muestra sí viaja: es pública");
ok(v0.jugadores.every((j) => j.cartasEnMano === 4), "se sabe cuántas cartas tiene cada uno");
ok(filtracionesEn(v0, s).length === 0, "el detector no encuentra filtraciones");

console.log("\n=== Ni el jugador ve sus propias cartas tapadas ===");
ok(v0.jugadores[0].mano.every((c) => c?.oculta),
   "las cartas propias también viajan tapadas: hay que recordarlas, no leerlas");

console.log("\n=== El mazo es secreto en contenido Y en orden ===");
const idsDelMazo = s.mazo.map((c) => c.id);
const serializada = JSON.stringify(v0);
ok(!idsDelMazo.some((id) => serializada.includes(`"${id}"`)),
   `ninguna de las ${idsDelMazo.length} cartas del mazo aparece en la vista`);

console.log("\n=== La carta levantada es sólo de quien juega ===");
s = M.cerrarVentanaDescarte(M.terminarMirada(s));
s = { ...s, indiceTurno: 1 };
s = M.levantar(s);
ok(s.levantada, "hay una carta levantada");
ok(vistaDe(s, 1).levantada?.id === s.levantada.id, "el que juega la ve");
ok(vistaDe(s, 0).levantada === null, "los demás no");
ok(vistaDe(s, 2).levantada === null, "ninguno de los demás");
ok(vistaDe(s, 0).hayLevantada === true, "pero sí saben que levantó");
ok([0, 2, 3].every((i) => filtracionesEn(vistaDe(s, i), s).length === 0),
   "sin filtraciones para los que no juegan");

console.log("\n=== Un descarte fallido sí expone esa carta a todos ===");
let e = M.empezarRonda(M.crearPartida(CONFIG, { rng: mulberry32(3) }));
e = M.terminarMirada(e);
// se busca una posición cuya carta NO coincida con la muestra
const muestra = e.descarte[0];
const posMala = e.jugadores[2].mano.findIndex((c) => c && c.numero !== muestra.numero);
e = M.intentarDescarte(e, 2, posMala);
ok(e.infoPublica.length === 1, "quedó registrada la exposición");
const expuesta = e.infoPublica[0].carta;
for (const quien of [0, 1, 2, 3]) {
  const v = vistaDe(e, quien);
  const cartaEnVista = v.jugadores[2].mano[posMala];
  if (cartaEnVista?.id !== expuesta.id) { fallos++; console.log("  ✗ el jugador", quien, "no ve la carta expuesta"); }
}
ok(true, "los cuatro jugadores ven la carta que se expuso");
ok(vistaDe(e, 0).jugadores[2].mano.filter((c) => c && !c.oculta).length === 1,
   "y sólo esa: el resto de esa mano sigue tapado");
ok(filtracionesEn(vistaDe(e, 0), e).length === 0, "exponer una carta no cuenta como filtración");

console.log("\n=== Al cortar se destapa todo, como manda el reglamento ===");
let c = M.empezarRonda(M.crearPartida(CONFIG, { rng: mulberry32(11) }));
c = M.cortar({ ...c, fase: "postLevantada", indiceTurno: 0 });
const vc = vistaDe(c, 3);
ok(vc.fase === "finRonda" || vc.fase === "finPartida", "la ronda terminó", vc.fase);
ok(vc.jugadores.every((j) => j.mano.every((x) => x === null || x.numero)),
   "todas las manos quedan visibles");
ok(Array.isArray(vc.puntosDeMano), "se manda el puntaje de cada mano", vc.puntosDeMano);
ok(filtracionesEn(vc, c).length === 0, "destapar al cortar no es filtración");

console.log("\n=== Partidas completas: se revisa cada paso ===");
let pasos = 0, sinFiltrar = 0;
for (let semilla = 1; semilla <= 12; semilla++) {
  const rng = mulberry32(semilla);
  let g = M.crearPartida(CONFIG.map((j, i) => ({ ...j, esIA: i > 0, dificultad: "medio" })), { rng });
  let mem = g.jugadores.map(() => IA.crearMemoria());
  g = M.empezarRonda(g);
  let guarda = 0;
  while (g.fase !== "finPartida" && guarda++ < 2000) {
    // en cada paso, la vista de los cuatro tiene que estar limpia
    for (let i = 0; i < 4; i++) {
      pasos++;
      if (filtracionesEn(vistaDe(g, i), g).length === 0) sinFiltrar++;
      else if (pasos < 2000) console.log("  ✗ filtración en", g.fase, filtracionesEn(vistaDe(g, i), g)[0]);
    }
    switch (g.fase) {
      case "mirar":
        g.jugadores.forEach((j, i) => { if (!j.eliminado) g = M.mirar(g, i, Math.floor(rng() * 4)); });
        g = M.terminarMirada(g); break;
      case "descarte":
        g.jugadores.forEach((j, i) => { if (j.eliminado) return; const p = IA.decidirDescarte(g, i, mem[i], rng); if (p != null) g = M.intentarDescarte(g, i, p); });
        g = M.cerrarVentanaDescarte(g); break;
      case "turno": { const antes = g.fase; g = M.levantar(g); if (g.fase === antes) guarda = 2000; break; }
      case "levantada": { const yo = g.indiceTurno; const d = IA.decidirLevantada(g, yo, mem[yo], rng);
        g = d.accion === "cambiar" ? M.cambiarCarta(g, d.posicion) : M.tirarCarta(g); break; }
      case "poder": g = M.saltarPoder(g); break;
      case "postLevantada": { const yo = g.indiceTurno; g = IA.decidirCorte(g, yo, mem[yo]) ? M.cortar(g) : M.pasarTurno(g); break; }
      case "finRonda": g = M.siguienteRonda(g); mem = g.jugadores.map(() => IA.crearMemoria()); break;
      default: guarda = 2000;
    }
  }
}
ok(sinFiltrar === pasos, `${pasos.toLocaleString("es-UY")} vistas revisadas, ninguna filtró una carta`, { pasos, sinFiltrar });

console.log(fallos === 0 ? "\n✅ TODO OK\n" : `\n❌ ${fallos} FALLOS\n`);
process.exit(fallos ? 1 : 0);
