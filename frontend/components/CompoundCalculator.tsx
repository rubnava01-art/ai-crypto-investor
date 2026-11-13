"use client";

// Calculadora de interés compuesto (extraída de ClasesHerramientas.tsx,
// 2026-11-12): 100 % navegador, cero red, cero auth. Reutilizable en la
// landing pública (héroe) y en Clases. Sin Panel/ToolCard, sin numeración
// ni ancla: el título lo pone quien la monta. Mantiene el aviso de
// "Ejemplo hipotético" y las label de los inputs. El idPrefix evita
// duplicar el id del hint si dos instancias convivieran en una página.
//
// Guardas (M7, 2026-11-13): tasa >= 0, años entero 1..100, cantidad
// <= 1e12 y resultado finito — antes una tasa negativa calculaba
// decaimiento en silencio, "2.5" años se aceptaba y un resultado
// infinito se mostraba como "$∞". El formato usa el locale del idioma.
import { useState } from "react";
import { useLanguage } from "../lib/i18n";

const MAX_PRINCIPAL = 1e12;
const MAX_YEARS = 100;

const fmtUsd = (n: number, locale: string) =>
  n.toLocaleString(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CompoundCalculator({ idPrefix = "calc" }: { idPrefix?: string }) {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const [principal, setPrincipal] = useState("");
  // SIN tasa por defecto: vacía hasta que el usuario escriba una.
  const [rate, setRate] = useState("");
  const [years, setYears] = useState("10");
  const p = Number(principal);
  const r = Number(rate);
  const n = Number(years);
  const principalValid = principal.trim() !== "" && Number.isFinite(p) && p > 0 && p <= MAX_PRINCIPAL;
  const rateValid = rate.trim() !== "" && Number.isFinite(r) && r >= 0;
  const yearsValid = years.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= MAX_YEARS;
  const valid = principalValid && yearsValid;
  const rawResult = valid && rateValid ? p * Math.pow(1 + r / 100, n) : null;
  const result = rawResult !== null && Number.isFinite(rawResult) ? rawResult : null;
  const resultOverflow = rawResult !== null && !Number.isFinite(rawResult);
  const hintId = `${idPrefix}-rate-hint`;
  const inputClass =
    "mt-1 w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40";
  return (
    <div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="text-xs text-zinc-400">{t.clases.calcInitial}
          <input data-no-swipe className={inputClass} type="number" min="0" max="1000000000000" step="any" inputMode="decimal" value={principal} onChange={(e) => setPrincipal(e.target.value)} placeholder="1000" />
        </label>
        <label className="text-xs text-zinc-400">{t.clases.calcRate}
          <input data-no-swipe className={inputClass} type="number" min="0" step="any" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="—" aria-describedby={hintId} />
        </label>
        <label className="text-xs text-zinc-400">{t.clases.calcYears}
          <input data-no-swipe className={inputClass} type="number" min="1" max="100" step="1" inputMode="numeric" value={years} onChange={(e) => setYears(e.target.value)} />
        </label>
      </div>
      <p id={hintId} className="mt-1.5 text-xs text-zinc-400">{t.clases.calcRateHint}</p>
      {result !== null ? (
        <p className="mt-2 text-sm text-zinc-100">
          {t.clases.calcResult}: <strong className="tabular-nums">{fmtUsd(result, locale)}</strong>
        </p>
      ) : resultOverflow ? (
        <p role="alert" className="mt-2 text-sm text-amber-400">{t.clases.calcOutOfRange}</p>
      ) : valid && !rateValid ? (
        <p className="mt-2 text-sm text-zinc-400">
          {rate.trim() !== "" && Number.isFinite(r) && r < 0 ? t.clases.calcRateNegative : t.clases.calcEnterRate}
        </p>
      ) : principal.trim() !== "" && !yearsValid ? (
        <p className="mt-2 text-sm text-zinc-400">{t.clases.calcYearsRange}</p>
      ) : (
        <p className="mt-2 text-sm text-zinc-400">{principal.trim() === "" && rate.trim() === "" ? t.clases.calcEnterAll : t.clases.calcInvalid}</p>
      )}
      <p className="mt-1.5 text-xs font-medium text-amber-400">{t.clases.calcHypothetical}</p>
    </div>
  );
}
