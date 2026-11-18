// Tests de lib/dates.ts (NEST, 2026-11-17): zona America/Los_Angeles
// explícita, ida y vuelta fecha+hora ⇄ ISO UTC, y rejilla de mes.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMonthGrid,
  combineDateTimeToIso,
  dateKeyInTz,
  toDateInputValue,
  toTimeInputValue,
  tzParts,
} from "./dates";

test("tzParts: un ISO UTC se lee en hora de Los Ángeles (PST, -8 en noviembre)", () => {
  const p = tzParts(new Date("2026-11-20T18:30:00Z"));
  assert.equal(p.year, 2026);
  assert.equal(p.month, 11);
  assert.equal(p.day, 20);
  assert.equal(p.hour, 10);
  assert.equal(p.minute, 30);
});

test("tzParts: horario de verano (PDT, -7 en junio)", () => {
  const p = tzParts(new Date("2026-06-20T18:30:00Z"));
  assert.equal(p.hour, 11);
  assert.equal(p.minute, 30);
});

test("combineDateTimeToIso: fecha+hora de pared en LA → ISO UTC correcto", () => {
  // 10:30 en LA (PST) = 18:30 UTC.
  assert.equal(combineDateTimeToIso("2026-11-20", "10:30"), "2026-11-20T18:30:00.000Z");
  // 10:30 en LA (PDT) = 17:30 UTC.
  assert.equal(combineDateTimeToIso("2026-06-20", "10:30"), "2026-06-20T17:30:00.000Z");
});

test("toDateInputValue / toTimeInputValue: ida y vuelta con combineDateTimeToIso", () => {
  const iso = combineDateTimeToIso("2026-11-20", "10:30");
  assert.equal(toDateInputValue(iso), "2026-11-20");
  assert.equal(toTimeInputValue(iso), "10:30");
  assert.equal(dateKeyInTz(iso), "2026-11-20");
});

test("combineDateTimeToIso: sin fecha devuelve vacío", () => {
  assert.equal(combineDateTimeToIso("", "10:30"), "");
});

test("buildMonthGrid: noviembre 2026 empieza lunes 26 oct y tiene 30 días en mes", () => {
  const weeks = buildMonthGrid(2026, 11);
  assert.equal(weeks.length, 6);
  for (const w of weeks) assert.equal(w.length, 7);
  assert.equal(weeks[0][0].key, "2026-10-26");
  assert.equal(weeks[0][0].inMonth, false);
  assert.equal(weeks[5][6].key, "2026-12-06");
  const inMonth = weeks.flat().filter((d) => d.inMonth);
  assert.equal(inMonth.length, 30);
  assert.equal(inMonth[0].key, "2026-11-01");
  assert.equal(inMonth[29].key, "2026-11-30");
  // 1 nov 2026 es domingo: última columna de la primera semana.
  assert.equal(weeks[0][6].key, "2026-11-01");
});

test("buildMonthGrid: febrero 2026 (28 días, 1 feb domingo) ocupa 5 semanas", () => {
  const weeks = buildMonthGrid(2026, 2);
  assert.equal(weeks.length, 5);
  assert.equal(weeks[0][0].key, "2026-01-26");
  assert.equal(weeks.flat().filter((d) => d.inMonth).length, 28);
});
