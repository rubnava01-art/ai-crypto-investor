// Tests de la matemática pura de la Calculadora de rentabilidad
// (lib/rentabilidad.ts, plan servicios-calc T-2, 2026-11-25). Se corre
// con el runner de Node: `npm test` en frontend (Node 24, sin
// dependencias: rentabilidad.ts es un módulo TS erasable y puro).
// Ejemplos 1–3 del Agente 3 §(c) con valores exactos (tolerancia
// ≤ 0.01) + casos borde E-1…E-12. Indefinidos → null, nunca
// NaN/Infinity; entradas inválidas → null (sin resultado).
import test from "node:test";
import assert from "node:assert/strict";
import { MAX_RENT_AMOUNT, calcRentabilidad } from "./rentabilidad";

/** Compara con tolerancia de redondeo a 2 decimales. */
const close = (actual: number | null, expected: number, msg?: string) => {
  assert.ok(actual !== null, `${msg ?? "valor"}: esperado ${expected}, llegó null`);
  assert.ok(Math.abs((actual as number) - expected) <= 0.01, `${msg ?? "valor"}: esperado ${expected}, llegó ${actual}`);
};

/** Ningún campo numérico del resultado es NaN ni Infinity ni -0. */
const assertClean = (r: NonNullable<ReturnType<typeof calcRentabilidad>>) => {
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === "number") {
      assert.ok(Number.isFinite(v), `${k} no es finito: ${v}`);
      assert.ok(!Object.is(v, -0), `${k} es -0`);
    }
  }
};

// --- Ejemplos 1–3 (Agente 3 §(c)) ---

test("Ej. 1 (típico): I=10000, CV=4000, CF=3000 → CT=7000, MB=6000 (60%), MN=3000 (30%), PE=5000, R≈42.86%", () => {
  const r = calcRentabilidad(10000, 4000, 3000);
  assert.ok(r !== null);
  assertClean(r);
  assert.equal(r.costosTotales, 7000);
  assert.equal(r.margenBruto, 6000);
  close(r.margenBrutoPct, 60, "MB%");
  assert.equal(r.margenNeto, 3000);
  close(r.margenNetoPct, 30, "MN%");
  close(r.puntoEquilibrio, 5000, "PE");
  assert.equal(r.sinEquilibrio, false);
  close(r.rentabilidad, 42.86, "R");
});

test("Ej. 2 (pérdida): I=5000, CV=4000, CF=3000 → MB=1000 (20%), MN=-2000 (-40%), PE=15000, R≈-28.57%", () => {
  const r = calcRentabilidad(5000, 4000, 3000);
  assert.ok(r !== null);
  assertClean(r);
  assert.equal(r.costosTotales, 7000);
  assert.equal(r.margenBruto, 1000);
  close(r.margenBrutoPct, 20, "MB%");
  assert.equal(r.margenNeto, -2000);
  close(r.margenNetoPct, -40, "MN%");
  close(r.puntoEquilibrio, 15000, "PE");
  assert.equal(r.sinEquilibrio, false);
  close(r.rentabilidad, -28.57, "R");
});

test("Ej. 3 (sin equilibrio): I=5000, CV=6000, CF=1000 → MB=-1000, PE no existe", () => {
  const r = calcRentabilidad(5000, 6000, 1000);
  assert.ok(r !== null);
  assertClean(r);
  assert.equal(r.margenBruto, -1000);
  close(r.margenBrutoPct, -20, "MB%");
  assert.equal(r.margenNeto, -2000);
  assert.equal(r.puntoEquilibrio, null);
  assert.equal(r.sinEquilibrio, true);
  close(r.rentabilidad, -28.57, "R");
});

// --- Definición de R (D-1): R = MN / CT × 100, NO MN / I ---

test("R es MN/CT×100, no MN/I (Ej. 1: 42.86% ≠ 30%)", () => {
  const r = calcRentabilidad(10000, 4000, 3000);
  assert.ok(r !== null);
  close(r.rentabilidad, 42.86, "R");
  assert.ok(r.rentabilidad !== null && Math.abs(r.rentabilidad - 30) > 1, "R no debe coincidir con MN%");
});

// --- Casos borde E-1…E-12 ---

test("E-1: I=0, CV=0, CF=0 → ceros definidos, %/PE/R en null (nunca NaN/Infinity)", () => {
  const r = calcRentabilidad(0, 0, 0);
  assert.ok(r !== null);
  assertClean(r);
  assert.equal(r.costosTotales, 0);
  assert.equal(r.margenBruto, 0);
  assert.equal(r.margenNeto, 0);
  assert.equal(r.margenBrutoPct, null);
  assert.equal(r.margenNetoPct, null);
  assert.equal(r.puntoEquilibrio, null);
  assert.equal(r.sinEquilibrio, false);
  assert.equal(r.rentabilidad, null);
});

test("E-2: I=0, CF>0 → MN=-CF se muestra; % y PE en null; R definida si CT>0 (D-1)", () => {
  const r = calcRentabilidad(0, 0, 3000);
  assert.ok(r !== null);
  assertClean(r);
  assert.equal(r.margenNeto, -3000);
  assert.equal(r.margenBrutoPct, null);
  assert.equal(r.margenNetoPct, null);
  assert.equal(r.puntoEquilibrio, null);
  // D-1 fija R = MN/CT×100 solo si CT > 0: CT=3000 → R=-100%.
  close(r.rentabilidad, -100, "R");
});

test("E-3: CV ≥ I (I>0) → PE no existe, nunca Infinity ni negativo", () => {
  const r = calcRentabilidad(5000, 5000, 1000);
  assert.ok(r !== null);
  assertClean(r);
  assert.equal(r.margenBruto, 0);
  assert.equal(r.puntoEquilibrio, null);
  assert.equal(r.sinEquilibrio, true);
  const r2 = calcRentabilidad(5000, 6000, 1000);
  assert.ok(r2 !== null);
  assert.equal(r2.puntoEquilibrio, null);
  assert.equal(r2.sinEquilibrio, true);
});

test("E-4: CF=0 → PE=0; R = MN/CV×100", () => {
  const r = calcRentabilidad(10000, 4000, 0);
  assert.ok(r !== null);
  assertClean(r);
  assert.equal(r.puntoEquilibrio, 0);
  assert.equal(r.sinEquilibrio, false);
  close(r.rentabilidad, 150, "R");
});

test("E-5: CT=0 (CV=0, CF=0, I>0) → MN=I, MN%=100%, R no definida", () => {
  const r = calcRentabilidad(5000, 0, 0);
  assert.ok(r !== null);
  assertClean(r);
  assert.equal(r.margenNeto, 5000);
  close(r.margenNetoPct, 100, "MN%");
  close(r.margenBrutoPct, 100, "MB%");
  assert.equal(r.puntoEquilibrio, 0);
  assert.equal(r.rentabilidad, null);
});

test("E-6: entradas negativas rechazadas (sin calcular)", () => {
  assert.equal(calcRentabilidad(-1, 0, 0), null);
  assert.equal(calcRentabilidad(100, -5, 0), null);
  assert.equal(calcRentabilidad(100, 0, -5), null);
});

test("E-7: entradas no numéricas o vacías → null (sin NaN visible)", () => {
  assert.equal(calcRentabilidad(NaN, 0, 0), null);
  assert.equal(calcRentabilidad(Number("abc"), 0, 0), null);
  // Nota: Number("") es 0 (válido) — el vacío se rechaza en el
  // componente (trim() === ""), no en la función pura, que recibe números.
  assert.equal(calcRentabilidad(Infinity, 0, 0), null);
});

test("E-8: desbordamiento → null, nunca $∞ ni Infinity%", () => {
  // Con el tope 1e12 ningún intermedio desborda en doble precisión;
  // la guarda de finitud lo cubre igual: Infinity de entrada → null.
  const r = calcRentabilidad(1e12, 1, 1e12);
  assert.ok(r !== null);
  assertClean(r);
  assert.ok(Number.isFinite(r.margenNeto));
  assert.ok(r.rentabilidad !== null && Number.isFinite(r.rentabilidad));
});

test("E-9: redondeo — sin artefactos binarios ni -0", () => {
  const r = calcRentabilidad(0.1, 0.2, 0);
  assert.ok(r !== null);
  assertClean(r);
  assert.ok(Math.abs(r.margenBruto - -0.1) < 1e-9, `MB esperado -0.1, llegó ${r.margenBruto}`);
  const r2 = calcRentabilidad(5, 5, 0);
  assert.ok(r2 !== null);
  assert.ok(!Object.is(r2.margenBruto, -0), "MB no debe ser -0");
  assert.equal(r2.margenBruto, 0);
  assert.equal(r2.margenBrutoPct, 0);
});

test("E-10: tope 1e12 — 1e12 aceptado, 1e12+1 rechazado", () => {
  assert.equal(MAX_RENT_AMOUNT, 1e12);
  assert.ok(calcRentabilidad(1e12, 0, 0) !== null);
  assert.ok(calcRentabilidad(0, 1e12, 0) !== null);
  assert.ok(calcRentabilidad(0, 0, 1e12) !== null);
  assert.equal(calcRentabilidad(1e12 + 1, 0, 0), null);
  assert.equal(calcRentabilidad(0, 1e12 + 1, 0), null);
  assert.equal(calcRentabilidad(0, 0, 1e12 + 1), null);
});

test("E-11: CV+CF con entradas individualmente válidas no inventa cifras", () => {
  const r = calcRentabilidad(1e12, 1e12, 1e12);
  assert.ok(r !== null);
  assertClean(r);
  assert.equal(r.costosTotales, 2e12);
  assert.equal(r.margenNeto, -1e12);
  assert.equal(r.puntoEquilibrio, null);
  assert.equal(r.sinEquilibrio, true);
});

test("E-12: coherencia interna — MN = MB − CF y PE verificado por sustitución", () => {
  for (const [I, CV, CF] of [
    [10000, 4000, 3000],
    [5000, 4000, 3000],
    [8000, 2000, 1000],
    [12000, 9000, 2000],
  ] as const) {
    const r = calcRentabilidad(I, CV, CF);
    assert.ok(r !== null);
    assertClean(r);
    assert.ok(Math.abs(r.margenNeto - (r.margenBruto - CF)) < 0.01, `MN ≠ MB − CF en (${I}, ${CV}, ${CF})`);
    if (r.puntoEquilibrio !== null && r.puntoEquilibrio > 0) {
      // Con ingresos = PE, los costos variables escalan en proporción
      // (CV × PE/I): el margen neto debe ser 0.
      const cvAtPe = (CV * r.puntoEquilibrio) / I;
      const check = calcRentabilidad(r.puntoEquilibrio, cvAtPe, CF);
      assert.ok(check !== null);
      assert.ok(Math.abs(check.margenNeto) <= 0.01, `PE=${r.puntoEquilibrio} no equilibra: MN=${check.margenNeto}`);
    }
  }
});
