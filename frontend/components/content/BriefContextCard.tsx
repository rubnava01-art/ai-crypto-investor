// Tarjeta de contexto del brief para la generación (NEST, 2026-11-17).
// Muestra solo las respuestas que alimentan la generación: personalidad
// (Q2), cliente ideal (Q3) y valores (Q5). Sin brief, o con respuestas
// vacías, muestra qué falta — nunca inventa contexto.
"use client";

import type { BrandBrief } from "../../lib/api";
import { useLanguage } from "../../lib/i18n";

export function BriefContextCard({
  brief,
  onUseAsTema,
}: {
  brief: BrandBrief | null;
  onUseAsTema?: (text: string) => void;
}) {
  const { t } = useLanguage();
  if (!brief) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-700 px-4 py-3">
        <p className="text-sm text-zinc-400">{t.brief.contextEmpty}</p>
      </div>
    );
  }
  const personality = (brief.answers.q2 || "").trim();
  const ideal = (brief.answers.q3 || "").trim();
  const values = (brief.answers.q5 || "").trim();
  const missing = brief.missing.length;
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
        {t.brief.contextTitle} · {brief.contact_name}
      </p>
      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="text-xs text-zinc-400">{t.brief.contextPersonality}</dt>
          <dd className="text-zinc-100">{personality || "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-400">{t.brief.contextIdeal}</dt>
          <dd className="whitespace-pre-wrap text-zinc-100">{ideal || "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-400">{t.brief.contextValues}</dt>
          <dd className="whitespace-pre-wrap text-zinc-100">{values || "—"}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-zinc-400">
        {missing === 0
          ? t.brief.contextComplete
          : t.brief.contextMissing.replace("{n}", String(missing))}
      </p>
      {personality && onUseAsTema && (
        <button
          type="button"
          onClick={() => onUseAsTema(personality)}
          className="mt-3 min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
        >
          {t.brief.useAsTema}
        </button>
      )}
    </div>
  );
}
