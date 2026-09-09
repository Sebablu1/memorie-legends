/**
 * La revancha: volver a jugar con la misma gente, o cambiar la apuesta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ SE DEFIENDE ACÁ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Cuando una partida por Leyendas termina, el modal del final ofrece jugar
 * otra. Eso abre una sala NUEVA —la vieja queda terminada, con su cierre— y
 * cobra una entrada. Que cobre es lo que hace que esto no sea un botón más:
 *
 *   1. Que la pida alguien que jugó esa partida, y no cualquiera que sepa el
 *      código. El código no autoriza nada: sirve para encontrar la sala.
 *   2. Que no se pueda pedir antes de que la partida termine. Si se pudiera,
 *      un jugador que va perdiendo abriría la siguiente a mitad de ésta.
 *   3. Que CUATRO jugadores tocando a la vez abran UNA sala y no cuatro. Sin
 *      esto, cuatro entradas cobradas, cuatro salas de un jugador cada una y
 *      ninguna partida.
 *   4. Que la entrada la cobre `abrirSalaEn`, que es el mismo código que usa
 *      `crearSala`. Dos copias de una línea que mueve Leyendas es exactamente
 *      lo que `pruebas/transacciones.mjs` está para impedir.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ MITAD PRUEBA Y MITAD AUDITORÍA DE TEXTO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `revanchaDeSala` es una `functions.https.onCall` declarada al cargar
 * `functions/index.js`: no se puede importar sin levantar medio Firebase. Lo
 * que sí se puede es sacarle la DECISIÓN —`puedeRevancha`, que vive en las
 * reglas y es pura— y probarla de verdad; y comprobar leyendo el archivo que
 * la callable use esa función y no otra copia. Es el mismo reparto que ya
 * usan `ritmo.mjs` y `retratos-en-red.mjs`.
 */

import { readFileSync } from "node:fs";
import {
  puedeRevancha,
  puedeUnirse,
  RECHAZO,
  ESTADOS_SALA,
  ENTRADAS,
  MODOS,
  costoDeAbandonar,
} from "../public/js/reglas/salas.js";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

const lee = (ruta) => readFileSync(new URL(ruta, import.meta.url), "utf8");

/**
 * El cuerpo de una callable, desde su declaración hasta la siguiente.
 *
 * Cortar por cantidad de caracteres —que fue lo primero que escribí— se pasa
 * de largo y arrastra la función de al lado: la comprobación de que
 * `revanchaDeSala` no mueve Leyendas por su cuenta estaba leyendo el
 * `moverLeyendas` de la función de abajo, y daba rojo sin que nada anduviera
 * mal.
 */
function cuerpoDe(fuente, nombre) {
  const desde = fuente.indexOf(`export const ${nombre} = functions.`);
  if (desde < 0) return "";
  const siguiente = fuente.indexOf("\nexport const ", desde + 1);
  return fuente.slice(desde, siguiente < 0 ? fuente.length : siguiente);
}

const TERMINADA = {
  codigo: "ABCDEF",
  estado: ESTADOS_SALA.TERMINADA,
  entrada: 50,
  jugadores: ["ana", "beto", "caro", "dani"],
};

// ═══════════════════════════════════════════ la regla, que es la que decide

console.log("\n=== Quién puede pedir revancha ===");
{
  ok(puedeRevancha(TERMINADA, "ana").puede, "el que jugó, sí");
  ok(puedeRevancha(TERMINADA, "dani").puede, "cualquiera de los cuatro");

  const ajeno = puedeRevancha(TERMINADA, "elena");
  ok(!ajeno.puede, "alguien que no jugó, no");
  ok(ajeno.motivo === RECHAZO.NO_JUGASTE, "y se dice por qué", ajeno.motivo);
  ok(Boolean(ajeno.mensaje), "con un mensaje que se le puede mostrar", ajeno.mensaje);
}

console.log("\n=== Y cuándo ===");
{
  // El orden importa: primero el estado, después quién es. A alguien ajeno
  // mirando una sala en juego no se le confirma que la partida esté viva.
  for (const estado of [ESTADOS_SALA.ESPERANDO, ESTADOS_SALA.JUGANDO]) {
    const r = puedeRevancha({ ...TERMINADA, estado }, "ana");
    ok(!r.puede && r.motivo === RECHAZO.NO_TERMINO, `con la sala en ${estado}, no`, r.motivo);
  }

  const cancelada = puedeRevancha({ ...TERMINADA, estado: ESTADOS_SALA.CANCELADA }, "ana");
  ok(!cancelada.puede, "de una cancelada tampoco");
  ok(
    cancelada.motivo === RECHAZO.CANCELADA,
    "y se distingue de «todavía no terminó»: no es lo mismo",
    cancelada.motivo,
  );

  ok(!puedeRevancha(null, "ana").puede, "de una sala que no existe, no");
  ok(puedeRevancha(null, "ana").motivo === RECHAZO.NO_EXISTE, "y lo dice");
}

console.log("\n=== Es la vuelta exacta de `puedeUnirse` ===");
{
  /**
   * Las dos miran la misma sala y contestan lo contrario, y tiene que ser
   * así: a una sala terminada no se entra, y de una sala terminada es de la
   * única de la que se pide revancha. Si algún día las dos dijeran que sí a
   * la vez, una de las dos estaría mal.
   */
  const entrar = puedeUnirse(TERMINADA, "elena", 1000);
  ok(!entrar.puede && entrar.motivo === RECHAZO.TERMINADA, "a la terminada no se entra");
  ok(puedeRevancha(TERMINADA, "ana").puede, "y de la terminada sí se pide revancha");

  const esperando = { ...TERMINADA, estado: ESTADOS_SALA.ESPERANDO, jugadores: ["ana"] };
  ok(puedeUnirse(esperando, "elena", 1000).puede, "a la que espera se entra");
  ok(!puedeRevancha(esperando, "ana").puede, "y de la que espera no se pide revancha");
}

console.log("\n=== La revancha no mira el saldo ===");
{
  // A propósito. La entrada se cobra al abrir la sala nueva, en el servidor y
  // dentro de una transacción. Un «no te alcanza» calculado acá miraría el
  // saldo que el navegador tenga cargado, que puede ser de hace diez minutos.
  ok(
    puedeRevancha(TERMINADA, "ana").puede,
    "sin pasarle saldo, contesta igual: no es asunto suyo",
  );
}

// ═══════════════════════════════════════════ la callable usa esa regla

console.log("\n=== La callable no repite la regla: la usa ===");
{
  const cuerpo = cuerpoDe(lee("../functions/index.js"), "revanchaDeSala");

  ok(cuerpo.length > 100, "la callable existe");
  ok(/puedeRevancha\(sala, uid\)/.test(cuerpo), "pregunta por la regla compartida");
  ok(
    !/jugadores \?\? \[\]\)\.includes\(uid\)[\s\S]{0,120}permission-denied/.test(cuerpo),
    "y no dejó una copia de la comprobación al lado",
  );
}

console.log("\n=== La entrada la cobra el mismo código que `crearSala` ===");
{
  const fuente = lee("../functions/index.js");

  ok(
    /async function abrirSalaEn\(/.test(fuente),
    "existe un solo lugar que abre una sala y cobra",
  );

  // Las dos puertas pasan por ahí. Si mañana una de las dos escribiera su
  // propio `moverLeyendas`, esto se pone en rojo.
  const puertas = ["crearSala", "revanchaDeSala"];
  for (const puerta of puertas) {
    const cuerpo = cuerpoDe(fuente, puerta);
    ok(cuerpo.length > 100, `${puerta} está`);
    ok(/abrirSalaEn\(/.test(cuerpo), `${puerta} abre la sala por ahí`);
    ok(!/moverLeyendas\(/.test(cuerpo), `${puerta} no mueve Leyendas por su cuenta`);
  }
}

console.log("\n=== Dos jugadores a la vez abren UNA sala ===");
{
  /**
   * La sala vieja guarda un puntero, `revancha`, y se lee DENTRO de la misma
   * transacción que lo escribe. El segundo que llega lo encuentra y devuelve
   * ese código en vez de abrir otra sala.
   *
   * Sin esto: cuatro jugadores tocando «jugar otra» al mismo tiempo, cuatro
   * entradas cobradas, cuatro salas de un jugador cada una y ninguna partida.
   */
  const cuerpo = cuerpoDe(lee("../functions/index.js"), "revanchaDeSala");

  ok(/if \(sala\.revancha\?\.codigo\)/.test(cuerpo), "si ya hay una, se devuelve esa");
  ok(
    cuerpo.indexOf("sala.revancha?.codigo") < cuerpo.indexOf("abrirSalaEn("),
    "y se comprueba ANTES de abrir nada",
  );
  ok(/tx\.update\(refVieja, \{[\s\S]{0,80}revancha:/.test(cuerpo), "y se anota el puntero");

  // Firestore prohíbe leer después de escribir dentro de una transacción, y
  // `abrirSalaEn` escribe. Esto no falla en las pruebas: falla en producción.
  ok(
    cuerpo.indexOf("await tx.get(refVieja)") < cuerpo.indexOf("abrirSalaEn("),
    "la sala vieja se lee antes de la primera escritura",
  );
}

console.log("\n=== La revancha no se le ofrece a quien no jugó ===");
{
  /**
   * La sala nueva no sale en la lista de salas abiertas.
   *
   * No es un permiso —cualquiera con el código entra, como en cualquier sala:
   * el código sirve para encontrarla, no para autorizar—. Es que ofrecérsela
   * a un desconocido tiene una consecuencia concreta: ocupa un asiento, y los
   * cuatro que venían jugando se quedan sin la revancha que acababan de
   * acordar.
   */
  const cuerpo = cuerpoDe(lee("../functions/index.js"), "revanchaDeSala");
  ok(/listada: false/.test(cuerpo), "la sala de revancha nace fuera de la lista");

  for (const pantalla of ["dashboard", "lobby"]) {
    const fuente = lee(`../public/js/${pantalla}.js`);
    ok(/s\.listada !== false/.test(fuente), `${pantalla} la saltea`);
  }

  // Pero el que YA está adentro tiene que verla igual: es como se vuelve a
  // una sala después de un corte de conexión.
  ok(
    /s\.listada !== false \|\| \(s\.jugadores \?\? \[\]\)\.includes\(miUid\)/.test(
      lee("../public/js/dashboard.js"),
    ),
    "salvo para quien ya está en ella, que necesita poder volver",
  );
}

console.log("\n=== El techo de ritmo está declarado ===");
{
  const limites = lee("../functions/limite-de-ritmo.js");
  ok(/revanchaDeSala: \d+,/.test(limites), "la revancha tiene su propio techo");
  const cuanto = Number(limites.match(/revanchaDeSala: (\d+),/)?.[1]);
  const crear = Number(limites.match(/crearSala: (\d+),/)?.[1]);
  ok(cuanto === crear, "el mismo que `crearSala`: es la misma operación", { cuanto, crear });
}

// ═══════════════════════════════════════════ lo que ve el jugador

console.log("\n=== La mesa ofrece la revancha al terminar ===");
{
  const mesa = lee("../public/js/mesa.js");

  ok(/id="panelRevancha"/.test(mesa), "el modal del final tiene su panel");
  ok(/escucharLaSala\(\);/.test(mesa), "y desde ahí se escucha la sala");
  ok(
    /data-accion="revancha-igual"/.test(mesa) && /data-accion="revancha-cambiar"/.test(mesa),
    "con las dos opciones que se pidieron: jugar otra, o cambiar la apuesta",
  );
  ok(/data-accion="revancha-unirme"/.test(mesa), "y unirse a la que abrió otro");

  // La apuesta que se ofrece sale de la lista de las reglas y no de una lista
  // escrita a mano: agregar una entrada nueva no puede dejar la mesa atrás.
  ok(/ENTRADAS\.map\(/.test(mesa), "el selector sale de ENTRADAS");
  ok(
    ENTRADAS.length >= 2,
    "y hay más de una para elegir, si no el botón no tendría sentido",
    ENTRADAS.length,
  );

  // Las dos llamadas, en ese orden: primero cuál es la sala, después entrar
  // por la puerta de siempre.
  ok(
    /revanchaDeSala\(salaPedida, entrada\)/.test(mesa),
    "pide la revancha con el código de esta sala",
  );
  ok(/if \(!r\.dentro\) await unirseASala\(r\.codigo\)/.test(mesa),
     "y si no está adentro, entra por `unirseASala`");
}

console.log("\n=== La sala terminada también lleva a la revancha ===");
{
  // Quien vuelve al enlace viejo de la sala no puede quedarse en una pantalla
  // sin salida si la revancha ya existe.
  const room = lee("../public/js/room.js");
  ok(/sala\.revancha/.test(room), "la sala de espera mira el puntero");
  ok(/enlaceRevancha/.test(room), "y enciende el enlace");
  ok(
    /id="enlaceRevancha"[^>]*hidden/.test(lee("../public/room.html")),
    "que nace apagado: sin revancha no se ve",
  );
}

// ═══════════════════════════════════════════ el arreglo que salió de acá

console.log("\n=== La mesa sabe cuánto se apostó, y por eso puede abandonar ===");
{
  /**
   * ESTO ERA UN FALLO, y se encontró escribiendo la revancha.
   *
   * `partidaEconomica.entrada` nacía en `null` y no se asignaba en ningún
   * lado. `costoDeAbandonar` exige una entrada válida para reconocer una
   * partida de Leyendas —`usaLeyendas`— así que con `null` devolvía
   * `esEntrenamiento: true`. Dos consecuencias, las dos en una partida por
   * la que el jugador había pagado:
   *
   *   · el cartel de abandono decía «no perderás Leyendas»;
   *   · y `confirmarAbandono` tomaba la rama de entrenamiento, que se va al
   *     tablero SIN llamar a `abandonarPartida`. Ni se cobraba la
   *     penalización ni la mesa se enteraba de que el jugador se había ido:
   *     su asiento quedaba esperándolo.
   */
  const sinEntrada = costoDeAbandonar({ modo: MODOS.LEYENDAS, entrada: null });
  ok(
    sinEntrada.esEntrenamiento,
    "sin entrada, la partida se confunde con un entrenamiento",
    sinEntrada,
  );

  const conEntrada = costoDeAbandonar({ modo: MODOS.LEYENDAS, entrada: 50 });
  ok(!conEntrada.esEntrenamiento, "con entrada, se sabe que se está jugando plata");
  ok(conEntrada.penalizacion > 0, "y que irse cuesta", conEntrada.penalizacion);

  // Y que la mesa la escriba de verdad, que es lo que faltaba.
  const mesa = lee("../public/js/mesa.js");
  ok(
    /partidaEconomica\.entrada = Number\(sala\?\.entrada\)/.test(mesa),
    "la mesa le pone la entrada de la sala al arrancar en red",
  );
  const desde = mesa.indexOf("async function arrancarModoLeyendas");
  ok(
    desde >= 0 && mesa.indexOf("partidaEconomica.entrada =") > desde,
    "y lo hace dentro de `arrancarModoLeyendas`, que es donde llega la sala",
  );
}

console.log(fallos === 0 ? "\n✅ TODO OK" : `\n❌ ${fallos} fallos`);
process.exit(fallos === 0 ? 0 : 1);
