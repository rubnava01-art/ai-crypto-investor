"use client";

// Herramientas de Clases (2026-11-10): calculadora de interés compuesto
// (100% navegador), conversor BTC/USD en vivo, gráfica BTC 1h en SVG hecha
// a mano (sin librerías nuevas), tira de indicadores y contenido educativo
// estático sobre Bitcoin. Se monta UNA vez en ClasesPanel (no dentro de
// ClassSection, que se duplica). Datos en vivo solo de /api/market/*:
// un 503 es "sin datos" y nunca se muestra un precio viejo como actual.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, isMarketNoData, type MarketCandlesResponse, type MarketIndicatorsResponse, type MarketTickerResponse } from "../lib/api";
import { Panel } from "./Panel";
import { ApiErrorBanner } from "./ui";
import { useLanguage } from "../lib/i18n";
import { useCancelled } from "../lib/useLoad";
import { CompoundCalculator } from "./CompoundCalculator";

type LoadStatus = "loading" | "ready" | "nodata" | "error";

const fmtUsd = (n: number, locale: string) =>
  n.toLocaleString(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNum = (n: number, locale: string, digits = 2) =>
  n.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtTime = (iso: string, locale: string) =>
  new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** SMA/EMA en frontend desde los cierres (el backend solo da el último
 * valor en /indicators; la serie de la gráfica se calcula aquí). */
function smaSeries(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i++) {
    out[i] = values.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n;
  }
  return out;
}
function emaSeries(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (values.length < n || n <= 0) return out;
  const k = 2 / (n + 1);
  let e = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = e;
  for (let i = n; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 mt-5 text-sm font-semibold text-zinc-100 first:mt-0">{children}</h3>;
}

/** Tarjeta de una herramienta: número de orden + título a primera vista
 * (2026-11-12): las 5 herramientas vivían en un solo flujo sin
 * separación visual; cada una tiene ahora su propia tarjeta y el índice
 * de salto del panel enlaza a su ancla. */
function ToolCard({ id, num, title, badge, children }: { id: string; num: string; title: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-label={title} className="scroll-mt-24 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-600 text-xs font-bold text-white">{num}</span>
        <h3 className="min-w-0 flex-1 text-sm font-semibold text-zinc-100">{title}</h3>
        {badge}
      </div>
      {children}
    </section>
  );
}

function LiveBadge({ live, liveLabel, staleLabel }: { live: boolean; liveLabel: string; staleLabel: string }) {
  return (
    <span
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${live ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}`}
    >
      <span className={`relative flex h-2 w-2`}>
        {live && <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-emerald-400 opacity-75" />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${live ? "bg-emerald-400" : "bg-amber-400"}`} />
      </span>
      {live ? liveLabel : staleLabel}
    </span>
  );
}

// ---------- (a) Calculadora de interés compuesto (solo navegador) ----------
// Extraída a ./CompoundCalculator.tsx (2026-11-12) para reutilizarla en
// la landing pública; aquí solo se monta dentro de su ToolCard.
function ClasesCompoundCalculator() {
  const { t } = useLanguage();
  return (
    <ToolCard id="herramienta-calculadora" num="1" title={t.clases.calcTitle}>
      <CompoundCalculator idPrefix="clases-calc" />
    </ToolCard>
  );
}

// ---------- (b) Conversor BTC/USD en vivo (/ticker, sondeo ~10 s) ----------

function BtcConverter() {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const isCancelled = useCancelled();
  const [ticker, setTicker] = useState<MarketTickerResponse | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<unknown>(null);
  const [now, setNow] = useState(() => Date.now());
  const [btc, setBtc] = useState("1");
  const [usd, setUsd] = useState("");
  const [lastEdited, setLastEdited] = useState<"btc" | "usd">("btc");
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const r = await api.marketTicker("BTC/USD", { signal: ctrl.signal });
      if (isCancelled() || ctrl.signal.aborted) return;
      setTicker(r);
      setError(null);
      // 503 con caché stale no llega aquí (el backend lo sirve como stale);
      // un 503 real es "sin datos": el precio queda no disponible.
      setStatus(r.last === null ? "nodata" : "ready");
    } catch (e) {
      if (ctrl.signal.aborted || isCancelled()) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e);
      setStatus(isMarketNoData(e) ? "nodata" : "error");
    }
  }, [isCancelled]);

  useEffect(() => {
    load();
    // Sondeo ~10 s, pausado con la pestaña oculta (no gasta peticiones).
    const poll = setInterval(() => {
      if (document.hidden) return;
      load();
    }, 10_000);
    const freshness = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      clearInterval(poll);
      clearInterval(freshness);
      abortRef.current?.abort();
    };
  }, [load]);

  const price = ticker?.last ?? null;
  // Fresco solo si el backend no lo marca stale Y tiene menos de 60 s.
  const fresh =
    status === "ready" && ticker !== null && !ticker.stale &&
    now - new Date(ticker.updated_utc).getTime() <= 60_000;
  const btcNum = Number(btc);
  const usdNum = Number(usd);
  const btcValid = btc.trim() !== "" && Number.isFinite(btcNum) && btcNum >= 0;
  const usdValid = usd.trim() !== "" && Number.isFinite(usdNum) && usdNum >= 0;
  const shownUsd = price !== null && lastEdited === "btc" && btcValid ? fmtNum(btcNum * price, "en-US", 2) : usd;
  const shownBtc = price !== null && lastEdited === "usd" && usdValid ? String(Number((usdNum / price).toFixed(8))) : btc;

  return (
    <ToolCard
      id="herramienta-conversor"
      num="2"
      title={t.clases.convTitle}
      badge={status === "ready" && ticker ? <LiveBadge live={fresh} liveLabel={t.clases.convLive} staleLabel={t.clases.convStale} /> : undefined}
    >
      {status === "loading" && <p className="text-sm text-zinc-400">{t.clases.convLoading}</p>}
      {status === "nodata" && <p role="alert" className="text-sm text-amber-400">{t.clases.convUnavailable}</p>}
      {status === "error" && <ApiErrorBanner error={error} t={t} onRetry={load} />}
      {/* 2026-11-11: "ready" solo se pone en load() cuando r.last !==
          null, así que price nunca es null aquí: la rama {price ===
          null} y el disabled={price === null} eran código muerto (V3
          del QA de Clases). El price !== null de la condición es el
          guarda de tipos para fmtUsd. */}
      {status === "ready" && ticker && price !== null && (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="text-xs text-zinc-400">{t.clases.convBtc}
              <input data-no-swipe className="mt-1 w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40" type="number" min="0" step="any" inputMode="decimal" value={shownBtc} onChange={(e) => { setBtc(e.target.value); setLastEdited("btc"); }} />
            </label>
            <label className="text-xs text-zinc-400">{t.clases.convUsd}
              <input data-no-swipe className="mt-1 w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40" type="number" min="0" step="any" inputMode="decimal" value={shownUsd} onChange={(e) => { setUsd(e.target.value); setLastEdited("usd"); }} />
            </label>
          </div>
          <p className={`mt-2 text-xs leading-relaxed ${fresh ? "text-zinc-500" : "text-amber-400"}`}>
            1 BTC = {fmtUsd(price, "en-US")} ·{" "}
            {t.clases.convSource.replace("{source}", ticker.source).replace("{time}", new Date(ticker.updated_utc).toLocaleTimeString(locale, { hour12: false }))}
            {!fresh && ` · ${t.clases.convStale}`}
          </p>
        </>
      )}
    </ToolCard>
  );
}

// ---------- (c) Gráfica BTC 1h en SVG hecha a mano (/candles, limit 100) ----------

function BtcChart() {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const isCancelled = useCancelled();
  const [data, setData] = useState<MarketCandlesResponse | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<unknown>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const r = await api.marketCandles("BTC/USD", "1h", 100, { signal: ctrl.signal });
      if (isCancelled() || ctrl.signal.aborted) return;
      setData(r);
      setError(null);
      setStatus(r.candles.length === 0 ? "nodata" : "ready");
    } catch (e) {
      if (ctrl.signal.aborted || isCancelled()) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e);
      setStatus(isMarketNoData(e) ? "nodata" : "error");
    }
  }, [isCancelled]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  const closes = data?.candles.map((c) => c.close) ?? [];
  const sma20 = smaSeries(closes, 20);
  const sma50 = smaSeries(closes, 50);
  const ema20 = emaSeries(closes, 20);
  const all = [
    ...closes,
    ...sma20.filter((v): v is number => v !== null),
    ...sma50.filter((v): v is number => v !== null),
    ...ema20.filter((v): v is number => v !== null),
  ];
  const min = all.length ? Math.min(...all) : 0;
  const max = all.length ? Math.max(...all) : 1;
  const span = max - min || 1;
  const W = 560;
  const H = 200;
  const pts = (series: (number | null)[]) =>
    series
      .map((v, i) => (v === null ? null : `${((i / Math.max(series.length - 1, 1)) * W).toFixed(1)},${(H - 4 - ((v - min) / span) * (H - 8)).toFixed(1)}`))
      .filter((p): p is string => p !== null)
      .join(" ");

  return (
    <ToolCard
      id="herramienta-grafica"
      num="3"
      title={t.clases.chartTitle}
      badge={
        status === "ready" && data?.stale ? (
          <span aria-live="polite" className="inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-400">
            {t.clases.convStale}
          </span>
        ) : undefined
      }
    >
      {status === "loading" && <p className="text-sm text-zinc-400">{t.clases.chartLoading}</p>}
      {status === "nodata" && <p role="alert" className="text-sm text-amber-400">{t.clases.chartNoData}</p>}
      {status === "error" && <ApiErrorBanner error={error} t={t} onRetry={load} />}
      {status === "ready" && data && closes.length >= 2 && (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border border-zinc-800 bg-zinc-950" role="img" aria-label={t.clases.chartTitle}>
            <polyline points={pts(sma50)} fill="none" stroke="#38bdf8" strokeWidth="1.5" strokeLinejoin="round" />
            <polyline points={pts(sma20)} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeLinejoin="round" />
            <polyline points={pts(ema20)} fill="none" stroke="#a78bfa" strokeWidth="1.5" strokeDasharray="4 3" strokeLinejoin="round" />
            <polyline points={pts(closes.map((v) => v))} fill="none" stroke="#10b981" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
          <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
            <span><span className="text-emerald-400">—</span> {t.clases.chartClose}</span>
            <span><span className="text-amber-400">—</span> {t.clases.chartSma20}</span>
            <span><span className="text-sky-400">—</span> {t.clases.chartSma50}</span>
            <span><span className="text-violet-400">- -</span> {t.clases.chartEma20}</span>
          </p>
          <p className={`mt-1.5 text-xs leading-relaxed ${data.stale ? "text-amber-400" : "text-zinc-500"}`}>
            {t.clases.chartSource.replace("{source}", data.source)} ·{" "}
            {t.clases.chartNewest.replace("{time}", fmtTime(data.newest_candle_utc, locale))}
          </p>
        </>
      )}
      {status === "ready" && data && closes.length < 2 && (
        <p role="alert" className="text-sm text-amber-400">{t.clases.chartNoData}</p>
      )}
      <button
        type="button"
        data-no-swipe
        onClick={load}
        className="mt-3 min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 hover:border-zinc-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
      >
        {t.clases.chartRefresh}
      </button>
    </ToolCard>
  );
}

// ---------- (d) Tira de indicadores (/indicators) ----------

function IndicatorsStrip() {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const isCancelled = useCancelled();
  const [data, setData] = useState<MarketIndicatorsResponse | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<unknown>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const r = await api.marketIndicators("BTC/USD", "1h", { signal: ctrl.signal });
      if (isCancelled() || ctrl.signal.aborted) return;
      setData(r);
      setError(null);
      setStatus("ready");
    } catch (e) {
      if (ctrl.signal.aborted || isCancelled()) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e);
      setStatus(isMarketNoData(e) ? "nodata" : "error");
    }
  }, [isCancelled]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  const ind = data?.indicators;
  const cards: { label: string; value: string; desc: string }[] = ind
    ? [
        { label: t.clases.indRsi, value: ind.rsi_14 === null ? t.clases.indNoValue : fmtNum(ind.rsi_14, locale, 1), desc: t.clases.indRsiDesc },
        { label: t.clases.indSma20, value: ind.sma_20 === null ? t.clases.indNoValue : fmtUsd(ind.sma_20, "en-US"), desc: t.clases.indSma20Desc },
        { label: t.clases.indSma50, value: ind.sma_50 === null ? t.clases.indNoValue : fmtUsd(ind.sma_50, "en-US"), desc: t.clases.indSma50Desc },
        { label: t.clases.indEma20, value: ind.ema_20 === null ? t.clases.indNoValue : fmtUsd(ind.ema_20, "en-US"), desc: t.clases.indEma20Desc },
        {
          label: t.clases.indMacd,
          value: ind.macd === null || ind.macd.macd_line === null
            ? t.clases.indNoValue
            : `${fmtNum(ind.macd.macd_line, locale, 2)} (${fmtNum(ind.macd.histogram ?? 0, locale, 2)})`,
          desc: t.clases.indMacdDesc,
        },
        { label: t.clases.indVol, value: ind.volatility_20 === null ? t.clases.indNoValue : `${fmtNum(ind.volatility_20 * 100, locale, 2)} %`, desc: t.clases.indVolDesc },
      ]
    : [];

  return (
    <ToolCard id="herramienta-indicadores" num="4" title={t.clases.indTitle}>
      {status === "loading" && <p className="text-sm text-zinc-400">{t.clases.indLoading}</p>}
      {status === "nodata" && <p role="alert" className="text-sm text-amber-400">{t.clases.indNoData}</p>}
      {status === "error" && <ApiErrorBanner error={error} t={t} onRetry={load} />}
      {status === "ready" && data && (
        <>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((c) => (
              <li key={c.label} className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{c.label}</p>
                <p className="mt-0.5 text-base font-semibold tabular-nums text-zinc-100">{c.value}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{c.desc}</p>
              </li>
            ))}
          </ul>
          <p className={`mt-2 text-xs leading-relaxed ${data.stale ? "text-amber-400" : "text-zinc-500"}`}>
            {t.clases.indSource.replace("{source}", data.source).replace("{time}", fmtTime(data.newest_candle_utc, locale))}
            {data.stale && ` · ${t.clases.convStale}`}
          </p>
        </>
      )}
    </ToolCard>
  );
}

// ---------- (e) Contenido educativo Bitcoin (estático, descriptivo) + (f) checklist y glosario ----------

function BitcoinEducation() {
  const { t } = useLanguage();
  const [checks, setChecks] = useState<boolean[]>([false, false, false, false]);
  const items = [t.clases.check1, t.clases.check2, t.clases.check3, t.clases.check4];
  const glossary: { term: string; def: string }[] = [
    { term: t.clases.glossBtc, def: t.clases.glossBtcDef },
    { term: t.clases.glossCandle, def: t.clases.glossCandleDef },
    { term: t.clases.glossVol, def: t.clases.glossVolDef },
    { term: t.clases.glossSim, def: t.clases.glossSimDef },
    { term: t.clases.glossKill, def: t.clases.glossKillDef },
  ];
  return (
    <ToolCard id="herramienta-bitcoin" num="5" title={t.clases.btcTitle}>
      <h4 className="text-sm font-semibold text-zinc-200">{t.clases.btcWhatTitle}</h4>
      <p className="mt-1 text-sm leading-relaxed text-zinc-400">{t.clases.btcWhatBody}</p>
      <h4 className="mt-3 text-sm font-semibold text-zinc-200">{t.clases.btcMoveTitle}</h4>
      <p className="mt-1 text-sm leading-relaxed text-zinc-400">{t.clases.btcMoveBody}</p>
      <h4 className="mt-3 text-sm font-semibold text-zinc-200">{t.clases.btcRisksTitle}</h4>
      <p className="mt-1 text-sm leading-relaxed text-zinc-400">{t.clases.btcRisksBody}</p>
      <p className="mt-2 text-sm font-semibold text-zinc-100">{t.clases.btcPast}</p>
      <p className="mt-2 flex flex-wrap gap-2">
        <a data-no-swipe href="/estudiar/manual-invertir" className="inline-flex min-h-[44px] items-center rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">
          {t.clases.btcManualLink}
        </a>
        <a data-no-swipe href="/" className="inline-flex min-h-[44px] items-center rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">
          {t.clases.btcInvestLink}
        </a>
      </p>

      <SectionTitle>{t.clases.checkTitle}</SectionTitle>
      <ul className="space-y-2">
        {items.map((label, i) => (
          <li key={i}>
            <label className="flex min-h-[44px] cursor-pointer items-start gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-sm text-zinc-200">
              <input
                data-no-swipe
                type="checkbox"
                checked={checks[i]}
                onChange={(e) => setChecks((prev) => prev.map((v, j) => (j === i ? e.target.checked : v)))}
                className="mt-0.5 h-5 w-5 shrink-0 accent-emerald-500"
              />
              <span>{label}</span>
            </label>
          </li>
        ))}
      </ul>

      <SectionTitle>{t.clases.glossTitle}</SectionTitle>
      <dl className="space-y-2">
        {glossary.map((g) => (
          <div key={g.term} className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
            <dt className="text-sm font-semibold text-zinc-100">{g.term}</dt>
            <dd className="mt-0.5 text-sm leading-relaxed text-zinc-400">{g.def}</dd>
          </div>
        ))}
      </dl>
    </ToolCard>
  );
}

export function ClasesHerramientas() {
  const { t } = useLanguage();
  const jump = [
    { href: "#herramienta-calculadora", label: t.clases.calcTitle },
    { href: "#herramienta-conversor", label: t.clases.convTitle },
    { href: "#herramienta-grafica", label: t.clases.chartTitle },
    { href: "#herramienta-indicadores", label: t.clases.indTitle },
    { href: "#herramienta-bitcoin", label: t.clases.btcTitle },
  ];
  return (
    <div data-no-swipe>
      <Panel title={t.clases.toolsTitle}>
        <p className="mb-3 text-xs leading-relaxed text-zinc-400">{t.clases.toolsIntro}</p>
        <nav aria-label={t.clases.toolsJumpLabel} className="mb-4 flex flex-wrap gap-2">
          {jump.map((j) => (
            <a
              key={j.href}
              href={j.href}
              className="inline-flex min-h-[36px] items-center rounded-full border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:border-sky-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
            >
              {j.label}
            </a>
          ))}
        </nav>
        <div className="space-y-3">
          <ClasesCompoundCalculator />
          <BtcConverter />
          <BtcChart />
          <IndicatorsStrip />
          <BitcoinEducation />
        </div>
      </Panel>
    </div>
  );
}
