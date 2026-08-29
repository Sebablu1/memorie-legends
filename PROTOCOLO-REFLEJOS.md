# La ventana de reflejos en red

Este documento es la autoridad sobre cómo se decide quién gana un descarte.
Si el código y este texto no coinciden, uno de los dos está mal y hay que
arreglarlo, no elegir.

## El problema que resuelve

La forma obvia de resolverlo en red es: gana el primer pedido que llega al
servidor. Es simple, es imposible de discutir… y arruina el juego. Con 40 ms
de conexión contra 180 ms, el de la fibra gana **siempre**, incluso cuando el
otro reaccionó antes de verdad. Deja de ser un juego de reflejos y pasa a ser
uno de proveedor de internet.

Así que el servidor no resuelve al recibir. **Junta y después ordena.**

## Cuándo empieza y cuándo termina una ventana

La abre el servidor, con su propio reloj, cuando la partida entra en fase de
descarte:

```
ventana = {
  id           "v_<aleatorio>"   generado por el servidor, impredecible
  abiertaEn    <epoch ms>        reloj del SERVIDOR, nunca el del cliente
  duracionMs   5000              lo que dura la ventana de reflejos
  graciaMs     2000              margen extra sólo para LLEGADAS
  cerrada      false
  intentos     { <clientActionId>: {...} }
}
```

Hay dos límites distintos y conviene no confundirlos:

| | Hasta | Qué pasa después |
|---|---|---|
| **Reacción** válida | `abiertaEn + 5000` | tocar después no cuenta, por rápida que sea la conexión |
| **Llegada** aceptada | `abiertaEn + 5000 + 2000` | un pedido que llega después se descarta |

La gracia existe porque un jugador que tocó en el milisegundo 4990 con 300 ms
de latencia llega al servidor en el 5290. Su reacción fue a tiempo; su paquete
no. Sin la gracia se perdería una jugada legítima.

Abrir la ventana dos veces devuelve la misma: es idempotente.

## Cómo se sincroniza el reloj

Al estilo NTP, con tres marcas por muestra:

```
t0   el cliente manda el pedido       (reloj del cliente)
t1   el servidor responde con el suyo (reloj del servidor)
t2   el cliente recibe la respuesta   (reloj del cliente)

desfase       = t1 - (t0 + t2) / 2
viaje         = t2 - t0
incertidumbre = viaje / 2
```

De varias muestras se conserva **la de viaje más corto**, no el promedio. Un
promedio arrastra las muestras que pasaron por un pico de congestión, que son
justamente las peores; la más rápida es la que menos se pudo distorsionar.

Sin ninguna muestra se asume la peor incertidumbre posible (1500 ms), nunca la
mejor. Quien no sincroniza no gana por no sincronizar.

## Qué manda el cliente

```
{
  windowId        de qué ventana habla
  posicion        qué carta suya toca
  clientActionId  identificador único de ESTA acción
  declarado       ms desde `abiertaEn` en que dice haber reaccionado
  latencia        su estimación de viaje de un sentido
  incertidumbre   el error de esa estimación
}
```

Nada de esto se cree sin más. `declarado`, `latencia` e `incertidumbre` son
declaraciones de una parte interesada.

## El tiempo efectivo

Es **la única autoridad** para ordenar los reflejos.

```
llegada  = ahoraDelServidor − ventana.abiertaEn

piso     = max(0, llegada − latencia − incertidumbre)
techo    = llegada

efectivo = min(max(declarado, piso), techo)
```

En palabras: se le cree al cliente **sólo dentro del intervalo que su propia
llegada hace físicamente posible.**

- **No puede ser posterior a la llegada.** Nadie reacciona después de que su
  pedido ya llegó. Declarar un tiempo tardío sólo se perjudica a sí mismo.
- **No puede ser anterior al piso.** Por más que lo afirme, el paquete habría
  tenido que viajar hacia atrás en el tiempo.

`latencia` e `incertidumbre` están topadas en 1500 ms cada una, así que
declarar una latencia enorme para bajar el piso tampoco funciona.

Un `declarado` ausente, `NaN` o no numérico cae en el **techo**: el peor caso.
No mandar un tiempo utilizable nunca es la opción conveniente.

### Por qué mentir no sirve

Un tramposo con 400 ms de latencia declara que reaccionó en el milisegundo 0:

```
llegada 1400 · latencia 400 · incertidumbre 200
piso = 1400 − 400 − 200 = 800
efectivo = min(max(0, 800), 1400) = 800
```

Y un jugador honesto, con la misma conexión, que reaccionó de verdad en el
800:

```
efectivo = min(max(800, 800), 1400) = 800
```

**Exactamente el mismo número.** Mentir no da ventaja: a lo sumo recupera la
que la red le había quitado, que es precisamente lo que se quería lograr.

Lo que sí queda es un margen de manipulación igual a la incertidumbre de
sincronización. Es irreducible: no se puede distinguir a alguien que afina su
tiempo dentro del error de medición de alguien que simplemente tiene ese
error. Por eso ese margen se declara empate técnico y se resuelve aparte.

## Empate técnico

Dos reacciones que difieren en menos de **60 ms** no se pueden distinguir: la
diferencia está por debajo de lo que el reloj mide. Pretender resolver por
debajo de eso sería fingir una precisión que no existe.

Hay que elegir igual, y toda elección es arbitraria. Lo que no puede ser es
**sesgada** ni **manipulable**:

- Ordenar por uid favorecería siempre al mismo jugador.
- Usar el `clientActionId` dejaría que alguien lo eligiera a propósito hasta
  encontrar uno que gane.

La regla es: gana el menor `FNV-1a(windowId + "|" + uid)`.

El `windowId` lo genera el servidor y nadie lo conoce antes de que la ventana
se abra, así que no se puede preparar. Es reproducible —la misma ventana da
siempre el mismo resultado, y por eso se puede probar y auditar— y a lo largo
de muchas ventanas favorece a cada jugador por igual: medido sobre 2000
ventanas, el reparto entre dos jugadores da 50,0 %.

Si dos pesos fueran iguales (astronómicamente improbable) desempata el uid,
para que el orden nunca quede indefinido.

## Cómo se ordenan las acciones al cerrar

Al cerrar la ventana:

1. Se ordenan todos los intentos por `efectivo` ascendente.
2. Los que caen dentro de los 60 ms se ordenan por el sorteo determinista.
3. Se aplican **en ese orden** al motor, uno por uno, con la misma función
   `intentarDescarte` que usa la mesa local.

El paso 3 es deliberado: las reglas A/B/C **no se reimplementan** en la capa
de red. Duplicarlas sería garantizar que en algún momento diverjan. Esta capa
sólo decide el orden; el primero de la lista es el que se salva.

Las reglas quedan idénticas:

| | | |
|---|---|---|
| **A** primer acierto | la carta se va al descarte | −1 carta |
| **B** acierto posterior | la carta se va igual, pero recibe una | 0 neto |
| **C** error | conserva su carta y recibe una | +1 carta |

Las revelaciones siguen siendo efímeras: duran lo que dura la ventana y no
queda ningún registro permanente. `infoPublica` no vuelve.

Cerrar la ventana es **idempotente**: lo primero que se mira es si ya estaba
cerrada. Puede pedirlo cualquier cliente que vea que venció, y los cuatro
pueden pedirlo a la vez; la transacción deja pasar una sola. Y no se puede
cerrar antes de tiempo: si no, cualquiera la cortaría en el instante en que
le conviene, justo después de descartar.

## Acciones tardías

| Caso | Qué pasa |
|---|---|
| Llega después de la gracia | rechazada, `fuera_de_tiempo` |
| Llega en la gracia, reaccionó a tiempo | **aceptada**, con su tiempo real |
| Llega en la gracia, reaccionó tarde | rechazada: el efectivo supera los 5000 |
| Llega antes de que la ventana abra | rechazada |
| Menciona otra ventana | rechazada, `ventana_distinta` |
| La ventana ya se cerró | rechazada, `ventana_cerrada` |

Hay un caso que conviene entender porque parece un error y no lo es: quien
declara **poca** latencia y llega **muy** tarde se perjudica. Si dice tener
400 ms pero su paquete tardó 1400, el piso lo empuja hacia adelante y puede
quedar fuera de la ventana. Es correcto: el servidor no puede creerle un
tiempo que su propia llegada desmiente.

## Acciones duplicadas

Todo intento lleva un `clientActionId` único. Si el mismo llega dos veces
—reintento por timeout, doble clic, recarga— la segunda no cambia nada y se
responde que sí.

Esto importa más de lo que parece: sin idempotencia, un reintento por una
respuesta que se perdió contaría como un intento nuevo, y podría costarle al
jugador una carta de castigo que no merecía. Reenviar el mismo identificador
con otra posición **tampoco** cambia la jugada: la primera es la que vale.

Las acciones de turno (levantar, cambiar, tirar, cortar, pasar) llevan el
mismo mecanismo. Se recuerdan las últimas 40, que alcanza de sobra para
cubrir un reintento.

## Desconexiones

La mesa manda una señal de vida cada pocos segundos. Sin señales durante 15
segundos, el jugador queda marcado como ausente.

**Perder la conexión no cuesta Leyendas.** Sería cobrarle a alguien por un
corte de luz. Lo único que pasa es que, si le toca el turno y no está, se le
salta —igual que si se le acabara el reloj de 8 segundos— y la partida sigue.
No se lo elimina: si vuelve, sigue jugando con sus cartas y sus puntos.

Saltear a un ausente lo puede pedir cualquiera, pero sólo prospera si se
cumplen las dos condiciones a la vez: que efectivamente le toque a ese
jugador y que lleve más de 15 segundos sin dar señales. Así nadie lo usa para
saltear al rival que está pensando.

Para irse de verdad hay que **abandonar**, que es una decisión explícita, se
avisa antes y tiene su penalización (ver Fase 7).

## Qué pasa con el que abandona

Su entrada ya está en el pozo y se queda ahí. En la partida se lo marca como
eliminado para que los turnos lo salteen, y queda distinguible de un
eliminado por puntos. Sigue figurando entre los jugadores, porque el pozo se
calculó con él. No puede volver a jugar ni descartar en ventanas siguientes.

El cobro de la penalización **no ocurre acá**: lo hace `abandonarPartida`,
que es la única función que mueve Leyendas.

## El estado persistente

El documento de una partida es **JSON puro**: números, cadenas, booleanos,
arrays y objetos planos. Sin funciones, sin `Map`, sin `Set`, sin instancias
de clases, sin referencias circulares.

El azar es parte del estado, como una **semilla entera** (`reglas/azar.js`),
no como una función. Eso no es un detalle de implementación:

- una función guardada en Firestore se pierde en silencio;
- si el estado necesitara "hidratarse" al leerlo, habría dos formas del estado
  dando vueltas y tarde o temprano una acción correría sobre la equivocada;
- con la semilla en el estado, la partida es **reproducible**: con la semilla
  inicial y la lista de acciones se vuelve a jugar exactamente la misma
  partida, que es lo que hace falta para auditar una queja.

El flujo es siempre el mismo, sin excepciones:

```
Firestore → estado serializable → motor puro → nuevo estado serializable → Firestore
```

Cada escritura pasa por un control que rechaza el estado si aparece algo no
serializable, y las pruebas fallan si alguien vuelve a meter una función.

## El algoritmo de la semilla

**mulberry32**, en `reglas/azar.js`. Un generador de 32 bits, rápido, con un
período largo y una distribución uniforme: sobre 100 000 tiradas repartidas en
diez cajas el peor desvío medido es de 0,9 %.

```js
s = (s + 0x6d2b79f5) >>> 0;
let t = Math.imul(s ^ (s >>> 15), 1 | s);
t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
valor = ((t ^ (t >>> 14)) >>> 0) / 4294967296;   // en [0, 1)
```

La semilla avanza **con cada valor pedido**, y el estado guarda en qué punto
quedó. Cada vez que el motor necesita azar hace lo mismo:

1. construye el generador desde `estado.semilla`;
2. pide los valores que necesita;
3. **escribe de vuelta** `semilla: azar.semilla()` en el estado nuevo.

Si el paso 3 se olvidara, la barajada siguiente repetiría exactamente la misma
mezcla. Ocurre en dos lugares y sólo en dos: `empezarRonda`, que reparte, y
`rellenarMazo`, que recicla el descarte cuando el mazo se agota.

La semilla **inicial** sí sale de una fuente externa (`crypto.getRandomValues`,
o `Math.random` si no está disponible) y la genera **siempre el servidor**. Si
la eligiera el cliente podría probar semillas hasta dar con un reparto que le
convenga.

### La semilla no es un secreto criptográfico

Sirve para **reproducir y auditar**, no para proteger nada. La confidencialidad
de las cartas la da otra cosa completamente distinta: el estado maestro no se
publica nunca, y a cada jugador se le manda sólo su vista recortada por
`vistaDe`, con las reglas de Firestore negando la lectura del documento
completo. Si alguien obtuviera la semilla de una partida en curso podría
calcular el mazo — y por eso la semilla vive únicamente en el documento
maestro, que nadie puede leer.

Dicho de otro modo: la semilla es la bitácora, no la cerradura.

### `Math.random` en el resto del proyecto

Buscado y revisado. Fuera del motor queda en:

| Dónde | Por qué está bien |
|---|---|
| `azar.js semillaAleatoria` | genera la semilla inicial, no reproduce nada |
| `salas.js generarCodigo` | código de sala, no es parte de una partida |
| `economia.js girarRuleta` | acepta un `rng` inyectable; el servidor le pasa `crypto` |
| `ia.js` (6 funciones) | la IA sólo existe en el entrenamiento local |
| `game.js`, `gameLogic.js` | la mesa vieja, que no usa este motor |

La IA merece una aclaración: sus decisiones son aleatorias y **no** salen de la
semilla de la partida, así que una partida contra la máquina no es reproducible
jugada por jugada. Es correcto que sea así por ahora, porque la única partida
que se guarda es la de red, y ahí no hay IA — la capa de red crea sus jugadores
con `esIA: false`, y hay una prueba que falla si eso cambia. El día que exista
una IA en una partida guardada, su `rng` tendrá que salir de la semilla como
todo lo demás; las seis funciones ya lo aceptan inyectado.

`barajar` **exige** su fuente de azar: se le quitó el valor por defecto, porque
un `rng = Math.random` implícito hacía que olvidarse de pasarlo no diera ningún
error, sólo una partida que en silencio dejaba de ser reproducible.
