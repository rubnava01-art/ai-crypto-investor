// Dominio crm del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request } from "./client";
import type { CrmContact, CrmContactInput } from "./types";

export const crmApi = {
  listContacts: (q?: string, status?: string, opts?: { signal?: AbortSignal }) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    const qs = params.toString();
    return request<CrmContact[]>(`/api/crm/contacts${qs ? `?${qs}` : ""}`, { auth: true, retry: true, signal: opts?.signal });
  },
  createContact: (body: CrmContactInput) =>
    request<CrmContact>("/api/crm/contacts", { method: "POST", auth: true, body }),
  updateContact: (id: number, body: CrmContactInput) =>
    request<CrmContact>(`/api/crm/contacts/${id}`, { method: "PUT", auth: true, body }),
  deleteContact: (id: number) =>
    request<void>(`/api/crm/contacts/${id}`, { method: "DELETE", auth: true }),
};
