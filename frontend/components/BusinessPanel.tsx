// Business — shell (NEST, 2026-11-17): conserva las pestañas de área y las
// notas/tareas por área. Cuando el área es Marketing, aparece una segunda
// fila de sub-pestañas: Notas y tareas (la vista actual, sin cambios) ·
// Marketing y citas · Portal cliente · Contenido · Desarrollo de marca ·
// Inteligencia. Cada sub-sección vive en su propio archivo y se carga con
// pasa `me`/`isAdmin` por props (un solo /me). Las áreas ventas/legal/
// administrativo no cambian. Sin entradas nuevas en ModuleNav, sin rutas
// nuevas en app/.
//
// REGLA DE COLOR POR NIVEL DE PESTAÑAS (2026-11-17, un color por nivel):
// - Nivel 1, áreas de Negocio (AREAS): emerald (bg-emerald-700).
// - Nivel 2, sub-pestañas de Marketing (SUBS): sky (bg-sky-700).
// - Nivel 3, pestañas internas de cada módulo (MarketingPanel,
//   ContentEnginePanel, ClientPortalPanel): sky oscuro (bg-sky-800).
//   La activa de cada nivel usa su color; la inactiva, borde zinc.
// Inteligencia (BI) es solo admin: sus endpoints son require_admin, así
// que la sub-pestaña se oculta a no-admin y el panel ni se monta.
"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api, ApiError,
  type BusinessArea, type BusinessNote, type BusinessTask, type MeResponse,
} from "../lib/api";
import { Panel } from "./Panel";
import { EmptyState } from "./badges";
import { useConfirm, Field, PanelLoading, isAdminOnlyForbidden } from "./ui";
import { useLanguage } from "../lib/i18n";
import { useCancelled } from "../lib/useLoad";

const MarketingPanel = dynamic(
  () => import("./marketing/MarketingPanel").then((m) => m.MarketingPanel),
  { loading: () => <PanelLoading /> },
);
const ClientPortalPanel = dynamic(
  () => import("./portal/ClientPortalPanel").then((m) => m.ClientPortalPanel),
  { loading: () => <PanelLoading /> },
);
const ContentEnginePanel = dynamic(
  () => import("./content/ContentEnginePanel").then((m) => m.ContentEnginePanel),
  { loading: () => <PanelLoading /> },
);
const BusinessIntelligencePanel = dynamic(
  () => import("./bi/BusinessIntelligencePanel").then((m) => m.BusinessIntelligencePanel),
  { loading: () => <PanelLoading /> },
);
const BrandDevelopmentPanel = dynamic(
  () => import("./marketing/BrandDevelopmentPanel").then((m) => m.BrandDevelopmentPanel),
  { loading: () => <PanelLoading /> },
);

const inputCls =
  "w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 transition-colors focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

type MarketingSub = "notas" | "marketing" | "portal" | "contenido" | "desarrollo" | "bi";

export function BusinessPanel() {
  const isCancelled = useCancelled();
  const { t: tt } = useLanguage();
  const { confirm, dialog } = useConfirm(tt);
  const AREAS: { value: BusinessArea; label: string; hint: string }[] = [
    { value: "marketing", label: tt.business.areaMarketing, hint: tt.business.hintMarketing },
    { value: "ventas", label: tt.business.areaVentas, hint: tt.business.hintVentas },
    { value: "legal", label: tt.business.areaLegal, hint: tt.business.hintLegal },
    { value: "administrativo", label: tt.business.areaAdministrativo, hint: tt.business.hintAdministrativo },
  ];
  const [area, setArea] = useState<BusinessArea>("marketing");
  const [sub, setSub] = useState<MarketingSub>("notas");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [notes, setNotes] = useState<BusinessNote[]>([]);
  const [tasks, setTasks] = useState<BusinessTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Error de carga en crudo (H1): el 403 del cliente vinculado se detecta
  // aquí; `error` queda solo para los fallos de acción (crear/editar…).
  const [loadError, setLoadError] = useState<unknown>(null);

  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  // Refs para los EmptyState con acción: el botón enfoca el campo de
  // creación (primera nota / primera tarea) en vez de dejar una frase.
  const noteTitleRef = useRef<HTMLInputElement | null>(null);
  const taskTitleRef = useRef<HTMLInputElement | null>(null);
  const focusField = (ref: React.RefObject<HTMLInputElement | null>) => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    ref.current?.focus();
  };
  const [editingNote, setEditingNote] = useState<BusinessNote | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");

  const isAdmin = me?.is_admin ?? false;
  // H1 (2026-11-17): cliente vinculado → 403 (S1) en notas/tareas: estado
  // amable en vez del párrafo rojo, sin reintento.
  const forbidden = isAdminOnlyForbidden(loadError, isAdmin);

  const load = useCallback(async (a: BusinessArea) => {
    setLoading(true);
    setError(null);
    setLoadError(null);
    try {
      const [n, t, m] = await Promise.all([
        api.listBusinessNotes(a),
        api.listBusinessTasks(a),
        me ? Promise.resolve(me) : api.me(),
      ]);
      if (isCancelled()) return;
      setNotes(n);
      setTasks(t);
      setMe(m);
    } catch (e) {
      // H1: el 403 del cliente vinculado (S1) no va al párrafo rojo de
      // error: lo marca `loadError` y lo muestra el EmptyState amable.
      setLoadError(e);
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

  const SUBS: { value: MarketingSub; label: string }[] = [
    { value: "notas", label: tt.business.subNotas },
    { value: "marketing", label: tt.business.subMarketing },
    { value: "portal", label: tt.business.subPortal },
    { value: "contenido", label: tt.business.subContenido },
    { value: "desarrollo", label: tt.business.subDesarrollo },
    // Inteligencia (S3): solo admin — sus endpoints son require_admin y
    // el panel ni se monta para no-admin.
    ...(isAdmin ? [{ value: "bi" as MarketingSub, label: tt.business.subBi }] : []),
  ];

  const notesTasksView = loading ? (
    <p className="text-sm text-zinc-400">{tt.business.loading.replace("{area}", areaLabel)}</p>
  ) : forbidden ? (
    <EmptyState text={tt.reliability.adminOnlySection} />
  ) : (
    <div className="grid gap-6 md:grid-cols-2">
      <Panel title={tt.business.notesTitle.replace("{area}", areaLabel)} badge={tt.business.areaBadge}>
        {notes.length === 0 && (
          <EmptyState
            text={tt.business.emptyNotes.replace("{area}", areaLabel)}
            actionLabel={isAdmin ? tt.business.createFirstNote : undefined}
            onAction={isAdmin ? () => focusField(noteTitleRef) : undefined}
          />
        )}
        <ul className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
              {editingNote?.id === n.id ? (
                <div className="space-y-3">
                  <Field label={tt.business.noteTitleAria}><input aria-label={tt.business.noteTitleAria} className={inputCls} value={editTitle} onChange={(e) => setEditTitle(e.target.value)} /></Field>
                  <textarea aria-label={tt.business.noteBodyAria} className={inputCls} rows={3} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                  <div className="flex gap-2">
                    <button onClick={saveEdit} className="min-h-[44px] rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">{tt.business.save}</button>
                    <button onClick={() => setEditingNote(null)} className="min-h-[44px] rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">{tt.business.cancel}</button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm font-semibold text-zinc-100">{n.title}</p>
                  {n.body && <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-300">{n.body}</p>}
                  {isAdmin && (
                    <div className="mt-3 flex gap-2 text-xs">
                      <button
                        className="min-h-[44px] inline-flex items-center rounded px-1 py-1 text-emerald-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                        onClick={() => { setEditingNote(n); setEditTitle(n.title); setEditBody(n.body); }}
                      >
                        {tt.business.edit}
                      </button>
                      <button
                        className="min-h-[44px] inline-flex items-center rounded px-1 py-1 text-red-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60"
                        onClick={async () => { if (!(await confirm(tt.business.confirmDeleteNote.replace("{titulo}", n.title)))) return; await api.deleteBusinessNote(n.id); refresh(); }}
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
          <div className="mt-5 space-y-3 border-t border-zinc-800 pt-5">
            <Field label={tt.business.noteTitleAria}><input aria-label={tt.business.noteTitleAria}
              ref={noteTitleRef}
              className={inputCls}
              placeholder={tt.business.noteTitlePlaceholder}
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
            /></Field>
            <Field label={tt.business.noteBodyAria}><textarea aria-label={tt.business.noteBodyAria}
              className={inputCls}
              rows={3}
              placeholder={tt.business.noteBodyPlaceholder}
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
            /></Field>
            <button onClick={createNote} className="min-h-[44px] rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">
              {tt.business.saveNote}
            </button>
          </div>
        )}
      </Panel>

      <Panel title={tt.business.tasksTitle.replace("{area}", areaLabel)} badge={tt.business.areaBadge}>
        {tasks.length === 0 && (
          <EmptyState
            text={tt.business.emptyTasks.replace("{area}", areaLabel)}
            actionLabel={isAdmin ? tt.business.addFirstTask : undefined}
            onAction={isAdmin ? () => focusField(taskTitleRef) : undefined}
          />
        )}
        <ul className="space-y-2">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0 accent-emerald-500"
                checked={t.done}
                disabled={!isAdmin}
                onChange={() => toggleTask(t)}
                aria-label={tt.business.markTask.replace("{titulo}", t.title)}
              />
              <span className={`flex-1 text-sm ${t.done ? "text-zinc-400 line-through" : "text-zinc-100"}`}>
                {t.title}
              </span>
              {isAdmin && (
                <button
                  className="min-h-[44px] inline-flex items-center rounded px-1 py-1 text-xs text-red-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60"
                  onClick={async () => { if (!(await confirm(tt.business.confirmDeleteTask.replace("{titulo}", t.title)))) return; await api.deleteBusinessTask(t.id); refresh(); }}
                >
                  {tt.business.delete}
                </button>
              )}
            </li>
          ))}
        </ul>
        {isAdmin && (
          <div className="mt-5 flex gap-2 border-t border-zinc-800 pt-5">
            <Field label={tt.business.newTaskAria} className="flex-1"><input aria-label={tt.business.newTaskAria}
              ref={taskTitleRef}
              className={inputCls}
              placeholder={tt.business.newTaskPlaceholder}
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") createTask(); }}
            /></Field>
            <button onClick={createTask} className="min-h-[44px] shrink-0 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">
              {tt.business.add}
            </button>
          </div>
        )}
      </Panel>
    </div>
  );

  return (
    <>
      {dialog}
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
                ? "min-h-[44px] rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                : "min-h-[44px] rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            }
          >
            {a.label}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm leading-relaxed text-red-300">{error}</p>
      )}

      {loadError != null && !forbidden && (
        <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm leading-relaxed text-red-300">{loadError instanceof ApiError ? loadError.message : tt.business.errLoad}</p>
      )}

      {area === "marketing" && (
        <div className="flex flex-wrap gap-2 overflow-x-auto" role="tablist" aria-label={tt.business.subAria}>
          {SUBS.map((s) => (
            <button
              key={s.value}
              role="tab"
              aria-selected={sub === s.value}
              onClick={() => setSub(s.value)}
              className={
                sub === s.value
                  ? "min-h-[44px] shrink-0 rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
                  : "min-h-[44px] shrink-0 rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/60"
              }
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {area === "marketing" && sub === "marketing" && <MarketingPanel me={me} isAdmin={isAdmin} />}
      {area === "marketing" && sub === "portal" && <ClientPortalPanel me={me} isAdmin={isAdmin} />}
      {area === "marketing" && sub === "contenido" && <ContentEnginePanel me={me} isAdmin={isAdmin} />}
      {area === "marketing" && sub === "desarrollo" && <BrandDevelopmentPanel me={me} isAdmin={isAdmin} />}
      {area === "marketing" && sub === "bi" && isAdmin && <BusinessIntelligencePanel me={me} isAdmin={isAdmin} />}
      {(area !== "marketing" || sub === "notas") && notesTasksView}
      {!isAdmin && me && (
        <p className="text-xs text-zinc-400">{tt.business.viewerNote}</p>
      )}
    </div>
    </>
  );
}
