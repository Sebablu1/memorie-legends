/**
 * Una foto de la mesa como la ve un jugador por Leyendas.
 *
 *   node herramientas/mirar-mesa-red.mjs [salida.png] [--yo=2]
 *
 * Hermana de `mirar-mesa.mjs`, que fotografía el entrenamiento. Ésta hace
 * falta aparte porque el modo red no se puede abrir escribiendo la URL: la
 * mesa comprueba la sesión, lee el documento de la sala y espera una vista
 * publicada por el servidor. Acá esas tres cosas son de mentira y la vista se
 * arma a mano, con `yo` en el asiento que se le pida.
 *
 * Sirve para mirar lo que ninguna prueba puede: que el jugador se vea abajo
 * con sus cartas grandes, con los rivales alrededor en el orden correcto.
 *
 * Necesita el servidor: `node herramientas/servir.mjs` en otra terminal.
 */

import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const SALIDA = args.find((a) => !a.startsWith("--")) ?? "mesa-red.png";
const YO = Number(args.find((a) => a.startsWith("--yo="))?.split("=")[1] ?? 2);
const FASE = args.find((a) => a.startsWith("--fase="))?.split("=")[1] ?? "turno";

const SESION = `
  export const COLECCION = "users";
  export const CAMPO_SALDO = "credits";
  export async function exigirSesion() {
    return { usuario: { uid: "ana", email: "a@b.c", photoURL: null },
             perfil: { uid: "ana", nombre: "Ana", saldo: 500 } };
  }
  export function mostrarSaldo() {}
  export function conectarBotonSalir() {}
  export function formatearEspera() { return "listo"; }
`;

const FIREBASE = `
  export const db = {};
  export const doc = (...a) => a;
  export const collection = (...a) => a;
  export const query = (...a) => a;
  export const orderBy = () => null;
  export const where = () => null;
  export const onSnapshot = () => () => {};
  export const getDocs = async () => ({ docs: [] });
  export const getDoc = async () => ({ exists: () => true, data: () => ({
    codigo: "ABCDEF", estado: "jugando", entrada: 10, maxJugadores: 4,
    jugadores: ["ana", "beto", "caro", "dani"],
    jugadoresNombres: ["Ana", "Beto", "Caro", "Dani"],
  }) });
  export const funciones = {};
  export const httpsCallable = () => async () => ({ data: {} });
  export const auth = { currentUser: { uid: "ana" } };
  export const SUPPORT_EMAIL = "soporte@memorie-legends.com";
`;

/** Los cuatro con retrato, que es lo que ahora manda el servidor de verdad. */
const RED = `
  const NOMBRES = ["Ana", "Beto", "Caro", "Dani"];
  const CARAS = [
    "/img/avatar/el_dragon.webp",
    "/img/avatar/orco.webp",
    "/img/avatar/sacerdotisa.webp",
    "/img/avatar/mago.webp",
  ];
  const tapada = { oculta: true };

  export const ahoraDelServidor = () => Date.now();
  export const relojActual = () => ({ desfase: 0, incertidumbre: 10 });
  export const sincronizarReloj = async () => {};
  export const mantenerVivo = () => () => {};
  export const mantenerEnMarcha = () => () => {};
  export const nuevoIdDeAccion = () => "a1";
  export const saltarAusente = async () => {};
  export const latir = async () => {};
  export const accion = async () => {};
  export const mirar = async () => {};
  export const levantar = async () => {};
  export const tirarCarta = async () => {};
  export const cortar = async () => {};
  export const pasarTurno = async () => {};
  export const cambiarCarta = async () => {};
  export const resolverCambio = async () => {};
  export const saltarPoder = async () => {};
  export const intentarDescarte = async () => {};
  export const abrirVentanaDescarte = async () => {};
  export const cerrarVentanaDescarte = async () => {};
  export const cerrarMirada = async () => {};
  export const avanzarPartida = async () => {};

  export function escucharMiVista(codigo, uid, alRecibir) {
    alRecibir({
      version: 1,
      fase: "${FASE}",
      ronda: 3,
      yo: ${YO},
      indiceMano: 0,
      indiceTurno: ${YO},
      turnosRonda: 2,
      indiceCortador: null,
      desempate: false,
      registro: [],
      cartasEnMazo: 24,
      cartasEnDescarte: 3,
      muestra: { id: "m", palo: "Espada", numero: 7, imagen: "/assets/Espada/7.png", visible: true },
      levantada: null,
      poderPendiente: null,
      puedeAtacar: [],
      plazo: { fase: "postLevantada", marca: "t2-${YO}", hasta: Date.now() + 22000, que: "pasarPorTiempo" },
      jugadores: NOMBRES.map((nombre, i) => ({
        id: nombre.toLowerCase(),
        nombre,
        retrato: CARAS[i],
        puntos: [120, 95, 60, 40][i],
        puntosRonda: [32, 25, 18, 22][i],
        eliminado: false,
        eliminadoEnRonda: null,
        cartasEnMano: 4,
        mano: [tapada, tapada, tapada, tapada],
      })),
    });
    return () => {};
  }
`;

const nav = await chromium.launch();
const pagina = await nav.newPage({ viewport: { width: 1536, height: 1024 } });
const js = (body) => ({ status: 200, contentType: "text/javascript; charset=utf-8", body });

await pagina.route("**/js/guardia-sesion.js", (r) =>
  r.fulfill(js('export async function exigirSesionEnMesa(){ return { uid: "ana" }; }')));
await pagina.route("**/js/sesion.js", (r) => r.fulfill(js(SESION)));
await pagina.route("**/js/firebase.js", (r) => r.fulfill(js(FIREBASE)));
await pagina.route("**/js/partida-red.js", (r) => r.fulfill(js(RED)));

await pagina.goto("http://localhost:5000/mesa.html?sala=ABCDEF");
await pagina.waitForSelector(".jugador[data-jugador]");
await pagina.waitForTimeout(1500);

const donde = await pagina.evaluate(() =>
  Object.fromEntries(
    [...document.querySelectorAll(".jugador[data-jugador]")].map((j) => [
      j.querySelector(".nombre")?.textContent.trim().split(" ")[0],
      j.closest(".asiento")?.id,
    ]),
  ));

await pagina.screenshot({ path: SALIDA });
await nav.close();

console.log(`Mesa por Leyendas desde el asiento ${YO} -> ${SALIDA}`);
console.log("dónde quedó cada uno:", JSON.stringify(donde, null, 1));
