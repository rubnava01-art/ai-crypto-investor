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
  system: SystemStatus | null;
  balances: BalancesResponse | null;
  performance: PerformanceResponse | null;
  signals: SignalsResponse | null;
  strategies: StrategyOut[] | null;
  modes: SimulationModes | null;
  operations: OperationsResponse | null;
  risk: RiskLimits | null;
  logs: LogEntry[] | null;
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

// ---------- Espacio (meditación y revelaciones) ----------

export interface Revelation {
  id: number;
  title: string;
  text: string;
  created_at: string | null;
}

// ---------- Clases (Estudiar) ----------

export type EduClassKind = "grabada" | "envivo";

export interface EduClass {
  id: number;
  kind: EduClassKind;
  title: string;
  description: string;
  url: string;
  scheduled_at: string | null;
  duration_min: number | null;
  created_at: string | null;
}

// ---------- Correos ----------

export interface EmailTemplate {
  id: number;
  name: string;
  subject: string;
  body: string;
  created_at: string | null;
}

export type EmailLogStatus = "preparado" | "enviado";

export interface EmailLog {
  id: number;
  contact_id: number | null;
  contact_name: string;
  contact_email: string;
  template_name: string;
  subject: string;
  body: string;
  status: EmailLogStatus;
  created_at: string | null;
}

// ---------- Facturas ----------

export interface InvoiceItem {
  description: string;
  qty: number;
  unit_price: number;
}

export type InvoiceStatus = "borrador" | "enviada" | "pagada";

export interface Invoice {
  id: number;
  number: string;
  client_name: string;
  client_email: string;
  client_phone: string;
  items: InvoiceItem[];
  tax_rate: number;
  status: InvoiceStatus;
  notes: string;
  created_at: string | null;
}

// ---------- Referidos (Plataforma Unificada — módulo Referidos) ----------
// Las recompensas solo se REGISTRAN (pendiente/confirmada/recompensada):
// v1 no procesa pagos ni mueve dinero.

export type ReferralRewardType = "fixed" | "percentage";
export type ReferralCampaignStatus = "active" | "paused" | "ended";
export type ReferralStatus = "pending" | "confirmed" | "rewarded";

export interface ReferralCampaign {
  id: number;
  name: string;
  business_contact_id: number | null;
  business_name: string | null;
  share_code: string;
  reward_type: ReferralRewardType;
  reward_value: string;
  reward_note: string;
  status: ReferralCampaignStatus;
  referrals_count: number;
  confirmed_count: number;
  rewarded_count: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface ReferralCampaignInput {
  name: string;
  business_contact_id?: number | null;
  reward_type?: ReferralRewardType;
  reward_value?: string;
  reward_note?: string;
  status?: ReferralCampaignStatus;
}

export interface Referral {
  id: number;
  campaign_id: number;
  referrer_name: string;
  referrer_contact: string;
  referred_name: string;
  referred_contact: string;
  code: string;
  status: ReferralStatus;
  notes: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface ReferralInput {
  referrer_name: string;
  referrer_contact?: string;
  referred_name: string;
  referred_contact?: string;
  code?: string;
  notes?: string;
}

// ---------- Business (Plataforma Unificada — módulo Business) ----------
// Cada área (Marketing, Ventas, Legal, Administrativo) tiene sus PROPIAS
// notas y tareas: el backend las filtra por área y nunca las mezcla.

export type BusinessArea = "marketing" | "ventas" | "legal" | "administrativo";

export interface BusinessNote {
  id: number;
  area: BusinessArea;
  title: string;
  body: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface BusinessTask {
  id: number;
  area: BusinessArea;
  title: string;
  done: boolean;
  created_at: string | null;
  updated_at: string | null;
}

// ---------- fetch core ----------

// Default per-request timeout: a hung backend must never block the UI forever.
// /api/ai/ask may legitimately take longer, so it opts into a longer timeout.
const DEFAULT_TIMEOUT_MS = 30_000;
const AI_TIMEOUT_MS = 120_000;

// Único punto de fetch con timeout: request() (JSON) y downloadCoursePdf
// (blob) lo comparten en vez de duplicar el AbortController. Un timeout se
// reporta como timeout, no como "API unreachable".
async function fetchTimed(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(0, `API timeout (${timeoutMs / 1000}s) en ${label}`);
    }
    throw new ApiError(0, `API unreachable (${API_URL})`);
  } finally {
    clearTimeout(timer);
  }
}

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

  const res = await fetchTimed(
    `${API_URL}${path}`,
    {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    },
    timeoutMs,
    path,
  );
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
  // Robustez: un 2xx con cuerpo vacío o no-JSON (p. ej. un error del proxy
  // de Render que llega con 200) antes lanzaba un SyntaxError crudo que
  // ningún panel sabía mostrar; ahora es un ApiError como cualquier otro.
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(0, `Respuesta no válida del API en ${path}`);
  }
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
    const path = `/api/academy/courses/${courseId}/download`;
    const res = await fetchTimed(
      `${API_URL}${path}`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: "no-store",
      },
      DEFAULT_TIMEOUT_MS,
      path,
    );
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
  listRevelations: () => request<Revelation[]>("/api/espacio/revelations", { auth: true }),
  createRevelation: (body: { title: string; text?: string }) =>
    request<Revelation>("/api/espacio/revelations", { method: "POST", auth: true, body }),
  deleteRevelation: (id: number) =>
    request<void>(`/api/espacio/revelations/${id}`, { method: "DELETE", auth: true }),
  listInvoices: () => request<Invoice[]>("/api/facturas/invoices", { auth: true }),
  createInvoice: (body: { number?: string; client_name: string; client_email?: string; client_phone?: string; items: InvoiceItem[]; tax_rate?: number; notes?: string }) =>
    request<Invoice>("/api/facturas/invoices", { method: "POST", auth: true, body }),
  updateInvoiceStatus: (id: number, status: InvoiceStatus) =>
    request<Invoice>(`/api/facturas/invoices/${id}`, { method: "PATCH", auth: true, body: { status } }),
  deleteInvoice: (id: number) =>
    request<void>(`/api/facturas/invoices/${id}`, { method: "DELETE", auth: true }),
  listClasses: (kind?: EduClassKind) =>
    request<EduClass[]>(`/api/clases/classes${kind ? `?kind=${kind}` : ""}`, { auth: true }),
  createClass: (body: { kind: EduClassKind; title: string; description?: string; url?: string; scheduled_at?: string | null; duration_min?: number | null }) =>
    request<EduClass>("/api/clases/classes", { method: "POST", auth: true, body }),
  deleteClass: (id: number) =>
    request<void>(`/api/clases/classes/${id}`, { method: "DELETE", auth: true }),
  listEmailTemplates: () => request<EmailTemplate[]>("/api/correos/templates", { auth: true }),
  createEmailTemplate: (body: { name: string; subject?: string; body?: string }) =>
    request<EmailTemplate>("/api/correos/templates", { method: "POST", auth: true, body }),
  deleteEmailTemplate: (id: number) =>
    request<void>(`/api/correos/templates/${id}`, { method: "DELETE", auth: true }),
  listEmailLogs: () => request<EmailLog[]>("/api/correos/logs", { auth: true }),
  createEmailLog: (body: { contact_id?: number | null; contact_name: string; contact_email?: string; template_name?: string; subject?: string; body?: string }) =>
    request<EmailLog>("/api/correos/logs", { method: "POST", auth: true, body }),
  updateEmailLogStatus: (id: number, status: EmailLogStatus) =>
    request<EmailLog>(`/api/correos/logs/${id}`, { method: "PATCH", auth: true, body: { status } }),
  deleteEmailLog: (id: number) =>
    request<void>(`/api/correos/logs/${id}`, { method: "DELETE", auth: true }),
  listReferralCampaigns: (status?: string) => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return request<ReferralCampaign[]>(`/api/referrals/campaigns${qs}`, { auth: true });
  },
  createReferralCampaign: (body: ReferralCampaignInput) =>
    request<ReferralCampaign>("/api/referrals/campaigns", { method: "POST", auth: true, body }),
  updateReferralCampaign: (id: number, body: ReferralCampaignInput) =>
    request<ReferralCampaign>(`/api/referrals/campaigns/${id}`, { method: "PUT", auth: true, body }),
  listReferrals: (campaignId: number, status?: string) => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return request<Referral[]>(`/api/referrals/campaigns/${campaignId}/referrals${qs}`, { auth: true });
  },
  registerReferral: (campaignId: number, body: ReferralInput) =>
    request<Referral>(`/api/referrals/campaigns/${campaignId}/referrals`, { method: "POST", auth: true, body }),
  updateReferralStatus: (id: number, status: ReferralStatus) =>
    request<Referral>(`/api/referrals/referrals/${id}`, { method: "PATCH", auth: true, body: { status } }),
  listBusinessNotes: (area: BusinessArea) =>
    request<BusinessNote[]>(`/api/business/${area}/notes`, { auth: true }),
  createBusinessNote: (area: BusinessArea, body: { title: string; body?: string }) =>
    request<BusinessNote>(`/api/business/${area}/notes`, { method: "POST", auth: true, body }),
  updateBusinessNote: (id: number, body: { title?: string; body?: string }) =>
    request<BusinessNote>(`/api/business/notes/${id}`, { method: "PUT", auth: true, body }),
  deleteBusinessNote: (id: number) =>
    request<void>(`/api/business/notes/${id}`, { method: "DELETE", auth: true }),
  listBusinessTasks: (area: BusinessArea) =>
    request<BusinessTask[]>(`/api/business/${area}/tasks`, { auth: true }),
  createBusinessTask: (area: BusinessArea, body: { title: string }) =>
    request<BusinessTask>(`/api/business/${area}/tasks`, { method: "POST", auth: true, body }),
  updateBusinessTask: (id: number, body: { title?: string; done?: boolean }) =>
    request<BusinessTask>(`/api/business/tasks/${id}`, { method: "PATCH", auth: true, body }),
  deleteBusinessTask: (id: number) =>
    request<void>(`/api/business/tasks/${id}`, { method: "DELETE", auth: true }),
};
