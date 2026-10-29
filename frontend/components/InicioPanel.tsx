"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type HomeComment, type HomePost, type MeResponse } from "../lib/api";
import { Panel } from "./Panel";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none";

/** Inicio: noticias y actualizaciones de la plataforma como posts, con
 * comentarios. La lista empieza VACÍA — aquí nada se inventa. Solo el
 * administrador publica y edita posts; cualquier usuario autenticado
 * comenta, y borra solo sus propios comentarios (el admin, cualquiera). */
export function InicioPanel() {
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
        setMsg("Publicación actualizada.");
      } else {
        await api.createHomePost({ title: title.trim(), body });
        setMsg("Publicación guardada.");
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  };

  const removePost = async (p: HomePost) => {
    if (!window.confirm(`¿Borrar la publicación "${p.title}" y sus comentarios?`)) return;
    setError(null);
    try {
      await api.deleteHomePost(p.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo borrar.");
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
      setError(err instanceof ApiError ? err.message : "No se pudo comentar.");
    }
  };

  const removeComment = async (postId: number, c: HomeComment) => {
    if (!window.confirm("¿Borrar este comentario?")) return;
    setError(null);
    try {
      await api.deleteHomeComment(c.id);
      await loadComments(postId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo borrar el comentario.");
    }
  };

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "";

  return (
    <Panel
      title="Inicio"
      badge={
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
          {posts === null ? "Cargando…" : `${posts.length} publicaciones`}
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-zinc-500">
        Noticias y actualizaciones de la plataforma. Solo el administrador las publica.
        Cualquier usuario puede comentar.
      </p>

      {isAdmin && (
        <form onSubmit={savePost} className="space-y-2">
          <input className={inputCls} placeholder="Título de la noticia *" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoComplete="off" />
          <textarea className={inputCls} placeholder="Texto de la publicación" value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !title.trim()}
              className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy ? "Guardando…" : editing ? "Actualizar publicación" : "Publicar noticia"}
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

      <div className="mt-4 border-t border-zinc-800 pt-3">
        {posts === null ? (
          <p className="py-2 text-sm text-zinc-500">Cargando publicaciones…</p>
        ) : posts.length === 0 ? (
          <p className="py-2 text-sm text-zinc-500">
            Todavía no hay noticias publicadas. El administrador publica la primera
            actualización desde esta misma pestaña.
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
                          Editar
                        </button>
                        <button
                          onClick={() => removePost(p)}
                          className="rounded-lg border border-red-900/60 px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/50"
                        >
                          Borrar
                        </button>
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    Por {p.author_name} · {fmtDate(p.created_at)}
                  </p>
                  {p.body && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{p.body}</p>}
                  <button
                    onClick={() => toggleComments(p.id)}
                    className="mt-3 text-sm font-semibold text-emerald-400 hover:underline"
                  >
                    {open ? "Ocultar comentarios" : `Comentarios (${p.comment_count})`}
                  </button>
                  {open && (
                    <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
                      {rows === undefined ? (
                        <p className="text-sm text-zinc-500">Cargando comentarios…</p>
                      ) : rows.length === 0 ? (
                        <p className="text-sm text-zinc-500">Sé el primero en comentar.</p>
                      ) : (
                        <ul className="space-y-2">
                          {rows.map((c) => (
                            <li key={c.id} className="rounded-lg bg-zinc-900 p-3">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-zinc-200">{c.author_name}</span>
                                <span className="text-xs text-zinc-500">{fmtDate(c.created_at)}</span>
                                {c.can_delete && (
                                  <button
                                    onClick={() => removeComment(p.id, c)}
                                    className="ml-auto text-xs font-semibold text-red-400 hover:underline"
                                  >
                                    Borrar
                                  </button>
                                )}
                              </div>
                              <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-300">{c.body}</p>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="flex gap-2">
                        <input
                          className={inputCls}
                          placeholder="Escribe un comentario…"
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
                          Comentar
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
