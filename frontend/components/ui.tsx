// Componentes compartidos (Fase 4, FE6/FE13/F10): este es el ui.tsx que la
// Fase 5 consumirá — no duplicar estos patrones en otro archivo.
// - Button: objetivo táctil 44px compartido (el pase PRO tuvo que aplicarse
//   ~25 veces porque no existía); la migración de botones existentes a este
//   componente es trabajo de la Fase 5, no de esta fase.
// - Input: campo con el patrón de anillo de foco del proyecto.
// - Money / DateText: render con lib/format.ts, sin formateadores locales.
// - ConfirmDialog + useConfirm + ConfirmButton: reemplazo de window.confirm
//   (22 sitios): diálogo con estilo, accesible (role=dialog, Escape) y que
//   no bloquea la pestaña.
// - ApiErrorBanner: banner de error con el patrón del dashboard (role=alert),
//   texto mapeado a i18n por estatus y detalle crudo solo en <details>.
// - LoadMore: botón "cargar más" para render incremental en cliente.
// - copyTextWithFallback / newId: fallbacks de portapapeles y UUID (FE14).
"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../lib/api";
import type { Dictionary } from "../lib/i18n";
import { formatDate, formatMoney } from "../lib/format";

// ---------- Button / Input ----------

const btnBase =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 disabled:opacity-50";

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
}) {
  const tone =
    variant === "primary"
      ? "bg-emerald-600 text-white hover:bg-emerald-500"
      : variant === "danger"
        ? "bg-red-700 text-white hover:bg-red-600"
        : "border border-zinc-700 text-zinc-200 hover:bg-zinc-800";
  return <button type="button" className={`${btnBase} ${tone} ${className}`} {...props} />;
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-400 transition-colors focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${props.className ?? ""}`}
    />
  );
}

// ---------- Field (etiqueta visible, patrón ProfileMenu) ----------

/** Campo con etiqueta VISIBLE (F6): la identidad del campo no desaparece
 * al escribir, a diferencia de placeholder + aria-label solos. Envuelve
 * el input/select/textarea; el aria-label existente se conserva. */
export function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

/** Enlace "Saltar al contenido" (F12/5.5): solo visible al enfocarlo con
 * teclado; evita atravesar los ~20 ítems de navegación antes del contenido. */
export function SkipLink({ label, targetId = "contenido" }: { label: string; targetId?: string }) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-zinc-900 focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-zinc-100 focus:ring-2 focus:ring-emerald-500/60"
    >
      {label}
    </a>
  );
}

// ---------- Money / DateText ----------

export function Money({
  value,
  currency = "USD",
  locale = "en-US",
}: {
  value: string | number | null | undefined;
  currency?: string;
  locale?: string;
}) {
  return <>{formatMoney(value, currency, locale)}</>;
}

export function DateText({ iso, locale }: { iso: string | null | undefined; locale: string }) {
  const d = formatDate(iso, locale);
  return <>{d ?? ""}</>;
}

// ---------- Errores mapeados a i18n ----------

/** Texto de error para mostrar: la clave i18n calculada en la frontera del
 * cliente (ApiError.key) manda sobre el mensaje crudo; si no hay clave, el
 * mensaje tal cual (comportamiento anterior). */
export function apiErrorText(err: unknown, t: Dictionary): string {
  if (err instanceof ApiError && err.key) {
    const map: Record<string, string> = {
      network: t.reliability.errorNetwork,
      unauthorized: t.reliability.errorUnauthorized,
      forbidden: t.reliability.errorForbidden,
      notFound: t.reliability.errorNotFound,
      server: t.reliability.errorServer,
      timeout: t.reliability.errorTimeout,
      unknown: t.reliability.errorUnknown,
    };
    return map[err.key] ?? err.message;
  }
  if (err instanceof Error) return err.message;
  return t.reliability.errorUnknown;
}

/** Banner de error con el patrón del dashboard (role=alert): texto mapeado,
 * detalle crudo solo en una línea "detalles" colapsable, y reintento opcional. */
export function ApiErrorBanner({
  error,
  t,
  onRetry,
}: {
  error: unknown;
  t: Dictionary;
  onRetry?: () => void;
}) {
  if (!error) return null;
  const detail = error instanceof ApiError ? error.detail : undefined;
  return (
    <div role="alert" className="mb-5 rounded-lg bg-red-500/10 px-4 py-3 text-sm leading-relaxed text-red-400">
      <p>{apiErrorText(error, t)}</p>
      {detail ? (
        <details className="mt-1 text-xs text-red-300/80">
          <summary className="cursor-pointer">{t.reliability.details}</summary>
          <p className="mt-1 break-words font-mono">{detail}</p>
        </details>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 min-h-[44px] rounded-lg border border-red-800 px-3 py-2 text-sm font-semibold text-red-300 hover:bg-red-950/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60"
        >
          {t.reliability.retry}
        </button>
      ) : null}
    </div>
  );
}

// ---------- ConfirmDialog ----------

export function ConfirmDialog({
  open,
  message,
  t,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  message: string;
  t: Dictionary;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.reliability.confirmTitle}
        className="w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl"
      >
        <p className="text-sm leading-relaxed text-zinc-100">{message}</p>
        <div className="mt-5 flex gap-2.5">
          <button
            type="button"
            ref={cancelRef}
            onClick={onCancel}
            className="min-h-[44px] flex-1 rounded-lg border border-zinc-700 px-3 py-2.5 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            {t.reliability.confirmCancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-[44px] flex-1 rounded-lg bg-red-700 px-3 py-2.5 text-sm font-semibold text-white hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60"
          >
            {t.reliability.confirmOk}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Hook para reemplazar window.confirm: `const { confirm, dialog } = useConfirm(t);`
 * renderizar `{dialog}` una vez en el panel y `await confirm(mensaje)` en el
 * handler (ya no bloquea la pestaña y funciona igual en móvil). */
export function useConfirm(t: Dictionary): {
  confirm: (message: string) => Promise<boolean>;
  dialog: ReactNode;
} {
  const [pending, setPending] = useState<{ message: string; resolve: (v: boolean) => void } | null>(null);
  const confirm = useCallback(
    (message: string) =>
      new Promise<boolean>((resolve) => {
        setPending({ message, resolve });
      }),
    [],
  );
  const close = useCallback(
    (v: boolean) => {
      pending?.resolve(v);
      setPending(null);
    },
    [pending],
  );
  const dialog = pending ? (
    <ConfirmDialog
      open
      message={pending.message}
      t={t}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  ) : null;
  return { confirm, dialog };
}

/** Botón que pide confirmación con el diálogo compartido antes de actuar. */
export function ConfirmButton({
  confirmMessage,
  onConfirm,
  t,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  confirmMessage: string;
  onConfirm: () => void | Promise<void>;
  t: Dictionary;
}) {
  const { confirm, dialog } = useConfirm(t);
  return (
    <>
      <button
        type="button"
        {...props}
        onClick={async () => {
          if (await confirm(confirmMessage)) await onConfirm();
        }}
      >
        {children}
      </button>
      {dialog}
    </>
  );
}

// ---------- LoadMore (render incremental en cliente) ----------

export function LoadMore({
  visible,
  total,
  t,
  onLoadMore,
}: {
  visible: number;
  total: number;
  t: Dictionary;
  onLoadMore: () => void;
}) {
  if (visible >= total) return null;
  return (
    <div className="mt-3 text-center">
      <p className="mb-2 text-xs text-zinc-500">
        {t.reliability.showingOf.replace("{n}", String(visible)).replace("{total}", String(total))}
      </p>
      <button
        type="button"
        onClick={onLoadMore}
        className="min-h-[44px] rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
      >
        {t.reliability.loadMore}
      </button>
    </div>
  );
}

// ---------- Fallbacks de compatibilidad (FE14) ----------

let idCounter = 0;
/** crypto.randomUUID() exige contexto seguro y navegador moderno; sin él,
 * un id único local (timestamp + aleatorio + contador) para las claves de
 * idempotencia del cliente. No es un UUID RFC, solo una clave única local. */
export function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* cae al fallback */
  }
  idCounter += 1;
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${idCounter}`;
}

/** Portapapeles con fallback: si writeText no existe o falla (iframe, HTTP),
 * selecciona un textarea temporal para copiar a mano. Devuelve true si copió. */
export async function copyTextWithFallback(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* cae al fallback */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
