// Dominio recomendaciones del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request } from "./client";
import { catalogMemo } from "./memo";
import type { Recommendation, RecommendationInput } from "./types";

export const recomendacionesApi = {
  // ---------- Recomendaciones ----------
  // Catálogo casi estático (P1, 2026-11-17): memo 60 s en cliente, como
  // Academia/Clases. Las mutaciones invalidan el prefijo.
  listRecommendations: () =>
    catalogMemo.get<Recommendation[]>("/api/recomendaciones", () =>
      request<Recommendation[]>("/api/recomendaciones", { auth: true }),
    ),
  createRecommendation: (body: RecommendationInput) =>
    request<Recommendation>("/api/recomendaciones", { method: "POST", auth: true, body }).then((res) => {
      catalogMemo.invalidate("/api/recomendaciones");
      return res;
    }),
  updateRecommendation: (id: number, body: Partial<RecommendationInput>) =>
    request<Recommendation>(`/api/recomendaciones/${id}`, { method: "PUT", auth: true, body }).then((res) => {
      catalogMemo.invalidate("/api/recomendaciones");
      return res;
    }),
  deleteRecommendation: (id: number) =>
    request<void>(`/api/recomendaciones/${id}`, { method: "DELETE", auth: true }).then((res) => {
      catalogMemo.invalidate("/api/recomendaciones");
      return res;
    }),

  // ---------- Inicio: noticias y comentarios ----------,
};
