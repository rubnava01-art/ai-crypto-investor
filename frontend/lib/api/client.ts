import type { MeResponse } from "./types";

// Cliente fetch del API (extraído de lib/api.ts en Fase 4, sin cambios
// de comportamiento). Único punto de fetch con timeout: request() (JSON)
// y downloadCoursePdf (blob).

// Typed API client for the AI CRYPTO INVESTOR FastAPI backend.
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

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
  clearMeCache();
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
  | "unknown";

export function errorKeyForStatus(status: number): ApiErrorKey {
  if (status === 0) return "network";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "notFound";
  if (status >= 500) return "server";
  return "unknown";
}

export class ApiError extends Error {
  status: number;
  key: ApiErrorKey;
  detail?: string;
  constructor(status: number, message: string, opts: { key?: ApiErrorKey; detail?: string } = {}) {
    super(message);
    this.status = status;
    this.key = opts.key ?? errorKeyForStatus(status);
    this.detail = opts.detail;
  }
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
export function handleUnauthorized() {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/login") return;
  setToken(null);
  // Fase 4 (FE7): preservar el destino (?next=) y marcar la expiración para
  // que /login muestre "sesión expirada" en vez de un login pelado. El
  // backend sigue siendo el gate real; esto es solo UX de redirección.
  const next = window.location.pathname || "/";
  window.location.replace(`/login?next=${encodeURIComponent(next)}&expired=1`);
}

// Detalle de error del backend cuando lo hay (FastAPI: {"detail": "..."});
// si el cuerpo no es JSON (p. ej. página del proxy), cae al statusText.
// Lo comparten request() (JSON) y downloadCoursePdf() (blob) para que un
// fallo de descarga muestre la causa real y no solo el código HTTP.
export async function errorDetail(res: Response): Promise<string> {
  try {
    const j = await res.json();
    if (typeof j?.detail === "string") return j.detail;
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
    /** Reintento opt-in (Fase 4, FE8): 1 reintento con backoff corto, solo
     * para GETs idempotentes y solo ante fallos transitorios (red/timeout o
     * 502/503/504). Nunca se reintentan POST/PUT/PATCH/DELETE ni 4xx. */
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
  const attempts = canRetry ? 2 : 1;

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
      // Fallo de red/timeout: reintentar una vez si es opt-in; si no, sale.
      if (canRetry && err instanceof ApiError && err.status === 0 && i < attempts - 1) {
        await sleep(600, opts.signal);
        continue;
      }
      throw err;
    }
    if (!res.ok) {
      // 502/503/504 (típico cold start del free tier): un reintento opt-in.
      if (canRetry && (res.status === 502 || res.status === 503 || res.status === 504) && i < attempts - 1) {
        await sleep(600, opts.signal);
        continue;
      }
      if (res.status === 401 && opts.auth) handleUnauthorized();
      const detail = await errorDetail(res);
      throw new ApiError(res.status, detail || res.statusText, {
        key: errorKeyForStatus(res.status),
        detail: detail || undefined,
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
