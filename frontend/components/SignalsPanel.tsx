"use client";

import { Panel } from "../components/Panel";
import { DemoBadge, EmptyState } from "../components/badges";
import { useLanguage } from "../lib/i18n";
import type { SignalsResponse, SignalSide } from "../lib/api";

const money = (s: string | null) =>
  s == null || s === "" ? "—" : `$${Number(s).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sideColor: Record<SignalSide, string> = {
  buy: "text-emerald-400",
  sell: "text-red-400",
  hold: "text-zinc-400",
};

type SignalsPanelProps = {
  signals: SignalsResponse | null;
  offline: boolean;
  time: (iso: string | null) => string;
};

/**
 * Señales del dashboard (C4, optimización 2026-11-14): extraída de
 * app/page.tsx para cargarla diferida — vive bajo el pliegue, en la
 * rejilla inferior, y no es contenido inicial. Solo presenta datos que
 * ya trae api.dashboard(); no dispara ninguna petición propia.
 */
export function SignalsPanel({ signals, offline, time }: SignalsPanelProps) {
  const { t } = useLanguage();
  // 2026-11-16: lado y estado se mostraban en inglés crudo ("BUY",
  // "demo") en la interfaz en español; ahora se traducen con las claves
  // dashboard.signal* y un estado desconocido cae al valor crudo.
  const sideLabel: Record<SignalSide, string> = {
    buy: t.dashboard.signalBuy,
    sell: t.dashboard.signalSell,
    hold: t.dashboard.signalHold,
  };
  const statusLabel: Record<string, string> = {
    generated: t.dashboard.signalStatusGenerated,
    approved: t.dashboard.signalStatusApproved,
    rejected: t.dashboard.signalStatusRejected,
    executed: t.dashboard.signalStatusExecuted,
    expired: t.dashboard.signalStatusExpired,
    demo: t.dashboard.signalStatusDemo,
  };
  return (
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
                  <span className={`shrink-0 font-bold uppercase ${sideColor[sig.side]}`}>{sideLabel[sig.side]}</span>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-1 font-mono text-xs text-zinc-400 sm:grid-cols-3">
                  <span>{t.dashboard.entry} {money(sig.entry_price)}</span>
                  <span>{t.dashboard.target} {money(sig.target_price)}</span>
                  <span>{t.dashboard.invalidation} {money(sig.invalidation_price)}</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-zinc-400">{sig.reason}</p>
                <p className="mt-1 text-xs text-zinc-400">
                  {statusLabel[sig.status] ?? sig.status} · {time(sig.created_utc)}
                </p>
              </li>
            ))}
          </ul>
        )
      ) : (
        <EmptyState text={offline ? t.dashboard.noDataDemo : t.dashboard.loading} />
      )}
    </Panel>
  );
}

