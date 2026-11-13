#!/usr/bin/env node
// check-i18n-unused.mjs — claves hoja de lib/i18n/es.ts sin uso literal
// en el frontend. Solo informa (exit 0 siempre): antes de borrar una
// clave candidata hay que verificarla a mano, porque el acceso puede
// ser por desestructuración (const { label } = t.nav.inicio) o por
// construcción dinámica, casos que este escáner no ve.
// Punto ciego conocido (2026-11-13): una hoja se marca usada si aparece
// cualquier prefijo `t.<prefijo>` en el corpus — no distingue hojas
// hermanas bajo un prefijo usado (p. ej. `t.login.passwordHint` parecía
// usada por `t.login.passwordMinHint`). Verificar a mano antes de borrar.
// Uso: node scripts/check-i18n-unused.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FRONTEND = join(ROOT, "frontend");

// Como check-i18n-parity.mjs: los dicts son TS erasable (solo
// `import type` y anotaciones), Node >= 22.6 los importa directo.
const { dictEs } = await import(
  pathToFileURL(join(FRONTEND, "lib/i18n/es.ts")).href
);

function leaves(obj, prefix, out) {
  for (const k of Object.keys(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (obj[k] && typeof obj[k] === "object") leaves(obj[k], p, out);
    else out.push(p);
  }
  return out;
}
const allLeaves = leaves(dictEs, "", []);

// Fuentes a escanear: todo el frontend salvo node_modules, .next y
// los propios diccionarios (que contienen todas las claves).
function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === "node_modules" || e === ".next") continue;
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(tsx?|mts|cts)$/.test(e) && !p.includes(`${"/"}lib${"/"}i18n${"/"}`))
      yield p;
  }
}
let corpus = "";
for (const f of walk(FRONTEND)) corpus += readFileSync(f, "utf8") + "\n";

// Una clave hoja cuenta como usada si aparece `t.<ruta>` o `t.<prefijo>`
// de esa ruta (desestructuración: const { label } = t.nav.inicio usa
// las hojas hijas sin nombrarlas).
const unused = allLeaves.filter((leaf) => {
  const parts = leaf.split(".");
  for (let i = 1; i <= parts.length; i++) {
    if (corpus.includes(`t.${parts.slice(0, i).join(".")}`)) return false;
  }
  return true;
});

console.log(`Claves hoja en es.ts: ${allLeaves.length}`);
console.log(`Sin uso literal en el frontend: ${unused.length}`);
for (const k of unused) console.log(`  ${k}`);
