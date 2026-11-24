import test from "node:test";
import assert from "node:assert/strict";
import { crmMoney, sparklinePoints, weeklyBarHeight } from "./crmResumen";

test("crmMoney: USD con dos decimales, formato $0.00 de la referencia", () => {
  assert.equal(crmMoney(0), "$0.00");
  assert.equal(crmMoney(1234.5), "$1,234.50");
  assert.equal(crmMoney(55), "$55.00");
});

test("sparklinePoints: 7 valores, último punto anclado al borde derecho", () => {
  const pts = sparklinePoints([0, 0, 1, 2, 0, 0, 3]);
  const pairs = pts.split(" ");
  assert.equal(pairs.length, 7);
  assert.ok(pairs[6].startsWith("120.0,"));
  assert.equal(sparklinePoints([]), "");
  // Serie vacía (todo a cero): línea plana en la base, sin NaN.
  assert.equal(sparklinePoints([0, 0, 0]), "0.0,28.0 60.0,28.0 120.0,28.0");
});

test("weeklyBarHeight: proporcional al máximo, mínimo 12 con venta, 4 sin ella", () => {
  assert.equal(weeklyBarHeight(100, 100), 100);
  assert.equal(weeklyBarHeight(50, 100), 50);
  assert.equal(weeklyBarHeight(1, 100), 12);
  assert.equal(weeklyBarHeight(0, 100), 4);
  assert.equal(weeklyBarHeight(0, 0), 4);
});
