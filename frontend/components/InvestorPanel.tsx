"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { api, ApiError } from "../lib/api";
import { Panel } from "./Panel";
import { Skeleton } from "./Skeleton";
import { newId } from "./ui";
import { useLanguage } from "../lib/i18n";

const inputCls =
  "min-h-[44px] w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

type Step = "form" | "validate" | "done";

export function InvestorPanel({
  mode,
  realEnabled,
  equityUsd,
  onExecuted,
}: {
  mode: string;
  realEnabled: boolean;
  equityUsd: number | null;
  onExecuted: () => void;
}) {
  const [symbol, setSymbol] = useState("BTC/USD");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState<number | null>(null);
  const [priceUpdatedAt, setPriceUpdatedAt] = useState<Date | null>(null);
  // 2026-11-07: si la carga del precio falla, antes el panel se quedaba
  // en "cargando…" para siempre con VALIDAR deshabilitado y sin decir por
  // qué. Ahora avisa y ofrece reintentar.
  const [priceError, setPriceError] = useState(false);
  // 2026-11-08: marketPrices() marca stale=true cuando el exchange no
  // responde y el servidor sirve su caché: ese precio no es en vivo y
  // la cantidad estimada de la orden se calcula con él, así que el
  // panel debe decirlo en vez de mostrarlo como actual.
  const [priceStale, setPriceStale] = useState(false);
  const priceRef = useRef<number | null>(null);
  const { t } = useLanguage();
  const [step, setStep] = useState<Step>("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  // Precio con guarda de cancelación: una carga en vuelo de un símbolo
  // anterior (o de un panel ya desmontado) no debe escribir su precio.
  // P2 (2026-11-17): cada carga lleva su AbortSignal y aborta la
  // anterior — un solo sondeo vivo por panel. marketPrices ya lleva
  // retry: true por dentro, así que este es el segundo sondeo de la
  // página (el otro es MarketPanel) con cancelación real; el WebSocket
  // de MarketPanel no se toca.
  const priceAbortRef = useRef<AbortController | null>(null);
  const loadPrice = useCallback(
    async (cancelled: () => boolean) => {
      priceAbortRef.current?.abort();
      const ctrl = new AbortController();
      priceAbortRef.current = ctrl;
      try {
        const res = await api.marketPrices({ signal: ctrl.signal });
        if (cancelled() || ctrl.signal.aborted) return;
        const coin = res.prices.find((p) => p.pair === symbol);
        if (coin?.price_usd) {
          priceRef.current = coin.price_usd;
          setPrice(coin.price_usd);
          setPriceUpdatedAt(new Date());
          setPriceStale(res.stale === true);
          setPriceError(false);
        }
      } catch (e) {
        if (cancelled() || ctrl.signal.aborted) return;
        // Un abort no es un error que mostrar.
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (e instanceof Error && e.name === "AbortError") return;
        // Con precio previo se conserva y su hora ya marca la
        // antigüedad; sin precio, avisar en vez de dejar "cargando…".
        if (priceRef.current == null) setPriceError(true);
      }
    },
    [symbol],
  );

  // Al cambiar de símbolo el precio anterior ya no vale: limpiarlo evita
  // mostrar el precio de BTC como si fuera el de ETH si la carga falla.
  useEffect(() => {
    priceRef.current = null;
    setPrice(null);
    setPriceUpdatedAt(null);
    setPriceStale(false);
    setPriceError(false);
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;
    loadPrice(() => cancelled);
    // Como el Chat y el Mercado: con la pestaña oculta el sondeo de
    // precio no aporta nada (al volver se recarga) y solo gasta peticiones.
    const t = setInterval(() => {
      if (document.hidden) return;
      loadPrice(() => cancelled);
    }, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
      priceAbortRef.current?.abort();
    };
  }, [loadPrice]);

  const amountNum = parseFloat(amount);
  const validAmount = Number.isFinite(amountNum) && amountNum > 0;
  const qty = validAmount && price ? amountNum / price : 0;
  // Unidad del activo (BTC/ETH) para acompañar la cantidad estimada:
  // "0.00012345" solo no dice de qué.
  const base = symbol.split("/")[0];
  const pctCapital =
    validAmount && equityUsd && equityUsd > 0 ? (amountNum / equityUsd) * 100 : null;
  const isReal = mode === "real" && realEnabled;
  const orderMode = isReal ? "real" : mode === "paper" ? "paper" : "simulation";

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const order = await api.createOrder(
        { symbol, side, quantity: qty.toFixed(8), mode: orderMode },
        newId()
      );
      setResult(
        (side === "buy" ? t.invertir.resultBuy : t.invertir.resultSell)
          .replace("{id}", String(order.id))
          .replace("{symbol}", symbol)
          .replace("{status}", order.status)
          .replace("{mode}", order.mode)
      );
      setStep("done");
      onExecuted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.invertir.orderFailed);
      setStep("form");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStep("form");
    setAmount("");
    setResult(null);
    setError(null);
  };

  return (
    <Panel
      title={t.invertir.title}
      badge={
        isReal ? (
          <span className="rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-bold text-red-400">
            {t.invertir.realBadge}
          </span>
        ) : (
          <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-400">
            {orderMode === "paper" ? t.invertir.paperBadge : t.invertir.simBadge} · {t.invertir.noRealMoney}
          </span>
        )
      }
    >
      {/* Indicador visual de pasos (1 Arma → 2 Valida): el texto del paso
          sigue dentro de cada rama para lectores de pantalla. */}
      {step !== "done" && (
        <div className="mb-3 flex items-center gap-2" aria-hidden="true">
          <span className={`h-1.5 flex-1 rounded-full ${step === "form" ? "bg-emerald-500" : "bg-emerald-500/40"}`} />
          <span className={`h-1.5 flex-1 rounded-full ${step === "validate" ? "bg-emerald-500" : "bg-zinc-700"}`} />
        </div>
      )}
      {step === "done" ? (
        <div className="py-2">
          <p role="status" className="text-sm leading-relaxed text-emerald-400">✓ {result}</p>
          <button
            onClick={reset}
            className="mt-4 min-h-[44px] w-full rounded-lg border border-zinc-700 px-3 py-2.5 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            {t.invertir.newOperation}
          </button>
        </div>
      ) : step === "validate" ? (
        <div className="py-1">
          {isReal && (
            <div className="mb-4 rounded-lg border border-red-800 bg-red-950/50 p-3.5 text-sm leading-relaxed text-red-200">
              ⚠️ <strong>{t.invertir.realWarningTitle}</strong> {t.invertir.realWarningBody}
            </div>
          )}
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">{t.invertir.stepValidate}</p>
          <p className="text-base font-semibold text-zinc-100">{t.invertir.validateTitle}</p>
          <dl className="mt-3 space-y-2.5 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-zinc-400">{t.invertir.operation}</dt>
              <dd className={`text-right font-semibold ${side === "buy" ? "text-emerald-400" : "text-red-400"}`}>
                {side === "buy" ? t.invertir.enterBuy : t.invertir.exitSell} {symbol}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-zinc-400">{t.invertir.amount}</dt>
              <dd className="text-right font-mono tabular-nums">${amountNum.toFixed(2)} USD</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-zinc-400">{t.invertir.currentPrice}</dt>
              <dd
                className={`text-right font-mono tabular-nums ${priceStale ? "text-zinc-400 opacity-70" : ""}`}
                title={priceStale ? t.reliability.stalePrice : undefined}
              >
                ${price?.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                {priceUpdatedAt && (
                  <span className="block text-xs font-sans text-zinc-400">
                    {t.invertir.updatedAt}{" "}
                    {priceUpdatedAt.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                )}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-zinc-400">{t.invertir.estQty}</dt>
              <dd className="text-right font-mono tabular-nums">{qty.toFixed(8)} {base}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-zinc-400">{t.invertir.pctCapital}</dt>
              <dd className="text-right font-mono tabular-nums">{pctCapital != null ? `${pctCapital.toFixed(1)}%` : "—"}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-zinc-400">{t.invertir.mode}</dt>
              <dd className="text-right font-mono">
                {isReal ? t.invertir.modeReal : orderMode === "paper" ? t.invertir.paperBadge : t.invertir.simBadge} {t.invertir.riskGuardNote}
              </dd>
            </div>
          </dl>
          {priceStale && (
            <p role="status" className="mt-3 text-xs leading-relaxed text-amber-400">
              {t.reliability.stalePrice}
            </p>
          )}
          {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
          <div className="mt-5 flex gap-2">
            <button
              onClick={confirm}
              disabled={busy}
              className={`min-h-[44px] flex-1 rounded-lg px-3 py-2.5 text-sm font-bold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
                side === "buy" ? "bg-emerald-700 hover:bg-emerald-800" : "bg-red-600 hover:bg-red-700"
              }`}
            >
              {busy ? t.invertir.executing : isReal ? (side === "buy" ? t.invertir.confirmRealEnter : t.invertir.confirmRealExit) : side === "buy" ? t.invertir.confirmEnter : t.invertir.confirmExit}
            </button>
            <button
              onClick={() => setStep("form")}
              disabled={busy}
              className="min-h-[44px] flex-1 rounded-lg border border-zinc-700 px-3 py-2.5 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              {t.invertir.back}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">{t.invertir.stepForm}</p>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              onClick={() => setSide("buy")}
              aria-pressed={side === "buy"}
              className={`min-h-[44px] rounded-lg px-3 py-3 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
                side === "buy"
                  ? "bg-emerald-700 text-white"
                  : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {t.invertir.enterBtn}
            </button>
            <button
              onClick={() => setSide("sell")}
              aria-pressed={side === "sell"}
              className={`min-h-[44px] rounded-lg px-3 py-3 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
                side === "sell"
                  ? "bg-red-600 text-white"
                  : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {t.invertir.exitBtn}
            </button>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs text-zinc-400">{t.invertir.symbolLabel}
              <select aria-label={t.invertir.symbolAria} className={`${inputCls} mt-1`} value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                <option value="BTC/USD">{t.invertir.bitcoin}</option>
                <option value="ETH/USD">{t.invertir.ethereum}</option>
              </select>
            </label>
            <label className="text-xs text-zinc-400">{t.invertir.amountLabel}
              <input aria-label={t.invertir.amountPlaceholder}
                className={`${inputCls} mt-1`}
                type="number"
                min="0"
                step="0.01"
                placeholder={t.invertir.amountPlaceholder}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
          </div>
          {/* Montos rápidos: solo rellenan el campo, no ejecutan nada.
              20 es el tope acumulado de compras reales (Fase 8). */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-400">{t.invertir.quickAmount}</span>
            {[5, 10, 20].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setAmount(String(v))}
                aria-pressed={amount === String(v)}
                className={`min-h-[36px] rounded-full border px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
                  amount === String(v)
                    ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                    : "border-zinc-700 text-zinc-200 hover:bg-zinc-800"
                }`}
              >
                ${v}
              </button>
            ))}
          </div>
          {/* Caja de precio: el precio en vivo grande y separado del resto,
              con su hora y el capital en tabular-nums; antes era una sola
              línea densa que mezclaba precio, hora y capital. Estilo
              Semrush (2026-11-23): tarjeta con número grande + contexto. */}
          <div className="fintech-card mt-3 px-4 py-3.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {t.invertir.price} {symbol}
              </span>
              {price ? (
                <span
                  className={`font-mono text-2xl font-extrabold tabular-nums ${priceStale ? "text-zinc-400 opacity-70" : "text-zinc-100"}`}
                  title={priceStale ? t.reliability.stalePrice : undefined}
                >
                  ${price.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </span>
              ) : priceError ? (
                <span role="alert" className="text-sm font-semibold text-red-400">
                  {t.invertir.priceLoadFailed}{" "}
                  <button
                    type="button"
                    onClick={() => loadPrice(() => false)}
                    className="font-semibold text-zinc-100 underline underline-offset-2 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                  >
                    {t.invertir.retry}
                  </button>
                </span>
              ) : (
                <Skeleton className="h-8 w-32" ariaLabel={t.misc.loadingAria} />
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
              {priceUpdatedAt && (
                <span>
                  {t.invertir.updatedAt}{" "}
                  {priceUpdatedAt.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
              )}
              <span>
                {t.invertir.capital}{" "}
                <span className="font-mono tabular-nums text-zinc-200">
                  {equityUsd != null ? `$${equityUsd.toFixed(2)}` : "—"}
                </span>
              </span>
            </div>
          </div>
          {validAmount && price !== null && (
            <p className="mt-2 text-xs leading-relaxed text-zinc-400">
              {t.invertir.estQty}:{" "}
              <span className="font-mono font-semibold tabular-nums text-zinc-100">{qty.toFixed(8)} {base}</span>
              {pctCapital != null && (
                <>
                  {" "}· {t.invertir.pctCapital}:{" "}
                  <span className="font-mono font-semibold tabular-nums text-zinc-100">{pctCapital.toFixed(1)}%</span>
                </>
              )}
            </p>
          )}
          {priceStale && price && (
            <p role="status" className="mt-2 text-xs leading-relaxed text-amber-400">
              {t.reliability.stalePrice}
            </p>
          )}
          {error && <p role="alert" className="mt-3 text-sm leading-relaxed text-red-400">{error}</p>}
          <button
            onClick={() => {
              setError(null);
              setStep("validate");
            }}
            disabled={!validAmount || !price}
            className="mt-4 min-h-[44px] w-full rounded-lg bg-zinc-100 px-3 py-3 text-sm font-bold text-zinc-900 hover:bg-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            {t.invertir.validateOrder}
          </button>
          {(!validAmount || !price) && (
            <p className="mt-2 text-xs leading-relaxed text-zinc-400">
              {!validAmount
                ? t.invertir.validateAmountZero
                : priceError
                  ? t.invertir.priceLoadFailed
                  : t.invertir.waitingLivePrice}
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
