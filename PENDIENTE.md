# Pendiente

Lo que está esperando algo — a Meta, a un banco, a una decisión, o a una
próxima sesión. Cada punto dice **qué falta**, **de quién depende** y **cómo se
sabe que se resolvió**.

Última revisión: 27 de septiembre de 2026.

---

## 0. Registro histórico — la sesión del 13 de septiembre

> **Esto es un registro de aquel día, no un estado actual.** Se conserva
> porque explica por qué los packs están como están, pero tres de sus
> afirmaciones dejaron de ser ciertas. Verificado el 27 de septiembre:
>
> | Decía | Hoy |
> |---|---|
> | «Nada desplegado» | Se desplegó todo el 27/09: hosting, las 81 funciones y las reglas |
> | «La suite quedó cortada en 77 de 253» | Corrió entera: **429 pasadas** |
> | «Élite y ML hay que sembrarlos y apagarlos» | Hecho: los 5 packs están sembrados y esos dos, retirados (ver §3b) |
>
> Lo de abajo queda tal como se escribió aquel día.

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

### Lo que faltaba aquel día, y ya está

Marco y título en la sala de espera y en el ranking. Se hizo: ver §3d.
---

## 1. WhatsApp Business — en revisión por Meta

**Estado:** esperando a Meta. No hay nada que hacer del lado del código.

**Cómo se sabe que se resolvió:** Meta avisa por correo y la cuenta pasa a
aprobada en el panel de WhatsApp Business.

---

## 2. Los pagos están listos, y la venta apagada a propósito

**Estado, verificado el 27 de septiembre:** el servidor puede cobrar. Lo que
falta no es técnico.

| Qué | Estado |
|---|---|
| `MP_ACCESS_TOKEN` | existe desde el 14/09 (versión 3) |
| `MP_WEBHOOK_SECRET` | existe desde el 14/09 |
| `MP_PUBLIC_KEY` | existe desde el 14/09 |
| `crearOrdenDeCompra` | desplegada el 27/09, recibe los dos secretos |
| `webhookPago` | desplegada el 27/09, recibe los dos secretos |

La prueba que esta misma sección proponía ya da el resultado de «resuelto»:

```
curl -s -X POST https://us-central1-memorie-legends.cloudfunctions.net/webhookPago -H "Content-Type: application/json" -d "{}"
```

Contesta **`Firma inválida`** (401). Cuando faltaban los secretos contestaba
`Sin configurar` (500).

### La venta está apagada, y es una decisión de negocio

`SOLO_ADMIN_COMPRA = true`, en `functions/index.js`. Con eso, `listarPacks`
devuelve `compra.habilitada` en `false` para cualquiera que no sea
administrador, y los botones de la tienda nacen apagados y no se encienden.
**Sólo la cuenta de administración puede probar compras.**

**No es un estado transitorio ni una tarea pendiente: es hasta que el juego
esté completo.** Vender antes sería cobrar por algo que todavía se está
armando.

**No habilitar sin una decisión explícita del dueño del sitio.** El día que se
decida, es cambiar esa constante y desplegar las funciones — nada más. Por eso
conviene que quede escrito acá: la facilidad del cambio es justamente el
riesgo.

### Lo que sí quedó resuelto de las notas viejas

- **El panel ya manda sobre el precio.** La advertencia anterior decía que no,
  porque `crearOrdenDeCompra` no se podía desplegar. Se desplegó el 27/09.
- **Las órdenes viejas no esconden ningún pago.** Hay 7, todas en `pendiente`
  y **ninguna con `transaccionId`**: según el criterio de esta misma sección,
  son intentos que nunca llegaron a Mercado Pago y se pueden descartar. No hay
  ningún pago real sin acreditar.
- **El webhook ya no escribe insignias con el código viejo**, así que lo de §5
  quedó sin efecto.

**Lo que falta para cobrar de verdad:** §3, la cuenta bancaria, que bloquea
retirar el dinero, no cobrarlo.
---

## 3. Cuenta bancaria de Mercado Pago — pendiente

**Estado:** sin resolver. Bloquea el retiro del dinero, no el cobro.

**Cómo se sabe que se resolvió:** la cuenta figura verificada en el panel de
Mercado Pago y admite transferencias.

---

## ~~3b. Sembrar los paquetes en producción~~  ✅ HECHO

Verificado en producción el 27 de septiembre:

- **`tienda/packs/items`: los cinco.** `basico`, `popular` y `premium`
  activos; `elite` y `ml` **retirados**, que era el orden que pedía la nota.
- **`catalogo`: 41 artículos**, con los **12 exclusivos** de los packs
  presentes. Sin ellos el panel habría rechazado guardar un pack que los
  promete, así que su presencia es la prueba de que la siembra corrió entera.

El panel ya manda: los packs se pueden editar porque existen en la base, y no
se cae a la semilla del código.

Queda abierto lo visual de esos 12 artículos, que es §3c.
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

## ~~5. Limpiar datos viejos en los perfiles~~  ✅ SIN NADA QUE HACER

Contado en producción el 27 de septiembre: **0 de 24 perfiles** tienen el
array `users/{uid}.insignias`. No hay nada que limpiar.

La nota decía que había que esperar a desplegar las funciones completas,
porque el webhook viejo seguía agregando ids que no existían en el catálogo
—`dorada`, `plateada`, `bronce`, `top10`, `comprador-elite`—. Ese despliegue
se hizo el 27/09, así que la fuente está cortada y el recuento es cero.

Si alguna vez vuelve a aparecer el campo, querría decir que algo lo escribe de
nuevo, y eso sí sería un hallazgo.
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

- ~~**Dos comentarios de documentación seguidos sobre `repartirEn`**~~ ✅
  **HECHO el 30/9/2026** (`73c0972`, sólo comentario, sin despliegue): borrado
  el comentario huérfano. Texto original, en
  `functions/partida-red.js`: el primero —«Reparte en el servidor…»— es el de
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

- ~~**`cerrarMirada` puede cortar la mirada antes de tiempo.**~~ **RESUELTO el
  30 de septiembre de 2026** (`8b1d80c`, hecho a mano): `cerrarMirada` en
  `functions/partida-red.js` ahora exige que la ventana haya vencido antes de
  aceptar la llamada. Desplegada sólo esa función; suite `mirar-descarte.mjs`
  verde. Texto original: «Ya no antes de que abra —eso se tapó—, pero una vez
  abierta cualquiera de los cuatro puede llamarla y terminarla para todos.
  **Y ahora el hueco es más grande**: la
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

## 14. ~~La pimienta de los códigos privados~~ — RESUELTO el 20/9/2026

Las salas privadas guardan el HASH del código, nunca el código. El hash lleva
una pimienta que sale del entorno de las funciones:

```
PIMIENTA_CODIGOS
```

**Está en Secret Manager** y las dos callables lo declaran con
`runWith({ secrets: ["PIMIENTA_CODIGOS"] })`, que en Functions v1 es lo único
que hace que el secreto llegue al entorno.

**Lo que salió mal en el medio, y por qué quedó anotado igual:** el primer
despliegue subió las dos funciones SIN declarar el secreto. El código leía
`process.env.PIMIENTA_CODIGOS ?? ""`, así que el `??` tapaba la falta: el
servidor hasheaba con cadena vacía y contestaba 200. Un servicio caído se
arregla en un despliegue; uno que parece andar y guarda hashes sin pimienta
hay que rehacerlo entero.

Ahora, sin pimienta, las dos funciones fallan con `failed-precondition` y no
escriben nada. Lo comprueban las secciones 11 y 12 de
`pruebas/salas-privadas.mjs`, la segunda leyendo `functions/index.js`: el bug
no estuvo en la lógica sino en cómo se declaró la función, y eso sólo se ve
mirando el texto.

**Lo que sigue en pie:** cambiar la pimienta invalida todos los códigos vivos.
Los que ya estén dentro de una sala siguen jugando; las invitaciones sin usar
dejan de servir. Y las salas privadas creadas entre el despliegue del 20 de
septiembre y este arreglo tienen su hash sin pimienta: sus códigos ya no
abren nada.

---

## 15. `desposeer` devuelve el precio de lista, no lo que se pagó

**Estado:** anotado el 21/9/2026, al arreglar las devoluciones (Bloque 0 del
rediseño del lobby). Sin tocar, por decisión.

Cada posesión guarda `precioPagado: a.precio`, que es el precio de LISTA del
artículo. Pero un pack de artículos se cobra con descuento (`precioDePack`), así
que lo que la persona pagó de verdad por cada uno es menos. Cuando la
administración le saca un artículo con `desposeer`, se le devuelve el precio de
lista: más de lo que le costó.

Ejemplo: tres artículos de 100 en un pack con 20 % de descuento se cobran 240.
Sacarle uno devuelve 100, no 80; sacarle los tres devuelve 300.

- **Por qué no urge:** `desposeer` sólo lo dispara un administrador, y hasta
  hoy se usó sobre artículos de prueba de la propia cuenta de administración.
- **Qué falta:** una decisión. Lo más directo es guardar en la posesión lo que
  se pagó de verdad —el total del pack repartido entre sus artículos— y
  devolver eso.
- **Cómo se sabe que se resolvió:** una prueba en `pruebas/tienda.mjs` compra
  un pack con descuento, le saca sus artículos uno por uno y comprueba que lo
  devuelto no supera lo cobrado.

Desde el Bloque 0, la devolución vuelve a cada bolsillo en la proporción del
cobro del pack. Con este exceso eso significa que se crean Leyendas de más en
los dos bolsillos, en esa misma proporción: no es una conversión de compradas en
ganadas, pero sigue siendo plata que no existía.

---

## 16. Anotado al cambiar la marca por el escudo y la moneda — sin tocar

- **`mostrarMesaEnRedPendiente`, en `mesa.js`, no la llama nadie.** Es la
  «pantalla honesta mientras la partida en red no esté implementada», y la
  partida en red existe hace rato. Sólo se le cambió la imagen —apuntaba al
  logo borrado—, para que ningún archivo del sitio pida algo que no está. Se
  puede borrar entera, en un cambio aparte.
- **La cuenta de administración sigue siendo `soporte.memorie.legends@gmail.com`.**
  El correo de contacto pasó a `soporte@memorielegends.com`, pero la cuenta
  con la que se entra al panel es otra cosa: es el administrador raíz
  cableado en las funciones (`CORREO_ADMIN`). Mudarla es un cambio en tres
  pasos y en este orden: cambiar el correo de la cuenta en Firebase
  Authentication, cambiar `CORREO_ADMIN` y desplegar las funciones, y recién
  después `public/js/administracion.js`. Al revés, la administración queda
  afuera. `pruebas/sitio.mjs` comprueba que las dos digan lo mismo.
- **Para el abogado, junto con lo demás: la licencia de Playfair Display.**
  Las tres tipografías son OFL y se sirven desde el sitio, con su licencia
  al lado. Inter y Cinzel no reservan nombre. Playfair sí («Reserved Font
  Name "Playfair Display"»), y la OFL no deja usar ese nombre en una versión
  modificada. Lo que se publica es el archivo tal cual lo entrega Google
  Fonts —el recorte al alfabeto latino lo hace Google, no nosotros—, que es
  lo que hacen también Fontsource y los demás que sirven estas fuentes. Si el
  abogado prefiere no discutirlo, la salida es volver a pedir Playfair a
  Google en las páginas que la usan, o cambiarla por una sin nombre
  reservado.
- **`herramientas/tarjeta.mjs` todavía pide las tipografías a Google** para
  dibujar la imagen de compartir. No es una página y no se publica, así que
  no afecta a nadie; sólo hace falta conexión para regenerarla.

---

## 17. El botón de soporte no llega al contraste que pide la WCAG

El botón flotante del tablero es blanco sobre el verde oficial de WhatsApp
(`#25d366`): **2,3:1**, por debajo del 4,5:1 que pide la WCAG 2.1 AA para
texto. Queda así a propósito y con decisión del dueño del sitio: es
exactamente el botón que publica WhatsApp, el glifo blanco es el que su kit
indica para fondos verdes, y sus normas de marca no dejan cambiarle el color
ni al fondo ni al dibujo.

Está anotado acá por si alguna vez hay que justificarlo —una auditoría, un
reclamo—: la alternativa sería no usar el verde de la marca, que es lo que las
normas del kit no permiten. El resto del sitio sí cumple: el mismo soporte,
dentro del cajón del menú, va en verde sobre fondo oscuro.

---

## 18. `fin-de-ronda-en-red` es intermitente bajo carga, y ya van dos veces

`pruebas/e2e/fin-de-ronda-en-red.spec.js` falla dentro de una corrida completa
y pasa sola. Pasó dos veces, y la segunda fue peor que la primera.

| | 27/09 | 28/09 |
|---|---|---|
| Fallaron | 1: «al cortar, el resultado se muestra» | **2**: esa misma y «el 10 a medio decidir se cierra si el servidor lo resuelve por tiempo» |
| La corrida | 428 pasadas, 17,5 min | 427 pasadas, **26,4 min** |
| Sola | 10 de 10 | **10 de 10, en 17,7 segundos** |

**La corrida del 28 tardó un 50% más que la del 27.** Es el mismo síntoma con
más carga encima: cuanto más ocupada la máquina, más pruebas de ese archivo se
caen. Empezó con una y ya son dos.

Ningún cambio la rompió, y las dos veces se comprobó y no se supuso. La segunda
vez el descarte fue así: `mesa.html` carga **sólo** `tema.css` y `mesa.css`, y
lo que se había tocado eran `app.css`, `style.css`, `portada.css`,
`sala-privada.css` y `sala-privada.js` — ninguno llega a la mesa, que además
tiene su propio `button.accion` en `mesa.css:1557`.

**Qué mirar cuando se la ataque:** si espera por un tiempo fijo en vez de
esperar por lo que tiene que pasar. Dos pruebas del mismo archivo cayendo
juntas bajo carga apuntan a un plazo compartido, no a dos casualidades.

**Y mientras tanto**, que quede dicho para no discutirlo cada vez: una corrida
con fallas SÓLO en este archivo, que pasa sola después, no bloquea un push. Una
falla en cualquier otro archivo, sí.

---

## 19. Cuando llegue el número de la URCDP

`public/privacidad.html`, en la sección «1. Responsable del tratamiento», dice
hoy **«Identificación en trámite»**: la Ley 18.331 exige identificar al
responsable con su nombre y domicilio, y todavía no hay número de registro.

Cuando la inscripción salga, ahí va el dato real. Hasta entonces se queda como
está: ningún texto legal afirma una inscripción que no existe.

La sección «3. Bases de datos» ya está escrita en futuro —«cuando corresponda,
las bases serán inscritas»—, así que esa no hay que tocarla.

---

## 20. Cuando el abogado opine sobre los premios físicos

`PREMIOS_FISICOS_ACTIVOS`, en `public/js/reglas/configuracion.js`, está en
`false`. No es un interruptor de desarrollo: es el estado del trámite. Con la
bandera apagada, el cierre del mes NO deja constancia de ninguna remera ni
llavero; la insignia Leyenda del top 5 sigue igual, porque es digital.

Nada se borró: los umbrales, `premioFisicoDe` y el otorgamiento siguen en su
lugar y se prueban con la bandera encendida (`cierre-de-periodos.mjs` §5),
para que el día que se encienda no haya que adivinar si todavía funciona.

**Dos cosas hay que resolver ANTES de pasarla a `true`, y las dos aparecen
recién con el segundo juego:**

1. **¿Los premios son del sitio o de cada juego?** El cierre recorre todos los
   juegos que tienen tabla. Con Truco sumado, el cierre de su mes también
   otorgaría: saldrían dos remeras por mes, una por juego. No se pisan —las
   constancias van con `arrayUnion` y cada una lleva su `juego` adentro, y el
   `premioFisico` de la fila vive en `rankings/{juego}/…`—, pero son dos.
   La forma correcta de resolverlo NO es un `if (juego === "memorie")`: eso es
   el enum cerrado que este diseño evita. Es un campo en `juegos/{id}`
   —`premiosFisicos: true`—, donde ya viven `activo`, `orden` y el logo. Así,
   sumar un juego sin premios es escribir un documento.
2. **Los umbrales son uno solo para todos.** `configuracion/ranking` guarda un
   par —remera 20.000, llavero 19.000— compartido. Con dos juegos, «20.000
   puntos» significa cosas distintas: dependen de cuánto se juega y de cuánto
   paga cada motor. Si se encienden los premios con dos juegos, el umbral
   también tiene que ser por juego, o el segundo regala o niega remeras según
   cuánto se parezca al primero.

---

## 21. La caja de crear sala está escrita dos veces

El tablero y el lobby tienen el MISMO formulario —crear una sala privada y
entrar con un código— escrito dos veces en HTML y llenado dos veces en
JavaScript. Los ids son idénticos (`entradaSala`, `duracionSala`,
`btnCrearSala`, `codigoSala`, `btnUnirse`, `codigoPrivado`) y por dentro las
dos llaman a lo mismo: `crearYMostrar` y `conectarCampoDeCodigo`. Lo que
cambia es el diseño y las palabras.

**Qué hacer:** un módulo compartido —`caja-sala-privada.js`— que dibuje el
formulario, llene los selectores, conecte los dos botones y la ayuda, igual
que `sala-privada.js` dibuja el cartel del código. Cada página queda con un
`<div>` vacío.

**La referencia visual es la caja del TABLERO.** El lobby adopta ese diseño;
su versión en dos columnas no gustó.

**Qué gana el lobby:** la ayuda viva del tablero, que hoy no tiene — «Con 4
jugadores se juntan 40 Leyendas: 30 para el primero y 10 para el segundo», que
se recalcula al cambiar la entrada.

**Qué NO puede perderse:** la ayuda del código del lobby —«ocho caracteres si
te invitaron a una sala privada; seis si es una mesa pública»—, que ahí tiene
más sentido que en el tablero, porque en el lobby conviven las dos. Va como
opción del módulo.

**Decisión abierta:** si el lobby conserva las dos columnas en pantalla ancha.
Es CSS, no estructura, y se ve con una captura al implementarlo.

**Alcance:** `dashboard.html`, `lobby.html`, `dashboard.js`, `lobby.js`,
`tablero.css`, `lobby.css`, y las pruebas `tablero.spec.js` y `lobby.spec.js`
—que casi no se tocan, porque los ids no cambian—.

**Cuidado:** `lobby.js` usa su `opcionesDeEntrada` TAMBIÉN para el formulario
de mesas públicas (`publicaEntrada`, `publicaDuracion`). Eso se queda en el
lobby o se exporta desde el módulo, pero no se borra.

**Lo que el lobby tiene de más —torneos, mesas públicas— no se toca.**

Es un bloque corto, y va DESPUÉS del despliegue: no conviene meter cambios
visuales el mismo día que se toca producción.

---

## 22. Una sala en espera que nadie llena se queda con la entrada adentro

El que crea una sala paga la entrada en el mismo momento de crearla
(`index.js`, dentro de la transacción que la escribe) y el pozo arranca con
esa entrada. Los que se unen pagan igual.

Si la sala no se llena, la plata vuelve **cuando alguien lo pide**: el jugador
que se va la recupera, el creador que se va de una privada dispara la
devolución **a todos** y cancela la sala, y la administración puede cancelarlas
en lote. Las tres devoluciones son irrepetibles —una por sala y jugador— y
`pruebas/salida.mjs` las cubre.

**Lo que no hay es un barrido automático.** `barrerPartidas` recorre partidas
EMPEZADAS y vencidas, no salas esperando. Una sala privada que nadie llena se
queda con la entrada del creador adentro hasta que él salga o la cancele la
administración.

Es como está hoy en producción, y con el tablero creando siempre salas
privadas conviene decidir qué hacer: un barrido que las cancele y devuelva al
vencer el código (30 minutos), o dejarlo en manos de quien la abrió.

**Y los códigos sobreviven a sus salas.** El 27/09, con `rooms` en cero,
quedaban dos documentos en `codigos` creados el 21/09 —`KJN7SD` y `TM2F9K`—
apuntando a salas que ya no existen y vencidos hace días. No hacen daño: el
código se busca por su hash y la sala no está, así que entrar falla igual. Pero
se acumulan, y el mismo barrido que resuelva lo de arriba tendría que barrerlos.

---

## 23. `listarPoseedoresItemAdmin` valida el argumento antes de pedir sesión

```js
export const listarPoseedoresItemAdmin = functions.https.onCall((data, context) =>
  tienda.listarPoseedores(context, validar(EsquemaItem, data, errorHttp).itemId));
```

`validar(...)` corre primero —es un argumento de la llamada—, así que sin
sesión y con datos vacíos contesta `INVALID_ARGUMENT` en vez de
`UNAUTHENTICATED`. Se vio en la llamada de humo del despliegue: las otras once
funciones contestaron 401 y ésta, 400.

No filtra nada —sólo dice que falta un campo— pero la convención del resto del
archivo es al revés: primero `exigirSesion`, después validar. Es un detalle de
estilo, y el arreglo es mover la validación adentro del cuerpo.

---

## 24. Cómo volver atrás el despliegue del lobby nuevo

El agujero que esta sección anunciaba está cerrado: la parte B se desplegó el
**27/09 21:53 UTC** y los 22 casos de `herramientas/probar-reglas.mjs` dan verde
contra el ruleset vivo. Lo que queda es el conocimiento de cómo volver atrás,
que sigue sirviendo.

### Volver atrás es una maniobra de dos pasos, y con orden

El cliente viejo consulta `rooms` con `where("estado", "==", "esperando")` y
nada más, sin filtrar por `publica`. La regla apretada rechaza esa consulta
ENTERA. Está comprobado contra producción, no deducido: esa consulta contesta
**HTTP 403 PERMISSION_DENIED**, mientras las dos del cliente nuevo —`publica ==
true` y `jugadores array-contains` mi uid— contestan 200.

O sea que **volver sólo el hosting rompe el sitio**: cliente viejo más reglas
apretadas es ninguna sala visible, ni en el lobby ni en el tablero.

Si hay que volver atrás, se vuelven las dos cosas y en este orden:

1. **Primero las reglas.** Aflojarlas no rompe nada: los dos clientes andan.
2. **Después el hosting.**

**Nunca al revés.** Y si sólo hace falta aflojar las reglas, con eso alcanza.

### Las dos puertas

**Hosting** — 10 a 20 segundos; no sube nada, sólo mueve el puntero:

```
npx firebase hosting:rollback
```

| versión | qué es |
|---|---|
| `51d538bdfffda3cc` | el lobby nuevo, del 27/09 21:42 UTC |
| `4dcb31df3b95a6f7` | lo anterior, del 21/09 21:30 UTC |

**Reglas** — la vía probada, 16 a 20 segundos medidos:

```
cp ~/respaldos-memorie/firestore-vivo-a037a8ef-desplegado-2026-09-16.rules firestore.rules
npx firebase deploy --only firestore:rules --project memorie-legends
git checkout firestore.rules
```

La vía más rápida, apuntando el release a un ruleset que ya existe del lado del
servidor (segundos, NO probada todavía):

```
curl -X PATCH -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: memorie-legends" -H "Content-Type: application/json" "https://firebaserules.googleapis.com/v1/projects/memorie-legends/releases/cloud.firestore" -d '{"name":"projects/memorie-legends/releases/cloud.firestore","rulesetName":"projects/memorie-legends/rulesets/RULESET"}'
```

| ruleset | qué es | cuándo |
|---|---|---|
| `77ee9876-8dde-42d8-8ef2-f11307f2068d` | **lo que corre hoy**: parte B, `rooms` apretada | — |
| `8817ed97-8d38-4eb0-a693-7426727ad4d9` | parte A: `juegos` sí, `rooms` permisiva | **el destino seguro casi siempre** |
| `a037a8ef-cca7-4a77-9ae8-09582d82e335` | lo de antes de todo (16/09 23:35 UTC) | sólo para volver del todo atrás |

La parte A sirve con cualquiera de los dos clientes: tiene `juegos` para el
nuevo y `rooms` permisiva para el viejo. El del 16/09 **no tiene `juegos`**, así
que sólo va si el hosting también vuelve atrás.

El archivo de ese último está en `~/respaldos-memorie/`, con
`sha256 72c70d1ae1070597dd9532e3ab87f56b4912c5cdc7acbf73d7b745c02e269068`.

### Y una cosa que confunde

El repositorio **no dice** con qué reglas corre producción. Lo que corre es el
release `cloud.firestore` de la API de Firebase Rules. Hoy coinciden, pero
durante un despliegue en dos partes no coinciden.

---

## 25. Las tres herramientas de cuentas no tienen suite

`resetear-cuentas.mjs`, `borrar-perfiles-huerfanos.mjs` y
`restaurar-users.mjs` no tienen prueba en `pruebas/`. Todas las demás
herramientas que tocan datos sí: `migrar-rankings`, `migrar-saldos`,
`sembrar-juegos`, `limpiar-perfiles` y `limpiar-rankings`.

Se probaron el 27/09 con guiones de sabotaje en un scratchpad —22 barreras,
todas frenando o pasando según correspondía— pero eso no lo corre `npm test`.
O sea que si mañana alguien afloja una barrera, nadie se entera.

Las que más importan, porque son las que impiden un desastre:

- Ninguna escritura del reset toca a un excluido.
- Si a un excluido le cambiaron el correo, se frena. No es hipotético: §24
  dice que la cuenta de administración se va a mudar algún día.
- Si la cantidad de cuentas o de huérfanos no es la esperada, se frena.
- El borrado nunca toca a alguien con cuenta de Auth.
- El barrido del libro mayor no toca a las excluidas ni a un asiento sin
  `uid`.
- El sello no se desequipa.

**Está listo para escribirse:** las tres exportan sus funciones puras
—`planDeReset`, `cambiosDe`, `planDeBorrado`, `planDeMovimientosSueltos`,
`planDeRestauracion`—, que deciden sin tocar Firestore. Es el mismo patrón que
`pruebas/migrar-rankings.mjs`: no hace falta emulador ni red.

Y acordarse de `pruebas/suites-registradas.mjs`: una suite nueva que no entre
en `npm test` es una suite que no existe.

---

---

## 26. Borrar `compartir-escudo.jpg`, la tarjeta vieja

Desde el 27/09 el sitio usa `compartir-escudo-2.jpg`, la versión centrada que
sobrevive al recorte cuadrado. **Ninguna página apunta ya a la vieja**, pero el
archivo se dejó en su lugar a propósito.

El motivo: los mensajes de WhatsApp ya enviados llevan adentro la dirección de
la imagen vieja. Si alguien abre una conversación de hace un mes y el cliente
vuelve a pedirla, un 404 le dejaría la tarjeta en blanco. Y las imágenes se
guardan un mes en caché (`firebase.json`).

**Cuándo borrarla:** pasado un mes desde el 27/09, o sea a partir del
**27 de octubre de 2026**. Son 99 KB.

Antes de borrarla, comprobar que sigue sin referencias:

```
grep -rn "compartir-escudo.jpg" public/ pruebas/ herramientas/
```

---

## 27. Lo que quedó fuera del barrido responsive del 28 de septiembre

El barrido cubrió las páginas públicas y las que piden sesión, a 320, 360,
414, 768 y 1440, y con la letra del sistema al 100, 125, 150 y 200 %. Estas
tres cosas quedaron identificadas y sin tocar.

### a. Los campos del panel de administración miden 14,4 px

El panel **sí** recibe `tema.css`: lo importa desde su propia hoja
(`admin.css:14`), no con un `<link>`. Así que el arreglo que llevó los campos
del sitio a 16 px también cubre los suyos... salvo éstos:

```css
.campos-item input[type="text"],
.campos-item input[type="number"],
.campos-item select {
  font-size: 0.9rem;   /* 14,4 px */
  min-height: 42px;
}
```

Con la raíz en 16, `0.9rem` son 14,4: por debajo del umbral de 16 con el que
Safari en iOS hace zoom al tocar un campo. Son treinta campos.

Y en la misma regla, `min-height: 42px` con el comentario «Alto de dedo: el
panel también se abre desde el teléfono». Le faltan los dos píxeles para
llegar a los 44 que pide Apple, que es justo lo que se corrigió en el resto
del sitio.

### b. Los enlaces del pie miden 16 a 18 px de alto

En las diecinueve páginas, entre seis y nueve por página. Están por debajo de
los 44 px, medido en el navegador.

Se dejaron afuera a propósito: son enlaces de texto en línea, que es el caso
donde la regla de los 44 px se discute más, y agrandarlos cambia el aspecto
del pie en todas las páginas a la vez. Es una decisión de diseño, no un
arreglo mecánico.

### c. `mesa.html` no se auditó

Es la pantalla más compleja del sitio —2.900 líneas de CSS propio— y para
verla hace falta una partida en curso. No entró en el barrido y no hay ningún
dato sobre ella: ni scroll horizontal, ni tamaños de campo, ni blancos
táctiles.


## 28. La banda muerta de 74 píxeles: la lección, y el reclamo que no tuvo dónde ir

Cerrado el 28 de septiembre de 2026 en `a59c3ed`. Queda anotado porque lo que
importa no es el arreglo —son dos palabras de CSS— sino lo que costó llegar a
él y por qué.

### a. El defecto, en una línea

La tabla de «Mis salas» mide unos 490 px por sus cinco cabeceras con `nowrap` y
mayúsculas espaciadas. Su caja la scrollea con `overflow-x: auto`, pero ese
desborde igual se propagaba al `scrollWidth` de los ancestros: a 360 de
pantalla, `section.panel-salas` daba 419 en una caja de 330 y `main` 434 en 360.
En el teléfono se veía como una banda muerta al costado, con el botón de soporte
corrido y la caja de la sala privada cortada.

Lo ataja `contain: paint` en `.tabla-salas-caja`. El porqué, y las cuatro
alternativas que se midieron antes de elegirlo, están escritos en
`css/tablero.css` al lado de la regla.

### b. Lo que costó

Diez horas. Nueve hipótesis descartadas: la dirección del link del cartel, los
`select` del panel, el cajón del menú, el botón flotante de soporte, la tabla de
salas —descartada por el motivo equivocado: se comprobó que su caja la contiene
visualmente y se dio por cerrado—, el cartel del código entero, el cajón por
`visibility: hidden`, la tipografía del sistema, y el ajuste de texto del
aparato.

Tres arreglos desplegados que no arreglaron nada: uno al panel (`1f6b581`,
revertido en `90af920`), uno al cartel (`c7cda5a`) y un recorte general con
`overflow-x: clip` sobre `html`, `body`, `main` y `.panel` (`5d6aeb3`, quitado
en `a59c3ed`).

Y cuatro rondas de mediciones que tuvo que hacer el humano en su teléfono,
anotadas a mano porque en ese aparato no se podían capturar.

### c. Las tres razones por las que no se encontró antes

Esta es la parte que sirve.

**1. La causa estaba en el primer mensaje.** El reporte inicial decía, con
capturas, que el defecto aparecía al pasar a «Por Leyendas». Y «Por Leyendas» es
exactamente el modo que muestra la tabla de salas: lo afirma una prueba que ya
existía, «las salas abiertas sólo se muestran en el modo por Leyendas». El
disparador señalaba a la tabla desde el principio y se leyó como si señalara al
panel.

**2. En el escritorio la tabla estaba vacía.** Sin salas listadas el defecto no
existe. Se midió durante horas una página que no tenía el problema, mientras el
teléfono del humano lo tenía porque él sí estaba en salas. **Nunca hizo falta el
aparato: hacía falta el contenido.** Cada ronda de mediciones que se le pidió
era evitable.

**3. El recorrido preguntaba lo que no era.** Se buscó `scrollWidth >
clientWidth` entre los descendientes. Eso encuentra al que NO PUEDE CONTENER, no
al que empuja: el que empuja nunca se desborda a sí mismo, porque nadie lo
apretó. En una cadena de cajas flexibles todas se estiran y encajan perfecto con
su contenido; el desborde aparece recién en la primera con techo duro, que era
justo lo único que el recorrido encontraba.

### d. Cómo medir esto la próxima vez

1. **Poblar el contenido primero.** Si la pantalla tiene listas, tablas o
   secciones que sólo aparecen con datos, llenarlas ANTES de medir. Una página
   vacía no tiene el defecto de una página usada.
2. **Medir holgura, no desborde.** Para cada elemento: su ancho mínimo (un clon
   en el mismo padre con `width: min-content`) contra el espacio que le queda
   hasta el techo duro de su cadena. Ordenar por holgura ascendente. Menos del
   15 % es un desborde en algún teléfono.
3. **Mirar lo que `querySelectorAll('*')` no ve:** nodos de texto (con `Range`)
   y pseudoelementos (con `getComputedStyle(el, '::before')`). Si una caja mide
   más que la unión de sus hijos elemento, lo que sobra es uno de esos dos.
4. **Estresar la tipografía, no emular el aparato.** `setViewportSize` cambia el
   ancho y nada más: los archivos de fuente siguen siendo los de la máquina, así
   que un desborde de métrica tipográfica no se reproduce nunca. Forzar una letra
   más ancha (Verdana sirve, es un 10 % más) y bloquear las tipografías web para
   ejercitar la cadena de respaldo.
5. **No tapar.** `overflow-x: clip` corta el síntoma y deja ciega a la medición:
   con el recorte puesto, `scrollWidth` da limpio siempre. Lo vigila el canario
   de `pruebas/e2e/tablero.spec.js`, que afirma que `html`, `body` y `main`
   siguen con `overflow-x: visible`.

### e. El reclamo por el tiempo perdido no tuvo dónde ir

El humano presentó un reclamo formal por calidad de servicio al soporte de
Anthropic —chat con el agente Fin— documentando las diez horas, las nueve
hipótesis erradas, las cuatro rondas de mediciones y el hecho de que la causa
estaba en el primer mensaje.

La respuesta, según la transcripción que trajo:

> No tengo información sobre un proceso formal de compensación por tiempo
> perdido en casos de diagnóstico erróneo, ni sobre cómo se registran este tipo
> de incidencias de calidad internamente. Lo que sí puedo confirmar es que tu
> reclamo queda registrado en esta conversación tal como lo describiste. No
> puedo ofrecerte crédito, extensión de suscripción ni ningún otro tipo de
> compensación.

Y después: «Entiendo tu frustración. Tu reclamo queda registrado aquí y lo
tomaré en cuenta».

En claro: **el sistema de soporte no tiene vía para procesar un reclamo de
calidad.** No hay expediente, no hay escalamiento, no hay compensación, y no hay
forma de saber si queda registrado en algún lado que no sea esa conversación. El
humano calificó la atención de «Horrible».

Lo que esto significa para el proyecto, que es lo único que este archivo puede
dejar dicho: si vuelve a pasar, **no hay canal**. El único registro que queda es
el que se escriba acá y en los mensajes de los commits. Por eso esta sección
tiene la sección (c) y la (d): no para tener la queja anotada, sino para que el
costo se pague una sola vez.


## 29. El orden de trabajo — acordado el 30 de septiembre de 2026

No es una lista de defectos: es en qué ORDEN se atacan los que ya están
anotados más arriba. Está acá porque la decisión más cara de este proyecto no
fue nunca qué arreglar sino cuántas cosas tener abiertas a la vez.

**La regla, que es lo único que no se negocia: un bloque por vez. Cerrar,
desplegar, verificar. Recién ahí se abre el siguiente.**

### Bloque 1 — el del poder 7 y el cuadro de cartas (CERRADO y desplegado al 30/9/2026)

1. Verde de navegador para el arreglo del 7.
2. El cuadro de objetivos del poder: «Tus cartas» arriba, a pantalla completa
   en el teléfono, y las cartas de ese cuadro pueden achicarse un poco. Sale
   de la auditoría de scroll: con cuatro jugadores el modal pide hasta 298 px
   de scroll interno y lo que queda abajo del corte es justamente la mano
   propia, que en el 9 y el 10 es la primera que hay que elegir.
3. Borrar los `pruebas/e2e/_auditoria-*.spec.js`, que son instrumentos y no
   pruebas.
4. Commit, push, despliegue y verificación en producción.

### Bloque 2 — el siguiente (el Bloque 1 ya está cerrado). NO ARRANCAR hasta que el usuario diga OK

- Precarga de las 48 cartas al iniciar partida (mata el parpadeo).
- Fondo del contenedor de carta que no sea blanco (defensa extra).
- ~~§13b: `cerrarMirada` puede cortar la mirada antes de tiempo.~~ ✅ HECHO
  a mano el 30/9 (`8b1d80c`, desplegada sólo esa función). Ya no va en la
  pasada única del Bloque 2.
- Paso 9: borrar `crearSala`, que quedó sin uso.
- §18: el test intermitente `fin-de-ronda-en-red`.
- **Una sola pasada de suite. Un commit. Un deploy.** Son veinte minutos cada
  vez y una pasada por cambio, para cambios que no se tocan entre sí, es
  tiempo tirado.

### Después del 2 — lo que se decide con datos, no antes

- Auditoría visual de la mesa: cuánto del viewport es carta y cuánto es
  adorno, con capturas anotadas, en móvil, tablet y escritorio. **Sólo mirar
  los números.** El rediseño de la mesa no se abre hasta tenerlos, y puede no
  abrirse nunca si los números no lo justifican.
- §21: unificar la caja de crear sala, que hoy está escrita dos veces.
- PageSpeed.
- §10 → Fase 3 (latencia), y con medición previa: es el único de la lista que
  puede empeorar lo que toca si se entra a ciegas.

### Lo que esto deja dicho

No abrir el rediseño de la mesa ni la Fase 3 hasta que el Bloque 2 esté
cerrado y desplegado. Si en el medio aparece un defecto que duele —como el
del ancho, que se comió diez horas—, se atiende y se vuelve acá; lo que no se
hace es empezar un tercer frente porque el segundo se puso aburrido.


## 30. Cierre del 30 de septiembre de 2026: Search Console y el formato de `index.html`

### a. Google Search Console — cerrado

- Etiqueta `google-site-verification` en `public/index.html` (línea 9, después
  del script con-js).
- Dominio verificado por DNS en Cloudflare desde la cuenta de la empresa.
  Propiedad dueña: soporte.memorie.legends@gmail.com. La cuenta personal
  queda también como Propietario (Google no deja bajarla a delegada cuando
  viene de verificación DNS).
- Sitemap enviado: https://memorielegends.com/sitemap.xml → «Correcto», 10
  páginas descubiertas. Home ya indexada. `robots.txt` sirve bien y el sitemap
  sale como `application/xml`.

### b. Format On Save de VS Code rompe `public/index.html`

1. **Si hay que reescribir `public/index.html`, NO usar Format On Save de VS
   Code**: borra las comas del `srcset` y lo deja como `srcset=",,"`. Usar el
   Bloc de notas o editar desde Claude.
2. `css-critico.mjs` anda bien y respeta el `srcset` y la etiqueta de Google
   (probado el 30/9).
3. Historia del archivo: el ruido de formato (19653d6, cf25f7f) quedó limpio;
   8f540f4 es el commit extra que agrega la etiqueta.

### c. Estado de producción al cierre

Hosting 8f540f4 (etiqueta de Google + arreglo del 7 + modal) · reglas 77ee9876
(parte B) · 81 funciones, todas al día · sitemap leído por Google · home
indexada.


## Y algo que no está roto, pero falta

**No existe el otorgamiento manual de insignias.** `tienda.otorgar` está del
lado del servidor y sólo lo llama `insignias.js` al cerrar una partida o un
período de ranking: no hay callable ni botón en el panel. Se dio por existente
en un pedido anterior. Se construye rápido cuando haga falta.
