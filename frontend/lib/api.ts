// Typed API client for the AI CRYPTO INVESTOR FastAPI backend.
// Contract: all JSON; money as strings; times ISO UTC.
// Money stays a string end-to-end; parsing/formatting happens at render time only.

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const TOKEN_KEY = "aci_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ---------- contract types ----------

export interface HealthResponse {
  status: string;
  version: string;
  mode: string;
  timestamp_utc: string;
}
export interface TokenResponse {
  access_token: string;
  token_type: string;
}
export interface SystemStatus {
  mode: "demo" | "live";
  exchange_connected: boolean;
  scanner_running: boolean;
  simulation_mode: "simulation" | "paper" | "real";
  kill_switch: boolean;
  data_source: string;
  last_update_utc: string;
}
export interface BalancesResponse {
  equity_usd: string;
  available_usd: string;
  currency: string;
  demo: boolean;
  as_of_utc: string;
}
export interface PerformanceResponse {
  realized_pnl_usd: string;
  unrealized_pnl_usd: string;
  max_drawdown_pct: string;
  fees_paid_usd: string;
  demo: boolean;
  as_of_utc: string;
}
export type SignalSide = "buy" | "sell" | "hold";
export interface SignalOut {
  id: number;
  symbol: string;
  side: SignalSide;
  entry_price: string | null;
  target_price: string | null;
  invalidation_price: string | null;
  reason: string;
  status: string;
  created_utc: string;
}
export interface SignalsResponse {
  signals: SignalOut[];
  demo: boolean;
}
export interface StrategyOut {
  id: number;
  name: string;
  version: string;
  status: string;
  notes: string;
}
export interface ScannerState {
  running: boolean;
}
export interface SimulationModes {
  modes: ("simulation" | "paper" | "real")[];
  current: string;
  real_enabled: boolean;
}
export interface OperationsResponse {
  orders: Record<string, unknown>[];
  trades: Record<string, unknown>[];
}
export interface RiskLimits {
  max_risk_per_trade_pct: string;
  max_daily_loss_usd: string;
  max_trades_per_day: number;
  spot_only: boolean;
  no_leverage: boolean;
  kill_switch: boolean;
}
export interface KillSwitchResponse {
  kill_switch: boolean;
  engaged_utc: string;
  idempotent_replay: boolean;
}
export interface LogEntry {
  id: number;
  level: string;
  category: string;
  message: string;
  created_utc: string;
}
export interface AIAskResponse {
  answer: string;
  refused: boolean;
  demo: boolean;
  confidence: number | null;
  signal_id: number | null;
}
export interface CalibrationBucket {
  bucket: string;
  n: number;
  claimed_avg_pct: number;
  actual_win_pct: number;
  miscalibrated: boolean;
}
export interface AILessonsResponse {
  summary_es: string;
  calibration: CalibrationBucket[];
  demo_note: string;
}
export interface AIStatusResponse {
  provider: string;
  configured: boolean;
  demo: boolean;
}

export interface CoinPrice {
  symbol: string;
  name: string;
  pair: string;
  price_usd: number | null;
  change_24h_pct: number | null;
  sparkline_24h: number[];
}

export interface MarketPricesResponse {
  source: string;
  updated_utc: string;
  stale: boolean;
  prices: CoinPrice[];
}

export interface MeResponse {
  username: string;
  is_admin: boolean;
  role: "admin" | "prueba";
}

export interface AdminUser {
  id: number;
  username: string;
  role: "admin" | "prueba";
  is_admin: boolean;
  created_at: string | null;
}

export interface OrderOut {
  id: number;
  client_order_id: string;
  symbol: string;
  side: string;
  quantity: string;
  status: string;
  mode: string;
  created_utc: string;
}

export interface DashboardResponse {
  system: SystemStatus;
  balances: BalancesResponse;
  performance: PerformanceResponse;
  signals: SignalsResponse;
  strategies: StrategyOut[];
  modes: SimulationModes;
  operations: OperationsResponse;
  risk: RiskLimits;
  logs: LogEntry[];
}

// ---------- CRM (Plataforma Unificada — Fase 1) ----------

export type CrmSource = "manual" | "academia" | "cohley" | "rivgoods" | "otro";
export type CrmStatus = "nuevo" | "contactado" | "interesado" | "cliente" | "inactivo";

export interface CrmContact {
  id: number;
  name: string;
  email: string;
  phone: string;
  source: CrmSource;
  tags: string[];
  status: CrmStatus;
  notes: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface CrmContactInput {
  name: string;
  email?: string;
  phone?: string;
  source?: CrmSource;
  tags?: string[];
  status?: CrmStatus;
  notes?: string;
}

// ---------- Academia (Plataforma Unificada — Fase 2, módulo Estudiar) ----------

export type CourseKind = "ebook" | "pack" | "academia";

export interface AcademyDownload {
  course_id: number;
  title: string;
  filename: string;
}

export interface AcademyCourse {
  id: number;
  slug: string;
  title: string;
  description: string;
  price_usd: string;
  kind: CourseKind;
  buy_url: string;
  delivery_note: string;
  sort_order: number;
  students_count: number;
  downloads: AcademyDownload[];
  created_at: string | null;
  updated_at: string | null;
}

export interface AcademyEnrollment {
  id: number;
  contact_id: number;
  course_id: number;
  contact_name: string;
  contact_email: string;
  course_title: string;
  purchased: boolean;
  delivered: boolean;
  purchased_at: string | null;
  delivered_at: string | null;
  notes: string;
  created_at: string | null;
  updated_at: string | null;
}

// ---------- Crear (Plataforma Unificada — Fase 3) ----------

export type CopyPlatform = "instagram" | "threads" | "facebook";
export type CopyTone = "directo" | "educativo" | "divertido" | "profesional";

export interface CopyDraft {
  id: number;
  topic: string;
  platform: CopyPlatform;
  tone: string;
  text: string;
  demo: boolean;
  created_at: string | null;
}

export interface TrendNote {
  id: number;
  title: string;
  source: string;
  summary: string;
  published_on: string | null;
  created_at: string | null;
}

// ---------- fetch core ----------

// Default per-request timeout: a hung backend must never block the UI forever.
// /api/ai/ask may legitimately take longer, so it opts into a longer timeout.
const DEFAULT_TIMEOUT_MS = 30_000;
const AI_TIMEOUT_MS = 120_000;

async function request<T>(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    auth?: boolean;
    idempotencyKey?: string;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(0, `API timeout (${timeoutMs / 1000}s) en ${path}`);
    }
    throw new ApiError(0, `API unreachable (${API_URL})`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      if (typeof j?.detail === "string") detail = j.detail;
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------- endpoints ----------

export const api = {
  health: () => request<HealthResponse>("/api/health"),
  login: (username: string, password: string) =>
    request<TokenResponse>("/api/auth/login", { method: "POST", body: { username, password } }),
  systemStatus: () => request<SystemStatus>("/api/system/status", { auth: true }),
  balances: () => request<BalancesResponse>("/api/portfolio/balances", { auth: true }),
  performance: () => request<PerformanceResponse>("/api/portfolio/performance", { auth: true }),
  signals: () => request<SignalsResponse>("/api/signals", { auth: true }),
  strategies: () => request<StrategyOut[]>("/api/strategies", { auth: true }),
  scannerStart: () => request<ScannerState>("/api/scanner/start", { method: "POST", auth: true }),
  scannerStop: () => request<ScannerState>("/api/scanner/stop", { method: "POST", auth: true }),
  simulationModes: () => request<SimulationModes>("/api/simulation/modes", { auth: true }),
  setSimulationMode: (mode: string) =>
    request<SimulationModes>("/api/simulation/mode", { method: "POST", auth: true, body: { mode } }),
  operations: () => request<OperationsResponse>("/api/operations", { auth: true }),
  riskLimits: () => request<RiskLimits>("/api/risk/limits", { auth: true }),
  killSwitch: (idempotencyKey: string) =>
    request<KillSwitchResponse>("/api/risk/kill-switch", {
      method: "POST",
      auth: true,
      idempotencyKey,
    }),
  logs: () => request<LogEntry[]>("/api/logs", { auth: true }),
  aiStatus: () => request<AIStatusResponse>("/api/ai/status", { auth: true }),
  aiAsk: (question: string, signal_id?: number | null) =>
    request<AIAskResponse>("/api/ai/ask", {
      method: "POST",
      auth: true,
      body: { question, signal_id: signal_id ?? null },
      timeoutMs: AI_TIMEOUT_MS,
    }),
  aiLessons: () => request<AILessonsResponse>("/api/ai/lessons", { auth: true }),
  me: () => request<MeResponse>("/api/auth/me", { auth: true }),
  marketPrices: () => request<MarketPricesResponse>("/api/market/prices", { auth: true }),
  listUsers: () => request<AdminUser[]>("/api/users", { auth: true }),
  createUser: (username: string, password: string, role: "admin" | "prueba") =>
    request<AdminUser>("/api/users", {
      method: "POST",
      auth: true,
      body: { username, password, role },
    }),
  updateUser: (id: number, patch: { role?: "admin" | "prueba"; password?: string }) =>
    request<AdminUser>(`/api/users/${id}`, { method: "PATCH", auth: true, body: patch }),
  deleteUser: (id: number) =>
    request<void>(`/api/users/${id}`, { method: "DELETE", auth: true }),
  dashboard: () => request<DashboardResponse>("/api/dashboard", { auth: true }),
  createOrder: (
    body: { symbol: string; side: "buy" | "sell"; quantity: string; mode: string },
    idempotencyKey: string
  ) =>
    request<OrderOut>("/api/orders", {
      method: "POST",
      auth: true,
      body,
      idempotencyKey,
    }),
  listContacts: (q?: string, status?: string) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    const qs = params.toString();
    return request<CrmContact[]>(`/api/crm/contacts${qs ? `?${qs}` : ""}`, { auth: true });
  },
  createContact: (body: CrmContactInput) =>
    request<CrmContact>("/api/crm/contacts", { method: "POST", auth: true, body }),
  updateContact: (id: number, body: CrmContactInput) =>
    request<CrmContact>(`/api/crm/contacts/${id}`, { method: "PUT", auth: true, body }),
  deleteContact: (id: number) =>
    request<void>(`/api/crm/contacts/${id}`, { method: "DELETE", auth: true }),
  listCourses: () => request<AcademyCourse[]>("/api/academy/courses", { auth: true }),
  updateCourse: (
    id: number,
    body: { title?: string; description?: string; price_usd?: string; kind?: CourseKind; buy_url?: string; delivery_note?: string },
  ) => request<AcademyCourse>(`/api/academy/courses/${id}`, { method: "PUT", auth: true, body }),
  listStudents: (courseId: number) =>
    request<AcademyEnrollment[]>(`/api/academy/courses/${courseId}/students`, { auth: true }),
  createEnrollment: (body: { contact_id: number; course_id: number; purchased?: boolean; delivered?: boolean; notes?: string }) =>
    request<AcademyEnrollment>("/api/academy/enrollments", { method: "POST", auth: true, body }),
  updateEnrollment: (id: number, body: { purchased?: boolean; delivered?: boolean; notes?: string }) =>
    request<AcademyEnrollment>(`/api/academy/enrollments/${id}`, { method: "PATCH", auth: true, body }),
  deleteEnrollment: (id: number) =>
    request<void>(`/api/academy/enrollments/${id}`, { method: "DELETE", auth: true }),

  // Descarga de un PDF real de la Academia: fetch con el token guardado ->
  // blob -> descarga del navegador (el endpoint exige autenticación).
  downloadCoursePdf: async (courseId: number, filename: string): Promise<void> => {
    const token = getToken();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${API_URL}/api/academy/courses/${courseId}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: "no-store",
        signal: ctrl.signal,
      });
    } catch {
      clearTimeout(timer);
      throw new ApiError(0, `API unreachable (${API_URL})`);
    }
    clearTimeout(timer);
    if (!res.ok) throw new ApiError(res.status, `No se pudo descargar el PDF (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  generateCopy: (body: { topic: string; platform: CopyPlatform; tone: CopyTone }) =>
    request<CopyDraft>("/api/crear/copies/generate", {
      method: "POST",
      auth: true,
      body,
      timeoutMs: AI_TIMEOUT_MS,
    }),
  listCopies: () => request<CopyDraft[]>("/api/crear/copies", { auth: true }),
  deleteCopy: (id: number) =>
    request<void>(`/api/crear/copies/${id}`, { method: "DELETE", auth: true }),
  listTrends: () => request<TrendNote[]>("/api/crear/trends", { auth: true }),
  createTrend: (body: { title: string; source?: string; summary?: string; published_on?: string | null }) =>
    request<TrendNote>("/api/crear/trends", { method: "POST", auth: true, body }),
  deleteTrend: (id: number) =>
    request<void>(`/api/crear/trends/${id}`, { method: "DELETE", auth: true }),
};
