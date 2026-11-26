// Tests de lib/planes.ts (2.4, 2026-11-26): las claves de plan son el
// contrato de /login?plan=<clave> y del payload de registro; un cambio
// aquí rompería el aviso post-registro y la vista de pendientes del
// admin. Se corre con el runner de Node: `npm test` en frontend.
import test from "node:test";
import assert from "node:assert/strict";
import { PLAN_KEYS, isPlanKey, planNameForKey, type PlanKey } from "./planes";

const DICT = {
  planes: {
    nameEsencial: "Esencial",
    nameCrecimiento: "Crecimiento",
    nameTotal: "Negocio Total",
  },
};

test("PLAN_KEYS tiene exactamente los tres planes, en orden", () => {
  assert.deepEqual([...PLAN_KEYS], ["esencial", "crecimiento", "total"]);
});

test("isPlanKey acepta solo las tres claves exactas", () => {
  for (const k of PLAN_KEYS) assert.equal(isPlanKey(k), true);
  for (const bad of [null, undefined, "", "Esencial", "esencial ", "premium", "inexistente"]) {
    assert.equal(isPlanKey(bad as string), false, `${String(bad)} no es clave de plan`);
  }
});

test("planNameForKey devuelve el nombre visible de cada clave", () => {
  assert.equal(planNameForKey(DICT, "esencial"), "Esencial");
  assert.equal(planNameForKey(DICT, "crecimiento"), "Crecimiento");
  assert.equal(planNameForKey(DICT, "total"), "Negocio Total");
});

test("el tipo PlanKey solo admite las tres claves", () => {
  const keys: PlanKey[] = ["esencial", "crecimiento", "total"];
  assert.equal(keys.length, 3);
});
