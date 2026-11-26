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
//   GET  /api/asistente/uso -> {"plan","plan_nombre","limite_diario","mensajes_hoy","restantes","fecha"} (Fase 6)
//   POST /api/asistente/feedback {"pregunta","voto":"util"|"no_util"} -> {"id","voto","creado_en"} (Fase 6)
//   GET  /api/asistente/feedback?voto= (solo admin, Fase 6)
//   POST /api/asistente/chat {"mensaje","historial":[{"role","texto"}]} (2026-11-26, C-2):
//     historial = últimos turnos (máx. 6) para resolver referencias
//     ("esa cita", "cámbiala a las 11"); el backend lo ignora si aún
//     no lo soporta — es aditivo y nunca rompe el contrato viejo.
//   GET  /api/asistente/uso -> 401 para invitado (sin fila de usuario);
//     el frontend lo trata como "sin línea de uso", nunca como error.
// Respuestas del chat en español, servidas por el backend y mostradas tal cual.
// Sin persistencia en BD: el historial vive en sessionStorage (A-1), no
// en el servidor. Usa el fetch central (lib/api/client.ts): JWT Bearer
// con auth:true, timeout largo de IA para el POST y reintento opt-in
// solo en el GET.
import { request } from "./api/client";
import { catalogMemo } from "./api/memo";
import { tzOffsetMinutes, tzParts } from "./dates";

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
  /** Fecha de publicación del contenido consultado, cuando la fuente
   * la trae (M-4, noticias RSS); null si la fuente no la indica. */
  publicado_en?: string | null;
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
  /** Fecha de publicación del contenido consultado, cuando la fuente
   * la trae (M-4, noticias RSS); null si no la hay. */
  publicado_en?: string | null;
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

export function postChat(
  mensaje: string,
  opts?: { signal?: AbortSignal; idempotencyKey?: string; historial?: HistorialTurno[] },
) {
  return request<AsistenteChatResponse>("/api/asistente/chat", {
    method: "POST",
    auth: true,
    // C-2: el historial viaja solo si hay turnos previos; el backend
    // que aún no lo soporte lo ignora (campo aditivo).
    body:
      opts?.historial && opts.historial.length > 0
        ? { mensaje, historial: opts.historial }
        : { mensaje },
    timeoutMs: CHAT_TIMEOUT_MS,
    signal: opts?.signal,
    // A6/M3: una clave por intento; el reintento del mismo mensaje
    // reutiliza la misma (el backend solo la aplica a las 4 mutaciones).
    idempotencyKey: opts?.idempotencyKey,
  });
}

// ---------- Uso diario por plan (C-1) ----------

/** Respuesta de GET /api/asistente/uso. Admin: limite_diario y
 * restantes son null (sin límite); invitado: 401, sin fila. */
export type AsistenteUso = {
  plan: string;
  plan_nombre: string;
  limite_diario: number | null;
  mensajes_hoy: number;
  restantes: number | null;
  fecha: string;
};

export function getUso(opts?: { signal?: AbortSignal }) {
  return request<AsistenteUso>("/api/asistente/uso", {
    auth: true,
    retry: true,
    signal: opts?.signal,
  });
}

// ---------- Memoria de conversación (C-2) ----------

/** Un turno previo del hilo: lo que viaja en `historial`. El
 * backend exige `{rol: "usuario"|"asistente", texto}` (Pydantic
 * HistorialTurno); el mapeo user→usuario / assistant→asistente se
 * hace aquí, en buildHistorial, en un solo punto (D1, QA 2026-11-26:
 * antes se enviaba `{role: "user"|"assistant"}` y cada mensaje a
 * partir del segundo devolvía 422). */
export type HistorialTurno = {
  rol: "usuario" | "asistente";
  texto: string;
};

/** Máximo de turnos que viajan en cada POST (plan, C-2). */
export const HISTORIAL_MAX_TURNOS = 6;

/** Últimos turnos del hilo, sin el saludo inicial ni los errores:
 * solo mensajes de usuario y del asistente, con texto no vacío. */
export function buildHistorial(
  mensajes: Array<{ role: string; text: string; isGreeting?: boolean }>,
  maxTurnos: number = HISTORIAL_MAX_TURNOS,
): HistorialTurno[] {
  const turnos: HistorialTurno[] = [];
  for (const m of mensajes) {
    if (m.isGreeting) continue;
    if (m.role !== "user" && m.role !== "assistant") continue;
    if (!m.text.trim()) continue;
    // D1: el contrato del backend es {rol: "usuario"|"asistente"}.
    turnos.push({
      rol: m.role === "user" ? "usuario" : "asistente",
      texto: m.text,
    });
  }
  return turnos.slice(-maxTurnos);
}

// ---------- Idempotencia (A6/M3) ----------

/** Clave única por intento de envío (UUID cuando hay crypto). */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `asistente-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

// ---------- Confirmación previa de citas (A-2) ----------

/** Heurística por texto: orden de crear/agendar una cita. No
 * interpreta fecha ni hora (eso lo hace el backend y lo muestra la
 * tarjeta de confirmación); solo decide si pedir confirmación antes
 * de enviar. "¿Qué citas tengo?" no casa: no lleva verbo de crear. */
const VERBOS_CREAR_CITA =
  /\b(crea|crear|agenda|agendar|programa|programar|reserva|reservar)\b/i;

export function esOrdenCrearCita(texto: string): boolean {
  return /\bcita\b/i.test(texto) && VERBOS_CREAR_CITA.test(texto);
}

// ---------- Mini-tarjeta de precio (M-2/B6) ----------

/** Precio extraído de accion.datos (tipo "precio_btc") o null si no
 * hay precio real. Nunca inventa: sin btc ni eth, no hay tarjeta.
 * La hora es actualizado_en (caché, fresca o vieja) o fecha_vela
 * (velas) o, si el backend no trae ninguna, la fecha de consulta. */
export type AsistentePrecio = {
  btcUsd: number | null;
  ethUsd: number | null;
  fuente: string;
  timestamp: string | null;
  /** Edad en segundos cuando el backend la da (cache_edad_s). */
  edadSegundos: number | null;
};

export function extractPrecio(
  accion: AsistenteAccion | null | undefined,
  consultado_en?: string | null,
): AsistentePrecio | null {
  if (!accion || accion.tipo !== "precio_btc") return null;
  const d = (accion.datos ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v ? v : null;
  const btcUsd = num(d.btc_usd);
  const ethUsd = num(d.eth_usd);
  if (btcUsd === null && ethUsd === null) return null;
  return {
    btcUsd,
    ethUsd,
    fuente: str(d.fuente) ?? "sin_datos",
    timestamp: str(d.actualizado_en) ?? str(d.fecha_vela) ?? str(consultado_en) ?? null,
    edadSegundos: num(d.cache_edad_s),
  };
}

// ---------- Tarjeta de confirmación (A-2) ----------

/** Destino de "Ver en {módulo}" tras crear algo. Las notas, tareas
 * y citas viven en /business (Marketing y citas); el borrador de
 * contenido, en /crear. */
export type AccionDestino = {
  ruta: string;
  modulo: "business" | "crear";
};

export function accionDestino(tipo: string): AccionDestino | null {
  switch (tipo) {
    case "crear_nota":
    case "crear_tarea":
    case "crear_cita":
      return { ruta: "/business", modulo: "business" };
    case "crear_borrador":
      return { ruta: "/crear", modulo: "crear" };
    default:
      return null;
  }
}

// ---------- Día de hoy en Los Ángeles (M-5) ----------

/** Límites [from, to) en ISO UTC del día civil de hoy en
 * America/Los_Angeles, para pedir las citas de hoy al backend. */
export function diaBoundsISO(now: Date = new Date()): {
  from: string;
  to: string;
  fecha: string;
} {
  const p = tzParts(now);
  const medianochePared = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0);
  const offsetMin = tzOffsetMinutes(new Date(medianochePared));
  const fromMs = medianochePared - offsetMin * 60000;
  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(fromMs + 86400000).toISOString(),
    fecha: `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`,
  };
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

// ---------- Feedback útil / no útil (Fase 6, tarea 3) ----------
// Se guarda pregunta + voto + usuario + fecha; nunca la respuesta
// del asistente ni la conversación completa (ver backend).

export type AsistenteFeedbackVoto = "util" | "no_util";

export type AsistenteFeedbackResponse = {
  id: number;
  voto: AsistenteFeedbackVoto;
  creado_en: string | null;
};

export function postFeedback(pregunta: string, voto: AsistenteFeedbackVoto) {
  return request<AsistenteFeedbackResponse>("/api/asistente/feedback", {
    method: "POST",
    auth: true,
    body: { pregunta, voto },
  });
}
