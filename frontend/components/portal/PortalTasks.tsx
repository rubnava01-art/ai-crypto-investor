// Tareas del portal (NEST, 2026-11-17): solo lectura, solo lo propio.
// Tareas de sus proyectos digitales + sus próximas citas como lista aparte.
// Solo endpoints /api/business/marketing/portal/*.
"use client";

import { api, type PortalTasksResponse } from "../../lib/api";
import { Panel } from "../Panel";
import { ApiErrorBanner } from "../ui";
import { useLanguage } from "../../lib/i18n";
import { useAsyncLoad } from "../../lib/useLoad";
import { formatDateTimeTz } from "../../lib/dates";

export function PortalTasks({ contactId }: { contactId?: number }) {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const load = useAsyncLoad<PortalTasksResponse>(
    (signal) => api.listPortalTasks(contactId, { signal }),
    [contactId],
  );
  const data = load.data;
  const tasks = data?.tasks ?? [];
  const upcoming = data?.proximas_citas ?? [];

  return (
    <div className="space-y-4">
      <Panel title={t.portal.tasksTitle} badge={<span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">{tasks.length}</span>}>
        {load.loading ? (
          <p role="status" className="py-4 text-center text-sm text-zinc-400">{t.portal.loading}</p>
        ) : load.error ? (
          <ApiErrorBanner error={load.error} t={t} onRetry={load.reload} />
        ) : tasks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-700 px-4 py-6 text-center">
            <p className="text-sm text-zinc-400">{t.portal.emptyTasks}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
                <input type="checkbox" className="h-5 w-5 shrink-0 accent-emerald-500" checked={task.done} disabled aria-label={task.title} />
                <span className={`flex-1 text-sm ${task.done ? "text-zinc-400 line-through" : "text-zinc-100"}`}>{task.title}</span>
                {task.project_title && <span className="text-xs text-zinc-400">{t.portal.projectLabel}: {task.project_title}</span>}
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${task.done ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
                  {task.done ? t.portal.taskDone : t.portal.taskPending}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={t.portal.upcomingTitle} badge={<span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">{upcoming.length}</span>}>
        {load.loading ? (
          <p role="status" className="py-4 text-center text-sm text-zinc-400">{t.portal.loading}</p>
        ) : load.error ? (
          <ApiErrorBanner error={load.error} t={t} onRetry={load.reload} />
        ) : upcoming.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-700 px-4 py-6 text-center">
            <p className="text-sm text-zinc-400">{t.portal.emptyAppointments}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {upcoming.map((a) => (
              <li key={a.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
                <p className="text-sm font-semibold text-zinc-100">{a.service_type}</p>
                <p className="text-xs text-zinc-400">{formatDateTimeTz(a.starts_at, locale)} · {a.duration_min} min</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
