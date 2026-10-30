"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";

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
  const [step, setStep] = useState<Step>("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const { t } = useLanguage();

  useEffect(() => {
    let cancelled = false;
    const loadPrice = async () => {
      try {
        const res = await api.marketPrices();
        const coin = res.prices.find((p) => p.pair === symbol);
        if (!cancelled && coin?.price_usd) setPrice(coin.price_usd);
      } catch {
        /* el precio se reintenta en el siguiente ciclo */
      }
    };
    loadPrice();
    // Como el Chat y el Mercado: con la pestaña oculta el sondeo de
    // precio no aporta nada (al volver se recarga) y solo gasta peticiones.
    const t = setInterval(() => {
      if (document.hidden) return;
      loadPrice();
    }, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [symbol]);

  const amountNum = parseFloat(amount);
  const validAmount = Number.isFinite(amountNum) && amountNum > 0;
  const qty = validAmount && price ? amountNum / price : 0;
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
        crypto.randomUUID()
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
      {step === "done" ? (
        <div className="py-2">
          <p className="text-sm text-emerald-400">✓ {result}</p>
          <button
            onClick={reset}
            className="mt-3 w-full rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800"
          >
            {t.invertir.newOperation}
          </button>
        </div>
      ) : step === "validate" ? (
        <div className="py-1">
          {isReal && (
            <div className="mb-3 rounded-lg border border-red-800 bg-red-950/50 p-3 text-sm text-red-200">
              ⚠️ <strong>{t.invertir.realWarningTitle}</strong> {t.invertir.realWarningBody}
            </div>
          )}
          <p className="text-sm font-semibold text-zinc-100">{t.invertir.validateTitle}</p>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-zinc-400">{t.invertir.operation}</dt>
              <dd className={`font-semibold ${side === "buy" ? "text-emerald-400" : "text-red-400"}`}>
                {side === "buy" ? t.invertir.enterBuy : t.invertir.exitSell} {symbol}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">{t.invertir.amount}</dt>
              <dd className="font-mono">${amountNum.toFixed(2)} USD</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">{t.invertir.currentPrice}</dt>
              <dd className="font-mono">${price?.toLocaleString("en-US", { maximumFractionDigits: 2 })}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">{t.invertir.estQty}</dt>
              <dd className="font-mono">{qty.toFixed(8)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">{t.invertir.pctCapital}</dt>
              <dd className="font-mono">{pctCapital != null ? `${pctCapital.toFixed(1)}%` : "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">{t.invertir.mode}</dt>
              <dd className="font-mono">
                {isReal ? t.invertir.modeReal : orderMode} {t.invertir.riskGuardNote}
              </dd>
            </div>
          </dl>
          {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
          <div className="mt-4 flex gap-2">
            <button
              onClick={confirm}
              disabled={busy}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold text-white disabled:opacity-50 ${
                side === "buy" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-red-600 hover:bg-red-500"
              }`}
            >
              {busy ? t.invertir.executing : isReal ? (side === "buy" ? t.invertir.confirmRealEnter : t.invertir.confirmRealExit) : side === "buy" ? t.invertir.confirmEnter : t.invertir.confirmExit}
            </button>
            <button
              onClick={() => setStep("form")}
              disabled={busy}
              className="flex-1 rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800"
            >
              {t.invertir.back}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setSide("buy")}
              aria-pressed={side === "buy"}
              className={`rounded-lg px-3 py-2.5 text-sm font-bold ${
                side === "buy"
                  ? "bg-emerald-600 text-white"
                  : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {t.invertir.enterBtn}
            </button>
            <button
              onClick={() => setSide("sell")}
              aria-pressed={side === "sell"}
              className={`rounded-lg px-3 py-2.5 text-sm font-bold ${
                side === "sell"
                  ? "bg-red-600 text-white"
                  : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {t.invertir.exitBtn}
            </button>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <select aria-label={t.invertir.symbolAria} className={inputCls} value={symbol} onChange={(e) => setSymbol(e.target.value)}>
              <option value="BTC/USD">{t.invertir.bitcoin}</option>
              <option value="ETH/USD">{t.invertir.ethereum}</option>
            </select>
            <input aria-label={t.invertir.amountPlaceholder}
              className={inputCls}
              type="number"
              min="0"
              step="0.01"
              placeholder={t.invertir.amountPlaceholder}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            {t.invertir.price} {symbol}:{" "}
            {price
              ? `$${price.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
              : t.invertir.loadingPrice}{" "}
            · {t.invertir.capital} {equityUsd != null ? `$${equityUsd.toFixed(2)}` : "—"}
          </p>
          {error && <p role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
          <button
            onClick={() => {
              setError(null);
              setStep("validate");
            }}
            disabled={!validAmount || !price}
            className="mt-3 w-full rounded-lg bg-zinc-100 px-3 py-2 text-sm font-bold text-zinc-900 hover:bg-white disabled:opacity-40"
          >
            {t.invertir.validateOrder}
          </button>
        </div>
      )}
    </Panel>
  );
}
