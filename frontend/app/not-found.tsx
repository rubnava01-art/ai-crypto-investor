"use client";

import { useLanguage } from "../lib/i18n";

/** Página 404 propia (corrida 3 agentes 2026-10-29): antes caía en la página
 * genérica de Next.js, en inglés y fuera del tema oscuro. */
export default function NotFound() {
  const { t } = useLanguage();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4 text-center">
      <h1 className="text-xl font-bold text-zinc-100">{t.misc.notFoundTitle}</h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-400">
        {t.misc.notFoundBody}
      </p>
      <a
        href="/"
        className="mt-6 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-800"
      >
        {t.misc.backHome}
      </a>
    </main>
  );
}
