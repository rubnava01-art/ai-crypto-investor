// Panel de tendencias (extraído de CrearPanel.tsx, 2026-11-17, sin cambio
// de comportamiento; CrearPanel lo re-importa y el Content Engine lo
// reutiliza).
"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type TrendNote } from "../../lib/api";
import { Panel } from "../Panel";
import { useConfirm, Field } from "../ui";
import { useLanguage } from "../../lib/i18n";
import { useCancelled } from "../../lib/useLoad";
import { fmtDate, inputCls } from "./shared";

export function TrendsPanel({ isAdmin }: { isAdmin: boolean }) {
  const isCancelled = useCancelled();
  const { t, lang } = useLanguage();
  const { confirm, dialog } = useConfirm(t);
  const locale = lang === "en" ? "en-US" : "es-MX";
  const [trends, setTrends] = useState<TrendNote[] | null>(null);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const _load2 = await api.listTrends();
      if (isCancelled()) return;
      setTrends(_load2);
    } catch {
      setTrends([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createTrend({ title: title.trim(), source: source.trim(), summary });
      setTitle("");
      setSource("");
      setSummary("");
      await load();
    } catch (err) {
      setError(t.crear.errSaveTrend);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (tr: TrendNote) => {
    if (!(await confirm(t.crear.confirmDeleteTrend.replace("{titulo}", tr.title)))) return;
    setError(null);
    try {
      await api.deleteTrend(tr.id);
      await load();
    } catch (err) {
      setError(t.crear.errDeleteTrend);
    }
  };

  return (
    <>
      {dialog}
    <Panel
      title={t.crear.trendsTitle}
      badge={
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
          {trends === null ? t.crear.trendsLoading : `${trends.length} ${t.crear.notesWord}`}
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-zinc-400">
        {t.crear.trendsIntro}
        {!isAdmin && t.crear.readonlyTrends}
      </p>

      {trends === null ? (
        <div role="status" aria-label={t.crear.loadingTrends} className="space-y-3 py-2">
          {[0, 1].map((i) => (
            <div key={i} aria-hidden="true" className="space-y-2">
              <div className="h-4 w-2/5 animate-pulse rounded bg-zinc-800" />
              <div className="h-3 w-full animate-pulse rounded bg-zinc-800" />
              <div className="h-3 w-3/4 animate-pulse rounded bg-zinc-800" />
            </div>
          ))}
        </div>
      ) : trends.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-700 px-4 py-6 text-center">
          <p className="text-sm text-zinc-400">
            {t.crear.emptyTrends}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {trends.map((tr) => (
            <li key={tr.id} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-semibold text-zinc-100">{tr.title}</span>
                {tr.published_on && <span className="text-xs text-zinc-400">{fmtDate(tr.published_on, locale)}</span>}
                {isAdmin && (
                  <button
                    onClick={() => remove(tr)}
                    className="min-h-[44px] ml-auto rounded-lg border border-red-900/60 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-950/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                  >
                    {t.crear.deleteBtn}
                  </button>
                )}
              </div>
              {tr.source && <p className="mt-1.5"><span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">{t.crear.sourceLabel}{tr.source}</span></p>}
              {tr.summary && <p className="mt-2 rounded-lg border border-zinc-800/80 bg-zinc-900/60 px-3 py-2 text-sm leading-relaxed text-zinc-300">{tr.summary}</p>}
            </li>
          ))}
        </ul>
      )}

      {isAdmin && (
        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <form onSubmit={add} className="space-y-3">
          <p className="text-sm font-semibold text-zinc-200">{t.crear.newTrend}</p>
          <Field label={t.crear.trendTitleAria}><input aria-label={t.crear.trendTitleAria} className={inputCls} placeholder={t.crear.trendTitlePlaceholder} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoComplete="off" /></Field>
          <Field label={t.crear.sourceAria}><input aria-label={t.crear.sourceAria} className={inputCls} placeholder={t.crear.sourcePlaceholder} value={source} onChange={(e) => setSource(e.target.value)} maxLength={120} autoComplete="off" /></Field>
          <Field label={t.crear.summaryAria}><textarea aria-label={t.crear.summaryAria} className={inputCls} placeholder={t.crear.summaryPlaceholder} value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} /></Field>
          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="w-full rounded-lg bg-emerald-700 min-h-[44px] px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50"
          >
            {busy ? t.crear.addBusy : t.crear.addTrend}
          </button>
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </form>
        </div>
      )}
      {!isAdmin && error && <p role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
    </Panel>
    </>
  );
}
