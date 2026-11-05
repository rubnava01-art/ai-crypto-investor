"use client";

import { useMemo, useState } from "react";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";
import { Field } from "./ui";

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

const COLORS = ["#34d399", "#38bdf8", "#fbbf24", "#f472b6", "#a78bfa", "#fb923c", "#2dd4bf", "#f87171"];

function BarChart({ data, fmt }: { data: ParsedPair[]; fmt: (n: number) => string }) {
  const W = 640;
  const H = 260;
  const max = Math.max(...data.map((d) => d.value), 0);
  const min = Math.min(...data.map((d) => d.value), 0);
  const range = max - min || 1;
  const slot = W / data.length;
  const bw = Math.max(8, Math.min(48, slot * 0.6));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Bar chart">
      {data.map((d, i) => {
        const h = ((d.value - min) / range) * 200;
        const x = i * slot + (slot - bw) / 2;
        const y = H - 30 - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={Math.max(h, 1)} fill={COLORS[i % COLORS.length]} rx={3} />
            <text x={x + bw / 2} y={Math.max(y - 4, 12)} textAnchor="middle" fontSize={11} fill="#e4e4e7">{fmt(d.value)}</text>
            <text x={x + bw / 2} y={H - 12} textAnchor="middle" fontSize={10} fill="#a1a1aa">{d.label.slice(0, 14)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function LineChart({ data, fmt }: { data: ParsedPair[]; fmt: (n: number) => string }) {
  const W = 640;
  const H = 260;
  const max = Math.max(...data.map((d) => d.value));
  const min = Math.min(...data.map((d) => d.value));
  const range = max - min || 1;
  const px = (i: number) => (data.length === 1 ? W / 2 : 30 + (i * (W - 60)) / (data.length - 1));
  const py = (v: number) => H - 30 - ((v - min) / range) * 200;
  const points = data.map((d, i) => `${px(i)},${py(d.value)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Line chart">
      <polyline points={points} fill="none" stroke="#34d399" strokeWidth={2} />
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={px(i)} cy={py(d.value)} r={4} fill="#34d399" />
          {data.length <= 12 && (
            <text x={px(i)} y={Math.max(py(d.value) - 8, 12)} textAnchor="middle" fontSize={11} fill="#e4e4e7">{fmt(d.value)}</text>
          )}
          <text x={px(i)} y={H - 12} textAnchor="middle" fontSize={10} fill="#a1a1aa">{d.label.slice(0, 14)}</text>
        </g>
      ))}
    </svg>
  );
}

function PieChart({ data, fmt }: { data: ParsedPair[]; fmt: (n: number) => string }) {
  const positives = data.filter((d) => d.value > 0);
  const total = positives.reduce((a, d) => a + d.value, 0);
  if (positives.length === 0 || total <= 0) return null;
  const cx = 130;
  const cy = 130;
  const r = 110;
  let acc = 0;
  const polar = (angle: number) => {
    const rad = (angle - 90) * (Math.PI / 180);
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const slices = positives.map((d, i) => {
    const start = (acc / total) * 360;
    acc += d.value;
    const end = (acc / total) * 360;
    const [x1, y1] = polar(start);
    const [x2, y2] = polar(end);
    const large = end - start > 180 ? 1 : 0;
    return { d, i, path: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`, pct: (d.value / total) * 100 };
  });
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <svg viewBox="0 0 260 260" className="w-full max-w-[260px] shrink-0" role="img" aria-label="Pie chart">
        {slices.map((s) => (
          <path key={s.i} d={s.path} fill={COLORS[s.i % COLORS.length]} stroke="#18181b" strokeWidth={1} />
        ))}
      </svg>
      <ul className="space-y-1 text-sm">
        {slices.map((s) => (
          <li key={s.i} className="text-zinc-300">
            <span className="mr-2 inline-block h-3 w-3 rounded-sm align-middle" style={{ background: COLORS[s.i % COLORS.length] }} />
            {s.d.label}: {fmt(s.d.value)} ({s.pct.toFixed(1)}%)
          </li>
        ))}
      </ul>
    </div>
  );
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
          className="min-h-[44px] flex-1 rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500">
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
            <div className="overflow-x-auto">
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
              <BarChart data={result.parsed} fmt={fmt} />
              <p className="mt-1 text-xs text-zinc-400">{t.analisis.sourceNote}: {sourceLine}</p>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-zinc-200">{t.analisis.lineTitle}</h3>
              <LineChart data={result.parsed} fmt={fmt} />
              <p className="mt-1 text-xs text-zinc-400">{t.analisis.sourceNote}: {sourceLine}</p>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-zinc-200">{t.analisis.pieTitle}</h3>
              {result.parsed.some((d) => d.value > 0) ? (
                <PieChart data={result.parsed} fmt={fmt} />
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
