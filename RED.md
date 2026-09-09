# Cuándo el navegador le habla al servidor

En una partida por Leyendas el navegador **no juega**: dibuja lo que el
servidor publica y le pide cosas. Este documento dice cuáles son esas cosas,
cada cuánto salen y por qué.

El modo entrenamiento no aparece acá. Ahí no hay servidor: el motor corre en la
propia página y no se manda un solo pedido.

---

## Las cuatro conversaciones

| Qué | Quién arranca | Cada cuánto | Para qué |
|---|---|---|---|
| **La vista** | el servidor | cuando cambia | lo que se dibuja en la mesa |
| **El golpe** | el navegador | cuando vence un plazo | pedirle al servidor que avance |
| **El latido** | el navegador | cada 5 s | decir «sigo acá» |
| **El barrido** | el servidor | cada minuto | destrabar lo que nadie destraba |

Son cuatro cosas distintas y conviene no confundirlas. El **golpe** pregunta si
venció algo; el **latido** dice que uno está presente. Espaciar el primero es
un ahorro; espaciar el segundo haría que a alguien le salten el turno estando
sentado frente a la pantalla.

---

## La vista: `escucharMiVista`

Cada jugador escucha **su propio** documento, `partidas/{codigo}/vistas/{uid}`.
Son cuatro documentos distintos y no uno compartido, porque cada uno ve cosas
distintas: las cartas del rival no viajan.

El servidor los reescribe todos en cada transición, dentro de la misma
transacción que mueve la partida. `filtracionesEn` corre en cada escritura y
tira si una vista llevara una carta que su dueño no puede ver.

Firestore reenvía al suscribirse, repite versiones y tras una reconexión puede
entregar fuera de orden. Lo filtra `crearFiltroDeVersion`.

---

## El golpe: `avanzarPartida`

### Qué hace

Le pregunta al servidor si algún plazo venció. Si venció, el servidor hace
**una** transición y publica; si no, contesta `todavia_no` sin tocar nada.

Golpean **los cuatro** jugadores, y está bien que así sea: si dependiera de uno
solo, su desconexión congelaría la mesa para los demás. Que lleguen a la vez
tampoco es problema — la transacción deja pasar una.

### Cuándo sale, y por qué cambió

Antes salía en **cada vuelta del temporizador, cada 900 ms, toda la partida**.
Con cuatro jugadores son unas **267 llamadas por minuto y por mesa** —cada una
una Cloud Function y una transacción de Firestore— y la enorme mayoría
contestaba «todavía no».

Ahora el reloj local sigue latiendo cada 900 ms —eso no cuesta nada, es un
`setInterval`— pero **sólo se sale a la red cuando el plazo ya venció**. El
plazo viene en la vista: es el mismo dato con el que la mesa dibuja la cuenta
regresiva.

```js
// public/js/partida-red.js
mantenerEnMarcha(codigo, () => miVista?.plazo?.hasta ?? null)
```

Medido en el navegador (`pruebas/e2e/golpes.spec.js`): con el plazo a treinta
segundos, **≤1 llamada en cuatro segundos**; antes eran unas 4,4.

### Dos excepciones, y son a propósito

**El arranque y la vuelta a la pestaña van forzados.** En los dos casos lo que
se sabe del plazo puede estar viejo —o no haber llegado todavía— y una llamada
de más es más barata que una mesa congelada.

**Sin plazo no se golpea.** `plazoDe` devuelve `null` en las fases que no tienen
reloj —`levantada`, `poder`— y ahí `avanzarPartida` contesta `sin_plazo` sin
mover nada: golpear sería gastar por gusto. Al que no está se lo saca por otra
vía, `saltarAusente`.

Queda un caso raro: una partida a la que le falte el plazo o lo tenga desfasado
se arregla golpeando, y con esto nadie golpearía. Lo cubre el barredor — un
minuto de demora en algo que no debería ocurrir nunca.

### Los plazos que existen

| Fase | Dura | Qué pasa al vencer |
|---|---|---|
| `mirar` | `MS_MIRAR` | se cierra la mirada |
| `descarte` | la ventana | se resuelven los reflejos |
| `turno` | 8 s | se le salta el turno al que no levantó |
| `postLevantada` | `MS_PASO_AUTOMATICO` | pasa el turno |
| `finRonda` | 6 s | empieza la ronda siguiente |
| `finPartida` | 4 s | se cierra la sala y se reparte el pozo |

---

## El latido: `latir`

Cada **5 segundos**, y **no** se espació.

A los **15 segundos** de silencio (`MS_SIN_SENALES`) al jugador en turno se le
puede saltar el turno. Con latidos cada 5 s hacen falta tres perdidos seguidos
para que eso pase, que es el margen que se quiere para una conexión mala.

`mantenerVivo` es un `setInterval` **sin** condición de visibilidad, a
diferencia del golpe. Una pestaña escondida sigue latiendo: el jugador está,
sólo que mirando otra cosa. El navegador frena esos temporizadores a uno por
minuto y puede llegar a congelar la página, y eso está contemplado más abajo.

El latido escribe el documento de la partida sólo para actualizar `latidos`. Si
además cambió **quién está ausente**, republica las vistas; si no cambió, no
—serían miles de escrituras por partida—.

---

## El barrido: `barrerPartidas`

Una función programada, **cada minuto**, que es el intervalo más corto que
admite el programador de Firebase.

### Por qué existe

Porque el golpe sale sólo con la pestaña **visible**. Si los cuatro jugadores
minimizan a la vez —el cambio de ronda, que es cuando todo el mundo mira el
marcador y se va a hacer otra cosa— nadie golpea y la partida se congela. Con
las entradas cobradas y el pozo retenido, para siempre: cerrar la sala también
es una transición de esa misma máquina que no corre.

### Qué hace, en orden

1. Busca las partidas con `plazo.hasta <= ahora`.
2. **Pregunta si queda alguien.** Si nadie de los que siguen en pie latió en
   **diez minutos** (`MS_MESA_DESIERTA`), da la mesa por desierta y marca el
   abandono de todos, lo que la lleva a `finPartida`.
3. Empuja hasta 8 transiciones por partida.
4. Si alguna llega a `cerrarPartida`, corre el cierre: insignias y ranking.

### Por qué diez minutos y no quince segundos

`MS_SIN_SENALES` mide a **uno** para saltarle el turno, y equivocarse cuesta un
turno. Esto mide a los **cuatro** para terminar la partida y devolver el pozo, y
equivocarse cuesta una partida en curso.

El navegador frena los latidos de una pestaña de fondo a uno por minuto y
pasados unos minutos puede congelar la página del todo. Quince segundos de
silencio no significan nada; diez minutos sí. Y si aun así se equivoca, el error
cae del lado bueno: a cada uno le vuelve lo que puso.

### El fallo que esto ya encontró

El barredor salió a producción y **destrabó** las partidas, pero destrabar no es
terminar. A una mesa sin nadie le daba `saltarTurno`, que corre el turno al
siguiente y no hace nada más: no mueve una carta, no elimina a nadie, no termina
la ronda. Doce minutos de registros con `pasos: 2, cerradas: 0`, sin un solo
error, mientras el registro de la partida se iba llenando renglón a renglón.

El paso 2 de arriba es el arreglo. Está en `pruebas/barrido.mjs`, que reproduce
el giro antes de arreglarlo.

---

## Dónde mirar

| Qué | Archivo |
|---|---|
| El golpe y el latido | `public/js/partida-red.js` |
| Los plazos | `functions/partida-red.js`, `plazoDe` |
| El barredor | `functions/index.js`, `barrerPartidasVencidas` |
| Cuántas llamadas salen de verdad | `pruebas/e2e/golpes.spec.js` |
| Que ningún techo ahogue al juego | `pruebas/ritmo.mjs` |
| El barredor y la mesa desierta | `pruebas/barrido.mjs` |
