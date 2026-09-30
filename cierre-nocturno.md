# Cierre — 30 de septiembre de 2026

Bloque 1 del plan de §29: el poder 7 y el cuadro de cartas.

## Lo que quedó hecho y commiteado

**El bug del poder 7.** Tirabas un 7, usabas el poder, veías que tu carta era
un 7 — y no podías descartarla. No pasaba nada y no se decía nada.

- El tiro propio ahora viaja con la MUESTRA y no con la ventana. Ése era el
  nudo: el contador se reiniciaba en cada ventana, y por eso la ventana del
  poder tenía que prohibir el descarte propio para no regalar dos
  oportunidades.
- `ventanaTrasPoder` abre si hay cualquier carta conocida que entre en la
  muestra, propia o ajena, del poder que venga. Es unión, no reemplazo: el 8,
  el 9 y el 10 abren exactamente cuando abrían.
- En esa ventana se juega lo que se CONOCE. A ciegas sigue prohibido: es una
  ventana privada y un tiro al azar ahí sería gratis.
- `huboPrimero` pasó de `true` a `false` en esa ventana. No estaba en el
  pedido y hacía falta: con `true`, el descarte propio acertaba *tarde* y la
  carta se quedaba Y venía una de castigo. Es correcto porque ser primero
  cambia la muestra, así que contra la que hay ahora nunca hubo primero.
- El rechazo dejó de ser mudo: `motivoDeRechazoDescarte` devuelve el texto y
  la mesa lo muestra.
- La red acompaña: `registrarIntento` recibe `tiroGastado`, que el servidor
  saca del estado del motor.

**El cuadro de objetivos del poder.** Con cuatro jugadores pedía hasta 298 px
de scroll interno y lo que quedaba abajo del corte era tu propia mano, que en
el 9 y el 10 es la primera que hay que elegir.

- «Tus cartas» va primero.
- A pantalla completa cuando la pantalla es corta O angosta:
  `(max-height: 700px), (max-width: 480px)`. El criterio por ancho solo dejaba
  afuera el teléfono acostado; el criterio por alto solo dejaba afuera el
  390×844 parado, que es el más común.
- En pantalla angosta cada mano se dobla en 2×2. Así entran tres grupos por
  fila SIN achicar la carta, que en un teléfono parado era la única salida que
  no bajaba del piso táctil de 40 px.
- En pantalla corta las cartas del cuadro bajan a 40×60 y abajo de 430 px se
  oculta la descripción del poder.

Medido con 4 jugadores y poder 9 en diez pantallas —375×667, 360×640, 390×844,
412×915, 844×390, 780×360, 915×412, 768×1024, 1024×768, 800×1280—: **scroll
interno 0 en las diez**, y nada se sale del viewport en ninguna.

## Suite

- **Node: 83 suites, verde.**
- **Navegador: 429 verdes** en la última pasada completa, más las **2 de
  `poderes-orden.spec.js`**, que fallaban porque afirmaban el orden viejo, se
  corrigieron y pasan aisladas. La pasada completa final se cortó a propósito:
  ya estaba sabido lo que iba a dar.

Cuatro pruebas existentes afirmaban decisiones que este bloque invirtió, y se
actualizaron con el porqué escrito en cada una:

- `ventana-tras-poder.mjs` — afirmaba que un 7 no abre la ventana. Era el bug.
- `poderes-orden.spec.js` — afirmaba «rivales arriba, tus cartas abajo».
- `entregar-a-rival.spec.js` — esperaba a que la pista dijera «buscá». Ahora
  espera a que aparezca una carta atacable, que es el hecho y no la redacción.
- `descarte.mjs`, `fallo-da-derecho.mjs`, `corte-automatico.mjs` — fixtures que
  contaban por ventana, o que reusaban el id `"muestra"` para cuatro muestras
  distintas.

## Pendiente para mañana

1. **Push.** El commit está local, sin empujar.
2. **Deploy** de hosting.
3. **Verificación en producción**, que no se hizo.

Después de eso, el Bloque 2 de §29: precarga de cartas y fondo no-blanco,
§13b (`cerrarMirada`), y el paso 9 (borrar `crearSala`). Una sola pasada de
suite para los tres.

Los seis `pruebas/e2e/_auditoria-*.spec.js` se borraron. Eran instrumentos, no
pruebas, y nunca estuvieron commiteados: no dejan rastro en git. Si hace falta
la auditoría visual del punto 2 del plan, se reescribe.
