# 🃏 Memorie Legends

Juego de cartas multijugador en tiempo real con Firebase.

## ✨ Características

- ✅ Registro y autenticación con Firebase Auth
- ✅ Sistema de créditos (50 gratis al registrarse)
- ✅ Salas multijugador en tiempo real
- ✅ Lógica completa del juego (baraja española, turnos, poderes, corte)
- ✅ Sistema de puntuación (150 puntos para ganar)
- ✅ Actualizaciones en tiempo real con Firestore
- ✅ Despliegue en Firebase Hosting

## 🚀 Instalación

```bash
# Clonar repositorio
git clone https://github.com/tu-usuario/memorie-legends.git
cd memorie-legends

# Instalar Firebase CLI
npm install -g firebase-tools

# Configurar Firebase
firebase login
firebase init

# Ejecutar localmente
firebase serve

# Desplegar a producción
firebase deploy
## 🧪 Pruebas

Cuatro atajos, de la más corta a la más larga. Los tiempos son de una máquina
de 8 núcleos y 8 GB.

| Comando | Qué corre | Tarda |
|---|---|---|
| `npm run test:file -- <archivo>` | un solo archivo de navegador | ~14 s |
| `npm run test:node` | las 52 suites de Node | ~27 s |
| `npm run test:fast` | 6 suites de navegador, 50 pruebas | ~55 s |
| `npm run test:full` | las 253 pruebas de navegador | ~8 min |

```bash
npm run test:file -- pruebas/e2e/marco-y-titulo.spec.js
```

**Cuál usar.** `test:file` mientras se trabaja en algo puntual, `test:node` y
`test:fast` en cada cambio, y `test:full` **antes de desplegar, siempre**.

Las rápidas son un subconjunto elegido a mano —la tienda, el inventario, la
mesa vestida, el panel— y no cubren todo. Dan confianza para seguir
trabajando, no para desplegar: la última vez que la completa corrió después
de un rato sin correrla, encontró 21 fallos que Node no veía.

**Node y navegador no se corren a la vez.** La mesa usa temporizadores reales,
y competir por CPU con las suites de Node hace que pruebas sanas fallen por
tiempo de espera. Si `test:full` se pone lento o intermitente, lo primero que
hay que mirar es qué más está corriendo.

### Los cuatro trabajadores

`playwright.config.js` corre con `workers: 4`, y el número está medido — no
elegido. La razón larga está en el archivo; en corto:

| Trabajadores | `test:fast` |
|---|---|
| 1 | 90 s |
| 2 | 61 s |
| 4 | 54 s |

La ganancia se aplana porque estas pruebas pasan el tiempo **esperando
relojes**, no calculando. Y cada trabajador es un Chromium, así que en una
máquina de 8 GB subir más compra poco y arriesga fallos por memoria, que se
leen igual que intermitencias.

Antes de subirlo de 1 se corrieron las cinco suites más cargadas de
temporizadores dos veces cada una: 60 pruebas, ninguna intermitente. En otra
máquina, `--workers=N` manda sobre el archivo sin tocarlo.
