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
import { request } from "./api/client";
import { catalogMemo } from "./api/memo";

// Timeout propio del chat (chat-opt 2026-11-23): el backend tiene un
// presupuesto global de 5 s para el chat (Internet incluido), así que
// 20 s deja margen de sobra para una BD lenta o un arranque en frío;
// antes usaba AI_TIMEOUT_MS (120 s) y un backend colgado bloqueaba
// la UI dos minutos. AI_TIMEOUT_MS sigue para /api/ai/ask y Crear.
export const CHAT_TIMEOUT_MS = 20_000;

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

/** Sugerencia del backend (chat-potencia 2026-11-24): el backend nuevo
 * la marca con `requiere_admin`; el formato antiguo (string plano) se
 * sigue aceptando y se trata como sugerencia sin marca. */
export type AsistenteSugerencia = {
  label: string;
  requiere_admin?: boolean;
};

/** Pregunta aclaratoria del backend cuando no puede decidir. */
export type AsistenteAclaracion = {
  pregunta: string;
  opciones?: string[];
};

/** Recurso de la biblioteca de Estudiar (frente 4). */
export type AsistenteRecurso = {
  id: string;
  tipo: "ebook" | "guia" | "pack" | "academia" | "clase_grabada" | "clase_en_vivo" | "video" | "herramienta";
  titulo: string;
  descripcion?: string | null;
  enlace?: string | null;
  ruta?: string | null;
  precio_usd?: number | null;
};

export type AsistenteChatResponse = {
  respuesta: string;
  accion: AsistenteAccion | null;
  /** Sugerencias: strings (formato antiguo) u objetos con `requiere_admin`. */
  sugerencias: Array<string | AsistenteSugerencia>;
  /** Fuente externa consultada (p. ej. Wikipedia) o null si la respuesta
   * viene de los datos de la plataforma. La fecha es ISO UTC. */
  fuente?: AsistenteFuente | null;
  consultado_en?: string | null;
  /** true cuando el Asistente no encontró información sobre el tema. */
  sin_respuesta?: boolean;
  /** Motivo del sin_respuesta (contrato aditivo, backend Agente 2). */
  motivo?: "via_rapida" | "internet_sin_resultado" | "biblioteca_sin_resultado";
  /** Calidad del match de la regla/intención, 0–100 (backend; nunca se
   * inventa en cliente). */
  confianza?: number;
  /** Pregunta aclaratoria con opciones (F3-3). */
  aclaracion?: AsistenteAclaracion | null;
  /** Recursos de la biblioteca (F4-3). */
  recursos?: AsistenteRecurso[] | null;
  /** Pasos de ayuda numerados, cuando la respuesta es una guía. */
  pasos?: string[];
  /** Ruta del módulo al que lleva la ayuda (p. ej. "/facturas"). */
  ruta?: string | null;
};

/** Normaliza sugerencias del backend a objetos; tolera el formato
 * antiguo (string) y entradas inválidas (se ignoran). */
export function normalizeSugerencias(
  raw: Array<string | AsistenteSugerencia> | null | undefined,
): AsistenteSugerencia[] {
  if (!Array.isArray(raw)) return [];
  const out: AsistenteSugerencia[] = [];
  for (const s of raw) {
    if (typeof s === "string") {
      if (s.trim()) out.push({ label: s });
    } else if (s && typeof s.label === "string" && s.label.trim()) {
      out.push({ label: s.label, requiere_admin: !!s.requiere_admin });
    }
  }
  return out;
}

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
  // Catálogo estático (chat-opt 2026-11-23): memo 60 s con dedup en
  // vuelo — cada apertura del panel flotante volvía a pedirlo. Los
  // errores no se guardan y el memo se vacía al cambiar el token.
  return catalogMemo.get<AsistenteCapacidadesResponse>(
    "/api/asistente/capacidades",
    () =>
      request<AsistenteCapacidadesResponse>("/api/asistente/capacidades", {
        auth: true,
        retry: true,
        signal: opts?.signal,
      }),
  );
}

export function postChat(mensaje: string, opts?: { signal?: AbortSignal }) {
  return request<AsistenteChatResponse>("/api/asistente/chat", {
    method: "POST",
    auth: true,
    body: { mensaje },
    timeoutMs: CHAT_TIMEOUT_MS,
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
