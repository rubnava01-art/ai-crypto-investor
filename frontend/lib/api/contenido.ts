// Dominio contenido del API (NEST, 2026-11-17): Nest Content Engine.
// Reutiliza sin cambios los endpoints de Crear (copies + tendencias); las
// plantillas se generan POR REGLAS en el servidor (source "plantilla"),
// nunca con el modelo de IA.
import { request } from "./client";
import type {
  BrandBrief, BrandBriefInput, BrandBriefSummary, ContentIdea, ContentIdeaInput, ContentIdeaStatus, ContentItem, ContentItemInput,
  ContentItemUpdate, ContentTemplate, ContentTemplateInput, TemplateGeneration,
} from "./types";

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const contenidoApi = {
  // ---------- Ideas ----------
  listIdeas: (
    filters?: { status?: ContentIdeaStatus; contact_id?: number },
    opts?: { signal?: AbortSignal },
  ) =>
    request<ContentIdea[]>(
      `/api/business/marketing/contenido/ideas${qs({
        status: filters?.status,
        contact_id: filters?.contact_id !== undefined ? String(filters.contact_id) : undefined,
      })}`,
      { auth: true, retry: true, signal: opts?.signal },
    ),
  createIdea: (body: ContentIdeaInput) =>
    request<ContentIdea>("/api/business/marketing/contenido/ideas", { method: "POST", auth: true, body }),
  updateIdea: (id: number, body: Partial<ContentIdeaInput>) =>
    request<ContentIdea>(`/api/business/marketing/contenido/ideas/${id}`, { method: "PUT", auth: true, body }),
  deleteIdea: (id: number) =>
    request<void>(`/api/business/marketing/contenido/ideas/${id}`, { method: "DELETE", auth: true }),

  // ---------- Plantillas (reglas, no IA) ----------
  listTemplates: (opts?: { signal?: AbortSignal }) =>
    request<ContentTemplate[]>("/api/business/marketing/contenido/plantillas", {
      auth: true, retry: true, signal: opts?.signal,
    }),
  createTemplate: (body: ContentTemplateInput) =>
    request<ContentTemplate>("/api/business/marketing/contenido/plantillas", { method: "POST", auth: true, body }),
  updateTemplate: (id: number, body: Partial<ContentTemplateInput>) =>
    request<ContentTemplate>(`/api/business/marketing/contenido/plantillas/${id}`, { method: "PUT", auth: true, body }),
  deleteTemplate: (id: number) =>
    request<void>(`/api/business/marketing/contenido/plantillas/${id}`, { method: "DELETE", auth: true }),
  generateFromTemplate: (body: { template_id: number; variables: { tema: string; negocio?: string; llamada?: string } }) =>
    request<TemplateGeneration>("/api/business/marketing/contenido/generar-desde-plantilla", {
      method: "POST", auth: true, body,
    }),

  // ---------- Calendario de contenido ----------
  listCalendar: (
    range: { from: string; to: string },
    filters?: { platform?: string; status?: string },
    opts?: { signal?: AbortSignal },
  ) =>
    request<ContentItem[]>(
      `/api/business/marketing/contenido/calendario${qs({
        from: range.from, to: range.to,
        platform: filters?.platform, status: filters?.status,
      })}`,
      { auth: true, retry: true, signal: opts?.signal },
    ),
  createCalendarItem: (body: ContentItemInput) =>
    request<ContentItem>("/api/business/marketing/contenido/calendario", { method: "POST", auth: true, body }),
  updateCalendarItem: (id: number, body: ContentItemUpdate) =>
    request<ContentItem>(`/api/business/marketing/contenido/calendario/${id}`, { method: "PATCH", auth: true, body }),
  deleteCalendarItem: (id: number) =>
    request<void>(`/api/business/marketing/contenido/calendario/${id}`, { method: "DELETE", auth: true }),

  // ---------- Brief de marca (test exprés, solo admin) ----------
  listBriefs: (opts?: { signal?: AbortSignal }) =>
    request<BrandBriefSummary[]>("/api/business/marketing/contenido/briefs", {
      auth: true, retry: true, signal: opts?.signal,
    }),
  getBrief: (contactId: number, opts?: { signal?: AbortSignal }) =>
    request<BrandBrief>(`/api/business/marketing/contenido/briefs/${contactId}`, {
      auth: true, retry: true, signal: opts?.signal,
    }),
  saveBrief: (contactId: number, body: BrandBriefInput) =>
    request<BrandBrief>(`/api/business/marketing/contenido/briefs/${contactId}`, {
      method: "PUT", auth: true, body,
    }),
};
