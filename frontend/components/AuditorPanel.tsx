"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type WebAudit } from "../lib/api";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";

/** Auditor web: revisa UNA página (velocidad medida + SEO básico).
 * El puntaje es transparente: % de la lista de verificación aprobado,
 * siempre mostrado CON la lista completa. NO es un puntaje Lighthouse
 * ni PageSpeed, no hay rastreo, sitemap ni Core Web Vitals. El servidor
 * rechaza URLs privadas/reservadas antes de descargar nada. */
export function AuditorPanel() {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<WebAudit | null>(null);
  const [recent, setRecent] = useState<WebAudit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRecent = useCallback(async () => {
    try {
      setRecent(await api.listWebAudits());
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

  return (
    <div className="space-y-4">
      <Panel title={t.auditor.panelTitle} badge={<span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">{t.auditor.badge}</span>}>
        <p className="mb-3 text-xs leading-relaxed text-zinc-500">
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
            className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? t.auditor.auditBusy : t.auditor.audit}
          </button>
        </form>
        {error && <p role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
      </Panel>

      {result && (
        <Panel title={t.auditor.resultTitle}>
          <div className="mb-4 flex flex-wrap items-center gap-4">
            <div className="text-center">
              <p className={`text-5xl font-bold ${scoreColor}`}>
                {result.score === null ? "—" : result.score}
              </p>
              <p className="text-xs text-zinc-500">{t.auditor.scoreLabel}</p>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-zinc-100">{result.url}</p>
              <p className="truncate text-xs text-zinc-500">{t.auditor.finalLabel}{result.final_url}</p>
              <p className="mt-1 text-xs text-zinc-500">
                {t.auditor.notScore}
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
                <p className="text-xs text-zinc-500">{label}</p>
                <p className="text-sm font-semibold text-zinc-100">{value}</p>
              </div>
            ))}
          </div>

          {result.checks.length > 0 && (
            <ul className="divide-y divide-zinc-800/70">
              {result.checks.map((c) => (
                <li key={c.id} className="flex flex-wrap items-baseline gap-2 py-2">
                  <span aria-hidden="true" className={c.passed ? "text-emerald-400" : "text-red-400"}>
                    {c.passed ? "✓" : "✗"}
                  </span>
                  <span className="text-sm font-semibold text-zinc-100">{c.label}</span>
                  <span className="text-sm text-zinc-300">{c.value}</span>
                  <span className="ml-auto text-xs text-zinc-500">{t.auditor.ideal}{c.ideal}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <Panel title={t.auditor.recentTitle}>
        {recent.length === 0 ? (
          <p className="text-sm text-zinc-500">{t.auditor.emptyRecent}</p>
        ) : (
          <ul className="space-y-1">
            {recent.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setResult(a)}
                  className="flex w-full flex-wrap items-baseline gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-left hover:bg-zinc-800"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">{a.url}</span>
                  <span className="text-sm font-semibold text-zinc-100">
                    {a.score === null ? t.auditor.noScore : `${a.score}/100`}
                  </span>
                  <span className="text-xs text-zinc-500">
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
