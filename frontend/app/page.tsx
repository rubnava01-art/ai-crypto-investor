"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  api, getToken, setToken, ApiError,
  type SystemStatus, type BalancesResponse, type PerformanceResponse,
  type SignalsResponse, type StrategyOut, type SimulationModes,
  type OperationsResponse, type RiskLimits, type LogEntry, type SignalSide,
} from "../lib/api";
import { Panel } from "../components/Panel";
import { ModuleNav } from "../components/ModuleNav";
import { MarketPanel } from "../components/MarketPanel";
import { ProfileMenu } from "../components/ProfileMenu";
import type { MeResponse } from "../lib/api";
import { DemoBadge, StatusDot, EmptyState } from "../components/badges";
import { LanguageToggle, useLanguage } from "../lib/i18n";
import { Footer } from "../components/Footer";
import dynamic from "next/dynamic";

// Carga diferida (optimización): los paneles que NO son la vista inicial del
// dashboard se descargan solo cuando se renderizan — Invertir es solo-admin
// y el Asistente IA va al final de la página. MarketPanel (precios en vivo,
// arriba) se queda en el bundle principal. El control de usuarios vive en
// su propio módulo (/usuarios) desde 2026-10-30, no incrustado aquí.
const panelLoading = () => {
  const { t } = useLanguage();
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-6 text-sm text-zinc-500">
      {t.dashboard.panelLoading}
    </div>
  );
};
const InvestorPanel = dynamic(
  () => import("../components/InvestorPanel").then((m) => m.InvestorPanel),
  { ssr: false, loading: panelLoading },
);
const AiAssistant = dynamic(
  () => import("../components/AiAssistant").then((m) => m.AiAssistant),
  { ssr: false, loading: panelLoading },
);

const money = (s: string | null) =>
  s == null || s === "" ? "—" : `$${Number(s).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (s: string | null) => (s == null || s === "" ? "—" : `${Number(s).toFixed(2)}%`);
const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { timeZone: "UTC", hour12: false }) + " UTC" : "—";

const sideColor: Record<SignalSide, string> = {
  buy: "text-emerald-400",
  sell: "text-red-400",
  hold: "text-zinc-400",
};

function OfflineBanner({ apiUrl }: { apiUrl: string }) {
  const { t } = useLanguage();
  return (
    <div
      role="alert"
      className="mb-6 rounded-xl border border-amber-700/60 bg-amber-500/10 px-4 py-3 text-sm text-amber-300"
    >
      <strong className="font-semibold">{t.dashboard.offlineTitle}</strong> {t.dashboard.offlineBefore}{" "}
      <code className="text-amber-200">{apiUrl}</code>{t.dashboard.offlineAfter}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [offline, setOffline] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmKill, setConfirmKill] = useState(false);

  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [balances, setBalances] = useState<BalancesResponse | null>(null);
  const [performance, setPerformance] = useState<PerformanceResponse | null>(null);
  const [signals, setSignals] = useState<SignalsResponse | null>(null);
  const [strategies, setStrategies] = useState<StrategyOut[] | null>(null);
  const [sim, setSim] = useState<SimulationModes | null>(null);
  const [operations, setOperations] = useState<OperationsResponse | null>(null);
  const [risk, setRisk] = useState<RiskLimits | null>(null);
  const [logs, setLogs] = useState<LogEntry[] | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const isAdmin = !!me?.is_admin;
  // No renderizar el dashboard hasta confirmar sesión: antes, los paneles se
  // montaban y disparaban llamadas sin token (flash de UI privada).
  const [checked, setChecked] = useState(false);

  const load = useCallback(async () => {
    setActionError(null);
    // Intento con un reintento: un fallo transitorio de red no debe tirar
    // todo el dashboard al modo offline sin intentarlo de nuevo.
    const attempts = [0, 1];
    for (const i of attempts) {
      try {
        // Una sola petición agregada (antes eran 9): carga mucho más rápida.
        const d = await api.dashboard();
        setSystem(d.system); setBalances(d.balances); setPerformance(d.performance);
        setSignals(d.signals); setStrategies(d.strategies); setSim(d.modes);
        setOperations(d.operations); setRisk(d.risk); setLogs(d.logs);
        setOffline(false);
        // Tolerancia parcial del backend: una sección nula significa que esa
        // sección falló, no que todo el dashboard esté caído. Avisar sin
        // esconder el resto de los datos.
        if ([d.system, d.balances, d.performance, d.signals, d.strategies,
             d.modes, d.operations, d.risk, d.logs].some((s) => s == null)) {
          setActionError(t.dashboard.partialError);
        }
        api.me().then(setMe).catch(() => setMe(null));
        return;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setToken(null);
          router.replace("/login");
          return;
        }
        if (i === attempts.length - 1) {
          setOffline(true);
        } else {
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    }
  }, [router]);

  useEffect(() => {
    if (!getToken()) { router.replace("/login"); return; }
    setChecked(true);
    load();
  }, [load, router]);

  async function scanner(action: "start" | "stop") {
    try {
      const state = action === "start" ? await api.scannerStart() : await api.scannerStop();
      setSystem((prev) => (prev ? { ...prev, scanner_running: state.running } : prev));
    } catch (err) {
      setActionError(err instanceof ApiError ? (action === "start" ? t.dashboard.scannerStartError : t.dashboard.scannerStopError).replace("{detail}", err.message) : String(err));
    }
  }

  async function changeMode(mode: string) {
    try {
      const res = await api.setSimulationMode(mode);
      setSim(res);
    } catch (err) {
      setActionError(err instanceof ApiError ? t.dashboard.modeError.replace("{detail}", err.message) : String(err));
    }
  }

  async function engageKillSwitch() {
    try {
      const res = await api.killSwitch(crypto.randomUUID());
      setRisk((prev) => (prev ? { ...prev, kill_switch: res.kill_switch } : prev));
      setSystem((prev) => (prev ? { ...prev, kill_switch: res.kill_switch } : prev));
    } catch (err) {
      setActionError(err instanceof ApiError ? t.dashboard.killError.replace("{detail}", err.message) : String(err));
    } finally {
      setConfirmKill(false);
    }
  }

  function logout() {
    setToken(null);
    router.replace("/login");
  }

  const scanning = system?.scanner_running ?? false;

  if (!checked) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-6">
        <p className="text-sm text-zinc-400">{t.dashboard.loading}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-400">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            {t.header.brand}
          </p>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{t.dashboard.title}</h1>
          <p className="text-sm text-zinc-400">
            AI Crypto Investor — {system ? <>{t.dashboard.modeLabel} <span className="font-mono">{system.mode}</span></> : t.dashboard.loading}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LanguageToggle />
          <DemoBadge />
          <button
            onClick={load}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            {t.dashboard.refresh}
          </button>
          <ProfileMenu onLogout={logout} />
        </div>
      </header>

      <div className="mb-6">
        <ModuleNav />
      </div>

      {offline && <OfflineBanner apiUrl={process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"} />}      {actionError && (
        <p role="alert" className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {actionError}
        </p>
      )}

      <div className="mb-4">
        <MarketPanel />
      </div>

      {me && !isAdmin && (
        <div className="mb-4 rounded-xl border border-sky-700/60 bg-sky-500/10 px-4 py-3 text-sm text-sky-300">
          <strong className="font-semibold">{t.dashboard.testModeTitle}</strong> {t.dashboard.testModeBody}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* System status */}
        <Panel title={t.dashboard.systemTitle} badge={<DemoBadge />}>
          {system ? (
            <dl className="space-y-2 text-sm">
              {[
                [t.dashboard.exchangeConnected, <StatusDot key="e" on={system.exchange_connected} />],
                [t.dashboard.scanner, <StatusDot key="s" on={system.scanner_running} />],
                [t.dashboard.simulationMode, <span key="m" className="font-mono">{system.simulation_mode}</span>],
                [t.dashboard.killSwitch, <span key="k" className={system.kill_switch ? "font-semibold text-red-400" : ""}>{system.kill_switch ? t.dashboard.killOn : t.dashboard.killOff}</span>],
                [t.dashboard.dataSource, <span key="d" className="font-mono">{system.data_source}</span>],
                [t.dashboard.lastUpdate, <span key="u" className="font-mono text-xs">{time(system.last_update_utc)}</span>],
              ].map(([label, value]) => (
                <div key={label as string} className="flex items-center justify-between gap-2">
                  <dt className="text-zinc-400">{label}</dt>
                  <dd className="flex items-center gap-2">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <EmptyState text={offline ? t.dashboard.noDataDemo : t.dashboard.loading} />
          )}
        </Panel>

        {/* Equity & balance */}
        <Panel title={t.dashboard.capitalTitle} badge={<DemoBadge />}>
          {balances ? (
            <div>
              <p className="text-3xl font-bold tracking-tight">{money(balances.equity_usd)}</p>
              <p className="mt-1 text-sm text-zinc-400">
                {t.dashboard.available} <span className="text-zinc-200">{money(balances.available_usd)}</span>{" "}
                <span className="font-mono text-xs">{balances.currency}</span>
              </p>
              <p className="mt-3 text-xs text-zinc-500">{t.dashboard.asOf} {time(balances.as_of_utc)}</p>
            </div>
          ) : (
            <EmptyState text={offline ? t.dashboard.noDataDemo : t.dashboard.loading} />
          )}
        </Panel>

        {/* P&L + drawdown */}
        <Panel title={t.dashboard.pnlTitle} badge={<DemoBadge />}>
          {performance ? (
            <dl className="space-y-2 text-sm">
              {[
                [t.dashboard.realized, money(performance.realized_pnl_usd)],
                [t.dashboard.unrealized, money(performance.unrealized_pnl_usd)],
                [t.dashboard.maxDrawdown, pct(performance.max_drawdown_pct)],
                [t.dashboard.fees, money(performance.fees_paid_usd)],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between">
                  <dt className="text-zinc-400">{label}</dt>
                  <dd className="font-mono">{value}</dd>
                </div>
              ))}
              <p className="pt-2 text-xs text-zinc-500">{t.dashboard.asOf} {time(performance.as_of_utc)}</p>
            </dl>
          ) : (
            <EmptyState text={offline ? t.dashboard.noDataDemo : t.dashboard.loading} />
          )}
        </Panel>

        {/* Signals */}
        <Panel title={t.dashboard.signalsTitle} badge={<DemoBadge />}>
          {signals ? (
            signals.signals.length === 0 ? (
              <EmptyState text={t.dashboard.noSignals} />
            ) : (
              <ul className="space-y-3">
                {signals.signals.map((sig) => (
                  <li key={sig.id} className="rounded-lg border border-zinc-800 p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-semibold">{sig.symbol}</span>
                      <span className={`font-bold uppercase ${sideColor[sig.side]}`}>{sig.side}</span>
                    </div>
                    <div className="mt-1 grid grid-cols-3 gap-1 font-mono text-xs text-zinc-400">
                      <span>{t.dashboard.entry} {money(sig.entry_price)}</span>
                      <span>{t.dashboard.target} {money(sig.target_price)}</span>
                      <span>{t.dashboard.invalidation} {money(sig.invalidation_price)}</span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">{sig.reason}</p>
                    <p className="mt-1 text-[11px] text-zinc-600">
                      {sig.status} · {time(sig.created_utc)}
                    </p>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <EmptyState text={offline ? t.dashboard.noDataDemo : t.dashboard.loading} />
          )}
        </Panel>

        {/* Strategies */}
        <Panel title={t.dashboard.strategiesTitle}>
          {strategies ? (
            strategies.length === 0 ? (
              <EmptyState text={t.dashboard.noStrategies} />
            ) : (
              <ul className="space-y-2 text-sm">
                {strategies.map((s) => (
                  <li key={s.id} className="rounded-lg border border-zinc-800 p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{s.name}</span>
                      <span className="text-xs text-zinc-400">v{s.version} · {s.status}</span>
                    </div>
                    {s.notes && <p className="mt-1 text-xs text-zinc-500">{s.notes}</p>}
                  </li>
                ))}
              </ul>
            )
          ) : (
            <EmptyState text={offline ? t.dashboard.noData : t.dashboard.loading} />
          )}
        </Panel>

        {/* Invertir: entrar / salir / validar (solo admin) */}
        {isAdmin && (
          <InvestorPanel
            mode={sim?.current ?? "simulation"}
            realEnabled={sim?.real_enabled ?? false}
            equityUsd={balances ? Number(balances.equity_usd) : null}
            onExecuted={load}
          />
        )}

        {/* Scanner controls */}
        <Panel title={t.dashboard.scannerControlsTitle}>
          <div className="flex items-center gap-3">
            <StatusDot on={scanning} />
            <span className="text-sm text-zinc-300">{scanning ? t.dashboard.running : t.dashboard.stopped}</span>
          </div>
          {isAdmin ? (
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => scanner("start")}
              disabled={scanning}
              className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              {t.dashboard.start}
            </button>
            <button
              onClick={() => scanner("stop")}
              disabled={!scanning}
              className="flex-1 rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
            >
              {t.dashboard.stop}
            </button>
          </div>
          ) : (
            <p className="mt-3 text-xs text-zinc-500">{t.dashboard.controlsAdminOnly}</p>
          )}
        </Panel>

        {/* Simulation mode */}
        <Panel title={t.dashboard.simulationMode}>
          {sim ? (
            <div>
              <select aria-label={t.dashboard.simModeAria}
                value={sim.current}
                disabled={!isAdmin}
                onChange={(e) => changeMode(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sim.modes.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <p className="mt-2 text-xs text-zinc-500">
                {t.dashboard.realModePrefix} {sim.real_enabled ? t.dashboard.realModeOn : t.dashboard.realModeOff} {t.dashboard.realModeSuffix}
                {!isAdmin && <> {t.dashboard.changeModeAdminOnly}</>}
              </p>
            </div>
          ) : (
            <EmptyState text={offline ? t.dashboard.noData : t.dashboard.loading} />
          )}
        </Panel>

        {/* Risk limits + kill switch */}
        <Panel title={t.dashboard.riskTitle} badge={<DemoBadge />} accent>
          {risk ? (
            <div>
              <dl className="space-y-2 text-sm">
                {[
                  [t.dashboard.maxRisk, pct(risk.max_risk_per_trade_pct)],
                  [t.dashboard.maxDailyLoss, money(risk.max_daily_loss_usd)],
                  [t.dashboard.maxTrades, String(risk.max_trades_per_day)],
                  [t.dashboard.spotOnly, risk.spot_only ? t.dashboard.yes : t.dashboard.no],
                  [t.dashboard.noLeverage, risk.no_leverage ? t.dashboard.yes : t.dashboard.no],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between">
                    <dt className="text-zinc-400">{label}</dt>
                    <dd className="font-mono">{value}</dd>
                  </div>
                ))}
              </dl>
              {isAdmin && (
              <button
                onClick={() => setConfirmKill(true)}
                disabled={risk.kill_switch}
                className="mt-4 w-full rounded-lg bg-red-700 px-3 py-2 text-sm font-bold uppercase tracking-wider text-white hover:bg-red-600 disabled:opacity-40"
              >
                {risk.kill_switch ? t.dashboard.killActivated : t.dashboard.killSwitch}
              </button>
              )}
              {confirmKill && (
                <div className="mt-3 rounded-lg border border-red-800 bg-red-950/50 p-3 text-sm">
                  <p className="text-red-200">
                    {t.dashboard.killConfirmQ}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={engageKillSwitch}
                      className="flex-1 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500"
                    >
                      {t.dashboard.confirm}
                    </button>
                    <button
                      onClick={() => setConfirmKill(false)}
                      className="flex-1 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
                    >
                      {t.dashboard.cancel}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <EmptyState text={offline ? t.dashboard.noDataDemo : t.dashboard.loading} />
          )}
        </Panel>

        {/* Operations */}
        <Panel title={t.dashboard.operationsTitle}>
          {operations ? (
            operations.orders.length === 0 && operations.trades.length === 0 ? (
              <EmptyState text={t.dashboard.noOrdersOrTrades} />
            ) : (
              <div className="space-y-3 text-sm">
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase text-zinc-400">{t.dashboard.ordersTitle}</h3>
                  {operations.orders.length === 0 ? (
                    <p className="text-sm text-zinc-500">{t.dashboard.noOrders}</p>
                  ) : (
                    <ul className="space-y-2">
                      {operations.orders.map((o, i) => (
                        <li key={String(o["id"] ?? i)} className="rounded-lg border border-zinc-800 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono font-semibold">{String(o["symbol"] ?? "—")}</span>
                            <span className={`font-bold uppercase ${o["side"] === "sell" ? "text-red-400" : "text-emerald-400"}`}>
                              {String(o["side"] ?? "—")}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-zinc-400">
                            {t.dashboard.quantity} {String(o["quantity"] ?? "—")} · {String(o["status"] ?? "—")} · {String(o["mode"] ?? "—")}
                          </p>
                          <p className="mt-1 text-[11px] text-zinc-600">
                            {time(typeof o["created_utc"] === "string" ? o["created_utc"] : null)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {operations.trades.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase text-zinc-400">{t.dashboard.operationsTitle}</h3>
                    <ul className="space-y-2">
                      {operations.trades.map((tr, i) => (
                        <li key={i} className="rounded-lg border border-zinc-800 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono font-semibold">{String(tr["symbol"] ?? "—")}</span>
                            <span className={`font-bold uppercase ${tr["side"] === "sell" ? "text-red-400" : "text-emerald-400"}`}>
                              {String(tr["side"] ?? "—")}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-zinc-400">
                            {t.dashboard.quantity} {String(tr["quantity"] ?? "—")} · {String(tr["status"] ?? "—")}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )
          ) : (
            <EmptyState text={offline ? t.dashboard.noData : t.dashboard.loading} />
          )}
        </Panel>

        {/* Logs feed */}
        <Panel title={t.dashboard.logsTitle}>
          {logs ? (
            logs.length === 0 ? (
              <EmptyState text={t.dashboard.noLogs} />
            ) : (
              <ul className="max-h-64 space-y-1.5 overflow-auto text-xs">
                {logs.map((l) => (
                  <li key={l.id} className="flex gap-2 font-mono">
                    <span className="shrink-0 text-zinc-600">{time(l.created_utc)}</span>
                    <span className={`shrink-0 font-semibold ${
                      l.level === "ERROR" ? "text-red-400" : l.level === "WARNING" ? "text-amber-400" : "text-zinc-500"
                    }`}>
                      {l.level}
                    </span>
                    <span className="break-words text-zinc-400">
                      <span className="text-zinc-500">[{l.category}]</span> {l.message}
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <EmptyState text={offline ? t.dashboard.noData : t.dashboard.loading} />
          )}
        </Panel>

        {/* AI assistant (read-only technical) */}
        <AiAssistant />
      </div>

      <Footer />
    </main>
  );
}
