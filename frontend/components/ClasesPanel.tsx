"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api, ApiError,
  type EduClass, type EduClassKind, type MeResponse,
} from "../lib/api";
import { Panel } from "./Panel";
import { ClasesHerramientas } from "./ClasesHerramientas";
import { useConfirm, Field, ApiErrorBanner, apiErrorText } from "./ui";
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

/** Espejo frontend de la regla de URLs del backend (E3): solo http/https
 * con host (netloc). Sin esquema se normaliza a https://; cualquier otro
 * esquema se rechaza. */
function normalizeClassUrl(raw: string): { url: string } | { error: true } {
  const value = raw.trim();
  if (!value) return { url: "" };
  if (value.startsWith("//")) return { url: `https:${value}` };
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value);
  if (scheme) {
    const s = scheme[1].toLowerCase();
    if (s !== "http" && s !== "https") return { error: true };
    const rest = value.slice(scheme[0].length);
    if (!rest.startsWith("//")) {
      // V1 del QA de Clases (2026-11-12): "http:example.com" pasaba
      // este filtro y el backend lo rechazaba con 422 (sin netloc).
      // Sin autoridad se normaliza a https:// + el resto sin barras.
      const hostpart = rest.replace(/^\/+/, "");
      if (!hostpart) return { error: true };
      return { url: `https://${hostpart}` };
    }
    // "http://" sin host también lo rechaza el backend (sin netloc).
    if (!rest.slice(2).split("/")[0]) return { error: true };
    return { url: value };
  }
  return { url: `https://${value}` };
}

function ClassSection({ kind, isAdmin }: { kind: EduClassKind; isAdmin: boolean }) {
  const isCancelled = useCancelled();
  const { t, lang } = useLanguage();
  const { confirm, dialog } = useConfirm(t);
  const locale = lang === "en" ? "en-US" : "es-MX";
  const [rows, setRows] = useState<EduClass[] | null>(null);
  // E4: el error de carga es un estado propio: un fallo ya no se disfraza
  // de lista vacía (antes el catch hacía setRows([])).
  const [loadError, setLoadError] = useState<unknown>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [scheduled, setScheduled] = useState("");
  const [duration, setDuration] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // E6: formulario colapsable, cerrado por defecto; la lista va primero.
  const [showForm, setShowForm] = useState(false);
  // E8: borrar con estado por fila (doble clic ya no dispara dos borrados).
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const isLive = kind === "envivo";
  // E8: aviso de fecha pasada (no bloquea el guardado, solo avisa).
  const scheduledDate = isLive && scheduled ? new Date(scheduled) : null;
  const pastDate =
    scheduledDate !== null && !Number.isNaN(scheduledDate.getTime()) && scheduledDate.getTime() < Date.now();

  const load = useCallback(async () => {
    try {
      const _load1 = await api.listClasses(kind);
      if (isCancelled()) return;
      setRows(_load1);
      setLoadError(null);
    } catch (err) {
      if (isCancelled()) return;
      // Error separado: rows queda en null y la UI muestra el banner con
      // Reintentar en vez de un "todavía no hay clases" falso.
      setLoadError(err);
    }
  }, [kind, isCancelled]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      // E3 (frontend): normalizar / rechazar la URL antes de enviarla.
      const normalized = normalizeClassUrl(url);
      if ("error" in normalized) throw new Error(t.clases.urlInvalid);
      // E8: duración entero ≥ 1.
      let durationMin: number | null = null;
      if (duration.trim() !== "") {
        if (!/^\d+$/.test(duration.trim()) || Number(duration) < 1) {
          throw new Error(t.clases.durationInvalid);
        }
        durationMin = Number(duration);
      }
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
        url: normalized.url,
        scheduled_at: scheduledAt,
        duration_min: durationMin,
      });
      setMsg(isLive ? t.clases.msgLive : t.clases.msgRecorded);
      setTitle("");
      setDescription("");
      setUrl("");
      setScheduled("");
      setDuration("");
      setShowForm(false);
      await load();
    } catch (err) {
      // E8: errores del API mapeados por err.key a i18n (apiErrorText); los
      // de validación del cliente llevan su propio mensaje i18n.
      setError(
        err instanceof ApiError
          ? apiErrorText(err, t)
          : err instanceof Error
            ? err.message
            : t.clases.errSave
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: EduClass) => {
    if (!(await confirm(t.clases.confirmDelete.replace("{titulo}", c.title)))) return;
    setError(null);
    setDeletingId(c.id);
    try {
      await api.deleteClass(c.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? apiErrorText(err, t) : t.clases.errDelete);
    } finally {
      setDeletingId((prev) => (prev === c.id ? null : prev));
    }
  };

  return (
    <>
      {dialog}
    <Panel
      title={isLive ? t.clases.liveTitle : t.clases.recordedTitle}
      badge={
        <span aria-live="polite" className={`rounded-full px-2.5 py-1 text-xs font-semibold ${isLive ? "bg-red-500/15 text-red-300" : "bg-indigo-500/15 text-indigo-300"}`}>
          {rows === null ? t.clases.badgeLoading : `${rows.length} ${rows.length === 1 ? t.clases.classOne : t.clases.classMany}`}
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-zinc-400">
        {isLive ? t.clases.liveIntro : t.clases.recordedIntro}
        {!isAdmin && t.clases.readonly}
      </p>

      {isAdmin && (
        <button
          type="button"
          data-no-swipe
          onClick={() => setShowForm((v) => !v)}
          aria-expanded={showForm}
          className="mb-3 min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
        >
          {showForm ? t.clases.hideForm : t.clases.addClass}
        </button>
      )}

      <div className="border-t border-zinc-800 pt-3">
        {loadError ? (
          <ApiErrorBanner error={loadError} t={t} onRetry={load} />
        ) : rows === null ? (
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
                        data-no-swipe
                        onClick={() => remove(c)}
                        disabled={deletingId === c.id}
                        aria-label={t.clases.deleteAria.replace("{titulo}", c.title)}
                        className="min-h-[44px] rounded-lg border border-red-900/60 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-950/50 active:bg-red-950/70 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50"
                      >
                        {deletingId === c.id ? t.clases.deleteBusy : t.clases.deleteBtn}
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

      {isAdmin && showForm && (
        <form onSubmit={add} data-no-swipe className="mt-4 space-y-3 border-t border-zinc-800 pt-4">
          <Field label={t.clases.titleAria}><input aria-label={t.clases.titleAria} className={inputCls} placeholder={t.clases.titlePlaceholder} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoComplete="off" /></Field>
          <Field label={t.clases.descAria}><textarea aria-label={t.clases.descAria} className={inputCls} placeholder={t.clases.descPlaceholder} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></Field>
          <Field label={t.clases.urlAria}><input aria-label={t.clases.urlAria} type="url" className={inputCls} placeholder={isLive ? t.clases.urlPlaceholderLive : t.clases.urlPlaceholderRecorded} value={url} onChange={(e) => setUrl(e.target.value)} maxLength={500} autoComplete="off" /></Field>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {isLive && (
              <label className="text-xs text-zinc-400">{t.clases.dateLabel}
                <input className={`${inputCls} mt-1`} type="datetime-local" value={scheduled} onChange={(e) => setScheduled(e.target.value)} />
                {pastDate && <span className="mt-1 block text-xs text-amber-400">{t.clases.pastDateWarn}</span>}
              </label>
            )}
            <label className="text-xs text-zinc-400">{t.clases.durationLabel}
              <input className={`${inputCls} mt-1`} type="number" min="1" step="1" value={duration} onChange={(e) => setDuration(e.target.value)} />
            </label>
          </div>
          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="w-full rounded-lg bg-indigo-600 min-h-[44px] px-3 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 active:bg-indigo-500 motion-safe:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50"
          >
            {busy ? t.clases.saveBusy : isLive ? t.clases.saveLive : t.clases.saveRecorded}
          </button>
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </form>
      )}
    </Panel>
    </>
  );
}

export function ClasesPanel() {
  const isCancelled = useCancelled();
  const { t } = useLanguage();
  const [me, setMe] = useState<MeResponse | null>(null);
  // E4: el fallo de api.me() también se muestra (antes se tragaba en silencio).
  const [meError, setMeError] = useState<unknown>(null);
  const isAdmin = !!me?.is_admin;

  const loadMe = useCallback(async () => {
    try {
      const v = await api.me();
      if (isCancelled()) return;
      setMe(v);
      setMeError(null);
    } catch (err) {
      if (isCancelled()) return;
      setMe(null);
      setMeError(err);
    }
  }, [isCancelled]);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  return (
    <div className="space-y-4">
      {meError !== null ? <ApiErrorBanner error={meError} t={t} onRetry={loadMe} /> : null}
      <ClassSection kind="grabada" isAdmin={isAdmin} />
      <ClassSection kind="envivo" isAdmin={isAdmin} />
      {/* Herramientas montadas UNA vez (no dentro de ClassSection, que se duplica). */}
      <ClasesHerramientas />
    </div>
  );
}
