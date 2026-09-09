# El panel de administración

Qué se puede hacer desde `/admin/`, qué pasa con la plata de la gente en cada
caso, y qué está deliberadamente prohibido.

**La regla que atraviesa todo esto**: ninguna operación del panel escribe
`credits` por su cuenta. Todas pasan por `moverLeyendas`, que es la única
puerta al saldo y deja un asiento en `movimientos/`. Ese libro mayor no se
borra nunca, ni siquiera cuando se borra la sala que lo originó.

---

## Salas

### Cancelar una sala EN ESPERA

Devuelve la entrada a cada jugador y deja la sala `cancelada`. Inofensivo: la
partida no empezó, nadie jugó nada.

La clave de idempotencia es `devolucion_{codigo}_{uid}`, **la misma** que usa
`salida.js`. A quien ya se le devolvió cuando se fue por su cuenta, no se le
devuelve otra vez.

También está el botón que cancela **todas** las que esperan de una pasada. Ese
consulta sólo las que están en espera y llama sin confirmación, así que no puede
cortar una partida ni por accidente.

### Cancelar una sala EN JUEGO

Se puede, pero **hay que pedirlo dos veces**: confirmar, y después escribir el
código de la sala. Es la misma ceremonia que el borrado forzado del catálogo,
porque en una lista donde las salas esperando y las jugando se ven casi iguales
un clic de más le cortaría la partida a cuatro personas.

**Qué devuelve.** La **entrada** de cada jugador. No el pozo repartido: la
partida no terminó, así que no hay ganador ni premio que pagar.

La penalización por abandono **no** se devuelve. Es un cobro aparte, por una
decisión que esa persona tomó, y cancelar la sala no la deshace.

**Por qué esto no paga dos veces.** Era el riesgo real y estaba a un paso: el
cierre reparte premios de ese mismo pozo cuando la partida llega al final, y
`planificar` sólo cortocircuitaba con la sala `terminada`, no con `cancelada`.
O sea que cancelar y devolver habría dejado la partida viva para que el barredor
la empujara hasta el final y el cierre pagara premios de un pozo ya devuelto.

Ahora la puerta se cierra por los dos lados:

- la partida queda marcada `cerrada`, y **`avanzarPartida` se niega a mover una
  partida cerrada** — el barredor deja de encontrarla;
- la sala queda `cancelada`, y **`planificar` no reparte nada de una sala
  cancelada**.

Cualquiera de las dos sola alcanzaría. Van las dos porque equivocarse acá cuesta
plata de verdad. Las dos tienen prueba propia: `pruebas/barrido.mjs` y
`pruebas/cierre.mjs` sección 4c.

### Retocar una sala

Sólo si está **en espera**, y sólo dos campos:

| Campo | ¿Editable? |
|---|---|
| `nombre` | sí |
| `maxJugadores` | sí, entre 2 y 4, y nunca por debajo de los que ya entraron |
| `entrada` | **no**, y el campo ni se acepta |
| `pozo`, `jugadores`, `estado` | no |

**Por qué la entrada no está.** La regla es que queda fija en cuanto alguien
pagó — y en una sala viva **siempre** pagó alguien: la paga el creador en la
misma transacción que crea la sala, y si el creador se va, la sala se cancela
entera. O sea que la regla, aplicada, dice «nunca». Aceptar el campo igual sería
escribir una rama inalcanzable que el día que alguien alcance desincroniza el
pozo, que está congelado con el número viejo.

Para cambiar la apuesta: cancelar —que devuelve— y abrir otra.

### Borrar salas cerradas

Sólo `cancelada` y `terminada`: en las dos, la plata ya se movió y quedó
asentada. Una sala esperando o jugando tiene entradas adentro; ésas se cancelan
primero.

Se van con ella el documento de la partida y las **vistas** de cada jugador, que
son subcolección suya y quedarían huérfanas.

**Por qué esto no es prolijidad.** `listarSalasAdmin` lee las colecciones
`rooms` y `partidas` **enteras** en cada refresco del panel y descarta las
cerradas *después* de leerlas. Sin una limpieza, abrir el panel cuesta cada vez
más, y crece con todas las salas que hubo desde siempre.

Hay borrado de a una y un «borrar todas las cerradas» con tope por vuelta: un
lote de Firestore admite 500 escrituras y cada sala se lleva su partida más una
vista por jugador.

---

## Torneos

Son **manuales**. Los crea el administrador y los mueve a mano, paso por paso.
No hay torneos automáticos y es a propósito: cada paso hace algo irreversible
con la plata de la gente.

### El camino

```
borrador ──▶ inscripciones_abiertas ──▶ completo ──▶ en_curso ──▶ finalizado
    │                 │                     │
    └─────────────────┴─────────────────────┴──▶ cancelado
```

| Paso | Qué hace con la plata |
|---|---|
| **Crear** | nada. Es un borrador |
| **Abrir inscripciones** | nada, pero a partir de acá **se cobra** a quien se anota |
| **Cerrar inscripciones** | si no llegan a cuatro, se cancela solo y devuelve todo |
| **Armar mesas y empezar** | devuelve la entrada a los que **sobran** de las mesas de cuatro |
| **Cargar ganadores y pagar** | reparte el pozo |
| **Cancelar** | devuelve todas las entradas cobradas |

`cancelado` se alcanza desde casi cualquier lado porque cancelar es la salida de
emergencia. **Desde `en_curso` no**: con la gente ya jugando, cancelar sería
devolverle la entrada a quien ya perdió y a quien ya ganó por igual. Desde
`finalizado` tampoco, porque ya se pagó.

### Qué se puede editar, y cuándo

| Estado | Campos editables |
|---|---|
| `borrador` | nombre, tipo, descripción, fecha, entrada, cupo |
| `inscripciones_abiertas` | nombre, tipo, descripción, fecha |
| `completo` | nombre, tipo, descripción, fecha |
| `en_curso` | nombre, tipo, descripción, fecha |
| `finalizado`, `cancelado` | ninguno: son historia |

**Por qué no es «se puede o no se puede».** Era eso, y por eso un torneo
publicado no se podía tocar en nada, ni para corregirle una falta de ortografía
al nombre. Pero no todos los campos pesan lo mismo: la **entrada** y el **cupo**
son las dos cosas que el jugador miró antes de pagar —cuánto le costaba y contra
cuántos iba a jugar—. El nombre y el tipo son etiquetas.

La lista vive en `camposEditables`, en las reglas, y la usan **el panel y el
servidor**. El botón «Editar» aparece o no según esa misma función: no hay
dos listas que mantener de acuerdo.

**Se queja, no ignora.** Si llega una entrada distinta con las inscripciones
abiertas, la llamada falla y lo dice. Guardar el resto en silencio dejaría al
administrador creyendo que cambió la entrada, y se enteraría cuando alguien
pague el número viejo.

Mandar la entrada **igual** a la que ya estaba no es cambiarla: el panel manda el
formulario entero en cada guardado.

**La fecha se puede mover después de publicar**, y es deliberado. Postergar un
torneo es una operación normal y la alternativa —cancelar, devolverle a todos y
recrear— es peor para todo el mundo. Es la decisión más discutible de la lista,
porque cambia algo que el jugador miró antes de pagar; queda escrita en
`pruebas/torneos.mjs` en vez de escondida.

### Cuándo se juega, y lo que sigue faltando

El torneo lleva `descripcion` y `comienzaEn`, y las dos aparecen en la cartelera
y en el aviso de confirmación **antes de cobrar**. Las dos pueden quedar vacías:
un torneo puede publicarse antes de saber cuándo se juega, y una fecha inventada
sería peor que ninguna.

Existen por una razón concreta. `iniciar` agrupa los uid en mesas **dentro del
documento del torneo**: no crea salas, no crea partidas y **no notifica a
nadie**. El aviso al anotarse decía «te avisamos cuando arranque» y no hay nada
que avise, así que el jugador pagaba sin saber cuándo tenía que estar.

Ahora dice «Empieza el sábado 20:00» si hay fecha, y «Mirá la cartelera para
saber cuándo arranca» si no la hay — porque prometer un aviso que no existe era
peor que no prometer nada.

**Esto no cierra el agujero.** Sigue sin haber notificación y sin mesas donde
jugar el torneo: el torneo se corre a mano, fuera del juego, y el administrador
carga los ganadores al final. La fecha mejora la vidriera; el flujo del torneo
dentro del juego no existe.

### El panel tiene que ver lo que administra

Durante un tiempo no lo veía. `torneos-admin.js` listaba con `listarTorneos`,
que es **la del jugador** y devuelve sólo los que tienen inscripciones abiertas.
Un torneo nace en borrador y el botón «Abrir inscripciones» vive en la fila de
la lista: el torneo quedaba inalcanzable apenas se creaba, y cerrar inscripciones
lo sacaba de la lista otra vez, así que los tres pasos siguientes tampoco se
podían tocar.

Lo delató que `accionesDe` tenía ramas para `borrador`, `completo` y `en_curso`
que no se dibujaban jamás. El panel usa `listarTorneosAdmin`, que es la misma
consulta sin el filtro.

---

## Catálogo de la tienda

El botón **Sembrar catálogo** llena la colección con los artículos de arranque.
No pisa lo que ya está: los precios cambiados se respetan y sembrar dos veces no
revierte nada — sólo agrega los que falten.

**Hay que tocarlo al menos una vez.** El catálogo vive en Firestore, no en el
archivo: los artículos nuevos que se agregan a la semilla en el código no
aparecen en la tienda hasta que se siembra.

### Quitarle un artículo a alguien

`borrarItemAdmin` se niega a borrar lo que alguien tenga. Para eso están:

- **ver poseedores**: recorre todas las compras que hubo, así que es la consulta
  más cara del panel;
- **desposeer**: le saca el artículo a una persona y **le devuelve lo que pagó**,
  desequipándoselo de paso;
- **borrado forzado**: hace lo anterior con todos y después borra. Pide escribir
  el id del artículo.

Cada quita queda anotada en `auditoria/`, que está cerrada al cliente por las
reglas de Firestore.

---

## Lo que el panel NO puede hacer

| | Por qué |
|---|---|
| Escribir un saldo a mano | `moverLeyendas` es la única puerta, y deja asiento |
| Cambiar la entrada de una sala con gente | desincroniza el pozo, que está congelado |
| Cambiar la entrada o el cupo de un torneo publicado | es lo que el jugador miró antes de pagar |
| Cancelar un torneo en curso | devolvería igual al que ganó y al que perdió |
| Borrar una sala que retiene Leyendas | primero se cancela, que devuelve |
| Tocar la tienda de dinero real | es otro sistema y no se mezcla |

---

## Dónde mirar

| Qué | Archivo |
|---|---|
| Las operaciones de sala | `functions/admin.js` |
| Las de torneo | `functions/torneos.js` |
| Qué se puede editar y cuándo | `public/js/reglas/torneos.js`, `camposEditables` |
| El cierre y el reparto del pozo | `functions/cierre.js` |
| La pantalla | `public/admin/` |
| Las pruebas | `pruebas/admin.mjs`, `pruebas/torneos.mjs`, `pruebas/cierre.mjs` |
