"use client";

// Calculadora de interés compuesto (extraída de ClasesHerramientas.tsx,
// 2026-11-12): 100 % navegador, cero red, cero auth. Reutilizable en la
// landing pública (héroe) y en Clases. Sin Panel/ToolCard, sin numeración
// ni ancla: el título lo pone quien la monta. Mantiene el aviso de
// "Ejemplo hipotético" y las label de los inputs. El idPrefix evita
// duplicar el id del hint si dos instancias convivieran en una página.
import { useState } from "react";
import { useLanguage } from "../lib/i18n";

const fmtUsd = (n: number, locale: string) =>
  n.toLocaleString(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CompoundCalculator({ idPrefix = "calc" }: { idPrefix?: string }) {
  const { t } = useLanguage();
  const [principal, setPrincipal] = useState("");
  // SIN tasa por defecto: vacía hasta que el usuario escriba una.
  const [rate, setRate] = useState("");
  const [years, setYears] = useState("10");
  const p = Number(principal);
  const r = Number(rate);
  const n = Number(years);
  const valid = principal.trim() !== "" && Number.isFinite(p) && p > 0 && Number.isFinite(n) && n > 0;
  const rateReady = rate.trim() !== "" && Number.isFinite(r);
  const result = valid && rateReady ? p * Math.pow(1 + r / 100, n) : null;
  const hintId = `${idPrefix}-rate-hint`;
  const inputClass =
    "mt-1 w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40";
  return (
    <div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="text-xs text-zinc-400">{t.clases.calcInitial}
          <input data-no-swipe className={inputClass} type="number" min="0" step="any" inputMode="decimal" value={principal} onChange={(e) => setPrincipal(e.target.value)} placeholder="1000" />
        </label>
        <label className="text-xs text-zinc-400">{t.clases.calcRate}
          <input data-no-swipe className={inputClass} type="number" step="any" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="—" aria-describedby={hintId} />
        </label>
        <label className="text-xs text-zinc-400">{t.clases.calcYears}
          <input data-no-swipe className={inputClass} type="number" min="1" step="1" inputMode="numeric" value={years} onChange={(e) => setYears(e.target.value)} />
        </label>
      </div>
      <p id={hintId} className="mt-1.5 text-xs text-zinc-500">{t.clases.calcRateHint}</p>
      {result !== null ? (
        <p className="mt-2 text-sm text-zinc-100">
          {t.clases.calcResult}: <strong className="tabular-nums">{fmtUsd(result, "en-US")}</strong>
        </p>
      ) : valid && !rateReady ? (
        <p className="mt-2 text-sm text-zinc-400">{t.clases.calcEnterRate}</p>
      ) : (
        <p className="mt-2 text-sm text-zinc-400">{principal.trim() === "" && rate.trim() === "" ? t.clases.calcEnterAll : t.clases.calcInvalid}</p>
      )}
      <p className="mt-1.5 text-xs font-medium text-amber-400">{t.clases.calcHypothetical}</p>
    </div>
  );
}
