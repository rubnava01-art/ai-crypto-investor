// Dominio tendencias del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request } from "./client";
import type { TrendResearch, TrendSearch } from "./types";

export const tendenciasApi = {
  // ---------- Tendencias ----------
  researchTrends: (keyword: string) =>
    request<TrendResearch>(`/api/tendencias/research?keyword=${encodeURIComponent(keyword)}`, { auth: true }),
  listTrendSearches: () => request<TrendSearch[]>("/api/tendencias/searches", { auth: true }),

  // ---------- Auditor web ----------,
};
