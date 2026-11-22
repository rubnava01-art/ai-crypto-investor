// Dominio users del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request } from "./client";
import type { AdminUser, RegisterChallenge } from "./types";

export const usersApi = {
  listUsers: () => request<AdminUser[]>("/api/users", { auth: true }),
  createUser: (username: string, password: string, role: "admin" | "prueba" | "super_admin") =>
    request<AdminUser>("/api/users", {
      method: "POST",
      auth: true,
      body: { username, password, role },
    }),
  updateUser: (
    id: number,
    patch: { username?: string; role?: "admin" | "prueba" | "super_admin"; password?: string },
  ) =>
    request<AdminUser>(`/api/users/${id}`, { method: "PATCH", auth: true, body: patch }),
  // Cambio de clave propio (2026-11-21): el usuario conoce su clave
  // actual; el backend revoca la sesión, así que tras el éxito hay que
  // volver a entrar con la clave nueva.
  changeMyPassword: (current_password: string, new_password: string) =>
    request<{ ok: boolean }>("/api/auth/change-password", {
      method: "POST",
      auth: true,
      body: { current_password, new_password },
    }),
  registerChallenge: () => request<RegisterChallenge>("/api/auth/register-challenge"),
  register: (body: { username: string; password: string; challenge_id: string; answer: number; plan?: string }) =>
    request<AdminUser>("/api/auth/register", { method: "POST", body }),
  deleteUser: (id: number) =>
    request<void>(`/api/users/${id}`, { method: "DELETE", auth: true }),
  approveUser: (id: number) =>
    request<AdminUser>(`/api/users/${id}/approve`, { method: "POST", auth: true }),
  rejectUser: (id: number) =>
    request<void>(`/api/users/${id}/reject`, { method: "POST", auth: true }),
};
