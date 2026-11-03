"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type HomeComment, type HomePost, type MeResponse } from "../lib/api";
import { useLanguage } from "../lib/i18n";
import { novedadesOrdenadas, type NovedadSistema } from "../lib/novedades";
import { Panel } from "./Panel";
import { useAsyncLoad, useCancelled } from "../lib/useLoad";
import { ApiErrorBanner, LoadMore, useConfirm, Field } from "./ui";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950";

/** Inicio: noticias y actualizaciones de la plataforma como posts, con
 * comentarios. La lista de posts del administrador empieza VACÍA — aquí
 * nada se inventa. Solo el administrador publica y edita posts; cualquier
 * usuario autenticado comenta, y borra solo sus propios comentarios
 * (el admin, cualquiera). ADEMÁS, la lista mezcla tarjetas del sistema
 * (lib/novedades.ts): avances reales de la app que viajan dentro del
 * frontend publicado, sin autor, sin comentarios y sin botones de
 * editar/borrar — nunca se atribuyen al administrador ni al dueño. */
export function InicioPanel() {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const [me, setMe] = useState<MeResponse | null>(null);
  // Tri-estado (Fase 4, FE3/FE2): posts con useAsyncLoad — al desmontar se
  // aborta el fetch y un error ya no se mapea a [] (antes parecía "sin
  // noticias"). La lista anterior se conserva y el banner explica el fallo.
  const postsLoad = useAsyncLoad<HomePost[]>((signal) => api.listHomePosts({ signal }), []);
  const posts = postsLoad.data;
  const postsError = postsLoad.error;
  const [comments, setComments] = useState<Record<number, HomeComment[]>>({});
  const [commentsError, setCommentsError] = useState<Record<number, unknown>>({});
  // Render incremental en cliente (Fase 4, FE10): el backend no pagina
  // comentarios, así que se muestran los primeros 20 y "cargar más" revela
  // el resto sin pedir nada nuevo (parámetro limit = seguimiento backend).
  const [commentsVisible, setCommentsVisible] = useState<Record<number, number>>({});
  const isCancelled = useCancelled();
  const { confirm, dialog } = useConfirm(t);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<HomePost | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = !!me?.is_admin;

  useEffect(() => {
    api.me().then((m) => { if (!isCancelled()) setMe(m); }).catch(() => { if (!isCancelled()) setMe(null); });
  }, [isCancelled]);

  const loadComments = useCallback(async (postId: number) => {
    try {
      const rows = await api.listHomeComments(postId);
      if (isCancelled()) return;
      setComments((prev) => ({ ...prev, [postId]: rows }));
      setCommentsError((prev) => ({ ...prev, [postId]: null }));
    } catch (e) {
      if (isCancelled()) return;
      // No vaciar comentarios previos ante un fallo: banner y reintento.
      setCommentsError((prev) => ({ ...prev, [postId]: e }));
    }
  }, [isCancelled]);

  const toggleComments = (postId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) {
        next.delete(postId);
      } else {
        next.add(postId);
        loadComments(postId);
      }
      return next;
    });
  };

  const resetForm = () => {
    setTitle("");
    setBody("");
    setEditing(null);
  };

  const savePost = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      if (editing) {
        await api.updateHomePost(editing.id, { title: title.trim(), body });
        setMsg(t.inicio.updated);
      } else {
        await api.createHomePost({ title: title.trim(), body });
        setMsg(t.inicio.saved);
      }
      resetForm();
      postsLoad.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.inicio.saveError);
    } finally {
      setBusy(false);
    }
  };

  const removePost = async (p: HomePost) => {
    if (!(await confirm(t.inicio.deletePostConfirm.replace("{nombre}", p.title)))) return;
    setError(null);
    try {
      await api.deleteHomePost(p.id);
      postsLoad.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.inicio.deleteError);
    }
  };

  const sendComment = async (postId: number) => {
    const text = (drafts[postId] ?? "").trim();
    if (!text) return;
    setError(null);
    try {
      await api.createHomeComment(postId, { body: text });
      setDrafts((prev) => ({ ...prev, [postId]: "" }));
      await loadComments(postId);
      postsLoad.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.inicio.commentError);
    }
  };

  const removeComment = async (postId: number, c: HomeComment) => {
    if (!(await confirm(t.inicio.deleteCommentConfirm))) return;
    setError(null);
    try {
      await api.deleteHomeComment(c.id);
      await loadComments(postId);
      postsLoad.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.inicio.deleteCommentError);
    }
  };

  const fmtDate = (iso: string | null) => {
    if (!iso) return "";
    // Fecha sola (AAAA-MM-DD, como las novedades del sistema): construirla
    // en hora local para que no se corra un día por la zona horaria.
    const soloFecha = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    const d = soloFecha
      ? new Date(Number(soloFecha[1]), Number(soloFecha[2]) - 1, Number(soloFecha[3]))
      : new Date(iso);
    return d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  };

  // Lista mezclada: posts del administrador + novedades del sistema, de
  // lo más reciente a lo más antiguo. Si el arreglo del sistema está
  // vacío, no aparece ninguna sección del sistema.
  type ItemLista =
    | { kind: "admin"; post: HomePost }
    | { kind: "system"; entry: NovedadSistema };
  const items: ItemLista[] = [
    ...(posts ?? []).map((p): ItemLista => ({ kind: "admin", post: p })),
    ...novedadesOrdenadas().map((entry): ItemLista => ({ kind: "system", entry })),
  ].sort((a, b) => {
    const fa = a.kind === "admin" ? a.post.created_at ?? "" : a.entry.date;
    const fb = b.kind === "admin" ? b.post.created_at ?? "" : b.entry.date;
    return fa < fb ? 1 : fa > fb ? -1 : 0;
  });

  return (
    <>
      {dialog}
    <Panel
      title={t.inicio.title}
      badge={
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
          {posts === null && !postsError ? t.inicio.loading : t.inicio.postsCount.replace("{nombre}", String(items.length))}
        </span>
      }
    >
      <p className="mb-4 text-sm leading-relaxed text-zinc-400">
        {t.inicio.intro}
      </p>

      {/* Avance de la plataforma: línea de tiempo con las novedades
          reales del sistema (lib/novedades.ts), de lo más reciente a
          lo más antiguo. Si no hay ninguna, no se muestra nada: sin
          texto de relleno ni avance inventado, y sin porcentajes. */}
      {(() => {
        const avances = novedadesOrdenadas();
        if (avances.length === 0) return null;
        return (
          <section aria-label={t.inicio.progressTitle} className="mb-5 rounded-lg border border-emerald-900/60 bg-zinc-950 p-4 shadow-sm sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-zinc-100">{t.inicio.progressTitle}</h2>
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                {t.inicio.progressCount.replace("{nombre}", String(avances.length))}
              </span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-zinc-400">{t.inicio.progressIntro}</p>
            <ol className="mt-3 space-y-3 border-l-2 border-emerald-900/60 pl-4">
              {avances.map((n) => (
                <li key={`avance-${n.date}-${n.title}`}>
                  <p className="text-xs text-zinc-500">{fmtDate(n.date)}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm font-semibold text-zinc-100">
                    {n.title}
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                      {t.inicio.systemNews}
                    </span>
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{n.body}</p>
                </li>
              ))}
            </ol>
          </section>
        );
      })()}

      {isAdmin && (
        <form onSubmit={savePost} className="space-y-3">
          <Field label={t.inicio.titleAria}><input aria-label={t.inicio.titleAria} className={inputCls} placeholder={t.inicio.titlePlaceholder} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoComplete="off" /></Field>
          <Field label={t.inicio.bodyAria}><textarea aria-label={t.inicio.bodyAria} className={inputCls} placeholder={t.inicio.bodyPlaceholder} value={body} onChange={(e) => setBody(e.target.value)} rows={3} /></Field>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !title.trim()}
              className="min-h-[44px] flex-1 rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? t.inicio.saving : editing ? t.inicio.updatePost : t.inicio.publishNews}
            </button>
            {editing && (
              <button type="button" onClick={resetForm} className="min-h-[44px] rounded-lg border border-zinc-700 px-4 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950">
                {t.inicio.cancel}
              </button>
            )}
          </div>
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </form>
      )}

      {postsError ? <ApiErrorBanner error={postsError} t={t} onRetry={postsLoad.reload} /> : null}
      <div className="mt-4 border-t border-zinc-800 pt-3">
        {posts === null && !postsError ? (
          <p className="py-2 text-sm text-zinc-500">{t.inicio.loadingPosts}</p>
        ) : items.length === 0 ? (
          <p className="py-2 text-sm text-zinc-500">
            {t.inicio.emptyPosts}
          </p>
        ) : (
          <ul className="space-y-4">
            {items.map((item) => {
              if (item.kind === "system") {
                const n = item.entry;
                return (
                  <li key={`sistema-${n.date}-${n.title}`} className="rounded-lg border border-emerald-900/60 bg-zinc-950 p-4 shadow-sm sm:p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-lg font-semibold leading-snug text-zinc-100">{n.title}</span>
                      <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                        {t.inicio.systemNews}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-400">{fmtDate(n.date)}</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{n.body}</p>
                  </li>
                );
              }
              const p = item.post;
              const open = expanded.has(p.id);
              const rows = comments[p.id];
              return (
                <li key={p.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 shadow-sm sm:p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-semibold leading-snug text-zinc-100">{p.title}</span>
                    {isAdmin && (
                      <span className="ml-auto flex gap-2">
                        <button
                          onClick={() => { setEditing(p); setTitle(p.title); setBody(p.body); }}
                          className="min-h-[44px] rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                        >
                          {t.inicio.edit}
                        </button>
                        <button
                          onClick={() => removePost(p)}
                          className="min-h-[44px] rounded-lg border border-red-900/60 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-950/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                        >
                          {t.inicio.delete}
                        </button>
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-zinc-400">
                    {t.inicio.by.replace("{nombre}", p.author_name)}
                    {p.author_username ? ` (@${p.author_username})` : ""} · {fmtDate(p.created_at)}
                  </p>
                  {p.body && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{p.body}</p>}
                  <button
                    onClick={() => toggleComments(p.id)}
                    className="mt-3 min-h-[44px] rounded-lg px-1 py-2 text-sm font-semibold text-emerald-400 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                  >
                    {open ? t.inicio.hideComments : t.inicio.commentsCount.replace("{nombre}", String(p.comment_count))}
                  </button>
                  {open && (
                    <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
                      {commentsError[p.id] ? (
                        <ApiErrorBanner error={commentsError[p.id]} t={t} onRetry={() => loadComments(p.id)} />
                      ) : null}
                      {rows === undefined ? (
                        <p className="text-sm text-zinc-500">{t.inicio.loadingComments}</p>
                      ) : rows.length === 0 ? (
                        <p className="text-sm text-zinc-500">{t.inicio.firstComment}</p>
                      ) : (
                        <>
                        <ul className="space-y-2">
                          {rows.slice(0, commentsVisible[p.id] ?? 20).map((c) => (
                            <li key={c.id} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3.5">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-zinc-200">{c.author_name}</span>
                                {c.author_username && (
                                  <span className="text-xs text-zinc-500">@{c.author_username}</span>
                                )}
                                <span className="text-xs text-zinc-500">{fmtDate(c.created_at)}</span>
                                {c.can_delete && (
                                  <button
                                    onClick={() => removeComment(p.id, c)}
                                    className="ml-auto min-h-[44px] rounded-lg px-2 py-1.5 text-xs font-semibold text-red-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                                  >
                                    {t.inicio.delete}
                                  </button>
                                )}
                              </div>
                              <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-300">{c.body}</p>
                            </li>
                          ))}
                        </ul>
                        <LoadMore
                          visible={commentsVisible[p.id] ?? 20}
                          total={rows.length}
                          t={t}
                          onLoadMore={() =>
                            setCommentsVisible((prev) => ({ ...prev, [p.id]: (prev[p.id] ?? 20) + 20 }))
                          }
                        />
                        </>
                      )}
                      <div className="flex gap-2">
                        <Field label={t.inicio.commentAria} className="flex-1"><input aria-label={t.inicio.commentAria}
                          className={inputCls}
                          placeholder={t.inicio.commentPlaceholder}
                          value={drafts[p.id] ?? ""}
                          onChange={(e) => setDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                          maxLength={1000}
                          autoComplete="off"
                        /></Field>
                        <button
                          onClick={() => sendComment(p.id)}
                          disabled={!(drafts[p.id] ?? "").trim()}
                          className="min-h-[44px] shrink-0 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {t.inicio.comment}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
    </>
  );
}
