// Dominio analizador del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request } from "./client";
import type { AnalizarResponse } from "./types";

export const analizadorApi = {
  // ---------- Analizador IA ----------
  analizarUrl: (url: string) =>
    request<AnalizarResponse>("/api/analizador/analizar", { method: "POST", auth: true, body: { url } }),
};
