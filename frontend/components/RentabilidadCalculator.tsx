"use client";

// Calculadora de rentabilidad (2026-11-25, plan servicios-calc §2.B.3):
// 100 % navegador, cero red, cero auth, cero persistencia — mismo
// patrón que CompoundCalculator.tsx. Calculadora MANUAL e hipotética:
// el usuario escribe sus cifras (USD / mes); NO lee facturas, costos
// ni ningún dato real del negocio (eso es BI, otra superficie) y no
// debe confundirse con la «Calculadora de materiales» de Facturas.
// La matemática pura vive en lib/rentabilidad.ts (calcRentabilidad):
// rentabilidad R = beneficio neto / costos totales × 100 (decisión
// D-1), distinta del margen neto %. Sin gráfica en v1 (D-6).
import { useMemo, useState } from "react";
import { useLanguage } from "../lib/i18n";
import { MAX_RENT_AMOUNT, calcRentabilidad } from "../lib/rentabilidad";

const fmtUsd = (n: number, locale: string) =>
  n.toLocaleString(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n: number, locale: string) =>
  `${n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;

const clampNum = (v: number, lo: number, hi: number) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;

export function RentabilidadCalculator({ idPrefix = "rent" }: { idPrefix?: string }) {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  // Sin valores por defecto: vacíos hasta que el usuario escriba.
  const [revenue, setRevenue] = useState("");
  const [variable, setVariable] = useState("");
  const [fixed, setFixed] = useState("");
  const i = Number(revenue);
  const cv = Number(variable);
  const cf = Number(fixed);
  // Vacío = «aún no escrito», no cero (patrón CompoundCalculator).
  const revenueValid = revenue.trim() !== "" && Number.isFinite(i) && i >= 0 && i <= MAX_RENT_AMOUNT;
  const variableValid = variable.trim() !== "" && Number.isFinite(cv) && cv >= 0 && cv <= MAX_RENT_AMOUNT;
  const fixedValid = fixed.trim() !== "" && Number.isFinite(cf) && cf >= 0 && cf <= MAX_RENT_AMOUNT;
  const allValid = revenueValid && variableValid && fixedValid;
  const anyWritten = revenue.trim() !== "" || variable.trim() !== "" || fixed.trim() !== "";
  const result = useMemo(
    () => (allValid ? calcRentabilidad(i, cv, cf) : null),
    [allValid, i, cv, cf],
  );
  // Con los tres campos válidos no hay cifras: E-1 (todo cero) muestra
  // la guía de «escribe tus cifras», no un bloque de ceros.
  const hasFigures = allValid && (i > 0 || cv > 0 || cf > 0);
  const hintId = `${idPrefix}-hint`;
  const inputClass =
    "mt-1 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#0B0F19] px-3.5 py-2.5 text-sm text-slate-100 tabular-nums placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40";
  const sliderClass = "mt-1.5 w-full accent-emerald-500";

  const sliderField = (
    label: string,
    value: string,
    setValue: (v: string) => void,
    min: number,
    max: number,
    step: number,
  ) => {
    const num = Number(value);
    const sliderValue = value.trim() === "" || !Number.isFinite(num) ? min : clampNum(num, min, max);
    return (
      <div>
        <label className="text-xs text-slate-400">
          {label}
          <input
            data-no-swipe
            className={inputClass}
            type="number"
            min="0"
            max="1000000000000"
            step="any"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-describedby={hintId}
          />
        </label>
        <input
          data-no-swipe
          type="range"
          aria-label={label}
          className={sliderClass}
          min={min}
          max={max}
          step={step}
          value={sliderValue}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
    );
  };

  return (
    <div>
      <p className="mb-3 text-xs leading-relaxed text-slate-400">{t.clases.rentManual}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {sliderField(t.clases.rentRevenue, revenue, setRevenue, 0, 100000, 500)}
        {sliderField(t.clases.rentVariable, variable, setVariable, 0, 100000, 500)}
        {sliderField(t.clases.rentFixed, fixed, setFixed, 0, 50000, 500)}
      </div>
      <p id={hintId} className="mt-1.5 text-xs text-slate-400">{t.clases.rentHint}</p>
      {result !== null && hasFigures ? (
        <div role="status" className="mt-2 space-y-1">
          <p className="text-sm text-slate-100">
            {t.clases.rentTotalCost}: <strong className="tabular-nums text-slate-100">{fmtUsd(result.costosTotales, locale)}</strong>
          </p>
          <p className="text-sm text-slate-100">
            {t.clases.rentGross}:{" "}
            <strong className={`tabular-nums ${result.margenBruto < 0 ? "text-amber-400" : "text-emerald-400"}`}>
              {fmtUsd(result.margenBruto, locale)}
              {result.margenBrutoPct !== null ? ` (${fmtPct(result.margenBrutoPct, locale)})` : " (—)"}
            </strong>
          </p>
          <p className="text-sm text-slate-100">
            {t.clases.rentNet}:{" "}
            <strong className={`tabular-nums ${result.margenNeto < 0 ? "text-amber-400" : "text-emerald-400"}`}>
              {fmtUsd(result.margenNeto, locale)}
              {result.margenNetoPct !== null ? ` (${fmtPct(result.margenNetoPct, locale)})` : " (—)"}
            </strong>
            {result.margenNeto < 0 && <span className="text-amber-400"> · {t.clases.rentLoss}</span>}
          </p>
          <p className="text-sm text-slate-100">
            {t.clases.rentBreakeven}:{" "}
            {result.sinEquilibrio ? (
              <strong className="text-amber-400">{t.clases.rentNoBreakeven}</strong>
            ) : result.puntoEquilibrio === null ? (
              <strong className="tabular-nums text-slate-100">—</strong>
            ) : result.puntoEquilibrio === 0 ? (
              <strong className="text-emerald-400">{t.clases.rentBreakevenZero}</strong>
            ) : (
              <strong className="tabular-nums text-emerald-400">{fmtUsd(result.puntoEquilibrio, locale)}</strong>
            )}
          </p>
          <p className="text-sm text-slate-100">
            {t.clases.rentProfit}:{" "}
            <strong className={`tabular-nums ${result.rentabilidad !== null && result.rentabilidad < 0 ? "text-amber-400" : "text-emerald-400"}`}>
              {result.rentabilidad !== null ? fmtPct(result.rentabilidad, locale) : "—"}
            </strong>
          </p>
          {i === 0 && <p className="text-xs leading-relaxed text-slate-400">{t.clases.rentZeroRevenue}</p>}
        </div>
      ) : result !== null && !hasFigures ? (
        <p className="mt-2 text-sm text-slate-400">{t.clases.rentEnterAll}</p>
      ) : allValid ? (
        // Defensa en profundidad (E-8/E-11): con el tope 1e12 no se
        // alcanza, pero si el cálculo no fuera finito, aviso — nunca $∞.
        <p role="alert" className="mt-2 text-sm text-amber-400">{t.clases.rentOutOfRange}</p>
      ) : anyWritten ? (
        <p className="mt-2 text-sm text-slate-400">{t.clases.rentInvalid}</p>
      ) : (
        <p className="mt-2 text-sm text-slate-400">{t.clases.rentEnterAll}</p>
      )}
      <p className="mt-1.5 text-xs font-medium text-amber-400">{t.clases.rentHypothetical}</p>
    </div>
  );
}
