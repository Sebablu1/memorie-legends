# Auditoría de seguridad — 7 de octubre de 2026

Revisión completa de los caminos que pueden mover dinero, escalar roles o
filtrar datos de terceros. Se hizo sobre el commit `9b1b5ee`.

Foco: ¿qué puede hacer alguien con una cuenta propia y la consola del
navegador? No incluye ataques de infraestructura (DDoS, robo de tokens de
Google) ni config de Auth.

---

## Resultado

**Dos hallazgos reales. Los dos cerrados y deployados el mismo día.**

### 1. `firestore.rules` — creación de perfil con campos de más 🔴 → ✅

La regla `saldoDeBienvenidaValido()` comprobaba los tres campos de plata
(`credits`, `creditosComprados`, `creditosGanados`) pero no limitaba qué
otros campos podía traer el documento en el `create`. Un atacante con su
propia cuenta podía escribir `wins: 999999`, `dorso`, `avatar`, `insignia`
o un `createdAt` inventado junto al saldo correcto, y Firestore lo aceptaba.

Impacto hoy: bajo — `users/{uid}` sólo lo lee su dueño, y los campos
equipados se leen desde otro lado. Impacto mañana: alto si el ranking lee
`wins` o el perfil muestra `createdAt`. Cerrar con lista blanca cuesta una
función; cerrar con datos sucios cuesta una migración.

**Fix:** `camposDePerfilNuevo()` con `hasOnly` sobre los 9 campos que
escriben los tres caminos del cliente (`register.js` formulario, `register.js`
Google, `auth.js` Google). Commit `60394ea`. Tests: 4 casos nuevos en
`herramientas/probar-reglas.mjs`, corren contra el motor de Google antes de
deployar.

### 2. `acreditarReferido` — Leyendas gratis ilimitadas 🔴 → ✅

La función acreditaba 25 Leyendas al que llamaba, con cualquier `referidoUid`
que mandara. No comprobaba que el uid fuera una cuenta real, ni que existiera
una relación entre los dos, ni que fuera una cuenta nueva. Con una cuenta
propia y un bucle: 5 llamadas/minuto (el techo de `LIMITES_DE_PLATA`) × 25
Leyendas = 7.500 Leyendas/hora, 180.000/día. La clave de idempotencia
`referido_${referidoUid}` no defendía: los uids inventados son únicos.

Y nadie la llamaba: `Select-String` sobre `public/` no encontró una sola
referencia. Era un cabo suelto de una versión anterior. Se activaba el día
que se encendiera la venta (`SOLO_ADMIN_COMPRA = false`).

**Fix:** `await administradores.exigir(context)` después de `exigirSesion`.
No se borró del todo porque dos pruebas verifican que sigue desplegada
(`sin-bono-diario.mjs`, `sin-ruleta.mjs`). El día que se implemente un sistema
de referidos real, se reemplaza. Commit `9b1b5ee`.

---

## Veredicto por canasta

### 🟢 Funciones user-facing (39)

Todas empiezan con `exigirSesion(context, "<nombre>")`. Siete además tienen
`limite.exigirRitmoDePlata` porque mueven saldo:

- `comprarItem`, `comprarPack`
- `inscribirseATorneo`
- `desposeerItemAdmin`, `forzarBorrarItemAdmin` (mueven saldo, aunque el
  nombre diga Admin — el `exigirSesion` es del admin, y el rate limit corre
  por el uid del admin)
- `crearOrdenDeCompra`
- `acreditarReferido`

Las de partida en red (`avanzarPartida`, `accionDePartida`, `intentarDescarte`,
`cerrarMirada`, `latir`, `saltarAusente`, `volver`, `abandonarPartida`) pasan
por el motor `partida-red.js`, que es server-authority: el cliente sólo pide
acciones, el servidor las valida y publica vistas.

### 🟢 Funciones admin (30)

Ninguna comprueba admin en `index.js`. Todas delegan a un módulo que sí lo
hace, contra el correo verificado del token — no contra un uid que venga en
la llamada:

| Módulo | Funciones | Guardia |
|---|---|---|
| `packs.js` | 5 (listar, guardar, borrar, activar, sembrar) | `administradores.exigir` |
| `tienda.js` | 9 (catálogo, items, poseedores, desposeer, forzar borrar, apagar viejo) | `administradores.exigir` |
| `admin.js` | 9 (salas, usuarios, nombres) | `exigirAdmin` → `administradores.exigir` |
| `reportes.js` | 2 (listar, resolver) | `exigirAdmin` → `administradores.exigir` |
| `administradores.js` | 3 (listar, agregar, quitar) | `exigir` (chequea que quien llama YA sea admin) |
| `torneos.js` | 8 (crear, editar, abrir, cerrar, iniciar, finalizar, cancelar, detalle) | `administradores.exigir` |

`reportarJugador` NO es admin — es la denuncia que hace un jugador común. Toma
el uid de `exigirSesion`, nunca del body, así que no se puede firmar una
denuncia a nombre de otro.

### 🟢 Funciones programadas (4)

`barrerPartidas`, `cerrarRankingSemanal`, `cerrarRankingMensual`,
`cerrarRankingAnual`. Sin input de usuario, disparadas por Cloud Scheduler.

### 🟢 Webhook (1)

`webhookPago` — auditado en la fase previa. No confía en el payload (consulta
la API de MP), verifica firma HMAC con `timingSafeEqual`, acredita dentro de
una transacción con `pagoCoincideConOrden` como última reja, idempotente por
`compra_${pago}`.

### 🟢 Utilidades (4)

`soyAdministrador`, `horaDelServidor`, `listarTorneos`, `listarPacks`. Todas
con `exigirSesion`, devuelven datos no sensibles.

---

## Auditorías de fondo (sin huecos)

- **`mercadopago.js`** — firma bien formada, ventana de 5 min anti-replay,
  precio del catálogo del servidor, `pagoCoincideConOrden` verifica referencia,
  moneda e importe con tolerancia de un centavo.
- **`moverLeyendas`** (`leyendas.js`) — única puerta del saldo. Atómica, con
  idempotencia por transacción, candados de dirección (cobro no acredita,
  devolución no cobra), auditoría completa por asiento (saldo previo, nuevo,
  delta por bolsillo).
- **`firestore.rules`** — `partidas/{id}` invisible al cliente, cada jugador
  lee sólo su vista. `codigos/`, `auditoria/`, `configuracion/`,
  `partidasPuntuadas/` ciegos. Fallback final deniega.
- **`comprarVarios`** (`tienda.js`) — recalcula precios en el servidor dentro
  de transacción. Cliente sólo manda ids.

---

## Riesgos aceptados (decisión consciente, no bug)

- **App Check apagado** (`MANDAR_TOKEN = false`, `EXIGIR_APP_CHECK = false`).
  Con 14 usuarios no vale la pena: 20s de delay con AdBlock y 345 KB de
  reCAPTCHA por página. Encender las dos banderas juntas cuando la venta se
  active (§2). Ver §12 de PENDIENTE.md.

- **`username` / `email` / `createdAt` los elige el cliente.** La regla no
  valida patrón. No es grave hoy porque nadie más los lee; sí lo será cuando
  haya chat social o reportes públicos.

---

## Fuera de alcance

- Auth config (reglas de password, protección de enumeración de emails,
  MFA obligatorio para admin).
- Storage rules, si existen.
- Contenido de las vistas recortadas (`vistaDe` en `partida-red.js`).
- Las 74 functions no listadas arriba (todas las de `index.js` están
  cubiertas).

---

## Contexto

- **Commit de referencia:** `9b1b5ee`
- **Suites de tests:** 83/83 verde (`npm test`)
- **Rules de Firestore:** validadas contra el motor de Google antes de
  deployar (`herramientas/probar-reglas.mjs`, 26 casos)
- **Cómo se hizo:** lectura de código + `Select-String` de patrones de guardia
  (`exigirSesion`, `administradores.exigir`, `exigirRitmoDePlata`) cruzados
  contra las 78 funciones del deploy. Para los 2 hallazgos, lectura completa
  del caller + el módulo que recibe la llamada.

Cuando aparezca una función nueva que toque dinero, roles o datos de
terceros: el chequeo mínimo es que empiece con `exigirSesion` (si es
user-facing) o que su módulo llame a `administradores.exigir` (si es admin).
Las suites estáticas ya cubren varias de estas invariantes.