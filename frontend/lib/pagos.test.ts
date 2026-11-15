// Tests del punto de cableado de pagos (lib/pagos.ts, 2026-11-14).
// Se corre con el runner de Node: `npm test` en frontend
// (Node 24, sin dependencias: pagos.ts es un módulo puro salvo un
// `import type`, que el stripping de tipos borra antes de resolver).
import test from "node:test";
import assert from "node:assert/strict";
import { PAYMENT_LINKS, paymentUrlForPlan } from "./pagos";
import type { PlanKey } from "../components/PlanesPanel";

const PLANS: PlanKey[] = ["esencial", "crecimiento", "total"];

test("los tres planes devuelven null hoy: el CTA sigue el flujo de registro", () => {
  for (const plan of PLANS) {
    assert.equal(paymentUrlForPlan(plan), null);
  }
});

test("PAYMENT_LINKS tiene exactamente los tres planes, sin extras", () => {
  assert.deepEqual(Object.keys(PAYMENT_LINKS).sort(), [...PLANS].sort());
});

test("ningún link inventado: cada valor es null o una URL https://", () => {
  for (const [plan, url] of Object.entries(PAYMENT_LINKS)) {
    assert.ok(
      url === null || url.startsWith("https://"),
      `${plan} tiene un valor no permitido: ${url}`,
    );
  }
});

test("un plan desconocido devuelve null en vez de romper el CTA", () => {
  assert.equal(paymentUrlForPlan("inexistente" as PlanKey), null);
});
