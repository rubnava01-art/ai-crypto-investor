"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type WebAudit } from "../lib/api";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";
import { useCancelled } from "../lib/useLoad";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-2 focus-visible:ring-emerald-500/40";

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
        </Panel>
      )}

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
