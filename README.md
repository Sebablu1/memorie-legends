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
| `npm run test:full` | las 259 pruebas de navegador | ~13 min |

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

### Los dos trabajadores

`playwright.config.js` corre con `workers: 2`, y el número está medido — dos
veces, porque la primera medición se equivocó.

Se subió de 1 a 4 midiendo el subconjunto rápido, que bajó de 90 a 54
segundos. Pero medir el subconjunto no alcanzó: al crecer la suite,
`menu.spec.js` empezó a fallar por tiempo de espera. Con `--repeat-each=4`
sobre esa suite sola:

| Trabajadores | Resultado | Tarda |
|---|---|---|
| 4 | **62 de 64** | 2,2 min |
| 3 | 64 de 64 | 1,0 min |
| 2 | 64 de 64 | 1,0 min |
| 1 | 64 de 64 | 1,3 min |

En esta máquina cuatro trabajadores no sólo son frágiles: son **más lentos que
dos**. Ocho núcleos, pero 8 GB de RAM con 2,5 libres, y cada trabajador es un
Chromium entero — pasado cierto punto se compite por memoria y todos esperan.

Estas pruebas pasan el tiempo **esperando relojes**, no calculando, así que el
paralelismo rinde poco y se agota rápido. Antes de volver a subirlo hay que
medirlo con `--repeat-each` y **sobre la suite completa**, no sobre un
subconjunto: ése fue el error.

En otra máquina, `--workers=N` manda sobre el archivo sin tocarlo.
