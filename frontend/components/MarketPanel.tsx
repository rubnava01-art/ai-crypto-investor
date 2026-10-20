"use client";

import { useEffect, useState, useCallback } from "react";
import { api, ApiError, type CoinPrice } from "../lib/api";
import { Panel } from "./Panel";

const COIN_STYLE: Record<string, { bg: string; glyph: string }> = {
  BTC: { bg: "#F7931A", glyph: "₿" },
  ETH: { bg: "#627EEA", glyph: "Ξ" },
  USDT: { bg: "#26A17B", glyph: "₮" },
  BNB: { bg: "#F0B90B", glyph: "⬢" },
};

function Sparkline({ data, up }: { data: number[]; up: boolean }) {
  if (data.length < 2) return <span className="text-xs text-zinc-600">—</span>;
  const w = 96;
  const h = 32;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - 3 - ((v - min) / span) * (h - 6)}`)
    .join(" ");
  const color = up ? "#10b981" : "#f43f5e";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function MarketPanel() {
  const [prices, setPrices] = useState<CoinPrice[] | null>(null);
  const [meta, setMeta] = useState<{ source: string; updated: string; stale: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.marketPrices();
      setPrices(r.prices);
      setMeta({ source: r.source, updated: r.updated_utc, stale: r.stale });
      setError(null);
    } catch (e) {
      if (!(e instanceof ApiError)) setError("No se pudo cargar el mercado.");
      else if (e.status === 503) setError("Mercado no disponible (sin conexión al exchange).");
      else setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <Panel title="Mercado en vivo" badge={meta ? <span className="text-xs font-normal normal-case tracking-normal text-zinc-500">Kraken · {meta.stale ? "datos de caché" : "actualizado"}</span> : undefined}>
      {error && <p className="py-4 text-center text-sm text-amber-400">{error}</p>}
      {!error && !prices && <p className="py-4 text-center text-sm text-zinc-500">Cargando precios…</p>}
      {prices && (
        <ul className="divide-y divide-zinc-800/70">
          {prices.map((c) => {
            const style = COIN_STYLE[c.symbol] ?? { bg: "#52525b", glyph: c.symbol.slice(0, 1) };
            const up = (c.change_24h_pct ?? 0) >= 0;
            return (
              <li key={c.symbol} className="flex items-center gap-3 py-3">
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl font-bold text-white"
                  style={{ backgroundColor: style.bg }}
                  aria-hidden
                >
                  {style.glyph}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-zinc-100">{c.name}</p>
                  <p className="text-xs uppercase tracking-wide text-zinc-500">{c.symbol}</p>
                </div>
                <div className="hidden sm:block">
                  <Sparkline data={c.sparkline_24h} up={up} />
                </div>
                <div className="w-32 text-right sm:w-36">
                  <p className="text-[15px] font-semibold tabular-nums text-zinc-100">
                    {c.price_usd == null
                      ? "—"
                      : `$${c.price_usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: c.price_usd < 10 ? 4 : 2 })}`}
                  </p>
                  <p className={`text-sm font-medium tabular-nums ${up ? "text-emerald-400" : "text-rose-400"}`}>
                    {c.change_24h_pct == null ? "—" : `${up ? "↗" : "↘"} ${Math.abs(c.change_24h_pct).toFixed(2)}%`}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {meta && (
        <p className="mt-1 text-[11px] text-zinc-600">
          Precios públicos de Kraken (solo lectura) · {new Date(meta.updated).toLocaleTimeString("en-US", { hour12: false })} UTC
        </p>
      )}
    </Panel>
  );
}
