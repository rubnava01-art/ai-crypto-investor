// Dominio inicio del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request } from "./client";
import { catalogMemo } from "./memo";
import type { HomeComment, HomePost, HomePostInput } from "./types";

export const inicioApi = {
  // ---------- Inicio: noticias y comentarios ----------
  // Posts casi estáticos (P1, 2026-11-17): memo 60 s en cliente, como
  // Academia/Clases — el cliente envía no-store, así que este memo es lo
  // que evita el viaje al navegar dentro de /inicio. Las mutaciones
  // invalidan el prefijo, así que la lista tras guardar nunca muestra
  // datos viejos. Los comentarios NO se memoizan (cambian con cada
  // comentario nuevo de cualquier usuario). La señal del llamador NO se
  // pasa al fetch memoizado (patrón Academia): un abort de un llamador
  // no debe tumbar la promesa compartida; la guarda `cancelled` de
  // useAsyncLoad ya evita escribir tras desmontar.
  listHomePosts: (_opts?: { signal?: AbortSignal }) =>
    catalogMemo.get<HomePost[]>("/api/inicio/posts", () =>
      request<HomePost[]>("/api/inicio/posts", { auth: true, retry: true }),
    ),
  createHomePost: (body: HomePostInput) =>
    request<HomePost>("/api/inicio/posts", { method: "POST", auth: true, body }).then((res) => {
      catalogMemo.invalidate("/api/inicio/posts");
      return res;
    }),
  updateHomePost: (id: number, body: Partial<HomePostInput>) =>
    request<HomePost>(`/api/inicio/posts/${id}`, { method: "PUT", auth: true, body }).then((res) => {
      catalogMemo.invalidate("/api/inicio/posts");
      return res;
    }),
  deleteHomePost: (id: number) =>
    request<void>(`/api/inicio/posts/${id}`, { method: "DELETE", auth: true }).then((res) => {
      catalogMemo.invalidate("/api/inicio/posts");
      return res;
    }),
  listHomeComments: (postId: number, opts?: { signal?: AbortSignal }) =>
    request<HomeComment[]>(`/api/inicio/posts/${postId}/comments`, { auth: true, retry: true, signal: opts?.signal }),
  createHomeComment: (postId: number, body: { body: string }) =>
    request<HomeComment>(`/api/inicio/posts/${postId}/comments`, { method: "POST", auth: true, body }),
  deleteHomeComment: (id: number) =>
    request<void>(`/api/inicio/comments/${id}`, { method: "DELETE", auth: true }),

  // ---------- Inventario ----------,
};
