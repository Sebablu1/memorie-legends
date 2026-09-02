/**
 * ¿Alguien se puso un nombre peligroso antes del arreglo?
 *
 * CÓMO SE USA
 *
 * Se pega ENTERO en la consola del navegador, estando con sesión iniciada en
 * https://memorie-legends.web.app (por ejemplo en el tablero). No hay que
 * instalar nada.
 *
 * POR QUÉ ASÍ Y NO DESDE UN SCRIPT
 *
 * Leer `users` con credenciales de administrador necesita `gcloud` o una clave
 * de cuenta de servicio, y ninguna de las dos está en esta máquina. Bajar una
 * clave de servicio para una consulta de lectura es una credencial de larga
 * vida creada para un rato: no vale la pena.
 *
 * Esto no hace falta que sea admin. Las reglas de Firestore ya dejan que
 * cualquier jugador autenticado lea la colección `users` —ver la nota al final,
 * porque eso merece una conversación aparte— así que alcanza con estar logueado.
 *
 * QUÉ HACE Y QUÉ NO
 *
 * Sólo LEE. No modifica ni borra nada. Si encuentra algo, lo imprime para que
 * vos decidas qué hacer; cambiar el nombre de alguien es una acción sobre la
 * cuenta de una persona y no la toma un script solo.
 */

(async () => {
  const VERSION_SDK = "10.7.1"; // la misma que carga el sitio

  const { getApp } = await import(
    `https://www.gstatic.com/firebasejs/${VERSION_SDK}/firebase-app.js`
  );
  const { getFirestore, collection, getDocs } = await import(
    `https://www.gstatic.com/firebasejs/${VERSION_SDK}/firebase-firestore.js`
  );

  const db = getFirestore(getApp());
  const snap = await getDocs(collection(db, "users"));

  /**
   * Qué se considera sospechoso.
   *
   * No se busca "código malicioso" —eso es imposible de definir— sino los
   * caracteres que un nombre normal no tiene y que son los que hacen falta para
   * salirse del texto: `<`, `>`, comillas y el `&` de las entidades.
   */
  const PELIGROSOS = /[<>"'&]/;

  const sospechosos = [];
  const total = snap.size;

  snap.forEach((doc) => {
    const nombre = doc.data().username;
    if (typeof nombre !== "string" || !PELIGROSOS.test(nombre)) return;
    sospechosos.push({
      uid: doc.id,
      nombre,
      // Marcado aparte: un nombre con `<script` o `onerror` no es alguien
      // despistado con una comilla, es un intento.
      pareceAtaque: /<\s*(script|img|svg|iframe)|on\w+\s*=|javascript:/i.test(nombre),
      largo: nombre.length,
    });
  });

  console.log(`Revisados ${total} perfiles.`);

  if (!sospechosos.length) {
    console.log("✅ Ningún nombre con caracteres peligrosos.");
    return;
  }

  const ataques = sospechosos.filter((s) => s.pareceAtaque);
  console.warn(
    `⚠️ ${sospechosos.length} nombre(s) con caracteres peligrosos, ` +
      `de los cuales ${ataques.length} parecen un intento deliberado.`,
  );
  // `console.table` no interpreta HTML: se ven como texto, que es el punto.
  console.table(sospechosos);

  // Para pasármelos sin tener que copiar la tabla a mano.
  console.log("Copiá esto:\n" + JSON.stringify(sospechosos, null, 2));
})();

/*
 * NOTA APARTE, y no es menor:
 *
 * Esto funciona sin ser administrador porque `firestore.rules` dice
 *
 *     match /users/{uid} { allow read: if autenticado(); }
 *
 * con el comentario "No hay datos sensibles acá". Pero en ese mismo documento
 * vive `credits`, que es el saldo. O sea que hoy CUALQUIER jugador logueado
 * puede leer el saldo, las partidas y las victorias de todos los demás.
 *
 * Para el ranking y el lobby alcanza con el nombre. Se arregla moviendo el
 * saldo a una subcolección privada, o publicando un documento aparte con lo
 * que de verdad es público. No lo toqué porque cambiar `firestore.rules` sin
 * avisar es exactamente lo que no hay que hacer con las reglas.
 */
