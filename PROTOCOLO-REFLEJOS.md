# La ventana de reflejos en red

Este documento es la autoridad sobre cómo se decide quién gana un descarte.
Si el código y este texto no coinciden, uno de los dos está mal y hay que
arreglarlo, no elegir.

## El problema, y de qué lado se decidió quedarse

La forma obvia de resolverlo en red es: gana el primer pedido que llega al
servidor. Es simple, es imposible de discutir… y tiene un costo real. Con 40 ms
de conexión contra 180 ms, el de la fibra gana más seguido, incluso cuando el
otro reaccionó antes de verdad.

Durante un tiempo este protocolo eligió la otra opción: el servidor **juntaba
y después ordenaba** todos los intentos por tiempo de reacción corregido, con
un empate técnico para lo que el reloj no podía distinguir. Era más justo en el
caso que medía, y acá está por qué se dio marcha atrás.

**Ordenar exige un momento en el que se ordena.** Ese momento era el cierre de
la ventana, y el cierre exigía un cronómetro: dos segundos en los que lo único
que podía pasar era esperar. El jugador tocaba su carta y no pasaba nada —ni
la carta se movía, ni se sabía si había acertado— hasta que el reloj terminaba.
Jugado, eso no se siente un juego de reflejos; se siente un formulario que se
envía. Y la mesa quedaba detenida en cada muestra, con los cuatro mirando una
barra vaciarse.

Así que se cambió, con el costo asumido y escrito:

> **Cada descarte se aplica en el instante en que llega al servidor.** Si dos
> tocan casi juntos, gana el que llegó primero.

Lo que se gana a cambio no es sólo que se vea en el momento. Al no haber nada
que juntar, la ventana no necesita cerrarse por tiempo — y sin cronómetro
nadie corre contra un reloj: se reacciona cuando se cae en la cuenta, con el
turno entero del siguiente por delante en vez de dos segundos. El borde que la
precisión protegía casi desaparece, porque los milisegundos dejan de ser el
terreno donde se juega.

`tiempoEfectivo` **no se fue** y sigue midiendo reacción, no conexión. Ya no
decide nada; es el registro de cuándo reaccionó cada uno, que es lo que hay que
poder mirar cuando alguien pregunta por qué perdió una mano.

## Cuándo empieza y cuándo termina una ventana

La abre el servidor, con su propio reloj, cuando cae una muestra nueva:

```
ventana = {
  id           "v_<aleatorio>"   generado por el servidor, impredecible
  abiertaEn    <epoch ms>        reloj del SERVIDOR, nunca el del cliente
  cerrada      false
  resueltaEn   <epoch ms>        cuándo se cerró, si se cerró
  intentos     { <clientActionId>: {...} }
}
```

**La ventana no vence.** Vive mientras viva la muestra, y la cierra el jugador
en turno cuando la cambia: al tirar, al cambiar una carta de su mano por la
levantada, o al cortar —que termina la ronda y con ella cualquier reflejo—.

Y lo que **no** la cierra importa tanto como lo que sí:

| Jugada | ¿Cierra? | Por qué |
|---|---|---|
| `tirar` | **sí** | hay muestra nueva, y se abre otra ventana en el acto |
| `cambiar` | **sí** | la carta que sale de la mano queda de muestra |
| `cortar` | **sí** | la ronda terminó: no queda a qué reaccionar |
| `pasar` | no | la muestra sigue siendo la misma |
| `mirar`, `levantar`, los poderes | no | no tocan el descarte |

Que `pasar` no cierre no es un descuido: es la regla. **Una ventana puede
atravesar varios turnos**, y no hay techo porque no hace falta — en algún
momento alguien tira, y ése es el límite.

El único límite que queda para un intento es que su ventana sea **la vigente**
y esté **abierta**. Eso es todo lo que mira `aceptaLlegadas`.

La gracia de 2 ms para llegadas tardías también se fue, y tampoco es un olvido.
Existía porque un toque en el milisegundo 4990 con 300 ms de latencia llegaba
en el 5290, y sin margen se perdía una jugada legítima. Pero ahora el cierre y
el cambio de muestra son el **mismo instante**: no queda un «después» en el que
un reflejo tardío pueda aplicarse bien, porque `intentarDescarte` vuelve a
comparar la carta contra la muestra y la evaluaría contra la nueva — el que
reaccionó bien se comería un castigo por haber acertado. Darle margen sería
peor que no dárselo.

Abrir la ventana dos veces devuelve la misma: es idempotente.

### En entrenamiento no es así

Allá la ventana **sí** dura 2 segundos (`MS_DESCARTE`) y se cierra sola. Es
correcto que difieran: del otro lado no hay nadie a quien esperar ni ninguna
latencia que compensar, y un cronómetro es lo que le da forma al ejercicio.
Las reglas del descarte —A, B y C— son las mismas y salen del mismo motor.

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

Ya no ordena nada: es el **registro** de cuándo reaccionó cada uno. Se calcula
igual que siempre y se guarda con el intento.

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
error. Ya no cambia quién gana —el orden es el de llegada— pero sí cambia el
número que queda anotado, y conviene saber que ese número tiene ese margen.

## Acá vivía el empate técnico

Se fue, y con él todo lo que lo rodeaba: `ordenarIntentos`, `esEmpateTecnico`,
`favorecido`, `MS_EMPATE_TECNICO` y el sorteo `FNV-1a(windowId + "|" + uid)`.

Resolvían un problema que ya no existe. Dos reacciones que difieren en menos de
60 ms no se pueden distinguir, así que había que elegir sin sesgo y sin que
nadie pudiera prepararlo: el `windowId` lo generaba el servidor y nadie lo
conocía antes, y sobre 2000 ventanas el reparto entre dos jugadores daba 50,0 %.
Funcionaba. Lo que desapareció es la **simultaneidad**: sin un cierre donde
juntar los intentos, no hay dos reacciones que comparar — hay una que llegó y
después otra.

Queda escrito porque la pregunta «¿y qué pasa si dos tocan a la vez?» se va a
volver a hacer, y la respuesta corta es: no hay «a la vez». Las transacciones
de Firestore se serializan sobre el documento de la partida, así que dos
descartes simultáneos se aplican uno después del otro, nunca encima. «El orden
de llegada» es un orden real, no una carrera.

## Cómo se aplican las acciones

**Al llegar**, una por una:

1. Se anota el intento en la ventana, con su `efectivo`.
2. Se aplica al motor en el acto, con la misma función `intentarDescarte` que
   usa la mesa local.
3. Se pregunta si alguien se quedó sin cartas. Si sí, la ronda se corta ahí
   mismo: en una mesa real, si alguien se queda sin cartas la mano se termina,
   no se espera.

El paso 2 es deliberado: las reglas A/B/C **no se reimplementan** en la capa de
red. Duplicarlas sería garantizar que en algún momento diverjan.

Las reglas quedan idénticas:

| | | |
|---|---|---|
| **A** primer acierto | la carta se va al descarte | −1 carta |
| **B** acierto posterior | la carta se va igual, pero recibe una | 0 neto |
| **C** error | conserva su carta y recibe una | +1 carta |

### Lo único que todavía espera

Un ataque **acertado** a la carta de un rival. La regla dice que la carta a
entregar se elige DESPUÉS de saber que acertó, así que en ese momento todavía
no existe: el intento queda pendiente y se completa cuando llega la entrega.
Hay dos formas de que termine, y las dos están en el reglamento:

- el dueño elige dentro de sus 5 segundos (`MS_PARA_ENTREGAR`, más la gracia
  del viaje), o
- se le acaba el tiempo y **la carta sale al azar**.

Y hay una tercera, que es nueva: **el tiro del jugador en turno le corta el
tiempo**. Si tira antes de que el otro elija, la entrega se resuelve al azar en
ese instante. Tiene que ser así y no al revés: la entrega se aplica contra la
muestra, y resolverla después del tiro la evaluaría contra la muestra nueva —
el acierto se convertiría en error.

Las revelaciones siguen siendo efímeras: una carta expuesta se ve **2 segundos
reales** (`MS_REVELACION`), contados desde que el descarte se aplicó. El motor
no los mide —sigue determinista y sin relojes—: el orquestador sella la hora de
cada intento, filtra la vista antes de mandarla, y vuelve a publicar al
cumplirse el plazo para que la carta desaparezca aunque en la mesa no pase nada
más. No queda ningún registro permanente; `infoPublica` no vuelve.

Cerrar la ventana es **idempotente**: lo primero que se mira es si ya estaba
cerrada. Ya no lo puede pedir ningún cliente —la callable
`cerrarVentanaDescarte` se borró— y el motivo es exactamente el que este
párrafo decía antes al revés: sin cronómetro, «ya venció» dejó de querer decir
nada, y cualquiera habría podido cortarla en el instante que le conviniera,
justo después de descartar.

## Acciones tardías

La tabla se acortó, y es la mitad del cambio: dejaron de existir las tres
primeras filas, que eran las que medían tiempo.

| Caso | Qué pasa |
|---|---|
| Reaccionó tarde, o llegó tarde | **aceptada**: no hay techo de tiempo |
| Llega antes de que la ventana abra | rechazada, `fuera_de_tiempo` |
| Menciona otra ventana | rechazada, `ventana_distinta` |
| La ventana ya se cerró | rechazada, `ventana_cerrada` |
| Ya jugó su tiro sobre su propia mano | rechazada, `ya_intento` |

«Tarde» ya no quiere decir nada mientras la ventana esté abierta: un reflejo en
el segundo 11, con el del turno todavía pensando, vale igual que el del primer
segundo. Lo que cierra la puerta es la ventana, no el reloj.

Lo que **sí** sigue existiendo es la corrección del tiempo declarado, y
conviene entenderla porque parece un error y no lo es: quien declara **poca**
latencia y llega **muy** tarde se perjudica. Si dice tener 400 ms pero su
paquete tardó 1400, el piso lo empuja hacia adelante. Antes eso lo podía dejar
fuera de la ventana; ahora sólo le empeora el número anotado. El servidor no
puede creerle un tiempo que su propia llegada desmiente.

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
