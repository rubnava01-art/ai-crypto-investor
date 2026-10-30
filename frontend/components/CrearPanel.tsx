"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api, ApiError,
  type AIStatusResponse, type CopyDraft, type CopyPlatform, type CopyTone, type MeResponse, type TrendNote,
} from "../lib/api";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";
import { LogoGenerator } from "./LogoGenerator";
import { ShirtMockupGenerator } from "./ShirtMockupGenerator";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";

const PLATFORMS: { value: CopyPlatform; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "threads", label: "Threads" },
  { value: "facebook", label: "Facebook" },
];

const platformLabel = (p: string) => PLATFORMS.find((x) => x.value === p)?.label ?? p;

const fmtDate = (iso: string | null, locale: string) =>
  iso ? new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) : null;

function CopyGenerator({ isAdmin }: { isAdmin: boolean }) {
  const { t, lang } = useLanguage();
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
      setDrafts(await api.listCopies());
    } catch {
      setDrafts([]);
    }
  }, []);

  useEffect(() => {
    api.aiStatus().then(setAiStatus).catch(() => setAiStatus(null));
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
    if (!window.confirm(t.crear.confirmDeleteCopy)) return;
    setError(null);
    setMsg(null);
    try {
      await api.deleteCopy(d.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.crear.errDeleteCopy);
    }
  };

  return (
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
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">
        {t.crear.copyIntro}
        {!isAdmin && t.crear.readonlyCopy}
      </p>

      {isAdmin && (
        <form onSubmit={generate} className="space-y-2">
          <input aria-label={t.crear.topicAria}
            className={inputCls}
            placeholder={t.crear.topicPlaceholder}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            required
            maxLength={200}
            autoComplete="off"
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <select className={inputCls} value={platform} onChange={(e) => setPlatform(e.target.value as CopyPlatform)} aria-label={t.crear.platformAria}>
              {PLATFORMS.map((p) => (
                <option key={p.value} value={p.value}>{t.crear.platformPrefix}{p.label}</option>
              ))}
            </select>
            <select className={inputCls} value={tone} onChange={(e) => setTone(e.target.value as CopyTone)} aria-label={t.crear.toneAria}>
              {tones.map((tn) => (
                <option key={tn.value} value={tn.value}>{t.crear.tonePrefix}{tn.label}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={busy || !topic.trim()}
            className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? t.crear.generateBusy : t.crear.generate}
          </button>
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </form>
      )}

      <div className="mt-4 border-t border-zinc-800 pt-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          {t.crear.saved} ({drafts === null ? "…" : drafts.length})
        </p>
        {drafts === null ? (
          <p className="py-2 text-sm text-zinc-500">{t.crear.loadingCopies}</p>
        ) : drafts.length === 0 ? (
          <p className="py-2 text-sm text-zinc-500">{t.crear.emptyCopies}</p>
        ) : (
          <ul className="divide-y divide-zinc-800/70">
            {drafts.map((d) => (
              <li key={d.id} className="py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300">{platformLabel(d.platform)}</span>
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300">{toneLabel(d.tone)}</span>
                  {d.demo && (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300">{t.crear.demoChip}</span>
                  )}
                  <span className="text-xs text-zinc-500">{d.topic}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <span className="text-xs text-zinc-600">{fmtDate(d.created_at, locale)}</span>
                    {isAdmin && (
                      <button
                        onClick={() => remove(d)}
                        className="rounded-lg border border-red-900/60 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/50"
                      >
                        {t.crear.deleteBtn}
                      </button>
                    )}
                  </span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{d.text}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function TrendsPanel({ isAdmin }: { isAdmin: boolean }) {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const [trends, setTrends] = useState<TrendNote[] | null>(null);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTrends(await api.listTrends());
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
    if (!window.confirm(t.crear.confirmDeleteTrend.replace("{titulo}", tr.title))) return;
    setError(null);
    try {
      await api.deleteTrend(tr.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.crear.errDeleteTrend);
    }
  };

  return (
    <Panel
      title={t.crear.trendsTitle}
      badge={
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
          {trends === null ? t.crear.trendsLoading : `${trends.length} ${t.crear.notesWord}`}
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">
        {t.crear.trendsIntro}
        {!isAdmin && t.crear.readonlyTrends}
      </p>

      {trends === null ? (
        <p className="py-2 text-sm text-zinc-500">{t.crear.loadingTrends}</p>
      ) : trends.length === 0 ? (
        <p className="py-2 text-sm text-zinc-500">
          {t.crear.emptyTrends}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-800/70">
          {trends.map((tr) => (
            <li key={tr.id} className="py-2.5">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-semibold text-zinc-100">{tr.title}</span>
                {tr.published_on && <span className="text-xs text-zinc-500">{fmtDate(tr.published_on, locale)}</span>}
                {isAdmin && (
                  <button
                    onClick={() => remove(tr)}
                    className="ml-auto rounded-lg border border-red-900/60 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/50"
                  >
                    {t.crear.deleteBtn}
                  </button>
                )}
              </div>
              {tr.source && <p className="mt-0.5 text-xs text-zinc-500">{t.crear.sourceLabel}{tr.source}</p>}
              {tr.summary && <p className="mt-0.5 text-sm text-zinc-400">{tr.summary}</p>}
            </li>
          ))}
        </ul>
      )}

      {isAdmin && (
        <form onSubmit={add} className="mt-4 space-y-2 border-t border-zinc-800 pt-4">
          <p className="text-sm font-semibold text-zinc-200">{t.crear.newTrend}</p>
          <input aria-label={t.crear.trendTitleAria} className={inputCls} placeholder={t.crear.trendTitlePlaceholder} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoComplete="off" />
          <input aria-label={t.crear.sourceAria} className={inputCls} placeholder={t.crear.sourcePlaceholder} value={source} onChange={(e) => setSource(e.target.value)} maxLength={120} autoComplete="off" />
          <textarea aria-label={t.crear.summaryAria} className={inputCls} placeholder={t.crear.summaryPlaceholder} value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} />
          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? t.crear.addBusy : t.crear.addTrend}
          </button>
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </form>
      )}
      {!isAdmin && error && <p role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
    </Panel>
  );
}

export function CrearPanel() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const isAdmin = !!me?.is_admin;

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null));
  }, []);

  return (
    <div className="space-y-4">
      <CopyGenerator isAdmin={isAdmin} />
      <LogoGenerator />
      <ShirtMockupGenerator />
      <TrendsPanel isAdmin={isAdmin} />
    </div>
  );
}
