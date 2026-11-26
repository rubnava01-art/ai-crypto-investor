// Dominio clases del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request } from "./client";
import { catalogMemo } from "./memo";
import type {
  CertificateOut,
  EduClass,
  EduClassKind,
  EduProgress,
  QuizOut,
  QuizQuestionAdmin,
  QuizResult,
} from "./types";

export const clasesApi = {
  // Catálogo casi estático (2026-11-17): memo 60 s en cliente, mismo
  // patrón que listCourses — cada sección (grabada/envivo) pedía el
  // listado al montar y al navegar de vuelta. create/delete invalidan.
  listClasses: (kind?: EduClassKind) => {
    const path = `/api/clases/classes${kind ? `?kind=${kind}` : ""}`;
    return catalogMemo.get<EduClass[]>(path, () => request<EduClass[]>(path, { auth: true }));
  },
  // Progreso propio (Fase 5a, tarea 4): SIN memo — cambia con cada
  // marca y el resumen debe reflejarlo al instante.
  getProgress: () => request<EduProgress>("/api/clases/progress", { auth: true }),
  completeClass: (id: number) =>
    request<EduProgress>(`/api/clases/classes/${id}/complete`, { method: "POST", auth: true }),
  uncompleteClass: (id: number) =>
    request<EduProgress>(`/api/clases/classes/${id}/complete`, { method: "DELETE", auth: true }),
  // Quiz corto por clase (Fase 5a, tarea 5): sin memo — las preguntas
  // las gestiona el admin y el resultado es por intento.
  getQuiz: (id: number) => request<QuizOut>(`/api/clases/classes/${id}/quiz`, { auth: true }),
  submitQuiz: (id: number, answers: Record<number, number>) =>
    request<QuizResult>(`/api/clases/classes/${id}/quiz/submit`, {
      method: "POST",
      auth: true,
      body: { answers },
    }),
  listQuizQuestions: (id: number) =>
    request<QuizQuestionAdmin[]>(`/api/clases/classes/${id}/quiz/questions`, { auth: true }),
  createQuizQuestion: (
    id: number,
    body: { question: string; options: string[]; correct_index: number; explanation?: string; source: string },
  ) =>
    request<QuizQuestionAdmin>(`/api/clases/classes/${id}/quiz/questions`, {
      method: "POST",
      auth: true,
      body,
    }),
  deleteQuizQuestion: (id: number, questionId: number) =>
    request<void>(`/api/clases/classes/${id}/quiz/questions/${questionId}`, {
      method: "DELETE",
      auth: true,
    }),
  // Certificado de finalización (Fase 5a, tarea 6): solo existe al
  // completar el 100 % de un recorrido; si no, completed=false.
  getCertificate: (kind: EduClassKind) =>
    request<CertificateOut>(`/api/clases/certificates/${kind}`, { auth: true }),
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
