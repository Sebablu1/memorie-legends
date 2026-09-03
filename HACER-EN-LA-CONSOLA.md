# Lo que hay que hacer a mano en la consola de Firebase

Parte del código está **escrito y desplegado pero todavía sin exigir**. No es un
descuido: encender App Check antes de tiempo deja fuera del juego a todos los
que tengan la pestaña abierta desde antes, con su saldo adentro.

Cada sección dice qué hacer, en qué orden, y cómo darse cuenta de que salió
bien antes de encender nada.

---

## Estado al día de hoy

| Qué | Estado |
|---|---|
| App Check — clave puesta, token viajando | ✅ hecho |
| App Check — obligatorio | ⬜ pendiente, a propósito (ver §1) |
| 2FA (TOTP) — código escrito y QR comprobado | ✅ hecho |
| 2FA (TOTP) — encendido en el servidor | ✅ hecho por API (ver §2) |
| 2FA — probado por una persona de verdad | ⬜ falta tu prueba (ver §2) |
| Reportes | ✅ funcionando |
| Pagos (Mercado Pago) | ⬜ faltan los secretos (ver §3) |

---

## 1. App Check — que sólo la aplicación pueda llamar al servidor

**Qué protege.** Hoy cualquiera con la clave web —que viaja en cada carga del
sitio y no es un secreto— puede llamar a las Cloud Functions desde un script
propio. El límite de ritmo frena el bucle de una pestaña, pero no a alguien que
se arma un cliente para pedir salas en masa o llamar a la ruleta desde un
servidor.

### Lo que ya está hecho

- Sitio registrado con **reCAPTCHA Enterprise**, modo **Supervisión**.
- La clave del sitio está en `public/js/app-check.js`.
- El proveedor del SDK es `ReCaptchaEnterpriseProvider`. **No es intercambiable
  con `ReCaptchaV3Provider`**: una clave de Enterprise pasada al proveedor de v3
  no falla al construirse, falla después al pedir el token, y desde afuera se ve
  como "App Check no anda" sin decir por qué.
- Comprobá que estén autorizados los dominios `memorie-legends.web.app`,
  `memorie-legends.firebaseapp.com` y `localhost`.

### Antes de encenderlo — esto es lo importante

**Esperá al menos unos días** y mirá **App Check → APIs → Cloud Functions**. La
consola muestra cuántos pedidos llegan con token válido y cuántos sin él.

Los "sin token" no son todos atacantes: también son jugadores con la pestaña
abierta desde antes del despliegue, que van a seguir sin mandarlo hasta que
recarguen. Exigirlo el mismo día que se enciende los deja afuera del juego con
el saldo adentro. Por eso hay que mirar primero.

Cuando los pedidos sin token sean cerca de cero, hay **dos** interruptores y
conviene entender que son distintos:

- `EXIGIR_APP_CHECK = true` en `functions/index.js` — lo comprueban las Cloud
  Functions. Éste es el que importa para el juego.
- El modo **Obligatorio** en la consola — cubre Firestore y el resto.

Empezá por el primero. Si algo sale mal, volver atrás es ponerlo en `false` y
desplegar functions; son dos minutos.

---

## 2. Verificación en dos pasos (TOTP) — encendida, falta tu prueba

**Estado:** completa por código y **encendida en el servidor**. No queda nada
por configurar; queda probarla con una cuenta descartable.

**Se descartó el SMS** después de haberlo empezado. Los motivos, por si vuelve
a discutirse: cuesta por mensaje y se paga cada vez que alguien entra, obliga a
pedirle el teléfono a cada jugador —un dato personal que hoy no tenemos y que
habría que cuidar— y se lo roban con un cambio de SIM, que es el ataque común
contra cuentas con dinero. Un código de una aplicación no viaja por ningún lado.

### Ya está encendido, y no se hizo desde la consola

La opción no aparecía en la consola por un motivo concreto: **el segundo factor
estaba apagado del todo** (`state: DISABLED`, sin ningún factor), y la consola
no ofrece elegir TOTP mientras no haya nada encendido. Lo que estaba habilitado
en Authentication era el ingreso *con* teléfono, que es otra función con nombre
parecido.

Se encendió por la API de administración, con `herramientas/mfa.mjs`:

```
{ "state": "ENABLED", "factorIds": [], "providerConfigs": [
    { "state": "ENABLED", "totpProviderConfig": { "adjacentIntervals": 5 } } ] }
```

`adjacentIntervals: 5` son ±5 ventanas de 30 segundos, o sea **±2,5 minutos**
de tolerancia al desfase entre el reloj del teléfono y el del servidor. Es
holgado a propósito: un teléfono con la hora unos segundos corrida es lo más
común del mundo, y el precio de ser estricto lo paga alguien que no puede
entrar a su cuenta.

`factorIds` quedó vacío: el SMS no estaba encendido y no se encendió.

### La herramienta

```bash
CLAVE=/ruta/a/la/clave.json node herramientas/mfa.mjs
```

Sin argumentos muestra cómo está. `--activar` enciende TOTP, `--apagar` lo
apaga, `--probar` comprueba de punta a punta que el servidor emite un secreto
—crea una cuenta temporal y la borra siempre, incluso si algo falla a la
mitad—.

**`--apagar` es la vuelta atrás.** Si los dos pasos dan problemas, no hay que
esperar a nadie. Ojo con una cosa: apagar **no** le quita el factor a quien ya
lo tenga puesto; para eso hay que ir a Consola → Authentication → Users.

La credencial es una clave de cuenta de servicio y da **control total** del
proyecto. No está en el repositorio y `.gitignore` ahora tapa el nombre que la
consola les pone al descargarlas (`*-firebase-adminsdk-*.json`), que antes
faltaba. Si alguna vez se filtra: Google Cloud → IAM → Cuentas de servicio,
revocar y generar otra.

### Ya comprobado

Una cuenta temporal con el correo verificado pidió inscribir un segundo factor
y **el servidor le emitió el secreto**: 6 dígitos cada 30 segundos. La cuenta se
borró; el proyecto quedó con las 6 de siempre.

Eso demuestra que el interruptor funciona. Lo que **no** demuestra —y por eso
siguen los pasos de abajo— es que la pantalla del jugador haga bien las tres
cosas que le tocan: mostrar el QR, aceptar el código, y pedirlo al entrar.

### Probalo con una cuenta descartable ANTES de contárselo a nadie

Esto es lo que más me importa de toda la lista. El riesgo no es que no
funcione: es que funcione a medias y alguien quede afuera de su cuenta con
Leyendas adentro.

1. Registrá una cuenta nueva con un correo tuyo.
2. Verificá el correo (el botón está en *Tu cuenta*).
3. Entrá a *Tu cuenta* y activá los dos pasos. **Escaneá el QR** con Google
   Authenticator.
4. Escribí el código que aparece y confirmá.
5. **Cerrá sesión y volvé a entrar.** Tiene que pedirte el código y aceptarlo.
6. Probá a propósito un código equivocado: tiene que dejarte reintentar sin
   perder el progreso.
7. Probá también "No puedo escanear" → copiar la clave a mano en la
   aplicación. Es la salida de quien tenga la cámara rota, y tiene que dar los
   mismos códigos que el QR.
8. Volvé a *Tu cuenta* y quitá el factor. Cerrá sesión y entrá otra vez: no te
   tiene que pedir nada.

El QR ya está comprobado del lado del código: hay una prueba que lo dibuja,
le lee los píxeles y lo decodifica con un lector de verdad, y exige que
devuelva exactamente la URI de esa cuenta. Lo que esa prueba **no** puede
comprobar es que Identity Platform emita el secreto — para eso hacen falta los
ocho pasos de arriba.

Si alguno falla, avisame **antes** de contárselo a los jugadores: la página
`seguridad.html` ya dice que los dos pasos están disponibles.

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
| App Check (cliente) | `public/js/app-check.js` → `CLAVE_RECAPTCHA` | ✅ puesta (Enterprise) |
| App Check (servidor) | `functions/index.js` → `EXIGIR_APP_CHECK` | `false` — a propósito |
| 2FA (TOTP) | `node herramientas/mfa.mjs --activar` / `--apagar` | ✅ ENABLED, ±5 ventanas |
| Pagos | `functions:secrets:set` | ⬜ sin secretos |
