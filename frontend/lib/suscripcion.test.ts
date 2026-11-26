// Tests del aviso de fin de prueba en la app (Fase 7 mejoras-v1,
// tarea 3): la lógica pura de lib/suscripcion.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { mostrarAvisoPrueba } from "./suscripcion";
import type { Suscripcion } from "./api/types";

function sub(overrides: Partial<Suscripcion>): Suscripcion {
  return {
    id: 1,
    user_id: 1,
    plan: "esencial",
    plan_nombre: "Esencial",
    precio_mensual_usd: 19,
    estado: "prueba_activa",
    estado_efectivo: "prueba_activa",
    acceso_activo: true,
    prueba_inicio: null,
    prueba_fin: null,
    renovacion_en: null,
    cancelada_en: null,
    acceso_hasta: null,
    dias_restantes_prueba: 2,
    creado_en: null,
    actualizado_en: null,
    ...overrides,
  };
}

test("prueba que vence en 2 días: aviso", () => {
  assert.equal(mostrarAvisoPrueba(sub({ dias_restantes_prueba: 2 })), true);
});

test("prueba que vence en 3 días (frontera H3-2): aviso", () => {
  assert.equal(mostrarAvisoPrueba(sub({ dias_restantes_prueba: 3 })), true);
});

test("prueba que vence en 4 días (fuera de la frontera H3-2): sin aviso", () => {
  assert.equal(mostrarAvisoPrueba(sub({ dias_restantes_prueba: 4 })), false);
});

test("prueba que vence en 10 días: sin aviso", () => {
  assert.equal(mostrarAvisoPrueba(sub({ dias_restantes_prueba: 10 })), false);
});

test("prueba ya vencida (estado efectivo vencida): sin aviso de pronto", () => {
  assert.equal(
    mostrarAvisoPrueba(
      sub({ estado: "prueba_activa", estado_efectivo: "vencida", dias_restantes_prueba: -1 }),
    ),
    false,
  );
});

test("prueba cancelada: sin aviso", () => {
  assert.equal(
    mostrarAvisoPrueba(
      sub({ estado: "cancelada", estado_efectivo: "cancelada", dias_restantes_prueba: 2 }),
    ),
    false,
  );
});

test("sin suscripción: sin aviso", () => {
  assert.equal(mostrarAvisoPrueba(null), false);
});
