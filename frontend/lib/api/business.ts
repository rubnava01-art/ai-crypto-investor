// Dominio business del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request } from "./client";
import type { BusinessArea, BusinessNote, BusinessNotificaciones, BusinessTask } from "./types";

export const businessApi = {
  // Notificaciones en la app (Fase 5b mejoras-v1, tarea 5): tareas no
  // hechas que vencen hoy o ya vencieron, en todas las áreas. NO hay
  // notificación por correo: PENDIENTE del proveedor (ver business.py).
  listNotificaciones: () =>
    request<BusinessNotificaciones>("/api/business/notificaciones", { auth: true, retry: true }),
  listBusinessNotes: (area: BusinessArea) =>
    request<BusinessNote[]>(`/api/business/${area}/notes`, { auth: true }),
  createBusinessNote: (area: BusinessArea, body: { title: string; body?: string }) =>
    request<BusinessNote>(`/api/business/${area}/notes`, { method: "POST", auth: true, body }),
  updateBusinessNote: (id: number, body: { title?: string; body?: string }) =>
    request<BusinessNote>(`/api/business/notes/${id}`, { method: "PUT", auth: true, body }),
  deleteBusinessNote: (id: number) =>
    request<void>(`/api/business/notes/${id}`, { method: "DELETE", auth: true }),
  listBusinessTasks: (area: BusinessArea) =>
    request<BusinessTask[]>(`/api/business/${area}/tasks`, { auth: true }),
  createBusinessTask: (area: BusinessArea, body: { title: string; due_date?: string | null }) =>
    request<BusinessTask>(`/api/business/${area}/tasks`, { method: "POST", auth: true, body }),
  updateBusinessTask: (id: number, body: { title?: string; done?: boolean; due_date?: string | null }) =>
    request<BusinessTask>(`/api/business/tasks/${id}`, { method: "PATCH", auth: true, body }),
  deleteBusinessTask: (id: number) =>
    request<void>(`/api/business/tasks/${id}`, { method: "DELETE", auth: true }),

  // ---------- Perfil (paquete 2026-10-28) ----------,
};
