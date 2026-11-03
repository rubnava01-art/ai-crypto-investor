// Dominio inicio del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request } from "./client";
import type { HomeComment, HomePost, HomePostInput } from "./types";

export const inicioApi = {
  // ---------- Inicio: noticias y comentarios ----------
  listHomePosts: (opts?: { signal?: AbortSignal }) =>
    request<HomePost[]>("/api/inicio/posts", { auth: true, retry: true, signal: opts?.signal }),
  createHomePost: (body: HomePostInput) =>
    request<HomePost>("/api/inicio/posts", { method: "POST", auth: true, body }),
  updateHomePost: (id: number, body: Partial<HomePostInput>) =>
    request<HomePost>(`/api/inicio/posts/${id}`, { method: "PUT", auth: true, body }),
  deleteHomePost: (id: number) =>
    request<void>(`/api/inicio/posts/${id}`, { method: "DELETE", auth: true }),
  listHomeComments: (postId: number, opts?: { signal?: AbortSignal }) =>
    request<HomeComment[]>(`/api/inicio/posts/${postId}/comments`, { auth: true, retry: true, signal: opts?.signal }),
  createHomeComment: (postId: number, body: { body: string }) =>
    request<HomeComment>(`/api/inicio/posts/${postId}/comments`, { method: "POST", auth: true, body }),
  deleteHomeComment: (id: number) =>
    request<void>(`/api/inicio/comments/${id}`, { method: "DELETE", auth: true }),

  // ---------- Inventario ----------,
};
