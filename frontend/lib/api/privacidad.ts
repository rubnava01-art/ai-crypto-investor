// Dominio privacidad del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request } from "./client";
import type { ComplianceItem, ComplianceItemInput } from "./types";

export const privacidadApi = {
  // ---------- Privacidad y cumplimiento ----------
  listComplianceItems: () =>
    request<ComplianceItem[]>("/api/privacidad/items", { auth: true }),
  createComplianceItem: (body: ComplianceItemInput) =>
    request<ComplianceItem>("/api/privacidad/items", { method: "POST", auth: true, body }),
  updateComplianceItem: (id: number, body: Partial<ComplianceItemInput>) =>
    request<ComplianceItem>(`/api/privacidad/items/${id}`, { method: "PUT", auth: true, body }),
  deleteComplianceItem: (id: number) =>
    request<void>(`/api/privacidad/items/${id}`, { method: "DELETE", auth: true }),
};
