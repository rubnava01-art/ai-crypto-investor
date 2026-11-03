// Dominio espacio del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request } from "./client";
import type { EmotionEntry, Revelation } from "./types";

export const espacioApi = {
  listRevelations: () => request<Revelation[]>("/api/espacio/revelations", { auth: true }),
  createRevelation: (body: { title: string; text?: string }) =>
    request<Revelation>("/api/espacio/revelations", { method: "POST", auth: true, body }),
  deleteRevelation: (id: number) =>
    request<void>(`/api/espacio/revelations/${id}`, { method: "DELETE", auth: true }),
  listEmotions: () => request<EmotionEntry[]>("/api/espacio/emotions", { auth: true }),
  createEmotion: (body: { emotion: string; intensity: number; note?: string }) =>
    request<EmotionEntry>("/api/espacio/emotions", { method: "POST", auth: true, body }),
  updateEmotion: (id: number, body: { emotion: string; intensity: number; note?: string }) =>
    request<EmotionEntry>(`/api/espacio/emotions/${id}`, { method: "PUT", auth: true, body }),
  deleteEmotion: (id: number) =>
    request<void>(`/api/espacio/emotions/${id}`, { method: "DELETE", auth: true }),
};
