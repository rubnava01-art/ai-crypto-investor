// Generador de copies (extraído de CrearPanel.tsx, 2026-11-17, sin cambio
// de comportamiento; CrearPanel lo re-importa y el Content Engine lo
// reutiliza). Badge demo de aiStatus + chip `demo` por borrador.
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api, ApiError,
  type AIStatusResponse, type CopyDraft, type CopyPlatform, type CopyTone,
} from "../../lib/api";
import { Panel } from "../Panel";
import { useConfirm, Field, copyTextWithFallback } from "../ui";
import { useLanguage } from "../../lib/i18n";
import { useCancelled } from "../../lib/useLoad";
import { PLATFORMS, fmtDate, inputCls, platformLabel } from "./shared";

export function CopyGenerator({ isAdmin }: { isAdmin: boolean }) {
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
            className="w-full rounded-lg bg-emerald-700 min-h-[44px] px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50"
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
