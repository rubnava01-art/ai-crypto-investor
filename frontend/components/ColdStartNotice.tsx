"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "../lib/i18n";

/** Aviso de cold start (Fase 5, 2026-11-23): solo se muestra cuando la
 * primera carga supera ~5 s. Muestra el tiempo transcurrido REAL (nunca
 * progreso falso) y un reintento manual visible. `elapsedSeconds` permite
 * que el llamador (ModuleShell) aporte su propio cronómetro; si no se
 * pasa, el componente lleva el suyo desde que `loading` es true. */
export function ColdStartNotice({
  loading,
  onRetry,
  elapsedSeconds,
}: {
  loading: boolean;
  onRetry?: () => void;
  elapsedSeconds?: number;
}) {
  const { t } = useLanguage();
  const [internalElapsed, setInternalElapsed] = useState(0);
  useEffect(() => {
    if (!loading || elapsedSeconds !== undefined) {
      setInternalElapsed(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(
      () => setInternalElapsed(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, [loading, elapsedSeconds]);
  const elapsed = elapsedSeconds ?? internalElapsed;
  if (!loading || elapsed < 5) return null;
  return (
    <div
      role="status"
      data-coldstart
      className="mb-5 rounded-xl border border-amber-700/60 bg-amber-500/10 px-4 py-3.5"
    >
      <p className="text-sm font-semibold text-amber-300">{t.dashboard.coldStartTitle}</p>
      <p className="mt-1 text-sm leading-relaxed text-amber-200/90">{t.dashboard.coldStartBody}</p>
      <p className="mt-1 text-sm tabular-nums text-amber-300">
        {t.dashboard.coldStartElapsed.replace("{seconds}", String(elapsed))}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex min-h-[44px] items-center rounded-lg border border-amber-500/60 px-4 py-2.5 text-sm font-semibold text-amber-200 hover:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
        >
          {t.dashboard.coldStartRetry}
        </button>
      )}
    </div>
  );
}
