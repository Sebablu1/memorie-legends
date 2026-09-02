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
  const paquete = { id: "chico", nombre: "Paquete chico", precio: 100 };
  const espia = falsoFetch([{ json: { id: "pref-1", init_point: "https://mp/x", sandbox_init_point: "https://mp/sandbox" } }]);
  const mp = crearMercadoPago({ accessToken: TOKEN, webhookSecret: SECRETO, buscar: espia });

  const r = await mp.crearPreferencia({
    orden: { id: "orden-1" }, paquete, moneda: "UYU",
    urlWebhook: "https://x/webhook", urlVuelta: "https://x/tienda.html",
  });

  const enviado = JSON.parse(espia.llamadas[0].opciones.body);
  ok(enviado.external_reference === "orden-1",
     "manda el id de NUESTRA orden como referencia, que es lo que permite reconciliar");
  ok(enviado.items[0].unit_price === 100,
     "y el precio del catálogo del servidor", enviado.items[0].unit_price);
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

console.log(fallos ? `\n❌ ${fallos} fallos\n` : "\n✅ TODO OK\n");
process.exit(fallos ? 1 : 0);
