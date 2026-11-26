// Dominio inventario del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request } from "./client";
import { catalogMemo } from "./memo";
import type { InventoryItem, InventoryItemInput, InventoryMovement } from "./types";

export const inventarioApi = {
  // Lista casi estática (2026-11-25): la lista de stock es la misma
  // para todos los lectores (cualquier usuario autenticado lee; solo
  // el admin escribe) y cada visita a Inventario volvía a pedirla;
  // memo 60 s en cliente como Facturas/Talento/Riesgos/Planillas, y el
  // backend la marca Cache-Control private max-age=60. Crear, editar
  // (incluido el ajuste +/-1, que usa update) y borrar invalidan el
  // prefijo, así que tras guardar nunca se muestra la lista vieja (el
  // panel además recarga tras cada mutación).
  listInventoryItems: () =>
    catalogMemo.get<InventoryItem[]>("/api/inventario/items", () =>
      request<InventoryItem[]>("/api/inventario/items", { auth: true, retry: true }),
    ),
  createInventoryItem: (body: InventoryItemInput) =>
    request<InventoryItem>("/api/inventario/items", { method: "POST", auth: true, body }).then((res) => {
      catalogMemo.invalidate("/api/inventario/items");
      return res;
    }),
  updateInventoryItem: (id: number, body: Partial<InventoryItemInput>) =>
    request<InventoryItem>(`/api/inventario/items/${id}`, { method: "PUT", auth: true, body }).then((res) => {
      catalogMemo.invalidate("/api/inventario/items");
      return res;
    }),
  deleteInventoryItem: (id: number) =>
    request<void>(`/api/inventario/items/${id}`, { method: "DELETE", auth: true }).then((res) => {
      catalogMemo.invalidate("/api/inventario/items");
      return res;
    }),

  // ---------- Historial de movimientos (Fase 5b mejoras-v1, tarea 3) ----------
  // El ajuste +/-1 del panel usa addMovement (queda registrado con su
  // motivo) en vez del PUT de cantidad, que no dejaba rastro.
  listMovements: (itemId: number) =>
    request<InventoryMovement[]>(`/api/inventario/items/${itemId}/movimientos`, { auth: true, retry: true }),
  addMovement: (itemId: number, body: { tipo: "entrada" | "venta" | "ajuste"; cantidad: number; motivo?: string }) =>
    request<InventoryMovement>(`/api/inventario/items/${itemId}/movimientos`, { method: "POST", auth: true, body }).then((res) => {
      catalogMemo.invalidate("/api/inventario/items");
      return res;
    }),

  // ---------- Desarrollo digital ----------,
};
