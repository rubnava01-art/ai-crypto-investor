// Dominio system del API (extraído de lib/api.ts en Fase 4, sin cambios de comportamiento).
import { request, AI_TIMEOUT_MS, fetchMe } from "./client";
import type { AIAskResponse, AILessonsResponse, AIStatusResponse, BalancesResponse, DashboardResponse, HealthResponse, KillSwitchResponse, LogEntry, MarketPricesResponse, MeResponse, OperationsResponse, OrderOut, PerformanceResponse, RiskLimits, ScannerState, SignalsResponse, SimulationModes, StrategyOut, SystemStatus, TokenResponse } from "./types";

export const systemApi = {
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
  me: fetchMe,
  marketPrices: (opts?: { signal?: AbortSignal }) =>
    request<MarketPricesResponse>("/api/market/prices", { auth: true, retry: true, signal: opts?.signal }),
  dashboard: (opts?: { signal?: AbortSignal }) =>
    request<DashboardResponse>("/api/dashboard", { auth: true, retry: true, signal: opts?.signal }),
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
};
