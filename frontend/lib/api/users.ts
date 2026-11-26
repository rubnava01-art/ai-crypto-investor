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
  register: (body: { username: string; password: string; challenge_id: string; answer: number; plan?: string; terms_accepted: boolean }) =>
    request<AdminUser>("/api/auth/register", { method: "POST", body }),
  // Verificación de correo (Fase 1 mejoras-v1, correcciones F1): la
  // página pública /verificar-correo usa verifyEmail; el reenvío es
  // genérico (siempre 200) y no filtra si la cuenta existe.
  verifyEmail: (token: string) =>
    request<{ ok: boolean; username: string }>("/api/auth/verify-email", {
      method: "POST",
      body: { token },
    }),
  resendVerification: (username: string) =>
    request<{ ok: boolean; detail: string }>("/api/auth/resend-verification", {
      method: "POST",
      body: { username },
    }),
  // 2FA TOTP propio (Fase 1 mejoras-v1, correcciones F1): solo admin y
  // super admin (el backend lo refuerza con require_admin). El setup
  // devuelve el secreto + otpauth_url (QR); confirm activa y devuelve
  // los 10 códigos de recuperación (una sola vez); disable exige clave
  // + código y revoca la sesión.
  getTwoFactorStatus: () =>
    request<{ enabled: boolean; pending_setup: boolean; recovery_codes_left: number }>(
      "/api/auth/2fa/status",
      { auth: true },
    ),
  setupTwoFactor: () =>
    request<{ secret: string; otpauth_url: string; issuer: string; account: string }>(
      "/api/auth/2fa/setup",
      { method: "POST", auth: true },
    ),
  confirmTwoFactor: (code: string) =>
    request<{ ok: boolean; recovery_codes: string[] }>("/api/auth/2fa/confirm", {
      method: "POST",
      auth: true,
      body: { code },
    }),
  disableTwoFactor: (password: string, code: string) =>
    request<{ ok: boolean }>("/api/auth/2fa/disable", {
      method: "POST",
      auth: true,
      body: { password, code },
    }),
  regenerateTwoFactorRecoveryCodes: (code: string) =>
    request<{ ok: boolean; recovery_codes: string[] }>("/api/auth/2fa/recovery-codes", {
      method: "POST",
      auth: true,
      body: { code },
    }),
  deleteUser: (id: number) =>
    request<void>(`/api/users/${id}`, { method: "DELETE", auth: true }),
  approveUser: (id: number) =>
    request<AdminUser>(`/api/users/${id}/approve`, { method: "POST", auth: true }),
  rejectUser: (id: number) =>
    request<void>(`/api/users/${id}/reject`, { method: "POST", auth: true }),
};
