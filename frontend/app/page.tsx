"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  api, getToken, setToken, ApiError,
  type SystemStatus, type BalancesResponse, type PerformanceResponse,
  type SignalsResponse, type StrategyOut, type SimulationModes,
  type OperationsResponse, type RiskLimits, type LogEntry, type SignalSide,
} from "../lib/api";
import { Panel } from "../components/Panel";
import { LoadMore, SkipLink, newId } from "../components/ui";
import { ModuleNav } from "../components/ModuleNav";
import { MarketPanel } from "../components/MarketPanel";
import { ProfileMenu } from "../components/ProfileMenu";
import type { MeResponse } from "../lib/api";
import { DemoBadge, StatusDot, EmptyState } from "../components/badges";
import { LanguageToggle, useLanguage } from "../lib/i18n";
import { Footer } from "../components/Footer";
import { ultimaNovedadSistema } from "../lib/novedades";
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
      className="mb-6 rounded-xl border border-amber-700/60 bg-amber-500/10 px-4 py-3.5 text-sm leading-relaxed text-amber-300"
    >
      <strong className="font-semibold">{t.dashboard.offlineTitle}</strong> {t.dashboard.offlineBefore}{" "}
      <code className="text-amber-200">{apiUrl}</code>{t.dashboard.offlineAfter}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const time = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(locale, { timeZone: "UTC", hour12: false }) + " UTC" : "—";
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
  const [logsVisible, setLogsVisible] = useState(25);
  const [me, setMe] = useState<MeResponse | null>(null);
  const isAdmin = !!me?.is_admin;
  // No renderizar el dashboard hasta confirmar sesión: antes, los paneles se
  // montaban y disparaban llamadas sin token (flash de UI privada).
  const [checked, setChecked] = useState(false);

  // Fase 4 (FE2): el reintento manual dormía 1,5s sin cancelación — al
  // navegar fuera en esa ventana, el setState posterior escribía en un
  // dashboard desmontado. La guarda se activa al desmontar el efecto.
  const loadCancelledRef = useRef(false);
  const load = useCallback(async () => {
    setActionError(null);
    // Intento con un reintento: un fallo transitorio de red no debe tirar
    // todo el dashboard al modo offline sin intentarlo de nuevo.
    const attempts = [0, 1];
    for (const i of attempts) {
      try {
        // Una sola petición agregada (antes eran 9): carga mucho más rápida.
        const d = await api.dashboard();
        if (loadCancelledRef.current) return;
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
        api.me().then((m) => { if (!loadCancelledRef.current) setMe(m); }).catch(() => { if (!loadCancelledRef.current) setMe(null); });
        return;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setToken(null);
          router.replace(`/login?next=${encodeURIComponent("/")}`);
          return;
        }
        if (i === attempts.length - 1) {
          if (!loadCancelledRef.current) setOffline(true);
        } else {
          await new Promise((r) => setTimeout(r, 1500));
          if (loadCancelledRef.current) return;
        }
      }
    }
  }, [router]);

  useEffect(() => {
    if (!getToken()) { router.replace(`/login?next=${encodeURIComponent("/")}`); return; }
    loadCancelledRef.current = false;
    setChecked(true);
    load();
    return () => {
      loadCancelledRef.current = true;
    };
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
      const res = await api.killSwitch(newId());
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
  // Última novedad del sistema (estática, viaja en el bundle): si no hay
  // ninguna, la tira no se muestra. No es un post del administrador.
  const novedad = ultimaNovedadSistema();

  if (!checked) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div role="status" aria-label={t.dashboard.loading} className="space-y-4">
          <div aria-hidden="true" className="h-8 w-48 motion-safe:animate-pulse rounded-lg bg-zinc-800" />
          <div aria-hidden="true" className="h-40 motion-safe:animate-pulse rounded-xl bg-zinc-900/70" />
          <div aria-hidden="true" className="h-40 motion-safe:animate-pulse rounded-xl bg-zinc-900/70" />
        </div>
      </main>
    );
  }

  return (
    <main className="relative mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <SkipLink label={t.shell.skipLink} />
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 sm:mb-8">
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
            className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            {t.dashboard.refresh}
          </button>
          <ProfileMenu onLogout={logout} />
        </div>
      </header>

      <div className="mb-6 sm:mb-8">
        <ModuleNav />
      </div>

      {novedad && (
        <div className="mb-5 rounded-xl border border-emerald-900/60 bg-emerald-500/10 px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
              {t.inicio.systemNews}
            </span>
            <span className="text-sm font-semibold text-zinc-100">{novedad.title}</span>
            <a
              href="/inicio"
              className="ml-auto inline-flex min-h-[44px] items-center rounded-lg px-2 py-2 text-sm font-semibold text-emerald-400 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              {t.inicio.viewInInicio}
            </a>
          </div>
        </div>
      )}

      {offline && <OfflineBanner apiUrl={process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"} />}      {actionError && (
        <p role="alert" className="mb-5 rounded-lg bg-red-500/10 px-4 py-3 text-sm leading-relaxed text-red-400">
          {actionError}
        </p>
      )}

      <section id="contenido" tabIndex={-1} aria-label={t.dashboard.heroHeading} className="mb-6 outline-none sm:mb-8">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">{t.dashboard.heroHeading}</h2>
      <div className="mb-5">
        <MarketPanel />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2">
        {/* Equity & balance */}
        <Panel title={t.dashboard.capitalTitle} badge={<DemoBadge quiet />}>
          {balances ? (
            <div>
              <p className="text-3xl font-bold tracking-tight tabular-nums sm:text-4xl">{money(balances.equity_usd)}</p>
              <p className="mt-1 text-sm text-zinc-400">
                {t.dashboard.available} <span className="text-zinc-200">{money(balances.available_usd)}</span>{" "}
                <span className="font-mono text-xs">{balances.currency}</span>
              </p>
              <p className="mt-3 text-xs text-zinc-400">{t.dashboard.asOf} {time(balances.as_of_utc)}</p>
            </div>
          ) : (
            <EmptyState text={offline ? t.dashboard.noDataDemo : t.dashboard.loading} />
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

      </div>
      </section>

      {me && !isAdmin && (
        <div className="mb-5 rounded-xl border border-sky-700/60 bg-sky-500/10 px-4 py-3.5 text-sm leading-relaxed text-sky-300">
          <strong className="font-semibold">{t.dashboard.testModeTitle}</strong> {t.dashboard.testModeBody}
        </div>
      )}

      <section aria-label={t.dashboard.secondaryHeading} className="mb-6 sm:mb-8">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">{t.dashboard.secondaryHeading}</h2>
      <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-3">
        {/* System status */}
        <Panel title={t.dashboard.systemTitle} badge={<DemoBadge quiet />}>
          {system ? (
            <dl className="space-y-2.5 text-sm">
              {[
                [t.dashboard.exchangeConnected, <StatusDot key="e" on={system.exchange_connected} srText={system.exchange_connected ? t.reliability.statusConnected : t.reliability.statusDisconnected} />],
                [t.dashboard.scanner, <StatusDot key="s" on={system.scanner_running} srText={system.scanner_running ? t.dashboard.running : t.dashboard.stopped} />],
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

        {/* Strategies */}
        <Panel title={t.dashboard.strategiesTitle}>
          {strategies ? (
            strategies.length === 0 ? (
              <EmptyState text={t.dashboard.noStrategies} />
            ) : (
              <ul className="space-y-2 text-sm">
                {strategies.map((s) => (
                  <li key={s.id} className="rounded-lg border border-zinc-800 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{s.name}</span>
                      <span className="shrink-0 text-xs text-zinc-400">v{s.version} · {s.status}</span>
                    </div>
                    {s.notes && <p className="mt-1 text-xs leading-relaxed text-zinc-400">{s.notes}</p>}
                  </li>
                ))}
              </ul>
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
              <>
              <ul className="max-h-64 space-y-1.5 overflow-auto text-xs">
                {logs.slice(0, logsVisible).map((l) => (
                  <li key={l.id} className="flex gap-2 font-mono">
                    <span className="shrink-0 text-zinc-500">{time(l.created_utc)}</span>
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
              <LoadMore visible={logsVisible} total={logs.length} t={t} onLoadMore={() => setLogsVisible((v) => v + 25)} />
              </>
            )
          ) : (
            <EmptyState text={offline ? t.dashboard.noData : t.dashboard.loading} />
          )}
        </Panel>

      </div>
      </section>

      <section aria-label={t.dashboard.controlTitle} className="mb-6 sm:mb-8">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">{t.dashboard.controlTitle}</h2>
      <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-3">
        {/* Scanner controls */}
        <Panel title={t.dashboard.scannerControlsTitle}>
          <div className="flex items-center gap-3">
            <StatusDot on={scanning} srText={scanning ? t.dashboard.running : t.dashboard.stopped} />
            <span className="text-sm text-zinc-300">{scanning ? t.dashboard.running : t.dashboard.stopped}</span>
          </div>
          {isAdmin ? (
          <div className="mt-4 flex gap-2.5">
            <button
              onClick={() => scanner("start")}
              disabled={scanning}
              className="min-h-[44px] flex-1 rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              {t.dashboard.start}
            </button>
            <button
              onClick={() => scanner("stop")}
              disabled={!scanning}
              className="min-h-[44px] flex-1 rounded-lg border border-zinc-700 px-3 py-2.5 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
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
                className="min-h-[44px] w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sim.modes.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <p className="mt-3 text-xs leading-relaxed text-zinc-400">
                {t.dashboard.realModePrefix} {sim.real_enabled ? t.dashboard.realModeOn : t.dashboard.realModeOff} {t.dashboard.realModeSuffix}
                {!isAdmin && <> {t.dashboard.changeModeAdminOnly}</>}
              </p>
            </div>
          ) : (
            <EmptyState text={offline ? t.dashboard.noData : t.dashboard.loading} />
          )}
        </Panel>

        {/* Risk limits + kill switch */}
        <Panel title={t.dashboard.riskTitle} badge={<DemoBadge quiet />} accent>
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
                className="mt-5 min-h-[44px] w-full rounded-lg bg-red-700 px-3 py-2.5 text-sm font-bold uppercase tracking-wider text-white hover:bg-red-600 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60"
              >
                {risk.kill_switch ? t.dashboard.killActivated : t.dashboard.killSwitch}
              </button>
              )}
              {confirmKill && (
                <div className="mt-4 rounded-lg border border-red-800 bg-red-950/50 p-3.5 text-sm leading-relaxed">
                  <p className="text-red-200">
                    {t.dashboard.killConfirmQ}
                  </p>
                  <div className="mt-3 flex gap-2.5">
                    <button
                      onClick={engageKillSwitch}
                      className="min-h-[44px] flex-1 rounded-lg bg-red-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60"
                    >
                      {t.dashboard.confirm}
                    </button>
                    <button
                      onClick={() => setConfirmKill(false)}
                      className="min-h-[44px] flex-1 rounded-lg border border-zinc-700 px-3 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
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

      </div>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-3">
        {/* P&L + drawdown */}
        <Panel title={t.dashboard.pnlTitle} badge={<DemoBadge quiet />}>
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
              <p className="pt-2 text-xs text-zinc-400">{t.dashboard.asOf} {time(performance.as_of_utc)}</p>
            </dl>
          ) : (
            <EmptyState text={offline ? t.dashboard.noDataDemo : t.dashboard.loading} />
          )}
        </Panel>

        {/* Signals */}
        <Panel title={t.dashboard.signalsTitle} badge={<DemoBadge quiet />}>
          {signals ? (
            signals.signals.length === 0 ? (
              <EmptyState text={t.dashboard.noSignals} />
            ) : (
              <ul className="space-y-3">
                {signals.signals.map((sig) => (
                  <li key={sig.id} className="rounded-lg border border-zinc-800 p-3.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold">{sig.symbol}</span>
                      <span className={`shrink-0 font-bold uppercase ${sideColor[sig.side]}`}>{sig.side}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-1 font-mono text-xs text-zinc-400 sm:grid-cols-3">
                      <span>{t.dashboard.entry} {money(sig.entry_price)}</span>
                      <span>{t.dashboard.target} {money(sig.target_price)}</span>
                      <span>{t.dashboard.invalidation} {money(sig.invalidation_price)}</span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-zinc-400">{sig.reason}</p>
                    <p className="mt-1 text-xs text-zinc-500">
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
                          <p className="mt-1 text-xs text-zinc-500">
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

        {/* AI assistant (read-only technical) */}
        <AiAssistant />
      </div>

      <Footer />
    </main>
  );
}
