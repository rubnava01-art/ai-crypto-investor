"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api,
  ApiError,
  type CrmContact,
  type DigitalProject,
  type DigitalStage,
  type DigitalTask,
  type MeResponse,
} from "../lib/api";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";


/** Desarrollo digital: seguimiento de la adaptación digital de empresas.
 * Cada proyecto se liga a un contacto del CRM (la empresa), avanza por
 * etapas y tiene tareas y notas. Empieza VACÍO. Solo el admin escribe;
 * prueba solo lee. */
function ProjectTasks({ project, isAdmin }: { project: DigitalProject; isAdmin: boolean }) {
  const { t } = useLanguage();
  const [tasks, setTasks] = useState<DigitalTask[] | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTasks(await api.listDigitalTasks(project.id));
    } catch {
      setTasks([]);
    }
  }, [project.id]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createDigitalTask(project.id, { title: title.trim() });
      setTitle("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.desarrollo.errAddTask);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (tk: DigitalTask) => {
    try {
      await api.updateDigitalTask(tk.id, { done: !tk.done });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.desarrollo.errUpdateTask);
    }
  };

  const remove = async (tk: DigitalTask) => {
    if (!window.confirm(t.desarrollo.confirmDeleteTask.replace("{titulo}", tk.title))) return;
    try {
      await api.deleteDigitalTask(tk.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.desarrollo.errDeleteTask);
    }
  };

  return (
    <div className="mt-3 border-t border-zinc-800 pt-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">{t.desarrollo.tasksHeading}</p>
      {tasks === null ? (
        <p className="text-sm text-zinc-500">{t.desarrollo.loadingTasks}</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-zinc-500">{t.desarrollo.emptyTasks}</p>
      ) : (
        <ul className="space-y-1.5">
          {tasks.map((tk) => (
            <li key={tk.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={tk.done}
                disabled={!isAdmin}
                onChange={() => toggle(tk)}
                aria-label={t.desarrollo.markTask.replace("{titulo}", tk.title)}
                className="h-4 w-4 accent-emerald-600"
              />
              <span className={`flex-1 ${tk.done ? "text-zinc-500 line-through" : "text-zinc-200"}`}>{tk.title}</span>
              {isAdmin && (
                <button onClick={() => remove(tk)} className="rounded border border-red-900/60 px-2 py-0.5 text-xs text-red-400 hover:bg-red-950/50">
                  {t.desarrollo.deleteBtn}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {isAdmin && (
        <form onSubmit={add} className="mt-2 flex gap-2">
          <input aria-label={t.desarrollo.newTaskAria} className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t.desarrollo.newTaskPlaceholder} maxLength={256} autoComplete="off" />
          <button type="submit" disabled={busy || !title.trim()} className="shrink-0 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
            {t.desarrollo.addTask}
          </button>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}

export function DesarrolloPanel() {
  const { t } = useLanguage();
  const stages: { value: DigitalStage; label: string }[] = [
    { value: "diagnostico", label: t.desarrollo.stageDiagnostico },
    { value: "propuesta", label: t.desarrollo.stagePropuesta },
    { value: "desarrollo", label: t.desarrollo.stageDesarrollo },
    { value: "entrega", label: t.desarrollo.stageEntrega },
  ];
  const stageLabel = (s: DigitalStage) => stages.find((x) => x.value === s)?.label ?? s;
  const [me, setMe] = useState<MeResponse | null>(null);
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [projects, setProjects] = useState<DigitalProject[] | null>(null);
  const [title, setTitle] = useState("");
  const [contactId, setContactId] = useState<string>("");
  const [stage, setStage] = useState<DigitalStage>("diagnostico");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = !!me?.is_admin;

  const load = useCallback(async () => {
    try {
      setProjects(await api.listDigitalProjects());
    } catch {
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null));
    api.listContacts().then(setContacts).catch(() => setContacts([]));
    load();
  }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.createDigitalProject({
        title: title.trim(),
        contact_id: contactId ? Number(contactId) : null,
        stage,
        notes,
      });
      setMsg(t.desarrollo.msgCreated);
      setTitle("");
      setContactId("");
      setStage("diagnostico");
      setNotes("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.desarrollo.errCreate);
    } finally {
      setBusy(false);
    }
  };

  const changeStage = async (p: DigitalProject, next: DigitalStage) => {
    setError(null);
    try {
      await api.updateDigitalProject(p.id, { stage: next });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.desarrollo.errChangeStage);
    }
  };

  const remove = async (p: DigitalProject) => {
    if (!window.confirm(t.desarrollo.confirmDeleteProject.replace("{titulo}", p.title))) return;
    setError(null);
    try {
      await api.deleteDigitalProject(p.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.desarrollo.errDeleteProject);
    }
  };

  return (
    <Panel
      title={t.desarrollo.panelTitle}
      badge={
        <span className="rounded-full bg-sky-500/15 px-2.5 py-1 text-xs font-semibold text-sky-300">
          {projects === null ? t.desarrollo.badgeLoading : `${projects.length} ${t.desarrollo.projectsWord}`}
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">
        {t.desarrollo.intro}
        {!isAdmin && t.desarrollo.readonly}
      </p>

      {isAdmin && (
        <form onSubmit={save} className="space-y-2">
          <input aria-label={t.desarrollo.projectAria} className={inputCls} placeholder={t.desarrollo.projectPlaceholder} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoComplete="off" />
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-400">{t.desarrollo.companyLabel}</span>
            <select className={inputCls} value={contactId} onChange={(e) => setContactId(e.target.value)}>
              <option value="">{t.desarrollo.noCompany}</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-400">{t.desarrollo.stageLabel}</span>
            <select className={inputCls} value={stage} onChange={(e) => setStage(e.target.value as DigitalStage)}>
              {stages.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <textarea aria-label={t.desarrollo.notesAria} className={inputCls} placeholder={t.desarrollo.notesPlaceholder} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="w-full rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {busy ? t.desarrollo.createBusy : t.desarrollo.create}
          </button>
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </form>
      )}

      <div className="mt-4 space-y-3 border-t border-zinc-800 pt-3">
        {projects === null ? (
          <p className="py-2 text-sm text-zinc-500">{t.desarrollo.loadingProjects}</p>
        ) : projects.length === 0 ? (
          <p className="py-2 text-sm text-zinc-500">{t.desarrollo.emptyProjects}</p>
        ) : (
          projects.map((p) => (
            <article key={p.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-zinc-100">{p.title}</span>
                <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-semibold text-sky-300">
                  {stageLabel(p.stage)}
                </span>
                {p.contact_name && (
                  <span className="text-xs text-zinc-400">· {p.contact_name}</span>
                )}
                <span className="text-xs text-zinc-500">
                  {p.done_count}/{p.tasks_count} {t.desarrollo.tasksWord}
                </span>
                {isAdmin && (
                  <span className="ml-auto flex items-center gap-2">
                    <select
                      aria-label={t.desarrollo.stageOf.replace("{titulo}", p.title)}
                      className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300"
                      value={p.stage}
                      onChange={(e) => changeStage(p, e.target.value as DigitalStage)}
                    >
                      {stages.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <button onClick={() => remove(p)} className="rounded-lg border border-red-900/60 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/50">
                      {t.desarrollo.deleteBtn}
                    </button>
                  </span>
                )}
              </div>
              {p.notes && <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{p.notes}</p>}
              <ProjectTasks project={p} isAdmin={isAdmin} />
            </article>
          ))
        )}
      </div>
    </Panel>
  );
}
