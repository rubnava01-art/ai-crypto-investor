"use client";

// Certificado de finalización por recorrido (Fase 5a, tarea 6): solo
// existe al completar el 100 % de las clases del recorrido (grabada /
// envivo). Datos reales: nombre del usuario y fecha de finalización
// del servidor. Sin sellos ni credenciales inventadas: el texto deja
// claro que es un certificado de finalización de la plataforma, no un
// título oficial. Imprimible: el botón usa window.print() y los
// controles se ocultan al imprimir (print:hidden).
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, type CertificateOut, type EduClassKind } from "../../../../lib/api";
import { ApiErrorBanner } from "../../../../components/ui";
import { useLanguage } from "../../../../lib/i18n";
import { useCancelled } from "../../../../lib/useLoad";
import { formatDateTz } from "../../../../lib/dates";

export default function CertificadoPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = use(params);
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "es-MX";
  const isCancelled = useCancelled();
  const [cert, setCert] = useState<CertificateOut | null>(null);
  const [error, setError] = useState<unknown>(null);

  const validKind = kind === "grabada" || kind === "envivo";
  const courseName = validKind
    ? kind === "grabada"
      ? t.clases.recordedTitle
      : t.clases.liveTitle
    : kind;

  const load = useCallback(async () => {
    if (!validKind) return;
    try {
      const c = await api.getCertificate(kind as EduClassKind);
      if (isCancelled()) return;
      setCert(c);
      setError(null);
    } catch (err) {
      if (isCancelled()) return;
      setError(err);
    }
  }, [kind, validKind, isCancelled]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="print:hidden mb-4 flex flex-wrap gap-2">
        <Link
          href="/estudiar"
          className="inline-flex min-h-[44px] items-center rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
        >
          ← {t.clases.certBack}
        </Link>
        {cert?.completed && (
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex min-h-[44px] items-center rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            {t.clases.certPrint}
          </button>
        )}
      </div>
      {error ? (
        <ApiErrorBanner error={error} t={t} onRetry={load} />
      ) : cert === null ? (
        <p className="text-sm text-zinc-400">{t.clases.certLoading}</p>
      ) : !cert.completed ? (
        <p role="status" className="rounded-lg border border-amber-800 bg-amber-950/40 px-4 py-3 text-sm leading-relaxed text-amber-300">
          {t.clases.certNotReady}
        </p>
      ) : (
        <article
          aria-label={t.clases.certTitle}
          className="rounded-2xl border-2 border-indigo-500/60 bg-zinc-900 px-6 py-10 text-center sm:px-12"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">{t.clases.certPlatform}</p>
          <h1 className="mt-3 text-2xl font-bold text-zinc-100 sm:text-3xl">{t.clases.certTitle}</h1>
          <p className="mt-6 text-sm text-zinc-400">{t.clases.certAwardedTo}</p>
          <p className="mt-1 text-2xl font-bold text-zinc-100 sm:text-3xl">{cert.user_name}</p>
          <p className="mt-6 text-base font-semibold text-zinc-100">{courseName}</p>
          <p className="mt-1 text-sm text-zinc-400">
            {t.clases.certCompletedOn.replace(
              "{date}",
              formatDateTz(cert.completed_at, locale) ?? "—",
            )}
          </p>
          <p className="mx-auto mt-8 max-w-md border-t border-zinc-800 pt-4 text-xs leading-relaxed text-zinc-400">
            {t.clases.certDisclaimer}
          </p>
        </article>
      )}
    </main>
  );
}
