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
//
// Fase 3 (2026-11-23): sliders sincronizados con los inputs (capital,
// tasa, años) + aporte mensual (input + slider); gráfica SVG anual hecha
// a mano (mismo estilo que BtcChart, sin librerías) con dos series — sin
// aportes vs. con aportes — tooltip al hover/toque y con teclado, y
// tabla anual accesible como alternativa textual. En el héroe
// (`compact`) la gráfica va colapsada tras un botón, para no duplicar
// peso en la landing; en Clases se muestra por defecto.
import { useMemo, useRef, useState } from "react";
import { useLanguage } from "../lib/i18n";

const MAX_PRINCIPAL = 1e12;
const MAX_MONTHLY = 1e6;
const MAX_YEARS = 100;

const fmtUsd = (n: number, locale: string) =>
  n.toLocaleString(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Serie anual (año 0..n) con capitalización mensual: el aporte mensual
 * se suma cada mes, así la comparación con/sin aportes es exacta. */
function yearlySeries(principal: number, ratePct: number, years: number, monthly: number): number[] {
  const rm = ratePct / 100 / 12;
  const out: number[] = [principal];
  let v = principal;
  for (let y = 1; y <= years; y++) {
    for (let m = 0; m < 12; m++) {
      v = v * (1 + rm) + monthly;
    }
    out.push(v);
  }
  return out;
}

const clampNum = (v: number, lo: number, hi: number) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;

export function CompoundCalculator({ idPrefix = "calc", compact = false }: { idPrefix?: string; compact?: boolean }) {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const [principal, setPrincipal] = useState("");
  // SIN tasa por defecto: vacía hasta que el usuario escriba una.
  const [rate, setRate] = useState("");
  const [years, setYears] = useState("10");
  const [monthly, setMonthly] = useState("");
  const [showChart, setShowChart] = useState(!compact);
  const [hoverYear, setHoverYear] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const p = Number(principal);
  const r = Number(rate);
  const n = Number(years);
  const m = monthly.trim() === "" ? 0 : Number(monthly);
  const principalValid = principal.trim() !== "" && Number.isFinite(p) && p > 0 && p <= MAX_PRINCIPAL;
  const rateValid = rate.trim() !== "" && Number.isFinite(r) && r >= 0;
  const yearsValid = years.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= MAX_YEARS;
  const monthlyValid = monthly.trim() === "" || (Number.isFinite(m) && m >= 0 && m <= MAX_MONTHLY);
  const valid = principalValid && yearsValid && monthlyValid;
  const seriesNo = useMemo(
    () => (valid && rateValid ? yearlySeries(p, r, n, 0) : null),
    [valid, rateValid, p, r, n],
  );
  const seriesWith = useMemo(
    () => (valid && rateValid && m > 0 ? yearlySeries(p, r, n, m) : null),
    [valid, rateValid, p, r, n, m],
  );
  const result = seriesNo !== null && Number.isFinite(seriesNo[n]) ? seriesNo[n] : null;
  const resultWith = seriesWith !== null && Number.isFinite(seriesWith[n]) ? seriesWith[n] : null;
  const resultOverflow =
    seriesNo !== null && !Number.isFinite(seriesNo[n]);
  const hintId = `${idPrefix}-rate-hint`;
  const monthlyHintId = `${idPrefix}-monthly-hint`;
  const inputClass =
    "mt-1 w-full min-h-[44px] rounded-lg border border-slate-700 bg-[#0B0F19] px-3.5 py-2.5 text-sm text-slate-100 tabular-nums placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40";
  const sliderClass = "mt-1.5 w-full accent-emerald-500";

  // Gráfica anual (SVG hecha a mano, como BtcChart).
  const chartW = 560;
  const chartH = 220;
  const chartMax = Math.max(
    ...(seriesNo ?? [0]),
    ...(seriesWith ?? [0]),
    1,
  );
  const chartMin = 0;
  const chartSpan = chartMax - chartMin || 1;
  const xFor = (year: number) => (year / Math.max(n, 1)) * chartW;
  const yFor = (v: number) => chartH - 8 - ((v - chartMin) / chartSpan) * (chartH - 16);
  const pts = (series: number[]) =>
    series.map((v, i) => `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`).join(" ");
  const yearFromEvent = (e: React.MouseEvent | React.TouchEvent): number | null => {
    const el = svgRef.current;
    if (!el || n < 1) return null;
    const rect = el.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0]?.clientX : e.clientX;
    if (clientX === undefined) return null;
    const ratio = (clientX - rect.left) / rect.width;
    return clampNum(Math.round(ratio * n), 0, n);
  };
  const hoveredNo = hoverYear !== null && seriesNo ? seriesNo[hoverYear] : null;
  const hoveredWith = hoverYear !== null && seriesWith ? seriesWith[hoverYear] : null;

  const sliderField = (
    label: string,
    value: string,
    setValue: (v: string) => void,
    min: number,
    max: number,
    step: number,
    inputProps: { min?: string; max?: string; step?: string; inputMode?: "decimal" | "numeric"; placeholder?: string; ariaDescribedBy?: string },
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
            min={inputProps.min}
            max={inputProps.max}
            step={inputProps.step}
            inputMode={inputProps.inputMode}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={inputProps.placeholder}
            aria-describedby={inputProps.ariaDescribedBy}
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {sliderField(t.clases.calcInitial, principal, setPrincipal, 0, 100000, 500, {
          min: "0", max: "1000000000000", step: "any", inputMode: "decimal", placeholder: "1000",
        })}
        {sliderField(t.clases.calcRate, rate, setRate, 0, 20, 0.5, {
          min: "0", step: "any", inputMode: "decimal", placeholder: "—", ariaDescribedBy: hintId,
        })}
        {sliderField(t.clases.calcYears, years, setYears, 1, 30, 1, {
          min: "1", max: "100", step: "1", inputMode: "numeric",
        })}
        {sliderField(t.clases.calcMonthly, monthly, setMonthly, 0, 2000, 10, {
          min: "0", max: "1000000", step: "any", inputMode: "decimal", placeholder: "0", ariaDescribedBy: monthlyHintId,
        })}
      </div>
      <p id={hintId} className="mt-1.5 text-xs text-slate-400">{t.clases.calcRateHint}</p>
      <p id={monthlyHintId} className="mt-0.5 text-xs text-slate-400">{t.clases.calcMonthlyHint}</p>
      {result !== null ? (
        <div className="mt-2 space-y-1">
          <p className="text-sm text-slate-100">
            {t.clases.calcResult}: <strong className="tabular-nums text-emerald-400">{fmtUsd(result, locale)}</strong>
          </p>
          {resultWith !== null && (
            <p className="text-sm text-slate-100">
              {t.clases.calcChartWithContrib}: <strong className="tabular-nums text-sky-400">{fmtUsd(resultWith, locale)}</strong>
            </p>
          )}
        </div>
      ) : resultOverflow ? (
        <p role="alert" className="mt-2 text-sm text-amber-400">{t.clases.calcOutOfRange}</p>
      ) : valid && !rateValid ? (
        <p className="mt-2 text-sm text-slate-400">
          {rate.trim() !== "" && Number.isFinite(r) && r < 0 ? t.clases.calcRateNegative : t.clases.calcEnterRate}
        </p>
      ) : principal.trim() !== "" && !yearsValid ? (
        <p className="mt-2 text-sm text-slate-400">{t.clases.calcYearsRange}</p>
      ) : (
        <p className="mt-2 text-sm text-slate-400">{principal.trim() === "" && rate.trim() === "" ? t.clases.calcEnterAll : t.clases.calcInvalid}</p>
      )}
      <p className="mt-1.5 text-xs font-medium text-amber-400">{t.clases.calcHypothetical}</p>

      {result !== null && seriesNo && (
        <div className="mt-4">
          <button
            type="button"
            data-no-swipe
            aria-expanded={showChart}
            onClick={() => setShowChart((v) => !v)}
            className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-emerald-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            {showChart ? t.clases.calcHideChart : t.clases.calcShowChart}
          </button>
          {showChart && (
            <div className="mt-3">
              <h3 className="text-sm font-semibold text-slate-100">{t.clases.calcChartTitle}</h3>
              <div className="relative mt-2">
                <svg
                  ref={svgRef}
                  viewBox={`0 0 ${chartW} ${chartH}`}
                  className="w-full rounded-lg border border-slate-800 bg-[#0B0F19]"
                  role="img"
                  tabIndex={0}
                  aria-label={`${t.clases.calcChartTitle}: ${t.clases.calcChartHint}`}
                  onMouseMove={(e) => setHoverYear(yearFromEvent(e))}
                  onMouseLeave={() => setHoverYear(null)}
                  onTouchStart={(e) => setHoverYear(yearFromEvent(e))}
                  onTouchMove={(e) => setHoverYear(yearFromEvent(e))}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight") setHoverYear((v) => clampNum((v ?? -1) + 1, 0, n));
                    if (e.key === "ArrowLeft") setHoverYear((v) => clampNum((v ?? 1) - 1, 0, n));
                  }}
                >
                  <polyline points={pts(seriesNo)} fill="none" stroke="#10b981" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                  {seriesWith && (
                    <polyline points={pts(seriesWith)} fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                  )}
                  {hoverYear !== null && hoveredNo !== null && (
                    <>
                      <line x1={xFor(hoverYear)} y1={4} x2={xFor(hoverYear)} y2={chartH - 4} stroke="#64748b" strokeWidth="1" strokeDasharray="3 3" />
                      <circle cx={xFor(hoverYear)} cy={yFor(hoveredNo)} r="4.5" fill="#10b981" stroke="#030712" strokeWidth="1.5" />
                      {hoveredWith !== null && (
                        <circle cx={xFor(hoverYear)} cy={yFor(hoveredWith)} r="4.5" fill="#38bdf8" stroke="#030712" strokeWidth="1.5" />
                      )}
                    </>
                  )}
                </svg>
                {hoverYear !== null && hoveredNo !== null && (
                  <div
                    role="status"
                    className="pointer-events-none absolute left-2 top-2 max-w-[90%] rounded-lg border border-slate-700 bg-[#0B0F19]/95 px-3 py-2 text-xs leading-relaxed text-slate-200 shadow-lg"
                  >
                    <p className="font-semibold">
                      {t.clases.calcTableYear} {hoverYear}
                    </p>
                    <p>
                      {t.clases.calcChartNoContrib}: <span className="font-semibold tabular-nums text-emerald-400">{fmtUsd(hoveredNo, locale)}</span>
                    </p>
                    {hoveredWith !== null && (
                      <p>
                        {t.clases.calcChartWithContrib}: <span className="font-semibold tabular-nums text-sky-400">{fmtUsd(hoveredWith, locale)}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
              <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
                <span><span className="text-emerald-400">—</span> {t.clases.calcChartNoContrib}</span>
                {seriesWith && <span><span className="text-sky-400">—</span> {t.clases.calcChartWithContrib}</span>}
              </p>
              <p className="mt-1 text-xs text-slate-400">{t.clases.calcChartHint}</p>
              <details className="mt-3 rounded-lg border border-slate-800 bg-[#0B0F19]/60 px-3 py-2">
                <summary className="cursor-pointer py-1 text-sm font-semibold text-slate-200">{t.clases.calcTableTitle}</summary>
                <div className="max-h-64 overflow-auto">
                  <table className="mt-2 w-full text-left text-sm tabular-nums">
                    <thead>
                      <tr className="text-xs uppercase tracking-wide text-slate-400">
                        <th scope="col" className="py-1.5 pr-2 font-semibold">{t.clases.calcTableYear}</th>
                        <th scope="col" className="py-1.5 pr-2 font-semibold">{t.clases.calcTableNoContrib}</th>
                        {seriesWith && <th scope="col" className="py-1.5 font-semibold">{t.clases.calcTableWithContrib}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {seriesNo.map((v, y) => (
                        <tr key={y} className="border-t border-slate-800/80 text-slate-200">
                          <th scope="row" className="py-1.5 pr-2 font-normal">{y}</th>
                          <td className="py-1.5 pr-2">{fmtUsd(v, locale)}</td>
                          {seriesWith && <td className="py-1.5">{fmtUsd(seriesWith[y], locale)}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
