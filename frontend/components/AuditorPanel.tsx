"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type WebAudit } from "../lib/api";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";
import { useCancelled } from "../lib/useLoad";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-2 focus-visible:ring-emerald-500/40";

/** Forma EXACTA que escribe el Analizador de redes sociales en
 * localStorage ("grow-social-analyses"). Se valida defensivamente:
 * solo entran filas con network (texto) y score (0-100); el resto
 * se ignora sin romper el panel. */
type SocialAnalysis = {
  id: string | number;
  network: string;
  handle: string;
  url: string;
  analyzedAt: string;
  followers: number | null;
  engagement: number | null;
  score: number;
  level: "low" | "medium" | "high";
  notes: string;
};

const CAT_COLORS: Record<string, string> = {
  seo: "#34d399",
  social: "#38bdf8",
  rastreo: "#a78bfa",
  rendimiento: "#fbbf24",
};

type BarRow = { label: string; value: number; max: number; display: string; color: string };

/** Barras horizontales en SVG puro (sin dependencias). */
function HBarChart({ rows, ariaLabel }: { rows: BarRow[]; ariaLabel: string }) {
  const W = 560;
  const ROW_H = 30;
  const LABEL_W = 120;
  const VAL_W = 96;
  const barMaxW = W - LABEL_W - VAL_W;
  const H = rows.length * ROW_H + 8;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel} className="block">
      {rows.map((r, i) => {
        const y = 8 + i * ROW_H;
        const w = r.max > 0 && r.value > 0 ? Math.max(4, (r.value / r.max) * barMaxW) : 0;
        const label = r.label.length > 16 ? `${r.label.slice(0, 15)}…` : r.label;
        return (
          <g key={`${r.label}-${i}`}>
            <text x={0} y={y + 14} fontSize={12} fill="#d4d4d8">{label}</text>
            <rect x={LABEL_W} y={y} width={barMaxW} height={18} rx={4} fill="#27272a" />
            <rect x={LABEL_W} y={y} width={w} height={18} rx={4} fill={r.color} />
            <text x={LABEL_W + barMaxW + 8} y={y + 14} fontSize={12} fill="#e4e4e7">{r.display}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Línea de puntaje en el tiempo en SVG puro (sin dependencias). */
function ScoreLineChart({ points, locale }: { points: { date: Date; score: number }[]; locale: string }) {
  const W = 560;
  const H = 180;
  const PAD_L = 36;
  const PAD_R = 12;
  const PAD_T = 16;
  const PAD_B = 28;
  const iw = W - PAD_L - PAD_R;
  const ih = H - PAD_T - PAD_B;
  const xs = points.map((_, i) => (points.length === 1 ? PAD_L + iw / 2 : PAD_L + (i / (points.length - 1)) * iw));
  const ys = points.map((p) => PAD_T + (1 - p.score / 100) * ih);
  const line = points.map((_, i) => `${xs[i].toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const fmt = (d: Date) => d.toLocaleDateString(locale, { day: "numeric", month: "short" });
  const xLabels = points.length <= 2 ? points : [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Score history: ${points.map((p) => `${fmt(p.date)} ${p.score}`).join(", ")}`} className="block">
      {[0, 50, 100].map((v) => {
        const y = PAD_T + (1 - v / 100) * ih;
        return (
          <g key={v}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="#27272a" strokeWidth={1} />
            <text x={PAD_L - 6} y={y + 4} fontSize={11} fill="#a1a1aa" textAnchor="end">{v}</text>
          </g>
        );
      })}
      <polyline points={line} fill="none" stroke="#34d399" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={xs[i]} cy={ys[i]} r={4} fill="#34d399" stroke="#09090b" strokeWidth={1} />
          {points.length <= 12 && (
            <text x={xs[i]} y={ys[i] - 8} fontSize={11} fill="#e4e4e7" textAnchor="middle">{p.score}</text>
          )}
        </g>
      ))}
      {xLabels.map((p) => {
        const i = points.indexOf(p);
        return (
          <text key={i} x={xs[i]} y={H - 8} fontSize={11} fill="#a1a1aa" textAnchor="middle">{fmt(p.date)}</text>
        );
      })}
    </svg>
  );
}

/** Auditor web: revisa UNA página (velocidad medida + SEO básico).
 * El puntaje es transparente: % de la lista de verificación aprobado,
 * siempre mostrado CON la lista completa. Informe estilo Semrush:
 * "Salud del sitio" con conteos por severidad (errores, advertencias,
 * avisos) y lista agrupada por categoría (SEO, Social, Rastreo,
 * Rendimiento). NO es un puntaje Lighthouse ni PageSpeed y NO son
 * datos de Semrush: la fuente honesta es la revisión propia de la app
 * (página, robots.txt y sitemap). No hay rastreo del sitio ni Core
 * Web Vitals. El servidor rechaza URLs privadas/reservadas antes de
 * descargar nada. */
export function AuditorPanel() {
  const isCancelled = useCancelled();
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<WebAudit | null>(null);
  const [recent, setRecent] = useState<WebAudit[]>([]);
  const [social, setSocial] = useState<SocialAnalysis[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRecent = useCallback(async () => {
    try {
      const _load1 = await api.listWebAudits();
      if (isCancelled()) return;
      setRecent(_load1);
    } catch {
      setRecent([]);
    }
  }, []);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  // Resumen social: lee lo que guardó el Analizador de redes en
  // este navegador (localStorage "grow-social-analyses"). Se relee
  // al enfocar la pestaña y cuando otra pestaña lo cambia; las filas
  // malformadas se ignoran sin romper el panel.
  const loadSocial = useCallback(() => {
    try {
      const raw = window.localStorage.getItem("grow-social-analyses");
      if (!raw) {
        setSocial([]);
        return;
      }
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setSocial([]);
        return;
      }
      const valid = parsed.filter((e): e is SocialAnalysis => {
        if (!e || typeof e !== "object") return false;
        const r = e as Record<string, unknown>;
        return (
          typeof r.network === "string" &&
          r.network.trim().length > 0 &&
          typeof r.score === "number" &&
          Number.isFinite(r.score) &&
          r.score >= 0 &&
          r.score <= 100
        );
      });
      setSocial(valid);
    } catch {
      setSocial([]);
    }
  }, []);

  useEffect(() => {
    loadSocial();
    window.addEventListener("storage", loadSocial);
    window.addEventListener("focus", loadSocial);
    return () => {
      window.removeEventListener("storage", loadSocial);
      window.removeEventListener("focus", loadSocial);
    };
  }, [loadSocial]);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = url.trim();
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api.runWebAudit(target);
      setResult(data);
      await loadRecent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.auditor.errAudit);
    } finally {
      setBusy(false);
    }
  };

  const scoreColor =
    !result || result.score === null
      ? "text-zinc-300"
      : result.score >= 80
        ? "text-emerald-400"
        : result.score >= 50
          ? "text-amber-400"
          : "text-red-400";

  // Informe estilo Semrush: salud del sitio + conteos por severidad y
  // lista agrupada por categoría. Las auditorías viejas guardadas no
  // traen category/severity: defaults seguros (seo / aviso).
  const sevOf = (c: { severity?: string }) => c.severity ?? "aviso";
  const catOf = (c: { category?: string }) => c.category ?? "seo";
  const failed = result?.checks.filter((c) => !c.passed) ?? [];
  const errCount = failed.filter((c) => sevOf(c) === "error").length;
  const warnCount = failed.filter((c) => sevOf(c) === "advertencia").length;
  const noteCount = failed.filter((c) => sevOf(c) === "aviso").length;
  const CATEGORY_ORDER = ["seo", "social", "rastreo", "rendimiento"];
  const catName: Record<string, string> = {
    seo: t.auditor.catSeo,
    social: t.auditor.catSocial,
    rastreo: t.auditor.catRastreo,
    rendimiento: t.auditor.catRendimiento,
  };
  const grouped = result
    ? [
        ...CATEGORY_ORDER.map((cat) => ({ cat, checks: result.checks.filter((c) => catOf(c) === cat) })),
        // Por si una fila vieja trajera otra categoría: no se pierde.
        ...Array.from(new Set(result.checks.map(catOf)))
          .filter((cat) => !CATEGORY_ORDER.includes(cat))
          .map((cat) => ({ cat, checks: result.checks.filter((c) => catOf(c) === cat) })),
      ].filter((g) => g.checks.length > 0)
    : [];
  // Etiquetas localizadas de los 4 ítems nuevos (el backend las manda
  // en español; el resto conserva su etiqueta guardada).
  const newLabels: Record<string, string> = {
    robots_txt: t.auditor.checkRobotsTxt,
    sitemap_xml: t.auditor.checkSitemapXml,
    twitter_card: t.auditor.checkTwitterCard,
    favicon: t.auditor.checkFavicon,
  };
  const sevBadge: Record<string, string> = {
    error: "bg-red-500/10 text-red-400 ring-red-500/30",
    advertencia: "bg-amber-500/10 text-amber-300 ring-amber-500/30",
    aviso: "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30",
  };
  const sevDot: Record<string, string> = {
    error: "bg-red-400",
    advertencia: "bg-amber-400",
    aviso: "bg-zinc-400",
  };
  const sevName: Record<string, string> = {
    error: t.auditor.severityError,
    advertencia: t.auditor.severityWarning,
    aviso: t.auditor.severityNotice,
  };

  // Informe gráfico: todo calculado del resultado actual, nada inventado.
  const catScores = CATEGORY_ORDER.map((cat) => {
    const checks = result?.checks.filter((c) => catOf(c) === cat) ?? [];
    const passed = checks.filter((c) => c.passed).length;
    return {
      cat,
      total: checks.length,
      passed,
      pct: checks.length > 0 ? Math.round((passed / checks.length) * 100) : 0,
    };
  }).filter((s) => s.total > 0);
  const sevMax = Math.max(1, errCount, warnCount, noteCount);

  // Historial: la API SÍ expone auditorías pasadas (listWebAudits).
  // Solo puntos reales con puntaje y fecha, ordenados en el tiempo.
  const historyPoints = useMemo(() => {
    const byId = new Map<number, { date: Date; score: number }>();
    for (const a of recent) {
      if (a.score === null || !a.created_at) continue;
      const date = new Date(a.created_at);
      if (Number.isNaN(date.getTime())) continue;
      byId.set(a.id, { date, score: a.score });
    }
    return [...byId.values()].sort((x, y) => x.date.getTime() - y.date.getTime());
  }, [recent]);

  // Redes: conteo + puntaje heurístico promedio por red.
  const socialByNetwork = useMemo(() => {
    const map = new Map<string, { network: string; count: number; total: number }>();
    for (const s of social) {
      const key = s.network.trim().toLowerCase();
      const cur = map.get(key) ?? { network: s.network.trim(), count: 0, total: 0 };
      cur.count += 1;
      cur.total += s.score;
      map.set(key, cur);
    }
    return [...map.values()]
      .map((g) => ({ network: g.network, count: g.count, avg: Math.round(g.total / g.count) }))
      .sort((a, b) => b.avg - a.avg);
  }, [social]);

  return (
    <div className="space-y-4">
      <Panel title={t.auditor.panelTitle} badge={<span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">{t.auditor.badge}</span>}>
        <p className="mb-3 text-xs leading-relaxed text-zinc-400">
          {t.auditor.intro}
        </p>
        <form onSubmit={run} className="flex flex-col gap-2 sm:flex-row">
          <input aria-label={t.auditor.urlAria}
            className={inputCls}
            placeholder={t.auditor.urlPlaceholder}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            maxLength={2048}
            autoComplete="off"
            inputMode="url"
          />
          <button
            type="submit"
            disabled={busy || !url.trim()}
            className="shrink-0 rounded-lg bg-emerald-600 min-h-[44px] px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50"
          >
            {busy ? t.auditor.auditBusy : t.auditor.audit}
          </button>
        </form>
        {error && <p role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
      </Panel>

      {result && (
        <Panel title={t.auditor.resultTitle}>
          <div className="mb-4 flex flex-wrap items-center gap-4">
            <div className="shrink-0 text-center">
              <p className={`text-5xl font-bold ${scoreColor}`}>
                {result.score === null ? "—" : result.score}
              </p>
              <p className="text-xs text-zinc-400">{t.auditor.scoreLabel}</p>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-zinc-100">{t.auditor.healthTitle}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="flex items-center gap-1.5 text-zinc-300">
                  <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-red-400" />
                  {errCount} {t.auditor.errorsWord}
                </span>
                <span className="flex items-center gap-1.5 text-zinc-300">
                  <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-amber-400" />
                  {warnCount} {t.auditor.warningsWord}
                </span>
                <span className="flex items-center gap-1.5 text-zinc-300">
                  <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-zinc-400" />
                  {noteCount} {t.auditor.noticesWord}
                </span>
              </p>
              <p className="mt-1 truncate text-sm font-semibold text-zinc-100">{result.url}</p>
              <p className="truncate text-xs text-zinc-400">{t.auditor.finalLabel}{result.final_url}</p>
              <p className="mt-1 text-xs text-zinc-400">
                {t.auditor.notScore}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                {t.auditor.sourceNote}
              </p>
              {result.note && <p className="mt-1 text-xs text-amber-300">{result.note}</p>}
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              [t.auditor.metricStatus, String(result.status)],
              [t.auditor.metricRedirects, String(result.redirect_count)],
              [t.auditor.metricTtfb, `${result.ttfb_ms} ms`],
              [t.auditor.metricTotal, `${result.total_ms} ms`],
              [t.auditor.metricSize, `${result.size_kb} KB`],
              [t.auditor.metricHttps, result.is_https ? t.auditor.yes : t.auditor.no],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
                <p className="text-xs text-zinc-400">{label}</p>
                <p className="text-sm font-semibold text-zinc-100">{value}</p>
              </div>
            ))}
          </div>

          {grouped.length > 0 && (
            <div className="space-y-4">
              {grouped.map((g) => {
                const gFailed = g.checks.filter((c) => !c.passed).length;
                return (
                  <section key={g.cat} aria-label={catName[g.cat] ?? g.cat}>
                    <h3 className="mb-1 flex flex-wrap items-baseline gap-2 text-sm font-bold text-zinc-100">
                      {catName[g.cat] ?? g.cat}
                      <span className="text-xs font-normal text-zinc-400">
                        {gFailed > 0 ? `${gFailed} ${t.auditor.toReview}` : `✓ ${g.checks.length}/${g.checks.length}`}
                      </span>
                    </h3>
                    <ul className="divide-y divide-zinc-800/70">
                      {g.checks.map((c) => {
                        const sev = sevOf(c);
                        return (
                          <li key={c.id} className="flex flex-wrap items-baseline gap-2 py-2">
                            <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 self-center rounded-full ${sevDot[sev] ?? sevDot.aviso}`} />
                            <span aria-hidden="true" className={c.passed ? "text-emerald-400" : "text-red-400"}>
                              {c.passed ? "✓" : "✗"}
                            </span>
                            <span className="text-sm font-semibold text-zinc-100">{newLabels[c.id] ?? c.label}</span>
                            <span className="text-sm text-zinc-300">{c.value}</span>
                            <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${sevBadge[sev] ?? sevBadge.aviso}`}>
                              {sevName[sev] ?? sev}
                            </span>
                            <span className="w-full text-xs text-zinc-400 sm:ml-auto sm:w-auto">{t.auditor.ideal}{c.ideal}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}

          {/* Informe gráfico: barras por categoría y por severidad,
              calculadas del resultado actual. */}
          <section aria-label={t.auditor.reportTitle} className="mt-6 border-t border-zinc-800 pt-4">
            <h3 className="mb-3 text-sm font-bold text-zinc-100">{t.auditor.reportTitle}</h3>
            <h4 className="mb-1 text-xs font-semibold text-zinc-300">{t.auditor.reportCatTitle}</h4>
            <HBarChart
              ariaLabel={`${t.auditor.reportCatTitle}: ${catScores.map((s) => `${catName[s.cat] ?? s.cat} ${s.pct}%`).join(", ")}`}
              rows={catScores.map((s) => ({
                label: catName[s.cat] ?? s.cat,
                value: s.pct,
                max: 100,
                display: `${s.passed}/${s.total} · ${s.pct}%`,
                color: CAT_COLORS[s.cat] ?? "#34d399",
              }))}
            />
            <h4 className="mb-1 mt-4 text-xs font-semibold text-zinc-300">{t.auditor.reportSevTitle}</h4>
            <HBarChart
              ariaLabel={`${t.auditor.reportSevTitle}: ${errCount} ${t.auditor.errorsWord}, ${warnCount} ${t.auditor.warningsWord}, ${noteCount} ${t.auditor.noticesWord}`}
              rows={[
                { label: t.auditor.errorsWord, value: errCount, max: sevMax, display: String(errCount), color: "#f87171" },
                { label: t.auditor.warningsWord, value: warnCount, max: sevMax, display: String(warnCount), color: "#fbbf24" },
                { label: t.auditor.noticesWord, value: noteCount, max: sevMax, display: String(noteCount), color: "#a1a1aa" },
              ]}
            />
          </section>
        </Panel>
      )}

      <Panel title={t.auditor.historyTitle}>
        {historyPoints.length >= 2 ? (
          <ScoreLineChart points={historyPoints} locale={locale} />
        ) : (
          <p className="text-sm text-zinc-400">
            {historyPoints.length === 0 ? t.auditor.historyEmpty : t.auditor.historyFew}
          </p>
        )}
      </Panel>

      <Panel title={t.auditor.socialTitle}>
        <p className="mb-3 text-xs leading-relaxed text-zinc-400">{t.auditor.socialIntro}</p>
        {socialByNetwork.length === 0 ? (
          <p className="text-sm text-zinc-400">{t.auditor.socialEmpty}</p>
        ) : (
          <HBarChart
            ariaLabel={`${t.auditor.socialTitle}: ${socialByNetwork.map((g) => `${g.network} ${g.avg}/100 (${g.count})`).join(", ")}`}
            rows={socialByNetwork.map((g) => ({
              label: g.network,
              value: g.avg,
              max: 100,
              display: `${g.avg}/100 · ${g.count} ${t.auditor.socialAnalyses}`,
              color: "#38bdf8",
            }))}
          />
        )}
      </Panel>

      <Panel title={t.auditor.recentTitle}>
        {recent.length === 0 ? (
          <p className="text-sm text-zinc-400">{t.auditor.emptyRecent}</p>
        ) : (
          <ul className="space-y-1.5">
            {recent.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setResult(a)}
                  className="flex w-full flex-wrap items-baseline gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-left hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">{a.url}</span>
                  <span className="text-sm font-semibold text-zinc-100">
                    {a.score === null ? t.auditor.noScore : `${a.score}/100`}
                  </span>
                  <span className="text-xs text-zinc-400">
                    {a.created_at ? new Date(a.created_at).toLocaleDateString(locale, { day: "numeric", month: "short" }) : ""}
                    {a.owner_username ? ` · ${a.owner_username}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
