"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type MeResponse, type Recommendation, type RecommendationCategory } from "../lib/api";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";

/** Recomendaciones: el admin recomienda cursos de Estudiar y herramientas
 * de Crear. La lista empieza VACÍA — aquí nada se inventa. Prueba solo
 * lee. */
export function RecomendacionesPanel() {
  const { t } = useLanguage();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [rows, setRows] = useState<Recommendation[] | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState<RecommendationCategory>("curso");
  const [editing, setEditing] = useState<Recommendation | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = !!me?.is_admin;

  const load = useCallback(async () => {
    try {
      setRows(await api.listRecommendations());
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null));
    load();
  }, [load]);

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setUrl("");
    setCategory("curso");
    setEditing(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      if (editing) {
        await api.updateRecommendation(editing.id, { title: title.trim(), description, url, category });
        setMsg(t.recomendaciones.msgUpdated);
      } else {
        await api.createRecommendation({ title: title.trim(), description, url, category });
        setMsg(t.recomendaciones.msgSaved);
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.recomendaciones.errSave);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: Recommendation) => {
    if (!window.confirm(t.recomendaciones.confirmDelete.replace("{titulo}", r.title))) return;
    setError(null);
    try {
      await api.deleteRecommendation(r.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.recomendaciones.errDelete);
    }
  };

  const startEdit = (r: Recommendation) => {
    setEditing(r);
    setTitle(r.title);
    setDescription(r.description);
    setUrl(r.url);
    setCategory(r.category);
  };

  return (
    <Panel
      title={t.recomendaciones.panelTitle}
      badge={
        <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-300">
          {rows === null ? t.recomendaciones.badgeLoading : `${rows.length} ${t.recomendaciones.recsWord}`}
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">
        {t.recomendaciones.intro}
        {!isAdmin && t.recomendaciones.readonly}
      </p>

      {isAdmin && (
        <form onSubmit={save} className="space-y-2">
          <input aria-label={t.recomendaciones.titleAria} className={inputCls} placeholder={t.recomendaciones.titlePlaceholder} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoComplete="off" />
          <textarea aria-label={t.recomendaciones.descAria} className={inputCls} placeholder={t.recomendaciones.descPlaceholder} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          <input aria-label={t.recomendaciones.urlAria} className={inputCls} placeholder={t.recomendaciones.urlPlaceholder} value={url} onChange={(e) => setUrl(e.target.value)} autoComplete="off" />
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-400">{t.recomendaciones.categoryLabel}</span>
            <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value as RecommendationCategory)}>
              <option value="curso">{t.recomendaciones.catCourse}</option>
              <option value="herramienta">{t.recomendaciones.catTool}</option>
            </select>
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !title.trim()}
              className="flex-1 rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
            >
              {busy ? t.recomendaciones.saveBusy : editing ? t.recomendaciones.update : t.recomendaciones.publish}
            </button>
            {editing && (
              <button type="button" onClick={resetForm} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
                {t.recomendaciones.cancelBtn}
              </button>
            )}
          </div>
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </form>
      )}

      <div className="mt-4 border-t border-zinc-800 pt-3">
        {rows === null ? (
          <p className="py-2 text-sm text-zinc-500">{t.recomendaciones.loadingRecs}</p>
        ) : rows.length === 0 ? (
          <p className="py-2 text-sm text-zinc-500">
            {t.recomendaciones.emptyRecs}
          </p>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.category === "curso" ? "bg-emerald-500/15 text-emerald-300" : "bg-violet-500/15 text-violet-300"}`}>
                    {r.category === "curso" ? t.recomendaciones.catCourse : t.recomendaciones.catTool}
                  </span>
                  <span className="text-sm font-semibold text-zinc-100">{r.title}</span>
                  {isAdmin && (
                    <span className="ml-auto flex gap-2">
                      <button onClick={() => startEdit(r)} className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800">
                        {t.recomendaciones.editBtn}
                      </button>
                      <button onClick={() => remove(r)} className="rounded-lg border border-red-900/60 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/50">
                        {t.recomendaciones.deleteBtn}
                      </button>
                    </span>
                  )}
                </div>
                {r.description && <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{r.description}</p>}
                {r.url && (
                  <a href={r.url} target="_blank" rel="noreferrer" className="mt-1.5 block truncate text-sm font-medium text-emerald-400 hover:underline">
                    {r.url} ↗
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
