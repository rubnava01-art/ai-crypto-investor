// Gráficos SVG puros (extraídos de AnalisisPanel.tsx, 2026-11-17, sin
// cambio de comportamiento). El aria-label llega por i18n desde el llamador
// (antes era texto fijo en inglés). El BI los alimenta con datos del
// backend; AnalisisPanel sigue usándolos con su texto pegado local.
"use client";

export interface ChartDatum {
  label: string;
  value: number;
}

const COLORS = ["#34d399", "#38bdf8", "#fbbf24", "#f472b6", "#a78bfa", "#fb923c", "#2dd4bf", "#f87171"];

export function BarChart({ data, fmt, ariaLabel }: { data: ChartDatum[]; fmt: (n: number) => string; ariaLabel: string }) {
  const W = 640;
  const H = 260;
  const max = Math.max(...data.map((d) => d.value), 0);
  const min = Math.min(...data.map((d) => d.value), 0);
  const range = max - min || 1;
  const slot = W / data.length;
  const bw = Math.max(8, Math.min(48, slot * 0.6));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={ariaLabel}>
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

export function LineChart({ data, fmt, ariaLabel }: { data: ChartDatum[]; fmt: (n: number) => string; ariaLabel: string }) {
  const W = 640;
  const H = 260;
  const max = Math.max(...data.map((d) => d.value));
  const min = Math.min(...data.map((d) => d.value));
  const range = max - min || 1;
  const px = (i: number) => (data.length === 1 ? W / 2 : 30 + (i * (W - 60)) / (data.length - 1));
  const py = (v: number) => H - 30 - ((v - min) / range) * 200;
  const points = data.map((d, i) => `${px(i)},${py(d.value)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={ariaLabel}>
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

export function PieChart({ data, fmt, ariaLabel }: { data: ChartDatum[]; fmt: (n: number) => string; ariaLabel: string }) {
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
      <svg viewBox="0 0 260 260" className="w-full max-w-[260px] shrink-0" role="img" aria-label={ariaLabel}>
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
