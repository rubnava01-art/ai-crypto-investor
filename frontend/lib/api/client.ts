import type { MeResponse } from "./types";
import { catalogMemo } from "./memo";
import { expiredLoginUrlFromLocation } from "../session";

// Cliente fetch del API (extraído de lib/api.ts en Fase 4, sin cambios
// de comportamiento). Único punto de fetch con timeout: request() (JSON)
// y downloadCoursePdf (blob).

// Typed API client for the Grow Business Platform FastAPI backend.
// Contract: all JSON; money as strings; times ISO UTC.
// Money stays a string end-to-end; parsing/formatting happens at render time only.

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
// Aviso ruidoso (Fase 4, FE12): si NEXT_PUBLIC_API_URL no está definida, el
// fallback localhost solo es válido en desarrollo; en producción apuntaría
// al equipo del usuario y el banner offline lo mostraría. NO se falla en
// producción por esto (decisión de la fase: el fallo estricto queda como
// seguimiento una vez Render tenga las variables), pero el aviso queda en
// consola para que no pase desapercibido.
if (typeof window !== "undefined" && !process.env.NEXT_PUBLIC_API_URL) {
  console.warn(
    "[api] NEXT_PUBLIC_API_URL no definida: usando http://localhost:8000, válido solo en desarrollo.",
  );
}
const TOKEN_KEY = "aci_token";
// Sesión de invitado (Fase 1, 2026-11-23): el token invitado vive en el
// mismo almacenamiento que el de cuenta, con una marca aparte
// (`aci_guest=1`) para que la UI sepa que es una prueba sin registro
// (menú filtrado, banner, sin /me ni perfil). Sin PII, sin persistencia.
const GUEST_KEY = "aci_guest";

export function isGuest(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(GUEST_KEY) === "1";
  } catch {
    return false;
  }
}

/** Guarda un token de invitado (contrato POST /api/auth/guest). */
export function setGuestToken(token: string) {
  setToken(token);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GUEST_KEY, "1");
  } catch {
    /* almacenamiento no disponible: la sesión sigue valiendo */
  }
}

function clearGuestFlag() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(GUEST_KEY);
  } catch {
    /* nada que limpiar */
  }
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
  // Entrada de prueba rápida (2026-11-24): la marca de invitado describe
  // LA SESIÓN ACTUAL, no el navegador. Antes sobrevivía a un login con
  // cuenta real (setToken no la borraba) y `isGuest()` seguía diciendo
  // "invitado" con un token de cuenta — el menú, el banner y la base de
  // mercado tomaban el camino de invitado por error. Al cambiar de
  // sesión la marca se borra; `setGuestToken` la vuelve a poner justo
  // después (llama a setToken primero y luego marca), así que el flujo
  // de invitado no cambia. `logout()` ya la borraba por su lado.
  clearGuestFlag();
  clearMeCache();
  // Defensa en profundidad (2026-11-23, recomendación QA 2026-11-22):
  // al cambiar de sesión ningún catálogo memoizado (facturas,
  // plantillas, clases…) debe sobrevivir al usuario anterior. Sin
  // fuga real verificada — las listas son las mismas para admin y
  // prueba y los errores no se cachean — pero el memo se vacía igual.
  catalogMemo.clear();
}

// Cierre de sesión centralizado y completo (2026-11-23, A3): borrar el
// token no basta — el borrador de correo (PII de cliente,
// sessionStorage `grow-correo-borrador`) y los datos locales de flujos
// (`grow-flows`) y análisis sociales (`grow-social-analyses`) quedaban
// en un dispositivo compartido tras cerrar sesión. La usan app/page.tsx,
// ModuleShell y handleUnauthorized (401). No borra nada más: el idioma
// (`aci_lang`) y las preferencias no son datos de sesión.
export function logout() {
  if (typeof window === "undefined") return;
  setToken(null);
  clearGuestFlag();
  try {
    window.sessionStorage.removeItem("grow-correo-borrador");
  } catch {
    /* almacenamiento no disponible: no hay nada que limpiar */
  }
  try {
    window.localStorage.removeItem("grow-flows");
    window.localStorage.removeItem("grow-social-analyses");
  } catch {
    /* almacenamiento no disponible: no hay nada que limpiar */
  }
}

/** Clave de error calculada en la frontera del cliente (Fase 4, FE8): la UI
 * la mapea a cadenas i18n (lib/i18n reliability) y el detalle crudo del
 * backend viaja aparte, solo en una línea "detalles" colapsable. El mensaje
 * (message) se conserva verbatim como antes para no romper las pantallas
 * que lo muestran directamente (p. ej. login: "cuenta pendiente"). */
export type ApiErrorKey =
  | "network"
  | "unauthorized"
  | "forbidden"
  | "notFound"
  | "server"
  | "timeout"
  | "tooManyRequests"
  | "unknown";

export function errorKeyForStatus(status: number): ApiErrorKey {
  if (status === 0) return "network";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "notFound";
  if (status === 429) return "tooManyRequests";
  if (status >= 500) return "server";
  return "unknown";
}

export class ApiError extends Error {
  status: number;
  key: ApiErrorKey;
  detail?: string;
  /** Segundos de espera del servidor (`Retry-After`, 429), si lo envió. */
  retryAfter?: number;
  constructor(status: number, message: string, opts: { key?: ApiErrorKey; detail?: string; retryAfter?: number } = {}) {
    super(message);
    this.status = status;
    this.key = opts.key ?? errorKeyForStatus(status);
    this.detail = opts.detail;
    this.retryAfter = opts.retryAfter;
  }
}

/** Parsea `Retry-After`: segundos o fecha HTTP → segundos hasta poder
 * reintentar (0 si ya pasó o no parsea). Corrida chat-potencia F1-3. */
export function parseRetryAfter(raw: string | null | undefined, nowMs = Date.now()): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return Math.max(0, Number(trimmed));
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return null;
  return Math.max(0, Math.ceil((dateMs - nowMs) / 1000));
}


// ---------- fetch core ----------

// Default per-request timeout: a hung backend must never block the UI forever.
// /api/ai/ask may legitimately take longer, so it opts into a longer timeout.
export const DEFAULT_TIMEOUT_MS = 30_000;
export const AI_TIMEOUT_MS = 120_000;

// /me, memoizado: antes cada panel (más ProfileMenu) pedía /me al montar,
// así que una sola página disparaba 3-4 peticiones idénticas. Ahora el
// cliente comparte una respuesta válida 60s y deduplica peticiones en
// vuelo. La caché se invalida al cambiar el token y al guardar el perfil.
const ME_CACHE_TTL_MS = 60_000;
let meCache: { at: number; data: MeResponse } | null = null;
let meInflight: Promise<MeResponse> | null = null;

export function clearMeCache() {
  meCache = null;
  meInflight = null;
}

// Único punto de fetch con timeout: request() (JSON) y downloadCoursePdf
// (blob) lo comparten en vez de duplicar el AbortController. Un timeout se
// reporta como timeout, no como "API unreachable".
// Idioma de los mensajes que construye ESTE cliente (no es un componente
// React, así que no puede usar useLanguage): lee la misma clave que el
// diccionario ("aci_lang") en el momento del error; por defecto español.
// El `detail` del backend pasa verbatim y NO se traduce aquí.
export function uiLang(): "es" | "en" {
  if (typeof window === "undefined") return "es";
  try {
    return window.localStorage.getItem("aci_lang") === "en" ? "en" : "es";
  } catch {
    return "es";
  }
}

export async function fetchTimed(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  // Señal externa (useAsyncLoad al desmontar): abortar el fetch de verdad.
  // Se distingue del timeout para que el hook no lo trate como error.
  let externalAborted = false;
  const onExternalAbort = () => {
    externalAborted = true;
    ctrl.abort();
  };
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  try {
    if (externalSignal?.aborted) throw new DOMException("Aborted", "AbortError");
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      if (externalAborted || externalSignal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      throw new ApiError(
        0,
        uiLang() === "en"
          ? `API timeout (${timeoutMs / 1000}s) on ${label}`
          : `API timeout (${timeoutMs / 1000}s) en ${label}`,
        { key: "timeout" },
      );
    }
    throw new ApiError(0, `API unreachable (${API_URL})`, { key: "network" });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// Sesión expirada: un 401 en una petición autenticada significa que el
// token guardado ya no vale. Antes cada panel mostraba su propio error y
// dejaba al usuario atascado en una página que ya no podía cargar nada
// (el shell solo comprobaba que hubiera un token, no que fuera válido).
// Ahora el cliente centraliza el caso: borra el token inválido y vuelve
// al login. Solo aplica a peticiones con auth: true, así un 401 de login
// por contraseña incorrecta sigue mostrando su error en la misma página
// sin redirigir, y nunca se redirige estando ya en /login.
// Único dueño del redirect (C2, 2026-11-13): la URL se construye en
// lib/session.ts y conserva pathname + query del destino.
export function handleUnauthorized() {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/login") return;
  // Invitado (Fase 1): su token dura 15 min; al caducar vuelve a la
  // landing pública con el aviso, no al login (no tiene cuenta).
  if (isGuest()) {
    logout();
    window.location.replace("/?guest=expired");
    return;
  }
  // F1 (2026-11-23): la expiración también es un cierre de sesión:
  // token + borrador + datos locales, no solo el token.
  logout();
  // Fase 4 (FE7): preservar el destino (?next=) y marcar la expiración para
  // que /login muestre "sesión expirada" en vez de un login pelado. El
  // backend sigue siendo el gate real; esto es solo UX de redirección.
  window.location.replace(expiredLoginUrlFromLocation());
}

// Detalle de error del backend cuando lo hay (FastAPI: {"detail": "..."});
// si el cuerpo no es JSON (p. ej. página del proxy), cae al statusText.
// Lo comparten request() (JSON) y downloadCoursePdf() (blob) para que un
// fallo de descarga muestre la causa real y no solo el código HTTP.
// Un 422 de FastAPI trae `detail` como LISTA de {loc, msg, type}: se
// aplana a su primer `msg` legible (P3, 2026-11-17) en vez de mostrar
// el JSON entero; un `detail` string sigue pasando tal cual.
export async function errorDetail(res: Response): Promise<string> {
  try {
    const j = await res.json();
    if (typeof j?.detail === "string") return j.detail;
    if (Array.isArray(j?.detail) && j.detail.length > 0) {
      const first = j.detail[0];
      if (typeof first?.msg === "string") return first.msg;
      if (typeof first === "string") return first;
    }
  } catch {
    /* cuerpo no-JSON: usa statusText */
  }
  return res.statusText;
}

export async function request<T>(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    auth?: boolean;
    idempotencyKey?: string;
    timeoutMs?: number;
    /** Señal de cancelación del llamador (useAsyncLoad al desmontar). */
    signal?: AbortSignal;
    /** Reintento opt-in (Fase 4, FE8; backoff Fase 5): hasta 2 reintentos
     * con backoff 600 ms / 1,5 s, solo para GETs idempotentes y solo ante
     * fallos transitorios (red/timeout o 502/503/504). Nunca se reintentan
     * POST/PUT/PATCH/DELETE ni 4xx. */
    retry?: boolean;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const method = opts.method ?? "GET";
  const canRetry = opts.retry === true && method === "GET";
  // Fase 5 (2026-11-23): backoff 600 ms → 1,5 s en 3 intentos (antes 1×
  // 600 ms): el cold start del free tier suele durar más que un reintento.
  const attempts = canRetry ? 3 : 1;
  const backoffMs = [600, 1500];

  for (let i = 0; i < attempts; i++) {
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    let res: Response;
    try {
      res = await fetchTimed(
        `${API_URL}${path}`,
        {
          method,
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          cache: "no-store",
        },
        timeoutMs,
        path,
        opts.signal,
      );
    } catch (err) {
      // Fallo de red/timeout: reintentar con backoff si es opt-in; si no, sale.
      if (canRetry && err instanceof ApiError && err.status === 0 && i < attempts - 1) {
        await sleep(backoffMs[i] ?? 1500, opts.signal);
        continue;
      }
      throw err;
    }
    if (!res.ok) {
      // 502/503/504 (típico cold start del free tier): reintentos opt-in con backoff.
      if (canRetry && (res.status === 502 || res.status === 503 || res.status === 504) && i < attempts - 1) {
        await sleep(backoffMs[i] ?? 1500, opts.signal);
        continue;
      }
      if (res.status === 401 && opts.auth) handleUnauthorized();
      const detail = await errorDetail(res);
      throw new ApiError(res.status, detail || res.statusText, {
        key: errorKeyForStatus(res.status),
        detail: detail || undefined,
        // F1-3: la cuenta atrás del 429 sale del Retry-After del servidor.
        retryAfter: parseRetryAfter(res.headers.get("Retry-After")) ?? undefined,
      });
    }
    if (res.status === 204) return undefined as T;
    // Robustez: un 2xx con cuerpo vacío o no-JSON (p. ej. un error del proxy
    // de Render que llega con 200) antes lanzaba un SyntaxError crudo que
    // ningún panel sabía mostrar; ahora es un ApiError como cualquier otro.
    try {
      return (await res.json()) as T;
    } catch {
      throw new ApiError(
        0,
        uiLang() === "en" ? `Invalid API response on ${path}` : `Respuesta no válida del API en ${path}`,
        { key: "unknown" },
      );
    }
  }
  throw new ApiError(0, "API unreachable", { key: "network" });
}

// /me memoizado (vivía junto al cliente en api.ts): una sola página disparaba
// 3-4 peticiones idénticas; el cliente comparte una respuesta válida 60s y
// deduplica peticiones en vuelo. Se invalida al cambiar el token y al guardar
// el perfil.
export function fetchMe(): Promise<MeResponse> {
  if (meCache && Date.now() - meCache.at < ME_CACHE_TTL_MS) {
    return Promise.resolve(meCache.data);
  }
  if (!meInflight) {
    meInflight = request<MeResponse>("/api/auth/me", { auth: true })
      .then((data) => {
        meCache = { at: Date.now(), data };
        return data;
      })
      .finally(() => {
        meInflight = null;
      });
  }
  return meInflight;
}
