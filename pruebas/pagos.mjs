/**
 * Mercado Pago: que nadie pueda acuñar Leyendas sin haber pagado.
 *
 * LA REGLA QUE SE PRUEBA
 *
 * El aviso del webhook no dice que te pagaron: dice que MIRES. El estado se lee
 * de la API de Mercado Pago y NUNCA del cuerpo del pedido. La versión anterior
 * leía `estado === "pagado"` del payload, así que cualquiera capaz de producir
 * un cuerpo aceptado acreditaba compras.
 *
 * Y la firma no alcanza sola: el manifiesto que MP firma cubre el id, el
 * request-id y la marca de tiempo, no el cuerpo entero. Una firma válida no
 * dice nada del resto del payload.
 *
 * QUÉ NO PRUEBA ESTO
 *
 * No habla con Mercado Pago. `fetch` entra inyectado y las respuestas son
 * dobles. La prueba contra el sandbox real hace falta igual, y necesita
 * credenciales: `MP_ACCESS_TOKEN` y `MP_WEBHOOK_SECRET`.
 */

import crypto from "node:crypto";
import { crearMercadoPago, pagoCoincideConOrden } from "../functions/mercadopago.js";
import { PAQUETES } from "../public/js/reglas/economia.js";
import { firmarComoMercadoPago, interpretar } from "../herramientas/sondear-webhook.mjs";

let fallos = 0;
const ok = (c, m, x) => {
  if (c) console.log("  ✓", m);
  else { fallos++; console.log("  ✗", m, x !== undefined ? JSON.stringify(x) : ""); }
};

const SECRETO = "secreto-de-prueba";
const TOKEN = "token-de-prueba";

/** Un `fetch` de mentira que devuelve lo que se le indique. */
const falsoFetch = (respuestas) => {
  const llamadas = [];
  const fn = async (url, opciones) => {
    llamadas.push({ url, opciones });
    const r = respuestas.shift();
    if (!r) throw new Error(`fetch inesperado a ${url}`);
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.json,
      text: async () => JSON.stringify(r.json ?? ""),
    };
  };
  fn.llamadas = llamadas;
  return fn;
};

/** Firma una notificación como lo haría Mercado Pago. */
function firmarComoMP({ dataId, requestId, ts, secreto = SECRETO }) {
  const id = /^[a-z0-9]+$/i.test(String(dataId)) ? String(dataId).toLowerCase() : String(dataId);
  const manifiesto = `id:${id};request-id:${requestId};ts:${ts};`;
  const v1 = crypto.createHmac("sha256", secreto).update(manifiesto).digest("hex");
  return `ts=${ts},v1=${v1}`;
}

// ═══════════════════════════════════════════════════════ la firma

console.log("\n=== La firma se verifica con el esquema de Mercado Pago ===");
{
  const ahora = 1_700_000_000_000;
  const ts = Math.floor(ahora / 1000);
  const mp = crearMercadoPago({ accessToken: TOKEN, webhookSecret: SECRETO, ahora: () => ahora });

  const buena = firmarComoMP({ dataId: "123456", requestId: "req-1", ts });
  ok(mp.verificarFirma({ firma: buena, requestId: "req-1", dataId: "123456", crypto }).valida,
     "una notificación firmada por MP se acepta");

  // Cada pieza del manifiesto importa: si alguna no entrara, se podría reusar
  // una firma vieja para otro pago.
  for (const [que, args] of [
    ["otro id de pago", { firma: buena, requestId: "req-1", dataId: "999999" }],
    ["otro request-id", { firma: buena, requestId: "req-2", dataId: "123456" }],
  ]) {
    const r = mp.verificarFirma({ ...args, crypto });
    ok(!r.valida, `cambiar ${que} invalida la firma`, r.motivo);
  }

  const conOtroSecreto = firmarComoMP({ dataId: "123456", requestId: "req-1", ts, secreto: "otro" });
  ok(!mp.verificarFirma({ firma: conOtroSecreto, requestId: "req-1", dataId: "123456", crypto }).valida,
     "una firma hecha con otro secreto se rechaza");

  // Una firma vieja se rechaza: si no, una notificación capturada sirve para
  // siempre.
  const vieja = firmarComoMP({ dataId: "123456", requestId: "req-1", ts: ts - 3600 });
  const rv = mp.verificarFirma({ firma: vieja, requestId: "req-1", dataId: "123456", crypto });
  ok(!rv.valida && rv.motivo === "firma_vencida", "una firma de hace una hora se rechaza", rv.motivo);

  for (const [que, firma] of [
    ["vacía", ""], ["sin v1", "ts=123"], ["basura", "no-es-una-firma"],
  ]) {
    ok(!mp.verificarFirma({ firma, requestId: "r", dataId: "1", crypto }).valida,
       `una firma ${que} se rechaza`);
  }

  // Sin secreto configurado NO se valida nada. Es el caso en que alguien
  // despliega sin poner la variable: tiene que fallar cerrado, no abierto.
  const sinSecreto = crearMercadoPago({ accessToken: TOKEN, webhookSecret: "", ahora: () => ahora });
  const rs = sinSecreto.verificarFirma({ firma: buena, requestId: "req-1", dataId: "123456", crypto });
  ok(!rs.valida && rs.motivo === "sin_secreto", "sin secreto configurado, nada se acepta", rs.motivo);
}

// ═══════════════════════ la sonda y el servidor firman igual

console.log("\n=== La sonda y el servidor llegan al mismo HMAC ===");
{
  /**
   * Dos implementaciones independientes, a propósito.
   *
   * `herramientas/sondear-webhook.mjs` arma el manifiesto por su cuenta en vez
   * de importar el del servidor. Si lo importara, un error en esa función daría
   * verde en la sonda y rojo en producción: estaría comprobando que el código
   * coincide consigo mismo, que es justo el agujero por el que se fue el bug
   * de `unit_price`.
   *
   * El precio de tener dos es que se pueden separar. Esto es lo que cobra ese
   * precio.
   */
  const mp = crearMercadoPago({ accessToken: TOKEN, webhookSecret: SECRETO });
  const ts = Math.floor(Date.now() / 1000);

  for (const dataId of ["Sonda123", "123456789", "abc-DEF-999"]) {
    const requestId = `req-${dataId}`;
    const { cabecera } = firmarComoMercadoPago({ dataId, requestId, ts, secreto: SECRETO });
    const r = mp.verificarFirma({ firma: cabecera, requestId, dataId, crypto });
    ok(r.valida, `el servidor acepta la firma de la sonda para ${dataId}`, r);
  }

  // Y con OTRO secreto no pasa: si pasara, la sonda no probaría nada sobre
  // cuál es el secreto desplegado, que es la mitad de para qué existe.
  const requestId = "req-x";
  const { cabecera } = firmarComoMercadoPago({
    dataId: "Sonda123",
    requestId,
    ts,
    secreto: "otro-secreto",
  });
  const r = mp.verificarFirma({ firma: cabecera, requestId, dataId: "Sonda123", crypto });
  ok(!r.valida && r.motivo === "no_coincide", "y rechaza una firmada con otro secreto", r);
}

// ═════════════════════════════════ el estado sale de la API, no del payload

console.log("\n=== El estado se lee de Mercado Pago, no del pedido ===");
{
  const respuesta = (status) => ({
    json: { id: 42, status, status_detail: "x", external_reference: "orden-1",
            transaction_amount: 100, currency_id: "UYU", live_mode: false },
  });

  for (const [estado, esperado] of [
    ["approved", true], ["authorized", false], ["pending", false],
    ["in_process", false], ["rejected", false], ["cancelled", false], ["refunded", false],
  ]) {
    const mp = crearMercadoPago({ accessToken: TOKEN, webhookSecret: SECRETO, buscar: falsoFetch([respuesta(estado)]) });
    const pago = await mp.consultarPago("42");
    ok(pago.aprobado === esperado, `"${estado}" ${esperado ? "acredita" : "NO acredita"}`, pago.aprobado);
  }

  // `authorized` merece su propia línea: está retenido y todavía puede caerse.
  // Tratarlo como pagado sería regalar Leyendas.
  const mp = crearMercadoPago({ accessToken: TOKEN, webhookSecret: SECRETO, buscar: falsoFetch([respuesta("authorized")]) });
  ok((await mp.consultarPago("42")).aprobado === false,
     "un pago sólo AUTORIZADO no es un pago cobrado");

  // Y que de verdad le pregunte a MP, con el token.
  const espia = falsoFetch([respuesta("approved")]);
  const mp2 = crearMercadoPago({ accessToken: TOKEN, webhookSecret: SECRETO, buscar: espia });
  await mp2.consultarPago("42");
  ok(espia.llamadas[0].url.includes("/v1/payments/42"), "consulta el pago por su id", espia.llamadas[0].url);
  ok(espia.llamadas[0].opciones.headers.Authorization === `Bearer ${TOKEN}`,
     "y va autenticado con el access token");
}

// ══════════════════════════════════ el pago tiene que cuadrar con su orden

console.log("\n=== Un pago aprobado todavía tiene que cuadrar ===");
{
  const orden = { id: "orden-1", estado: "pendiente", importe: 100, leyendas: 500, uid: "u1" };
  const pago = { id: "42", ordenId: "orden-1", importe: 100, moneda: "UYU", aprobado: true };

  ok(pagoCoincideConOrden(pago, orden, { moneda: "UYU" }).ok, "el caso bueno pasa");

  // El de más abajo es el que de verdad protege la caja: sin él, alguien que
  // consiga pagar 1 se lleva el paquete de 100.
  const barato = pagoCoincideConOrden({ ...pago, importe: 1 }, orden, { moneda: "UYU" });
  ok(!barato.ok && barato.motivo === "importe_distinto",
     "pagar menos que la orden NO acredita", barato.motivo);

  ok(!pagoCoincideConOrden({ ...pago, moneda: "ARS" }, orden, { moneda: "UYU" }).ok,
     "pagar en otra moneda tampoco");
  ok(!pagoCoincideConOrden({ ...pago, ordenId: "otra" }, orden, { moneda: "UYU" }).ok,
     "un pago que apunta a otra orden tampoco");
  ok(!pagoCoincideConOrden(pago, null, { moneda: "UYU" }).ok,
     "y una orden que no existe, menos");

  // Reintento de MP: no es un error, es lo normal.
  const repetido = pagoCoincideConOrden(pago, { ...orden, estado: "pagado" }, { moneda: "UYU" });
  ok(!repetido.ok && repetido.motivo === "ya_pagada",
     "una orden ya pagada se reconoce como reintento", repetido.motivo);

  // Los céntimos no pueden tumbar una compra legítima: MP devuelve decimales.
  ok(pagoCoincideConOrden({ ...pago, importe: 100.004 }, orden, { moneda: "UYU" }).ok,
     "una diferencia de milésimos no rompe nada");
  ok(!pagoCoincideConOrden({ ...pago, importe: 99.5 }, orden, { moneda: "UYU" }).ok,
     "pero medio peso menos sí");
}

// ═══════════════════════════════════════════ la creación del checkout

console.log("\n=== El checkout se crea con los datos del servidor ===");
{
  /**
   * El paquete sale del catálogo DE VERDAD, no de uno inventado acá.
   *
   * ────────────────────────────────────────────────────────────────────
   * ES EL AGUJERO POR EL QUE SE FUE UN BUG A PRODUCCIÓN
   * ────────────────────────────────────────────────────────────────────
   *
   * Acá había `{ id: "chico", nombre: "Paquete chico", precio: 100 }`, escrito
   * a mano. El campo real se llama `precioUYU`, y el código leía `precio`: el
   * doble tenía la MISMA equivocación que el código, así que la prueba
   * confirmaba el error en vez de encontrarlo.
   *
   * En producción el item viajaba sin precio —`JSON.stringify` descarta las
   * claves `undefined`— y Mercado Pago contestaba «unit_price needed».
   *
   * Usando el paquete del catálogo, el día que un campo se renombre esta
   * prueba se cae sola. Un doble escrito a mano sólo comprueba que el código
   * coincida consigo mismo.
   */
  const paquete = PAQUETES[0];
  const espia = falsoFetch([{ json: { id: "pref-1", init_point: "https://mp/x", sandbox_init_point: "https://mp/sandbox" } }]);
  const mp = crearMercadoPago({ accessToken: TOKEN, webhookSecret: SECRETO, buscar: espia });

  const r = await mp.crearPreferencia({
    orden: { id: "orden-1" }, paquete, moneda: "UYU",
    urlWebhook: "https://x/webhook", urlVuelta: "https://x/tienda.html",
  });

  const enviado = JSON.parse(espia.llamadas[0].opciones.body);
  ok(enviado.external_reference === "orden-1",
     "manda el id de NUESTRA orden como referencia, que es lo que permite reconciliar");
  ok(enviado.items[0].unit_price === paquete.precioUYU,
     `y el precio del catálogo del servidor (${paquete.precioUYU})`, enviado.items[0].unit_price);
  ok(Number.isFinite(enviado.items[0].unit_price) && enviado.items[0].unit_price > 0,
     "que es un número de verdad y no `undefined`", enviado.items[0].unit_price);
  ok(enviado.items[0].currency_id === "UYU", "con su moneda");
  ok(enviado.items[0].quantity === 1, "y una unidad");
  ok(enviado.notification_url === "https://x/webhook", "con la URL del webhook");

  ok(r.url === "https://mp/sandbox" && r.esSandbox === true,
     "con credenciales de prueba devuelve el checkout de sandbox", r);

  // Sin `sandbox_init_point` —o sea, con credenciales de producción— usa el
  // real. Que sea una u otra lo decide la CREDENCIAL y no una bandera nuestra:
  // así es imposible cobrar de verdad creyendo que se está probando.
  const espia2 = falsoFetch([{ json: { id: "pref-2", init_point: "https://mp/vivo" } }]);
  const mp2 = crearMercadoPago({ accessToken: TOKEN, webhookSecret: SECRETO, buscar: espia2 });
  const r2 = await mp2.crearPreferencia({
    orden: { id: "o2" }, paquete, moneda: "UYU", urlWebhook: "w", urlVuelta: "v",
  });
  ok(r2.url === "https://mp/vivo" && r2.esSandbox === false, "y con las de producción, el real", r2);

  // Si MP rechaza la preferencia, se entera quien llama.
  const roto = crearMercadoPago({
    accessToken: TOKEN, webhookSecret: SECRETO,
    buscar: falsoFetch([{ ok: false, status: 400, json: { message: "bad" } }]),
  });
  let salto = false;
  try {
    await roto.crearPreferencia({ orden: { id: "o" }, paquete, moneda: "UYU", urlWebhook: "w", urlVuelta: "v" });
  } catch { salto = true; }
  ok(salto, "un rechazo de MP al crear la preferencia no pasa en silencio");

  /**
   * Un paquete sin precio se rompe ANTES de salir a la red.
   *
   * Es la mitad que faltaba del bug. Con `unit_price` en `undefined`, la
   * llamada igual salía y el error llegaba de vuelta como un 400 de Mercado
   * Pago diciendo «unit_price needed» —que suena a campo olvidado en vez de a
   * valor ausente, y manda a mirar el lugar equivocado—.
   *
   * Un paquete sin precio es un error nuestro: un documento de Firestore a
   * medio escribir, o un campo renombrado. Decirlo con el id adelante ahorra
   * el viaje y la traducción.
   */
  for (const roto of [
    { id: "sin-precio", nombre: "Roto" },
    { id: "precio-cero", nombre: "Roto", precioUYU: 0 },
    { id: "precio-texto", nombre: "Roto", precioUYU: "doscientos" },
    { id: "precio-negativo", nombre: "Roto", precioUYU: -100 },
    // El nombre viejo del campo, que es exactamente lo que estaba pasando.
    { id: "campo-viejo", nombre: "Roto", precio: 250 },
  ]) {
    const espiaRoto = falsoFetch([{ json: { id: "no-deberia-llegar" } }]);
    const mpRoto = crearMercadoPago({
      accessToken: TOKEN, webhookSecret: SECRETO, buscar: espiaRoto,
    });
    let mensaje = "";
    try {
      await mpRoto.crearPreferencia({
        orden: { id: "o" }, paquete: roto, moneda: "UYU", urlWebhook: "w", urlVuelta: "v",
      });
    } catch (e) {
      mensaje = e.message;
    }
    ok(mensaje.includes(roto.id),
       `un paquete con ${roto.id} se rechaza nombrándolo`, mensaje);
    ok(espiaRoto.llamadas.length === 0,
       `  y no se llama a Mercado Pago`, espiaRoto.llamadas.length);
  }
}

// ════════════════════════════ auditoría: que el webhook no vuelva a confiar

console.log("\n=== El webhook no lee el estado del payload ===");
{
  const { readFileSync } = await import("node:fs");
  const fuente = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  // Sin comentarios: el que explica el arreglo cita la línea vieja.
  const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  ok(!/body[^\n]*\.estado/.test(codigo),
     "no queda ninguna lectura de `estado` desde el cuerpo del pedido");
  ok(codigo.includes("consultarPago("),
     "y el estado sale de consultarPago, o sea de la API de Mercado Pago");
  ok(codigo.includes("pagoCoincideConOrden("),
     "y todavía tiene que cuadrar con la orden antes de acreditar");

  // Un secreto configurado pero NO declarado es invisible en producción: en
  // Cloud Functions v1, `process.env` sigue vacío hasta que la función lo pide
  // con `runWith`. El código anterior leía `PAGOS_SECRETO` sin declararlo, así
  // que habría respondido "Sin configurar" para siempre con el secreto bien
  // guardado y nadie entendiendo por qué.
  ok(/runWith\(\{\s*secrets:/.test(codigo), "las funciones DECLARAN sus secretos");
  const conRunWith = [...codigo.matchAll(/runWith\(\{\s*secrets:/g)].length;
  ok(conRunWith >= 2, `las dos que tocan pagos lo declaran (${conRunWith})`);
  ok(codigo.includes('"MP_ACCESS_TOKEN"') && codigo.includes('"MP_WEBHOOK_SECRET"'),
     "y los nombres son los que lee el código");
}

// ═══════════════════ la sonda entiende TODO lo que el webhook contesta

console.log("\n=== La sonda sabe leer cada respuesta del webhook ===");
{
  /**
   * La prueba que faltaba, y que se escribió después de que la sonda mintiera.
   *
   * La primera versión miraba sólo el código de estado y trataba cualquier 500
   * como «faltan los secretos». La primera corrida de verdad devolvió
   * 500 «No se pudo confirmar» —que es el ÉXITO: la firma validó y Mercado Pago
   * no conoce el pago inventado— y la sonda dijo que los secretos no habían
   * llegado. Mandó a buscar el problema al lugar equivocado, que es exactamente
   * lo que venía a evitar.
   *
   * Y el comentario del archivo daba por bueno un 200 que nunca ocurre: se
   * supuso que `consultarPago` devolvería «no aprobado» ante un pago
   * inexistente. Lo que hace es LANZAR.
   *
   * Así que ahora las respuestas no se suponen: se leen del webhook. Si alguien
   * le agrega una, esta prueba se cae hasta que la sonda aprenda a leerla.
   */
  const { readFileSync } = await import("node:fs");
  const fuente = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");

  const desde = fuente.indexOf("export const webhookPago");
  const hasta = fuente.indexOf("export const", desde + 10);
  const cuerpoWebhook = fuente.slice(desde, hasta === -1 ? undefined : hasta);

  ok(desde !== -1, "se encontró el cuerpo de `webhookPago`");

  const respuestas = [...cuerpoWebhook.matchAll(/res\.status\((\d+)\)\.send\("([^"]*)"\)/g)]
    .map((m) => ({ status: Number(m[1]), cuerpo: m[2] }));

  ok(respuestas.length >= 8, `el webhook tiene ${respuestas.length} respuestas`, respuestas.length);

  const sinLeer = respuestas.filter((r) => interpretar(r).firmaPaso === null);
  ok(sinLeer.length === 0, "la sonda sabe leerlas todas", sinLeer);

  // Las tres que deciden el veredicto, uña por uña.
  ok(interpretar({ status: 401, cuerpo: "Firma inválida" }).firmaPaso === false,
     "401 significa que la firma NO pasó");
  ok(interpretar({ status: 500, cuerpo: "Sin configurar" }).firmaPaso === false,
     "500 «Sin configurar» tampoco: no llegó ni a mirar la firma");
  ok(interpretar({ status: 500, cuerpo: "No se pudo confirmar" }).firmaPaso === true,
     "y 500 «No se pudo confirmar» SÍ: es el éxito de la sonda");

  // El orden del webhook es lo que hace válida esa lectura: mira los secretos,
  // después la firma, y recién entonces el resto. Si eso se invirtiera, un 500
  // posterior podría ocurrir SIN haber validado la firma.
  const iSecretos = cuerpoWebhook.indexOf("Sin configurar");
  const iFirma = cuerpoWebhook.indexOf("Firma inválida");
  const iConfirmar = cuerpoWebhook.indexOf("No se pudo confirmar");
  ok(iSecretos < iFirma && iFirma < iConfirmar,
     "y el webhook sigue comprobando secretos, luego firma, luego el pago",
     { iSecretos, iFirma, iConfirmar });
}


// =====================================================================
console.log("\n=== Sin credenciales no se anota ninguna orden ===");
// =====================================================================

{
  /**
   * QUÉ SE ROMPIÓ
   *
   * `crearOrdenDeCompra` escribía el documento de la orden ANTES de comprobar
   * que hubiera token. Con los secretos sin cargar, cada persona que apretaba
   * «Comprar» dejaba una orden en `pendiente` que nunca iba a existir del lado
   * de Mercado Pago.
   *
   * El daño no es el espacio: es que `ordenes` es la colección que hay que
   * conciliar a mano cuando algo falla, y esas órdenes fantasma son
   * indistinguibles a simple vista de un pago real que quedó sin acreditar.
   *
   * QUÉ NO CAMBIA
   *
   * Si los secretos ESTÁN y la preferencia falla igual, la orden se conserva a
   * propósito: hubo un intento real y que quede anotado es lo que permite
   * entender después qué pasó. Lo que se borró de raíz es la orden sin
   * intento, no la orden sin éxito.
   *
   * Se mide por orden en la fuente porque es una función de Cloud Functions:
   * no se puede instanciar sin `firebase-admin` ni sin entorno.
   *
   * Y se mide sobre la fuente SIN COMENTARIOS. Con ellos, el comentario que
   * explica por qué la comprobación va primero nombra las dos cosas, y la
   * prueba encontraría el orden correcto en la explicación aunque el código
   * hiciera lo contrario.
   */
  const { readFileSync: leerArchivo } = await import("node:fs");
  const crudo = leerArchivo(new URL("../functions/index.js", import.meta.url), "utf8");
  const sinComentarios = crudo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  const cuerpo = sinComentarios.slice(
    sinComentarios.indexOf("export const crearOrdenDeCompra"),
    sinComentarios.indexOf("export const webhookPago"),
  );

  ok(cuerpo.length > 500, "se encontró el cuerpo de `crearOrdenDeCompra`", cuerpo.length);

  const comprobacion = cuerpo.indexOf("if (!process.env.MP_ACCESS_TOKEN)");
  const escritura = cuerpo.indexOf('db.collection("ordenes")');

  ok(comprobacion !== -1, "comprueba el token");
  ok(escritura !== -1, "y escribe la orden");
  ok(comprobacion < escritura,
     "el token se comprueba ANTES de escribir la orden",
     { comprobacion, escritura });

  // El fallo de la preferencia sigue conservando la orden: son dos casos
  // distintos y sólo uno de los dos tenía que cambiar. Esto sí se busca en el
  // texto con comentarios, porque es la decisión lo que hay que preservar.
  const conComentarios = crudo.slice(
    crudo.indexOf("export const crearOrdenDeCompra"),
    crudo.indexOf("export const webhookPago"),
  );
  ok(/no se borra/.test(conComentarios),
     "y una preferencia fallida sigue dejando rastro, que es lo que se quiere");
}

console.log(fallos ? `\n❌ ${fallos} fallos\n` : "\n✅ TODO OK\n");
process.exit(fallos ? 1 : 0);
