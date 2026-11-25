// Tests del catálogo de herramientas (lib/herramientas.ts, TBT-Herramientas
// FASE 2, 2026-11-24). Se corre con el runner de Node: `npm test` en
// frontend (Node 24, sin dependencias: herramientas.ts y los diccionarios
// son módulos TS erasables; PLAN_FEATURE_KEYS se lee del fuente de
// PlanesPanel.tsx — NO se importa el componente, que depende de
// next/link — y se replica su cálculo acumulativo, el mismo que
// PlanesCompare).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HERRAMIENTAS } from "./herramientas";
import { dictEs } from "./i18n/es";
import { dictEn } from "./i18n/en";

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// PLAN_FEATURE_KEYS, leída del fuente (fuente única, sin duplicarla aquí).
const planesPanelSrc = readFileSync(path.join(FRONTEND, "components/PlanesPanel.tsx"), "utf8");
const matrixMatch = planesPanelSrc.match(/export const PLAN_FEATURE_KEYS = \[([\s\S]*?)\n\] as const;/);
assert.ok(matrixMatch, "PLAN_FEATURE_KEYS no encontrada en PlanesPanel.tsx");
// Las 14 claves, en orden Esencial → Crecimiento → Total; las filas se
// reconstruyen por su tamaño conocido (4 + 4 + 6).
const allKeys = [...(matrixMatch?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
assert.equal(allKeys.length, 14, `PLAN_FEATURE_KEYS debe tener 14 funciones, tiene ${allKeys.length}`);
const PLAN_FEATURE_KEYS: string[][] = [allKeys.slice(0, 4), allKeys.slice(4, 8), allKeys.slice(8)];
const PLAN_KEYS = ["esencial", "crecimiento", "total"];
const includedByPlan: Set<string>[] = PLAN_FEATURE_KEYS.map((_, i) =>
  new Set(PLAN_FEATURE_KEYS.slice(0, i + 1).flat()),
);
function planIndexForFeature(featureKey: string): number {
  return includedByPlan.findIndex((included) => included.has(featureKey));
}

test("corte de lanzamiento: exactamente 25 herramientas, ids únicos", () => {
  assert.equal(HERRAMIENTAS.length, 25);
  assert.equal(new Set(HERRAMIENTAS.map((t) => t.id)).size, 25);
});

test("nunca: ajustador, terminal, usuarios, privacidad, perfil ni chat", () => {
  const forbidden = ["ajustador", "terminal", "usuarios", "privacidad", "perfil", "chat"];
  for (const tool of HERRAMIENTAS) {
    assert.ok(!forbidden.includes(tool.id), `${tool.id} no debe aparecer en v1`);
  }
});

test("cada herramienta tiene plan válido derivado de PLAN_FEATURE_KEYS", () => {
  const allFeatures = new Set(PLAN_FEATURE_KEYS.flat());
  for (const tool of HERRAMIENTAS) {
    assert.ok(allFeatures.has(tool.featureKey), `${tool.id}: featureKey ${tool.featureKey} no está en PLAN_FEATURE_KEYS`);
    const idx = planIndexForFeature(tool.featureKey);
    assert.ok(idx >= 0 && idx <= 2, `${tool.id}: sin plan mínimo válido`);
    assert.ok(PLAN_KEYS[idx], `${tool.id}: sin clave de plan`);
  }
});

test("categorías válidas y Espacio en Gestiona", () => {
  const valid = new Set(["invierte", "aprende", "crea", "gestiona"]);
  for (const tool of HERRAMIENTAS) {
    assert.ok(valid.has(tool.categoria), `${tool.id}: categoría ${tool.categoria} inválida`);
  }
  assert.equal(HERRAMIENTAS.find((t) => t.id === "espacio")?.categoria, "gestiona");
});

test("solo las 2 de acceso libre llevan el gancho sin cuenta", () => {
  const free = HERRAMIENTAS.filter((t) => t.free).map((t) => t.id).sort();
  assert.deepEqual(free, ["bitcoin", "calculadora"]);
});

test("cada herramienta tiene ruta existente y, si lleva ancla, ancla existente", () => {
  // Ficheros donde viven los ids de ancla de /estudiar y /crear.
  const anchorFiles = [
    "app/estudiar/page.tsx",
    "components/ClasesHerramientas.tsx",
    "components/CrearPanel.tsx",
  ].map((rel) => readFileSync(path.join(FRONTEND, rel), "utf8"));
  for (const tool of HERRAMIENTAS) {
    const [rawPath, hash] = tool.href.split("#");
    const pagePath = rawPath === "/" ? "app/page.tsx" : `app${rawPath}/page.tsx`;
    assert.ok(
      existsSync(path.join(FRONTEND, pagePath)),
      `${tool.id}: ruta ${tool.href} sin página (${pagePath})`,
    );
    if (hash) {
      const pageSrc = readFileSync(path.join(FRONTEND, pagePath), "utf8");
      const found =
        pageSrc.includes(`id="${hash}"`) || anchorFiles.some((src) => src.includes(`id="${hash}"`));
      assert.ok(found, `${tool.id}: ancla #${hash} no encontrada en ${tool.href}`);
    }
  }
});

test("cada herramienta tiene Desc y Límite no vacíos en ES y EN", () => {
  for (const tool of HERRAMIENTAS) {
    for (const [lang, dict] of [
      ["es", dictEs],
      ["en", dictEn],
    ] as const) {
      const desc = dict.herramientas[`${tool.id}Desc`];
      const limit = dict.herramientas[`${tool.id}Limit`];
      assert.ok(typeof desc === "string" && desc.trim() !== "", `${tool.id}: falta herramientas.${tool.id}Desc en ${lang}`);
      assert.ok(typeof limit === "string" && limit.trim() !== "", `${tool.id}: falta herramientas.${tool.id}Limit en ${lang}`);
    }
  }
});

test("ninguna tarjeta promete ganancias ni inventa precios", () => {
  const banned = /ganar[aá]s|dinero seguro|rentabilidad garantizada|100\s?%/i;
  for (const tool of HERRAMIENTAS) {
    for (const dict of [dictEs, dictEn]) {
      const text = `${dict.herramientas[`${tool.id}Desc`]} ${dict.herramientas[`${tool.id}Limit`]}`;
      assert.ok(!banned.test(text), `${tool.id}: texto con promesa no permitida`);
    }
  }
});

// H-02 (ronda de correcciones QA, 2026-11-24): «Ver en qué plan va»
// navega a /#plan-<clave>; Landing debe desplazar al ancla tras la
// hidratación, cuando PlanesPanel (dynamic ssr: false) ya existe.
test("H-02: Landing reintenta el desplazamiento a #plan-* tras hidratar", () => {
  const landingSrc = readFileSync(path.join(FRONTEND, "components/Landing.tsx"), "utf8");
  assert.ok(landingSrc.includes('hash.startsWith("#plan-")'), "Landing debe detectar #plan-* en la URL");
  assert.ok(landingSrc.includes("document.getElementById(id)"), "Landing debe buscar el elemento del plan");
  assert.ok(landingSrc.includes("scrollIntoView()"), "Landing debe desplazar al elemento del plan");
  const planesSrc = readFileSync(path.join(FRONTEND, "components/PlanesPanel.tsx"), "utf8");
  for (const id of ["plan-esencial", "plan-crecimiento", "plan-total"]) {
    assert.ok(planesSrc.includes(`"${id}"`), `PlanesPanel debe tener el id ${id}`);
  }
});

// R-01 (ronda final QA re-validación, 2026-11-24): el gancho libre
// navega a /estudiar#herramienta-*; /estudiar debe desplazar al ancla
// tras la hidratación, cuando ClasesPanel (dynamic ssr: false) ya
// existe. Solo #herramienta-* (los #estudiar-* ya existen desde el
// primer render y no necesitan reintento).
test("R-01: /estudiar reintenta el desplazamiento a #herramienta-* tras hidratar", () => {
  const estudiarSrc = readFileSync(path.join(FRONTEND, "app/estudiar/page.tsx"), "utf8");
  assert.ok(estudiarSrc.includes('hash.startsWith("#herramienta-")'), "/estudiar debe detectar #herramienta-* en la URL");
  assert.ok(estudiarSrc.includes("document.getElementById(id)"), "/estudiar debe buscar el elemento de la herramienta");
  assert.ok(estudiarSrc.includes("scrollIntoView()"), "/estudiar debe desplazar al elemento de la herramienta");
  const clasesSrc = readFileSync(path.join(FRONTEND, "components/ClasesHerramientas.tsx"), "utf8");
  for (const id of ["herramienta-calculadora", "herramienta-bitcoin"]) {
    assert.ok(clasesSrc.includes(`"${id}"`), `ClasesHerramientas debe tener el id ${id}`);
  }
});
