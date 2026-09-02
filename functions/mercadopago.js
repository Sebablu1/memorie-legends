/**
 * Mercado Pago: crear el checkout y confirmar que un pago ocurrió de verdad.
 *
 * ────────────────────────────────────────────────────────────────────────
 * LA REGLA QUE ORDENA TODO ESTE ARCHIVO
 * ────────────────────────────────────────────────────────────────────────
 *
 * El aviso del webhook NO dice que te pagaron. Dice que MIRES.
 *
 * Mercado Pago manda una notificación con un id y poco más. Lo que confirma el
 * pago es volver a preguntarle a MP por ese id y leer el `status` que responde
 * su API. La versión anterior de este webhook leía `estado === "pagado"` del
 * cuerpo del pedido: eso significa que cualquiera capaz de producir un cuerpo
 * aceptado acuñaba Leyendas.
 *
 * La firma ayuda pero no alcanza, y conviene entender por qué: el manifiesto
 * que MP firma cubre el `data.id`, el `x-request-id` y la marca de tiempo —no
 * el cuerpo entero—. Así que una firma válida NO garantiza que el resto del
 * cuerpo sea de MP. Por eso el estado se lee de la API y nunca del payload.
 *
 * ────────────────────────────────────────────────────────────────────────
 * CREDENCIALES
 * ────────────────────────────────────────────────────────────────────────
 *
 * Entran por variable de entorno y no viven en el código:
 *
 *   firebase functions:secrets:set MP_ACCESS_TOKEN     (Access Token de la app)
 *   firebase functions:secrets:set MP_WEBHOOK_SECRET   (clave del webhook)
 *
 * Las de sandbox y las de producción son distintas. Empezar por sandbox.
 */

const API = "https://api.mercadopago.com";

/**
 * Arma el cliente con sus dependencias, como el resto del proyecto.
 *
 * `fetch` entra inyectado para poder probar todo esto sin llamar a Mercado
 * Pago: las pruebas le pasan un doble que devuelve lo que haga falta, incluida
 * la respuesta de un pago rechazado o de un monto que no coincide.
 */
export function crearMercadoPago({
  accessToken,
  webhookSecret,
  buscar = globalThis.fetch,
  ahora = () => Date.now(),
  /** Tolerancia de reloj para la marca de tiempo de la firma. */
  msDeGracia = 5 * 60 * 1000,
}) {
  const cabeceras = () => ({
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  });

  // ─────────────────────────────────────────────── crear el checkout

  /**
   * Crea la preferencia y devuelve la URL a la que mandar al comprador.
   *
   * `external_reference` es el id de NUESTRA orden, y es lo que después
   * permite reconciliar: cuando MP avise, el pago va a traer esa referencia y
   * con ella se sabe a quién acreditar. Sin eso habría que confiar en algo que
   * mande el cliente.
   *
   * El precio sale del catálogo del servidor. Nunca de lo que pida el
   * navegador: ése es el punto por el que alguien pagaría 1 por un paquete de
   * 100.
   */
  async function crearPreferencia({ orden, paquete, moneda, urlWebhook, urlVuelta }) {
    const respuesta = await buscar(`${API}/checkout/preferences`, {
      method: "POST",
      headers: cabeceras(),
      body: JSON.stringify({
        items: [
          {
            id: paquete.id,
            title: paquete.nombre,
            quantity: 1,
            unit_price: paquete.precio,
            currency_id: moneda,
          },
        ],
        external_reference: orden.id,
        notification_url: urlWebhook,
        back_urls: {
          success: `${urlVuelta}?compra=ok`,
          pending: `${urlVuelta}?compra=pendiente`,
          failure: `${urlVuelta}?compra=error`,
        },
        auto_return: "approved",
      }),
    });

    if (!respuesta.ok) {
      const detalle = await respuesta.text().catch(() => "");
      throw new Error(`Mercado Pago rechazó la preferencia (${respuesta.status}): ${detalle.slice(0, 200)}`);
    }

    const datos = await respuesta.json();
    return {
      preferenciaId: datos.id,
      // `sandbox_init_point` sólo viene con credenciales de prueba. Que se use
      // una u otra lo decide la credencial, no una bandera nuestra: así es
      // imposible cobrar de verdad creyendo que se está probando.
      url: datos.sandbox_init_point ?? datos.init_point,
      esSandbox: Boolean(datos.sandbox_init_point),
    };
  }

  // ──────────────────────────────────────────────────── la firma

  /**
   * ¿La notificación viene de Mercado Pago?
   *
   * El esquema es el de MP y no un HMAC genérico sobre el cuerpo:
   *
   *   x-signature: ts=1704908010,v1=618c8534...
   *   x-request-id: c1a2b3...
   *
   *   manifiesto = `id:{data.id};request-id:{x-request-id};ts:{ts};`
   *   v1 = HMAC-SHA256(manifiesto, MP_WEBHOOK_SECRET) en hexadecimal
   *
   * El `data.id` que entra al manifiesto es el de la QUERY del pedido, no el
   * del cuerpo. Son el mismo valor cuando todo va bien, y justamente por eso
   * hay que tomar el que MP firmó y no el que el cuerpo dice.
   *
   * @param crypto  el módulo de node, inyectado para poder probarlo.
   */
  function verificarFirma({ firma, requestId, dataId, crypto }) {
    if (!webhookSecret) return { valida: false, motivo: "sin_secreto" };
    if (!firma || !dataId) return { valida: false, motivo: "faltan_datos" };

    const partes = Object.fromEntries(
      String(firma)
        .split(",")
        .map((p) => p.split("=").map((x) => x.trim()))
        .filter((p) => p.length === 2),
    );
    const { ts, v1 } = partes;
    if (!ts || !v1) return { valida: false, motivo: "firma_mal_formada" };

    // Una firma vieja se rechaza: si no, una notificación capturada sirve para
    // siempre. MP manda `ts` en segundos.
    const edad = Math.abs(ahora() - Number(ts) * 1000);
    if (!Number.isFinite(edad) || edad > msDeGracia) {
      return { valida: false, motivo: "firma_vencida" };
    }

    // El id se compara en minúsculas cuando es alfanumérico, como pide MP.
    const id = /^[a-z0-9]+$/i.test(String(dataId)) ? String(dataId).toLowerCase() : String(dataId);
    const manifiesto = `id:${id};request-id:${requestId ?? ""};ts:${ts};`;

    const esperada = crypto.createHmac("sha256", webhookSecret).update(manifiesto).digest("hex");

    // Comparación en tiempo constante: comparar con === filtra, por el tiempo
    // que tarda en fallar, cuántos caracteres del principio acertó quien
    // prueba. Y las longitudes se miran antes porque `timingSafeEqual` tira si
    // no coinciden.
    const a = Buffer.from(esperada, "utf8");
    const b = Buffer.from(String(v1), "utf8");
    const iguales = a.length === b.length && crypto.timingSafeEqual(a, b);

    return iguales ? { valida: true } : { valida: false, motivo: "no_coincide" };
  }

  // ────────────────────────────────────────── preguntarle a MP de verdad

  /**
   * Consulta el pago en la API de Mercado Pago.
   *
   * Esto es lo que confirma el cobro. Devuelve sólo lo que hace falta para
   * decidir, y `aprobado` se calcula acá para que quien llama no tenga que
   * acordarse de qué estados de MP cuentan como pagado.
   */
  async function consultarPago(idPago) {
    const respuesta = await buscar(`${API}/v1/payments/${encodeURIComponent(idPago)}`, {
      headers: cabeceras(),
    });

    if (!respuesta.ok) {
      throw new Error(`No se pudo consultar el pago ${idPago} (${respuesta.status})`);
    }

    const p = await respuesta.json();
    return {
      id: String(p.id),
      // `approved` es el único que acredita. `authorized` está retenido y
      // todavía puede caerse; tratarlo como pagado sería regalar Leyendas.
      aprobado: p.status === "approved",
      estado: p.status,
      detalle: p.status_detail,
      ordenId: p.external_reference ?? null,
      importe: Number(p.transaction_amount),
      moneda: p.currency_id,
      // Sirve para conciliar a mano si alguna vez hace falta.
      modoVivo: p.live_mode !== false,
    };
  }

  return { crearPreferencia, verificarFirma, consultarPago };
}

/**
 * ¿El pago se corresponde con la orden que dice pagar?
 *
 * Se comprueba aparte de `consultarPago` para poder probarlo solo, y porque es
 * la última reja antes de mover dinero:
 *
 *   - que la orden exista y sea la que el pago dice;
 *   - que el importe coincida con el del catálogo, no con el que venga;
 *   - que la moneda sea la misma;
 *   - que la orden no esté ya pagada.
 *
 * El importe se compara con céntimos de tolerancia porque MP devuelve un
 * número con decimales y comparar dos flotantes con `===` falla por nada.
 */
export function pagoCoincideConOrden(pago, orden, { moneda }) {
  if (!orden) return { ok: false, motivo: "orden_inexistente" };
  if (orden.estado === "pagado") return { ok: false, motivo: "ya_pagada" };
  if (pago.ordenId !== orden.id) return { ok: false, motivo: "referencia_distinta" };
  if (pago.moneda !== moneda) return { ok: false, motivo: "moneda_distinta" };
  if (!Number.isFinite(pago.importe) || Math.abs(pago.importe - orden.importe) > 0.01) {
    return { ok: false, motivo: "importe_distinto" };
  }
  return { ok: true };
}
