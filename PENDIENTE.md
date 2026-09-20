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

### ⚠️ El panel no manda sobre el precio todavía

**Hasta que se carguen los secretos de MP, el checkout sigue con la lista vieja
de packs. No cambiar precios esperando que tengan efecto.**

El motivo: `crearOrdenDeCompra` es la que lee el pack para cobrar, y en el
cambio del 13 de septiembre pasó a leerlo de Firestore en vez del código. Pero
esa función **declara los secretos de MP**, así que no se puede desplegar —
quedó con el código anterior, que usa la constante.

Hoy no tiene consecuencia real, porque esa función no cobra nada: contesta «los
pagos todavía no están habilitados». Pero significa que editar un precio desde
el panel **no cambia lo que se cobraría**. Se arregla solo con el
`firebase deploy --only functions` completo de más arriba.

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

## ~~3d. Dibujar marco y título en la sala de espera y en el ranking~~  ✅ HECHO

Las cuatro pantallas: perfil, mesa, sala de espera y ranking.

**El ranking traía un bug que esta nota no mencionaba.** La tabla pintaba
`f.nombre ?? f.uid ?? "Jugador"` y nadie escribía nunca `nombre` en la fila,
así que durante meses mostró el uid crudo de cada jugador — en la pantalla que
su propio comentario llama «la de mayor alcance del sitio». Se arregló con el
mismo cambio, porque es el mismo problema: la fila no tenía identidad.

**La decisión que la nota dejaba abierta la había cerrado la privacidad.** El
navegador no puede leer el perfil de otro jugador (`users/{uid}` es de lectura
sólo para su dueño), así que congelar en la fila no era una de dos opciones:
era la única. La alternativa de 50 lecturas por visita ni siquiera es posible.

Se congela `nombre`, `retrato`, `marco` y `titulo` al puntuar, desde
`identidadEnSala` —la misma función que visten la sala y la mesa—. Las filas
viejas dicen «Jugador» y se completan solas la primera vez que ese jugador
vuelve a puntuar.

Sí queda cierto lo que la nota advertía: quien compre un marco no lo ve en el
ranking hasta jugar otra partida. Es lo correcto para un registro histórico —
la fila dice cómo lucía cuando ganó ese puesto— pero conviene saberlo si
alguien pregunta.


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

## ~~7. El guardián de dobles no mira `firebase.js`~~  ✅ HECHO

**Resuelto.** No con la regla que se propuso —exigirle los 32 exports a cada
doble— sino con la correcta: cada doble tiene que exportar lo que la PÁGINA
que la prueba abre le pide, siguiendo la cadena de imports y cortando en los
módulos que la propia prueba dobla. Está en `pruebas/dobles-de-partida.mjs` y
cubre 21 pruebas. Comprobado que caza el caso original: quitándole `funciones`
y `httpsCallable` al doble de `sala-vestida.spec.js`, los nombra.

**Estado:** `pruebas/dobles-de-partida.mjs` vigila los dobles de
`partida-red.js` y de `servidor.js`, y comprueba que cada doble exporte todo lo
que exporta el módulo real. `firebase.js` no está en esa lista, y sí lo doblan
diecinueve pruebas de navegador.

**Qué se pierde:** un `import` con nombre de algo que el doble no exporta no
da `undefined`: rompe el módulo entero al enlazarlo, y con él a todo el que lo
importa. Pasó al escribir `sala-vestida.spec.js`: el doble traía tres exports,
`servidor.js` pedía `funciones` y `httpsCallable` del mismo archivo, y la sala
no se dibujaba nunca. Se ve como una espera hasta que vence el plazo, no como
un error.

**Por qué no se arregló en el momento:** la regla de los otros dos no sirve
acá. `firebase.js` es un mostrador que reexporta treinta y dos nombres y cada
pantalla usa un puñado distinto; exigirle a cada doble los treinta y dos
pondría en rojo a las diecinueve pruebas que hoy andan bien. La comprobación
correcta es otra: qué importa, en cadena, la página que la prueba abre.

**Mientras tanto:** los dobles nuevos de `firebase.js` copian el de
`sala-vestida.spec.js`, que los lleva todos, y ese archivo explica por qué.

---

## ~~8. El marco de la MESA tiene el mismo `width: auto`~~  ✅ HECHO

**Resuelto.** `mesa.css` lleva alto y ancho escritos en función de `--aro`, más
`object-fit: contain`. La prueba nueva de `marco-y-titulo.spec.js` mide el marco
PINTADO y no la caja que lo contiene, y se comprobó que falla con el CSS viejo.

**Estado:** `.jugador .retrato .marco-avatar`, en `public/css/mesa.css`, va en
posición absoluta con `width: auto; height: auto`. Una imagen reemplazada en
absoluto no se estira hasta los `inset`: se pinta al tamaño del archivo.

**Qué pasaría:** con un marco de 512 píxeles, el asiento queda tapado por el
marco. No mueve la caja del retrato —así que las pruebas que comparan tamaños
de asiento siguen en verde—, simplemente se pinta encima de todo. Se vio en la
sala de espera, que copiaba el mismo CSS, y ahí se arregló con un alto y un
ancho escritos más `object-fit: contain`.

**Por qué no urge:** hoy el único marco del catálogo es `marco_dorado` con
`imagen: "🖼️"`, un emoji. `esRutaDelSitio` lo rechaza y no se dibuja ningún
marco en ninguna pantalla. El problema aparece el día que se suba el arte de
verdad —el mismo día del punto de las imágenes de los packs—.

**Cómo:** copiar las tres líneas de `.marco-sala` en `public/css/sala.css`, y
una prueba que mida el marco pintado y no la caja que lo contiene; está escrita
en `pruebas/e2e/sala-vestida.spec.js` («el marco se achica a la ficha aunque el
archivo sea enorme») y se traduce derecho a `marco-y-titulo.spec.js`.

---

## 9. Alcance (b): los identificadores internos siguen diciendo «apuesta»

**Estado:** se cambió lo que se ve y lo que se escribe —el botón de la
revancha, su `aria-label`, y el motivo del libro mayor, que pasó de
`"apuesta"` a `"entrada_partida"`—. Los NOMBRES del código no:
`BONOS_APUESTA`, `bonoDeApuesta`, `dobleApuesta`, `apuestaDeLaMesa`,
`panelDeApuesta`, `calcularReparto({ apuesta })`, `partida.apuesta`,
`#apuestaRevancha`, `.apuesta-revancha`, y los comentarios de `ia.js`,
`motor.js`, `esquemas.js`, `admin.js`, `cierre.js` y `ranking.js`.

**Por qué no urge:** no los lee nadie de afuera. Un jugador no ve el nombre de
una función ni una clase de CSS, y los términos y condiciones hablan de lo que
el producto dice y hace, no de cómo se llaman sus variables.

**Por qué igual conviene:** el vocabulario del código es el que termina en la
pantalla cuando alguien agrega una función apurado. Mientras el motor diga
«apuesta», la próxima etiqueta nueva va a decir «apuesta».

**Cuándo hacerlo:** en una sesión propia y sin nada más encima. Toca
`mesa.js`, `economia.js`, `ranking.js` y el motor —los cuatro archivos más
delicados del proyecto— y es un renombrado grande sin ningún cambio de
comportamiento, que es exactamente el tipo de cambio que conviene no mezclar
con otro.

**Lo que NO se toca, nunca:** la frase del reglamento, «No son juegos de azar
ni apuestas». Es la que niega que esto sean apuestas y la que protege
legalmente; cambiarla debilita la defensa. Es la única vez que la palabra
aparece en todo el HTML.

---

## 10. Velocidad en red

**Estado:** diagnosticado y medido el 16 de septiembre. La fase 0a está hecha;
el resto, en el orden de abajo. **Costo fijo: $0 en todas.** Nada de
instancias mínimas.

### Lo que se midió

Desde la laptop de desarrollo, contra producción, con llamadas rechazadas sin
sesión —no tocan datos—, y en los registros de una partida real:

| Qué | Medido |
|---|---|
| Función en frío (contenedor) | **3,6 – 4,5 s** |
| La misma, tibia | 0,29 s |
| Primera llamada de cada instancia, *dentro* del handler | **~2 s** (primera conexión con Firestore + claves de tokens) |
| Las siguientes, dentro del handler | 200 – 290 ms |
| Cargar `firebase-functions/v1` | 1,3 s de los ~1,5 s del módulo |
| Una jugada que publica | 1 lectura · 5 escrituras · 13 KB |
| CPU del servidor por jugada | < 1 ms |

**La causa principal es el arranque en frío.** Las funciones son de primera
generación: una instancia atiende un pedido a la vez, con poca CPU, y sin
instancias mínimas. Con el tráfico de hoy, casi cada partida las encuentra
frías, y cada pedido simultáneo abre otra instancia que también arranca en
frío.

**Descartado con números:** mandar sólo el delta de las vistas (13 KB, no
ahorra nada medible y complica la parte que garantiza que nadie vea cartas
ajenas), las lecturas por jugada (1), la CPU, y los escuchas (2 documentos
chicos durante el juego). Mover las funciones de región tampoco: Firestore está
en `nam5` y las funciones en `us-central1`, mismo país.

### El orden acordado

1. ✅ **Fase 0a — el descarte que se perdía.** La llegada se sella al entrar al
   handler, antes de la transacción: arregla la primera conexión y, sobre
   todo, la COLA —el cuarto en descartar llegaba ~750 ms tarde por esperar a
   los otros tres, aun tibio—. Y la mesa precalienta `intentarDescarte` antes
   de cada ventana, con una lectura, para que el arranque lo pague otro
   pedido.
2. **Fase 3 — respuesta optimista** para tirar, cortar y pasar. No para
   levantar (la carta la conoce sólo el servidor) ni para descartar (depende
   del tiempo que mide el servidor).
3. **Fase 4 — menos choques.** `latir` que actualice su campo y no reescriba el
   documento entero cada cinco segundos por jugador; y un desfase al azar en
   los golpes cuando vence un plazo, que hoy salen los cuatro a la vez.
4. **Fase 0b — el toque directo a Firestore**, en su propia sesión junto con la
   1B. El cliente escribe el intento con `serverTimestamp()` y las reglas
   exigen que sea igual a `request.time`: una llegada que no se puede falsificar
   y que no pasa por ninguna función. Es la primera escritura del cliente bajo
   `partidas/`, así que las reglas pasan a ser frontera de seguridad y conviene
   sumar el emulador para probarlas de verdad — hoy sólo se prueba su texto.
5. **Fase 1B — migrar las funciones de juego a segunda generación**, con
   concurrencia: una instancia atiende muchos pedidos. `webhookPago` NO se
   mueve: su URL está en la lista de no tocar.

### Anotado para las fases 3 y 1B — no tocar antes

- **El `OPTIONS` antes de cada llamada.** Los registros muestran una
  verificación de CORS antes de cada jugada: un viaje de ida y vuelta más, unos
  250 ms. Una salida posible es llamar a las funciones desde el mismo dominio
  (`getFunctions(app, "https://memorielegends.com")` con reescrituras de
  Hosting), que no necesita esa verificación. Medirlo antes de decidir.
- **La transacción tibia en `nam5` tarda ~250 ms.** Son las escrituras
  confirmadas en varias regiones. Es un piso estructural: lo que se puede hacer
  es necesitar menos transacciones por jugada, no hacerlas más rápidas.

### Lo que 0a no arregla

Un toque que cae en un **contenedor** frío sigue llegando tarde: ese arranque
ocurre antes de que exista el handler. El precalentamiento lo vuelve raro, no
imposible. Lo resuelve 0b.

---

## 11. Anotado de paso — sin tocar

Encontrado mientras se trabajaba en otra cosa. Ninguno rompe nada hoy.

- **`FASES_SIN_RELOJ`, en `public/js/mesa.js`, tiene un nombre falso.** Las tres
  fases que agrupa —`levantada`, `poder` y `postLevantada`— tienen reloj desde
  los cronómetros de decisión. Su USO sigue siendo correcto: son las fases en
  las que `saltarAusente` puede actuar, porque `turno` lo cubre el plazo del
  servidor. Es el mismo error que tenía el comentario de `saltarAusente`, ya
  corregido. Un nombre como `FASES_QUE_RESCATA_EL_AUSENTE` diría la verdad.

- **`functions/limite-de-ritmo.js` lleva un byte nulo literal.** Está a propósito,
  como separador en la clave `${uid}\0${accion}`: es un carácter que no puede
  aparecer en un uid. Pero hace que `file` y `grep` traten el archivo como
  binario, y alguna herramienta podría truncarlo. Escribirlo como `"\u0000"`
  dejaría el mismo valor sin el byte crudo en el fuente.

- **Dos comentarios de documentación seguidos sobre `repartirEn`**, en
  `functions/partida-red.js`. El primero —«Reparte en el servidor…»— es el de
  `repartir`, que quedó separado de su función. Un editor muestra el de abajo
  y el de arriba no se lee en ningún lado.

- **El bloque «NUEVO: Permitir mirar (clic simple) en fase descarte»**, al
  principio de `clicEnCartaDeRed` en `public/js/mesa.js`. Un toque sobre una
  carta propia durante el descarte dice «Mirando tu carta…» y no muestra
  nada: en red la mano propia llega tapada, así que lo que se "revela" es el
  marcador de carta oculta. Además repite el descarte propio que ya existe más
  abajo, y deja esa otra rama sin uso. Desde el descarte al rival la entrega
  va antes que este bloque —era lo que la bloqueaba—, pero el bloque sigue ahí.

- **En entrenamiento, el aviso «la carta salió al azar» dura un instante** cuando
  la ventana ya había vencido: el cierre que esperaba la entrega escribe
  enseguida la pista siguiente («CORTAR O PASAR»). La carta sí sale y se oye el
  acierto; lo que se pierde es el texto. En red el aviso queda.

---

## 12. App Check — resolver los navegadores donde reCAPTCHA falla

**Estado:** apagado en el cliente desde el 16 de septiembre (`MANDAR_TOKEN =
false`, atado a `EXIGIR_APP_CHECK`). No protege nada hoy, y así estaba también
antes: el servidor nunca lo exigió.

**Qué pasó.** Con App Check inicializado, el SDK de Firebase no manda ninguna
llamada hasta tener respuesta sobre el token. En el navegador de un jugador
real, reCAPTCHA fallaba en cada llamada (`appCheck/recaptcha-error`), y
reproducido bloqueando su iframe, los dos primeros pedidos de token quedaron
colgados más de veinte segundos cada uno. Las primeras jugadas de la partida
esperaban eso antes de salir.

**Qué falta antes de exigirlo algún día:**

- **Saber cuántos navegadores fallan.** No son atacantes: son jugadores con
  extensiones de privacidad o con el almacenamiento de terceros bloqueado. El
  período de «mandar sin exigir y mirar la consola» ya no sirve para medirlo,
  porque mandarlo es justamente lo que les arruinaba la partida.
- **Decidir qué hacer con ellos.** Opciones a evaluar, ninguna probada: otro
  proveedor de atestación; pedir el token con un límite de tiempo propio en
  vez de dejar que el SDK espere; o aceptar que quien bloquee reCAPTCHA no
  pueda jugar por Leyendas, avisándole por qué en vez de colgarle la mesa.
- **Encender los dos interruptores juntos**, en el mismo despliegue.

**Cómo se sabe que se resolvió:** hay un número de navegadores que fallan, una
decisión sobre ellos, y una partida jugada con App Check exigido desde un
navegador con bloqueo de terceros que o funciona, o explica por qué no.

---

## 13. La mirada inicial — anotado al arreglar la primera ronda

Desde el 17 de septiembre la ronda 1 en red espera a que lleguen todos y corre
la cuenta regresiva antes de abrir la mirada. Tres cosas quedaron afuera a
propósito, porque no eran ese arreglo. La primera ya está hecha; quedan dos.

- ~~**En red, la mirada dura dos segundos EN TOTAL; en entrenamiento, cinco
  para elegir y dos para ver.**~~ **RESUELTO el 20 de septiembre de 2026.** La
  fase `mirar` dura `MS_MIRADA_TOTAL` —`MS_ELEGIR_MIRADA` (5 s) más `MS_MIRAR`
  (2 s)— en los dos modos, y la ventana de la ronda se estiró con ella:
  `MS_VENTANA_TOTAL = MS_MIRADA_TOTAL + MS_VENTANA`, ahora en `reglas/red.js`.
  Los cinco segundos del descarte quedaron enteros. Lo comprueba
  `pruebas/mirar-descarte.mjs`, sección 2b: una mirada al cuarto segundo se
  acepta, y a los siete se cierra.

  Era una diferencia entre modos contra la regla de «entrenamiento = red», y
  **ya había pasado en producción**: partida del 17 de septiembre, 07:19:47
  UTC, una mirada llegó al final de los dos segundos a una instancia recién
  arrancada —1679 ms dentro de la función— y `accionDePartida` la rechazó con
  400. Eso sigue relacionado con el punto 10 (arranques en frío): ahora hay
  cinco segundos más de margen, pero el arranque en frío no desapareció.

- **`cerrarMirada` puede cortar la mirada antes de tiempo.** Ya no antes de que
  abra —eso se tapó—, pero una vez abierta cualquiera de los cuatro puede
  llamarla y terminarla para todos. **Y ahora el hueco es más grande**: la
  mirada dura siete segundos en vez de dos, así que hay siete segundos en los
  que un cliente modificado se la puede cortar a los otros tres. El plazo del
  servidor la cierra solo, así que el cliente no necesita llamarla: se podría
  exigir que haya vencido `abiertaEn + MS_MIRADA_TOTAL`, o sacarla. Ninguna
  pantalla la llama hoy — `public/js/partida-red.js` la exporta y nadie la usa.

- **En entrenamiento, tocar una carta durante la cuenta regresiva dice «Una
  sola carta por ronda».** La fase ya es `mirar` pero `faseMirada` todavía no
  puso su manejador, y la mesa toma el toque como un segundo intento. Las
  cartas, además, se ven tocables durante la cuenta. En red ya no pasa:
  `miradaTodaviaCerrada` las apaga. En entrenamiento el aviso correcto sería
  no decir nada, como en red.

---

## Y algo que no está roto, pero falta

**No existe el otorgamiento manual de insignias.** `tienda.otorgar` está del
lado del servidor y sólo lo llama `insignias.js` al cerrar una partida o un
período de ranking: no hay callable ni botón en el panel. Se dio por existente
en un pedido anterior. Se construye rápido cuando haga falta.
