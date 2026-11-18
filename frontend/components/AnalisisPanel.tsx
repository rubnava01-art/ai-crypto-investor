"use client";

import { useMemo, useState } from "react";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";
import { Field } from "./ui";
import { BarChart, LineChart, PieChart } from "./bi/BiCharts";

const inputCls =
  "w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 transition-colors focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

export interface ParsedPair {
  label: string;
  original: string;
  value: number;
}

interface ParseResult {
  parsed: ParsedPair[];
  unparsed: string[];
}

/** Parser tolerante, solo en el navegador: acepta "Ventas 12000",
 * "Ventas: 12,000", "Ventas = $12,000.50" o "Ventas — 12,5". El símbolo
 * de moneda se quita solo para el cálculo; el texto original se conserva
 * para mostrarlo. Regla de comas: una coma única con 1-2 decimales
 * ("12,5") es decimal; en cualquier otro caso las comas son miles
 * ("12,000" = 12000). Una línea sin número interpretable NO se descarta
 * en silencio: va a la lista "no interpretadas". */
export function parseCompanyText(text: string): ParseResult {
  const parsed: ParsedPair[] = [];
  const unparsed: string[] = [];
  let counter = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(/^(.*?)[\s:=\-–—]*([$€£]?\s*-?\d[\d,.\s]*\d|[$€£]?\s*-?\d)\s*%?\s*$/);
    if (!m) {
      unparsed.push(line);
      continue;
    }
    let rawNum = m[2].replace(/[$€£\s]/g, "");
    if (/^-?\d+,\d{1,2}$/.test(rawNum)) rawNum = rawNum.replace(",", ".");
    else rawNum = rawNum.replace(/,/g, "");
    const value = Number(rawNum);
    if (!Number.isFinite(value)) {
      unparsed.push(line);
      continue;
    }
    counter += 1;
    let label = (m[1] ?? "").trim().replace(/[:=\-–—,]+$/, "").trim();
    if (!label) label = `Dato ${counter}`;
    parsed.push({ label, original: line, value });
  }
  return { parsed, unparsed };
}

/** Herramienta de análisis corporativo — familia Negocio, 100% en el
 * navegador: nada se envía a ningún servidor ni a ninguna IA, no hay
 * backend ni dependencias nuevas, y los gráficos son SVG puro. El
 * usuario pega texto con datos etiquetados; la salida es tabla de
 * pares, gráficos, estadísticas calculadas solo con los números
 * interpretados, KPIs y un resumen DESCRIPTIVO (mayor, menor, total):
 * sin predicciones ni referencias inventadas. Sin texto pegado no hay
 * gráficos. */
export function AnalisisPanel() {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const fmt = (n: number) => n.toLocaleString(locale, { maximumFractionDigits: 2 });
  const [text, setText] = useState("");
  const [result, setResult] = useState<ParseResult | null>(null);

  const stats = useMemo(() => {
    if (!result || result.parsed.length === 0) return null;
    const values = result.parsed.map((d) => d.value);
    const total = values.reduce((a, v) => a + v, 0);
    const maxPair = result.parsed.reduce((a, b) => (b.value > a.value ? b : a));
    const minPair = result.parsed.reduce((a, b) => (b.value < a.value ? b : a));
    return { total, avg: total / values.length, min: minPair, max: maxPair, count: values.length };
  }, [result]);

  const sourceLine = result && result.parsed.length > 0
    ? result.parsed.map((d) => `${d.label}: ${fmt(d.value)}`).join(" · ")
    : "";

  return (
    <Panel title={t.analisis.panelTitle}>
      <p className="mb-4 text-sm leading-relaxed text-zinc-400">{t.analisis.intro}</p>
      <p className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-xs leading-relaxed text-zinc-400">
        {t.analisis.localNote}
      </p>
      <Field label={t.analisis.pasteAria}>
        <textarea aria-label={t.analisis.pasteAria} className={inputCls} placeholder={t.analisis.pastePlaceholder}
          value={text} onChange={(e) => setText(e.target.value)} rows={6} />
      </Field>
      <div className="mt-3 flex gap-2">
        <button onClick={() => setResult(parseCompanyText(text))}
          className="min-h-[44px] flex-1 rounded-lg bg-emerald-700 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800">
          {t.analisis.parse}
        </button>
        <button onClick={() => { setText(""); setResult(null); }}
          className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800">
          {t.analisis.clear}
        </button>
      </div>

      {!result || result.parsed.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-400">{t.analisis.empty}</p>
      ) : (
        <>
          {stats && (
            <div className="mt-6">
              <h3 className="mb-3 text-sm font-semibold text-zinc-200">{t.analisis.kpiTitle}</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3"><p className="text-xs text-zinc-400">{t.analisis.total}</p><p className="mt-1 text-lg font-semibold text-zinc-100">{fmt(stats.total)}</p></div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3"><p className="text-xs text-zinc-400">{t.analisis.average}</p><p className="mt-1 text-lg font-semibold text-zinc-100">{fmt(stats.avg)}</p></div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3"><p className="text-xs text-zinc-400">{t.analisis.largest}</p><p className="mt-1 text-lg font-semibold text-zinc-100">{fmt(stats.max.value)}</p><p className="text-xs text-zinc-400">{stats.max.label}</p></div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3"><p className="text-xs text-zinc-400">{t.analisis.smallest}</p><p className="mt-1 text-lg font-semibold text-zinc-100">{fmt(stats.min.value)}</p><p className="text-xs text-zinc-400">{stats.min.label}</p></div>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-zinc-300">
                {t.analisis.summaryPrefix} {stats.count} {t.analisis.countSuffix} {fmt(stats.total)}. {t.analisis.largest}: {stats.max.label} ({fmt(stats.max.value)}). {t.analisis.smallest}: {stats.min.label} ({fmt(stats.min.value)}).
              </p>
              <p className="mt-3 text-sm text-zinc-300">
                {t.analisis.statsTitle}: {t.analisis.total} {fmt(stats.total)} · {t.analisis.average} {fmt(stats.avg)} · {t.analisis.min} {fmt(stats.min.value)} ({stats.min.label}) · {t.analisis.max} {fmt(stats.max.value)} ({stats.max.label}) · {t.analisis.count} {stats.count}
              </p>
            </div>
          )}

          <div className="mt-6">
            <h3 className="mb-3 text-sm font-semibold text-zinc-200">{t.analisis.tableTitle}</h3>
            {/* H-8: tarjetas apiladas en teléfono (patrón CRM): la tabla, con
                min-w de 480 px, obligaba a scroll horizontal para leer un
                dato; en móvil se muestra la tarjeta y la tabla queda para
                sm en adelante. Sin claves i18n nuevas: reutiliza etiqueta,
                original y valor. */}
            <ul className="space-y-3 sm:hidden">
              {result.parsed.map((d, i) => (
                <li key={i} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                  <p className="text-sm font-semibold text-zinc-100">{d.label}</p>
                  <p className="mt-1 break-words text-sm text-zinc-300">{d.original}</p>
                  <p className="mt-1 text-sm font-semibold tabular-nums text-zinc-100">{fmt(d.value)}</p>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-400">
                    <th className="py-3 pr-3 font-semibold">{t.analisis.thLabel}</th>
                    <th className="py-3 pr-3 font-semibold">{t.analisis.thOriginal}</th>
                    <th className="py-3 font-semibold">{t.analisis.thValue}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {result.parsed.map((d, i) => (
                    <tr key={i} className="align-top">
                      <td className="py-3 pr-3 font-semibold text-zinc-100">{d.label}</td>
                      <td className="py-3 pr-3 text-zinc-300">{d.original}</td>
                      <td className="py-3 text-zinc-100">{fmt(d.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-6 space-y-6">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-zinc-200">{t.analisis.barTitle}</h3>
              <BarChart data={result.parsed} fmt={fmt} ariaLabel={t.analisis.barTitle} />
              <p className="mt-1 text-xs text-zinc-400">{t.analisis.sourceNote}: {sourceLine}</p>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-zinc-200">{t.analisis.lineTitle}</h3>
              <LineChart data={result.parsed} fmt={fmt} ariaLabel={t.analisis.lineTitle} />
              <p className="mt-1 text-xs text-zinc-400">{t.analisis.sourceNote}: {sourceLine}</p>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-zinc-200">{t.analisis.pieTitle}</h3>
              {result.parsed.some((d) => d.value > 0) ? (
                <PieChart data={result.parsed} fmt={fmt} ariaLabel={t.analisis.pieTitle} />
              ) : (
                <p className="text-sm text-zinc-400">{t.analisis.pieNeedsPositive}</p>
              )}
              <p className="mt-1 text-xs text-zinc-400">{t.analisis.sourceNote}: {sourceLine}</p>
            </div>
          </div>
        </>
      )}

      {result && result.unparsed.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-semibold text-zinc-200">{t.analisis.unparsedTitle}</h3>
          <ul className="space-y-1">
            {result.unparsed.map((line, i) => (
              <li key={i} className="text-sm text-amber-300">{line}</li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
