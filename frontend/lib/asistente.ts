// Cliente del Asistente (chat personalizado dentro de la web).
// Contrato del backend (Agente 2, 2026-11-22):
//   GET  /api/asistente/capacidades -> {"comandos":[{"id","ejemplo","descripcion","requiere_admin"}]}
//   POST /api/asistente/chat {"mensaje"} -> {"respuesta","accion":{"tipo","datos"}|null,"sugerencias":[...]}
// Respuestas del chat en español, servidas por el backend y mostradas tal cual.
// Sin persistencia: el historial vive solo en la sesión (estado React).
// Usa el fetch central (lib/api/client.ts): JWT Bearer con auth:true,
// timeout largo de IA para el POST y reintento opt-in solo en el GET.
import { AI_TIMEOUT_MS, request } from "./api/client";

export type AsistenteComando = {
  id: string;
  ejemplo: string;
  descripcion: string;
  requiere_admin: boolean;
};

export type AsistenteAccion = {
  tipo: string;
  datos: unknown;
};

export type AsistenteChatResponse = {
  respuesta: string;
  accion: AsistenteAccion | null;
  sugerencias: string[];
};

export type AsistenteCapacidadesResponse = {
  comandos: AsistenteComando[];
};

export function getCapacidades(opts?: { signal?: AbortSignal }) {
  return request<AsistenteCapacidadesResponse>("/api/asistente/capacidades", {
    auth: true,
    retry: true,
    signal: opts?.signal,
  });
}

export function postChat(mensaje: string, opts?: { signal?: AbortSignal }) {
  return request<AsistenteChatResponse>("/api/asistente/chat", {
    method: "POST",
    auth: true,
    body: { mensaje },
    timeoutMs: AI_TIMEOUT_MS,
    signal: opts?.signal,
  });
}
