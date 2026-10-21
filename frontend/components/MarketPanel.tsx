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

// Kraken WS v1 usa XBT para BTC en los nombres de par.
const PAIR_TO_SYMBOL: Record<string, string> = {
  "XBT/USD": "BTC",
  "ETH/USD": "ETH",
  "USDT/USD": "USDT",
  "BNB/USD": "BNB",
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
  const [live, setLive] = useState<Record<string, number>>({});
  const [wsLive, setWsLive] = useState(false);

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

    // Ticks en tiempo real directo del WebSocket público de Kraken (sin clave),
    // con reconexión automática con backoff exponencial si la conexión cae.
    let ws: WebSocket | null = null;
    let retryDelay = 2_000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    const connect = () => {
      if (unmounted) return;
      const sock = new WebSocket("wss://ws.kraken.com");
      ws = sock;
      sock.onopen = () => {
        retryDelay = 2_000; // la conexión funcionó: reiniciar el backoff
        setWsLive(true);
        sock.send(
          JSON.stringify({
            event: "subscribe",
            pair: Object.keys(PAIR_TO_SYMBOL),
            subscription: { name: "ticker" },
          })
        );
      };
      sock.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string);
          if (Array.isArray(msg) && msg.length >= 4 && msg[2] === "ticker") {
            const sym = PAIR_TO_SYMBOL[msg[3] as string];
            const price = parseFloat(msg[1]?.c?.[0]);
            if (sym && Number.isFinite(price)) {
              setLive((prev) => ({ ...prev, [sym]: price }));
            }
          }
        } catch {
          /* ignorar frames malformados */
        }
      };
      const down = () => {
        setWsLive(false);
        // onerror llega antes que onclose: programar un solo reintento
        if (!unmounted && retryTimer === null) {
          retryTimer = setTimeout(() => {
            retryTimer = null;
            connect();
          }, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 30_000);
        }
      };
      sock.onerror = down;
      sock.onclose = down;
    };
    connect();

    return () => {
      unmounted = true;
      clearInterval(t);
      if (retryTimer) clearTimeout(retryTimer);
      try {
        ws?.close();
      } catch {
        /* ya cerrado */
      }
    };
  }, [load]);

  const liveBadge = wsLive ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
      </span>
      EN VIVO
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-700/40 px-2.5 py-1 text-xs font-semibold text-zinc-400">
      actualizando…
    </span>
  );

  return (
    <Panel title="Mercado en vivo" badge={liveBadge}>
      {error && <p className="py-4 text-center text-sm text-amber-400">{error}</p>}
      {!error && !prices && <p className="py-4 text-center text-sm text-zinc-500">Cargando precios…</p>}
      {prices && (
        <ul className="divide-y divide-zinc-800/70">
          {prices.map((c) => {
            const style = COIN_STYLE[c.symbol] ?? { bg: "#52525b", glyph: c.symbol.slice(0, 1) };
            const up = (c.change_24h_pct ?? 0) >= 0;
            const price = live[c.symbol] ?? c.price_usd;
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
                    {price == null
                      ? "—"
                      : `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: price < 10 ? 4 : 2 })}`}
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
          {wsLive
            ? "Precios en tiempo real (WebSocket público de Kraken) · cambio 24h cada minuto"
            : `Precios públicos de Kraken (solo lectura) · ${new Date(meta.updated).toLocaleTimeString("en-US", { hour12: false })} UTC`}
        </p>
      )}
    </Panel>
  );
}
