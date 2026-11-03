// Dominio academy del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request, getToken, fetchTimed, API_URL, errorDetail, handleUnauthorized, ApiError, DEFAULT_TIMEOUT_MS, uiLang } from "./client";
import type { AcademyCourse, AcademyEnrollment, CourseKind } from "./types";

export const academyApi = {
  listCourses: () => request<AcademyCourse[]>("/api/academy/courses", { auth: true }),
  updateCourse: (
    id: number,
    body: { title?: string; description?: string; price_usd?: string; kind?: CourseKind; buy_url?: string; delivery_note?: string },
  ) => request<AcademyCourse>(`/api/academy/courses/${id}`, { method: "PUT", auth: true, body }),
  listStudents: (courseId: number) =>
    request<AcademyEnrollment[]>(`/api/academy/courses/${courseId}/students`, { auth: true }),
  createEnrollment: (body: { contact_id: number; course_id: number; purchased?: boolean; delivered?: boolean; notes?: string }) =>
    request<AcademyEnrollment>("/api/academy/enrollments", { method: "POST", auth: true, body }),
  updateEnrollment: (id: number, body: { purchased?: boolean; delivered?: boolean; notes?: string }) =>
    request<AcademyEnrollment>(`/api/academy/enrollments/${id}`, { method: "PATCH", auth: true, body }),
  deleteEnrollment: (id: number) =>
    request<void>(`/api/academy/enrollments/${id}`, { method: "DELETE", auth: true }),

  // Descarga de un PDF real de la Academia: fetch con el token guardado ->
  // blob -> descarga del navegador (el endpoint exige autenticación).,
  // Descarga de un PDF real de la Academia: fetch con el token guardado ->
  // blob -> descarga del navegador (el endpoint exige autenticación).
  downloadCoursePdf: async (courseId: number, filename: string): Promise<void> => {
    const token = getToken();
    const path = `/api/academy/courses/${courseId}/download`;
    const res = await fetchTimed(
      `${API_URL}${path}`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: "no-store",
      },
      DEFAULT_TIMEOUT_MS,
      path,
    );
    if (!res.ok) {
      if (res.status === 401) handleUnauthorized();
      const detail = await errorDetail(res);
      throw new ApiError(
        res.status,
        detail ||
          (uiLang() === "en"
            ? `Could not download the PDF (${res.status})`
            : `No se pudo descargar el PDF (${res.status})`),
        { detail: detail || undefined },
      );
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
