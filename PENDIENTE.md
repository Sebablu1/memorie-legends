# Pendiente

Lo abierto, en 3 minutos de lectura. Lo cerrado vive en `HISTORIA.md`.

Última revisión: 10 de octubre de 2026.

Los commits con `§N` en el mensaje cierran la sección N.
Buscar: `git log --oneline --all --grep="§N"`.

---

## 🔴 Bloquea dinero

### §2 — Encender la venta de packs

- **Estado:** `SOLO_ADMIN_COMPRA = true` en `index.js`. Pagos funcionan, pero
  solo el admin puede comprar.
- **Qué falta:** decisión del dueño. Es cambiar la constante a `false` y
  desplegar.
- **Antes de encender:** §3 y §41.

### §3 — Cuenta bancaria de Mercado Pago

- **Estado:** sin verificar. Bloquea retirar, no cobrar.
- **Cómo se resuelve:** cuenta verificada en el panel de MP + admite
  transferencias.

### §41 — Panel de Mercado Pago apuntando a São Paulo

- **Estado:** el panel apunta a la URL vieja de v1 (us-central1), que devuelve
  404 desde la mudanza.
- **Qué falta:** cambiar en el panel de MP la URL de notificaciones a:
  `https://southamerica-east1-memorie-legends.cloudfunctions.net/webhookPago`
- **Si se olvida:** MP cobra y las Leyendas no llegan. Sin error.
- **No urge:** los pagos están apagados (§2).

---

## 🟡 Bloquea venta al público

### §20 — Premios físicos (remera / llavero)

- **Estado:** `PREMIOS_FISICOS_ACTIVOS = false`. Esperando al abogado.
- **Dos cosas antes de encender:**
  1. `juegos/{id}.premiosFisicos` (con 2 juegos, saldrían 2 remeras por mes).
  2. Umbrales por juego, no uno global.

### §12 — App Check

- **Estado:** `MANDAR_TOKEN = false` y `EXIGIR_APP_CHECK = false`. No protege.
- **Qué falta:** medir cuántos navegadores fallan con extensiones de
  privacidad, decidir qué hacer con ellos, y encender los dos en el mismo
  deploy.

### §19 — URCDP

- **Estado:** `privacidad.html` dice «Identificación en trámite».
- **Qué falta:** que salga el número de registro.

---

## 🟡 Ingeniería (sin urgencia)

### §44 — Privacidad: nombrar Analytics (y Sentry cuando exista)

- **Estado:** `privacidad.html` §11 enumera «Firebase Authentication, Firestore
  e infraestructura de Google/Firebase». Desde `03b86ad` hay también Firebase
  Analytics, y habrá un servicio de errores.
- **No queda falsa:** §11 ya contempla proveedores de «seguridad, análisis,
  comunicación y pago». Es la enumeración de lo *actual* la que envejeció.
- **Por qué igual conviene:** el trámite ante la URCDP sigue abierto (§19), y
  esa enumeración es justo lo que se mira.

### §48 — ~~`entregar-a-rival.spec.js` falla en dos pruebas~~ ARREGLADO

Arreglado en `cf86b26`. Era un bug de la prueba, y el primer diagnóstico que se
dio fue equivocado: las diez semillas de `SEMILLAS_ACIERTO` seguían siendo
buenas —corrido el motor contra las diez, las diez reparten un 8 arriba del
mazo y un 8 en la carta 0 del jugador 1—.

**La causa:** la ventana de reflejos de la ronda abre con la mirada, ANTES de
mi turno, y ahí juegan las tres IA. Si el jugador 1 descarta una carta anterior
a la que la cuenta predice, su mano se corre y el modal ofrece otra carta: la
semilla sigue siendo «de acierto» sobre el papel y el ataque es un error.
Encima `mesaConOcho` devolvía la PRIMERA semilla que repartiera un 8, sin mirar
el resultado, así que ni siquiera probaba las otras nueve.

**La lección, que vale para cualquier prueba con semillas:** una lista de
semillas calculada en Node predice el REPARTO, no la partida. Todo lo que pasa
entre el reparto y la jugada —y en esta mesa pasa una ventana entera de
reflejos con tres IA— queda afuera. El ayudante ahora usa el 8, lee lo que el 8
muestra y lo compara con la muestra; si no es el resultado que la prueba
necesita, prueba la semilla siguiente. Las listas pasaron de promesas a
candidatas.

**Y el `test.skip` se fue.** Si ninguna candidata sirve, esto se pone rojo con
la cuenta de lo que vio cada semilla. Un salto silencioso no protege y no se
nota, que es la peor de las tres salidas.

**Una aserción corregida** (con OK explícito): decía que el 8 marca la carta
vista «y sólo ésa», y eso el juego no lo garantiza. `recordarFallo` deja a la
vista de todos la carta que alguien tocó por error, y conocerla da derecho a
atacarla. Ahora se afirma la regla de verdad —la carta vista está marcada, la
mano entera no—, que es el bug original. **El mismo punto flojo le queda a la
línea de al lado**, `atacablesOtro` contra `[]`: si el que se equivoca en la
ventana inicial es el OTRO rival, va a sobrar una marca. Se dejó como está; la
corrección, si aparece, es la misma.

### §53 — ~~El poder 9 no hace su transición visual en red~~ ARREGLADO

**Arreglado en `7c2a77a`.** Se deja anotado porque el diagnóstico tiene dos
cosas que conviene no perder.

**No lo trajo la etapa 3**, aunque lo parecía. `pedirPoderEnRed` se escribió el
5/10 (`3a6d62c`) y se tocó por última vez el 7/10 (`ce4d41b`), las dos antes de
la etapa 3a, y la etapa 3 no tocó esa función ni `efectoCambio`. Tampoco era el
patrón de `23022d2` —ahí había una guarda que miraba la fase, acá la llamada no
existía— ni pasaba por los ocho lugares de `reflejosAbiertos()`: los poderes
entran por el modal. Estuvo roto desde que se armó el modal de poderes en red.

**La regla quedó igualada con la del 10:** las CARTAS se le muestran a quien
corresponda —al que usa el 10, a nadie en el 9— y QUE HUBO INTERCAMBIO, con sus
dos posiciones, lo ven los cuatro. El motor anota `tipo: "cambioCiego"` con
actor, objetivo y posiciones, nunca las cartas, y el efecto sale del registro
—un solo camino para los cuatro navegadores— en vez de `pedirPoderEnRed`, que
lo haría ver sólo al que usó el poder.

No publicó nada nuevo: la frase del registro ya decía las dos posiciones
(«cambió su 1 por la 2 de Beto») y viaja desde siempre.

**Lo que este bug enseñó, y vale para la próxima:** `registro` viajaba vacío en
TODOS los specs de red, así que el camino de los efectos de poderes no se
ejecutaba en ninguna prueba de navegador. Es el mismo hueco de forma que los
dobles vacíos de §51: un campo que ningún spec puebla es un camino que ninguna
prueba recorre. Ahora se puede guionar por paso.

### §54 — Un cerrojo para los campos de la vista que ningún spec puebla

**Para la próxima sesión.** Es el mismo oficio que `cadena-de-turno.mjs`: una
prueba que mira las pruebas.

**El patrón que ya costó tres bugs.** Un campo de la vista que viaja constante
en todos los specs de red es un camino que ninguna prueba recorre:

| Campo | Qué quedó sin cubrir | Lo que costó |
|---|---|---|
| los dobles de jugada (`levantar`, `tirarCarta`, `cortar`, `pasarTurno`, `cambiarCarta`) | la cadena de turno entera | el rollback de la etapa 3 |
| `revelaciones`, siempre `[]` | `mostrarRevelaciones` — uno de los 8 lugares de 3c | se descubrió revisando, no jugando |
| `registro`, siempre `[]` | los efectos de los poderes | §53, el 9 sin transición |

Las tres veces el síntoma fue el mismo: suite verde, camino muerto. Y las tres
se encontraron a mano, una por una.

**Qué tendría que hacer.** Recorrer los campos que `vistaDe` publica y, para
cada uno, mirar si TODOS los specs de red lo mandan con el mismo valor
—vacío, `null`, el mismo literal—. Si sí, fallar nombrando el campo: nadie está
ejercitando lo que la mesa hace con él.

**Las trampas, que ya conocemos de `cadena-de-turno.mjs`:**

- **Los archivos mixtos no cuentan.** Cuatro specs montan las dos mesas y no se
  puede saber, leyendo el texto, a qué modo pertenece cada valor.
- **Los comentarios se recortan antes de contar.** Una mención como ejemplo no
  es cobertura.
- **Y el propio cerrojo tiene que probarse contra sí mismo**, con un caso que
  SÍ enganche y uno que no. Sin eso, una expresión regular que no engancha nada
  convierte todo en un «sí» automático.

**Cuidado con el falso positivo legítimo.** Hay campos que de verdad son
constantes en todos los specs y está bien que lo sean —`limitePuntos`,
`desempate`—. Va a hacer falta una lista de exenciones escrita a mano, con el
motivo de cada una al lado. Si la lista crece sin motivos, el cerrojo dejó de
servir.

### §55 — ~~Acortar los mensajes largos de la mesa~~ HECHO

**Hecho.** La pista de la mesa entra en un renglón, medido y no estimado.

**El número, medido en el navegador a 375 px:** el renglón de `#pista` mide
16 px y entran **38 caracteres** de castellano. El CSS de `.tira-pista` ya
contaba el daño de pasarse: «en un teléfono bajo esos 16 px de más empujan la
mesa hasta que las cartas se meten encima. Justo el mensaje que hay que poder
leer, tapado.» No era cosmética.

**Lo que midió, y por qué hacía falta medir:** de la primera tanda de
propuestas, **cuatro no entraban** aunque parecían cortas — y los emojis
cuentan mucho más que un carácter (`⚠️ Se cortó la conexión. Reintentando…` da
38 en el conteo y se parte igual). Estimar a ojo no alcanzaba.

**El vocabulario:** «tocá» salió de todos los carteles —suena raro en
Argentina—, «tirá» se quedó donde significa tirar al descarte, y «mirá» lo
reemplaza en el reparto. No queda ninguna ocurrencia de «tocá» en los textos.

**«Descarte activo.»** se agrega sólo cuando la ventana está abierta Y mi mano
está disponible para reflejos — que no es lo mismo. No va en mi `levantada`
(mi mano es para cambiar), ni en mi `poder` (el velo me tapa la mesa), ni en la
mirada (la pista tiene que decir qué memorizar, y las dos cosas no entran en
38). Es la única señal que queda de que la ventana sigue viva: el cronómetro
que lo decía se fue con la etapa 3b.

**De paso, dos arreglos que no eran de §55:** `pistaDeRed` interpolaba el
nombre del jugador en `innerHTML` **sin escapar**, mientras `dibujarJugador` sí
lo escapa; ahora escapa dentro de `nombreCorto`, que es por donde pasan todos.
Y «No era esa: te comés una carta al cerrar la ventana» mentía desde la etapa
1 —el castigo se aplica al llegar, no al cerrar—: acortarla la arregló.

**El borde que se aceptó:** `nombreCorto` recorta por cantidad (10 + `...`), no
por ancho, así que ocho letras anchas seguidas —`MMMMMMMM`, `WWWWWWWW`— siguen
partiendo la pista. No es un nombre de castellano y el síntoma es el que la
mesa ya tenía. La salida barata es §57.

### §56 — Unificar el estilo de las pistas entre los dos modos

Entrenamiento usa MAYÚSCULAS para las fases —`LEVANTAR`, `CORTAR O PASAR`,
`MIRÁ TU CARTA`— y red usa frases: `Levantá del mazo.`, `Podés cortar o pasar.`
Las dos formas son cortas, así que no es un problema de espacio: es que el
mismo juego habla de dos maneras según el modo.

Quedó fuera de §55 a propósito, para no mezclar «acortar» con «unificar» en un
commit. Al hacerlo conviene decidir cuál de los dos estilos gana, y mi apuesta
es el de red: una frase dice qué hacer, una palabra en mayúsculas sólo nombra
la fase.

Ojo: `carteles.spec.js`, `ausente.spec.js` y `reloj-para-decidir.spec.js`
afirman textos de entrenamiento, así que hay aserciones que se mueven.

### §57 — Un tope al largo del nombre, al registrarse

`esquemas.js:124` acepta nombres de hasta **40 caracteres** y no mira el ancho.
Con eso, cualquier plantilla de la pista se parte, y el recorte de `nombreCorto`
sólo tapa el caso medio (§55).

Es el lugar barato para cerrarlo de raíz: un tope más corto donde el nombre
entra, en vez de recortes en cada lugar donde se dibuja. Hay que mirar también
qué hace el lobby y el ranking con un nombre largo — la mesa no es el único
lado que lo muestra.

### §62 — Extender `tiempos-en-prosa.mjs` a la portada y al tablero

`tiempos-en-prosa.mjs` compara los tiempos escritos EN PALABRAS contra el
motor, y lo hace con el mecanismo correcto: la página declara de qué habla cada
mención —`data-tiempo="MS_DESCARTE"`— y el valor lo pone el motor. Además exige
que no quede ninguna mención de «segundos» fuera de un elemento marcado, así
que una frase nueva sin marca se denuncia sola.

**Mira una sola página:** `como-se-juega.html`. Por eso §60 y §61 llegaron a
producción. La portada decía «Cinco segundos de reflejos» en un `<h2>` y el
tablero «5 segundos de descarte por reflejos» en su resumen, con `MS_DESCARTE`
en 2 s desde `f5749a5` y la ventana de red sin reloj desde la etapa 3. Lo único
que vigilaba esas dos páginas era la sección 5 de `reglamento.mjs`, con dos
patrones puntuales —la mirada de 2 s y el límite de 150— que no se cruzan con
esto.

**El trabajo**, medido y no estimado:

- Parametrizar la suite sobre una lista de páginas, en vez de la constante
  `PAGINA`.
- Marcar **3 menciones**: `dashboard.html:381` («cinco segundos para elegir
  cuál y dos para verla» → `MS_ELEGIR_MIRADA,MS_MIRAR`), `dashboard.html:382`
  (el descarte → `MS_DESCARTE`) y lo que quede en `index.html` sobre reflejos,
  que hoy ya no lleva número.
- **Y resolver un choque real:** el tablero escribe «2 segundos», con dígito, y
  esta suite compara contra la palabra («dos»). Su propio encabezado dice que
  los dígitos no los cubre. Hay que decidir: o la página pasa a «dos segundos»,
  o la suite aprende a aceptar las dos formas. El reglamento usa dígitos en el
  mismo párrafo, así que la decisión es de estilo y vale para los dos lados.

**Lo que NO hace falta**, para que nadie lo busque: las otras dos menciones de
«segundo» de esas páginas no molestan. La de `index.html` («llega un segundo
más tarde») vive dentro de un comentario HTML, y el chequeo de cobertura
recorta los comentarios; la del tablero es «el primero y el segundo», que no es
un número seguido de «segundos».

### §50 — La línea de base de las pruebas, y cómo leerla

Las dos suites miden cosas distintas y ninguna incluye a la otra. Los números
de referencia, al 10 de octubre de 2026:

| Suite | Comando | Verde es |
|---|---|---|
| Node | `npm test` | **85 de 85** |
| Navegador | `npx playwright test` | **464 en total; el verde hay que volver a medirlo** |

Los dos rojos históricos de §48 se arreglaron el 10/10/2026 (`cf86b26`) y su
archivo da 3 de 3. Pero la corrida completa de esa misma noche dio **460 pasan,
4 fallan**, y los cuatro son OTROS:

    menu.spec.js:179            se cierra con la X, con el velo y con Escape
    ojo-del-poder.spec.js:295   los cuatro miran a la vez
    poder-paso-a-paso.spec.js:156   el cuadro del poder en 390x844
    tablero.spec.js:1124        el tablero no mide más que la pantalla

**No están clasificados, y no hay que darlos por intermitentes sin probarlo.**
Lo que se sabe: esa corrida tardó **34,5 minutos** en vez de los 23 de siempre,
porque compartió la máquina con un `npm test`, otra corrida de Playwright y
varios `git`. En una laptop de 8 GB eso es contención real, y tres de los
cuatro miden tiempos o geometría. `ojo-del-poder` ya figura como intermitente
en §29-Bloque2.

**Lo primero antes del próximo deploy:** correr los 65 archivos con la máquina
libre. Si los cuatro se van, el número es 464 y queda entero en verde por
primera vez; si queda alguno, es un rojo nuevo y hay que anotarlo acá con su
causa. No desplegar leyendo «3 de 3 en su archivo» como «suite verde»: es
exactamente el error que §48 documenta.

- **Correr los 65 archivos, no un recorte.** La etapa 3c se validó con los
  archivos de la mesa en red y bajó `MS_PASO_AUTOMATICO` de 20 s a 10 sin ver
  que `carteles.spec.js` —que es de entrenamiento— afirmaba los 20. Lo
  denunció en la corrida completa, dos días después.
- **Son 23 minutos.** Conviene lanzarla en segundo plano y seguir trabajando,
  no saltearla.
- **El «92 pasan, 2 fallan» que anduvo dando vueltas no reconcilia** con nada
  medible: los archivos que montan la mesa en red son 14 con 104 pruebas, y
  los dos rojos de §48 están en un spec de entrenamiento. Se descartó.

### §51 — Lo que la etapa 3 dejó abierto

Nada de esto bloquea el despliegue. Se anota porque son consecuencias de
sacarle el cronómetro a los reflejos, y ninguna se ve leyendo el código: se ven
jugando.

**Al 10 de octubre quedan abiertos el 1 y el 4**, más los cuatro de limpieza.
El 2 y el 3 están arreglados y se dejan tachados en vez de borrados: el 3
porque su descripción original era incorrecta y conviene que se sepa, y el 2
porque su arreglo deshizo una decisión anterior y el camino importa.

**Reglas, por orden de cuánto cambian una mano:**

1. **El que tira puede cortar en el acto y anular los reflejos de su propia
   muestra.** Antes los 2 s de ventana retenían la fase en `descarte`, así que
   no llegaba a `postLevantada` hasta que vencía. Ahora `tirar` devuelve la
   fase enseguida y puede cortar sin que nadie haya podido reaccionar. Le
   conviene al que teme que le descarten una carta. La ventana se cierra con el
   corte, que es lo correcto —la ronda terminó— pero la garantía estratégica se
   perdió.
2. ~~**Un toque hecho durante la MIRADA se resuelve en el próximo tiro.**~~
   **ARREGLADO** (`3462ff7`). Le daba la mano a quien tocó después: el de la
   fase de reflejos se aplicaba al llegar y se llevaba el «primero», el de la
   mirada esperaba al tiro y se llevaba el «tarde». Ahora se aplican al
   TERMINAR la mirada, que es el primer instante en que el motor puede
   aceptarlos, y en orden de llegada. Seguro porque la muestra no puede cambiar
   entre la mirada y el descarte: en `mirar` sólo existen mirar y descartar,
   `saltarAusente` desde ahí tira, y `rellenarMazo` conserva la muestra. Sólo
   orquestador. `mirar-descarte.mjs` §5 volvió a su forma original.
3. ~~**Con un acierto esperando su carta, el toque propio es la entrega y dura
   todo el turno.**~~ **LA DESCRIPCIÓN ERA FALSA, Y LO QUE SÍ HABÍA ESTÁ
   ARREGLADO** (`c603293`).

   El cap de 5 s ya existía: la guarda cambió de fase a ventana, pero
   `atacando` siempre se apagó solo a los `MS_PARA_ENTREGAR` por su propio
   temporizador. Lo que cambió fue el mínimo —antes ~2 s, ahora los 5
   limpios—, que es el comportamiento que se quería. No duraba todo el turno.

   Lo que sí estaba flojo: el cap dependía de UN `setTimeout`, y los
   navegadores los estrangulan en pestañas de fondo. Quien cambiaba de pestaña
   con un acierto pendiente volvía con el modo puesto, su toque se leía como
   entrega, el servidor lo rechazaba por vencido, y el toque se perdía en vez
   de ser un descarte. Ahora la fecha viaja en `atacando` y se comprueba al
   clic; el temporizador avisa, no decide.
4. **`MS_PASO_AUTOMATICO` 20 s → 10 s también cambió ENTRENAMIENTO.** El motivo
   —que la decisión ahora contiene la ventana en vez de seguirla— vale sólo en
   red. Allá la ventana sí se cierra a los 2 s, así que esos 10 s volvieron a
   ser tiempo propio. Se aceptó para no bifurcar los tiempos por modo.

**Limpieza, sin urgencia:**

5. **Constantes huérfanas de la ventana en red:** `duracionMs`, `graciaMs`,
   `MS_GRACIA`, `venceEn` y `yaVencio` sólo siguen vivas por
   `cerrarVentana({ forzar: false })`, que desde `5dcb189` no llama nadie en
   producción — sólo las suites. `resumenDeVentana` además publica
   `duracionMs` y `graciaMs` a clientes que ya no los miran. Sacarlos arrastra
   la fila «Gracia de red para un toque» del reglamento, que hoy dice «ya no se
   aplica».
6. **`abrirVentanaDescarte` sigue expuesta** como callable, con su envoltorio
   muerto en `public/js/partida-red.js` — la misma forma que la que se borró en
   `5dcb189`. No es explotable (es idempotente y exige fase `descarte`), pero
   es superficie que nadie usa.
7. **Trece mocks de e2e declaran `cerrarVentanaDescarte`**, que ya no existe.
   Línea muerta en los fixtures; se dejó para no tocar trece specs justo antes
   de medir la línea de base.
8. **Cuatro specs montan las dos mesas** —`ausente`, `marco-y-titulo`,
   `ojo-del-poder`, `reloj-para-decidir`— y `cadena-de-turno.mjs` no puede
   atribuir sus clics a un modo. Partirlos le daría más de dónde agarrarse al
   cerrojo.

### §45 — PITR y protección de borrado en producción

**HECHO.** Lo configuró el usuario en la consola. Verificado el 10/10/2026
contra la base de producción, no de memoria:

    gcloud firestore databases describe --database=southamerica \
      --project=memorie-legends

- `POINT_IN_TIME_RECOVERY_ENABLED` y `DELETE_PROTECTION_ENABLED`.
- Retención de versiones: **604800 s**, o sea 7 días. Era una hora.
- `earliestVersionTime`: 2026-10-09T03:35Z. Hasta ahí llega la recuperación.
- **Y hay respaldo automático diario**, con retención de 8467200 s (98 días),
  creado el 9/10. El primero ya está `READY`, del 10/10 a las 03:45Z.

Queda sólo una cosa suelta, y es de limpieza: el export viejo del bucket
`memorie-legends-backup` es del 5/10 y es de la base `(default)`, tomado
durante la mudanza. No sirve para restaurar nada de lo que hay hoy, así que
conviene no confundirlo con un respaldo.

- **Antes de cobrar:** el libro mayor de Leyendas vive en `movimientos`.

### §10 — Velocidad en red (Fase 3, 4, 0b)

- **Lo hecho:** Fase 0a (descarte perdido) y CORS `maxAge: 3600` (7/10).
- **Falta:**
  - **Fase 3:** respuesta optimista al tirar / cortar / pasar.
  - **Fase 4:** `latir` que actualice su campo, no el documento entero.
  - **Fase 0b:** toque directo a Firestore con `serverTimestamp()`.

### §29-Bloque2 — Precarga y limpiezas

- **Precarga de las 48 cartas.** No existe todavía en `mesa.js`.
  Diseño acordado 4/10: dorsos al entrar, caras cuando se van a mostrar.
- **Borrar `crearSala`** (sigue exportada en `index.js:594`).
- **Tests intermitentes:** `fin-de-ronda-en-red` (§18) y `ojo-del-poder`.

### §40 — Test E2E del corte automático

- **Existe `pruebas/corte-automatico.mjs`** pero es del motor, no del
  navegador.
- **Falta:** el test que pruebe que la mesa se destraba (1 carta + muestra
  coincidente + reapertura). Requiere `?debug-mano=` en `mesa.js` o aceptar
  verificación a mano.

### §25 — Tests de 3 herramientas

- `resetear-cuentas.mjs`, `borrar-perfiles-huerfanos.mjs`,
  `restaurar-users.mjs`.
- Exportan sus funciones puras — solo hace falta escribirlos.
- Acordarse de `pruebas/suites-registradas.mjs`.

### §23 — `listarPoseedoresItemAdmin` valida antes de sesión

- **Esfuerzo:** 1 línea. En `functions/index.js:1712`, mover el `validar(...)`
  adentro del cuerpo, después de `exigirSesion`.

### §21 — Caja de crear sala duplicada

- **Estado:** `public/js/caja-sala-privada.js` no existe. Sigue duplicada en
  `dashboard.html` y `lobby.html`.
- **Esfuerzo:** medio. Referencia visual: la caja del tablero.

### §32 — Borrar `crearSala` (dead code)

- **Estado:** nadie la llama. `index.js:594`.
- **Toca:** 3 tests (`ritmo.mjs`, `revancha.mjs`, `salas-publicas.mjs`).

---

## 🟢 Contenido

### §4 — Los 48 frentes de cartas

- **Decisión:** no se hace por ahora. Faltan 2-3 diseños de dorso.
- **Restricción:** no usar `sharp`.

### §3c — Arte de los 12 artículos exclusivos

- **Decisión:** mantener los emojis por ahora.

---

## ⏳ Esperando a terceros o fechas

### §1 — WhatsApp Business

- **Estado:** en revisión por Meta. Meta avisa por correo.

### §26 — Borrar `compartir-escudo.jpg`

- **Cuándo:** a partir del **27 de octubre de 2026**.
- **Antes de borrar:**
  `grep -rn "compartir-escudo.jpg" public/ pruebas/ herramientas/`

### §6 — Imágenes de build en GCR

- **Estado:** el deploy del 10/09 avisó. Se borran a mano en
  `console.cloud.google.com/gcr/images/memorie-legends/us/gcf`.
- **O:** se van solas en el próximo deploy que logre limpiar.
- **Verificar:** que la facturación de Artifact Registry no siga creciendo.

---

## 📝 Notas / decisiones sin acción hoy

### §9 — Identificadores internos siguen diciendo «apuesta»

- **Decisión:** no renombrar por ahora. Cosmético.
- **Nunca tocar:** «No son juegos de azar ni apuestas» en el reglamento.

### §15 — `desposeer` devuelve precio de lista, no lo pagado

- **Estado:** `tienda.js:223` sigue con `precioPagado: a.precio`.
- **Decisión:** solo lo usa el admin, no urge.

### §16 — Notas sueltas

- Cuenta admin: `soporte.memorie.legends@gmail.com`.
- Licencia Playfair Display — para el abogado.
- `herramientas/tarjeta.mjs` pide fuentes a Google.

### §17 — Contraste del botón WhatsApp (2,3:1, bajo WCAG)

- **Decisión:** queda así. Es el kit oficial de WhatsApp.

### §27 — Barrido responsive (cosas dejadas a propósito)

- Panel admin: campos a 14,4px.
- Enlaces del pie: 16-18px de alto.
- `mesa.html`: no se auditó.

### §43 — Pendientes chicos post-migración

- `herramientas/sondear-webhook.mjs:86` sigue con URL vieja de v1 por defecto.
- 2 herramientas usan `lib/firestore` (frágil).
- Índices de la base nueva no verificados.

---

## Cerrado → ver `HISTORIA.md`

§0, §3b, §3d, §5, §7, §8, §11, §13b, §14, §22, §24, §28, §30,
§31, §33, §34, §35, §36, §38, §39, §42 (parcial).
