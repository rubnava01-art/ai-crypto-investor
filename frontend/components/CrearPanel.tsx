"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api, ApiError,
  type AIStatusResponse, type CopyDraft, type CopyPlatform, type CopyTone, type MeResponse, type TrendNote,
} from "../lib/api";
import { Panel } from "./Panel";
import { useConfirm, Field, copyTextWithFallback } from "./ui";
import { useLanguage } from "../lib/i18n";
import { useCancelled } from "../lib/useLoad";
import { LogoGenerator } from "./LogoGenerator";
import { ShirtMockupGenerator } from "./ShirtMockupGenerator";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-2 focus-visible:ring-emerald-500/40";

const PLATFORMS: { value: CopyPlatform; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "threads", label: "Threads" },
  { value: "facebook", label: "Facebook" },
];

const platformLabel = (p: string) => PLATFORMS.find((x) => x.value === p)?.label ?? p;

const fmtDate = (iso: string | null, locale: string) =>
  iso ? new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) : null;

function CopyGenerator({ isAdmin }: { isAdmin: boolean }) {
  const isCancelled = useCancelled();
  const { t, lang } = useLanguage();
  const { confirm, dialog } = useConfirm(t);
  const locale = lang === "en" ? "en-US" : "es-MX";
  const tones: { value: CopyTone; label: string }[] = [
    { value: "directo", label: t.crear.toneDirecto },
    { value: "educativo", label: t.crear.toneEducativo },
    { value: "divertido", label: t.crear.toneDivertido },
    { value: "profesional", label: t.crear.toneProfesional },
  ];
  const toneLabel = (v: string) => tones.find((x) => x.value === v)?.label ?? v;
  const [aiStatus, setAiStatus] = useState<AIStatusResponse | null>(null);
  const [drafts, setDrafts] = useState<CopyDraft[] | null>(null);
  const [topic, setTopic] = useState("");
  const [platform, setPlatform] = useState<CopyPlatform>("instagram");
  const [tone, setTone] = useState<CopyTone>("directo");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const _load1 = await api.listCopies();
      if (isCancelled()) return;
      setDrafts(_load1);
    } catch {
      setDrafts([]);
    }
  }, []);

  useEffect(() => {
    api.aiStatus().then((v) => { if (!isCancelled()) setAiStatus(v); }).catch(() => { if (!isCancelled()) setAiStatus(null); });
    load();
  }, [load]);

  const isDemo = aiStatus ? aiStatus.demo : true;

  const generate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const draft = await api.generateCopy({ topic: topic.trim(), platform, tone });
      setMsg(draft.demo ? t.crear.msgDemo : t.crear.msgOk);
      setTopic("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.crear.errGenerate);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (d: CopyDraft) => {
    if (!(await confirm(t.crear.confirmDeleteCopy))) return;
    setError(null);
    setMsg(null);
    try {
      await api.deleteCopy(d.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.crear.errDeleteCopy);
    }
  };

  const [copiedId, setCopiedId] = useState<number | null>(null);
  const copyDraft = async (d: CopyDraft) => {
    if (await copyTextWithFallback(d.text)) {
      setCopiedId(d.id);
      setTimeout(() => setCopiedId((v) => (v === d.id ? null : v)), 2000);
    }
  };

  return (
    <>
      {dialog}
    <Panel
      title={t.crear.copyTitle}
      badge={
        isDemo ? (
          <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-300">
            {t.crear.badgeDemo}
          </span>
        ) : (
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
            {t.crear.badgeAi}
          </span>
        )
      }
    >
      {isDemo && (
        <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm leading-relaxed text-amber-200">
          {t.crear.demoPrefix}<strong>{t.crear.demoWord}</strong>{t.crear.demoSuffix}
        </p>
      )}
      <p className="mb-3 text-xs leading-relaxed text-zinc-400">
        {t.crear.copyIntro}
        {!isAdmin && t.crear.readonlyCopy}
      </p>

      {isAdmin && (
        <form onSubmit={generate} className="space-y-3">
          <Field label={t.crear.topicAria}><input aria-label={t.crear.topicAria}
            className={inputCls}
            placeholder={t.crear.topicPlaceholder}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            required
            maxLength={200}
            autoComplete="off"
          /></Field>
          <p className="text-right text-xs text-zinc-400">{topic.length}/200</p>
          <div>
            <span className="mb-1 block text-xs font-medium text-zinc-400">{t.crear.platformAria}</span>
            <div className="flex gap-2" role="group" aria-label={t.crear.platformAria}>
              {PLATFORMS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  aria-pressed={platform === p.value}
                  onClick={() => setPlatform(p.value)}
                  className={`min-h-[44px] flex-1 rounded-lg px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 ${platform === p.value ? "bg-emerald-700 text-white" : "border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-zinc-400">{t.crear.toneAria}</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label={t.crear.toneAria}>
              {tones.map((tn) => (
                <button
                  key={tn.value}
                  type="button"
                  aria-pressed={tone === tn.value}
                  onClick={() => setTone(tn.value)}
                  className={`min-h-[44px] rounded-lg px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 ${tone === tn.value ? "bg-emerald-700 text-white" : "border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"}`}
                >
                  {tn.label}
                </button>
              ))}
            </div>
          </div>
          <button
            type="submit"
            disabled={busy || !topic.trim()}
            className="w-full rounded-lg bg-emerald-700 min-h-[44px] px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50"
          >
            {busy ? t.crear.generateBusy : t.crear.generate}
          </button>
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </form>
      )}

      <div className="mt-4 border-t border-zinc-800 pt-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          {t.crear.saved} ({drafts === null ? "…" : drafts.length})
        </p>
        {drafts === null ? (
          <div role="status" aria-label={t.crear.loadingCopies} className="space-y-3 py-2">
            {[0, 1].map((i) => (
              <div key={i} aria-hidden="true" className="space-y-2">
                <div className="h-4 w-2/5 animate-pulse rounded bg-zinc-800" />
                <div className="h-3 w-full animate-pulse rounded bg-zinc-800" />
                <div className="h-3 w-3/4 animate-pulse rounded bg-zinc-800" />
              </div>
            ))}
          </div>
        ) : drafts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-700 px-4 py-6 text-center">
            <p className="text-sm text-zinc-400">{t.crear.emptyCopies}</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {drafts.map((d) => (
              <li key={d.id} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded bg-zinc-800 px-1.5 py-1 text-xs text-zinc-300">{platformLabel(d.platform)}</span>
                  <span className="rounded bg-zinc-800 px-1.5 py-1 text-xs text-zinc-300">{toneLabel(d.tone)}</span>
                  {d.demo && (
                    <span className="rounded bg-amber-500/15 px-1.5 py-1 text-xs font-semibold text-amber-300">{t.crear.demoChip}</span>
                  )}
                </div>
                <p className="mt-2 text-xs font-semibold text-zinc-300">{d.topic}</p>
                <p className="mt-2 whitespace-pre-wrap rounded-lg border border-zinc-800/80 bg-zinc-900/60 px-3 py-2.5 text-sm leading-relaxed text-zinc-200">{d.text}</p>
                <div className="mt-2 flex items-center justify-end gap-2">
                  <span className="mr-auto text-xs text-zinc-400">{fmtDate(d.created_at, locale)}</span>
                  <button
                    type="button"
                    onClick={() => copyDraft(d)}
                    className="min-h-[44px] rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                  >
                    {copiedId === d.id ? t.crear.copied : t.crear.copy}
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() => remove(d)}
                      className="min-h-[44px] rounded-lg border border-red-900/60 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-950/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                    >
                      {t.crear.deleteBtn}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
    </>
  );
}

function TrendsPanel({ isAdmin }: { isAdmin: boolean }) {
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
      setError(err instanceof ApiError ? err.message : t.crear.errSaveTrend);
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
      setError(err instanceof ApiError ? err.message : t.crear.errDeleteTrend);
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
            className="w-full rounded-lg bg-emerald-700 min-h-[44px] px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50"
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

export function CrearPanel() {
  const isCancelled = useCancelled();
  const [me, setMe] = useState<MeResponse | null>(null);
  const isAdmin = !!me?.is_admin;
  const { t } = useLanguage();
  const flowSteps = [
    { n: "1", label: t.crear.trendsTitle },
    { n: "2", label: t.crear.copyTitle },
    { n: "3", label: t.nav.crm.label },
  ];

  useEffect(() => {
    api.me().then((v) => { if (!isCancelled()) setMe(v); }).catch(() => { if (!isCancelled()) setMe(null); });
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          {t.crear.flowLabel}
        </p>
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {flowSteps.map((s) => (
            <li key={s.n} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3.5 py-3">
              <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-xs font-bold text-white">{s.n}</span>
              <span className="text-sm font-semibold text-zinc-100">{s.label}</span>
            </li>
          ))}
        </ol>
      </div>
      <CopyGenerator isAdmin={isAdmin} />
      <LogoGenerator />
      <ShirtMockupGenerator />
      <TrendsPanel isAdmin={isAdmin} />
    </div>
  );
}
