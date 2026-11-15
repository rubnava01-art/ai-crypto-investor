// Tests de isFreePrice (lib/format.ts, mejora diaria 2026-11-15):
// la guía gratuita de /estudiar muestra "Gratis" en vez de "$0.00 USD".
// Se corre con el runner de Node: `npm test` en frontend.
import test from "node:test";
import assert from "node:assert/strict";
import { isFreePrice } from "./format";

test("isFreePrice acepta 0 como string o número", () => {
  assert.equal(isFreePrice("0.00"), true);
  assert.equal(isFreePrice("0"), true);
  assert.equal(isFreePrice(0), true);
  assert.equal(isFreePrice("0.0"), true);
});

test("isFreePrice rechaza precios con importe", () => {
  assert.equal(isFreePrice("19.99"), false);
  assert.equal(isFreePrice(59.99), false);
  assert.equal(isFreePrice("1"), false);
});

test("isFreePrice rechaza ausentes y no numéricos (nunca 'Gratis' por error)", () => {
  assert.equal(isFreePrice(""), false);
  assert.equal(isFreePrice(null), false);
  assert.equal(isFreePrice(undefined), false);
  assert.equal(isFreePrice("abc"), false);
  assert.equal(isFreePrice(Number.NaN), false);
});
