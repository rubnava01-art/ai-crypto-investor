"use client";

import { useLanguage } from "../lib/i18n";

/** Página 404 propia (corrida 3 agentes 2026-10-29): antes caía en la página
 * genérica de Next.js, en inglés y fuera del tema oscuro. */
export default function NotFound() {
  const { t } = useLanguage();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-zinc-950 px-4 py-10 text-center">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.25em] text-emerald-400">
        {t.header.brand}
      </p>
      <h1 className="text-2xl font-bold tracking-tight text-zinc-100">{t.misc.notFoundTitle}</h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-400 [text-wrap:balance]">
        {t.misc.notFoundBody}
      </p>
      <a
        href="/"
        className="mt-6 inline-flex min-h-[2.75rem] items-center rounded-lg border border-zinc-700 px-5 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-800"
      >
        {t.misc.backHome}
      </a>
    </main>
  );
}
