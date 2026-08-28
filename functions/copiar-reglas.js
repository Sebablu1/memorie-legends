/**
 * Las reglas del juego viven en /public/js/reglas y las usan tanto el
 * navegador como las Cloud Functions. Firebase sólo sube el contenido de
 * /functions al desplegar, así que se copian acá antes de cada deploy.
 *
 * Una sola fuente de verdad: nunca editar functions/reglas a mano.
 */
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const aca = dirname(fileURLToPath(import.meta.url));
const origen = join(aca, "..", "public", "js", "reglas");
const destino = join(aca, "reglas");

mkdirSync(destino, { recursive: true });
cpSync(origen, destino, { recursive: true });
writeFileSync(
  join(destino, "LEEME.txt"),
  "Copia generada por copiar-reglas.js. No editar: los originales están en public/js/reglas.\n",
);

console.log(`Reglas copiadas de ${origen} a ${destino}`);
