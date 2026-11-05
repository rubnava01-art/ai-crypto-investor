"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api, ApiError,
  type EduClass, type EduClassKind, type MeResponse,
} from "../lib/api";
import { Panel } from "./Panel";
import { useConfirm, Field } from "./ui";
import { useLanguage } from "../lib/i18n";
import { useCancelled } from "../lib/useLoad";

const inputCls =
  "w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40";

const fmtDateTime = (iso: string | null, locale: string) =>
  iso
    ? new Date(iso).toLocaleDateString(locale, {
        day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : null;

function ClassSection({ kind, isAdmin }: { kind: EduClassKind; isAdmin: boolean }) {
  const isCancelled = useCancelled();
  const { t, lang } = useLanguage();
  const { confirm, dialog } = useConfirm(t);
  const locale = lang === "en" ? "en-US" : "es-MX";
  const [rows, setRows] = useState<EduClass[] | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [scheduled, setScheduled] = useState("");
  const [duration, setDuration] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isLive = kind === "envivo";

  const load = useCallback(async () => {
    try {
      const _load1 = await api.listClasses(kind);
      if (isCancelled()) return;
      setRows(_load1);
    } catch {
      setRows([]);
    }
  }, [kind]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      let scheduledAt: string | null = null;
      if (isLive && scheduled) {
        const d = new Date(scheduled);
        if (Number.isNaN(d.getTime())) throw new Error(t.clases.invalidDate);
        scheduledAt = d.toISOString();
      }
      await api.createClass({
        kind,
        title: title.trim(),
        description,
        url: url.trim(),
        scheduled_at: scheduledAt,
        duration_min: duration ? Number(duration) : null,
      });
      setMsg(isLive ? t.clases.msgLive : t.clases.msgRecorded);
      setTitle("");
      setDescription("");
      setUrl("");
      setScheduled("");
      setDuration("");
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : t.clases.errSave
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: EduClass) => {
    if (!(await confirm(t.clases.confirmDelete.replace("{titulo}", c.title)))) return;
    setError(null);
    try {
      await api.deleteClass(c.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.clases.errDelete);
    }
  };

  return (
    <>
      {dialog}
    <Panel
      title={isLive ? t.clases.liveTitle : t.clases.recordedTitle}
      badge={
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${isLive ? "bg-red-500/15 text-red-300" : "bg-indigo-500/15 text-indigo-300"}`}>
          {rows === null ? t.clases.badgeLoading : `${rows.length} ${rows.length === 1 ? t.clases.classOne : t.clases.classMany}`}
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-zinc-400">
        {isLive ? t.clases.liveIntro : t.clases.recordedIntro}
        {!isAdmin && t.clases.readonly}
      </p>

      {isAdmin && (
        <form onSubmit={add} className="space-y-3">
          <Field label={t.clases.titleAria}><input aria-label={t.clases.titleAria} className={inputCls} placeholder={t.clases.titlePlaceholder} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoComplete="off" /></Field>
          <Field label={t.clases.descAria}><textarea aria-label={t.clases.descAria} className={inputCls} placeholder={t.clases.descPlaceholder} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></Field>
          <Field label={t.clases.urlAria}><input aria-label={t.clases.urlAria} className={inputCls} placeholder={isLive ? t.clases.urlPlaceholderLive : t.clases.urlPlaceholderRecorded} value={url} onChange={(e) => setUrl(e.target.value)} maxLength={500} autoComplete="off" /></Field>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {isLive && (
              <label className="text-xs text-zinc-400">{t.clases.dateLabel}
                <input className={`${inputCls} mt-1`} type="datetime-local" value={scheduled} onChange={(e) => setScheduled(e.target.value)} />
              </label>
            )}
            <label className="text-xs text-zinc-400">{t.clases.durationLabel}
              <input className={`${inputCls} mt-1`} type="number" min="1" step="1" value={duration} onChange={(e) => setDuration(e.target.value)} />
            </label>
          </div>
          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="w-full rounded-lg bg-indigo-600 min-h-[44px] px-3 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 active:bg-indigo-500 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50"
          >
            {busy ? t.clases.saveBusy : isLive ? t.clases.saveLive : t.clases.saveRecorded}
          </button>
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </form>
      )}

      <div className="mt-4 border-t border-zinc-800 pt-3">
        {rows === null ? (
          <p className="py-2 text-sm text-zinc-400">{t.clases.loadingClasses}</p>
        ) : rows.length === 0 ? (
          <p className="py-2 text-sm text-zinc-400">
            {isLive
              ? t.clases.emptyLive
              : t.clases.emptyRecorded}
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800/70">
            {rows.map((c) => (
              <li key={c.id} className="py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-semibold text-zinc-100">{c.title}</span>
                  {c.scheduled_at && <span className="text-xs text-zinc-400">{fmtDateTime(c.scheduled_at, locale)}</span>}
                  {c.duration_min && <span className="text-xs text-zinc-400">{c.duration_min} min</span>}
                  <span className="ml-auto flex items-center gap-2">
                    {c.url && (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex min-h-[44px] items-center rounded-lg px-3 py-2 text-xs font-semibold text-white motion-safe:active:scale-[0.98] ${isLive ? "bg-red-600 hover:bg-red-500 active:bg-red-500" : "bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-500"}`}
                      >
                        {isLive ? t.clases.joinLive : t.clases.watchRecorded}
                      </a>
                    )}
                    {isAdmin && (
                      <button
                        onClick={() => remove(c)}
                        className="min-h-[44px] rounded-lg border border-red-900/60 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-950/50 active:bg-red-950/70 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                      >
                        {t.clases.deleteBtn}
                      </button>
                    )}
                  </span>
                </div>
                {c.description && <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{c.description}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
    </>
  );
}

export function ClasesPanel() {
  const isCancelled = useCancelled();
  const [me, setMe] = useState<MeResponse | null>(null);
  const isAdmin = !!me?.is_admin;

  useEffect(() => {
    api.me().then((v) => { if (!isCancelled()) setMe(v); }).catch(() => { if (!isCancelled()) setMe(null); });
  }, []);

  return (
    <div className="space-y-4">
      <ClassSection kind="grabada" isAdmin={isAdmin} />
      <ClassSection kind="envivo" isAdmin={isAdmin} />
    </div>
  );
}
