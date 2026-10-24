"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api, ApiError,
  type BusinessArea, type BusinessNote, type BusinessTask, type MeResponse,
} from "../lib/api";
import { Panel } from "./Panel";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";

const AREAS: { value: BusinessArea; label: string; hint: string }[] = [
  { value: "marketing", label: "Marketing", hint: "Campañas, contenido y promoción" },
  { value: "ventas", label: "Ventas", hint: "Clientes, ofertas y cierres" },
  { value: "legal", label: "Legal", hint: "Contratos, permisos y cumplimiento" },
  { value: "administrativo", label: "Administrativo", hint: "Operación, finanzas y oficina" },
];

export function BusinessPanel() {
  const [area, setArea] = useState<BusinessArea>("marketing");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [notes, setNotes] = useState<BusinessNote[]>([]);
  const [tasks, setTasks] = useState<BusinessTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [editingNote, setEditingNote] = useState<BusinessNote | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");

  const isAdmin = me?.is_admin ?? false;

  const load = useCallback(async (a: BusinessArea) => {
    setLoading(true);
    setError(null);
    try {
      const [n, t, m] = await Promise.all([
        api.listBusinessNotes(a),
        api.listBusinessTasks(a),
        me ? Promise.resolve(me) : api.me(),
      ]);
      setNotes(n);
      setTasks(t);
      setMe(m);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo cargar el área");
    } finally {
      setLoading(false);
    }
  }, [me]);

  useEffect(() => {
    load(area);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area]);

  const refresh = () => load(area);

  const createNote = async () => {
    if (!noteTitle.trim()) return;
    try {
      await api.createBusinessNote(area, { title: noteTitle.trim(), body: noteBody });
      setNoteTitle("");
      setNoteBody("");
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo crear la nota");
    }
  };

  const saveEdit = async () => {
    if (!editingNote || !editTitle.trim()) return;
    try {
      await api.updateBusinessNote(editingNote.id, { title: editTitle.trim(), body: editBody });
      setEditingNote(null);
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo guardar la nota");
    }
  };

  const createTask = async () => {
    if (!taskTitle.trim()) return;
    try {
      await api.createBusinessTask(area, { title: taskTitle.trim() });
      setTaskTitle("");
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo crear la tarea");
    }
  };

  const toggleTask = async (t: BusinessTask) => {
    try {
      await api.updateBusinessTask(t.id, { done: !t.done });
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo actualizar la tarea");
    }
  };

  const areaLabel = AREAS.find((a) => a.value === area)?.label ?? area;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Áreas de Business">
        {AREAS.map((a) => (
          <button
            key={a.value}
            role="tab"
            aria-selected={area === a.value}
            onClick={() => setArea(a.value)}
            className={
              area === a.value
                ? "rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
                : "rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300 hover:bg-zinc-800"
            }
          >
            {a.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</p>
      )}

      {loading ? (
        <p className="text-sm text-zinc-400">Cargando {areaLabel}…</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <Panel title={`Notas — ${areaLabel}`} badge="Solo de esta área">
            {notes.length === 0 && (
              <p className="text-sm text-zinc-400">Sin notas todavía en {areaLabel}.</p>
            )}
            <ul className="space-y-3">
              {notes.map((n) => (
                <li key={n.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                  {editingNote?.id === n.id ? (
                    <div className="space-y-2">
                      <input className={inputCls} value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                      <textarea className={inputCls} rows={3} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                      <div className="flex gap-2">
                        <button onClick={saveEdit} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white">Guardar</button>
                        <button onClick={() => setEditingNote(null)} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300">Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-zinc-100">{n.title}</p>
                      {n.body && <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-300">{n.body}</p>}
                      {isAdmin && (
                        <div className="mt-2 flex gap-3 text-xs">
                          <button
                            className="text-emerald-400 hover:underline"
                            onClick={() => { setEditingNote(n); setEditTitle(n.title); setEditBody(n.body); }}
                          >
                            Editar
                          </button>
                          <button
                            className="text-red-400 hover:underline"
                            onClick={async () => { await api.deleteBusinessNote(n.id); refresh(); }}
                          >
                            Eliminar
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
            {isAdmin && (
              <div className="mt-4 space-y-2 border-t border-zinc-800 pt-4">
                <input
                  className={inputCls}
                  placeholder="Título de la nota"
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                />
                <textarea
                  className={inputCls}
                  rows={3}
                  placeholder="Texto de la nota"
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                />
                <button onClick={createNote} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">
                  Guardar nota
                </button>
              </div>
            )}
          </Panel>

          <Panel title={`Tareas — ${areaLabel}`} badge="Solo de esta área">
            {tasks.length === 0 && (
              <p className="text-sm text-zinc-400">Sin tareas todavía en {areaLabel}.</p>
            )}
            <ul className="space-y-2">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={t.done}
                    disabled={!isAdmin}
                    onChange={() => toggleTask(t)}
                    aria-label={`Marcar ${t.title}`}
                  />
                  <span className={`flex-1 text-sm ${t.done ? "text-zinc-500 line-through" : "text-zinc-100"}`}>
                    {t.title}
                  </span>
                  {isAdmin && (
                    <button
                      className="text-xs text-red-400 hover:underline"
                      onClick={async () => { await api.deleteBusinessTask(t.id); refresh(); }}
                    >
                      Eliminar
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {isAdmin && (
              <div className="mt-4 flex gap-2 border-t border-zinc-800 pt-4">
                <input
                  className={inputCls}
                  placeholder="Nueva tarea"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") createTask(); }}
                />
                <button onClick={createTask} className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">
                  Añadir
                </button>
              </div>
            )}
          </Panel>
        </div>
      )}
      {!isAdmin && me && (
        <p className="text-xs text-zinc-500">Rol prueba: puedes leer las notas y tareas, pero solo el admin las crea o edita.</p>
      )}
    </div>
  );
}
