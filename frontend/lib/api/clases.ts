// Dominio clases del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request } from "./client";
import { catalogMemo } from "./memo";
import type { EduClass, EduClassKind } from "./types";

export const clasesApi = {
  // Catálogo casi estático (2026-11-17): memo 60 s en cliente, mismo
  // patrón que listCourses — cada sección (grabada/envivo) pedía el
  // listado al montar y al navegar de vuelta. create/delete invalidan.
  listClasses: (kind?: EduClassKind) => {
    const path = `/api/clases/classes${kind ? `?kind=${kind}` : ""}`;
    return catalogMemo.get<EduClass[]>(path, () => request<EduClass[]>(path, { auth: true }));
  },
  createClass: (body: { kind: EduClassKind; title: string; description?: string; url?: string; scheduled_at?: string | null; duration_min?: number | null }) =>
    request<EduClass>("/api/clases/classes", { method: "POST", auth: true, body }).then((res) => {
      catalogMemo.invalidate("/api/clases/classes");
      return res;
    }),
  deleteClass: (id: number) =>
    request<void>(`/api/clases/classes/${id}`, { method: "DELETE", auth: true }).then((res) => {
      catalogMemo.invalidate("/api/clases/classes");
      return res;
    }),
};
