// Dominio desarrollo del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request } from "./client";
import type { DigitalProject, DigitalProjectInput, DigitalProjectUpdate, DigitalTask } from "./types";

export const desarrolloApi = {
  // ---------- Desarrollo digital ----------
  listDigitalProjects: () =>
    request<DigitalProject[]>("/api/desarrollo/projects", { auth: true }),
  createDigitalProject: (body: DigitalProjectInput) =>
    request<DigitalProject>("/api/desarrollo/projects", { method: "POST", auth: true, body }),
  updateDigitalProject: (id: number, body: DigitalProjectUpdate) =>
    request<DigitalProject>(`/api/desarrollo/projects/${id}`, { method: "PUT", auth: true, body }),
  deleteDigitalProject: (id: number) =>
    request<void>(`/api/desarrollo/projects/${id}`, { method: "DELETE", auth: true }),
  listDigitalTasks: (projectId: number) =>
    request<DigitalTask[]>(`/api/desarrollo/projects/${projectId}/tasks`, { auth: true }),
  createDigitalTask: (projectId: number, body: { title: string }) =>
    request<DigitalTask>(`/api/desarrollo/projects/${projectId}/tasks`, { method: "POST", auth: true, body }),
  updateDigitalTask: (id: number, body: { title?: string; done?: boolean }) =>
    request<DigitalTask>(`/api/desarrollo/tasks/${id}`, { method: "PATCH", auth: true, body }),
  deleteDigitalTask: (id: number) =>
    request<void>(`/api/desarrollo/tasks/${id}`, { method: "DELETE", auth: true }),

  // ---------- Tendencias ----------,
};
