"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { Panel } from "./Panel";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";

type Step = "form" | "validate" | "done";

export function InvestorPanel({
  mode,
  equityUsd,
  onExecuted,
}: {
  mode: string;
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
    const t = setInterval(loadPrice, 15_000);
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
  const orderMode = mode === "paper" ? "paper" : "simulation";

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const order = await api.createOrder(
        { symbol, side, quantity: qty.toFixed(8), mode: orderMode },
        crypto.randomUUID()
      );
      setResult(
        `Orden #${order.id} ${side === "buy" ? "de compra" : "de venta"} ${symbol} — estado: ${order.status} (modo ${order.mode}).`
      );
      setStep("done");
      onExecuted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "La orden no se pudo ejecutar.");
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
      title="Invertir"
      badge={
        <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-400">
          {orderMode === "paper" ? "PAPER" : "SIMULACIÓN"} · sin dinero real
        </span>
      }
    >
      {step === "done" ? (
        <div className="py-2">
          <p className="text-sm text-emerald-400">✓ {result}</p>
          <button
            onClick={reset}
            className="mt-3 w-full rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800"
          >
            Nueva operación
          </button>
        </div>
      ) : step === "validate" ? (
        <div className="py-1">
          <p className="text-sm font-semibold text-zinc-100">Valida tu orden antes de ejecutarla:</p>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-zinc-400">Operación</dt>
              <dd className={`font-semibold ${side === "buy" ? "text-emerald-400" : "text-red-400"}`}>
                {side === "buy" ? "ENTRAR (comprar)" : "SALIR (vender)"} {symbol}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">Monto</dt>
              <dd className="font-mono">${amountNum.toFixed(2)} USD</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">Precio actual</dt>
              <dd className="font-mono">${price?.toLocaleString("en-US", { maximumFractionDigits: 2 })}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">Cantidad estimada</dt>
              <dd className="font-mono">{qty.toFixed(8)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">% de tu capital</dt>
              <dd className="font-mono">{pctCapital != null ? `${pctCapital.toFixed(1)}%` : "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">Modo</dt>
              <dd className="font-mono">{orderMode} (el guardia de riesgo la revisa al ejecutar)</dd>
            </div>
          </dl>
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
          <div className="mt-4 flex gap-2">
            <button
              onClick={confirm}
              disabled={busy}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold text-white disabled:opacity-50 ${
                side === "buy" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-red-600 hover:bg-red-500"
              }`}
            >
              {busy ? "Ejecutando…" : side === "buy" ? "Confirmar entrada" : "Confirmar salida"}
            </button>
            <button
              onClick={() => setStep("form")}
              disabled={busy}
              className="flex-1 rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800"
            >
              Volver
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setSide("buy")}
              className={`rounded-lg px-3 py-2.5 text-sm font-bold ${
                side === "buy"
                  ? "bg-emerald-600 text-white"
                  : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              ↗ ENTRAR
            </button>
            <button
              onClick={() => setSide("sell")}
              className={`rounded-lg px-3 py-2.5 text-sm font-bold ${
                side === "sell"
                  ? "bg-red-600 text-white"
                  : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              ↘ SALIR
            </button>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <select className={inputCls} value={symbol} onChange={(e) => setSymbol(e.target.value)}>
              <option value="BTC/USD">Bitcoin (BTC/USD)</option>
              <option value="ETH/USD">Ethereum (ETH/USD)</option>
            </select>
            <input
              className={inputCls}
              type="number"
              min="0"
              step="0.01"
              placeholder="Monto en USD (ej. 5)"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Precio {symbol}:{" "}
            {price
              ? `$${price.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
              : "cargando…"}{" "}
            · Capital: {equityUsd != null ? `$${equityUsd.toFixed(2)}` : "—"}
          </p>
          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
          <button
            onClick={() => {
              setError(null);
              setStep("validate");
            }}
            disabled={!validAmount || !price}
            className="mt-3 w-full rounded-lg bg-zinc-100 px-3 py-2 text-sm font-bold text-zinc-900 hover:bg-white disabled:opacity-40"
          >
            VALIDAR ORDEN →
          </button>
        </div>
      )}
    </Panel>
  );
}
