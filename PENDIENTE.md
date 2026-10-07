# Pendiente

Lo abierto, en 3 minutos de lectura. Lo cerrado vive en `HISTORIA.md`.

Última revisión: 7 de octubre de 2026.

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
- Reglas de `southamerica` no verificadas contra el repo.
- Índices de la base nueva no verificados.

---

## Cerrado → ver `HISTORIA.md`

§0, §3b, §3d, §5, §7, §8, §11, §13b, §14, §22, §24, §28, §30,
§31, §33, §34, §35, §36, §38, §39, §42 (parcial).
