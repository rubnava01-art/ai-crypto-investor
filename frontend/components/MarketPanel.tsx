"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { api, ApiError, type CoinPrice } from "../lib/api";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";
import { useCancelled } from "../lib/useLoad";
import { apiErrorText } from "./ui";

// URL del WebSocket público de Kraken por variable de entorno (Fase 4,
// FE12), con el valor actual como fallback y aviso ruidoso si falta (sin
// fallar en producción: el fallback sigue funcionando).
export const KRAKEN_WS_URL = process.env.NEXT_PUBLIC_KRAKEN_WS_URL ?? "wss://ws.kraken.com";
if (typeof window !== "undefined" && !process.env.NEXT_PUBLIC_KRAKEN_WS_URL) {
  console.warn("[market] NEXT_PUBLIC_KRAKEN_WS_URL no definida: usando wss://ws.kraken.com.");
}

// Un tick WS se considera fresco durante ~60s (mismo umbral que el stale
// del REST): pasado ese tiempo, el precio en vivo se atenúa y la nota de
// pie recibe el mismo tratamiento stale que el REST (FE4).
const WS_FRESH_MS = 60_000;

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
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState<Record<string, { price: number; at: number }>>({});
  const [wsLive, setWsLive] = useState(false);
  // Reloj para reevaluar la frescura de los ticks aunque no lleguen nuevos.
  const [now, setNow] = useState(() => Date.now());
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const isCancelled = useCancelled();
  const restAbortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    restAbortRef.current?.abort();
    const ctrl = new AbortController();
    restAbortRef.current = ctrl;
    setLoading(true);
    try {
      const r = await api.marketPrices({ signal: ctrl.signal });
      if (isCancelled() || ctrl.signal.aborted) return;
      setPrices(r.prices);
      setMeta({ source: r.source, updated: r.updated_utc, stale: r.stale });
      setError(null);
    } catch (e) {
      if (ctrl.signal.aborted || isCancelled()) return;
      if (!(e instanceof ApiError)) setError(t.market.loadFailed);
      else if (e.status === 503) setError(t.market.unavailable);
      else setError(apiErrorText(e, t));
    } finally {
      // Solo la carga vigente apaga el estado: una carga abortada por
      // un clic nuevo no debe apagar el "Actualizando…" de la nueva.
      if (restAbortRef.current === ctrl) setLoading(false);
    }
  }, [isCancelled, t]);

  useEffect(() => {
    load();
    // Como el Chat (optimización 2026-10-28): con la pestaña oculta el
    // sondeo REST de 60s no aporta nada — los ticks del WebSocket ya
    // mantienen el precio en vivo al volver — y solo gasta peticiones.
    const t = setInterval(() => {
      if (document.hidden) return;
      load();
    }, 60_000);
    // Reevaluar frescura cada 15s: un tick deja de ser fresco a los 60s
    // aunque no llegue ningún evento nuevo que dispare un render.
    const freshness = setInterval(() => setNow(Date.now()), 15_000);

    // Ticks en tiempo real directo del WebSocket público de Kraken (sin clave),
    // con reconexión automática con backoff exponencial si la conexión cae.
    let ws: WebSocket | null = null;
    let retryDelay = 2_000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    const connect = () => {
      if (unmounted) return;
      const sock = new WebSocket(KRAKEN_WS_URL);
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
              setLive((prev) => ({ ...prev, [sym]: { price, at: Date.now() } }));
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
      clearInterval(freshness);
      restAbortRef.current?.abort();
      if (retryTimer) clearTimeout(retryTimer);
      try {
        ws?.close();
      } catch {
        /* ya cerrado */
      }
    };
  }, [load]);

  // Frescura WS: conectado Y con al menos un tick reciente. Si no, el
  // panel vuelve al mismo tratamiento stale que el REST (nota ámbar) y los
  // precios en vivo se atenúan en vez de mostrarse como actuales.
  const lastTickAt = Math.max(0, ...Object.values(live).map((v) => v.at));
  const wsFresh = wsLive && lastTickAt > 0 && now - lastTickAt <= WS_FRESH_MS;
  const liveBadge = wsFresh ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
      </span>
      {t.market.live}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-700/40 px-2.5 py-1 text-xs font-semibold text-zinc-400">
      {t.market.updating}
    </span>
  );

  return (
    <Panel title={t.market.title} badge={liveBadge}>
      {error && <p role="alert" className="py-6 text-center text-sm leading-relaxed text-amber-400">{error}</p>}
      {!error && !prices && <p className="py-6 text-center text-sm text-zinc-400">{t.market.loadingPrices}</p>}
      {prices && (
        <ul className="divide-y divide-zinc-800/70">
          {prices.map((c) => {
            const style = COIN_STYLE[c.symbol] ?? { bg: "#52525b", glyph: c.symbol.slice(0, 1) };
            const up = (c.change_24h_pct ?? 0) >= 0;
            const liveEntry = live[c.symbol];
            const liveFresh = wsFresh && liveEntry !== undefined;
            const price = liveEntry?.price ?? c.price_usd;
            const priceStale = liveEntry !== undefined && !liveFresh;
            return (
              <li key={c.symbol} className="flex items-center gap-3 py-3.5 sm:gap-4">
                <span
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-xl font-bold text-white"
                  style={{ backgroundColor: style.bg }}
                  aria-hidden
                >
                  {style.glyph}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-zinc-100">{c.name}</p>
                  <p className="text-xs uppercase tracking-wide text-zinc-400">{c.symbol}</p>
                </div>
                <div className="hidden sm:block">
                  <Sparkline data={c.sparkline_24h} up={up} />
                </div>
                <div className="w-[7.5rem] shrink-0 text-right sm:w-36">
                  <p className={`text-base font-semibold tabular-nums ${priceStale ? "text-zinc-400 opacity-60" : "text-zinc-100"}`} title={priceStale ? t.reliability.stalePrice : undefined}>
                    {price == null
                      ? "—"
                      : `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: price < 10 ? 4 : 2 })}`}
                  </p>
                  <p className={`text-sm font-semibold tabular-nums ${up ? "text-emerald-400" : "text-rose-400"}`}>
                    <span className="sr-only">{up ? t.market.directionUp : t.market.directionDown} </span>
                    {c.change_24h_pct == null ? "—" : `${up ? "↗" : "↘"} ${Math.abs(c.change_24h_pct).toFixed(2)}%`}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {meta && (
        <p
          className={`mt-3 text-xs leading-relaxed ${!wsFresh && (meta.stale || lastTickAt > 0) ? "text-amber-400" : "text-zinc-500"}`}
          role={!wsFresh && (meta.stale || lastTickAt > 0) ? "status" : undefined}
        >
          {wsFresh
            ? t.market.liveNote
            : meta.stale || lastTickAt > 0
              ? t.market.staleNote.replace("{time}", new Date(meta.updated).toLocaleTimeString(locale, { hour12: false }))
              : t.market.publicNote.replace("{time}", new Date(meta.updated).toLocaleTimeString(locale, { hour12: false }))}
        </p>
      )}
      <button
        type="button"
        onClick={load}
        disabled={loading}
        className="mt-3 min-h-[44px] w-full rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 hover:border-zinc-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? t.market.refreshing : t.market.refresh}
      </button>
    </Panel>
  );
}
