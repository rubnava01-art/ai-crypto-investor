#!/usr/bin/env node
// Paridad ES/EN de los diccionarios i18n (frontend/lib/i18n/es.ts, en.ts).
//
// Las secciones del diccionario son Record<string, string>, así que tsc
// NO detecta una clave que falte en un idioma: en runtime se renderiza
// `undefined` en vez de fallar el build. Precedente: 2026-11-06, el bloque
// 'social' quedó fuera del diccionario y el panel mostró claves vacías.
// Este chequeo compara las claves aplanadas de ambos diccionarios y falla
// (exit 1) si falta o sobra alguna, para que el error no llegue al commit.
//
// Uso: node scripts/check-i18n-parity.mjs [es.ts] [en.ts]
// Requiere Node >= 22.6 con type stripping (los dicts son TS erasable:
// solo `import type` y anotaciones de tipo).
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const esPath = process.argv[2] ?? path.join(root, "frontend/lib/i18n/es.ts");
const enPath = process.argv[3] ?? path.join(root, "frontend/lib/i18n/en.ts");

const { dictEs } = await import(pathToFileURL(esPath).href);
const { dictEn } = await import(pathToFileURL(enPath).href);

function flatten(obj, prefix = "", out = new Map()) {
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object") flatten(value, full, out);
    else out.set(full, value);
  }
  return out;
}

const es = flatten(dictEs);
const en = flatten(dictEn);
const missingInEn = [...es.keys()].filter((k) => !en.has(k));
const missingInEs = [...en.keys()].filter((k) => !es.has(k));
const empty = [...es.entries(), ...en.entries()].filter(
  ([, v]) => typeof v !== "string" || v.trim() === "",
);

console.log(`i18n: es=${es.size} claves, en=${en.size} claves.`);
let failed = false;
for (const k of missingInEn) {
  console.error(`Falta en en.ts: ${k}`);
  failed = true;
}
for (const k of missingInEs) {
  console.error(`Falta en es.ts: ${k}`);
  failed = true;
}
for (const [k] of empty) {
  console.error(`Valor vacío o no cadena: ${k}`);
  failed = true;
}
if (failed) {
  console.error("Paridad i18n: FALLÓ.");
  process.exit(1);
}
console.log("Paridad i18n: OK.");
