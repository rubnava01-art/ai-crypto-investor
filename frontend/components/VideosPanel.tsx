"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type MeResponse } from "../lib/api";
import { ajustadorApi, youtubeVideoId, type VideoEducativo } from "../lib/api/ajustador";
import { Panel } from "./Panel";
import { useLanguage, type Lang } from "../lib/i18n";
import { useCancelled } from "../lib/useLoad";
import { ApiErrorBanner, useConfirm, Field } from "./ui";

const inputCls =
  "w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 transition-colors focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

type SortMode = "newest" | "az";

/** Miniatura real de YouTube a partir del id del enlace (hqdefault):
 * nunca se inventa una imagen — si el enlace no da un id válido, no
 * hay miniatura. */
function thumbnailUrl(videoId: string | null): string | null {
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;
}

function formatAdded(addedAt: string | null, lang: Lang): string | null {
  if (!addedAt) return null;
  const d = new Date(addedAt);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(lang === "en" ? "en-US" : "es-ES", {
    dateStyle: "medium",
  }).format(d);
}

/** Orden por defecto: lo más reciente primero (added_at desc; sin
 * fecha, el id mayor primero). */
function byNewest(a: VideoEducativo, b: VideoEducativo): number {
  const ta = a.added_at ? Date.parse(a.added_at) : 0;
  const tb = b.added_at ? Date.parse(b.added_at) : 0;
  if (tb !== ta) return tb - ta;
  return b.id - a.id;
}

/** Videos de YouTube en Estudiar (2026-11-05, reproductor y
 * organización 2026-11-06): lista gestionada por el administrador
 * (URL + título). Todos leen; solo el admin añade, edita o borra. La
 * lista empieza VACÍA — nunca se inventan URLs, títulos ni canales.
 * El embed usa el reproductor de privacidad mejorada
 * (youtube-nocookie) y el id se extrae con la misma regla que valida
 * el servidor (youtube.com/watch o youtu.be). La organización es
 * solo del lado del cliente, con los campos que ya expone la API
 * (id, url, titulo, added_at): búsqueda por título y orden
 * (más recientes / A–Z). La API no expone categoría ni etiqueta, así
 * que no hay agrupación por categoría. */
export function VideosPanel() {
  const { t, lang } = useLanguage();
  const isCancelled = useCancelled();
  const { confirm, dialog } = useConfirm(t);
  const [me, setMe] = useState<MeResponse | null>(null);
  const isAdmin = !!me?.is_admin;
  const [rows, setRows] = useState<VideoEducativo[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("newest");
  const [url, setUrl] = useState("");
  const [titulo, setTitulo] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await ajustadorApi.listVideos();
      if (isCancelled()) return;
      setRows(data);
      setLoadError(null);
    } catch (e) {
      if (isCancelled()) return;
      setLoadError(e);
    }
  }, [isCancelled]);

  useEffect(() => {
    api.me().then((m) => { if (!isCancelled()) setMe(m); }).catch(() => { if (!isCancelled()) setMe(null); });
    load();
  }, [load, isCancelled]);

  // El video en reproducción: el más reciente al cargar, y si el
  // seleccionado desaparece (borrado), vuelve al más reciente.
  useEffect(() => {
    if (!rows || rows.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId === null || !rows.some((v) => v.id === selectedId)) {
      setSelectedId([...rows].sort(byNewest)[0].id);
    }
  }, [rows, selectedId]);

  const visible = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    const filtered = q
      ? rows.filter((v) => v.titulo.toLowerCase().includes(q))
      : [...rows];
    if (sort === "az") {
      filtered.sort((a, b) => a.titulo.localeCompare(b.titulo, lang === "en" ? "en" : "es"));
    } else {
      filtered.sort(byNewest);
    }
    return filtered;
  }, [rows, search, sort, lang]);

  const selected = rows?.find((v) => v.id === selectedId) ?? null;
  const selectedVideoId = selected ? youtubeVideoId(selected.url) : null;

  const startEdit = (v: VideoEducativo) => {
    setEditingId(v.id);
    setUrl(v.url);
    setTitulo(v.titulo);
    setMsg(null);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setUrl("");
    setTitulo("");
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    const cleanUrl = url.trim();
    const cleanTitulo = titulo.trim();
    if (!youtubeVideoId(cleanUrl)) {
      setError(t.videos.errUrl);
      setBusy(false);
      return;
    }
    try {
      if (editingId !== null) {
        await ajustadorApi.updateVideo(editingId, { url: cleanUrl, titulo: cleanTitulo });
        setMsg(t.videos.msgUpdated);
      } else {
        await ajustadorApi.createVideo({ url: cleanUrl, titulo: cleanTitulo });
        setMsg(t.videos.msgCreated);
      }
      setUrl("");
      setTitulo("");
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.videos.errSave);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (v: VideoEducativo) => {
    if (!(await confirm(t.videos.confirmDelete.replace("{titulo}", v.titulo)))) return;
    setError(null);
    setMsg(null);
    try {
      await ajustadorApi.deleteVideo(v.id);
      setMsg(t.videos.msgDeleted);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.videos.errDelete);
    }
  };

  return (
    <>
      {dialog}
      <Panel
        title={t.videos.sectionTitle}
        badge={
          <span className="shrink-0 whitespace-nowrap rounded-full bg-sky-500/15 px-2.5 py-1 text-xs font-semibold text-sky-400">
            {rows === null ? t.videos.loading : `${rows.length}`}
          </span>
        }
      >
        <p className="mb-4 text-sm leading-relaxed text-zinc-400">{t.videos.sectionIntro}</p>
        {me && !isAdmin && (
          <p className="mb-4 rounded-lg border border-amber-900/60 bg-amber-950/40 px-3 py-2.5 text-sm text-amber-200">
            {t.videos.readOnly}
          </p>
        )}
        {loadError ? <ApiErrorBanner error={loadError} t={t} onRetry={load} /> : null}
        {rows === null ? (
          loadError ? null : <p className="py-4 text-center text-sm text-zinc-400">{t.videos.loading}</p>
        ) : rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-400">{t.videos.empty}</p>
        ) : (
          <>
            {/* Reproductor principal: el video seleccionado, 16:9. */}
            {selected && selectedVideoId ? (
              <div data-no-swipe className="mb-5">
                <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
                  <iframe
                    className="h-full w-full"
                    src={`https://www.youtube-nocookie.com/embed/${selectedVideoId}`}
                    title={t.videos.videoAria.replace("{titulo}", selected.titulo)}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-sky-500/15 px-2.5 py-1 text-xs font-semibold text-sky-400">
                    {t.videos.nowPlaying}
                  </span>
                  <p className="text-sm font-semibold text-zinc-100">{selected.titulo}</p>
                  {formatAdded(selected.added_at, lang) && (
                    <p className="text-xs text-zinc-400">
                      {t.videos.addedOn.replace("{fecha}", formatAdded(selected.added_at, lang) as string)}
                    </p>
                  )}
                </div>
              </div>
            ) : selected ? (
              <p className="mb-5 text-sm text-red-400">{t.videos.errUrl}</p>
            ) : null}

            {/* Búsqueda y orden (solo con los campos de la API). */}
            <div data-no-swipe className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
              <input
                aria-label={t.videos.searchAria}
                className={inputCls}
                placeholder={t.videos.searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                maxLength={200}
                autoComplete="off"
              />
              <label className="flex items-center gap-2 text-sm text-zinc-300">
                <span className="sr-only">{t.videos.sortAria}</span>
                <select
                  aria-label={t.videos.sortAria}
                  className="min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortMode)}
                >
                  <option value="newest">{t.videos.sortNewest}</option>
                  <option value="az">{t.videos.sortAz}</option>
                </select>
              </label>
            </div>

            {/* Lista / cola: tarjetas con miniatura, título y fecha. */}
            {visible.length === 0 ? (
              <p className="py-4 text-center text-sm text-zinc-400">{t.videos.noResults}</p>
            ) : (
              <ul data-no-swipe className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {visible.map((v) => {
                  const videoId = youtubeVideoId(v.url);
                  const thumb = thumbnailUrl(videoId);
                  const isPlaying = v.id === selectedId;
                  const added = formatAdded(v.added_at, lang);
                  return (
                    <li
                      key={v.id}
                      className={`overflow-hidden rounded-xl border bg-zinc-900/60 ${
                        isPlaying ? "border-sky-500/70 ring-1 ring-sky-500/50" : "border-zinc-800"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedId(v.id)}
                        aria-label={t.videos.playAria.replace("{titulo}", v.titulo)}
                        className="block w-full text-left motion-safe:active:scale-[0.99]"
                      >
                        {thumb ? (
                          <img
                            src={thumb}
                            alt={t.videos.thumbnailAlt.replace("{titulo}", v.titulo)}
                            loading="lazy"
                            className="aspect-video w-full object-cover"
                          />
                        ) : (
                          <div className="flex aspect-video w-full items-center justify-center bg-zinc-800 text-sm text-red-400">
                            {t.videos.errUrl}
                          </div>
                        )}
                        <span className="block p-3">
                          <span className="flex items-start justify-between gap-2">
                            <span className="text-sm font-semibold text-zinc-100">{v.titulo}</span>
                            {isPlaying && (
                              <span className="shrink-0 rounded-full bg-sky-500/15 px-2 py-0.5 text-xs font-semibold text-sky-400">
                                {t.videos.nowPlaying}
                              </span>
                            )}
                          </span>
                          {added && (
                            <span className="mt-1 block text-xs text-zinc-400">
                              {t.videos.addedOn.replace("{fecha}", added)}
                            </span>
                          )}
                        </span>
                      </button>
                      {isAdmin && (
                        <span className="flex gap-2 border-t border-zinc-800 px-3 py-2">
                          <button
                            type="button"
                            onClick={() => startEdit(v)}
                            className="min-h-[44px] flex-1 rounded-lg border border-zinc-700 px-3 py-2.5 text-xs text-zinc-200 hover:bg-zinc-800 active:bg-zinc-800 motion-safe:active:scale-[0.98]"
                          >
                            {t.videos.edit}
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(v)}
                            className="min-h-[44px] flex-1 rounded-lg border border-red-900/60 px-3 py-2.5 text-xs text-red-400 hover:bg-red-950/50 active:bg-red-950/70 motion-safe:active:scale-[0.98]"
                          >
                            {t.videos.delete}
                          </button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-3 text-xs text-zinc-500">{t.videos.playlistTitle}: {visible.length}</p>
          </>
        )}
        {isAdmin && (
          <form data-no-swipe onSubmit={submit} className="mt-5 space-y-3 border-t border-zinc-800 pt-5">
            <p className="text-sm font-semibold text-zinc-200">
              {editingId !== null ? t.videos.editTitle : t.videos.addTitle}
            </p>
            <p className="text-xs text-zinc-400">{t.videos.adminHint}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t.videos.urlAria}>
                <input
                  aria-label={t.videos.urlAria}
                  className={inputCls}
                  placeholder={t.videos.urlPlaceholder}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                  maxLength={500}
                  autoComplete="off"
                  inputMode="url"
                />
              </Field>
              <Field label={t.videos.titleAria}>
                <input
                  aria-label={t.videos.titleAria}
                  className={inputCls}
                  placeholder={t.videos.titlePlaceholder}
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  required
                  maxLength={200}
                  autoComplete="off"
                />
              </Field>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="min-h-[44px] flex-1 rounded-lg bg-sky-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 active:bg-sky-500 motion-safe:active:scale-[0.98] disabled:opacity-50">
                {busy ? t.videos.saving : editingId !== null ? t.videos.saveChanges : t.videos.create}
              </button>
              {editingId !== null && (
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={busy}
                  className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-2.5 text-sm text-zinc-200 hover:bg-zinc-800 active:bg-zinc-800 motion-safe:active:scale-[0.98] disabled:opacity-50"
                >
                  {t.videos.cancel}
                </button>
              )}
            </div>
            {msg && <p className="text-sm text-emerald-400">{msg}</p>}
            {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          </form>
        )}
      </Panel>
    </>
  );
}
