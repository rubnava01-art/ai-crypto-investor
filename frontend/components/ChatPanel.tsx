"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type ChatMessage, type MeResponse } from "../lib/api";
import { Panel } from "./Panel";
import { useLanguage } from "../lib/i18n";
import { ApiErrorBanner, LoadMore, useConfirm } from "./ui";
import { useCancelled } from "../lib/useLoad";

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-2 focus-visible:ring-emerald-500/40";

/** Chat en vivo: mensajes cortos para usuarios autenticados. El panel
 * consulta cada ~5s (sin WebSocket en el tier gratuito) y se salta la
 * consulta con la pestaña oculta. Empieza vacío; solo el admin borra
 * (moderación). Prueba puede leer y escribir. */
export function ChatPanel() {
  const isCancelled = useCancelled();
  const { t, lang } = useLanguage();
  const { confirm, dialog } = useConfirm(t);
  const locale = lang === "en" ? "en-US" : "es-MX";
  const [me, setMe] = useState<MeResponse | null>(null);
  const [rows, setRows] = useState<ChatMessage[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tri-estado parcial (Fase 4, FE3): un fallo de carga ya no se ve como
  // "chat vacío" — se conservan los mensajes y se muestra el banner con
  // reintento. El sondeo silencioso (5s) no muestra banner para no
  // spamear: solo conserva lo anterior.
  const [loadError, setLoadError] = useState<unknown>(null);
  // Render incremental en cliente (Fase 4, FE10): el backend no pagina el
  // chat, así que se muestran los últimos 50 y "cargar más" revela el
  // historial anterior sin pedir nada nuevo.
  const [visibleCount, setVisibleCount] = useState(50);
  const bottomRef = useRef<HTMLDivElement>(null);
  const firstLoad = useRef(true);

  const load = useCallback(async (silent: boolean) => {
    try {
      const data = await api.listChatMessages();
      if (isCancelled()) return;
      setRows(data);
      setLoadError(null);
      if (!silent) {
        requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
      }
    } catch (e) {
      if (isCancelled()) return;
      if (!silent) setLoadError(e);
    }
  }, [isCancelled]);

  useEffect(() => {
    api.me().then((v) => { if (!isCancelled()) setMe(v); }).catch(() => { if (!isCancelled()) setMe(null); });
  }, []);

  useEffect(() => {
    load(false).then(() => { firstLoad.current = false; });
    const t = setInterval(() => {
      if (document.hidden) return;
      load(true);
    }, 5000);
    return () => clearInterval(t);
  }, [load]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const msg = text.trim();
    if (!msg) return;
    setBusy(true);
    setError(null);
    try {
      await api.postChatMessage({ text: msg });
      setText("");
      await load(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.chat.errSend);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m: ChatMessage) => {
    if (!(await confirm(t.chat.confirmDelete.replace("{autor}", m.author_label)))) return;
    setError(null);
    try {
      await api.deleteChatMessage(m.id);
      await load(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.chat.errDelete);
    }
  };

  const isAdmin = !!me?.is_admin;
  const fmtTime = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
      : "";

  return (
    <>
      {dialog}
    <Panel
      title={t.chat.panelTitle}
      badge={
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
          {rows === null ? t.chat.badgeLoading : `${rows.length} ${t.chat.messagesWord}`}
        </span>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-zinc-400">
        {t.chat.intro}
      </p>
      {loadError ? <ApiErrorBanner error={loadError} t={t} onRetry={() => load(false)} /> : null}

      <div className="mb-3 max-h-[420px] space-y-3 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        {rows === null ? (
          <p className="py-2 text-sm text-zinc-400">{t.chat.loadingMessages}</p>
        ) : rows.length === 0 ? (
          <p className="py-2 text-sm text-zinc-400">
            {t.chat.emptyChat}
          </p>
        ) : (
          rows.slice(-visibleCount).map((m) => {
            const mine = me?.username === m.author_username;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] sm:max-w-[75%] sm:max-w-[75%] rounded-2xl px-3.5 py-2 ${
                    mine ? "rounded-br-sm bg-emerald-600/90 text-white" : "rounded-bl-sm bg-zinc-800 text-zinc-100"
                  }`}
                >
                  <p className="text-[11px] font-semibold opacity-80">
                    {m.author_label} <span className="font-normal opacity-70">@{m.author_username}</span>
                    <span className="ml-2 font-normal opacity-70">{fmtTime(m.created_at)}</span>
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.text}</p>
                  {isAdmin && (
                    <button
                      onClick={() => remove(m)}
                      className="mt-1 inline-block py-1 text-xs font-semibold text-red-300 hover:underline"
                    >
                      {t.chat.deleteBtn}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
      {rows !== null && rows.length > visibleCount && (
        <LoadMore
          visible={visibleCount}
          total={rows.length}
          t={t}
          onLoadMore={() => setVisibleCount((v) => v + 50)}
        />
      )}

      <form onSubmit={send} className="flex gap-2">
        <input aria-label={t.chat.inputAria}
          className={inputCls}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.chat.inputPlaceholder}
          maxLength={500}
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="shrink-0 rounded-lg bg-emerald-600 min-h-[44px] px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-50"
        >
          {busy ? t.chat.sendBusy : t.chat.send}
        </button>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
    </Panel>
    </>
  );
}
