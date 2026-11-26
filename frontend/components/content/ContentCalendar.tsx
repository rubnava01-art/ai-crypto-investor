// Calendario de contenido (NEST, 2026-11-17): mes con los contenidos
// programados + formulario. El rango from/to es obligatorio en el backend
// (máx. 93 días); aquí se pide el mes visible. `publicado` solo desde
// borrador/programado, sin retroceso.
"use client";

import { useMemo, useState } from "react";
import {
  api, ApiError,
  type ContentItem, type ContentItemStatus, type ContentPlatform,
} from "../../lib/api";
import { Panel } from "../Panel";
import { ApiErrorBanner, Field, useConfirm } from "../ui";
import { useLanguage } from "../../lib/i18n";
import { useAsyncLoad } from "../../lib/useLoad";
import {
  buildMonthGrid, combineDateTimeToIso, dateKeyInTz, formatDateTimeTz,
  toDateInputValue, toTimeInputValue, todayKey,
} from "../../lib/dates";

const inputCls =
  "w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 transition-colors focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

const PLATFORMS: ContentPlatform[] = ["instagram", "threads", "facebook"];
const STATUSES: ContentItemStatus[] = ["borrador", "programado", "publicado"];

function statusCls(status: ContentItemStatus): string {
  switch (status) {
    case "programado": return "bg-amber-500/15 text-amber-300";
    case "publicado": return "bg-emerald-500/15 text-emerald-300";
    default: return "bg-sky-500/15 text-sky-300";
  }
}

export function ContentCalendar({ isAdmin }: { isAdmin: boolean }) {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const { confirm, dialog } = useConfirm(t);
  const today = todayKey();
  const [cursor, setCursor] = useState(today);
  const [selected, setSelected] = useState<string>(today);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ContentItem | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [platform, setPlatform] = useState<ContentPlatform>("instagram");
  const [status, setStatus] = useState<ContentItemStatus>("borrador");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [year, month] = cursor.split("-").map(Number);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = buildMonthGrid(year, month).flat().filter((d) => d.inMonth).length;
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const monthTitle = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );

  const load = useAsyncLoad<ContentItem[]>(
    (signal) =>
      api.listCalendar(
        { from: monthStart, to: monthEnd },
        statusFilter ? { status: statusFilter } : undefined,
        { signal },
      ),
    [monthStart, monthEnd, statusFilter],
  );
  const items = load.data ?? [];

  const byDay = useMemo(() => {
    const m = new Map<string, ContentItem[]>();
    for (const item of items) {
      const k = dateKeyInTz(item.scheduled_at);
      if (!k) continue;
      const list = m.get(k) ?? [];
      list.push(item);
      m.set(k, list);
    }
    for (const list of m.values()) list.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    return m;
  }, [items]);

  const weeks = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const weekdayShort = (isoDay: number) => {
    const d = new Date(Date.UTC(2026, 10, 1 + isoDay));
    return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(d);
  };
  const selectedList = byDay.get(selected) ?? [];

  const platformLabel = (p: ContentPlatform) =>
    p === "instagram" ? t.contenido.platformInstagram
    : p === "threads" ? t.contenido.platformThreads
    : t.contenido.platformFacebook;

  const statusLabel = (s: ContentItemStatus) =>
    s === "borrador" ? t.contenido.statusDraft
    : s === "programado" ? t.contenido.statusScheduled
    : t.contenido.statusPublished;

  const shiftMonth = (delta: number) => {
    const d = new Date(Date.UTC(year, month - 1 + delta, 1));
    setCursor(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`);
  };

  const openForm = (item?: ContentItem, dayKey?: string) => {
    setMsg(null);
    setFormError(null);
    setEditing(item ?? null);
    setTitle(item?.title ?? "");
    setText(item?.text ?? "");
    setDate(toDateInputValue(item?.scheduled_at) || dayKey || selected);
    setTime(toTimeInputValue(item?.scheduled_at) || "10:00");
    setPlatform(item?.platform ?? "instagram");
    setStatus(item?.status ?? "borrador");
    setNotes(item?.notes ?? "");
    setShowForm(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!title.trim() || !date || !time) {
      setFormError(t.contenido.errSaveItem);
      return;
    }
    setBusy(true);
    try {
      const scheduled_at = combineDateTimeToIso(date, time);
      if (editing) {
        await api.updateCalendarItem(editing.id, {
          title: title.trim(), text, scheduled_at, platform, status, notes: notes.trim(),
        });
        setMsg(t.contenido.msgItemUpdated);
      } else {
        await api.createCalendarItem({
          title: title.trim(), text, scheduled_at, platform, status, notes: notes.trim(),
        });
        setMsg(t.contenido.msgItemCreated);
      }
      setShowForm(false);
      setEditing(null);
      load.reload();
    } catch (err) {
      setFormError(t.contenido.errSaveItem);
    } finally {
      setBusy(false);
    }
  };

  const publish = async (item: ContentItem) => {
    setActionError(null);
    setMsg(null);
    try {
      await api.updateCalendarItem(item.id, { status: "publicado" });
      setMsg(t.contenido.msgPublished);
      load.reload();
    } catch (err) {
      setActionError(t.contenido.errPublish);
    }
  };

  const remove = async (item: ContentItem) => {
    if (!(await confirm(t.contenido.confirmDeleteItem.replace("{titulo}", item.title)))) return;
    setActionError(null);
    setMsg(null);
    try {
      await api.deleteCalendarItem(item.id);
      setMsg(t.contenido.msgItemDeleted);
      load.reload();
    } catch (err) {
      setActionError(t.contenido.errDeleteItem);
    }
  };

  return (
    <>
      {dialog}
      <Panel title={t.contenido.calendarTitle}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => shiftMonth(-1)} aria-label={t.citas.prevMonth} className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">‹</button>
          <span className="min-w-0 flex-1 text-center text-sm font-semibold capitalize text-zinc-100">{monthTitle}</span>
          <button type="button" onClick={() => shiftMonth(1)} aria-label={t.citas.nextMonth} className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">›</button>
          <button type="button" onClick={() => { setCursor(today); setSelected(today); }} className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">{t.citas.today}</button>
          <Field label={t.contenido.itemStatusAria} className="min-w-[160px]">
            <select aria-label={t.contenido.itemStatusAria} className={inputCls} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">{t.citas.allStatuses}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{statusLabel(s)}</option>
              ))}
            </select>
          </Field>
          {isAdmin && (
            <button type="button" onClick={() => openForm()} className="min-h-[44px] rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">
              {t.contenido.newItem}
            </button>
          )}
        </div>

        {load.loading ? (
          <p role="status" className="py-4 text-center text-sm text-zinc-400">{t.contenido.loadingCalendar}</p>
        ) : load.error ? (
          <ApiErrorBanner error={load.error} t={t} onRetry={load.reload} />
        ) : (
          <>
            <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs font-semibold text-zinc-400">
              {Array.from({ length: 7 }, (_, i) => (
                <span key={i} className="py-1 capitalize">{weekdayShort(i)}</span>
              ))}
            </div>
            <div className="space-y-1">
              {weeks.map((week, wi) => (
                <div key={wi} className="grid grid-cols-7 gap-1">
                  {week.map((d) => {
                    const list = byDay.get(d.key) ?? [];
                    const isSelected = d.key === selected;
                    const isToday = d.key === today;
                    return (
                      <button
                        key={d.key}
                        type="button"
                        onClick={() => setSelected(d.key)}
                        aria-label={`${d.key} (${list.length})`}
                        aria-pressed={isSelected}
                        className={`flex min-h-[52px] flex-col items-center justify-start rounded-lg border px-1 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
                          isSelected
                            ? "border-emerald-500 bg-emerald-500/15 text-zinc-100"
                            : d.inMonth
                              ? "border-zinc-800 bg-zinc-900/60 text-zinc-200 hover:bg-zinc-800"
                              : "border-zinc-800/50 bg-zinc-950/40 text-zinc-400"
                        }`}
                      >
                        <span className={`font-semibold ${isToday ? "rounded-full bg-emerald-600 px-1.5 text-white" : ""}`}>{d.day}</span>
                        <span className="mt-1 flex gap-0.5">
                          {list.slice(0, 3).map((item) => (
                            <span
                              key={item.id}
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ background: item.status === "publicado" ? "#34d399" : item.status === "programado" ? "#fbbf24" : "#38bdf8" }}
                            />
                          ))}
                          {list.length > 3 && <span className="text-[10px] leading-none text-zinc-400">+{list.length - 3}</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">{selected}</p>
              {selectedList.length === 0 ? (
                <p className="text-sm text-zinc-400">{t.contenido.emptyCalendar}</p>
              ) : (
                <ul className="space-y-2">
                  {selectedList.map((item) => (
                    <li key={item.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-zinc-100">{item.title}</p>
                          <p className="text-xs text-zinc-400">{platformLabel(item.platform)} · {formatDateTimeTz(item.scheduled_at, locale)}</p>
                          {item.text && <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-300">{item.text}</p>}
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${statusCls(item.status)}`}>{statusLabel(item.status)}</span>
                      </div>
                      {isAdmin && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {item.status !== "publicado" && (
                            <button type="button" onClick={() => publish(item)} className="min-h-[44px] rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white">{t.contenido.markPublished}</button>
                          )}
                          <button type="button" onClick={() => openForm(item)} className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200">{t.contenido.edit}</button>
                          <button type="button" onClick={() => remove(item)} className="min-h-[44px] rounded-lg border border-red-900/60 px-3 py-2 text-xs text-red-400">{t.contenido.delete}</button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {msg && <p className="mt-3 text-sm text-emerald-400">{msg}</p>}
        {actionError && <p role="alert" className="mt-3 text-sm text-red-400">{actionError}</p>}

        {showForm && isAdmin && (
          <form onSubmit={submit} className="mt-4 space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <p className="text-sm font-semibold text-zinc-200">{editing ? t.contenido.saveItem : t.contenido.newItem}</p>
            <Field label={t.contenido.itemTitleAria}>
              <input aria-label={t.contenido.itemTitleAria} className={inputCls} placeholder={t.contenido.itemTitlePlaceholder} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoComplete="off" />
            </Field>
            <Field label={t.contenido.itemTextAria}>
              <textarea aria-label={t.contenido.itemTextAria} className={inputCls} rows={3} placeholder={t.contenido.itemTextPlaceholder} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t.contenido.itemDateAria}>
                <input aria-label={t.contenido.itemDateAria} type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} required />
              </Field>
              <Field label={t.contenido.itemTimeAria}>
                <input aria-label={t.contenido.itemTimeAria} type="time" className={inputCls} value={time} onChange={(e) => setTime(e.target.value)} required />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t.contenido.platformAria}>
                <select aria-label={t.contenido.platformAria} className={inputCls} value={platform} onChange={(e) => setPlatform(e.target.value as ContentPlatform)}>
                  {PLATFORMS.map((p) => (
                    <option key={p} value={p}>{platformLabel(p)}</option>
                  ))}
                </select>
              </Field>
              <Field label={t.contenido.itemStatusAria}>
                <select aria-label={t.contenido.itemStatusAria} className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as ContentItemStatus)}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{statusLabel(s)}</option>
                  ))}
                </select>
              </Field>
            </div>
            {formError && <p role="alert" className="text-sm text-red-400">{formError}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="min-h-[44px] flex-1 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:opacity-50">
                {busy ? t.contenido.saving : t.contenido.saveItem}
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
