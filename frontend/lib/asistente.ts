// Cliente del Asistente (chat personalizado dentro de la web).
// Contrato del backend (Agente 2, 2026-11-22):
//   GET  /api/asistente/capacidades -> {"comandos":[{"id","ejemplo","descripcion","requiere_admin"}]}
//   POST /api/asistente/chat {"mensaje"} -> {"respuesta","accion":{"tipo","datos"}|null,"sugerencias":[...],
//     "fuente":{"nombre","url"}|null,"consultado_en":ISO|null,"sin_respuesta":bool,
//     "pasos":string[],"ruta":string|null}
//   GET  /api/asistente/preguntas (solo admin) -> [{"id","pregunta","veces","primera_vez","ultima_vez","estado"}]
//   POST /api/asistente/preguntas/{id}/regla {"respuesta","modulo?","ruta?"}
//   DELETE /api/asistente/preguntas/{id}
//   GET  /api/asistente/reglas
//   DELETE /api/asistente/reglas/{id}
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

export type AsistenteFuente = {
  nombre: string;
  url: string | null;
};

export type AsistenteChatResponse = {
  respuesta: string;
  accion: AsistenteAccion | null;
  sugerencias: string[];
  /** Fuente externa consultada (p. ej. Wikipedia) o null si la respuesta
   * viene de los datos de la plataforma. La fecha es ISO UTC. */
  fuente?: AsistenteFuente | null;
  consultado_en?: string | null;
  /** true cuando el Asistente no encontró información sobre el tema. */
  sin_respuesta?: boolean;
  /** Pasos de ayuda numerados, cuando la respuesta es una guía. */
  pasos?: string[];
  /** Ruta del módulo al que lleva la ayuda (p. ej. "/facturas"). */
  ruta?: string | null;
};

/** Pregunta pendiente de enseñar (bandeja solo-admin, 2026-11-23). */
export type AsistentePregunta = {
  id: number;
  pregunta: string;
  veces: number;
  primera_vez: string | null;
  ultima_vez: string | null;
  estado: string;
};

/** Regla activa enseñada al Asistente. */
export type AsistenteRegla = {
  id: number;
  pregunta?: string | null;
  respuesta: string;
  modulo?: string | null;
  ruta?: string | null;
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

// ---------- Bandeja "Preguntas por enseñar" (solo admin) ----------

export function listPreguntas(opts?: { signal?: AbortSignal }) {
  return request<AsistentePregunta[]>("/api/asistente/preguntas", {
    auth: true,
    retry: true,
    signal: opts?.signal,
  });
}

export function createRegla(
  preguntaId: number,
  body: { respuesta: string; modulo?: string; ruta?: string },
) {
  return request<AsistenteRegla>(`/api/asistente/preguntas/${preguntaId}/regla`, {
    method: "POST",
    auth: true,
    body,
  });
}

export function deletePregunta(preguntaId: number) {
  return request<void>(`/api/asistente/preguntas/${preguntaId}`, {
    method: "DELETE",
    auth: true,
  });
}

export function listReglas(opts?: { signal?: AbortSignal }) {
  return request<AsistenteRegla[]>("/api/asistente/reglas", {
    auth: true,
    retry: true,
    signal: opts?.signal,
  });
}

export function deleteRegla(reglaId: number) {
  return request<void>(`/api/asistente/reglas/${reglaId}`, {
    method: "DELETE",
    auth: true,
  });
}
