"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type ComplianceCategory, type ComplianceItem, type ComplianceStatus, type MeResponse } from "../lib/api";
import { Panel } from "./Panel";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";

const CATEGORY_LABELS: Record<ComplianceCategory, string> = {
  documentos: "Documentos legales",
  cookies: "Cookies y consentimiento",
  datos: "Protección y gestión de datos",
  transparencia: "Transparencia y prácticas comerciales",
  accesibilidad: "Accesibilidad y contenido",
  negocio: "Información del negocio",
};

const CATEGORY_ORDER: ComplianceCategory[] = [
  "documentos",
  "cookies",
  "datos",
  "transparencia",
  "accesibilidad",
  "negocio",
];

const STATUS_LABELS: Record<ComplianceStatus, string> = {
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  completado: "Completado",
};

function statusCls(s: ComplianceStatus) {
  if (s === "completado") return "bg-emerald-500/15 text-emerald-300";
  if (s === "en_proceso") return "bg-amber-500/15 text-amber-300";
  return "bg-zinc-500/15 text-zinc-300";
}

/** Privacidad y cumplimiento: el centro interno de tareas de privacidad,
 * protección de datos, accesibilidad y cumplimiento del sitio, con las
 * 20 tareas que Rubén definió en 6 grupos. Solo el admin edita; prueba
 * solo lee. Las tareas empiezan pendientes y solo se marcan hechas a
 * mano — aquí nada se da por hecho. Esta sección gestiona tareas: no
 * publica textos legales ni afirma que el sitio ya cumple. */
export function PrivacidadPanel() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [rows, setRows] = useState<ComplianceItem[] | null>(null);
  const [filter, setFilter] = useState<"todas" | ComplianceCategory>("todas");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [category, setCategory] = useState<ComplianceCategory>("documentos");
  const [statusValue, setStatusValue] = useState<ComplianceStatus>("pendiente");
  const [editing, setEditing] = useState<ComplianceItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = !!me?.is_admin;

  const load = useCallback(async () => {
    try {
      setRows(await api.listComplianceItems());
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null));
    load();
  }, [load]);

  const done = useMemo(() => (rows ?? []).filter((r) => r.status === "completado").length, [rows]);
  const total = rows?.length ?? 0;

  const visible = useMemo(() => {
    if (!rows) return null;
    const list = filter === "todas" ? rows : rows.filter((r) => r.category === filter);
    return [...list].sort((a, b) => {
      const ca = CATEGORY_ORDER.indexOf(a.category);
      const cb = CATEGORY_ORDER.indexOf(b.category);
      return ca - cb || a.id - b.id;
    });
  }, [rows, filter]);

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setNotes("");
    setCategory("documentos");
    setStatusValue("pendiente");
    setEditing(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      if (editing) {
        await api.updateComplianceItem(editing.id, { title: title.trim(), description, notes, category, status: statusValue });
        setMsg("Tarea actualizada.");
      } else {
        await api.createComplianceItem({ title: title.trim(), description, notes, category, status: statusValue });
        setMsg("Tarea guardada.");
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  };

  const quickStatus = async (item: ComplianceItem, s: ComplianceStatus) => {
    setError(null);
    try {
      await api.updateComplianceItem(item.id, { status: s });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cambiar el estado.");
    }
  };

  const remove = async (item: ComplianceItem) => {
    if (!window.confirm(`¿Borrar la tarea "${item.title}"?`)) return;
    setError(null);
    try {
      await api.deleteComplianceItem(item.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo borrar.");
    }
  };

  const startEdit = (item: ComplianceItem) => {
    setEditing(item);
    setTitle(item.title);
    setDescription(item.description);
    setNotes(item.notes);
    setCategory(item.category);
    setStatusValue(item.status);
  };

  return (
    <Panel
      title="Privacidad y cumplimiento"
      badge={
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
          {rows === null ? "Cargando…" : `${done} de ${total} completadas`}
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">
        Gestiona la privacidad, la seguridad, la transparencia y el cumplimiento legal del sitio desde una sola sección.
        Las tareas empiezan pendientes y solo se marcan hechas a mano.
        Esta sección gestiona tareas: no publica textos legales ni afirma que el sitio ya cumple; los documentos
        (privacidad, términos, reembolsos, cookies) se redactan y se enlazan en las notas.
        {!isAdmin && " Tu rol de prueba es de solo lectura."}
      </p>

      {isAdmin && (
        <form onSubmit={save} className="space-y-2">
          <input className={inputCls} placeholder="Título de la tarea *" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoComplete="off" />
          <textarea className={inputCls} placeholder="Descripción" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          <textarea className={inputCls} placeholder="Notas (enlaces o texto del documento, cuando exista)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-400">Grupo</span>
              <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value as ComplianceCategory)}>
                {CATEGORY_ORDER.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-400">Estado</span>
              <select className={inputCls} value={statusValue} onChange={(e) => setStatusValue(e.target.value as ComplianceStatus)}>
                <option value="pendiente">Pendiente</option>
                <option value="en_proceso">En proceso</option>
                <option value="completado">Completado</option>
              </select>
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !title.trim()}
              className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy ? "Guardando…" : editing ? "Actualizar tarea" : "Guardar tarea"}
            </button>
            {editing && (
              <button type="button" onClick={resetForm} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
                Cancelar
              </button>
            )}
          </div>
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </form>
      )}

      <div className="mt-4 flex flex-wrap gap-1.5">
        <button
          onClick={() => setFilter("todas")}
          className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === "todas" ? "bg-emerald-600 text-white" : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}
        >
          Todas
        </button>
        {CATEGORY_ORDER.map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === c ? "bg-emerald-600 text-white" : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"}`}
          >
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      <div className="mt-4 border-t border-zinc-800 pt-3">
        {visible === null ? (
          <p className="py-2 text-sm text-zinc-500">Cargando tareas…</p>
        ) : visible.length === 0 ? (
          <p className="py-2 text-sm text-zinc-500">No hay tareas en este grupo.</p>
        ) : (
          <ul className="space-y-3">
            {visible.map((item) => (
              <li key={item.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 text-[11px] font-semibold text-zinc-300">
                    {CATEGORY_LABELS[item.category]}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusCls(item.status)}`}>
                    {STATUS_LABELS[item.status]}
                  </span>
                  <span className="text-sm font-semibold text-zinc-100">{item.title}</span>
                  {isAdmin && (
                    <span className="ml-auto flex flex-wrap gap-2">
                      <select
                        aria-label="Cambiar estado"
                        className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
                        value={item.status}
                        onChange={(e) => quickStatus(item, e.target.value as ComplianceStatus)}
                      >
                        <option value="pendiente">Pendiente</option>
                        <option value="en_proceso">En proceso</option>
                        <option value="completado">Completado</option>
                      </select>
                      <button onClick={() => startEdit(item)} className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800">
                        Editar
                      </button>
                      <button onClick={() => remove(item)} className="rounded-lg border border-red-900/60 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/50">
                        Borrar
                      </button>
                    </span>
                  )}
                </div>
                {item.description && <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{item.description}</p>}
                {item.notes && <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-zinc-500">Notas: {item.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
