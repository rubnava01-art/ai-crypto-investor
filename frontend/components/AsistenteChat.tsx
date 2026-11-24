"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ApiError, getToken, isGuest } from "../lib/api/client";
import { api } from "../lib/api";
import { loginUrl } from "../lib/session";
import { safeHttpHref } from "../lib/urls";
import {
  getCapacidades,
  postChat,
  type AsistenteAccion,
  type AsistenteComando,
  type AsistenteFuente,
} from "../lib/asistente";
import { useLanguage } from "../lib/i18n";
import { PreguntasEnsenar } from "./PreguntasEnsenar";
import { catalogMemo } from "../lib/api/memo";

/**
 * Asistente — chat personalizado dentro de la web.
 * Botón flotante (esquina inferior derecha) + panel de chat, y vista
 * dedicada en /asistente (mismo cuerpo de chat, variante "page").
 * Historial solo en sesión (estado React): nada se persiste en BD.
 * Las respuestas llegan en español desde el backend y se muestran tal cual;
 * si el backend devuelve accion null con texto de solo-lectura (rol prueba),
 * también se muestra tal cual.
 * Tras una acción se muestra la confirmación y se invalida el memo del
 * cliente (P2, 2026-11-23): la lista afectada se vuelve a pedir al
 * visitar el módulo, en vez de mostrar datos viejos hasta recargar.
 */

type ChatMsg = {
  id: number;
  role: "user" | "assistant" | "error";
  text: string;
  accion?: AsistenteAccion | null;
  /** Mensaje original que falló, para el botón de reintento. */
  failedInput?: string;
  /** Fuente externa consultada + fecha (contrato 2026-11-23). */
  fuente?: AsistenteFuente | null;
  consultado_en?: string | null;
  sin_respuesta?: boolean;
  pasos?: string[];
  ruta?: string | null;
};

let nextMsgId = 1;

/** Mapea ApiError.key a una cadena i18n. Nunca se muestra el detalle
 * técnico del backend ni trazas al usuario. */
function errorKeyToString(key: ApiError["key"], t: ReturnType<typeof useLanguage>["t"]): string {
  switch (key) {
    case "network":
      return t.asistente.errNetwork;
    case "timeout":
      return t.asistente.errTimeout;
    case "forbidden":
      return t.asistente.errForbidden;
    case "server":
    case "notFound":
    case "tooManyRequests":
      return t.asistente.errServer;
    default:
      return t.asistente.errGeneric;
  }
}

function ChatIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Una burbuja del historial, memoizada (chat-opt 2026-11-23): cada
 * pulsación en el input re-renderizaba el cuerpo entero y con él
 * todas las burbujas. Las props son estables (el mensaje es el mismo
 * objeto mientras viva en el historial; las etiquetas son strings del
 * diccionario; fmtConsultado/onRetry son useCallback), así que una
 * burbuja ya pintada no se vuelve a pintar al teclear o al llegar un
 * mensaje nuevo. */
type ChatBubbleLabels = {
  noAnswer: string;
  stepsTitle: string;
  goToModule: string;
  actionDone: string;
  consultedAt: string;
  sourceOnly: string;
  retry: string;
};

const ChatBubble = memo(function ChatBubble({
  m,
  labels,
  fmtConsultado,
  onRetry,
}: {
  m: ChatMsg;
  labels: ChatBubbleLabels;
  fmtConsultado: (iso: string | null | undefined) => string | null;
  onRetry: (msg: ChatMsg) => void;
}) {
  return (
    <div className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          m.role === "user"
            ? "rounded-br-md bg-emerald-700 text-white"
            : m.role === "error"
              ? "rounded-bl-md border border-red-800/70 bg-red-500/10 text-red-200"
              : "rounded-bl-md border border-zinc-700 bg-zinc-800 text-zinc-100"
        }`}
      >
        <p className="whitespace-pre-wrap">{m.text}</p>
        {m.role === "assistant" && m.sin_respuesta && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-300">
            {labels.noAnswer}
          </p>
        )}
        {m.role === "assistant" && m.pasos && m.pasos.length > 0 && (
          <div className="mt-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              {labels.stepsTitle}
            </p>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              {m.pasos.map((paso, i) => (
                <li key={i} className="text-sm leading-relaxed text-zinc-200">
                  {paso}
                </li>
              ))}
            </ol>
            {m.ruta && m.ruta.startsWith("/") && (
              <Link
                href={m.ruta}
                className="mt-2 inline-flex min-h-[36px] items-center rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
              >
                {labels.goToModule} →
              </Link>
            )}
          </div>
        )}
        {m.role === "assistant" && m.fuente && (
          <p className="mt-2 text-xs leading-relaxed text-zinc-400">
            {(() => {
              const fecha = fmtConsultado(m.consultado_en);
              const href = safeHttpHref(m.fuente?.url);
              const label = labels.sourceOnly.replace("{nombre}", m.fuente?.nombre ?? "");
              return (
                <>
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-emerald-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                    >
                      {label} ↗
                    </a>
                  ) : (
                    label
                  )}
                  {fecha ? ` · ${labels.consultedAt.replace("{fecha}", fecha)}` : ""}
                </>
              );
            })()}
          </p>
        )}
        {m.accion && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
            <span aria-hidden="true">✓</span>
            {labels.actionDone.replace("{tipo}", m.accion.tipo)}
          </p>
        )}
        {m.role === "error" && m.failedInput && (
          <button
            type="button"
            onClick={() => onRetry(m)}
            className="mt-2 block min-h-[36px] rounded-lg border border-red-400/60 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60"
          >
            {labels.retry}
          </button>
        )}
      </div>
    </div>
  );
});

/** Cuerpo del chat compartido por el panel flotante y la página /asistente. */
function AsistenteChatBody() {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  // Fecha de consulta ("23 nov 2026, 17:58"): el backend manda ISO UTC;
  // si no parsea, no se muestra fecha en vez de inventar una.
  const fmtConsultado = useCallback(
    (iso: string | null | undefined): string | null => {
      if (!iso) return null;
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return null;
      return `${d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}, ${d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`;
    },
    [locale],
  );
  // Etiquetas de la burbuja, estables por idioma: con ellas ChatBubble
  // (memo) no se re-renderiza al teclear.
  const bubbleLabels: ChatBubbleLabels = useMemo(
    () => ({
      noAnswer: t.asistente.noAnswer,
      stepsTitle: t.asistente.stepsTitle,
      goToModule: t.asistente.goToModule,
      actionDone: t.asistente.actionDone,
      consultedAt: t.asistente.consultedAt,
      sourceOnly: t.asistente.sourceOnly,
      retry: t.asistente.retry,
    }),
    [t],
  );
  const [messages, setMessages] = useState<ChatMsg[]>([
    { id: 0, role: "assistant", text: t.asistente.greeting },
  ]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [comandos, setComandos] = useState<AsistenteComando[]>([]);
  const [sugerencias, setSugerencias] = useState<string[]>([]);
  // F3 (2026-11-23): rol para filtrar los chips de creación de admin.
  // Empieza en false (fail-closed, como ModuleNav) hasta que /me confirme.
  const [isAdmin, setIsAdmin] = useState(false);
  const [hasSession, setHasSession] = useState(() => !!getToken());
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);

  // Capacidades (chips de comandos) al montar, solo con sesión.
  // Invitado (Fase 1): sin /me ni capacidades — /me con token de
  // invitado no tiene fila de usuario y un 401 expulsaría la prueba; el
  // invitado nunca es admin y los chips llegan con las respuestas.
  useEffect(() => {
    if (!getToken() || isGuest()) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await getCapacidades();
        if (!cancelled) setComandos(res.comandos ?? []);
      } catch {
        // Sin chips si fallan las capacidades: el chat sigue funcionando.
        if (!cancelled) setComandos([]);
      }
    })();
    // Rol (F3): los chips de creación de admin solo se muestran a admin.
    // Ante error se asume no-admin (fail-closed): el chat sigue
    // funcionando, solo sin esos chips.
    api.me().then((m) => { if (!cancelled) setIsAdmin(!!m.is_admin); }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Autoscroll al fondo con cada mensaje nuevo o al escribir.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing]);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || sendingRef.current) return;
      if (!getToken()) {
        setHasSession(false);
        return;
      }
      sendingRef.current = true;
      setTyping(true);
      setMessages((prev) => [...prev, { id: nextMsgId++, role: "user", text }]);
      setInput("");
      setSugerencias([]);
      try {
        const res = await postChat(text);
        // Refresco de paneles (P2): si el Asistente ejecutó una acción,
        // los catálogos memoizados quedan viejos — se invalidan para que
        // el módulo afectado se vuelva a pedir al visitarlo.
        if (res.accion) catalogMemo.clear();
        setMessages((prev) => [
          ...prev,
          {
            id: nextMsgId++,
            role: "assistant",
            text: res.respuesta,
            accion: res.accion ?? null,
            fuente: res.fuente ?? null,
            consultado_en: res.consultado_en ?? null,
            sin_respuesta: res.sin_respuesta ?? false,
            pasos: res.pasos ?? [],
            ruta: res.ruta ?? null,
          },
        ]);
        setSugerencias(res.sugerencias ?? []);
      } catch (err) {
        // Un 401 con sesión expirada ya redirige al login desde el cliente
        // central; aquí solo queda el resto de fallos, sin trazas técnicas.
        const key = err instanceof ApiError ? err.key : "unknown";
        setMessages((prev) => [
          ...prev,
          { id: nextMsgId++, role: "error", text: errorKeyToString(key, t), failedInput: text },
        ]);
      } finally {
        setTyping(false);
        sendingRef.current = false;
      }
    },
    [t],
  );

  const retry = useCallback(
    (msg: ChatMsg) => {
      if (!msg.failedInput) return;
      setMessages((prev) => prev.filter((m) => m.id !== msg.id));
      void send(msg.failedInput);
    },
    [send],
  );

  // Chips: tras cada respuesta mandan las sugerencias del backend; al
  // inicio, los ejemplos de las capacidades. Un chip rellena el input y
  // pone el foco (no envía solo: evita ejecutar una acción por un toque).
  // F3 (2026-11-23, M5): a prueba NO se le ofrecen los chips de creación
  // de admin (el backend ya los rechaza; la UI no debe prometerlos). Los
  // chips de lectura sensible SE mantienen visibles: la decisión M1 es
  // de Rubén y está pendiente. Las sugerencias del backend son texto
  // libre sin marca de rol, así que las de creación se filtran por el
  // prefijo "Crea " — todos los ejemplos de creación del backend
  // empiezan así y ningún comando de lectura lo hace.
  const chips: { label: string; title?: string; admin?: boolean }[] = (
    sugerencias.length > 0
      ? sugerencias.map((s) => ({ label: s }))
      : comandos
          .filter((c) => isAdmin || !c.requiere_admin)
          .map((c) => ({ label: c.ejemplo, title: c.descripcion, admin: c.requiere_admin }))
  ).filter((c) => isAdmin || !c.label.startsWith("Crea "));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-label={t.asistente.title}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {messages.map((m) => (
          <ChatBubble
            key={m.id}
            m={m}
            labels={bubbleLabels}
            fmtConsultado={fmtConsultado}
            onRetry={retry}
          />
        ))}
        {typing && (
          <div className="flex justify-start">
            <div
              aria-label={t.asistente.typing}
              className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-zinc-700 bg-zinc-800 px-3.5 py-3"
            >
              <span className="sr-only">{t.asistente.typing}</span>
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-zinc-400 motion-safe:animate-bounce" />
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-zinc-400 motion-safe:animate-bounce [animation-delay:150ms]" />
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-zinc-400 motion-safe:animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}
      </div>

      {/* Invitación a registrarse tras 5 mensajes de invitado (Fase 1):
          el chat sigue funcionando, pero guardar el progreso exige cuenta. */}
      {isGuest() && messages.filter((m) => m.role === "user").length >= 5 && (
        <div role="status" className="border-t border-emerald-800/60 bg-emerald-500/10 px-4 py-3">
          <p className="text-sm leading-relaxed text-emerald-200">{t.guest.inviteChat}</p>
          <Link
            href="/login?mode=register"
            className="mt-2 inline-flex min-h-[44px] items-center rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            {t.guest.bannerCta}
          </Link>
        </div>
      )}

      {!hasSession && (
        <div className="border-t border-zinc-800 px-4 py-3">
          <p className="text-sm text-zinc-300">{t.asistente.errLogin}</p>
          <Link
            href={loginUrl(typeof window !== "undefined" ? window.location.pathname : "/asistente")}
            className="mt-2 inline-flex min-h-[44px] items-center rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            {t.asistente.loginCta}
          </Link>
        </div>
      )}

      {chips.length > 0 && hasSession && (
        <div className="border-t border-zinc-800 px-4 pb-1 pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            {t.asistente.suggestionsTitle}
          </p>
          <div className="flex flex-wrap gap-2">
            {chips.map((c) => (
              <button
                key={c.label}
                type="button"
                title={c.title}
                onClick={() => {
                  setInput(c.label);
                  inputRef.current?.focus();
                }}
                className="min-h-[36px] rounded-full border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:border-emerald-600 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
              >
                {c.label}
                {c.admin && (
                  <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                    {t.asistente.adminBadge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2 border-t border-zinc-800 px-4 py-3">
        <input
          ref={inputRef}
          aria-label={t.asistente.inputAria}
          type="text"
          value={input}
          disabled={!hasSession || typing}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send(input);
          }}
          placeholder={t.asistente.inputPlaceholder}
          maxLength={1000}
          className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void send(input)}
          disabled={!hasSession || typing || !input.trim()}
          className="min-h-[44px] shrink-0 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
        >
          {typing ? t.asistente.sending : t.asistente.send}
        </button>
      </div>
    </div>
  );
}

/** Botón flotante + panel de chat. Se monta en el layout raíz; se oculta
 * en /login (pantalla pública) y en /asistente (la vista dedicada ya tiene
 * el chat), y al cliente vinculado (2026-11-23: sin "asistente" en sus
 * módulos, el chat le daría 403). En móvil queda por encima de la barra inferior (bottom-20);
 * en escritorio, bottom-6. z-50 por encima de la nav inferior (z-40). */
export function AsistenteChat() {
  const pathname = usePathname();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  // Corrección 2026-11-23 (QA, opción B): el cliente vinculado ya no
  // tiene "asistente" en sus módulos (Agente 2 lo quita de
  // MODULOS_CLIENTE) y el backend le deniega el chat (403, B1); el FAB
  // no debe abrirle un chat que no puede usar. Mismo GET
  // /api/acceso/perfil que consume ModuleNav. Fail-closed: mientras el
  // perfil no resuelve, el FAB no se muestra; si la petición falla, se
  // asume prueba (mismo fallback que ModuleNav), así admin/prueba
  // quedan como hoy. Sin sesión no hay cliente vinculado posible: se
  // muestra como hoy.
  const [perfil, setPerfil] = useState<"loading" | "admin" | "prueba" | "cliente" | "invitado">(() =>
    getToken() ? "loading" : "prueba",
  );

  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    api
      .getPerfil()
      .then((p) => {
        if (cancelled) return;
        setPerfil(p.role === "super_admin" || p.role === "admin" ? "admin" : p.role);
      })
      .catch(() => {
        if (cancelled) return;
        // Invitado sin perfil (backend aún sin invitado): el FAB se
        // muestra igual; el chat con token invitado es de solo lectura.
        setPerfil(isGuest() ? "invitado" : "prueba");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Focus trap + retorno de foco (P2, 2026-11-23): al abrir, el foco va
  // al input del chat; Tab cicla dentro del panel; al cerrar, el foco
  // vuelve al botón flotante. Escape también cierra.
  const fabRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    panel?.querySelector<HTMLInputElement>("input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      fabRef.current?.focus();
    };
  }, [open ]);

  if (pathname === "/login" || pathname === "/asistente") return null;
  // Cliente vinculado (o perfil aún sin resolver): sin FAB ni panel.
  if (perfil === "loading" || perfil === "cliente") return null;

  return (
    <>
      {open && (
        <section
          ref={panelRef}
          aria-label={t.asistente.title}
          className="fixed inset-x-4 bottom-40 z-50 flex h-[min(70dvh,560px)] flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl sm:inset-x-auto sm:bottom-24 sm:right-6 sm:w-[380px]"
        >
          <header className="flex items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
              <span className="text-emerald-400">
                <ChatIcon size={18} />
              </span>
              {t.asistente.title}
            </h2>
            <div className="flex items-center gap-1">
              <Link
                href="/asistente"
                onClick={() => setOpen(false)}
                className="min-h-[36px] rounded-lg px-2.5 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
              >
                {t.asistente.openFullPage}
              </Link>
              <button
                type="button"
                aria-label={t.asistente.closeAria}
                onClick={() => setOpen(false)}
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
              >
                <span aria-hidden="true" className="text-lg leading-none">×</span>
              </button>
            </div>
          </header>
          <AsistenteChatBody />
        </section>
      )}
      <button
        ref={fabRef}
        type="button"
        aria-label={open ? t.asistente.closeAria : t.asistente.openAria}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-20 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-700 text-white shadow-2xl ring-4 ring-zinc-900/60 transition-transform hover:scale-105 hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 sm:bottom-6 sm:right-6"
      >
        {open ? (
          <span aria-hidden="true" className="text-2xl leading-none">×</span>
        ) : (
          <ChatIcon size={26} />
        )}
      </button>
    </>
  );
}

/** Variante de página completa para /asistente (dentro de ModuleShell).
 * Debajo del chat va la bandeja "Preguntas por enseñar", solo-admin
 * (el componente se oculta solo si no eres admin). */
export function AsistentePanel() {
  return (
    <div className="space-y-4">
      <div className="flex h-[70dvh] min-h-[420px] flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900">
        <AsistenteChatBody />
      </div>
      <PreguntasEnsenar />
    </div>
  );
}
