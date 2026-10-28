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

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";

const STAGES: { value: DigitalStage; label: string }[] = [
  { value: "diagnostico", label: "Diagnóstico" },
  { value: "propuesta", label: "Propuesta" },
  { value: "desarrollo", label: "Desarrollo" },
  { value: "entrega", label: "Entrega" },
];

const stageLabel = (s: DigitalStage) => STAGES.find((x) => x.value === s)?.label ?? s;

/** Desarrollo digital: seguimiento de la adaptación digital de empresas.
 * Cada proyecto se liga a un contacto del CRM (la empresa), avanza por
 * etapas y tiene tareas y notas. Empieza VACÍO. Solo el admin escribe;
 * prueba solo lee. */
function ProjectTasks({ project, isAdmin }: { project: DigitalProject; isAdmin: boolean }) {
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
      setError(err instanceof ApiError ? err.message : "No se pudo agregar la tarea.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (t: DigitalTask) => {
    try {
      await api.updateDigitalTask(t.id, { done: !t.done });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo actualizar la tarea.");
    }
  };

  const remove = async (t: DigitalTask) => {
    if (!window.confirm(`¿Borrar la tarea "${t.title}"?`)) return;
    try {
      await api.deleteDigitalTask(t.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo borrar la tarea.");
    }
  };

  return (
    <div className="mt-3 border-t border-zinc-800 pt-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Tareas</p>
      {tasks === null ? (
        <p className="text-sm text-zinc-500">Cargando tareas…</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-zinc-500">Sin tareas todavía.</p>
      ) : (
        <ul className="space-y-1.5">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={t.done}
                disabled={!isAdmin}
                onChange={() => toggle(t)}
                aria-label={`Marcar "${t.title}"`}
                className="h-4 w-4 accent-emerald-600"
              />
              <span className={`flex-1 ${t.done ? "text-zinc-500 line-through" : "text-zinc-200"}`}>{t.title}</span>
              {isAdmin && (
                <button onClick={() => remove(t)} className="rounded border border-red-900/60 px-2 py-0.5 text-xs text-red-400 hover:bg-red-950/50">
                  Borrar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {isAdmin && (
        <form onSubmit={add} className="mt-2 flex gap-2">
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nueva tarea…" maxLength={256} autoComplete="off" />
          <button type="submit" disabled={busy || !title.trim()} className="shrink-0 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
            Agregar
          </button>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}

export function DesarrolloPanel() {
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
      setMsg("Proyecto creado.");
      setTitle("");
      setContactId("");
      setStage("diagnostico");
      setNotes("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el proyecto.");
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
      setError(err instanceof ApiError ? err.message : "No se pudo cambiar la etapa.");
    }
  };

  const remove = async (p: DigitalProject) => {
    if (!window.confirm(`¿Borrar el proyecto "${p.title}" y todas sus tareas?`)) return;
    setError(null);
    try {
      await api.deleteDigitalProject(p.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo borrar el proyecto.");
    }
  };

  return (
    <Panel
      title="Desarrollo digital"
      badge={
        <span className="rounded-full bg-sky-500/15 px-2.5 py-1 text-xs font-semibold text-sky-300">
          {projects === null ? "Cargando…" : `${projects.length} proyectos`}
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">
        Adaptación digital de empresas: cada proyecto se liga a una empresa del
        CRM, avanza por etapas y guarda sus tareas y notas. Solo el
        administrador crea y edita.
        {!isAdmin && " Tu rol de prueba es de solo lectura."}
      </p>

      {isAdmin && (
        <form onSubmit={save} className="space-y-2">
          <input className={inputCls} placeholder="Nombre del proyecto *" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoComplete="off" />
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-400">Empresa (contacto del CRM)</span>
            <select className={inputCls} value={contactId} onChange={(e) => setContactId(e.target.value)}>
              <option value="">Sin empresa ligada</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-400">Etapa</span>
            <select className={inputCls} value={stage} onChange={(e) => setStage(e.target.value as DigitalStage)}>
              {STAGES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <textarea className={inputCls} placeholder="Notas del proyecto (plan, acuerdos, pendientes)…" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="w-full rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {busy ? "Creando…" : "Crear proyecto"}
          </button>
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </form>
      )}

      <div className="mt-4 space-y-3 border-t border-zinc-800 pt-3">
        {projects === null ? (
          <p className="py-2 text-sm text-zinc-500">Cargando proyectos…</p>
        ) : projects.length === 0 ? (
          <p className="py-2 text-sm text-zinc-500">Todavía no hay proyectos de desarrollo digital.</p>
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
                  {p.done_count}/{p.tasks_count} tareas
                </span>
                {isAdmin && (
                  <span className="ml-auto flex items-center gap-2">
                    <select
                      aria-label={`Etapa de ${p.title}`}
                      className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300"
                      value={p.stage}
                      onChange={(e) => changeStage(p, e.target.value as DigitalStage)}
                    >
                      {STAGES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <button onClick={() => remove(p)} className="rounded-lg border border-red-900/60 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/50">
                      Borrar
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
