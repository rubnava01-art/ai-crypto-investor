// Dominio recomendaciones del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request } from "./client";
import type { Recommendation, RecommendationInput } from "./types";

export const recomendacionesApi = {
  // ---------- Recomendaciones ----------
  listRecommendations: () =>
    request<Recommendation[]>("/api/recomendaciones", { auth: true }),
  createRecommendation: (body: RecommendationInput) =>
    request<Recommendation>("/api/recomendaciones", { method: "POST", auth: true, body }),
  updateRecommendation: (id: number, body: Partial<RecommendationInput>) =>
    request<Recommendation>(`/api/recomendaciones/${id}`, { method: "PUT", auth: true, body }),
  deleteRecommendation: (id: number) =>
    request<void>(`/api/recomendaciones/${id}`, { method: "DELETE", auth: true }),

  // ---------- Inicio: noticias y comentarios ----------,
};
