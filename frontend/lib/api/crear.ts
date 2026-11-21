// Dominio crear del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request, AI_TIMEOUT_MS } from "./client";
import { catalogMemo } from "./memo";
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
  // Tendencias casi estáticas (2026-11-21): notas curadas por el admin;
  // memo 60 s en cliente como Academia/Clases/Videos, y el backend las
  // marca Cache-Control private max-age=60. Crear/borrar invalida el
  // prefijo, así que tras guardar nunca se muestra la lista vieja.
  listTrends: () =>
    catalogMemo.get<TrendNote[]>("/api/crear/trends", () =>
      request<TrendNote[]>("/api/crear/trends", { auth: true }),
    ),
  createTrend: (body: { title: string; source?: string; summary?: string; published_on?: string | null }) =>
    request<TrendNote>("/api/crear/trends", { method: "POST", auth: true, body }).then((res) => {
      catalogMemo.invalidate("/api/crear/trends");
      return res;
    }),
  deleteTrend: (id: number) =>
    request<void>(`/api/crear/trends/${id}`, { method: "DELETE", auth: true }).then((res) => {
      catalogMemo.invalidate("/api/crear/trends");
      return res;
    }),
};
