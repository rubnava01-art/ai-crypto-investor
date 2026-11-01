"use client";

import { useLanguage } from "../lib/i18n";

export default function Loading() {
  const { t } = useLanguage();
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 sm:px-6 sm:py-8" role="status" aria-label={t.misc.loadingAria}>
      <div aria-hidden="true" className="h-8 w-48 motion-safe:animate-pulse rounded-lg bg-zinc-800" />
      <div aria-hidden="true" className="h-40 motion-safe:animate-pulse rounded-xl bg-zinc-900/70" />
      <div aria-hidden="true" className="h-40 motion-safe:animate-pulse rounded-xl bg-zinc-900/70" />
    </div>
  );
}
