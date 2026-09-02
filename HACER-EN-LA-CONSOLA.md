# Lo que hay que hacer a mano en la consola de Firebase

Tres cosas del código quedaron **escritas, desplegadas y apagadas**. No es un
descuido: encender cualquiera de las dos primeras sin hacer antes su paso de
consola deja a todos los jugadores fuera del juego, con su saldo adentro.

Cada sección dice qué hacer, en qué orden, y cómo darse cuenta de que salió
bien antes de encender nada.

---

## 1. App Check — que sólo la aplicación pueda llamar al servidor

**Qué protege.** Hoy cualquiera con la clave web —que viaja en cada carga del
sitio y no es un secreto— puede llamar a las Cloud Functions desde un script
propio. El límite de ritmo frena el bucle de una pestaña, pero no a alguien que
se arma un cliente para pedir salas en masa o llamar a la ruleta desde un
servidor.

### Pasos

1. **Consola → App Check → Empezar.**
2. En la pestaña **Apps**, registrá la app web `memorie-legends`.
3. Elegí **reCAPTCHA v3** como proveedor. La consola te va a pedir crear las
   claves o te las genera.
4. Copiá la **clave del sitio** (la pública, la que empieza con `6L...`).
5. Pegala en `public/js/app-check.js`:

   ```js
   const CLAVE_RECAPTCHA = "6Lxxxxxxxxxxxxxxxxxxxxxxxxxxx";
   ```

   > La clave del sitio es pública y va en el repositorio sin problema. La
   > **clave secreta** se queda en la consola y no toca este repositorio nunca.

6. Verificá que los dominios estén autorizados en la configuración de
   reCAPTCHA: `memorie-legends.web.app`, `memorie-legends.firebaseapp.com` y
   `localhost` si querés probar en local.
7. Desplegá el hosting.

### Antes de encenderlo — esto es lo importante

**Esperá al menos unos días** y mirá **App Check → APIs → Cloud Functions**. La
consola muestra cuántos pedidos llegan con token válido y cuántos sin él.

Los "sin token" no son todos atacantes: también son jugadores con la pestaña
abierta desde antes del despliegue. Por eso hay que darle tiempo.

Cuando los pedidos sin token sean cerca de cero:

- Poné `EXIGIR_APP_CHECK = true` en `functions/index.js` y desplegá functions.
- (Opcional) Activá el modo obligatorio también desde la consola.

Si algo sale mal, volver atrás es poner la constante en `false` y desplegar.

---

## 2. Verificación en dos pasos (2FA) — hace falta subir a Identity Platform

**Estado hoy:** el código está entero (`public/js/mfa.js`, `public/cuenta.html`,
y el segundo paso en el login). Si un jugador entra a *Tu cuenta* y toca
"Activar", va a leer *"todavía no está habilitada en el servidor"*. Eso es lo
correcto hasta que hagas esto.

**Por qué:** Firebase Auth a secas no tiene segundo factor. Hace falta subir el
proyecto a **Identity Platform**, que es gratis hasta 50.000 usuarios activos
por mes y ya está disponible porque el proyecto está en Blaze.

### Pasos

1. **Consola → Authentication → Settings → pestaña "Multi-factor".**
2. Vas a ver el ofrecimiento de **actualizar a Identity Platform**. Aceptalo.
   - Revisá el precio en esa misma pantalla antes de aceptar. Con la cantidad
     de cuentas que tenés hoy, cae en el tramo gratis.
3. Habilitá **TOTP (aplicación de autenticación)**.
   - No hace falta SMS. Se eligió TOTP a propósito: no cuesta por mensaje, no
     obliga a pedirle el teléfono a cada jugador, y no se lo roban con un
     cambio de SIM —que es el ataque común contra cuentas con dinero—.

### Probalo con una cuenta descartable ANTES de contárselo a nadie

Esto es lo que más me importa de toda la lista. El riesgo de 2FA no es que no
funcione: es que funcione a medias y alguien quede afuera de su cuenta con
Leyendas adentro.

1. Registrá una cuenta nueva con un correo tuyo.
2. Verificá el correo.
3. Entrá a `cuenta.html` y activá los dos pasos con Google Authenticator.
4. **Cerrá sesión y volvé a entrar.** Tiene que pedirte el código y aceptarlo.
5. Probá a propósito un código equivocado: tiene que dejarte reintentar sin
   perder el progreso.
6. Volvé a `cuenta.html` y quitá el factor. Cerrá sesión y entrá otra vez: no
   te tiene que pedir nada.

Recién cuando los seis pasos anden, avisale a los jugadores. Y actualizá
`seguridad.html`, donde hoy dice que 2FA todavía no está activa.

### Si alguien se queda afuera

Consola → **Authentication → Users** → buscá la cuenta → quitale el segundo
factor. Es la única salida y hay que hacerla a mano; está avisado en la propia
pantalla de activación.

---

## 3. Mercado Pago — sigue pendiente de antes

Los secretos no existen todavía, así que las dos funciones de pago
(`crearOrdenDeCompra` y `webhookPago`) **no se pueden desplegar**. Por eso los
despliegues de functions van con lista explícita y las excluyen.

```bash
npx firebase-tools functions:secrets:set MP_ACCESS_TOKEN
```

```bash
npx firebase-tools functions:secrets:set MP_WEBHOOK_SECRET
```

Después de eso ya se puede desplegar todo junto, y hay que registrar la URL del
webhook en el panel de Mercado Pago:

```
https://us-central1-memorie-legends.cloudfunctions.net/webhookPago
```

---

## Resumen de interruptores

| Qué | Dónde se enciende | Estado hoy |
|---|---|---|
| App Check (cliente) | `public/js/app-check.js` → `CLAVE_RECAPTCHA` | vacío = apagado |
| App Check (servidor) | `functions/index.js` → `EXIGIR_APP_CHECK` | `false` |
| 2FA | Consola → Authentication → Multi-factor → TOTP | sin habilitar |
| Pagos | `functions:secrets:set` | sin secretos |
