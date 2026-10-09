# Despliegue

> **Actualizado el 2026-08-28.** Se desplegó `firestore.rules` con
> `firebase deploy --only firestore:rules`. La salida del comando dice
> `released rules firestore.rules to cloud.firestore`, así que en ese momento
> el archivo de este repositorio pasó a ser el ruleset activo. Todo lo que
> sigue vale igual para la próxima vez: sigue sin poder LEERSE el ruleset
> activo desde este entorno, y cualquier edición hecha en la consola después
> de esa fecha no se vería reflejada acá.

## Las reglas locales y las desplegadas pueden no ser las mismas

`firestore.rules` es el archivo de este repositorio. **No es prueba de nada
sobre lo que está corriendo en producción.** Firestore aplica el último
*ruleset* que se le desplegó, y ese despliegue es un acto aparte del commit:
alguien puede haber editado las reglas desde la consola web, o el último
`firebase deploy --only firestore:rules` puede haberse hecho desde otra copia
del repositorio, o puede no haberse hecho nunca.

El CLI de Firebase sigue sin poder leerlas: `firebase firestore:*` sólo expone
`delete`, `bulkdelete`, `indexes`, `locations`, `operations`, `databases` y
`backups`. No hay nada ahí para leer reglas.

**Pero ya se pueden leer**, y eso cambió desde que se escribió esto. Acá decía
que la API que lo permite —`firebaserules.googleapis.com`— necesita `gcloud` y
que `gcloud` no estaba instalado. Hoy **sí lo está** (SDK 585.0.0, autenticado
con la cuenta de soporte), así que la comprobación dejó de ser a mano. Ver
*Traer las reglas vivas* más abajo.

Mientras no se compruebe, sigue valiendo lo de siempre: **hay que asumir que
pueden diferir.** No tratar "está en el repositorio" como "está aplicado".

### Traer las reglas vivas

```bash
T=$(gcloud auth print-access-token)
curl -s -H "Authorization: Bearer $T" -H "X-Goog-User-Project: memorie-legends" "https://firebaserules.googleapis.com/v1/projects/memorie-legends/releases"
```

`X-Goog-User-Project` es **imprescindible**: sin esa cabecera la API contesta
403 por falta de proyecto de cuota, y el mensaje habla de credenciales por
omisión, que manda a buscar el problema donde no está. Se pasa por cabecera y
no con `gcloud auth application-default set-quota-project` para no tocar la
configuración local de nadie.

Eso devuelve tres *releases*, y conviene no confundirlas:

| Release | Qué es |
|---|---|
| `cloud.firestore/southamerica` | **la que importa**: la base que usa el juego |
| `cloud.firestore` | la base `(default)`, en Iowa, con los datos viejos |
| `firebase.storage` | las reglas de Storage |

Con el `rulesetName` que trae la que interese, el contenido sale de:

```bash
curl -s -H "Authorization: Bearer $T" -H "X-Goog-User-Project: memorie-legends" "https://firebaserules.googleapis.com/v1/<rulesetName>"
```

El fuente viene en `source.files[0].content`, y se compara con `diff` contra
`firestore.rules`.

**Comprobado el 9 de octubre de 2026: idénticas, byte por byte.**

### Cómo comprobarlo en Firebase Console

1. Entrar a <https://console.firebase.google.com/project/memorie-legends/firestore/rules>.
2. La pestaña **Reglas** muestra el texto activo. Arriba dice cuándo se
   publicó por última vez.
3. Comparar con `firestore.rules` de este repositorio. Los cinco puntos que
   importan, y que hay que ver textualmente:

   | Qué buscar | Tiene que decir |
   |---|---|
   | `match /users/{uid}` → `allow update` | `hasOnly(['username', 'avatar', 'photoURL'])` — sin `credits` |
   | `match /users/{uid}` → `allow create` | `request.resource.data.credits == 100` |
   | `match /rooms/{salaId}` | `allow write: if false;` |
   | `match /movimientos/{id}` | `allow write: if false;` |
   | Al final del archivo | `match /{documento=**} { allow read, write: if false; }` |

4. En el desplegable **Historial de versiones** se ve si hubo publicaciones
   que no salieron de este repositorio.

Si algo no coincide, la forma de sincronizar es desplegar desde acá:

```bash
firebase deploy --only firestore:rules
```

Eso **pisa** lo que haya en producción con `firestore.rules`. Conviene mirar
antes qué se está pisando.

### Huella de la versión local

Calculada sobre el archivo sin comentarios ni espacios sobrantes, para poder
citarla en una revisión:

```
sha256 (16 primeros) : f9620b972e7379b1
líneas               : 394
```

Se recalcula así:

```bash
python -c "import io,hashlib,re;s=io.open('firestore.rules',encoding='utf-8').read();t=re.sub(r'\s+',' ',re.sub(r'//.*','',s)).strip();print(hashlib.sha256(t.encode()).hexdigest()[:16])"
```

## Estado de las Cloud Functions

Comprobado con `firebase functions:list`.

| Función | Estado |
|---|---|
| `crearSala`, `unirseASala`, `iniciarPartida`, `salirDeSalaEnEspera`, `marcarListo` | desplegadas |
| `abandonarPartida` | **escrita y probada, sin desplegar** |
| `reclamarBonoDiario`, `girarLaRuleta`, `cerrarPartida`, `acreditarReferido`, los tres cron de ranking, `crearOrdenDeCompra`, `webhookPago` | escritas, sin desplegar |

El plan es Blaze: las funciones *callable* desplegadas no existirían en Spark.

## Antes de desplegar cualquier función que mueva Leyendas

1. Comprobar las reglas activas como se describe arriba.
2. `npm test` en verde.
3. Revisar que la función nueva use `moverLeyendas` y no escriba `credits`
   por su cuenta. `pruebas/abandono.mjs` lo comprueba automáticamente para
   `index.js` y `abandono.js`; si aparece otro módulo económico, agregarlo a
   esa comprobación.
