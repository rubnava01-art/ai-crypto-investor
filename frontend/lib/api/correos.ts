// Dominio correos del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request } from "./client";
import { catalogMemo } from "./memo";
import type { EmailLog, EmailLogStatus, EmailTemplate } from "./types";

export const correosApi = {
  // Plantillas casi estáticas (2026-11-23): las crea/borra solo el
  // admin y el backend ya las marca Cache-Control private max-age=60
  // (2026-11-19); memo 60 s en cliente como Facturas/Tendencias, con
  // la ruta completa (con limit/offset) como clave para que cada página
  // tenga su propia entrada. Crear/borrar invalida el prefijo, así que
  // tras guardar nunca se muestra la lista vieja (el panel además
  // recarga tras cada mutación).
  // La señal del llamador (useAsyncLoad al desmontar) NO se pasa al
  // fetch memoizado: la petición en vuelo es compartida y abortarla
  // un consumidor dejaría a los demás sin datos; el hook ya evita
  // escribir tras desmontar con su guarda `cancelled`.
  listEmailTemplates: (opts?: { signal?: AbortSignal; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.offset != null) params.set("offset", String(opts.offset));
    const qs = params.toString();
    const path = `/api/correos/templates${qs ? `?${qs}` : ""}`;
    return catalogMemo.get<EmailTemplate[]>(path, () =>
      request<EmailTemplate[]>(path, { auth: true, retry: true }),
    );
  },
  createEmailTemplate: (body: { name: string; subject?: string; body?: string }) =>
    request<EmailTemplate>("/api/correos/templates", { method: "POST", auth: true, body }).then((res) => {
      catalogMemo.invalidate("/api/correos/templates");
      return res;
    }),
  deleteEmailTemplate: (id: number) =>
    request<void>(`/api/correos/templates/${id}`, { method: "DELETE", auth: true }).then((res) => {
      catalogMemo.invalidate("/api/correos/templates");
      return res;
    }),
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
