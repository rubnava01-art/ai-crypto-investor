// Dominio auditor del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request } from "./client";
import type { WebAudit } from "./types";

export const auditorApi = {
  // ---------- Auditor web ----------
  runWebAudit: (url: string) =>
    request<WebAudit>("/api/auditor/audits", { method: "POST", auth: true, body: { url } }),

  // ---------- Analizador IA ----------,
  listWebAudits: () => request<WebAudit[]>("/api/auditor/audits", { auth: true }),

  // ---------- Privacidad y cumplimiento ----------,
};
