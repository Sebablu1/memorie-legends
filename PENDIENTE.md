# Pendiente

Lo abierto, en 3 minutos de lectura. Lo cerrado vive en `HISTORIA.md`.

Última revisión: 11 de octubre de 2026.

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
  comunicación y pago». Es la enumeración de lo _actual_ la que envejeció.
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

| Campo                                                                                   | Qué quedó sin cubrir                               | Lo que costó                       |
| --------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------- |
| los dobles de jugada (`levantar`, `tirarCarta`, `cortar`, `pasarTurno`, `cambiarCarta`) | la cadena de turno entera                          | el rollback de la etapa 3          |
| `revelaciones`, siempre `[]`                                                            | `mostrarRevelaciones` — uno de los 8 lugares de 3c | se descubrió revisando, no jugando |
| `registro`, siempre `[]`                                                                | los efectos de los poderes                         | §53, el 9 sin transición           |

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

### §63 — «No tenés nada» y «el catálogo no contestó» se ven igual

La pestaña «Colección» del perfil muestra `#sinColeccion` cuando
`montarInventario` no destapa la sección. Eso pasa por DOS motivos distintos:
el jugador no tiene nada, o el catálogo no contestó. El montaje trata los dos
igual —se va sin tocar nada— así que la pantalla no puede distinguirlos.

Hoy el cartel está redactado para ser cierto en los dos casos y para decir lo
mismo que hay que hacer, así que no miente. Pero a quien se le cayó la lectura
le estamos diciendo que vaya a la tienda, cuando lo que necesita es recargar.

**Para arreglarlo**, `montarInventario` tiene que devolver POR QUÉ se fue
—`"sin-seccion" | "error" | "vacio" | "ok"`— y el perfil elegir el cartel. Es
un cambio en un módulo que comparten dos pantallas, y por eso quedó afuera de
A2a: aquella etapa era una mudanza, no un rediseño.

`public/perfil.html` tiene el comentario que apunta acá.

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
de referencia, al 11 de octubre de 2026:

| Suite     | Comando               | Verde es                        |
| --------- | --------------------- | ------------------------------- |
| Node      | `npm test`            | **85 de 85** suites             |
| Navegador | `npx playwright test` | **510 de 510**, en 68 archivos  |

**La corrida del 11/10 por la tarde fue la primera entera en verde: 510 de
510, cero rojos, 20,8 minutos.** No hay rojo conocido ni tolerado: cualquiera
que aparezca es nuevo y hay que mirarlo.

El único rojo de la corrida anterior —`poder-paso-a-paso.spec.js:117`, el
cuadro del poder a 390x844, con un 503 del servidor local— **no volvió a
aparecer**. Era fatiga, como decía la hipótesis, y ahora está medido dos
veces: una con la máquina ocupada y otra sin.

De 464 a 510 en dos días, y las cuarenta y seis son de lo que se fue
arreglando: once de `ranking-movil` (fase D), diecisiete de
`perfil-pestanas` (A1 y A2a) y dieciocho de `cabecera` (C2).

- **Correr los 68 archivos, no un recorte.** La etapa 3c se validó con los
  archivos de la mesa en red y bajó `MS_PASO_AUTOMATICO` de 20 s a 10 sin ver
  que `carteles.spec.js` —que es de entrenamiento— afirmaba los 20. Lo
  denunció en la corrida completa, dos días después.
- **Son 20 minutos.** Medido el 11/10 con la máquina libre: 20 m 6 s para 65
  archivos a la mañana y 20,8 minutos para 68 a la tarde — o sea que cuarenta
  y seis pruebas más casi no se notan, porque lo que tarda es levantar las
  mesas y no correrlas. Conviene lanzarla en segundo plano y seguir trabajando, no
  saltearla — pero ojo con QUÉ se hace mientras: la corrida del 10/10 tardó
  34,5 minutos porque compartió la máquina con otras cosas, y esos catorce
  minutos de más vinieron con cuatro rojos que no eran bugs.
- **Cerrado el 11/10: primero se fueron los cuatro rojos, después el quinto.**
  La corrida de la mañana quedó en 491/492 con un solo rojo por fatiga; la de
  la tarde, en 510/510. Los cinco eran contención de recursos, y eso ya no es
  una hipótesis: está medido con la máquina ocupada y con la máquina libre.
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

- **Estado:** avisaron los deploys del **10/09** y del **11/10**. O sea que no
  se limpiaron solas en el medio: van tres meses juntándose.
- **Dónde:** `console.cloud.google.com/gcr/images/memorie-legends/us/gcf`. Se
  borran a mano.
- **O:** se van solas en el próximo deploy que logre limpiar — que es
  justamente lo que no viene pasando.
- **Cuánto:** centavos por mes. No urge; lo que importa es que no crezca sin
  que nadie mire.
- **Verificar:** que la facturación de Artifact Registry no siga subiendo.

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

### §73 — `mesa-vestida.spec.js:230`, una ventana de 550 ms — RESUELTO

El halo del asiento en turno. La prueba le saca a mano la clase `propio` al
asiento propio y espera que la opacidad del `::before` llegue a 1.

**Medido**, muestreando cada 100 ms después de sacar la clase:

```
  +   0 ms  propio=false  en-turno=true  opacidad=0        mismo nodo=true
  + 412 ms  propio=false  en-turno=true  opacidad=1        mismo nodo=true
  + 960 ms  propio=true   en-turno=true  opacidad=0        mismo nodo=FALSE
```

Dos cosas que la prueba no sabe:

1. La transición de 0,35 s **corre igual** con `reducedMotion: "reduce"`
   puesto en `playwright.config.js`. Tarda 412 ms en llegar a 1.
2. A los ~960 ms el asiento **se reemplaza**: `mesa.js:1112` lo redibuja
   desde una plantilla que incluye sus clases, así que `propio` vuelve y la
   opacidad se queda en 0. No es que tarde: ya no va a pasar nunca.

O sea que la afirmación tiene **~550 ms** para acertar. `expect.poll` lee a los
~0, 100, 350 y 850 ms: con la máquina descansada el tiro de los 850 cae dentro
de la ventana y pasa; con carga esas lecturas se corren y pasan de largo, y los
15 s de timeout son 15 s esperando algo que no vuelve. Eso explica los dos
resultados: **5 de 5 en aislamiento** y rojo en la suite completa.

**Cómo se arregló:** no esperando a ver el pico, sino PROVOCÁNDOLO y quedándose
con el máximo. Un solo `page.evaluate` saca la clase, muestrea con `rAF` hasta
~600 ms y devuelve la opacidad más alta vista. El pico se captura antes de que
el redibujo llegue, y si llegara primero se corta por `isConnected` y vuelve el
máximo parcial: la prueba falla fuerte en vez de leerle la opacidad a un nodo
desprendido, que contesta cualquier cosa. Sigue afirmando lo mismo —que un
asiento en turno que no es el mío se enciende— y ya no depende del reloj.

**Lo que NO se hizo:** aflojar el `toBe(1)` a `> 0.5`. Ensanchaba la ventana a
~800 ms y la dejaba igual de colgada del redibujo. Era comprar tiempo.

**Lo que queda escrito acá y no en el código:** que una prueba que le muta el
DOM a la mesa tiene fecha de vencimiento, porque la mesa redibuja sus asientos
desde una plantilla con las clases adentro. Si aparece otra prueba que saque o
ponga una clase a mano y después espere, es el mismo pozo.

### §72 — El harness de mesa sale a la Firestore de producción

**Medido:** un solo arranque de mesa en las pruebas hace **5 pedidos** al canal
`Listen` de `firestore.googleapis.com`, al proyecto de producción.

`pruebas/e2e/mesa.js` dobla únicamente `guardia-sesion.js`. `firebase.js` es el
de verdad, y las reglas dejan leer `config/{clave}` sin sesión
(`firestore.rules:194`), así que la lectura de `vestirLaCasa` sale a la red y
vuelve. Son **26 specs** los que arrancan una mesa.

**Lo que costó, con número.** Ojo: el flake de `mesa-vestida.spec.js:230`
NO es esto —se midió y tiene causa propia, ver §73—. Lo que sí es de acá:

- `entregar-a-rival.spec.js` busca semilla en un bucle que hace `continue`
  cuando «una IA se comió la carta de arriba del mazo»: **la semilla que toca
  depende del reloj**. La fase 1 le agregó una lectura al arranque y eso la
  movió a otra semilla. Medido en aislamiento: con dos lecturas **0 de 5**, con
  una **3 de 3**. La afirmación ya se arregló —ahora cuenta en vez de comparar
  un conjunto exacto— pero el acoplamiento al reloj sigue ahí.

**Lo que haría falta:** doblar `firebase.js` en `pruebas/e2e/mesa.js`, como ya
lo hacen `diseno-de-mesa.spec.js` y `admin-mesa.spec.js`, o bloquear
`firestore.googleapis.com` en `playwright.config.js`. Saca una clase entera de
ruido de 26 specs, y de paso la suite se acorta.

**Y hay algo peor que los flakes:** la suite depende de datos de producción. El
día que el panel escriba `config/mesa`, esos 26 specs van a ver una mesa
distinta a la que esperan, sin que nadie haya tocado una prueba.

**Por qué no se hizo acá:** es el harness compartido de 26 specs. Eso se toca
con su propia sesión y su propia corrida completa, no de pasada.

### §70 — La configuración general ya no se edita desde el panel

Salió de la fase 4 de la mesa por contexto. El selector tiene los CUATRO
contextos y nada más, así que `config/mesa` —el documento global, el que esta
pantalla escribía antes de que hubiera contextos— quedó de sólo lectura: se
muestra como heredada y se adopta al guardar, pero no hay forma de escribirla.

Hoy no se pierde nada porque está vacío: ninguna mesa tiene documento propio y
todas caen al global, que tampoco existe, así que todo el mundo ve la mesa de
siempre. El costo aparece el día que quieras cambiar lo que heredan las cuatro:
hay que tocarlas de a una, cuatro veces lo mismo.

**Lo que haría falta:** una quinta opción «General (todas las mesas)» en el
selector, con valor vacío, que `documentoDeMesa` ya resuelve al global
(`reglas/salas.js:92` — cualquier cosa que no sea uno de los cuatro cae en
`mesa`). El servidor no necesita cambios: `guardar` sin contexto ya escribe
ahí. Las opciones se arman en `admin/mesas-admin.js:108` desde
`CONTEXTOS_VALIDOS`, así que la quinta tendría que agregarse a mano fuera de
ese bucle, y eso es justo lo que la prueba «el selector tiene las cuatro mesas»
afirma hoy — habría que ajustarla.

**Por qué no se hizo:** no me lo pidieron, y no es gratis. Una opción que
escribe lo que heredan las otras cuatro es la que más fácil se toca sin querer.
Si se agrega, el panel tendría que decir en qué modo está con más énfasis que
una línea de texto.

### §71 — Dos lecturas de config por cada arranque de mesa

`mesa.js:262` pide `config/mesa-{contexto}` y, si no está, `mesa.js:265` pide
`config/mesa`. Mientras ningún contexto tenga documento propio —o sea, hoy
siempre— son **dos** viajes a Firestore por partida en vez de uno.

No bloquea nada: `vestirLaCasa()` se dispara sin `await` a propósito, la mesa
se dibuja con lo de siempre y el diseño se aplica cuando llega. Son dos
variables de CSS, así que aplicarlas no redibuja ni mueve una carta. Pero es un
viaje de más, y se paga en cada mesa que se abre.

**Se arregla solo** en cuanto los cuatro contextos tengan su documento: ahí la
primera lectura acierta y la segunda no ocurre (`diseno-de-mesa.js:89` y `:92`
hacen lo mismo del lado del panel, y hay una prueba que afirma que con el
documento propio puesto NO se va a buscar el general).

**Si alguna vez molesta:** la salida no es cachear en el cliente —el diseño lo
decide la casa y tiene que poder cambiar— sino que las cuatro mesas tengan lo
suyo escrito, aunque sea copiando el global una vez. Eso es una decisión de
datos, no de código, y tiene su contra: cuatro copias de lo mismo que después
hay que mantener sincronizadas (es la razón por la que el fallback existe y no
se copió nada en la fase 1).

### §69 — Mesa personalizable

Cinco piezas, 4–6 h, 2–3 sesiones. Las tres primeras son fáciles y sueltas;
las dos últimas tienen lo suyo.

El diagnóstico está hecho: lo que sigue son referencias, no suposiciones.

**C6 — la rosa de los vientos** (lo que se ve como «una rueda de carro»).
`mesa.css:400-401`, las dos ÚNICAS referencias a `rosa-viento.svg` en todo el
repo. Vive en `.mesa::before`, con `pointer-events: none`, así que no ocupa
lugar ni recibe clics. Quitarla o cambiarla no toca nada más. Ojo: se usa como
MÁSCARA, así que el color lo pone el CSS y lo que manda el archivo es la
opacidad — un reemplazo con relleno sólido se vería como un bloque. Y ninguna
prueba la vigila, o sea que un reemplazo malo no se denuncia solo.

**D — `--sala`.** El hueco ya existe y está comentado: `mesa.css:111`,
`var(--sala, none)` como primera capa del fondo del `body`. **Nadie la
escribe.** `--pano` sí tiene quien lo haga, en `mesa.js:209`. Conectarla es
darle un escritor, igual que aquél. No define nada estructural: es
`background-attachment: fixed` sobre el `body`.

**B1 + C — el paño en ráster.** Son el mismo trabajo: no hay «dibujo de la
mesa» que reemplazar —son capas de CSS— y el hueco para el diseño ES `--pano`,
que ya funciona. Lo único que falta es que el panel deje subir ráster para
`fondo`: cambiar su `clase` de VECTOR a RASTER en
`reglas/imagenes-de-catalogo.js:154`. La receta (1200 lado mayor, nativa) ya
la soporta la tabla.

Cinco cerrojos a seguir, no cuatro: `imagenes-de-catalogo.mjs` en :146, :79 y
:117; `admin-conversor.spec.js:300`; y `panos.mjs:175`, que lee CADA paño como
texto buscando `preserveAspectRatio` y daría falso negativo con un WebP — el
arreglo está al lado, en :284, donde los mazos ya se filtran con
`.endsWith(".svg")`.

El mensaje «es un SVG y no se rasteriza» está en UN solo lugar,
`conversor-de-imagen.js:255`, y se queda sin usuarios solo. El admin no se
toca.

Aviso de diseño: `--pano` se aplica ESTIRADO —`center / 100% 100%`,
`mesa.js:209`— y la mesa es fluida, sin medidas fijas. Por eso los cuatro
paños actuales son SVG con `preserveAspectRatio="none"`. Un ráster estirado a
un óvalo de proporción variable se deforma.

**B2 — el mazo a 400×600 exactos.** Lo único que necesita código nuevo.
`PROPORCIONES` (`imagenes-de-catalogo.js:70`) sólo tiene CUADRADA y NATIVA, y
las dos trabajan sobre `ladoMayor`. Falta un modo de PAR EXACTO: una entrada
en `PROPORCIONES`, una rama en `medidasDeSalida`
(`conversor-de-imagen.js:59`) y generalizar el recorte centrado de 1:1 a w:h
—el código ya existe para CUADRADA—, más sus pruebas.

**E — mesa por modo.** Decidido: **archivos fijos elegidos por código**, en
`/img/mesa/modos/{entrenamiento,publica,privada,torneo}`. NO artículos del
catálogo: el catálogo es lo que un jugador compra y equipa, y esto lo decide
la casa y no se elige. El jugador sigue eligiendo paño y dorsos como hoy.

Hoy la mesa es SIEMPRE la misma. `MODO` es binario —`mesa.js:459`,
`salaPedida ? "leyendas" : "entrenamiento"`— y ni eso cambia el dibujo: el CSS
de la mesa no sabe de modos y `mesa.html` no lleva ningún `data-`.

El dato existe a medias: la sala privada YA trae `extra.privada: true`
(`salas-privadas.js:215`), la pública es su ausencia, y el `tipo` del torneo
vive en el documento del TORNEO (`torneos.js:138`), no en la sala — ése hay
que propagarlo o cruzarlo. La mesa hoy lee de la sala sólo `entrada`,
`estado`, `jugadores`, `pozo` y `revancha`.

Y la capa donde entra ya está: `mesa.css:336` apila paño (del jugador),
piedra (de la casa) y baranda, las tres en el mismo `background`. Una mesa por
modo va entre la piedra y el paño, sin tocar geometría ni el paño del jugador.

**Lo que NO se toca: `marco` y `sello`.** No hay una sola pieza de arte
dibujada, y elegir medidas para algo que nadie vio es escribir un número para
cambiarlo después.

### §68 — `entregar-a-rival.spec.js:315` — RESUELTO

El spec asumía posiciones DENSAS (0, 1, 2) y la mesa usa posiciones HUECAS
después de un descarte —{0, 2, 3}, por ejemplo—: `data-posicion` es el
protocolo del motor y NO se compacta. Lo dice `mesa.js` donde dibuja la mano:
«si se compactara también eso, tocar la tercera carta jugaría la cuarta».

Pedía `cartaDe(otroRival, 0)` —dando por hecho que existe la posición 0— y
`cartaDe(rival, (posicion + 1) % cuantas(rival))`, que mezclaba una CUENTA
con un ÍNDICE. Las dos daban `null` apenas la mano tenía un hueco.

Arreglado con `posicionesDe()` y `otraCartaDe()`: se leen las posiciones que
la mano tiene en vez de suponerlas. **El código de la mesa estaba bien.**

Verificado ×5 el caso y ×2 el archivo entero. Commit `f4422fd`.

### §67 — `fin-de-ronda-en-red.spec.js` es frágil por diseño

El archivo entero depende de atrapar un estado que dura ~1 segundo con un
SALTO de reloj falso que dispara la apertura y el cierre dentro del mismo
avance. No es un caso mal escrito: es la forma del archivo.

**Ajustar `runFor` no lo arregla.** Se probó, con medición de por medio:

| `runFor` | fallos |
|---|---|
| 600 (el actual) | 1 de 50 |
| 800 | 8 de 18 |
| 1000 | 17 de 50 |

Medido con un `MutationObserver` sobre la clase de `#velo`: el modal dura
~1000 ms de reloj falso y **se cierra solo** —no lo cierra la vista de
`mirar` de los 1500, que es lo que parece mirando la secuencia— y su
apertura salta entre 121 y 377 ms según cuánto tarde la mesa en montar.

Y una trampa para el que venga: un barrido de CUATRO repeticiones da
«perfecto» sobre valores que fallan un tercio de las veces. `runFor(1000)`
pasó 4 de 4 y falla 17 de 50. Para este archivo, menos de veinte
repeticiones no dice nada.

**El arreglo real es cambiar CÓMO el test observa el modal** —esperar el
evento en vez de adivinar el milisegundo— no cuánto avanza el reloj.

Hay otros dos casos del mismo archivo con la misma forma, que también
cayeron en la verificación: `el 10 a medio decidir se cierra si el servidor
lo resuelve por tiempo` (línea 290) y `la cuenta sale del plazo del
servidor, no de ocho segundos fijos` (línea 328).

Sesión propia. **No bloquea el despliegue**: es viejo, conocido y el rojo
que produce es siempre el mismo.

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

