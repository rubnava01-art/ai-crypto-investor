// Dominio chat del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request } from "./client";
import type { ChatMessage } from "./types";

export const chatApi = {
  // ---------- Chat en vivo ----------
  listChatMessages: (opts?: { signal?: AbortSignal }) =>
    request<ChatMessage[]>("/api/chat/messages", { auth: true, retry: true, signal: opts?.signal }),
  postChatMessage: (body: { text: string }) =>
    request<ChatMessage>("/api/chat/messages", { method: "POST", auth: true, body }),
  deleteChatMessage: (id: number) =>
    request<void>(`/api/chat/messages/${id}`, { method: "DELETE", auth: true }),

  // ---------- Recomendaciones ----------,
};
