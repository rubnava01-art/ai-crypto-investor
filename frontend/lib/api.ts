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

// ---------- fetch core ----------

async function request<T>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: boolean; idempotencyKey?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, `API unreachable (${API_URL})`);
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
    }),
  aiLessons: () => request<AILessonsResponse>("/api/ai/lessons", { auth: true }),
};
