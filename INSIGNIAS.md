# Insignias

Las insignias son logros. No se compran, no se venden y no se regalan: se
ganan jugando, las otorga el servidor, y desde ahora **pagan Leyendas**.

---

## Las seis

| Insignia | Se gana | Paga | Cuándo se otorga |
|---|---|---|---|
| Novato | jugar 1 partida | +20 | al cerrarse la partida |
| Aventurero | ganar 5 partidas | +30 | al cerrarse la partida |
| Estratega | ganar 10 partidas | +40 | al cerrarse la partida |
| Héroe | ganar 25 partidas | +60 | al cerrarse la partida |
| Campeón | ganar 1 torneo | +50 | al cerrarse la partida siguiente |
| Leyenda | entrar al top 10 del ranking mensual | +100 | el día 1 a las 00:00 |

Techo por cuenta: **300 Leyendas**, una sola vez en la vida y por
idempotencia, no por buena voluntad.

La condición y el premio viven juntos en `public/js/reglas/insignias.js`, en
`CONDICIONES`. Es el único lugar donde se cambian: el servidor lee de ahí para
otorgar y el panel del jugador lee de ahí para dibujar la barra de progreso,
así que no hay forma de que se desincronicen.

---

## Cuándo llegan, de verdad

**Las cinco de partida son inmediatas.** `despuesDelCierre` corre dentro de la
misma llamada que cierra la partida, justo después de la transacción. Va
después y no adentro porque para saber si se ganó «Novato» hay que **leer**
`gamesPlayed`, que la transacción de cierre acaba de **escribir**, y Firestore
no deja leer después de escribir. Como corre con la transacción ya confirmada,
lee el contador nuevo: la insignia se otorga por *esa* partida, no por la
anterior.

Quién dispara el cierre es lo único que puede demorarlo. Lo normal es que lo
llame un jugador que sigue en la mesa cuando vence el plazo. Si todos cerraron
la pestaña, lo levanta `barrerPartidas`, que corre **cada minuto**.

**«Leyenda» espera al cierre del mes**, `cerrarRankingMensual`, cron
`0 0 1 * *` en `America/Montevideo`. No es un defecto: el puesto no existe
hasta que el mes termina. Lo que sí queda para siempre es la marca —
`registrarPuestoMensual` guarda el **mejor** puesto histórico, nunca el
último — así que quien fue tercero una vez es Leyenda aunque después no juegue
más.

---

## Dónde vive lo que un jugador tiene

En `users/{uid}/items/{itemId}`, el mismo lugar que un avatar o un dorso. El
id del documento es el id del artículo, y de ahí sale la idempotencia: otorgar
dos veces escribe el mismo documento, no dos.

Un segundo lugar para «cosas que tenés» sería un segundo lugar donde puede
desincronizarse. **Ya lo hubo**, y ver la sección siguiente.

---

## El pago

Otorgar dejó de ser una escritura inocente: mueve saldo. Por lo tanto pasa por
`moverLeyendas`, que es la única puerta que escribe `credits`, con su asiento
en el libro mayor y su clave de idempotencia.

`tienda.otorgar` es una **transacción**: lee el catálogo y la posesión, paga, y
recién entonces anota. Saldo y posesión se mueven juntos o no se mueven. Con
dos escrituras sueltas, un corte en el medio dejaba al jugador con la insignia
y sin las Leyendas.

**Dos candados contra el pago doble.** El documento de posesión hace que
revisar dos veces no vuelva a entrar. Y si igual entrara —dos servidores a la
vez, o una posesión que un administrador borró desde el panel— la clave
`logro_{uid}_{itemId}` del libro mayor impide el segundo asiento.

El motivo contable es propio, `premio_logro`, y no `premio_partida`: el premio
de una partida sale del pozo que pusieron los jugadores —redistribuye— y esto
lo emite la casa —crea—. Con un motivo compartido, el libro mayor no podría
responder cuántas Leyendas se emitieron, que es justo lo que hay que poder
vigilar cuando las Leyendas también se compran con dinero.

---

## El aviso en la mesa

Al terminar, el modal del final anuncia lo que se ganó: «🏆 ¡Ganaste la
insignia Novato! +20 Leyendas».

Viaja en `partidas/{codigo}/logros/{uid}`, uno por jugador, y las reglas sólo
dejan leer el propio. Un único documento con los cuatro adentro le contaría a
cada uno lo que ganaron los otros.

**No viaja en la vista**, y la razón importa: la vista la escribe el motor
*dentro* de la transacción que cierra, y el cliente la filtra por `version`,
descartando cualquier vista cuya versión no sea mayor que la última que vio.
Las insignias se otorgan *después* de esa transacción, así que meterlas ahí
obligaba a inventar una versión más y a que el motor y el añadido se pusieran
de acuerdo sobre quién numera.

Con su propio documento no hay carrera. El cliente escucha con `onSnapshot`
desde que arranca la mesa: si el aviso llega antes de que se abra el modal, lo
encuentra esperando; si llega después, lo pinta sobre el modal abierto. Las
dos ramas están probadas en `pruebas/e2e/logro-en-la-mesa.spec.js`.

Si el pago no se aplicó —la clave de idempotencia lo frenó— el servidor manda
`leyendas: 0` y la mesa **no** anuncia un saldo que no llegó.

---

## Lo que se sacó, y por qué

Había **dos sistemas de insignias que no se hablaban**.

El que andaba es el de arriba. El que no andaba escribía cinco ids más
—`dorada`, `plateada`, `bronce`, `top10` y `comprador-elite`— con `arrayUnion`
en `users/{uid}.insignias`, un campo del perfil que **no leía ninguna función
ni ninguna pantalla**, y con ids que no existían en ningún catálogo.

- **Los cuatro del ranking** venían de `PREMIOS_RANKING`, un id por tramo.
- **`comprador-elite`** venía del Pack Élite, que cuesta $1000, y la tienda
  anunciaba «🏆 Incluye insignia».

Nadie recibía ninguna de las cinco. No fallaba nada: `arrayUnion` sobre un
campo que nadie lee funciona perfectamente. No hay excepción, no hay registro.
Sólo que el jugador no recibe lo que pagó.

Se sacaron las cinco. El ranking sigue pagando Leyendas por puesto y su única
insignia es «Leyenda»; los paquetes dan Leyendas y nada más.

`pruebas/logros-y-packs.mjs` vigila que no vuelvan: que ningún paquete ni
ningún tramo prometa una insignia, que nadie escriba ese campo del perfil, y
que **todo id de insignia que aparezca en las reglas exista en el catálogo**.
Esa última es la regla que se había violado, escrita como prueba.

---

## Cambiar un umbral o un premio

En `CONDICIONES`, y en ningún otro lado. Dos avisos:

**El corte del ranking sale de la condición.** `PUESTO_MENSUAL_CON_INSIGNIA`
se deriva de `maximo`, y el servidor lo usa para decidir a quién le anota el
puesto. Con una copia suelta, mover el corte de 5 a 10 en un solo lado dejaba
a los puestos 6 a 10 mereciendo la insignia sin que nadie les anotara el
puesto que la justifica.

**Bajar un umbral no paga hacia atrás.** Quien ya tiene la insignia no vuelve
a entrar por `insigniasNuevas`, así que no cobra el premio nuevo; quien la
gane después de la baja, sí. Es la decisión conservadora —no se emite dinero
retroactivo sin querer— pero es una decisión, no una consecuencia inevitable:
si alguna vez se quiere pagar hacia atrás, hace falta un backfill explícito
contra producción.
