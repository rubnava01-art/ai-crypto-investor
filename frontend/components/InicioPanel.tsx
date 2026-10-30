"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type HomeComment, type HomePost, type MeResponse } from "../lib/api";
import { useLanguage } from "../lib/i18n";
import { Panel } from "./Panel";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";

/** Inicio: noticias y actualizaciones de la plataforma como posts, con
 * comentarios. La lista empieza VACÍA — aquí nada se inventa. Solo el
 * administrador publica y edita posts; cualquier usuario autenticado
 * comenta, y borra solo sus propios comentarios (el admin, cualquiera). */
export function InicioPanel() {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const [me, setMe] = useState<MeResponse | null>(null);
  const [posts, setPosts] = useState<HomePost[] | null>(null);
  const [comments, setComments] = useState<Record<number, HomeComment[]>>({});
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<HomePost | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = !!me?.is_admin;

  const load = useCallback(async () => {
    try {
      setPosts(await api.listHomePosts());
    } catch {
      setPosts([]);
    }
  }, []);

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null));
    load();
  }, [load]);

  const loadComments = useCallback(async (postId: number) => {
    try {
      const rows = await api.listHomeComments(postId);
      setComments((prev) => ({ ...prev, [postId]: rows }));
    } catch {
      setComments((prev) => ({ ...prev, [postId]: [] }));
    }
  }, []);

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
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.inicio.saveError);
    } finally {
      setBusy(false);
    }
  };

  const removePost = async (p: HomePost) => {
    if (!window.confirm(t.inicio.deletePostConfirm.replace("{nombre}", p.title))) return;
    setError(null);
    try {
      await api.deleteHomePost(p.id);
      await load();
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
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.inicio.commentError);
    }
  };

  const removeComment = async (postId: number, c: HomeComment) => {
    if (!window.confirm(t.inicio.deleteCommentConfirm)) return;
    setError(null);
    try {
      await api.deleteHomeComment(c.id);
      await loadComments(postId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.inicio.deleteCommentError);
    }
  };

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) : "";

  return (
    <Panel
      title={t.inicio.title}
      badge={
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
          {posts === null ? t.inicio.loading : t.inicio.postsCount.replace("{nombre}", String(posts.length))}
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">
        {t.inicio.intro}
      </p>

      {isAdmin && (
        <form onSubmit={savePost} className="space-y-2">
          <input aria-label={t.inicio.titleAria} className={inputCls} placeholder={t.inicio.titlePlaceholder} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoComplete="off" />
          <textarea aria-label={t.inicio.bodyAria} className={inputCls} placeholder={t.inicio.bodyPlaceholder} value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !title.trim()}
              className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy ? t.inicio.saving : editing ? t.inicio.updatePost : t.inicio.publishNews}
            </button>
            {editing && (
              <button type="button" onClick={resetForm} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
                {t.inicio.cancel}
              </button>
            )}
          </div>
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        </form>
      )}

      <div className="mt-4 border-t border-zinc-800 pt-3">
        {posts === null ? (
          <p className="py-2 text-sm text-zinc-500">{t.inicio.loadingPosts}</p>
        ) : posts.length === 0 ? (
          <p className="py-2 text-sm text-zinc-500">
            {t.inicio.emptyPosts}
          </p>
        ) : (
          <ul className="space-y-4">
            {posts.map((p) => {
              const open = expanded.has(p.id);
              const rows = comments[p.id];
              return (
                <li key={p.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold text-zinc-100">{p.title}</span>
                    {isAdmin && (
                      <span className="ml-auto flex gap-2">
                        <button
                          onClick={() => { setEditing(p); setTitle(p.title); setBody(p.body); }}
                          className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                        >
                          {t.inicio.edit}
                        </button>
                        <button
                          onClick={() => removePost(p)}
                          className="rounded-lg border border-red-900/60 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/50"
                        >
                          {t.inicio.delete}
                        </button>
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {t.inicio.by.replace("{nombre}", p.author_name)}
                    {p.author_username ? ` (@${p.author_username})` : ""} · {fmtDate(p.created_at)}
                  </p>
                  {p.body && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{p.body}</p>}
                  <button
                    onClick={() => toggleComments(p.id)}
                    className="mt-3 text-sm font-semibold text-emerald-400 hover:underline"
                  >
                    {open ? t.inicio.hideComments : t.inicio.commentsCount.replace("{nombre}", String(p.comment_count))}
                  </button>
                  {open && (
                    <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
                      {rows === undefined ? (
                        <p className="text-sm text-zinc-500">{t.inicio.loadingComments}</p>
                      ) : rows.length === 0 ? (
                        <p className="text-sm text-zinc-500">{t.inicio.firstComment}</p>
                      ) : (
                        <ul className="space-y-2">
                          {rows.map((c) => (
                            <li key={c.id} className="rounded-lg bg-zinc-900 p-3">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-zinc-200">{c.author_name}</span>
                                {c.author_username && (
                                  <span className="text-xs text-zinc-500">@{c.author_username}</span>
                                )}
                                <span className="text-xs text-zinc-500">{fmtDate(c.created_at)}</span>
                                {c.can_delete && (
                                  <button
                                    onClick={() => removeComment(p.id, c)}
                                    className="ml-auto text-xs font-semibold text-red-400 hover:underline"
                                  >
                                    {t.inicio.delete}
                                  </button>
                                )}
                              </div>
                              <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-300">{c.body}</p>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="flex gap-2">
                        <input aria-label={t.inicio.commentAria}
                          className={inputCls}
                          placeholder={t.inicio.commentPlaceholder}
                          value={drafts[p.id] ?? ""}
                          onChange={(e) => setDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                          maxLength={1000}
                          autoComplete="off"
                        />
                        <button
                          onClick={() => sendComment(p.id)}
                          disabled={!(drafts[p.id] ?? "").trim()}
                          className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
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
  );
}
