// Buscador global (Fase 4 mejoras-v1, tarea 4): pruebas de la lógica
// pura (sin React ni red).
import test from "node:test";
import assert from "node:assert/strict";
import { filtrarBuscador, normalizarBuscador, type BuscadorItem } from "./buscador";

const items: BuscadorItem[] = [
  { id: "m-crm", kind: "modulo", titulo: "Gestor de Clientes", descripcion: "Contactos y clientes", href: "/crm" },
  { id: "m-facturas", kind: "modulo", titulo: "Facturas", descripcion: "Facturas y materiales", href: "/facturas" },
  { id: "a-contacto", kind: "accion", titulo: "Crear contacto", descripcion: "Nuevo contacto en el CRM", href: "/crm" },
  { id: "m-analisis", kind: "modulo", titulo: "Análisis de datos", descripcion: "Datos del negocio", href: "/analisis" },
];

test("normalizarBuscador quita acentos y mayúsculas", () => {
  assert.equal(normalizarBuscador("Análisis"), "analisis");
  assert.equal(normalizarBuscador("Gestión"), "gestion");
});

test("consulta vacía devuelve todo en el mismo orden", () => {
  assert.deepEqual(filtrarBuscador(items, ""), items);
  assert.deepEqual(filtrarBuscador(items, "   "), items);
});

test("un token filtra por título o descripción", () => {
  assert.deepEqual(
    filtrarBuscador(items, "factura").map((i) => i.id),
    ["m-facturas"],
  );
  assert.deepEqual(
    filtrarBuscador(items, "clientes").map((i) => i.id),
    ["m-crm"],
  );
});

test("todos los tokens deben aparecer (AND)", () => {
  assert.deepEqual(
    filtrarBuscador(items, "crear contacto").map((i) => i.id),
    ["a-contacto"],
  );
  assert.deepEqual(filtrarBuscador(items, "crear factura"), []);
});

test("ignora acentos en la consulta", () => {
  assert.deepEqual(
    filtrarBuscador(items, "analisis").map((i) => i.id),
    ["m-analisis"],
  );
});

test("el título que empieza por la consulta va primero", () => {
  const res = filtrarBuscador(items, "contacto");
  assert.equal(res[0].id, "a-contacto");
});
