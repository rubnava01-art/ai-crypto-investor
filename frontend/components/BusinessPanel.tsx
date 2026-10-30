"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api, ApiError,
  type BusinessArea, type BusinessNote, type BusinessTask, type MeResponse,
} from "../lib/api";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";


export function BusinessPanel() {
  const { t: tt } = useLanguage();
  const AREAS: { value: BusinessArea; label: string; hint: string }[] = [
    { value: "marketing", label: tt.business.areaMarketing, hint: tt.business.hintMarketing },
    { value: "ventas", label: tt.business.areaVentas, hint: tt.business.hintVentas },
    { value: "legal", label: tt.business.areaLegal, hint: tt.business.hintLegal },
    { value: "administrativo", label: tt.business.areaAdministrativo, hint: tt.business.hintAdministrativo },
  ];
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
      setError(e instanceof ApiError ? e.message : tt.business.errLoad);
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
      setError(e instanceof ApiError ? e.message : tt.business.errCreateNote);
    }
  };

  const saveEdit = async () => {
    if (!editingNote || !editTitle.trim()) return;
    try {
      await api.updateBusinessNote(editingNote.id, { title: editTitle.trim(), body: editBody });
      setEditingNote(null);
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tt.business.errSaveNote);
    }
  };

  const createTask = async () => {
    if (!taskTitle.trim()) return;
    try {
      await api.createBusinessTask(area, { title: taskTitle.trim() });
      setTaskTitle("");
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tt.business.errCreateTask);
    }
  };

  const toggleTask = async (t: BusinessTask) => {
    try {
      await api.updateBusinessTask(t.id, { done: !t.done });
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tt.business.errUpdateTask);
    }
  };

  const areaLabel = AREAS.find((a) => a.value === area)?.label ?? area;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={tt.business.areasAria}>
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
        <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</p>
      )}

      {loading ? (
        <p className="text-sm text-zinc-400">{tt.business.loading.replace("{area}", areaLabel)}</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <Panel title={tt.business.notesTitle.replace("{area}", areaLabel)} badge={tt.business.areaBadge}>
            {notes.length === 0 && (
              <p className="text-sm text-zinc-400">{tt.business.emptyNotes.replace("{area}", areaLabel)}</p>
            )}
            <ul className="space-y-3">
              {notes.map((n) => (
                <li key={n.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                  {editingNote?.id === n.id ? (
                    <div className="space-y-2">
                      <input aria-label={tt.business.noteTitleAria} className={inputCls} value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                      <textarea aria-label={tt.business.noteBodyAria} className={inputCls} rows={3} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                      <div className="flex gap-2">
                        <button onClick={saveEdit} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white">{tt.business.save}</button>
                        <button onClick={() => setEditingNote(null)} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300">{tt.business.cancel}</button>
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
                            {tt.business.edit}
                          </button>
                          <button
                            className="text-red-400 hover:underline"
                            onClick={async () => { if (!window.confirm(tt.business.confirmDeleteNote.replace("{titulo}", n.title))) return; await api.deleteBusinessNote(n.id); refresh(); }}
                          >
                            {tt.business.delete}
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
                <input aria-label={tt.business.noteTitleAria}
                  className={inputCls}
                  placeholder={tt.business.noteTitlePlaceholder}
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                />
                <textarea aria-label={tt.business.noteBodyAria}
                  className={inputCls}
                  rows={3}
                  placeholder={tt.business.noteBodyPlaceholder}
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                />
                <button onClick={createNote} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">
                  {tt.business.saveNote}
                </button>
              </div>
            )}
          </Panel>

          <Panel title={tt.business.tasksTitle.replace("{area}", areaLabel)} badge={tt.business.areaBadge}>
            {tasks.length === 0 && (
              <p className="text-sm text-zinc-400">{tt.business.emptyTasks.replace("{area}", areaLabel)}</p>
            )}
            <ul className="space-y-2">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={t.done}
                    disabled={!isAdmin}
                    onChange={() => toggleTask(t)}
                    aria-label={tt.business.markTask.replace("{titulo}", t.title)}
                  />
                  <span className={`flex-1 text-sm ${t.done ? "text-zinc-500 line-through" : "text-zinc-100"}`}>
                    {t.title}
                  </span>
                  {isAdmin && (
                    <button
                      className="text-xs text-red-400 hover:underline"
                      onClick={async () => { if (!window.confirm(tt.business.confirmDeleteTask.replace("{titulo}", t.title))) return; await api.deleteBusinessTask(t.id); refresh(); }}
                    >
                      {tt.business.delete}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {isAdmin && (
              <div className="mt-4 flex gap-2 border-t border-zinc-800 pt-4">
                <input aria-label={tt.business.newTaskAria}
                  className={inputCls}
                  placeholder={tt.business.newTaskPlaceholder}
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") createTask(); }}
                />
                <button onClick={createTask} className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">
                  {tt.business.add}
                </button>
              </div>
            )}
          </Panel>
        </div>
      )}
      {!isAdmin && me && (
        <p className="text-xs text-zinc-500">{tt.business.viewerNote}</p>
      )}
    </div>
  );
}
