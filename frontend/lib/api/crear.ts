// Dominio crear del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request, AI_TIMEOUT_MS } from "./client";
import type { CopyDraft, CopyPlatform, CopyTone, TrendNote } from "./types";

export const crearApi = {
  generateCopy: (body: { topic: string; platform: CopyPlatform; tone: CopyTone }) =>
    request<CopyDraft>("/api/crear/copies/generate", {
      method: "POST",
      auth: true,
      body,
      timeoutMs: AI_TIMEOUT_MS,
    }),
  listCopies: () => request<CopyDraft[]>("/api/crear/copies", { auth: true }),
  deleteCopy: (id: number) =>
    request<void>(`/api/crear/copies/${id}`, { method: "DELETE", auth: true }),
  listTrends: () => request<TrendNote[]>("/api/crear/trends", { auth: true }),
  createTrend: (body: { title: string; source?: string; summary?: string; published_on?: string | null }) =>
    request<TrendNote>("/api/crear/trends", { method: "POST", auth: true, body }),
  deleteTrend: (id: number) =>
    request<void>(`/api/crear/trends/${id}`, { method: "DELETE", auth: true }),
};
