# MEMORIE LEGENDS — REGLAMENTO OFICIAL

> Versión 2 — 20 de septiembre de 2026.
> El anexo del final dice qué cambió respecto de la versión 1 y por qué.
>
> Este documento manda. Si el juego hace otra cosa, es un bug del juego; si el
> reglamento dice algo que el juego no puede hacer, es un bug del reglamento.
> La página pública `public/como-se-juega.html` es un resumen de esto, no una
> fuente aparte.

---

## 1. CONCEPTO

Memorie Legends es un juego de habilidad basado en memoria, observación,
estrategia, timing y gestión de información.

No alcanza con recordar una carta: hay que recordar dónde estaba, quién era su
dueño, si cambió de posición y si la información sigue siendo válida.

---

## 2. JUGADORES

- De 2 a 4 jugadores. Máximo: 4.
- Se puede jugar contra IA en cuatro niveles: Fácil, Medio, Difícil y Experto.
- Cada nivel cambia tres cosas: el porcentaje de error al descartar, el tiempo
  de reacción y **cuánto recuerda** de lo que vio.

| Nivel | Error | Reacción | Memoria |
|---|---|---|---|
| Fácil | 30% | 2–4 s | 45% |
| Medio | 15% | 1–3 s | 70% |
| Difícil | 5% | 0,5–1,5 s | 90% |
| Experto | 0% | 0,3–0,8 s | 100% |

---

## 3. MAZO Y VALORES

Baraja de 48 cartas: cuatro palos —Basto, Copa, Espada, Oro— de doce valores
cada uno. Sin comodines.

- **11 = 0 puntos.** Es la mejor carta que podés tener.
- **12 = 12 puntos.** La más cara.
- El resto vale su número: 1=1, 2=2… 10=10.
- **El palo no importa** para las coincidencias: se comparan valores.
- Las cartas con poder son **7, 8, 9 y 10**.
- El poder **sólo se activa si tirás la carta sin cambiarla**. Tener un 7, 8, 9
  o 10 boca abajo entre tus cartas no activa nada.

---

## 4. PREPARACIÓN Y MIRADA INICIAL

1. Cada jugador recibe **4 cartas boca abajo**.
2. Se reparte la carta muestra al centro. **Se dibuja de dorso** hasta que
   termina la mirada: durante esos segundos hay que mirar la carta propia, no
   memorizar la muestra.
3. **Mirada inicial: 5 segundos para elegir + 2 segundos para ver.** Cada
   jugador toca una de sus cuatro cartas; esa carta se le muestra a él solo,
   durante dos segundos, y se vuelve a tapar.
4. Si no elegís en los 5 segundos, se abre la primera carta.
5. Los demás ven **dónde** miraste, nunca qué viste.

Estos tiempos son los mismos en entrenamiento y en partidas por Leyendas.

---

## 5. CARTA MUESTRA

- Al terminar la mirada, la muestra queda boca arriba en el centro.
- Las coincidencias se determinan **por valor**, no por palo.
- Si la muestra es un 11, sólo otro 11 coincide. Que el 11 valga 0 puntos no
  cambia con qué coincide.
- Si la muestra es un 7, sirve cualquier 7.

---

## 6. FASE DE DESCARTE POR REFLEJOS

- **Duración: 5 segundos.** Todos los jugadores descartan a la vez.
- **Un intento por ventana sobre tu propia mano.** El primero que mandás es el
  que cuenta: un roce no se cobra dos veces y tocar tres cartas no cuesta tres
  castigos.
- Descartar es **opcional**.

Los tres desenlaces:

| Desenlace | Qué pasa |
|---|---|
| **Acertás primero** | Tu carta se va al descarte y pasa a ser la muestra. Sin castigo. |
| **Acertás tarde** | **Conservás la carta y sumás una de castigo: neto +1.** La carta que intentaste descartar queda expuesta a todos durante 2 segundos. |
| **Errás** | Conservás la carta, sumás una de castigo, y todos ven cuál era y en qué posición estaba durante 2 segundos. Además esa carta queda **conocida**: cualquiera puede intentar descartártela (capítulo 9). |

La carta de castigo que recibís en un **error** también se muestra a los cuatro
y queda conocida por todos, vos incluido.

En red, un toque que llega tarde por la conexión se acepta dentro de una
**gracia de 2 segundos**: lo que vale es el momento del toque, no el de la
llegada. Si dos toques quedan a menos de **60 milisegundos**, el orden se
resuelve por **sorteo determinista**: la misma partida da siempre el mismo
resultado, y la conexión no decide.

---

## 7. TURNOS: LEVANTAR DEL MAZO

- Los turnos van en orden: A → B → C → D → A…
- A los jugadores eliminados se los saltea.
- En tu turno **tenés 8 segundos para levantar**. Si se vencen, se levanta y se
  tira por vos.
- Una vez levantada la carta, **tenés 10 segundos** para elegir:
  - **Cambiarla** por una de tus cartas, en cualquier posición. La que sale
    queda de muestra y abre una ventana de reflejos de 3 segundos.
  - **Tirarla** directamente, sin cambiarla. Si es 7, 8, 9 o 10, se activa su
    poder.
  - Si se vencen los 10 segundos, la carta se tira.

---

## 8. PODERES ESPECIALES

| Carta tirada sin cambiar | Poder |
|---|---|
| **7** | Mirar 1 carta propia. |
| **8** | Mirar 1 carta de un rival. |
| **9** | Intercambio a ciegas con la carta de otro jugador. |
| **10** | Intercambio viendo las dos cartas antes de decidir. |

- El poder **sólo existe si la carta se tiró directamente del mazo**.
- Usarlo es opcional.
- **Tenés 10 segundos para resolverlo.** Si se vencen, el poder se saltea sin
  efecto. Con el 10, si se vencen los 10 segundos de la segunda mitad, no se
  cambia nada.
- Primero corren los reflejos de toda la mesa y después el poder. Al terminar
  el poder, quien lo usó tiene una **ventana privada de 3 segundos** para
  descartarle una carta a un rival, si conoce alguna (capítulo 9).

---

## 9. DESCARTE AL RIVAL

Es la jugada que convierte la memoria en ventaja: descartarle a otro una carta
suya que vos conocés.

### Cómo se conoce una carta ajena

- **Poder 8:** mirás una carta de un rival. Desde ahí la conocés.
- **Poder 10:** ves las dos cartas —la tuya y la del rival— antes de decidir.
  Conocés las dos, cambies o no.
- **Castigo ajeno:** cuando alguien erra un descarte, su carta y la de castigo
  quedan a la vista de los cuatro. Desde ahí las conocen todos.
- **Seguimiento con el 9:** el 9 no muestra nada, pero las cartas se mueven a
  la vista de todos. Si le pasaste al rival una carta que conocías, sabés qué
  tiene; si te sacaron una que conocías, sabés en qué mano quedó.

### Cómo viaja el conocimiento

- Lo que se conoce es **la carta**, no el lugar. Si se mueve con un 9 o un 10,
  se la sigue conociendo **en su posición nueva**.
- El conocimiento **se pierde** cuando la carta sale de las manos: al
  descartarse, al cambiarse por la levantada o al entregarse en un acierto.
- Al repartir una ronda nueva, todo el conocimiento se borra.
- El **7 nunca** da conocimiento de una carta ajena: mira una propia.

### Cómo se juega

1. Durante una ventana de descarte, tocás **dos veces** la carta del rival que
   conocés. Sólo se pueden tocar las cartas conocidas.
2. El juego dice en el acto si acertaste:
   - **Acierto** (la carta va con la muestra): la carta del rival se va al
     descarte —**él queda con una menos**— y vos elegís **a ciegas** una de tus
     cartas, que ocupa exactamente ese lugar, boca abajo. **Quedás con una
     menos.** Tenés **5 segundos** para elegirla; si no elegís, la elige el
     azar.
   - **Error** (no va con la muestra): la carta del rival no se mueve, queda
     expuesta 2 segundos, y **vos sumás una carta de castigo**.
3. Mientras dure la ventana podés intentar **más de una vez** sobre cartas
   ajenas, y cada error vuelve a costar. El límite de un intento por ventana es
   sólo para tu propia mano.

Nadie ve jamás qué carta entregaste, ni siquiera vos.

---

## 10. CORTAR

- En tu turno, **después de levantar**, podés cortar. Tenés **20 segundos**
  para decidir entre cortar y pasar.
- Al cortar se revelan todas las manos y **todos suman los puntos de su mano,
  incluido el que cortó**.
- **−10 puntos** si cortás sin quedarte ninguna carta.
- **+10 puntos** si cortás sin tener el puntaje más bajo.
- Si **empatás** en el puntaje más bajo, no hay castigo.

### Corte automático

Si te quedás con **0 cartas**, la ronda se corta sola y el corte es tuyo, con su
bono de −10. Si dos jugadores se vacían en la misma ventana, corta **el que se
vació primero**, según el orden de reacción de esa ventana.

---

## 11. AUSENTE Y «HE VUELTO»

Si dejás vencer los 20 segundos de cortar o pasar sin tocar nada, quedás
marcado como **ausente**:

- Tu asiento se ve apagado y dice «ausente» para todos.
- **Tus turnos se saltean al instante**: los demás no pierden tiempo
  esperándote.
- Volvés apretando **«He vuelto»**, y seguís desde la ronda en curso.

En partidas por Leyendas hay además una marca por **silencio**: si tu mesa deja
de dar señales durante 15 segundos, se te puede saltear el turno. Son dos cosas
distintas: una mide inactividad, la otra, desconexión.

---

## 12. ARRANQUE EN RED

- La primera ronda **espera a que lleguen los cuatro**, hasta **15 segundos**.
  Al que no llega se le pierde la mirada, como si se hubiera desconectado.
- Cuando llega el último, corre una **cuenta regresiva de 4 segundos**
  —«3, 2, 1, Preparate…»— igual para las cuatro pantallas.
- Hasta que la cuenta termina no se puede tocar ninguna carta.

---

## 13. RONDAS, MANO Y FIN DE PARTIDA

- El puntaje se **acumula entre rondas**.
- Al terminar una ronda, **la mano rota al jugador siguiente** en el orden de
  la mesa (A → B → C → D → A), salteando eliminados. La mano abre la ronda.
- **Límite de puntos: 150 por defecto.** También se puede jugar a **60** o a
  **100**, tanto en entrenamiento como en partidas por Leyendas; el límite se
  elige al crear la mesa y vale para toda la partida.
- Quien **supera** el límite queda eliminado. Con el límite exacto seguís
  jugando.
- Gana **el último que quede por debajo del límite**.

### Empate final

Si en la misma ronda se pasan todos del límite y quedan **empatados en el
puntaje más bajo**, hay **rondas extra**:

- Vuelven a la mesa **sólo los empatados en ese puntaje más bajo**.
- Vuelven **con el puntaje que tenían**: no se reinicia nada.
- Se juegan rondas normales hasta que uno quede solo por debajo del límite o
  haya un único puntaje más bajo.

---

## 14. ABANDONO EN PARTIDAS POR LEYENDAS

- Abandonar es una decisión explícita, con aviso previo.
- Cuesta **la mitad de la entrada** de esa mesa, que se descuenta al
  abandonar.
- La mesa sigue jugando sin vos: tus turnos se saltean y tus cartas quedan
  fuera del reparto del pozo.
- Perder la conexión **no** es abandonar: no cuesta Leyendas. Lo único que pasa
  es que te saltean el turno mientras no des señales.

---

## 15. TIEMPOS Y RELOJES

| Momento | Tiempo | Qué pasa al vencer |
|---|---|---|
| Elegir la carta de la mirada inicial | 5 s | Se abre la primera |
| Ver la carta mirada | 2 s | Se tapa |
| Descarte por reflejos | 5 s | Se cierra la ventana |
| Gracia de red para un toque | 2 s | Se rechaza el intento |
| Revelación por error o acierto tarde | 2 s | Se tapa |
| Levantar del mazo | 8 s | Se levanta y se tira |
| Decidir qué hacer con la levantada | 10 s | Se tira |
| Resolver un poder | 10 s | Se saltea |
| Cortar o pasar | 20 s | Pasa, y quedás ausente |
| Elegir la carta que entregás tras un acierto | 5 s | La elige el azar |
| Ventana de reapertura al cambiar la muestra | 3 s | Se cierra |
| Ventana privada después de un poder | 3 s | Se cierra |
| Espera de jugadores en la primera ronda (red) | 15 s | Arranca igual |
| Cuenta regresiva antes de la primera mirada (red) | 4 s | Empieza la mirada |

Todos los relojes los cuenta el servidor en las partidas por Leyendas. Lo que
se ve en pantalla es un espejo de ese reloj: si llega a cero, quien actúa es el
servidor, no el navegador.

---

## 16. CHULETA RÁPIDA

- 4 cartas al inicio. Mirás una: 5 s para elegir, 2 s para verla.
- La muestra define coincidencias **por valor**. 11 = 0 puntos; el resto, su número.
- Descarte por reflejos: 5 s, todos a la vez, **un intento sobre tu mano**.
- Primero → te la sacás. Tarde → la conservás y sumás una (+1). Error → sumás
  una y queda expuesta 2 s.
- 7 → mirar propia · 8 → mirar rival · 9 → cambio ciego · 10 → cambio con vista.
  Sólo si tirás la carta sin cambiarla.
- Carta ajena que conocés: dos toques. Acierto → él pierde una y vos entregás
  una a ciegas (5 s para elegir). Error → sumás una.
- 0 cartas → corta solo, −10. Corte sin el menor → +10. Empate en el menor → sin castigo.
- Superar el límite (150, 100 o 60) → eliminado. Gana el último por debajo.

---

## 17. FILOSOFÍA

SABER → RECORDAR → DEDUCIR → DECIDIR → ACTUAR → VOLVER A RECORDAR.

No gana necesariamente quien memoriza más.
Gana quien convierte mejor la información en decisiones.

---

## ANEXO — QUÉ CAMBIÓ EN LA VERSIÓN 2

Esta versión sale de una auditoría regla por regla contra el código y contra la
web. Cada punto dice qué decía la versión 1, qué dice ahora y por qué.

### Correcciones

1. **Acierto tarde (capítulo 6).**
   Antes: «descartás, pero recibís +1 carta» —neto 0—.
   Ahora: **conservás la carta y sumás una: neto +1**, y la carta queda
   expuesta 2 segundos.
   Por qué: es lo que el juego hacía desde hace meses, y con razón. Si el
   tardío se sacara la carta de encima, intentar siempre convendría: cambiaría
   una carta conocida por una desconocida sin costo neto. Además la muestra
   crecía con una carta que nadie ganó. La exposición de 2 segundos se agrega
   ahora para que el castigo sea público, igual que el del error.

2. **Mirada inicial (capítulo 4).**
   Antes: «2 segundos», sin distinguir elegir de ver, y en red sólo había 2
   segundos para las dos cosas.
   Ahora: **5 segundos para elegir + 2 para ver**, iguales en los dos modos.
   Por qué: en red, con la latencia real, un toque al segundo y medio podía
   llegar cuando la mirada ya estaba cerrada; hubo miradas rechazadas en
   producción. Y entrenamiento y red no pueden repartir tiempos distintos.

3. **Límite de puntos (capítulo 13).**
   Antes: «límite único: 150».
   Ahora: **150 por defecto, con 60 y 100 disponibles**, en entrenamiento y en
   red.
   Por qué: las partidas cortas ya existían en entrenamiento y no estaban
   escritas; ahora existen también en red y el reglamento las contempla.

4. **Intentos por ventana (capítulo 6).**
   Antes: no se decía.
   Ahora: **un intento sobre la mano propia por ventana**, en los dos modos.
   Por qué: en red ya era así y en entrenamiento no, así que la misma jugada
   costaba distinto según dónde se jugara.

### Capítulos nuevos

5. **Descarte al rival (capítulo 9).** La mecánica completa: de dónde sale el
   conocimiento, cómo viaja con la carta, cómo se pierde, y qué pasa al acertar
   y al errar. No estaba escrita en ninguna parte.
6. **Tiempos y relojes (capítulo 15).** La versión 1 decía que los poderes no
   tenían tiempo. Lo tienen, y todo lo demás también.
7. **Corte automático (capítulo 10).** Quedarse sin cartas corta la ronda, con
   su criterio de desempate.
8. **Ausente y «He vuelto» (capítulo 11).**
9. **Arranque en red (capítulo 12).**
10. **Rotación de la mano (capítulo 13).**
11. **Empate final (capítulo 13):** quiénes vuelven y con qué puntaje.
12. **Abandono en Leyendas (capítulo 14).**

### Aclaraciones

13. Al cortar, **todos** suman su mano, incluido el cortador.
14. La muestra se reparte antes de la mirada pero **se dibuja de dorso** hasta
    que termina.
15. En red, el **empate técnico de 60 ms** se resuelve por sorteo determinista.
16. **De 2 a 4 jugadores**, no sólo «máximo 4».
17. La IA también varía **cuánto recuerda**, además del error y la reacción.
18. La **carta de castigo de un error** se muestra a los cuatro y queda
    conocida.
