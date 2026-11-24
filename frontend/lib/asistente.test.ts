// F2-8 (chat-potencia 2026-11-24): las sugerencias del backend se
// normalizan — formato nuevo (objeto con requiere_admin) y formato
// antiguo (string plano) conviven; las inválidas se ignoran.
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSugerencias } from "./asistente";

test("normalizeSugerencias: strings antiguos pasan sin marca", () => {
  assert.deepEqual(normalizeSugerencias(["Crea una factura", "Ver clientes"]), [
    { label: "Crea una factura" },
    { label: "Ver clientes" },
  ]);
});

test("normalizeSugerencias: objetos conservan requiere_admin", () => {
  assert.deepEqual(
    normalizeSugerencias([
      { label: "Crea una factura", requiere_admin: true },
      { label: "Ver clientes", requiere_admin: false },
    ]),
    [
      { label: "Crea una factura", requiere_admin: true },
      { label: "Ver clientes", requiere_admin: false },
    ],
  );
});

test("normalizeSugerencias: mezcla de formatos y entradas inválidas", () => {
  assert.deepEqual(
    normalizeSugerencias(["  ", { label: "  " }, null, "Ver ventas"] as never),
    [{ label: "Ver ventas" }],
  );
});

test("normalizeSugerencias: null o undefined devuelven lista vacía", () => {
  assert.deepEqual(normalizeSugerencias(null), []);
  assert.deepEqual(normalizeSugerencias(undefined), []);
});
