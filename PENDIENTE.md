# Pendiente

Lo que está esperando algo — a Meta, a un banco, a una decisión, o a una
próxima sesión. Cada punto dice **qué falta**, **de quién depende** y **cómo se
sabe que se resolvió**.

Última revisión: 13 de septiembre de 2026.

---

## 0. Dónde quedó la sesión del 13 de septiembre

### Lo que quedó hecho

- **Los cinco packs nuevos**, con la tabla acordada: Básico $250 (300+50),
  Popular $450 (600+150), Premium $1.000 (1.500+500), Élite $2.500
  (5.000+2.000) y Memorie Legends $5.000 (12.000+3.000). El Básico viejo de
  $100 se eliminó.
- **Los packs salieron del código** y viven en `tienda/packs/items/{id}`, con
  la semilla de `economia.js` como respaldo si la colección queda vacía.
- **CRUD completo en el panel**: crear, editar, activar/desactivar, borrar con
  confirmación por id, y selector múltiple de artículos exclusivos. Con las dos
  salvaguardas pedidas — nombres escapados y precio validado contra un rango.
- **Tres tipos nuevos** en el catálogo: `marco`, `titulo` y `sello`. Ninguno se
  vende con Leyendas; el sello además no se equipa.
- **12 artículos exclusivos** sembrados, marcados con `packExclusivo`. No se
  compran sueltos ni se ganan jugando, y una insignia no puede ser exclusiva de
  un pack.
- **El webhook entrega los artículos** al acreditar, desde la orden congelada y
  fuera de la transacción del pago.
- **El sello se ve en el perfil**, en una tira arriba de las insignias.
- **El marco y el título se ven en la mesa**: el marco superpuesto sobre la
  cara —no como borde, para que los asientos sigan midiendo lo mismo— y el
  título al lado del nombre, escapado.
- **Órdenes huérfanas**: el token se comprueba antes de escribir la orden.

### Lo que falta

- **Marco y título en la sala de espera** (~1–1,5 h). El dato ya está en la
  sala; lo que falta es que la sala dibuje un avatar, porque hoy muestra una
  inicial en un círculo.
- **Marco y título en el ranking** (~2–3 h **más una decisión**). La tabla no
  tiene avatares y la fila no tiene cosméticos; habría que escribirlos desde el
  servidor en el cierre, lo que los **congela** hasta la próxima partida. Esa
  decisión merece su propia sesión.

### ⚠️ La suite de navegador no se completó

Quedó cortada en **77 de 253**, sin ningún fallo hasta ahí. **Node sí pasó
entero: 52/52.**

Antes de desplegar hay que correrla completa y sola:

```bash
npx playwright test
```

Y sola de verdad: nada de Node en paralelo, que la mesa usa temporizadores
reales y `workers: 1`.

### ⚠️ Élite y ML hay que sembrarlos y apagarlos, en ese orden

Se decidió no vender esos dos packs hasta que lo visual esté completo. **No
alcanza con apagarlos**: la colección está vacía en producción, así que el
panel muestra los cinco del código con el cartel «⚠️ Estos son los del código,
no los de la base», y ahí el botón *Retirar* no hace nada.

El orden es:

1. `/admin/` → **Sembrar catálogo** — trae los 12 artículos exclusivos. Sin
   ellos, guardar un pack que los promete se rechaza.
2. `/admin/` → **Sembrar paquetes** — escribe los cinco. No pisa lo que ya esté.
3. Recién ahí, **Retirar** el Élite y el ML.

### Nada desplegado

Este trabajo está sólo en `main`. No se desplegó hosting, ni functions, ni
reglas.

---

## 1. WhatsApp Business — en revisión por Meta

**Estado:** esperando a Meta. No hay nada que hacer del lado del código.

**Cómo se sabe que se resolvió:** Meta avisa por correo y la cuenta pasa a
aprobada en el panel de WhatsApp Business.

---

## 2. Secretos de Mercado Pago — esperando app estable

**Estado:** los dos secretos **no existen** en el proyecto de Firebase.
Decisión tomada: no se cargan todavía, para probar la app completa sin pagos
primero.

**Consecuencia mientras tanto — los pagos están caídos:**

| Función | Qué hace hoy |
|---|---|
| `crearOrdenDeCompra` | responde «Los pagos todavía no están habilitados» |
| `webhookPago` | contesta HTTP 500 «Sin configurar» a cada aviso |

El 500 es deliberado: hace que Mercado Pago reintente en vez de dar el aviso
por entregado y perder el pago. Pero MP reintenta con espera creciente y por
una ventana limitada, así que **no es una red de seguridad indefinida**.

**Qué hay que hacer cuando se decida activarlos:**

```bash
npx firebase functions:secrets:set MP_ACCESS_TOKEN
```

```bash
npx firebase functions:secrets:set MP_WEBHOOK_SECRET
```

```bash
npx firebase deploy --only functions
```

Ese despliegue está pendiente desde el 10 de septiembre: falló por estos
secretos y sólo entraron seis funciones a mano (`avanzarPartida`,
`cerrarPartida`, `barrerPartidas` y los tres cierres de ranking). **Las dos
funciones de pago siguen con código viejo**, o sea que el webhook del Pack
Élite todavía escribe `comprador-elite` en `users/{uid}.insignias`. Es inocuo
—nadie lee ese campo— pero es lo último que falta del cambio de insignias.

**Cómo se sabe que se resolvió:**

```bash
curl -s -X POST https://us-central1-memorie-legends.cloudfunctions.net/webhookPago -H "Content-Type: application/json" -d "{}"
```

Tiene que contestar **`Firma inválida`** (401). Si dice `Sin configurar` (500),
los secretos siguen sin llegar al runtime.

**Y después, conciliar `ordenes`:** las que quedaron en `pendiente` **con**
`transaccionId` son pagos reales sin acreditar y hay que resolverlas a mano.
Las que están en `pendiente` **sin** `transaccionId` son intentos que nunca
llegaron a MP y se pueden descartar. Desde el 13 de septiembre ya no se crean
órdenes nuevas cuando faltan las credenciales, así que la basura tiene fecha de
corte.

---

## 3. Cuenta bancaria de Mercado Pago — pendiente

**Estado:** sin resolver. Bloquea el retiro del dinero, no el cobro.

**Cómo se sabe que se resolvió:** la cuenta figura verificada en el panel de
Mercado Pago y admite transferencias.

---

## 3b. Sembrar los paquetes en producción

**Estado:** los cinco packs nuevos están en el código, pero la colección
`tienda/packs/items` está vacía en producción.

Mientras esté vacía la tienda funciona igual —cae a la semilla del código— y
el panel lo dice con todas las letras. Pero **no se pueden editar** hasta que
existan: editar algo que no está guardado no hace nada.

**Qué hacer:** `/admin/` → *Sembrar paquetes*. No pisa lo que ya esté.

Y antes o después, `/admin/` → *Sembrar catálogo*, que ahora también trae los
12 artículos exclusivos de los packs. Sin ellos, guardar un pack desde el
panel se rechaza: el servidor comprueba que lo que promete exista.

---

## 3c. Arte de los 12 artículos exclusivos

**Estado:** los doce usan un emoji como imagen. Se dibujan bien en la tienda y
en la vitrina, pero son marcadores de posición.

Se eligió emoji y no una ruta a `/img/packs/…` a propósito: un archivo que no
existe deja la imagen rota en producción y la prueba en verde, porque sólo se
comprueba que exista el archivo cuando la imagen ES una ruta.

Los doce: `avatar_iniciado`, `dorso_viajero`, `avatar_erudito`,
`pano_terciopelo`, `avatar_soberano`, `dorso_soberano`, `mazo_soberano`,
`pano_soberano`, `marco_dorado`, `titulo_elite`, `sello_fundador`,
`avatar_leyenda_viva`.

---

## 3d. Dibujar marco, título y sello donde corresponde

**Estado:** los tres tipos existen, se poseen y —marco y título— se equipan.
**Todavía no se dibujan en ningún lado.**

Lo que falta es mostrarlos: el marco alrededor del avatar en ranking, lobby y
mesa; el título al lado del nombre en ranking y lobby; el sello en el perfil.
Es trabajo de pantalla en cuatro lugares distintos y quedó fuera de esta
tanda.

Mientras tanto, quien compre el Élite o el ML **recibe** el marco y el título
—están en su inventario y los puede equipar— pero no los ve puestos. Conviene
resolverlo antes de vender esos dos packs.

---

## 4. Los 48 frentes de cartas — próxima sesión

**Estado:** trabajo de contenido, no de código. Sin empezar.

**Contexto que conviene tener a mano:** los dorsos y los frentes son cosas
distintas. Los dorsos ya funcionan como artículo de tienda —hay dos, a 0 y a
100— y siguen siendo el hueco real de catálogo que quedó anotado: harían falta
dos o tres diseños más.

**Restricción vigente:** no usar `sharp`.

---

## 5. Limpiar datos viejos en los perfiles

**Estado:** sin hacer. No molesta a nadie, pero confunde.

**Qué hay:** el array `users/{uid}.insignias` puede tener escritos `dorada`,
`plateada`, `bronce`, `top10` o `comprador-elite`. Son de los dos sistemas de
insignias que no se hablaban, y ninguno de esos cinco ids existió nunca en el
catálogo.

**Por qué no urge:** ninguna función ni ninguna pantalla lee ese campo. Lo que
un jugador tiene vive en `users/{uid}/items/`, y eso es lo que mira
`misInsignias`. El campo ya no se escribe más —salvo desde el webhook de pago,
que sigue con código viejo (ver punto 2)— así que la lista está congelada.

**Cuándo hacerlo:** después de desplegar functions completo. Antes no tiene
sentido, porque el webhook viejo seguiría agregando.

**Cómo:** un borrado de campo por perfil, `FieldValue.delete()` sobre
`insignias`. No toca saldos ni posesiones. Conviene contar cuántos perfiles lo
tienen antes de decidir si vale la pena.

---

## 6. Imágenes de build en GCR

**Estado:** el despliegue del 10 de septiembre avisó:

> Unhandled error cleaning up build images. This could result in a small
> monthly bill if not corrected.

**Qué hacer:** se borran a mano en
`https://console.cloud.google.com/gcr/images/memorie-legends/us/gcf`, o se van
solas en el próximo despliegue que sí logre limpiar.

**Cómo se sabe que se resolvió:** el despliegue siguiente no repite el aviso, y
la facturación de Artifact Registry deja de crecer.

---

## Y algo que no está roto, pero falta

**No existe el otorgamiento manual de insignias.** `tienda.otorgar` está del
lado del servidor y sólo lo llama `insignias.js` al cerrar una partida o un
período de ranking: no hay callable ni botón en el panel. Se dio por existente
en un pedido anterior. Se construye rápido cuando haga falta.
