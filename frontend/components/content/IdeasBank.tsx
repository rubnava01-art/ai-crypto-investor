// Banco de ideas (NEST, 2026-11-17): ideas de contenido con origen y
// estado. Vacío al inicio; sin ideas de ejemplo inventadas.
"use client";

import { useState } from "react";
import {
  api, ApiError,
  type ContentIdea, type ContentIdeaSource, type ContentIdeaStatus,
} from "../../lib/api";
import { Panel } from "../Panel";
import { ApiErrorBanner, Field, useConfirm } from "../ui";
import { useLanguage } from "../../lib/i18n";
import { useAsyncLoad } from "../../lib/useLoad";
import { formatDate } from "../../lib/format";

const inputCls =
  "w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 transition-colors focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

const SOURCES: ContentIdeaSource[] = ["manual", "tendencia", "cliente"];
const STATUSES: ContentIdeaStatus[] = ["idea", "en_produccion", "descartada"];

function statusCls(status: ContentIdeaStatus): string {
  switch (status) {
    case "en_produccion": return "bg-emerald-500/15 text-emerald-300";
    case "descartada": return "bg-zinc-500/15 text-zinc-400";
    default: return "bg-sky-500/15 text-sky-300";
  }
}

export function IdeasBank({ isAdmin }: { isAdmin: boolean }) {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const { confirm, dialog } = useConfirm(t);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ContentIdea | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [source, setSource] = useState<ContentIdeaSource>("manual");
  const [status, setStatus] = useState<ContentIdeaStatus>("idea");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useAsyncLoad<ContentIdea[]>(
    (signal) =>
      api.listIdeas(statusFilter ? { status: statusFilter as ContentIdeaStatus } : undefined, { signal }),
    [statusFilter],
  );
  const ideas = load.data ?? [];

  const sourceLabel = (s: ContentIdeaSource) =>
    s === "manual" ? t.contenido.sourceManual
    : s === "tendencia" ? t.contenido.sourceTrend
    : t.contenido.sourceClient;

  const statusLabel = (s: ContentIdeaStatus) =>
    s === "idea" ? t.contenido.statusIdea
    : s === "en_produccion" ? t.contenido.statusProducing
    : t.contenido.statusDiscarded;

  const openForm = (idea?: ContentIdea) => {
    setMsg(null);
    setFormError(null);
    setEditing(idea ?? null);
    setTitle(idea?.title ?? "");
    setNotes(idea?.notes ?? "");
    setSource(idea?.source ?? "manual");
    setStatus(idea?.status ?? "idea");
    setShowForm(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!title.trim()) {
      setFormError(t.contenido.errSaveIdea);
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        await api.updateIdea(editing.id, { title: title.trim(), notes: notes.trim(), source, status });
        setMsg(t.contenido.msgIdeaUpdated);
      } else {
        await api.createIdea({ title: title.trim(), notes: notes.trim(), source, status });
        setMsg(t.contenido.msgIdeaCreated);
      }
      setShowForm(false);
      setEditing(null);
      load.reload();
    } catch (err) {
      setFormError(t.contenido.errSaveIdea);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (idea: ContentIdea) => {
    if (!(await confirm(t.contenido.confirmDeleteIdea.replace("{titulo}", idea.title)))) return;
    setActionError(null);
    setMsg(null);
    try {
      await api.deleteIdea(idea.id);
      setMsg(t.contenido.msgIdeaDeleted);
      load.reload();
    } catch (err) {
      setActionError(t.contenido.errDeleteIdea);
    }
  };

  return (
    <>
      {dialog}
      <Panel title={t.contenido.ideasTitle} badge={<span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">{ideas.length}</span>}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Field label={t.contenido.ideaStatusAria} className="min-w-[180px] flex-1">
            <select aria-label={t.contenido.ideaStatusAria} className={inputCls} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">{t.citas.allStatuses}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{statusLabel(s)}</option>
              ))}
            </select>
          </Field>
          {isAdmin && (
            <button
              type="button"
              onClick={() => openForm()}
              className="min-h-[44px] rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              {t.contenido.newIdea}
            </button>
          )}
        </div>

        {load.loading ? (
          <p role="status" className="py-4 text-center text-sm text-zinc-400">{t.contenido.loadingIdeas}</p>
        ) : load.error ? (
          <ApiErrorBanner error={load.error} t={t} onRetry={load.reload} />
        ) : ideas.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-700 px-4 py-6 text-center">
            <p className="text-sm text-zinc-400">{t.contenido.emptyIdeas}</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {ideas.map((idea) => (
              <li key={idea.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">{idea.title}</p>
                    <p className="mt-1 text-xs text-zinc-400">
                      {sourceLabel(idea.source)}
                      {idea.contact_name ? ` · ${idea.contact_name}` : ""}
                      {idea.created_at ? ` · ${formatDate(idea.created_at, locale) ?? ""}` : ""}
                    </p>
                    {idea.notes && <p className="mt-1 text-sm text-zinc-300">{idea.notes}</p>}
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${statusCls(idea.status)}`}>{statusLabel(idea.status)}</span>
                </div>
                {isAdmin && (
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => openForm(idea)} className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200">{t.contenido.editIdea}</button>
                    <button type="button" onClick={() => remove(idea)} className="min-h-[44px] rounded-lg border border-red-900/60 px-3 py-2 text-xs text-red-400">{t.contenido.delete}</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {msg && <p className="mt-3 text-sm text-emerald-400">{msg}</p>}
        {actionError && <p role="alert" className="mt-3 text-sm text-red-400">{actionError}</p>}

        {showForm && isAdmin && (
          <form onSubmit={submit} className="mt-4 space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <p className="text-sm font-semibold text-zinc-200">{editing ? t.contenido.editIdea : t.contenido.newIdea}</p>
            <Field label={t.contenido.ideaTitleAria}>
              <input aria-label={t.contenido.ideaTitleAria} className={inputCls} placeholder={t.contenido.ideaTitlePlaceholder} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoComplete="off" />
            </Field>
            <Field label={t.contenido.ideaNotesAria}>
              <textarea aria-label={t.contenido.ideaNotesAria} className={inputCls} rows={2} placeholder={t.contenido.ideaNotesPlaceholder} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t.contenido.ideaSourceAria}>
                <select aria-label={t.contenido.ideaSourceAria} className={inputCls} value={source} onChange={(e) => setSource(e.target.value as ContentIdeaSource)}>
                  {SOURCES.map((s) => (
                    <option key={s} value={s}>{sourceLabel(s)}</option>
                  ))}
                </select>
              </Field>
              <Field label={t.contenido.ideaStatusAria}>
                <select aria-label={t.contenido.ideaStatusAria} className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as ContentIdeaStatus)}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{statusLabel(s)}</option>
                  ))}
                </select>
              </Field>
            </div>
            {formError && <p role="alert" className="text-sm text-red-400">{formError}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="min-h-[44px] flex-1 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:opacity-50">
                {busy ? t.contenido.saving : t.contenido.saveIdea}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="min-h-[44px] rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">
                {t.contenido.cancel}
              </button>
            </div>
          </form>
        )}
      </Panel>
    </>
  );
}
