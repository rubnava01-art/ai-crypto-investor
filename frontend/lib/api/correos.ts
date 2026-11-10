// Dominio correos del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request } from "./client";
import type { EmailLog, EmailLogStatus, EmailTemplate } from "./types";

export const correosApi = {
  listEmailTemplates: (opts?: { signal?: AbortSignal; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.offset != null) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return request<EmailTemplate[]>(`/api/correos/templates${qs ? `?${qs}` : ""}`, { auth: true, retry: true, signal: opts?.signal });
  },
  createEmailTemplate: (body: { name: string; subject?: string; body?: string }) =>
    request<EmailTemplate>("/api/correos/templates", { method: "POST", auth: true, body }),
  deleteEmailTemplate: (id: number) =>
    request<void>(`/api/correos/templates/${id}`, { method: "DELETE", auth: true }),
  listEmailLogs: (opts?: { signal?: AbortSignal; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.offset != null) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return request<EmailLog[]>(`/api/correos/logs${qs ? `?${qs}` : ""}`, { auth: true, retry: true, signal: opts?.signal });
  },
  createEmailLog: (body: { contact_id?: number | null; contact_name: string; contact_email?: string; template_name?: string; subject?: string; body?: string }) =>
    request<EmailLog>("/api/correos/logs", { method: "POST", auth: true, body }),
  updateEmailLogStatus: (id: number, status: EmailLogStatus) =>
    request<EmailLog>(`/api/correos/logs/${id}`, { method: "PATCH", auth: true, body: { status } }),
  deleteEmailLog: (id: number) =>
    request<void>(`/api/correos/logs/${id}`, { method: "DELETE", auth: true }),
};
