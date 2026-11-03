// Dominio inventario del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request } from "./client";
import type { InventoryItem, InventoryItemInput } from "./types";

export const inventarioApi = {
  // ---------- Inventario ----------
  listInventoryItems: () => request<InventoryItem[]>("/api/inventario/items", { auth: true }),
  createInventoryItem: (body: InventoryItemInput) =>
    request<InventoryItem>("/api/inventario/items", { method: "POST", auth: true, body }),
  updateInventoryItem: (id: number, body: Partial<InventoryItemInput>) =>
    request<InventoryItem>(`/api/inventario/items/${id}`, { method: "PUT", auth: true, body }),
  deleteInventoryItem: (id: number) =>
    request<void>(`/api/inventario/items/${id}`, { method: "DELETE", auth: true }),

  // ---------- Desarrollo digital ----------,
};
