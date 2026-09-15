/**
 * Manda al webhook una notificación FIRMADA de verdad, y mira qué contesta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUÉ PRUEBA, Y QUÉ NO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Prueba la mitad del camino que hoy no se puede ejercitar de otra forma: que
 * el secreto desplegado sea el que creemos, que el manifiesto se arme igual de
 * los dos lados, que la ventana de tiempo funcione, y que el HMAC coincida.
 * Todo eso es invisible hasta que llega un aviso de verdad, y cuando llega, si
 * está mal, se ve como un pago que no se acredita.
 *
 * NO prueba la acreditación. No puede: después de validar la firma, el webhook
 * le pregunta a la API de Mercado Pago cómo salió ese pago, y un id inventado
 * no existe. Esa negativa es justamente la regla más importante del archivo
 * —el aviso no dice que te pagaron, dice que MIRES— así que sondearlo también
 * comprueba que un aviso bien firmado de un pago inexistente NO acredite nada.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CÓMO SE LEE EL RESULTADO
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   401 «Firma inválida»        → la firma no pasó. El secreto desplegado no es
 *                                 el que usaste, o el reloj está corrido.
 *   500 «Sin configurar»        → los secretos no llegaron a la función.
 *   500 «No se pudo confirmar»  → LA FIRMA PASÓ. El webhook le preguntó a
 *                                 Mercado Pago por el pago, no existe, y no
 *                                 acreditó nada. Es el resultado bueno.
 *   200 cualquier cosa          → la firma pasó, y además MP contestó algo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LOS DOS 500 NO SIGNIFICAN LO MISMO, Y ESO YA CONFUNDIÓ UNA VEZ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La primera versión de esta sonda miraba SÓLO el código de estado y trataba
 * cualquier 500 como «faltan los secretos». La primera corrida de verdad
 * devolvió 500 «No se pudo confirmar» —que es el éxito— y la sonda dijo que
 * los secretos no habían llegado. Mandó a buscar el problema al lugar
 * equivocado, que es justo lo que vino a evitar.
 *
 * Peor: el comentario decía que el resultado bueno era un 200, y eso nunca se
 * verificó. Se supuso que `consultarPago` devolvería «no aprobado» ante un pago
 * inexistente; lo que hace es LANZAR, y el webhook lo convierte en ese 500.
 *
 * Por eso ahora la interpretación es una función aparte, con pruebas, y hay
 * una que recorre `functions/index.js` y falla si el webhook aprende a
 * contestar algo que esta sonda no sabe leer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL SECRETO SE LEE DEL ENTORNO, NO DE UN ARGUMENTO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Los argumentos quedan en el historial del shell y son visibles en la lista
 * de procesos de la máquina. Una variable de entorno de una sola línea no.
 *
 *   MP_WEBHOOK_SECRET='...' node herramientas/sondear-webhook.mjs
 *
 * No acredita nada y no puede: lo único que manda es un id que no existe.
 */

import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const URL_WEBHOOK =
  process.env.URL_WEBHOOK ??
  "https://us-central1-memorie-legends.cloudfunctions.net/webhookPago";

/**
 * El manifiesto, exactamente como lo arma el servidor.
 *
 * Está copiado a propósito y no importado: el sentido de la sonda es que dos
 * implementaciones independientes lleguen al mismo HMAC. Importando la del
 * servidor, un error en esa función daría verde acá y rojo en producción.
 */
export function firmarComoMercadoPago({ dataId, requestId, ts, secreto }) {
  const id = /^[a-z0-9]+$/i.test(String(dataId)) ? String(dataId).toLowerCase() : String(dataId);
  const manifiesto = `id:${id};request-id:${requestId};ts:${ts};`;
  const v1 = crypto.createHmac("sha256", secreto).update(manifiesto).digest("hex");
  return { manifiesto, cabecera: `ts=${ts},v1=${v1}` };
}

/**
 * Qué dice la respuesta del webhook sobre LA FIRMA, que es lo único que esta
 * sonda vino a averiguar.
 *
 * Devuelve `firmaPaso: true` cuando la respuesta sólo pudo producirse después
 * de validar la firma, `false` cuando no llegó hasta ahí, y `null` cuando es
 * algo que no sabemos leer — que no es lo mismo que un fallo, y decirlo así
 * evita dar por bueno o por malo lo que no se entendió.
 *
 * El orden de las comprobaciones del webhook es lo que hace posible esta
 * lectura: primero mira los secretos, después la firma, y recién entonces
 * todo lo demás. Así que cualquier respuesta que NO sea «sin configurar» ni
 * «firma inválida» ocurrió con la firma ya validada.
 */
export function interpretar({ status, cuerpo }) {
  const texto = String(cuerpo ?? "").toLowerCase();

  if (status === 401) {
    return { firmaPaso: false, que: "la firma no pasó" };
  }
  if (status === 500 && texto.includes("sin configurar")) {
    return { firmaPaso: false, que: "los secretos no llegaron a la función" };
  }
  if (status === 500 && texto.includes("no se pudo confirmar")) {
    return { firmaPaso: true, que: "la firma pasó; Mercado Pago no conoce ese pago" };
  }
  if (status === 500) {
    // Un 500 con otro cuerpo: pasó la firma —si no, sería 401— pero falló
    // más adelante, y eso merece mirarse en los logs.
    return { firmaPaso: true, que: "la firma pasó, pero algo falló después" };
  }
  if (status === 400) {
    return { firmaPaso: true, que: "la firma pasó; faltaba el id del pago" };
  }
  if (status === 200) {
    return { firmaPaso: true, que: `la firma pasó y el webhook contestó «${cuerpo}»` };
  }
  if (status === 405) {
    return { firmaPaso: false, que: "el webhook sólo acepta POST" };
  }
  return { firmaPaso: null, que: "respuesta que esta sonda no sabe leer" };
}

async function principal() {
  const secreto = process.env.MP_WEBHOOK_SECRET;
  if (!secreto) {
    console.error("\nFalta el secreto. Se lee del entorno para que no quede en el historial:\n");
    console.error("  MP_WEBHOOK_SECRET='...' node herramientas/sondear-webhook.mjs\n");
    process.exit(1);
  }

  // Un id que no existe en Mercado Pago, a propósito. Si existiera, esto
  // dejaría de ser una sonda y pasaría a mover saldo.
  const dataId = `sonda${Date.now()}`;
  const requestId = `sonda-${crypto.randomUUID()}`;
  const ts = Math.floor(Date.now() / 1000);

  const { cabecera } = firmarComoMercadoPago({ dataId, requestId, ts, secreto });

  const url = `${URL_WEBHOOK}?data.id=${encodeURIComponent(dataId)}&type=payment`;
  console.log(`\nMandando un aviso firmado a ${URL_WEBHOOK}`);
  console.log(`  data.id: ${dataId}  (no existe en Mercado Pago, a propósito)\n`);

  const respuesta = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-signature": cabecera,
      "x-request-id": requestId,
    },
    body: JSON.stringify({ type: "payment", data: { id: dataId } }),
  });

  const cuerpo = (await respuesta.text()).trim();
  console.log(`  HTTP ${respuesta.status}  ${cuerpo}\n`);

  const veredicto = interpretar({ status: respuesta.status, cuerpo });
  console.log(`  ${veredicto.que}\n`);

  if (veredicto.firmaPaso === true) {
    console.log("✅ La firma PASÓ.\n");
    console.log("   El secreto desplegado es el que usaste, el manifiesto se arma");
    console.log("   igual de los dos lados y la ventana de tiempo funciona.");
    console.log("   Y el pago no existe, así que no se acreditó nada — que es la");
    console.log("   otra mitad de lo que había que comprobar.\n");
    return;
  }

  if (veredicto.firmaPaso === false) {
    console.error("❌ La firma NO pasó.\n");
    if (respuesta.status === 401) {
      console.error("   El secreto desplegado no es el que usaste acá, o el reloj de");
      console.error("   esta máquina está corrido más de la ventana de gracia.");
      console.error("   El motivo exacto está en los logs de webhookPago.\n");
    } else {
      console.error("   Hace falta desplegar functions para que `runWith` monte los");
      console.error("   secretos.\n");
    }
    process.exit(1);
  }

  console.error("❓ Respuesta que esta sonda no sabe leer.\n");
  console.error("   Si el webhook aprendió a contestar algo nuevo, hay que enseñárselo");
  console.error("   a `interpretar` — y `pruebas/pagos.mjs` ya debería estar en rojo.\n");
  process.exit(1);
}

/** Sólo cuando se lo invoca directo. Rutas completas, no nombres de archivo. */
const invocadoDirecto =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invocadoDirecto) {
  principal().catch((e) => {
    console.error("\n❌ No se pudo sondear:", e.message, "\n");
    process.exit(1);
  });
}
