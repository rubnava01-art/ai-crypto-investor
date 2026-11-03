// Dominio clases del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request } from "./client";
import type { EduClass, EduClassKind } from "./types";

export const clasesApi = {
  listClasses: (kind?: EduClassKind) =>
    request<EduClass[]>(`/api/clases/classes${kind ? `?kind=${kind}` : ""}`, { auth: true }),
  createClass: (body: { kind: EduClassKind; title: string; description?: string; url?: string; scheduled_at?: string | null; duration_min?: number | null }) =>
    request<EduClass>("/api/clases/classes", { method: "POST", auth: true, body }),
  deleteClass: (id: number) =>
    request<void>(`/api/clases/classes/${id}`, { method: "DELETE", auth: true }),
};
