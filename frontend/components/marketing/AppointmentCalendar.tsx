// Calendario de citas (NEST, 2026-11-17): mes / semana / lista.
// Las horas se muestran con timeZone America/Los_Angeles explícito.
// Mes con puntos por día; en móvil la lista es la vista principal.
"use client";

import { useMemo, useState } from "react";
import type { Appointment } from "../../lib/api";
import { useLanguage } from "../../lib/i18n";
import {
  addDaysKey, buildMonthGrid, dateKeyInTz, formatDateTimeTz, todayKey,
} from "../../lib/dates";

type View = "mes" | "semana" | "lista";

function statusDot(status: Appointment["status"]): string {
  switch (status) {
    case "confirmada": return "bg-emerald-400";
    case "completada": return "bg-sky-400";
    case "cancelada": return "bg-zinc-500";
    default: return "bg-amber-400";
  }
}

export function AppointmentCalendar({
  appointments,
  onSelectDay,
}: {
  appointments: Appointment[];
  onSelectDay?: (key: string) => void;
}) {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const [view, setView] = useState<View>("mes");
  const today = todayKey();
  const [cursor, setCursor] = useState(today); // YYYY-MM-DD (lunes de la semana / día del mes)
  const [selected, setSelected] = useState<string>(today);

  const byDay = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of appointments) {
      const k = dateKeyInTz(a.starts_at);
      if (!k) continue;
      const list = m.get(k) ?? [];
      list.push(a);
      m.set(k, list);
    }
    for (const list of m.values()) list.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    return m;
  }, [appointments]);

  const [year, month] = cursor.split("-").map(Number);
  const weeks = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const monthTitle = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
  const weekdayShort = (isoDay: number) => {
    // 2026-11-02 es lunes; días 2-8 nov = lun-dom.
    const d = new Date(Date.UTC(2026, 10, 1 + isoDay));
    return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(d);
  };

  // Semana que contiene el cursor (lunes…domingo).
  const weekStart = useMemo(() => {
    const d = new Date(`${cursor}T00:00:00Z`);
    const dow = (d.getUTCDay() + 6) % 7; // lunes = 0
    return addDaysKey(cursor, -dow);
  }, [cursor]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysKey(weekStart, i)), [weekStart]);

  const selectDay = (key: string) => {
    setSelected(key);
    setCursor(key);
    onSelectDay?.(key);
  };

  const shiftMonth = (delta: number) => {
    const d = new Date(Date.UTC(year, month - 1 + delta, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    setCursor(`${y}-${String(m).padStart(2, "0")}-01`);
  };
  const shiftWeek = (delta: number) => setCursor(addDaysKey(weekStart, delta * 7));

  const sortedAll = useMemo(
    () => [...appointments].sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [appointments],
  );
  const selectedList = byDay.get(selected) ?? [];

  const dayCell = (key: string, day: number, inMonth: boolean) => {
    const list = byDay.get(key) ?? [];
    const isToday = key === today;
    const isSelected = key === selected;
    return (
      <button
        key={key}
        type="button"
        onClick={() => selectDay(key)}
        aria-label={`${key} (${list.length})`}
        aria-pressed={isSelected}
        className={`flex min-h-[52px] flex-col items-center justify-start rounded-lg border px-1 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
          isSelected
            ? "border-emerald-500 bg-emerald-500/15 text-zinc-100"
            : inMonth
              ? "border-zinc-800 bg-zinc-900/60 text-zinc-200 hover:bg-zinc-800"
              : "border-zinc-800/50 bg-zinc-950/40 text-zinc-600"
        }`}
      >
        <span className={`font-semibold ${isToday ? "rounded-full bg-emerald-600 px-1.5 text-white" : ""}`}>{day}</span>
        <span className="mt-1 flex gap-0.5">
          {list.slice(0, 3).map((a) => (
            <span key={a.id} className={`h-1.5 w-1.5 rounded-full ${statusDot(a.status)}`} />
          ))}
          {list.length > 3 && <span className="text-[10px] leading-none text-zinc-400">+{list.length - 3}</span>}
        </span>
      </button>
    );
  };

  const renderList = (list: Appointment[]) => (
    <ul className="space-y-2">
      {list.map((a) => (
        <li key={a.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
          <p className="text-sm font-semibold text-zinc-100">{a.client_name}</p>
          <p className="text-xs text-zinc-400">{a.service_type} · {formatDateTimeTz(a.starts_at, locale)} · {a.duration_min} min</p>
        </li>
      ))}
    </ul>
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="group" aria-label={t.citas.calendarTitle}>
          {(["mes", "semana", "lista"] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`min-h-[44px] rounded-lg px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
                view === v ? "bg-emerald-700 text-white" : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              {v === "mes" ? t.citas.viewMonth : v === "semana" ? t.citas.viewWeek : t.citas.viewList}
            </button>
          ))}
        </div>
        {view !== "lista" && (
          <>
            <button
              type="button"
              onClick={() => (view === "mes" ? shiftMonth(-1) : shiftWeek(-1))}
              aria-label={t.citas.prevMonth}
              className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              ‹
            </button>
            <span className="min-w-0 flex-1 text-center text-sm font-semibold capitalize text-zinc-100">
              {view === "mes" ? monthTitle : `${weekDays[0]} → ${weekDays[6]}`}
            </span>
            <button
              type="button"
              onClick={() => (view === "mes" ? shiftMonth(1) : shiftWeek(1))}
              aria-label={t.citas.nextMonth}
              className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              ›
            </button>
            <button
              type="button"
              onClick={() => { setCursor(today); setSelected(today); }}
              className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              {t.citas.today}
            </button>
          </>
        )}
      </div>

      {view === "mes" && (
        <>
          <div className="mb-1 grid grid-cols-7 gap-1 text-center text-xs font-semibold text-zinc-400">
            {Array.from({ length: 7 }, (_, i) => (
              <span key={i} className="py-1 capitalize">{weekdayShort(i)}</span>
            ))}
          </div>
          <div className="space-y-1">
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-1">
                {week.map((d) => dayCell(d.key, d.day, d.inMonth))}
              </div>
            ))}
          </div>
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">{selected}</p>
            {selectedList.length === 0 ? (
              <p className="text-sm text-zinc-400">{t.citas.noAppointmentsDay}</p>
            ) : (
              renderList(selectedList)
            )}
          </div>
        </>
      )}

      {view === "semana" && (
        <>
          <div className="grid grid-cols-7 gap-1">
            {weekDays.map((key) => {
              const d = new Date(`${key}T00:00:00Z`);
              return dayCell(key, d.getUTCDate(), true);
            })}
          </div>
          <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">{weekdayShort((new Date(`${selected}T00:00:00Z`).getUTCDay() + 6) % 7)} · {selected}</p>
          <div className="mt-2">
            {selectedList.length === 0 ? (
              <p className="text-sm text-zinc-400">{t.citas.noAppointmentsDay}</p>
            ) : (
              renderList(selectedList)
            )}
          </div>
        </>
      )}

      {view === "lista" && (
        sortedAll.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-400">{t.citas.emptyAppointments}</p>
        ) : (
          renderList(sortedAll)
        )
      )}
    </div>
  );
}
