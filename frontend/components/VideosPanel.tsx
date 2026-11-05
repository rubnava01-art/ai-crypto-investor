"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type MeResponse } from "../lib/api";
import { ajustadorApi, youtubeVideoId, type VideoEducativo } from "../lib/api/ajustador";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";
import { useCancelled } from "../lib/useLoad";
import { ApiErrorBanner, useConfirm, Field } from "./ui";

const inputCls =
  "w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 transition-colors focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60";

/** Videos de YouTube en Estudiar (2026-11-05): lista gestionada por
 * el administrador (URL + título). Todos leen; solo el admin añade o
 * borra. La lista empieza VACÍA — nunca se inventan URLs, títulos ni
 * canales. El embed usa el reproductor de privacidad mejorada
 * (youtube-nocookie) y el id se extrae con la misma regla que valida
 * el servidor (youtube.com/watch o youtu.be); sin metadatos del
 * servidor y sin miniaturas inventadas. */
export function VideosPanel() {
  const { t } = useLanguage();
  const isCancelled = useCancelled();
  const { confirm, dialog } = useConfirm(t);
  const [me, setMe] = useState<MeResponse | null>(null);
  const isAdmin = !!me?.is_admin;
  const [rows, setRows] = useState<VideoEducativo[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [url, setUrl] = useState("");
  const [titulo, setTitulo] = useState("");
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
      await ajustadorApi.createVideo({ url: cleanUrl, titulo: cleanTitulo });
      setMsg(t.videos.msgCreated);
      setUrl("");
      setTitulo("");
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
          <ul className="space-y-4">
            {rows.map((v) => {
              const videoId = youtubeVideoId(v.url);
              return (
                <li key={v.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-zinc-100">{v.titulo}</p>
                    {isAdmin && (
                      <button
                        onClick={() => remove(v)}
                        className="min-h-[44px] shrink-0 rounded-lg border border-red-900/60 px-3 py-2.5 text-xs text-red-400 hover:bg-red-950/50"
                      >
                        {t.videos.delete}
                      </button>
                    )}
                  </div>
                  {videoId ? (
                    <div className="mt-3 aspect-video w-full overflow-hidden rounded-lg bg-black">
                      <iframe
                        className="h-full w-full"
                        src={`https://www.youtube-nocookie.com/embed/${videoId}`}
                        title={t.videos.videoAria.replace("{titulo}", v.titulo)}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                      />
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-red-400">{t.videos.errUrl}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {isAdmin && (
          <form onSubmit={submit} className="mt-5 space-y-3 border-t border-zinc-800 pt-5">
            <p className="text-sm font-semibold text-zinc-200">{t.videos.addTitle}</p>
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
              <button type="submit" disabled={busy} className="min-h-[44px] flex-1 rounded-lg bg-sky-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
                {busy ? t.videos.saving : t.videos.create}
              </button>
            </div>
            {msg && <p className="text-sm text-emerald-400">{msg}</p>}
            {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          </form>
        )}
      </Panel>
    </>
  );
}
