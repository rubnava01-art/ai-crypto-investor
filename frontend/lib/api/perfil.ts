// Dominio perfil del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request, clearMeCache } from "./client";
import type { UserProfile, UserProfileInput } from "./types";

export const perfilApi = {
  // ---------- Perfil (paquete 2026-10-28) ----------
  getMyProfile: () => request<UserProfile>("/api/profile/me", { auth: true }),
  updateMyProfile: (body: UserProfileInput) => {
    const p = request<UserProfile>("/api/profile/me", { method: "PUT", auth: true, body });
    // El /me memoizado no incluye el perfil, pero se invalida igual para
    // que ningún panel conserve datos viejos del usuario.
    p.then(() => clearMeCache()).catch(() => undefined);
    return p;
  },
  getUserProfile: (id: number) =>
    request<UserProfile>(`/api/profile/users/${id}`, { auth: true }),

  // ---------- Chat en vivo ----------,
};
