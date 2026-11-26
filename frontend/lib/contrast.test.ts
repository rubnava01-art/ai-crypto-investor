// Tests de contraste WCAG (4.1, 2026-11-26): fijan que los banners y
// badges de estado de la plataforma lleguen a AA (>= 4.5:1) y
// documentan por qué zinc-500 y slate-600 se subieron a zinc-400.
// Los fondos con /10 o /15 son mezclas sobre la página oscura
// (zinc-950 #09090b o slate #0f172a según el módulo); blendColor
// reproduce esa mezcla. Se corre con `npm test` en frontend.
import test from "node:test";
import assert from "node:assert/strict";
import { blendColor, contrastRatio, meetsAa, relativeLuminance } from "./contrast";

const ZINC_950 = "#09090b";
const SLATE_PAGE = "#0f172a";
const close = (got: number, want: number, tol = 0.06) =>
  assert.ok(Math.abs(got - want) <= tol, `ratio ${got.toFixed(2)} ≈ ${want}`);

test("la fórmula WCAG da los valores conocidos: blanco/negro 21:1", () => {
  assert.equal(contrastRatio("#ffffff", "#000000"), 21);
  assert.equal(relativeLuminance("#000000"), 0);
  assert.equal(relativeLuminance("#ffffff"), 1);
});

test("blendColor mezcla un fondo /10 sobre la página oscura", () => {
  assert.equal(blendColor("#0ea5e9", SLATE_PAGE, 0.1), "#0f253d");
  assert.equal(blendColor("#10b981", ZINC_950, 0.15), "#0a231d");
});

test("banner 'Modo prueba' (sky-300 sobre sky-500/10) llega a AA", () => {
  const bg = blendColor("#0ea5e9", SLATE_PAGE, 0.1);
  close(contrastRatio("#7dd3fc", bg), 9.31);
  assert.equal(meetsAa("#7dd3fc", bg), true);
});

test("banners de invitado y sin conexión llegan a AA", () => {
  close(contrastRatio("#6ee7b7", blendColor("#10b981", SLATE_PAGE, 0.1)), 10.14);
  close(contrastRatio("#fcd34d", blendColor("#f59e0b", SLATE_PAGE, 0.1)), 10.58);
});

test("badges de estado (emerald/red/amber/sky) llegan a AA", () => {
  close(contrastRatio("#34d399", blendColor("#10b981", ZINC_950, 0.15)), 8.59);
  close(contrastRatio("#f87171", blendColor("#ef4444", ZINC_950, 0.1)), 6.67);
  close(contrastRatio("#fcd34d", blendColor("#f59e0b", ZINC_950, 0.1)), 12.14);
  close(contrastRatio("#38bdf8", blendColor("#0ea5e9", ZINC_950, 0.1)), 8.35);
});

test("texto secundario zinc-400/slate-400 llega a AA (7.76:1)", () => {
  close(contrastRatio("#a1a1aa", ZINC_950), 7.76);
  close(contrastRatio("#94a3b8", ZINC_950), 7.76);
});

test("el zinc-500 y slate-600 antiguos NO llegaban a AA (motivo del cambio)", () => {
  close(contrastRatio("#71717a", ZINC_950), 4.12);
  assert.equal(meetsAa("#71717a", ZINC_950), false);
  close(contrastRatio("#475569", blendColor("#ffffff", ZINC_950, 0.03)), 2.51);
  assert.equal(meetsAa("#475569", blendColor("#ffffff", ZINC_950, 0.03)), false);
});

test("botones sólidos con texto blanco llegan a AA", () => {
  for (const bg of ["#0e7490", "#047857", "#b91c1c", "#2563eb"]) {
    assert.equal(meetsAa("#ffffff", bg), true, `blanco sobre ${bg}`);
  }
});
