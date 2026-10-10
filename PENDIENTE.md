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

### §48 — `entregar-a-rival.spec.js` falla en dos pruebas

- **Estado:** los tests de las líneas 211 y 233 fallan. La mesa dice «No era
  esa: te comés una carta» donde debería decir «le acertaste».
- **Preexistente:** se corrió en worktrees contra `6a386dd`, `01be9d6` y
  `5b47670` y falla igual en los tres. No lo trajeron las etapas de reflejos.
- **Es de ENTRENAMIENTO**, no de red: la escena no pasa por el servidor.
- **Y `npm test` no lo ve.** Las suites de Node están verdes mientras estas dos
  llevan rojas desde antes. Cuidado con leer «85/85» como «todo verde».
- **Revisar aparte, en su propio commit.**

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

### §50 — La línea de base de las pruebas, y cómo leerla

Las dos suites miden cosas distintas y ninguna incluye a la otra. Los números
de referencia, al 10 de octubre de 2026:

| Suite | Comando | Verde es |
|---|---|---|
| Node | `npm test` | **85 de 85** |
| Navegador | `npx playwright test` | **460 pasan, 2 fallan** (§48) |

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

- **Estado:** la base `southamerica` tiene `POINT_IN_TIME_RECOVERY_DISABLED` y
  `DELETE_PROTECTION_DISABLED`. La retención de versiones es de **una hora**.
- **Qué significa hoy:** no hay respaldo de la base viva. El único export del
  bucket `memorie-legends-backup` es del 5/10 y es de la base `(default)`,
  tomado durante la mudanza.
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
