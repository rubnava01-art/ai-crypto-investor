// Dominio crm del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request, API_URL, getToken } from "./client";
import type { CrmContact, CrmContactInput, CrmImportResult, CrmReminder, CrmResumen, CrmStage, CrmStageHistory } from "./types";

// Descarga autenticada de un CSV (Fase 5b, tarea 1): el token Bearer no
// viaja en un <a href>, así que se pide con fetch y se entrega como blob.
async function downloadCsv(path: string, filename: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`CSV download failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const crmApi = {
  getCrmResumen: () =>
    request<CrmResumen>("/api/crm/contacts/resumen", { auth: true, retry: true }),
  listContacts: (q?: string, status?: string, stage?: string, opts?: { signal?: AbortSignal }) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (stage) params.set("stage", stage);
    const qs = params.toString();
    return request<CrmContact[]>(`/api/crm/contacts${qs ? `?${qs}` : ""}`, { auth: true, retry: true, signal: opts?.signal });
  },
  createContact: (body: CrmContactInput) =>
    request<CrmContact>("/api/crm/contacts", { method: "POST", auth: true, body }),
  updateContact: (id: number, body: CrmContactInput) =>
    request<CrmContact>(`/api/crm/contacts/${id}`, { method: "PUT", auth: true, body }),
  deleteContact: (id: number) =>
    request<void>(`/api/crm/contacts/${id}`, { method: "DELETE", auth: true }),

  // ---------- Etapas de venta (Fase 5b mejoras-v1, tarea 1) ----------
  // Cambio rápido de etapa: PUT parcial (solo stage); el backend
  // registra el cambio en el historial solo si la etapa cambia.
  updateContactStage: (id: number, stage: CrmStage) =>
    request<CrmContact>(`/api/crm/contacts/${id}`, { method: "PUT", auth: true, body: { stage } }),
  getStageHistory: (id: number) =>
    request<CrmStageHistory[]>(`/api/crm/contacts/${id}/historial`, { auth: true, retry: true }),

  // ---------- Recordatorios ----------
  listReminders: (contactId: number) =>
    request<CrmReminder[]>(`/api/crm/contacts/${contactId}/recordatorios`, { auth: true, retry: true }),
  createReminder: (contactId: number, body: { remind_date: string; note?: string }) =>
    request<CrmReminder>(`/api/crm/contacts/${contactId}/recordatorios`, { method: "POST", auth: true, body }),
  updateReminder: (id: number, body: { remind_date?: string; note?: string; done?: boolean }) =>
    request<CrmReminder>(`/api/crm/contacts/recordatorios/${id}`, { method: "PATCH", auth: true, body }),
  deleteReminder: (id: number) =>
    request<void>(`/api/crm/contacts/recordatorios/${id}`, { method: "DELETE", auth: true }),

  // ---------- CSV: plantilla, exportar, importar ----------
  // La importación envía el texto del archivo tal cual (text/csv): sin
  // multipart, porque python-multipart no es dependencia del backend.
  downloadTemplate: () => downloadCsv("/api/crm/contacts/plantilla", "contactos-plantilla.csv"),
  exportContacts: () => downloadCsv("/api/crm/contacts/export", "contactos.csv"),
  importContacts: async (csvText: string): Promise<CrmImportResult> => {
    const token = getToken();
    const res = await fetch(`${API_URL}/api/crm/contacts/import`, {
      method: "POST",
      headers: {
        "Content-Type": "text/csv",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: csvText,
    });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).detail ?? ""; } catch { /* sin detalle */ }
      throw new Error(detail || `CSV import failed: ${res.status}`);
    }
    return (await res.json()) as CrmImportResult;
  },
};
